import { supabase } from '@/lib/supabase';
import { saveBlob } from '@/lib/saveBlob';

export type AuditLogScope = 'business' | 'platform';

export type AuditLogAction =
    | 'login'
    | 'logout'
    | 'login_failed'
    | 'signup'
    | 'password_reset'
    | 'insert'
    | 'update'
    | 'delete'
    | 'export'
    | 'access_denied'
    | 'forbidden'
    | 'rls_denied'
    | 'custom';

export interface AuditLogRow {
    id: string;
    created_at: string;
    scope: AuditLogScope;
    business_id: string | null;
    actor_id: string | null;
    actor_role: string | null;
    actor_name: string | null;
    actor_email: string | null;
    actor_avatar_url: string | null;
    action: string;
    entity_table: string | null;
    entity_id: string | null;
    entity_label: string | null;
    changes: { before?: unknown; after?: unknown } | null;
    metadata: Record<string, unknown> | null;
    ip: string | null;
    user_agent: string | null;
    geo: {
        country?: string | null;
        country_code?: string | null;
        region?: string | null;
        city?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        isp?: string | null;
        org?: string | null;
        timezone?: string | null;
    } | null;
    session_id: string | null;
}

export interface AuditLogFilters {
    search?: string;
    ip?: string;
    actions?: string[];
    tables?: string[];
    roles?: string[];
    businesses?: string[];
    scopes?: AuditLogScope[];
}

export interface AuditLogQueryInput {
    filters?: AuditLogFilters;
    from?: Date | null;
    to?: Date | null;
    limit?: number;
    offset?: number;
}

export interface AuditLogQueryResult {
    rows: AuditLogRow[];
    total: number;
}

interface LogActionInput {
    action: AuditLogAction | string;
    entity_table?: string | null;
    entity_id?: string | null;
    entity_label?: string | null;
    changes?: unknown;
    metadata?: Record<string, unknown> | null;
    business_id?: string | null;
    scope?: AuditLogScope;
}

export async function logAction(input: LogActionInput): Promise<void> {
    try {
        await supabase.functions.invoke('log-action', { body: input });
    } catch (err) {
        console.warn('[auditLog] logAction failed', err);
    }
}

export async function queryAuditLogs(input: AuditLogQueryInput): Promise<AuditLogQueryResult> {
    // The RPC is not yet in the generated Database types (large file was not regenerated
    // to keep the types file size manageable). Cast the client to `any` for this call only.
    const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    }).rpc('query_audit_logs', {
        p_filters: input.filters ?? {},
        p_from: input.from ? input.from.toISOString() : null,
        p_to: input.to ? input.to.toISOString() : null,
        p_limit: input.limit ?? 50,
        p_offset: input.offset ?? 0,
    });
    if (error) throw error as Error;
    const first = Array.isArray(data) ? (data[0] as { rows: AuditLogRow[] | null; total: number | string }) : null;
    return {
        rows: (first?.rows ?? []) as AuditLogRow[],
        total: Number(first?.total ?? 0),
    };
}

export const ACTION_LABEL: Record<string, string> = {
    login: 'Login',
    logout: 'Logout',
    login_failed: 'Failed login',
    signup: 'Signup',
    password_reset: 'Password reset',
    insert: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    export: 'Exported',
    access_denied: 'Access denied',
    forbidden: 'Forbidden',
    rls_denied: 'RLS denied',
    custom: 'Event',
};

export const ACTION_TONE: Record<string, string> = {
    login: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    logout: 'bg-slate-50 text-slate-700 border-slate-200',
    login_failed: 'bg-red-50 text-red-700 border-red-200',
    signup: 'bg-blue-50 text-blue-700 border-blue-200',
    password_reset: 'bg-amber-50 text-amber-700 border-amber-200',
    insert: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    update: 'bg-amber-50 text-amber-700 border-amber-200',
    delete: 'bg-red-50 text-red-700 border-red-200',
    export: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    access_denied: 'bg-red-50 text-red-700 border-red-200',
    forbidden: 'bg-red-50 text-red-700 border-red-200',
    rls_denied: 'bg-red-50 text-red-700 border-red-200',
    custom: 'bg-slate-50 text-slate-700 border-slate-200',
};

export function formatGeo(row: AuditLogRow): string {
    if (!row.geo) return row.ip || '—';
    const parts = [row.geo.city, row.geo.region, row.geo.country].filter(Boolean);
    return parts.length ? parts.join(', ') : (row.ip || '—');
}

export function flagFromCountryCode(code?: string | null): string {
    if (!code || code.length !== 2) return '';
    const A = 0x1f1e6;
    const a = 'A'.charCodeAt(0);
    return String.fromCodePoint(A + code.toUpperCase().charCodeAt(0) - a) +
        String.fromCodePoint(A + code.toUpperCase().charCodeAt(1) - a);
}

export function diffKeys(before: unknown, after: unknown): string[] {
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const changed: string[] = [];
    keys.forEach((k) => {
        if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
    });
    return changed;
}

function csvEscape(v: unknown): string {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export async function exportAuditLogsCsv(rows: AuditLogRow[], filename: string) {
    const header = [
        'timestamp', 'scope', 'business_id', 'actor_name', 'actor_email', 'actor_role',
        'action', 'entity_table', 'entity_id', 'entity_label',
        'ip', 'country', 'region', 'city', 'isp', 'user_agent',
        'changed_keys', 'metadata',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
        const changed = diffKeys(r.changes?.before, r.changes?.after).join('|');
        lines.push([
            r.created_at,
            r.scope,
            r.business_id ?? '',
            r.actor_name ?? '',
            r.actor_email ?? '',
            r.actor_role ?? '',
            r.action,
            r.entity_table ?? '',
            r.entity_id ?? '',
            r.entity_label ?? '',
            r.ip ?? '',
            r.geo?.country ?? '',
            r.geo?.region ?? '',
            r.geo?.city ?? '',
            r.geo?.isp ?? '',
            r.user_agent ?? '',
            changed,
            r.metadata ? JSON.stringify(r.metadata) : '',
        ].map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const result = await saveBlob(blob, { filename });
    await logAction({
        action: 'export',
        metadata: { filename, row_count: rows.length, save_status: result.status },
    });
    return result;
}
