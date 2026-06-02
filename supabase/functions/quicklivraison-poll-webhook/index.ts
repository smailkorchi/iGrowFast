// @ts-nocheck - Deno runtime types not recognized by VSCode
// Polls Quick Livraison (no native webhook) — mirrors ozon-poll-webhook.
// Every 15 min: for each active QL provider_webhook, walk non-terminal company_parcels,
// call provider-integration track_parcel, diff status_label, self-POST changes into provider-webhook.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CONCURRENCY = 4;
const TERMINAL_CATEGORIES = ['delivered', 'returned', 'returning', 'refused', 'cancelled'];

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
    }

    const json = (body: object, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    try {
        const { trigger = 'manual' } = await req.json().catch(() => ({}));
        console.log(`[quicklivraison-poll] started trigger=${trigger}`);

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, serviceKey);

        const { data: qlWebhooks, error: whErr } = await supabase
            .from('provider_webhooks')
            .select('id, provider_id, webhook_secret, "DigiCom Business", providers!inner(name, provider_type, api_key, api_base_url)')
            .eq('is_active', true)
            .eq('providers.provider_type', 'quicklivraison');

        if (whErr) {
            console.error('[quicklivraison-poll] failed to fetch webhooks:', whErr.message);
            return json({ error: whErr.message }, 500);
        }

        if (!qlWebhooks?.length) {
            console.log('[quicklivraison-poll] no active quicklivraison webhooks found');
            return json({ status: 'ok', message: 'No active Quick Livraison webhooks' });
        }

        console.log(`[quicklivraison-poll] found ${qlWebhooks.length} Quick Livraison webhook(s)`);

        let totalChecked = 0;
        let totalChanged = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        for (const wh of qlWebhooks) {
            const providerId = wh.provider_id;
            const businessId = wh['DigiCom Business'];
            const webhookSecret = wh.webhook_secret;
            const providerName = (wh.providers as any)?.name || 'Quick Livraison';

            console.log(`[quicklivraison-poll] processing provider=${providerName} business=${businessId}`);

            const { data: parcels, error: pErr } = await supabase
                .from('company_parcels')
                .select('id, tracking_code, external_id, status_id, status_label, order_id, package_statuses!inner(category)')
                .eq('provider_id', providerId)
                .eq('DigiCom Business', businessId)
                .not('package_statuses.category', 'in', `(${TERMINAL_CATEGORIES.join(',')})`)
                .order('created_at', { ascending: false });

            if (pErr) {
                console.error(`[quicklivraison-poll] parcel query error:`, pErr.message);
                // Fallback: fetch all and filter client-side (same as ozon)
                const { data: allParcels } = await supabase
                    .from('company_parcels')
                    .select('id, tracking_code, external_id, status_id, status_label, order_id')
                    .eq('provider_id', providerId)
                    .eq('DigiCom Business', businessId);

                if (!allParcels?.length) {
                    console.log(`[quicklivraison-poll] no parcels for provider=${providerId}`);
                    continue;
                }

                const { data: terminalStatuses } = await supabase
                    .from('package_statuses')
                    .select('id')
                    .in('category', TERMINAL_CATEGORIES);

                const terminalIds = new Set((terminalStatuses || []).map(s => s.id));
                const activeParcels = allParcels.filter(p => !p.status_id || !terminalIds.has(p.status_id));

                if (!activeParcels.length) {
                    console.log(`[quicklivraison-poll] all parcels terminal for provider=${providerId}`);
                    continue;
                }

                const results = await processParcels(activeParcels, providerId, businessId, webhookSecret, supabaseUrl, serviceKey);
                totalChecked += results.checked;
                totalChanged += results.changed;
                totalSkipped += results.skipped;
                totalFailed += results.failed;
                continue;
            }

            if (!parcels?.length) {
                console.log(`[quicklivraison-poll] no active parcels for provider=${providerId}`);
                continue;
            }

            console.log(`[quicklivraison-poll] ${parcels.length} active parcel(s) to check`);
            const results = await processParcels(parcels, providerId, businessId, webhookSecret, supabaseUrl, serviceKey);
            totalChecked += results.checked;
            totalChanged += results.changed;
            totalSkipped += results.skipped;
            totalFailed += results.failed;
        }

        const summary = { status: 'ok', trigger, total_checked: totalChecked, changed: totalChanged, skipped: totalSkipped, failed: totalFailed };
        console.log(`[quicklivraison-poll] done:`, JSON.stringify(summary));
        return json(summary);

    } catch (e) {
        console.error('[quicklivraison-poll] fatal:', e);
        return json({ error: e.message }, 500);
    }
});

async function processParcels(
    parcels: any[],
    providerId: string,
    businessId: string,
    webhookSecret: string,
    supabaseUrl: string,
    serviceKey: string,
) {
    let checked = 0;
    let changed = 0;
    let skipped = 0;
    let failed = 0;

    const queue = [...parcels];

    async function worker() {
        while (queue.length > 0) {
            const parcel = queue.shift();
            if (!parcel) break;

            if (!parcel.tracking_code) {
                skipped++;
                continue;
            }

            checked++;
            try {
                const trackRes = await fetch(`${supabaseUrl}/functions/v1/provider-integration`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${serviceKey}`,
                        'apikey': serviceKey,
                    },
                    body: JSON.stringify({
                        action: 'track_parcel',
                        provider_id: providerId,
                        data: {
                            tracking_code: parcel.tracking_code,
                            external_id: parcel.external_id,
                        },
                    }),
                });

                if (!trackRes.ok) {
                    console.warn(`[quicklivraison-poll] track failed for ${parcel.tracking_code}: HTTP ${trackRes.status}`);
                    failed++;
                    continue;
                }

                const wrapped = await trackRes.json();
                const trackData = wrapped?.data || wrapped; // provider-integration wraps in { success, data }

                // QL adapter returns { status: <raw QL code>, statusLabel: <French label>, ... }
                const qlStatus = trackData?.status || trackData?.statusLabel;
                if (!qlStatus) {
                    console.warn(`[quicklivraison-poll] no status in response for ${parcel.tracking_code}`);
                    skipped++;
                    continue;
                }

                // Skip unchanged — compare against our stored label (French).
                // If statusLabel matches, it's the same mapped state already.
                const currentLabel = parcel.status_label || '';
                const newLabel = trackData?.statusLabel || qlStatus;
                if (newLabel === currentLabel) {
                    skipped++;
                    continue;
                }

                console.log(`[quicklivraison-poll] CHANGE: ${parcel.tracking_code} "${currentLabel}" → "${newLabel}"`);

                const webhookUrl = `${supabaseUrl}/functions/v1/provider-webhook/${providerId}/${webhookSecret}`;
                const webhookPayload = {
                    EVENT: 'PARCEL_STATUS_CHANGED',
                    TRACKING: parcel.tracking_code,
                    STATUS: qlStatus,
                    COMMENT: trackData?.history?.[trackData.history.length - 1]?.comment || '',
                };

                const whRes = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(webhookPayload),
                });

                if (whRes.ok) {
                    const whBody = await whRes.json();
                    console.log(`[quicklivraison-poll] webhook sent for ${parcel.tracking_code}: ${whBody.status}`);
                    changed++;
                } else {
                    console.error(`[quicklivraison-poll] webhook failed for ${parcel.tracking_code}: HTTP ${whRes.status}`);
                    failed++;
                }

            } catch (err) {
                console.error(`[quicklivraison-poll] error processing ${parcel.tracking_code}:`, err);
                failed++;
            }
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, parcels.length) }, () => worker());
    await Promise.all(workers);

    return { checked, changed, skipped, failed };
}
