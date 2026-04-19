import type React from 'react';

// ── Meta Ads Manager palette ─────────────────────────────────────────────
// The page is branded as "Meta Ads" but the surface uses Anthropic neutrals so
// it stays cohesive with the rest of the admin dashboard. `blue`/`blueHover`
// stay as Facebook's brand color and are reserved for Meta-specific UI (OAuth
// button, platform icons, review/processing status dots) — the rest of the
// surface reads ink-on-paper like every other admin page.
export const META = {
    // Facebook brand blue — keep only for Meta-identified elements
    blue: '#1877F2',
    blueHover: '#166fe5',
    blueBg: 'rgba(24, 119, 242, 0.08)',
    // Anthropic surface
    text: '#141413',          // ant-ink
    secondary: '#6b6a63',     // ant-muted
    placeholder: '#b0aea5',   // ant-mid
    border: '#e8e6dc',        // ant-line
    borderDark: '#d8d6cc',
    bg: '#faf9f5',            // ant-light
    bgHover: '#f1efe8',       // ant-line-soft
    // Semantic
    green: '#788c5d',         // ant-green
    red: '#c96356',           // ant-rose
    orange: '#d97757',        // ant-orange
    white: '#ffffff',
} as const;

// CSS variable override so shadcn components (Switch, Checkbox, focus rings,
// Button primary) inside the Meta surface use Meta blue. Keeps Facebook's
// accent inside the manager while leaving the rest of the app on Anthropic's
// orange accent.
export const META_THEME_VARS: React.CSSProperties = {
    '--ring': '214 89% 52%',
    '--primary': '214 89% 52%',
    '--accent': '214 89% 96%',
} as React.CSSProperties;

// ── Status styling ──────────────────────────────────────────────────────
export type DeliveryStatus =
    | 'ACTIVE'
    | 'PAUSED'
    | 'DELETED'
    | 'ARCHIVED'
    | 'CAMPAIGN_PAUSED'
    | 'ADSET_PAUSED'
    | 'DISAPPROVED'
    | 'PENDING_REVIEW'
    | 'IN_PROCESS'
    | 'WITH_ISSUES';

export interface StatusStyle {
    dot: string;
    bg: string;
    fg: string;
    label: string;
}

// All status tones use Anthropic's semantic palette. Paused/archived fall back
// to the neutral ink/mid tones rather than the old Facebook gray swatches.
export const STATUS_STYLES: Record<string, StatusStyle> = {
    ACTIVE: { dot: 'bg-ant-green', bg: 'bg-ant-green/12', fg: 'text-ant-green', label: 'Active' },
    PAUSED: { dot: 'bg-ant-mid', bg: 'bg-ant-line-soft', fg: 'text-ant-muted', label: 'Paused' },
    DELETED: { dot: 'bg-ant-rose', bg: 'bg-ant-rose/10', fg: 'text-ant-rose', label: 'Deleted' },
    ARCHIVED: { dot: 'bg-ant-mid', bg: 'bg-ant-line-soft', fg: 'text-ant-muted', label: 'Archived' },
    CAMPAIGN_PAUSED: { dot: 'bg-ant-orange', bg: 'bg-ant-orange/10', fg: 'text-ant-orange', label: 'Campaign paused' },
    ADSET_PAUSED: { dot: 'bg-ant-orange', bg: 'bg-ant-orange/10', fg: 'text-ant-orange', label: 'Ad set paused' },
    DISAPPROVED: { dot: 'bg-ant-rose', bg: 'bg-ant-rose/10', fg: 'text-ant-rose', label: 'Disapproved' },
    PENDING_REVIEW: { dot: 'bg-[#1877F2]', bg: 'bg-[#1877F2]/10', fg: 'text-[#1877F2]', label: 'In review' },
    IN_PROCESS: { dot: 'bg-[#1877F2]', bg: 'bg-[#1877F2]/10', fg: 'text-[#1877F2]', label: 'Processing' },
    WITH_ISSUES: { dot: 'bg-ant-orange', bg: 'bg-ant-orange/10', fg: 'text-ant-orange', label: 'Issues' },
};

export function getStatusStyle(status: string): StatusStyle {
    return (
        STATUS_STYLES[status] ?? {
            dot: 'bg-ant-mid',
            bg: 'bg-ant-line-soft',
            fg: 'text-ant-muted',
            label: status.replace(/_/g, ' ').toLowerCase(),
        }
    );
}

// ── Table column definitions ────────────────────────────────────────────
export interface ColumnDef {
    key: string;
    label: string;
    width: string;      // tailwind width class or fixed px
    align: 'left' | 'right';
    group: 'performance' | 'engagement' | 'conversion';
    defaultVisible: boolean;
}

export const TABLE_COLUMNS: ColumnDef[] = [
    { key: 'spend', label: 'Amount spent', width: 'w-[100px]', align: 'right', group: 'performance', defaultVisible: true },
    { key: 'results', label: 'Results', width: 'w-[80px]', align: 'right', group: 'conversion', defaultVisible: true },
    { key: 'cost_per_result', label: 'Cost per result', width: 'w-[110px]', align: 'right', group: 'conversion', defaultVisible: true },
    { key: 'roas', label: 'ROAS', width: 'w-[70px]', align: 'right', group: 'conversion', defaultVisible: true },
    { key: 'reach', label: 'Reach', width: 'w-[80px]', align: 'right', group: 'performance', defaultVisible: true },
    { key: 'impressions', label: 'Impressions', width: 'w-[100px]', align: 'right', group: 'performance', defaultVisible: true },
    { key: 'clicks', label: 'Clicks', width: 'w-[70px]', align: 'right', group: 'engagement', defaultVisible: false },
    { key: 'ctr', label: 'CTR', width: 'w-[60px]', align: 'right', group: 'engagement', defaultVisible: true },
    { key: 'cpc', label: 'CPC', width: 'w-[70px]', align: 'right', group: 'engagement', defaultVisible: true },
    { key: 'cpm', label: 'CPM', width: 'w-[70px]', align: 'right', group: 'performance', defaultVisible: false },
    { key: 'frequency', label: 'Frequency', width: 'w-[80px]', align: 'right', group: 'performance', defaultVisible: false },
];

export const COLUMN_PRESETS: Record<string, string[]> = {
    Performance: ['spend', 'results', 'cost_per_result', 'roas', 'reach', 'impressions', 'ctr', 'cpc'],
    Engagement: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach', 'frequency'],
    Conversions: ['spend', 'results', 'cost_per_result', 'roas', 'reach', 'impressions'],
};

// Formatters shared across manager components
export const nf = new Intl.NumberFormat('en-US');
export const nfc = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const pct = (v: number, digits = 2) => `${v.toFixed(digits)}%`;
export const money = (n: number, currency: string) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
    }).format(n);
