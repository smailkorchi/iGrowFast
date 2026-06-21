/**
 * Cachet (stamp) + signature overlay for collaborator payout PDFs.
 *
 * IDENTICAL to FacturePdfDocument's stamp block: both images overlaid in a
 * 180×120 box, bottom-right, fixed on every page, shown only when the business
 * has a cachet and/or signature set. The two images are passed pre-resolved as
 * data URIs (the PDF builders embed remote URLs before render).
 */
import { View, Image, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  // raised to bottom:90 to clear the legal footer block — same as facture/devis.
  stampBlock: { position: 'absolute', right: 40, bottom: 90, width: 180, height: 120 },
  stampImg: { position: 'absolute', top: 0, left: 0, width: 180, height: 120, objectFit: 'contain' },
});

export function StampBlock({ cachet, signature }: { cachet?: string | null; signature?: string | null }) {
  if (!cachet && !signature) return null;
  return (
    <View style={styles.stampBlock} fixed>
      {cachet ? <Image src={cachet} style={styles.stampImg} /> : null}
      {signature ? <Image src={signature} style={styles.stampImg} /> : null}
    </View>
  );
}
