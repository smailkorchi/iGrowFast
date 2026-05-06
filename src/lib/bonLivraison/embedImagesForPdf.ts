import { embedRemoteImagesForPdfDoc, fetchUrlAsDataUri } from '@/lib/documentPdf/embedRemoteImages';
import type { BonLivraisonSnapshot } from './types';

export async function embedRemoteImagesForPdf(snapshot: BonLivraisonSnapshot): Promise<BonLivraisonSnapshot> {
  let s = await embedRemoteImagesForPdfDoc(snapshot);
  const logo = s.transport?.provider_logo_url;
  if (logo && /^https?:\/\//i.test(logo)) {
    const data = await fetchUrlAsDataUri(logo);
    s = {
      ...s,
      transport: s.transport
        ? { ...s.transport, provider_logo_url: data ?? s.transport.provider_logo_url }
        : s.transport,
    };
  }
  return s;
}
