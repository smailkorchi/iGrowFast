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
    iconBg = 'bg-brand-navy/5',
    iconColor = 'text-brand-navy',
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
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
        >
            <Card className={cn('border border-gray-100 shadow-none rounded-lg h-full', className)}>
                <CardContent className="p-2.5">
                    <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <Icon className={cn('w-3 h-3 shrink-0', iconColor)} />
                            <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 truncate">
                                {title}
                            </span>
                        </div>
                        {trend !== undefined && (
                            <div className={cn(
                                'flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md tabular-nums shrink-0',
                                trendIsPositive && 'bg-emerald-50 text-emerald-600',
                                trendIsNegative && 'bg-red-50 text-red-600',
                                trendIsZero && 'bg-gray-50 text-gray-500',
                            )}>
                                {trendIsPositive && <ArrowUpRight className="w-2.5 h-2.5" />}
                                {trendIsNegative && <ArrowDownRight className="w-2.5 h-2.5" />}
                                {trendIsZero && <Minus className="w-2.5 h-2.5" />}
                                {Math.abs(trend).toFixed(1)}%
                            </div>
                        )}
                    </div>
                    <div className={cn('text-[17px] font-semibold text-brand-navy tabular-nums leading-none mt-1.5', valueColor)}>
                        {prefix}{typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
                        {suffix && <span className="text-[9px] font-semibold text-brand-navy/40 ml-0.5">{suffix}</span>}
                    </div>
                    {(subtitle || trendLabel) && (
                        <div className="text-[9px] text-gray-400 mt-1 truncate tabular-nums">
                            {subtitle || trendLabel}
                        </div>
                    )}
                </CardContent>
            </Card>
        </motion.div>
    );
};
