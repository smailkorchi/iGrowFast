import React from 'react';
import { Columns3 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { TABLE_COLUMNS, COLUMN_PRESETS } from '../shared/metaTheme';
import { cn } from '@/lib/utils';

interface Props {
    visibleColumns: string[];
    onChange: (cols: string[]) => void;
}

export const ColumnCustomizer: React.FC<Props> = ({ visibleColumns, onChange }) => {
    const toggle = (key: string) => {
        if (visibleColumns.includes(key)) {
            onChange(visibleColumns.filter((c) => c !== key));
        } else {
            onChange([...visibleColumns, key]);
        }
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-[#ccd0d5] bg-white text-[13px] text-[#1c1e21] hover:bg-[#f7f8fa] transition">
                    <Columns3 className="w-3.5 h-3.5 text-[#606770]" />
                    Columns
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[280px] p-0">
                {/* Presets */}
                <div className="px-3 pt-3 pb-2 border-b border-[#e4e6eb]">
                    <div className="text-[11px] font-semibold text-[#606770] uppercase tracking-wider mb-2">
                        Presets
                    </div>
                    <div className="flex gap-1.5">
                        {Object.entries(COLUMN_PRESETS).map(([name, cols]) => {
                            const isActive =
                                cols.length === visibleColumns.length &&
                                cols.every((c) => visibleColumns.includes(c));
                            return (
                                <button
                                    key={name}
                                    onClick={() => onChange([...cols])}
                                    className={cn(
                                        'px-2.5 py-1 rounded text-[11px] font-medium transition',
                                        isActive
                                            ? 'bg-[#ebf5ff] text-[#1877F2]'
                                            : 'bg-[#f0f2f5] text-[#606770] hover:bg-[#e4e6eb]'
                                    )}
                                >
                                    {name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Individual columns */}
                <div className="px-3 py-2 max-h-[300px] overflow-y-auto space-y-1">
                    {TABLE_COLUMNS.map((col) => (
                        <label
                            key={col.key}
                            className="flex items-center gap-2.5 py-1 cursor-pointer hover:bg-[#f7f8fa] rounded px-1 -mx-1"
                        >
                            <Checkbox
                                checked={visibleColumns.includes(col.key)}
                                onCheckedChange={() => toggle(col.key)}
                            />
                            <span className="text-[12px] text-[#1c1e21]">{col.label}</span>
                        </label>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
};
