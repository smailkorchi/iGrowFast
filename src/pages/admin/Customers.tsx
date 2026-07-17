import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useToast } from '@/hooks/use-toast';
import {
    Search,
    ShoppingBag,
    ArrowUpRight,
    Filter,
    Download,
    ChevronsUpDown,
    X,
    ChevronLeft,
    ChevronRight,
    Users as UsersIcon,
    Coins,
    TrendingUp,
    Truck,
    Activity,
    type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';

/**
 * D7b (docs/d7-recon/02-pages.md §1) — the last unbounded full-order-table
 * download in the app is gone.
 *
 * BEFORE: `useQuery(['customers-derived'])` fetchAllRows()'d EVERY non-deleted,
 * non-pending order of the business (2 104 rows + 3 embeds, measured) on every
 * page mount to render 12 rows, then did the phone grouping, the filtering, the
 * search, the sort, the pagination and the KPI strip in a client-side Map.
 *
 * AFTER: three RPCs from mig 20260715040000 —
 *   customers_list_page  ONE keyset page (D1 cursor-stack precedent:
 *                        src/pages/admin/Orders.tsx:729-798)
 *   customers_kpis       the KPI strip (UNFILTERED — see below)
 *   customer_orders      the drill-down dialog's order list + chart, gated on
 *                        dialog open
 * All three are SECURITY INVOKER + admin-gated; the aggregates, the tier, the
 * interaction score and the last-status pill are now computed server-side.
 *
 * `handleExport` is untouched: it already paged the real `customers` table at
 * 1000/batch and was never part of the defect.
 *
 * CALLER TRAPS carried over from the migration header — read before editing:
 *   * `phone` and `phone_normalized` are DIFFERENT strings. `phone` is the raw
 *     digit display value; `phone_normalized` is the canonical key and the ONLY
 *     valid p_phone_normalized for customer_orders. Passing `phone` silently
 *     returns an EMPTY drill-down, not an error.
 *   * `next_cursor` is JSON null (not an absent key) on the last page — falsy in
 *     JS, so `if (next)` is the correct guard.
 *
 * RENDERED-SURFACE DEVIATIONS (both forced by the keyset, both flagged in the
 * migration header):
 *   * Numbered pagination (page N / totalPages) cannot survive a keyset cursor —
 *     Prev/Next only, exactly as D1 did to admin/Orders. The "Total customers"
 *     KPI still carries the real total (customers_kpis.total).
 *   * The "Showing X of Y customers" hint is DROPPED. X was `filteredData.length`
 *     — a FILTERED total. No RPC returns one (customers_kpis is deliberately
 *     unfiltered, see below), and printing page_count there would read "Showing
 *     12 of 1719" on every page — a false statement, not a preserved surface.
 *
 * The KPI strip is UNFILTERED on purpose: the old `stats` (:386-395) reduced over
 * `customers` — the raw derived array — NOT over `filteredData`. Search and the
 * status filters never moved those three counters, and customers_kpis(p_business)
 * takes no filter params so they cannot start moving silently.
 */

/** Group label derived from the master semantic flags (replaces the old free-text category). */
function orderStatusGroup(s: { is_new: boolean; is_paid: boolean; is_unpaid: boolean; is_confirmed: boolean; is_cancelled: boolean; is_callback: boolean; is_return: boolean; is_postponed: boolean; is_relaunch: boolean }) {
    if (s.is_new) return 'Nouveau';
    if (s.is_paid) return 'Payé';
    if (s.is_unpaid) return 'Impayé';
    if (s.is_confirmed) return 'Confirmé';
    if (s.is_cancelled) return 'Annulé';
    if (s.is_callback) return 'Rappel';
    if (s.is_return) return 'Retour';
    if (s.is_postponed) return 'Reporté';
    if (s.is_relaunch) return 'Relance';
    return 'Autre';
}
function pkgStatusGroup(s: { is_delivered: boolean; is_returned: boolean; is_shipped: boolean; is_cancelled: boolean; is_postponed: boolean; is_recheck: boolean; is_new: boolean }) {
    if (s.is_delivered) return 'Livré';
    if (s.is_returned) return 'Retour';
    if (s.is_shipped) return 'En livraison';
    if (s.is_cancelled) return 'Annulé';
    if (s.is_postponed) return 'Reporté';
    if (s.is_recheck) return 'Recheck';
    if (s.is_new) return 'Nouveau';
    return 'Autre';
}

// --- Types (the `customers_list_page` / `customer_orders` row shapes) ---

/** One row of `customer_orders(p_business, p_phone_normalized).orders`. */
interface CustomerOrder {
    id: string;
    date: string;
    price: number;
    shipping_cost: number;
    order_status_id: string;
    package_status_id: string | null;
    status: {
        label: string;
        color: string;
    };
    city_name: string;
}

/**
 * One row of `customers_list_page(...).rows`.
 * `customer_id` is nullable by design: the row set is driven by the ORDERS
 * aggregate LEFT JOINed to `customers`, so a trigger miss degrades to
 * name/city 'Unknown' instead of dropping the customer from the list.
 */
interface CustomerRow {
    customer_id: string | null;
    phone_normalized: string;
    phone: string;
    name: string;
    city: string;
    totalOrders: number;
    totalSpent: number;
    avgOrderValue: number | null;
    lastOrderDate: string | null;
    firstOrderDate: string | null;
    /** 'New' is never emitted — it was the old Map-insert default, overwritten
     *  before any render (dead tier, flagged in the migration, not reproduced). */
    status: 'High Value' | 'Mid Value' | 'Low Value' | 'New';
    interactionScore: number;
    lastStatus: { label: string | null; color: string | null } | null;
}

interface CustomersPage {
    rows: CustomerRow[];
    page_count: number;
    next_cursor: CustomerCursor | null;
}

interface CustomerCursor {
    ts: string | null;
    num: number | null;
    key: string;
}

interface CustomerKpis {
    total: number;
    revenue: number;
    avgValue: number;
}

const PAGE_SIZE = 12;

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const CustomerKpi: React.FC<{
    label: string;
    value: string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
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
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const valueTierPill = (status: CustomerRow['status']) => {
    if (status === 'High Value') return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' };
    if (status === 'Mid Value') return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };
    if (status === 'New') return { bg: 'bg-ant-ink/5', border: 'border-ant-line', text: 'text-ant-ink', dot: 'bg-ant-ink' };
    return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' };
};

/** The list renders `lastOrderDate` through date-fns. It is nullable in the RPC
 *  contract (coalesced from '-infinity'), so never hand `new Date(null)` to
 *  format() — that throws RangeError and takes the whole table down. */
const safeDay = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy');
};

const CSV_HEADER = [
    'Name',
    'Phone',
    'Phone Normalized',
    'City',
    'Address',
    'Total Orders',
    'Total Spent',
    'First Order',
    'Last Order',
    'Tags',
    'Notes',
    'Source',
];

function toCsvCell(v: unknown): string {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join('|') : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

const Customers = () => {
    const statusCats = useStatusCategories();
    const { toast } = useToast();
    const [isExporting, setIsExporting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    // Hold the SELECTION KEY, not a snapshot of the row: the dialog's header +
    // KPI tiles must not freeze at click time while the drill-down table below
    // them refetches live (a realtime bump or a refetch would leave the tiles
    // claiming "3 orders / 1 115 MAD" above a 4-row table). `lastSelectedRef`
    // keeps the last known row so the dialog can still render its closing
    // animation after the key leaves the current page.
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const lastSelectedRef = useRef<CustomerRow | null>(null);
    const [sortBy, setSortBy] = useState<'recency' | 'value' | 'frequency'>('recency');
    const [orderStatusFilterIds, setOrderStatusFilterIds] = useState<string[]>([]);
    const [packageStatusFilterIds, setPackageStatusFilterIds] = useState<string[]>([]);
    const [orderStatusFilterOpen, setOrderStatusFilterOpen] = useState(false);
    const [packageStatusFilterOpen, setPackageStatusFilterOpen] = useState(false);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const orderStatusGroups = useMemo(() => {
        const list = statusCats.orderStatuses.filter((s) => s.active !== false);
        const groups = [...new Set(list.map(orderStatusGroup))];
        return groups.map((g) => ({
            category: g,
            heading: g,
            items: list.filter((s) => orderStatusGroup(s) === g).sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0)),
        }));
    }, [statusCats.orderStatuses]);

    const packageStatusGroups = useMemo(() => {
        const list = statusCats.packageStatuses;
        const groups = [...new Set(list.map(pkgStatusGroup))];
        return groups.map((g) => ({
            category: g,
            heading: g,
            items: list.filter((s) => pkgStatusGroup(s) === g).sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0)),
        }));
    }, [statusCats.packageStatuses]);

    const toggleOrderStatusFilter = (id: string) => {
        setOrderStatusFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const togglePackageStatusFilter = (id: string) => {
        setPackageStatusFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    // The search box drives an RPC now, so it is debounced (D1 precedent,
    // admin/Orders.tsx:666-675) — otherwise every keystroke is a round-trip.
    // NOT trimmed: the old filter was `name.toLowerCase().includes(searchQuery
    // .toLowerCase())`, which does not trim, so " a" must keep matching names
    // containing " a". The RPC does `like_escape(nullif(p_search, ''))`, so ''
    // means "no filter" exactly as `includes('') === true` did.
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery), 350);
        return () => clearTimeout(t);
    }, [searchQuery]);

    // Filter/sort state → RPC params, 1:1. Empty arrays travel as null: the RPC
    // treats null as "no filter", mirroring the old `.length === 0` checks.
    const listParams = useMemo(() => ({
        p_business: activeBusinessId,
        p_search: debouncedSearch || null,
        p_sort: sortBy,
        p_status_ids: orderStatusFilterIds.length > 0 ? orderStatusFilterIds : null,
        p_package_ids: packageStatusFilterIds.length > 0 ? packageStatusFilterIds : null,
    }), [activeBusinessId, debouncedSearch, sortBy, orderStatusFilterIds, packageStatusFilterIds]);

    // Keyset cursor STACK — Prev pops, Next pushes the page's next_cursor.
    // The page number is implicit (stack depth + 1). D1 precedent.
    const [cursorStack, setCursorStack] = useState<CustomerCursor[]>([]);
    const cursor = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1] : null;
    const page = cursorStack.length + 1;

    // Snap back to page 1 whenever the filter/sort/search surface mutates —
    // otherwise a cursor minted under the old params strands the user on a page
    // that no longer exists (and a cursor from another sort is incoherent).
    const paramsKey = useMemo(() => JSON.stringify(listParams), [listParams]);
    useEffect(() => {
        setCursorStack((prev) => (prev.length > 0 ? [] : prev));
    }, [paramsKey]);

    const {
        data: pageData,
        isPending: listPending,
        isFetching: listFetching,
        isError: listIsError,
        error: listError,
        refetch: refetchList,
    } = useQuery<CustomersPage>({
        queryKey: ['customers-page', activeBusinessId, listParams, cursor],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('customers_list_page', {
                ...listParams,
                p_cursor_ts: cursor?.ts ?? null,
                p_cursor_num: cursor?.num ?? null,
                p_cursor_key: cursor?.key ?? null,
                p_limit: PAGE_SIZE,
            });
            if (error) throw error;
            return data as CustomersPage;
        },
        enabled: !!activeBusinessId,
        staleTime: 60 * 1000,
        refetchOnMount: 'always',
        // C7 (OR-4 class): freshness rides the ecom:biz broadcast seam (these keys
        // are in its order/parcel invalidation set) — focus refetch of an
        // O(business) aggregate per admin per tab-switch is a fleet-scale storm.
        refetchOnWindowFocus: false,
        // keepPreviousData: the current page stays visible while the next loads.
        placeholderData: (prev) => prev,
    });

    const {
        data: kpis,
        isPending: kpisPending,
        isError: kpisIsError,
        refetch: refetchKpis,
    } = useQuery<CustomerKpis>({
        queryKey: ['customers-kpis', activeBusinessId],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('customers_kpis', {
                p_business: activeBusinessId,
            });
            if (error) throw error;
            return data as CustomerKpis;
        },
        enabled: !!activeBusinessId,
        staleTime: 60 * 1000,
        refetchOnMount: 'always',
        // C7 (OR-4 class): freshness rides the ecom:biz broadcast seam (these keys
        // are in its order/parcel invalidation set) — focus refetch of an
        // O(business) aggregate per admin per tab-switch is a fleet-scale storm.
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
    });

    const rows = useMemo(() => (pageData?.rows ?? []), [pageData]);

    // Resolve the selected row LIVE from the current page so the dialog's money
    // tiles move with the drill-down table instead of freezing at click time.
    const selectedCustomer = useMemo(() => {
        if (!selectedKey) return null;
        const live = rows.find((r: CustomerRow) => r.phone_normalized === selectedKey);
        if (live) lastSelectedRef.current = live;
        return live ?? lastSelectedRef.current;
    }, [rows, selectedKey]);
    const setSelectedCustomer = (c: CustomerRow | null) => {
        if (c) lastSelectedRef.current = c;
        setSelectedKey(c?.phone_normalized ?? null);
    };

    // Treat the pre-auth window (no activeBusinessId yet → query disabled →
    // isPending stays true) as loading, so we never flash an empty state before
    // the query has even run.
    const listLoading = listPending || !activeBusinessId;
    const kpisLoading = kpisPending || !activeBusinessId;

    // A failed RPC must NOT leave the page as a permanent skeleton: every block
    // below gates on `isPending`, which never resolves on error. Surface the
    // failure with a retry instead (D5 standing rule 3 / D3 review).
    const loadFailed = (listIsError && !pageData) || (kpisIsError && !kpis);

    // If the current cursor page went empty under us (the filtered set shrank),
    // snap back to page 1 — a keyset cursor cannot clamp to a "last page" the
    // way the old client-side slice did.
    useEffect(() => {
        if (!listFetching && pageData && pageData.page_count === 0 && cursorStack.length > 0) {
            setCursorStack([]);
        }
    }, [listFetching, pageData, cursorStack.length]);

    // Drill-down. Gated on the dialog actually being open — the Dialog stays
    // mounted, so an ungated query would fire for every row ever selected.
    // NOTE the trap: p_phone_normalized takes `phone_normalized`, NOT `phone`.
    const {
        data: detail,
        isPending: detailPending,
        isError: detailIsError,
        refetch: refetchDetail,
    } = useQuery<{ orders: CustomerOrder[] }>({
        queryKey: ['customer-orders', activeBusinessId, selectedCustomer?.phone_normalized],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('customer_orders', {
                p_business: activeBusinessId,
                p_phone_normalized: selectedCustomer!.phone_normalized,
            });
            if (error) throw error;
            return data as { orders: CustomerOrder[] };
        },
        enabled: !!activeBusinessId && !!selectedCustomer?.phone_normalized,
        staleTime: 60 * 1000,
    });

    const detailOrders = detail?.orders ?? [];

    const handleExport = async () => {
        if (!activeBusinessId) {
            toast({ title: 'No business selected', variant: 'destructive' });
            return;
        }
        setIsExporting(true);
        try {
            const PAGE = 1000;
            let from = 0;
            const rows: any[] = [];
            while (true) {
                const { data: batch, error } = await (supabase as any)
                    .from('customers')
                    .select('name, phone, phone_normalized, city_name, address, total_orders, total_spent, first_order_at, last_order_at, tags, notes, source')
                    .eq('DigiCom Business', activeBusinessId)
                    .order('last_order_at', { ascending: false, nullsFirst: false })
                    .range(from, from + PAGE - 1);
                if (error) throw error;
                if (!batch || batch.length === 0) break;
                rows.push(...batch);
                if (batch.length < PAGE) break;
                from += PAGE;
            }

            if (rows.length === 0) {
                toast({ title: 'No customers to export', description: 'The customer table is empty for this business.' });
                return;
            }

            const csvRows = [CSV_HEADER.join(',')];
            for (const r of rows) {
                csvRows.push(
                    [
                        r.name,
                        r.phone,
                        r.phone_normalized,
                        r.city_name,
                        r.address,
                        r.total_orders ?? 0,
                        r.total_spent ?? 0,
                        r.first_order_at ? new Date(r.first_order_at).toISOString() : '',
                        r.last_order_at ? new Date(r.last_order_at).toISOString() : '',
                        Array.isArray(r.tags) ? r.tags.join('|') : '',
                        r.notes,
                        r.source,
                    ]
                        .map(toCsvCell)
                        .join(','),
                );
            }
            const csv = '﻿' + csvRows.join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            toast({ title: 'Exported', description: `${rows.length} customer row(s) downloaded.` });
        } catch (e: any) {
            toast({ title: 'Export failed', description: e?.message || 'Unknown error', variant: 'destructive' });
        } finally {
            setIsExporting(false);
        }
    };

    const chartData = useMemo(() => {
        // customer_orders returns date DESC; the chart reads left-to-right in
        // time, so reverse — identical to the old `[...orders].reverse()`.
        return [...detailOrders].reverse().map((o) => ({
            date: format(new Date(o.date), 'MMM dd'),
            amount: o.price,
            fullDate: o.date,
        }));
    }, [detailOrders]);

    if (loadFailed) {
        return (
            <div className="ant-surface flex items-center justify-center h-[60vh]">
                <div className="text-center max-w-md px-6">
                    <UsersIcon className="w-12 h-12 text-ant-mid mx-auto mb-4" strokeWidth={1.5} />
                    <h2 className="font-display text-[22px] font-semibold text-ant-ink mb-1 tracking-tight">
                        Clients indisponibles
                    </h2>
                    <p className="font-serif italic text-[13px] text-ant-mid mb-4">
                        {(listError as Error)?.message || 'Le chargement du répertoire clients a échoué.'}
                    </p>
                    <button
                        type="button"
                        onClick={() => { refetchList(); refetchKpis(); }}
                        disabled={listFetching}
                        className="inline-flex items-center gap-2 rounded-xl border border-ant-line bg-ant-paper px-4 py-2 text-[12px] font-semibold text-ant-ink hover:bg-ant-light disabled:opacity-60 cursor-pointer"
                    >
                        {listFetching ? 'Chargement…' : 'Réessayer'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            People · Lifetime ledger
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Customers
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every phone number becomes a story — the first order, the loyalty, the value accrued across every return.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleExport}
                        disabled={isExporting}
                        className="h-10 px-5 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 shrink-0 cursor-pointer disabled:opacity-60"
                    >
                        <Download className="w-3.5 h-3.5" />
                        {isExporting ? 'Exporting…' : 'Export'}
                    </Button>
                </header>

                {/* KPI strip — customers_kpis, business-wide and UNFILTERED (parity) */}
                {kpisLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4 animate-pulse h-[100px]" />
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <CustomerKpi label="Total customers" value={(kpis?.total ?? 0).toLocaleString()} suffix="profiles" accent="ink" icon={UsersIcon} />
                        <CustomerKpi label="Lifetime value" value={Math.round(kpis?.revenue ?? 0).toLocaleString()} suffix="MAD" accent="green" icon={TrendingUp} />
                        <CustomerKpi label="Avg. customer value" value={Math.round(kpis?.avgValue ?? 0).toLocaleString()} suffix="MAD" accent="orange" icon={Coins} />
                    </section>
                )}

                {/* Toolbar */}
                <div className="space-y-2">
                    <div className="flex flex-col xl:flex-row gap-2 items-stretch xl:items-center justify-between">
                        <div className="relative w-full xl:w-[320px] shrink-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                            <Input
                                placeholder="Search by name, phone, city..."
                                className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full xl:flex-1 xl:justify-end">
                            <Popover open={orderStatusFilterOpen} onOpenChange={setOrderStatusFilterOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className={cn(
                                            'h-10 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light justify-between gap-2 text-[12px] font-semibold text-ant-ink sm:min-w-[170px]',
                                            orderStatusFilterIds.length > 0 && 'border-ant-orange/40 bg-ant-orange/5'
                                        )}
                                    >
                                        <span className="flex items-center gap-2 truncate">
                                            <ShoppingBag className="w-3.5 h-3.5 text-ant-mid" />
                                            <span className="truncate">
                                                {orderStatusFilterIds.length === 0
                                                    ? 'Order status'
                                                    : `${orderStatusFilterIds.length} order status${orderStatusFilterIds.length > 1 ? 'es' : ''}`}
                                            </span>
                                        </span>
                                        <ChevronsUpDown className="w-3 h-3 text-ant-mid" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-[min(100vw-2rem,380px)] p-0 rounded-2xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]"
                                    align="end"
                                    onWheel={(e) => e.stopPropagation()}
                                >
                                    <Command className="rounded-2xl">
                                        <CommandInput placeholder="Search order statuses…" className="h-11" />
                                        <CommandList className="max-h-[min(55vh,300px)]">
                                            <CommandEmpty className="text-[12px] text-ant-mid py-4 font-serif italic">No matching status.</CommandEmpty>
                                            {orderStatusGroups.map((g) => (
                                                <CommandGroup key={g.category} heading={g.heading}>
                                                    {g.items.map((s) => (
                                                        <CommandItem
                                                            key={s.id}
                                                            value={`${s.label} ${g.category}`}
                                                            onSelect={() => toggleOrderStatusFilter(s.id)}
                                                            className="flex cursor-pointer items-center gap-2 rounded-lg aria-selected:bg-ant-light"
                                                        >
                                                            <Checkbox
                                                                checked={orderStatusFilterIds.includes(s.id)}
                                                                className="pointer-events-none border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                            />
                                                            <span
                                                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                                style={{ backgroundColor: s.color || '#8B8680' }}
                                                            />
                                                            <span className="font-medium text-ant-ink text-[12px]">{s.label}</span>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            ))}
                                        </CommandList>
                                    </Command>
                                    <div className="flex items-center justify-between gap-2 border-t border-ant-line px-3 py-2.5">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light rounded-full cursor-pointer"
                                            onClick={() => setOrderStatusFilterIds([])}
                                        >
                                            Clear all
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 rounded-full px-4 cursor-pointer"
                                            onClick={() => setOrderStatusFilterOpen(false)}
                                        >
                                            Done
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>

                            <Popover open={packageStatusFilterOpen} onOpenChange={setPackageStatusFilterOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className={cn(
                                            'h-10 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light justify-between gap-2 text-[12px] font-semibold text-ant-ink sm:min-w-[170px]',
                                            packageStatusFilterIds.length > 0 && 'border-ant-orange/40 bg-ant-orange/5'
                                        )}
                                    >
                                        <span className="flex items-center gap-2 truncate">
                                            <Truck className="w-3.5 h-3.5 text-ant-mid" />
                                            <span className="truncate">
                                                {packageStatusFilterIds.length === 0
                                                    ? 'Package status'
                                                    : `${packageStatusFilterIds.length} package status${packageStatusFilterIds.length > 1 ? 'es' : ''}`}
                                            </span>
                                        </span>
                                        <ChevronsUpDown className="w-3 h-3 text-ant-mid" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-[min(100vw-2rem,380px)] p-0 rounded-2xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]"
                                    align="end"
                                    onWheel={(e) => e.stopPropagation()}
                                >
                                    <Command className="rounded-2xl">
                                        <CommandInput placeholder="Search package statuses…" className="h-11" />
                                        <CommandList className="max-h-[min(55vh,300px)]">
                                            <CommandEmpty className="text-[12px] text-ant-mid py-4 font-serif italic">No matching status.</CommandEmpty>
                                            {packageStatusGroups.map((g) => (
                                                <CommandGroup key={g.category} heading={g.heading}>
                                                    {g.items.map((s) => (
                                                        <CommandItem
                                                            key={s.id}
                                                            value={`${s.label} ${g.category}`}
                                                            onSelect={() => togglePackageStatusFilter(s.id)}
                                                            className="flex cursor-pointer items-center gap-2 rounded-lg aria-selected:bg-ant-light"
                                                        >
                                                            <Checkbox
                                                                checked={packageStatusFilterIds.includes(s.id)}
                                                                className="pointer-events-none border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                            />
                                                            <span
                                                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                                style={{ backgroundColor: s.color || '#8B8680' }}
                                                            />
                                                            <span className="font-medium text-ant-ink text-[12px]">{s.label}</span>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            ))}
                                        </CommandList>
                                    </Command>
                                    <div className="flex items-center justify-between gap-2 border-t border-ant-line px-3 py-2.5">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light rounded-full cursor-pointer"
                                            onClick={() => setPackageStatusFilterIds([])}
                                        >
                                            Clear all
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 rounded-full px-4 cursor-pointer"
                                            onClick={() => setPackageStatusFilterOpen(false)}
                                        >
                                            Done
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {(orderStatusFilterIds.length > 0 || packageStatusFilterIds.length > 0) && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-10 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink gap-1.5 cursor-pointer"
                                    onClick={() => {
                                        setOrderStatusFilterIds([]);
                                        setPackageStatusFilterIds([]);
                                    }}
                                >
                                    <X className="w-3 h-3" />
                                    Reset
                                </Button>
                            )}

                            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                                <SelectTrigger className="w-full sm:w-[170px] h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink">
                                    <div className="flex items-center gap-2">
                                        <Filter className="w-3.5 h-3.5 text-ant-mid" />
                                        <SelectValue placeholder="Sort by" />
                                    </div>
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-ant-line">
                                    <SelectItem value="recency" className="text-[12px]">Most recent</SelectItem>
                                    <SelectItem value="value" className="text-[12px]">Highest value</SelectItem>
                                    <SelectItem value="frequency" className="text-[12px]">Most orders</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                {/* Customer Table.
                    The `rows.length === 0 && kpisLoading` arm is load-bearing: the
                    empty state below picks its copy off `kpis.total`, so rendering it
                    before the KPI query resolves would read `undefined` as 0 and
                    claim "No customer history yet" for a business that merely has an
                    active filter (standing rule 3 — never render a cold query's
                    default as fact). Both queries fire together, so this only ever
                    costs the few ms of skew, and ONLY on an empty page. */}
                {listLoading || (rows.length === 0 && kpisLoading) ? (
                    <div className="space-y-2">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-14 rounded-2xl bg-ant-light animate-pulse" />
                        ))}
                    </div>
                ) : rows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <UsersIcon className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {/* kpis.total is the UNFILTERED customer count — exactly what the
                                old `customers?.length` was, so this split is unchanged. */}
                            {kpis?.total ? 'No customers match these filters' : 'No customer history yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {kpis?.total
                                ? 'Relax the filters to bring the ledger back into view.'
                                : 'Each order you record will build a profile here — the ledger grows with every sale.'}
                        </p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Customer</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">City</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Orders</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Spent</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Last order</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Last status</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((customer) => {
                                        const tier = valueTierPill(customer.status);
                                        return (
                                            <tr
                                                // phone_normalized, not customer_id: the latter is
                                                // nullable (agg-driven LEFT JOIN) and would collide.
                                                key={customer.phone_normalized}
                                                className="hover:bg-ant-light/60 transition-colors border-b border-ant-line last:border-0 cursor-pointer"
                                                onClick={() => setSelectedCustomer(customer)}
                                            >
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-9 w-9 rounded-full bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink font-display font-semibold text-[12px] shrink-0">
                                                            {customer.name.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-display text-[13px] font-semibold text-ant-ink leading-tight truncate">
                                                                    {customer.name}
                                                                </p>
                                                                <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]', tier.bg, tier.border, tier.text)}>
                                                                    <span className={cn('h-1 w-1 rounded-full', tier.dot)} />
                                                                    {customer.status.replace(' Value', '')}
                                                                </span>
                                                            </div>
                                                            <p className="text-[11px] text-ant-mid tabular-nums mt-0.5">{customer.phone}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-[12px] text-ant-ink">{customer.city}</td>
                                                <td className="px-4 py-3 text-right text-[13px] font-semibold text-ant-ink tabular-nums">{customer.totalOrders}</td>
                                                <td className="px-4 py-3 text-right font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                    {customer.totalSpent.toLocaleString()} <span className="text-[11px] text-ant-mid font-normal">DH</span>
                                                </td>
                                                <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums">{safeDay(customer.lastOrderDate)}</td>
                                                <td className="px-4 py-3">
                                                    {customer.lastStatus?.label && (
                                                        <span
                                                            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                                                            style={{
                                                                backgroundColor: `${customer.lastStatus.color}12`,
                                                                borderColor: `${customer.lastStatus.color}40`,
                                                                color: customer.lastStatus.color ?? undefined,
                                                            }}
                                                        >
                                                            <span
                                                                className="h-1.5 w-1.5 rounded-full"
                                                                style={{ backgroundColor: customer.lastStatus.color ?? undefined }}
                                                            />
                                                            {customer.lastStatus.label}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-ant-mid">
                                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Pagination — keyset Prev/Next cursor stack (D1). A keyset has no
                    "page N of M": totalPages is unknowable without a filtered count,
                    so the page number stands alone and Next is driven by next_cursor. */}
                {(cursorStack.length > 0 || !!pageData?.next_cursor) && (
                    <div className="flex items-center justify-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setCursorStack((prev) => prev.slice(0, -1))}
                            disabled={cursorStack.length === 0 || listFetching}
                            className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-[12px] font-semibold text-ant-ink px-3 tabular-nums">
                            <span className="text-ant-mid font-normal">Page </span>{page}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                                const next = pageData?.next_cursor;
                                if (next) setCursorStack((prev) => [...prev, next]);
                            }}
                            disabled={!pageData?.next_cursor || listFetching}
                            className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                )}

                {/* Customer detail dialog */}
                <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
                    <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-ant-line bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] p-0 gap-0">
                        {selectedCustomer && (
                            <div className="ant-scroll">
                                {/* Editorial header */}
                                <div className="px-6 pt-6 pb-5 border-b border-ant-line">
                                    <div className="flex items-start gap-4">
                                        <div className="h-14 w-14 rounded-2xl bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink font-display font-semibold text-[22px] shrink-0">
                                            {selectedCustomer.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0 space-y-1.5">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                Customer · Profile
                                            </div>
                                            <h2 className="font-display text-[22px] leading-tight tracking-tight text-ant-ink truncate">
                                                {selectedCustomer.name}
                                            </h2>
                                            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ant-mid">
                                                <span className="tabular-nums">{selectedCustomer.phone}</span>
                                                <span>·</span>
                                                <span>{selectedCustomer.city}</span>
                                            </div>
                                        </div>
                                        {(() => {
                                            const tier = valueTierPill(selectedCustomer.status);
                                            return (
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] shrink-0', tier.bg, tier.border, tier.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
                                                    {selectedCustomer.status}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </div>

                                <div className="p-6 space-y-5">
                                    {/* KPI strip — straight off the list row, no second round-trip */}
                                    <section className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                                        <CustomerKpi label="Lifetime value" value={selectedCustomer.totalSpent.toLocaleString()} suffix="DH" accent="green" icon={TrendingUp} />
                                        <CustomerKpi label="Total orders" value={String(selectedCustomer.totalOrders)} suffix="orders" accent="ink" icon={ShoppingBag} />
                                        <CustomerKpi label="Avg. order" value={Math.round(selectedCustomer.avgOrderValue ?? 0).toLocaleString()} suffix="DH" accent="orange" icon={Coins} />
                                        <CustomerKpi label="Loyalty score" value={String(selectedCustomer.interactionScore)} suffix="pts" accent="rose" icon={Activity} />
                                    </section>

                                    {/* Chart */}
                                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="h-[3px] w-full bg-ant-orange" />
                                        <div className="p-5">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-3">
                                                <TrendingUp className="w-3 h-3" />
                                                Order history
                                            </div>
                                            <div className="h-[200px]">
                                                {/* Never paint an empty chart as fact while the
                                                    drill-down is still in flight (standing rule 3). */}
                                                {detailPending ? (
                                                    <div className="h-full w-full rounded-xl bg-ant-light animate-pulse" />
                                                ) : (
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                                            <defs>
                                                                <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#D97706" stopOpacity={0.3} />
                                                                    <stop offset="95%" stopColor="#D97706" stopOpacity={0} />
                                                                </linearGradient>
                                                            </defs>
                                                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#8B8680', fontSize: 10 }} dy={6} />
                                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8B8680', fontSize: 10 }} tickFormatter={(v) => `${v}`} />
                                                            <CartesianGrid vertical={false} stroke="#E6E1D6" strokeDasharray="3 3" />
                                                            <Tooltip
                                                                contentStyle={{
                                                                    borderRadius: '12px',
                                                                    border: '1px solid #E6E1D6',
                                                                    background: '#FAF9F4',
                                                                    fontSize: '12px',
                                                                    padding: '8px 12px',
                                                                    boxShadow: '0 16px 48px -20px rgba(20,20,19,0.2)',
                                                                }}
                                                                cursor={{ stroke: '#D97706', strokeWidth: 1 }}
                                                                formatter={(v: any) => [`${v} DH`, 'Amount']}
                                                            />
                                                            <Area type="monotone" dataKey="amount" stroke="#D97706" strokeWidth={1.75} fillOpacity={1} fill="url(#colorAmount)" activeDot={{ r: 4, strokeWidth: 0, fill: '#D97706' }} />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Orders table */}
                                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="px-5 py-3.5 border-b border-ant-line flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <ShoppingBag className="w-3 h-3" />
                                                Order history
                                            </div>
                                            {/* totalOrders (from the row), NOT detailOrders.length:
                                                same pool, same number, but known immediately — so the
                                                header never reads "0 orders" while the RPC is in
                                                flight. */}
                                            <span className="text-[11px] font-semibold text-ant-mid tabular-nums">
                                                {selectedCustomer.totalOrders} {selectedCustomer.totalOrders === 1 ? 'order' : 'orders'}
                                            </span>
                                        </div>
                                        {detailIsError && !detail ? (
                                            <div className="px-5 py-10 text-center">
                                                <p className="font-serif italic text-[13px] text-ant-mid mb-3">
                                                    L'historique des commandes n'a pas pu être chargé.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => refetchDetail()}
                                                    className="inline-flex items-center gap-2 rounded-xl border border-ant-line bg-ant-paper px-4 py-2 text-[12px] font-semibold text-ant-ink hover:bg-ant-light cursor-pointer"
                                                >
                                                    Réessayer
                                                </button>
                                            </div>
                                        ) : detailPending ? (
                                            <div className="p-4 space-y-2">
                                                {[1, 2, 3].map((i) => (
                                                    <div key={i} className="h-10 rounded-xl bg-ant-light animate-pulse" />
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table className="w-full">
                                                    <thead>
                                                        <tr className="border-b border-ant-line bg-ant-light/50">
                                                            <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Date</th>
                                                            <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Status</th>
                                                            <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">City</th>
                                                            <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Amount</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {detailOrders.map((order) => (
                                                            <tr key={order.id} className="hover:bg-ant-light/60 transition-colors border-b border-ant-line last:border-0">
                                                                <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums">{safeDay(order.date)}</td>
                                                                <td className="px-4 py-3">
                                                                    <span
                                                                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                                                                        style={{
                                                                            backgroundColor: `${order.status.color}12`,
                                                                            borderColor: `${order.status.color}40`,
                                                                            color: order.status.color,
                                                                        }}
                                                                    >
                                                                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: order.status.color }} />
                                                                        {order.status.label}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-[12px] text-ant-ink">{order.city_name}</td>
                                                                <td className="px-4 py-3 text-right font-display text-[13px] font-semibold text-ant-ink tabular-nums">
                                                                    {order.price.toLocaleString()} <span className="text-[10px] text-ant-mid font-normal">DH</span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default Customers;
