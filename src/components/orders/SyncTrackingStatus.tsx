import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Clock, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TrackingSyncRun } from '@/hooks/useTrackingSyncStatus';

type SyncTrackingStatusProps = {
    latestRun: TrackingSyncRun | null;
    isSyncing: boolean;
    nextSyncAt: number | null;
    triggering: boolean;
    onRunNow: () => void;
    className?: string;
};

function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m <= 0) return `${s}s`;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/**
 * Server-driven sync indicator + manual trigger button.
 *
 * Reads its state from `useTrackingSyncStatus` (backed by `tracking_sync_runs`
 * + Supabase realtime). The button is enabled only when no run is in flight.
 */
export function SyncTrackingStatus({
    latestRun,
    isSyncing,
    nextSyncAt,
    triggering,
    onRunNow,
    className,
}: SyncTrackingStatusProps) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);

    const buttonDisabled = isSyncing || triggering;

    let pill: React.ReactNode;
    if (isSyncing) {
        const target = latestRun?.total ?? 0;
        pill = (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ant-ink/5 border border-ant-ink/10 text-xs font-bold text-ant-ink select-none cursor-default">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Synchronisation des suivis…
                {target > 0 && (
                    <span className="opacity-60 font-semibold">· {target} colis</span>
                )}
            </div>
        );
    } else if (latestRun?.status === 'error') {
        pill = (
            <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ant-rose/10 border border-red-200 text-xs font-bold text-ant-rose select-none cursor-default"
                title={latestRun.error || 'Erreur de synchronisation'}
            >
                <AlertTriangle className="w-3.5 h-3.5" />
                Synchro échouée
            </div>
        );
    } else if (latestRun && nextSyncAt) {
        const remaining = nextSyncAt - now;
        const lastChanged = latestRun.changed;
        const lastTotal = latestRun.total;
        pill = (
            <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ant-green/10 border border-ant-green/30 text-xs font-bold text-ant-green select-none cursor-default"
                title={`Dernière synchro : ${new Date(latestRun.started_at).toLocaleTimeString()} · ${lastChanged}/${lastTotal} mis à jour`}
            >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Suivis à jour
                {lastChanged > 0 && (
                    <span className="opacity-70 font-semibold">· {lastChanged} maj</span>
                )}
                {remaining > 0 && (
                    <>
                        <span className="opacity-60 font-semibold">·</span>
                        <Clock className="w-3 h-3 opacity-70" />
                        <span className="font-semibold opacity-80">{formatCountdown(remaining)}</span>
                    </>
                )}
            </div>
        );
    } else {
        pill = (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border text-xs font-bold text-ant-muted select-none cursor-default">
                <Clock className="w-3.5 h-3.5" />
                Suivi automatique en attente…
            </div>
        );
    }

    return (
        <div className={cn('inline-flex items-center gap-2', className)} aria-live="polite">
            {pill}
            <button
                type="button"
                onClick={onRunNow}
                disabled={buttonDisabled}
                className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all',
                    'bg-ant-ink text-ant-light border-ant-ink hover:bg-ant-ink/90 active:scale-95',
                    'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
                )}
                title={buttonDisabled ? 'Synchronisation en cours…' : 'Synchroniser maintenant'}
            >
                {triggering || isSyncing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                )}
                Sync now
            </button>
        </div>
    );
}
