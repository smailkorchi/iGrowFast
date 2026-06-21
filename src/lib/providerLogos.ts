/**
 * Canonical delivery-provider logo resolver.
 *
 * Provider logos are PRESET assets shipped in `/public/providers`. They are NOT
 * read from the database: the legacy `providers.logo_url` column holds stale,
 * now-dead upload URLs (e.g. Supabase storage `providers-logos/logos/0.xxxx.png`)
 * from the old "user uploads his own logo" model. Every place that displays a
 * provider/company logo MUST resolve it through this module by `provider_type`
 * (or, as a fallback, the provider `name`) and ignore the DB URL entirely.
 *
 * Filenames are case-sensitive on the production (Linux) host — keep them exact.
 */

/** provider_type (canonical, lowercase) -> local asset path under /public/providers. */
export const PROVIDER_LOGO_BY_TYPE: Record<string, string> = {
    ameex: '/providers/Ameex.png',
    coliaty: '/providers/Coliaty.png',
    ozon: '/providers/OZON.png',
    quicklivraison: '/providers/Quick%20Livraison.png',
    vitex: '/providers/Vitex.png',
    forcelog: '/providers/Forcelog.png',
    sendit: '/providers/Sendit.jpg',
    digylog: '/providers/Digylog.webp',
    delvoexpress: '/providers/Delvo.png',
    olivraison: '/providers/Olivraison.png',
};

/**
 * name/type substring -> canonical provider_type. Used to recover the provider
 * identity from rows where `provider_type` was not selected (only `name`), and
 * to absorb naming drift (e.g. "OzonExpress", "Delevo Express", "Quick Livraison").
 * Order matters: more specific hints first.
 */
const PROVIDER_HINTS: ReadonlyArray<readonly [string, string]> = [
    ['ameex', 'ameex'],
    ['coliaty', 'coliaty'],
    ['ozon', 'ozon'],
    ['quick', 'quicklivraison'],
    ['quicklivraison', 'quicklivraison'],
    ['vitex', 'vitex'],
    ['forcelog', 'forcelog'],
    ['sendit', 'sendit'],
    ['digylog', 'digylog'],
    ['delvoexpress', 'delvoexpress'],
    ['delevo', 'delvoexpress'],
    ['delvo', 'delvoexpress'],
    ['olivraison', 'olivraison'],
];

/** Normalize any provider_type / name string to a canonical provider_type, or null. */
export function normalizeProviderType(raw?: string | null): string | null {
    if (!raw) return null;
    const t = raw.toString().toLowerCase().trim();
    if (!t) return null;
    if (PROVIDER_LOGO_BY_TYPE[t]) return t;
    for (const [hint, type] of PROVIDER_HINTS) {
        if (t.includes(hint)) return type;
    }
    return null;
}

export interface ProviderLike {
    provider_type?: string | null;
    type?: string | null;
    name?: string | null;
}

/**
 * Resolve the preset local logo path for a provider/company.
 * Returns null for unknown providers so callers can render their existing
 * initial-letter fallback instead of a broken image. NEVER falls back to a DB URL.
 */
export function resolveProviderLogo(provider?: ProviderLike | null): string | null {
    if (!provider) return null;
    const byType = normalizeProviderType(provider.provider_type ?? provider.type);
    if (byType) return PROVIDER_LOGO_BY_TYPE[byType];
    const byName = normalizeProviderType(provider.name);
    if (byName) return PROVIDER_LOGO_BY_TYPE[byName];
    return null;
}

/** Convenience: resolve directly from a provider_type string. */
export function providerLogoByType(providerType?: string | null): string | null {
    const t = normalizeProviderType(providerType);
    return t ? PROVIDER_LOGO_BY_TYPE[t] : null;
}
