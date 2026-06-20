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
 * bypassing the default 1000-row limit. Uses `.range()` in batches.
 *
 * @param table   - Table name
 * @param select  - Column selection string (e.g. 'id, name, zone_id')
 * @param options - Optional: order column, ascending flag, filters array
 * @returns       All matching rows
 */
const PAGE_SIZE = 1000;

export type FetchAllFilterOp = 'eq' | 'neq' | 'in' | 'is' | 'gte' | 'lte' | 'gt' | 'lt' | 'ilike';

export async function fetchAllRows<T = Record<string, unknown>>(
    table: string,
    select: string,
    options?: {
        orderBy?: string;
        ascending?: boolean;
        filters?: { column: string; op: FetchAllFilterOp; value: unknown }[];
        /** Raw PostgREST OR expression, e.g. `seller_id.eq.X,assign_id.eq.X`. */
        orFilter?: string;
    }
): Promise<T[]> {
    const all: T[] = [];
    let from = 0;

    for (;;) {
        let query = (supabase as unknown as SupabaseClient)
            .from(table)
            .select(select)
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

        const { data, error } = await query;
        if (error) throw error;

        const batch = (data ?? []) as T[];
        all.push(...batch);

        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return all;
}
