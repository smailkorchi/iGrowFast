
/** An order reduced to the tracking identifiers it can be matched on. */
export type TrackingImportOrder = { id: string; trackingCodes: (string | null | undefined)[] };

export type TrackingImportResult = {
    /** Order ids whose tracking matched a value in the detected column. */
    matchedOrderIds: string[];
    /** Total data rows read from the file. */
    rowsImported: number;
    /** Index of the column auto-detected as the tracking column (null = none). */
    detectedColumn: number | null;
    /** Distinct tracking values matched to an order. */
    matchedValues: number;
    /** Tracking values present in the detected column with no matching order. */
    notFound: string[];
};

/** Fold case/whitespace/separators so "AGA-0526 88 22" == "aga052688220". */
const normalize = (s: unknown): string =>
    String(s ?? '').trim().toUpperCase().replace(/[\s\-_.]/g, '');

/** Read a CSV / XLSX / XLS file into a raw 2-D string grid (first sheet). */
export async function parseSpreadsheet(file: File): Promise<string[][]> {
    const buf = await file.arrayBuffer();
    // Dynamic import keeps xlsx (~0.5 MB) off the eager bundle — loads only when a
    // spreadsheet is actually parsed. Mirrors lib/ordersExport.ts.
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) as unknown[][];
    return rows.map((r) => (r || []).map((c) => (c == null ? '' : String(c))));
}

/**
 * Auto-detect the tracking column (the one whose values match the most orders)
 * and return the matched orders + import stats. Provider-format agnostic: it never
 * reads headers, it scores every column against the known tracking set and picks
 * the best one.
 */
export function matchTrackingColumn(rows: string[][], orders: TrackingImportOrder[]): TrackingImportResult {
    const map = new Map<string, string>(); // normalized tracking -> orderId
    for (const o of orders) {
        for (const t of o.trackingCodes) {
            const n = normalize(t);
            if (n) map.set(n, o.id);
        }
    }

    const base: TrackingImportResult = {
        matchedOrderIds: [], rowsImported: rows.length, detectedColumn: null, matchedValues: 0, notFound: [],
    };
    if (!rows.length || map.size === 0) return base;

    const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
    let bestCol = -1;
    let bestMatches = 0;
    for (let c = 0; c < colCount; c++) {
        const seen = new Set<string>();
        let matches = 0;
        for (const r of rows) {
            const n = normalize(r[c]);
            if (!n || seen.has(n)) continue;
            seen.add(n);
            if (map.has(n)) matches++;
        }
        if (matches > bestMatches) { bestMatches = matches; bestCol = c; }
    }
    if (bestCol < 0 || bestMatches === 0) return base;

    const matchedIds = new Set<string>();
    const notFound: string[] = [];
    const seen = new Set<string>();
    let matchedValues = 0;
    for (const r of rows) {
        const raw = r[bestCol];
        const n = normalize(raw);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const id = map.get(n);
        if (id) { matchedIds.add(id); matchedValues++; }
        else notFound.push(String(raw).trim());
    }

    return {
        matchedOrderIds: [...matchedIds],
        rowsImported: rows.length,
        detectedColumn: bestCol,
        matchedValues,
        notFound,
    };
}
