import React, { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    useMetaAccountSummary,
    useMetaAccountTimeseries,
    useMetaCampaigns,
    type DatePreset,
    type MetaConnection,
} from '@/hooks/useMetaAds';
import { firstInsights, pickAction } from '@/lib/metaAds';
import { COLUMN_PRESETS, nfc } from '../shared/metaTheme';
import { ManagerTabs, type ManagerTab } from './ManagerTabs';
import { ManagerToolbar } from './ManagerToolbar';
import { SummaryBar } from './SummaryBar';
import { CampaignsTable } from './CampaignsTable';
import { AdSetsTable } from './AdSetsTable';
import { AdsTable } from './AdsTable';
import { PixelDashboard } from './PixelDashboard';

interface Props {
    connection: MetaConnection;
    onCreateCampaign: () => void;
}

export const MetaAdsManager: React.FC<Props> = ({ connection, onCreateCampaign }) => {
    const [tab, setTab] = useState<ManagerTab>('campaigns');
    const [datePreset, setDatePreset] = useState<DatePreset>('last_28d');
    const [searchQuery, setSearchQuery] = useState('');
    const [visibleColumns, setVisibleColumns] = useState<string[]>(
        () => {
            const saved = localStorage.getItem('meta_visible_columns');
            if (saved) try { return JSON.parse(saved); } catch { /* ignore */ }
            return [...COLUMN_PRESETS.Performance];
        }
    );

    const handleColumnsChange = (cols: string[]) => {
        setVisibleColumns(cols);
        localStorage.setItem('meta_visible_columns', JSON.stringify(cols));
    };

    // Counts for tab labels
    const [campaignCount, setCampaignCount] = useState(0);
    const [adsetCount, setAdsetCount] = useState(0);
    const [adCount, setAdCount] = useState(0);

    // Summary bar data
    const { data: account } = useMetaAccountSummary(connection.id);
    const campaignsQ = useMetaCampaigns(connection.id, datePreset);
    const timeseriesQ = useMetaAccountTimeseries(connection.id, datePreset);
    const currency = account?.currency ?? 'USD';

    const totals = useMemo(() => {
        const all = campaignsQ.data ?? [];
        let spend = 0, impressions = 0, clicks = 0, reach = 0, results = 0, purchaseValue = 0;
        for (const c of all) {
            const ins = firstInsights(c);
            spend += Number(ins.spend || 0);
            impressions += Number(ins.impressions || 0);
            clicks += Number(ins.clicks || 0);
            reach += Number(ins.reach || 0);
            results += pickAction(ins, 'purchase') || pickAction(ins, 'omni_purchase');
            const rv = ins.action_values?.find(
                (a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
            );
            if (rv) purchaseValue += Number(rv.value) || 0;
        }
        return { spend, impressions, reach, clicks, results, purchaseValue, currency };
    }, [campaignsQ.data, currency]);

    const showChart = tab === 'campaigns';

    return (
        <div className="flex flex-col bg-white border border-gray-100 rounded-xl overflow-hidden">
            {/* Tabs */}
            <ManagerTabs
                value={tab}
                onChange={setTab}
                counts={{ campaigns: campaignCount, adsets: adsetCount, ads: adCount }}
            />

            {/* Toolbar */}
            <ManagerToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                datePreset={datePreset}
                onDatePresetChange={setDatePreset}
                visibleColumns={visibleColumns}
                onColumnsChange={handleColumnsChange}
                onCreateCampaign={onCreateCampaign}
                showCreate={tab !== 'pixel'}
            />

            {/* Summary bar (campaigns/adsets/ads tabs) */}
            {tab !== 'pixel' && (
                <div className="px-2.5 pt-2">
                    <SummaryBar totals={totals} isLoading={campaignsQ.isLoading} />
                </div>
            )}

            {/* Chart (campaigns tab only) */}
            {showChart && (
                <div className="px-2.5 pt-2.5">
                    <div className="bg-white border border-gray-100 rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                            <div>
                                <div className="text-[12px] font-semibold text-brand-navy">
                                    Spend &amp; impressions
                                </div>
                                <div className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 mt-0.5">
                                    Daily account-level trend
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 text-[10px] text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-[#1877F2]" />
                                    Spend
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-[#42b72a]" />
                                    Impressions
                                </span>
                            </div>
                        </div>
                        <div className="h-40">
                            {timeseriesQ.isLoading ? (
                                <Skeleton className="w-full h-full rounded" />
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={timeseriesQ.data ?? []} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="meta-spend-g" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#1877F2" stopOpacity={0.18} />
                                                <stop offset="100%" stopColor="#1877F2" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="meta-imp-g" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#42b72a" stopOpacity={0.12} />
                                                <stop offset="100%" stopColor="#42b72a" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
                                        <XAxis
                                            dataKey="date_start"
                                            tick={{ fontSize: 10, fill: '#9ca3af' }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => (v ? String(v).slice(5) : '')}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            tick={{ fontSize: 10, fill: '#9ca3af' }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={36}
                                            tickFormatter={(v) => nfc.format(Number(v))}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            tick={{ fontSize: 10, fill: '#9ca3af' }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={32}
                                            tickFormatter={(v) => nfc.format(Number(v))}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: 10,
                                                border: '1px solid #f3f4f6',
                                                boxShadow: 'none',
                                                fontSize: 11,
                                            }}
                                        />
                                        <Area
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="spend"
                                            stroke="#1877F2"
                                            strokeWidth={1.75}
                                            fill="url(#meta-spend-g)"
                                            dot={false}
                                        />
                                        <Area
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="impressions"
                                            stroke="#42b72a"
                                            strokeWidth={1.25}
                                            fill="url(#meta-imp-g)"
                                            dot={false}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Table / Pixel content */}
            <div className="p-2.5">
                {tab === 'campaigns' && (
                    <CampaignsTable
                        connection={connection}
                        datePreset={datePreset}
                        searchQuery={searchQuery}
                        visibleColumns={visibleColumns}
                        onCampaignCountChange={setCampaignCount}
                    />
                )}
                {tab === 'adsets' && (
                    <AdSetsTable
                        connection={connection}
                        datePreset={datePreset}
                        searchQuery={searchQuery}
                        visibleColumns={visibleColumns}
                        onAdSetCountChange={setAdsetCount}
                    />
                )}
                {tab === 'ads' && (
                    <AdsTable
                        connection={connection}
                        datePreset={datePreset}
                        searchQuery={searchQuery}
                        visibleColumns={visibleColumns}
                        onAdCountChange={setAdCount}
                    />
                )}
                {tab === 'pixel' && (
                    <PixelDashboard
                        connection={connection}
                        datePreset={datePreset}
                    />
                )}
            </div>
        </div>
    );
};
