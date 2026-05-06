import type {
  DevisBusinessBlock,
  DevisClientBlock,
  DevisLine,
  DevisLinesSource,
  DevisStampSource,
} from '@/lib/devis/types';

export type FactureBusinessBlock = DevisBusinessBlock;
export type FactureLine = DevisLine;
export type FactureLinesSource = DevisLinesSource;
export type FactureClientBlock = DevisClientBlock;
export type FactureStampSource = DevisStampSource;

export type FactureSnapshot = {
  business: FactureBusinessBlock;
  lines: { source: FactureLinesSource; items: FactureLine[] };
  tva_included: boolean;
  tva_rate: number;
  subtotal_ht: number;
  tva_amount: number;
  total_ttc: number;
  client: FactureClientBlock;
  stamps: {
    source: FactureStampSource;
    cachet_url?: string | null;
    signature_url?: string | null;
  };
  due_date?: string | null;
  payment_terms?: string | null;
  devis_reference?: string | null;
  notes?: string | null;
  thank_you_text?: string | null;
  issued_at_iso?: string;
  facture_number?: string;
};
