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
export const dateToBusinessYmd = (d: Date): string => toBusinessDate(d.toISOString());
