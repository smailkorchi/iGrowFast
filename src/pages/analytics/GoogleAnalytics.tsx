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

const CHANNEL_COLORS = [
    '#0f172a', '#0ea5e9', '#8b5cf6', '#10b981',
    '#f59e0b', '#ef4444', '#06b6d4', '#e879f9',
    '#64748b', '#f97316',
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
            <div className="max-w-3xl mx-auto py-12">
                <EmptyBusinessPicker
                    businesses={businesses ?? []}
                    onSelect={setOwnerBusinessId}
                />
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <div className="space-y-6">
                {/* Header — matches existing page style */}
                <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                    <div className="relative p-8">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div>
                                <h1 className="text-4xl font-extralight text-gray-900 mb-2">
                                    Google Analytics
                                </h1>
                                <p className="text-gray-500 font-light">
                                    Live traffic, engagement & conversions from your GA4 properties
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
                    </div>
                </div>

                {/* Connections row */}
                {connectionsLoading ? (
                    <Skeleton className="h-20 w-full rounded-2xl" />
                ) : connections.length === 0 ? (
                    <OnboardingCard onAdd={() => setAddOpen(true)} />
                ) : (
                    <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
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
            </div>

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
                    className="h-10 rounded-xl border-slate-200 bg-white font-semibold text-brand-navy min-w-[220px] justify-between"
                >
                    <span className="truncate">{current?.name ?? 'Select business'}</span>
                    <ChevronsUpDown className="w-4 h-4 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[280px] p-1">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => {
                            onChange(b.id);
                            setOpen(false);
                        }}
                        className={cn(
                            'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold text-left hover:bg-slate-100 transition',
                            value === b.id && 'bg-slate-100'
                        )}
                    >
                        <span className="truncate">{b.name}</span>
                        {value === b.id && <Check className="w-4 h-4 text-brand-navy" />}
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
    <Card className="rounded-3xl border-slate-200 shadow-none">
        <CardContent className="p-8 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-navy flex items-center justify-center mb-4">
                <BarChart3 className="w-7 h-7 text-brand-white" />
            </div>
            <h2 className="text-xl font-black text-brand-navy mb-1">Choose a business</h2>
            <p className="text-sm text-slate-500 mb-6">
                Pick a business to view its Google Analytics.
            </p>
            <div className="max-w-md mx-auto space-y-1">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => onSelect(b.id)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition text-left font-semibold text-brand-navy"
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
                    <button className="group flex items-center gap-3 h-12 px-4 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition shadow-sm min-w-[280px]">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-navy to-slate-700 flex items-center justify-center shrink-0">
                            <Layers className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                            <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                                Property
                            </div>
                            <div className="text-sm font-black text-brand-navy truncate">
                                {active?.display_name ?? '—'}
                            </div>
                        </div>
                        <ChevronsUpDown className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[360px] p-1">
                    <div className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
                        Connected properties
                    </div>
                    {connections.map((c) => (
                        <div
                            key={c.id}
                            className={cn(
                                'group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100',
                                active?.id === c.id && 'bg-slate-100'
                            )}
                        >
                            <button
                                onClick={() => {
                                    onChange(c);
                                    setOpen(false);
                                }}
                                className="flex-1 flex items-center gap-3 text-left min-w-0"
                            >
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center shrink-0">
                                    <Globe2 className="w-4 h-4 text-slate-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-sm font-bold text-brand-navy truncate">
                                            {c.display_name}
                                        </span>
                                        {c.is_default && (
                                            <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                                        )}
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-mono">
                                        {c.property_id}
                                    </div>
                                </div>
                                {active?.id === c.id && (
                                    <Check className="w-4 h-4 text-brand-navy shrink-0" />
                                )}
                            </button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white opacity-0 group-hover:opacity-100 transition">
                                        <MoreVertical className="w-4 h-4 text-slate-500" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
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
                                        <Star className="w-4 h-4 mr-2" />
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
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Remove
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ))}
                    <div className="border-t border-slate-100 mt-1 pt-1">
                        <button
                            onClick={() => {
                                setOpen(false);
                                onAdd();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-brand-navy hover:bg-slate-100"
                        >
                            <Plus className="w-4 h-4" />
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
    <div className="flex items-center gap-1 h-12 px-1 rounded-2xl bg-white border border-slate-200 shadow-sm">
        {PRESETS.map((p) => (
            <button
                key={p.key}
                onClick={() => onChange(p.key)}
                className={cn(
                    'h-10 px-4 rounded-xl text-xs font-bold transition',
                    value === p.key
                        ? 'bg-brand-navy text-white'
                        : 'text-slate-500 hover:bg-slate-100'
                )}
            >
                {p.label}
            </button>
        ))}
        <div className="hidden lg:flex items-center px-3 text-[10px] font-mono text-slate-400 border-l border-slate-100 ml-1">
            {range.start} → {range.end}
        </div>
    </div>
);

const RealtimePill: React.FC<{ total: number; isLoading: boolean }> = ({
    total,
    isLoading,
}) => (
    <div className="flex items-center gap-2 h-12 px-4 rounded-2xl bg-emerald-50 border border-emerald-100 shadow-sm">
        <div className="relative">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
        </div>
        <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700">
                Live
            </span>
            <span className="text-sm font-black text-emerald-900">
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
            <Card className="rounded-2xl border-red-200 bg-red-50 shadow-none">
                <CardContent className="p-6 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                        <div className="font-black text-red-900">Cannot load data</div>
                        <div className="text-sm text-red-700 mt-1">
                            {(error as Error).message}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (isLoading || !data) {
        return (
            <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 rounded-2xl" />
                    ))}
                </div>
                <Skeleton className="h-80 rounded-3xl" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Skeleton className="h-80 rounded-3xl" />
                    <Skeleton className="h-80 rounded-3xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* KPI grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi
                    label="Active users"
                    value={nf.format(data.totals.activeUsers ?? 0)}
                    sublabel={`${nf.format(data.totals.newUsers ?? 0)} new`}
                    icon={UsersIcon}
                    tone="navy"
                />
                <Kpi
                    label="Sessions"
                    value={nf.format(data.totals.sessions ?? 0)}
                    sublabel={`${nfc.format(data.totals.screenPageViews ?? 0)} views`}
                    icon={Activity}
                    tone="sky"
                />
                <Kpi
                    label="Engagement rate"
                    value={pct(data.totals.engagementRate ?? 0)}
                    sublabel={`${pct(1 - (data.totals.bounceRate ?? 0))} non-bounce`}
                    icon={TrendingUp}
                    tone="emerald"
                />
                <Kpi
                    label="Avg. session"
                    value={dur(data.totals.averageSessionDuration ?? 0)}
                    sublabel={`${nfc.format(data.totals.eventCount ?? 0)} events`}
                    icon={Clock}
                    tone="violet"
                />
            </div>

            {/* Trend */}
            <Card className="rounded-3xl border-slate-200 shadow-none overflow-hidden">
                <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-5">
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-wider text-brand-navy">
                                Traffic trend
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Daily users, sessions, page views
                            </p>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] font-bold">
                            <LegendDot color="#0f172a" label="Users" />
                            <LegendDot color="#0ea5e9" label="Sessions" />
                            <LegendDot color="#8b5cf6" label="Views" />
                        </div>
                    </div>
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.trend}>
                                <defs>
                                    <linearGradient id="ga-users" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#0f172a" stopOpacity={0.25} />
                                        <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="ga-sessions" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.2} />
                                        <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(v) => parseGaDate(String(v))}
                                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(v) => nfc.format(Number(v))}
                                />
                                <Tooltip
                                    contentStyle={{
                                        border: 'none',
                                        borderRadius: 12,
                                        boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                        fontSize: 12,
                                    }}
                                    labelFormatter={(v) => parseGaDate(String(v))}
                                    formatter={(v: number, name: string) => [nf.format(v), name]}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="activeUsers"
                                    name="Users"
                                    stroke="#0f172a"
                                    strokeWidth={2.5}
                                    fill="url(#ga-users)"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="sessions"
                                    name="Sessions"
                                    stroke="#0ea5e9"
                                    strokeWidth={2}
                                    fill="url(#ga-sessions)"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="screenPageViews"
                                    name="Views"
                                    stroke="#8b5cf6"
                                    strokeWidth={1.5}
                                    fill="transparent"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Row 1: channels + devices */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="rounded-3xl border-slate-200 shadow-none lg:col-span-2">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-brand-navy">
                                    Acquisition
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Sessions by channel
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                            <div className="h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={data.channels}
                                            dataKey="sessions"
                                            nameKey="sessionDefaultChannelGroup"
                                            innerRadius={50}
                                            outerRadius={85}
                                            paddingAngle={2}
                                            stroke="#fff"
                                            strokeWidth={2}
                                        >
                                            {data.channels.map((_, i) => (
                                                <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                border: 'none',
                                                borderRadius: 12,
                                                boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                                fontSize: 12,
                                            }}
                                            formatter={(v: number) => nf.format(v)}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="space-y-1.5 max-h-52 overflow-y-auto no-scrollbar">
                                {data.channels.map((c, i) => {
                                    const total = data.channels.reduce(
                                        (s, r) => s + (Number(r.sessions) || 0),
                                        0
                                    );
                                    const share = total ? (Number(c.sessions) / total) * 100 : 0;
                                    return (
                                        <div
                                            key={String(c.sessionDefaultChannelGroup)}
                                            className="flex items-center gap-2"
                                        >
                                            <div
                                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                                style={{
                                                    background:
                                                        CHANNEL_COLORS[i % CHANNEL_COLORS.length],
                                                }}
                                            />
                                            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                                <span className="text-xs font-bold text-brand-navy truncate">
                                                    {c.sessionDefaultChannelGroup || 'Unassigned'}
                                                </span>
                                                <span className="text-xs font-black text-slate-700 shrink-0">
                                                    {nfc.format(Number(c.sessions))}
                                                    <span className="text-slate-400 font-medium ml-1">
                                                        {share.toFixed(0)}%
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-3xl border-slate-200 shadow-none">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-brand-navy">
                                    Devices
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Sessions by device
                                </p>
                            </div>
                            <Smartphone className="w-4 h-4 text-slate-300" />
                        </div>
                        <div className="h-52">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.devices}>
                                    <CartesianGrid
                                        strokeDasharray="3 3"
                                        stroke="#f1f5f9"
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="deviceCategory"
                                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(v) => nfc.format(Number(v))}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            border: 'none',
                                            borderRadius: 12,
                                            boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                            fontSize: 12,
                                        }}
                                        formatter={(v: number) => nf.format(v)}
                                    />
                                    <Bar
                                        dataKey="sessions"
                                        fill="#0f172a"
                                        radius={[10, 10, 0, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Row 2: top pages + countries */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
type Tone = 'navy' | 'sky' | 'emerald' | 'violet';
const TONES: Record<Tone, { bg: string; fg: string; icon: string }> = {
    navy: { bg: 'bg-brand-navy', fg: 'text-white', icon: 'text-white' },
    sky: { bg: 'bg-sky-500', fg: 'text-white', icon: 'text-white' },
    emerald: { bg: 'bg-emerald-500', fg: 'text-white', icon: 'text-white' },
    violet: { bg: 'bg-violet-500', fg: 'text-white', icon: 'text-white' },
};

const Kpi: React.FC<{
    label: string;
    value: string;
    sublabel?: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
}> = ({ label, value, sublabel, icon: Icon, tone }) => {
    const t = TONES[tone];
    return (
        <Card className="rounded-2xl border-slate-200 shadow-none overflow-hidden">
            <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', t.bg)}>
                        <Icon className={cn('w-4 h-4', t.icon)} />
                    </div>
                </div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    {label}
                </div>
                <div className="text-2xl font-black text-brand-navy mt-1 tracking-tight">
                    {value}
                </div>
                {sublabel && (
                    <div className="text-[11px] font-bold text-slate-400 mt-1">{sublabel}</div>
                )}
            </CardContent>
        </Card>
    );
};

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <div className="flex items-center gap-1.5 text-slate-500">
        <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span>{label}</span>
    </div>
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
    return (
        <Card className="rounded-3xl border-slate-200 shadow-none">
            <CardContent className="p-6">
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h3 className="text-sm font-black uppercase tracking-wider text-brand-navy">
                            {title}
                        </h3>
                        {subtitle && (
                            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
                        )}
                    </div>
                    <Icon className="w-4 h-4 text-slate-300" />
                </div>
                <div className="space-y-3">
                    {rows.length === 0 ? (
                        <div className="text-xs text-slate-400 font-medium py-8 text-center">
                            No data for this range
                        </div>
                    ) : (
                        rows.slice(0, 8).map((r, i) => {
                            const pctWidth = (r.value / max) * 100;
                            return (
                                <div key={i} className="space-y-1">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-brand-navy truncate">
                                                {r.label}
                                            </div>
                                            {r.sub && (
                                                <div className="text-[10px] font-mono text-slate-400 truncate">
                                                    {r.sub}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-black text-brand-navy">
                                                {valueFormatter(r.value)}
                                            </div>
                                            {r.extra && (
                                                <div className="text-[10px] font-bold text-slate-400">
                                                    {r.extra}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                        <div
                                            className={cn(
                                                'h-full rounded-full transition-all duration-500',
                                                accent === 'emerald' ? 'bg-emerald-500' : 'bg-brand-navy'
                                            )}
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
        <Card className="rounded-3xl border-slate-200 shadow-none overflow-hidden">
            <CardContent className="p-0">
                <div className="grid grid-cols-1 md:grid-cols-5">
                    <div className="md:col-span-2 p-8 bg-gradient-to-br from-brand-navy to-slate-800 text-white">
                        <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mb-4">
                            <BarChart3 className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl font-black tracking-tight mb-2">
                            Connect Google Analytics
                        </h2>
                        <p className="text-sm text-white/60 font-medium leading-relaxed">
                            Grant read access to our service account, then paste your GA4
                            Property ID. No OAuth, no popups. Works for multiple properties.
                        </p>
                    </div>
                    <div className="md:col-span-3 p-8 space-y-5">
                        <Step
                            num={1}
                            title="Open GA4 property access"
                            body="In Google Analytics, go to Admin → Property access management → Add users."
                        />
                        <Step
                            num={2}
                            title="Add our service account as Viewer"
                            body={
                                <div className="space-y-2 mt-2">
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 px-3 py-2 rounded-lg bg-slate-100 text-[11px] font-mono text-brand-navy truncate">
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
                                                className="rounded-lg h-9"
                                                onClick={() => refetch()}
                                            >
                                                Retry
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="rounded-lg h-9"
                                                disabled={!sa?.email}
                                                onClick={() => {
                                                    navigator.clipboard.writeText(sa?.email ?? '');
                                                    toast({ title: 'Copied', description: sa?.email });
                                                }}
                                            >
                                                <Copy className="w-3.5 h-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                    {error && (
                                        <div className="text-[11px] text-red-600 font-medium">
                                            {(error as Error).message}
                                        </div>
                                    )}
                                </div>
                            }
                        />
                        <Step
                            num={3}
                            title="Paste your GA4 Property ID"
                            body="Find it in Admin → Property Settings. Usually a 9-10 digit number."
                        />
                        <Button
                            onClick={onAdd}
                            className="w-full h-12 rounded-xl bg-brand-navy hover:bg-slate-800 text-white font-bold"
                        >
                            <Plus className="w-4 h-4 mr-2" />
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
    <div className="flex gap-3">
        <div className="w-7 h-7 rounded-full bg-brand-navy text-white text-xs font-black flex items-center justify-center shrink-0">
            {num}
        </div>
        <div className="flex-1">
            <div className="text-sm font-black text-brand-navy">{title}</div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">{body}</div>
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
