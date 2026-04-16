import { supabase } from '@/lib/supabase';

// ── Types (mirror subset of Meta Graph shapes we consume) ──────────────
export type MetaInsightAction = { action_type: string; value: string };
export type MetaInsights = {
    spend?: string;
    impressions?: string;
    clicks?: string;
    ctr?: string;
    cpm?: string;
    cpc?: string;
    reach?: string;
    frequency?: string;
    actions?: MetaInsightAction[];
    action_values?: MetaInsightAction[];
    purchase_roas?: { action_type: string; value: string }[];
};

export type MetaCampaign = {
    id: string;
    name: string;
    status: string;
    effective_status: string;
    objective: string;
    daily_budget?: string | null;
    lifetime_budget?: string | null;
    budget_remaining?: string | null;
    start_time?: string | null;
    stop_time?: string | null;
    created_time?: string;
    updated_time?: string;
    special_ad_categories?: string[];
    insights?: { data: MetaInsights[] };
};

export type MetaAdSet = {
    id: string;
    name: string;
    status: string;
    effective_status: string;
    campaign_id: string;
    daily_budget?: string | null;
    lifetime_budget?: string | null;
    budget_remaining?: string | null;
    billing_event?: string;
    optimization_goal?: string;
    bid_amount?: string | null;
    start_time?: string;
    end_time?: string;
    targeting?: Record<string, unknown>;
    insights?: { data: MetaInsights[] };
};

export type MetaAd = {
    id: string;
    name: string;
    status: string;
    effective_status: string;
    adset_id: string;
    campaign_id: string;
    creative?: {
        id?: string;
        thumbnail_url?: string;
        image_url?: string;
        title?: string;
        body?: string;
    };
    insights?: { data: MetaInsights[] };
};

export type MetaAdAccount = {
    id: string; // with act_ prefix
    name: string;
    currency: string;
    timezone_name?: string;
    business?: { id: string; name: string };
    account_status?: number;
    amount_spent?: string;
    balance?: string;
};

export type MetaPixelStats = {
    aggregation: string;
    data: Array<{ value: string; count: number }>;
    start_time?: number;
    end_time?: number;
};

// ── Invoke helper ──────────────────────────────────────────────────────
type InvokeBody = Record<string, unknown> & { action: string };

export async function invokeMeta<T = unknown>(body: InvokeBody): Promise<T> {
    const { data, error } = await supabase.functions.invoke('meta-ads-fetch', {
        body,
    });
    if (error) {
        // FunctionsHttpError hides body on non-2xx. Recover the { ok:false, error }
        // payload so callers see the real message (same as invokeGA).
        const maybeCtx = error as unknown as { context?: Response };
        if (maybeCtx?.context && typeof maybeCtx.context.text === 'function') {
            try {
                const text = await maybeCtx.context.text();
                const parsed = JSON.parse(text) as { error?: string };
                if (parsed?.error) throw new Error(parsed.error);
            } catch {
                // fall through to generic error
            }
        }
        throw new Error(error.message);
    }
    const payload = data as { ok?: boolean; error?: string } & T;
    if (payload && payload.ok === false && payload.error) {
        throw new Error(payload.error);
    }
    return payload as T;
}

// ── Small helpers ──────────────────────────────────────────────────────
export function firstInsights(obj: {
    insights?: { data: MetaInsights[] };
}): MetaInsights {
    return obj?.insights?.data?.[0] ?? {};
}

export function pickRoas(ins: MetaInsights): number {
    const entries = ins.purchase_roas ?? [];
    // Pick the omni/default roas; fall back to first entry.
    const omni = entries.find((e) => e.action_type === 'omni_purchase') ?? entries[0];
    return omni ? Number(omni.value) || 0 : 0;
}

export function pickAction(
    ins: MetaInsights,
    action_type: string
): number {
    const entries = ins.actions ?? [];
    const match = entries.find((e) => e.action_type === action_type);
    return match ? Number(match.value) || 0 : 0;
}

export function formatCents(raw: string | null | undefined, currency: string): string {
    if (raw == null || raw === '') return '—';
    const n = Number(raw) / 100;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
    }).format(n);
}

// Meta budgets are in cents of the account currency.
export function toBudgetCents(value: number): string {
    return Math.round(value * 100).toString();
}
