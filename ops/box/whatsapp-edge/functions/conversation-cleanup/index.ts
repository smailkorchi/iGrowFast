// conversation-cleanup
//
// Admin-only. Two modes:
//
//   mode = 'clear'  → deletes every message in the conversation + their R2
//                     media, resets conversation summary columns. Conversation
//                     row, assignments, tags, notes survive.
//
//   mode = 'delete' → deletes the entire conversation row. CASCADE wipes
//                     messages / assignments / notes / tags / outbound_queue.
//                     media_fetch_jobs CASCADE from messages. R2 media is
//                     wiped first so we don't orphan storage.
//
// Pipeline mirrors instance-delete:
//   1. Preflight RPC (admin-gated) returns counts + r2_keys.
//   2. R2 batch DeleteObjects (1000 keys per request).
//   3. DB op:
//        clear  → admin_conversation_clear RPC
//        delete → DELETE FROM conversations WHERE id = $1 (RLS allows admin)
//
// Return shape:
//   { ok: true, mode, summary: { counts, r2_objects_deleted, db_result } }
//   { ok: false, reason, ...details }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { admin, requireAdmin } from '../_shared/admin.ts'
import { json, preflight } from '../_shared/cors.ts'

const R2_ENDPOINT          = Deno.env.get('R2_MEDIA_ENDPOINT')!
const R2_ACCESS_KEY_ID     = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID')!
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY')!
const R2_BUCKET            = Deno.env.get('R2_MEDIA_BUCKET') ?? 'whatsapp-media'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const r2 = new AwsClient({
  accessKeyId:     R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service:         's3',
  region:          'auto',
})

interface PreflightResult {
  conversation_id: string
  counts: Record<string, number>
  r2_keys: string[]
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function r2DeleteBatch(keys: string[]): Promise<{ deleted: number; errors: { key: string; code: string }[] }> {
  if (keys.length === 0) return { deleted: 0, errors: [] }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Delete><Quiet>false</Quiet>' +
    keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join('') +
    '</Delete>'

  const url = `${R2_ENDPOINT.replace(/\/+$/, '')}/${encodeURIComponent(R2_BUCKET)}?delete`
  const res = await r2.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/xml' },
    body: xml,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`R2 DeleteObjects ${res.status}: ${body.slice(0, 256)}`)
  }
  const body = await res.text()

  const deleted = (body.match(/<Deleted>/g) ?? []).length
  const errors: { key: string; code: string }[] = []
  const errorBlocks = body.match(/<Error>[\s\S]*?<\/Error>/g) ?? []
  for (const b of errorBlocks) {
    const key  = b.match(/<Key>([^<]+)<\/Key>/)?.[1] ?? ''
    const code = b.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? 'Unknown'
    errors.push({ key, code })
  }
  return { deleted, errors }
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, { status: 405 })

  const caller = await requireAdmin(req)
  if (!caller) return json({ ok: false, reason: 'forbidden' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() }
  catch { return json({ ok: false, reason: 'invalid_input' }, { status: 400 }) }

  const conversationId = (raw as { conversation_id?: unknown })?.conversation_id
  const mode           = (raw as { mode?: unknown })?.mode

  if (typeof conversationId !== 'string' || !UUID_RE.test(conversationId)) {
    return json({ ok: false, reason: 'invalid_conversation_id' }, { status: 400 })
  }
  if (mode !== 'clear' && mode !== 'delete') {
    return json({ ok: false, reason: 'invalid_mode' }, { status: 400 })
  }

  try {
    // 0. Snapshot (instance_id, remote_jid) BEFORE the delete — we need it
    //    to signal the worker afterwards (DELETE realtime events on the
    //    conversations table only carry the pkey, not full row data).
    const { data: convRow, error: convErr } = await admin
      .schema('whatsapp')
      .from('conversations')
      .select('instance_id, remote_jid')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      return json({ ok: false, reason: 'lookup_failed', error: convErr.message }, { status: 500 })
    }
    if (!convRow) {
      return json({ ok: false, reason: 'conversation_not_found' }, { status: 404 })
    }
    const peerInstanceId = convRow.instance_id as string
    const peerRemoteJid  = convRow.remote_jid as string

    // 1. Preflight — caller-scoped so the RPC's is_admin() runs against the JWT.
    const { data: preflightData, error: preErr } = await caller.client.schema('whatsapp').rpc(
      'admin_conversation_purge_preflight',
      { p_conversation_id: conversationId },
    )
    if (preErr) {
      return json({ ok: false, reason: 'preflight_failed', error: preErr.message }, { status: 500 })
    }
    const pf = preflightData as unknown as PreflightResult
    const keys = pf?.r2_keys ?? []

    // 2. R2 wipe (best-effort — orphan R2 < orphan DB).
    let r2Deleted = 0
    const r2Errors: { key: string; code: string }[] = []
    for (let i = 0; i < keys.length; i += 1000) {
      const slice = keys.slice(i, i + 1000)
      try {
        const r = await r2DeleteBatch(slice)
        r2Deleted += r.deleted
        if (r.errors.length) r2Errors.push(...r.errors)
      } catch (err) {
        console.error('r2_batch_failed', err instanceof Error ? err.message : err)
        r2Errors.push({ key: slice[0] ?? '?', code: 'batch_threw' })
      }
    }

    // 3. DB op
    let dbResult: unknown = null
    if (mode === 'clear') {
      const { data, error } = await caller.client.schema('whatsapp').rpc(
        'admin_conversation_clear',
        { p_conversation_id: conversationId },
      )
      if (error) {
        return json({
          ok: false, reason: 'db_clear_failed', error: error.message,
          partial: { r2_objects_deleted: r2Deleted, r2_errors: r2Errors },
        }, { status: 500 })
      }
      dbResult = data
    } else {
      // mode === 'delete' — service-role DELETE; admin RLS already evaluated.
      // The caller client could also do this directly, but using the admin
      // client mirrors the instance-delete pattern + avoids a redundant RLS
      // round-trip after the preflight already authorized.
      const { error } = await admin
        .schema('whatsapp')
        .from('conversations')
        .delete()
        .eq('id', conversationId)
      if (error) {
        return json({
          ok: false, reason: 'db_delete_failed', error: error.message,
          partial: { r2_objects_deleted: r2Deleted, r2_errors: r2Errors },
        }, { status: 500 })
      }
      dbResult = { conversation_id: conversationId, deleted: true }
    }

    // 4. Tell the worker to drop its peer-subscription cache for this peer
    //    so the next inbound message re-fires sendPresence (which is what
    //    re-subscribes Baileys to peer typing events). Only meaningful on
    //    `delete` — `clear` keeps Baileys' existing subscription valid.
    //    Best-effort: a failure here doesn't roll back the DB op; the
    //    20-min periodic warmup loop will recover within one tick anyway.
    if (mode === 'delete') {
      try {
        const ch = admin.channel(`wa-typing:${peerInstanceId}`, {
          config: { broadcast: { self: false, ack: false } },
        })
        await new Promise<void>((resolve) => {
          ch.subscribe(async (status) => {
            if (status !== 'SUBSCRIBED') return
            await ch.send({
              type: 'broadcast',
              event: 'purge_peer',
              payload: { remote_jid: peerRemoteJid },
            })
            await admin.removeChannel(ch)
            resolve()
          })
          // Don't wait forever — if the channel can't subscribe, move on.
          setTimeout(() => { void admin.removeChannel(ch); resolve() }, 3000)
        })
      } catch (err) {
        console.error('purge_peer_broadcast_failed', err instanceof Error ? err.message : err)
      }
    }

    return json({
      ok: true,
      mode,
      summary: {
        counts:             pf?.counts ?? {},
        r2_objects_deleted: r2Deleted,
        r2_errors:          r2Errors,
        db_result:          dbResult,
      },
    }, { status: 200 })
  } catch (err) {
    return json({
      ok: false, reason: 'handler_threw',
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
})
