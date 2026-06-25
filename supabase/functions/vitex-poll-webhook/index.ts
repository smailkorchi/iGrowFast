// @ts-nocheck - Deno runtime types not recognized by VSCode
// Polls Vitex (no native webhook) — mirror of quicklivraison-poll-webhook.
// Every 15 min: for each active Vitex provider_webhook, walk non-terminal company_parcels,
// call provider-integration track_parcel, diff against the master label (via status_id join), self-POST changes into provider-webhook.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CONCURRENCY = 4;
// "Terminal for polling" = master flags is_terminal (delivered/returned/refused/cancelled)
// OR is_returned (adds the in-flight 'returning' state). No category strings.

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
    }

    const json = (body: object, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    try {
        const { trigger = 'manual' } = await req.json().catch(() => ({}));
        console.log(`[vitex-poll] started trigger=${trigger}`);

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, serviceKey);

        const { data: vitexWebhooks, error: whErr } = await supabase
            .from('provider_webhooks')
            .select('id, provider_id, webhook_secret, "DigiCom Business", providers!inner(name, provider_type, api_key, api_base_url)')
            .eq('is_active', true)
            .eq('providers.provider_type', 'vitex');

        if (whErr) {
            console.error('[vitex-poll] failed to fetch webhooks:', whErr.message);
            return json({ error: whErr.message }, 500);
        }

        if (!vitexWebhooks?.length) {
            console.log('[vitex-poll] no active vitex webhooks found');
            return json({ status: 'ok', message: 'No active Vitex webhooks' });
        }

        console.log(`[vitex-poll] found ${vitexWebhooks.length} Vitex webhook(s)`);

        let totalChecked = 0;
        let totalChanged = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        for (const wh of vitexWebhooks) {
            const providerId = wh.provider_id;
            const businessId = wh['DigiCom Business'];
            const webhookSecret = wh.webhook_secret;
            const providerName = (wh.providers as any)?.name || 'Vitex';

            console.log(`[vitex-poll] processing provider=${providerName} business=${businessId}`);

            const { data: parcels, error: pErr } = await supabase
                .from('company_parcels')
                .select('id, tracking_code, external_id, status_id, order_id, package_statuses!inner(label)')
                .eq('provider_id', providerId)
                .eq('DigiCom Business', businessId)
                .eq('package_statuses.is_terminal', false)
                .eq('package_statuses.is_returned', false)
                .order('created_at', { ascending: false });

            if (pErr) {
                console.error(`[vitex-poll] parcel query error:`, pErr.message);
                // Fallback path: fetch all, filter terminal ones client-side.
                const { data: allParcels } = await supabase
                    .from('company_parcels')
                    .select('id, tracking_code, external_id, status_id, order_id, package_statuses(label)')
                    .eq('provider_id', providerId)
                    .eq('DigiCom Business', businessId);

                if (!allParcels?.length) continue;

                const { data: terminalStatuses } = await supabase
                    .from('package_statuses')
                    .select('id')
                    .or('is_terminal.eq.true,is_returned.eq.true');

                const terminalIds = new Set((terminalStatuses || []).map(s => s.id));
                const activeParcels = allParcels.filter(p => !p.status_id || !terminalIds.has(p.status_id));
                if (!activeParcels.length) continue;

                const results = await processParcels(activeParcels, providerId, businessId, webhookSecret, supabaseUrl, serviceKey);
                totalChecked += results.checked;
                totalChanged += results.changed;
                totalSkipped += results.skipped;
                totalFailed += results.failed;
                continue;
            }

            if (!parcels?.length) {
                console.log(`[vitex-poll] no active parcels for provider=${providerId}`);
                continue;
            }

            console.log(`[vitex-poll] ${parcels.length} active parcel(s) to check`);
            const results = await processParcels(parcels, providerId, businessId, webhookSecret, supabaseUrl, serviceKey);
            totalChecked += results.checked;
            totalChanged += results.changed;
            totalSkipped += results.skipped;
            totalFailed += results.failed;
        }

        const summary = { status: 'ok', trigger, total_checked: totalChecked, changed: totalChanged, skipped: totalSkipped, failed: totalFailed };
        console.log(`[vitex-poll] done:`, JSON.stringify(summary));
        return json(summary);

    } catch (e) {
        console.error('[vitex-poll] fatal:', e);
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
            if (!parcel.tracking_code) { skipped++; continue; }
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
                        data: { tracking_code: parcel.tracking_code, external_id: parcel.external_id },
                    }),
                });
                if (!trackRes.ok) {
                    console.warn(`[vitex-poll] track failed for ${parcel.tracking_code}: HTTP ${trackRes.status}`);
                    failed++; continue;
                }
                const wrapped = await trackRes.json();
                const trackData = wrapped?.data || wrapped; // provider-integration wraps in { success, data }

                // Vitex adapter returns status (raw code) + statusLabel (French).
                const vitexStatus = trackData?.status || trackData?.statusLabel;
                if (!vitexStatus) { skipped++; continue; }

                const currentLabel = parcel.package_statuses?.label || '';
                const newLabel = trackData?.statusLabel || vitexStatus;
                if (newLabel === currentLabel) { skipped++; continue; }

                console.log(`[vitex-poll] CHANGE: ${parcel.tracking_code} "${currentLabel}" → "${newLabel}"`);

                const webhookUrl = `${supabaseUrl}/functions/v1/provider-webhook/${providerId}/${webhookSecret}`;
                const lastHist = trackData?.history?.[trackData.history.length - 1] || null;
                const webhookPayload = {
                    EVENT: 'PARCEL_STATUS_CHANGED',
                    TRACKING: parcel.tracking_code,
                    STATUS: vitexStatus,
                    COMMENT: lastHist?.comment || '',
                };

                const whRes = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(webhookPayload),
                });
                if (whRes.ok) {
                    const whBody = await whRes.json();
                    console.log(`[vitex-poll] webhook sent for ${parcel.tracking_code}: ${whBody.status}`);
                    changed++;
                } else {
                    console.error(`[vitex-poll] webhook failed for ${parcel.tracking_code}: HTTP ${whRes.status}`);
                    failed++;
                }
            } catch (err) {
                console.error(`[vitex-poll] error processing ${parcel.tracking_code}:`, err);
                failed++;
            }
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, parcels.length) }, () => worker());
    await Promise.all(workers);
    return { checked, changed, skipped, failed };
}
