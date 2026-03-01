import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { format, subDays, startOfYear, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';

export interface DateFilter {
    from: Date | undefined;
    to: Date | undefined;
    label: string;
}

const PRESETS = [
    { label: 'Today', getRange: () => ({ from: new Date(), to: new Date() }) },
    { label: '7 Days', getRange: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
    { label: '30 Days', getRange: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
    { label: '90 Days', getRange: () => ({ from: subDays(new Date(), 90), to: new Date() }) },
    { label: 'This Month', getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
    { label: 'Last Month', getRange: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
    { label: 'YTD', getRange: () => ({ from: startOfYear(new Date()), to: new Date() }) },
    { label: 'All Time', getRange: () => ({ from: undefined, to: undefined }) },
];

interface AnalyticsDateFilterProps {
    dateFilter: DateFilter;
    onDateFilterChange: (filter: DateFilter) => void;
}

export const AnalyticsDateFilter = ({ dateFilter, onDateFilterChange }: AnalyticsDateFilterProps) => {
    const [open, setOpen] = useState(false);

    const handlePreset = (preset: typeof PRESETS[number]) => {
        const range = preset.getRange();
        onDateFilterChange({ from: range.from, to: range.to, label: preset.label });
    };

    const handleRangeSelect = (range: DateRange | undefined) => {
        if (range) {
            onDateFilterChange({
                from: range.from,
                to: range.to,
                label: range.from && range.to
                    ? `${format(range.from, 'MMM d')} - ${format(range.to, 'MMM d, yyyy')}`
                    : 'Custom',
            });
        }
    };

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {PRESETS.map((preset) => (
                <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePreset(preset)}
                    className={cn(
                        'rounded-2xl text-xs font-semibold h-9 px-4 transition-all',
                        dateFilter.label === preset.label
                            ? 'bg-brand-navy text-white hover:bg-brand-navy/90 hover:text-white'
                            : 'bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08]'
                    )}
                >
                    {preset.label}
                </Button>
            ))}

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                            'rounded-2xl text-xs font-semibold h-9 px-4 gap-2',
                            'bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08]'
                        )}
                    >
                        <CalendarDays className="w-3.5 h-3.5" />
                        Custom
                        <ChevronDown className="w-3 h-3" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-2xl" align="end">
                    <Calendar
                        mode="range"
                        selected={{ from: dateFilter.from, to: dateFilter.to }}
                        onSelect={handleRangeSelect}
                        numberOfMonths={2}
                        disabled={{ after: new Date() }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
};
