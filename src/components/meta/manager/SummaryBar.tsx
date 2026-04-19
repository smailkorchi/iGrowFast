import React from 'react';
import { money, nfc, pct } from '../shared/metaTheme';

interface Totals {
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    results: number;
    purchaseValue: number;
    currency: string;
}

export const SummaryBar: React.FC<{ totals: Totals; isLoading: boolean }> = ({
    totals,
    isLoading,
}) => {
    const {
        spend,
        impressions,
        reach,
        clicks,
        results,
        purchaseValue,
        currency,
    } = totals;

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? purchaseValue / spend : 0;
    const costPerResult = results > 0 ? spend / results : 0;

    const metrics = [
        { label: 'Amount spent', value: money(spend, currency) },
        { label: 'Results', value: nfc.format(results) },
        { label: 'Cost per result', value: costPerResult > 0 ? money(costPerResult, currency) : '--' },
        { label: 'ROAS', value: roas > 0 ? `${roas.toFixed(2)}x` : '--' },
        { label: 'Reach', value: nfc.format(reach) },
        { label: 'Impressions', value: nfc.format(impressions) },
        { label: 'CTR', value: pct(ctr) },
        { label: 'CPC', value: cpc > 0 ? money(cpc, currency) : '--' },
        { label: 'CPM', value: cpm > 0 ? money(cpm, currency) : '--' },
    ];

    return (
        <div className="flex items-stretch bg-white border border-ant-line rounded-lg overflow-hidden">
            {metrics.map((m, i) => (
                <div
                    key={m.label}
                    className={`flex-1 min-w-0 px-3 py-2.5 ${i > 0 ? 'border-l border-ant-line' : ''}`}
                >
                    <div className="text-[11px] text-ant-muted truncate">{m.label}</div>
                    <div className="text-[13px] font-semibold text-ant-ink tabular-nums truncate">
                        {isLoading ? '--' : m.value}
                    </div>
                </div>
            ))}
        </div>
    );
};
