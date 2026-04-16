import React from 'react';
import { cn } from '@/lib/utils';

export type ManagerTab = 'campaigns' | 'adsets' | 'ads' | 'pixel';

interface Props {
    value: ManagerTab;
    onChange: (tab: ManagerTab) => void;
    counts: { campaigns: number; adsets: number; ads: number };
}

const TABS: { key: ManagerTab; label: string; countKey?: keyof Props['counts'] }[] = [
    { key: 'campaigns', label: 'Campaigns', countKey: 'campaigns' },
    { key: 'adsets', label: 'Ad sets', countKey: 'adsets' },
    { key: 'ads', label: 'Ads', countKey: 'ads' },
    { key: 'pixel', label: 'Pixel' },
];

export const ManagerTabs: React.FC<Props> = ({ value, onChange, counts }) => (
    <div className="flex items-center border-b border-[#e4e6eb] bg-white">
        {TABS.map((tab) => {
            const active = value === tab.key;
            const count = tab.countKey ? counts[tab.countKey] : undefined;
            return (
                <button
                    key={tab.key}
                    onClick={() => onChange(tab.key)}
                    className={cn(
                        'relative px-4 h-10 text-[13px] font-semibold transition-colors whitespace-nowrap',
                        active
                            ? 'text-[#1877F2]'
                            : 'text-[#606770] hover:text-[#1c1e21] hover:bg-[#f7f8fa]'
                    )}
                >
                    {tab.label}
                    {count !== undefined && count > 0 && (
                        <span className={cn(
                            'ml-1.5 text-[11px]',
                            active ? 'text-[#1877F2]' : 'text-[#8a8d91]'
                        )}>
                            ({count})
                        </span>
                    )}
                    {active && (
                        <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1877F2] rounded-t" />
                    )}
                </button>
            );
        })}
    </div>
);
