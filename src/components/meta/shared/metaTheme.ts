import type React from 'react';

// ── Meta Ads Manager color palette ──────────────────────────────────────
export const META = {
    blue: '#1877F2',
    blueHover: '#166fe5',
    blueBg: '#ebf5ff',
    text: '#1c1e21',
    secondary: '#606770',
    placeholder: '#8a8d91',
    border: '#e4e6eb',
    borderDark: '#dddfe2',
    bg: '#f0f2f5',
    bgHover: '#f7f8fa',
    green: '#31a24c',
    red: '#e4405f',
    white: '#ffffff',
} as const;

// CSS variable override so shadcn components (Switch, Checkbox, focus rings)
// use Meta blue instead of DigiCom brand-navy.
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

export const STATUS_STYLES: Record<string, StatusStyle> = {
    ACTIVE: { dot: 'bg-[#31a24c]', bg: 'bg-[#e6f4ea]', fg: 'text-[#1e7e34]', label: 'Active' },
    PAUSED: { dot: 'bg-[#8a8d91]', bg: 'bg-[#f0f2f5]', fg: 'text-[#606770]', label: 'Paused' },
    DELETED: { dot: 'bg-[#e4405f]', bg: 'bg-[#fce8ec]', fg: 'text-[#c4314b]', label: 'Deleted' },
    ARCHIVED: { dot: 'bg-[#8a8d91]', bg: 'bg-[#f0f2f5]', fg: 'text-[#606770]', label: 'Archived' },
    CAMPAIGN_PAUSED: { dot: 'bg-[#f0ad4e]', bg: 'bg-[#fff8e6]', fg: 'text-[#b8860b]', label: 'Campaign paused' },
    ADSET_PAUSED: { dot: 'bg-[#f0ad4e]', bg: 'bg-[#fff8e6]', fg: 'text-[#b8860b]', label: 'Ad set paused' },
    DISAPPROVED: { dot: 'bg-[#e4405f]', bg: 'bg-[#fce8ec]', fg: 'text-[#c4314b]', label: 'Disapproved' },
    PENDING_REVIEW: { dot: 'bg-[#1877F2]', bg: 'bg-[#ebf5ff]', fg: 'text-[#1877F2]', label: 'In review' },
    IN_PROCESS: { dot: 'bg-[#1877F2]', bg: 'bg-[#ebf5ff]', fg: 'text-[#1877F2]', label: 'Processing' },
    WITH_ISSUES: { dot: 'bg-[#f0ad4e]', bg: 'bg-[#fff8e6]', fg: 'text-[#b8860b]', label: 'Issues' },
};

export function getStatusStyle(status: string): StatusStyle {
    return (
        STATUS_STYLES[status] ?? {
            dot: 'bg-[#8a8d91]',
            bg: 'bg-[#f0f2f5]',
            fg: 'text-[#606770]',
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
