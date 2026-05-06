/** Snapshots that carry remote image URLs for @react-pdf/renderer (devis, facture, etc.). */
export type SnapshotWithPdfImages = {
  business: { logo_url?: string | null };
  stamps: { cachet_url?: string | null; signature_url?: string | null };
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

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

export async function embedRemoteImagesForPdfDoc<T extends SnapshotWithPdfImages>(snapshot: T): Promise<T> {
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
