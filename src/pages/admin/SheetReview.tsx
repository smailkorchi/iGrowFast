import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Loader2, CheckCircle2, AlertTriangle, Eye, FileSpreadsheet, ArrowRight, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface DraftRow {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
    price: number | null;
    source_name: string | null;
    master_city_id: string | null;
    master_cities?: { name: string | null } | null;
    order_items?: Array<{ quantity: number; unit_price: number; product?: { name: string | null; code: string | null } | null }>;
    sheet_ingest_rows?: Array<{ raw: Record<string, unknown> | null; status: string | null; sheet_row_number: number | null; external_row_id: string | null }>;
}

const SheetReview = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [viewing, setViewing] = useState<DraftRow | null>(null);

    const { data: drafts, isLoading } = useQuery({
        queryKey: ['sheet-review-drafts', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('orders')
                .select(`
                    id, name, phone, address, price, source_name, master_city_id,
                    master_cities ( name ),
                    order_items ( quantity, unit_price, product:products ( name, code ) ),
                    sheet_ingest_rows ( raw, status, sheet_row_number, external_row_id )
                `)
                .eq('DigiCom Business', activeBusinessId)
                .eq('source_review_status', 'pending')
                .is('date_deleted', null)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as unknown as DraftRow[];
        },
        enabled: !!activeBusinessId,
    });

    // Realtime: a freshly synced draft pops in + a toast, no refresh needed.
    useEffect(() => {
        if (!activeBusinessId) return;
        const channel = supabase
            .channel(`sheet-review-${activeBusinessId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'orders',
                filter: `DigiCom Business=eq.${activeBusinessId}`,
            }, (payload: { new: { source_review_status?: string } }) => {
                if (payload.new?.source_review_status === 'pending') {
                    queryClient.invalidateQueries({ queryKey: ['sheet-review-drafts'] });
                    toast({ title: 'New order from sheet', description: 'A draft just arrived and is waiting for your review.' });
                }
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [activeBusinessId, queryClient, toast]);

    const approveMutation = useMutation({
        mutationFn: async (orderId: string) => {
            const { data, error } = await supabase.rpc('approve_sheet_order' as never, { p_order_id: orderId } as never);
            if (error) throw new Error(error.message);
            const res = data as unknown as { ok: boolean; error?: string };
            if (!res?.ok) throw new Error(res?.error || 'Approval failed');
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sheet-review-drafts'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            setViewing(null);
            toast({ title: 'Order approved', description: 'It is now live in your orders.' });
        },
        onError: (e: Error) => {
            toast({ title: 'Cannot approve yet', description: e.message, variant: 'destructive' });
        },
    });

    const stats = useMemo(() => {
        const list = drafts || [];
        const needsReview = list.filter((d) => d.sheet_ingest_rows?.[0]?.status === 'needs_review').length;
        return { total: list.length, needsReview };
    }, [drafts]);

    const isReady = (d: DraftRow) => (d.sheet_ingest_rows?.[0]?.status ?? 'ready') !== 'needs_review';

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Sales channels · Review inbox
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Sheet review
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Orders pulled from your sheets land here as drafts. Nothing goes live until you approve it — check what arrived, fix if needed, approve.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden shrink-0">
                        <div className="bg-ant-paper px-5 py-3">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Pending</p>
                            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums">{stats.total}</p>
                        </div>
                        <div className="bg-ant-paper px-5 py-3">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Needs attention</p>
                            <p className="font-display text-[22px] font-semibold text-ant-orange tabular-nums">{stats.needsReview}</p>
                        </div>
                    </div>
                </header>

                {isLoading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
                    </div>
                ) : !drafts?.length ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-green/10 border border-ant-green/25 flex items-center justify-center mb-4">
                            <CheckCircle2 className="w-5 h-5 text-ant-green" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">Inbox clear</h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2">No drafts waiting. New sheet orders will appear here automatically.</p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-ant-line overflow-hidden divide-y divide-ant-line">
                        {drafts.map((d) => {
                            const ready = isReady(d);
                            const item = d.order_items?.[0];
                            return (
                                <div key={d.id} className={cn('flex items-center gap-4 px-4 py-3 transition-colors',
                                    'bg-ant-ink/[0.025] hover:bg-ant-ink/[0.05]')}>
                                    <div className="w-8 h-8 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
                                        <FileSpreadsheet className="w-4 h-4 text-ant-mid" />
                                    </div>
                                    <div className="min-w-0 flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5">
                                        <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wide text-ant-mid">Customer</p>
                                            <p className="text-[13px] font-semibold text-ant-ink truncate">{d.name || <span className="text-ant-rose">— missing —</span>}</p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wide text-ant-mid">Phone</p>
                                            <p className="text-[13px] text-ant-ink tabular-nums truncate">{d.phone || <span className="text-ant-rose">—</span>}</p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wide text-ant-mid">City</p>
                                            <p className={cn('text-[13px] truncate', d.master_city_id ? 'text-ant-ink' : 'text-ant-rose')}>
                                                {d.master_cities?.name || (d.master_city_id ? '—' : 'unresolved')}
                                            </p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wide text-ant-mid">Product</p>
                                            <p className="text-[13px] text-ant-ink truncate">{item?.product?.name || item?.product?.code || <span className="text-ant-mid">none</span>}</p>
                                        </div>
                                    </div>
                                    {!ready && (
                                        <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange shrink-0">
                                            <AlertTriangle className="w-3 h-3" /> Needs attention
                                        </span>
                                    )}
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button variant="ghost" onClick={() => setViewing(d)}
                                            className="h-9 px-3 rounded-full text-[12px] font-semibold text-ant-ink hover:bg-ant-ink/5 gap-1.5 cursor-pointer">
                                            <Eye className="w-3.5 h-3.5" /> View
                                        </Button>
                                        <Button
                                            onClick={() => approveMutation.mutate(d.id)}
                                            disabled={approveMutation.isPending}
                                            className="h-9 px-4 rounded-full text-[12px] font-semibold bg-ant-ink hover:bg-ant-ink/90 text-white gap-1.5 cursor-pointer">
                                            {approveMutation.isPending && approveMutation.variables === d.id
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <CheckCircle2 className="w-3.5 h-3.5" />}
                                            Approve
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Raw-vs-parsed popup */}
                <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
                    <DialogContent className="max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-2xl overflow-hidden">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Row {viewing?.sheet_ingest_rows?.[0]?.sheet_row_number ?? '—'} · Draft review
                            </div>
                            <DialogTitle className="font-display text-[20px] tracking-tight text-ant-ink">What the sheet sent vs. what we parsed</DialogTitle>
                            <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Confirm the parse is right, then approve. Approval validates the order and makes it live.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto ant-scroll">
                            <div className="rounded-xl border border-ant-line bg-ant-light/40 p-4">
                                <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ant-mid mb-3">
                                    <FileSpreadsheet className="w-3 h-3" /> From the sheet
                                </div>
                                <dl className="space-y-1.5">
                                    {Object.entries(viewing?.sheet_ingest_rows?.[0]?.raw || {}).map(([k, v]) => (
                                        <div key={k} className="flex items-start justify-between gap-3 text-[12px]">
                                            <dt className="text-ant-mid shrink-0 max-w-[45%] truncate">{k}</dt>
                                            <dd className="text-ant-ink font-medium text-right break-words">{String(v ?? '')}</dd>
                                        </div>
                                    ))}
                                    {!viewing?.sheet_ingest_rows?.[0]?.raw && <p className="text-[12px] text-ant-mid italic">No raw row stored.</p>}
                                </dl>
                            </div>
                            <div className="rounded-xl border border-ant-line bg-ant-paper p-4">
                                <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ant-mid mb-3">
                                    <Sparkles className="w-3 h-3" /> Parsed order
                                </div>
                                <dl className="space-y-1.5 text-[12px]">
                                    <Parsed label="Name" value={viewing?.name} missing={!viewing?.name} />
                                    <Parsed label="Phone" value={viewing?.phone} missing={!viewing?.phone} />
                                    <Parsed label="City" value={viewing?.master_cities?.name} missing={!viewing?.master_city_id} missingLabel="unresolved" />
                                    <Parsed label="Address" value={viewing?.address} />
                                    <Parsed label="Source" value={viewing?.source_name} />
                                    <Parsed label="Product" value={viewing?.order_items?.[0]?.product?.name || viewing?.order_items?.[0]?.product?.code} missingLabel="none" />
                                    <Parsed label="Qty" value={viewing?.order_items?.[0]?.quantity?.toString()} />
                                    <Parsed label="Price" value={viewing?.price != null ? `${viewing.price} MAD` : null} />
                                </dl>
                            </div>
                        </div>
                        <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                            <Button variant="ghost" onClick={() => setViewing(null)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer">
                                Close
                            </Button>
                            <Button
                                onClick={() => viewing && approveMutation.mutate(viewing.id)}
                                disabled={approveMutation.isPending}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-ink hover:bg-ant-ink/90 text-white gap-2 cursor-pointer">
                                {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                                Approve order
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

const Parsed = ({ label, value, missing, missingLabel = 'missing' }: { label: string; value?: string | null; missing?: boolean; missingLabel?: string }) => (
    <div className="flex items-start justify-between gap-3">
        <dt className="text-ant-mid shrink-0">{label}</dt>
        <dd className={cn('text-right break-words font-medium', missing || !value ? 'text-ant-rose' : 'text-ant-ink')}>
            {value || (missing ? missingLabel : '—')}
        </dd>
    </div>
);

export default SheetReview;
