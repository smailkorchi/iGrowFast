import { embedRemoteImagesForPdfDoc, fetchUrlAsDataUri } from '@/lib/documentPdf/embedRemoteImages';
import type { BonLivraisonSnapshot } from './types';

export async function embedRemoteImagesForPdf(snapshot: BonLivraisonSnapshot): Promise<BonLivraisonSnapshot> {
  let s = await embedRemoteImagesForPdfDoc(snapshot);
  const logo = s.transport?.provider_logo_url;
  // Provider logos are now preset local assets (e.g. "/providers/Coliaty.png").
  // react-pdf needs an http(s)/data URI, so promote app-relative paths to an
  // absolute same-origin URL before embedding them as a data URI.
  if (logo) {
    let abs: string | null = null;
    if (/^https?:\/\//i.test(logo) || logo.startsWith('data:')) {
      abs = logo;
    } else if (logo.startsWith('/') && typeof window !== 'undefined') {
      abs = new URL(logo, window.location.origin).href;
    }
    if (abs) {
      const data = await fetchUrlAsDataUri(abs);
      s = {
        ...s,
        transport: s.transport
          ? { ...s.transport, provider_logo_url: data ?? s.transport.provider_logo_url }
          : s.transport,
      };
    }
  }
  return s;
}
