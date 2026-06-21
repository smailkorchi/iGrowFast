/**
 * Client-side PDF generator for a courier payout note.
 *
 * Uses @react-pdf/renderer to build a real PDF blob that can be downloaded
 * directly from the same page — no popup, no window.print(), no browser
 * print dialog. Works identically on mobile and desktop.
 *
 * The layout mirrors the premium HTML template used by the admin print,
 * but re-expressed using react-pdf's StyleSheet/View primitives.
 */
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Image,
    pdf,
} from '@react-pdf/renderer';
import { format } from 'date-fns';
import { fetchUrlAsDataUri } from './documentPdf/embedRemoteImages';
import { blobToBase64 } from './documentPdf/toBase64';
import { LegalFooter, type LegalFooterBusiness } from './documentPdf/legalFooter';
import { StampBlock } from './documentPdf/stampBlock';
import { saveBlob, type SaveBlobResult } from './saveBlob';

// ─── Brand palette (Anthropic editorial tokens) ──────────────────────────────
const NAVY = '#141413';         // ant-ink — primary text / dark surfaces
const NAVY_DARK = '#0d0d0c';    // deepest ink for gradient/header
const EMERALD = '#2D7A3E';      // ant-green — success accents
const EMERALD_LIGHT = '#D97706';// ant-orange — net-amount highlight
const MUTED = '#6B6760';        // ant-mid — secondary text
const BG_CREAM = '#faf9f5';     // ant-light — page bg
const BORDER = '#e8e6dc';       // ant-line — hairlines
const ROW_BORDER = '#f1efe8';   // ant-line-soft — row dividers
const ORANGE = '#D97706';       // ant-orange — accent stripe

// ─── Types ───────────────────────────────────────────────────────────────────
export type CourierPayoutPdfLineItem = {
    id: string;
    tracking_code: string | null;
    amount: number;
    shipping_fee: number;
};

export type CourierPayoutPdfInput = {
    reference: string;
    status: string;
    total_amount: number;
    total_shipping_fees: number;
    net_amount: number;
    order_count: number;
    paid_at: string | null;
    created_at: string;
    line_items: CourierPayoutPdfLineItem[];
    business: { name: string; logo: string | null; cachet_url?: string | null; signature_url?: string | null } & LegalFooterBusiness;
    courier: { name: string; avatar_url: string | null };
};

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmtMAD = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(n || 0)
        .replace(/[  ]/g, ' '); // narrow/no-break space → regular space (Helvetica has no glyph)

const fmtDate = (iso?: string | null) => {
    if (!iso) return '—';
    try {
        return format(new Date(iso), 'dd MMM yyyy • HH:mm');
    } catch {
        return '—';
    }
};

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    page: {
        paddingTop: 40,
        paddingBottom: 150, // reserved band so table rows never overlap the last-page stamp + footer
        paddingHorizontal: 38,
        fontSize: 10,
        fontFamily: 'Helvetica',
        color: NAVY,
        backgroundColor: '#ffffff',
    },

    // ─── Header ───
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingBottom: 18,
        marginBottom: 18,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    brandLogoBox: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: BG_CREAM,
        borderWidth: 1,
        borderColor: BORDER,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    brandLogoImg: { width: 40, height: 40, objectFit: 'contain' },
    brandLogoFallback: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: NAVY,
        color: '#daddcc',
        alignItems: 'center',
        justifyContent: 'center',
    },
    brandLogoFallbackText: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 15,
        color: '#daddcc',
    },
    brandName: {
        fontSize: 15,
        fontFamily: 'Helvetica-Bold',
        color: NAVY,
        letterSpacing: -0.2,
    },
    brandSub: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: MUTED,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        marginTop: 4,
    },
    metaWrap: { alignItems: 'flex-end' },
    metaKicker: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: EMERALD,
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    metaRef: {
        fontSize: 18,
        fontFamily: 'Courier-Bold',
        color: NAVY,
        letterSpacing: -0.4,
    },
    metaDate: {
        fontSize: 9,
        color: MUTED,
        marginTop: 4,
    },

    // ─── Courier block ───
    courierBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        backgroundColor: BG_CREAM,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        marginBottom: 16,
    },
    avatarBox: {
        width: 48,
        height: 48,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: BORDER,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarImg: { width: 48, height: 48, objectFit: 'cover' },
    avatarFallback: {
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: NAVY,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarFallbackText: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 14,
        color: '#daddcc',
    },
    courierInfo: { flex: 1 },
    courierLabel: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: MUTED,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 3,
    },
    courierName: {
        fontSize: 16,
        fontFamily: 'Helvetica-Bold',
        color: NAVY,
        letterSpacing: -0.3,
    },
    badge: {
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: '#d1fae5',
    },
    badgeText: {
        fontSize: 8,
        fontFamily: 'Helvetica-Bold',
        color: '#065f46',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },

    // ─── Earnings hero ───
    hero: {
        padding: 24,
        backgroundColor: NAVY,
        borderRadius: 18,
        marginBottom: 14,
    },
    heroLabel: {
        fontSize: 8,
        fontFamily: 'Helvetica-Bold',
        color: EMERALD_LIGHT,
        letterSpacing: 2.2,
        textTransform: 'uppercase',
        marginBottom: 8,
        opacity: 0.85,
    },
    heroValRow: { flexDirection: 'row', alignItems: 'baseline' },
    heroVal: {
        fontSize: 40,
        fontFamily: 'Helvetica-Bold',
        color: EMERALD_LIGHT,
        letterSpacing: -1,
    },
    heroUnit: {
        fontSize: 16,
        fontFamily: 'Helvetica-Bold',
        color: EMERALD_LIGHT,
        opacity: 0.6,
        marginLeft: 8,
    },
    heroSub: {
        marginTop: 10,
        fontSize: 9,
        color: '#ffffff',
        opacity: 0.55,
    },

    // ─── Stats row ───
    stats: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 18,
    },
    stat: {
        flex: 1,
        padding: 14,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
    },
    statK: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: MUTED,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    statV: {
        fontSize: 13,
        fontFamily: 'Helvetica-Bold',
        color: NAVY,
    },
    statVGhost: {
        fontSize: 13,
        fontFamily: 'Helvetica-Bold',
        color: MUTED,
    },

    // ─── Table ───
    table: { marginBottom: 16 },
    tableHeader: {
        flexDirection: 'row',
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    thText: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: MUTED,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    tr: {
        flexDirection: 'row',
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: ROW_BORDER,
    },
    cNum: { width: '8%', fontSize: 8, fontFamily: 'Courier-Bold', color: MUTED },
    cTrack: { width: '32%', fontSize: 9, fontFamily: 'Courier-Bold', color: NAVY, letterSpacing: -0.2 },
    cAmount: { width: '20%', fontSize: 9, color: NAVY, textAlign: 'right' },
    cFee: {
        width: '20%',
        fontSize: 9,
        fontFamily: 'Helvetica-Bold',
        color: EMERALD,
        textAlign: 'right',
    },
    cNet: { width: '20%', fontSize: 9, color: NAVY, textAlign: 'right' },

    // ─── Footer ───
    footer: {
        position: 'absolute',
        left: 38,
        right: 38,
        bottom: 24,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: BORDER,
    },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
    footerText: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: MUTED,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    footerLegal: { fontSize: 7, color: MUTED, marginTop: 4 },
});

// ─── Document ────────────────────────────────────────────────────────────────
function CourierPayoutDocument({ input }: { input: CourierPayoutPdfInput }) {
    const { reference, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at, line_items, business, courier } = input;

    const businessInitials = (business.name || 'DC').substring(0, 2).toUpperCase();
    const courierInitials = (courier.name || 'CR').substring(0, 2).toUpperCase();

    return (
        <Document
            title={`${reference} — Bon de paiement`}
            author={business.name || 'iGrowFast'}
            subject="Bon de paiement livreur"
        >
            <Page size="A4" style={styles.page} wrap>
                {/* Header */}
                <View style={styles.header} fixed>
                    <View style={styles.brand}>
                        {business.logo ? (
                            <View style={styles.brandLogoBox}>
                                <Image style={styles.brandLogoImg} src={business.logo} />
                            </View>
                        ) : (
                            <View style={styles.brandLogoFallback}>
                                <Text style={styles.brandLogoFallbackText}>{businessInitials}</Text>
                            </View>
                        )}
                        <View>
                            <Text style={styles.brandName}>{business.name || 'iGrowFast'}</Text>
                            <Text style={styles.brandSub}>Bon de paiement</Text>
                        </View>
                    </View>

                    <View style={styles.metaWrap}>
                        <Text style={styles.metaKicker}>Réglé</Text>
                        <Text style={styles.metaRef}>{reference}</Text>
                        <Text style={styles.metaDate}>{fmtDate(paid_at)}</Text>
                    </View>
                </View>

                {/* Courier identity */}
                <View style={styles.courierBox}>
                    {courier.avatar_url ? (
                        <View style={styles.avatarBox}>
                            <Image style={styles.avatarImg} src={courier.avatar_url} />
                        </View>
                    ) : (
                        <View style={styles.avatarFallback}>
                            <Text style={styles.avatarFallbackText}>{courierInitials}</Text>
                        </View>
                    )}
                    <View style={styles.courierInfo}>
                        <Text style={styles.courierLabel}>Bénéficiaire · Livreur</Text>
                        <Text style={styles.courierName}>{courier.name || 'Courier'}</Text>
                    </View>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>Payé</Text>
                    </View>
                </View>

                {/* Earnings hero */}
                <View style={styles.hero}>
                    <Text style={styles.heroLabel}>Vos frais de livraison</Text>
                    <View style={styles.heroValRow}>
                        <Text style={styles.heroVal}>{fmtMAD(total_shipping_fees)}</Text>
                        <Text style={styles.heroUnit}>MAD</Text>
                    </View>
                    <Text style={styles.heroSub}>
                        Frais de livraison pour {order_count} colis livré{order_count !== 1 ? 's' : ''}
                    </Text>
                </View>

                {/* Stats */}
                <View style={styles.stats}>
                    <View style={styles.stat}>
                        <Text style={styles.statK}>Livrés</Text>
                        <Text style={styles.statV}>{order_count}</Text>
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.statK}>Total encaissé</Text>
                        <Text style={styles.statVGhost}>{fmtMAD(total_amount)} MAD</Text>
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.statK}>Reversé au business</Text>
                        <Text style={styles.statVGhost}>{fmtMAD(net_amount)} MAD</Text>
                    </View>
                </View>

                {/* Parcel table */}
                <View style={styles.table}>
                    <View style={styles.tableHeader} fixed>
                        <Text style={[styles.thText, { width: '8%' }]}>#</Text>
                        <Text style={[styles.thText, { width: '32%' }]}>Suivi</Text>
                        <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>Commande</Text>
                        <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>Vos frais</Text>
                        <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>Au business</Text>
                    </View>

                    {line_items.map((li, i) => (
                        <View style={styles.tr} key={li.id} wrap={false}>
                            <Text style={styles.cNum}>{String(i + 1).padStart(2, '0')}</Text>
                            <Text style={styles.cTrack}>{li.tracking_code || '—'}</Text>
                            <Text style={styles.cAmount}>{Number(li.amount).toFixed(2)}</Text>
                            <Text style={styles.cFee}>+{Number(li.shipping_fee).toFixed(2)}</Text>
                            <Text style={styles.cNet}>
                                {(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}
                            </Text>
                        </View>
                    ))}
                </View>

                {/* Cachet + signature — identical to facture (bottom-right, only when set) */}
                <StampBlock cachet={business.cachet_url} signature={business.signature_url} />
                {/* Legal footer — identical layout to facture/devis */}
                <LegalFooter business={business} />
            </Page>
        </Document>
    );
}

// ─── Public entrypoints ──────────────────────────────────────────────────────

/**
 * Builds the courier payout PDF and returns the raw Blob.
 *
 * Split from the save step so the caller can pre-generate the blob (e.g.
 * during a loading state) and then trigger the save in a fresh user
 * activation context — this is critical on iOS Safari where user
 * activation expires quickly and navigator.share() is rejected if called
 * after long awaits.
 *
 * If the caller has already resolved the business logo and courier avatar
 * as data URIs (recommended — see `resolveCourierPayoutImages`), pass them
 * via `input` directly; otherwise this function will fetch them here,
 * which adds latency and risks iOS user-activation expiration.
 */
export async function buildCourierPayoutPdfBlob(input: CourierPayoutPdfInput): Promise<Blob> {
    // Embed remote images (logo, cachet, signature, courier avatar) as data URIs;
    // already-resolved data URIs pass through untouched.
    const embed = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? fetchUrlAsDataUri(u) : Promise.resolve(u ?? null));
    const [logo, cachet, signature, avatar] = await Promise.all([
        embed(input.business.logo), embed(input.business.cachet_url), embed(input.business.signature_url), embed(input.courier.avatar_url),
    ]);

    const resolved: CourierPayoutPdfInput = {
        ...input,
        business: { ...input.business, logo: logo ?? null, cachet_url: cachet ?? null, signature_url: signature ?? null },
        courier: { ...input.courier, avatar_url: avatar ?? null },
    };

    return pdf(<CourierPayoutDocument input={resolved} />).toBlob();
}

/** Build the courier payout PDF and return { base64, filename } for an email attachment. */
export async function buildCourierPayoutPdfBase64(input: CourierPayoutPdfInput): Promise<{ base64: string; filename: string }> {
    const blob = await buildCourierPayoutPdfBlob(input);
    const base64 = await blobToBase64(blob);
    const safeRef = (input.reference || 'versement').replace(/[^a-zA-Z0-9_-]+/g, '-');
    return { base64, filename: `bon-paiement-livreur-${safeRef}.pdf` };
}

/**
 * Pre-resolves the courier payout's remote images into data URIs.
 *
 * Call this at page mount so the click handler has zero image-fetch
 * latency. On iOS Safari this is the difference between a working share
 * sheet and a "user activation expired" rejection.
 */
export async function resolveCourierPayoutImages(opts: {
    businessLogo: string | null;
    courierAvatar: string | null;
}): Promise<{ businessLogo: string | null; courierAvatar: string | null }> {
    const [businessLogo, courierAvatar] = await Promise.all([
        opts.businessLogo ? fetchUrlAsDataUri(opts.businessLogo) : Promise.resolve(null),
        opts.courierAvatar ? fetchUrlAsDataUri(opts.courierAvatar) : Promise.resolve(null),
    ]);
    return { businessLogo, courierAvatar };
}

/**
 * Generates the PDF blob and immediately attempts to save it via the
 * unified `saveBlob` helper (Web Share API first, anchor download second,
 * new-tab fallback third).
 *
 * Returns the `SaveBlobResult` AND the blob itself — the caller can
 * re-use the blob to offer a fallback save action inside a "PDF ready"
 * modal when iOS rejects the first share attempt.
 */
export async function downloadCourierPayoutPdf(
    input: CourierPayoutPdfInput,
): Promise<{ blob: Blob; save: SaveBlobResult }> {
    const blob = await buildCourierPayoutPdfBlob(input);
    const save = await saveBlob(blob, {
        filename: `${input.reference || 'courier-payout'}.pdf`,
        title: `${input.reference} — Payout`,
        text: `Payout statement ${input.reference}`,
        mimeType: 'application/pdf',
    });
    return { blob, save };
}
