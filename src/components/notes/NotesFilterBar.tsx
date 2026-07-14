import React from 'react';
import { Search, SlidersHorizontal, X, CalendarRange, Coins } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export interface FilterOption { value: string; label: string; }

interface SelectFilter {
    value: string;
    onChange: (v: string) => void;
    options: FilterOption[];   // caller supplies the leading "all" option
    placeholder?: string;
    icon?: React.ReactNode;
    widthClass?: string;
}

interface DateFilter {
    from: string;              // 'YYYY-MM-DD' or ''
    to: string;
    onChange: (from: string, to: string) => void;
}

interface AmountFilter {
    min: string;
    max: string;
    onChange: (min: string, max: string) => void;
}

interface NotesFilterBarProps {
    search: string;
    onSearch: (v: string) => void;
    searchPlaceholder?: string;
    status?: SelectFilter;
    entity?: SelectFilter;
    createdBy?: SelectFilter;
    date?: DateFilter;
    amount?: AmountFilter;
    /** number of non-default filters currently applied (drives the Reset control) */
    activeCount: number;
    onReset: () => void;
    /** optional right-aligned slot (e.g. a result count) */
    trailing?: React.ReactNode;
}

const pill =
    'h-9 rounded-full border-ant-line bg-ant-paper text-[11.5px] text-ant-ink data-[placeholder]:text-ant-mid focus:ring-ant-orange focus:ring-offset-0';

function FilterSelect({ f }: { f: SelectFilter }) {
    return (
        <Select value={f.value} onValueChange={f.onChange}>
            <SelectTrigger className={`${pill} ${f.widthClass || 'w-[150px]'} px-3.5 gap-1.5`}>
                {f.icon}
                <SelectValue placeholder={f.placeholder} />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-ant-line">
                {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[12px]">
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function NotesFilterBar({
    search, onSearch, searchPlaceholder = 'Search name, phone, tracking or reference…',
    status, entity, createdBy, date, amount, activeCount, onReset, trailing,
}: NotesFilterBarProps) {
    const dateActive = !!(date && (date.from || date.to));
    const amountActive = !!(amount && (amount.min || amount.max));

    return (
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 rounded-2xl border border-ant-line bg-ant-surface/60 p-2">
            {/* Universal search */}
            <div className="relative w-full lg:w-[320px] shrink-0">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                <Input
                    placeholder={searchPlaceholder}
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25"
                />
                {search && (
                    <button
                        type="button"
                        onClick={() => onSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                        aria-label="Clear search"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
                {status && <FilterSelect f={status} />}
                {entity && <FilterSelect f={entity} />}
                {createdBy && <FilterSelect f={createdBy} />}

                {date && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className={`h-9 px-3.5 rounded-full border-ant-line bg-ant-paper text-[11.5px] gap-1.5 ${dateActive ? 'text-ant-ink border-ant-ink/25' : 'text-ant-mid'}`}
                            >
                                <CalendarRange className="w-3.5 h-3.5" />
                                {dateActive ? `${date.from || '…'} → ${date.to || '…'}` : 'Date'}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 rounded-xl border-ant-line p-3 space-y-2" align="start">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase tracking-widest text-ant-mid">From</label>
                                <Input type="date" value={date.from}
                                    onChange={(e) => date.onChange(e.target.value, date.to)}
                                    className="h-8 rounded-lg border-ant-line text-[12px]" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase tracking-widest text-ant-mid">To</label>
                                <Input type="date" value={date.to}
                                    onChange={(e) => date.onChange(date.from, e.target.value)}
                                    className="h-8 rounded-lg border-ant-line text-[12px]" />
                            </div>
                            {dateActive && (
                                <Button variant="ghost" onClick={() => date.onChange('', '')}
                                    className="w-full h-7 text-[11px] text-ant-mid hover:text-ant-ink">Clear dates</Button>
                            )}
                        </PopoverContent>
                    </Popover>
                )}

                {amount && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className={`h-9 px-3.5 rounded-full border-ant-line bg-ant-paper text-[11.5px] gap-1.5 ${amountActive ? 'text-ant-ink border-ant-ink/25' : 'text-ant-mid'}`}
                            >
                                <Coins className="w-3.5 h-3.5" />
                                {amountActive ? `${amount.min || '0'} – ${amount.max || '∞'}` : 'Amount'}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 rounded-xl border-ant-line p-3 space-y-2" align="start">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-widest text-ant-mid">Min</label>
                                    <Input type="number" inputMode="decimal" value={amount.min}
                                        onChange={(e) => amount.onChange(e.target.value, amount.max)}
                                        className="h-8 rounded-lg border-ant-line text-[12px]" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-widest text-ant-mid">Max</label>
                                    <Input type="number" inputMode="decimal" value={amount.max}
                                        onChange={(e) => amount.onChange(amount.min, e.target.value)}
                                        className="h-8 rounded-lg border-ant-line text-[12px]" />
                                </div>
                            </div>
                            {amountActive && (
                                <Button variant="ghost" onClick={() => amount.onChange('', '')}
                                    className="w-full h-7 text-[11px] text-ant-mid hover:text-ant-ink">Clear amount</Button>
                            )}
                        </PopoverContent>
                    </Popover>
                )}

                {activeCount > 0 && (
                    <Button
                        variant="ghost"
                        onClick={onReset}
                        className="h-9 px-3 rounded-full text-[11.5px] text-ant-mid hover:text-ant-ink gap-1.5"
                    >
                        <X className="w-3.5 h-3.5" />
                        Reset
                        <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-ant-ink text-ant-light text-[9px] tabular-nums">{activeCount}</span>
                    </Button>
                )}
            </div>

            <div className="hidden lg:flex items-center gap-1.5 text-ant-mid ml-auto pr-1">
                {trailing ?? <SlidersHorizontal className="w-3.5 h-3.5 opacity-40" />}
            </div>
        </div>
    );
}

export default NotesFilterBar;
