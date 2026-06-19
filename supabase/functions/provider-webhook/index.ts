// @ts-nocheck - Deno runtime types not recognized by VSCode
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/* Forward-progression ranks — webhook must not move an order backward */
const FORWARD_RANKS: Record<string, number> = {
    new: 0,
    pickup_pending: 1,
    picked_up: 2,
    in_transit: 3,
    out_for_delivery: 4,
};

/* Terminal categories — once an order is here, only same-category status updates are allowed.
 * Prevents Coliaty's PARCEL_SITUATION_CHANGED (sent days after delivery when the invoice is
 * paid) from flipping a delivered order back into in_transit, and prevents a refused/returned
 * order from being clobbered by a stale status push. */
const TERMINAL_CATEGORIES = new Set(['delivered', 'returned', 'refused', 'cancelled']);

/* Parse Coliaty DATE field. Coliaty's API reference shows two formats in production:
 *   - PARCEL_STATUS_CHANGED:    "20/06/2025"  (dd/mm/yyyy)
 *   - PARCEL_SITUATION_CHANGED: "14-05-2026"  (dd-mm-yyyy)
 * Returns an ISO string anchored at 12:00 UTC of that day (avoids day-boundary drift on
 * timezone conversion) or null when the input is missing or unparseable. */
function parseColiatyDate(raw: unknown): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000) return null;
    const utc = Date.UTC(year, month - 1, day, 12, 0, 0);
    if (Number.isNaN(utc)) return null;
    return new Date(utc).toISOString();
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const json = (body: object, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    try {
        // ── 1. Extract provider ID + secret from URL ────────────────────
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const webhookSecret = pathParts[pathParts.length - 1];
        const providerId = pathParts[pathParts.length - 2];

        if (!providerId || !webhookSecret) {
            return json({ error: 'Invalid URL' }, 400);
        }

        // ── 2. Init Supabase (service-role) ─────────────────────────────
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );

        // ── 3. Parse payload (JSON, form-encoded, raw text, or URL query) ──
        // Delevo Express sends GET with templated URL params — merge query string
        // into the payload so a single extractor handles all providers.
        const contentType = req.headers.get('content-type') || '';
        let payload: any = {};
        // First, harvest query params (works for any method).
        for (const [k, v] of url.searchParams.entries()) {
            try { payload[k] = JSON.parse(v); } catch { payload[k] = v; }
        }
        // Then layer the body on top (if any).
        if (req.method !== 'GET') {
            if (contentType.includes('application/json')) {
                try { Object.assign(payload, await req.json()); } catch { /* empty body */ }
            } else if (contentType.includes('form') || contentType.includes('multipart')) {
                const formData = await req.formData();
                for (const [key, value] of formData.entries()) {
                    try { payload[key] = JSON.parse(value as string); } catch { payload[key] = value; }
                }
            } else {
                const text = await req.text();
                if (text) {
                    try { Object.assign(payload, JSON.parse(text)); } catch { payload.raw = text; }
                }
            }
        }

        console.log(`[webhook] provider=${providerId} payload=`, JSON.stringify(payload));

        // ── 4. Validate webhook credentials ─────────────────────────────
        const { data: webhookConfig, error: webhookError } = await supabase
            .from('provider_webhooks')
            .select('*, "DigiCom Business"')
            .eq('webhook_secret', webhookSecret)
            .eq('provider_id', providerId)
            .eq('is_active', true)
            .single();

        if (webhookError || !webhookConfig) {
            console.error('[webhook] auth failed:', webhookError?.message);
            return json({ error: 'Unauthorized' }, 401);
        }

        const businessId = webhookConfig['DigiCom Business'];

        // ── 5. Extract tracking code (Coliaty=TRACKING, AMEEX=CODE) ─────
        // Forcelog nests fields under `data` — extract defensively without disturbing flat providers.
        const forcelogData = (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object')
            ? payload.data
            : null;
        // Sendit payload shape is TBD — handle both wrapped (payload.data) and flat (payload.code).
        // Sendit delivery codes start with "D" (e.g. "DH1D31F9029"), distinguishable from Forcelog's "F-XXX".
        const trackingCode =
            payload.CODE ||        // AMEEX
            payload.TRACKING ||    // Coliaty
            payload.tracking_number ||
            payload.barcode ||
            payload.ref ||
            forcelogData?.parcel_code ||  // Forcelog
            payload.code ||                // Sendit (flat)
            forcelogData?.code ||          // Sendit (wrapped in data)
            payload.tracking ||            // Digylog (flat camelCase)
            payload.traking;               // Digylog typo per public docs

        // Always log — even if no tracking code (so we can debug)
        const { data: logEntry } = await supabase.from('webhook_logs').insert({
            provider_id: providerId,
            tracking_code: trackingCode || 'UNKNOWN',
            payload,
            processed: false,
            'DigiCom Business': businessId,
        }).select().single();

        // Update last-received heartbeat
        await supabase
            .from('provider_webhooks')
            .update({ last_received_at: new Date().toISOString() })
            .eq('id', webhookConfig.id);

        if (!trackingCode) {
            console.warn('[webhook] no tracking code in payload');
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: 'No tracking code in payload' }).eq('id', logEntry.id);
            return json({ status: 'logged', message: 'No tracking code' });
        }

        console.log(`[webhook] tracking=${trackingCode} business=${businessId}`);

        // ── 6. Find parcel → order ──────────────────────────────────────
        // Primary: company_parcels.tracking_code
        const { data: parcel } = await supabase
            .from('company_parcels')
            .select('id, order_id, provider_id')
            .eq('tracking_code', trackingCode)
            .eq('DigiCom Business', businessId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        let orderId: string | null = parcel?.order_id || null;

        // Fallback: orders.tracking_number (legacy/manual)
        if (!orderId) {
            const { data: order } = await supabase
                .from('orders')
                .select('id')
                .eq('tracking_number', trackingCode)
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null)
                .maybeSingle();
            if (order) orderId = order.id;
        }

        if (!orderId) {
            console.warn(`[webhook] order not found for tracking=${trackingCode}`);
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: 'Order not found for tracking code' }).eq('id', logEntry.id);
            return json({ status: 'logged', message: 'Order not found' });
        }

        // Skip soft-deleted orders entirely — don't leak status updates into trashed rows.
        // The parcel lookup above hits company_parcels.tracking_code without join, so deleted
        // orders can still surface here.
        const { data: orderMeta, error: orderMetaErr } = await supabase
            .from('orders')
            .select('id, date_deleted, delivered, payed, date_livraison, package_status_id, replace')
            .eq('id', orderId)
            .maybeSingle();

        if (orderMetaErr || !orderMeta) {
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: `Order lookup failed: ${orderMetaErr?.message || 'not found'}` }).eq('id', logEntry.id);
            return json({ status: 'logged', message: 'Order lookup failed' });
        }
        if (orderMeta.date_deleted) {
            if (logEntry) await supabase.from('webhook_logs').update({ processed: true, error_message: 'Order is soft-deleted — skipped' }).eq('id', logEntry.id);
            return json({ status: 'skipped', reason: 'order_deleted' });
        }

        console.log(`[webhook] orderId=${orderId}`);

        // ── 7. Coliaty event classification ─────────────────────────────
        // Coliaty now distinguishes two events. PARCEL_STATUS_CHANGED is the live lifecycle
        // event (delivered, picked_up, …). PARCEL_SITUATION_CHANGED fires later when the
        // invoice for that parcel is settled — Coliaty re-attaches the final STATUS
        // (DELIVERED / REFUSE) along with billing fields (INVOICE_REF, PRICE, FEES, NET).
        // The two MUST be handled differently: a SITUATION=PAID event arrives days after the
        // actual delivery and must NOT overwrite date_livraison.
        const eventName: string = String(payload.EVENT || '').toUpperCase();
        const situation: string = String(payload.SITUATION || '').toUpperCase();
        const isSituationEvent = eventName === 'PARCEL_SITUATION_CHANGED';
        const isPaidSituation = situation === 'PAID';

        // Pre-extract the webhook's own DATE so we can use it for date_livraison (delivery day)
        // when Coliaty includes it on the lifecycle event itself.
        const coliatyDate = parseColiatyDate(payload.DATE);

        // ── 8. Multi-candidate status matching ──────────────────────────
        // Priority: AMEEX sub-status > AMEEX/Coliaty main status > generic > Forcelog (data.secondary_status > data.status)
        // Sendit uses camelCase keys — `newStatus` for forward flow, `statusReturn` for returns.
        // `statusReturn === 'NA'` means no return event; skip it (filter below drops literal 'NA' too).
        const skipSenditNA = (v: unknown) => (typeof v === 'string' && v.toUpperCase() === 'NA' ? null : v);
        // PAID is not a real Coliaty status code (it's a SITUATION). Old Coliaty payloads
        // briefly mis-shipped EVENT=PARCEL_STATUS_CHANGED, STATUS=PAID — those events should
        // be treated as billing confirmations, not status changes. Drop "PAID" from the
        // status-mapping candidates so we don't error or wrongly downgrade the order.
        const dropPaid = (v: unknown) => (typeof v === 'string' && v.toUpperCase() === 'PAID' ? null : v);
        const statusCandidates = [
            payload.STATUT_S,                         // AMEEX sub-status (most precise)
            payload.STATUT,                           // AMEEX main status
            dropPaid(payload.STATUS),                 // Coliaty status (drop literal "PAID")
            skipSenditNA(payload.statusReturn),       // Sendit return-flow (camelCase, flat)
            payload.newStatus,                        // Sendit forward-flow (camelCase, flat)
            payload.status,                           // generic / legacy snake_case
            payload.status_return,                    // legacy snake_case return
            forcelogData?.secondary_status,           // Forcelog sub-status (more precise)
            forcelogData?.status,                     // Forcelog primary code
            forcelogData?.status_return,              // legacy wrapped return
            skipSenditNA(forcelogData?.statusReturn), // Sendit wrapped return (defensive)
            forcelogData?.newStatus,                  // Sendit wrapped forward (defensive)
        ].filter(Boolean);

        // PAID-only event (no real status field) — record the payment, skip status mapping.
        if (statusCandidates.length === 0 && isPaidSituation) {
            const billingUpdate: any = {
                payed: true,
                updated_at: new Date().toISOString(),
            };
            await supabase
                .from('orders')
                .update(billingUpdate)
                .eq('id', orderId)
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            if (logEntry) await supabase.from('webhook_logs').update({ processed: true }).eq('id', logEntry.id);
            console.log(`[webhook] PAID-only situation recorded for order=${orderId}`);
            return json({ status: 'success', situation: 'PAID', order_id: orderId });
        }

        if (statusCandidates.length === 0) {
            // Legacy stale Coliaty payload where STATUS=PAID was the only signal — degrade
            // gracefully: mark order as paid if SITUATION=PAID can be inferred from COMMENT.
            const commentHint = String(payload.COMMENT || '').toLowerCase();
            if (commentHint.includes('facture') && commentHint.includes('pay')) {
                await supabase
                    .from('orders')
                    .update({ payed: true, updated_at: new Date().toISOString() })
                    .eq('id', orderId)
                    .eq('DigiCom Business', businessId)
                    .is('date_deleted', null);
                if (logEntry) await supabase.from('webhook_logs').update({ processed: true, error_message: 'Inferred PAID from comment' }).eq('id', logEntry.id);
                return json({ status: 'success', inferred: 'PAID', order_id: orderId });
            }
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: 'No status field in payload' }).eq('id', logEntry.id);
            return json({ status: 'logged', message: 'Status missing' });
        }

        console.log(`[webhook] statusCandidates=`, statusCandidates);

        let matchedStatus: any = null;
        let matchedCandidate: string | null = null;

        // AMEEX uses IN_PROGRESS as a container ("check the sub-status"); Forcelog uses it as a real in-transit state.
        const isAmeexPayload = Boolean(payload.STATUT_S || payload.STATUT);

        for (const candidate of statusCandidates) {
            // Skip bare IN_PROGRESS — AMEEX container, not a real status. Forcelog sends IN_PROGRESS as a real code.
            if (candidate === 'IN_PROGRESS' && isAmeexPayload) continue;

            // Try RPC first (handles diacritics, case-insensitive, deterministic ordering)
            const { data: rpcMatch, error: rpcErr } = await supabase
                .rpc('match_package_status', { p_status_value: candidate });

            if (!rpcErr && rpcMatch?.[0]) {
                matchedStatus = rpcMatch[0];
                matchedCandidate = candidate;
                break;
            }

            // Fallback: JSONB array containment
            const { data: fbMatch } = await supabase
                .from('package_statuses')
                .select('id, code, label, category, color')
                .contains('delivery_service_statuses', JSON.stringify([candidate]))
                .limit(1)
                .maybeSingle();

            if (fbMatch) {
                matchedStatus = fbMatch;
                matchedCandidate = candidate;
                break;
            }
        }

        if (!matchedStatus) {
            const tried = statusCandidates.filter(c => c !== 'IN_PROGRESS').join(', ');
            console.warn(`[webhook] no mapping for candidates: ${tried}`);
            // Still update raw label on parcel even without mapping
            if (parcel) {
                await supabase.from('company_parcels').update({
                    status_label: statusCandidates[0],
                    updated_at: new Date().toISOString(),
                }).eq('id', parcel.id);
            }
            // If this was a paid-situation event with an unknown status, at least flag payed=true.
            if (isPaidSituation) {
                await supabase
                    .from('orders')
                    .update({ payed: true, updated_at: new Date().toISOString() })
                    .eq('id', orderId)
                    .eq('DigiCom Business', businessId)
                    .is('date_deleted', null);
            }
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: `No mapping for: ${tried}` }).eq('id', logEntry.id);
            return json({ status: 'logged', message: 'No mapping found' });
        }

        console.log(`[webhook] matched: "${matchedCandidate}" → ${matchedStatus.label} (${matchedStatus.code}, cat=${matchedStatus.category})`);

        // ── 9. Regression guard ─────────────────────────────────────────
        // Fetch current category. Deleted-order short-circuit above guarantees the row exists.
        let currentCat: string | null = null;
        if (orderMeta.package_status_id) {
            const { data: currentPkgStatus } = await supabase
                .from('package_statuses')
                .select('category')
                .eq('id', orderMeta.package_status_id)
                .maybeSingle();
            currentCat = currentPkgStatus?.category || null;
        }

        const newCat = matchedStatus.category;

        if (currentCat) {
            // Never regress to 'new' from any non-new status
            if (newCat === 'new' && currentCat !== 'new') {
                console.log(`[webhook] BLOCKED regression to 'new' from '${currentCat}'`);
                if (logEntry) await supabase.from('webhook_logs').update({ processed: true, error_message: `Regression blocked: ${currentCat} → new` }).eq('id', logEntry.id);
                return json({ status: 'skipped', reason: 'regression_blocked' });
            }

            // Terminal-category lock: once delivered/returned/refused/cancelled, only allow
            // same-category re-confirmations (idempotent) and side-effects from billing
            // events. Block transitions to any other category. Crucially, this prevents
            // Coliaty's PARCEL_SITUATION_CHANGED with STATUS=DELIVERED (sent at invoice-pay
            // time) from being treated as a fresh "delivery just happened" event — the
            // actual delivery may have been days earlier and date_livraison must not move.
            // Exchange orders (replace=true) get the single delivered → returned transition:
            // Coliaty's swap shipment reports DELIVERED (new item handed over) then RETURNED
            // (old item brought back), and the exchange order must settle at 'returned'. Every
            // other terminal transition stays locked.
            const exchangeDeliveredToReturned =
                currentCat === 'delivered' && newCat === 'returned' && orderMeta.replace === true;
            if (TERMINAL_CATEGORIES.has(currentCat) && newCat !== currentCat && !exchangeDeliveredToReturned) {
                console.log(`[webhook] BLOCKED terminal regression: ${currentCat} → ${newCat}`);
                if (logEntry) await supabase.from('webhook_logs').update({ processed: true, error_message: `Terminal lock: ${currentCat} → ${newCat}` }).eq('id', logEntry.id);
                // Still record payment if applicable.
                if (isPaidSituation) {
                    await supabase
                        .from('orders')
                        .update({ payed: true, updated_at: new Date().toISOString() })
                        .eq('id', orderId)
                        .eq('DigiCom Business', businessId)
                        .is('date_deleted', null);
                }
                return json({ status: 'skipped', reason: 'terminal_lock' });
            }

            // Never move backward in forward delivery progression
            const currentRank = FORWARD_RANKS[currentCat];
            const newRank = FORWARD_RANKS[newCat];
            if (currentRank !== undefined && newRank !== undefined && newRank < currentRank) {
                console.log(`[webhook] BLOCKED backward move: ${currentCat}(${currentRank}) → ${newCat}(${newRank})`);
                if (logEntry) await supabase.from('webhook_logs').update({ processed: true, error_message: `Backward blocked: ${currentCat} → ${newCat}` }).eq('id', logEntry.id);
                return json({ status: 'skipped', reason: 'backward_blocked' });
            }
        }

        // ── 10. Same-status no-op guard ─────────────────────────────────
        // Coliaty (and other providers) occasionally retry the same webhook event, and
        // each retry without this check would bump updated_at — triggering a realtime
        // UPDATE, cache invalidation, and a redundant toast even though nothing actually
        // changed. Bail out unless:
        //   - the status_id actually moved, OR
        //   - we'd be flipping the delivered flag on for the first time, OR
        //   - we'd be filing the first cancellation / postponement timestamp, OR
        //   - SITUATION=PAID newly marks the order as payed.
        const sameStatusId = orderMeta.package_status_id === matchedStatus.id;
        const hasDeliveredSideEffect = newCat === 'delivered' && !orderMeta.delivered;
        const hasCancelSideEffect = newCat === 'cancelled' && currentCat !== 'cancelled';
        const hasPostponeSideEffect = newCat === 'postponed' && currentCat !== 'postponed';
        const hasPaidSideEffect = isPaidSituation && !orderMeta.payed;
        const noOp =
            sameStatusId &&
            !hasDeliveredSideEffect &&
            !hasCancelSideEffect &&
            !hasPostponeSideEffect &&
            !hasPaidSideEffect;

        if (noOp) {
            // Touch the parcel only if its label/color drift (cheap, doesn't fan out to
            // the orders realtime channel).
            if (parcel) {
                await supabase.from('company_parcels').update({
                    status_id: matchedStatus.id,
                    status_label: matchedStatus.label,
                    status_color: matchedStatus.color || null,
                }).eq('id', parcel.id);
            }
            if (logEntry) await supabase.from('webhook_logs').update({ processed: true, error_message: 'No-op (status unchanged)' }).eq('id', logEntry.id);
            console.log(`[webhook] NO-OP order=${orderId} → ${matchedStatus.code}`);
            return json({ status: 'noop', reason: 'status_unchanged', order_id: orderId });
        }

        // ── 11. Update company_parcels ──────────────────────────────────
        if (parcel) {
            await supabase.from('company_parcels').update({
                status_id: matchedStatus.id,
                status_label: matchedStatus.label,
                status_color: matchedStatus.color || null,
                updated_at: new Date().toISOString(),
            }).eq('id', parcel.id);
        }

        // ── 12. Update order ────────────────────────────────────────────
        const nowIso = new Date().toISOString();
        const updateData: any = {
            package_status_id: matchedStatus.id,
            package_status_label: matchedStatus.label,
            package_status_color: matchedStatus.color || null,
            updated_at: nowIso,
        };

        // Delivered: mark delivered=true and lock the delivery date. The date sources, in
        // priority order:
        //   1. Existing orders.date_livraison if it's already set (idempotent — don't move it)
        //   2. Coliaty payload DATE field (parsed dd/mm/yyyy or dd-mm-yyyy at 12:00 UTC)
        //   3. nowIso (live PARCEL_STATUS_CHANGED with no DATE — webhook arrival is the best
        //      estimator for the actual delivery moment)
        // For PARCEL_SITUATION_CHANGED, the DATE is the invoice-pay day and is NOT used for
        // date_livraison — the terminal-category lock above already short-circuits this code
        // path for already-delivered orders. For brand-new deliveries first observed via the
        // situation event (no prior PARCEL_STATUS_CHANGED), we fall back to nowIso.
        if (newCat === 'delivered') {
            updateData.delivered = true;
            if (orderMeta.date_livraison) {
                // Already set — don't move it.
            } else if (!isSituationEvent && coliatyDate) {
                updateData.date_livraison = coliatyDate;
            } else {
                updateData.date_livraison = nowIso;
            }
        }

        // Cancelled / refused / returned timestamps — set on first transition, idempotent.
        if (newCat === 'cancelled' && currentCat !== 'cancelled') {
            updateData.annulation_date = coliatyDate || nowIso;
        }
        if (newCat === 'postponed' && currentCat !== 'postponed') {
            updateData.reported_date = coliatyDate || nowIso;
        }

        // Paid situation — always flag the order, regardless of status transition outcome.
        if (isPaidSituation) {
            updateData.payed = true;
        }

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', orderId)
            .eq('DigiCom Business', businessId)
            .is('date_deleted', null);

        if (updateError) {
            console.error('[webhook] order update failed:', updateError.message);
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: updateError.message }).eq('id', logEntry.id);
            return json({ error: 'Update failed' }, 500);
        }

        // ── 12. Mark success ────────────────────────────────────────────
        if (logEntry) await supabase.from('webhook_logs').update({ processed: true }).eq('id', logEntry.id);

        console.log(`[webhook] SUCCESS order=${orderId} → ${matchedStatus.label} (${matchedStatus.code})${isSituationEvent ? ' [situation]' : ''}${isPaidSituation ? ' [paid]' : ''}`);
        return json({
            status: 'success',
            status_mapped: matchedStatus.code,
            order_id: orderId,
            event: eventName || null,
            situation: isPaidSituation ? 'PAID' : null,
        });

    } catch (e) {
        console.error('[webhook] fatal:', e);
        return json({ error: e.message }, 500);
    }
});
