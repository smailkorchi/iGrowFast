import type { DevisLine } from './types';

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeTotals(items: DevisLine[], tvaIncluded: boolean, tvaRatePercent: number) {
  const subtotal_ht = roundMoney(
    items.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0),
  );
  const rate = tvaIncluded ? Math.min(100, Math.max(0, Number(tvaRatePercent) || 0)) : 0;
  const tva_amount = tvaIncluded ? roundMoney(subtotal_ht * (rate / 100)) : 0;
  const total_ttc = roundMoney(subtotal_ht + tva_amount);
  return {
    subtotal_ht,
    tva_rate: rate,
    tva_amount,
    total_ttc,
  };
}
