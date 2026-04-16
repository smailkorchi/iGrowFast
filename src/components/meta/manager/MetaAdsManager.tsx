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
        <div className="flex flex-col bg-white border border-[#e4e6eb] rounded-lg overflow-hidden">
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

            {/* Summary bar (for campaigns/adsets/ads tabs) */}
            {tab !== 'pixel' && (
                <div className="px-4 pt-3">
                    <SummaryBar totals={totals} isLoading={campaignsQ.isLoading} />
                </div>
            )}

            {/* Chart (campaigns tab only) */}
            {showChart && (
                <div className="px-4 pt-4">
                    <div className="bg-white border border-[#e4e6eb] rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <div className="text-[13px] font-semibold text-[#1c1e21]">
                                    Spend & impressions
                                </div>
                                <div className="text-[11px] text-[#8a8d91]">Daily account-level trend</div>
                            </div>
                            <div className="flex items-center gap-4 text-[11px] font-medium text-[#606770]">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-[#1877F2]" />
                                    Spend
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-[#42b72a]" />
                                    Impressions
                                </div>
                            </div>
                        </div>
                        <div className="h-56">
                            {timeseriesQ.isLoading ? (
                                <Skeleton className="w-full h-full rounded" />
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={timeseriesQ.data ?? []}>
                                        <defs>
                                            <linearGradient id="meta-spend-g" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#1877F2" stopOpacity={0.15} />
                                                <stop offset="100%" stopColor="#1877F2" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="meta-imp-g" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#42b72a" stopOpacity={0.1} />
                                                <stop offset="100%" stopColor="#42b72a" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e4e6eb" vertical={false} />
                                        <XAxis
                                            dataKey="date_start"
                                            tick={{ fontSize: 11, fill: '#8a8d91' }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => (v ? String(v).slice(5) : '')}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            tick={{ fontSize: 11, fill: '#8a8d91' }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => nfc.format(Number(v))}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            tick={{ fontSize: 11, fill: '#8a8d91' }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => nfc.format(Number(v))}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                border: '1px solid #e4e6eb',
                                                borderRadius: 8,
                                                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                                fontSize: 12,
                                            }}
                                        />
                                        <Area
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="spend"
                                            stroke="#1877F2"
                                            strokeWidth={2}
                                            fill="url(#meta-spend-g)"
                                        />
                                        <Area
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="impressions"
                                            stroke="#42b72a"
                                            strokeWidth={1.5}
                                            fill="url(#meta-imp-g)"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Table / Pixel content */}
            <div className="p-4">
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
