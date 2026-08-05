/**
 * r2-media-janitor — reclaims unreferenced objects from the ONE WhatsApp media
 * bucket in Cloudflare R2. DELIBERATELY NARROW.
 *
 * This function deletes customer media. Every constraint below exists because the
 * audit proved a naive "unreferenced ⇒ delete" rule destroys live data, and because
 * the same R2 account also holds BACKUPS and LOGS.
 *
 * ── Why this is a separate function and not part of storage-janitor ──────────
 * storage-janitor cleans SUPABASE STORAGE. This cleans CLOUDFLARE R2. They share a
 * safety shape and nothing else:
 *   1. Different backend. storage-janitor calls the Supabase Storage JS API
 *      (`service.storage.from(bucket).list/copy/remove`). R2 has no such API here —
 *      every operation is hand-rolled SigV4 S3 XML over aws4fetch (ListObjectsV2,
 *      CopyObject, HeadObject, DeleteObjects). Zero action code is shareable.
 *   2. storage-janitor REFUSES `whatsapp-media` BY NAME, with a documented reason.
 *      Extending it to do this job would mean deleting one of its stated refusals.
 *   3. A single allow-list would conflate two different namespaces: a Supabase
 *      bucket named X and an R2 bucket named X are unrelated objects. That
 *      confusion is exactly the class of mistake that could reach a backup bucket.
 *   4. Blast radius. These R2 credentials can see the backup and log buckets.
 *      Keeping them inside one function whose bucket is a hardcoded constant is a
 *      smaller, more auditable surface than adding R2 reach to a function that
 *      already deletes Supabase objects.
 *
 * ── The structural boundary (NOT a filter in a loop) ─────────────────────────
 * BUCKET is a module constant. `objectUrl()` and `bucketUrl()` take NO bucket
 * parameter — they close over that constant. There is no code path, reachable by
 * any request body, that puts a caller-supplied string into an R2 URL. A request
 * naming any other bucket is refused before any I/O, and a MIXED request refuses
 * the WHOLE run rather than processing the allowed part.
 *
 * ── What lives in this bucket (verified against the live box) ────────────────
 *   <inst>/<conv>/<uuid>.<ext>      chat media        → messages.media_storage_key
 *   <inst>/qr/<uuid>.<ext>          quick-reply media → quick_replies.steps[].r2_key
 *   <inst>/<conv>/sm/<uuid>.<ext>   scheduled media   → scheduled_messages.steps[].r2_key
 *   <media_storage_key>.preview.jpg doc thumbnail     → REFERENCED BY NOTHING (derived)
 *   avatars/<inst>/<hex>.jpg        cached WA avatar  → 5 columns, as a FULL PUBLIC URL
 *
 * ── The three false positives that must not come back ────────────────────────
 * 1. quick_replies / scheduled_messages media. A predicate that checks only
 *    `messages` classifies every quick-reply and scheduled-message object as an
 *    orphan. quick_replies are BUSINESS-scoped and deliberately outlive the
 *    instance (admin_instance_delete_preflight excludes them on purpose), so they
 *    are not reachable from any message row.
 * 2. `.preview.jpg` doc thumbnails. No DB column ever names them — media-upload
 *    derives the key as `<media_storage_key>.preview.jpg`. They are protected BY
 *    DERIVATION from the referenced set, never by a DB lookup.
 * 3. Avatars. Stored as `https://<public-domain>/avatars/...`, not as bare keys.
 *    A normaliser that only understands bare keys silently drops 2344 live
 *    references and turns every cached avatar into an "orphan".
 *
 * ── Age floor is not the only lifecycle here ─────────────────────────────────
 * The bucket ALREADY has lifecycle rules this function must not duplicate or
 * fight: unclaimed presigned uploads are swept at 24h, and superseded avatars at
 * 365 days. This function touches no lifecycle rule, no other bucket, and no DB row.
 *
 * ── Safety net ───────────────────────────────────────────────────────────────
 * There is NO byte-level backup of this bucket. That is why the destructive step
 * is a MOVE to `_gc/<date>/`, why purge only ever touches what quarantine already
 * moved, and why `report` is the default.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s: number) =>
    new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

// ─────────────────────────────────────────────────────────────────────────────
// THE STRUCTURAL BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ONE bucket this function may ever touch. Hard-coded, not configurable, not
 * overridable by the request. Everything below closes over this constant.
 */
const BUCKET = "whatsapp-media" as const;

/**
 * Named refusals. R2 in this account also holds backups and logs; a generic
 * "unknown bucket" error invites someone to add one to an allow-list. These say why.
 */
const REFUSAL_REASON: Record<string, string> = {
    "igf-backups": "database + system BACKUPS — the disaster-recovery copy of record; never a janitor target",
    "igf-backup": "database + system BACKUPS — the disaster-recovery copy of record; never a janitor target",
    "igf-logs": "retained LOG archive; retention is owned by its lifecycle rule, not by this function",
    "igf-log": "retained LOG archive; retention is owned by its lifecycle rule, not by this function",
    "igf-db-dumps": "logical DB dumps — the restore path; deleting one is unrecoverable",
    "wamancer-media": "upstream WA-Mancer bucket; not this deployment's media store",
};

/**
 * Second, independent guard. Any requested name that merely LOOKS like backup/log/
 * dump/DB storage is refused with a specific reason even if someone later widens
 * the allow-list. Defense in depth: the allow-list is the boundary, this is the alarm.
 */
const DENY_SUBSTRINGS = ["backup", "bkp", "log", "dump", "wal", "restore", "archive", "snapshot", "db-"] as const;

/** Quarantine root. Objects under it are invisible to the orphan scan and are the ONLY purge targets. */
const GC_PREFIX = "_gc/";

const DEFAULT_MIN_AGE_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const REST_PAGE = 1000;      // PostgREST MAX_ROWS on this box is 1000 — one page is NOT everything
const LIST_PAGE = 1000;      // S3 ListObjectsV2 max-keys
const LIST_MAX_PAGES = 5000; // 5M objects. Hitting this aborts rather than scanning a partial bucket.
const DELETE_BATCH = 1000;   // S3 DeleteObjects max keys per request

// ─────────────────────────────────────────────────────────────────────────────
// R2 wiring — same mechanism the existing WhatsApp media functions use.
// (media-upload / conversation-cleanup / instance-delete all read these exact vars.)
// ─────────────────────────────────────────────────────────────────────────────

const R2_ENDPOINT = Deno.env.get("R2_MEDIA_ENDPOINT") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_MEDIA_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_MEDIA_SECRET_ACCESS_KEY") ?? "";
const R2_ENV_BUCKET = Deno.env.get("R2_MEDIA_BUCKET") ?? BUCKET;
const R2_PUBLIC_DOMAIN = Deno.env.get("R2_MEDIA_PUBLIC_DOMAIN") ?? "media.igrowfast.com";

const r2 = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
});

const endpoint = () => R2_ENDPOINT.replace(/\/+$/, "");
const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
/** Bucket-level URL (list, batch delete). Takes no bucket argument, by design. */
const bucketUrl = () => `${endpoint()}/${encodeURIComponent(BUCKET)}`;
/** Object-level URL (copy, head, get). Takes no bucket argument, by design. */
const objectUrl = (key: string) => `${bucketUrl()}/${encodeKey(key)}`;

const escapeXml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const decodeXml = (s: string) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// ─────────────────────────────────────────────────────────────────────────────
// R2 operations
// ─────────────────────────────────────────────────────────────────────────────

interface Obj { path: string; size: number; last_modified: string; age_days: number }

const ageDays = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);

/**
 * List EVERY object in the bucket via paginated ListObjectsV2.
 *
 * A truncated listing is not merely incomplete — it makes live objects look
 * missing, which breaks the reference assertion below. So exhausting the page
 * guard throws instead of returning what it managed to read.
 */
async function listAll(now: number): Promise<Obj[]> {
    const out: Obj[] = [];
    let token: string | undefined;
    for (let page = 0; page < LIST_MAX_PAGES; page++) {
        const u = new URL(bucketUrl());
        u.searchParams.set("list-type", "2");
        u.searchParams.set("max-keys", String(LIST_PAGE));
        if (token) u.searchParams.set("continuation-token", token);

        const res = await r2.fetch(u.toString());
        if (!res.ok) {
            const b = await res.text().catch(() => "");
            throw new Error(`R2 ListObjectsV2 ${res.status}: ${b.slice(0, 200)}`);
        }
        const body = await res.text();

        for (const m of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
            const block = m[1];
            const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
            if (!key) continue;
            const lm = block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? new Date(now).toISOString();
            const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
            const path = decodeXml(key);
            out.push({ path, size, last_modified: lm, age_days: ageDays(lm, now) });
        }

        const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(body);
        token = body.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
        if (!truncated || !token) return out;
    }
    throw new Error(
        `R2 listing exceeded ${LIST_MAX_PAGES} pages — refusing to act on a partial object list`,
    );
}

/** Server-side CopyObject within the bucket. */
async function copyObject(from: string, to: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const res = await r2.fetch(objectUrl(to), {
        method: "PUT",
        headers: { "x-amz-copy-source": `/${BUCKET}/${encodeKey(from)}` },
    });
    if (!res.ok) {
        const b = await res.text().catch(() => "");
        return { ok: false, error: `copy ${res.status}: ${b.slice(0, 200)}` };
    }
    // R2/S3 can return 200 with an XML <Error> body on a failed copy.
    const body = await res.text().catch(() => "");
    if (/<Error>/.test(body)) return { ok: false, error: `copy body error: ${body.slice(0, 200)}` };
    return { ok: true };
}

/** Verify the copy actually landed, at the expected byte size, BEFORE the original is removed. */
async function copyLanded(dest: string, expectedSize: number): Promise<boolean> {
    const res = await r2.fetch(objectUrl(dest), { method: "HEAD" });
    if (!res.ok) return false;
    const len = Number(res.headers.get("content-length") ?? -1);
    return expectedSize === 0 ? true : len === expectedSize;
}

/** Batch DeleteObjects — same XML shape the existing cleanup functions use. */
async function deleteBatch(keys: string[]): Promise<{ deleted: number; errors: { key: string; code: string }[] }> {
    if (keys.length === 0) return { deleted: 0, errors: [] };
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>false</Quiet>' +
        keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join("") + "</Delete>";

    const res = await r2.fetch(`${bucketUrl()}?delete`, {
        method: "POST",
        headers: { "content-type": "application/xml" },
        body: xml,
    });
    if (!res.ok) {
        const b = await res.text().catch(() => "");
        throw new Error(`R2 DeleteObjects ${res.status}: ${b.slice(0, 256)}`);
    }
    const body = await res.text();
    const deleted = (body.match(/<Deleted>/g) ?? []).length;
    const errors: { key: string; code: string }[] = [];
    for (const b of body.match(/<Error>[\s\S]*?<\/Error>/g) ?? []) {
        errors.push({
            key: decodeXml(b.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? ""),
            code: b.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "Unknown",
        });
    }
    return { deleted, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference normalisation
// ─────────────────────────────────────────────────────────────────────────────

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

type NormResult =
    | { kind: "path"; path: string; decoded: string }
    /** Not a reference to an object in this bucket (external host, data:/blob:, app-relative). */
    | { kind: "not-storage"; raw: string }
    /** Looks like one of our media URLs but the shape is unrecognised — caller must abort. */
    | { kind: "foreign"; raw: string }
    | { kind: "empty" };

/**
 * Turn a stored reference value into the object key it names inside the bucket.
 *
 * Handles every format the WhatsApp stack actually stores, and REFUSES to guess:
 *   - bare key        `<inst>/<conv>/<uuid>.jpg`   (messages, quick_replies, scheduled_messages)
 *   - public CDN URL  `https://media.igrowfast.com/avatars/...`  (the 5 avatar columns)
 *   - S3 endpoint URL `<endpoint>/<bucket>/<key>`  (what instance-wa-profile PUTs to)
 *
 * Returns BOTH raw and percent-decoded forms; a reference "resolves" if EITHER
 * exists. Ambiguity always keeps the object — over-retaining is the safe direction.
 */
function normaliseRef(raw: unknown): NormResult {
    if (typeof raw !== "string") return { kind: "empty" };
    let s = raw.trim();
    if (!s) return { kind: "empty" };

    if (/^(data|blob):/i.test(s)) return { kind: "not-storage", raw: s };

    // Drop cache-buster / render params and fragments BEFORE matching.
    s = s.split("?")[0].split("#")[0];
    if (!s) return { kind: "empty" };

    if (/^https?:\/\//i.test(s)) {
        let u: URL;
        try { u = new URL(s); } catch { return { kind: "foreign", raw: s }; }
        const path = u.pathname.replace(/^\/+/, "");

        // The R2 public custom domain serves the bucket at the path root.
        if (u.hostname.toLowerCase() === R2_PUBLIC_DOMAIN.toLowerCase()) {
            if (!path) return { kind: "foreign", raw: s };
            return { kind: "path", path, decoded: safeDecode(path) };
        }

        // The S3 API endpoint addresses this bucket path-style: <endpoint>/<bucket>/<key>.
        if (R2_ENDPOINT) {
            let ep: URL | null = null;
            try { ep = new URL(endpoint()); } catch { ep = null; }
            if (ep && u.hostname.toLowerCase() === ep.hostname.toLowerCase()) {
                const segs = path.split("/");
                const head = safeDecode(segs[0] ?? "");
                const rest = segs.slice(1).join("/");
                // Another bucket on the same endpoint — says nothing about ours.
                if (head !== BUCKET) return { kind: "not-storage", raw: s };
                if (!rest) return { kind: "foreign", raw: s };
                return { kind: "path", path: rest, decoded: safeDecode(rest) };
            }
        }

        // Any other host (WhatsApp CDN, Supabase storage, an external link).
        return { kind: "not-storage", raw: s };
    }

    // App-relative static asset — not an object in this bucket.
    if (s.startsWith("/")) return { kind: "not-storage", raw: s };

    const bare = s.replace(/^\/+/, "");
    return { kind: "path", path: bare, decoded: safeDecode(bare) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The reference model — every referencing column, verified against the live box
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bare-key sources. Each carries the bucket the key was written to, because a key
 * recorded against a DIFFERENT bucket must still be RETAINED (a same-named object
 * could exist here) but must NOT be asserted (its absence here proves nothing).
 * Live data contains exactly this case: 2 `messages` rows on `wamancer-media`.
 */
const KEY_COLUMNS = [
    {
        table: "messages",
        column: "media_storage_key",
        bucketColumn: "media_storage_bucket",
        // A row whose upload was never CONFIRMED is not a claim that bytes exist. media-upload
        // presigns a PUT and records the intended key up front; media_uploaded_at is only set once
        // the object is actually claimed. If the client abandons the upload, the bucket's own 24h
        // lifecycle rule sweeps the unclaimed object and the row keeps pointing at a key that was
        // never really there. Live data contains exactly this: 2 rows, media_uploaded_at NULL,
        // whose .mp4 the lifecycle rule removed.
        //
        // Such a key is still RETAINED (never treated as an orphan — an in-flight upload must not be
        // deleted out from under a client) but it is NOT ASSERTED, because its absence proves nothing
        // about the normaliser. This is a semantic exclusion using the system's own confirmation
        // flag, deliberately not a tolerance threshold — a threshold would also hide a genuinely
        // broken normaliser, which is the failure the assertion exists to catch.
        assertOnlyWhen: "media_uploaded_at is not null",
    },
] as const;

/** jsonb step arrays: steps[].r2_key with a sibling steps[].r2_bucket. */
const STEP_TABLES = ["quick_replies", "scheduled_messages"] as const;

/**
 * Avatar sources. These hold a FULL PUBLIC URL, not a bare key. Omitting any one of
 * them turns thousands of live cached avatars into "orphans".
 * `group_participants` is currently empty but has a live producer (the worker's
 * cacheAvatar path) — including it now is what stops the first group avatar from
 * being deleted.
 * NOT included: `whatsapp.profiles.avatar_url` — a 0-row WA-Mancer vestige with no
 * writer anywhere in this codebase (iGrowFast identity lives in public.users).
 */
const URL_COLUMNS = [
    { table: "contact_profiles", column: "profile_pic" },
    { table: "contacts", column: "profile_pic" },
    { table: "conversations", column: "peer_profile_pic" },
    { table: "group_participants", column: "profile_pic" },
    { table: "whatsapp_instances", column: "profile_pic_url" },
] as const;

/** Doc thumbnails are derived, never stored: media-upload writes `<key>.preview.jpg`. */
const PREVIEW_SUFFIX = ".preview.jpg";

interface RawRef { table: string; column: string; value: unknown; bucket: string | null; assertable?: boolean }

/** Paginate PostgREST properly — a single page silently truncates at MAX_ROWS. */
async function fetchAll(wa: any, table: string, select: string, notNull?: string): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += REST_PAGE) {
        let q = wa.from(table).select(select).range(from, from + REST_PAGE - 1);
        if (notNull) q = q.not(notNull, "is", null);
        const { data, error } = await q;
        if (error) throw new Error(`select ${table}.${select}: ${error.message}`);
        const rows = data ?? [];
        out.push(...rows);
        if (rows.length < REST_PAGE) break;
    }
    return out;
}

/** Collect every stored reference, tagged with the bucket it was recorded against. */
async function collectRefs(wa: any): Promise<RawRef[]> {
    const refs: RawRef[] = [];

    for (const c of KEY_COLUMNS) {
        // `assertOnlyWhen` names a column that confirms the bytes were actually claimed. When the
        // confirmation is absent the reference is still RETAINED (an in-flight upload must never be
        // deleted out from under a client) but it is not asserted — see the comment on KEY_COLUMNS.
        const confirmCol = "assertOnlyWhen" in c
            ? String((c as { assertOnlyWhen: string }).assertOnlyWhen).split(" ")[0]
            : null;
        const select = confirmCol
            ? `${c.column},${c.bucketColumn},${confirmCol}`
            : `${c.column},${c.bucketColumn}`;
        const rows = await fetchAll(wa, c.table, select, c.column);
        for (const r of rows) {
            refs.push({
                table: c.table,
                column: c.column,
                value: r?.[c.column],
                bucket: (r?.[c.bucketColumn] ?? null) as string | null,
                assertable: confirmCol ? r?.[confirmCol] !== null && r?.[confirmCol] !== undefined : true,
            });
        }
    }

    for (const table of STEP_TABLES) {
        const rows = await fetchAll(wa, table, "steps");
        for (const r of rows) {
            const steps = r?.steps;
            if (!Array.isArray(steps)) continue;
            for (const st of steps) {
                if (!st || typeof st !== "object") continue;
                const k = (st as Record<string, unknown>).r2_key;
                if (k === null || k === undefined || k === "") continue;
                refs.push({
                    table,
                    column: "steps[].r2_key",
                    value: k,
                    bucket: ((st as Record<string, unknown>).r2_bucket ?? null) as string | null,
                });
            }
        }
    }

    for (const c of URL_COLUMNS) {
        const rows = await fetchAll(wa, c.table, c.column, c.column);
        for (const r of rows) {
            // A URL names its own bucket via the host/path; there is no sibling column.
            refs.push({ table: c.table, column: c.column, value: r?.[c.column], bucket: null });
        }
    }

    return refs;
}

interface Unresolved { table: string; column: string; value: string; reason: string }

/**
 * Build the protected-path set AND assert every in-bucket reference resolves.
 *
 * The assertion is the load-bearing check: orphans are the COMPLEMENT of this set,
 * so a normaliser that fails to parse one format turns live objects into "orphans".
 * If anything fails to resolve, the caller ABORTS instead of trusting the complement.
 *
 * Scoping that is NOT a weakening: a reference explicitly recorded against a
 * different bucket is retained but not asserted — its absence HERE proves nothing
 * about the normaliser.
 */
function scanReferences(
    refs: RawRef[],
    existing: Set<string>,
    quarantinedOriginals: Map<string, string>,
): { protectedPaths: Set<string>; unresolved: Unresolved[] } {
    const protectedPaths = new Set<string>();
    const unresolved: Unresolved[] = [];

    const protect = (p: string) => {
        protectedPaths.add(p);
        // A referenced object's derived doc thumbnail is referenced by nothing.
        // It survives only because we protect it here, by derivation.
        protectedPaths.add(p + PREVIEW_SUFFIX);
    };

    for (const ref of refs) {
        const r = normaliseRef(ref.value);
        if (r.kind === "empty" || r.kind === "not-storage") continue;

        if (r.kind === "foreign") {
            unresolved.push({
                table: ref.table,
                column: ref.column,
                value: r.raw,
                reason: "unrecognised media URL shape — the normaliser does not understand this format",
            });
            continue;
        }

        const otherBucket = ref.bucket !== null && ref.bucket !== "" && ref.bucket !== BUCKET;

        const hitRaw = existing.has(r.path);
        const hitDec = existing.has(r.decoded);

        // Retain regardless of which bucket it was recorded against — a same-named
        // object could exist here, and over-retaining is the safe direction.
        if (hitRaw) protect(r.path);
        if (hitDec) protect(r.decoded);

        if (hitRaw || hitDec) continue;

        // Recorded against another bucket: nothing to assert.
        if (otherBucket) continue;

        // Upload never confirmed (see KEY_COLUMNS.assertOnlyWhen): the row records an INTENDED
        // key, not a claim that bytes landed. The path stays protected above — an in-flight
        // upload must never be swept — but its absence says nothing about the normaliser, so it
        // must not abort the run.
        if (ref.assertable === false) {
            protect(r.path);
            continue;
        }

        // Resolving INTO quarantine is a different, louder alarm than a bad
        // normaliser: it means a previous run moved something still referenced.
        const gc = quarantinedOriginals.get(r.path) ?? quarantinedOriginals.get(r.decoded);
        if (gc) {
            unresolved.push({
                table: ref.table,
                column: ref.column,
                value: String(ref.value),
                reason: `referenced object is IN QUARANTINE at "${gc}" — restore it (copy back) before running again`,
            });
            continue;
        }

        unresolved.push({
            table: ref.table,
            column: ref.column,
            value: String(ref.value),
            reason: `normalised to "${r.path}" which does not exist in the bucket`,
        });
    }

    return { protectedPaths, unresolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quarantine / purge
// ─────────────────────────────────────────────────────────────────────────────

const QUARANTINE_DATE = /^_gc\/(\d{4}-\d{2}-\d{2})\//;

/** Quarantine age from the PATH date — the explicit contract. Unparseable ⇒ never purged. */
function quarantineAgeDays(path: string, now: number): number | null {
    const m = QUARANTINE_DATE.exec(path);
    if (!m) return null;
    const t = Date.parse(`${m[1]}T00:00:00Z`);
    if (Number.isNaN(t)) return null;
    return Math.floor((now - t) / 86_400_000);
}

/** MOVE an orphan under `_gc/<date>/`. Copy → verify → delete, in that order. */
async function quarantine(objs: Obj[], day: string) {
    const moved: Array<{ from: string; to: string; size: number }> = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const o of objs) {
        const dest = `${GC_PREFIX}${day}/${o.path}`;
        try {
            const cp = await copyObject(o.path, dest);
            if (!cp.ok) { failed.push({ path: o.path, error: cp.error }); continue; }
            if (!await copyLanded(dest, o.size)) {
                failed.push({ path: o.path, error: "copy not verified — original left in place" });
                continue;
            }
            const del = await deleteBatch([o.path]);
            if (del.errors.length) {
                failed.push({ path: o.path, error: `remove after verified copy: ${del.errors[0].code}` });
                continue;
            }
            moved.push({ from: o.path, to: dest, size: o.size });
        } catch (e) {
            failed.push({ path: o.path, error: (e as Error).message });
        }
    }
    return { moved, failed };
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "missing_env" }, 500);

    // Service-role gated. This function deletes media; a valid end-user JWT (all the
    // router's global VERIFY_JWT proves) is NOT sufficient. Not in PUBLIC_FUNCTIONS.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    if (!bearer || bearer.length !== SERVICE_KEY.length || bearer !== SERVICE_KEY) {
        return json({ ok: false, error: "forbidden", detail: "service role key required" }, 403);
    }

    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return json({
            ok: false,
            error: "missing_r2_env",
            detail: "R2_MEDIA_ENDPOINT, R2_MEDIA_ACCESS_KEY_ID and R2_MEDIA_SECRET_ACCESS_KEY must be set " +
                "on the edge-functions container (the same vars media-upload / conversation-cleanup use)",
        }, 500);
    }

    // If the deployment's media bucket is not the one hard-coded here, this
    // function's entire premise is wrong. Refuse rather than clean the wrong bucket.
    if (R2_ENV_BUCKET !== BUCKET) {
        return json({
            ok: false,
            error: "bucket_mismatch",
            detail: `R2_MEDIA_BUCKET is "${R2_ENV_BUCKET}" but this janitor is hard-coded to "${BUCKET}". ` +
                "Refusing: the media store is not where this function believes it is.",
        }, 500);
    }

    const body = await req.json().catch(() => ({} as any));

    // Default is `report`. Deleting must require asking for it explicitly.
    const mode = body?.mode === undefined || body?.mode === null ? "report" : String(body.mode);
    if (!["report", "quarantine", "purge"].includes(mode)) {
        return json({ ok: false, error: "bad_mode", detail: `mode must be report|quarantine|purge, got "${mode}"` }, 400);
    }

    const minAgeDays = body?.min_age_days === undefined || body?.min_age_days === null
        ? DEFAULT_MIN_AGE_DAYS
        : Number(body.min_age_days);
    if (!Number.isFinite(minAgeDays) || minAgeDays < 0) {
        return json({ ok: false, error: "bad_min_age_days" }, 400);
    }

    const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(body?.limit === undefined || body?.limit === null ? DEFAULT_LIMIT : body.limit) || DEFAULT_LIMIT),
    );

    // ── Allow-list enforcement. Refuse by name; a mixed request refuses WHOLLY. ──
    if (body?.buckets !== undefined && body?.buckets !== null) {
        if (!Array.isArray(body.buckets) || body.buckets.length === 0) {
            return json({ ok: false, error: "bad_buckets", detail: "buckets must be a non-empty array" }, 400);
        }
        const requested = body.buckets.map((b: unknown) => String(b));
        const refused = requested
            .filter((b: string) => b !== BUCKET)
            .map((b: string) => {
                const lower = b.toLowerCase();
                const danger = DENY_SUBSTRINGS.find((d) => lower.includes(d));
                return {
                    bucket: b,
                    reason: REFUSAL_REASON[lower] ??
                        (danger
                            ? `name matches "${danger}" — backup/log/dump storage is categorically out of scope for a janitor`
                            : "not the WhatsApp media bucket; this janitor owns exactly one bucket"),
                };
            });
        if (refused.length) {
            // Refuse the WHOLE run — not just the offending entries. A request that
            // mixes this bucket with a backup bucket is a mistake, not a partial job.
            return json({
                ok: false,
                error: "bucket_not_allowed",
                detail: `r2-media-janitor may only process "${BUCKET}". The whole run is refused because ` +
                    `it named: ${refused.map((r: { bucket: string; reason: string }) => `${r.bucket} (${r.reason})`).join("; ")}`,
                refused,
                allowed: [BUCKET],
            }, 400);
        }
    }

    const wa = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        db: { schema: "whatsapp" },
    });

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    try {
        // ── 1. Inventory ──────────────────────────────────────────────────────
        const all = await listAll(now);
        const live = all.filter((o) => !o.path.startsWith(GC_PREFIX));
        const gc = all.filter((o) => o.path.startsWith(GC_PREFIX));

        // original key → its quarantined path, so a reference resolving into
        // quarantine reports where to restore it from.
        const quarantinedOriginals = new Map<string, string>();
        for (const o of gc) {
            const m = QUARANTINE_DATE.exec(o.path);
            if (!m) continue;
            quarantinedOriginals.set(o.path.slice(`${GC_PREFIX}${m[1]}/`.length), o.path);
        }

        const gcEligible = gc.filter((o) => {
            const a = quarantineAgeDays(o.path, now);
            return a !== null && a >= minAgeDays;
        });
        const quarantineSummary = {
            objects: gc.length,
            bytes: gc.reduce((s, o) => s + o.size, 0),
            purge_eligible: gcEligible.length,
            purge_eligible_bytes: gcEligible.reduce((s, o) => s + o.size, 0),
        };

        // ── 2. References + assertion. Runs in EVERY mode, including purge: a
        //       reference that now resolves into quarantine must stop the purge. ──
        const existing = new Set(live.map((o) => o.path));
        const refs = await collectRefs(wa);
        const { protectedPaths, unresolved } = scanReferences(refs, existing, quarantinedOriginals);

        const base = {
            ok: true as const,
            bucket: BUCKET,
            mode,
            min_age_days: minAgeDays,
            limit,
            generated_at: new Date(now).toISOString(),
            total_objects: live.length,
            total_bytes: live.reduce((s, o) => s + o.size, 0),
            references_scanned: refs.length,
            quarantine: quarantineSummary,
        };

        if (unresolved.length) {
            // ok:false + a non-2xx status on purpose. An abort means the run did NOT
            // do what was asked and a human must look; a scheduled caller that checks
            // only `ok` (or only the HTTP status) must not sail past it silently.
            const out = {
                ...base,
                ok: false,
                error: "unresolved_references",
                aborted: true,
                abort_reason:
                    "a stored reference did not resolve to an existing object. The orphan set is the " +
                    "COMPLEMENT of the reference set, so an unresolved reference means the normaliser " +
                    "(or a prior quarantine) cannot be trusted. NOTHING was touched.",
                unresolved_count: unresolved.length,
                unresolved_references: unresolved.slice(0, 100),
            };
            console.error(`r2-media-janitor: ABORT — ${unresolved.length} unresolved reference(s)`);
            return json(out, 409);
        }

        // ── 3. purge: only ever touches what quarantine already moved ──────────
        if (mode === "purge") {
            const batch = gcEligible.slice(0, limit);
            // Belt and braces: nothing outside _gc/ may reach a delete, ever.
            const paths = batch.map((o) => o.path).filter((p) => p.startsWith(GC_PREFIX));
            if (paths.length !== batch.length) {
                return json({ ok: false, error: "purge_guard_tripped", detail: "non-_gc path reached the purge batch" }, 500);
            }
            let purged = 0;
            const failed: { key: string; code: string }[] = [];
            for (let i = 0; i < paths.length; i += DELETE_BATCH) {
                const slice = paths.slice(i, i + DELETE_BATCH);
                const r = await deleteBatch(slice);
                purged += r.deleted;
                failed.push(...r.errors);
            }
            return json({
                ...base,
                aborted: false,
                truncated: gcEligible.length > batch.length,
                purged,
                purged_bytes: batch.reduce((s, o) => s + o.size, 0),
                failed,
                objects: batch.map((o) => ({
                    path: o.path,
                    size: o.size,
                    quarantined_days_ago: quarantineAgeDays(o.path, now),
                    action: failed.length ? "purge_failed" : "purged",
                })),
            }, 200);
        }

        // ── 4. Orphans = complement of the protected set ───────────────────────
        const orphans = live.filter((o) => !protectedPaths.has(o.path));
        const oldEnough = orphans.filter((o) => o.age_days >= minAgeDays);
        // Deterministic order so a capped run is reproducible.
        oldEnough.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        const batch = oldEnough.slice(0, limit);

        const actions = mode === "quarantine" ? await quarantine(batch, today) : null;
        const movedSet = new Set(actions?.moved.map((m) => m.from) ?? []);
        const referencedCount = live.length - orphans.length;

        return json({
            ...base,
            aborted: false,
            referenced: referencedCount,
            referenced_bytes: live.filter((o) => protectedPaths.has(o.path)).reduce((s, o) => s + o.size, 0),
            orphaned: orphans.length,
            orphaned_bytes: orphans.reduce((s, o) => s + o.size, 0),
            orphaned_old_enough: oldEnough.length,
            orphaned_old_enough_bytes: oldEnough.reduce((s, o) => s + o.size, 0),
            skipped_too_new: orphans.length - oldEnough.length,
            truncated: oldEnough.length > batch.length,
            unresolved_references: [] as Unresolved[], // always [] here; shape stays stable
            actions,
            objects: batch.map((o) => ({
                path: o.path,
                size: o.size,
                age_days: o.age_days,
                action: mode === "quarantine"
                    ? (movedSet.has(o.path) ? "quarantined" : "quarantine_failed")
                    : "would_quarantine",
            })),
        }, 200);
    } catch (e) {
        console.error("r2-media-janitor failed:", (e as Error).message);
        return json({ ok: false, error: "scan_failed", detail: (e as Error).message }, 500);
    }
});
