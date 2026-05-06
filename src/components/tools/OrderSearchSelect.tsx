import { useState, useMemo } from 'react';
import { ChevronsUpDown, Check, ShoppingCart } from 'lucide-react';
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

interface OrderOption {
  id: string;
  label: string;
}

interface OrderSearchSelectProps {
  orders: OrderOption[];
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function OrderSearchSelect({
  orders,
  value,
  onValueChange,
  placeholder = 'Choisir une commande…',
  disabled = false,
}: OrderSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => o.label.toLowerCase().includes(q));
  }, [orders, search]);

  const selected = orders.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between rounded-xl h-10 font-medium text-sm',
            !value && 'text-muted-foreground'
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
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
            placeholder="Rechercher par nom, téléphone..."
            className="h-10 text-sm"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[min(50vh,280px)]">
            <CommandEmpty className="py-6 text-center">
              <ShoppingCart className="w-5 h-5 mx-auto mb-1 text-muted-foreground/30" />
              <span className="text-xs font-medium text-muted-foreground/50">Aucune commande trouvée</span>
            </CommandEmpty>
            <CommandGroup className="p-1">
              {filtered.map((o) => {
                const isSelected = o.id === value;
                return (
                  <CommandItem
                    key={o.id}
                    value={o.label}
                    onSelect={() => {
                      onValueChange(o.id);
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
                      <span className="text-[13px] font-bold text-brand-navy truncate">{o.label}</span>
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
