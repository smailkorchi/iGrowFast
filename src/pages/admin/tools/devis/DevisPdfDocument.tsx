import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { DevisSnapshot } from '@/lib/devis/types';


const FONT = 'NotoSansArabic';
const FONT_BOLD = 'NotoSansArabic';

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingHorizontal: 40,
    paddingBottom: 60,
    fontSize: 9,
    fontFamily: FONT,
    color: '#111',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  logo: { width: 72, height: 72, objectFit: 'contain' },
  headerRight: { alignItems: 'flex-end' },
  title: { fontSize: 18, fontFamily: FONT_BOLD, fontWeight: 'bold' as const, marginBottom: 4 },
  meta: { fontSize: 9, color: '#444', textAlign: 'right' },
  twoCol: { flexDirection: 'row', gap: 24, marginBottom: 20 },
  col: { flex: 1 },
  blockTitle: { fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 6 },
  blockName: { fontSize: 11, fontFamily: FONT_BOLD, fontWeight: 'bold' as const, marginBottom: 4 },
  line: { fontSize: 9, color: '#333', marginBottom: 2 },
  table: { marginTop: 8, marginBottom: 16 },
  th: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingBottom: 6,
    marginBottom: 4,
    fontFamily: FONT_BOLD, fontWeight: 'bold' as const,
    fontSize: 8,
    textTransform: 'uppercase',
    color: '#666',
  },
  tr: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  c1: { width: '46%' },
  c2: { width: '18%', textAlign: 'right' },
  c3: { width: '18%', textAlign: 'right' },
  c4: { width: '18%', textAlign: 'right' },
  totals: { alignSelf: 'flex-end', width: 220, marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalStrong: { fontFamily: FONT_BOLD, fontWeight: 'bold' as const, fontSize: 11 },
  notes: { marginTop: 16, padding: 10, backgroundColor: '#f7f7f7', fontSize: 8, color: '#444' },
  // Stamps sit at a fixed position above the footer so they always end up
  // near the bottom of every page regardless of how short the content is.
  // Cachet + signature share the same box so the signature visually overlays
  // the cachet the way a real hand-signed document looks.
  // Stamps live above the footer block. Raised to clear the taller footer
  // (thank-you + 3 legal lines when all fields are filled).
  stampBlock: { position: 'absolute', right: 40, bottom: 90, width: 180, height: 120 },
  stampImg: { position: 'absolute', top: 0, left: 0, width: 180, height: 120, objectFit: 'contain' },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
  },
  // Closing phrase above the divider — same footer block as the legal info.
  footerThankYou: { fontSize: 9, color: '#333', textAlign: 'center', marginBottom: 4 },
  footerDivider: { height: 0.5, backgroundColor: '#bbb', marginBottom: 5 },
  footerText: { fontSize: 7, color: '#555', textAlign: 'center', lineHeight: 1.45 },
});

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'd MMMM yyyy', { locale: fr }); } catch { return iso; }
}

function fmtMoney(n: number) { return `${n.toFixed(2)} MAD`; }

// Three-line legal footer. Each line is assembled from whichever fields exist;
// empty lines are dropped so a partially-filled business record still looks clean.
function buildFooterLines(b: DevisSnapshot['business']): string[] {
  const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

  // Line 1: identity — "{name} {legal_form} au capital de {capital} Dhs · RC · Patente · IF · ICE · CNSS"
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

  // Line 2: "Siège : {address} · {city} {postal} · Maroc"
  const cityAndPostal = [b.legal_city, b.postal_code].filter(Boolean).join(' ');
  const siegeParts: string[] = [];
  if (b.legal_address) siegeParts.push(b.legal_address);
  if (cityAndPostal) siegeParts.push(cityAndPostal);
  const line2 = siegeParts.length
    ? `Siège : ${siegeParts.join(' · ')} · Maroc`
    : '';

  // Line 3: "Tél : ... · Email : ... · Site Web : ..."
  const line3 = join([
    b.business_phone ? `Tél : ${b.business_phone}` : null,
    b.business_email ? `Email : ${b.business_email}` : null,
    b.website ? `Site Web : ${b.website}` : null,
  ]);

  return [line1, line2, line3].filter(Boolean);
}

type Props = { snapshot: DevisSnapshot; devisNumber: string; issuedAtIso: string };

export function DevisPdfDocument({ snapshot, devisNumber, issuedAtIso }: Props) {
  const { business, client, lines, stamps } = snapshot;
  const showStamps = stamps.source === 'business' && (stamps.cachet_url || stamps.signature_url);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header: logo left, doc info right */}
        <View style={styles.headerRow}>
          {business.logo_url ? (
            <Image src={business.logo_url} style={styles.logo} />
          ) : (
            <View style={{ width: 72 }} />
          )}
          <View style={styles.headerRight}>
            <Text style={styles.title}>Devis</Text>
            <Text style={[styles.meta, { fontSize: 12, fontFamily: FONT_BOLD, fontWeight: 'bold' as const }]}>N° {devisNumber}</Text>
            <Text style={styles.meta}>Émis le {fmtDate(issuedAtIso)}</Text>
            {snapshot.valid_until ? (
              <Text style={styles.meta}>Valable jusqu'au {fmtDate(snapshot.valid_until)}</Text>
            ) : null}
          </View>
        </View>

        {/* Issuer + client — no column headers, the layout alone conveys the roles. */}
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.blockName}>{business.name || '—'}</Text>
            {business.business_phone ? <Text style={styles.line}>Tél. {business.business_phone}</Text> : null}
            {business.business_email ? <Text style={styles.line}>{business.business_email}</Text> : null}
          </View>
          <View style={styles.col}>
            <Text style={styles.blockName}>{client.name || '—'}</Text>
            {client.phone ? <Text style={styles.line}>Tél. {client.phone}</Text> : null}
            {client.address ? <Text style={styles.line}>{client.address}</Text> : null}
            {client.city ? <Text style={styles.line}>{client.city}</Text> : null}
          </View>
        </View>

        {/* Items table */}
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.c1}>Désignation</Text>
            <Text style={styles.c2}>Qté</Text>
            <Text style={styles.c3}>P.U. HT</Text>
            <Text style={styles.c4}>Total HT</Text>
          </View>
          {lines.items.map((line, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={styles.c1}>{line.label}</Text>
              <Text style={styles.c2}>{String(line.quantity)}</Text>
              <Text style={styles.c3}>{fmtMoney(line.unit_price)}</Text>
              <Text style={styles.c4}>{fmtMoney(line.quantity * line.unit_price)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totals}>
          <View style={styles.totalRow}><Text>Sous-total HT</Text><Text>{fmtMoney(snapshot.subtotal_ht)}</Text></View>
          {snapshot.tva_included && snapshot.tva_rate > 0 ? (
            <View style={styles.totalRow}><Text>TVA ({snapshot.tva_rate}%)</Text><Text>{fmtMoney(snapshot.tva_amount)}</Text></View>
          ) : null}
          <View style={styles.totalRow}>
            <Text style={styles.totalStrong}>Total TTC</Text>
            <Text style={styles.totalStrong}>{fmtMoney(snapshot.total_ttc)}</Text>
          </View>
        </View>

        {snapshot.notes ? (
          <View style={styles.notes}>
            <Text style={{ fontFamily: FONT_BOLD, fontWeight: 'bold' as const, marginBottom: 4 }}>Notes</Text>
            <Text>{snapshot.notes}</Text>
          </View>
        ) : null}

        {showStamps ? (
          <View style={styles.stampBlock} fixed>
            {stamps.cachet_url ? <Image src={stamps.cachet_url} style={styles.stampImg} /> : null}
            {stamps.signature_url ? <Image src={stamps.signature_url} style={styles.stampImg} /> : null}
          </View>
        ) : null}

        {/* Footer: optional thank-you phrase + divider + 3 legal-identity lines */}
        <View style={styles.footer} fixed>
          {snapshot.thank_you_text ? (
            <Text style={styles.footerThankYou}>{snapshot.thank_you_text}</Text>
          ) : null}
          <View style={styles.footerDivider} />
          {buildFooterLines(business).map((line, i) => (
            <Text key={i} style={styles.footerText}>{line}</Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}
