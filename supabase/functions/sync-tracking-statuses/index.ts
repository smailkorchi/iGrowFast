// @ts-nocheck
// Deno edge function: sync-tracking-statuses
//
// Polls Ozon parcels only. Coliaty and Ameex push updates via webhooks and
// do not need active polling.
//
// For each non-terminal Ozon parcel with a tracking_code, calls
// provider-integration (track_parcel), compares the returned status against
// the current DB status, and if changed, forwards the update to the
// provider-webhook edge function — making it indistinguishable from a
// real Ozon webhook push.
//
// Each run is logged in tracking_sync_runs.
//
// Triggered by pg_cron every 15 minutes (server-to-server with service role key).
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// "Terminal for polling" = master flags is_terminal (delivered/returned/refused/cancelled)
// OR is_returned (adds the in-flight 'returning' state). No category strings.
const CONCURRENCY = 4;

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_KEY) {
        return new Response(
            JSON.stringify({ success: false, error: 'Missing env' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let trigger = 'cron';
    try {
        const body = await req.json().catch(() => ({}));
        if (body && typeof body.trigger === 'string') trigger = body.trigger;
    } catch { /* no body */ }

    // Insert run row (status=running).
    const startedAt = new Date();
    const { data: runRow, error: runErr } = await supabase
        .from('tracking_sync_runs')
        .insert({
            started_at: startedAt.toISOString(),
            status: 'running',
            trigger: ['cron', 'manual', 'startup'].includes(trigger) ? trigger : 'cron',
            total: 0,
            changed: 0,
            failed: 0,
        })
        .select('id')
        .single();
    if (runErr || !runRow) {
        console.error('Failed to insert tracking_sync_runs row:', runErr);
        return new Response(
            JSON.stringify({ success: false, error: runErr?.message || 'log insert failed' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
    const runId = runRow.id;

    const finalizeRun = async (total, changed, failed, fatalError) => {
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        await supabase
            .from('tracking_sync_runs')
            .update({
                finished_at: finishedAt.toISOString(),
                status: fatalError ? 'error' : 'success',
                total,
                changed,
                failed,
                duration_ms: durationMs,
                error: fatalError,
            })
            .eq('id', runId);
        return new Response(
            JSON.stringify({ success: !fatalError, run_id: runId, total, changed, failed, duration_ms: durationMs, error: fatalError }),
            { status: fatalError ? 500 : 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    };

    let total = 0;
    let changed = 0;
    let failed = 0;

    try {
        // 1. Get active Ozon webhook configs (need webhook_secret to forward).
        const { data: ozonWebhooks, error: whErr } = await supabase
            .from('provider_webhooks')
            .select('id, provider_id, webhook_secret, "DigiCom Business", providers!inner(name, provider_type)')
            .eq('is_active', true)
            .eq('providers.provider_type', 'ozon');
        if (whErr) throw whErr;

        if (!ozonWebhooks?.length) {
            console.log(`[sync-tracking] run ${runId} no active Ozon webhooks found — nothing to sync`);
            return await finalizeRun(0, 0, 0, null);
        }

        console.log(`[sync-tracking] run ${runId} trigger=${trigger} ozon webhooks=${ozonWebhooks.length}`);

        for (const wh of ozonWebhooks) {
            const providerId = wh.provider_id;
            const businessId = wh['DigiCom Business'];
            const webhookSecret = wh.webhook_secret;
            const providerName = (wh.providers as any)?.name || 'OzonExpress';

            console.log(`[sync-tracking] processing provider=${providerName} business=${businessId}`);

            // 2. Fetch non-terminal Ozon parcels for this provider + business.
            let activeParcels;

            const { data: parcels, error: pErr } = await supabase
                .from('company_parcels')
                .select('id, tracking_code, external_id, status_id, order_id, package_statuses!inner(label)')
                .eq('provider_id', providerId)
                .eq('DigiCom Business', businessId)
                .eq('package_statuses.is_terminal', false)
                .eq('package_statuses.is_returned', false)
                .order('created_at', { ascending: false });

            if (pErr) {
                console.error(`[sync-tracking] parcel query error:`, pErr.message);
                // Fallback: get all parcels and filter client-side.
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
                activeParcels = allParcels.filter(p => !p.status_id || !terminalIds.has(p.status_id));
            } else {
                activeParcels = parcels || [];
            }

            if (!activeParcels.length) {
                console.log(`[sync-tracking] no active parcels for provider=${providerId}`);
                continue;
            }

            console.log(`[sync-tracking] ${activeParcels.length} active parcel(s) to check`);

            // 3. Concurrency-bounded worker pool — poll each parcel, forward
            //    changes to provider-webhook.
            const queue = [...activeParcels];
            total += queue.length;

            const worker = async () => {
                while (queue.length > 0) {
                    const parcel = queue.shift();
                    if (!parcel) break;

                    if (!parcel.tracking_code) continue;

                    try {
                        // Call provider-integration track_parcel.
                        const trackRes = await fetch(`${SUPABASE_URL}/functions/v1/provider-integration`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${SERVICE_KEY}`,
                                apikey: SERVICE_KEY,
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
                            console.warn(`[sync-tracking] track failed for ${parcel.tracking_code}: HTTP ${trackRes.status}`);
                            failed++;
                            continue;
                        }

                        const trackData = await trackRes.json();
                        const ozonStatus = trackData?.data?.status || trackData?.data?.statusLabel || trackData?.status || trackData?.statusLabel;

                        if (!ozonStatus) {
                            console.warn(`[sync-tracking] no status in response for ${parcel.tracking_code}`);
                            continue;
                        }

                        // Compare with current DB status — skip if unchanged.
                        const currentLabel = parcel.package_statuses?.label || '';
                        if (ozonStatus === currentLabel) continue;

                        console.log(`[sync-tracking] CHANGE detected: ${parcel.tracking_code} "${currentLabel}" → "${ozonStatus}"`);

                        // Forward to provider-webhook — makes it look like a
                        // real Ozon webhook push.
                        const webhookUrl = `${SUPABASE_URL}/functions/v1/provider-webhook/${providerId}/${webhookSecret}`;
                        const webhookPayload = {
                            EVENT: 'PARCEL_STATUS_CHANGED',
                            TRACKING: parcel.tracking_code,
                            STATUS: ozonStatus,
                            COMMENT: trackData?.data?.history?.[0]?.comment || trackData?.history?.[0]?.comment || '',
                        };

                        const whRes = await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(webhookPayload),
                        });

                        if (whRes.ok) {
                            console.log(`[sync-tracking] webhook forwarded for ${parcel.tracking_code}`);
                            changed++;
                        } else {
                            console.error(`[sync-tracking] webhook forward failed for ${parcel.tracking_code}: HTTP ${whRes.status}`);
                            failed++;
                        }
                    } catch (err) {
                        failed++;
                        console.error(`[sync-tracking] parcel ${parcel.tracking_code} error:`, err?.message || err);
                    }
                }
            };

            await Promise.all(
                Array.from({ length: Math.min(CONCURRENCY, activeParcels.length) }, () => worker()),
            );
        }
    } catch (err) {
        console.error(`[sync-tracking] run ${runId} fatal:`, err?.message || err);
        return await finalizeRun(total, changed, failed, err?.message || String(err));
    }

    return await finalizeRun(total, changed, failed, null);
});
