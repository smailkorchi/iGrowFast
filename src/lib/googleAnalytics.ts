import { supabase } from '@/lib/supabase';

// GA4 Data API row shape: metric/dimension columns are parallel arrays.
// These helpers normalize responses to a flat list of { [dim]: string, [metric]: number }.

export type GAReportRow = Record<string, string | number>;

export type GAReportRequest = {
    dateRanges: { startDate: string; endDate: string }[];
    dimensions?: { name: string }[];
    metrics: { name: string }[];
    orderBys?: Array<{
        metric?: { metricName: string };
        dimension?: { dimensionName: string };
        desc?: boolean;
    }>;
    limit?: number;
    keepEmptyRows?: boolean;
};

export type GAReportResponse = {
    dimensionHeaders?: { name: string }[];
    metricHeaders?: { name: string; type: string }[];
    rows?: Array<{
        dimensionValues: { value: string }[];
        metricValues: { value: string }[];
    }>;
    totals?: Array<{ metricValues: { value: string }[] }>;
    rowCount?: number;
};

type InvokeAction =
    | { action: 'service_account_email' }
    | { action: 'verify_property'; property_id: string }
    | { action: 'run_report'; property_id: string; report: GAReportRequest }
    | {
          action: 'batch_reports';
          property_id: string;
          requests: GAReportRequest[];
      }
    | { action: 'get_realtime'; property_id: string; report?: unknown };

export async function invokeGA<T = unknown>(body: InvokeAction): Promise<T> {
    const { data, error } = await supabase.functions.invoke('google-analytics-fetch', {
        body,
    });
    if (error) {
        // FunctionsHttpError hides the body for non-2xx responses. Try to recover it.
        const maybeCtx = error as unknown as { context?: Response };
        if (maybeCtx?.context && typeof maybeCtx.context.text === 'function') {
            try {
                const text = await maybeCtx.context.text();
                const parsed = JSON.parse(text) as { error?: string };
                if (parsed?.error) throw new Error(parsed.error);
            } catch {
                // fall through to generic error
            }
        }
        throw new Error(error.message);
    }
    const payload = data as { ok?: boolean; error?: string } & T;
    if (payload && payload.ok === false && payload.error) {
        throw new Error(payload.error);
    }
    return payload as T;
}

export function normalizeReport(
    res: GAReportResponse | undefined | null
): GAReportRow[] {
    if (!res || !res.rows) return [];
    const dimHeaders = res.dimensionHeaders ?? [];
    const metHeaders = res.metricHeaders ?? [];
    return res.rows.map((r) => {
        const out: GAReportRow = {};
        dimHeaders.forEach((h, i) => {
            out[h.name] = r.dimensionValues[i]?.value ?? '';
        });
        metHeaders.forEach((h, i) => {
            const raw = r.metricValues[i]?.value ?? '0';
            const num = Number(raw);
            out[h.name] = Number.isFinite(num) ? num : 0;
        });
        return out;
    });
}

export function totalsFromReport(
    res: GAReportResponse | undefined | null
): Record<string, number> {
    const out: Record<string, number> = {};
    if (!res || !res.totals || !res.metricHeaders) return out;
    const first = res.totals[0];
    if (!first) return out;
    res.metricHeaders.forEach((h, i) => {
        out[h.name] = Number(first.metricValues[i]?.value ?? '0') || 0;
    });
    return out;
}
