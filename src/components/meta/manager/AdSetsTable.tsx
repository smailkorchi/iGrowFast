import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
    useMetaAllAdSets,
    type DatePreset,
    type MetaConnection,
} from '@/hooks/useMetaAds';
import { firstInsights, pickAction, pickRoas } from '@/lib/metaAds';
import { getStatusStyle, money, nfc, pct, TABLE_COLUMNS } from '../shared/metaTheme';
import { StatusToggle } from './StatusToggle';
import { BulkActions } from './BulkActions';

interface Props {
    connection: MetaConnection;
    datePreset: DatePreset;
    searchQuery: string;
    visibleColumns: string[];
    onAdSetCountChange?: (n: number) => void;
}

export const AdSetsTable: React.FC<Props> = ({
    connection,
    datePreset,
    searchQuery,
    visibleColumns,
    onAdSetCountChange,
}) => {
    const adsetsQ = useMetaAllAdSets(connection.id, datePreset);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const adsets = useMemo(() => {
        const all = adsetsQ.data ?? [];
        onAdSetCountChange?.(all.length);
        if (!searchQuery) return all;
        const q = searchQuery.toLowerCase();
        return all.filter((a: any) => a.name?.toLowerCase().includes(q));
    }, [adsetsQ.data, searchQuery]);

    const toggleSelect = (id: string) =>
        setSelected((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });

    const toggleAll = () => {
        if (selected.size === adsets.length) setSelected(new Set());
        else setSelected(new Set(adsets.map((a: any) => a.id)));
    };

    const cols = TABLE_COLUMNS.filter((c) => visibleColumns.includes(c.key));
    const currency = 'USD';

    if (adsetsQ.isLoading) return <Skeleton className="h-96 w-full rounded-lg" />;

    if (adsets.length === 0) {
        return (
            <div className="bg-white border border-[#e4e6eb] rounded-lg p-10 text-center">
                <div className="text-[13px] font-semibold text-[#606770]">
                    {searchQuery ? 'No ad sets match your search' : 'No ad sets found'}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white border border-[#e4e6eb] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-[#f0f2f5] text-[11px] font-semibold uppercase text-[#606770] tracking-wider">
                            <th className="w-10 px-3 py-2">
                                <Checkbox
                                    checked={selected.size === adsets.length && adsets.length > 0}
                                    onCheckedChange={toggleAll}
                                />
                            </th>
                            <th className="w-12 px-2 py-2 text-center">On/Off</th>
                            <th className="text-left px-3 py-2 min-w-[200px]">Ad set name</th>
                            <th className="text-left px-3 py-2 w-[100px]">Delivery</th>
                            <th className="text-right px-3 py-2 w-[90px]">Budget</th>
                            {cols.map((col) => (
                                <th key={col.key} className={cn('px-3 py-2', col.width, col.align === 'right' ? 'text-right' : 'text-left')}>
                                    {col.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {adsets.map((a: any) => {
                            const ins = firstInsights(a);
                            const spend = Number(ins.spend || 0);
                            const impressions = Number(ins.impressions || 0);
                            const clicks = Number(ins.clicks || 0);
                            const reach = Number(ins.reach || 0);
                            const ctr = Number(ins.ctr || 0);
                            const cpc = Number(ins.cpc || 0);
                            const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
                            const frequency = Number(ins.frequency || 0);
                            const roas = pickRoas(ins);
                            const results = pickAction(ins, 'purchase') || pickAction(ins, 'omni_purchase');
                            const costPerResult = results > 0 ? spend / results : 0;
                            const status = getStatusStyle(a.effective_status || a.status);
                            const isActive = a.status === 'ACTIVE';
                            const isSelected = selected.has(a.id);

                            const cellValue = (key: string): string => {
                                switch (key) {
                                    case 'spend': return money(spend, currency);
                                    case 'results': return results > 0 ? nfc.format(results) : '--';
                                    case 'cost_per_result': return costPerResult > 0 ? money(costPerResult, currency) : '--';
                                    case 'roas': return roas > 0 ? `${roas.toFixed(2)}x` : '--';
                                    case 'reach': return nfc.format(reach);
                                    case 'impressions': return nfc.format(impressions);
                                    case 'clicks': return nfc.format(clicks);
                                    case 'ctr': return pct(ctr);
                                    case 'cpc': return cpc > 0 ? money(cpc, currency) : '--';
                                    case 'cpm': return cpm > 0 ? money(cpm, currency) : '--';
                                    case 'frequency': return frequency > 0 ? frequency.toFixed(2) : '--';
                                    default: return '--';
                                }
                            };

                            return (
                                <tr
                                    key={a.id}
                                    className={cn(
                                        'border-t border-[#e4e6eb] hover:bg-[#f7f8fa] transition-colors h-[44px]',
                                        isSelected && 'bg-[#ebf5ff]'
                                    )}
                                >
                                    <td className="px-3"><Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(a.id)} /></td>
                                    <td className="px-2 text-center">
                                        <StatusToggle connectionId={connection.id} objectType="adset" objectId={a.id} isActive={isActive} />
                                    </td>
                                    <td className="px-3">
                                        <div className="text-[13px] font-semibold text-[#1c1e21] truncate max-w-[260px]">{a.name}</div>
                                        <div className="text-[11px] text-[#8a8d91]">{a.optimization_goal?.replace(/_/g, ' ').toLowerCase()}</div>
                                    </td>
                                    <td className="px-3">
                                        <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold', status.bg, status.fg)}>
                                            <span className={cn('w-1.5 h-1.5 rounded-full', status.dot)} />
                                            {status.label}
                                        </span>
                                    </td>
                                    <td className="px-3 text-right text-[12px] text-[#1c1e21] tabular-nums">
                                        {a.daily_budget ? `${(Number(a.daily_budget) / 100).toFixed(2)}/day` : '--'}
                                    </td>
                                    {cols.map((col) => (
                                        <td key={col.key} className={cn('px-3 text-[12px] tabular-nums text-[#1c1e21]', col.align === 'right' ? 'text-right' : 'text-left')}>
                                            {cellValue(col.key)}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <BulkActions connectionId={connection.id} selectedIds={selected} objectType="adset" onDone={() => setSelected(new Set())} />
        </div>
    );
};
