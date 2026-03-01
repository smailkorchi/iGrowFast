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
    iconBg = 'bg-brand-navy/5',
    iconColor = 'text-brand-navy',
    children,
    loading = false,
    defaultOpen = true,
}: SectionWrapperProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <motion.section
            id={id}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5 }}
        >
            <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
                <CardHeader
                    className="cursor-pointer select-none"
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center', iconBg)}>
                                <Icon className={cn('w-6 h-6', iconColor)} />
                            </div>
                            <div>
                                <CardTitle className="text-lg font-black text-brand-navy">
                                    {title}
                                </CardTitle>
                                <CardDescription className="text-xs text-gray-400 mt-0.5">
                                    {description}
                                </CardDescription>
                            </div>
                        </div>
                        <motion.div
                            animate={{ rotate: isOpen ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                        </motion.div>
                    </div>
                </CardHeader>
                <AnimatePresence initial={false}>
                    {isOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                        >
                            <CardContent className="pt-0">
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
    <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
        </div>
    </div>
);
