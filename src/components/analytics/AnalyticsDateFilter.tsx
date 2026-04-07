import { useEffect, useState } from 'react';
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
    const [tempRange, setTempRange] = useState<DateRange | undefined>({
        from: dateFilter.from,
        to: dateFilter.to,
    });
    const [hoveredDate, setHoveredDate] = useState<Date | undefined>(undefined);

    const previewRange = tempRange?.from && !tempRange.to && hoveredDate
        ? (hoveredDate.getTime() >= tempRange.from.getTime()
            ? { from: tempRange.from, to: hoveredDate }
            : { from: hoveredDate, to: tempRange.from })
        : undefined;

    useEffect(() => {
        if (open) {
            setTempRange({ from: dateFilter.from, to: dateFilter.to });
        } else {
            setHoveredDate(undefined);
        }
    }, [open, dateFilter.from, dateFilter.to]);

    const handlePreset = (preset: typeof PRESETS[number]) => {
        const range = preset.getRange();
        onDateFilterChange({ from: range.from, to: range.to, label: preset.label });
    };

    const handleRangeSelect = (range: DateRange | undefined) => {
        // Click on the already-active single day -> clear filter.
        if (
            tempRange?.from &&
            !tempRange.to &&
            range?.from &&
            range.to &&
            range.from.getTime() === range.to.getTime() &&
            range.from.getTime() === tempRange.from.getTime()
        ) {
            setTempRange(undefined);
            onDateFilterChange({ from: undefined, to: undefined, label: 'All Time' });
            return;
        }

        // Second click: full range selected -> commit and close.
        if (range?.from && range.to) {
            setTempRange(range);
            onDateFilterChange({
                from: range.from,
                to: range.to,
                label: `${format(range.from, 'MMM d')} - ${format(range.to, 'MMM d, yyyy')}`,
            });
            setOpen(false);
            return;
        }

        // First click (or reset): treat as single-day filter, keep popover open for hover preview + second click.
        if (range?.from && !range.to) {
            setTempRange({ from: range.from, to: undefined });
            onDateFilterChange({
                from: range.from,
                to: range.from,
                label: format(range.from, 'MMM d, yyyy'),
            });
            return;
        }

        setTempRange(range);
    };

    const isPresetActive = PRESETS.some((p) => p.label === dateFilter.label);
    const customLabel =
        !isPresetActive && dateFilter.from
            ? dateFilter.to && dateFilter.from.getTime() !== dateFilter.to.getTime()
                ? `${format(dateFilter.from, 'MMM d')} – ${format(dateFilter.to, 'MMM d, yyyy')}`
                : format(dateFilter.from, 'MMM d, yyyy')
            : 'Custom';
    const customActive = !isPresetActive && !!dateFilter.from;

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
                            : 'bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08] hover:text-brand-navy'
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
                            'rounded-2xl text-xs font-semibold h-9 px-4 gap-2 transition-all',
                            customActive
                                ? 'bg-brand-navy text-white hover:bg-brand-navy/90 hover:text-white'
                                : 'bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08] hover:text-brand-navy'
                        )}
                    >
                        <CalendarDays className="w-3.5 h-3.5" />
                        {customLabel}
                        <ChevronDown className="w-3 h-3" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-2xl" align="end">
                    <Calendar
                        mode="range"
                        selected={tempRange}
                        onSelect={handleRangeSelect}
                        onDayMouseEnter={(day) => setHoveredDate(day)}
                        onDayMouseLeave={() => setHoveredDate(undefined)}
                        modifiers={previewRange ? { preview: previewRange } : undefined}
                        modifiersClassNames={{ preview: 'bg-accent text-accent-foreground' }}
                        numberOfMonths={2}
                        disabled={{ after: new Date() }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
};
