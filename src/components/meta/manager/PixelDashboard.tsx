import React from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { AlertCircle, Clock, Layers, MousePointerClick, Radio, Zap } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
    useMetaPixelOverview,
    useMetaPixelEventsByType,
    useMetaPixelTimeseries,
    type DatePreset,
    type MetaConnection,
} from '@/hooks/useMetaAds';
import { nf, nfc } from '../shared/metaTheme';

interface Props {
    connection: MetaConnection;
    datePreset: DatePreset;
}

export const PixelDashboard: React.FC<Props> = ({ connection, datePreset }) => {
    const overviewQ = useMetaPixelOverview(connection.id, connection.pixel_id);
    const eventsQ = useMetaPixelEventsByType(connection.id, datePreset, connection.pixel_id);
    const seriesQ = useMetaPixelTimeseries(connection.id, datePreset, connection.pixel_id);

    if (!connection.pixel_id) {
        return (
            <div className="bg-ant-orange/10 border border-[#f0ad4e]/30 rounded-lg p-4 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-ant-orange shrink-0" />
                <div className="text-[13px] font-semibold text-[#856404]">
                    No Pixel linked to this connection. Edit the connection to select a Pixel.
                </div>
            </div>
        );
    }

    const events = eventsQ.data?.[0]?.data ?? [];
    const totalFires = events.reduce((s, e) => s + (Number(e.count) || 0), 0);
    const byType = [...events].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));

    const FUNNEL_ORDER = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'];
    const byTypeMap = Object.fromEntries(byType.map((r) => [r.value, Number(r.count) || 0]));
    const funnel = FUNNEL_ORDER.map((name) => ({ name, count: byTypeMap[name] ?? 0 }));
    const funnelMax = Math.max(1, ...funnel.map((f) => f.count));

    return (
        <div className="space-y-4">
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <PixelKpi
                    label="Pixel name"
                    value={overviewQ.data?.name ?? '--'}
                    icon={Radio}
                />
                <PixelKpi
                    label="Total events"
                    value={eventsQ.isLoading ? '--' : nfc.format(totalFires)}
                    icon={Zap}
                />
                <PixelKpi
                    label="Unique types"
                    value={eventsQ.isLoading ? '--' : String(byType.length)}
                    icon={Layers}
                />
                <PixelKpi
                    label="Last fired"
                    value={
                        overviewQ.data?.last_fired_time
                            ? new Date(overviewQ.data.last_fired_time).toLocaleString()
                            : '--'
                    }
                    icon={Clock}
                />
            </div>

            {/* Timeseries */}
            <div className="bg-white border border-ant-line rounded-lg p-4">
                <div className="mb-3">
                    <div className="text-[13px] font-semibold text-ant-ink">
                        Event volume over time
                    </div>
                    <div className="text-[11px] text-ant-mid">
                        All pixel fires grouped by time bucket
                    </div>
                </div>
                <div className="h-56">
                    {seriesQ.isLoading ? (
                        <Skeleton className="w-full h-full rounded" />
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={(seriesQ.data?.[0]?.data ?? []).map((p) => ({
                                    value: Number(p.value) ? new Date(Number(p.value) * 1000).toLocaleDateString() : p.value,
                                    count: Number(p.count) || 0,
                                }))}
                            >
                                <defs>
                                    <linearGradient id="pixel-vol" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#1877F2" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#1877F2" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e8e6dc" vertical={false} />
                                <XAxis
                                    dataKey="value"
                                    tick={{ fontSize: 11, fill: '#b0aea5' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#b0aea5' }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(v) => nfc.format(Number(v))}
                                />
                                <Tooltip
                                    contentStyle={{
                                        border: '1px solid #e8e6dc',
                                        borderRadius: 8,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                        fontSize: 12,
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="count"
                                    stroke="#1877F2"
                                    strokeWidth={2}
                                    fill="url(#pixel-vol)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* Funnel + event types */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Funnel */}
                <div className="bg-white border border-ant-line rounded-lg p-4">
                    <div className="text-[13px] font-semibold text-ant-ink mb-1">
                        Conversion funnel
                    </div>
                    <div className="text-[11px] text-ant-mid mb-4">Standard e-commerce funnel</div>
                    <div className="space-y-3">
                        {funnel.map((step, i) => {
                            const pctW = (step.count / funnelMax) * 100;
                            const prev = i > 0 ? funnel[i - 1].count : step.count;
                            const rate = prev > 0 ? (step.count / prev) * 100 : 0;
                            return (
                                <div key={step.name}>
                                    <div className="flex items-center justify-between text-[12px] mb-1">
                                        <span className="font-semibold text-ant-ink">{step.name}</span>
                                        <span className="font-semibold tabular-nums text-ant-ink">
                                            {nf.format(step.count)}
                                            {i > 0 && (
                                                <span className="text-[10px] font-normal text-ant-mid ml-2">
                                                    {rate.toFixed(1)}%
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <div className="h-2 rounded-full bg-ant-light overflow-hidden">
                                        <div
                                            className="h-full bg-[#1877F2] rounded-full transition-all duration-500"
                                            style={{ width: `${pctW}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* All event types */}
                <div className="bg-white border border-ant-line rounded-lg p-4">
                    <div className="text-[13px] font-semibold text-ant-ink mb-1">
                        All event types
                    </div>
                    <div className="text-[11px] text-ant-mid mb-4">Sorted by volume</div>
                    {eventsQ.isLoading ? (
                        <Skeleton className="h-48" />
                    ) : byType.length === 0 ? (
                        <div className="text-[12px] text-ant-mid py-10 text-center">
                            No events in this date range
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
                            {byType.map((e) => (
                                <div key={e.value} className="flex items-center justify-between text-[12px]">
                                    <div className="flex items-center gap-2">
                                        <MousePointerClick className="w-3.5 h-3.5 text-ant-mid" />
                                        <span className="font-medium text-ant-ink">{e.value}</span>
                                    </div>
                                    <span className="font-semibold tabular-nums text-ant-ink">
                                        {nfc.format(Number(e.count) || 0)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── Pixel KPI card ──────────────────────────────────────────────────────
const PixelKpi: React.FC<{
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
}> = ({ label, value, icon: Icon }) => (
    <div className="bg-white border border-ant-line rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-[#ebf5ff] flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-[#1877F2]" />
            </div>
            <span className="text-[11px] text-ant-muted">{label}</span>
        </div>
        <div className="text-[16px] font-semibold text-ant-ink truncate">{value}</div>
    </div>
);
