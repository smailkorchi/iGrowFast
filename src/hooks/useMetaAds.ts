import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
    invokeMeta,
    type MetaAd,
    type MetaAdAccount,
    type MetaAdSet,
    type MetaCampaign,
    type MetaPixelStats,
} from '@/lib/metaAds';

// meta_ads_connections is not yet in the generated Database type. Cast to the
// untyped SupabaseClient for operations on this table so we avoid the type
// machinery recursing into an unknown relation (same trick as useGoogleAnalytics).
const metaDb = supabase as unknown as SupabaseClient;

export type MetaConnection = {
    id: string;
    'DigiCom Business': string;
    ad_account_id: string;
    business_id_meta: string | null;
    pixel_id: string | null;
    display_name: string;
    is_default: boolean;
    token_secret_id: string;
    token_expires_at: string | null;
    last_verified_at: string | null;
    verification_status: 'pending' | 'verified' | 'error';
    verification_error: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type DatePreset =
    | 'today'
    | 'yesterday'
    | 'last_7d'
    | 'last_14d'
    | 'last_28d'
    | 'last_30d'
    | 'last_90d'
    | 'this_month'
    | 'last_month'
    | 'maximum';

// ── Connections ────────────────────────────────────────────────────────
/**
 * Loads Meta Ads connections for a specific business. Always pass
 * `businessId` — filtering is server-side so a missing/null id returns an
 * empty array and never fetches rows belonging to other businesses.
 * Previously the query had no `.eq` filter, fetching everything and relying
 * on RLS + client-side filtering as the only scope guard.
 */
export function useMetaConnections(businessId: string | null | undefined) {
    return useQuery({
        queryKey: ['meta-connections', businessId ?? null],
        enabled: !!businessId,
        queryFn: async () => {
            if (!businessId) return [] as MetaConnection[];
            const { data, error } = await metaDb
                .from('meta_ads_connections')
                .select('*')
                .eq('DigiCom Business', businessId)
                .order('is_default', { ascending: false })
                .order('created_at', { ascending: true });
            if (error) throw error;
            return (data ?? []) as unknown as MetaConnection[];
        },
    });
}

export function useVerifyMetaToken() {
    return useMutation({
        mutationFn: async (payload: { token: string; ad_account_id?: string }) => {
            return invokeMeta<{ ok: true; me: { id: string; name: string }; account: MetaAdAccount | null }>({
                action: 'verify_token',
                ...payload,
            });
        },
    });
}

export function useListMetaAdAccounts() {
    return useMutation({
        mutationFn: async (payload: { token: string }) => {
            const res = await invokeMeta<{ ok: true; accounts: MetaAdAccount[] }>({
                action: 'list_ad_accounts',
                ...payload,
            });
            return res.accounts;
        },
    });
}

export function useListMetaPixelsForToken() {
    return useMutation({
        mutationFn: async (payload: { token: string; ad_account_id: string }) => {
            const res = await invokeMeta<{
                ok: true;
                pixels: Array<{ id: string; name: string; last_fired_time?: string }>;
            }>({
                action: 'list_pixels_for_token',
                ...payload,
            });
            return res.pixels;
        },
    });
}

export function useCreateMetaConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload: {
            token: string;
            business_id: string;
            ad_account_id: string;
            display_name: string;
            business_id_meta?: string | null;
            pixel_id?: string | null;
            is_default?: boolean;
            token_expires_at?: string | null;
        }) => {
            const res = await invokeMeta<{ ok: true; connection_id: string }>({
                action: 'create_connection',
                ...payload,
            });
            return res.connection_id;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['meta-connections'] });
        },
    });
}

export function useDeleteMetaConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            // ON DELETE trigger cleans up the paired vault secret.
            const { error } = await metaDb.from('meta_ads_connections').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['meta-connections'] });
        },
    });
}

export function useSetDefaultMetaConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, business_id }: { id: string; business_id: string }) => {
            const { error: clearErr } = await metaDb
                .from('meta_ads_connections')
                .update({ is_default: false })
                .eq('DigiCom Business', business_id);
            if (clearErr) throw clearErr;
            const { error } = await metaDb
                .from('meta_ads_connections')
                .update({ is_default: true })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['meta-connections'] });
        },
    });
}

// ── Reads ──────────────────────────────────────────────────────────────
export function useMetaAccountSummary(connection_id: string | null) {
    return useQuery({
        queryKey: ['meta-account-summary', connection_id],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 5,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; account: MetaAdAccount }>({
                action: 'account_summary',
                connection_id,
            });
            return res.account;
        },
    });
}

export function useMetaCampaigns(
    connection_id: string | null,
    date_preset: DatePreset
) {
    return useQuery({
        queryKey: ['meta-campaigns', connection_id, date_preset],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 2,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; campaigns: MetaCampaign[] }>({
                action: 'list_campaigns',
                connection_id,
                date_preset,
                limit: 200,
            });
            return res.campaigns ?? [];
        },
    });
}

export function useMetaAdSets(
    connection_id: string | null,
    campaign_id: string | null,
    date_preset: DatePreset,
    options?: { enabled?: boolean }
) {
    return useQuery({
        queryKey: ['meta-adsets', connection_id, campaign_id, date_preset],
        enabled: !!connection_id && (options?.enabled ?? true),
        staleTime: 1000 * 60 * 2,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; adsets: MetaAdSet[] }>({
                action: 'list_adsets',
                connection_id,
                campaign_id,
                date_preset,
            });
            return res.adsets ?? [];
        },
    });
}

export function useMetaAds(
    connection_id: string | null,
    adset_id: string | null,
    date_preset: DatePreset,
    options?: { enabled?: boolean }
) {
    return useQuery({
        queryKey: ['meta-ads', connection_id, adset_id, date_preset],
        enabled: !!connection_id && !!adset_id && (options?.enabled ?? true),
        staleTime: 1000 * 60 * 2,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; ads: MetaAd[] }>({
                action: 'list_ads',
                connection_id,
                adset_id,
                date_preset,
            });
            return res.ads ?? [];
        },
    });
}

export function useMetaAccountTimeseries(
    connection_id: string | null,
    date_preset: DatePreset
) {
    return useQuery({
        queryKey: ['meta-account-timeseries', connection_id, date_preset],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 5,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{
                ok: true;
                rows: Array<Record<string, string>>;
            }>({
                action: 'get_insights',
                connection_id,
                level: 'account',
                time_increment: 1,
                date_preset,
            });
            return res.rows ?? [];
        },
    });
}

// ── Writes ─────────────────────────────────────────────────────────────
export function useMetaUpdateStatus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload: {
            connection_id: string;
            object_type: 'campaign' | 'adset' | 'ad';
            object_id: string;
            status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
        }) => {
            return invokeMeta({ action: 'update_status', ...payload });
        },
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({
                queryKey:
                    vars.object_type === 'campaign'
                        ? ['meta-campaigns', vars.connection_id]
                        : vars.object_type === 'adset'
                            ? ['meta-adsets', vars.connection_id]
                            : ['meta-ads', vars.connection_id],
            });
        },
    });
}

export function useMetaUpdateBudget() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload: {
            connection_id: string;
            object_id: string;
            daily_budget?: number;
            lifetime_budget?: number;
            bid_amount?: number;
        }) => {
            return invokeMeta({ action: 'update_budget', ...payload });
        },
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['meta-campaigns', vars.connection_id] });
            qc.invalidateQueries({ queryKey: ['meta-adsets', vars.connection_id] });
        },
    });
}

export function useMetaCreateCampaign() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload: {
            connection_id: string;
            name: string;
            objective: string;
            status?: 'PAUSED' | 'ACTIVE';
            special_ad_categories?: string[];
            buying_type?: string;
            daily_budget?: number;
            lifetime_budget?: number;
        }) => {
            const res = await invokeMeta<{ ok: true; id: string }>({
                action: 'create_campaign',
                ...payload,
            });
            return res.id;
        },
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['meta-campaigns', vars.connection_id] });
        },
    });
}

export function useMetaCreateAdSet() {
    return useMutation({
        mutationFn: async (payload: {
            connection_id: string;
            campaign_id: string;
            name: string;
            daily_budget?: number;
            lifetime_budget?: number;
            billing_event: string;
            optimization_goal: string;
            bid_amount?: number;
            targeting: Record<string, unknown>;
            start_time?: string;
            end_time?: string;
            status?: 'PAUSED' | 'ACTIVE';
        }) => {
            const res = await invokeMeta<{ ok: true; id: string }>({
                action: 'create_adset',
                ...payload,
            });
            return res.id;
        },
    });
}

export function useMetaCreateAd() {
    return useMutation({
        mutationFn: async (payload: {
            connection_id: string;
            adset_id: string;
            name: string;
            creative: Record<string, unknown>;
            status?: 'PAUSED' | 'ACTIVE';
        }) => {
            const res = await invokeMeta<{ ok: true; id: string }>({
                action: 'create_ad',
                ...payload,
            });
            return res.id;
        },
    });
}

export function useMetaUploadImageFromUrl() {
    return useMutation({
        mutationFn: async (payload: { connection_id: string; image_url: string }) => {
            return invokeMeta<{ ok: true; images: unknown }>({
                action: 'upload_image_from_url',
                ...payload,
            });
        },
    });
}

// ── Pixel ──────────────────────────────────────────────────────────────
export function useMetaPixelOverview(connection_id: string | null, pixel_id?: string | null) {
    return useQuery({
        queryKey: ['meta-pixel-overview', connection_id, pixel_id],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 5,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; pixel: any }>({
                action: 'get_pixel_overview',
                connection_id,
                pixel_id,
            });
            return res.pixel;
        },
    });
}

export function useMetaPixelEventsByType(
    connection_id: string | null,
    date_preset: DatePreset,
    pixel_id?: string | null
) {
    return useQuery({
        queryKey: ['meta-pixel-events-by-type', connection_id, date_preset, pixel_id],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 2,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; stats: MetaPixelStats[] }>({
                action: 'get_pixel_events_by_type',
                connection_id,
                date_preset,
                pixel_id,
            });
            return res.stats ?? [];
        },
    });
}

export function useMetaPixelTimeseries(
    connection_id: string | null,
    date_preset: DatePreset,
    pixel_id?: string | null
) {
    return useQuery({
        queryKey: ['meta-pixel-timeseries', connection_id, date_preset, pixel_id],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 5,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; stats: MetaPixelStats[] }>({
                action: 'get_pixel_timeseries',
                connection_id,
                date_preset,
                pixel_id,
            });
            return res.stats ?? [];
        },
    });
}

// ── OAuth ──────────────────────────────────────────────────────────────
export function useStartMetaOAuth() {
    return useMutation({
        mutationFn: async (payload: { business_id: string; return_to: string }) => {
            // supabase.functions.invoke sends POST with Authorization header,
            // which is exactly what the /start handler expects.
            const { data, error } = await supabase.functions.invoke('meta-ads-oauth', {
                body: { action: 'start', ...payload },
            });
            if (error) throw new Error(error.message);
            const res = data as { ok: boolean; auth_url?: string; error?: string };
            if (!res.ok || !res.auth_url) throw new Error(res.error ?? 'failed to start OAuth');
            return res.auth_url;
        },
    });
}

// ── All ad sets (no campaign filter) ─────────────────────────────────
export function useMetaAllAdSets(connection_id: string | null, date_preset: DatePreset) {
    return useQuery({
        queryKey: ['meta-all-adsets', connection_id, date_preset],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 2,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; adsets: any[] }>({
                action: 'list_adsets',
                connection_id,
                date_preset,
            });
            return res.adsets ?? [];
        },
    });
}

// ── Custom audiences ─────────────────────────────────────────────────
export function useMetaCustomAudiences(connection_id: string | null) {
    return useQuery({
        queryKey: ['meta-custom-audiences', connection_id],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 5,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; audiences: Array<{ id: string; name: string; approximate_count: number }> }>({
                action: 'list_custom_audiences',
                connection_id,
            });
            return res.audiences ?? [];
        },
    });
}

// ── All ads (no adset filter) ────────────────────────────────────────
export function useMetaAllAds(connection_id: string | null, date_preset: DatePreset) {
    return useQuery({
        queryKey: ['meta-all-ads', connection_id, date_preset],
        enabled: !!connection_id,
        staleTime: 1000 * 60 * 2,
        queryFn: async () => {
            if (!connection_id) throw new Error('connection_id required');
            const res = await invokeMeta<{ ok: true; ads: any[] }>({
                action: 'list_ads',
                connection_id,
                date_preset,
            });
            return res.ads ?? [];
        },
    });
}

// ── Shared helpers ─────────────────────────────────────────────────────
/**
 * Returns the currently-active business id. Previously wrapped in `useMemo`
 * with an empty dep array, which froze the value on mount and ignored any
 * subsequent localStorage writes. The lookup is a single synchronous read —
 * no memoisation needed.
 */
export function useActiveMetaBusinessId(): string | null {
    return localStorage.getItem('activeBusinessId');
}
