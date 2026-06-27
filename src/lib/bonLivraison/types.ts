import type {
  DevisBusinessBlock,
  DevisClientBlock,
  DevisLine,
  DevisLinesSource,
  DevisStampSource,
} from '@/lib/devis/types';

export type BonLivraisonSource = 'manual' | 'order' | 'company_delivery_note';

export type BonLivraisonParcelSnapshot = {
  id?: string | null;
  tracking_code: string | null;
  status_label?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  order_id?: string | null;
};

export type BonLivraisonTransportSnapshot = {
  provider_name?: string | null;
  provider_logo_url?: string | null;
};

export type BonLivraisonSnapshot = {
  source: BonLivraisonSource;
  company_delivery_note_id?: string | null;
  order_id?: string | null;
  /** Réf. interne (company_delivery_notes.reference ou note commande) */
  linked_reference?: string | null;
  business: DevisBusinessBlock;
  client: DevisClientBlock;
  lines: { source: DevisLinesSource; items: DevisLine[] };
  include_prices: boolean;
  show_transport_block: boolean;
  transport?: BonLivraisonTransportSnapshot | null;
  parcels: BonLivraisonParcelSnapshot[];
  stamps: {
    source: DevisStampSource;
    cachet_url?: string | null;
    signature_url?: string | null;
  };
  delivery_date?: string | null;
  notes?: string | null;
  thank_you_text?: string | null;
  issued_at_iso?: string;
  bl_number?: string;
};

export type BonLivraisonHydrateResult = {
  lines: DevisLine[];
  linesSource: DevisLinesSource;
  client: DevisClientBlock;
  parcels: BonLivraisonParcelSnapshot[];
  transport: BonLivraisonTransportSnapshot | null;
  linked_reference: string | null;
  company_delivery_note_id: string | null;
  order_id: string | null;
  show_transport_default: boolean;
};
