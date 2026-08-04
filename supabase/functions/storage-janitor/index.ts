/**
 * storage-janitor — reclaims unreferenced storage objects. DELIBERATELY NARROW.
 *
 * This function deletes customer files. Every constraint below exists because the
 * storage audit proved a naive "unreferenced ⇒ delete" rule destroys live data.
 * Do not widen the allow-list, do not relax the age floor, do not drop the
 * reference-resolution assertion.
 *
 * ── Why only two buckets ─────────────────────────────────────────────────────
 * 92 of 261 objects are unreferenced by any database column. Only 45 of them have
 * a defensible deletion case: `products` (36) and `business-logos` (9). The other
 * 47 are unreferenced for reasons that make deletion WRONG:
 *   - documents      → referenced only by HARDCODED FRONTEND CONSTANTS (and
 *                      URL-encoded there: "Orders%20Model.xlsx" vs the object's
 *                      "Orders Model.xlsx"). Deleting breaks three import pages.
 *   - payment-proofs → financial evidence whose DB rows are already gone.
 *   - business-stamps→ legal-document stamps; the referencing slot
 *                      (snapshot_json.stamps) exists and merely happens to be null.
 *   - demand-media   → belongs to a deleted support ticket.
 *   - avatar         → strict and loose reference rules disagree; superseded
 *                      avatars are better fixed at the upload site.
 * Those buckets are REFUSED by name, structurally, below — not by an `if` in a loop.
 *
 * ── The false positive that must not come back ───────────────────────────────
 * `public.storage_legacy_flat_path()` is NOT an orphan test. `products/2ig1xvocrr4.png`
 * sits on a legacy flat path (no tenant folder) AND is referenced by a live product
 * row — verified against production. Nothing here treats path SHAPE as evidence;
 * the only evidence is whether a reference normalises to the object's exact name.
 *
 * ── Reference formats are not uniform ────────────────────────────────────────
 * Full public URL (sometimes with a `?v=` cache-buster), bare path, URL-encoded,
 * data:/blob: URIs, signed URLs, and app-relative static assets
 * (providers.logo_url = "/providers/Coliaty.png" — not a storage object at all).
 * normaliseRef() handles each explicitly and REFUSES to guess.
 *
 * ── Safety net ───────────────────────────────────────────────────────────────
 * /usr/local/bin/igf-storage-mirror.sh rclone-mirrors the bucket to R2 nightly with
 * a 45-day archive, so deleted BYTES are recoverable for 45 days. The
 * `storage.objects` ROW is not. That is why quarantine (a move) is the default
 * destructive step and purge only ever touches what quarantine already moved.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
 * The ONLY buckets this function may ever touch. Hard-coded, not configurable,
 * not overridable by the request. A bucket absent from this list is refused with
 * an error naming it — there is no code path that reaches a delete for one.
 */
const ALLOWED_BUCKETS = Object.freeze(["products", "business-logos"] as const);
type AllowedBucket = typeof ALLOWED_BUCKETS[number];

/**
 * Named refusals. These exist so the error tells a human WHY, instead of a generic
 * "unknown bucket" that invites someone to add it to the allow-list.
 */
const REFUSAL_REASON: Record<string, string> = {
    "payment-proofs": "financial evidence; DB rows already deleted, objects are the only record",
    "business-documents": "customer-uploaded legal documents; no audited orphan rule exists",
    "business-stamps": "legal-document stamps; snapshot_json.stamps slot exists and is merely null today",
    "documents": "referenced only by hardcoded (URL-encoded) frontend constants; deleting breaks import pages",
    "demand-media": "belongs to a deleted support ticket; not proven safe",
    "whatsapp-media": "conversation media; lifecycle is owned by conversation-cleanup, not this function",
    "avatar": "strict and loose reference rules disagree; fix superseded avatars at the upload site",
    "campaign-media": "no audited orphan rule exists",
    "providers-logos": "preset logos are app-relative static assets, not storage references",
};

/** Quarantine root. Objects under it are invisible to the orphan scan and are the ONLY purge targets. */
const GC_PREFIX = "_gc/";

const DEFAULT_MIN_AGE_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PAGE = 1000;          // storage list page size
const REST_PAGE = 1000;     // PostgREST MAX_ROWS on this box is 1000 — never assume one page is everything

// ─────────────────────────────────────────────────────────────────────────────
// Reference normalisation
// ─────────────────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function safeDecode(s: string): string {
    try { return decodeURIComponent(s); } catch { return s; }
}

type NormResult =
    | { kind: "path"; path: string; decoded: string }
    /** Not a reference to a storage object at all (data:/blob:/app-relative/external). */
    | { kind: "not-storage"; raw: string }
    /** Looks like a storage URL but not for this bucket — the assumption is wrong; caller must abort. */
    | { kind: "foreign"; raw: string }
    | { kind: "empty" };

/**
 * Turn a stored reference value into the object path it names inside `bucket`.
 *
 * Returns BOTH the raw and percent-decoded forms because object names may contain
 * a literal `%`; a reference "resolves" if EITHER form exists. Over-retaining is
 * the safe direction, so ambiguity always keeps the object.
 */
function normaliseRef(raw: unknown, bucket: string): NormResult {
    if (typeof raw !== "string") return { kind: "empty" };
    let s = raw.trim();
    if (!s) return { kind: "empty" };

    // Frozen snapshots embed data: URIs; upload previews are blob:. Neither names an object.
    if (/^(data|blob):/i.test(s)) return { kind: "not-storage", raw: s };

    // Strip the `?v=` cache-buster / render params and any fragment BEFORE matching.
    s = s.split("?")[0].split("#")[0];

    // Full storage URL — public, signed, authenticated, or the image-render variant.
    const mine = new RegExp(
        `/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/${escapeRe(bucket)}/(.+)$`,
    ).exec(s);
    if (mine) {
        const path = mine[1].replace(/^\/+/, "");
        return { kind: "path", path, decoded: safeDecode(path) };
    }

    // A storage URL for a DIFFERENT bucket means our prefix assumption is wrong.
    // Surface it and let the caller abort rather than silently treating it as "no reference".
    if (/\/storage\/v1\/(?:object|render\/image)\//.test(s)) return { kind: "foreign", raw: s };

    // External host that is not this storage API.
    if (/^https?:\/\//i.test(s)) return { kind: "not-storage", raw: s };

    // App-relative static asset, e.g. providers.logo_url = "/providers/Coliaty.png".
    if (s.startsWith("/")) return { kind: "not-storage", raw: s };

    // Bare storage path (cachet_url / signature_url / media[].path style).
    const bare = s.replace(/^\/+/, "");
    return { kind: "path", path: bare, decoded: safeDecode(bare) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage listing
// ─────────────────────────────────────────────────────────────────────────────

interface Obj { path: string; size: number; created_at: string; age_days: number }

const ageDays = (iso: string, now: number) =>
    Math.floor((now - new Date(iso).getTime()) / 86_400_000);

/**
 * Recursively list every object in a bucket. The storage API lists ONE level at a
 * time (a folder entry has `id === null`), and objects live at both `<biz>/<file>`
 * and legacy flat `<file>`, so a flat list would miss most of the bucket.
 */
async function listAll(service: any, bucket: string, prefix = "", depth = 0): Promise<Obj[]> {
    if (depth > 8) return [];
    const now = Date.now();
    const out: Obj[] = [];
    for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await service.storage.from(bucket).list(prefix, {
            limit: PAGE, offset, sortBy: { column: "name", order: "asc" },
        });
        if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
        const rows = data ?? [];
        for (const e of rows) {
            const full = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.id === null || e.id === undefined) {
                out.push(...await listAll(service, bucket, full, depth + 1));
            } else {
                const created = e.created_at ?? e.updated_at ?? new Date(now).toISOString();
                out.push({
                    path: full,
                    size: Number(e.metadata?.size ?? 0),
                    created_at: created,
                    age_days: ageDays(created, now),
                });
            }
        }
        if (rows.length < PAGE) break;
    }
    return out;
}

/** Paginate PostgREST properly — a single page silently truncates at MAX_ROWS (1000). */
async function fetchAllRows(service: any, table: string, column: string): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += REST_PAGE) {
        const { data, error } = await service.from(table).select(column).range(from, from + REST_PAGE - 1);
        if (error) throw new Error(`select ${table}.${column}: ${error.message}`);
        const rows = data ?? [];
        out.push(...rows);
        if (rows.length < REST_PAGE) break;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orphan rules — one per bucket, exactly as audited
// ─────────────────────────────────────────────────────────────────────────────

/** Columns whose references MUST resolve to a live object. This is the assertion set. */
const REFERENCE_COLUMNS: Record<AllowedBucket, Array<{ table: string; column: string }>> = {
    // The products bucket is referenced by TWO tables. Checking only `products`
    // would classify every accessory image (acc_* under the same tenant folders)
    // as an orphan and delete it.
    "products": [
        { table: "products", column: "image_url" },
        { table: "accessories", column: "image_url" },
    ],
    "business-logos": [
        { table: "businesses", column: "logo" },
    ],
};

/**
 * Frozen documents embed the logo URL inside snapshot_json, so a
 * `businesses.logo`-only predicate would delete a logo a frozen quote still renders.
 * These are searched as TEXT (substring), not enumerated as references — see
 * assertReferencesResolve() for why they are excluded from the assertion.
 */
const SNAPSHOT_TABLES = ["devis", "factures", "bons_commande", "bons_livraison"] as const;

interface RefScan { referenced: Set<string>; unresolved: Array<{ table: string; column: string; value: string; reason: string }> }

/**
 * Build the referenced-path set AND assert every reference resolves to an existing object.
 *
 * The assertion is the load-bearing safety check: orphans are computed as the
 * COMPLEMENT of this set, so a normaliser that fails to parse a reference format
 * turns live objects into "orphans". If any reference does not resolve, the caller
 * ABORTS the bucket instead of trusting the complement.
 */
function scanReferences(
    rows: Array<{ table: string; column: string; values: unknown[] }>,
    bucket: string,
    existing: Set<string>,
): RefScan {
    const referenced = new Set<string>();
    const unresolved: RefScan["unresolved"] = [];

    for (const { table, column, values } of rows) {
        for (const raw of values) {
            const r = normaliseRef(raw, bucket);
            if (r.kind === "empty" || r.kind === "not-storage") continue;
            if (r.kind === "foreign") {
                unresolved.push({ table, column, value: r.raw, reason: "storage URL for a different bucket" });
                continue;
            }
            const hitRaw = existing.has(r.path);
            const hitDec = existing.has(r.decoded);
            if (!hitRaw && !hitDec) {
                unresolved.push({ table, column, value: String(raw), reason: `normalised to "${r.path}" which does not exist` });
                continue;
            }
            // Retain BOTH forms — the object set is matched by exact name and a
            // percent-encoded reference must not leave the decoded object exposed.
            if (hitRaw) referenced.add(r.path);
            if (hitDec) referenced.add(r.decoded);
        }
    }
    return { referenced, unresolved };
}

/**
 * Remove any candidate whose path appears inside a frozen snapshot_json.
 *
 * Substring search, checked against both the raw and percent-encoded path. This can
 * only ever RETAIN more than a strict match would (a suffix collision keeps a file
 * that might have been deletable) — the safe direction for a deleter.
 *
 * Snapshot references are deliberately NOT part of the resolution assertion: a
 * frozen document is a historical record and may legitimately embed a path that no
 * longer exists (production has exactly this — a devis embeds
 * "business-logos/profile/<biz>/logo-1776303201156.jpg", a pre-tenant-scoping path
 * that no longer resolves). Asserting on it would abort the bucket forever.
 */
async function excludeSnapshotReferenced(
    service: any,
    candidates: Obj[],
): Promise<{ kept: Obj[]; protectedBySnapshot: string[] }> {
    if (candidates.length === 0) return { kept: [], protectedBySnapshot: [] };
    const hit = new Set<string>();

    for (const table of SNAPSHOT_TABLES) {
        for (let from = 0; ; from += REST_PAGE) {
            const { data, error } = await service.from(table).select("snapshot_json").range(from, from + REST_PAGE - 1);
            if (error) throw new Error(`select ${table}.snapshot_json: ${error.message}`);
            const rows = data ?? [];
            for (const row of rows) {
                if (row?.snapshot_json === null || row?.snapshot_json === undefined) continue;
                const text = typeof row.snapshot_json === "string" ? row.snapshot_json : JSON.stringify(row.snapshot_json);
                for (const c of candidates) {
                    if (hit.has(c.path)) continue;
                    if (text.includes(c.path) || text.includes(encodeURI(c.path))) hit.add(c.path);
                }
            }
            if (rows.length < REST_PAGE) break;
        }
    }
    return { kept: candidates.filter((c) => !hit.has(c.path)), protectedBySnapshot: [...hit] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

/** Verify the copy landed with the same byte size before the original is removed. */
async function copyLanded(service: any, bucket: string, dest: string, expectedSize: number): Promise<boolean> {
    const slash = dest.lastIndexOf("/");
    const dir = slash === -1 ? "" : dest.slice(0, slash);
    const base = slash === -1 ? dest : dest.slice(slash + 1);
    const { data, error } = await service.storage.from(bucket).list(dir, { limit: 100, search: base });
    if (error || !data) return false;
    const found = data.find((e: any) => e.name === base && e.id);
    if (!found) return false;
    const size = Number(found.metadata?.size ?? -1);
    return expectedSize === 0 ? true : size === expectedSize;
}

/** MOVE an orphan under `_gc/<date>/`. Copy → verify → delete, in that order. Nothing is destroyed. */
async function quarantine(service: any, bucket: string, objs: Obj[], day: string) {
    const moved: Array<{ from: string; to: string; size: number }> = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const o of objs) {
        const dest = `${GC_PREFIX}${day}/${o.path}`;
        try {
            const { error: cpErr } = await service.storage.from(bucket).copy(o.path, dest);
            if (cpErr) { failed.push({ path: o.path, error: `copy: ${cpErr.message}` }); continue; }
            if (!await copyLanded(service, bucket, dest, o.size)) {
                failed.push({ path: o.path, error: "copy not verified — original left in place" });
                continue;
            }
            const { error: rmErr } = await service.storage.from(bucket).remove([o.path]);
            if (rmErr) { failed.push({ path: o.path, error: `remove after verified copy: ${rmErr.message}` }); continue; }
            moved.push({ from: o.path, to: dest, size: o.size });
        } catch (e) {
            failed.push({ path: o.path, error: (e as Error).message });
        }
    }
    return { moved, failed };
}

const QUARANTINE_DATE = /^_gc\/(\d{4}-\d{2}-\d{2})\//;

/** Quarantine age from the PATH date — the explicit contract. Unparseable ⇒ never purged. */
function quarantineAgeDays(path: string, now: number): number | null {
    const m = QUARANTINE_DATE.exec(path);
    if (!m) return null;
    const t = Date.parse(`${m[1]}T00:00:00Z`);
    if (Number.isNaN(t)) return null;
    return Math.floor((now - t) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "missing_env" }, 500);

    // Service-role gated. This function deletes files; a valid end-user JWT (which is
    // all the router's global VERIFY_JWT proves) is NOT sufficient.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    if (!bearer || bearer.length !== SERVICE_KEY.length || bearer !== SERVICE_KEY) {
        return json({ ok: false, error: "forbidden", detail: "service role key required" }, 403);
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
        Math.max(1, Number(
            body?.limit === undefined || body?.limit === null ? DEFAULT_LIMIT : body.limit,
        ) || DEFAULT_LIMIT),
    );

    // ── Allow-list enforcement. Refuse by name; never silently drop. ──────────
    const requested: string[] = Array.isArray(body?.buckets) && body.buckets.length
        ? body.buckets.map((b: unknown) => String(b))
        : [...ALLOWED_BUCKETS];

    const refused = requested
        .filter((b) => !(ALLOWED_BUCKETS as readonly string[]).includes(b))
        .map((b) => ({
            bucket: b,
            reason: REFUSAL_REASON[b] ?? "not in the janitor allow-list",
        }));
    if (refused.length) {
        return json({
            ok: false,
            error: "bucket_not_allowed",
            detail: `storage-janitor may only process ${ALLOWED_BUCKETS.join(", ")}. Refused: ` +
                refused.map((r) => `${r.bucket} (${r.reason})`).join("; "),
            refused,
            allowed: [...ALLOWED_BUCKETS],
        }, 400);
    }
    const targets = requested.filter((b, i) => requested.indexOf(b) === i) as AllowedBucket[];

    const service = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const report: Record<string, unknown> = {};

    try {
        for (const bucket of targets) {
            const all = await listAll(service, bucket);
            const live = all.filter((o) => !o.path.startsWith(GC_PREFIX));
            const gc = all.filter((o) => o.path.startsWith(GC_PREFIX));

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

            // ── purge: only ever touches what quarantine already moved ────────
            if (mode === "purge") {
                const batch = gcEligible.slice(0, limit);
                // Belt and braces: nothing outside _gc/ may reach remove(), ever.
                const paths = batch.map((o) => o.path).filter((p) => p.startsWith(GC_PREFIX));
                if (paths.length !== batch.length) {
                    return json({ ok: false, error: "purge_guard_tripped", detail: "non-_gc path reached the purge batch" }, 500);
                }
                let purged = 0;
                const failed: Array<{ path: string; error: string }> = [];
                if (paths.length) {
                    const { error } = await service.storage.from(bucket).remove(paths);
                    if (error) failed.push({ path: `${paths.length} objects`, error: error.message });
                    else purged = paths.length;
                }
                report[bucket] = {
                    mode: "purge",
                    quarantine: quarantineSummary,
                    min_age_days: minAgeDays,
                    limit_applied: limit,
                    truncated: gcEligible.length > batch.length,
                    purged,
                    purged_bytes: purged ? batch.reduce((s, o) => s + o.size, 0) : 0,
                    failed,
                    objects: batch.map((o) => ({
                        path: o.path, size: o.size, quarantined_days_ago: quarantineAgeDays(o.path, now),
                        action: failed.length ? "purge_failed" : "purged",
                    })),
                };
                continue;
            }

            // ── scan: build references, ASSERT, then take the complement ──────
            const existing = new Set(live.map((o) => o.path));
            const columns = REFERENCE_COLUMNS[bucket];
            const rows: Array<{ table: string; column: string; values: unknown[] }> = [];
            for (const c of columns) {
                const r = await fetchAllRows(service, c.table, c.column);
                rows.push({ table: c.table, column: c.column, values: r.map((x: any) => x?.[c.column]) });
            }
            const { referenced, unresolved } = scanReferences(rows, bucket, existing);

            const totalBytes = live.reduce((s, o) => s + o.size, 0);
            const referencedObjs = live.filter((o) => referenced.has(o.path));

            if (unresolved.length) {
                // The normaliser is wrong for at least one format. The complement of a
                // wrong reference set turns LIVE objects into "orphans" — abort.
                report[bucket] = {
                    mode,
                    aborted: true,
                    abort_reason: "unresolved_references — a stored reference did not resolve to an existing object; " +
                        "the normaliser cannot be trusted, so the orphan complement was not computed",
                    total_objects: live.length,
                    total_bytes: totalBytes,
                    referenced: referencedObjs.length,
                    referenced_bytes: referencedObjs.reduce((s, o) => s + o.size, 0),
                    unresolved_references: unresolved,
                    quarantine: quarantineSummary,
                };
                console.error(`storage-janitor: ABORT ${bucket} — ${unresolved.length} unresolved reference(s)`);
                continue;
            }

            let orphans = live.filter((o) => !referenced.has(o.path));
            let protectedBySnapshot: string[] = [];
            if (bucket === "business-logos") {
                const res = await excludeSnapshotReferenced(service, orphans);
                orphans = res.kept;
                protectedBySnapshot = res.protectedBySnapshot;
            }

            // Age floor — never consider anything created more recently.
            const oldEnough = orphans.filter((o) => o.age_days >= minAgeDays);
            const batch = oldEnough.slice(0, limit);

            let actions: unknown = null;
            if (mode === "quarantine") {
                actions = await quarantine(service, bucket, batch, today);
            }

            const movedSet = new Set(
                (actions as any)?.moved?.map((m: { from: string }) => m.from) ?? [],
            );

            report[bucket] = {
                mode,
                aborted: false,
                total_objects: live.length,
                total_bytes: totalBytes,
                referenced: referencedObjs.length,
                referenced_bytes: referencedObjs.reduce((s, o) => s + o.size, 0),
                orphaned: orphans.length,
                orphaned_bytes: orphans.reduce((s, o) => s + o.size, 0),
                orphaned_old_enough: oldEnough.length,
                orphaned_old_enough_bytes: oldEnough.reduce((s, o) => s + o.size, 0),
                skipped_too_new: orphans.length - oldEnough.length,
                min_age_days: minAgeDays,
                limit_applied: limit,
                truncated: oldEnough.length > batch.length,
                protected_by_snapshot: protectedBySnapshot,
                unresolved_references: unresolved, // always [] here; present so the shape is stable
                quarantine: quarantineSummary,
                actions,
                objects: batch.map((o) => ({
                    path: o.path,
                    size: o.size,
                    age_days: o.age_days,
                    action: mode === "quarantine"
                        ? (movedSet.has(o.path) ? "quarantined" : "quarantine_failed")
                        : "would_quarantine",
                })),
            };
        }
    } catch (e) {
        console.error("storage-janitor failed:", (e as Error).message);
        return json({ ok: false, error: "scan_failed", detail: (e as Error).message, partial: report }, 500);
    }

    const out = {
        ok: true,
        mode,
        min_age_days: minAgeDays,
        limit,
        allowed_buckets: [...ALLOWED_BUCKETS],
        generated_at: new Date(now).toISOString(),
        buckets: report,
    };
    // No durable record is written: email_log is the wrong table and inventing one is
    // out of scope. The response IS the record — capture it where you invoke this.
    console.log("storage-janitor:", JSON.stringify(out));
    return json(out, 200);
});
