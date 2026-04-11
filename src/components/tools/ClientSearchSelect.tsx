import { useState, useMemo } from 'react';
import { ChevronsUpDown, Check, User } from 'lucide-react';
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

interface Client {
  name: string;
  phone: string;
  city?: string | null;
}

interface ClientSearchSelectProps {
  clients: Client[];
  value: string;
  onValueChange: (phone: string) => void;
  placeholder?: string;
}

export default function ClientSearchSelect({
  clients,
  value,
  onValueChange,
  placeholder = 'Sélectionner un client…',
}: ClientSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      const city = (c.city || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || city.includes(q);
    });
  }, [clients, search]);

  const selected = clients.find((c) => c.phone === value);

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
            {selected ? `${selected.name} — ${selected.phone}` : placeholder}
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
            placeholder="Rechercher par nom ou téléphone..."
            className="h-10 text-sm"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[min(50vh,280px)]">
            <CommandEmpty className="py-6 text-center">
              <User className="w-5 h-5 mx-auto mb-1 text-muted-foreground/30" />
              <span className="text-xs font-medium text-muted-foreground/50">Aucun client trouvé</span>
            </CommandEmpty>
            <CommandGroup className="p-1">
              {filtered.map((c) => {
                const isSelected = c.phone === value;
                return (
                  <CommandItem
                    key={c.phone}
                    value={`${c.name} ${c.phone} ${c.city ?? ''}`}
                    onSelect={() => {
                      onValueChange(c.phone);
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
                        <span className="font-bold text-brand-navy text-[13px] truncate block">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground/60 font-medium">
                          {c.phone}
                          {c.city && <span> · {c.city}</span>}
                        </span>
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
