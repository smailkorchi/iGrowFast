import { supabase } from '@/lib/supabase';
import { getLatestTrackableCompanyParcel } from '@/lib/orders/getLatestTrackableCompanyParcel';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

const TERMINAL_PKG_CATEGORIES = new Set([
    'delivered',
    'returned',
    'returning',
    'refused',
    'cancelled',
]);

export type TrackableParcel = {
    id: string;
    provider_id: string;
    tracking_code: string;
    external_id: string | null;
    current_status_id?: string | null;
};

type PackageStatusRow = {
    id: string;
    code: string | null;
    label: string | null;
    color: string | null;
    category: string | null;
    delivery_service_statuses: string[] | null;
};

let statusCache: PackageStatusRow[] | null = null;
let statusCachePromise: Promise<PackageStatusRow[]> | null = null;

/** Loads package_statuses once and caches in-memory for the session. */
async function getPackageStatuses(force = false): Promise<PackageStatusRow[]> {
    if (!force && statusCache) return statusCache;
    if (!force && statusCachePromise) return statusCachePromise;
    statusCachePromise = (async () => {
        const { data, error } = await supabase
            .from('package_statuses')
            .select('id, code, label, color, category, delivery_service_statuses');
        if (error) throw error;
        statusCache = (data || []) as PackageStatusRow[];
        statusCachePromise = null;
        return statusCache;
    })();
    return statusCachePromise;
}

/** Force-refresh the package_statuses cache (e.g. after admin edits). */
export function invalidatePackageStatusCache() {
    statusCache = null;
    statusCachePromise = null;
}

const norm = (v: unknown): string =>
    String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip diacritics
        .toLowerCase()
        .trim();

/**
 * Smart match: tries delivery_service_statuses array (matched against the
 * provider status code AND its localized label), falls back to label match.
 * Diacritic- and case-insensitive throughout.
 */
function matchPackageStatus(
    rows: PackageStatusRow[],
    candidates: Array<string | null | undefined>,
): PackageStatusRow | null {
    const normalized = candidates
        .map((c) => norm(c))
        .filter((c) => c.length > 0);
    if (normalized.length === 0) return null;

    // Pass 1: exact match in delivery_service_statuses array
    for (const row of rows) {
        const arr = row.delivery_service_statuses || [];
        for (const entry of arr) {
            const n = norm(entry);
            if (!n) continue;
            if (normalized.includes(n)) return row;
        }
    }

    // Pass 2: exact match against label
    for (const row of rows) {
        const n = norm(row.label);
        if (n && normalized.includes(n)) return row;
    }

    // Pass 3: exact match against code
    for (const row of rows) {
        const n = norm(row.code);
        if (n && normalized.includes(n)) return row;
    }

    // Pass 4: partial (substring) match against label
    for (const row of rows) {
        const n = norm(row.label);
        if (!n) continue;
        if (normalized.some((c) => c.includes(n) || n.includes(c))) return row;
    }

    return null;
}

/** Calls provider-integration with track_parcel + fallback to get_parcel_info. */
export async function trackParcelWithFallback(
    parcel: TrackableParcel,
    signal?: AbortSignal,
): Promise<Record<string, unknown>> {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
    };

    let response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
            action: 'track_parcel',
            provider_id: parcel.provider_id,
            data: {
                tracking_code: parcel.tracking_code,
                external_id: parcel.external_id,
            },
        }),
    });

    const isError = !response.ok;
    let result = isError ? null : await response.json();

    if (isError || !result?.success) {
        response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers,
            signal,
            body: JSON.stringify({
                action: 'get_parcel_info',
                provider_id: parcel.provider_id,
                data: { tracking_code: parcel.tracking_code },
            }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: 'Failed to fetch tracking data' }));
            throw new Error(errData.error || `Error ${response.status}`);
        }

        result = await response.json();

        if (result.success && result.data && !result.data.history && !Array.isArray(result.data)) {
            result.data.history = [
                {
                    status: result.data.status,
                    statusLabel: result.data.statusLabel || result.data.status,
                    date: result.data.date || new Date().toISOString(),
                    comment: result.data.comment || 'Statut actuel (historique indisponible)',
                    user: 'Synchronisation Coliaty/Provider',
                },
            ];
        }
    }

    if (result && result.success) {
        return result.data as Record<string, unknown>;
    }
    throw new Error(result?.error || 'Unknown error');
}

/**
 * Pick the best matching package_status from the provider response.
 * Tries the headline status first, then walks the history (latest first)
 * until something maps to a known package_status.
 */
function pickStatusFromResponse(
    data: Record<string, unknown>,
    rows: PackageStatusRow[],
): { matched: PackageStatusRow | null; rawLabel: string | null; rawColor: string | null } {
    const headlineLabel = (data.statusLabel || data.status || data.current_status) as string | undefined;
    const headlineCode = (data.status || data.current_status) as string | undefined;
    const headlineColor = (data.statusColor || data.color) as string | undefined;

    let matched = matchPackageStatus(rows, [headlineLabel, headlineCode]);

    let rawLabel = headlineLabel || null;
    let rawColor = headlineColor || null;

    if (!matched) {
        const history = (Array.isArray(data.history) ? (data.history as any[]) : []).slice();
        // Walk newest-first.
        for (const event of history) {
            if (!event) continue;
            const evLabel = event.statusLabel || event.status_label;
            const evCode = event.status;
            const candidate = matchPackageStatus(rows, [evLabel, evCode]);
            if (candidate) {
                matched = candidate;
                rawLabel = (evLabel || evCode || rawLabel) as string | null;
                rawColor = (event.statusColor || event.color || rawColor) as string | null;
                break;
            }
        }
    }

    return { matched, rawLabel, rawColor };
}

/** Sync a single parcel: fetch from provider, smart-match status, update company_parcels. */
export async function syncParcelTracking(
    parcel: TrackableParcel,
    signal?: AbortSignal,
): Promise<{ updated: boolean; status_id: string | null; status_label: string | null }> {
    const [data, rows] = await Promise.all([
        trackParcelWithFallback(parcel, signal),
        getPackageStatuses(),
    ]);

    if (signal?.aborted) {
        return { updated: false, status_id: null, status_label: null };
    }

    const { matched, rawLabel, rawColor } = pickStatusFromResponse(data, rows);

    // Nothing usable in the response.
    if (!matched && !rawLabel) {
        return { updated: false, status_id: null, status_label: null };
    }

    const newStatusId = matched?.id ?? null;
    const newLabel = matched?.label || rawLabel || null;
    const newColor = matched?.color || rawColor || null;

    // Skip the write when nothing changed (cuts realtime noise + DB churn).
    if (parcel.current_status_id && newStatusId && parcel.current_status_id === newStatusId) {
        return { updated: false, status_id: newStatusId, status_label: newLabel };
    }

    const { error: updateError } = await supabase
        .from('company_parcels')
        .update({
            status_id: newStatusId,
            status_label: newLabel,
            status_color: newColor,
        })
        .eq('id', parcel.id);

    if (updateError) throw updateError;

    return { updated: true, status_id: newStatusId, status_label: newLabel };
}

type OrderForSync = {
    id: string;
    package_status?: { id?: string | null; category?: string | null } | null;
    package_status_id?: string | null;
    parcels?: any[];
};

export type BatchSyncResult = {
    synced: number;
    changed: number;
    skipped: number;
    failed: number;
};

/** Batch-sync all non-terminal trackable orders with bounded concurrency. */
export async function syncOrdersTracking(
    orders: OrderForSync[],
    opts?: { concurrency?: number; signal?: AbortSignal },
): Promise<BatchSyncResult> {
    const concurrency = Math.max(1, opts?.concurrency ?? 4);
    const signal = opts?.signal;

    // Warm the cache up-front so workers don't race on it.
    try { await getPackageStatuses(); } catch { /* ignore — fall back to per-call load */ }

    const targets: TrackableParcel[] = [];
    let skipped = 0;

    for (const order of orders || []) {
        const cat = order?.package_status?.category ?? null;
        if (cat && TERMINAL_PKG_CATEGORIES.has(cat)) {
            skipped++;
            continue;
        }
        const parcel = getLatestTrackableCompanyParcel(order);
        if (!parcel) {
            skipped++;
            continue;
        }
        targets.push({
            ...parcel,
            current_status_id: order.package_status_id ?? order.package_status?.id ?? null,
        });
    }

    let synced = 0;
    let changed = 0;
    let failed = 0;
    let cursor = 0;

    const worker = async () => {
        while (cursor < targets.length) {
            if (signal?.aborted) return;
            const i = cursor++;
            try {
                const r = await syncParcelTracking(targets[i], signal);
                synced++;
                if (r.updated) changed++;
            } catch (err) {
                if ((err as any)?.name === 'AbortError') return;
                failed++;
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
    );

    return { synced, changed, skipped, failed };
}
