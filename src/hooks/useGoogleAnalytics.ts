import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
    invokeGA,
    normalizeReport,
    totalsFromReport,
    type GAReportResponse,
    type GAReportRequest,
} from '@/lib/googleAnalytics';

// google_analytics_connections is not yet in the generated Database type.
// Cast to the untyped SupabaseClient for operations on this table so we
// avoid the type machinery recursing into an unknown relation.
const gaDb = supabase as unknown as SupabaseClient;

export type GAConnection = {
    id: string;
    'DigiCom Business': string;
    property_id: string;
    display_name: string;
    website_url: string | null;
    is_default: boolean;
    verification_status: 'pending' | 'verified' | 'error';
    verification_error: string | null;
    last_verified_at: string | null;
    created_at: string;
    updated_at: string;
};

type ConnectionInsert = Omit<
    GAConnection,
    'id' | 'created_at' | 'updated_at' | 'last_verified_at' | 'verification_status' | 'verification_error'
> & {
    is_default?: boolean;
};

function resolveBusinessId(fallbackFromUser: string | null | undefined): string | null {
    return (
        localStorage.getItem('activeBusinessId') ||
        fallbackFromUser ||
        null
    );
}

export function useGAConnections() {
    return useQuery({
        queryKey: ['ga-connections'],
        queryFn: async () => {
            const { data, error } = await gaDb
                .from('google_analytics_connections')
                .select('*')
                .order('is_default', { ascending: false })
                .order('created_at', { ascending: true });
            if (error) throw error;
            return (data ?? []) as unknown as GAConnection[];
        },
    });
}

export function useAddGAConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload: {
            property_id: string;
            display_name: string;
            website_url?: string | null;
            business_id: string;
            make_default?: boolean;
        }) => {
            const normalized = payload.property_id.replace(/\D+/g, '');
            if (!normalized) throw new Error('Enter a numeric GA4 property ID');

            const verify = await invokeGA<{ ok: boolean; error?: string }>({
                action: 'verify_property',
                property_id: normalized,
            });
            if (!verify.ok) {
                throw new Error(
                    verify.error ??
                        'The service account could not access this property. Add the SA as a viewer in GA4, then retry.'
                );
            }

            const { data: { user } } = await supabase.auth.getUser();

            const row = {
                'DigiCom Business': payload.business_id,
                property_id: normalized,
                display_name: payload.display_name.trim() || `Property ${normalized}`,
                website_url: payload.website_url?.trim() || null,
                is_default: !!payload.make_default,
                verification_status: 'verified' as const,
                last_verified_at: new Date().toISOString(),
                created_by: user?.id ?? null,
            };

            const { data, error } = await gaDb
                .from('google_analytics_connections')
                .insert(row)
                .select('*')
                .single();
            if (error) throw error;

            if (payload.make_default && data) {
                await gaDb
                    .from('google_analytics_connections')
                    .update({ is_default: false })
                    .eq('DigiCom Business', payload.business_id)
                    .neq('id', (data as unknown as GAConnection).id);
            }

            return data as unknown as GAConnection;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['ga-connections'] });
        },
    });
}

export function useDeleteGAConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            const { error } = await gaDb
                .from('google_analytics_connections')
                .delete()
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['ga-connections'] });
        },
    });
}

export function useSetDefaultGAConnection() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            business_id,
        }: {
            id: string;
            business_id: string;
        }) => {
            const { error: clearErr } = await gaDb
                .from('google_analytics_connections')
                .update({ is_default: false })
                .eq('DigiCom Business', business_id);
            if (clearErr) throw clearErr;

            const { error } = await gaDb
                .from('google_analytics_connections')
                .update({ is_default: true })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['ga-connections'] });
        },
    });
}

export function useServiceAccountEmail() {
    return useQuery({
        queryKey: ['ga-service-account-email'],
        queryFn: async () => {
            const res = await invokeGA<{ email: string; project_id: string }>({
                action: 'service_account_email',
            });
            return res;
        },
        staleTime: 1000 * 60 * 60,
    });
}

export type DateRange = { start: string; end: string };

const CORE_METRICS: GAReportRequest['metrics'] = [
    { name: 'activeUsers' },
    { name: 'newUsers' },
    { name: 'sessions' },
    { name: 'screenPageViews' },
    { name: 'engagementRate' },
    { name: 'averageSessionDuration' },
    { name: 'eventCount' },
    { name: 'bounceRate' },
];

export function useGAReports(property_id: string | null, range: DateRange) {
    return useQuery({
        queryKey: ['ga-reports', property_id, range.start, range.end],
        enabled: !!property_id,
        staleTime: 1000 * 60 * 5,
        queryFn: async () => {
            if (!property_id) throw new Error('property_id required');
            const dateRanges = [{ startDate: range.start, endDate: range.end }];
            const requests: GAReportRequest[] = [
                // 0: totals (no dimensions)
                {
                    dateRanges,
                    metrics: CORE_METRICS,
                },
                // 1: daily trend
                {
                    dateRanges,
                    dimensions: [{ name: 'date' }],
                    metrics: [
                        { name: 'activeUsers' },
                        { name: 'sessions' },
                        { name: 'screenPageViews' },
                    ],
                    orderBys: [
                        { dimension: { dimensionName: 'date' }, desc: false },
                    ],
                    limit: 365,
                    keepEmptyRows: true,
                },
                // 2: channel sources
                {
                    dateRanges,
                    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
                    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
                    orderBys: [
                        { metric: { metricName: 'sessions' }, desc: true },
                    ],
                    limit: 10,
                },
                // 3: top pages
                {
                    dateRanges,
                    dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
                    metrics: [
                        { name: 'screenPageViews' },
                        { name: 'activeUsers' },
                        { name: 'averageSessionDuration' },
                    ],
                    orderBys: [
                        { metric: { metricName: 'screenPageViews' }, desc: true },
                    ],
                    limit: 10,
                },
                // 4: countries
                {
                    dateRanges,
                    dimensions: [{ name: 'country' }],
                    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
                    orderBys: [
                        { metric: { metricName: 'activeUsers' }, desc: true },
                    ],
                    limit: 10,
                },
                // 5: device categories
                {
                    dateRanges,
                    dimensions: [{ name: 'deviceCategory' }],
                    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
                    orderBys: [
                        { metric: { metricName: 'sessions' }, desc: true },
                    ],
                    limit: 5,
                },
                // 6: browsers
                {
                    dateRanges,
                    dimensions: [{ name: 'browser' }],
                    metrics: [{ name: 'sessions' }],
                    orderBys: [
                        { metric: { metricName: 'sessions' }, desc: true },
                    ],
                    limit: 8,
                },
                // 7: events top
                {
                    dateRanges,
                    dimensions: [{ name: 'eventName' }],
                    metrics: [{ name: 'eventCount' }],
                    orderBys: [
                        { metric: { metricName: 'eventCount' }, desc: true },
                    ],
                    limit: 10,
                },
            ];

            // GA4 batchRunReports caps at 5 requests per batch — split into chunks.
            const BATCH_SIZE = 5;
            const batches: GAReportRequest[][] = [];
            for (let i = 0; i < requests.length; i += BATCH_SIZE) {
                batches.push(requests.slice(i, i + BATCH_SIZE));
            }

            const responses = await Promise.all(
                batches.map((batch) =>
                    invokeGA<{ ok: boolean; data: { reports: GAReportResponse[] } }>({
                        action: 'batch_reports',
                        property_id,
                        requests: batch,
                    })
                )
            );
            const reports = responses.flatMap((r) => r.data?.reports ?? []);
            return {
                totals: totalsFromReport(reports[0]),
                trend: normalizeReport(reports[1]),
                channels: normalizeReport(reports[2]),
                pages: normalizeReport(reports[3]),
                countries: normalizeReport(reports[4]),
                devices: normalizeReport(reports[5]),
                browsers: normalizeReport(reports[6]),
                events: normalizeReport(reports[7]),
            };
        },
    });
}

export function useGARealtime(property_id: string | null) {
    return useQuery({
        queryKey: ['ga-realtime', property_id],
        enabled: !!property_id,
        refetchInterval: 30_000,
        staleTime: 20_000,
        queryFn: async () => {
            if (!property_id) throw new Error('property_id required');
            const res = await invokeGA<{
                ok: boolean;
                data: GAReportResponse;
            }>({
                action: 'get_realtime',
                property_id,
                report: {
                    metrics: [{ name: 'activeUsers' }],
                    dimensions: [{ name: 'country' }],
                    limit: 10,
                },
            });
            const rows = normalizeReport(res.data);
            const total = rows.reduce(
                (s, r) => s + (Number(r.activeUsers) || 0),
                0
            );
            return { total, byCountry: rows };
        },
    });
}

export function useActiveBusinessId(): string | null {
    return useMemo(() => resolveBusinessId(null), []);
}
