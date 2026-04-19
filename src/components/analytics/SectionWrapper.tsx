import { ReactNode, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LucideIcon, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface SectionWrapperProps {
    id: string;
    title: string;
    description: string;
    icon: LucideIcon;
    iconBg?: string;
    iconColor?: string;
    children: ReactNode;
    loading?: boolean;
    defaultOpen?: boolean;
}

export const SectionWrapper = ({
    id,
    title,
    description,
    icon: Icon,
    iconColor = 'text-gray-400',
    children,
    loading = false,
    defaultOpen = true,
}: SectionWrapperProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <motion.section
            id={id}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.35 }}
        >
            <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                <CardHeader
                    className="cursor-pointer select-none px-3.5 pt-2.5 pb-2"
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Icon className={cn('w-3 h-3', iconColor)} />
                            <div>
                                <CardTitle className="text-[12px] font-semibold text-brand-navy leading-tight">
                                    {title}
                                </CardTitle>
                                <CardDescription className="text-[9px] text-gray-400 uppercase tracking-[0.14em] mt-0.5">
                                    {description}
                                </CardDescription>
                            </div>
                        </div>
                        <motion.div
                            animate={{ rotate: isOpen ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                        </motion.div>
                    </div>
                </CardHeader>
                <AnimatePresence initial={false}>
                    {isOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: 'easeInOut' }}
                        >
                            <CardContent className="px-3.5 pb-3.5 pt-0">
                                {loading ? <SectionSkeleton /> : children}
                            </CardContent>
                        </motion.div>
                    )}
                </AnimatePresence>
            </Card>
        </motion.section>
    );
};

const SectionSkeleton = () => (
    <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
        </div>
    </div>
);
