/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';
import { ChevronsUpDown, ImageOff, Package, Check } from 'lucide-react';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';
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
    image_url?: string | null;
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

function stockPillClass(stock: number | null) {
    if (stock === null) return 'bg-brand-navy/[0.06] text-brand-navy/60 ring-brand-navy/10';
    if (stock <= 0) return 'bg-red-50 text-red-700 ring-red-200/70';
    if (stock < 10) return 'bg-amber-50 text-amber-800 ring-amber-200/70';
    return 'bg-emerald-50 text-emerald-800 ring-emerald-200/70';
}

type ProductThumbProps = {
    src?: string | null;
    alt: string;
    size?: 'sm' | 'md';
};

function ProductThumb({ src, alt, size = 'md' }: ProductThumbProps) {
    const dims = size === 'sm' ? 'h-11 w-11' : 'h-12 w-12';
    return (
        <div
            className={cn(
                dims,
                'shrink-0 overflow-hidden rounded-xl bg-brand-navy/[0.06] ring-1 ring-inset ring-brand-navy/10 flex items-center justify-center'
            )}
        >
            {src ? (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                        const sib = (e.currentTarget.nextElementSibling as HTMLElement | null);
                        if (sib) sib.style.display = 'flex';
                    }}
                />
            ) : null}
            <div
                className={cn('h-full w-full items-center justify-center text-brand-navy/30', src ? 'hidden' : 'flex')}
                aria-hidden
            >
                <ImageOff className="h-4 w-4" />
            </div>
        </div>
    );
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
        const [search, setSearch] = React.useState('');
        const list = products ?? [];
        const selected = value && value !== 'none' ? list.find((p) => p.id === value) : undefined;
        const selStock = selected ? toProductStockNumber(selected.stock) : null;

        const displayList = React.useMemo(() => {
            const q = search.trim().toLowerCase();
            const filtered = q
                ? list.filter((p) => {
                      const name = (p.name || '').toLowerCase();
                      const code = (p.code || '').toLowerCase();
                      return name.includes(q) || code.includes(q);
                  })
                : list.slice();
            // Push zero-stock items to the bottom (stable sort).
            return filtered
                .map((p, i) => ({ p, i, oos: toProductStockNumber(p.stock) === 0 }))
                .sort((a, b) => {
                    if (a.oos !== b.oos) return a.oos ? 1 : -1;
                    return a.i - b.i;
                })
                .map((x) => x.p);
        }, [list, search]);

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
                            'h-auto min-h-[60px] w-full justify-between rounded-2xl border border-brand-navy/10 bg-white px-2.5 py-2 text-left shadow-none hover:bg-brand-navy/[0.02]',
                            triggerClassName
                        )}
                    >
                        <span className="flex min-w-0 flex-1 items-center gap-3">
                            {selected ? (
                                <>
                                    <ImageHoverPreview imageUrl={selected.image_url} name={selected.name} code={selected.code ?? ''}>
                                    <ProductThumb src={selected.image_url} alt={selected.name} />
                                    </ImageHoverPreview>
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="line-clamp-2 text-[13px] font-bold leading-snug text-brand-navy break-words">
                                            {formatLabel(selected)}
                                        </span>
                                        <span className="flex items-center gap-1.5 min-w-0">
                                            <span className="truncate text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                SKU {selected.code || '—'}
                                            </span>
                                            {selStock !== null && (
                                                <span
                                                    className={cn(
                                                        'shrink-0 rounded-md px-1.5 py-[1px] text-[9px] font-black uppercase tracking-wider tabular-nums ring-1 ring-inset',
                                                        stockPillClass(selStock)
                                                    )}
                                                >
                                                    {selStock} in stock
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                </>
                            ) : (
                                <>
                                    <div className="h-12 w-12 shrink-0 rounded-xl bg-brand-navy/[0.04] ring-1 ring-inset ring-brand-navy/10 flex items-center justify-center text-brand-navy/30">
                                        <Package className="h-4 w-4" />
                                    </div>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="text-[13px] font-bold leading-tight text-brand-navy/55">
                                            Choose product…
                                        </span>
                                        <span className="text-[10px] font-medium text-brand-navy/35">
                                            Search by name or SKU
                                        </span>
                                    </span>
                                </>
                            )}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-brand-navy/40" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] min-w-[min(100vw-2rem,440px)] p-0 rounded-2xl border border-brand-navy/10 shadow-2xl overflow-hidden"
                    align="start"
                    onWheel={(e) => e.stopPropagation()}
                >
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder="Search by name or SKU…"
                            className="h-12 text-sm font-medium"
                            value={search}
                            onValueChange={setSearch}
                        />
                        <CommandList className="max-h-[min(60vh,360px)]">
                            <CommandEmpty className="py-8 text-center text-xs font-bold text-brand-navy/45">
                                No product found.
                            </CommandEmpty>
                            <CommandGroup className="p-1.5">
                                {allowNone && (
                                    <CommandItem
                                        value="__none__"
                                        onSelect={() => {
                                            onProductIdChange('none');
                                            setOpen(false);
                                        }}
                                        className="cursor-pointer rounded-xl px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-navy/45 data-[selected=true]:bg-brand-navy/[0.05]"
                                    >
                                        {noneLabel}
                                    </CommandItem>
                                )}
                                {displayList.map((p) => {
                                    const sn = toProductStockNumber(p.stock);
                                    const isOos = sn === 0;
                                    const disabled = blockZeroStock && isOos;
                                    const isSelected = selected?.id === p.id;
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
                                                'cursor-pointer rounded-xl px-2.5 py-2 my-0.5 data-[selected=true]:bg-brand-navy/[0.04]',
                                                isSelected && 'bg-brand-navy/[0.05]',
                                                disabled && 'cursor-not-allowed opacity-50'
                                            )}
                                        >
                                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                                <ImageHoverPreview imageUrl={p.image_url} name={p.name} code={p.code ?? ''}>
                                                <ProductThumb src={p.image_url} alt={p.name} />
                                                </ImageHoverPreview>
                                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <span className="line-clamp-2 min-w-0 text-[13px] font-bold leading-snug text-brand-navy break-words">
                                                            {formatLabel(p)}
                                                        </span>
                                                        {sn !== null && (
                                                            <span
                                                                className={cn(
                                                                    'shrink-0 rounded-md px-1.5 py-[2px] text-[9px] font-black uppercase tracking-wider tabular-nums ring-1 ring-inset',
                                                                    stockPillClass(sn)
                                                                )}
                                                            >
                                                                {sn}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="truncate text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                            SKU {p.code || '—'}
                                                        </span>
                                                        {p.selling_price != null && Number(p.selling_price) > 0 && (
                                                            <>
                                                                <span className="text-brand-navy/15">·</span>
                                                                <span className="shrink-0 text-[10px] font-bold tabular-nums text-brand-navy/55">
                                                                    {Number(p.selling_price).toLocaleString()} DH
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <Check className="h-4 w-4 shrink-0 text-brand-navy/60" />
                                                )}
                                            </div>
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
