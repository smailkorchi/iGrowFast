/**
 * Delivery-side image sizing — ONE place that turns a stored image value into a
 * URL sized for the box it is rendered in.
 *
 * WHY: Supabase Storage serves the ORIGINAL bytes from
 * `/storage/v1/object/public/<bucket>/<path>`. The self-host box has the image
 * renderer enabled, so the same object can be served resized (and auto-WebP when
 * the browser sends `Accept: image/webp`) from
 * `/storage/v1/render/image/public/<bucket>/<path>?width=&height=&resize=&quality=`.
 * Measured on production 2026-08-03: the 18,924,584-byte avatar PNG comes back as
 * 1,198 bytes at `width=128&height=128&resize=cover&quality=70`.
 *
 * This module is DELIVERY ONLY. It never touches uploads and never mutates a
 * stored value — it rewrites the URL at render time.
 *
 * ── What it accepts (surveyed against the live box) ──────────────────────────
 * Every PUBLIC image column stores a FULL public URL
 * (`users.avatar_url`, `products.image_url`, `accessories.image_url`,
 * `businesses.logo`, `campaigns.media[].url`), sometimes with a `?v=<ts>`
 * cache-bust appended (see `saveOwnAvatar` in src/lib/profile.ts) — that query is
 * preserved, the renderer tolerates unknown params. Values that are NOT storage
 * URLs also flow through these call sites and are returned UNCHANGED:
 *   - app-relative static assets: `/providers/Coliaty.png`, `/Logo/....png`
 *     (preset provider logos, see src/lib/providerLogos.ts)
 *   - `data:` URIs (frozen document snapshots) and `blob:` object URLs (local
 *     upload previews)
 *   - signed/private URLs (`/object/sign/`, `/object/authenticated/`) — those go
 *     through resolveStampUrl instead
 *   - any external absolute URL, empty string, null, undefined
 *
 * ── When it declines to transform (documented rule) ──────────────────────────
 * 1. Not a public storage object URL → pass through (nothing to rewrite).
 * 2. Already a `/render/image/` URL → pass through (idempotent).
 * 3. `.svg` (vector — rasterising throws away the only thing an SVG is good for),
 *    `.gif` (the renderer drops the animation), and video extensions (the image
 *    renderer cannot serve them; `campaign-media` holds video).
 * 4. Preset LARGER than the source: NOT a special case — the renderer does not
 *    enlarge. Measured on production: a 225x225 source requested at `width=1200`
 *    returned 4,020 bytes, byte-identical to the same object at `width=400`, vs
 *    4,061 bytes for the original PNG. So an oversized preset degrades to "same
 *    pixels, WebP-encoded" and never to an upscale penalty. The residual risk is
 *    that re-encoding an already-tiny image can cost a few hundred bytes; that is
 *    bounded and irrelevant next to the 18.9 MB → 1.2 KB case this exists for.
 *
 * Pure and synchronous — safe to call inline in JSX. Never throws.
 */

const OBJECT_SEGMENT = '/storage/v1/object/public/';
const RENDER_SEGMENT = '/storage/v1/render/image/public/';

/** Extensions the image renderer must not be asked for. */
const NO_TRANSFORM_EXT = /\.(svg|gif|mp4|mov|webm|m4v|avi|mkv)$/i;

export type ImagePreset =
    | 'avatarSm'
    | 'avatarMd'
    | 'avatarLg'
    | 'thumb'
    | 'card'
    | 'logo'
    | 'full';

interface PresetSpec {
    width: number;
    /** Omitted = bound the width only, let the height follow the aspect ratio. */
    height?: number;
    /** `cover` fills (and crops to) the box — only for SQUARE containers that already use `object-cover`. */
    resize: 'cover' | 'contain';
    quality: number;
}

/**
 * Presets are named after the DISPLAY slot, not the pixel count, and are sized
 * for a 2x screen (a 32px row thumb and a 100px card thumb share `thumb`).
 *
 * GEOMETRY RULE — why some presets crop and some do not:
 * a `cover` preset crops server-side, which is only free when the CSS slot is
 * SQUARE and already `object-cover` (the two crops are then identical). In a
 * non-square slot the server crop would stack on top of the CSS crop and zoom
 * the image in. So `cover` presets are reserved for square slots (avatars, row
 * thumbs), while `card`/`full` bound the WIDTH only and let the CSS do the
 * framing exactly as it does today.
 */
const PRESETS: Record<ImagePreset, PresetSpec> = {
    avatarSm: { width: 64, height: 64, resize: 'cover', quality: 70 },
    avatarMd: { width: 128, height: 128, resize: 'cover', quality: 70 },
    avatarLg: { width: 256, height: 256, resize: 'cover', quality: 75 },
    thumb: { width: 200, height: 200, resize: 'cover', quality: 70 },
    card: { width: 400, resize: 'contain', quality: 75 },
    /** Business logos: small box, `object-contain`, never cropped. */
    logo: { width: 200, height: 200, resize: 'contain', quality: 75 },
    full: { width: 1200, resize: 'contain', quality: 80 },
};

interface ImageUrlOptions {
    /**
     * Bucket to resolve a BARE storage path against (e.g. `products` for
     * `folder/file.jpg`). Without it a bare path is passed through untouched —
     * guessing a bucket would produce 404s.
     */
    bucket?: string;
}

function buildRenderUrl(objectUrl: string, spec: PresetSpec): string {
    const q = objectUrl.indexOf('?');
    const base = q === -1 ? objectUrl : objectUrl.slice(0, q);
    const params = new URLSearchParams(q === -1 ? '' : objectUrl.slice(q + 1));
    params.set('width', String(spec.width));
    if (spec.height) params.set('height', String(spec.height));
    params.set('resize', spec.resize);
    params.set('quality', String(spec.quality));
    return `${base.replace(OBJECT_SEGMENT, RENDER_SEGMENT)}?${params.toString()}`;
}

/**
 * Size a stored image value for the slot it renders in.
 *
 * @param value  Whatever the column/JSON holds — full public URL, bare storage
 *               path (with `opts.bucket`), data:/blob:/relative/external URL,
 *               empty, null or undefined.
 * @param preset Display slot. See PRESETS.
 * @returns The transformed URL, or `value` unchanged when transforming does not
 *          apply. Nullish input comes back nullish (never the string "undefined").
 */
export function imageUrl(
    value: string | null | undefined,
    preset: ImagePreset,
    opts?: ImageUrlOptions,
): string | null | undefined {
    if (typeof value !== 'string') return value;
    const raw = value.trim();
    if (!raw) return value;
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return value;

    const spec = PRESETS[preset];
    if (!spec) return value;

    // Bare storage path + explicit bucket → build the public object URL first.
    let objectUrl = raw;
    if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) {
        const base = (import.meta.env?.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
        if (!opts?.bucket || !base) return value;
        objectUrl = `${base}${OBJECT_SEGMENT}${opts.bucket}/${raw.replace(/^\/+/, '')}`;
    }

    if (objectUrl.includes(RENDER_SEGMENT)) return value; // already transformed
    if (!objectUrl.includes(OBJECT_SEGMENT)) return value; // static asset, signed URL, external host

    const path = objectUrl.split('?')[0];
    if (NO_TRANSFORM_EXT.test(path)) return value;

    return buildRenderUrl(objectUrl, spec);
}

export default imageUrl;
