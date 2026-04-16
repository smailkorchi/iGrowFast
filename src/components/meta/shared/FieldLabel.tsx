import React from 'react';
import { HelpCircle } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';

interface Props {
    children: React.ReactNode;
    tooltip?: string;
    required?: boolean;
}

export const FieldLabel: React.FC<Props> = ({ children, tooltip, required }) => (
    <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[13px] font-semibold text-[#1c1e21]">
            {children}
            {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {tooltip && (
            <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                    <button type="button" className="w-[14px] h-[14px] rounded-full bg-[#e4e6eb] flex items-center justify-center hover:bg-[#d8dadf] transition">
                        <HelpCircle className="w-[10px] h-[10px] text-[#606770]" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-xs">
                    {tooltip}
                </TooltipContent>
            </Tooltip>
        )}
    </div>
);

export const FieldHelper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-[12px] text-[#8a8d91] mt-1.5 leading-relaxed">{children}</p>
);
