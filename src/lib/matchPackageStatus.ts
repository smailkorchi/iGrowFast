import type { SupabaseClient } from '@supabase/supabase-js';

export type MatchedPackageStatus = {
    id: string;
    code: string | null;
    label: string | null;
    color: string | null;
    category: string | null;
};

/**
 * Resolve a provider status string (raw, possibly English, possibly with diacritics)
 * to our canonical `package_statuses` row.
 *
 * Match order (same as `provider-webhook` edge function):
 *   1. JSONB containment on `delivery_service_statuses` (exact, fast).
 *   2. RPC `match_package_status` (case + diacritic insensitive).
 *   3. ILIKE on `label` as last resort (legacy behaviour).
 *
 * Returns `null` when no match so callers can keep the raw label on the parcel
 * without crashing or emitting a PostgREST 406.
 */
export async function matchPackageStatus(
    supabase: SupabaseClient,
    rawStatus: string | null | undefined
): Promise<MatchedPackageStatus | null> {
    const value = (rawStatus ?? '').toString().trim();
    if (!value) return null;

    // 1) JSONB containment
    try {
        const { data: exact } = await supabase
            .from('package_statuses')
            .select('id, code, label, color, category')
            .contains('delivery_service_statuses', JSON.stringify([value]))
            .limit(1)
            .maybeSingle();
        if (exact) return exact as MatchedPackageStatus;
    } catch (_) { /* continue to fallback */ }

    // 2) RPC fallback — matches case-insensitive + diacritic-folded
    try {
        const { data: rpcResult } = await supabase.rpc('match_package_status', { p_status_value: value });
        if (Array.isArray(rpcResult) && rpcResult[0]) return rpcResult[0] as MatchedPackageStatus;
        if (rpcResult && typeof rpcResult === 'object') return rpcResult as MatchedPackageStatus;
    } catch (_) { /* continue to fallback */ }

    // 3) Last-resort ILIKE on label (what the old callers did)
    try {
        const { data: byLabel } = await supabase
            .from('package_statuses')
            .select('id, code, label, color, category')
            .ilike('label', value)
            .limit(1)
            .maybeSingle();
        if (byLabel) return byLabel as MatchedPackageStatus;
    } catch (_) { /* swallow */ }

    return null;
}
