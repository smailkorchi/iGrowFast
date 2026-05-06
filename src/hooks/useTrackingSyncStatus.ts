import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // matches the pg_cron schedule

export type TrackingSyncRun = {
    id: string;
    started_at: string;
    finished_at: string | null;
    status: 'running' | 'success' | 'error';
    trigger: 'cron' | 'manual' | 'startup';
    total: number;
    changed: number;
    failed: number;
    duration_ms: number | null;
    error: string | null;
};

export type TrackingSyncState = {
    latestRun: TrackingSyncRun | null;
    isSyncing: boolean;
    /** Estimated next cron tick: lastSuccessfulRun.started_at + 15min */
    nextSyncAt: number | null;
    /** Triggers a manual run via the edge function. */
    runNow: () => Promise<void>;
    /** True while a manual sync request is being submitted (network-only). */
    triggering: boolean;
};

/**
 * Server-driven tracking sync status.
 *
 * Source of truth = `tracking_sync_runs` table, written by the
 * `sync-tracking-statuses` edge function (called by pg_cron every 15 min and
 * by manual button clicks). The hook subscribes to realtime so the UI updates
 * the moment a run starts/finishes.
 *
 * When a run completes successfully and changed > 0, the provided
 * `ordersQueryKey` is invalidated so the orders table reflects new statuses.
 */
export function useTrackingSyncStatus(ordersQueryKey?: QueryKey): TrackingSyncState {
    const queryClient = useQueryClient();
    const [latestRun, setLatestRun] = useState<TrackingSyncRun | null>(null);
    const [triggering, setTriggering] = useState(false);
    const lastInvalidatedRunIdRef = useRef<string | null>(null);
    const ordersQueryKeyRef = useRef(ordersQueryKey);
    ordersQueryKeyRef.current = ordersQueryKey;

    // Initial fetch.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('tracking_sync_runs')
                .select('*')
                .order('started_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (cancelled) return;
            if (data) setLatestRun(data as TrackingSyncRun);
        })();
        return () => { cancelled = true; };
    }, []);

    // Realtime subscription.
    useEffect(() => {
        const channel = supabase
            .channel('tracking-sync-runs-watch')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'tracking_sync_runs' },
                (payload) => {
                    const row = payload.new as TrackingSyncRun;
                    setLatestRun((prev) => {
                        if (!prev) return row;
                        return new Date(row.started_at) >= new Date(prev.started_at) ? row : prev;
                    });
                },
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'tracking_sync_runs' },
                (payload) => {
                    const row = payload.new as TrackingSyncRun;
                    setLatestRun((prev) => {
                        if (!prev || prev.id === row.id) return row;
                        return new Date(row.started_at) >= new Date(prev.started_at) ? row : prev;
                    });
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // When a successful run with changes lands, invalidate the orders query
    // (idempotent — guarded by run id so we don't refetch repeatedly).
    useEffect(() => {
        if (!latestRun) return;
        if (latestRun.status !== 'success') return;
        if (latestRun.changed <= 0) return;
        if (lastInvalidatedRunIdRef.current === latestRun.id) return;
        const key = ordersQueryKeyRef.current;
        if (key) {
            queryClient.invalidateQueries({ queryKey: key });
        }
        lastInvalidatedRunIdRef.current = latestRun.id;
    }, [latestRun, queryClient]);

    const runNow = useCallback(async () => {
        if (triggering) return;
        if (latestRun?.status === 'running') return;
        setTriggering(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                console.error('[tracking-sync] no session — user must be logged in');
                return;
            }
            const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-tracking-statuses`;
            const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                    ...(apikey ? { apikey } : {}),
                },
                body: JSON.stringify({ trigger: 'manual' }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error('[tracking-sync] manual trigger failed:', res.status, text);
            }
        } catch (err) {
            console.error('[tracking-sync] manual trigger error:', err);
        } finally {
            setTriggering(false);
        }
    }, [triggering, latestRun?.status]);

    // Compute the estimated next cron tick from the most recent *completed* run.
    let nextSyncAt: number | null = null;
    if (latestRun && latestRun.finished_at) {
        // Use started_at + 15min — cron fires on a fixed cadence anchored to the
        // previous trigger. This is an estimate; the realtime feed corrects it.
        nextSyncAt = new Date(latestRun.started_at).getTime() + SYNC_INTERVAL_MS;
    }

    return {
        latestRun,
        isSyncing: latestRun?.status === 'running',
        nextSyncAt,
        runNow,
        triggering,
    };
}
