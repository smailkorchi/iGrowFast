import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    title: string;
    subtitle?: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
    badge?: React.ReactNode;
}

export const AccordionSection: React.FC<Props> = ({
    title,
    subtitle,
    defaultOpen = true,
    children,
    badge,
}) => {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="bg-white rounded-2xl border border-[#dddfe2] shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#f7f8fa] transition-colors"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div>
                        <div className="text-[15px] font-semibold text-[#1c1e21] leading-tight">
                            {title}
                        </div>
                        {subtitle && (
                            <div className="text-[12px] text-[#8a8d91] mt-0.5">{subtitle}</div>
                        )}
                    </div>
                    {badge && <div className="ml-2">{badge}</div>}
                </div>
                <motion.div
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                >
                    <ChevronDown className="w-5 h-5 text-[#606770]" />
                </motion.div>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-5 pt-1 border-t border-[#e4e6eb]">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
