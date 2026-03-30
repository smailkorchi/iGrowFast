import * as React from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

export type OrderLineProductOption = {
    id: string;
    name: string;
    code?: string | null;
    stock?: number | null;
    selling_price?: number | null;
};

export function toProductStockNumber(stock: unknown): number | null {
    if (stock === null || stock === undefined) return null;
    const n = Number(stock);
    return Number.isFinite(n) ? n : null;
}

export function productStockTextClass(stock: number | null) {
    if (stock === null) return 'text-brand-navy';
    if (stock <= 0) return 'text-red-600';
    if (stock < 10) return 'text-amber-600';
    return 'text-emerald-700';
}

type OrderLineProductComboboxProps = {
    products: OrderLineProductOption[] | undefined;
    value: string;
    onProductIdChange: (productId: string) => void;
    blockZeroStock: boolean;
    formatLabel: (p: OrderLineProductOption) => string;
    triggerClassName?: string;
    allowNone?: boolean;
    noneLabel?: string;
};

export const OrderLineProductCombobox = React.forwardRef<HTMLButtonElement, OrderLineProductComboboxProps>(
    function OrderLineProductCombobox(
        {
            products,
            value,
            onProductIdChange,
            blockZeroStock,
            formatLabel,
            triggerClassName,
            allowNone = true,
            noneLabel = '— None —',
        },
        ref
    ) {
        const [open, setOpen] = React.useState(false);
        const list = products ?? [];
        const selected = value && value !== 'none' ? list.find((p) => p.id === value) : undefined;
        const selStock = selected ? toProductStockNumber(selected.stock) : null;

        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        ref={ref}
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className={cn(
                            'h-10 w-full justify-between rounded-xl border border-brand-navy/10 bg-brand-navy/[0.03] px-3 text-sm font-bold text-brand-navy shadow-none',
                            triggerClassName
                        )}
                    >
                        <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-left">
                            {selected ? (
                                <>
                                    <span className="truncate">{formatLabel(selected)}</span>
                                    {selStock !== null && (
                                        <span
                                            className={cn(
                                                'shrink-0 text-[11px] font-black tabular-nums',
                                                productStockTextClass(selStock)
                                            )}
                                        >
                                            · {selStock} in stock
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="truncate font-medium text-muted-foreground">Choose product…</span>
                            )}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] min-w-[min(100vw-2rem,320px)] p-0 rounded-xl border border-brand-navy/10 shadow-2xl"
                    align="start"
                    onWheel={(e) => e.stopPropagation()}
                >
                    <Command>
                        <CommandInput placeholder="Search product…" className="h-11" />
                        <CommandList className="max-h-[min(50vh,260px)]">
                            <CommandEmpty>No product found.</CommandEmpty>
                            <CommandGroup>
                                {allowNone && (
                                    <CommandItem
                                        value="__none__"
                                        onSelect={() => {
                                            onProductIdChange('none');
                                            setOpen(false);
                                        }}
                                        className="cursor-pointer font-medium text-muted-foreground"
                                    >
                                        {noneLabel}
                                    </CommandItem>
                                )}
                                {list.map((p) => {
                                    const sn = toProductStockNumber(p.stock);
                                    const isOos = sn === 0;
                                    const disabled = blockZeroStock && isOos;
                                    const rowClass = productStockTextClass(sn);
                                    return (
                                        <CommandItem
                                            key={p.id}
                                            value={`${formatLabel(p)} ${p.code ?? ''} ${p.id}`}
                                            disabled={disabled}
                                            onSelect={() => {
                                                if (disabled) return;
                                                onProductIdChange(p.id);
                                                setOpen(false);
                                            }}
                                            className={cn(
                                                'cursor-pointer py-2.5 font-bold',
                                                disabled && 'cursor-not-allowed opacity-50'
                                            )}
                                        >
                                            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                                <span className="min-w-0 truncate text-brand-navy">
                                                    {formatLabel(p)}
                                                    <span className="ml-1.5 text-[10px] font-semibold text-muted-foreground">
                                                        ({p.code ?? '—'})
                                                    </span>
                                                </span>
                                                {sn !== null && (
                                                    <span
                                                        className={cn(
                                                            'shrink-0 text-[10px] font-black tabular-nums',
                                                            rowClass
                                                        )}
                                                    >
                                                        {sn}
                                                    </span>
                                                )}
                                            </span>
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        );
    }
);

OrderLineProductCombobox.displayName = 'OrderLineProductCombobox';

type StockHintProps = {
    stock: number | null;
    blockZeroStock: boolean;
};

export function OrderLineProductStockHint({ stock, blockZeroStock }: StockHintProps) {
    if (stock === null) return null;
    const low = stock > 0 && stock < 10;
    const out = stock <= 0;
    return (
        <div
            className={cn(
                'mt-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold leading-snug',
                out && 'border-red-200 bg-red-50 text-red-700',
                low && 'border-amber-200 bg-amber-50 text-amber-800',
                !out && !low && 'border-emerald-100 bg-emerald-50/90 text-emerald-800'
            )}
        >
            In stock: <span className="tabular-nums">{stock}</span>
            {blockZeroStock && out && ' · Out of stock — pick another product for a new order.'}
            {low && ' · Low stock (under 10).'}
        </div>
    );
}
