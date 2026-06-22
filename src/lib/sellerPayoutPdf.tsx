/**
 * Client-side PDF generator for a SELLER (commercial) commission payout statement.
 *
 * Mirrors the editorial style of courierPayoutPdf.tsx (same @react-pdf/renderer
 * primitives + brand palette), adapted to the seller context: a financial
 * breakdown (earned / carried / owed / remaining) plus a full per-order
 * commission table (client, phone, tracking, units, commission) and a branded
 * legal footer — a professional payment document the seller can keep.
 *
 * Generated on the admin client the moment a seller payment is recorded, then
 * posted (base64) to the `send-payout-statement` edge function for emailing.
 */
import {
  Document, Page, Text, View, StyleSheet, Image, pdf,
} from '@react-pdf/renderer';
import { format } from 'date-fns';
import { fetchUrlAsDataUri } from './documentPdf/embedRemoteImages';
import { blobToBase64 } from './documentPdf/toBase64';
import { LegalFooter, type LegalFooterBusiness } from './documentPdf/legalFooter';
import { StampBlock } from './documentPdf/stampBlock';

// ─── Brand palette (Anthropic editorial tokens — matches courier payout) ──────
const NAVY = '#141413';
const EMERALD = '#2D7A3E';
const ORANGE = '#D97706';
const MUTED = '#6B6760';
const BG_CREAM = '#faf9f5';
const BORDER = '#e8e6dc';
const ROW_BORDER = '#f1efe8';

// ─── Types ────────────────────────────────────────────────────────────────────
export type SellerPayoutPdfOrder = {
  order_id: string;
  client: string | null;
  phone: string | null;
  tracking: string | null;
  units: number;
  commission: number;
  delivered_at?: string | null;
  /** Portion of this order's commission settled BY THIS payment (FIFO). */
  paidPortion?: number;
  /** True when only part of the commission is settled by this payment (boundary order). */
  partial?: boolean;
};

export type SellerPayoutPdfInput = {
  reference: string;          // payout reference / period code
  period_label: string;       // e.g. "Juin 2026"
  status_label: string;       // "Payé" | "Partiel"
  paid_at: string | null;
  currency: string;
  paid_amount: number;
  month_earned: number;
  carried_in: number;
  total_owed: number;
  already_paid: number;
  remaining_owed: number;
  delivered_orders: number;
  processing_orders: number;
  /** Portion of this payment that settled the prior-month carry-in (no listable orders). */
  report_portion?: number;
  /** Delivered orders still awaiting settlement after this payment. */
  remaining_orders?: number;
  orders: SellerPayoutPdfOrder[];
  business: { name: string; logo: string | null; cachet_url?: string | null; signature_url?: string | null } & LegalFooterBusiness;
  seller: { name: string; avatar_url: string | null };
};

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtMAD = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n || 0)
    .replace(/[  ]/g, ' '); // narrow/no-break space → regular space (Helvetica has no glyph)
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return format(new Date(iso), 'dd MMM yyyy'); } catch { return '—'; }
};
const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  try { return format(new Date(iso), 'dd MMM yyyy • HH:mm'); } catch { return '—'; }
};

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 150, paddingHorizontal: 38, fontSize: 10, fontFamily: 'Helvetica', color: NAVY, backgroundColor: '#ffffff' }, // paddingBottom = reserved band for last-page stamp + footer
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 18, marginBottom: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandLogoBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: BG_CREAM, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  brandLogoImg: { width: 40, height: 40, objectFit: 'contain' },
  brandLogoFallback: { width: 48, height: 48, borderRadius: 12, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  brandLogoFallbackText: { fontFamily: 'Helvetica-Bold', fontSize: 15, color: '#daddcc' },
  brandName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: -0.2 },
  brandSub: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 4 },
  metaWrap: { alignItems: 'flex-end' },
  metaKicker: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: EMERALD, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  metaRef: { fontSize: 16, fontFamily: 'Courier-Bold', color: NAVY, letterSpacing: -0.4 },
  metaDate: { fontSize: 9, color: MUTED, marginTop: 4 },

  beneficiary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, backgroundColor: BG_CREAM, borderWidth: 1, borderColor: BORDER, borderRadius: 14, marginBottom: 16 },
  avatarBox: { width: 48, height: 48, borderRadius: 14, overflow: 'hidden', backgroundColor: '#ffffff', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 48, height: 48, objectFit: 'cover' },
  avatarFallback: { width: 48, height: 48, borderRadius: 14, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontFamily: 'Helvetica-Bold', fontSize: 14, color: '#daddcc' },
  benInfo: { flex: 1 },
  benLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 3 },
  benName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: -0.3 },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: '#d1fae5' },
  badgeText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#065f46', textTransform: 'uppercase', letterSpacing: 1 },
  badgePartial: { backgroundColor: '#fde68a' },
  badgePartialText: { color: '#92400e' },

  hero: { padding: 24, backgroundColor: NAVY, borderRadius: 18, marginBottom: 14 },
  heroLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: ORANGE, letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 8, opacity: 0.85 },
  heroValRow: { flexDirection: 'row', alignItems: 'baseline' },
  heroVal: { fontSize: 40, fontFamily: 'Helvetica-Bold', color: ORANGE, letterSpacing: -1 },
  heroUnit: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: ORANGE, opacity: 0.6, marginLeft: 8 },
  heroSub: { marginTop: 10, fontSize: 9, color: '#ffffff', opacity: 0.55 },

  stats: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  stat: { flex: 1, padding: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: BORDER, borderRadius: 14 },
  statK: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  statV: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: NAVY },
  statVGhost: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: MUTED },

  sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 },
  breakdown: { backgroundColor: BG_CREAM, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 14, marginBottom: 18 },
  brRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  brK: { fontSize: 10, color: MUTED },
  brV: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: NAVY },
  brRowStrong: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 7, marginTop: 4, borderTopWidth: 1, borderTopColor: BORDER },
  brKStrong: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#3f4a2e' },
  brVStrong: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#3f4a2e' },

  table: { marginBottom: 16 },
  tableHeader: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  thText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: ROW_BORDER },
  cNum: { width: '7%', fontSize: 8, fontFamily: 'Courier-Bold', color: MUTED },
  cClient: { width: '27%', fontSize: 8.5, color: NAVY },
  cPhone: { width: '20%', fontSize: 8.5, fontFamily: 'Courier', color: MUTED },
  cTrack: { width: '26%', fontSize: 8.5, fontFamily: 'Courier-Bold', color: NAVY },
  cUnits: { width: '8%', fontSize: 8.5, color: NAVY, textAlign: 'right' },
  cComm: { width: '12%', fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: EMERALD, textAlign: 'right' },

  footer: { position: 'absolute', left: 38, right: 38, bottom: 22, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: MUTED },
  footerStrong: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1 },
});

function SellerPayoutDocument({ input }: { input: SellerPayoutPdfInput }) {
  const { reference, period_label, status_label, paid_at, currency, paid_amount,
    month_earned, carried_in, total_owed, already_paid, remaining_owed,
    delivered_orders, processing_orders, report_portion = 0, remaining_orders = 0, orders, business, seller } = input;
  const hasPartial = orders.some((o) => o.partial);
  const settledCount = orders.length;
  const bizInitials = (business.name || 'DC').substring(0, 2).toUpperCase();
  const selInitials = (seller.name || 'CM').substring(0, 2).toUpperCase();
  const isPaid = (status_label || '').toLowerCase().includes('pay');

  return (
    <Document title={`${reference} — Versement commercial`} author={business.name || 'iGrowFast'} subject="Relevé de versement — Commercial">
      <Page size="A4" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.header} fixed>
          <View style={styles.brand}>
            {business.logo ? (
              <View style={styles.brandLogoBox}><Image style={styles.brandLogoImg} src={business.logo} /></View>
            ) : (
              <View style={styles.brandLogoFallback}><Text style={styles.brandLogoFallbackText}>{bizInitials}</Text></View>
            )}
            <View>
              <Text style={styles.brandName}>{business.name || 'iGrowFast'}</Text>
              <Text style={styles.brandSub}>Relevé de versement</Text>
            </View>
          </View>
          <View style={styles.metaWrap}>
            <Text style={styles.metaKicker}>Commercial · {period_label}</Text>
            <Text style={styles.metaRef}>{reference}</Text>
            <Text style={styles.metaDate}>{fmtDateTime(paid_at)}</Text>
          </View>
        </View>

        {/* Beneficiary */}
        <View style={styles.beneficiary}>
          {seller.avatar_url ? (
            <View style={styles.avatarBox}><Image style={styles.avatarImg} src={seller.avatar_url} /></View>
          ) : (
            <View style={styles.avatarFallback}><Text style={styles.avatarFallbackText}>{selInitials}</Text></View>
          )}
          <View style={styles.benInfo}>
            <Text style={styles.benLabel}>Bénéficiaire · Commercial</Text>
            <Text style={styles.benName}>{seller.name || 'Commercial'}</Text>
          </View>
          <View style={[styles.badge, ...(isPaid ? [] : [styles.badgePartial])]}>
            <Text style={[styles.badgeText, ...(isPaid ? [] : [styles.badgePartialText])]}>{status_label || 'Payé'}</Text>
          </View>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Montant versé</Text>
          <View style={styles.heroValRow}>
            <Text style={styles.heroVal}>{fmtMAD(paid_amount)}</Text>
            <Text style={styles.heroUnit}>{currency}</Text>
          </View>
          <Text style={styles.heroSub}>{settledCount} commande{settledCount !== 1 ? 's' : ''} réglée{settledCount !== 1 ? 's' : ''} par ce versement · {period_label}</Text>
        </View>

        {/* Stats */}
        <View style={styles.stats}>
          <View style={styles.stat}><Text style={styles.statK}>Réglées</Text><Text style={styles.statV}>{settledCount}</Text></View>
          <View style={styles.stat}><Text style={styles.statK}>Restantes à régler</Text><Text style={styles.statVGhost}>{remaining_orders}</Text></View>
          <View style={styles.stat}><Text style={styles.statK}>En traitement</Text><Text style={styles.statVGhost}>{processing_orders}</Text></View>
          <View style={styles.stat}><Text style={styles.statK}>Reste à verser</Text><Text style={styles.statVGhost}>{fmtMAD(remaining_owed)} {currency}</Text></View>
        </View>

        {/* Financial breakdown */}
        <Text style={styles.sectionTitle}>Décompte financier</Text>
        <View style={styles.breakdown}>
          <View style={styles.brRow}><Text style={styles.brK}>Gains de la période</Text><Text style={styles.brV}>{fmtMAD(month_earned)} {currency}</Text></View>
          <View style={styles.brRow}><Text style={styles.brK}>Report entrant</Text><Text style={styles.brV}>{fmtMAD(carried_in)} {currency}</Text></View>
          <View style={styles.brRow}><Text style={styles.brK}>Total dû</Text><Text style={styles.brV}>{fmtMAD(total_owed)} {currency}</Text></View>
          <View style={styles.brRow}><Text style={styles.brK}>Déjà versé (cumul)</Text><Text style={styles.brV}>{fmtMAD(already_paid)} {currency}</Text></View>
          <View style={styles.brRowStrong}><Text style={styles.brKStrong}>Reste à verser</Text><Text style={styles.brVStrong}>{fmtMAD(remaining_owed)} {currency}</Text></View>
        </View>

        {/* Per-order commission table — only the orders THIS payment settled (FIFO) */}
        <Text style={styles.sectionTitle}>Commandes réglées par ce versement · {settledCount}</Text>
        {report_portion > 0.005 && (
          <Text style={{ fontSize: 8, color: MUTED, marginBottom: 4 }}>
            Dont {fmtMAD(report_portion)} {currency} affectés au report du mois précédent.
          </Text>
        )}
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.thText, { width: '7%' }]}>#</Text>
            <Text style={[styles.thText, { width: '27%' }]}>Client</Text>
            <Text style={[styles.thText, { width: '20%' }]}>Téléphone</Text>
            <Text style={[styles.thText, { width: '26%' }]}>Suivi</Text>
            <Text style={[styles.thText, { width: '8%', textAlign: 'right' }]}>Unités</Text>
            <Text style={[styles.thText, { width: '12%', textAlign: 'right' }]}>Réglé</Text>
          </View>
          {orders.map((o, i) => (
            <View style={styles.tr} key={o.order_id} wrap={false}>
              <Text style={styles.cNum}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={styles.cClient}>{o.client || '—'}</Text>
              <Text style={styles.cPhone}>{o.phone || '—'}</Text>
              <Text style={styles.cTrack}>{o.tracking || '—'}</Text>
              <Text style={styles.cUnits}>{o.units}</Text>
              <Text style={styles.cComm}>{fmtMAD(o.paidPortion ?? o.commission)}{o.partial ? ' *' : ''}</Text>
            </View>
          ))}
        </View>
        {hasPartial && (
          <Text style={{ fontSize: 7, color: MUTED, marginTop: 4 }}>
            * Commande réglée partiellement par ce versement — le solde sera réglé au prochain versement.
          </Text>
        )}

        {/* Cachet + signature — identical to facture (bottom-right, only when set) */}
        <StampBlock cachet={business.cachet_url} signature={business.signature_url} />
        {/* Legal footer — identical layout to facture/devis */}
        <LegalFooter business={business} />
      </Page>
    </Document>
  );
}

const embed = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? fetchUrlAsDataUri(u) : Promise.resolve(u ?? null));

async function resolveImages(input: SellerPayoutPdfInput): Promise<SellerPayoutPdfInput> {
  const [logo, cachet, signature, avatar] = await Promise.all([
    embed(input.business.logo), embed(input.business.cachet_url), embed(input.business.signature_url), embed(input.seller.avatar_url),
  ]);
  return {
    ...input,
    business: { ...input.business, logo: logo ?? null, cachet_url: cachet ?? null, signature_url: signature ?? null },
    seller: { ...input.seller, avatar_url: avatar ?? null },
  };
}

/** Build the seller payout PDF as a Blob (e.g. for local download). */
export async function buildSellerPayoutPdfBlob(input: SellerPayoutPdfInput): Promise<Blob> {
  const resolved = await resolveImages(input);
  return pdf(<SellerPayoutDocument input={resolved} />).toBlob();
}

/** Build the seller payout PDF and return { base64, filename } for the email attachment. */
export async function buildSellerPayoutPdfBase64(input: SellerPayoutPdfInput): Promise<{ base64: string; filename: string }> {
  const blob = await buildSellerPayoutPdfBlob(input);
  const base64 = await blobToBase64(blob);
  const safeRef = (input.reference || 'versement').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return { base64, filename: `versement-commercial-${safeRef}.pdf` };
}
