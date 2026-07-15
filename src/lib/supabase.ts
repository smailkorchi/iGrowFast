import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/lib/database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    // Opt into WebAuthn passkeys (experimental). Other auth defaults (persistSession,
    // autoRefreshToken, detectSessionInUrl) are preserved.
    auth: { experimental: { passkey: true } },
});

/**
 * Paginated fetch that retrieves ALL rows from a Supabase table,
 * bypassing PostgREST's per-request row cap. Uses `.range()` in batches.
 *
 * @param table   - Table name
 * @param select  - Column selection string (e.g. 'id, name, zone_id')
 * @param options - Optional: order column, ascending flag, filters array
 * @returns       All matching rows
 */

/**
 * How many rows we ASK for per request.
 *
 * PostgREST independently caps every response at `PGRST_DB_MAX_ROWS` (set on the
 * self-host box in `/opt/supabase-project/.env` and `docker-compose.yml`,
 * currently 1000), so the server is free to return FEWER rows than we request.
 * This loop therefore never assumes the requested size was honoured:
 *
 *   - it advances by the number of rows ACTUALLY returned (`from += batch.length`),
 *     never by PAGE_SIZE;
 *   - it terminates on the exact row count PostgREST reports, not on "this page
 *     was short".
 *
 * Consequence: PAGE_SIZE and PGRST_DB_MAX_ROWS are decoupled. Lowering the box
 * env only changes how many round-trips this makes; it can no longer change the
 * RESULT.
 *
 * This matters because the previous `batch.length < PAGE_SIZE` termination made
 * the two values a load-bearing, undocumented, cross-repo invariant: setting
 * `PGRST_DB_MAX_ROWS=500` (an entirely reasonable DB-protection move) would have
 * made the loop stop after page 1 and every caller silently return only the first
 * 500 rows — no error, wrong totals, including the money paths.
 */
const PAGE_SIZE = 1000;

/** One-shot guard so the page-size-drift warning is not logged per batch. */
let warnedPageSizeDrift = false;

export type FetchAllFilterOp = 'eq' | 'neq' | 'in' | 'is' | 'gte' | 'lte' | 'gt' | 'lt' | 'ilike';

export async function fetchAllRows<T = Record<string, unknown>>(
    table: string,
    select: string,
    options?: {
        orderBy?: string;
        ascending?: boolean;
        filters?: { column: string; op: FetchAllFilterOp; value: unknown }[];
        /** Raw PostgREST filter expression, e.g. `seller_id.eq.X`. */
        orFilter?: string;
    }
): Promise<T[]> {
    const all: T[] = [];
    let from = 0;
    /** Exact number of rows matching the filters, as reported by PostgREST on page 1. */
    let total: number | null = null;

    for (;;) {
        let query = (supabase as unknown as SupabaseClient)
            .from(table)
            // `count: 'exact'` on the FIRST request only: it makes PostgREST report
            // how many rows the filters really match, so we can stop precisely
            // instead of inferring the end from a short page (which is ambiguous —
            // a short page means either "end of data" OR "server capped us").
            // Requesting it only once keeps the extra count pass off every batch.
            .select(select, from === 0 ? { count: 'exact' } : undefined)
            .range(from, from + PAGE_SIZE - 1);

        // A stable order is REQUIRED for correct .range() pagination — without it
        // PostgREST can return rows in an unstable physical order across pages,
        // duplicating/skipping rows. Default to primary key 'id'.
        query = query.order(options?.orderBy ?? 'id', {
            ascending: options?.ascending ?? true,
        });

        if (options?.filters) {
            for (const f of options.filters) {
                if (f.op === 'eq') query = query.eq(f.column, f.value);
                else if (f.op === 'neq') query = query.neq(f.column, f.value);
                else if (f.op === 'in') query = query.in(f.column, f.value as unknown[]);
                else if (f.op === 'is') query = query.is(f.column, f.value as null | boolean);
                else if (f.op === 'gte') query = query.gte(f.column, f.value);
                else if (f.op === 'lte') query = query.lte(f.column, f.value);
                else if (f.op === 'gt') query = query.gt(f.column, f.value);
                else if (f.op === 'lt') query = query.lt(f.column, f.value);
                else if (f.op === 'ilike') query = query.ilike(f.column, f.value as string);
            }
        }

        if (options?.orFilter) {
            query = query.or(options.orFilter);
        }

        const { data, error, count } = await query;
        if (error) {
            // PGRST103 = "Requested range not satisfiable" — we asked for rows past
            // the end of the result set, i.e. there is nothing left to read. Older
            // PostgREST versions answer an out-of-range `.range()` with this error
            // rather than an empty 200, so treat it as a normal end-of-data.
            if ((error as { code?: string }).code === 'PGRST103') break;
            throw error;
        }

        if (from === 0 && typeof count === 'number') total = count;

        const batch = (data ?? []) as T[];
        all.push(...batch);

        // Nothing came back -> end of data. Backstop for when `count` is
        // unavailable; also prevents an infinite loop on a degenerate response.
        if (batch.length === 0) break;

        // Advance by what we ACTUALLY received. Advancing by PAGE_SIZE here would
        // skip rows whenever the server returned a shorter page than requested.
        from += batch.length;

        // Precise termination: we have every matching row.
        if (total !== null && from >= total) break;

        // We asked for PAGE_SIZE, got less, and `total` says rows remain => the
        // server's PGRST_DB_MAX_ROWS is lower than PAGE_SIZE. The loop handles this
        // correctly (that is the point of the rewrite), but it is worth surfacing:
        // it means extra round-trips, and it used to be a silent-truncation bug.
        if (batch.length < PAGE_SIZE && !warnedPageSizeDrift) {
            warnedPageSizeDrift = true;
            console.warn(
                `[fetchAllRows] PostgREST returned ${batch.length} rows for a ${PAGE_SIZE}-row request ` +
                    `on "${table}". PGRST_DB_MAX_ROWS is lower than PAGE_SIZE — results are still ` +
                    `complete, but each fetch costs extra round-trips. Align PAGE_SIZE in ` +
                    `src/lib/supabase.ts with PGRST_DB_MAX_ROWS in /opt/supabase-project/.env.`
            );
        }
    }

    return all;
}
