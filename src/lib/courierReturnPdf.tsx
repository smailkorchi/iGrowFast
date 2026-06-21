/**
 * Client-side PDF generator for a courier RETURN statement.
 *
 * Twin of courierPayoutPdf.tsx (same @react-pdf/renderer primitives + brand
 * palette), re-framed for returns: the hero shows the return fees the courier
 * kept, the table lists each returned parcel (tracking, parcel value, return
 * fee). Downloaded from the courier's Payments page "Retours" tab.
 */
import {
    Document, Page, Text, View, StyleSheet, Image, pdf,
} from '@react-pdf/renderer';
import { format } from 'date-fns';
import { fetchUrlAsDataUri } from './documentPdf/embedRemoteImages';
import { blobToBase64 } from './documentPdf/toBase64';
import { LegalFooter, type LegalFooterBusiness } from './documentPdf/legalFooter';

const NAVY = '#141413';
const EMERALD = '#2D7A3E';
const ORANGE = '#D97706';
const MUTED = '#6B6760';
const BG_CREAM = '#faf9f5';
const BORDER = '#e8e6dc';
const ROW_BORDER = '#f1efe8';

export type CourierReturnPdfLineItem = {
    id: string;
    tracking_code: string | null;
    amount: number;
    shipping_fee: number;
};

export type CourierReturnPdfInput = {
    reference: string;
    total_amount: number;
    total_shipping_fees: number;
    net_amount: number;
    order_count: number;
    received_at: string | null;
    created_at: string;
    line_items: CourierReturnPdfLineItem[];
    business: { name: string; logo: string | null } & LegalFooterBusiness;
    courier: { name: string; avatar_url: string | null };
};

const fmtMAD = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(n || 0)
        .replace(/[  ]/g, ' '); // narrow/no-break space → regular space (Helvetica has no glyph)
const fmtDate = (iso?: string | null) => {
    if (!iso) return '—';
    try { return format(new Date(iso), 'dd MMM yyyy • HH:mm'); } catch { return '—'; }
};

const styles = StyleSheet.create({
    page: { paddingTop: 40, paddingBottom: 40, paddingHorizontal: 38, fontSize: 10, fontFamily: 'Helvetica', color: NAVY, backgroundColor: '#ffffff' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 18, marginBottom: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    brandLogoBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: BG_CREAM, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    brandLogoImg: { width: 40, height: 40, objectFit: 'contain' },
    brandLogoFallback: { width: 48, height: 48, borderRadius: 12, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
    brandLogoFallbackText: { fontFamily: 'Helvetica-Bold', fontSize: 15, color: '#daddcc' },
    brandName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: -0.2 },
    brandSub: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 4 },
    metaWrap: { alignItems: 'flex-end' },
    metaKicker: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: ORANGE, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
    metaRef: { fontSize: 18, fontFamily: 'Courier-Bold', color: NAVY, letterSpacing: -0.4 },
    metaDate: { fontSize: 9, color: MUTED, marginTop: 4 },

    courierBox: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, backgroundColor: BG_CREAM, borderWidth: 1, borderColor: BORDER, borderRadius: 14, marginBottom: 16 },
    avatarBox: { width: 48, height: 48, borderRadius: 14, overflow: 'hidden', backgroundColor: '#ffffff', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    avatarImg: { width: 48, height: 48, objectFit: 'cover' },
    avatarFallback: { width: 48, height: 48, borderRadius: 14, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
    avatarFallbackText: { fontFamily: 'Helvetica-Bold', fontSize: 14, color: '#daddcc' },
    courierInfo: { flex: 1 },
    courierLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 3 },
    courierName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: -0.3 },
    badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: '#fde68a' },
    badgeText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#92400e', textTransform: 'uppercase', letterSpacing: 1 },

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

    table: { marginBottom: 16 },
    tableHeader: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
    thText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase' },
    tr: { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: 0.5, borderBottomColor: ROW_BORDER },
    cNum: { width: '8%', fontSize: 8, fontFamily: 'Courier-Bold', color: MUTED },
    cTrack: { width: '46%', fontSize: 9, fontFamily: 'Courier-Bold', color: NAVY, letterSpacing: -0.2 },
    cAmount: { width: '23%', fontSize: 9, color: NAVY, textAlign: 'right' },
    cFee: { width: '23%', fontSize: 9, fontFamily: 'Helvetica-Bold', color: EMERALD, textAlign: 'right' },

    footer: { position: 'absolute', left: 38, right: 38, bottom: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
    footerText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase' },
    footerLegal: { fontSize: 7, color: MUTED, marginTop: 4 },
});

function CourierReturnDocument({ input }: { input: CourierReturnPdfInput }) {
    const { reference, total_amount, total_shipping_fees, net_amount, order_count, received_at, created_at, line_items, business, courier } = input;
    const businessInitials = (business.name || 'DC').substring(0, 2).toUpperCase();
    const courierInitials = (courier.name || 'CR').substring(0, 2).toUpperCase();

    return (
        <Document title={`${reference} — Retour`} author={business.name || 'iGrowFast'} subject="Courier Return Statement">
            <Page size="A4" style={styles.page} wrap>
                <View style={styles.header} fixed>
                    <View style={styles.brand}>
                        {business.logo ? (
                            <View style={styles.brandLogoBox}><Image style={styles.brandLogoImg} src={business.logo} /></View>
                        ) : (
                            <View style={styles.brandLogoFallback}><Text style={styles.brandLogoFallbackText}>{businessInitials}</Text></View>
                        )}
                        <View>
                            <Text style={styles.brandName}>{business.name || 'iGrowFast'}</Text>
                            <Text style={styles.brandSub}>Bon de retour</Text>
                        </View>
                    </View>
                    <View style={styles.metaWrap}>
                        <Text style={styles.metaKicker}>Reçu</Text>
                        <Text style={styles.metaRef}>{reference}</Text>
                        <Text style={styles.metaDate}>{fmtDate(received_at)}</Text>
                    </View>
                </View>

                <View style={styles.courierBox}>
                    {courier.avatar_url ? (
                        <View style={styles.avatarBox}><Image style={styles.avatarImg} src={courier.avatar_url} /></View>
                    ) : (
                        <View style={styles.avatarFallback}><Text style={styles.avatarFallbackText}>{courierInitials}</Text></View>
                    )}
                    <View style={styles.courierInfo}>
                        <Text style={styles.courierLabel}>Bénéficiaire · Livreur</Text>
                        <Text style={styles.courierName}>{courier.name || 'Livreur'}</Text>
                    </View>
                    <View style={styles.badge}><Text style={styles.badgeText}>Reçu</Text></View>
                </View>

                <View style={styles.hero}>
                    <Text style={styles.heroLabel}>Vos frais de retour</Text>
                    <View style={styles.heroValRow}>
                        <Text style={styles.heroVal}>{fmtMAD(total_shipping_fees)}</Text>
                        <Text style={styles.heroUnit}>MAD</Text>
                    </View>
                    <Text style={styles.heroSub}>
                        Frais de retour pour {order_count} colis retourné{order_count !== 1 ? 's' : ''}
                    </Text>
                </View>

                <View style={styles.stats}>
                    <View style={styles.stat}><Text style={styles.statK}>Retournés</Text><Text style={styles.statV}>{order_count}</Text></View>
                    <View style={styles.stat}><Text style={styles.statK}>Valeur des colis</Text><Text style={styles.statVGhost}>{fmtMAD(total_amount)} MAD</Text></View>
                    <View style={styles.stat}><Text style={styles.statK}>Net</Text><Text style={styles.statVGhost}>{fmtMAD(net_amount)} MAD</Text></View>
                </View>

                <View style={styles.table}>
                    <View style={styles.tableHeader} fixed>
                        <Text style={[styles.thText, { width: '8%' }]}>#</Text>
                        <Text style={[styles.thText, { width: '46%' }]}>Suivi</Text>
                        <Text style={[styles.thText, { width: '23%', textAlign: 'right' }]}>Valeur</Text>
                        <Text style={[styles.thText, { width: '23%', textAlign: 'right' }]}>Frais retour</Text>
                    </View>
                    {line_items.map((li, i) => (
                        <View style={styles.tr} key={li.id} wrap={false}>
                            <Text style={styles.cNum}>{String(i + 1).padStart(2, '0')}</Text>
                            <Text style={styles.cTrack}>{li.tracking_code || '—'}</Text>
                            <Text style={styles.cAmount}>{Number(li.amount).toFixed(2)}</Text>
                            <Text style={styles.cFee}>+{Number(li.shipping_fee).toFixed(2)}</Text>
                        </View>
                    ))}
                </View>

                {/* Legal footer — identical layout to facture/devis */}
                <LegalFooter business={business} />
            </Page>
        </Document>
    );
}

export async function buildCourierReturnPdfBlob(input: CourierReturnPdfInput): Promise<Blob> {
    const needsLogoFetch = !!input.business.logo && !input.business.logo.startsWith('data:');
    const needsAvatarFetch = !!input.courier.avatar_url && !input.courier.avatar_url.startsWith('data:');
    let logoDataUri = input.business.logo;
    let avatarDataUri = input.courier.avatar_url;
    if (needsLogoFetch || needsAvatarFetch) {
        const [lg, av] = await Promise.all([
            needsLogoFetch ? fetchUrlAsDataUri(input.business.logo as string) : Promise.resolve(input.business.logo),
            needsAvatarFetch ? fetchUrlAsDataUri(input.courier.avatar_url as string) : Promise.resolve(input.courier.avatar_url),
        ]);
        logoDataUri = lg;
        avatarDataUri = av;
    }
    const resolved: CourierReturnPdfInput = {
        ...input,
        business: { ...input.business, logo: logoDataUri || null },
        courier: { ...input.courier, avatar_url: avatarDataUri || null },
    };
    return pdf(<CourierReturnDocument input={resolved} />).toBlob();
}

/** Build the courier return PDF and return { base64, filename } for an email attachment. */
export async function buildCourierReturnPdfBase64(input: CourierReturnPdfInput): Promise<{ base64: string; filename: string }> {
    const blob = await buildCourierReturnPdfBlob(input);
    const base64 = await blobToBase64(blob);
    const safeRef = (input.reference || 'retour').replace(/[^a-zA-Z0-9_-]+/g, '-');
    return { base64, filename: `bon-retour-livreur-${safeRef}.pdf` };
}
