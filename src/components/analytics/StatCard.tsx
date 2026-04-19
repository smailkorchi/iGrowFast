import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: LucideIcon;
    /** Kept for backwards-compat — ignored in the new Anthropic design. */
    iconBg?: string;
    iconColor?: string;
    trend?: number;
    trendLabel?: string;
    prefix?: string;
    suffix?: string;
    className?: string;
    valueColor?: string;
}

export const StatCard = ({
    title,
    value,
    subtitle,
    icon: Icon,
    trend,
    trendLabel,
    prefix,
    suffix,
    className,
    valueColor,
}: StatCardProps) => {
    const trendIsPositive = trend !== undefined && trend > 0;
    const trendIsNegative = trend !== undefined && trend < 0;
    const trendIsZero = trend !== undefined && trend === 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
        >
            <Card
                className={cn(
                    'group relative border border-ant-line bg-ant-paper shadow-none rounded-xl h-full overflow-hidden transition-all',
                    className,
                )}
            >
                <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <Icon className="w-3 h-3 text-ant-mid shrink-0" strokeWidth={1.75} />
                            <span className="text-[9.5px] uppercase tracking-[0.18em] font-medium text-ant-mid truncate">
                                {title}
                            </span>
                        </div>
                        {trend !== undefined && (
                            <div
                                className={cn(
                                    'flex items-center gap-0.5 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums shrink-0',
                                    trendIsPositive && 'bg-ant-green/12 text-ant-green',
                                    trendIsNegative && 'bg-ant-rose/12 text-ant-rose',
                                    trendIsZero && 'bg-ant-line text-ant-mid',
                                )}
                            >
                                {trendIsPositive && <ArrowUpRight className="w-2.5 h-2.5" />}
                                {trendIsNegative && <ArrowDownRight className="w-2.5 h-2.5" />}
                                {trendIsZero && <Minus className="w-2.5 h-2.5" />}
                                {Math.abs(trend).toFixed(1)}%
                            </div>
                        )}
                    </div>
                    <div
                        className={cn(
                            'font-display text-[20px] font-semibold text-ant-ink tabular-nums leading-none tracking-[-0.02em] mt-2',
                            valueColor,
                        )}
                    >
                        {prefix}
                        {typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
                        {suffix && (
                            <span className="text-[10px] font-medium text-ant-mid ml-1">{suffix}</span>
                        )}
                    </div>
                    {(subtitle || trendLabel) && (
                        <div className="text-[10px] text-ant-muted mt-1.5 truncate tabular-nums">
                            {subtitle || trendLabel}
                        </div>
                    )}
                </CardContent>
            </Card>
        </motion.div>
    );
};
