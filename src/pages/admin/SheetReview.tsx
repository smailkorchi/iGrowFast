import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { subscribeEcomBus } from '@/lib/ecomBus';
import {
    Loader2, CheckCircle2, AlertTriangle, Eye, FileSpreadsheet, Sparkles, Trash2, ChevronsUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
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
    order_items?: Array<{ id: string; product_id: string | null; quantity: number; unit_price: number; product?: { name: string | null; code: string | null } | null }>;
    sheet_ingest_rows?: Array<{ raw: Record<string, unknown> | null; status: string | null; sheet_row_number: number | null }>;
}
interface Opt { value: string; label: string; }

const DRAFT_SELECT = `
    id, name, phone, address, price, source_name, master_city_id,
    master_cities ( name ),
    order_items ( id, product_id, quantity, unit_price, product:products ( name, code ) ),
    sheet_ingest_rows ( raw, status, sheet_row_number )
`;

const SheetReview = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [viewing, setViewing] = useState<DraftRow | null>(null);
    const [toDiscard, setToDiscard] = useState<DraftRow | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    // editable copy of the parsed order while reviewing
    const [edit, setEdit] = useState({ name: '', phone: '', address: '', price: '', cityId: '', cityName: '', productId: '', productLabel: '', qty: '1' });

    useEffect(() => {
        if (!viewing) return;
        const item = viewing.order_items?.[0];
        setEdit({
            name: viewing.name || '',
            phone: viewing.phone || '',
            address: viewing.address || '',
            price: viewing.price != null ? String(viewing.price) : '',
            cityId: viewing.master_city_id || '',
            cityName: viewing.master_cities?.name || '',
            productId: item?.product_id || '',
            productLabel: item?.product?.name || item?.product?.code || '',
            qty: item?.quantity != null ? String(item.quantity) : '1',
        });
    }, [viewing]);

    const { data: drafts, isLoading } = useQuery({
        queryKey: ['sheet-review-drafts', activeBusinessId],
        staleTime: 5 * 60 * 1000, // SheetReview audit: drafts arrive via 'review_pending' broadcast; refs static
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const rows = await fetchAllRows('orders', DRAFT_SELECT, { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }, { column: 'source_review_status', op: 'eq', value: 'pending' }, { column: 'date_deleted', op: 'is', value: null }] });
            return (rows as any[]).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()) as unknown as DraftRow[];
        },
        enabled: !!activeBusinessId,
    });

    // city + product options for the edit pickers (cached; cities are global)
    const { data: cities } = useQuery({
        queryKey: ['review-cities'],
        queryFn: async () => fetchAllRows<{ id: string; name: string }>('master_cities', 'id, name', { orderBy: 'name' }),
        staleTime: 1000 * 60 * 30,
    });
    const { data: products } = useQuery({
        queryKey: ['review-products', activeBusinessId],
        staleTime: 5 * 60 * 1000, // SheetReview audit: drafts arrive via 'review_pending' broadcast; refs static
        queryFn: async () => {
            const { data } = await (supabase as any).from('products').select('id, name, code').eq('active', true).eq('DigiCom Business', activeBusinessId);
            return (data || []) as { id: string; name: string; code: string }[];
        },
        enabled: !!activeBusinessId,
    });
    const cityOpts: Opt[] = useMemo(() => (cities || []).map((c) => ({ value: c.id, label: c.name })), [cities]);
    const productOpts: Opt[] = useMemo(() => (products || []).map((p) => ({ value: p.id, label: p.name || p.code })), [products]);

    // W7 R1a: rides the layout-owned ecom:biz broadcast (topic is already scoped
    // to the active business). 'order' INSERTs flag review_pending when a
    // sheet-imported draft lands in the review inbox.
    useEffect(() => {
        if (!activeBusinessId) return;
        return subscribeEcomBus((event) => {
            if (event.type === 'order' && event.payload.op === 'INSERT' && event.payload.review_pending) {
                queryClient.invalidateQueries({ queryKey: ['sheet-review-drafts'] });
                toast({ title: 'New order from sheet', description: 'A draft just arrived and is waiting for your review.' });
            }
        });
    }, [activeBusinessId, queryClient, toast]);

    // persist any edits made in the popup, then approve
    const saveEdits = async (d: DraftRow) => {
        const priceNum = edit.price.trim() === '' ? null : Number(edit.price);
        await (supabase.from('orders') as any).update({
            name: edit.name.trim() || null,
            phone: edit.phone.trim() || null,
            address: edit.address.trim() || null,
            master_city_id: edit.cityId || null,
            price: priceNum,
            raw_price: priceNum,
        }).eq('id', d.id);

        const item = d.order_items?.[0];
        if (edit.productId) {
            const qty = Math.max(1, parseInt(edit.qty || '1', 10) || 1);
            if (item?.id) {
                await (supabase.from('order_items') as any).update({ product_id: edit.productId, quantity: qty, unit_price: (priceNum ?? 0) / qty }).eq('id', item.id);
            } else {
                await (supabase.from('order_items') as any).insert({ order_id: d.id, product_id: edit.productId, quantity: qty, unit_price: (priceNum ?? 0) / qty, 'DigiCom Business': activeBusinessId });
            }
        }
    };

    const approveMutation = useMutation({
        mutationFn: async (d: DraftRow) => {
            await saveEdits(d);
            const { data, error } = await supabase.rpc('approve_sheet_order' as never, { p_order_id: d.id } as never);
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
        onError: (e: Error) => toast({ title: 'Cannot approve yet', description: e.message, variant: 'destructive' }),
    });

    const discardMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase.from('orders') as any).update({ date_deleted: new Date().toISOString() }).eq('id', id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sheet-review-drafts'] });
            setToDiscard(null); setViewing(null);
            toast({ title: 'Draft discarded', description: 'Removed from review. It will not be re-imported.' });
        },
        onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    const bulkApproveMutation = useMutation({
        mutationFn: async (ids: string[]) => {
            let ok = 0, fail = 0;
            for (const id of ids) {
                try {
                    const { data, error } = await supabase.rpc('approve_sheet_order' as never, { p_order_id: id } as never);
                    const res = data as unknown as { ok?: boolean };
                    if (error || !res?.ok) fail++; else ok++;
                } catch { fail++; }
            }
            return { ok, fail };
        },
        onSuccess: ({ ok, fail }) => {
            queryClient.invalidateQueries({ queryKey: ['sheet-review-drafts'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            setSelected(new Set());
            toast({ title: `${ok} approved`, description: fail ? `${fail} still need attention (missing city/phone) — review them individually.` : 'All selected drafts are now live.' });
        },
        onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    const bulkDiscardMutation = useMutation({
        mutationFn: async (ids: string[]) => {
            const { error } = await (supabase.from('orders') as any).update({ date_deleted: new Date().toISOString() }).in('id', ids);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sheet-review-drafts'] });
            setSelected(new Set());
            toast({ title: 'Drafts discarded' });
        },
        onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    const stats = useMemo(() => {
        const list = drafts || [];
        return { total: list.length, needsReview: list.filter((d) => d.sheet_ingest_rows?.[0]?.status === 'needs_review').length };
    }, [drafts]);
    const isReady = (d: DraftRow) => (d.sheet_ingest_rows?.[0]?.status ?? 'ready') !== 'needs_review';

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Sales channels · Review inbox
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">Sheet review</h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Orders pulled from your sheets land here as drafts. Nothing goes live until you approve it — check what arrived, fix it if needed, approve or discard.
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
                    <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
                ) : !drafts?.length ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-green/10 border border-ant-green/25 flex items-center justify-center mb-4">
                            <CheckCircle2 className="w-5 h-5 text-ant-green" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">Inbox clear</h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2">No drafts waiting. New sheet orders will appear here automatically.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 px-1 min-h-9">
                            <label className="inline-flex items-center gap-2 text-[12px] text-ant-mid cursor-pointer select-none">
                                <input type="checkbox"
                                    checked={selected.size > 0 && selected.size === drafts.length}
                                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < drafts.length; }}
                                    onChange={(e) => setSelected(e.target.checked ? new Set(drafts.map((x) => x.id)) : new Set())}
                                    className="h-4 w-4 rounded border-ant-line accent-ant-ink cursor-pointer" />
                                {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
                            </label>
                            {selected.size > 0 && (
                                <div className="flex items-center gap-2">
                                    <Button variant="ghost" onClick={() => bulkDiscardMutation.mutate([...selected])} disabled={bulkDiscardMutation.isPending}
                                        className="h-9 px-4 rounded-full text-[12px] font-semibold text-ant-rose hover:bg-ant-rose/10 gap-1.5 cursor-pointer">
                                        {bulkDiscardMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Discard {selected.size}
                                    </Button>
                                    <Button onClick={() => bulkApproveMutation.mutate([...selected])} disabled={bulkApproveMutation.isPending}
                                        className="h-9 px-4 rounded-full text-[12px] font-semibold bg-ant-ink hover:bg-ant-ink/90 text-white gap-1.5 cursor-pointer">
                                        {bulkApproveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve {selected.size}
                                    </Button>
                                </div>
                            )}
                        </div>
                        <div className="rounded-2xl border border-ant-line overflow-hidden divide-y divide-ant-line">
                        {drafts.map((d) => {
                            const item = d.order_items?.[0];
                            return (
                                <div key={d.id} className={cn('flex items-center gap-4 px-4 py-3 transition-colors', selected.has(d.id) ? 'bg-ant-orange/[0.06]' : 'bg-ant-ink/[0.025] hover:bg-ant-ink/[0.05]')}>
                                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)}
                                        className="h-4 w-4 rounded border-ant-line accent-ant-ink cursor-pointer shrink-0" />
                                    <div className="w-8 h-8 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
                                        <FileSpreadsheet className="w-4 h-4 text-ant-mid" />
                                    </div>
                                    <div className="min-w-0 flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5">
                                        <Cell label="Customer" value={d.name} missing={!d.name} />
                                        <Cell label="Phone" value={d.phone} missing={!d.phone} mono />
                                        <Cell label="City" value={d.master_cities?.name} missing={!d.master_city_id} missingLabel="unresolved" />
                                        <Cell label="Product" value={item?.product?.name || item?.product?.code} mutedMissing missingLabel="none" />
                                    </div>
                                    {!isReady(d) && (
                                        <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange shrink-0">
                                            <AlertTriangle className="w-3 h-3" /> Needs attention
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <Button variant="ghost" size="icon" onClick={() => setToDiscard(d)} title="Discard"
                                            className="h-9 w-9 rounded-full text-ant-mid hover:text-ant-rose hover:bg-ant-rose/10 cursor-pointer">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" onClick={() => setViewing(d)}
                                            className="h-9 px-3 rounded-full text-[12px] font-semibold text-ant-ink hover:bg-ant-ink/5 gap-1.5 cursor-pointer">
                                            <Eye className="w-3.5 h-3.5" /> Review
                                        </Button>
                                        <Button onClick={() => approveMutation.mutate(d)} disabled={approveMutation.isPending}
                                            className="h-9 px-4 rounded-full text-[12px] font-semibold bg-ant-ink hover:bg-ant-ink/90 text-white gap-1.5 cursor-pointer">
                                            {approveMutation.isPending && approveMutation.variables?.id === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                        </div>
                    </div>
                )}

                {/* Review + edit popup */}
                <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
                    <DialogContent className="max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-2xl overflow-hidden">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Row {viewing?.sheet_ingest_rows?.[0]?.sheet_row_number ?? '—'} · Edit &amp; approve
                            </div>
                            <DialogTitle className="font-display text-[20px] tracking-tight text-ant-ink">What the sheet sent vs. what we parsed</DialogTitle>
                            <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Fix anything that came in wrong, then approve. Approval validates the order and makes it live.
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
                            <div className="rounded-xl border border-ant-line bg-ant-paper p-4 space-y-2.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ant-mid">
                                    <Sparkles className="w-3 h-3" /> Parsed order — editable
                                </div>
                                <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))} className="h-9 text-[12px]" /></Field>
                                <Field label="Phone"><Input value={edit.phone} onChange={(e) => setEdit((s) => ({ ...s, phone: e.target.value }))} className="h-9 text-[12px]" /></Field>
                                <Field label="City">
                                    <Picker placeholder="Pick a city" search="Search cities…" valueLabel={edit.cityName} options={cityOpts}
                                        onSelect={(o) => setEdit((s) => ({ ...s, cityId: o.value, cityName: o.label }))} />
                                </Field>
                                <Field label="Address"><Input value={edit.address} onChange={(e) => setEdit((s) => ({ ...s, address: e.target.value }))} className="h-9 text-[12px]" /></Field>
                                <Field label="Product">
                                    <Picker placeholder="Pick a product (optional)" search="Search products…" valueLabel={edit.productLabel} options={productOpts}
                                        onSelect={(o) => setEdit((s) => ({ ...s, productId: o.value, productLabel: o.label }))} />
                                </Field>
                                <div className="grid grid-cols-2 gap-2.5">
                                    <Field label="Qty"><Input type="number" value={edit.qty} onChange={(e) => setEdit((s) => ({ ...s, qty: e.target.value }))} className="h-9 text-[12px]" /></Field>
                                    <Field label="Price"><Input type="number" value={edit.price} onChange={(e) => setEdit((s) => ({ ...s, price: e.target.value }))} className="h-9 text-[12px]" /></Field>
                                </div>
                            </div>
                        </div>
                        <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2 sm:justify-between">
                            <Button variant="ghost" onClick={() => viewing && setToDiscard(viewing)}
                                className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-rose hover:bg-ant-rose/10 gap-1.5 cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5" /> Discard
                            </Button>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" onClick={() => setViewing(null)}
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer">Close</Button>
                                <Button onClick={() => viewing && approveMutation.mutate(viewing)} disabled={approveMutation.isPending}
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-ink hover:bg-ant-ink/90 text-white gap-2 cursor-pointer">
                                    {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Save &amp; approve
                                </Button>
                            </div>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Discard confirm */}
                <AlertDialog open={!!toDiscard} onOpenChange={(o) => !o && setToDiscard(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" /> Discard draft
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] tracking-tight text-ant-ink">Remove this draft?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Discarding <span className="not-italic font-semibold text-ant-ink">{toDiscard?.name || 'this row'}</span> removes it from review. It won&apos;t be re-imported from the sheet.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => toDiscard && discardMutation.mutate(toDiscard.id)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer">
                                {discardMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}<Trash2 className="w-3.5 h-3.5" /> Discard
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

const Cell = ({ label, value, missing, missingLabel = 'missing', mono, mutedMissing }: { label: string; value?: string | null; missing?: boolean; missingLabel?: string; mono?: boolean; mutedMissing?: boolean }) => (
    <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-ant-mid">{label}</p>
        <p className={cn('text-[13px] truncate', mono && 'tabular-nums', (missing) ? 'text-ant-rose' : 'text-ant-ink')}>
            {value || (missing ? missingLabel : mutedMissing ? <span className="text-ant-mid">{missingLabel}</span> : '—')}
        </p>
    </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ant-mid">{label}</p>
        {children}
    </div>
);

const Picker = ({ valueLabel, options, onSelect, placeholder, search }: { valueLabel: string; options: Opt[]; onSelect: (o: Opt) => void; placeholder: string; search: string }) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const filtered = useMemo(() => {
        const qq = q.trim().toLowerCase();
        return (qq ? options.filter((o) => o.label.toLowerCase().includes(qq)) : options).slice(0, 50);
    }, [q, options]);
    return (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
            <PopoverTrigger asChild>
                <button type="button" className={cn('h-9 w-full flex items-center justify-between gap-2 rounded-md border border-ant-line bg-ant-paper px-3 text-[12px] cursor-pointer', valueLabel ? 'text-ant-ink' : 'text-ant-mid')}>
                    <span className="truncate">{valueLabel || placeholder}</span>
                    <ChevronsUpDown className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[260px] rounded-xl border-ant-line" align="start">
                <Command shouldFilter={false}>
                    <CommandInput value={q} onValueChange={setQ} placeholder={search} className="text-[12px]" />
                    <CommandList>
                        <CommandEmpty className="py-4 text-center text-[12px] text-ant-mid">No match.</CommandEmpty>
                        {filtered.map((o) => (
                            <CommandItem key={o.value} value={o.value} onSelect={() => { onSelect(o); setOpen(false); setQ(''); }} className="text-[12px] cursor-pointer">
                                {o.label}
                            </CommandItem>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

export default SheetReview;
