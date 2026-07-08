// instance-delete
//
// Admin-only. Fully decommissions a number — zero leftovers anywhere:
//   1. Preflight RPC → counts of everything that will be wiped + the list of
//      R2 storage keys belonging to this instance.
//   2. R2 bucket: batch-delete every chat media + quick-reply attachment via
//      S3 DeleteObjects (1000 keys per request).
//   3. Evolution server: DELETE /instance/delete/{name} (tolerates 404 — if
//      it's already gone, we still finish the local cleanup).
//   4. Database: DELETE whatsapp_instances row. Existing FK CASCADEs wipe:
//      conversations, messages, conversation_assignments, conversation_notes,
//      conversation_tags, outbound_queue, jid_mapping, contact_profiles,
//      tags, quick_replies, media_fetch_jobs, group_participants,
//      number_pacing_state. Contacts get orphaned (instance_id NULL) by the
//      new SET NULL FK — admin's manually-uploaded book_name survives for
//      re-link on the next instance pair.
//   5. Worker side: the realtime subscription on whatsapp_instances picks up
//      the DELETE event and calls stopDispatcher(id) automatically — no
//      separate signal needed.
//
// Return shape:
//   { ok: true, summary: { counts, r2_objects_deleted, evolution_status } }
//   { ok: false, reason: string, ...details }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { deleteInstance as evolutionDeleteInstance } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

const R2_ENDPOINT          = Deno.env.get('R2_MEDIA_ENDPOINT')!
const R2_ACCESS_KEY_ID     = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID')!
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY')!
const R2_BUCKET            = Deno.env.get('R2_MEDIA_BUCKET') ?? 'whatsapp-media'

const r2 = new AwsClient({
  accessKeyId:     R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service:         's3',
  region:          'auto',
})

interface PreflightResult {
  instance_id: string
  counts: Record<string, number>
  r2_keys: string[]
}

/**
 * Delete up to 1000 keys per call via S3 DeleteObjects XML API.
 * Returns the actual number of objects removed (R2 is idempotent — missing
 * keys are reported as Deleted, not errors).
 */
async function r2DeleteBatch(keys: string[]): Promise<{ deleted: number; errors: { key: string; code: string }[] }> {
  if (keys.length === 0) return { deleted: 0, errors: [] }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Delete><Quiet>false</Quiet>' +
    keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join('') +
    '</Delete>'

  // R2 accepts a signed POST without Content-MD5 — aws4fetch sets
  // x-amz-content-sha256 during signing which satisfies the checksum
  // requirement. (Deno Edge Runtime doesn't expose MD5 via Web Crypto.)
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * List every object key under a prefix via paginated ListObjectsV2. Used to
 * catch instance-scoped objects the preflight DB-key list misses — derived
 * `*.preview.jpg` thumbnails and `avatars/<id>/*` — so a delete leaves zero R2
 * trace, not just the keys recorded in messages/quick_replies rows.
 */
async function r2ListPrefix(prefix: string): Promise<string[]> {
  const out: string[] = []
  let token: string | undefined
  for (let guard = 0; guard < 100; guard++) {
    const u = new URL(`${R2_ENDPOINT.replace(/\/+$/, '')}/${encodeURIComponent(R2_BUCKET)}`)
    u.searchParams.set('list-type', '2')
    u.searchParams.set('prefix', prefix)
    u.searchParams.set('max-keys', '1000')
    if (token) u.searchParams.set('continuation-token', token)
    const res = await r2.fetch(u.toString())
    if (!res.ok) {
      const b = await res.text().catch(() => '')
      throw new Error(`R2 ListObjectsV2 ${res.status}: ${b.slice(0, 200)}`)
    }
    const body = await res.text()
    for (const m of body.matchAll(/<Key>([^<]+)<\/Key>/g)) out.push(decodeXml(m[1]))
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(body)
    token = body.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
    if (!truncated || !token) break
  }
  return out
}

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // 1. Preflight — gather counts + R2 key list. Must run as the caller
    //    (not service-role) so the RPC's is_admin() gate evaluates the
    //    admin's JWT, not the contextless service-role client.
    const { data: preflight, error: preErr } = await ctx.callerClient.schema('whatsapp').rpc(
      'admin_instance_delete_preflight',
      { p_instance_id: ctx.instanceId },
    )
    if (preErr) {
      return json({ ok: false, reason: 'preflight_failed', error: preErr.message }, { status: 500 })
    }
    const pf = preflight as unknown as PreflightResult

    // 2. Wipe R2 (best-effort — partial failures are reported but do not
    //    block the rest of the cleanup; orphan R2 objects are far less
    //    harmful than orphan DB rows).
    //
    //    Key set = preflight DB keys (quick_replies attachments + any key not
    //    under an instance prefix) UNIONED with a live prefix sweep of
    //    `<instanceId>/**` (chat media + derived .preview.jpg) and
    //    `avatars/<instanceId>/**` (cached WA avatars). The prefix sweep is what
    //    guarantees zero R2 trace — the old DB-key-only list missed previews and
    //    avatars, stranding them on every delete.
    let r2Deleted = 0
    const r2Errors: { key: string; code: string }[] = []
    const keySet = new Set<string>(pf?.r2_keys ?? [])
    for (const prefix of [`${ctx.instanceId}/`, `avatars/${ctx.instanceId}/`]) {
      try {
        for (const k of await r2ListPrefix(prefix)) keySet.add(k)
      } catch (err) {
        console.error('r2_list_failed', prefix, err instanceof Error ? err.message : err)
        r2Errors.push({ key: prefix + '*', code: 'list_failed' })
      }
    }
    const keys = [...keySet]
    for (let i = 0; i < keys.length; i += 1000) {
      const slice = keys.slice(i, i + 1000)
      try {
        const r = await r2DeleteBatch(slice)
        r2Deleted += r.deleted
        if (r.errors.length) r2Errors.push(...r.errors)
      } catch (err) {
        // Log and continue — we still want to wipe DB + Evolution
        console.error('r2_batch_failed', err instanceof Error ? err.message : err)
        r2Errors.push({ key: slice[0] ?? '?', code: 'batch_threw' })
      }
    }

    // 3. Evolution server delete — tolerant. A 200 means the WA session is
    //    logged out + the named instance is gone from Evolution. A 404 means
    //    it was already gone. ANYTHING ELSE (5xx, network blip, timeout):
    //    we record the failure but proceed with DB cleanup so the local
    //    state never gets stranded by a transient server issue. Admin can
    //    inspect evolutionError in the summary if cleanup on that side is
    //    needed (the named instance becomes harmless drift on Evolution).
    // Retry transient failures (5xx/network) up to 3 attempts — a single blip
    // here is what stranded `h-x3n7fobv` (DB row gone, Evolution instance left).
    // On persistent failure we still delete the DB row (never strand local
    // state); the worker's orphan reaper sweeps the leftover Evolution instance.
    let evo = await evolutionDeleteInstance(ctx.evolutionBaseUrl, ctx.evolutionInstanceName)
    for (let attempt = 1; attempt < 3 && !evo.ok && evo.status !== 404; attempt++) {
      await new Promise((r) => setTimeout(r, 800 * attempt))
      evo = await evolutionDeleteInstance(ctx.evolutionBaseUrl, ctx.evolutionInstanceName)
    }
    let evolutionStatus: 'deleted' | 'already_gone' | 'failed'
    let evolutionError: unknown = null
    if (evo.ok)               evolutionStatus = 'deleted'
    else if (evo.status === 404) evolutionStatus = 'already_gone'
    else {
      evolutionStatus = 'failed'
      evolutionError = { status: evo.status, body: evo.body }
      console.error('evolution_delete_failed_continuing', evolutionError)
    }

    // 4. Database row delete — cascades through all per-instance children;
    //    contacts auto-orphan via the new ON DELETE SET NULL FK.
    const { error: delErr } = await admin
      .schema('whatsapp')
      .from('whatsapp_instances')
      .delete()
      .eq('id', ctx.instanceId)

    if (delErr) {
      return json({
        ok: false,
        reason: 'db_delete_failed',
        error: delErr.message,
        partial: {
          r2_objects_deleted: r2Deleted,
          r2_errors: r2Errors,
          evolution_status: evolutionStatus,
        },
      }, { status: 500 })
    }

    return json({
      ok: true,
      summary: {
        counts: pf?.counts ?? {},
        r2_objects_deleted: r2Deleted,
        r2_errors: r2Errors,
        evolution_status: evolutionStatus,
        evolution_error: evolutionError,
      },
    }, { status: 200 })
  }),
)
