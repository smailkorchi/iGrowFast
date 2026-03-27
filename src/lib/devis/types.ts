export type DevisBusinessSource = 'database' | 'manual';

export type DevisBusinessBlock = {
  source: DevisBusinessSource;
  name: string;
  ice?: string | null;
  rc?: string | null;
  identifiant_fiscal?: string | null;
  patente?: string | null;
  cnss?: string | null;
  legal_form?: string | null;
  capital_social?: string | null;
  legal_address?: string | null;
  legal_city?: string | null;
  business_phone?: string | null;
  business_email?: string | null;
  logo_url?: string | null;
};

export type DevisLine = {
  label: string;
  quantity: number;
  unit_price: number;
  product_id?: string | null;
};

export type DevisLinesSource = 'database' | 'manual';

export type DevisClientBlock = {
  source: 'orders' | 'manual';
  name: string;
  phone?: string;
  address?: string;
  city?: string;
};

export type DevisStampSource = 'business' | 'blank';

export type DevisSnapshot = {
  business: DevisBusinessBlock;
  lines: { source: DevisLinesSource; items: DevisLine[] };
  tva_included: boolean;
  tva_rate: number;
  subtotal_ht: number;
  tva_amount: number;
  total_ttc: number;
  client: DevisClientBlock;
  stamps: {
    source: DevisStampSource;
    cachet_url?: string | null;
    signature_url?: string | null;
  };
  valid_until?: string | null;
  notes?: string | null;
  issued_at_iso?: string;
  devis_number?: string;
};

export type OrderDerivedClient = {
  phone: string;
  name: string;
  city: string;
  address: string;
};
