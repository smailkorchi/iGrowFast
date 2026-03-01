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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
        >
            <Card className={cn('border-0 shadow-sm rounded-3xl h-full', className)}>
                <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                        <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center', iconBg)}>
                            <Icon className={cn('w-5 h-5', iconColor)} />
                        </div>
                        {trend !== undefined && (
                            <div className={cn(
                                'flex items-center gap-0.5 text-xs font-bold px-2 py-1 rounded-full',
                                trendIsPositive && 'bg-emerald-50 text-emerald-600',
                                trendIsNegative && 'bg-red-50 text-red-600',
                                trendIsZero && 'bg-gray-50 text-gray-500',
                            )}>
                                {trendIsPositive && <ArrowUpRight className="w-3 h-3" />}
                                {trendIsNegative && <ArrowDownRight className="w-3 h-3" />}
                                {trendIsZero && <Minus className="w-3 h-3" />}
                                {Math.abs(trend).toFixed(1)}%
                            </div>
                        )}
                    </div>
                    <div className={cn('text-2xl font-black text-brand-navy tracking-tight', valueColor)}>
                        {prefix}{typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
                        {suffix && <span className="text-[11px] font-bold text-brand-navy/40 ml-0.5">{suffix}</span>}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mt-1">
                        {title}
                    </div>
                    {(subtitle || trendLabel) && (
                        <div className="text-xs text-gray-500 mt-1.5">
                            {subtitle || trendLabel}
                        </div>
                    )}
                </CardContent>
            </Card>
        </motion.div>
    );
};
