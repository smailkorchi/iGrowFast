/**
 * Client-side PDF generator for a MEDIA BUYER commission payout statement.
 *
 * Same editorial style as sellerPayoutPdf / courierPayoutPdf. The media-buyer
 * context has NO clean per-order ownership (attribution is day+source fuzzy),
 * so instead of an order table it shows a financial breakdown
 * (commission / ad spend / delivered attributed / campaigns) plus an optional
 * per-day spend table for transparency. Branded legal footer.
 */
import {
  Document, Page, Text, View, StyleSheet, Image, pdf,
} from '@react-pdf/renderer';
import { format } from 'date-fns';
import { fetchUrlAsDataUri } from './documentPdf/embedRemoteImages';
import { blobToBase64 } from './documentPdf/toBase64';

const NAVY = '#141413';
const EMERALD = '#2D7A3E';
const ORANGE = '#D97706';
const MUTED = '#6B6760';
const BG_CREAM = '#faf9f5';
const BORDER = '#e8e6dc';
const ROW_BORDER = '#f1efe8';

export type MediaBuyerPayoutDailyRow = { date: string; source?: string | null; spend: number };

export type MediaBuyerPayoutPdfInput = {
  reference: string;
  period_label: string;       // e.g. "Juin 2026"
  status_label: string;       // "Payé" | "Partiel"
  paid_at: string | null;
  currency: string;
  paid_amount: number;
  commission_earned: number;
  total_spend: number;
  delivered_orders: number;
  campaigns_count: number;
  commission_price?: number | null;
  already_paid: number;
  remaining_owed: number;
  daily?: MediaBuyerPayoutDailyRow[];
  business: {
    name: string; logo: string | null;
    ice?: string | null; rc?: string | null;
    legal_address?: string | null; legal_city?: string | null;
    business_phone?: string | null; business_email?: string | null;
  };
  mediabuyer: { name: string; avatar_url: string | null };
};

const fmtMAD = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return format(new Date(iso), 'dd MMM yyyy'); } catch { return '—'; }
};
const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  try { return format(new Date(iso), 'dd MMM yyyy • HH:mm'); } catch { return '—'; }
};

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 38, fontSize: 10, fontFamily: 'Helvetica', color: NAVY, backgroundColor: '#ffffff' },
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
  cDate: { width: '34%', fontSize: 8.5, fontFamily: 'Courier-Bold', color: NAVY },
  cSource: { width: '40%', fontSize: 8.5, color: NAVY, textTransform: 'capitalize' },
  cSpend: { width: '26%', fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: NAVY, textAlign: 'right' },

  footer: { position: 'absolute', left: 38, right: 38, bottom: 22, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: MUTED },
  footerStrong: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1 },
});

function joinLegal(parts: (string | null | undefined)[]): string {
  return parts.map(p => (p || '').trim()).filter(Boolean).join('  ·  ');
}

function MediaBuyerPayoutDocument({ input }: { input: MediaBuyerPayoutPdfInput }) {
  const { reference, period_label, status_label, paid_at, currency, paid_amount,
    commission_earned, total_spend, delivered_orders, campaigns_count, commission_price,
    already_paid, remaining_owed, daily, business, mediabuyer } = input;
  const bizInitials = (business.name || 'DC').substring(0, 2).toUpperCase();
  const mbInitials = (mediabuyer.name || 'MB').substring(0, 2).toUpperCase();
  const isPaid = (status_label || '').toLowerCase().includes('pay');
  const rows = daily ?? [];

  return (
    <Document title={`${reference} — Versement media buyer`} author={business.name || 'iGrowFast'} subject="Relevé de versement — Media Buyer">
      <Page size="A4" style={styles.page} wrap>
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
            <Text style={styles.metaKicker}>Media Buyer · {period_label}</Text>
            <Text style={styles.metaRef}>{reference}</Text>
            <Text style={styles.metaDate}>{fmtDateTime(paid_at)}</Text>
          </View>
        </View>

        <View style={styles.beneficiary}>
          {mediabuyer.avatar_url ? (
            <View style={styles.avatarBox}><Image style={styles.avatarImg} src={mediabuyer.avatar_url} /></View>
          ) : (
            <View style={styles.avatarFallback}><Text style={styles.avatarFallbackText}>{mbInitials}</Text></View>
          )}
          <View style={styles.benInfo}>
            <Text style={styles.benLabel}>Bénéficiaire · Media Buyer</Text>
            <Text style={styles.benName}>{mediabuyer.name || 'Media Buyer'}</Text>
          </View>
          <View style={[styles.badge, ...(isPaid ? [] : [styles.badgePartial])]}>
            <Text style={[styles.badgeText, ...(isPaid ? [] : [styles.badgePartialText])]}>{status_label || 'Payé'}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Montant versé</Text>
          <View style={styles.heroValRow}>
            <Text style={styles.heroVal}>{fmtMAD(paid_amount)}</Text>
            <Text style={styles.heroUnit}>{currency}</Text>
          </View>
          <Text style={styles.heroSub}>Commission pour {delivered_orders} commande{delivered_orders !== 1 ? 's' : ''} livrée{delivered_orders !== 1 ? 's' : ''} attribuée{delivered_orders !== 1 ? 's' : ''} · {period_label}</Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}><Text style={styles.statK}>Livrées attribuées</Text><Text style={styles.statV}>{delivered_orders}</Text></View>
          <View style={styles.stat}><Text style={styles.statK}>Dépense pub</Text><Text style={styles.statVGhost}>{fmtMAD(total_spend)} {currency}</Text></View>
          <View style={styles.stat}><Text style={styles.statK}>Campagnes</Text><Text style={styles.statVGhost}>{campaigns_count}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Décompte financier</Text>
        <View style={styles.breakdown}>
          <View style={styles.brRow}><Text style={styles.brK}>Commission de la période{commission_price ? ` (${delivered_orders} × ${fmtMAD(commission_price)})` : ''}</Text><Text style={styles.brV}>{fmtMAD(commission_earned)} {currency}</Text></View>
          <View style={styles.brRow}><Text style={styles.brK}>Dépense publicitaire</Text><Text style={styles.brV}>{fmtMAD(total_spend)} {currency}</Text></View>
          <View style={styles.brRow}><Text style={styles.brK}>Commandes livrées attribuées</Text><Text style={styles.brV}>{delivered_orders}</Text></View>
          <View style={styles.brRow}><Text style={styles.brK}>Campagnes</Text><Text style={styles.brV}>{campaigns_count}</Text></View>
          <View style={styles.brRow}><Text style={styles.brK}>Déjà versé</Text><Text style={styles.brV}>{fmtMAD(already_paid)} {currency}</Text></View>
          <View style={styles.brRowStrong}><Text style={styles.brKStrong}>Reste à verser</Text><Text style={styles.brVStrong}>{fmtMAD(remaining_owed)} {currency}</Text></View>
        </View>

        {rows.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Dépense quotidienne · {rows.length} jour{rows.length !== 1 ? 's' : ''}</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader} fixed>
                <Text style={[styles.thText, { width: '34%' }]}>Date</Text>
                <Text style={[styles.thText, { width: '40%' }]}>Source</Text>
                <Text style={[styles.thText, { width: '26%', textAlign: 'right' }]}>Dépense</Text>
              </View>
              {rows.map((r, i) => (
                <View style={styles.tr} key={`${r.date}-${i}`} wrap={false}>
                  <Text style={styles.cDate}>{fmtDate(r.date)}</Text>
                  <Text style={styles.cSource}>{r.source || '—'}</Text>
                  <Text style={styles.cSpend}>{fmtMAD(r.spend)} {currency}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.footer} fixed>
          <View style={styles.footerRow}>
            <Text style={styles.footerStrong}>{(business.name || 'iGrowFast').toUpperCase()} · RELEVÉ DE VERSEMENT</Text>
            <Text style={styles.footerStrong}>{fmtDate(paid_at)}</Text>
          </View>
          <Text style={[styles.footerText, { marginTop: 4 }]}>
            {joinLegal([
              business.legal_address, business.legal_city,
              business.ice ? `ICE ${business.ice}` : null,
              business.rc ? `RC ${business.rc}` : null,
              business.business_phone, business.business_email,
            ]) || 'Document généré par iGrowFast'}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

async function resolveImages(input: MediaBuyerPayoutPdfInput): Promise<MediaBuyerPayoutPdfInput> {
  const needLogo = !!input.business.logo && !input.business.logo.startsWith('data:');
  const needAvatar = !!input.mediabuyer.avatar_url && !input.mediabuyer.avatar_url.startsWith('data:');
  if (!needLogo && !needAvatar) return input;
  const [logo, avatar] = await Promise.all([
    needLogo ? fetchUrlAsDataUri(input.business.logo as string) : Promise.resolve(input.business.logo),
    needAvatar ? fetchUrlAsDataUri(input.mediabuyer.avatar_url as string) : Promise.resolve(input.mediabuyer.avatar_url),
  ]);
  return {
    ...input,
    business: { ...input.business, logo: logo || null },
    mediabuyer: { ...input.mediabuyer, avatar_url: avatar || null },
  };
}

export async function buildMediaBuyerPayoutPdfBlob(input: MediaBuyerPayoutPdfInput): Promise<Blob> {
  const resolved = await resolveImages(input);
  return pdf(<MediaBuyerPayoutDocument input={resolved} />).toBlob();
}

export async function buildMediaBuyerPayoutPdfBase64(input: MediaBuyerPayoutPdfInput): Promise<{ base64: string; filename: string }> {
  const blob = await buildMediaBuyerPayoutPdfBlob(input);
  const base64 = await blobToBase64(blob);
  const safeRef = (input.reference || 'versement').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return { base64, filename: `versement-media-buyer-${safeRef}.pdf` };
}
