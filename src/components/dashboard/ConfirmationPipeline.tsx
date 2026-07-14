import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneCall } from 'lucide-react';
import { StackedProportionBar } from './performance/StackedProportionBar';

/**
 * `confirmation_pipeline` section of admin_dashboard_stats (D2). Same pool as
 * pending_breakdown (pending_confirmation flag + no tracking, null dates pass
 * every window), grouped by order_status_id with label/color resolved
 * server-side; already sorted count desc.
 */
export interface ConfirmationPipelineSection {
    total: number;
    statuses: Array<{
        order_status_id: string;
        label: string;
        color: string;
        count: number;
    }>;
}

interface ConfirmationPipelineProps {
    stats: ConfirmationPipelineSection | undefined;
}

export const ConfirmationPipeline = ({ stats }: ConfirmationPipelineProps) => {
    if (!stats) return null;

    const sorted = stats.statuses.map((s) => ({
        code: s.order_status_id,
        label: s.label,
        count: s.count,
        color: s.color,
    }));
    const total = stats.total;
    const topThree = sorted.slice(0, 3);

    return (
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">
                            Confirmation pipeline
                        </CardTitle>
                    </div>
                    <span className="text-[10px] text-ant-mid uppercase tracking-[0.18em] tabular-nums">
                        {total.toLocaleString('fr-MA')} being confirmed
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                <div className="space-y-2">
                    <StackedProportionBar
                        segments={sorted.map((s) => ({
                            id: s.code,
                            label: s.label,
                            count: s.count,
                            color: s.color,
                        }))}
                        total={total}
                        height={6}
                    />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {topThree.map((s) => {
                            const pct = total > 0 ? (s.count / total) * 100 : 0;
                            return (
                                <span key={s.code} className="inline-flex items-center gap-1 text-[10px]">
                                    <PhoneCall className="hidden" />
                                    <span
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{ backgroundColor: s.color }}
                                    />
                                    <span className="text-ant-ink truncate max-w-[110px]">{s.label}</span>
                                    <span className="text-ant-mid tabular-nums">
                                        {pct.toFixed(0)}%
                                    </span>
                                </span>
                            );
                        })}
                        {sorted.length > 3 && (
                            <span className="text-[10px] text-ant-mid">+{sorted.length - 3} more</span>
                        )}
                    </div>
                </div>

                <div className="h-px bg-ant-line" />

                <div className="space-y-0 max-h-[200px] overflow-y-auto pr-1 ant-scroll">
                    {sorted.length === 0 ? (
                        <p className="font-serif-display text-[11px] text-ant-muted italic py-2 text-center">
                            No orders awaiting confirmation in this period
                        </p>
                    ) : (
                        sorted.map((s) => {
                            const pct = total > 0 ? (s.count / total) * 100 : 0;
                            return (
                                <div
                                    key={s.code}
                                    className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-ant-line-soft transition-colors"
                                >
                                    <span
                                        className="w-[3px] h-3.5 rounded-full shrink-0"
                                        style={{ backgroundColor: s.color }}
                                        aria-hidden
                                    />
                                    <span className="text-[11px] font-medium text-ant-ink flex-1 min-w-0 truncate">
                                        {s.label}
                                    </span>
                                    <div className="w-20 h-[3px] rounded-full bg-ant-line overflow-hidden shrink-0">
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${Math.min(100, pct)}%`,
                                                backgroundColor: s.color,
                                            }}
                                        />
                                    </div>
                                    <span className="text-[11px] font-semibold text-ant-ink tabular-nums w-8 text-right shrink-0">
                                        {s.count}
                                    </span>
                                    <span className="text-[10px] text-ant-mid tabular-nums w-10 text-right shrink-0">
                                        {pct.toFixed(1)}%
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
