// @ts-nocheck
// Deno edge function: sync-tracking-statuses
//
// Iterates every non-terminal company_parcel that has a tracking_code +
// provider_id, calls the existing `provider-integration` edge function for
// each one (track_parcel with get_parcel_info fallback), smart-matches the
// returned status against package_statuses (using the
// delivery_service_statuses array), and updates company_parcels in place.
// Each run is logged in tracking_sync_runs.
//
// Triggered by:
//  - pg_cron every 15 minutes (server-to-server with the service role key)
//  - Manual UI button (any authenticated user)
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TERMINAL_CATEGORIES = new Set([
    'delivered',
    'returned',
    'returning',
    'refused',
    'cancelled',
]);

// Forward delivery progression. Used to detect regressions: if the provider
// returns a status whose forward rank is *strictly less* than the order's
// current status, we refuse to write — that's a regression and almost always
// means the order has multiple parcels and we're looking at a fresh one.
const FORWARD_RANK: Record<string, number> = {
    new: 0,
    pickup_pending: 1,
    picked_up: 2,
    in_transit: 3,
    out_for_delivery: 4,
};

const CONCURRENCY = 4;

// ---------- helpers ----------

const norm = (v) =>
    String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

function matchPackageStatus(rows, candidates) {
    const normalized = candidates.map((c) => norm(c)).filter((c) => c.length > 0);
    if (normalized.length === 0) return null;

    // Pass 1: delivery_service_statuses contains
    for (const row of rows) {
        const arr = row.delivery_service_statuses || [];
        for (const entry of arr) {
            const n = norm(entry);
            if (!n) continue;
            if (normalized.includes(n)) return row;
        }
    }
    // Pass 2: exact label
    for (const row of rows) {
        const n = norm(row.label);
        if (n && normalized.includes(n)) return row;
    }
    // Pass 3: exact code
    for (const row of rows) {
        const n = norm(row.code);
        if (n && normalized.includes(n)) return row;
    }
    // Pass 4: substring on label
    for (const row of rows) {
        const n = norm(row.label);
        if (!n) continue;
        if (normalized.some((c) => c.includes(n) || n.includes(c))) return row;
    }
    return null;
}

function pickStatusFromResponse(data, rows) {
    if (!data) return { matched: null, rawLabel: null, rawColor: null };

    const headlineLabel = data.statusLabel || data.status || data.current_status;
    const headlineCode = data.status || data.current_status;
    const headlineColor = data.statusColor || data.color;

    let matched = matchPackageStatus(rows, [headlineLabel, headlineCode]);
    let rawLabel = headlineLabel || null;
    let rawColor = headlineColor || null;

    if (!matched && Array.isArray(data.history)) {
        for (const event of data.history) {
            if (!event) continue;
            const evLabel = event.statusLabel || event.status_label;
            const evCode = event.status;
            const candidate = matchPackageStatus(rows, [evLabel, evCode]);
            if (candidate) {
                matched = candidate;
                rawLabel = evLabel || evCode || rawLabel;
                rawColor = event.statusColor || event.color || rawColor;
                break;
            }
        }
    }
    return { matched, rawLabel, rawColor };
}

async function callProviderIntegration(supabaseUrl, serviceKey, body) {
    const res = await fetch(`${supabaseUrl}/functions/v1/provider-integration`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
        },
        body: JSON.stringify(body),
    });
    const ok = res.ok;
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    return { ok, json };
}

async function callTrack(supabaseUrl, serviceKey, parcel) {
    const r = await callProviderIntegration(supabaseUrl, serviceKey, {
        action: 'track_parcel',
        provider_id: parcel.provider_id,
        data: { tracking_code: parcel.tracking_code, external_id: parcel.external_id },
    });
    if (!r.ok || !r.json?.success) return null;
    return r.json.data;
}

async function callInfo(supabaseUrl, serviceKey, parcel) {
    const r = await callProviderIntegration(supabaseUrl, serviceKey, {
        action: 'get_parcel_info',
        provider_id: parcel.provider_id,
        data: { tracking_code: parcel.tracking_code },
    });
    if (!r.ok || !r.json?.success) return null;
    return r.json.data;
}

// ---------- main ----------

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

    // Insert run row (status=running) — unblocks the UI immediately.
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

    let total = 0;
    let changed = 0;
    let failed = 0;
    let fatalError = null;

    try {
        // 1. Load package_statuses once
        const { data: statusRows, error: statusErr } = await supabase
            .from('package_statuses')
            .select('id, code, label, color, category, delivery_service_statuses');
        if (statusErr) throw statusErr;
        const rows = statusRows || [];

        // 2. Build the candidate set: trackable, non-terminal parcels.
        //    We pick the *latest* parcel per order (matches frontend behavior),
        //    and we also pull the order's current package_status category so
        //    we can skip orders that are already terminal (e.g. order has an
        //    old delivered parcel + a new replacement parcel).
        const { data: parcels, error: parcelErr } = await supabase
            .from('company_parcels')
            .select(`
                id,
                order_id,
                provider_id,
                tracking_code,
                external_id,
                status_id,
                created_at,
                parcel_status:package_statuses!company_parcels_status_id_fkey(id, category),
                order:orders!company_parcels_order_id_fkey(
                    id,
                    package_status_id,
                    order_status:package_statuses!orders_package_status_id_fkey(id, category)
                )
            `)
            .not('tracking_code', 'is', null)
            .not('provider_id', 'is', null);
        if (parcelErr) throw parcelErr;

        const latestPerOrder = new Map();
        let skippedTerminalParcel = 0;
        let skippedTerminalOrder = 0;
        for (const p of parcels || []) {
            if (!p.tracking_code || !String(p.tracking_code).trim()) continue;

            // Parcel-level terminal filter (parcel already in a final state).
            const parcelCat = p.parcel_status?.category ?? null;
            if (parcelCat && TERMINAL_CATEGORIES.has(parcelCat)) {
                skippedTerminalParcel++;
                continue;
            }

            // Order-level terminal filter — critical for orders with multiple
            // parcels where the *order* is delivered/returned/cancelled even
            // though this specific parcel might be a fresh replacement.
            const orderCat = p.order?.order_status?.category ?? null;
            if (orderCat && TERMINAL_CATEGORIES.has(orderCat)) {
                skippedTerminalOrder++;
                continue;
            }

            const orderKey = p.order_id || p.id;
            const prev = latestPerOrder.get(orderKey);
            if (!prev || new Date(p.created_at || 0) > new Date(prev.created_at || 0)) {
                latestPerOrder.set(orderKey, p);
            }
        }

        const targets = Array.from(latestPerOrder.values());
        total = targets.length;
        console.log(
            `[sync-tracking] run ${runId} trigger=${trigger} targets=${total} ` +
            `skippedTerminalParcel=${skippedTerminalParcel} skippedTerminalOrder=${skippedTerminalOrder}`,
        );

        // 3. Concurrency-bounded worker pool
        let cursor = 0;
        const worker = async () => {
            while (cursor < targets.length) {
                const i = cursor++;
                const parcel = targets[i];
                try {
                    // STEP 1: try track_parcel (full history). For Coliaty/Ozon
                    // this returns raw codes; for AMEEX it returns localized labels.
                    let data = await callTrack(SUPABASE_URL, SERVICE_KEY, parcel);
                    let { matched, rawLabel } = data
                        ? pickStatusFromResponse(data, rows)
                        : { matched: null, rawLabel: null };

                    // STEP 2: if track_parcel didn't yield a matchable status,
                    // fall back to get_parcel_info — which for Coliaty returns
                    // the *localized* status.label (e.g. "Expédié" instead of "SENT")
                    // and is far more likely to match against package_statuses.
                    if (!matched) {
                        const info = await callInfo(SUPABASE_URL, SERVICE_KEY, parcel);
                        if (info) {
                            const r2 = pickStatusFromResponse(info, rows);
                            if (r2.matched) {
                                matched = r2.matched;
                                rawLabel = r2.rawLabel;
                                data = info;
                            }
                        }
                    }

                    // CRITICAL: never write unless we positively matched a known
                    // package_status row. Writing a raw provider code (e.g. "SENT")
                    // would propagate via triggers to orders.package_status_label,
                    // and the update_order_package_status_id trigger would then
                    // null out package_status_id — silently reverting the order.
                    if (!matched) {
                        console.warn(`[sync-tracking] unmapped parcel=${parcel.id} tracking=${parcel.tracking_code} raw=${rawLabel}`);
                        continue;
                    }

                    if (parcel.status_id === matched.id) {
                        // Already on this status — nothing to do.
                        continue;
                    }

                    // REGRESSION GUARD #1: never set category to "new" if the
                    // order already has a non-new status. A fresh NEW_PARCEL
                    // event from the provider must not wipe a mature order.
                    const orderCat = parcel.order?.order_status?.category ?? null;
                    const parcelCat = parcel.parcel_status?.category ?? null;
                    if (
                        matched.category === 'new' &&
                        ((orderCat && orderCat !== 'new') || (parcelCat && parcelCat !== 'new'))
                    ) {
                        console.warn(
                            `[sync-tracking] refused regression to 'new' parcel=${parcel.id} ` +
                            `orderCat=${orderCat} parcelCat=${parcelCat}`,
                        );
                        continue;
                    }

                    // REGRESSION GUARD #2: don't move backwards along the
                    // forward delivery progression (new → pickup_pending →
                    // picked_up → in_transit → out_for_delivery). Side
                    // categories (callback, postponed, etc.) are allowed.
                    const currentRank =
                        FORWARD_RANK[orderCat as string] ??
                        FORWARD_RANK[parcelCat as string];
                    const newRank = FORWARD_RANK[matched.category as string];
                    if (
                        currentRank !== undefined &&
                        newRank !== undefined &&
                        newRank < currentRank
                    ) {
                        console.warn(
                            `[sync-tracking] refused forward regression parcel=${parcel.id} ` +
                            `${parcelCat || orderCat}(${currentRank}) → ${matched.category}(${newRank})`,
                        );
                        continue;
                    }

                    // Always write the *canonical* package_status row's label,
                    // never the raw provider string. This guarantees the trigger
                    // chain resolves cleanly to the correct package_status_id.
                    const { error: upErr } = await supabase
                        .from('company_parcels')
                        .update({
                            status_id: matched.id,
                            status_label: matched.label,
                            status_color: matched.color,
                        })
                        .eq('id', parcel.id);
                    if (upErr) throw upErr;
                    changed++;
                } catch (err) {
                    failed++;
                    console.error(`[sync-tracking] parcel ${parcel.id} failed:`, err?.message || err);
                }
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
        );
    } catch (err) {
        fatalError = err?.message || String(err);
        console.error(`[sync-tracking] run ${runId} fatal:`, fatalError);
    }

    // Finalize the run row.
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
        JSON.stringify({
            success: !fatalError,
            run_id: runId,
            total,
            changed,
            failed,
            duration_ms: durationMs,
            error: fatalError,
        }),
        {
            status: fatalError ? 500 : 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
    );
});
