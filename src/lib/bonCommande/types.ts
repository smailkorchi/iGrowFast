import type {
  DevisBusinessBlock,
  DevisClientBlock,
  DevisLine,
  DevisLinesSource,
  DevisStampSource,
} from '@/lib/devis/types';

export type BonCommandeDirection = 'purchase' | 'sales';

export type BonCommandeSupplierBlock = {
  name: string;
  phone?: string;
  address?: string;
  city?: string;
  ice?: string;
};

export type BonCommandeSnapshot = {
  direction: BonCommandeDirection;
  business: DevisBusinessBlock;
  lines: { source: DevisLinesSource; items: DevisLine[] };
  tva_included: boolean;
  tva_rate: number;
  subtotal_ht: number;
  tva_amount: number;
  total_ttc: number;
  supplier?: BonCommandeSupplierBlock;
  client?: DevisClientBlock;
  stamps: {
    source: DevisStampSource;
    cachet_url?: string | null;
    signature_url?: string | null;
  };
  valid_until?: string | null;
  notes?: string | null;
  issued_at_iso?: string;
  bc_number?: string;
};
