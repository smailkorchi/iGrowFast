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
import { saveBlob, type SaveBlobResult } from './saveBlob';

// ─── Brand palette ───────────────────────────────────────────────────────────
const NAVY = '#3b5e5e';
const NAVY_DARK = '#2d4747';
const EMERALD = '#059669';
const EMERALD_LIGHT = '#a7f3d0';
const MUTED = '#9aa6a0';
const BG_CREAM = '#f9faf7';
const BORDER = '#eef1ee';
const ROW_BORDER = '#f4f6f2';

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
    business: { name: string; logo: string | null };
    courier: { name: string; avatar_url: string | null };
};

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmtMAD = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        n || 0,
    );

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
        paddingBottom: 40,
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
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: BORDER,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    footerText: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: MUTED,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
});

// ─── Document ────────────────────────────────────────────────────────────────
function CourierPayoutDocument({ input }: { input: CourierPayoutPdfInput }) {
    const { reference, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at, line_items, business, courier } = input;

    const businessInitials = (business.name || 'DC').substring(0, 2).toUpperCase();
    const courierInitials = (courier.name || 'CR').substring(0, 2).toUpperCase();

    return (
        <Document
            title={`${reference} — Payout`}
            author={business.name || 'DigiCom'}
            subject="Courier Payout Statement"
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
                            <Text style={styles.brandName}>{business.name || 'DigiCom'}</Text>
                            <Text style={styles.brandSub}>Courier Payout</Text>
                        </View>
                    </View>

                    <View style={styles.metaWrap}>
                        <Text style={styles.metaKicker}>Settled</Text>
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
                        <Text style={styles.courierLabel}>Beneficiary</Text>
                        <Text style={styles.courierName}>{courier.name || 'Courier'}</Text>
                    </View>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>Paid</Text>
                    </View>
                </View>

                {/* Earnings hero */}
                <View style={styles.hero}>
                    <Text style={styles.heroLabel}>Your Earnings</Text>
                    <View style={styles.heroValRow}>
                        <Text style={styles.heroVal}>{fmtMAD(total_shipping_fees)}</Text>
                        <Text style={styles.heroUnit}>MAD</Text>
                    </View>
                    <Text style={styles.heroSub}>
                        Delivery fees for {order_count} successfully delivered parcel{order_count !== 1 ? 's' : ''}
                    </Text>
                </View>

                {/* Stats */}
                <View style={styles.stats}>
                    <View style={styles.stat}>
                        <Text style={styles.statK}>Delivered</Text>
                        <Text style={styles.statV}>{order_count}</Text>
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.statK}>Gross Collected</Text>
                        <Text style={styles.statVGhost}>{fmtMAD(total_amount)} MAD</Text>
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.statK}>Settled to Business</Text>
                        <Text style={styles.statVGhost}>{fmtMAD(net_amount)} MAD</Text>
                    </View>
                </View>

                {/* Parcel table */}
                <View style={styles.table}>
                    <View style={styles.tableHeader} fixed>
                        <Text style={[styles.thText, { width: '8%' }]}>#</Text>
                        <Text style={[styles.thText, { width: '32%' }]}>Tracking</Text>
                        <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>Order</Text>
                        <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>Your Fee</Text>
                        <Text style={[styles.thText, { width: '20%', textAlign: 'right' }]}>To Business</Text>
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

                {/* Footer */}
                <View style={styles.footer} fixed>
                    <Text style={styles.footerText}>{business.name || 'DigiCom'} · Payout Statement</Text>
                    <Text style={styles.footerText}>Generated {fmtDate(created_at)}</Text>
                </View>
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
    // Inline remote images only if they're still URLs (caller may have
    // already resolved them into data URIs at page load).
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

    const resolved: CourierPayoutPdfInput = {
        ...input,
        business: { ...input.business, logo: logoDataUri || null },
        courier: { ...input.courier, avatar_url: avatarDataUri || null },
    };

    return pdf(<CourierPayoutDocument input={resolved} />).toBlob();
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
