import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

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

export async function fetchAllRows<T = Record<string, unknown>>(
    table: string,
    select: string,
    options?: {
        orderBy?: string;
        ascending?: boolean;
        filters?: { column: string; op: 'eq' | 'neq' | 'in'; value: unknown }[];
    }
): Promise<T[]> {
    const all: T[] = [];
    let from = 0;

    for (;;) {
        let query = (supabase as any)
            .from(table)
            .select(select)
            .range(from, from + PAGE_SIZE - 1);

        if (options?.orderBy) {
            query = query.order(options.orderBy, {
                ascending: options.ascending ?? true,
            });
        }

        if (options?.filters) {
            for (const f of options.filters) {
                if (f.op === 'eq') query = query.eq(f.column, f.value);
                else if (f.op === 'neq') query = query.neq(f.column, f.value);
                else if (f.op === 'in') query = query.in(f.column, f.value as unknown[]);
            }
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
