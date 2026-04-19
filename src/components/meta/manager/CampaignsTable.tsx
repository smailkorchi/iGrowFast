import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, DollarSign, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
    useMetaCampaigns,
    useMetaUpdateBudget,
    type DatePreset,
    type MetaConnection,
} from '@/hooks/useMetaAds';
import {
    firstInsights,
    formatCents,
    pickAction,
    pickRoas,
    toBudgetCents,
    type MetaCampaign,
    invokeMeta,
} from '@/lib/metaAds';
import { getStatusStyle, money, nfc, pct, TABLE_COLUMNS } from '../shared/metaTheme';
import { StatusToggle } from './StatusToggle';
import { BulkActions } from './BulkActions';

interface Props {
    connection: MetaConnection;
    datePreset: DatePreset;
    searchQuery: string;
    visibleColumns: string[];
    onCampaignCountChange?: (n: number) => void;
}

export const CampaignsTable: React.FC<Props> = ({
    connection,
    datePreset,
    searchQuery,
    visibleColumns,
    onCampaignCountChange,
}) => {
    const campaignsQ = useMetaCampaigns(connection.id, datePreset);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const campaigns = useMemo(() => {
        const all = campaignsQ.data ?? [];
        onCampaignCountChange?.(all.length);
        if (!searchQuery) return all;
        const q = searchQuery.toLowerCase();
        return all.filter((c) => c.name.toLowerCase().includes(q));
    }, [campaignsQ.data, searchQuery]);

    const toggleExpand = (id: string) =>
        setExpanded((s) => ({ ...s, [id]: !s[id] }));

    const toggleSelect = (id: string) =>
        setSelected((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const toggleAll = () => {
        if (selected.size === campaigns.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(campaigns.map((c) => c.id)));
        }
    };

    const cols = TABLE_COLUMNS.filter((c) => visibleColumns.includes(c.key));

    if (campaignsQ.isLoading) {
        return <Skeleton className="h-96 w-full rounded-lg" />;
    }

    if (campaignsQ.error) {
        return (
            <div className="bg-white border border-ant-line rounded-lg p-6">
                <div className="text-[13px] font-semibold text-ant-rose">
                    Failed to load campaigns
                </div>
                <div className="text-[12px] text-ant-muted mt-1">
                    {(campaignsQ.error as Error).message}
                </div>
            </div>
        );
    }

    if (campaigns.length === 0) {
        return (
            <div className="bg-white border border-ant-line rounded-lg p-10 text-center">
                <div className="text-[13px] font-semibold text-ant-muted">
                    {searchQuery ? 'No campaigns match your search' : 'No campaigns found in this date range'}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white border border-ant-line rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-ant-light text-[11px] font-semibold uppercase text-ant-muted tracking-wider">
                            <th className="w-10 px-3 py-2">
                                <Checkbox
                                    checked={selected.size === campaigns.length && campaigns.length > 0}
                                    onCheckedChange={toggleAll}
                                />
                            </th>
                            <th className="w-12 px-2 py-2 text-center">On/Off</th>
                            <th className="text-left px-3 py-2 min-w-[200px]">Campaign name</th>
                            <th className="text-left px-3 py-2 w-[100px]">Delivery</th>
                            <th className="text-right px-3 py-2 w-[90px]">Budget</th>
                            {cols.map((col) => (
                                <th
                                    key={col.key}
                                    className={cn(
                                        'px-3 py-2',
                                        col.width,
                                        col.align === 'right' ? 'text-right' : 'text-left'
                                    )}
                                >
                                    {col.label}
                                </th>
                            ))}
                            <th className="w-8 px-2 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {campaigns.map((c) => (
                            <CampaignRow
                                key={c.id}
                                campaign={c}
                                connection={connection}
                                datePreset={datePreset}
                                visibleColumns={visibleColumns}
                                expanded={!!expanded[c.id]}
                                selected={selected.has(c.id)}
                                onToggleExpand={() => toggleExpand(c.id)}
                                onToggleSelect={() => toggleSelect(c.id)}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            <BulkActions
                connectionId={connection.id}
                selectedIds={selected}
                objectType="campaign"
                onDone={() => setSelected(new Set())}
            />
        </div>
    );
};

// ── Campaign Row ────────────────────────────────────────────────────────
const CampaignRow: React.FC<{
    campaign: MetaCampaign;
    connection: MetaConnection;
    datePreset: DatePreset;
    visibleColumns: string[];
    expanded: boolean;
    selected: boolean;
    onToggleExpand: () => void;
    onToggleSelect: () => void;
}> = ({
    campaign,
    connection,
    datePreset,
    visibleColumns,
    expanded,
    selected,
    onToggleExpand,
    onToggleSelect,
}) => {
    const ins = firstInsights(campaign);
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

    const currency = 'USD'; // overridden by parent context
    const status = getStatusStyle(campaign.effective_status || campaign.status);
    const isActive = campaign.status === 'ACTIVE';

    const budgetLabel = campaign.daily_budget
        ? `${formatCents(campaign.daily_budget, currency)}/day`
        : campaign.lifetime_budget
            ? `${formatCents(campaign.lifetime_budget, currency)}`
            : '--';

    const cols = TABLE_COLUMNS.filter((c) => visibleColumns.includes(c.key));

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
        <>
            <tr
                className={cn(
                    'border-t border-ant-line hover:bg-ant-line-soft transition-colors h-[44px]',
                    selected && 'bg-[#ebf5ff]'
                )}
            >
                <td className="px-3">
                    <Checkbox
                        checked={selected}
                        onCheckedChange={onToggleSelect}
                    />
                </td>
                <td className="px-2 text-center">
                    <StatusToggle
                        connectionId={connection.id}
                        objectType="campaign"
                        objectId={campaign.id}
                        isActive={isActive}
                    />
                </td>
                <td className="px-3">
                    <div className="text-[13px] font-semibold text-ant-ink truncate max-w-[260px]">
                        {campaign.name}
                    </div>
                    <div className="text-[11px] text-ant-mid">
                        {campaign.objective?.replace('OUTCOME_', '').replace(/_/g, ' ').toLowerCase()}
                    </div>
                </td>
                <td className="px-3">
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold',
                            status.bg,
                            status.fg
                        )}
                    >
                        <span className={cn('w-1.5 h-1.5 rounded-full', status.dot)} />
                        {status.label}
                    </span>
                </td>
                <td className="px-3 text-right">
                    <BudgetCell
                        connectionId={connection.id}
                        campaignId={campaign.id}
                        dailyBudget={campaign.daily_budget}
                        lifetimeBudget={campaign.lifetime_budget}
                        currency={currency}
                    />
                </td>
                {cols.map((col) => (
                    <td
                        key={col.key}
                        className={cn(
                            'px-3 text-[12px] tabular-nums text-ant-ink',
                            col.align === 'right' ? 'text-right' : 'text-left'
                        )}
                    >
                        {cellValue(col.key)}
                    </td>
                ))}
                <td className="px-2">
                    <button
                        onClick={onToggleExpand}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-ant-line transition"
                    >
                        {expanded ? (
                            <ChevronDown className="w-4 h-4 text-ant-muted" />
                        ) : (
                            <ChevronRight className="w-4 h-4 text-ant-muted" />
                        )}
                    </button>
                </td>
            </tr>
            {expanded && (
                <AdSetSubRows
                    connection={connection}
                    campaignId={campaign.id}
                    datePreset={datePreset}
                    visibleColumns={visibleColumns}
                    currency={currency}
                />
            )}
        </>
    );
};

// ── Budget cell with inline editing ─────────────────────────────────────
const BudgetCell: React.FC<{
    connectionId: string;
    campaignId: string;
    dailyBudget?: string | null;
    lifetimeBudget?: string | null;
    currency: string;
}> = ({ connectionId, campaignId, dailyBudget, lifetimeBudget, currency }) => {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');
    const updateBudget = useMetaUpdateBudget();
    const { toast } = useToast();

    const label = dailyBudget
        ? `${formatCents(dailyBudget, currency)}/day`
        : lifetimeBudget
            ? formatCents(lifetimeBudget, currency)
            : '--';

    const submit = async () => {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return;
        try {
            await updateBudget.mutateAsync({
                connection_id: connectionId,
                object_id: campaignId,
                daily_budget: Number(toBudgetCents(n)),
            });
            toast({ title: 'Budget updated' });
            setOpen(false);
        } catch (e) {
            toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' });
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(v) => {
                setOpen(v);
                if (v && dailyBudget) setValue(String(Number(dailyBudget) / 100));
            }}
        >
            <PopoverTrigger asChild>
                <button className="text-[12px] font-medium text-ant-ink hover:text-[#1877F2] transition tabular-nums">
                    {label}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="end">
                <div className="text-[11px] font-semibold text-ant-muted mb-2">
                    Daily budget ({currency})
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                        placeholder="0.00"
                        className="h-8 text-[13px] font-mono border-ant-line"
                    />
                    <Button
                        size="sm"
                        className="h-8 rounded-md bg-[#1877F2] hover:bg-[#166fe5] text-[12px]"
                        onClick={submit}
                        disabled={updateBudget.isPending}
                    >
                        {updateBudget.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

// ── Ad set sub-rows (lazy loaded) ───────────────────────────────────────
const AdSetSubRows: React.FC<{
    connection: MetaConnection;
    campaignId: string;
    datePreset: DatePreset;
    visibleColumns: string[];
    currency: string;
}> = ({ connection, campaignId, datePreset, visibleColumns, currency }) => {
    const { data: adsets, isLoading } = useQuery({
        queryKey: ['meta-adsets', connection.id, campaignId, datePreset],
        queryFn: async () => {
            const res = await invokeMeta<{ ok: true; adsets: any[] }>({
                action: 'list_adsets',
                connection_id: connection.id,
                campaign_id: campaignId,
                date_preset: datePreset,
            });
            return res.adsets ?? [];
        },
    });

    const [expandedAds, setExpandedAds] = useState<Record<string, boolean>>({});
    const cols = TABLE_COLUMNS.filter((c) => visibleColumns.includes(c.key));
    const colSpan = 5 + cols.length + 1;

    if (isLoading) {
        return (
            <tr className="bg-ant-line-soft">
                <td colSpan={colSpan} className="px-6 py-3">
                    <Skeleton className="h-10 w-full rounded" />
                </td>
            </tr>
        );
    }

    if (!adsets || adsets.length === 0) {
        return (
            <tr className="bg-ant-line-soft">
                <td colSpan={colSpan} className="px-6 py-3 text-[12px] text-ant-mid">
                    No ad sets in this campaign
                </td>
            </tr>
        );
    }

    return (
        <>
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
                const isExpanded = !!expandedAds[a.id];

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
                    <React.Fragment key={a.id}>
                        <tr className="bg-ant-line-soft border-t border-ant-line hover:bg-ant-light transition-colors h-[40px]">
                            <td />
                            <td className="px-2 text-center">
                                <StatusToggle
                                    connectionId={connection.id}
                                    objectType="adset"
                                    objectId={a.id}
                                    isActive={isActive}
                                />
                            </td>
                            <td className="px-3 pl-8">
                                <div className="text-[12px] font-semibold text-ant-ink truncate max-w-[240px]">
                                    {a.name}
                                </div>
                                <div className="text-[10px] text-ant-mid">
                                    {a.optimization_goal?.replace(/_/g, ' ').toLowerCase()}
                                </div>
                            </td>
                            <td className="px-3">
                                <span className={cn(
                                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
                                    status.bg, status.fg
                                )}>
                                    <span className={cn('w-1 h-1 rounded-full', status.dot)} />
                                    {status.label}
                                </span>
                            </td>
                            <td className="px-3 text-right text-[11px] text-ant-ink tabular-nums">
                                {a.daily_budget ? `${formatCents(a.daily_budget, currency)}/day` : '--'}
                            </td>
                            {cols.map((col) => (
                                <td
                                    key={col.key}
                                    className={cn(
                                        'px-3 text-[11px] tabular-nums text-ant-muted',
                                        col.align === 'right' ? 'text-right' : 'text-left'
                                    )}
                                >
                                    {cellValue(col.key)}
                                </td>
                            ))}
                            <td className="px-2">
                                <button
                                    onClick={() => setExpandedAds((s) => ({ ...s, [a.id]: !s[a.id] }))}
                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-ant-line transition"
                                >
                                    {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5 text-ant-muted" />
                                    ) : (
                                        <ChevronRight className="w-3.5 h-3.5 text-ant-muted" />
                                    )}
                                </button>
                            </td>
                        </tr>
                        {isExpanded && (
                            <AdSubRows
                                connection={connection}
                                adsetId={a.id}
                                datePreset={datePreset}
                                visibleColumns={visibleColumns}
                                currency={currency}
                                colSpan={colSpan}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </>
    );
};

// ── Individual ad sub-rows ──────────────────────────────────────────────
const AdSubRows: React.FC<{
    connection: MetaConnection;
    adsetId: string;
    datePreset: DatePreset;
    visibleColumns: string[];
    currency: string;
    colSpan: number;
}> = ({ connection, adsetId, datePreset, visibleColumns, currency, colSpan }) => {
    const { data: ads, isLoading } = useQuery({
        queryKey: ['meta-ads-for-adset', connection.id, adsetId, datePreset],
        queryFn: async () => {
            const res = await invokeMeta<{ ok: true; ads: any[] }>({
                action: 'list_ads',
                connection_id: connection.id,
                adset_id: adsetId,
                date_preset: datePreset,
            });
            return res.ads ?? [];
        },
    });

    const cols = TABLE_COLUMNS.filter((c) => visibleColumns.includes(c.key));

    if (isLoading) {
        return (
            <tr className="bg-[#fafafa]">
                <td colSpan={colSpan} className="px-8 py-2">
                    <Skeleton className="h-8 w-full rounded" />
                </td>
            </tr>
        );
    }

    if (!ads || ads.length === 0) {
        return (
            <tr className="bg-[#fafafa]">
                <td colSpan={colSpan} className="px-8 py-2 text-[11px] text-ant-mid">
                    No ads in this ad set
                </td>
            </tr>
        );
    }

    return (
        <>
            {ads.map((ad: any) => {
                const ins = firstInsights(ad);
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
                const status = getStatusStyle(ad.effective_status || ad.status);
                const isActive = ad.status === 'ACTIVE';

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
                    <tr key={ad.id} className="bg-[#fafafa] border-t border-ant-line/60 hover:bg-ant-light transition-colors h-[36px]">
                        <td />
                        <td className="px-2 text-center">
                            <StatusToggle
                                connectionId={connection.id}
                                objectType="ad"
                                objectId={ad.id}
                                isActive={isActive}
                            />
                        </td>
                        <td className="px-3 pl-14">
                            <div className="text-[11px] font-medium text-ant-ink truncate max-w-[220px]">
                                {ad.name}
                            </div>
                        </td>
                        <td className="px-3">
                            <span className={cn(
                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
                                status.bg, status.fg
                            )}>
                                <span className={cn('w-1 h-1 rounded-full', status.dot)} />
                                {status.label}
                            </span>
                        </td>
                        <td className="px-3 text-right text-[11px] text-ant-mid">--</td>
                        {cols.map((col) => (
                            <td
                                key={col.key}
                                className={cn(
                                    'px-3 text-[10px] tabular-nums text-ant-mid',
                                    col.align === 'right' ? 'text-right' : 'text-left'
                                )}
                            >
                                {cellValue(col.key)}
                            </td>
                        ))}
                        <td />
                    </tr>
                );
            })}
        </>
    );
};
