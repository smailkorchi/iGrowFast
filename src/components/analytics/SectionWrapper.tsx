import { ReactNode, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LucideIcon, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface SectionWrapperProps {
    id: string;
    title: string;
    description: string;
    icon: LucideIcon;
    /** Kept for backwards compat with old call sites — ignored in the new design. */
    iconBg?: string;
    iconColor?: string;
    children: ReactNode;
    loading?: boolean;
    defaultOpen?: boolean;
}

// Ordered index of the sections on the Analytics page. Kept in sync with
// src/pages/Analytics.tsx. Used to render the chapter number prefix.
const SECTION_ORDER: Record<string, number> = {
    profitability: 1,
    orders: 2,
    ads: 3,
    shipping: 4,
    inventory: 5,
    channels: 6,
    customers: 7,
    sellers: 8,
    couriers: 9,
    mediabuyers: 10,
    users: 11,
    'business-health': 12,
};

export const SectionWrapper = ({
    id,
    title,
    description,
    icon: Icon,
    children,
    loading = false,
    defaultOpen = true,
}: SectionWrapperProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const chapter = SECTION_ORDER[id];

    return (
        <motion.section
            id={id}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.35 }}
            className="ant-surface rounded-xl border border-ant-line bg-ant-paper overflow-hidden"
        >
            {/* Editorial chapter header */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between gap-4 px-4 md:px-5 py-3 text-left hover:bg-ant-line-soft transition-colors"
            >
                <div className="flex items-center gap-3 min-w-0">
                    {chapter !== undefined && (
                        <span className="font-display text-[11px] font-semibold tabular-nums tracking-[0.14em] text-ant-orange shrink-0">
                            {String(chapter).padStart(2, '0')}
                        </span>
                    )}
                    <span className="w-[1px] h-6 bg-ant-line shrink-0" aria-hidden />
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-3.5 h-3.5 text-ant-mid shrink-0" strokeWidth={1.75} />
                        <div className="min-w-0">
                            <h2 className="font-display text-[15px] font-semibold text-ant-ink leading-tight tracking-tight truncate">
                                {title}
                            </h2>
                            <p className="font-serif-display text-[11.5px] text-ant-muted italic leading-tight mt-0.5 truncate">
                                {description}
                            </p>
                        </div>
                    </div>
                </div>
                <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full border border-ant-line text-ant-mid"
                >
                    <ChevronDown className="w-3.5 h-3.5" />
                </motion.span>
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                    >
                        <div className="border-t border-ant-line px-4 md:px-5 py-4">
                            {loading ? <SectionSkeleton /> : children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.section>
    );
};

const SectionSkeleton = () => (
    <div className="space-y-3">
        <div className="space-y-2">
            <Skeleton className={cn('h-4 w-32 rounded bg-ant-line-soft')} />
            <Skeleton className={cn('h-10 w-48 rounded bg-ant-line-soft')} />
            <Skeleton className={cn('h-3 w-80 rounded bg-ant-line-soft')} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg bg-ant-line-soft" />
            ))}
        </div>
        <Skeleton className="h-40 rounded-xl bg-ant-line-soft" />
    </div>
);
