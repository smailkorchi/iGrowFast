/**
 * Orders export engine — column registry, server-side filtered query builder,
 * chunked fetch (.range() pages of 1000, house 1000-row-cap law) and CSV/XLSX
 * serializers.
 *
 * Design rules (mirrors the admin Orders page dataset):
 *   - Scoping: "DigiCom Business" eq + date_deleted IS NULL + source_review_status
 *     neq 'pending' — the exact regime of the ['orders-aggregate'] query, so the
 *     export never surfaces rows the page itself hides.
 *   - The SELECT is composed from ONLY the chosen columns' fragments (id always
 *     included). Never `select *`.
 *   - All filters run SERVER-SIDE (.in() on small fixed id lists, gte/lte on "date").
 *   - Ordered by "date" DESC (id ASC tiebreak → stable .range() pagination).
 *   - Hard safety cap: 20 000 rows.
 */

import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { saveBlob, type SaveBlobResult } from '@/lib/saveBlob';

// Typed client rejects dynamic select strings — same escape hatch the Orders
// page uses for its own queries.
const sb = supabase as unknown as { from: (table: string) => any };

export const HARD_EXPORT_CAP = 20_000;
const PAGE_SIZE = 1000;
// House DB law: long id lists in .in() blow the ~8k URL limit (GET). The wizard
// drops full selections ("Tout" = no filter), this guard catches every other path.
const IN_LIST_MAX = 150;

// Same hardcoded list the Orders page filters on (orders.source_name — NOT the
// sales_channels table; see SALES_SOURCES in src/pages/admin/Orders.tsx).
export const EXPORT_SOURCES = [
    'whatsapp',
    'facebook',
    'instagram',
    'tiktok',
    'phone call',
    'connaissance',
    'reorder',
    'website',
    'other',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExportGroupKey =
    | 'commande'
    | 'client'
    | 'produits'
    | 'statuts'
    | 'livraison'
    | 'financier';

export const EXPORT_GROUPS: { key: ExportGroupKey; label: string }[] = [
    { key: 'commande', label: 'Commande' },
    { key: 'client', label: 'Client' },
    { key: 'produits', label: 'Produits' },
    { key: 'statuts', label: 'Statuts' },
    { key: 'livraison', label: 'Livraison' },
    { key: 'financier', label: 'Financier' },
];

/** Raw PostgREST row — shape depends on the composed select. */
type Raw = Record<string, any>;

export type ExportCell = string | number;

/** Lookup context resolved by the caller (fields not embedded in the select). */
export interface ExportContext {
    /** users.id → users.name — resolves confirmed_by_id. */
    userNameById: Map<string, string>;
}

export interface ExportColumn {
    key: string;
    group: ExportGroupKey;
    /** French header used in the file. */
    label: string;
    /** PostgREST select fragment(s) this column needs (own column or embed). */
    selectFragments: string[];
    extract: (row: Raw, ctx: ExportContext) => ExportCell;
    /** Pre-checked in the wizard. */
    defaultOn?: boolean;
}

export interface ExportFilters {
    statusIds?: string[];
    packageStatusIds?: string[];
    courierIds?: string[];
    sellerIds?: string[];
    cityIds?: string[];
    sources?: string[];
    /** ISO timestamps applied to the "date" column (gte / lte). */
    dateFrom?: string | null;
    dateTo?: string | null;
}

export interface ExportScope {
    /** Max rows to export; null = all (still bounded by HARD_EXPORT_CAP). */
    limit: number | null;
}

export interface ExportProgress {
    fetched: number;
    total: number;
    /** 'fetching' while pages stream in; 'serializing' while the file is built. */
    phase: 'fetching' | 'serializing';
}

export interface ExportResult {
    headers: string[];
    rows: ExportCell[][];
    total: number;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const fmtDate = (v: unknown): string => {
    if (!v) return '';
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? '' : format(d, 'dd/MM/yyyy HH:mm');
};

const fmtBool = (v: unknown): string => (v ? 'Oui' : 'Non');

/** Money / quantities as plain numbers (Excel-friendly, no currency suffix). */
const fmtNum = (v: unknown): ExportCell => (v === null || v === undefined || v === '' ? '' : Number(v));

const fmtStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// ─── Column registry ─────────────────────────────────────────────────────────

const ITEMS_FRAGMENT =
    'items:order_items(quantity, unit_price, total_price, accessory_quantity, accessory_unit_price, product:products(name, code), accessory:accessories(name, code))';

const itemsSummary = (row: Raw): string => {
    const parts: string[] = [];
    for (const it of row.items || []) {
        if (it?.product && Number(it.quantity) > 0) {
            const code = it.product.code ? ` (${it.product.code})` : '';
            parts.push(`${Number(it.quantity)}× ${it.product.name || 'Produit'}${code}`);
        }
        if (it?.accessory && Number(it.accessory_quantity) > 0) {
            parts.push(`${Number(it.accessory_quantity)}× ${it.accessory.name || 'Accessoire'} (accessoire)`);
        }
    }
    return parts.join(' | ');
};

/** Prefer parcels linked to a note (the page's tracking-filter semantics), else all. */
const parcelCodes = (parcels: Raw[] | null | undefined, noteKey: string): string => {
    const list = parcels || [];
    const linked = list.filter((p) => p?.tracking_code && p?.[noteKey]);
    const chosen = linked.length > 0 ? linked : list.filter((p) => p?.tracking_code);
    return chosen.map((p) => String(p.tracking_code)).join('; ');
};

// ONE canonical courier_parcels embed shared by every column that needs it —
// two different fragment strings for the same embed would survive the Set
// dedupe and produce an invalid duplicate embed in the composed select.
const COURIER_PARCELS_FRAGMENT =
    'courier_parcels(tracking_code, courier_delivery_note_id, created_at, status:package_statuses(label))';

const newestCourierParcelStatus = (row: Raw): string => {
    const list = (row.courier_parcels || []) as Raw[];
    if (list.length === 0) return '';
    const newest = [...list].sort((a, b) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')))[0];
    return fmtStr(newest?.status?.label);
};

const LEGACY_TRACKING_COLUMNS: { column: string; label: string }[] = [
    { column: 'coliaty_old_tracking', label: 'Coliaty' },
    { column: 'ameex_old_tracking', label: 'Ameex' },
    { column: 'quicklivraison_old_tracking', label: 'QuickLivraison' },
    { column: 'forcelog_old_tracking', label: 'Forcelog' },
    { column: 'sendit_old_tracking', label: 'Sendit' },
    { column: 'delvoexpress_old_tracking', label: 'DelvoExpress' },
];

export const EXPORT_COLUMNS: ExportColumn[] = [
    // ── Commande ────────────────────────────────────────────────────────────
    {
        key: 'id', group: 'commande', label: 'ID commande',
        selectFragments: ['id'], extract: (r) => fmtStr(r.id),
    },
    {
        key: 'date', group: 'commande', label: 'Date de commande', defaultOn: true,
        selectFragments: ['date'], extract: (r) => fmtDate(r.date),
    },
    {
        key: 'created_at', group: 'commande', label: 'Créée le',
        selectFragments: ['created_at'], extract: (r) => fmtDate(r.created_at),
    },
    {
        key: 'updated_at', group: 'commande', label: 'Modifiée le',
        selectFragments: ['updated_at'], extract: (r) => fmtDate(r.updated_at),
    },
    {
        key: 'source_name', group: 'commande', label: 'Source', defaultOn: true,
        selectFragments: ['source_name'], extract: (r) => capitalize(fmtStr(r.source_name)),
    },
    {
        key: 'channel', group: 'commande', label: 'Canal de vente',
        selectFragments: ['channel:sales_channels!orders_source_id_fkey(name)'],
        extract: (r) => fmtStr(r.channel?.name),
    },
    {
        key: 'external_row_id', group: 'commande', label: 'Réf. externe',
        selectFragments: ['external_row_id'], extract: (r) => fmtStr(r.external_row_id),
    },
    {
        key: 'replace', group: 'commande', label: 'Échange',
        selectFragments: ['replace'], extract: (r) => fmtBool(r.replace),
    },
    {
        key: 'swap_only', group: 'commande', label: 'Échange sans vente',
        selectFragments: ['swap_only'], extract: (r) => fmtBool(r.swap_only),
    },
    {
        key: 'exchange_of_order_id', group: 'commande', label: "Commande d'origine (échange)",
        selectFragments: ['exchange_of_order_id'], extract: (r) => fmtStr(r.exchange_of_order_id),
    },
    {
        key: 'note', group: 'commande', label: 'Note interne',
        selectFragments: ['note'], extract: (r) => fmtStr(r.note),
    },

    // ── Client ──────────────────────────────────────────────────────────────
    {
        key: 'name', group: 'client', label: 'Client', defaultOn: true,
        selectFragments: ['name'], extract: (r) => fmtStr(r.name),
    },
    {
        key: 'phone', group: 'client', label: 'Téléphone', defaultOn: true,
        selectFragments: ['phone'], extract: (r) => fmtStr(r.phone),
    },
    {
        key: 'city', group: 'client', label: 'Ville', defaultOn: true,
        selectFragments: ['city:master_cities(name)'], extract: (r) => fmtStr(r.city?.name),
    },
    {
        key: 'address', group: 'client', label: 'Adresse',
        selectFragments: ['address'], extract: (r) => fmtStr(r.address),
    },

    // ── Produits ────────────────────────────────────────────────────────────
    {
        key: 'products', group: 'produits', label: 'Produits',
        selectFragments: [ITEMS_FRAGMENT], extract: (r) => itemsSummary(r),
    },
    {
        key: 'product_codes', group: 'produits', label: 'Codes produits',
        selectFragments: [ITEMS_FRAGMENT],
        extract: (r) => {
            const codes = new Set<string>();
            for (const it of r.items || []) {
                if (it?.product?.code) codes.add(String(it.product.code));
            }
            return Array.from(codes).join(' | ');
        },
    },
    {
        key: 'items_qty', group: 'produits', label: 'Quantité totale',
        selectFragments: [ITEMS_FRAGMENT],
        extract: (r) => (r.items || []).reduce((acc: number, it: Raw) => acc + (Number(it?.quantity) || 0), 0),
    },

    // ── Statuts ─────────────────────────────────────────────────────────────
    {
        key: 'status', group: 'statuts', label: 'Statut commande', defaultOn: true,
        selectFragments: ['status:order_statuses(label)'], extract: (r) => fmtStr(r.status?.label),
    },
    {
        key: 'package_status', group: 'statuts', label: 'Statut colis', defaultOn: true,
        // Courier (internal) orders keep orders.package_status_id NULL — their
        // status lives on the newest courier_parcels row, exactly like the
        // page's getCourierPackageStatus fallback. Without it every courier
        // order would export an empty cell while the page shows a badge.
        selectFragments: ['package_status:package_statuses(label)', COURIER_PARCELS_FRAGMENT],
        extract: (r) => fmtStr(r.package_status?.label || newestCourierParcelStatus(r)),
    },
    {
        key: 'confirmation_date', group: 'statuts', label: 'Date de confirmation',
        selectFragments: ['confirmation_date'], extract: (r) => fmtDate(r.confirmation_date),
    },
    {
        key: 'annulation_date', group: 'statuts', label: "Date d'annulation",
        selectFragments: ['annulation_date'], extract: (r) => fmtDate(r.annulation_date),
    },
    {
        key: 'reported_date', group: 'statuts', label: 'Date de report',
        selectFragments: ['reported_date'], extract: (r) => fmtDate(r.reported_date),
    },
    {
        key: 'assignment_date', group: 'statuts', label: "Date d'assignation",
        selectFragments: ['assignment_date'], extract: (r) => fmtDate(r.assignment_date),
    },
    {
        key: 'assignee', group: 'statuts', label: 'Assignée à',
        selectFragments: ['assignee:users!orders_seller_id_fkey(name)'],
        extract: (r) => fmtStr(r.assignee?.name),
    },
    {
        key: 'confirmed_by', group: 'statuts', label: 'Confirmée par',
        selectFragments: ['confirmed_by_id'],
        extract: (r, ctx) => (r.confirmed_by_id ? ctx.userNameById.get(r.confirmed_by_id) || '' : ''),
    },

    // ── Livraison ───────────────────────────────────────────────────────────
    {
        key: 'delivered', group: 'livraison', label: 'Livrée',
        selectFragments: ['delivered'], extract: (r) => fmtBool(r.delivered),
    },
    {
        key: 'date_livraison', group: 'livraison', label: 'Date de livraison',
        selectFragments: ['date_livraison'], extract: (r) => fmtDate(r.date_livraison),
    },
    {
        key: 'courier', group: 'livraison', label: 'Livreur',
        selectFragments: ['courier:users!orders_courier_id_fkey(name)'],
        extract: (r) => fmtStr(r.courier?.name),
    },
    {
        key: 'company', group: 'livraison', label: 'Société de livraison',
        selectFragments: ['company:providers(name)'], extract: (r) => fmtStr(r.company?.name),
    },
    {
        key: 'tracking_company', group: 'livraison', label: 'N° de suivi (société)',
        selectFragments: ['parcels:company_parcels(tracking_code, company_delivery_note_id)'],
        extract: (r) => parcelCodes(r.parcels, 'company_delivery_note_id'),
    },
    {
        key: 'tracking_courier', group: 'livraison', label: 'N° de suivi (livreur)',
        selectFragments: [COURIER_PARCELS_FRAGMENT],
        extract: (r) => parcelCodes(r.courier_parcels, 'courier_delivery_note_id'),
    },
    {
        key: 'legacy_tracking', group: 'livraison', label: 'Anciens n° de suivi',
        selectFragments: LEGACY_TRACKING_COLUMNS.map((l) => l.column),
        extract: (r) =>
            LEGACY_TRACKING_COLUMNS
                .filter((l) => r[l.column])
                .map((l) => `${l.label}: ${r[l.column]}`)
                .join('; '),
    },
    {
        // orders.delivery_note is the "Public Delivery Note" TEXT shown on the
        // order modal (a message for the courier/customer) — NOT the BL
        // document. 'Bon de livraison' was a mislabel.
        key: 'delivery_note', group: 'livraison', label: 'Note de livraison (publique)',
        selectFragments: ['delivery_note'], extract: (r) => fmtStr(r.delivery_note),
    },

    // ── Financier ───────────────────────────────────────────────────────────
    {
        key: 'price', group: 'financier', label: 'Total (DH)', defaultOn: true,
        selectFragments: ['price'], extract: (r) => fmtNum(r.price),
    },
    {
        key: 'raw_price', group: 'financier', label: 'Prix produits (DH)',
        selectFragments: ['raw_price'], extract: (r) => fmtNum(r.raw_price),
    },
    {
        key: 'shipping_cost', group: 'financier', label: 'Frais de livraison (DH)',
        selectFragments: ['shipping_cost'], extract: (r) => fmtNum(r.shipping_cost),
    },
    {
        key: 'include_delivery_in_total', group: 'financier', label: 'Livraison incluse dans le total',
        selectFragments: ['include_delivery_in_total'], extract: (r) => fmtBool(r.include_delivery_in_total),
    },
    {
        key: 'payed', group: 'financier', label: 'Payée', defaultOn: true,
        selectFragments: ['payed'], extract: (r) => fmtBool(r.payed),
    },
];

export const DEFAULT_EXPORT_KEYS: string[] = EXPORT_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key);

// ─── Query builder ───────────────────────────────────────────────────────────

/** Composes the minimal SELECT for the chosen columns (id always included). */
export function buildExportSelect(columns: ExportColumn[]): string {
    const fragments = new Set<string>(['id']);
    for (const col of columns) for (const f of col.selectFragments) fragments.add(f);
    return Array.from(fragments).join(', ');
}

/**
 * Fresh PostgREST query on 'orders' with tenant scoping + every wizard filter
 * applied SERVER-SIDE. Builders are single-use — call once per request.
 */
export function buildExportQuery(
    businessId: string,
    filters: ExportFilters,
    select: string,
    options?: { count?: 'exact'; head?: boolean },
) {
    let q = sb
        .from('orders')
        .select(select, options)
        .eq('DigiCom Business', businessId)
        .is('date_deleted', null)
        .neq('source_review_status', 'pending');

    const inList = (column: string, ids: string[] | undefined, label: string) => {
        if (!ids?.length) return;
        if (ids.length > IN_LIST_MAX) {
            throw new Error(
                `Trop de valeurs sélectionnées pour le filtre « ${label} » (${ids.length}). ` +
                `Sélectionnez moins de ${IN_LIST_MAX} valeurs, ou aucune pour tout inclure.`,
            );
        }
        q = q.in(column, ids);
    };
    inList('order_status_id', filters.statusIds, 'Statut commande');
    inList('package_status_id', filters.packageStatusIds, 'Statut colis');
    inList('courier_id', filters.courierIds, 'Livreur');
    inList('seller_id', filters.sellerIds, 'Vendeur');
    inList('master_city_id', filters.cityIds, 'Ville');
    inList('source_name', filters.sources, 'Source');
    if (filters.dateFrom) q = q.gte('date', filters.dateFrom);
    if (filters.dateTo) q = q.lte('date', filters.dateTo);

    return q;
}

/** Exact row count for the recap step — HEAD request, no rows transferred. */
export async function countExport(businessId: string, filters: ExportFilters): Promise<number> {
    const { count, error } = await buildExportQuery(businessId, filters, 'id', {
        count: 'exact',
        head: true,
    });
    if (error) throw error;
    return count ?? 0;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Fetches matching orders in chunks of 1000 (.range() pages, "date" DESC with
 * id ASC tiebreak for stable pagination), maps them through the registry
 * extractors and reports progress. Throws beyond HARD_EXPORT_CAP.
 */
export async function runExport(opts: {
    businessId: string;
    columns: ExportColumn[];
    filters: ExportFilters;
    scope: ExportScope;
    ctx: ExportContext;
    onProgress?: (p: ExportProgress) => void;
}): Promise<ExportResult> {
    const { businessId, columns, filters, scope, ctx, onProgress } = opts;
    if (!businessId) throw new Error('Aucune activité sélectionnée.');
    if (columns.length === 0) throw new Error('Aucun champ sélectionné.');

    const count = await countExport(businessId, filters);
    const total = scope.limit !== null ? Math.min(scope.limit, count) : count;
    if (total > HARD_EXPORT_CAP) {
        throw new Error(
            `L'export dépasse la limite de sécurité de ${new Intl.NumberFormat('fr-FR').format(HARD_EXPORT_CAP)} lignes ` +
            `(${new Intl.NumberFormat('fr-FR').format(total)} demandées). Réduisez la portée ou affinez les filtres.`,
        );
    }

    const select = buildExportSelect(columns);
    const raws: Raw[] = [];
    // Offset pages over a LIVE table ordered by "date" DESC: an insert between
    // chunks shifts boundaries and replays the boundary row — dedupe by id (the
    // dangerous direction for a financial export is a duplicated line).
    const seen = new Set<string>();
    let fetched = 0;
    onProgress?.({ fetched: 0, total, phase: 'fetching' });

    while (fetched < total) {
        const from = fetched;
        const to = Math.min(from + PAGE_SIZE - 1, total - 1);
        const { data, error } = await buildExportQuery(businessId, filters, select)
            .order('date', { ascending: false, nullsFirst: false })
            .order('id', { ascending: true })
            .range(from, to);
        if (error) throw error;
        const batch = (data ?? []) as Raw[];
        for (const r of batch) {
            const id = String(r.id);
            if (seen.has(id)) continue;
            seen.add(id);
            raws.push(r);
        }
        fetched += batch.length;
        onProgress?.({ fetched: Math.min(fetched, total), total, phase: 'fetching' });
        if (batch.length < to - from + 1) break; // short page = dataset shrank mid-export
    }

    // Serialization phase: extraction over 20k×N cells is main-thread work —
    // yield every 2000 rows so the wizard's "Génération du fichier…" state and
    // spinner keep painting instead of looking hung.
    onProgress?.({ fetched: Math.min(fetched, total), total, phase: 'serializing' });
    await new Promise((r) => setTimeout(r, 0));
    const headers = columns.map((c) => c.label);
    const rows: ExportCell[][] = [];
    for (let i = 0; i < raws.length; i++) {
        rows.push(columns.map((c) => c.extract(raws[i], ctx)));
        if (i > 0 && i % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return { headers, rows, total: rows.length };
}

// ─── Serializers ─────────────────────────────────────────────────────────────

const csvCell = (v: ExportCell): string => {
    // Formula-injection hardening: a customer-controlled string starting with
    // =, +, -, @ or a tab would be EVALUATED by Excel on open (HYPERLINK/DDE
    // exfiltration). Neutralize with a leading apostrophe \u2014 strings only,
    // numbers (negative money) must stay numeric.
    const s0 = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v ?? '');
    return /[";\r\n]/.test(s0) ? `"${s0.replace(/"/g, '""')}"` : s0;
};

/**
 * Semicolon-separated (the list separator French-locale Excel actually splits
 * on \u2014 comma CSVs open as one column there), CRLF line endings, BOM prefix so
 * Excel reads UTF-8.
 */
export function toCsv(headers: string[], rows: ExportCell[][]): string {
    const lines = [headers.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function exportFilename(ext: 'csv' | 'xlsx'): string {
    return `commandes_${format(new Date(), 'yyyy-MM-dd_HHmm')}.${ext}`;
}

/**
 * Serializes and hands the file to the browser. Both formats go through
 * saveBlob (Web Share → <a download> → window.open) so iOS Safari gets a real
 * save path — XLSX is produced via lazy `import('xlsx')` to keep SheetJS out
 * of the main bundle.
 */
export async function saveExport(
    fmt: 'csv' | 'xlsx',
    headers: string[],
    rows: ExportCell[][],
): Promise<SaveBlobResult> {
    const filename = exportFilename(fmt);
    if (fmt === 'csv') {
        const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
        return saveBlob(blob, { filename, mimeType: 'text/csv' });
    }
    const XLSX = await import('xlsx');
    const data = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commandes');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return saveBlob(blob, { filename, mimeType: blob.type });
}
