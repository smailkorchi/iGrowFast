/**
 * OrdersExportWizard — 4-step export assistant for the admin Orders page.
 *
 *   1. Champs   — grouped column picker (registry in src/lib/ordersExport.ts)
 *   2. Filtres  — optional multi-selects fed by the SAME react-query keys the
 *                 page already uses (zero new lookups when the cache is warm)
 *   3. Portée   — row cap + date range (they combine) + CSV/XLSX format
 *   4. Résumé   — exact server-side count, then chunked export with progress
 *
 * Lazy-loaded from Orders.tsx (React.lazy) and mounted only while open, so it
 * costs nothing until the user clicks "Exporter".
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    AlertCircle, ArrowLeft, ArrowRight, CalendarRange, Check, ClipboardCheck, Download,
    FileSpreadsheet, FileText, ListChecks, Loader2, RotateCcw, Search, SlidersHorizontal,
    type LucideIcon,
} from 'lucide-react';
import {
    DEFAULT_EXPORT_KEYS, EXPORT_COLUMNS, EXPORT_GROUPS, EXPORT_SOURCES, HARD_EXPORT_CAP,
    countExport, runExport, saveExport,
    type ExportFilters, type ExportProgress,
} from '@/lib/ordersExport';

const nf = new Intl.NumberFormat('fr-FR');

type Step = 0 | 1 | 2 | 3;
type Phase = 'idle' | 'running' | 'done' | 'error';
type LimitChoice = 'all' | 100 | 200 | 500 | 1000 | 'custom';

const STEPS: { label: string; icon: LucideIcon }[] = [
    { label: 'Champs', icon: ListChecks },
    { label: 'Filtres', icon: SlidersHorizontal },
    { label: 'Portée', icon: CalendarRange },
    { label: 'Résumé', icon: ClipboardCheck },
];

const STEP_TITLES: { title: string; desc: string }[] = [
    { title: 'Choisir les champs', desc: 'Sélectionnez les colonnes à inclure dans le fichier.' },
    { title: 'Affiner les filtres', desc: 'Tous les filtres sont optionnels — sans filtre, tout l’historique est exportable.' },
    { title: 'Portée & format', desc: 'Limitez le volume, choisissez la période et le format du fichier.' },
    { title: 'Récapitulatif', desc: 'Vérifiez la sélection, puis lancez l’export.' },
];

const LIMIT_PILLS: { key: LimitChoice; label: string }[] = [
    { key: 'all', label: 'Toutes' },
    { key: 100, label: '100' },
    { key: 200, label: '200' },
    { key: 500, label: '500' },
    { key: 1000, label: '1000' },
    { key: 'custom', label: 'Personnalisé' },
];

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** 'yyyy-MM-dd' (native date input) → local-day ISO bound, null when empty/invalid. */
const dayToIso = (s: string, endOfDay: boolean): string | null => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return null;
    const dt = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};

const inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink focus-visible:ring-1 focus-visible:ring-ant-orange/40';
const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';

// ─── Small shared pieces ─────────────────────────────────────────────────────

const SectionHeader = ({ icon: Icon, title, hint, badge }: {
    icon: LucideIcon; title: string; hint?: string; badge?: number;
}) => (
    <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink shrink-0">
            <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ant-ink leading-none flex items-center gap-2">
                {title}
                {typeof badge === 'number' && badge > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-ant-orange text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                        {badge}
                    </span>
                )}
            </p>
            {hint && <p className="text-[11px] text-ant-mid mt-1">{hint}</p>}
        </div>
    </div>
);

const CheckSquare = ({ on, accent = 'ink' }: { on: boolean; accent?: 'ink' | 'orange' }) => (
    <span className={cn(
        'w-4 h-4 rounded-md flex items-center justify-center shrink-0 border transition',
        on
            ? accent === 'orange' ? 'bg-ant-orange border-ant-orange text-white' : 'bg-ant-ink border-ant-ink text-white'
            : 'border-ant-line',
    )}>
        {on && <Check className="w-3 h-3" />}
    </span>
);

interface PickItem { id: string; label: string; sub?: string; color?: string | null }

/** Multi-select list with select-all / clear, optional search, active-count badge. */
const MultiPick = ({ icon, title, hint, items, selected, onChange, searchable, emptyText }: {
    icon: LucideIcon;
    title: string;
    hint?: string;
    items: PickItem[];
    selected: string[];
    onChange: (ids: string[]) => void;
    searchable?: boolean;
    emptyText: string;
}) => {
    const [search, setSearch] = useState('');
    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter((i) => i.label.toLowerCase().includes(q) || (i.sub || '').toLowerCase().includes(q));
    }, [items, search]);
    const toggle = (id: string) =>
        onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

    return (
        <div className="rounded-2xl border border-ant-line p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <SectionHeader icon={icon} title={title} hint={hint} badge={selected.length} />
                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={() => onChange(items.map((i) => i.id))}
                        disabled={items.length === 0}
                        className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-ink hover:border-ant-ink/30 transition cursor-pointer disabled:opacity-40"
                    >
                        Tout
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange([])}
                        disabled={selected.length === 0}
                        className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:border-ant-ink/30 transition cursor-pointer disabled:opacity-40"
                    >
                        Effacer
                    </button>
                </div>
            </div>
            {searchable && (
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                    <Input className={cn(inputCls, 'pl-9 h-9')} placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
            )}
            <div className="max-h-40 overflow-y-auto ant-scroll grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {visible.map((item) => {
                    const on = selected.includes(item.id);
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            onClick={() => toggle(item.id)}
                            className={cn(
                                'flex items-center gap-2.5 p-2 rounded-xl border text-left transition cursor-pointer',
                                on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20',
                            )}
                        >
                            <CheckSquare on={on} accent="orange" />
                            {item.color && (
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                            )}
                            <span className="text-[12px] text-ant-ink truncate">
                                {item.label}
                                {item.sub && <span className="text-ant-mid"> · {item.sub}</span>}
                            </span>
                        </button>
                    );
                })}
                {visible.length === 0 && <p className="text-[11px] text-ant-mid px-1 sm:col-span-2">{emptyText}</p>}
            </div>
        </div>
    );
};

// ─── Wizard ──────────────────────────────────────────────────────────────────

interface OrdersExportWizardProps {
    isOpen: boolean;
    onClose: () => void;
    activeBusinessId: string | null;
}

export const OrdersExportWizard = ({ isOpen, onClose, activeBusinessId }: OrdersExportWizardProps) => {
    const { toast } = useToast();

    const [step, setStep] = useState<Step>(0);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(DEFAULT_EXPORT_KEYS));

    // Step 2 — filters (all optional)
    const [statusIds, setStatusIds] = useState<string[]>([]);
    const [packageStatusIds, setPackageStatusIds] = useState<string[]>([]);
    const [courierIds, setCourierIds] = useState<string[]>([]);
    const [sellerIds, setSellerIds] = useState<string[]>([]);
    const [cityIds, setCityIds] = useState<string[]>([]);
    const [sources, setSources] = useState<string[]>([]);

    // Step 3 — scope & format
    const [limitChoice, setLimitChoice] = useState<LimitChoice>('all');
    const [customLimit, setCustomLimit] = useState('2000');
    const [dateFromStr, setDateFromStr] = useState('');
    const [dateToStr, setDateToStr] = useState('');
    const [fileFormat, setFileFormat] = useState<'csv' | 'xlsx'>('csv');

    // Step 4 — run
    const [phase, setPhase] = useState<Phase>('idle');
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportedCount, setExportedCount] = useState(0);
    const [confirmClose, setConfirmClose] = useState(false);
    const closeTimerRef = useRef<number | null>(null);

    const reset = () => {
        setStep(0);
        setSelectedKeys(new Set(DEFAULT_EXPORT_KEYS));
        setStatusIds([]); setPackageStatusIds([]); setCourierIds([]);
        setSellerIds([]); setCityIds([]); setSources([]);
        setLimitChoice('all'); setCustomLimit('2000');
        setDateFromStr(''); setDateToStr('');
        setFileFormat('csv');
        setPhase('idle'); setProgress(null); setExportError(null); setExportedCount(0);
        setConfirmClose(false);
        if (closeTimerRef.current) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    };

    useEffect(() => { if (isOpen) reset(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); }, []);

    // ── Lookups — identical keys + queryFns to the Orders page, so a warm page
    // cache means zero extra requests. ─────────────────────────────────────────
    const { data: orderStatuses } = useQuery({
        queryKey: ['order-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('order_statuses')
                .select('id, code, label, ranking, color, show_in_order, show_in_quick_status')
                .eq('active', true)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
        enabled: isOpen && !!activeBusinessId,
    });

    const { data: packageStatuses } = useQuery({
        queryKey: ['package-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('package_statuses')
                .select('id, code, label, color')
                .eq('active', true)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
        enabled: isOpen && !!activeBusinessId,
    });

    const { data: cities } = useQuery({
        queryKey: ['cities-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return fetchAllRows<{ id: string; name: string; zone_id: string | null }>('master_cities', 'id, name, zone_id', { orderBy: 'name' });
        },
        enabled: isOpen && !!activeBusinessId,
    });

    const { data: couriers } = useQuery({
        queryKey: ['couriers-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, avatar_config')
                .eq('role', 'courier')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        },
        enabled: isOpen && !!activeBusinessId,
    });

    const { data: sellers } = useQuery({
        queryKey: ['sellers-commercial-v2', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, avatar_config, role')
                .eq('role', 'commercial')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        },
        enabled: isOpen && !!activeBusinessId,
    });

    // Resolves "Confirmée par" (confirmed_by_id has no embed in the export
    // select). Wizard-specific key — NOT the page's active-only
    // 'confirmers-dropdown': an export must also resolve names of since-
    // DEACTIVATED confirmers, and fetchAllRows dodges the silent 1000-row cap.
    const { data: confirmers } = useQuery({
        queryKey: ['export-confirmers', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return fetchAllRows<{ id: string; name: string | null }>('users', 'id, name', {
                filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }],
            });
        },
        enabled: isOpen && !!activeBusinessId,
        staleTime: 5 * 60_000,
    });

    const userNameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const u of ((confirmers ?? []) as { id: string; name: string | null }[])) {
            if (u?.id && u?.name) m.set(u.id, u.name);
        }
        return m;
    }, [confirmers]);

    // ── Derived state ─────────────────────────────────────────────────────────
    const customLimitNum = Math.floor(Number(customLimit));
    const customLimitValid = Number.isFinite(customLimitNum) && customLimitNum >= 1;
    const limit: number | null =
        limitChoice === 'all' ? null : limitChoice === 'custom' ? (customLimitValid ? customLimitNum : null) : limitChoice;

    const dateRangeInvalid = !!dateFromStr && !!dateToStr && dateFromStr > dateToStr;

    // "Tout" (full selection) = NO filter: semantically identical, and it keeps
    // big id lists (cities can be 1000+) out of the GET URL — the 8k-limit trap
    // the engine's IN_LIST_MAX guard exists for.
    const effectiveIds = (sel: string[], all: readonly unknown[] | undefined) =>
        all && all.length > 0 && sel.length >= all.length ? [] : sel;
    const filters: ExportFilters = useMemo(() => ({
        statusIds: effectiveIds(statusIds, orderStatuses),
        packageStatusIds: effectiveIds(packageStatusIds, packageStatuses),
        courierIds: effectiveIds(courierIds, couriers),
        sellerIds: effectiveIds(sellerIds, sellers),
        cityIds: effectiveIds(cityIds, cities),
        sources: effectiveIds(sources, EXPORT_SOURCES),
        dateFrom: dayToIso(dateFromStr, false),
        dateTo: dayToIso(dateToStr, true),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [statusIds, packageStatusIds, courierIds, sellerIds, cityIds, sources, dateFromStr, dateToStr,
        orderStatuses, packageStatuses, couriers, sellers, cities]);

    const activeFilterCount =
        [statusIds, packageStatusIds, courierIds, sellerIds, cityIds, sources].filter((a) => a.length > 0).length;

    const stepValid = (s: Step): boolean => {
        if (s === 0) return selectedKeys.size > 0;
        if (s === 2) return (limitChoice !== 'custom' || customLimitValid) && !dateRangeInvalid;
        return true;
    };

    // ── Exact count for the recap step ────────────────────────────────────────
    const filtersKey = JSON.stringify(filters);
    const { data: matchCount, isFetching: counting, isError: countFailed, refetch: refetchCount } = useQuery({
        queryKey: ['orders-export-count', activeBusinessId, filtersKey],
        queryFn: () => countExport(activeBusinessId as string, filters),
        enabled: isOpen && step === 3 && !!activeBusinessId,
        staleTime: 30 * 1000,
    });

    const effectiveTotal = matchCount === undefined
        ? null
        : limit !== null ? Math.min(limit, matchCount) : matchCount;
    const overCap = effectiveTotal !== null && effectiveTotal > HARD_EXPORT_CAP;
    const canExport =
        (phase === 'idle' || phase === 'error') &&
        !counting && !countFailed &&
        effectiveTotal !== null && effectiveTotal > 0 && !overCap &&
        selectedKeys.size > 0 && !!activeBusinessId;

    // ── Run ───────────────────────────────────────────────────────────────────
    const runExportNow = async () => {
        if (!activeBusinessId || phase === 'running' || phase === 'done') return;
        setPhase('running'); setExportError(null); setProgress(null);
        try {
            const columns = EXPORT_COLUMNS.filter((c) => selectedKeys.has(c.key));
            const res = await runExport({
                businessId: activeBusinessId,
                columns,
                filters,
                scope: { limit },
                ctx: { userNameById },
                onProgress: setProgress,
            });
            if (res.total === 0) throw new Error('Aucune commande ne correspond aux filtres.');
            const saved = await saveExport(fileFormat, res.headers, res.rows);
            if (saved.status === 'cancelled') { setPhase('idle'); setProgress(null); return; }
            if (saved.status === 'failed' || saved.status === 'unsupported') {
                throw new Error('Le fichier n’a pas pu être enregistré sur cet appareil.');
            }
            setExportedCount(res.total);
            setPhase('done');
            toast({
                title: 'Export terminé',
                description: `${nf.format(res.total)} commande${res.total > 1 ? 's' : ''} exportée${res.total > 1 ? 's' : ''} en ${fileFormat.toUpperCase()}.`,
            });
            // No auto-close: the precedent wizards let the user read the
            // success card and leave via Fermer.
        } catch (e) {
            setPhase('error');
            setExportError((e as Error)?.message || 'L’export a échoué.');
            toast({ title: 'Export impossible', description: (e as Error)?.message, variant: 'destructive' });
        }
    };

    // ── Close & keyboard ──────────────────────────────────────────────────────
    const requestClose = () => {
        if (phase === 'running') {
            // Never abandon a running export silently — and never no-op the X
            // without feedback either (it reads as a frozen dialog).
            toast({ title: 'Export en cours', description: 'Patientez, le fichier est en préparation.' });
            return;
        }
        // Step 0 closes instantly only while PRISTINE — a curated field
        // selection deserves the same confirmation as the later steps.
        const pristine =
            selectedKeys.size === DEFAULT_EXPORT_KEYS.length &&
            DEFAULT_EXPORT_KEYS.every((k) => selectedKeys.has(k));
        if (phase === 'done' || (step === 0 && pristine)) { onClose(); return; }
        setConfirmClose(true);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Enter') return;
        const tag = (e.target as HTMLElement)?.tagName;
        // INPUT excluded too: Enter in the city search / custom-limit / date
        // fields must not yank the user to the next step mid-typing.
        if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
        e.preventDefault();
        if (confirmClose || phase === 'running' || phase === 'done') return;
        if (step < 3) {
            if (stepValid(step)) setStep((s) => (s + 1) as Step);
        } else if (canExport) {
            void runExportNow();
        }
    };

    // ── Step 1 helpers ────────────────────────────────────────────────────────
    const toggleKey = (key: string) => {
        setSelectedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };
    const setGroup = (group: string, on: boolean) => {
        setSelectedKeys((prev) => {
            const next = new Set(prev);
            for (const c of EXPORT_COLUMNS) {
                if (c.group !== group) continue;
                if (on) next.add(c.key); else next.delete(c.key);
            }
            return next;
        });
    };

    const progressPct = progress && progress.total > 0
        ? Math.min(100, Math.round((progress.fetched / progress.total) * 100))
        : 0;

    const scopeSummary = useMemo(() => {
        const parts: string[] = [];
        parts.push(limit === null ? 'Toutes les commandes' : `${nf.format(limit)} max`);
        if (dateFromStr && dateToStr) parts.push(`du ${dateFromStr.split('-').reverse().join('/')} au ${dateToStr.split('-').reverse().join('/')}`);
        else if (dateFromStr) parts.push(`depuis le ${dateFromStr.split('-').reverse().join('/')}`);
        else if (dateToStr) parts.push(`jusqu’au ${dateToStr.split('-').reverse().join('/')}`);
        return parts.join(' · ');
    }, [limit, dateFromStr, dateToStr]);

    return (
        <Dialog open={isOpen} onOpenChange={(o) => { if (!o) requestClose(); }}>
            <DialogContent
                onKeyDown={handleKeyDown}
                className="max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col"
            >
                {/* Gradient hairline */}
                <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-orange/60 to-transparent" />

                <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-ant-ink text-white flex items-center justify-center shrink-0 shadow-sm">
                            <FileSpreadsheet className="w-5 h-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Exporter les commandes
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                {STEP_TITLES[step].title}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                {STEP_TITLES[step].desc}
                            </DialogDescription>
                        </div>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-2">
                        {STEPS.map((s, i) => {
                            const Icon = s.icon;
                            const done = i < step;
                            const current = i === step;
                            return (
                                <div key={s.label} className="flex items-center gap-2 flex-1 last:flex-none">
                                    <div className={cn(
                                        'inline-flex items-center gap-2 px-2.5 h-7 rounded-full border text-[10px] font-semibold uppercase tracking-[0.12em] transition',
                                        current ? 'bg-ant-ink text-white border-ant-ink'
                                            : done ? 'bg-ant-green/10 text-ant-green border-ant-green/30'
                                            : 'bg-ant-light text-ant-mid border-ant-line',
                                    )}>
                                        {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                                        {s.label}
                                    </div>
                                    {i < STEPS.length - 1 && (
                                        <div className={cn('h-px flex-1 transition', done ? 'bg-ant-green/40' : 'bg-ant-line')} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </DialogHeader>

                <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6">
                    {/* ── STEP 0 — CHAMPS ─────────────────────────────────────── */}
                    {step === 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <p className="text-[12px] font-semibold text-ant-ink tabular-nums">
                                    {nf.format(selectedKeys.size)} champ{selectedKeys.size > 1 ? 's' : ''} sélectionné{selectedKeys.size > 1 ? 's' : ''}
                                </p>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedKeys(new Set(EXPORT_COLUMNS.map((c) => c.key)))}
                                        className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-ink hover:border-ant-ink/30 transition cursor-pointer"
                                    >
                                        Tout sélectionner
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedKeys(new Set(DEFAULT_EXPORT_KEYS))}
                                        className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:border-ant-ink/30 transition cursor-pointer inline-flex items-center gap-1"
                                    >
                                        <RotateCcw className="w-3 h-3" /> Par défaut
                                    </button>
                                </div>
                            </div>

                            {EXPORT_GROUPS.map((g) => {
                                const cols = EXPORT_COLUMNS.filter((c) => c.group === g.key);
                                const onCount = cols.filter((c) => selectedKeys.has(c.key)).length;
                                const allOn = onCount === cols.length;
                                return (
                                    <div key={g.key} className="rounded-2xl border border-ant-line p-4 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-[13px] font-semibold text-ant-ink flex items-center gap-2">
                                                {g.label}
                                                <span className={cn(
                                                    'text-[10px] font-semibold tabular-nums px-1.5 h-[18px] rounded-full flex items-center border',
                                                    onCount > 0 ? 'bg-ant-ink/5 text-ant-ink border-ant-ink/15' : 'text-ant-mid border-ant-line',
                                                )}>
                                                    {onCount}/{cols.length}
                                                </span>
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => setGroup(g.key, !allOn)}
                                                className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:border-ant-ink/30 transition cursor-pointer"
                                            >
                                                {allOn ? 'Tout retirer' : 'Tout sélectionner'}
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                            {cols.map((c) => {
                                                const on = selectedKeys.has(c.key);
                                                return (
                                                    <button
                                                        key={c.key}
                                                        type="button"
                                                        role="checkbox"
                                                        aria-checked={on}
                                                        onClick={() => toggleKey(c.key)}
                                                        className={cn(
                                                            'flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer',
                                                            on ? 'border-ant-ink bg-ant-ink/5' : 'border-ant-line hover:border-ant-ink/20',
                                                        )}
                                                    >
                                                        <CheckSquare on={on} />
                                                        <span className="text-[12px] text-ant-ink truncate">{c.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── STEP 1 — FILTRES ────────────────────────────────────── */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <MultiPick
                                icon={ListChecks}
                                title="Statut commande"
                                items={((orderStatuses ?? []) as { id: string; label: string; color: string | null }[])
                                    .map((s) => ({ id: s.id, label: s.label, color: s.color }))}
                                selected={statusIds}
                                onChange={setStatusIds}
                                emptyText="Aucun statut."
                            />
                            <MultiPick
                                icon={ListChecks}
                                title="Statut colis"
                                items={((packageStatuses ?? []) as { id: string; label: string; color: string | null }[])
                                    .map((s) => ({ id: s.id, label: s.label, color: s.color }))}
                                selected={packageStatusIds}
                                onChange={setPackageStatusIds}
                                emptyText="Aucun statut colis."
                            />
                            <MultiPick
                                icon={SlidersHorizontal}
                                title="Livreur"
                                items={((couriers ?? []) as { id: string; name: string | null }[])
                                    .map((u) => ({ id: u.id, label: u.name || '—' }))}
                                selected={courierIds}
                                onChange={setCourierIds}
                                emptyText="Aucun livreur actif."
                            />
                            <MultiPick
                                icon={SlidersHorizontal}
                                title="Vendeur (assignée à)"
                                items={((sellers ?? []) as { id: string; name: string | null }[])
                                    .map((u) => ({ id: u.id, label: u.name || '—' }))}
                                selected={sellerIds}
                                onChange={setSellerIds}
                                emptyText="Aucun vendeur actif."
                            />
                            <MultiPick
                                icon={SlidersHorizontal}
                                title="Ville"
                                items={((cities ?? []) as { id: string; name: string }[])
                                    .map((c) => ({ id: c.id, label: c.name }))}
                                selected={cityIds}
                                onChange={setCityIds}
                                searchable
                                emptyText="Aucune ville trouvée."
                            />
                            <MultiPick
                                icon={SlidersHorizontal}
                                title="Source"
                                hint="Source déclarée de la commande (même liste que le filtre de la page)."
                                items={EXPORT_SOURCES.map((s) => ({ id: s, label: capitalize(s) }))}
                                selected={sources}
                                onChange={setSources}
                                emptyText="—"
                            />
                        </div>
                    )}

                    {/* ── STEP 2 — PORTÉE & FORMAT ────────────────────────────── */}
                    {step === 2 && (
                        <div className="space-y-5">
                            <div className="rounded-2xl border border-ant-line p-4 space-y-3">
                                <SectionHeader icon={CalendarRange} title="Nombre de commandes" hint="La limite s’applique aux commandes les plus récentes." />
                                <div className="flex items-center gap-2 flex-wrap">
                                    {LIMIT_PILLS.map((p) => (
                                        <button
                                            key={String(p.key)}
                                            type="button"
                                            onClick={() => setLimitChoice(p.key)}
                                            className={cn(
                                                'h-9 px-3.5 rounded-full text-[11px] font-semibold border transition cursor-pointer',
                                                limitChoice === p.key
                                                    ? 'bg-ant-ink text-white border-ant-ink shadow-sm'
                                                    : 'border-ant-line text-ant-mid hover:text-ant-ink hover:border-ant-ink/30',
                                            )}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                                {limitChoice === 'custom' && (
                                    <div className="space-y-1.5 max-w-[220px]">
                                        <label htmlFor="export-custom-limit" className={labelCls}>Nombre maximum</label>
                                        <Input
                                            id="export-custom-limit"
                                            type="number"
                                            min={1}
                                            max={HARD_EXPORT_CAP}
                                            className={inputCls}
                                            value={customLimit}
                                            onChange={(e) => setCustomLimit(e.target.value)}
                                        />
                                        {!customLimitValid && (
                                            <p className="text-[11px] font-medium text-ant-rose/90">Saisissez un nombre supérieur à 0.</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="rounded-2xl border border-ant-line p-4 space-y-3">
                                <SectionHeader
                                    icon={CalendarRange}
                                    title="Période (date de commande)"
                                    hint="Optionnelle — se combine avec la limite : la période filtre, la limite plafonne."
                                    badge={dateFromStr || dateToStr ? 1 : 0}
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label htmlFor="export-date-from" className={labelCls}>Du</label>
                                        <Input id="export-date-from" type="date" className={inputCls} value={dateFromStr} onChange={(e) => setDateFromStr(e.target.value)} max={dateToStr || undefined} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label htmlFor="export-date-to" className={labelCls}>Au</label>
                                        <Input id="export-date-to" type="date" className={inputCls} value={dateToStr} onChange={(e) => setDateToStr(e.target.value)} min={dateFromStr || undefined} />
                                    </div>
                                </div>
                                {dateRangeInvalid && (
                                    <p className="text-[11px] font-medium text-ant-rose/90">La date de début doit précéder la date de fin.</p>
                                )}
                            </div>

                            <div className="rounded-2xl border border-ant-line p-4 space-y-3">
                                <SectionHeader icon={FileSpreadsheet} title="Format du fichier" />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {([
                                        { key: 'csv' as const, icon: FileText, label: 'CSV', desc: 'Texte léger (séparateur « ; ») — Excel, Google Sheets.' },
                                        { key: 'xlsx' as const, icon: FileSpreadsheet, label: 'XLSX (Excel)', desc: 'Classeur Excel natif, feuille « Commandes ».' },
                                    ]).map((f) => {
                                        const Icon = f.icon;
                                        const active = fileFormat === f.key;
                                        return (
                                            <button
                                                key={f.key}
                                                type="button"
                                                onClick={() => setFileFormat(f.key)}
                                                className={cn(
                                                    'group relative text-left p-4 rounded-2xl border bg-ant-paper transition-all cursor-pointer flex items-start gap-3 overflow-hidden',
                                                    active ? 'border-transparent ring-2 ring-ant-ink/50 shadow-[0_16px_40px_-20px_rgba(20,20,19,0.3)]'
                                                        : 'border-ant-line hover:border-ant-ink/30 hover:shadow-sm',
                                                )}
                                            >
                                                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border bg-ant-ink/6 border-ant-ink/20 text-ant-ink">
                                                    <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                                                </div>
                                                <div className="min-w-0 pr-5">
                                                    <p className="font-display text-[14px] font-semibold text-ant-ink leading-tight">{f.label}</p>
                                                    <p className="text-[11.5px] text-ant-mid leading-snug mt-0.5">{f.desc}</p>
                                                </div>
                                                <span className={cn(
                                                    'absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center transition',
                                                    active ? 'bg-ant-ink text-white' : 'border border-ant-line text-transparent group-hover:border-ant-ink/30',
                                                )}>
                                                    <Check className="w-3 h-3" />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── STEP 3 — RÉCAPITULATIF ──────────────────────────────── */}
                    {step === 3 && (
                        <div className="space-y-5">
                            {/* Recap chips */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[
                                    { label: 'Champs', value: `${nf.format(selectedKeys.size)} colonne${selectedKeys.size > 1 ? 's' : ''}`, icon: ListChecks },
                                    { label: 'Filtres', value: activeFilterCount > 0 ? `${activeFilterCount} actif${activeFilterCount > 1 ? 's' : ''}` : 'Aucun', icon: SlidersHorizontal },
                                    { label: 'Portée', value: scopeSummary, icon: CalendarRange },
                                    { label: 'Format', value: fileFormat === 'csv' ? 'CSV' : 'XLSX (Excel)', icon: fileFormat === 'csv' ? FileText : FileSpreadsheet },
                                ].map((chip) => {
                                    const Icon = chip.icon;
                                    return (
                                        <div key={chip.label} className="flex items-center gap-3 p-3 rounded-2xl border border-ant-line bg-ant-light">
                                            <div className="w-9 h-9 rounded-lg flex items-center justify-center border bg-ant-ink/6 border-ant-ink/20 text-ant-ink shrink-0">
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className={labelCls}>{chip.label}</p>
                                                <p className="text-[12.5px] font-semibold text-ant-ink mt-0.5 truncate">{chip.value}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Live count / progress / result */}
                            {phase === 'done' ? (
                                <div className="rounded-2xl border border-ant-green/30 bg-gradient-to-b from-ant-green/8 to-transparent p-5 text-center">
                                    <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-green/15 border border-ant-green/30 flex items-center justify-center mb-3">
                                        <Check className="w-6 h-6 text-ant-green" />
                                    </div>
                                    <p className="font-display text-[16px] font-semibold text-ant-ink">Export terminé</p>
                                    <p className="text-[12px] text-ant-mid mt-1">
                                        {nf.format(exportedCount)} commande{exportedCount > 1 ? 's' : ''} exportée{exportedCount > 1 ? 's' : ''} · le fichier {fileFormat.toUpperCase()} a été remis au navigateur.
                                    </p>
                                </div>
                            ) : phase === 'running' ? (
                                <div className="rounded-2xl border border-ant-line p-5 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin text-ant-ink" />
                                        <p className="text-[12.5px] font-semibold text-ant-ink">
                                            Export en cours…
                                            {progress && progress.total > 0 && (
                                                <span className="text-ant-mid font-medium"> {nf.format(progress.fetched)} / {nf.format(progress.total)}</span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="h-2 rounded-full bg-ant-light border border-ant-line overflow-hidden">
                                        <div
                                            className="h-full bg-ant-ink rounded-full transition-all duration-300"
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                    <p className="text-[11px] text-ant-mid">
                                        {progress?.phase === 'serializing'
                                            ? 'Génération du fichier — ne fermez pas cette fenêtre.'
                                            : 'Récupération par lots de 1 000 commandes — ne fermez pas cette fenêtre.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-ant-line p-5">
                                    {counting ? (
                                        <p className="text-[12.5px] font-medium text-ant-mid flex items-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" /> Comptage des commandes…
                                        </p>
                                    ) : countFailed ? (
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-[12px] font-semibold text-ant-rose flex items-center gap-2">
                                                <AlertCircle className="w-4 h-4 shrink-0" /> Impossible de compter les commandes.
                                            </p>
                                            <Button
                                                variant="ghost"
                                                onClick={() => void refetchCount()}
                                                className="h-8 px-3 rounded-full border border-ant-line text-[11px] font-semibold text-ant-ink hover:border-ant-ink/30 shrink-0"
                                            >
                                                Réessayer
                                            </Button>
                                        </div>
                                    ) : effectiveTotal !== null && effectiveTotal === 0 ? (
                                        <p className="text-[12px] font-semibold text-ant-rose flex items-center gap-2">
                                            <AlertCircle className="w-4 h-4" /> Aucune commande ne correspond aux filtres — ajustez-les pour continuer.
                                        </p>
                                    ) : overCap ? (
                                        <p className="text-[12px] font-semibold text-ant-rose flex items-center gap-2">
                                            <AlertCircle className="w-4 h-4 shrink-0" />
                                            L’export dépasse la limite de sécurité de {nf.format(HARD_EXPORT_CAP)} lignes — réduisez la portée ou affinez les filtres.
                                        </p>
                                    ) : effectiveTotal !== null ? (
                                        <div>
                                            <p className="font-display text-[18px] font-semibold text-ant-ink tabular-nums">
                                                {nf.format(effectiveTotal)} commande{effectiveTotal > 1 ? 's' : ''} {effectiveTotal > 1 ? 'seront exportées' : 'sera exportée'}
                                            </p>
                                            {matchCount !== undefined && limit !== null && matchCount > limit && (
                                                <p className="text-[11.5px] text-ant-mid mt-1">
                                                    {nf.format(matchCount)} commandes correspondent — limitées aux {nf.format(limit)} plus récentes.
                                                </p>
                                            )}
                                        </div>
                                    ) : null}
                                    {phase === 'error' && exportError && (
                                        <p className="text-[11px] font-semibold text-ant-rose bg-ant-rose/10 border border-ant-rose/30 rounded-lg px-3 py-2 mt-3">
                                            {exportError}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── FOOTER ──────────────────────────────────────────────────── */}
                <div className="px-6 py-4 border-t border-ant-line bg-ant-paper">
                    {confirmClose ? (
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-[12px] font-medium text-ant-ink">
                                Fermer l’assistant ? La sélection en cours sera perdue.
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                                <Button
                                    variant="ghost"
                                    onClick={() => setConfirmClose(false)}
                                    className="h-9 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink"
                                >
                                    Continuer
                                </Button>
                                <Button
                                    onClick={onClose}
                                    className="h-9 px-4 rounded-full bg-ant-rose hover:bg-ant-rose/90 text-white text-[12px] font-semibold"
                                >
                                    Fermer
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between gap-2">
                            {step > 0 && phase !== 'done' ? (
                                <Button
                                    variant="ghost"
                                    disabled={phase === 'running'}
                                    onClick={() => setStep((s) => (s - 1) as Step)}
                                    className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink gap-1.5 disabled:opacity-50"
                                >
                                    <ArrowLeft className="w-4 h-4" /> {STEPS[step - 1].label}
                                </Button>
                            ) : <span />}

                            {step < 3 ? (
                                <Button
                                    onClick={() => stepValid(step) && setStep((s) => (s + 1) as Step)}
                                    disabled={!stepValid(step)}
                                    className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 disabled:opacity-50"
                                >
                                    Continuer <ArrowRight className="w-4 h-4" />
                                </Button>
                            ) : phase === 'done' ? (
                                <Button
                                    onClick={onClose}
                                    className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold"
                                >
                                    Fermer
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => void runExportNow()}
                                    disabled={!canExport}
                                    className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 disabled:opacity-50"
                                >
                                    {phase === 'running'
                                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Export…</>
                                        : phase === 'error'
                                            ? <><RotateCcw className="w-3.5 h-3.5" /> Réessayer</>
                                            : <><Download className="w-4 h-4" /> Exporter</>}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default OrdersExportWizard;
