// supabase.functions.invoke() surfaces non-2xx responses as a FunctionsHttpError
// whose .message is the generic "Edge Function returned a non-2xx status code".
// The actual JSON body ({ error: "..." }) lives on error.context (a Response),
// NOT in `data`. This helper digs the real, human-readable message out of it.
export async function edgeFnErrorMessage(
    error: unknown,
    data: unknown,
    fallback = 'Something went wrong. Please try again.',
): Promise<string> {
    // Some functions return 200 with { error } in the body.
    if (data && typeof data === 'object' && 'error' in data && (data as any).error) {
        return String((data as any).error);
    }

    const ctx = (error as any)?.context;
    if (ctx) {
        try {
            const res = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
            const body = await res.json();
            if (body?.error) return String(body.error);
            if (typeof body === 'string' && body.trim()) return body.trim();
        } catch {
            // body wasn't JSON — fall through
        }
    }

    const msg = (error as any)?.message;
    if (typeof msg === 'string' && msg && msg !== 'Edge Function returned a non-2xx status code') {
        return msg;
    }
    return fallback;
}
