import { embedRemoteImagesForPdfDoc } from '@/lib/documentPdf/embedRemoteImages';
import type { BonCommandeSnapshot } from './types';

export async function embedRemoteImagesForPdf(snapshot: BonCommandeSnapshot): Promise<BonCommandeSnapshot> {
  return embedRemoteImagesForPdfDoc(snapshot);
}
