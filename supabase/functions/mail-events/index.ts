// @ts-nocheck - Deno runtime types not recognized by VSCode
// Receiver for Stalwart's webhook delivery events (T22). Stalwart's own POST envelope is not
// documented — this function is deliberately shape-tolerant: every event is stored verbatim in
// email_delivery_events (matched or not), and email_log is updated only when the event's queue
// id (falling back to message id) matches a row send-email wrote. An unmatched event is not a
// bug — it's the only way we get to see the real payload shape.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mail-events-secret, x-signature, x-stalwart-signature, x-webhook-signature',
};

const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

// Constant-time string compare — a header/HMAC secret check must not leak timing information
// through an early-exit comparison. Equal-length inputs are compared byte-by-byte with no
// short-circuit; a length mismatch is itself not a meaningful secret to protect here (Node's
// own crypto.timingSafeEqual also rejects mismatched lengths).
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function toBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}
async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

// Search an event object for the first of `keys` present at the top level, or one level down
// under `data`/`payload` — the only nesting the envelope is known (or guessed) to use. Never
// throws on an unexpected shape; just returns null.
function findField(obj: unknown, keys: string[]): string | null {
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
        if (o[k] !== undefined && o[k] !== null) return String(o[k]);
    }
    for (const nestKey of ['data', 'payload']) {
        const nested = o[nestKey];
        if (nested && typeof nested === 'object') {
            for (const k of keys) {
                const v = (nested as Record<string, unknown>)[k];
                if (v !== undefined && v !== null) return String(v);
            }
        }
    }
    return null;
}

// Best-effort Message-ID-looking string anywhere in the event, for when no explicit
// messageId/message_id field exists (e.g. a bounce DSN quoting the original header).
function findMessageIdLike(event: unknown): string | null {
    const str = JSON.stringify(event);
    const m = str.match(/<[^<>@\s"]+@[^<>@\s"]+>/);
    return m ? m[0] : null;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // ── 1. Fail closed if the shared secret isn't configured ───────────
    const secret = Deno.env.get('MAIL_EVENTS_SECRET');
    if (!secret) {
        console.error('[mail-events] MAIL_EVENTS_SECRET not configured — refusing all requests');
        return json({ error: 'not configured' }, 503);
    }

    // Read the raw body ONCE (needed verbatim for HMAC verification) and parse it ourselves.
    const rawBody = await req.text();

    // ── 2. Authenticate: shared-secret header OR HMAC-SHA256 over the raw body ──
    // Stalwart's exact signing header name isn't documented, so any of the three plausible
    // ones is accepted; the digest can plausibly arrive as hex or base64, so both encodings
    // are checked, case-insensitively (hex especially — some emitters use uppercase A-F).
    // The shared secret itself is compared exactly. All comparisons are constant-time.
    const headerSecret = req.headers.get('x-mail-events-secret');
    let authorized = !!headerSecret && timingSafeEqual(headerSecret, secret);

    if (!authorized) {
        const sigHeaderNames = ['x-signature', 'x-stalwart-signature', 'x-webhook-signature'];
        const sigHeader = sigHeaderNames.map((h) => req.headers.get(h)).find((v) => !!v);
        if (sigHeader) {
            const mac = await hmacSha256(secret, rawBody);
            const expectedHex = toHex(mac).toLowerCase();
            const expectedB64 = toBase64(mac).toLowerCase();
            const given = sigHeader.trim().toLowerCase();
            authorized = timingSafeEqual(given, expectedHex) || timingSafeEqual(given, expectedB64);
        }
    }

    if (!authorized) {
        console.error('[mail-events] auth failed: no matching shared secret or signature');
        return json({ error: 'unauthorized' }, 401);
    }

    // ── 3. Init Supabase (service-role) ─────────────────────────────────
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 4. Parse the body defensively. The envelope may be a single event object,
    // `{events: [...]}`, or a bare array. Anything else (including invalid JSON) is
    // wrapped into one synthetic event so it still gets recorded, never thrown on.
    let events: unknown[];
    try {
        const parsed = rawBody ? JSON.parse(rawBody) : null;
        if (Array.isArray(parsed)) {
            events = parsed;
        } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).events)) {
            events = (parsed as Record<string, unknown>).events as unknown[];
        } else if (parsed && typeof parsed === 'object') {
            events = [parsed];
        } else {
            events = [{ raw: rawBody }];
        }
    } catch (parseErr) {
        console.warn('[mail-events] body was not valid JSON:', parseErr);
        events = [{ raw: rawBody }];
    }

    let received = 0;
    let matched = 0;
    let recorded = 0;
    let recordFailures = 0;

    for (const event of events) {
        received++;
        try {
            const eventType = findField(event, ['type', 'event', 'eventType']);
            // Deliberately NOT falling back to a bare `id`: an envelope's own event id would
            // be indistinguishable from a queue id here, and a false match would stamp
            // "delivered"/"bounced" onto an unrelated email. An unmatched event costs nothing
            // (it is still recorded, and tells us the real field name to add here).
            const queueId = findField(event, ['queueId', 'queue_id']);
            const messageId = findField(event, ['messageId', 'message_id', 'messageID']) ?? findMessageIdLike(event);

            // ── Match against email_log: queue_id first (the primary join key per Stalwart's
            // DATA ack), message_id as fallback (bounce DSNs quote the original Message-ID). ──
            let logRow: { id: string; status: string } | null = null;
            if (queueId) {
                const { data } = await supabase.from('email_log').select('id, status').eq('queue_id', queueId).maybeSingle();
                logRow = data ?? null;
            }
            if (!logRow && messageId) {
                const { data } = await supabase.from('email_log').select('id, status').eq('message_id', messageId).maybeSingle();
                logRow = data ?? null;
            }

            // Postgres jsonb rejects NUL (U+0000) with SQLSTATE 22P05. Such a payload would fail
            // to insert on every attempt, and because a batch that records nothing asks Stalwart
            // to retry, it would loop forever. Strip it so an event is always storable.
            let safePayload: unknown = event;
            try {
                // Operates on the SERIALISED form, where a NUL appears as the six characters
                // backslash-u-0-0-0-0, so it is removed before Postgres ever sees it.
                safePayload = JSON.parse(JSON.stringify(event).split("\\u0000").join(""));
            } catch { /* unserialisable — keep the original and let the insert decide */ }

            // Always record — matched or not. This table is how we discover the real payload
            // shape, so an unmatched event must still be stored, never dropped.
            const { error: recordErr } = await supabase.from('email_delivery_events').insert({
                event_type: eventType,
                queue_id: queueId,
                email_log_id: logRow?.id ?? null,
                matched: !!logRow,
                payload: safePayload,
            });
            if (recordErr) { recordFailures++; console.error('[mail-events] failed to record event:', recordErr.message); }
            else recorded++;

            if (logRow) {
                matched++;

                const et = (eventType ?? '').toLowerCase();
                const isDelivered = et.includes('delivered') || et.includes('dsn-success');
                const isPermFail = et.includes('perm-fail') || et.includes('rcpt-to-rejected');
                const isTempFail = et.includes('temp-fail') || et.includes('deferred');

                // Delivered/bounced are the final states in the vocabulary (queued -> sent ->
                // delivered | bounced | deferred). A row already in one of those must never
                // regress — a replayed, duplicated or late webhook must not move it backward.
                // The guard is applied IN THE UPDATE's own WHERE clause, not from the status we
                // read above: two events arriving concurrently would both read 'sent' and both
                // pass a read-then-write check. Filtering on the non-final states makes the
                // database itself the arbiter, so the loser of a race simply updates 0 rows.
                const NON_FINAL = ['queued', 'sent', 'deferred'];
                const nowIso = new Date().toISOString();

                if (isDelivered) {
                    await supabase.from('email_log').update({
                        status: 'delivered', delivered_at: nowIso, updated_at: nowIso,
                    }).eq('id', logRow.id).in('status', NON_FINAL);
                } else if (isPermFail) {
                    const failureCode = findField(event, ['code', 'failureCode', 'failure_code', 'smtpCode']);
                    const failureReason = findField(event, ['reason', 'details', 'failure_reason', 'error', 'message']);
                    await supabase.from('email_log').update({
                        status: 'bounced', failed_at: nowIso, updated_at: nowIso,
                        ...(failureCode ? { failure_code: failureCode } : {}),
                        ...(failureReason ? { failure_reason: failureReason } : {}),
                    }).eq('id', logRow.id).in('status', NON_FINAL);
                } else if (isTempFail) {
                    // A deferral is only meaningful before a final outcome; the same WHERE-clause
                    // guard keeps a late retry notice from downgrading a delivered/bounced row.
                    await supabase.from('email_log').update({
                        status: 'deferred', updated_at: nowIso,
                    }).eq('id', logRow.id).in('status', NON_FINAL);
                }
                // Anything else (or isFinal already true): the event is recorded above; leave
                // email_log alone.
            }
        } catch (eventErr) {
            // One malformed event must never take down the rest of the batch or the response.
            console.error('[mail-events] failed to process one event:', eventErr);
        }
    }

    // A webhook receiver that 500s makes the sender retry forever, so an unmatched or
    // unrecognised event is still a 200 — not matching is an expected outcome, not an error.
    // The one case that MUST fail loudly is losing the event entirely: if we received events
    // and recorded none of them (the database is down), returning 200 would tell Stalwart the
    // delivery outcome was safely taken and it would never be sent again. Ask for the retry.
    if (received > 0 && recorded === 0) {
        return json({ error: 'could not record any event', received, recordFailures }, 503);
    }
    return json({ received, recorded, matched });
});
