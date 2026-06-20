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
type PresetKey = 'today' | 'yesterday' | '7d' | '28d' | '90d' | 'ytd';
const PRESETS: { key: PresetKey; label: string; days?: number }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: 'Last 7 days', days: 7 },
    { key: '28d', label: 'Last 28 days', days: 28 },
    { key: '90d', label: 'Last 90 days', days: 90 },
    { key: 'ytd', label: 'Year to date' },
];

function presetToRange(key: PresetKey): DateRange {
    const today = startOfDay(new Date());
    const end = format(today, 'yyyy-MM-dd');
    if (key === 'today') {
        return { start: end, end };
    }
    if (key === 'yesterday') {
        const y = format(subDays(today, 1), 'yyyy-MM-dd');
        return { start: y, end: y };
    }
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
    '#141413', '#3f3e3a', '#6b6a63', '#8d8b84',
    '#b0aea5', '#c9c6bc', '#d4d1c6', '#d8d6cc',
    '#e0ded3', '#e8e6dc',
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
    // Mediabuyers view only the properties an admin assigned them — they cannot connect/remove/set-default.
    const canManage = profile?.role !== 'mediabuyer';
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

    // Clear a stale stored business id when it no longer appears in the
    // owner's accessible businesses list (business removed or permissions
    // changed). Without this guard the page kept a stuck id and rendered
    // a misleading "No connections yet" onboarding card for a phantom business.
    useEffect(() => {
        if (!isOwner || !businesses || !ownerBusinessId) return;
        if (!businesses.some((b) => b.id === ownerBusinessId)) {
            localStorage.removeItem('ga_owner_business_id');
            setOwnerBusinessId(null);
        }
    }, [isOwner, businesses, ownerBusinessId]);

    const { data: connections = [], isLoading: connectionsLoading } = useGAConnections(businessId);

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
            <div className="ant-surface flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-ant-ink" />
            </div>
        );
    }

    if (isOwner && !businessId) {
        return (
            <div className="ant-surface mx-auto max-w-[640px] px-3 md:px-5 py-6">
                <EmptyBusinessPicker
                    businesses={businesses ?? []}
                    onSelect={setOwnerBusinessId}
                />
            </div>
        );
    }

    const today = format(new Date(), 'EEEE, MMMM d');

    return (
        <div className="ant-surface px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        {today}
                    </span>
                    <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                        Google Analytics
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Live GA4 traffic, engagement, and conversions.
                    </p>
                </div>
                {isOwner && businesses && (
                    <BusinessSwitcher
                        businesses={businesses}
                        value={ownerBusinessId}
                        onChange={setOwnerBusinessId}
                    />
                )}
            </header>

            <div className="h-px bg-ant-line" />

            {/* Connections row */}
            {connectionsLoading ? (
                <Skeleton className="h-12 w-full rounded-xl bg-ant-line-soft" />
            ) : connections.length === 0 ? (
                canManage ? (
                    <OnboardingCard onAdd={() => setAddOpen(true)} />
                ) : (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper p-8 text-center">
                        <p className="text-[13px] font-semibold text-ant-ink">Aucune propriété assignée</p>
                        <p className="text-[12px] text-ant-mid mt-1">Demandez à un administrateur de vous donner accès à une propriété Google Analytics.</p>
                    </div>
                )
            ) : (
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 flex-wrap">
                    <PropertySwitcher
                        connections={connections}
                        active={activeConnection}
                        onChange={(c) => setActivePropertyId(c.property_id)}
                        businessId={businessId!}
                        onAdd={() => setAddOpen(true)}
                        canManage={canManage}
                    />
                    <DateRangeBar value={preset} onChange={setPreset} range={range} />
                    <RealtimePill total={realtime.data?.total ?? 0} isLoading={realtime.isLoading} />
                </div>
            )}

            {/* Dashboard */}
            {connections.length > 0 && activeConnection && (
                <Dashboard reports={reports} realtime={realtime.data} />
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
                <button className="h-9 rounded-full border border-ant-line bg-ant-paper text-[11px] font-medium text-ant-ink min-w-[200px] inline-flex items-center justify-between px-3.5 gap-2 hover:border-ant-ink/25 transition">
                    <span className="truncate">{current?.name ?? 'Select business'}</span>
                    <ChevronsUpDown className="w-3 h-3 text-ant-mid" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="ant-surface w-[260px] p-1 rounded-xl border-ant-line bg-ant-paper">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => {
                            onChange(b.id);
                            setOpen(false);
                        }}
                        className={cn(
                            'w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11.5px] font-medium text-left hover:bg-ant-line-soft transition',
                            value === b.id && 'bg-ant-line-soft text-ant-ink'
                        )}
                    >
                        <span className="truncate">{b.name}</span>
                        {value === b.id && <Check className="w-3 h-3 text-ant-orange" />}
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
    <div className="rounded-2xl border border-ant-line bg-ant-paper p-6 text-center">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-ant-orange/10 mb-3">
            <BarChart3 className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
        </div>
        <h2 className="font-display text-[20px] font-semibold text-ant-ink tracking-tight">Choose a business</h2>
        <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-4">
            Pick a business to view its Google Analytics.
        </p>
        <div className="max-w-sm mx-auto space-y-1.5">
            {businesses.map((b) => (
                <button
                    key={b.id}
                    onClick={() => onSelect(b.id)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ant-line bg-ant-paper hover:border-ant-ink/25 hover:bg-ant-line-soft transition text-left text-[12px] font-medium text-ant-ink"
                >
                    {b.name}
                </button>
            ))}
        </div>
    </div>
);

const PropertySwitcher: React.FC<{
    connections: GAConnection[];
    active: GAConnection | null;
    onChange: (c: GAConnection) => void;
    businessId: string;
    onAdd: () => void;
    canManage: boolean;
}> = ({ connections, active, onChange, businessId, onAdd, canManage }) => {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();
    const setDefault = useSetDefaultGAConnection();
    const deleteConn = useDeleteGAConnection();

    return (
        <div className="flex items-center gap-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button className="flex items-center gap-2.5 h-9 px-3.5 rounded-full bg-ant-paper border border-ant-line hover:border-ant-ink/25 transition min-w-[240px]">
                        <Layers className="w-3.5 h-3.5 text-ant-orange shrink-0" strokeWidth={1.75} />
                        <div className="flex-1 text-left min-w-0">
                            <div className="text-[9px] text-ant-mid font-medium uppercase tracking-[0.2em] leading-none">
                                Property
                            </div>
                            <div className="text-[11.5px] font-medium text-ant-ink truncate leading-tight mt-0.5">
                                {active?.display_name ?? '—'}
                            </div>
                        </div>
                        <ChevronsUpDown className="w-3 h-3 text-ant-mid shrink-0" />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="ant-surface w-[340px] p-1.5 rounded-xl border-ant-line bg-ant-paper">
                    <div className="px-2.5 pt-1 pb-1.5 text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-mid">
                        Connected properties
                    </div>
                    {connections.map((c) => (
                        <div
                            key={c.id}
                            className={cn(
                                'group flex items-center gap-1 px-1.5 py-1.5 rounded-lg hover:bg-ant-line-soft',
                                active?.id === c.id && 'bg-ant-line-soft'
                            )}
                        >
                            <button
                                onClick={() => {
                                    onChange(c);
                                    setOpen(false);
                                }}
                                className="flex-1 flex items-center gap-2 text-left min-w-0"
                            >
                                <Globe2 className="w-3.5 h-3.5 text-ant-mid shrink-0" strokeWidth={1.75} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[11.5px] font-semibold text-ant-ink truncate">
                                            {c.display_name}
                                        </span>
                                        {c.is_default && (
                                            <Star className="w-3 h-3 fill-ant-orange text-ant-orange shrink-0" />
                                        )}
                                    </div>
                                    <div className="text-[10px] text-ant-mid font-mono">
                                        {c.property_id}
                                    </div>
                                </div>
                                {active?.id === c.id && (
                                    <Check className="w-3 h-3 text-ant-orange shrink-0" />
                                )}
                            </button>
                            {canManage && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-ant-paper opacity-0 group-hover:opacity-100 transition">
                                        <MoreVertical className="w-3 h-3 text-ant-muted" />
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
                                        className="text-ant-rose"
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
                            )}
                        </div>
                    ))}
                    {canManage && (
                    <div className="border-t border-ant-line mt-1 pt-1">
                        <button
                            onClick={() => {
                                setOpen(false);
                                onAdd();
                            }}
                            className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11.5px] font-semibold text-ant-ink hover:bg-ant-line-soft"
                        >
                            <Plus className="w-3 h-3 text-ant-orange" />
                            Connect another property
                        </button>
                    </div>
                    )}
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
    <div className="flex items-center gap-1 flex-wrap">
        {PRESETS.map((p) => (
            <button
                key={p.key}
                onClick={() => onChange(p.key)}
                className={cn(
                    'h-9 px-3.5 rounded-full text-[11px] font-medium transition whitespace-nowrap border',
                    value === p.key
                        ? 'bg-ant-ink text-ant-light border-ant-ink'
                        : 'bg-transparent text-ant-ink border-ant-line hover:border-ant-ink/30',
                )}
            >
                {p.label}
            </button>
        ))}
        <div className="hidden lg:flex items-center px-3 h-9 text-[9.5px] font-mono text-ant-mid border-l border-ant-line ml-1">
            {range.start} → {range.end}
        </div>
    </div>
);

const RealtimePill: React.FC<{ total: number; isLoading: boolean }> = ({
    total,
    isLoading,
}) => (
    <div className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-ant-green/10 border border-ant-green/25">
        <span className="relative inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-ant-green" />
            <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-ant-green animate-ping" />
        </span>
        <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-green">
            Live
        </span>
        <span className="text-[11.5px] font-semibold text-ant-ink tabular-nums">
            {isLoading ? '—' : `${nf.format(total)} active`}
        </span>
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
            <div className="ant-surface rounded-xl border border-ant-rose/30 bg-ant-rose/10 p-4 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-ant-rose mt-0.5 shrink-0" strokeWidth={1.75} />
                <div>
                    <div className="font-display text-[13px] font-semibold text-ant-rose">Cannot load data</div>
                    <div className="text-[11.5px] text-ant-rose mt-0.5">
                        {(error as Error).message}
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading || !data) {
        return (
            <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 rounded-xl bg-ant-line-soft" />
                    ))}
                </div>
                <Skeleton className="h-56 rounded-xl bg-ant-line-soft" />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <Skeleton className="h-56 rounded-xl lg:col-span-2 bg-ant-line-soft" />
                    <Skeleton className="h-56 rounded-xl bg-ant-line-soft" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* KPI strip — unified neutral cards, single orange accent on engagement */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
                <Kpi
                    label="Active users"
                    value={nf.format(data.totals.activeUsers ?? 0)}
                    sublabel={`${nf.format(data.totals.newUsers ?? 0)} new`}
                    icon={UsersIcon}
                    accent="#141413"
                />
                <Kpi
                    label="Sessions"
                    value={nf.format(data.totals.sessions ?? 0)}
                    sublabel={`${nfc.format(data.totals.screenPageViews ?? 0)} views`}
                    icon={Activity}
                    accent="#141413"
                />
                <Kpi
                    label="Conversions"
                    value={nf.format(Math.round(data.totals.conversions ?? 0))}
                    sublabel={
                        data.totals.sessions && data.totals.sessions > 0
                            ? `${pct((data.totals.conversions ?? 0) / data.totals.sessions)} of sessions`
                            : '—'
                    }
                    icon={Star}
                    accent="#d97757"
                />
                <Kpi
                    label="Engagement rate"
                    value={pct(data.totals.engagementRate ?? 0)}
                    sublabel={`${pct(1 - (data.totals.bounceRate ?? 0))} non-bounce`}
                    icon={TrendingUp}
                    accent="#d97757"
                    rate={(data.totals.engagementRate ?? 0) * 100}
                />
                <Kpi
                    label="Avg. session"
                    value={dur(data.totals.averageSessionDuration ?? 0)}
                    sublabel={`${nfc.format(data.totals.eventCount ?? 0)} events`}
                    icon={Clock}
                    accent="#788c5d"
                />
            </div>

            {/* Trend */}
            <Card className="border border-ant-line bg-ant-paper shadow-none rounded-xl">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                            <div>
                                <h3 className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">Traffic trend</h3>
                                <p className="text-[10px] text-ant-mid uppercase tracking-[0.18em] mt-0.5">
                                    Daily users · sessions · page views
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-ant-muted">
                            <LegendDot color="#141413" label="Users" />
                            <LegendDot color="#788c5d" label="Sessions" />
                            <LegendDot color="#d97757" label="Views" />
                        </div>
                    </div>
                    <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.trend} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="ga-users" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#141413" stopOpacity={0.22} />
                                        <stop offset="100%" stopColor="#141413" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="ga-sessions" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#788c5d" stopOpacity={0.18} />
                                        <stop offset="100%" stopColor="#788c5d" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(v) => parseGaDate(String(v))}
                                    tick={{ fontSize: 10, fill: '#b0aea5' }}
                                    axisLine={false}
                                    tickLine={false}
                                    interval="preserveStartEnd"
                                    minTickGap={24}
                                />
                                <YAxis
                                    tick={{ fontSize: 10, fill: '#b0aea5' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={36}
                                    tickFormatter={(v) => nfc.format(Number(v))}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: 10,
                                        border: '1px solid #e8e6dc',
                                        boxShadow: 'none',
                                        fontSize: 11,
                                    }}
                                    labelFormatter={(v) => parseGaDate(String(v))}
                                    formatter={(v: number, name: string) => [nf.format(v), name]}
                                />
                                <Area type="monotone" dataKey="activeUsers" name="Users" stroke="#141413" strokeWidth={1.75} fill="url(#ga-users)" dot={false} />
                                <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#788c5d" strokeWidth={1.5} fill="url(#ga-sessions)" dot={false} />
                                <Area type="monotone" dataKey="screenPageViews" name="Views" stroke="#d97757" strokeWidth={1.25} strokeDasharray="4 3" fill="transparent" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Row 1: acquisition + devices */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Card className="border border-ant-line bg-ant-paper shadow-none rounded-xl lg:col-span-2">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                <div>
                                    <h3 className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">Acquisition</h3>
                                    <p className="text-[10px] text-ant-mid uppercase tracking-[0.18em] mt-0.5">
                                        Sessions by channel
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {data.channels.length === 0 && (
                                <p className="font-serif-display text-[12px] text-ant-muted italic text-center py-4">No channel data yet</p>
                            )}
                            {data.channels.map((c, i) => {
                                const total = data.channels.reduce((s, r) => s + (Number(r.sessions) || 0), 0);
                                const value = Number(c.sessions) || 0;
                                const share = total ? (value / total) * 100 : 0;
                                const max = data.channels.reduce((m, r) => Math.max(m, Number(r.sessions) || 0), 0) || 1;
                                const width = (value / max) * 100;
                                return (
                                    <div key={String(c.sessionDefaultChannelGroup) + i}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span
                                                className="w-[3px] h-3.5 rounded-full shrink-0"
                                                style={{ backgroundColor: CHANNEL_SHADES[i % CHANNEL_SHADES.length] }}
                                            />
                                            <span className="text-[11.5px] font-medium text-ant-ink flex-1 truncate capitalize">
                                                {String(c.sessionDefaultChannelGroup || 'Unassigned')}
                                            </span>
                                            <span className="text-[11.5px] font-semibold text-ant-ink tabular-nums">
                                                {nfc.format(value)}
                                            </span>
                                            <span className="text-[10px] text-ant-mid tabular-nums w-10 text-right">
                                                {share.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="ml-[11px] h-1 bg-ant-line rounded-full overflow-hidden">
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

                <Card className="border border-ant-line bg-ant-paper shadow-none rounded-xl">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                <div>
                                    <h3 className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">Devices</h3>
                                    <p className="text-[10px] text-ant-mid uppercase tracking-[0.18em] mt-0.5">
                                        Sessions by device
                                    </p>
                                </div>
                            </div>
                            <Smartphone className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        </div>
                        <div className="h-40">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.devices} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                    <XAxis
                                        dataKey="deviceCategory"
                                        tick={{ fontSize: 10, fill: '#b0aea5' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: '#b0aea5' }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={32}
                                        tickFormatter={(v) => nfc.format(Number(v))}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: 10,
                                            border: '1px solid #e8e6dc',
                                            boxShadow: 'none',
                                            fontSize: 11,
                                        }}
                                        formatter={(v: number) => nf.format(v)}
                                    />
                                    <Bar dataKey="sessions" fill="#141413" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Row 2: top pages + countries */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
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
// KPI tile — matches Dashboard KPI aesthetic: hairline border, tiny accent dot
// next to the icon, Poppins display numeric, optional rate bar.
const Kpi: React.FC<{
    label: string;
    value: string;
    sublabel?: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    rate?: number;
}> = ({ label, value, sublabel, icon: Icon, accent, rate }) => (
    <Card className="border border-ant-line bg-ant-paper shadow-none rounded-xl overflow-hidden">
        <CardContent className="p-3">
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Icon className="w-3 h-3 text-ant-mid shrink-0" />
                    <span className="text-[9.5px] uppercase tracking-[0.18em] font-medium text-ant-mid truncate">
                        {label}
                    </span>
                </div>
                <span
                    className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                    style={{ backgroundColor: `${accent}14`, color: accent }}
                >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
                </span>
            </div>
            <div className="font-display text-[20px] font-semibold text-ant-ink tabular-nums leading-none tracking-[-0.02em] mt-2">
                {value}
            </div>
            {rate !== undefined && (
                <div className="mt-2 h-[3px] rounded-full overflow-hidden bg-ant-line/70">
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(0, Math.min(100, rate))}%`, backgroundColor: accent }}
                    />
                </div>
            )}
            {sublabel && (
                <div className="text-[10px] font-medium text-ant-muted tabular-nums mt-1.5 truncate">
                    {sublabel}
                </div>
            )}
        </CardContent>
    </Card>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-ant-muted">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
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
    const barColor = accent === 'emerald' ? 'bg-ant-green' : 'bg-ant-ink/70';
    return (
        <Card className="border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={cn('w-1 h-1 rounded-full', accent === 'emerald' ? 'bg-ant-green' : 'bg-ant-orange')} />
                        <div>
                            <h3 className="font-display text-[13px] font-semibold text-ant-ink tracking-tight truncate">{title}</h3>
                            {subtitle && (
                                <p className="text-[10px] text-ant-mid uppercase tracking-[0.18em] mt-0.5 truncate">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                    <Icon className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                </div>
                <div className="space-y-2">
                    {rows.length === 0 ? (
                        <div className="font-serif-display text-[11px] text-ant-muted italic py-4 text-center">
                            No data for this range
                        </div>
                    ) : (
                        rows.slice(0, 8).map((r, i) => {
                            const pctWidth = (r.value / max) * 100;
                            return (
                                <div key={i}>
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11.5px] font-medium text-ant-ink truncate">
                                                {r.label}
                                            </div>
                                            {r.sub && (
                                                <div className="text-[9.5px] font-mono text-ant-mid truncate">
                                                    {r.sub}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-[11.5px] font-semibold text-ant-ink tabular-nums">
                                                {valueFormatter(r.value)}
                                            </div>
                                            {r.extra && (
                                                <div className="text-[9.5px] text-ant-mid tabular-nums">
                                                    {r.extra}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="h-[3px] rounded-full bg-ant-line overflow-hidden">
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
        <div className="rounded-2xl border border-ant-line bg-ant-paper p-5">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
                <div className="md:col-span-2 p-4 rounded-xl bg-ant-light border border-ant-line">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ant-orange/10 mb-3">
                        <BarChart3 className="w-4 h-4 text-ant-orange" strokeWidth={1.75} />
                    </div>
                    <div className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        Connect
                    </div>
                    <h2 className="font-display text-[20px] font-semibold text-ant-ink tracking-tight mt-1">
                        Google Analytics
                    </h2>
                    <p className="font-serif-display text-[12.5px] text-ant-muted italic leading-relaxed mt-2">
                        Grant read access to our service account and paste your GA4 Property ID. No OAuth, no popups. Works for multiple properties.
                    </p>
                </div>
                <div className="md:col-span-3 space-y-4">
                    <Step
                        num={1}
                        title="Open GA4 property access"
                        body="In Google Analytics, go to Admin → Property access management → Add users."
                    />
                    <Step
                        num={2}
                        title="Add our service account as Viewer"
                        body={
                            <div className="space-y-1.5 mt-2">
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 px-3 py-2 rounded-lg bg-ant-line-soft border border-ant-line text-[11px] font-mono text-ant-ink truncate">
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
                                            className="rounded-lg h-9 px-3 text-[11px] border-ant-line text-ant-ink hover:bg-ant-line-soft"
                                            onClick={() => refetch()}
                                        >
                                            Retry
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="rounded-lg h-9 w-9 p-0 border-ant-line text-ant-ink hover:bg-ant-line-soft"
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
                                    <div className="text-[11px] text-ant-rose">
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
                        className="w-full h-10 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium"
                    >
                        <Plus className="w-3.5 h-3.5 mr-2" />
                        Connect a property
                    </Button>
                </div>
            </div>
        </div>
    );
};

const Step: React.FC<{ num: number; title: string; body: React.ReactNode }> = ({
    num,
    title,
    body,
}) => (
    <div className="flex gap-3">
        <div className="font-display w-7 h-7 rounded-full border border-ant-line bg-ant-paper text-ant-orange text-[11px] font-semibold tabular-nums flex items-center justify-center shrink-0 tracking-[0.04em]">
            {String(num).padStart(2, '0')}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
            <div className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">{title}</div>
            <div className="text-[11.5px] text-ant-muted mt-0.5 leading-snug">{body}</div>
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
    // Scoped to this business server-side. Used only to decide whether this
    // would be the first connection (→ default checked by default).
    const { data: connections } = useGAConnections(businessId);
    const { toast } = useToast();
    const add = useAddGAConnection();

    const [propertyId, setPropertyId] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [makeDefault, setMakeDefault] = useState(!connections || connections.length === 0);

    useEffect(() => {
        if (!open) {
            setPropertyId('');
            setDisplayName('');
            setWebsiteUrl('');
        }
    }, [open]);

    useEffect(() => {
        setMakeDefault(!connections || connections.length === 0);
    }, [connections, open]);

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
            <DialogContent className="ant-surface rounded-2xl max-w-lg bg-ant-paper border-ant-line">
                <DialogHeader>
                    <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-tight">
                        Connect a GA4 property
                    </DialogTitle>
                    <DialogDescription className="font-serif-display text-[13px] text-ant-muted italic">
                        Make sure the service account has Viewer access first.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="rounded-xl bg-ant-light border border-ant-line p-3.5 flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-ant-orange mt-0.5 shrink-0" strokeWidth={1.75} />
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                Grant access to
                            </div>
                            <div className="text-[12px] font-mono text-ant-ink truncate mt-0.5">
                                {sa?.email ?? 'Loading…'}
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(sa?.email ?? '');
                                toast({ title: 'Copied' });
                            }}
                            className="w-8 h-8 rounded-lg bg-ant-paper border border-ant-line hover:bg-ant-line-soft flex items-center justify-center"
                        >
                            <Copy className="w-3.5 h-3.5 text-ant-muted" />
                        </button>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                            GA4 Property ID
                        </Label>
                        <Input
                            placeholder="123456789"
                            value={propertyId}
                            onChange={(e) => setPropertyId(e.target.value)}
                            className="h-11 rounded-xl font-mono border-ant-line bg-ant-paper text-ant-ink focus-visible:ring-ant-orange"
                        />
                        <p className="text-[11px] text-ant-muted">
                            Numeric ID only (not the G-XXXX measurement ID).
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                            Display name
                        </Label>
                        <Input
                            placeholder="Main website"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="h-11 rounded-xl border-ant-line bg-ant-paper text-ant-ink focus-visible:ring-ant-orange"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                            Website URL <span className="text-ant-mid font-normal normal-case tracking-normal">(optional)</span>
                        </Label>
                        <div className="relative">
                            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" strokeWidth={1.75} />
                            <Input
                                placeholder="https://example.com"
                                value={websiteUrl}
                                onChange={(e) => setWebsiteUrl(e.target.value)}
                                className="h-11 rounded-xl pl-9 border-ant-line bg-ant-paper text-ant-ink focus-visible:ring-ant-orange"
                            />
                        </div>
                    </div>

                    <label className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-ant-line cursor-pointer hover:bg-ant-line-soft transition">
                        <input
                            type="checkbox"
                            checked={makeDefault}
                            onChange={(e) => setMakeDefault(e.target.checked)}
                            className="w-4 h-4 rounded accent-ant-orange"
                        />
                        <span className="text-[12.5px] font-medium text-ant-ink">
                            Make this the default property
                        </span>
                    </label>
                </div>
                <DialogFooter className="gap-2">
                    <Button
                        variant="outline"
                        className="rounded-full border-ant-line text-ant-ink bg-ant-paper hover:bg-ant-line-soft"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={add.isPending || !propertyId.trim() || !displayName.trim()}
                        className="rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium"
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
