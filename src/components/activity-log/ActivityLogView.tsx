import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
    Search,
    Download,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Filter,
    Shield,
    RefreshCcw,
    X,
    Info,
    History,
    ArrowUpRight,
    type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
    AuditLogFilters,
    AuditLogRow,
    AuditLogScope,
    ACTION_LABEL,
    diffKeys,
    exportAuditLogsCsv,
    flagFromCountryCode,
    formatGeo,
    queryAuditLogs,
} from '@/lib/auditLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';

type Variant = 'admin' | 'owner';

interface ActivityLogViewProps {
    variant: Variant;
}

const ACTION_OPTIONS = [
    'login', 'logout', 'login_failed', 'signup', 'password_reset',
    'insert', 'update', 'delete', 'export', 'access_denied', 'forbidden', 'rls_denied', 'custom',
];

const ROLE_OPTIONS = ['super admin', 'admin', 'commercial', 'mediabuyer', 'courier', 'owner'];

const TABLE_OPTIONS = [
    'orders', 'order_items', 'users', 'products', 'businesses', 'expenses', 'transactions',
    'campaigns', 'ads_history', 'providers', 'provider_webhooks', 'whatsapp_instances',
    'plans', 'business_payments', 'seller_payments', 'mediabuyer_payments', 'courier_fees',
    'seller_demands', 'mediabuyer_demands', 'accessories', 'product_accessories',
    'cities', 'zones', 'courier_zones', 'platform_settings',
];

const PAGE_SIZE = 50;

// Map action → Anthropic tone pill
const actionTheme = (action: string) => {
    switch (action) {
        case 'login':
        case 'signup':
            return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' };
        case 'logout':
            return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' };
        case 'login_failed':
        case 'access_denied':
        case 'forbidden':
        case 'rls_denied':
            return { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' };
        case 'insert':
            return { bg: 'bg-ant-ink/6', border: 'border-ant-ink/20', text: 'text-ant-ink', dot: 'bg-ant-ink' };
        case 'update':
        case 'password_reset':
            return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };
        case 'delete':
            return { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' };
        case 'export':
            return { bg: 'bg-ant-ink/6', border: 'border-ant-ink/20', text: 'text-ant-ink', dot: 'bg-ant-ink' };
        default:
            return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' };
    }
};

const ActivityLogView: React.FC<ActivityLogViewProps> = ({ variant }) => {
    const activeBusinessId = typeof window !== 'undefined'
        ? localStorage.getItem('activeBusinessId')
        : null;

    const [search, setSearch] = useState('');
    const [ipSearch, setIpSearch] = useState('');
    const [actions, setActions] = useState<string[]>([]);
    const [tables, setTables] = useState<string[]>([]);
    const [roles, setRoles] = useState<string[]>([]);
    const [businesses, setBusinesses] = useState<string[]>([]);
    const [scopes, setScopes] = useState<AuditLogScope[]>([]);
    const [dateRange, setDateRange] = useState<DateRange | undefined>();
    const [page, setPage] = useState(0);
    const [detailRow, setDetailRow] = useState<AuditLogRow | null>(null);

    const { data: businessOptions } = useQuery({
        queryKey: ['owner-business-options'],
        enabled: variant === 'owner',
        queryFn: async () => {
            const { data } = await supabase
                .from('businesses')
                .select('id,name,logo')
                .order('name');
            return data ?? [];
        },
    });

    const filters = useMemo<AuditLogFilters>(() => {
        const f: AuditLogFilters = {};
        if (search.trim()) f.search = search.trim();
        if (ipSearch.trim()) f.ip = ipSearch.trim();
        if (actions.length) f.actions = actions;
        if (tables.length) f.tables = tables;
        if (roles.length) f.roles = roles;
        if (variant === 'owner') {
            if (businesses.length) f.businesses = businesses;
            if (scopes.length) f.scopes = scopes;
        } else if (activeBusinessId) {
            f.businesses = [activeBusinessId];
            f.scopes = ['business'];
        }
        return f;
    }, [search, ipSearch, actions, tables, roles, businesses, scopes, variant, activeBusinessId]);

    const { data, isLoading, isFetching, refetch } = useQuery({
        queryKey: ['audit-logs', variant, filters, dateRange?.from, dateRange?.to, page],
        queryFn: () =>
            queryAuditLogs({
                filters,
                from: dateRange?.from ?? null,
                to: dateRange?.to ? new Date(dateRange.to.getTime() + 24 * 3600 * 1000 - 1) : null,
                limit: PAGE_SIZE,
                offset: page * PAGE_SIZE,
            }),
    });

    const rows = data?.rows ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const activeFilterCount =
        actions.length + tables.length + roles.length +
        (variant === 'owner' ? businesses.length + scopes.length : 0) +
        (search ? 1 : 0) + (ipSearch ? 1 : 0) + (dateRange?.from ? 1 : 0);

    const resetFilters = () => {
        setSearch('');
        setIpSearch('');
        setActions([]);
        setTables([]);
        setRoles([]);
        setBusinesses([]);
        setScopes([]);
        setDateRange(undefined);
        setPage(0);
    };

    const handleExport = async () => {
        if (!rows.length) return;
        const name = `activity-log-${variant}-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
        await exportAuditLogsCsv(rows, name);
    };

    return (
        <div className="ant-surface min-h-screen">
            <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            {variant === 'admin' ? 'Security · Activity' : 'Platform · Forensic trail'}
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Activity log
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            {variant === 'admin'
                                ? 'The last 14 days of every action inside this business — older entries purged automatically.'
                                : 'Every action, across every business, kept for posterity. The paper trail that answers every question.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            variant="outline"
                            onClick={() => refetch()}
                            className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 cursor-pointer"
                            disabled={isFetching}
                        >
                            <RefreshCcw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button
                            onClick={handleExport}
                            disabled={!rows.length}
                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Export CSV
                        </Button>
                    </div>
                </header>

                {/* Filters panel */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <Filter className="w-3 h-3" />
                                Filters
                                {activeFilterCount > 0 && (
                                    <span className="rounded-full bg-ant-orange/10 border border-ant-orange/25 text-ant-orange px-2 py-0.5 text-[10px] tabular-nums normal-case tracking-normal">
                                        {activeFilterCount} active
                                    </span>
                                )}
                            </div>
                            <span className="font-serif italic text-[11px] text-ant-mid tabular-nums">
                                {total.toLocaleString()} events
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-1 min-w-[220px]">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                                <Input
                                    placeholder="Search actor, email, entity label or ID..."
                                    value={search}
                                    onChange={(e) => {
                                        setSearch(e.target.value);
                                        setPage(0);
                                    }}
                                    className="h-10 pl-9 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                />
                            </div>

                            <Input
                                placeholder="IP contains..."
                                value={ipSearch}
                                onChange={(e) => {
                                    setIpSearch(e.target.value);
                                    setPage(0);
                                }}
                                className="h-10 w-[160px] rounded-full border-ant-line bg-ant-paper text-[12px] font-mono text-ant-ink placeholder:text-ant-mid"
                            />

                            <MultiPill
                                label="Action"
                                values={actions}
                                options={ACTION_OPTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }))}
                                onChange={(v) => {
                                    setActions(v);
                                    setPage(0);
                                }}
                            />

                            <MultiPill
                                label="Table"
                                values={tables}
                                options={TABLE_OPTIONS.map((t) => ({ value: t, label: t }))}
                                onChange={(v) => {
                                    setTables(v);
                                    setPage(0);
                                }}
                            />

                            <MultiPill
                                label="Role"
                                values={roles}
                                options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
                                onChange={(v) => {
                                    setRoles(v);
                                    setPage(0);
                                }}
                            />

                            {variant === 'owner' && (
                                <>
                                    <MultiPill
                                        label="Business"
                                        values={businesses}
                                        options={(businessOptions ?? []).map((b) => ({ value: b.id, label: b.name ?? b.id }))}
                                        onChange={(v) => {
                                            setBusinesses(v);
                                            setPage(0);
                                        }}
                                    />
                                    <MultiPill
                                        label="Scope"
                                        values={scopes}
                                        options={[
                                            { value: 'platform', label: 'Platform' },
                                            { value: 'business', label: 'Business' },
                                        ]}
                                        onChange={(v) => {
                                            setScopes(v as AuditLogScope[]);
                                            setPage(0);
                                        }}
                                    />
                                </>
                            )}

                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="h-10 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink text-[12px] font-semibold gap-2 cursor-pointer"
                                    >
                                        <Filter className="w-3.5 h-3.5 text-ant-mid" />
                                        {dateRange?.from
                                            ? `${format(dateRange.from, 'MMM d')}${dateRange.to ? ' → ' + format(dateRange.to, 'MMM d') : ''}`
                                            : 'Date range'}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="ant-calendar w-auto p-0 rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="end">
                                    <CalendarComponent
                                        mode="range"
                                        selected={dateRange}
                                        onSelect={(r) => {
                                            setDateRange(r);
                                            setPage(0);
                                        }}
                                        numberOfMonths={2}
                                    />
                                </PopoverContent>
                            </Popover>

                            {activeFilterCount > 0 && (
                                <Button
                                    variant="ghost"
                                    onClick={resetFilters}
                                    className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light gap-1.5 cursor-pointer"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    Clear {activeFilterCount}
                                </Button>
                            )}
                        </div>
                    </div>
                </section>

                {/* Table */}
                <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light/50">
                                    <Th>When</Th>
                                    <Th>Actor</Th>
                                    <Th>Action</Th>
                                    <Th>Entity</Th>
                                    {variant === 'owner' && <Th>Business</Th>}
                                    <Th>Location</Th>
                                    <Th>IP</Th>
                                    <Th></Th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={variant === 'owner' ? 8 : 7} className="py-20 text-center">
                                            <Loader2 className="w-6 h-6 animate-spin text-ant-mid inline-block" />
                                        </td>
                                    </tr>
                                ) : !rows.length ? (
                                    <tr>
                                        <td colSpan={variant === 'owner' ? 8 : 7} className="py-16 text-center">
                                            <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                                                <History className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                                            </div>
                                            <h3 className="font-display text-[16px] text-ant-ink tracking-tight">
                                                {activeFilterCount > 0 ? 'No events match these filters' : 'No activity yet'}
                                            </h3>
                                            <p className="font-serif italic text-[12px] text-ant-mid mt-1 max-w-sm mx-auto">
                                                {activeFilterCount > 0
                                                    ? 'Relax the filters to bring history back into view.'
                                                    : 'Every action in the platform will surface here.'}
                                            </p>
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((row) => (
                                        <LogRow
                                            key={row.id}
                                            row={row}
                                            variant={variant}
                                            businessName={businessOptions?.find((b) => b.id === row.business_id)?.name ?? null}
                                            businessLogo={businessOptions?.find((b) => b.id === row.business_id)?.logo ?? null}
                                            onOpen={() => setDetailRow(row)}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-5 py-3 border-t border-ant-line">
                        <p className="text-[11px] font-semibold text-ant-mid uppercase tracking-[0.18em] tabular-nums">
                            <span className="text-ant-ink">{total.toLocaleString()}</span> events · page <span className="text-ant-ink">{page + 1}</span> / {totalPages}
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page === 0}
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                className="h-9 rounded-full px-4 border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[11px] font-semibold gap-1.5 cursor-pointer"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" /> Prev
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page + 1 >= totalPages}
                                onClick={() => setPage((p) => p + 1)}
                                className="h-9 rounded-full px-4 border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[11px] font-semibold gap-1.5 cursor-pointer"
                            >
                                Next <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </div>
                </div>

                <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
                    <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto ant-scroll p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Event · Forensic detail
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                                {detailRow && ACTION_LABEL[detailRow.action] ? ACTION_LABEL[detailRow.action] : 'Event detail'}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Everything captured about this action — who, when, where, and what changed.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="p-6">
                            {detailRow && <LogDetail row={detailRow} />}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">
        {children}
    </th>
);

interface LogRowProps {
    row: AuditLogRow;
    variant: Variant;
    businessName: string | null;
    businessLogo: string | null;
    onOpen: () => void;
}

const LogRow: React.FC<LogRowProps> = ({ row, variant, businessName, businessLogo, onOpen }) => {
    const tone = actionTheme(row.action);
    const actionLabel = ACTION_LABEL[row.action] ?? row.action;
    const flag = flagFromCountryCode(row.geo?.country_code);
    const isSystem = row.actor_name === 'System' || (row.metadata as { system?: boolean } | null)?.system === true;
    return (
        <tr
            onClick={onOpen}
            className="border-b border-ant-line last:border-0 hover:bg-ant-light/60 cursor-pointer transition-colors"
        >
            <td className="px-4 py-3 align-top">
                <div className="text-[12px] font-semibold text-ant-ink">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                </div>
                <div className="text-[10px] text-ant-mid tabular-nums">
                    {format(new Date(row.created_at), 'MMM d · HH:mm:ss')}
                </div>
            </td>
            <td className="px-4 py-3 align-top">
                <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="h-8 w-8 rounded-xl shrink-0 border border-ant-line">
                        <AvatarImage src={row.actor_avatar_url ?? undefined} />
                        <AvatarFallback className={cn(
                            'rounded-xl text-[10px] font-display font-semibold',
                            isSystem ? 'bg-ant-light text-ant-mid' : 'bg-ant-ink/5 text-ant-ink',
                        )}>
                            {isSystem ? 'SYS' : (row.actor_name ?? row.actor_email ?? '?').charAt(0).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <div className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[180px]">
                            {row.actor_name ?? row.actor_email ?? 'Unknown'}
                        </div>
                        <div className="text-[10px] text-ant-mid uppercase tracking-[0.14em] truncate max-w-[180px]">
                            {isSystem
                                ? ((row.metadata as { origin?: string } | null)?.origin ?? 'automated')
                                : (row.actor_role ?? '—')}
                        </div>
                    </div>
                </div>
            </td>
            <td className="px-4 py-3 align-top">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', tone.bg, tone.border, tone.text)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                    {actionLabel}
                </span>
            </td>
            <td className="px-4 py-3 align-top">
                {row.entity_table ? (
                    <div>
                        <div className="text-[12px] font-semibold text-ant-ink">
                            {row.entity_table}
                            {row.entity_id && <span className="text-ant-mid font-mono tabular-nums ml-1">#{row.entity_id.slice(0, 8)}</span>}
                        </div>
                        {row.entity_label && (
                            <div className="text-[11px] text-ant-mid truncate max-w-[220px]">
                                {row.entity_label}
                            </div>
                        )}
                        {row.changes?.before && row.changes?.after && (
                            <div className="text-[10px] text-ant-orange font-semibold tabular-nums mt-0.5">
                                {diffKeys(row.changes.before, row.changes.after).length} field{diffKeys(row.changes.before, row.changes.after).length === 1 ? '' : 's'} changed
                            </div>
                        )}
                    </div>
                ) : (
                    <span className="text-[11px] text-ant-mid">—</span>
                )}
            </td>
            {variant === 'owner' && (
                <td className="px-4 py-3 align-top">
                    {businessName ? (
                        <div className="flex items-center gap-2 min-w-0">
                            <Avatar className="h-7 w-7 rounded-lg shrink-0 border border-ant-line">
                                <AvatarImage src={businessLogo ?? undefined} />
                                <AvatarFallback className="rounded-lg text-[10px] font-display font-semibold bg-ant-ink/5 text-ant-ink">
                                    {businessName.charAt(0).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <span className="text-[12px] font-semibold text-ant-ink truncate max-w-[160px]">
                                {businessName}
                            </span>
                        </div>
                    ) : (
                        <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid uppercase tracking-[0.14em]">
                            Platform
                        </span>
                    )}
                </td>
            )}
            <td className="px-4 py-3 align-top">
                <div className="text-[12px] font-semibold text-ant-ink flex items-center gap-1.5">
                    {flag && <span className="text-base leading-none">{flag}</span>}
                    <span className="truncate max-w-[170px]">{formatGeo(row)}</span>
                </div>
                {row.geo?.isp && (
                    <div className="text-[10px] text-ant-mid truncate max-w-[170px]">
                        {row.geo.isp}
                    </div>
                )}
            </td>
            <td className="px-4 py-3 align-top">
                <code className="text-[11px] font-mono text-ant-mid tabular-nums">
                    {row.ip ?? '—'}
                </code>
            </td>
            <td className="px-4 py-3 align-top text-right">
                <ArrowUpRight className="w-4 h-4 text-ant-mid inline" />
            </td>
        </tr>
    );
};

const LogDetail: React.FC<{ row: AuditLogRow }> = ({ row }) => {
    const changed = diffKeys(row.changes?.before, row.changes?.after);
    const tone = actionTheme(row.action);
    return (
        <div className="space-y-5">
            {/* Action summary strip */}
            <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize', tone.bg, tone.border, tone.text)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                    {ACTION_LABEL[row.action] ?? row.action}
                </span>
                <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2.5 py-1 text-[11px] font-semibold text-ant-ink capitalize">
                    {row.scope}
                </span>
                {row.entity_table && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper px-2.5 py-1 text-[11px] font-semibold text-ant-ink">
                        {row.entity_table}
                        {row.entity_id && <span className="text-ant-mid font-mono tabular-nums">#{row.entity_id.slice(0, 8)}</span>}
                    </span>
                )}
                <span className="font-serif italic text-[11px] text-ant-mid tabular-nums ml-auto">
                    {format(new Date(row.created_at), 'PPpp')}
                </span>
            </div>

            {/* Stat grid */}
            <div className="grid grid-cols-2 gap-3">
                <Stat label="Actor">
                    {row.actor_name ?? row.actor_email ?? '—'} <span className="text-ant-mid font-normal">({row.actor_role ?? 'n/a'})</span>
                </Stat>
                <Stat label="Session">
                    <span className="font-mono text-[11px]">{row.session_id ?? '—'}</span>
                </Stat>
                <Stat label="IP">
                    <span className="font-mono text-[11px] tabular-nums">{row.ip ?? '—'}</span>
                </Stat>
                <Stat label="Location">
                    {formatGeo(row)} {flagFromCountryCode(row.geo?.country_code)}
                </Stat>
                <Stat label="ISP">{row.geo?.isp ?? '—'}</Stat>
                <Stat label="Timezone">{row.geo?.timezone ?? '—'}</Stat>
            </div>

            {row.user_agent && (
                <div>
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-2">
                        User agent
                    </div>
                    <code className="block text-[11px] font-mono text-ant-ink bg-ant-light rounded-2xl p-3.5 break-all border border-ant-line leading-relaxed">
                        {row.user_agent}
                    </code>
                </div>
            )}

            {row.metadata && Object.keys(row.metadata).length > 0 && (
                <div>
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-2">
                        Metadata
                    </div>
                    <pre className="text-[11px] font-mono text-ant-ink bg-ant-light rounded-2xl p-3.5 overflow-x-auto border border-ant-line leading-relaxed">
                        {JSON.stringify(row.metadata, null, 2)}
                    </pre>
                </div>
            )}

            {row.changes && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            Changes
                        </div>
                        {changed.length > 0 && (
                            <span className="inline-flex items-center rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange tabular-nums">
                                {changed.length} field{changed.length === 1 ? '' : 's'}
                            </span>
                        )}
                    </div>
                    {changed.length > 0 && row.changes.before && row.changes.after ? (
                        <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <table className="w-full text-[11px] font-mono">
                                <thead className="bg-ant-light/50">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-sans font-semibold text-[10px] uppercase tracking-[0.18em] text-ant-mid">Field</th>
                                        <th className="text-left px-4 py-3 font-sans font-semibold text-[10px] uppercase tracking-[0.18em] text-ant-rose">Before</th>
                                        <th className="text-left px-4 py-3 font-sans font-semibold text-[10px] uppercase tracking-[0.18em] text-ant-green">After</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {changed.map((k) => (
                                        <tr key={k} className="border-t border-ant-line">
                                            <td className="px-4 py-2.5 font-sans font-semibold text-ant-ink">{k}</td>
                                            <td className="px-4 py-2.5 text-ant-rose break-all">
                                                {JSON.stringify((row.changes!.before as Record<string, unknown>)[k])}
                                            </td>
                                            <td className="px-4 py-2.5 text-ant-green break-all">
                                                {JSON.stringify((row.changes!.after as Record<string, unknown>)[k])}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <pre className="text-[11px] font-mono text-ant-ink bg-ant-light rounded-2xl p-3.5 overflow-x-auto max-h-64 border border-ant-line leading-relaxed">
                            {JSON.stringify(row.changes, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
};

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="rounded-xl border border-ant-line bg-ant-paper p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid mb-1">{label}</div>
        <div className="text-[12px] font-semibold text-ant-ink break-words">{children}</div>
    </div>
);

interface MultiPillProps {
    label: string;
    values: string[];
    options: { value: string; label: string }[];
    onChange: (v: string[]) => void;
}

const MultiPill: React.FC<MultiPillProps> = ({ label, values, options, onChange }) => {
    const [open, setOpen] = useState(false);
    const has = values.length > 0;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        'h-10 rounded-full text-[12px] font-semibold gap-1.5 cursor-pointer',
                        has
                            ? 'bg-ant-ink text-white border-ant-ink hover:bg-ant-ink/90'
                            : 'bg-ant-paper border-ant-line text-ant-ink hover:bg-ant-light'
                    )}
                >
                    {label}
                    {has && (
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', 'bg-white/20 text-white')}>
                            {values.length}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-2 rounded-2xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="start">
                <div className="ant-scroll max-h-64 overflow-y-auto space-y-0.5">
                    {options.map((o) => {
                        const active = values.includes(o.value);
                        return (
                            <button
                                key={o.value}
                                onClick={() => onChange(active ? values.filter((v) => v !== o.value) : [...values, o.value])}
                                className={cn(
                                    'w-full flex items-center justify-between px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors cursor-pointer',
                                    active ? 'bg-ant-orange/10 text-ant-orange border border-ant-orange/25' : 'text-ant-ink hover:bg-ant-light border border-transparent'
                                )}
                            >
                                <span className="truncate">{o.label}</span>
                                {active && <span className="text-[11px]">✓</span>}
                            </button>
                        );
                    })}
                </div>
                {values.length > 0 && (
                    <Button
                        variant="ghost"
                        onClick={() => onChange([])}
                        className="w-full mt-2 h-8 rounded-full text-[11px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                    >
                        Clear all
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default ActivityLogView;
