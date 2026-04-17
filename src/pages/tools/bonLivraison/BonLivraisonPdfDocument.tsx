import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { BonLivraisonSnapshot } from '@/lib/bonLivraison/types';


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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  logo: { width: 72, height: 72, objectFit: 'contain' },
  headerRight: { alignItems: 'flex-end' },
  title: { fontSize: 18, fontFamily: FONT_BOLD, fontWeight: 'bold' as const, marginBottom: 4 },
  meta: { fontSize: 9, color: '#444', textAlign: 'right' },
  transportRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16,
    padding: 10, backgroundColor: '#f5f5f5', borderRadius: 4,
  },
  transportLogo: { width: 48, height: 48, objectFit: 'contain' },
  twoCol: { flexDirection: 'row', gap: 24, marginBottom: 18 },
  col: { flex: 1 },
  blockTitle: { fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 6 },
  blockName: { fontSize: 11, fontFamily: FONT_BOLD, fontWeight: 'bold' as const, marginBottom: 4 },
  line: { fontSize: 9, color: '#333', marginBottom: 2 },
  table: { marginTop: 6, marginBottom: 14 },
  th: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingBottom: 6, marginBottom: 4,
    fontFamily: FONT_BOLD, fontWeight: 'bold' as const, fontSize: 8, textTransform: 'uppercase', color: '#666',
  },
  tr: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  c1: { width: '52%' }, c2: { width: '16%', textAlign: 'right' }, c3: { width: '16%', textAlign: 'right' }, c4: { width: '16%', textAlign: 'right' },
  c1n: { width: '70%' }, c2n: { width: '30%', textAlign: 'right' },
  parcelTh: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingBottom: 4, marginTop: 8, marginBottom: 4,
    fontFamily: FONT_BOLD, fontWeight: 'bold' as const, fontSize: 7, color: '#666',
  },
  ptr: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  pc1: { width: '28%' }, pc2: { width: '24%' }, pc3: { width: '22%' }, pc4: { width: '26%' },
  totals: { alignSelf: 'flex-end', width: 200, marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalStrong: { fontFamily: FONT_BOLD, fontWeight: 'bold' as const, fontSize: 10 },
  notes: { marginTop: 12, padding: 10, backgroundColor: '#f7f7f7', fontSize: 8, color: '#444' },
  // See DevisPdfDocument — stamps raised to clear the taller footer block.
  stampBlock: { position: 'absolute', right: 40, bottom: 90, width: 180, height: 120 },
  stampImg: { position: 'absolute', top: 0, left: 0, width: 180, height: 120, objectFit: 'contain' },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40 },
  footerThankYou: { fontSize: 9, color: '#333', textAlign: 'center', marginBottom: 4 },
  footerDivider: { height: 0.5, backgroundColor: '#bbb', marginBottom: 5 },
  footerText: { fontSize: 7, color: '#555', textAlign: 'center', lineHeight: 1.45 },
});

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'd MMMM yyyy', { locale: fr }); } catch { return iso; }
}
function fmtMoney(n: number) { return `${n.toFixed(2)} MAD`; }

// See DevisPdfDocument for rationale — 3-line footer with graceful skipping.
function buildFooterLines(b: BonLivraisonSnapshot['business']): string[] {
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

type Props = { snapshot: BonLivraisonSnapshot; blNumber: string; issuedAtIso: string };

export function BonLivraisonPdfDocument({ snapshot, blNumber, issuedAtIso }: Props) {
  const { business, client, lines, stamps, parcels, include_prices, show_transport_block, transport } = snapshot;
  const showStamps = stamps.source === 'business' && (stamps.cachet_url || stamps.signature_url);
  const totalHt = lines.items.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          {business.logo_url ? <Image src={business.logo_url} style={styles.logo} /> : <View style={{ width: 72 }} />}
          <View style={styles.headerRight}>
            <Text style={styles.title}>Bon de livraison</Text>
            <Text style={[styles.meta, { fontSize: 12, fontFamily: FONT_BOLD, fontWeight: 'bold' as const }]}>N° {blNumber}</Text>
            <Text style={styles.meta}>Émis le {fmtDate(issuedAtIso)}</Text>
            {snapshot.delivery_date ? <Text style={styles.meta}>Livraison le {fmtDate(snapshot.delivery_date)}</Text> : null}
            {snapshot.linked_reference ? <Text style={styles.meta}>Réf. : {snapshot.linked_reference}</Text> : null}
          </View>
        </View>

        {show_transport_block && transport?.provider_name ? (
          <View style={styles.transportRow}>
            {transport.provider_logo_url ? <Image src={transport.provider_logo_url} style={styles.transportLogo} /> : <View style={{ width: 48 }} />}
            <View>
              <Text style={{ fontSize: 8, color: '#666', textTransform: 'uppercase' }}>Transporteur</Text>
              <Text style={{ fontSize: 11, fontFamily: FONT_BOLD, fontWeight: 'bold' as const }}>{transport.provider_name}</Text>
            </View>
          </View>
        ) : null}

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

        <Text style={{ ...styles.blockTitle, marginBottom: 4 }}>Marchandises</Text>
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={include_prices ? styles.c1 : styles.c1n}>Désignation</Text>
            <Text style={include_prices ? styles.c2 : styles.c2n}>Qté</Text>
            {include_prices ? <><Text style={styles.c3}>P.U. HT</Text><Text style={styles.c4}>Total HT</Text></> : null}
          </View>
          {lines.items.map((line, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={include_prices ? styles.c1 : styles.c1n}>{line.label}</Text>
              <Text style={include_prices ? styles.c2 : styles.c2n}>{String(line.quantity)}</Text>
              {include_prices ? <><Text style={styles.c3}>{fmtMoney(line.unit_price)}</Text><Text style={styles.c4}>{fmtMoney(line.quantity * line.unit_price)}</Text></> : null}
            </View>
          ))}
        </View>

        {include_prices ? (
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalStrong}>Total HT</Text><Text style={styles.totalStrong}>{fmtMoney(totalHt)}</Text>
            </View>
          </View>
        ) : null}

        {parcels.length > 0 ? (
          <View wrap={false}>
            <Text style={{ ...styles.blockTitle, marginTop: 10 }}>Colis</Text>
            <View style={styles.parcelTh}>
              <Text style={styles.pc1}>Suivi</Text><Text style={styles.pc2}>Réf.</Text>
              <Text style={styles.pc3}>Statut</Text><Text style={styles.pc4}>Destinataire</Text>
            </View>
            {parcels.map((p, i) => (
              <View key={i} style={styles.ptr} wrap={false}>
                <Text style={styles.pc1}>{p.tracking_code || '—'}</Text><Text style={styles.pc2}>{p.reference || '—'}</Text>
                <Text style={styles.pc3}>{p.status_label || '—'}</Text>
                <Text style={styles.pc4}>{[p.recipient_name, p.recipient_phone].filter(Boolean).join(' · ') || '—'}</Text>
              </View>
            ))}
          </View>
        ) : null}

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
