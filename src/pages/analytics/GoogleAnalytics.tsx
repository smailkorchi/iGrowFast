import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format, subDays, startOfDay } from 'date-fns';
import {
    Activity,
    BarChart3,
    Check,
    ChevronsUpDown,
    Copy,
    Eye,
    Globe2,
    LayoutGrid,
    Layers,
    Loader2,
    MoreVertical,
    MousePointerClick,
    Plus,
    Radio,
    Smartphone,
    Star,
    Trash2,
    TrendingUp,
    Users as UsersIcon,
    Clock,
    X,
    AlertCircle,
    Link2,
    ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    useGAConnections,
    useAddGAConnection,
    useDeleteGAConnection,
    useSetDefaultGAConnection,
    useServiceAccountEmail,
    useGAReports,
    useGARealtime,
    type GAConnection,
    type DateRange,
} from '@/hooks/useGoogleAnalytics';

// ── Date presets ─────────────────────────────────────────────────────
type PresetKey = '7d' | '28d' | '90d' | 'ytd';
const PRESETS: { key: PresetKey; label: string; days?: number }[] = [
    { key: '7d', label: 'Last 7 days', days: 7 },
    { key: '28d', label: 'Last 28 days', days: 28 },
    { key: '90d', label: 'Last 90 days', days: 90 },
    { key: 'ytd', label: 'Year to date' },
];

function presetToRange(key: PresetKey): DateRange {
    const today = startOfDay(new Date());
    const end = format(today, 'yyyy-MM-dd');
    if (key === 'ytd') {
        return { start: format(new Date(today.getFullYear(), 0, 1), 'yyyy-MM-dd'), end };
    }
    const p = PRESETS.find((x) => x.key === key)!;
    return { start: format(subDays(today, (p.days ?? 28) - 1), 'yyyy-MM-dd'), end };
}

// ── Formatters ──────────────────────────────────────────────────────
const nf = new Intl.NumberFormat('en-US');
const nfc = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const dur = (seconds: number) => {
    if (!seconds || !Number.isFinite(seconds)) return '0s';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m ? `${m}m ${s}s` : `${s}s`;
};
const parseGaDate = (s: string) => {
    if (!s || s.length !== 8) return s;
    return `${s.slice(4, 6)}/${s.slice(6, 8)}`;
};

// Single brand-navy channel base; ranks stepped down by opacity so the UI reads
// as one sorted list, not a rainbow. Matches the Analytics page palette.
const CHANNEL_SHADES = [
    '#3b5e5e', '#6b8784', '#8a9e9b', '#adbab8',
    '#c5cdcb', '#d1d5db', '#dde1df', '#e5e7eb',
    '#eaecec', '#eef0f0',
];

// ── Business resolution ─────────────────────────────────────────────
function useCurrentProfile() {
    return useQuery({
        queryKey: ['current-profile-ga'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await supabase
                .from('users')
                .select('id, role, "DigiCom Business", name')
                .eq('id', user.id)
                .single();
            return data;
        },
    });
}

function useBusinessesForOwner(enabled: boolean) {
    return useQuery({
        queryKey: ['ga-owner-businesses'],
        enabled,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('businesses')
                .select('id, name')
                .order('name');
            if (error) throw error;
            return data ?? [];
        },
    });
}

// ── Main Page ────────────────────────────────────────────────────────
const GoogleAnalyticsPage: React.FC = () => {
    const { toast } = useToast();
    const { data: profile, isLoading: profileLoading } = useCurrentProfile();

    const isOwner = profile?.role === 'owner';
    const { data: businesses } = useBusinessesForOwner(!!isOwner);

    const [ownerBusinessId, setOwnerBusinessId] = useState<string | null>(() => {
        return localStorage.getItem('ga_owner_business_id');
    });

    const businessId = useMemo(() => {
        if (isOwner) return ownerBusinessId;
        return (profile as { 'DigiCom Business'?: string } | null)?.['DigiCom Business'] ?? null;
    }, [isOwner, ownerBusinessId, profile]);

    useEffect(() => {
        if (ownerBusinessId) localStorage.setItem('ga_owner_business_id', ownerBusinessId);
    }, [ownerBusinessId]);

    const { data: allConnections, isLoading: connectionsLoading } = useGAConnections();
    const connections = useMemo(() => {
        if (!allConnections) return [];
        if (!businessId) return [];
        return allConnections.filter((c) => c['DigiCom Business'] === businessId);
    }, [allConnections, businessId]);

    const [activePropertyId, setActivePropertyId] = useState<string | null>(() => {
        return localStorage.getItem('ga_active_property');
    });

    const activeConnection = useMemo(() => {
        if (!connections.length) return null;
        const byId = connections.find((c) => c.property_id === activePropertyId);
        return byId ?? connections.find((c) => c.is_default) ?? connections[0];
    }, [connections, activePropertyId]);

    useEffect(() => {
        if (activeConnection) {
            localStorage.setItem('ga_active_property', activeConnection.property_id);
            setActivePropertyId(activeConnection.property_id);
        }
    }, [activeConnection?.property_id]);

    const [preset, setPreset] = useState<PresetKey>('28d');
    const range = useMemo(() => presetToRange(preset), [preset]);

    const [isAddOpen, setAddOpen] = useState(false);

    const reports = useGAReports(activeConnection?.property_id ?? null, range);
    const realtime = useGARealtime(activeConnection?.property_id ?? null);

    // Early states
    if (profileLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-brand-navy" />
            </div>
        );
    }

    if (isOwner && !businessId) {
        return (
            <div className="mx-auto max-w-[640px] px-3 md:px-5 py-6">
                <EmptyBusinessPicker
                    businesses={businesses ?? []}
                    onSelect={setOwnerBusinessId}
                />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header — matches /analytics compact style */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            Google Analytics
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            Live GA4 traffic, engagement & conversions
                        </p>
                    </div>
                    {isOwner && businesses && (
                        <BusinessSwitcher
                            businesses={businesses}
                            value={ownerBusinessId}
                            onChange={setOwnerBusinessId}
                        />
                    )}
                </div>
            </header>

            {/* Connections row */}
            {connectionsLoading ? (
                <Skeleton className="h-12 w-full rounded-xl" />
            ) : connections.length === 0 ? (
                <OnboardingCard onAdd={() => setAddOpen(true)} />
            ) : (
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
                    <PropertySwitcher
                        connections={connections}
                        active={activeConnection}
                        onChange={(c) => setActivePropertyId(c.property_id)}
                        businessId={businessId!}
                        onAdd={() => setAddOpen(true)}
                    />
                    <DateRangeBar value={preset} onChange={setPreset} range={range} />
                    <RealtimePill total={realtime.data?.total ?? 0} isLoading={realtime.isLoading} />
                </div>
            )}

            {/* Dashboard */}
            {connections.length > 0 && activeConnection && (
                <Dashboard
                    reports={reports}
                    realtime={realtime.data}
                />
            )}

            {/* Add connection dialog */}
            <AddConnectionDialog
                open={isAddOpen}
                onOpenChange={setAddOpen}
                businessId={businessId!}
                onAdded={(c) => {
                    setActivePropertyId(c.property_id);
                    toast({ title: 'Property connected', description: c.display_name });
                }}
            />
        </div>
    );
};

export default GoogleAnalyticsPage;

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

const BusinessSwitcher: React.FC<{
    businesses: { id: string; name: string }[];
    value: string | null;
    onChange: (id: string) => void;
}> = ({ businesses, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const current = businesses.find((b) => b.id === value);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md border-gray-200 bg-white text-[11px] font-semibold text-brand-navy min-w-[180px] justify-between px-2.5"
                >
                    <span className="truncate">{current?.name ?? 'Select business'}</span>
                    <ChevronsUpDown className="w-3 h-3 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[240px] p-1">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => {
                            onChange(b.id);
                            setOpen(false);
                        }}
                        className={cn(
                            'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-left hover:bg-gray-100 transition',
                            value === b.id && 'bg-gray-100'
                        )}
                    >
                        <span className="truncate">{b.name}</span>
                        {value === b.id && <Check className="w-3 h-3 text-brand-navy" />}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
};

const EmptyBusinessPicker: React.FC<{
    businesses: { id: string; name: string }[];
    onSelect: (id: string) => void;
}> = ({ businesses, onSelect }) => (
    <Card className="border border-gray-100 shadow-none rounded-xl">
        <CardContent className="p-5 text-center">
            <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-brand-navy/[0.04] mb-2.5">
                <BarChart3 className="w-4 h-4 text-brand-navy" />
            </div>
            <h2 className="text-[14px] font-semibold text-brand-navy">Choose a business</h2>
            <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
                Pick a business to view its Google Analytics.
            </p>
            <div className="max-w-sm mx-auto space-y-1">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => onSelect(b.id)}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition text-left text-[11px] font-semibold text-brand-navy"
                    >
                        {b.name}
                    </button>
                ))}
            </div>
        </CardContent>
    </Card>
);

const PropertySwitcher: React.FC<{
    connections: GAConnection[];
    active: GAConnection | null;
    onChange: (c: GAConnection) => void;
    businessId: string;
    onAdd: () => void;
}> = ({ connections, active, onChange, businessId, onAdd }) => {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();
    const setDefault = useSetDefaultGAConnection();
    const deleteConn = useDeleteGAConnection();

    return (
        <div className="flex items-center gap-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-white border border-gray-200 hover:border-gray-300 transition min-w-[220px]">
                        <Layers className="w-3 h-3 text-gray-400 shrink-0" />
                        <div className="flex-1 text-left min-w-0">
                            <div className="text-[9px] text-gray-400 font-bold uppercase tracking-[0.14em] leading-none">
                                Property
                            </div>
                            <div className="text-[11px] font-semibold text-brand-navy truncate leading-tight">
                                {active?.display_name ?? '—'}
                            </div>
                        </div>
                        <ChevronsUpDown className="w-3 h-3 text-gray-400 shrink-0" />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[320px] p-1">
                    <div className="px-2.5 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">
                        Connected properties
                    </div>
                    {connections.map((c) => (
                        <div
                            key={c.id}
                            className={cn(
                                'group flex items-center gap-1 px-1.5 py-1.5 rounded-md hover:bg-gray-50',
                                active?.id === c.id && 'bg-gray-50'
                            )}
                        >
                            <button
                                onClick={() => {
                                    onChange(c);
                                    setOpen(false);
                                }}
                                className="flex-1 flex items-center gap-2 text-left min-w-0"
                            >
                                <Globe2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                        <span className="text-[11px] font-semibold text-brand-navy truncate">
                                            {c.display_name}
                                        </span>
                                        {c.is_default && (
                                            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" />
                                        )}
                                    </div>
                                    <div className="text-[10px] text-gray-400 font-mono">
                                        {c.property_id}
                                    </div>
                                </div>
                                {active?.id === c.id && (
                                    <Check className="w-3 h-3 text-brand-navy shrink-0" />
                                )}
                            </button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white opacity-0 group-hover:opacity-100 transition">
                                        <MoreVertical className="w-3 h-3 text-gray-500" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuItem
                                        disabled={c.is_default}
                                        onClick={async () => {
                                            await setDefault.mutateAsync({
                                                id: c.id,
                                                business_id: businessId,
                                            });
                                            toast({ title: 'Default set', description: c.display_name });
                                        }}
                                    >
                                        <Star className="w-3.5 h-3.5 mr-2" />
                                        Make default
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-red-600"
                                        onClick={async () => {
                                            await deleteConn.mutateAsync(c.id);
                                            toast({ title: 'Property removed' });
                                        }}
                                    >
                                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                                        Remove
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ))}
                    <div className="border-t border-gray-100 mt-1 pt-1">
                        <button
                            onClick={() => {
                                setOpen(false);
                                onAdd();
                            }}
                            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-brand-navy hover:bg-gray-50"
                        >
                            <Plus className="w-3 h-3" />
                            Connect another property
                        </button>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
};

const DateRangeBar: React.FC<{
    value: PresetKey;
    onChange: (k: PresetKey) => void;
    range: DateRange;
}> = ({ value, onChange, range }) => (
    <div className="flex items-center gap-0.5 h-8 px-0.5 rounded-md bg-white border border-gray-200">
        {PRESETS.map((p) => (
            <button
                key={p.key}
                onClick={() => onChange(p.key)}
                className={cn(
                    'h-7 px-2.5 rounded-md text-[10px] font-semibold transition whitespace-nowrap',
                    value === p.key
                        ? 'bg-brand-navy text-white'
                        : 'text-gray-500 hover:bg-gray-100'
                )}
            >
                {p.label}
            </button>
        ))}
        <div className="hidden lg:flex items-center px-2 text-[9px] font-mono text-gray-400 border-l border-gray-100 ml-0.5">
            {range.start} → {range.end}
        </div>
    </div>
);

const RealtimePill: React.FC<{ total: number; isLoading: boolean }> = ({
    total,
    isLoading,
}) => (
    <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-emerald-50 border border-emerald-100">
        <div className="relative">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
        </div>
        <div className="flex items-baseline gap-1.5 leading-none">
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                Live
            </span>
            <span className="text-[11px] font-semibold text-emerald-900 tabular-nums">
                {isLoading ? '—' : `${nf.format(total)} active`}
            </span>
        </div>
    </div>
);

// ── Dashboard ────────────────────────────────────────────────────────
const Dashboard: React.FC<{
    reports: ReturnType<typeof useGAReports>;
    realtime?: { total: number; byCountry: Array<Record<string, string | number>> };
}> = ({ reports, realtime }) => {
    const { data, isLoading, error } = reports;

    if (error) {
        return (
            <Card className="rounded-xl border-red-200 bg-red-50 shadow-none">
                <CardContent className="p-3.5 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                    <div>
                        <div className="text-[12px] font-semibold text-red-900">Cannot load data</div>
                        <div className="text-[11px] text-red-700 mt-0.5">
                            {(error as Error).message}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (isLoading || !data) {
        return (
            <div className="space-y-2.5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
                <Skeleton className="h-48 rounded-xl" />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                    <Skeleton className="h-48 rounded-xl lg:col-span-2" />
                    <Skeleton className="h-48 rounded-xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2.5">
            {/* KPI strip — matches DashboardKPICards pattern: left accent stripe + tabular number. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Kpi
                    label="Active users"
                    value={nf.format(data.totals.activeUsers ?? 0)}
                    sublabel={`${nf.format(data.totals.newUsers ?? 0)} new`}
                    icon={UsersIcon}
                    accent="#3b5e5e"
                />
                <Kpi
                    label="Sessions"
                    value={nf.format(data.totals.sessions ?? 0)}
                    sublabel={`${nfc.format(data.totals.screenPageViews ?? 0)} views`}
                    icon={Activity}
                    accent="#3b5e5e"
                />
                <Kpi
                    label="Engagement rate"
                    value={pct(data.totals.engagementRate ?? 0)}
                    sublabel={`${pct(1 - (data.totals.bounceRate ?? 0))} non-bounce`}
                    icon={TrendingUp}
                    accent="#059669"
                    rate={(data.totals.engagementRate ?? 0) * 100}
                />
                <Kpi
                    label="Avg. session"
                    value={dur(data.totals.averageSessionDuration ?? 0)}
                    sublabel={`${nfc.format(data.totals.eventCount ?? 0)} events`}
                    icon={Clock}
                    accent="#d97706"
                />
            </div>

            {/* Trend */}
            <Card className="border border-gray-100 shadow-none rounded-xl">
                <CardContent className="p-3.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <div>
                            <h3 className="text-[12px] font-semibold text-brand-navy">Traffic trend</h3>
                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.14em] mt-0.5">
                                Daily users · sessions · page views
                            </p>
                        </div>
                        <div className="flex items-center gap-2.5 text-[10px] text-gray-500">
                            <LegendDot color="#3b5e5e" label="Users" />
                            <LegendDot color="#059669" label="Sessions" />
                            <LegendDot color="#d97706" label="Views" />
                        </div>
                    </div>
                    <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.trend} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="ga-users" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b5e5e" stopOpacity={0.22} />
                                        <stop offset="100%" stopColor="#3b5e5e" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="ga-sessions" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#059669" stopOpacity={0.18} />
                                        <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(v) => parseGaDate(String(v))}
                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={36}
                                    tickFormatter={(v) => nfc.format(Number(v))}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: 10,
                                        border: '1px solid #f3f4f6',
                                        boxShadow: 'none',
                                        fontSize: 11,
                                    }}
                                    labelFormatter={(v) => parseGaDate(String(v))}
                                    formatter={(v: number, name: string) => [nf.format(v), name]}
                                />
                                <Area type="monotone" dataKey="activeUsers" name="Users" stroke="#3b5e5e" strokeWidth={1.75} fill="url(#ga-users)" dot={false} />
                                <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#059669" strokeWidth={1.5} fill="url(#ga-sessions)" dot={false} />
                                <Area type="monotone" dataKey="screenPageViews" name="Views" stroke="#d97706" strokeWidth={1.25} strokeDasharray="4 3" fill="transparent" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Row 1: acquisition + devices */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                <Card className="border border-gray-100 shadow-none rounded-xl lg:col-span-2">
                    <CardContent className="p-3.5">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h3 className="text-[12px] font-semibold text-brand-navy">Acquisition</h3>
                                <p className="text-[9px] text-gray-400 uppercase tracking-[0.14em] mt-0.5">
                                    Sessions by channel
                                </p>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            {data.channels.length === 0 && (
                                <p className="text-[11px] text-gray-400 text-center py-4">No channel data yet</p>
                            )}
                            {data.channels.map((c, i) => {
                                const total = data.channels.reduce((s, r) => s + (Number(r.sessions) || 0), 0);
                                const value = Number(c.sessions) || 0;
                                const share = total ? (value / total) * 100 : 0;
                                const max = data.channels.reduce((m, r) => Math.max(m, Number(r.sessions) || 0), 0) || 1;
                                const width = (value / max) * 100;
                                return (
                                    <div key={String(c.sessionDefaultChannelGroup) + i}>
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span
                                                className="w-[3px] h-3 rounded-full shrink-0"
                                                style={{ backgroundColor: CHANNEL_SHADES[i % CHANNEL_SHADES.length] }}
                                            />
                                            <span className="text-[11px] text-brand-navy/80 flex-1 truncate capitalize">
                                                {String(c.sessionDefaultChannelGroup || 'Unassigned')}
                                            </span>
                                            <span className="text-[11px] font-semibold text-brand-navy tabular-nums">
                                                {nfc.format(value)}
                                            </span>
                                            <span className="text-[10px] text-gray-400 tabular-nums w-10 text-right">
                                                {share.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="ml-[11px] h-1 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{ width: `${width}%`, backgroundColor: CHANNEL_SHADES[i % CHANNEL_SHADES.length] }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-gray-100 shadow-none rounded-xl">
                    <CardContent className="p-3.5">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h3 className="text-[12px] font-semibold text-brand-navy">Devices</h3>
                                <p className="text-[9px] text-gray-400 uppercase tracking-[0.14em] mt-0.5">
                                    Sessions by device
                                </p>
                            </div>
                            <Smartphone className="w-3 h-3 text-gray-300" />
                        </div>
                        <div className="h-40">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.devices} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
                                    <XAxis
                                        dataKey="deviceCategory"
                                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={32}
                                        tickFormatter={(v) => nfc.format(Number(v))}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: 10,
                                            border: '1px solid #f3f4f6',
                                            boxShadow: 'none',
                                            fontSize: 11,
                                        }}
                                        formatter={(v: number) => nf.format(v)}
                                    />
                                    <Bar dataKey="sessions" fill="#3b5e5e" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Row 2: top pages + countries */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                <RankList
                    title="Top pages"
                    subtitle="Most viewed"
                    icon={Eye}
                    rows={data.pages.map((r) => ({
                        label: String(r.pageTitle || r.pagePath || '—'),
                        sub: String(r.pagePath || ''),
                        value: Number(r.screenPageViews) || 0,
                        extra: dur(Number(r.averageSessionDuration) || 0),
                    }))}
                    valueFormatter={(v) => nf.format(v)}
                />
                <RankList
                    title="Geography"
                    subtitle="Users by country"
                    icon={Globe2}
                    rows={data.countries.map((r) => ({
                        label: String(r.country || 'Unknown'),
                        value: Number(r.activeUsers) || 0,
                        extra: `${nfc.format(Number(r.sessions) || 0)} sessions`,
                    }))}
                    valueFormatter={(v) => nf.format(v)}
                />
            </div>

            {/* Row 3: events + browsers + realtime countries */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                <RankList
                    title="Top events"
                    subtitle="Most triggered"
                    icon={MousePointerClick}
                    rows={data.events.map((r) => ({
                        label: String(r.eventName || '—'),
                        value: Number(r.eventCount) || 0,
                    }))}
                    valueFormatter={(v) => nfc.format(v)}
                />
                <RankList
                    title="Browsers"
                    subtitle="Sessions by browser"
                    icon={LayoutGrid}
                    rows={data.browsers.map((r) => ({
                        label: String(r.browser || '—'),
                        value: Number(r.sessions) || 0,
                    }))}
                    valueFormatter={(v) => nfc.format(v)}
                />
                <RankList
                    title="Live right now"
                    subtitle="Active users by country"
                    icon={Radio}
                    accent="emerald"
                    rows={(realtime?.byCountry ?? []).map((r) => ({
                        label: String(r.country || 'Unknown'),
                        value: Number(r.activeUsers) || 0,
                    }))}
                    valueFormatter={(v) => nf.format(v)}
                />
            </div>
        </div>
    );
};

// ── Shared widgets ───────────────────────────────────────────────────
// KPI card — left accent stripe + dense tabular number. Matches DashboardKPICards
// and uses the locked 5-tone palette (navy / emerald / red / amber / gray).
const Kpi: React.FC<{
    label: string;
    value: string;
    sublabel?: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    rate?: number;
}> = ({ label, value, sublabel, icon: Icon, accent, rate }) => (
    <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
        <CardContent className="p-2.5 relative">
            <span
                className="absolute top-2.5 left-0 w-[3px] h-8 rounded-r-full"
                style={{ backgroundColor: accent }}
                aria-hidden
            />
            <div className="pl-2">
                <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 text-gray-400 shrink-0" />
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400 truncate">
                        {label}
                    </span>
                </div>
                <div className="text-[18px] font-semibold text-brand-navy tabular-nums leading-tight mt-0.5">
                    {value}
                </div>
                {sublabel && (
                    <div className="text-[10px] font-medium text-gray-400 tabular-nums">{sublabel}</div>
                )}
                {rate !== undefined && (
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-1.5">
                        <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(0, Math.min(100, rate))}%`, backgroundColor: accent }}
                        />
                    </div>
                )}
            </div>
        </CardContent>
    </Card>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        {label}
    </span>
);

const RankList: React.FC<{
    title: string;
    subtitle?: string;
    icon: React.ComponentType<{ className?: string }>;
    rows: { label: string; sub?: string; value: number; extra?: string }[];
    valueFormatter: (v: number) => string;
    accent?: 'default' | 'emerald';
}> = ({ title, subtitle, icon: Icon, rows, valueFormatter, accent = 'default' }) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const barColor = accent === 'emerald' ? 'bg-emerald-500' : 'bg-brand-navy/70';
    return (
        <Card className="border border-gray-100 shadow-none rounded-xl">
            <CardContent className="p-3.5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-[12px] font-semibold text-brand-navy">{title}</h3>
                        {subtitle && (
                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.14em] mt-0.5">
                                {subtitle}
                            </p>
                        )}
                    </div>
                    <Icon className="w-3 h-3 text-gray-300" />
                </div>
                <div className="space-y-1.5">
                    {rows.length === 0 ? (
                        <div className="text-[11px] text-gray-400 py-4 text-center">
                            No data for this range
                        </div>
                    ) : (
                        rows.slice(0, 8).map((r, i) => {
                            const pctWidth = (r.value / max) * 100;
                            return (
                                <div key={i}>
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-medium text-brand-navy truncate">
                                                {r.label}
                                            </div>
                                            {r.sub && (
                                                <div className="text-[9px] font-mono text-gray-400 truncate">
                                                    {r.sub}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-[11px] font-semibold text-brand-navy tabular-nums">
                                                {valueFormatter(r.value)}
                                            </div>
                                            {r.extra && (
                                                <div className="text-[9px] text-gray-400 tabular-nums">
                                                    {r.extra}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                                        <div
                                            className={cn('h-full rounded-full transition-all duration-500', barColor)}
                                            style={{ width: `${pctWidth}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

// ── Onboarding ───────────────────────────────────────────────────────
const OnboardingCard: React.FC<{ onAdd: () => void }> = ({ onAdd }) => {
    const { data: sa, isLoading, error, refetch } = useServiceAccountEmail();
    const { toast } = useToast();
    return (
        <Card className="border border-gray-100 shadow-none rounded-xl">
            <CardContent className="p-3.5">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5">
                    <div className="md:col-span-2 p-3 rounded-xl bg-brand-navy/[0.03] border border-brand-navy/10">
                        <div className="flex items-center gap-1.5">
                            <BarChart3 className="w-3.5 h-3.5 text-brand-navy" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">
                                Connect
                            </span>
                        </div>
                        <h2 className="text-[14px] font-semibold text-brand-navy tracking-tight mt-1">
                            Google Analytics
                        </h2>
                        <p className="text-[11px] text-gray-500 leading-snug mt-1">
                            Grant read access to our service account and paste your GA4 Property ID.
                            No OAuth, no popups. Works for multiple properties.
                        </p>
                    </div>
                    <div className="md:col-span-3 space-y-3">
                        <Step
                            num={1}
                            title="Open GA4 property access"
                            body="In Google Analytics, go to Admin → Property access management → Add users."
                        />
                        <Step
                            num={2}
                            title="Add our service account as Viewer"
                            body={
                                <div className="space-y-1 mt-1">
                                    <div className="flex items-center gap-1.5">
                                        <code className="flex-1 px-2 py-1 rounded-md bg-gray-100 text-[10px] font-mono text-brand-navy truncate">
                                            {isLoading
                                                ? 'Loading…'
                                                : error
                                                    ? 'Failed to load email'
                                                    : sa?.email ?? '—'}
                                        </code>
                                        {error ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="rounded-md h-7 px-2 text-[10px]"
                                                onClick={() => refetch()}
                                            >
                                                Retry
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="rounded-md h-7 px-2"
                                                disabled={!sa?.email}
                                                onClick={() => {
                                                    navigator.clipboard.writeText(sa?.email ?? '');
                                                    toast({ title: 'Copied', description: sa?.email });
                                                }}
                                            >
                                                <Copy className="w-3 h-3" />
                                            </Button>
                                        )}
                                    </div>
                                    {error && (
                                        <div className="text-[10px] text-red-600">
                                            {(error as Error).message}
                                        </div>
                                    )}
                                </div>
                            }
                        />
                        <Step
                            num={3}
                            title="Paste your GA4 Property ID"
                            body="Find it in Admin → Property Settings. Usually a 9–10 digit number."
                        />
                        <Button
                            onClick={onAdd}
                            size="sm"
                            className="w-full h-8 rounded-md bg-brand-navy hover:bg-brand-navy/90 text-white text-[11px] font-semibold"
                        >
                            <Plus className="w-3 h-3 mr-1.5" />
                            Connect a property
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const Step: React.FC<{ num: number; title: string; body: React.ReactNode }> = ({
    num,
    title,
    body,
}) => (
    <div className="flex gap-2">
        <div className="w-5 h-5 rounded-full bg-brand-navy text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
            {num}
        </div>
        <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-brand-navy">{title}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">{body}</div>
        </div>
    </div>
);

// ── Add Connection Dialog ────────────────────────────────────────────
const AddConnectionDialog: React.FC<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    businessId: string;
    onAdded: (c: GAConnection) => void;
}> = ({ open, onOpenChange, businessId, onAdded }) => {
    const { data: sa } = useServiceAccountEmail();
    const { data: connections } = useGAConnections();
    const { toast } = useToast();
    const add = useAddGAConnection();

    const [propertyId, setPropertyId] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [makeDefault, setMakeDefault] = useState(
        !connections || connections.filter((c) => c['DigiCom Business'] === businessId).length === 0
    );

    useEffect(() => {
        if (!open) {
            setPropertyId('');
            setDisplayName('');
            setWebsiteUrl('');
        }
    }, [open]);

    useEffect(() => {
        const empty = !connections || connections.filter((c) => c['DigiCom Business'] === businessId).length === 0;
        setMakeDefault(empty);
    }, [connections, businessId, open]);

    const submit = async () => {
        try {
            const created = await add.mutateAsync({
                property_id: propertyId,
                display_name: displayName,
                website_url: websiteUrl,
                business_id: businessId,
                make_default: makeDefault,
            });
            onAdded(created);
            onOpenChange(false);
        } catch (e) {
            toast({
                title: 'Could not connect property',
                description: (e as Error).message,
                variant: 'destructive',
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="rounded-3xl max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-xl font-black text-brand-navy">
                        Connect a GA4 property
                    </DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Make sure the service account has Viewer access first.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-brand-navy mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                Grant access to
                            </div>
                            <div className="text-xs font-mono text-brand-navy truncate">
                                {sa?.email ?? 'Loading…'}
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(sa?.email ?? '');
                                toast({ title: 'Copied' });
                            }}
                            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center"
                        >
                            <Copy className="w-3.5 h-3.5 text-slate-600" />
                        </button>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-black uppercase tracking-wider text-slate-600">
                            GA4 Property ID
                        </Label>
                        <Input
                            placeholder="123456789"
                            value={propertyId}
                            onChange={(e) => setPropertyId(e.target.value)}
                            className="h-11 rounded-xl font-mono"
                        />
                        <p className="text-[11px] text-slate-400">
                            Numeric ID only (not the G-XXXX measurement ID).
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-black uppercase tracking-wider text-slate-600">
                            Display name
                        </Label>
                        <Input
                            placeholder="Main website"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="h-11 rounded-xl"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-black uppercase tracking-wider text-slate-600">
                            Website URL <span className="text-slate-400 font-medium normal-case">(optional)</span>
                        </Label>
                        <div className="relative">
                            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="https://example.com"
                                value={websiteUrl}
                                onChange={(e) => setWebsiteUrl(e.target.value)}
                                className="h-11 rounded-xl pl-9"
                            />
                        </div>
                    </div>

                    <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                        <input
                            type="checkbox"
                            checked={makeDefault}
                            onChange={(e) => setMakeDefault(e.target.checked)}
                            className="w-4 h-4 rounded accent-brand-navy"
                        />
                        <span className="text-sm font-bold text-brand-navy">
                            Make this the default property
                        </span>
                    </label>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={add.isPending || !propertyId.trim() || !displayName.trim()}
                        className="rounded-xl bg-brand-navy hover:bg-slate-800 text-white font-bold"
                    >
                        {add.isPending ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Verifying…
                            </>
                        ) : (
                            <>
                                <Plus className="w-4 h-4 mr-2" />
                                Connect
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
