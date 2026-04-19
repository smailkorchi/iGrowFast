import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
            <div className="flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3">
                <AlertCircle className="w-10 h-10 text-gray-200" />
                <p className="text-[12px] text-gray-400">Campaign not found.</p>
                <Button onClick={() => navigate(basePath)} variant="outline" className="h-8 rounded-md text-[11px] font-semibold">
                    Back to campaigns
                </Button>
            </div>
        );
    }

    const currency = campaign.currency || 'MAD';

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(basePath)}
                            className="h-8 w-8 rounded-md border border-gray-200 text-gray-500 hover:text-brand-navy shrink-0"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                        </Button>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">{campaign.name}</h1>
                                <Badge
                                    className="h-5 px-1.5 text-[9px] rounded-md border-none font-semibold text-white shrink-0"
                                    style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                                >
                                    <span className="mr-1">{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5')}</span>
                                    {campaign.platform}
                                </Badge>
                                <Badge
                                    className={cn(
                                        'h-5 px-1.5 text-[9px] rounded-md border-none font-semibold',
                                        campaign.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                    )}
                                >
                                    {campaign.status}
                                </Badge>
                            </div>
                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Daily performance entries</p>
                        </div>
                    </div>
                    <Button
                        onClick={() => navigate(`${basePath}/${campaign.id}`)}
                        variant="outline"
                        className="h-8 rounded-md text-[11px] font-semibold gap-1.5 border-gray-200"
                    >
                        <Eye className="w-3.5 h-3.5" /> Preview
                    </Button>
                </div>
            </header>

            {/* KPI tiles */}
            {loadingMetrics ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {[
                        { label: 'Total Spend', value: fmtCur(totals.spend, currency), sub: `${totals.days} day${totals.days !== 1 ? 's' : ''}`, accent: '#ef4444' },
                        { label: 'Leads', value: fmtNum(totals.leads), sub: 'injected', accent: '#3b5e5e' },
                        { label: 'Confirmed', value: fmtNum(totals.confirmed), sub: fmtPct(totals.confirmRate), accent: '#3b5e5e' },
                        { label: 'Delivered', value: fmtNum(totals.delivered), sub: fmtPct(totals.deliveryRate), accent: '#059669' },
                        { label: 'Revenue', value: fmtCur(totals.revenue, currency), sub: '—', accent: '#059669' },
                    ].map((s) => (
                        <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: s.accent }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{s.value}</p>
                                <p className="text-[9px] text-gray-400 mt-0.5">{s.sub}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add entry card */}
            <div className="border border-gray-100 rounded-xl bg-white p-3.5">
                <div className="flex items-center gap-1.5 mb-3">
                    <Plus className="w-3.5 h-3.5 text-gray-400" />
                    <h2 className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Add / update daily entry</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <div className="md:col-span-3">
                        <label className="text-[11px] font-medium text-gray-500 mb-1 block">Date</label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className={cn(
                                        'w-full h-9 rounded-md border-gray-200 text-left text-[12px] font-medium text-brand-navy justify-start gap-2',
                                        !addDate && 'text-gray-400'
                                    )}
                                >
                                    <CalendarIcon className="w-3.5 h-3.5 opacity-60 shrink-0" />
                                    {addDate ? format(addDate, 'PPP') : 'Pick a date'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 rounded-xl overflow-hidden shadow-md border-gray-100" align="start">
                                <CalendarComponent
                                    mode="single"
                                    selected={addDate ?? undefined}
                                    onSelect={(d) => setAddDate(d ?? null)}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                        {addDate && existingDates.has(format(addDate, 'yyyy-MM-dd')) && (
                            <p className="text-[9px] text-amber-600 mt-1 flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5" /> Will overwrite existing entry
                            </p>
                        )}
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-[11px] font-medium text-gray-500 mb-1 block">Spend</label>
                        <div className="relative">
                            <Input
                                type="number"
                                step="0.01"
                                value={addSpend}
                                onChange={(e) => setAddSpend(e.target.value)}
                                placeholder="0.00"
                                className="h-9 text-[12px] rounded-md border-gray-200 pr-10"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[9px] font-semibold">{currency}</span>
                        </div>
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-[11px] font-medium text-gray-500 mb-1 block">Leads</label>
                        <Input
                            type="number"
                            value={addLeads}
                            onChange={(e) => setAddLeads(e.target.value)}
                            placeholder="0"
                            className="h-9 text-[12px] rounded-md border-gray-200"
                        />
                    </div>
                    <div className="md:col-span-3">
                        <label className="text-[11px] font-medium text-gray-500 mb-1 block">Notes (optional)</label>
                        <Input
                            value={addNotes}
                            onChange={(e) => setAddNotes(e.target.value)}
                            placeholder="e.g. changed creative"
                            className="h-9 text-[12px] rounded-md border-gray-200"
                        />
                    </div>
                    <div className="md:col-span-2 flex items-end">
                        <Button
                            onClick={handleAdd}
                            disabled={upsertMutation.isPending || !addDate}
                            className="w-full h-8 rounded-md text-[11px] font-semibold gap-1.5"
                        >
                            {upsertMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save
                        </Button>
                    </div>
                </div>
                <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                    <span className="font-semibold">Spend</span> and <span className="font-semibold">leads</span> are entered manually from your ad platform.
                    Confirmed orders, delivered orders, cost-per-X metrics and revenue are computed automatically from orders
                    matching <span className="font-semibold capitalize">{campaign.platform}</span> on each day.
                </p>
            </div>

            {/* Entries table */}
            <div className="border border-gray-100 rounded-xl bg-white overflow-hidden">
                {daily.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 space-y-3">
                        <CalendarIcon className="w-8 h-8 text-gray-200" />
                        <div className="text-center space-y-1">
                            <p className="text-[12px] font-semibold text-brand-navy">No entries yet</p>
                            <p className="text-[10px] text-gray-400 max-w-xs">Add your first daily entry above. Orders for matching days will auto-attribute.</p>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400 sticky left-0 bg-white">Date</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Spend</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Leads</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Confirmed</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Delivered</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPL</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPC</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPD</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Conf %</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Liv %</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Revenue</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400 pr-3">Actions</th>
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
                                                'border-b border-gray-50 transition-colors tabular-nums',
                                                isEditing ? 'bg-gray-50' : 'hover:bg-gray-50'
                                            )}
                                        >
                                            <td className="px-3 py-2 text-[11px] font-semibold text-brand-navy sticky left-0 bg-white">
                                                {format(new Date(d.date), 'EEE dd MMM yyyy')}
                                            </td>
                                            <td className="text-right px-3 py-2">
                                                {isEditing ? (
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        value={editSpend}
                                                        onChange={(e) => setEditSpend(e.target.value)}
                                                        className="h-7 w-20 ml-auto rounded-md border-gray-200 text-[11px] text-right"
                                                    />
                                                ) : (
                                                    <span className="text-[11px] font-semibold text-brand-navy/80">{fmtCurFull(d.spend, currency)}</span>
                                                )}
                                            </td>
                                            <td className="text-right px-3 py-2">
                                                {isEditing ? (
                                                    <Input
                                                        type="number"
                                                        value={editLeads}
                                                        onChange={(e) => setEditLeads(e.target.value)}
                                                        className="h-7 w-16 ml-auto rounded-md border-gray-200 text-[11px] text-right"
                                                    />
                                                ) : (
                                                    <span className="text-[11px] text-brand-navy/80">{fmtNum(d.leads)}</span>
                                                )}
                                            </td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{fmtNum(d.confirmed)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-emerald-600 font-semibold">{fmtNum(d.delivered)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{fmtPct(d.confirmRate)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{fmtPct(d.deliveryRate)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] font-semibold text-brand-navy/80">{fmtCurFull(d.revenue, currency)}</td>
                                            <td className="text-right px-3 py-2 pr-3">
                                                {isEditing ? (
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={() => saveEdit(entry)}
                                                            disabled={upsertMutation.isPending}
                                                            className="h-8 w-8 rounded-md text-emerald-600 hover:bg-emerald-50"
                                                        >
                                                            <Check className="w-3.5 h-3.5" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={() => setEditingId(null)}
                                                            className="h-8 w-8 rounded-md text-gray-400 hover:bg-gray-100"
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
                                                            className="h-8 w-8 rounded-md text-gray-400 hover:bg-gray-100"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            onClick={() => setToDelete(entry)}
                                                            className="h-8 w-8 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50"
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
                                    <tr className="bg-brand-navy text-white tabular-nums font-semibold">
                                        <td className="px-3 py-2.5 sticky left-0 bg-brand-navy text-[9px] uppercase tracking-[0.18em]">Totaux</td>
                                        <td className="text-right px-3 py-2.5 text-[11px]">{fmtCurFull(totals.spend, currency)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px]">{fmtNum(totals.leads)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px]">{fmtNum(totals.confirmed)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px]">{fmtNum(totals.delivered)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{fmtPct(totals.confirmRate)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{fmtPct(totals.deliveryRate)}</td>
                                        <td className="text-right px-3 py-2.5 text-[11px]">{fmtCurFull(totals.revenue, currency)}</td>
                                        <td className="pr-3" />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}
            </div>

            <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
                <AlertDialogContent className="rounded-xl border-gray-100 shadow-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[15px] font-semibold text-brand-navy">Delete entry?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[12px] text-gray-500">
                            Remove the entry for {toDelete && format(new Date(toDelete.entry_date), 'PPP')}. This only deletes the spend/leads row — orders themselves are not affected.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="h-8 rounded-md text-[11px] font-semibold">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}
                            disabled={deleteMutation.isPending}
                            className="h-8 rounded-md text-[11px] font-semibold bg-red-600 hover:bg-red-700"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default CampaignManage;
