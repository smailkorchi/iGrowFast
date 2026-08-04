/**
 * Shared client-side image compressor — the single encoder for every image the
 * app uploads. It exists because storage was filling with camera-original
 * photos: one avatar bucket held 185 MB across 35 objects, the largest a single
 * 18.9 MB PNG uploaded eleven times.
 *
 * What it does: decode → (optional centre crop) → downscale to the preset's
 * longest edge (NEVER upscale) → re-encode. The canvas round-trip drops EXIF
 * and every other metadata block as a side effect.
 *
 * OUTPUT FORMAT IS PER PRESET, and that is deliberate:
 *   - `product` / `media` are browser-only, so they take WebP (with a JPEG
 *     fallback when the browser cannot encode WebP — feature-detected below).
 *   - `avatar` and `logo` are ALSO embedded into PDFs by @react-pdf/renderer
 *     (payout statements embed the user avatar + business logo; facture / devis
 *     / bon de livraison embed the logo and the cachet + signature stamps).
 *     react-pdf decodes JPEG and PNG only — a WebP there does not degrade, it
 *     throws and the whole document fails to build. So avatars encode to JPEG
 *     and logos/stamps to PNG (lossless, and alpha survives for transparent
 *     marks printed on white paper).
 *
 * This module is NOT an enforcement boundary. The tus and S3 storage endpoints
 * accept the same JWT and bypass every line of it; real limits live on the
 * bucket rows (supabase/migrations/20260804110000_storage_upload_limits.sql)
 * and in the edge functions that proxy bytes.
 */

export type CompressPreset = 'avatar' | 'logo' | 'product' | 'media';

export interface CompressedImage {
  blob: Blob;
  contentType: string;
  /** File extension matching `contentType`, no dot. */
  ext: string;
  /** false = the original was already smaller and is returned untouched. */
  compressed: boolean;
}

const QUALITY = 0.82;

interface PresetSpec {
  maxDim: number;
  /** Centre-crop to a square before scaling (avatars are always shown cropped). */
  square: boolean;
  /** Encode targets in order of preference; the first the browser supports wins. */
  formats: readonly string[];
  /** Original types allowed to pass through untouched when already smaller. */
  passthrough: readonly string[];
}

const PDF_SAFE = ['image/jpeg', 'image/png'] as const;
const WEB_SAFE = ['image/jpeg', 'image/png', 'image/webp'] as const;

const PRESETS: Record<CompressPreset, PresetSpec> = {
  // Rendered at 40 px or smaller everywhere; 512 covers retina + the payout PDF.
  avatar: { maxDim: 512, square: true, formats: ['image/jpeg'], passthrough: PDF_SAFE },
  // Logos, cachets and signatures: PNG keeps the alpha these assets rely on.
  logo: { maxDim: 800, square: false, formats: ['image/png'], passthrough: PDF_SAFE },
  // Product / accessory catalogue images — biggest zoom is a full-width card.
  product: { maxDim: 1600, square: false, formats: ['image/webp', 'image/jpeg'], passthrough: WEB_SAFE },
  // Campaign creatives and demand attachments, viewed full screen.
  media: { maxDim: 1920, square: false, formats: ['image/webp', 'image/jpeg'], passthrough: WEB_SAFE },
};

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Source ceiling before we even try to decode — above this, phones run out of memory. */
export const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;

const ERR_NOT_IMAGE = "Ce fichier n'est pas une image.";
const ERR_SVG = 'Les fichiers SVG ne sont pas acceptés pour des raisons de sécurité.';
const ERR_DECODE = "Image illisible ou dans un format que ce navigateur ne sait pas ouvrir.";
const ERR_NO_DIMS = 'Image sans dimensions exploitables.';
const ERR_CANVAS = 'Canvas 2D indisponible dans ce navigateur.';
const ERR_ENCODE = 'La compression de l’image a échoué.';

const encoderSupport = new Map<string, Promise<boolean>>();

/**
 * Browsers silently fall back to PNG when asked for a codec they lack, so the
 * only honest probe is the MIME type of the blob that actually comes back.
 */
function canEncode(type: string): Promise<boolean> {
  let probe = encoderSupport.get(type);
  if (!probe) {
    probe = new Promise<boolean>((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvas.toBlob((blob) => resolve(!!blob && blob.type === type), type, QUALITY);
      } catch {
        resolve(false);
      }
    });
    encoderSupport.set(type, probe);
  }
  return probe;
}

async function pickFormat(formats: readonly string[]): Promise<string> {
  for (const type of formats) {
    if (await canEncode(type)) return type;
  }
  return 'image/png'; // universally supported last resort
}

function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(ERR_DECODE));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(ERR_ENCODE))), type, QUALITY);
  });
}

function untouched(file: Blob, type: string): CompressedImage {
  return { blob: file, contentType: type, ext: EXT_BY_TYPE[type] ?? 'bin', compressed: false };
}

/**
 * Compress `file` for `preset`. Throws (French message) when the input is not a
 * decodable raster image — callers should surface `err.message` directly.
 */
export async function compressImage(file: Blob, preset: CompressPreset): Promise<CompressedImage> {
  const sourceType = (file.type || '').toLowerCase();
  if (!sourceType.startsWith('image/')) throw new Error(ERR_NOT_IMAGE);
  if (sourceType === 'image/svg+xml') throw new Error(ERR_SVG);

  const spec = PRESETS[preset];

  // A canvas keeps frame 1 and throws the animation away. Campaign creatives and
  // demand attachments are the only places an animated GIF is legitimate, and
  // those buckets are sized for video anyway — pass them through intact.
  if (sourceType === 'image/gif' && preset === 'media') return untouched(file, sourceType);

  const img = await decode(file);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) throw new Error(ERR_NO_DIMS);

  const cropSide = spec.square ? Math.min(sw, sh) : 0;
  const srcW = spec.square ? cropSide : sw;
  const srcH = spec.square ? cropSide : sh;
  const scale = Math.min(1, spec.maxDim / Math.max(srcW, srcH)); // never upscale
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(ERR_CANVAS);

  const outType = await pickFormat(spec.formats);
  // JPEG has no alpha: without a matte, transparent pixels come out black.
  if (outType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.drawImage(img, (sw - srcW) / 2, (sh - srcH) / 2, srcW, srcH, 0, 0, outW, outH);

  const encoded = await encode(canvas, outType);

  // Re-encoding a small image usually costs bytes rather than saving them (a
  // measured 11 KB stamp came back at 12 KB). Keep the original when it is both
  // smaller and in a format this preset's consumers can read.
  if (encoded.size >= file.size && spec.passthrough.includes(sourceType)) {
    return untouched(file, sourceType);
  }
  return { blob: encoded, contentType: outType, ext: EXT_BY_TYPE[outType] ?? 'bin', compressed: true };
}

/** Data URL for a blob — for the flows that carry an avatar as base64 JSON. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(ERR_ENCODE));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export interface UploadRule {
  maxBytes: number;
  /** MIME prefixes ('image/', 'video/') and/or exact types ('application/pdf'). */
  accept: readonly string[];
}

const ACCEPT_LABEL: Record<string, string> = {
  'image/': 'images',
  'video/': 'vidéos',
  'application/pdf': 'PDF',
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

/**
 * Client-side gate so a 20 MB file is refused politely here instead of failing
 * against the bucket. Returns a French message, or null when the file is fine.
 */
export function validateUploadFile(file: File, rule: UploadRule): string | null {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/svg+xml') return ERR_SVG;
  const accepted = rule.accept.some((a) => (a.endsWith('/') ? type.startsWith(a) : type === a));
  if (!accepted) {
    const labels = rule.accept.map((a) => ACCEPT_LABEL[a] ?? a).join(', ');
    return `« ${file.name} » n'est pas un fichier accepté. Formats acceptés : ${labels}.`;
  }
  if (file.size > rule.maxBytes) {
    return `« ${file.name} » (${formatSize(file.size)}) dépasse la limite de ${formatSize(rule.maxBytes)}.`;
  }
  return null;
}

/** Shorthand for the image-only upload sites. */
export function validateImageFile(file: File, maxBytes = MAX_IMAGE_SOURCE_BYTES): string | null {
  return validateUploadFile(file, { maxBytes, accept: ['image/'] });
}
