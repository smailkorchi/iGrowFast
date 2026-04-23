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

        // ── 3. Parse payload (JSON, form-encoded, or raw text) ──────────
        const contentType = req.headers.get('content-type') || '';
        let payload: any = {};
        if (contentType.includes('application/json')) {
            payload = await req.json();
        } else if (contentType.includes('form') || contentType.includes('multipart')) {
            const formData = await req.formData();
            for (const [key, value] of formData.entries()) {
                try { payload[key] = JSON.parse(value as string); } catch { payload[key] = value; }
            }
        } else {
            const text = await req.text();
            try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
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
        const trackingCode =
            payload.CODE ||        // AMEEX
            payload.TRACKING ||    // Coliaty
            payload.tracking_number ||
            payload.barcode ||
            payload.ref ||
            forcelogData?.parcel_code;  // Forcelog

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
            .select('id, date_deleted')
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

        // ── 7. Multi-candidate status matching ──────────────────────────
        // Priority: AMEEX sub-status > AMEEX/Coliaty main status > generic > Forcelog (data.secondary_status > data.status)
        const statusCandidates = [
            payload.STATUT_S,            // AMEEX sub-status (most precise)
            payload.STATUT,              // AMEEX main status
            payload.STATUS,              // Coliaty status
            payload.status,              // generic fallback
            forcelogData?.secondary_status, // Forcelog sub-status (more precise)
            forcelogData?.status,        // Forcelog primary code
        ].filter(Boolean);

        if (statusCandidates.length === 0) {
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

            // Try RPC first (handles diacritics, case-insensitive)
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
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: `No mapping for: ${tried}` }).eq('id', logEntry.id);
            return json({ status: 'logged', message: 'No mapping found' });
        }

        console.log(`[webhook] matched: "${matchedCandidate}" → ${matchedStatus.label} (${matchedStatus.code}, cat=${matchedStatus.category})`);

        // ── 8. Regression guard ─────────────────────────────────────────
        // Fetch current order status to prevent backward moves. Deleted-order short-circuit
        // above guarantees the row exists, so no date_deleted filter needed here.
        const { data: currentOrder } = await supabase
            .from('orders')
            .select('package_status_id')
            .eq('id', orderId)
            .maybeSingle();

        if (currentOrder?.package_status_id) {
            const { data: currentPkgStatus } = await supabase
                .from('package_statuses')
                .select('category')
                .eq('id', currentOrder.package_status_id)
                .maybeSingle();

            if (currentPkgStatus) {
                const currentCat = currentPkgStatus.category;
                const newCat = matchedStatus.category;

                // Never regress to 'new' from any non-new status
                if (newCat === 'new' && currentCat !== 'new') {
                    console.log(`[webhook] BLOCKED regression to 'new' from '${currentCat}'`);
                    if (logEntry) await supabase.from('webhook_logs').update({ processed: true, error_message: `Regression blocked: ${currentCat} → new` }).eq('id', logEntry.id);
                    return json({ status: 'skipped', reason: 'regression_blocked' });
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
        }

        // ── 9. Update company_parcels ───────────────────────────────────
        if (parcel) {
            await supabase.from('company_parcels').update({
                status_id: matchedStatus.id,
                status_label: matchedStatus.label,
                status_color: matchedStatus.color || null,
                updated_at: new Date().toISOString(),
            }).eq('id', parcel.id);
        }

        // ── 10. Update order ────────────────────────────────────────────
        const updateData: any = {
            package_status_id: matchedStatus.id,
            package_status_label: matchedStatus.label,
            package_status_color: matchedStatus.color || null,
            updated_at: new Date().toISOString(),
        };

        if (matchedStatus.category === 'delivered') {
            updateData.delivered = true;
            updateData.date_livraison = new Date().toISOString();
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

        // ── 11. Mark success ────────────────────────────────────────────
        if (logEntry) await supabase.from('webhook_logs').update({ processed: true }).eq('id', logEntry.id);

        console.log(`[webhook] SUCCESS order=${orderId} → ${matchedStatus.label} (${matchedStatus.code})`);
        return json({ status: 'success', status_mapped: matchedStatus.code, order_id: orderId });

    } catch (e) {
        console.error('[webhook] fatal:', e);
        return json({ error: e.message }, 500);
    }
});
