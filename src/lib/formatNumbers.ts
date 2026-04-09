// Shared number formatters for campaign / statistics UIs.
// All cards that display monetary values inside fixed-width containers should use these helpers
// so large numbers (10K+) don't overflow and get truncated to ellipses.

/**
 * Compact currency formatter. Suffixes the currency code so the digits dominate visually:
 *   22       -> "22.00 MAD"
 *   2_200    -> "2.2K MAD"
 *   220_000  -> "220K MAD"
 *   2_200_000-> "2.2M MAD"
 * Values < 10_000 keep full precision.
 */
export const fmtCur = (n: number | null | undefined, code = 'MAD'): string => {
    const value = Number(n || 0);
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B ${code}`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ${code}`;
    if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K ${code}`;
    return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${code}`;
};

/**
 * Compact integer formatter. Used for leads/orders counts.
 *   999     -> "999"
 *   12_345  -> "12.3K"
 *   2_345_000 -> "2.3M"
 */
export const fmtNumCompact = (n: number | null | undefined): string => {
    if (n == null) return '—';
    const value = Number(n);
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
    return new Intl.NumberFormat('en-US').format(value);
};

/** Full-precision number formatter — use in wide contexts like tables. */
export const fmtNum = (n: number | null | undefined): string =>
    n == null ? '—' : new Intl.NumberFormat('en-US').format(Number(n));

/** Full-precision currency — use in tables and tooltips where width is flexible. */
export const fmtCurFull = (n: number | null | undefined, code = 'MAD'): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2 }).format(Number(n || 0));

/** Percentage formatter accepting a 0..1 value. */
export const fmtPct = (n: number | null | undefined): string =>
    n == null ? '—' : `${(Number(n) * 100).toFixed(2)}%`;
