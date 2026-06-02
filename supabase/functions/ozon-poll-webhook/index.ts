// @ts-nocheck - Deno runtime types not recognized by VSCode
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
        console.log(`[ozon-poll] started trigger=${trigger}`);

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, serviceKey);

        // ── 1. Get all active Ozon webhook configs ──────────────────────
        const { data: ozonWebhooks, error: whErr } = await supabase
            .from('provider_webhooks')
            .select('id, provider_id, webhook_secret, "DigiCom Business", providers!inner(name, provider_type, api_key, api_base_url)')
            .eq('is_active', true)
            .eq('providers.provider_type', 'ozon');

        if (whErr) {
            console.error('[ozon-poll] failed to fetch ozon webhooks:', whErr.message);
            return json({ error: whErr.message }, 500);
        }

        if (!ozonWebhooks?.length) {
            console.log('[ozon-poll] no active ozon webhooks found');
            return json({ status: 'ok', message: 'No active Ozon webhooks' });
        }

        console.log(`[ozon-poll] found ${ozonWebhooks.length} Ozon webhook(s)`);

        let totalChecked = 0;
        let totalChanged = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        for (const wh of ozonWebhooks) {
            const providerId = wh.provider_id;
            const businessId = wh['DigiCom Business'];
            const webhookSecret = wh.webhook_secret;
            const providerName = (wh.providers as any)?.name || 'OzonExpress';

            console.log(`[ozon-poll] processing provider=${providerName} business=${businessId}`);

            // ── 2. Fetch non-terminal Ozon parcels ──────────────────────
            const { data: parcels, error: pErr } = await supabase
                .from('company_parcels')
                .select('id, tracking_code, external_id, status_id, status_label, order_id, package_statuses!inner(category)')
                .eq('provider_id', providerId)
                .eq('DigiCom Business', businessId)
                .not('package_statuses.category', 'in', `(${TERMINAL_CATEGORIES.join(',')})`)
                .order('created_at', { ascending: false });

            if (pErr) {
                console.error(`[ozon-poll] parcel query error:`, pErr.message);
                // Fallback: get all parcels and filter client-side
                const { data: allParcels } = await supabase
                    .from('company_parcels')
                    .select('id, tracking_code, external_id, status_id, status_label, order_id')
                    .eq('provider_id', providerId)
                    .eq('DigiCom Business', businessId);

                if (!allParcels?.length) {
                    console.log(`[ozon-poll] no parcels for provider=${providerId}`);
                    continue;
                }

                // Get terminal status IDs to exclude
                const { data: terminalStatuses } = await supabase
                    .from('package_statuses')
                    .select('id')
                    .in('category', TERMINAL_CATEGORIES);

                const terminalIds = new Set((terminalStatuses || []).map(s => s.id));
                const activeParcels = allParcels.filter(p => !p.status_id || !terminalIds.has(p.status_id));

                if (!activeParcels.length) {
                    console.log(`[ozon-poll] all parcels terminal for provider=${providerId}`);
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
                console.log(`[ozon-poll] no active parcels for provider=${providerId}`);
                continue;
            }

            console.log(`[ozon-poll] ${parcels.length} active parcel(s) to check`);
            const results = await processParcels(parcels, providerId, businessId, webhookSecret, supabaseUrl, serviceKey);
            totalChecked += results.checked;
            totalChanged += results.changed;
            totalSkipped += results.skipped;
            totalFailed += results.failed;
        }

        const summary = { status: 'ok', trigger, total_checked: totalChecked, changed: totalChanged, skipped: totalSkipped, failed: totalFailed };
        console.log(`[ozon-poll] done:`, JSON.stringify(summary));
        return json(summary);

    } catch (e) {
        console.error('[ozon-poll] fatal:', e);
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

    // Bounded concurrency worker pool
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
                // ── Call provider-integration track_parcel ───────────
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
                    console.warn(`[ozon-poll] track failed for ${parcel.tracking_code}: HTTP ${trackRes.status}`);
                    failed++;
                    continue;
                }

                const wrapped = await trackRes.json();
                const trackData = wrapped?.data || wrapped; // provider-integration wraps in { success, data }

                // Extract latest status from Ozon response
                const ozonStatus = trackData?.status || trackData?.statusLabel;
                if (!ozonStatus) {
                    console.warn(`[ozon-poll] no status in response for ${parcel.tracking_code}`);
                    skipped++;
                    continue;
                }

                // Compare with current DB status — skip if unchanged
                const currentLabel = parcel.status_label || '';
                if (ozonStatus === currentLabel) {
                    skipped++;
                    continue;
                }

                console.log(`[ozon-poll] CHANGE detected: ${parcel.tracking_code} "${currentLabel}" → "${ozonStatus}"`);

                // ── Self-POST to provider-webhook ───────────────────
                const webhookUrl = `${supabaseUrl}/functions/v1/provider-webhook/${providerId}/${webhookSecret}`;
                const webhookPayload = {
                    EVENT: 'PARCEL_STATUS_CHANGED',
                    TRACKING: parcel.tracking_code,
                    STATUS: ozonStatus,
                    COMMENT: trackData?.history?.[0]?.comment || '',
                };

                const whRes = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(webhookPayload),
                });

                if (whRes.ok) {
                    const whBody = await whRes.json();
                    console.log(`[ozon-poll] webhook sent for ${parcel.tracking_code}: ${whBody.status}`);
                    changed++;
                } else {
                    console.error(`[ozon-poll] webhook failed for ${parcel.tracking_code}: HTTP ${whRes.status}`);
                    failed++;
                }

            } catch (err) {
                console.error(`[ozon-poll] error processing ${parcel.tracking_code}:`, err);
                failed++;
            }
        }
    }

    // Launch concurrent workers
    const workers = Array.from({ length: Math.min(CONCURRENCY, parcels.length) }, () => worker());
    await Promise.all(workers);

    return { checked, changed, skipped, failed };
}
