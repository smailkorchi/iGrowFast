import type { DevisSnapshot } from './types';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** Fetch a remote image in the browser and return a data URI for @react-pdf/renderer (avoids Node Buffer in fetchImage). */
export async function fetchUrlAsDataUri(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:')) return trimmed || null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const res = await fetch(trimmed, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) return null;
    const b64 = arrayBufferToBase64(buf);
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

/** Clone snapshot and replace http(s) image URLs with data URIs so PDF generation works in the browser. */
export async function embedRemoteImagesForPdf(snapshot: DevisSnapshot): Promise<DevisSnapshot> {
  const business = { ...snapshot.business };
  if (business.logo_url && /^https?:\/\//i.test(business.logo_url)) {
    const data = await fetchUrlAsDataUri(business.logo_url);
    business.logo_url = data ?? null;
  }

  const stamps = { ...snapshot.stamps };
  if (stamps.cachet_url && /^https?:\/\//i.test(stamps.cachet_url)) {
    const data = await fetchUrlAsDataUri(stamps.cachet_url);
    stamps.cachet_url = data ?? null;
  }
  if (stamps.signature_url && /^https?:\/\//i.test(stamps.signature_url)) {
    const data = await fetchUrlAsDataUri(stamps.signature_url);
    stamps.signature_url = data ?? null;
  }

  return { ...snapshot, business, stamps };
}
