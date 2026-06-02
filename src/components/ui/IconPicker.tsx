import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DynamicIcon, getAllIconNamesAsync } from '@/lib/renderReactIcon';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 80;

// Curated delivery/status icons shown by default before any search.
// Restricted to the only packs DynamicIcon now supports: Fa (FontAwesome), Tb (Tabler),
// Bs (Bootstrap) — the libraries the statuses actually use. (Md/Lu/Bi/Hi/Ci/Go/Pi/Fi were
// removed; several never rendered.)
const FEATURED_ICONS = [
    // Delivery & Shipping
    'FaTruck', 'FaTruckMoving', 'FaTruckLoading', 'FaShippingFast', 'FaTruckPickup',
    'FaBox', 'FaBoxOpen', 'FaBoxes', 'FaWarehouse',
    'TbTruckDelivery', 'TbPackage', 'TbPackages', 'TbBox',
    'BsTruck', 'BsBox', 'BsBoxSeam',
    // Status-related
    'FaCheckCircle', 'FaCheck', 'FaTimesCircle', 'FaBan', 'FaClock', 'FaPause', 'FaRedo', 'FaUndo',
    'TbCircleCheck', 'TbCircleX', 'TbClock', 'TbRefresh', 'TbRepeat',
    'BsCheckCircle', 'BsXCircle', 'BsClockHistory', 'BsArrowRepeat',
    // Location & Navigation
    'FaMapMarkerAlt', 'FaRoute', 'TbMapPin', 'TbRoute', 'BsGeoAlt',
    // People & Contact
    'FaUser', 'FaUserCheck', 'FaPhone', 'FaPhoneAlt',
    'TbUser', 'TbUserCheck', 'TbPhone', 'BsPerson', 'BsTelephone',
    // Commerce
    'FaShoppingCart', 'FaReceipt', 'FaMoneyBillWave', 'FaCreditCard', 'FaStore',
    'TbShoppingCart', 'TbReceipt', 'TbCash', 'BsReceipt', 'BsCart',
    // Alerts & Info
    'FaExclamationTriangle', 'FaInfoCircle', 'FaBell', 'FaEye',
    'TbAlertTriangle', 'TbInfoCircle', 'TbBell', 'BsExclamationTriangle', 'BsInfoCircle', 'BsBell',
    // Arrows & Actions
    'FaArrowRight', 'FaArrowLeft', 'FaArrowUp', 'FaArrowDown',
    'TbArrowBack', 'TbArrowForward', 'TbArrowsExchange',
    'BsArrowReturnLeft', 'BsArrowReturnRight',
];

// No sync getNames — we use async loading in the component

export function IconPicker({
    value,
    onChange,
    className,
}: {
    value: string;
    onChange: (name: string) => void;
    className?: string;
}) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [page, setPage] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    const [allNames, setAllNames] = useState<string[]>([]);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    // Lazy-load all icon names only when picker opens
    useEffect(() => {
        if (!isOpen || allNames.length > 0) return;
        let cancelled = false;
        getAllIconNamesAsync().then(names => {
            if (!cancelled) setAllNames(names);
        });
        return () => { cancelled = true; };
    }, [isOpen, allNames.length]);

    const filtered = useMemo(() => {
        // Once the packs are loaded, drop any featured name that isn't a real icon
        // (guards against blanks if a curated name doesn't exist in the trimmed packs).
        const allSet = new Set(allNames);
        const featured = allNames.length ? FEATURED_ICONS.filter(n => allSet.has(n)) : FEATURED_ICONS;
        if (!search.trim()) {
            // Show featured icons immediately, no need for allNames
            if (page === 1) return featured;
            if (!allNames.length) return featured;
            const featuredSet = new Set(featured);
            const rest = allNames.filter(n => !featuredSet.has(n));
            return [...featured, ...rest.slice(0, PAGE_SIZE * (page - 1))];
        }
        // Need allNames for search
        const source = allNames.length > 0 ? allNames : FEATURED_ICONS;
        const q = search.toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const matches = source.filter(n => {
            const lower = n.toLowerCase();
            return words.every(w => lower.includes(w));
        });
        return matches.slice(0, PAGE_SIZE * page);
    }, [search, allNames, page]);

    const totalMatches = useMemo(() => {
        if (!search.trim()) return allNames.length || FEATURED_ICONS.length;
        const source = allNames.length > 0 ? allNames : FEATURED_ICONS;
        const q = search.toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        return source.filter(n => {
            const lower = n.toLowerCase();
            return words.every(w => lower.includes(w));
        }).length;
    }, [search, allNames]);

    // Reset page when search changes
    useEffect(() => {
        setPage(1);
    }, [search]);

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            {/* Trigger button */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 w-full h-12 px-4 rounded-2xl bg-brand-navy/[0.04] shadow-inner hover:bg-brand-navy/[0.07] transition-colors"
            >
                {value ? (
                    <>
                        <div className="w-8 h-8 rounded-xl bg-brand-navy/10 flex items-center justify-center">
                            <DynamicIcon name={value} className="w-4 h-4 text-brand-navy" />
                        </div>
                        <span className="text-sm font-bold text-brand-navy flex-1 text-left truncate">{value}</span>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onChange(''); }}
                            className="p-1 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </>
                ) : (
                    <span className="text-sm font-medium text-brand-navy/30">Choose an icon...</span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
                    {/* Search */}
                    <div className="p-3 border-b border-slate-100">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="truck, delivery, package, check, cancel, phone..."
                                className="pl-10 h-10 rounded-xl border-none bg-slate-50 text-sm font-medium"
                                autoFocus
                            />
                        </div>
                        <p className="text-[10px] font-medium text-muted-foreground mt-2 px-1">
                            {allNames.length > 0
                                ? `${totalMatches.toLocaleString()} icons${search ? ` matching "${search}"` : ''}`
                                : search ? 'Loading icons...' : `${FEATURED_ICONS.length} featured icons`}
                        </p>
                    </div>

                    {/* Grid */}
                    <div className="max-h-64 overflow-y-auto p-3">
                        <div className="grid grid-cols-8 gap-1">
                            {filtered.map((name) => (
                                <button
                                    key={name}
                                    type="button"
                                    title={name}
                                    onClick={() => {
                                        onChange(name);
                                        setIsOpen(false);
                                        setSearch('');
                                    }}
                                    className={cn(
                                        'w-full aspect-square rounded-xl flex items-center justify-center transition-all hover:bg-brand-navy/10 hover:scale-110',
                                        value === name ? 'bg-brand-navy text-white shadow-lg' : 'text-slate-600'
                                    )}
                                >
                                    <DynamicIcon name={name} className="w-4 h-4" />
                                </button>
                            ))}
                        </div>

                        {/* Load more */}
                        {filtered.length < totalMatches && (
                            <button
                                type="button"
                                onClick={() => setPage(p => p + 1)}
                                className="w-full mt-3 py-2 text-xs font-bold text-brand-navy/60 hover:text-brand-navy hover:bg-slate-50 rounded-xl transition-colors"
                            >
                                Load more ({totalMatches - filtered.length} remaining)
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
