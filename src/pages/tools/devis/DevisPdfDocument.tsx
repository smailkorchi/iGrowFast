import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { DevisSnapshot } from '@/lib/devis/types';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  meta: { fontSize: 9, color: '#444' },
  logo: { width: 72, height: 72, objectFit: 'contain' },
  twoCol: { flexDirection: 'row', gap: 24, marginBottom: 20 },
  col: { flex: 1 },
  blockTitle: { fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 6 },
  blockName: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  line: { fontSize: 9, color: '#333', marginBottom: 2 },
  table: { marginTop: 8, marginBottom: 16 },
  th: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingBottom: 6,
    marginBottom: 4,
    fontFamily: 'Helvetica-Bold',
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
  totalStrong: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  notes: { marginTop: 16, padding: 10, backgroundColor: '#f7f7f7', fontSize: 8, color: '#444' },
  stampRow: { flexDirection: 'row', gap: 24, marginTop: 28, justifyContent: 'flex-end' },
  stampImg: { width: 120, height: 60, objectFit: 'contain' },
});

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'd MMMM yyyy', { locale: fr });
  } catch {
    return iso;
  }
}

function fmtMoney(n: number) {
  return `${n.toFixed(2)} MAD`;
}

type Props = {
  snapshot: DevisSnapshot;
  devisNumber: string;
  issuedAtIso: string;
};

export function DevisPdfDocument({ snapshot, devisNumber, issuedAtIso }: Props) {
  const { business, client, lines, stamps } = snapshot;
  const showStamps = stamps.source === 'business' && (stamps.cachet_url || stamps.signature_url);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Devis</Text>
            <Text style={styles.meta}>N° {devisNumber}</Text>
            <Text style={styles.meta}>Émis le {fmtDate(issuedAtIso)}</Text>
            {snapshot.valid_until ? (
              <Text style={styles.meta}>Valable jusqu'au {fmtDate(snapshot.valid_until)}</Text>
            ) : null}
          </View>
          {business.logo_url ? (
            <Image src={business.logo_url} style={styles.logo} />
          ) : (
            <View style={{ width: 72 }} />
          )}
        </View>

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.blockTitle}>Émetteur</Text>
            <Text style={styles.blockName}>{business.name || '—'}</Text>
            {business.legal_address ? <Text style={styles.line}>{business.legal_address}</Text> : null}
            {business.legal_city ? <Text style={styles.line}>{business.legal_city}</Text> : null}
            {business.business_phone ? <Text style={styles.line}>Tél. {business.business_phone}</Text> : null}
            {business.business_email ? <Text style={styles.line}>{business.business_email}</Text> : null}
            {business.ice ? <Text style={styles.line}>ICE : {business.ice}</Text> : null}
            {business.rc ? <Text style={styles.line}>RC : {business.rc}</Text> : null}
            {business.identifiant_fiscal ? (
              <Text style={styles.line}>IF : {business.identifiant_fiscal}</Text>
            ) : null}
          </View>
          <View style={styles.col}>
            <Text style={styles.blockTitle}>Client</Text>
            <Text style={styles.blockName}>{client.name || '—'}</Text>
            {client.phone ? <Text style={styles.line}>Tél. {client.phone}</Text> : null}
            {client.address ? <Text style={styles.line}>{client.address}</Text> : null}
            {client.city ? <Text style={styles.line}>{client.city}</Text> : null}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.c1}>Désignation</Text>
            <Text style={styles.c2}>Qté</Text>
            <Text style={styles.c3}>P.U. HT</Text>
            <Text style={styles.c4}>Total HT</Text>
          </View>
          {lines.items.map((line, i) => {
            const lineHt = line.quantity * line.unit_price;
            return (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={styles.c1}>{line.label}</Text>
                <Text style={styles.c2}>{String(line.quantity)}</Text>
                <Text style={styles.c3}>{fmtMoney(line.unit_price)}</Text>
                <Text style={styles.c4}>{fmtMoney(lineHt)}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Sous-total HT</Text>
            <Text>{fmtMoney(snapshot.subtotal_ht)}</Text>
          </View>
          {snapshot.tva_included && snapshot.tva_rate > 0 ? (
            <View style={styles.totalRow}>
              <Text>TVA ({snapshot.tva_rate}%)</Text>
              <Text>{fmtMoney(snapshot.tva_amount)}</Text>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <Text style={styles.totalStrong}>Total TTC</Text>
            <Text style={styles.totalStrong}>{fmtMoney(snapshot.total_ttc)}</Text>
          </View>
        </View>

        {snapshot.notes ? (
          <View style={styles.notes}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Notes</Text>
            <Text>{snapshot.notes}</Text>
          </View>
        ) : null}

        {showStamps ? (
          <View style={styles.stampRow}>
            {stamps.cachet_url ? <Image src={stamps.cachet_url} style={styles.stampImg} /> : null}
            {stamps.signature_url ? <Image src={stamps.signature_url} style={styles.stampImg} /> : null}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
