/**
 * Cachet (stamp) + signature for collaborator payout PDFs.
 *
 * Pinned to the BOTTOM-RIGHT of the LAST page only (just above the legal footer), exactly like
 * the devis/facture stamp — but gated to the final page via react-pdf's `fixed` + `render`
 * (pageNumber === totalPages) so it does NOT repeat on every page of a multi-page note. The
 * cachet and signature are overlaid in the same box. Images are passed pre-resolved as data
 * URIs by the PDF builders.
 */
import { View, Image, StyleSheet } from '@react-pdf/renderer';

// Sits inside the reserved bottom band (page paddingBottom = STAMP_FOOTER_BAND in each PDF):
// stamp top = bottom(64) + height(82) = 146 < 150 reserved → rows can never overlap it.
const styles = StyleSheet.create({
  stampBlock: { position: 'absolute', right: 38, bottom: 64, width: 130, height: 82 },
  stampImg: { position: 'absolute', top: 0, left: 0, width: 130, height: 82, objectFit: 'contain' },
});

export function StampBlock({ cachet, signature }: { cachet?: string | null; signature?: string | null }) {
  if (!cachet && !signature) return null;
  return (
    <View
      style={styles.stampBlock}
      fixed
      render={({ pageNumber, totalPages }: { pageNumber: number; totalPages?: number }) =>
        pageNumber === totalPages ? (
          <View>
            {cachet ? <Image src={cachet} style={styles.stampImg} /> : null}
            {signature ? <Image src={signature} style={styles.stampImg} /> : null}
          </View>
        ) : null
      }
    />
  );
}
