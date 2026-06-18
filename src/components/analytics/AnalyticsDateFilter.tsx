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
    // Set, order, AND windows kept identical to the Orders page date filter.
    // Rolling windows are INCLUSIVE of today: "7 Days" = today + 6 prior = 7
    // calendar days (subDays(now, N-1)). The old subDays(now, N) spanned N+1
    // day-buckets once start/endOfDay was applied downstream, returning a wider
    // window than Orders for the same pill. Today/Yesterday use the bare date;
    // every consumer normalizes via startOfDay(from)/endOfDay(to).
    { label: 'All Time', getRange: () => ({ from: undefined, to: undefined }) },
    { label: 'Today', getRange: () => ({ from: new Date(), to: new Date() }) },
    { label: 'Yesterday', getRange: () => ({ from: subDays(new Date(), 1), to: subDays(new Date(), 1) }) },
    { label: '7 Days', getRange: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
    { label: '30 Days', getRange: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
    { label: '90 Days', getRange: () => ({ from: subDays(new Date(), 89), to: new Date() }) },
    { label: 'This Month', getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
    { label: 'Last Month', getRange: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
    { label: 'YTD', getRange: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

interface AnalyticsDateFilterProps {
    dateFilter: DateFilter;
    onDateFilterChange: (filter: DateFilter) => void;
    /**
     * Visual variant.
     * - 'default' (current/legacy) — teal brand-navy pill-group used across analytics pages.
     * - 'ant' — Anthropic-brand variant: warm ink pills on light paper, orange active state.
     *   Used by the redesigned Dashboard.
     */
    variant?: 'default' | 'ant';
}

export const AnalyticsDateFilter = ({ dateFilter, onDateFilterChange, variant = 'default' }: AnalyticsDateFilterProps) => {
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

    const isAnt = variant === 'ant';

    const presetActiveClass = isAnt
        ? 'bg-ant-ink text-ant-light hover:bg-ant-ink/90 hover:text-ant-light'
        : 'bg-brand-navy text-white hover:bg-brand-navy/90 hover:text-white';
    const presetIdleClass = isAnt
        ? 'bg-transparent text-ant-ink hover:bg-ant-line/60 hover:text-ant-ink border border-ant-line'
        : 'bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08] hover:text-brand-navy';
    const buttonShape = isAnt ? 'rounded-full text-[11px] font-medium h-8 px-3.5' : 'rounded-2xl text-xs font-semibold h-9 px-4';

    return (
        <div className={cn('flex items-center gap-1.5 flex-wrap', !isAnt && 'gap-2')}>
            {PRESETS.map((preset) => (
                <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePreset(preset)}
                    className={cn(
                        buttonShape,
                        'transition-all',
                        dateFilter.label === preset.label ? presetActiveClass : presetIdleClass,
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
                            buttonShape,
                            'gap-1.5 transition-all',
                            customActive ? presetActiveClass : presetIdleClass,
                        )}
                    >
                        <CalendarDays className="w-3.5 h-3.5" />
                        {customLabel}
                        <ChevronDown className="w-3 h-3" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className={cn(
                        'w-auto p-0 rounded-2xl',
                        isAnt && 'ant-surface ant-calendar border-ant-line bg-ant-paper shadow-[0_20px_50px_-18px_rgba(20,20,19,0.25)]',
                    )}
                    align="end"
                >
                    <Calendar
                        mode="range"
                        selected={tempRange}
                        onSelect={handleRangeSelect}
                        onDayMouseEnter={(day) => setHoveredDate(day)}
                        onDayMouseLeave={() => setHoveredDate(undefined)}
                        modifiers={previewRange ? { preview: previewRange } : undefined}
                        modifiersClassNames={{
                            preview: isAnt
                                ? 'bg-ant-orange/15 text-ant-ink'
                                : 'bg-accent text-accent-foreground',
                        }}
                        numberOfMonths={2}
                        disabled={{ after: new Date() }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
};
