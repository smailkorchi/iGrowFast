import React from 'react';
import { Check, ChevronsUpDown, Filter, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColumnCustomizer } from './ColumnCustomizer';
import type { DatePreset } from '@/hooks/useMetaAds';

const PRESETS: { key: DatePreset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last_7d', label: 'Last 7 days' },
    { key: 'last_28d', label: 'Last 28 days' },
    { key: 'last_90d', label: 'Last 90 days' },
    { key: 'this_month', label: 'This month' },
    { key: 'last_month', label: 'Last month' },
    { key: 'maximum', label: 'Maximum' },
];

interface Props {
    searchQuery: string;
    onSearchChange: (q: string) => void;
    datePreset: DatePreset;
    onDatePresetChange: (p: DatePreset) => void;
    visibleColumns: string[];
    onColumnsChange: (cols: string[]) => void;
    onCreateCampaign: () => void;
    showCreate: boolean;
}

export const ManagerToolbar: React.FC<Props> = ({
    searchQuery,
    onSearchChange,
    datePreset,
    onDatePresetChange,
    visibleColumns,
    onColumnsChange,
    onCreateCampaign,
    showCreate,
}) => {
    const currentPreset = PRESETS.find((p) => p.key === datePreset);

    return (
        <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-ant-line">
            {/* Search */}
            <div className="relative w-[240px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                <Input
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search"
                    className="h-8 pl-8 rounded-md border-ant-line text-[13px] placeholder:text-ant-mid focus:border-[#1877F2] focus:ring-1 focus:ring-[#1877F2]/30"
                />
            </div>

            {/* Filters (placeholder) */}
            <button className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-ant-line bg-white text-[13px] text-ant-muted hover:bg-ant-line-soft transition">
                <Filter className="w-3.5 h-3.5" />
                Filters
            </button>

            {/* Columns */}
            <ColumnCustomizer
                visibleColumns={visibleColumns}
                onChange={onColumnsChange}
            />

            {/* Date range */}
            <Popover>
                <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-ant-line bg-white text-[13px] font-medium text-ant-ink hover:bg-ant-line-soft transition">
                        {currentPreset?.label ?? 'Date range'}
                        <ChevronsUpDown className="w-3 h-3 text-ant-mid" />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-48 p-1">
                    {PRESETS.map((p) => (
                        <button
                            key={p.key}
                            onClick={() => onDatePresetChange(p.key)}
                            className={cn(
                                'w-full flex items-center justify-between px-3 py-1.5 rounded text-[12px] text-left hover:bg-ant-line-soft',
                                datePreset === p.key
                                    ? 'bg-[#ebf5ff] text-[#1877F2] font-semibold'
                                    : 'text-ant-ink'
                            )}
                        >
                            <span>{p.label}</span>
                            {datePreset === p.key && <Check className="w-3.5 h-3.5" />}
                        </button>
                    ))}
                </PopoverContent>
            </Popover>

            <div className="flex-1" />

            {/* Create campaign */}
            {showCreate && (
                <button
                    onClick={onCreateCampaign}
                    className="flex items-center gap-1.5 h-8 px-4 rounded-md bg-[#1877F2] hover:bg-[#166fe5] text-white text-[13px] font-semibold transition"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Create
                </button>
            )}
        </div>
    );
};
