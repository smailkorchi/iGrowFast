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
    History,
    RefreshCcw,
    X,
    Info,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
    AuditLogFilters,
    AuditLogRow,
    AuditLogScope,
    ACTION_LABEL,
    ACTION_TONE,
    diffKeys,
    exportAuditLogsCsv,
    flagFromCountryCode,
    formatGeo,
    queryAuditLogs,
} from '@/lib/auditLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
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

    // Owner-only: list of businesses for the business filter.
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Activity Log</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            {variant === 'admin'
                                ? 'Last 14 days — older entries purged automatically'
                                : 'Cross-business forensic trail — full retention'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => refetch()}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1.5"
                            disabled={isFetching}
                        >
                            <RefreshCcw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button
                            onClick={handleExport}
                            disabled={!rows.length}
                            className="h-8 rounded-md bg-brand-navy text-white hover:bg-brand-navy/90 text-[11px] font-semibold gap-1.5"
                        >
                            <Download className="w-3 h-3" />
                            Export CSV
                        </Button>
                    </div>
                </div>
            </header>

            {/* Filters */}
            <div className="rounded-xl border border-gray-100 bg-white p-3 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <Input
                        placeholder="Search actor, email, entity label or ID"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                        className="h-8 pl-8 rounded-md border-gray-200 bg-white text-[11px]"
                    />
                </div>

                <Input
                    placeholder="IP contains…"
                    value={ipSearch}
                    onChange={(e) => { setIpSearch(e.target.value); setPage(0); }}
                    className="h-8 w-[140px] rounded-md border-gray-200 bg-white text-[11px]"
                />

                <MultiPill
                    label="Action"
                    values={actions}
                    options={ACTION_OPTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }))}
                    onChange={(v) => { setActions(v); setPage(0); }}
                />

                <MultiPill
                    label="Table"
                    values={tables}
                    options={TABLE_OPTIONS.map((t) => ({ value: t, label: t }))}
                    onChange={(v) => { setTables(v); setPage(0); }}
                />

                <MultiPill
                    label="Role"
                    values={roles}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
                    onChange={(v) => { setRoles(v); setPage(0); }}
                />

                {variant === 'owner' && (
                    <>
                        <MultiPill
                            label="Business"
                            values={businesses}
                            options={(businessOptions ?? []).map((b) => ({ value: b.id, label: b.name ?? b.id }))}
                            onChange={(v) => { setBusinesses(v); setPage(0); }}
                        />
                        <MultiPill
                            label="Scope"
                            values={scopes}
                            options={[
                                { value: 'platform', label: 'Platform' },
                                { value: 'business', label: 'Business' },
                            ]}
                            onChange={(v) => { setScopes(v as AuditLogScope[]); setPage(0); }}
                        />
                    </>
                )}

                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className="h-8 rounded-md text-[11px] font-semibold gap-1.5"
                        >
                            <Filter className="w-3 h-3" />
                            {dateRange?.from
                                ? `${format(dateRange.from, 'MMM d')}${dateRange.to ? ' → ' + format(dateRange.to, 'MMM d') : ''}`
                                : 'Date range'}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 rounded-xl" align="end">
                        <CalendarComponent
                            mode="range"
                            selected={dateRange}
                            onSelect={(r) => { setDateRange(r); setPage(0); }}
                            numberOfMonths={2}
                        />
                    </PopoverContent>
                </Popover>

                {activeFilterCount > 0 && (
                    <Button
                        variant="ghost"
                        onClick={resetFilters}
                        className="h-8 rounded-md text-[11px] font-semibold text-gray-500 hover:text-brand-navy gap-1"
                    >
                        <X className="w-3 h-3" />
                        Clear {activeFilterCount}
                    </Button>
                )}
            </div>

            {/* Table */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-100 bg-gray-50/60">
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
                                    <td colSpan={variant === 'owner' ? 8 : 7} className="py-16 text-center">
                                        <Loader2 className="w-5 h-5 animate-spin text-brand-navy/30 inline-block" />
                                    </td>
                                </tr>
                            ) : !rows.length ? (
                                <tr>
                                    <td colSpan={variant === 'owner' ? 8 : 7} className="py-16 text-center text-[11px] text-gray-400 font-medium">
                                        No activity matches the current filters.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row, idx) => (
                                    <LogRow
                                        key={row.id}
                                        row={row}
                                        variant={variant}
                                        businessName={businessOptions?.find((b) => b.id === row.business_id)?.name ?? null}
                                        businessLogo={businessOptions?.find((b) => b.id === row.business_id)?.logo ?? null}
                                        alt={idx % 2 === 0}
                                        onOpen={() => setDetailRow(row)}
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between px-3 py-2.5 border-t border-gray-100">
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.18em]">
                        {total.toLocaleString()} events · page {page + 1} / {totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page === 0}
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1"
                        >
                            <ChevronLeft className="w-3 h-3" /> Prev
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page + 1 >= totalPages}
                            onClick={() => setPage((p) => p + 1)}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1"
                        >
                            Next <ChevronRight className="w-3 h-3" />
                        </Button>
                    </div>
                </div>
            </div>

            <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
                <DialogContent className="max-w-3xl rounded-xl border border-gray-100">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-[13px] font-semibold text-brand-navy">
                            <Info className="w-3.5 h-3.5" /> Event detail
                        </DialogTitle>
                    </DialogHeader>
                    {detailRow && <LogDetail row={detailRow} />}
                </DialogContent>
            </Dialog>
        </div>
    );
};

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">
        {children}
    </th>
);

interface LogRowProps {
    row: AuditLogRow;
    variant: Variant;
    businessName: string | null;
    businessLogo: string | null;
    alt: boolean;
    onOpen: () => void;
}

const LogRow: React.FC<LogRowProps> = ({ row, variant, businessName, businessLogo, alt, onOpen }) => {
    const tone = ACTION_TONE[row.action] ?? ACTION_TONE.custom;
    const actionLabel = ACTION_LABEL[row.action] ?? row.action;
    const flag = flagFromCountryCode(row.geo?.country_code);
    const isSystem = row.actor_name === 'System' || (row.metadata as { system?: boolean } | null)?.system === true;
    return (
        <tr
            onClick={onOpen}
            className={cn(
                'border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer transition-colors',
                alt && 'bg-gray-50/30',
            )}
        >
            <td className="px-3 py-2 align-top">
                <div className="text-[11px] font-semibold text-brand-navy/80">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                </div>
                <div className="text-[10px] text-gray-400 tabular-nums">
                    {format(new Date(row.created_at), 'MMM d, HH:mm:ss')}
                </div>
            </td>
            <td className="px-3 py-2 align-top">
                <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-7 w-7 rounded-lg shrink-0">
                        <AvatarImage src={row.actor_avatar_url ?? undefined} />
                        <AvatarFallback className={cn(
                            'text-[10px] font-semibold',
                            isSystem ? 'bg-gray-100 text-gray-500' : 'bg-brand-navy/10 text-brand-navy',
                        )}>
                            {isSystem ? 'SYS' : (row.actor_name ?? row.actor_email ?? '?').charAt(0).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-brand-navy/80 truncate">
                            {row.actor_name ?? row.actor_email ?? 'Unknown'}
                        </div>
                        <div className="text-[10px] text-gray-400 truncate">
                            {isSystem
                                ? ((row.metadata as { origin?: string } | null)?.origin ?? 'automated')
                                : (row.actor_role ?? '—')}
                        </div>
                    </div>
                </div>
            </td>
            <td className="px-3 py-2 align-top">
                <Badge className={cn('rounded-full text-[9px] font-semibold border h-5 px-1.5', tone)}>
                    {actionLabel}
                </Badge>
            </td>
            <td className="px-3 py-2 align-top">
                {row.entity_table ? (
                    <div>
                        <div className="text-[11px] font-semibold text-brand-navy/80">
                            {row.entity_table}
                            {row.entity_id && <span className="text-gray-400"> #{row.entity_id.slice(0, 8)}</span>}
                        </div>
                        {row.entity_label && (
                            <div className="text-[10px] text-gray-400 truncate max-w-[200px]">
                                {row.entity_label}
                            </div>
                        )}
                        {row.changes?.before && row.changes?.after && (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                                {diffKeys(row.changes.before, row.changes.after).length} field{diffKeys(row.changes.before, row.changes.after).length === 1 ? '' : 's'} changed
                            </div>
                        )}
                    </div>
                ) : (
                    <span className="text-[11px] text-gray-300">—</span>
                )}
            </td>
            {variant === 'owner' && (
                <td className="px-3 py-2 align-top">
                    {businessName ? (
                        <div className="flex items-center gap-2 min-w-0">
                            <Avatar className="h-6 w-6 rounded-lg shrink-0">
                                <AvatarImage src={businessLogo ?? undefined} />
                                <AvatarFallback className="text-[9px] font-semibold bg-brand-navy/10 text-brand-navy">
                                    {businessName.charAt(0).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] font-semibold text-brand-navy/80 truncate max-w-[140px]">
                                {businessName}
                            </span>
                        </div>
                    ) : (
                        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Platform</span>
                    )}
                </td>
            )}
            <td className="px-3 py-2 align-top">
                <div className="text-[11px] font-medium text-brand-navy/80 flex items-center gap-1.5">
                    {flag && <span className="text-base leading-none">{flag}</span>}
                    <span className="truncate max-w-[160px]">{formatGeo(row)}</span>
                </div>
                {row.geo?.isp && (
                    <div className="text-[10px] text-gray-400 truncate max-w-[160px]">
                        {row.geo.isp}
                    </div>
                )}
            </td>
            <td className="px-3 py-2 align-top">
                <code className="text-[11px] font-mono text-brand-navy/60">
                    {row.ip ?? '—'}
                </code>
            </td>
            <td className="px-3 py-2 align-top text-right">
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 inline" />
            </td>
        </tr>
    );
};

const LogDetail: React.FC<{ row: AuditLogRow }> = ({ row }) => {
    const changed = diffKeys(row.changes?.before, row.changes?.after);
    return (
        <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4">
                <Stat label="Action">{ACTION_LABEL[row.action] ?? row.action}</Stat>
                <Stat label="Scope">{row.scope}</Stat>
                <Stat label="When">{format(new Date(row.created_at), 'PPpp')}</Stat>
                <Stat label="Session">{row.session_id ?? '—'}</Stat>
                <Stat label="Actor">{row.actor_name ?? row.actor_email ?? '—'} <span className="text-gray-400">({row.actor_role ?? 'n/a'})</span></Stat>
                <Stat label="Entity">{row.entity_table ? `${row.entity_table}${row.entity_id ? ' #' + row.entity_id : ''}` : '—'}</Stat>
                <Stat label="IP">{row.ip ?? '—'}</Stat>
                <Stat label="Location">{formatGeo(row)} {flagFromCountryCode(row.geo?.country_code)}</Stat>
                <Stat label="ISP">{row.geo?.isp ?? '—'}</Stat>
                <Stat label="Timezone">{row.geo?.timezone ?? '—'}</Stat>
            </div>

            {row.user_agent && (
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">User agent</div>
                    <code className="block text-[10px] font-mono text-brand-navy/70 bg-gray-50 rounded-lg p-3 break-all border border-gray-100">
                        {row.user_agent}
                    </code>
                </div>
            )}

            {row.metadata && Object.keys(row.metadata).length > 0 && (
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">Metadata</div>
                    <pre className="text-[10px] font-mono text-brand-navy/70 bg-gray-50 rounded-lg p-3 overflow-x-auto border border-gray-100">
                        {JSON.stringify(row.metadata, null, 2)}
                    </pre>
                </div>
            )}

            {row.changes && (
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">
                        Changes {changed.length ? `(${changed.length} fields)` : ''}
                    </div>
                    {changed.length > 0 && row.changes.before && row.changes.after ? (
                        <div className="rounded-xl border border-gray-100 overflow-hidden">
                            <table className="w-full text-[10px] font-mono">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-semibold text-gray-400">Field</th>
                                        <th className="text-left px-3 py-2 font-semibold text-gray-400">Before</th>
                                        <th className="text-left px-3 py-2 font-semibold text-gray-400">After</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {changed.map((k) => (
                                        <tr key={k} className="border-t border-gray-100">
                                            <td className="px-3 py-2 font-semibold text-brand-navy">{k}</td>
                                            <td className="px-3 py-2 text-red-500 break-all">
                                                {JSON.stringify((row.changes!.before as Record<string, unknown>)[k])}
                                            </td>
                                            <td className="px-3 py-2 text-emerald-600 break-all">
                                                {JSON.stringify((row.changes!.after as Record<string, unknown>)[k])}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <pre className="text-[10px] font-mono text-brand-navy/70 bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-64 border border-gray-100">
                            {JSON.stringify(row.changes, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
};

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">{label}</div>
        <div className="text-[11px] font-semibold text-brand-navy break-words">{children}</div>
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
                        'h-8 rounded-md text-[11px] font-semibold',
                        has && 'bg-brand-navy text-white border-brand-navy',
                    )}
                >
                    {label}{has ? ` · ${values.length}` : ''}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-2 rounded-xl border border-gray-100" align="start">
                <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {options.map((o) => {
                        const active = values.includes(o.value);
                        return (
                            <button
                                key={o.value}
                                onClick={() => onChange(active ? values.filter((v) => v !== o.value) : [...values, o.value])}
                                className={cn(
                                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors',
                                    active ? 'bg-brand-navy text-white' : 'text-brand-navy hover:bg-gray-50',
                                )}
                            >
                                <span className="truncate">{o.label}</span>
                                {active && <span className="text-[10px] opacity-60">✓</span>}
                            </button>
                        );
                    })}
                </div>
                {values.length > 0 && (
                    <Button
                        variant="ghost"
                        onClick={() => onChange([])}
                        className="w-full mt-2 h-7 text-[10px] font-semibold text-gray-400"
                    >
                        Clear
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default ActivityLogView;
