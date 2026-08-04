/**
 * Delete the image a product/accessory just REPLACED.
 *
 * WHY: uploads write a new randomly-named object and the row is repointed at it,
 * but the old object was never removed — so every edit leaked one file forever.
 * That is the ongoing accumulation behind the storage growth. Deleting on replace
 * is EXACT (we know precisely which object was superseded), unlike the janitor's
 * inferred orphan scan, so it belongs here at the source.
 *
 * Both `products` and `accessories` store their images in the SAME `products`
 * bucket (accessories under an `acc_` filename prefix), which is why the
 * still-referenced check below has to look at both tables.
 *
 * Guards, all deliberate:
 *  - Only ever touches an object in the `products` bucket. A value that is not a
 *    storage URL for that bucket (data:, blob:, app-relative asset, external host)
 *    is left alone.
 *  - Only runs when the NEW value is itself a `products` object AND the path
 *    actually changed. If the upload failed, `image_url` still holds the old URL,
 *    so old === new and nothing is deleted.
 *  - Skips deletion when any other row still references the path — the same image
 *    can legitimately be reused across rows.
 *  - Never throws. The row update has already succeeded by the time this runs; a
 *    storage hiccup must not be reported to the user as a failed save.
 */
import { supabase } from '@/lib/supabase';

const BUCKET = 'products';

const OBJECT_URL = new RegExp(
    `/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/${BUCKET}/(.+)$`,
);

/** The object path inside the `products` bucket, or null when the value does not name one. */
function toObjectPath(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw || /^(data|blob):/i.test(raw)) return null;
    const m = OBJECT_URL.exec(raw.split('?')[0].split('#')[0]);
    if (!m) return null;
    const path = m[1].replace(/^\/+/, '');
    return path || null;
}

/** True when any product/accessory row still points at this object path. */
async function stillReferenced(path: string): Promise<boolean> {
    // `%${path}%` tolerates the `?v=` cache-buster some rows carry. `_` in a path
    // (e.g. `acc_…`) acts as a LIKE wildcard here, which can only MATCH MORE rows —
    // i.e. err towards keeping the file, which is the safe direction.
    const pattern = `%${path}%`;
    for (const table of ['products', 'accessories'] as const) {
        const { data, error } = await supabase
            .from(table)
            .select('id')
            .ilike('image_url', pattern)
            .limit(1);
        // A failed check is NOT evidence of absence — treat it as "still referenced".
        if (error) return true;
        if ((data?.length ?? 0) > 0) return true;
    }
    return false;
}

/**
 * Remove the superseded image. Call AFTER the row update has succeeded.
 *
 * @param previous the row's image_url before the edit
 * @param next     the image_url just written to the row
 */
export async function cleanupReplacedProductImage(
    previous: string | null | undefined,
    next: string | null | undefined,
): Promise<void> {
    try {
        const oldPath = toObjectPath(previous);
        if (!oldPath) return;

        // Require a real NEW object: this is a replace, not a clear, and not a
        // save whose upload failed (in which case image_url is unchanged).
        const newPath = toObjectPath(next);
        if (!newPath || newPath === oldPath) return;

        if (await stillReferenced(oldPath)) return;

        const { error } = await supabase.storage.from(BUCKET).remove([oldPath]);
        if (error) console.warn('[image cleanup] could not remove', oldPath, error.message);
    } catch (e) {
        console.warn('[image cleanup] skipped:', (e as Error)?.message);
    }
}

export default cleanupReplacedProductImage;
