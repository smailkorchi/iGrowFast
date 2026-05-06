import { useState, useMemo } from 'react';
import { ChevronsUpDown, Check, Package } from 'lucide-react';
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

interface Product {
  id: string;
  name: string;
  code?: string | null;
  selling_price?: number | null;
  cost_price?: number | null;
}

interface ProductSearchSelectProps {
  products: Product[];
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
  renderPrice?: (product: Product) => string;
}

export default function ProductSearchSelect({
  products,
  value,
  onValueChange,
  placeholder = 'Choisir…',
  renderPrice,
}: ProductSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = (p.name || '').toLowerCase();
      const code = (p.code || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [products, search]);

  const selected = products.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between rounded-xl mt-1 h-10 font-medium text-sm',
            !value && 'text-muted-foreground'
          )}
        >
          <span className="truncate">
            {selected
              ? `${selected.name}${renderPrice ? ` — ${renderPrice(selected)}` : ''}`
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 rounded-xl border border-brand-navy/10 shadow-2xl overflow-hidden"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Rechercher par nom ou code..."
            className="h-10 text-sm"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[min(50vh,280px)]">
            <CommandEmpty className="py-6 text-center">
              <Package className="w-5 h-5 mx-auto mb-1 text-muted-foreground/30" />
              <span className="text-xs font-medium text-muted-foreground/50">Aucun produit trouvé</span>
            </CommandEmpty>
            <CommandGroup className="p-1">
              {filtered.map((p) => {
                const isSelected = p.id === value;
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.name} ${p.code ?? ''} ${p.id}`}
                    onSelect={() => {
                      onValueChange(p.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg px-2.5 py-2 my-0.5 data-[selected=true]:bg-brand-navy/[0.04]',
                      isSelected && 'bg-brand-navy/[0.06]'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isSelected ? (
                        <Check className="w-3.5 h-3.5 text-brand-navy shrink-0" />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-brand-navy text-[13px] truncate block">{p.name}</span>
                        {(p.code || renderPrice) && (
                          <span className="text-[10px] text-muted-foreground/60 font-medium">
                            {p.code && <span>{p.code}</span>}
                            {p.code && renderPrice && <span> · </span>}
                            {renderPrice && <span>{renderPrice(p)}</span>}
                          </span>
                        )}
                      </div>
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
