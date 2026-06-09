import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
    ArrowLeft,
    Plus,
    Save,
    Trash2,
    Loader2,
    Calendar as CalendarIcon,
    Eye,
    AlertCircle,
    Edit2,
    Check,
    X,
    Coins,
    Users as UsersIcon,
    CheckCircle2,
    Target,
    TrendingUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import {
    getPlatformIcon,
    getPlatformColor,
    type Campaign,
    type CampaignDailyEntry,
} from '@/lib/campaignConstants';
import { useCampaignMetrics } from '@/hooks/useCampaignMetrics';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useCampaignBasePath } from '@/hooks/useCampaignBasePath';
import { fmtCur, fmtCurFull, fmtNum, fmtPct } from '@/lib/formatNumbers';
import type { LucideIcon } from 'lucide-react';

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const ManageKpi: React.FC<{
    label: string;
    value: string;
    sub: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, sub, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 leading-tight truncate">{value}</p>
            <p className="text-[10px] text-ant-mid font-serif italic mt-0.5 truncate">{sub}</p>
        </div>
    );
};

const CampaignManage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentUserId = useCurrentUserId();
    const basePath = useCampaignBasePath();

    const { data: campaign, isLoading: loadingCampaign } = useQuery<Campaign | null>({
        queryKey: ['campaign', id],
        queryFn: async () => {
            if (!id) return null;
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('*')
                .eq('id', id)
                .single();
            if (error) throw error;
            return data as Campaign;
        },
        enabled: !!id,
    });

    const { entries, daily, totals, isLoading: loadingMetrics } = useCampaignMetrics(campaign);

    useEffect(() => {
        if (!campaign || !currentUserId) return;
        if (campaign.created_by && campaign.created_by !== currentUserId) {
            toast({
                title: 'Read only',
                description: 'You can only manage campaigns you created.',
                variant: 'destructive',
            });
            navigate(`${basePath}/${campaign.id}`, { replace: true });
        }
    }, [campaign, currentUserId, basePath, navigate, toast]);

    const [addDate, setAddDate] = useState<Date | null>(new Date());
    const [addSpend, setAddSpend] = useState<string>('');
    const [addLeads, setAddLeads] = useState<string>('');
    const [addNotes, setAddNotes] = useState<string>('');

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editSpend, setEditSpend] = useState<string>('');
    const [editLeads, setEditLeads] = useState<string>('');
    const [editNotes, setEditNotes] = useState<string>('');

    const [toDelete, setToDelete] = useState<CampaignDailyEntry | null>(null);

    const existingDates = useMemo(() => new Set(entries.map((e) => e.entry_date)), [entries]);

    const upsertMutation = useMutation({
        mutationFn: async (payload: { entry_date: string; spend: number; leads: number; notes: string | null }) => {
            if (!campaign || !activeBusinessId) throw new Error('Missing context');
            const existing = entries.find((e) => e.entry_date === payload.entry_date);
            if (existing) {
                const { error } = await (supabase as any)
                    .from('campaign_daily_entries')
                    .update({ spend: payload.spend, leads: payload.leads, notes: payload.notes })
                    .eq('id', existing.id);
                if (error) throw error;
                return 'updated';
            }
            const { error } = await (supabase as any).from('campaign_daily_entries').insert({
                campaign_id: campaign.id,
                'DigiCom Business': activeBusinessId,
                entry_date: payload.entry_date,
                spend: payload.spend,
                leads: payload.leads,
                notes: payload.notes,
            });
            if (error) throw error;
            return 'created';
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['campaign-daily-entries', campaign?.id] });
            queryClient.invalidateQueries({ queryKey: ['campaign-orders', campaign?.id] });
            toast({ title: result === 'created' ? 'Entry added' : 'Entry updated' });
            setAddSpend('');
            setAddLeads('');
            setAddNotes('');
            setEditingId(null);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: async (entryId: string) => {
            const { error } = await (supabase as any)
                .from('campaign_daily_entries')
                .delete()
                .eq('id', entryId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaign-daily-entries', campaign?.id] });
            queryClient.invalidateQueries({ queryKey: ['campaign-orders', campaign?.id] });
            toast({ title: 'Entry deleted' });
            setToDelete(null);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const handleAdd = () => {
        if (!addDate) return toast({ title: 'Select a date', variant: 'destructive' });
        const spendVal = Number(addSpend || 0);
        const leadsVal = Number(addLeads || 0);
        if (spendVal < 0 || leadsVal < 0) return toast({ title: 'Values must be ≥ 0', variant: 'destructive' });
        upsertMutation.mutate({
            entry_date: format(addDate, 'yyyy-MM-dd'),
            spend: spendVal,
            leads: leadsVal,
            notes: addNotes || null,
        });
    };

    const startEdit = (e: CampaignDailyEntry) => {
        setEditingId(e.id);
        setEditSpend(String(e.spend));
        setEditLeads(String(e.leads));
        setEditNotes(e.notes || '');
    };

    const saveEdit = (e: CampaignDailyEntry) => {
        upsertMutation.mutate({
            entry_date: e.entry_date,
            spend: Number(editSpend || 0),
            leads: Number(editLeads || 0),
            notes: editNotes || null,
        });
    };

    if (loadingCampaign) {
        return (
            <div className="ant-surface min-h-screen flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 animate-spin text-ant-mid" />
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="ant-surface min-h-screen flex flex-col items-center justify-center py-32 gap-3">
                <div className="h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                </div>
                <p className="font-serif italic text-[13px] text-ant-mid">Campaign not found.</p>
                <Button onClick={() => navigate(basePath)} className="h-9 px-5 rounded-full bg-ant-ink text-white hover:bg-ant-ink/90 text-[12px] font-semibold gap-2 cursor-pointer">
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Global Ads
                </Button>
            </div>
        );
    }

    const currency = campaign.currency || 'MAD';
    const statusPill = campaign.status === 'active'
        ? { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' }
        : { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(basePath)}
                            className="h-10 w-10 rounded-full border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light shrink-0 cursor-pointer"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <div className="space-y-2 min-w-0">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Campaign · Daily entries
                            </div>
                            <h1 className="font-display text-[28px] md:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink truncate">
                                {campaign.name}
                            </h1>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span
                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white capitalize"
                                    style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                                >
                                    <span>{getPlatformIcon(campaign.platform, 'w-3 h-3')}</span>
                                    {campaign.platform}
                                </span>
                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', statusPill.bg, statusPill.border, statusPill.text)}>
                                    <span className={cn('h-1.5 w-1.5 rounded-full', statusPill.dot)} />
                                    {campaign.status}
                                </span>
                            </div>
                        </div>
                    </div>
                    <Button
                        onClick={() => navigate(`${basePath}/${campaign.id}`)}
                        variant="outline"
                        className="h-10 px-5 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Eye className="w-3.5 h-3.5" /> Preview report
                    </Button>
                </header>

                {/* KPI strip */}
                {loadingMetrics ? (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <ManageKpi label="Total spend" value={fmtCur(totals.spend, currency)} sub={`${totals.days} day${totals.days !== 1 ? 's' : ''}`} accent="rose" icon={Coins} />
                        <ManageKpi label="Leads" value={fmtNum(totals.leads)} sub="manual entry" accent="ink" icon={UsersIcon} />
                        <ManageKpi label="Confirmed" value={fmtNum(totals.confirmed)} sub={fmtPct(totals.confirmRate)} accent="orange" icon={CheckCircle2} />
                        <ManageKpi label="Delivered" value={fmtNum(totals.delivered)} sub={fmtPct(totals.deliveryRate)} accent="green" icon={Target} />
                        <ManageKpi label="Revenue" value={fmtCur(totals.revenue, currency)} sub="attributed" accent="green" icon={TrendingUp} />
                    </section>
                )}

                {/* Add entry card */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-5">
                        <div className="flex items-start justify-between gap-4 mb-4">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <Plus className="w-3 h-3" />
                                    Add / update entry
                                </div>
                                <h2 className="font-display text-[18px] text-ant-ink tracking-tight">Log today&rsquo;s performance</h2>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                            <div className="md:col-span-3 space-y-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Date</label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                'w-full h-10 rounded-xl border-ant-line bg-ant-paper hover:bg-ant-light text-left text-[12px] font-medium text-ant-ink justify-start gap-2',
                                                !addDate && 'text-ant-mid'
                                            )}
                                        >
                                            <CalendarIcon className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                            {addDate ? format(addDate, 'PPP') : 'Pick a date'}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="ant-calendar w-auto p-0 rounded-xl overflow-hidden shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] border border-ant-line bg-ant-paper" align="start">
                                        <CalendarComponent
                                            mode="single"
                                            selected={addDate ?? undefined}
                                            onSelect={(d) => setAddDate(d ?? null)}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                {addDate && existingDates.has(format(addDate, 'yyyy-MM-dd')) && (
                                    <p className="text-[10px] text-ant-orange mt-1 inline-flex items-center gap-1 font-serif italic">
                                        <AlertCircle className="w-2.5 h-2.5" /> Will overwrite the existing entry
                                    </p>
                                )}
                            </div>
                            <div className="md:col-span-2 space-y-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Spend</label>
                                <div className="relative">
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={addSpend}
                                        onChange={(e) => setAddSpend(e.target.value)}
                                        placeholder="0.00"
                                        className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink tabular-nums pr-12 focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid text-[10px] font-semibold uppercase tracking-[0.18em]">{currency}</span>
                                </div>
                            </div>
                            <div className="md:col-span-2 space-y-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Leads</label>
                                <Input
                                    type="number"
                                    value={addLeads}
                                    onChange={(e) => setAddLeads(e.target.value)}
                                    placeholder="0"
                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink tabular-nums"
                                />
                            </div>
                            <div className="md:col-span-3 space-y-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Notes · optional</label>
                                <Input
                                    value={addNotes}
                                    onChange={(e) => setAddNotes(e.target.value)}
                                    placeholder="e.g. changed creative"
                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid"
                                />
                            </div>
                            <div className="md:col-span-2 flex items-end">
                                <Button
                                    onClick={handleAdd}
                                    disabled={upsertMutation.isPending || !addDate}
                                    className="w-full h-10 rounded-full bg-ant-ink text-white hover:bg-ant-ink/90 text-[12px] font-semibold gap-2 cursor-pointer"
                                >
                                    {upsertMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                    Save entry
                                </Button>
                            </div>
                        </div>
                        <p className="text-[11px] font-serif italic text-ant-mid mt-4 leading-relaxed">
                            <span className="not-italic font-semibold text-ant-ink">Spend</span> and <span className="not-italic font-semibold text-ant-ink">leads</span> come from you — pulled from your ad platform.
                            Confirmed, delivered, cost-per-X and revenue are computed automatically from orders matching{' '}
                            <span className="not-italic font-semibold text-ant-ink capitalize">{campaign.platform}</span> on each day.
                        </p>
                    </div>
                </section>

                {/* Entries table */}
                <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    {daily.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-4">
                            <div className="h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center">
                                <CalendarIcon className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                            </div>
                            <div className="text-center space-y-1">
                                <h3 className="font-display text-[16px] text-ant-ink tracking-tight">No entries yet</h3>
                                <p className="font-serif italic text-[12px] text-ant-mid max-w-sm mx-auto">
                                    Log the first day above — orders matching the platform and date will attribute themselves automatically.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                        <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid sticky left-0 bg-ant-light/50">Date</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Spend</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Leads</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Confirmed</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Delivered</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">CPL</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">CPC</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">CPD</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Conf %</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Liv %</th>
                                        <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Revenue</th>
                                        <th className="text-right px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {daily.map((d) => {
                                        const entry = entries.find((e) => e.entry_date === d.date)!;
                                        const isEditing = editingId === entry.id;
                                        return (
                                            <tr
                                                key={d.date}
                                                className={cn(
                                                    'border-b border-ant-line last:border-0 transition-colors tabular-nums',
                                                    isEditing ? 'bg-ant-orange/8' : 'hover:bg-ant-light/60'
                                                )}
                                            >
                                                <td className="px-4 py-3 text-[12px] font-semibold text-ant-ink sticky left-0 bg-ant-paper">
                                                    {format(new Date(d.date), 'EEE dd MMM yyyy')}
                                                </td>
                                                <td className="text-right px-3 py-3">
                                                    {isEditing ? (
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            value={editSpend}
                                                            onChange={(e) => setEditSpend(e.target.value)}
                                                            className="h-8 w-24 ml-auto rounded-lg border-ant-line bg-ant-paper text-[12px] text-right tabular-nums"
                                                        />
                                                    ) : (
                                                        <span className="text-[12px] font-semibold text-ant-ink">{fmtCurFull(d.spend, currency)}</span>
                                                    )}
                                                </td>
                                                <td className="text-right px-3 py-3">
                                                    {isEditing ? (
                                                        <Input
                                                            type="number"
                                                            value={editLeads}
                                                            onChange={(e) => setEditLeads(e.target.value)}
                                                            className="h-8 w-20 ml-auto rounded-lg border-ant-line bg-ant-paper text-[12px] text-right tabular-nums"
                                                        />
                                                    ) : (
                                                        <span className="text-[12px] text-ant-ink">{fmtNum(d.leads)}</span>
                                                    )}
                                                </td>
                                                <td className="text-right px-3 py-3 text-[12px] text-ant-orange font-semibold">{fmtNum(d.confirmed)}</td>
                                                <td className="text-right px-3 py-3 text-[12px] text-ant-green font-semibold">{fmtNum(d.delivered)}</td>
                                                <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                                <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                                <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                                <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{fmtPct(d.confirmRate)}</td>
                                                <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{fmtPct(d.deliveryRate)}</td>
                                                <td className="text-right px-3 py-3 text-[12px] font-semibold text-ant-green">{fmtCurFull(d.revenue, currency)}</td>
                                                <td className="text-right px-4 py-3">
                                                    {isEditing ? (
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => saveEdit(entry)}
                                                                disabled={upsertMutation.isPending}
                                                                className="h-8 w-8 rounded-full text-ant-green hover:bg-ant-green/10 cursor-pointer"
                                                            >
                                                                <Check className="w-3.5 h-3.5" />
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => setEditingId(null)}
                                                                className="h-8 w-8 rounded-full text-ant-mid hover:bg-ant-ink/5 cursor-pointer"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => startEdit(entry)}
                                                                className="h-8 w-8 rounded-full text-ant-orange hover:bg-ant-orange/10 cursor-pointer"
                                                            >
                                                                <Edit2 className="w-3.5 h-3.5" />
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => setToDelete(entry)}
                                                                className="h-8 w-8 rounded-full text-ant-rose hover:bg-ant-rose/10 cursor-pointer"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                {daily.length > 0 && (
                                    <tfoot>
                                        <tr className="bg-ant-ink text-white tabular-nums font-semibold">
                                            <td className="px-4 py-3.5 sticky left-0 bg-ant-ink text-[10px] uppercase tracking-[0.24em]">Totals</td>
                                            <td className="text-right px-3 py-3.5 text-[12px]">{fmtCurFull(totals.spend, currency)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px]">{fmtNum(totals.leads)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px]">{fmtNum(totals.confirmed)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px]">{fmtNum(totals.delivered)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{fmtPct(totals.confirmRate)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{fmtPct(totals.deliveryRate)}</td>
                                            <td className="text-right px-3 py-3.5 text-[12px]">{fmtCurFull(totals.revenue, currency)}</td>
                                            <td className="px-4" />
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    )}
                </div>

                <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this entry?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Remove the spend and lead numbers for <span className="not-italic font-semibold text-ant-ink">{toDelete && format(new Date(toDelete.entry_date), 'PPP')}</span>. Order data itself is untouched.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}
                                disabled={deleteMutation.isPending}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

export default CampaignManage;
