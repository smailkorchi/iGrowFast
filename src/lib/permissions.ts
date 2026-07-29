import { USER_PAGES } from '@/lib/invitations';

// Page-permission resolution — the ONE place the `users.permissions.pages` map is
// interpreted. Sidebar filtering and the route gate both call these, so a page can
// never be hidden from the nav yet reachable by URL (or vice-versa).
//
// SEMANTICS (deliberate, documented in the TKT-11 design):
//   • absent map  ⇒ allowed   (a user with no permissions object keeps full access)
//   • absent key  ⇒ allowed   (pages shipped after the map was written appear automatically)
//   • explicit false ⇒ DENIED (explicit denial always wins)
// SCOPE: callers apply this to role 'admin' only. super admin / business owner / owner
// are structurally exempt and must never be filtered.
//
// BOUNDARY: this gates the app SURFACE (nav + navigation). The data boundary is RLS.

export type PagePermissionMap = Record<string, boolean> | null | undefined;

/** Registry route keys, matched longest-first. */
const REGISTRY_PATHS: string[] = USER_PAGES.map((p) => p.path);

/** Drop a trailing slash (except on the root) so '/orders/' resolves like '/orders'. */
function normalize(pathname: string): string {
    if (!pathname) return '/';
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

/**
 * A registry key covers a pathname when it IS the pathname or is a path-segment prefix of it
 * (so /campaigns/:id inherits /campaigns). '/' is exact-only — otherwise the Dashboard key
 * would swallow every route.
 */
function covers(pathname: string, key: string): boolean {
    if (pathname === key) return true;
    if (key === '/') return false;
    return pathname.startsWith(key + '/');
}

/**
 * Is `pathname` allowed by this page map?
 * Resolution: of the registry keys covering the pathname, the LONGEST one the map actually
 * specifies decides (so an exact key beats its parent: /business/payments answers for itself,
 * not for /business). A pathname whose covering keys are all unspecified — or that no registry
 * key covers at all (/profile, legacy aliases) — is allowed.
 */
/**
 * Legacy route aliases: paths that serve a registry page's content under an old
 * URL. Without this, a denied page stays reachable through its alias
 * (/sellers renders the same component as /collaborators/sellers).
 */
const ROUTE_ALIASES: Record<string, string> = {
    '/sellers': '/collaborators/sellers',
};

export function isPageAllowed(pathname: string, pages: PagePermissionMap): boolean {
    if (!pages) return true;
    const raw = normalize(pathname);
    const path = ROUTE_ALIASES[raw] ?? raw;
    let bestKey: string | null = null;
    for (const key of REGISTRY_PATHS) {
        if (!covers(path, key)) continue;
        if (!(key in pages)) continue;
        if (bestKey === null || key.length > bestKey.length) bestKey = key;
    }
    if (bestKey === null) return true;
    return pages[bestKey] !== false;
}

/** First registry page this map allows, in registry order — the landing page for a gated admin.
 *  null ⇒ the admin has ZERO allowed pages (callers render the « aucune page » screen). */
export function firstAllowedPath(pages: PagePermissionMap): string | null {
    // Must agree with isPageAllowed (ancestor inheritance included) — a raw
    // key check here could pick a page the gate then denies, looping the
    // redirect forever.
    for (const p of USER_PAGES) {
        if (isPageAllowed(p.path, pages)) return p.path;
    }
    return null;
}

/* ── Contract cases (kept in sync with the ticket's verification list) ─────────────
 * isPageAllowed('/business/payments', { '/business': true, '/business/payments': false })
 *      → false   exact key beats the shorter '/business' prefix
 * isPageAllowed('/business/payments', { '/business': false })
 *      → false   no own key ⇒ inherits the nearest SPECIFIED ancestor
 * isPageAllowed('/business/payments', { '/business': false, '/business/payments': true })
 *      → true    an explicit own key always overrides the ancestor
 * isPageAllowed('/business',          { '/business/payments': false })
 *      → true    a child key never restricts its parent page
 * isPageAllowed('/campaigns/abc',     { '/campaigns': false })            → false
 * isPageAllowed('/campaigns/abc',     { '/campaigns': true })             → true
 * isPageAllowed('/orders',            {})                                → true   absent key
 * isPageAllowed('/orders',            null)                              → true   absent map
 * isPageAllowed('/orders',            { '/': false })                     → true   '/' is exact-only
 * isPageAllowed('/',                  { '/': false })                     → false
 * isPageAllowed('/profile',           { ...everything false })            → true   not in registry
 * isPageAllowed('/whatsapp/numbers/x',{ '/whatsapp/numbers': false })     → false
 * firstAllowedPath({ '/': false, '/analytics': false })                   → '/google-analytics'
 * firstAllowedPath(Object.fromEntries(USER_PAGES.map(p => [p.path, false]))) → null
 * ─────────────────────────────────────────────────────────────────────────────── */
