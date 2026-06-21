/**
 * Shared legal footer for collaborator payout/statement PDFs.
 *
 * Mirrors EXACTLY the facture/devis layout (FacturePdfDocument.buildFooterLines)
 * so seller/media-buyer/courier documents carry the same legal block as the rest
 * of the app's official documents: a centered 3-line footer —
 *   1) {name} {legal_form} au capital de {capital} Dhs · RC · Patente · IF · ICE · CNSS
 *   2) Siège : {address} · {city} {postal} · Maroc
 *   3) Tél · Email · Site Web
 * Lines with no data are skipped gracefully.
 */
import { View, Text, StyleSheet } from '@react-pdf/renderer';

export type LegalFooterBusiness = {
  name?: string | null;
  legal_form?: string | null;
  capital_social?: string | null;
  rc?: string | null;
  patente?: string | null;
  identifiant_fiscal?: string | null;
  ice?: string | null;
  cnss?: string | null;
  legal_address?: string | null;
  legal_city?: string | null;
  postal_code?: string | null;
  business_phone?: string | null;
  business_email?: string | null;
  website?: string | null;
};

export function buildLegalFooterLines(b: LegalFooterBusiness): string[] {
  const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

  const identityLead: string[] = [];
  if (b.name) identityLead.push(b.name);
  if (b.legal_form) identityLead.push(b.legal_form);
  const identityHead = identityLead.join(' ');
  const capital = b.capital_social ? `au capital de ${b.capital_social} Dhs` : null;
  const line1 = join([
    [identityHead, capital].filter(Boolean).join(' ') || null,
    b.rc ? `RC : ${b.rc}` : null,
    b.patente ? `Patente : ${b.patente}` : null,
    b.identifiant_fiscal ? `IF : ${b.identifiant_fiscal}` : null,
    b.ice ? `ICE : ${b.ice}` : null,
    b.cnss ? `CNSS : ${b.cnss}` : null,
  ]);

  const cityAndPostal = [b.legal_city, b.postal_code].filter(Boolean).join(' ');
  const siegeParts: string[] = [];
  if (b.legal_address) siegeParts.push(b.legal_address);
  if (cityAndPostal) siegeParts.push(cityAndPostal);
  const line2 = siegeParts.length ? `Siège : ${siegeParts.join(' · ')} · Maroc` : '';

  const line3 = join([
    b.business_phone ? `Tél : ${b.business_phone}` : null,
    b.business_email ? `Email : ${b.business_email}` : null,
    b.website ? `Site Web : ${b.website}` : null,
  ]);

  return [line1, line2, line3].filter(Boolean);
}

const styles = StyleSheet.create({
  footer: { position: 'absolute', bottom: 20 },
  divider: { height: 0.5, backgroundColor: '#bbb', marginBottom: 5 },
  text: { fontSize: 7, color: '#555', textAlign: 'center', lineHeight: 1.45 },
});

/** Fixed legal footer (repeats on every page), matching the facture/devis layout. */
export function LegalFooter({ business, pad = 38 }: { business: LegalFooterBusiness; pad?: number }) {
  const lines = buildLegalFooterLines(business);
  if (lines.length === 0) return null;
  return (
    <View style={[styles.footer, { left: pad, right: pad }]} fixed>
      <View style={styles.divider} />
      {lines.map((line, i) => (
        <Text key={i} style={styles.text}>{line}</Text>
      ))}
    </View>
  );
}
