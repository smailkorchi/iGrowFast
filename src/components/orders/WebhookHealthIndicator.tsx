import { useEffect, useRef, useState } from 'react';
import { Activity, Wifi, WifiOff, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useWebhookHealth, type WebhookHealthState } from '@/hooks/useWebhookHealth';
import { cn } from '@/lib/utils';

function timeAgo(iso: string | null): string {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

type Status = 'live' | 'idle' | 'error' | 'none';

function getStatus(h: WebhookHealthState): Status {
    if (h.activeCount === 0) return 'none';
    if (h.recentFailed > 0 && h.recentFailed > h.recentProcessed) return 'error';
    if (!h.lastEventAt) return 'idle';
    const age = Date.now() - new Date(h.lastEventAt).getTime();
    if (age > 60 * 60 * 1000) return 'idle'; // > 1 hour
    return 'live';
}

const statusConfig: Record<Status, { label: string; dotClass: string; pillClass: string }> = {
    live: {
        label: 'Webhooks Live',
        dotClass: 'bg-ant-green',
        pillClass: 'bg-ant-green/10 text-ant-green border-ant-green/30',
    },
    idle: {
        label: 'Webhooks Idle',
        dotClass: 'bg-ant-orange',
        pillClass: 'bg-ant-orange/10 text-ant-orange border-ant-orange/30',
    },
    error: {
        label: 'Webhook Errors',
        dotClass: 'bg-ant-rose',
        pillClass: 'bg-ant-rose/10 text-ant-rose border-red-200',
    },
    none: {
        label: 'No Webhooks',
        dotClass: 'bg-gray-400',
        pillClass: 'bg-ant-line-soft text-ant-muted border-ant-line',
    },
};

export function WebhookHealthIndicator({
    activeBusinessId,
    className,
}: {
    activeBusinessId: string | null;
    className?: string;
}) {
    const health = useWebhookHealth(activeBusinessId);
    const status = getStatus(health);
    const config = statusConfig[status];

    // Pulse animation on new webhook event
    const [isPulsing, setIsPulsing] = useState(false);
    const prevPulse = useRef(health.pulse);
    useEffect(() => {
        if (health.pulse !== prevPulse.current) {
            prevPulse.current = health.pulse;
            setIsPulsing(true);
            const t = setTimeout(() => setIsPulsing(false), 1500);
            return () => clearTimeout(t);
        }
    }, [health.pulse]);

    if (!activeBusinessId) return null;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    className={cn(
                        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer hover:shadow-sm',
                        config.pillClass,
                        isPulsing && 'ring-2 ring-emerald-300 ring-offset-1',
                        className,
                    )}
                >
                    {/* Animated dot */}
                    <span className="relative flex h-2 w-2">
                        {status === 'live' && (
                            <span className={cn('absolute inset-0 rounded-full animate-ping opacity-75', config.dotClass)} />
                        )}
                        <span className={cn('relative inline-flex h-2 w-2 rounded-full', config.dotClass)} />
                    </span>
                    {config.label}
                    {health.activeCount > 0 && (
                        <span className="opacity-60">({health.activeCount})</span>
                    )}
                    {health.lastEventAt && status !== 'none' && (
                        <span className="opacity-50 font-normal">{timeAgo(health.lastEventAt)}</span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
                <div className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-ant-muted" />
                            <span className="text-sm font-semibold text-ant-ink">Webhook Status</span>
                        </div>
                        {health.isListening ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ant-green">
                                <Wifi className="w-3 h-3" /> Realtime
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ant-mid">
                                <WifiOff className="w-3 h-3" /> Disconnected
                            </span>
                        )}
                    </div>

                    {/* Per-provider list */}
                    {health.providers.length === 0 ? (
                        <p className="text-xs text-ant-mid py-2">No active webhook providers configured.</p>
                    ) : (
                        <div className="space-y-2">
                            {health.providers.map((p) => {
                                const isRecent = p.lastReceivedAt &&
                                    (Date.now() - new Date(p.lastReceivedAt).getTime()) < 60 * 60 * 1000;
                                return (
                                    <div key={p.providerId} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-ant-line-soft">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: p.providerColor || '#6b7280' }}
                                            />
                                            <span className="text-xs font-medium text-ant-ink">{p.providerName}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {isRecent ? (
                                                <CheckCircle2 className="w-3 h-3 text-ant-green" />
                                            ) : p.lastReceivedAt ? (
                                                <Clock className="w-3 h-3 text-ant-orange" />
                                            ) : (
                                                <AlertTriangle className="w-3 h-3 text-ant-mid" />
                                            )}
                                            <span className="text-[10px] text-ant-muted">
                                                {timeAgo(p.lastReceivedAt)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Stats row */}
                    {health.recentTotal > 0 && (
                        <div className="flex items-center gap-3 pt-1 border-t border-ant-line">
                            <span className="text-[10px] text-ant-muted">Last 1h:</span>
                            <span className="text-[10px] font-medium text-ant-green">
                                {health.recentProcessed} processed
                            </span>
                            {health.recentFailed > 0 && (
                                <span className="text-[10px] font-medium text-ant-rose">
                                    {health.recentFailed} failed
                                </span>
                            )}
                        </div>
                    )}

                </div>
            </PopoverContent>
        </Popover>
    );
}
