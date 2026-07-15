// Date bucketing helpers for analytics that mix DB `timestamptz` (UTC) with
// user-entered `YYYY-MM-DD` strings. `orders.date` is a timestamptz; sheets
// and `campaign_daily_entries.entry_date` are plain local-day strings. Without
// converting, Morocco-side orders placed in the 00:00–00:59 local hour are
// attributed to the previous day (off-by-one in the daily rollup).
export const BUSINESS_TZ = 'Africa/Casablanca';

const businessDateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

// Returns YYYY-MM-DD in the business timezone for an ISO-ish timestamp.
export const toBusinessDate = (iso: string): string => businessDateFmt.format(new Date(iso));

// Shifts a YYYY-MM-DD string by N calendar days.
export const shiftYmd = (ymd: string, days: number): string => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

// Returns YYYY-MM-DD for today in the business timezone. Use this instead of
// `format(new Date(), 'yyyy-MM-dd')` — browser-local `format` returns the
// viewer's calendar date, which can differ from the business-local date for
// users outside Casablanca or when the app is rendered under UTC (SSR/CI).
export const todayBusinessYmd = (): string => toBusinessDate(new Date().toISOString());

// Returns the YYYY-MM-DD key for a Date in the business timezone.
//
// RUNTIME-DEAD, RETAINED DELIBERATELY (D7, 2026-07-15) — zero callers (external
// or internal). Kept as the parity reference for the Casablanca day-bucketing
// the D2/D3 RPCs perform server-side. Tree-shaken at build time. Do not delete
// while the SQL it documents is live.
//
// NOTE: `BUSINESS_TZ` above is sometimes listed alongside this symbol as a "dead
// export" — it is NOT dead. It has no *external* consumers, but it is
// load-bearing internally (the Intl formatter at the top of this file reads it).
// Only its `export` keyword is redundant; removing the constant breaks this file.
export const dateToBusinessYmd = (d: Date): string => toBusinessDate(d.toISOString());
