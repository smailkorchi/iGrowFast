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
import { Card, CardContent } from '@/components/ui/card';
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
import { fmtCur, fmtCurFull, fmtNum, fmtNumCompact, fmtPct } from '@/lib/formatNumbers';

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

    // Redirect non-owners back to the preview page.
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

    // Add-entry form state
    const [addDate, setAddDate] = useState<Date | null>(new Date());
    const [addSpend, setAddSpend] = useState<string>('');
    const [addLeads, setAddLeads] = useState<string>('');
    const [addNotes, setAddNotes] = useState<string>('');

    // Inline edit state
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
                <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
                <AlertCircle className="w-12 h-12 text-brand-navy/20" />
                <p className="text-muted-foreground">Campaign not found.</p>
                <Button onClick={() => navigate(basePath)} variant="outline" className="rounded-xl">
                    Back to campaigns
                </Button>
            </div>
        );
    }

    const currency = campaign.currency || 'MAD';

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex items-start gap-4 min-w-0">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate(basePath)}
                                className="h-12 w-12 rounded-2xl bg-white shadow-sm hover:bg-brand-navy hover:text-white transition-all shrink-0"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-2">
                                    <Badge
                                        className="rounded-full text-[10px] font-black uppercase px-2.5 py-0.5 border-none text-white shrink-0"
                                        style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                                    >
                                        <span className="mr-1">{getPlatformIcon(campaign.platform, 'w-3 h-3')}</span>
                                        {campaign.platform}
                                    </Badge>
                                    <Badge
                                        className={cn(
                                            'rounded-full text-[10px] font-black uppercase px-2.5 py-0.5 border-none',
                                            campaign.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
                                        )}
                                    >
                                        {campaign.status}
                                    </Badge>
                                </div>
                                <h1 className="text-4xl font-extralight text-gray-900 mb-1 truncate">{campaign.name}</h1>
                                <p className="text-gray-500 font-light">Daily performance entries — inject spend and lead counts.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            <Button
                                onClick={() => navigate(`${basePath}/${campaign.id}`)}
                                variant="outline"
                                className="h-12 px-6 rounded-2xl font-bold text-xs uppercase tracking-widest border-brand-navy/10 gap-2"
                            >
                                <Eye className="w-4 h-4" /> Preview
                            </Button>
                        </div>
                    </div>

                    {/* Mini totals strip */}
                    {loadingMetrics ? (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-6">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} className="h-24 rounded-3xl bg-white/60" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-6">
                            {[
                                { label: 'Total Spend', value: fmtCur(totals.spend, currency), sub: `${totals.days} day${totals.days !== 1 ? 's' : ''}` },
                                { label: 'Leads', value: fmtNum(totals.leads), sub: 'injected' },
                                { label: 'Confirmed', value: fmtNum(totals.confirmed), sub: fmtPct(totals.confirmRate) },
                                { label: 'Delivered', value: fmtNum(totals.delivered), sub: fmtPct(totals.deliveryRate) },
                                { label: 'Revenue', value: fmtCur(totals.revenue, currency), sub: '—' },
                            ].map((s) => (
                                <div key={s.label} className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{s.label}</p>
                                    <p className="text-2xl font-black tabular-nums text-gray-900 tracking-tight mt-1">{s.value}</p>
                                    <p className="text-[11px] text-muted-foreground font-medium mt-0.5">{s.sub}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Add entry card */}
            <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur">
                <CardContent className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Plus className="w-4 h-4 text-brand-navy/60" />
                        <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Add / update daily entry</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                        <div className="md:col-span-3">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-2 block">Date</label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            'w-full h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-left font-bold text-brand-navy shadow-inner justify-start gap-2',
                                            !addDate && 'text-muted-foreground'
                                        )}
                                    >
                                        <CalendarIcon className="w-4 h-4 opacity-60" />
                                        {addDate ? format(addDate, 'PPP') : 'Pick a date'}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-2xl border-none" align="start">
                                    <CalendarComponent
                                        mode="single"
                                        selected={addDate ?? undefined}
                                        onSelect={(d) => setAddDate(d ?? null)}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                            {addDate && existingDates.has(format(addDate, 'yyyy-MM-dd')) && (
                                <p className="text-[10px] font-bold text-amber-600 mt-1.5 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" /> Will overwrite existing entry
                                </p>
                            )}
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-2 block">Spend</label>
                            <div className="relative">
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={addSpend}
                                    onChange={(e) => setAddSpend(e.target.value)}
                                    placeholder="0.00"
                                    className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy pr-12"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/30 text-[10px] font-bold">{currency}</span>
                            </div>
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-2 block">Leads</label>
                            <Input
                                type="number"
                                value={addLeads}
                                onChange={(e) => setAddLeads(e.target.value)}
                                placeholder="0"
                                className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy"
                            />
                        </div>
                        <div className="md:col-span-3">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-2 block">Notes (optional)</label>
                            <Input
                                value={addNotes}
                                onChange={(e) => setAddNotes(e.target.value)}
                                placeholder="e.g. changed creative"
                                className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-medium text-brand-navy"
                            />
                        </div>
                        <div className="md:col-span-2 flex items-end">
                            <Button
                                onClick={handleAdd}
                                disabled={upsertMutation.isPending || !addDate}
                                className="w-full h-12 rounded-2xl bg-brand-navy hover:bg-brand-navy/90 text-white font-bold text-xs uppercase tracking-widest gap-2"
                            >
                                {upsertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save
                            </Button>
                        </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
                        <span className="font-bold">Spend</span> and <span className="font-bold">leads</span> are entered manually from your ad
                        platform. Confirmed orders, delivered orders, cost-per-X metrics and revenue are computed automatically from orders
                        matching <span className="font-bold capitalize">{campaign.platform}</span> on each day.
                    </p>
                </CardContent>
            </Card>

            {/* Entries table */}
            <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur overflow-hidden">
                <CardContent className="p-0">
                    {daily.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 space-y-4">
                            <div className="w-16 h-16 rounded-full bg-brand-navy/[0.04] flex items-center justify-center">
                                <CalendarIcon className="w-7 h-7 text-brand-navy/20" />
                            </div>
                            <div className="text-center space-y-1">
                                <p className="text-base font-bold text-brand-navy">No entries yet</p>
                                <p className="text-xs text-muted-foreground max-w-xs">Add your first daily entry above. Orders for matching days will auto-attribute.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                        <th className="text-left px-6 py-3 sticky left-0 bg-white/95 backdrop-blur">Date</th>
                                        <th className="text-right px-3 py-3">Spend</th>
                                        <th className="text-right px-3 py-3">Leads</th>
                                        <th className="text-right px-3 py-3">Confirmed</th>
                                        <th className="text-right px-3 py-3">Delivered</th>
                                        <th className="text-right px-3 py-3">CPL</th>
                                        <th className="text-right px-3 py-3">CPC</th>
                                        <th className="text-right px-3 py-3">CPD</th>
                                        <th className="text-right px-3 py-3">Conf %</th>
                                        <th className="text-right px-3 py-3">Liv %</th>
                                        <th className="text-right px-3 py-3">Revenue</th>
                                        <th className="text-right px-3 py-3 pr-6">Actions</th>
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
                                                    'border-b border-brand-navy/[0.03] transition-colors tabular-nums',
                                                    isEditing ? 'bg-brand-navy/[0.04]' : 'hover:bg-brand-navy/[0.02]'
                                                )}
                                            >
                                                <td className="px-6 py-3 font-bold text-brand-navy sticky left-0 bg-white/95 backdrop-blur">
                                                    {format(new Date(d.date), 'EEE dd MMM yyyy')}
                                                </td>
                                                <td className="text-right px-3 py-3">
                                                    {isEditing ? (
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            value={editSpend}
                                                            onChange={(e) => setEditSpend(e.target.value)}
                                                            className="h-9 w-24 ml-auto rounded-xl bg-brand-navy/[0.06] border-none font-bold text-right"
                                                        />
                                                    ) : (
                                                        <span className="font-bold text-brand-navy">{fmtCurFull(d.spend, currency)}</span>
                                                    )}
                                                </td>
                                                <td className="text-right px-3 py-3">
                                                    {isEditing ? (
                                                        <Input
                                                            type="number"
                                                            value={editLeads}
                                                            onChange={(e) => setEditLeads(e.target.value)}
                                                            className="h-9 w-20 ml-auto rounded-xl bg-brand-navy/[0.06] border-none font-bold text-right"
                                                        />
                                                    ) : (
                                                        <span className="font-medium text-brand-navy/70">{fmtNum(d.leads)}</span>
                                                    )}
                                                </td>
                                                <td className="text-right px-3 py-3 text-brand-navy/60">{fmtNum(d.confirmed)}</td>
                                                <td className="text-right px-3 py-3 text-emerald-600 font-bold">{fmtNum(d.delivered)}</td>
                                                <td className="text-right px-3 py-3 text-brand-navy/50 text-xs">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                                <td className="text-right px-3 py-3 text-brand-navy/50 text-xs">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                                <td className="text-right px-3 py-3 text-brand-navy/50 text-xs">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                                <td className="text-right px-3 py-3 text-brand-navy/50 text-xs">{fmtPct(d.confirmRate)}</td>
                                                <td className="text-right px-3 py-3 text-brand-navy/50 text-xs">{fmtPct(d.deliveryRate)}</td>
                                                <td className="text-right px-3 py-3 font-bold text-brand-navy">{fmtCurFull(d.revenue, currency)}</td>
                                                <td className="text-right px-3 py-3 pr-6">
                                                    {isEditing ? (
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => saveEdit(entry)}
                                                                disabled={upsertMutation.isPending}
                                                                className="h-8 w-8 rounded-xl text-emerald-600 hover:bg-emerald-50"
                                                            >
                                                                <Check className="w-4 h-4" />
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => setEditingId(null)}
                                                                className="h-8 w-8 rounded-xl text-brand-navy/50 hover:bg-brand-navy/5"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => startEdit(entry)}
                                                                className="h-8 w-8 rounded-xl text-brand-navy/50 hover:bg-brand-navy/5"
                                                            >
                                                                <Edit2 className="w-4 h-4" />
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                onClick={() => setToDelete(entry)}
                                                                className="h-8 w-8 rounded-xl text-red-500/60 hover:text-red-600 hover:bg-red-50"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
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
                                        <tr className="bg-brand-navy text-white tabular-nums font-black">
                                            <td className="px-6 py-4 sticky left-0 bg-brand-navy text-[10px] uppercase tracking-widest">Totaux</td>
                                            <td className="text-right px-3 py-4">{fmtCurFull(totals.spend, currency)}</td>
                                            <td className="text-right px-3 py-4">{fmtNum(totals.leads)}</td>
                                            <td className="text-right px-3 py-4">{fmtNum(totals.confirmed)}</td>
                                            <td className="text-right px-3 py-4">{fmtNum(totals.delivered)}</td>
                                            <td className="text-right px-3 py-4 text-xs text-white/70">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                            <td className="text-right px-3 py-4 text-xs text-white/70">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                            <td className="text-right px-3 py-4 text-xs text-white/70">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                            <td className="text-right px-3 py-4 text-xs text-white/70">{fmtPct(totals.confirmRate)}</td>
                                            <td className="text-right px-3 py-4 text-xs text-white/70">{fmtPct(totals.deliveryRate)}</td>
                                            <td className="text-right px-3 py-4">{fmtCurFull(totals.revenue, currency)}</td>
                                            <td className="pr-6" />
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
                <AlertDialogContent className="rounded-[32px] border-none shadow-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-2xl font-bold text-brand-navy">Delete entry?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Remove the entry for {toDelete && format(new Date(toDelete.entry_date), 'PPP')}. This only deletes the spend/leads row
                            — orders themselves are not affected.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl font-bold">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}
                            disabled={deleteMutation.isPending}
                            className="rounded-xl font-bold bg-red-600 hover:bg-red-700"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default CampaignManage;
