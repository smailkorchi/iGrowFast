// supabase.functions.invoke() surfaces non-2xx responses as a FunctionsHttpError
// whose .message is the generic "Edge Function returned a non-2xx status code".
// The actual JSON body ({ error: "..." }) lives on error.context (a Response),
// NOT in `data`. This helper digs the real, human-readable message out of it.
export async function edgeFnErrorMessage(
    error: unknown,
    data: unknown,
    fallback = 'Something went wrong. Please try again.',
): Promise<string> {
    // Functions vary: some return { error }, others { ok:false, reason, detail }.
    const pick = (b: any): string | null => {
        if (!b || typeof b !== 'object') return (typeof b === 'string' && b.trim()) ? b.trim() : null;
        if (b.error) return String(b.error);
        if (b.detail) return String(b.detail);
        if (b.reason && b.reason !== 'error') return String(b.reason);
        return null;
    };

    const fromData = pick(data);
    if (fromData) return fromData;

    const ctx = (error as any)?.context;
    if (ctx) {
        try {
            const res = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
            const body = await res.json();
            const fromBody = pick(body);
            if (fromBody) return fromBody;
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
