import { useEffect, useRef, useState } from 'react';
import { Activity, Wifi, WifiOff, ExternalLink, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
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
        dotClass: 'bg-emerald-500',
        pillClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    idle: {
        label: 'Webhooks Idle',
        dotClass: 'bg-amber-500',
        pillClass: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    error: {
        label: 'Webhook Errors',
        dotClass: 'bg-red-500',
        pillClass: 'bg-red-50 text-red-700 border-red-200',
    },
    none: {
        label: 'No Webhooks',
        dotClass: 'bg-gray-400',
        pillClass: 'bg-gray-50 text-gray-500 border-gray-200',
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
                            <Activity className="w-4 h-4 text-gray-600" />
                            <span className="text-sm font-semibold text-gray-900">Webhook Status</span>
                        </div>
                        {health.isListening ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                                <Wifi className="w-3 h-3" /> Realtime
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
                                <WifiOff className="w-3 h-3" /> Disconnected
                            </span>
                        )}
                    </div>

                    {/* Per-provider list */}
                    {health.providers.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No active webhook providers configured.</p>
                    ) : (
                        <div className="space-y-2">
                            {health.providers.map((p) => {
                                const isRecent = p.lastReceivedAt &&
                                    (Date.now() - new Date(p.lastReceivedAt).getTime()) < 60 * 60 * 1000;
                                return (
                                    <div key={p.providerId} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-gray-50">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: p.providerColor || '#6b7280' }}
                                            />
                                            <span className="text-xs font-medium text-gray-700">{p.providerName}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {isRecent ? (
                                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                            ) : p.lastReceivedAt ? (
                                                <Clock className="w-3 h-3 text-amber-500" />
                                            ) : (
                                                <AlertTriangle className="w-3 h-3 text-gray-400" />
                                            )}
                                            <span className="text-[10px] text-gray-500">
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
                        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
                            <span className="text-[10px] text-gray-500">Last 1h:</span>
                            <span className="text-[10px] font-medium text-emerald-600">
                                {health.recentProcessed} processed
                            </span>
                            {health.recentFailed > 0 && (
                                <span className="text-[10px] font-medium text-red-500">
                                    {health.recentFailed} failed
                                </span>
                            )}
                        </div>
                    )}

                    {/* Link to Webhooks page */}
                    <a
                        href="/webhooks"
                        className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 hover:text-blue-700 pt-1"
                    >
                        Manage Webhooks <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
            </PopoverContent>
        </Popover>
    );
}
