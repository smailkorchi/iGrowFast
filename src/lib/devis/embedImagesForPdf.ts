import { embedRemoteImagesForPdfDoc } from '@/lib/documentPdf/embedRemoteImages';
import type { DevisSnapshot } from './types';

export { fetchUrlAsDataUri } from '@/lib/documentPdf/embedRemoteImages';

export async function embedRemoteImagesForPdf(snapshot: DevisSnapshot): Promise<DevisSnapshot> {
  return embedRemoteImagesForPdfDoc(snapshot);
}
