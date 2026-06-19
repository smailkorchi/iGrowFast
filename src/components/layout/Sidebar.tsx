import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    Home,
    Users,
    DollarSign,
    BarChart2,
    Megaphone,
    Settings,
    ShoppingBag,
    Truck,
    FileText,
    Repeat,
    Globe,
    CreditCard,
    Package,
    ArrowRightLeft,
    Box,
    UserPlus,
    Wallet,
    List,
    Tag,
    Upload,
    ChevronRight,
    Target,
    Zap,
    LogOut,
    PanelLeftClose,
    User as UserIcon,
    Loader2,
    Calculator,
    Wrench,
    Store,
    MessageSquare,
    Puzzle,
    Briefcase,
    LayoutDashboard,
    FileSpreadsheet,
    Receipt,
    ClipboardList,
    PackageCheck,
    Smartphone,
    BrainCircuit,
    Plug,
    LineChart,
    UserCheck,
    Bike,
    Radar,
    Trash2,
    History,
    type LucideIcon,
} from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { SiMeta } from 'react-icons/si';
import { FaGoogle } from 'react-icons/fa';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

type NavItem = {
    icon: LucideIcon | React.ComponentType<{ className?: string }>;
    label: string;
    path: string;
};

type NavSection = {
    label?: string;
    icon?: LucideIcon | React.ComponentType<{ className?: string }>;
    items: NavItem[];
};

const navigation: NavSection[] = [
    {
        items: [
            { icon: Home, label: 'Dashboard', path: '/' },
            { icon: BarChart2, label: 'Analytics', path: '/analytics' },
            { icon: FaGoogle, label: 'Google Analytics', path: '/google-analytics' },
            { icon: SiMeta, label: 'Meta Ads', path: '/meta-ads' },
        ],
    },
    {
        label: 'WhatsApp',
        icon: FaWhatsapp,
        items: [
            { icon: Smartphone, label: 'Instances', path: '/business/whatsapp/manager' },
            { icon: FaWhatsapp, label: 'Inbox', path: '/business/whatsapp/inbox' },
        ],
    },
    {
        items: [{ icon: BrainCircuit, label: 'AI Brain', path: '/business/ai-brain' }],
    },
    {
        items: [{ icon: ShoppingBag, label: 'Orders', path: '/orders' }],
    },
    {
        label: 'Shipping',
        icon: Truck,
        items: [
            { icon: FileText, label: 'Delivery Note', path: '/delivery-note' },
            { icon: Repeat, label: 'Return Note', path: '/return-note' },
            { icon: CreditCard, label: 'Payment', path: '/payments' },
            { icon: Globe, label: 'Delivery Services', path: '/delivery-services' },
            { icon: Zap, label: 'Webhooks', path: '/webhooks' },
        ],
    },
    {
        label: 'Inventory',
        icon: Package,
        items: [
            { icon: ArrowRightLeft, label: 'Transactions', path: '/transactions' },
            { icon: Box, label: 'Products', path: '/products' },
            { icon: Puzzle, label: 'Accessories', path: '/accessories' },
        ],
    },
    {
        label: 'Ads',
        icon: Megaphone,
        items: [
            { icon: Target, label: 'Global Ads', path: '/campaigns' },
            { icon: LineChart, label: 'Product Ads', path: '/ads-history' },
        ],
    },
    {
        items: [
            { icon: Plug, label: 'Sales Channels', path: '/sales-channels' },
            { icon: ClipboardList, label: 'Sheet Review', path: '/sheet-review' },
            { icon: Users, label: 'Customers', path: '/customers' },
            { icon: UserPlus, label: 'Users', path: '/users' },
        ],
    },
    {
        label: 'Collaborators',
        icon: Store,
        items: [
            { icon: UserCheck, label: 'Sellers', path: '/collaborators/sellers' },
            { icon: Bike, label: 'Couriers', path: '/collaborators/couriers' },
            { icon: Radar, label: 'Media Buyers', path: '/collaborators/mediabuyers' },
        ],
    },
    {
        items: [{ icon: DollarSign, label: 'Salaries', path: '/salaries' }],
    },
    {
        items: [
            { icon: MessageSquare, label: 'Demands', path: '/demands' },
            { icon: History, label: 'Activity Log', path: '/activity-log' },
        ],
    },
    {
        label: 'Business',
        icon: Briefcase,
        items: [
            { icon: LayoutDashboard, label: 'Overview', path: '/business' },
            { icon: Wallet, label: 'Billing', path: '/business/payments' },
        ],
    },
    {
        label: 'Expenses',
        icon: Wallet,
        items: [
            { icon: List, label: 'Expenses Details', path: '/expenses-details' },
            { icon: Repeat, label: 'Recurring Charges', path: '/recurring-charges' },
            { icon: Tag, label: 'Expenses Types', path: '/expenses-types' },
        ],
    },
    {
        label: 'Tools',
        icon: Wrench,
        items: [
            { icon: Calculator, label: 'Profit Calculator', path: '/calculator' },
            { icon: FileSpreadsheet, label: 'Devis', path: '/devis' },
            { icon: Receipt, label: 'Facture', path: '/facture' },
            { icon: ClipboardList, label: 'Bon de commande', path: '/bon-de-commande' },
            { icon: PackageCheck, label: 'Bon de livraison', path: '/bon-de-livraison' },
        ],
    },
    {
        label: 'Settings',
        icon: Settings,
        items: [
            { icon: Upload, label: 'Import Orders', path: '/import-orders' },
            { icon: Upload, label: 'Import Products', path: '/import-products' },
            { icon: Upload, label: 'Import Accessories', path: '/import-accessories' },
            { icon: Upload, label: 'Import Customers', path: '/import-customers' },
        ],
    },
];

const ALL_NAV_PATHS = navigation.flatMap((s) => s.items.map((i) => i.path));

function isParentPath(path: string): boolean {
    return ALL_NAV_PATHS.some((other) => other !== path && other.startsWith(path + '/'));
}

function findActiveSection(pathname: string): string | null {
    let best: { label: string; length: number } | null = null;
    for (const section of navigation) {
        if (!section.label) continue;
        for (const item of section.items) {
            const match = pathname === item.path || pathname.startsWith(item.path + '/');
            if (!match) continue;
            const len = item.path.length;
            if (!best || len > best.length) {
                best = { label: section.label, length: len };
            }
        }
    }
    return best?.label ?? null;
}

function isSectionActive(pathname: string, sectionLabel: string): boolean {
    return findActiveSection(pathname) === sectionLabel;
}

const Sidebar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [isPinned, setIsPinned] = React.useState(() => {
        return localStorage.getItem('sidebarPinned') === 'true';
    });

    const togglePin = () => {
        setIsPinned((prev) => {
            const next = !prev;
            localStorage.setItem('sidebarPinned', String(next));
            return next;
        });
    };

    const [expandedSection, setExpandedSection] = React.useState<string | null>(
        () => findActiveSection(location.pathname),
    );

    const toggleSection = (label: string) => {
        setExpandedSection((prev) => (prev === label ? null : label));
    };

    React.useEffect(() => {
        const label = findActiveSection(location.pathname);
        if (label) {
            setExpandedSection((prev) => (prev !== label ? label : prev));
        }
    }, [location.pathname]);

    const { data: profile, isLoading: isProfileLoading } = useQuery({
        queryKey: ['current-profile'],
        queryFn: async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            if (!user) return null;

            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) return null;
            return data;
        },
    });

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('activeBusinessId');
        navigate('/auth');
    };

    return (
        <aside
            className={cn(
                'ant-surface relative flex-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group/sidebar',
                isPinned ? 'w-[232px]' : 'w-[72px] hover:w-[232px]',
            )}
        >
            <div
                className={cn(
                    'fixed left-0 top-0 bottom-0 flex items-center z-50 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] pointer-events-none',
                    isPinned ? 'w-[232px]' : 'w-[72px] group-hover/sidebar:w-[232px]',
                )}
            >
                <div
                    className={cn(
                        'flex flex-col ml-3 h-[calc(100vh-1.5rem)] bg-ant-ink rounded-[20px] text-ant-light transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden border border-white/[0.06] pointer-events-auto shadow-[0_24px_60px_-24px_rgba(20,20,19,0.55)]',
                        isPinned
                            ? 'w-[216px] group/sidebar-inner'
                            : 'w-[60px] group-hover/sidebar:w-[216px] group/sidebar-inner',
                    )}
                    data-pinned={isPinned}
                >
                    {/* Brand mark */}
                    <div className="flex items-center h-14 shrink-0 px-2">
                        <div className="flex items-center w-full h-10 rounded-xl relative">
                            <div className="w-[44px] h-10 flex items-center justify-center shrink-0">
                                <div className="w-8 h-8 rounded-[10px] bg-ant-orange flex items-center justify-center overflow-hidden p-1 transition-transform duration-700 group-hover/sidebar-inner:rotate-[360deg] group-data-[pinned=true]/sidebar-inner:rotate-[360deg]">
                                    <img
                                        src="/Logo/iGrowFast Icon Transparent.png"
                                        alt="iGrowFast"
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                            </div>
                            <span className="ml-2 font-display font-semibold text-[15px] tracking-tight text-ant-light opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-100 whitespace-nowrap overflow-hidden">
                                iGrowFast
                                <span className="text-ant-orange">.</span>
                            </span>
                        </div>
                    </div>

                    <div className="mx-3 border-t border-white/[0.06]" />

                    {/* Nav — no-scrollbar hides native scrollbar (collapsed-width horizontal-overflow bug) */}
                    <div className="flex-1 px-2 pt-2 space-y-0.5 overflow-y-auto overflow-x-hidden no-scrollbar pb-3 scroll-smooth">
                        {navigation.map((section, idx) => (
                            <div key={idx} className="space-y-0.5">
                                {section.label ? (
                                    <>
                                        <button
                                            onClick={() => toggleSection(section.label!)}
                                            className={cn(
                                                'flex items-center w-full h-9 rounded-lg transition-all duration-300 group/item relative',
                                                'hover:bg-white/[0.04]',
                                                expandedSection === section.label ||
                                                    isSectionActive(location.pathname, section.label!)
                                                    ? 'text-ant-light'
                                                    : 'text-ant-light/50 hover:text-ant-light',
                                            )}
                                        >
                                            <div className="w-[44px] h-9 flex items-center justify-center shrink-0">
                                                {section.icon && (
                                                    <section.icon className="w-[15px] h-[15px]" />
                                                )}
                                            </div>
                                            <div className="flex-1 flex items-center justify-between pr-3 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75">
                                                <span className="font-medium text-[12px] whitespace-nowrap tracking-tight">
                                                    {section.label}
                                                </span>
                                                <ChevronRight
                                                    className={cn(
                                                        'w-3 h-3 transition-transform duration-300 text-ant-mid',
                                                        expandedSection === section.label &&
                                                            'rotate-90 text-ant-orange',
                                                    )}
                                                />
                                            </div>
                                        </button>

                                        <div
                                            className={cn(
                                                'overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]',
                                                expandedSection === section.label
                                                    ? 'max-h-[420px] opacity-100 mt-0.5'
                                                    : 'max-h-0 opacity-0',
                                            )}
                                        >
                                            <div className="relative ml-[22px] pl-3 border-l border-white/[0.07] space-y-px">
                                                {section.items.map((item) => (
                                                    <NavLink
                                                        key={item.path}
                                                        to={item.path}
                                                        end={isParentPath(item.path)}
                                                        className={({ isActive }) =>
                                                            cn(
                                                                'flex items-center h-8 rounded-md transition-all duration-300 group/subitem relative',
                                                                isActive
                                                                    ? 'text-ant-light'
                                                                    : 'text-ant-light/45 hover:text-ant-light',
                                                            )
                                                        }
                                                    >
                                                        {({ isActive }) => (
                                                            <>
                                                                {isActive && (
                                                                    <span
                                                                        aria-hidden
                                                                        className="absolute -left-3 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-ant-orange"
                                                                    />
                                                                )}
                                                                <div className="w-[28px] h-8 flex items-center justify-center shrink-0">
                                                                    <item.icon
                                                                        className={cn(
                                                                            'w-[13px] h-[13px]',
                                                                            isActive
                                                                                ? 'text-ant-orange'
                                                                                : 'text-ant-light/40 group-hover/subitem:text-ant-light',
                                                                        )}
                                                                    />
                                                                </div>
                                                                <span className="font-medium text-[11.5px] opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                                                                    {item.label}
                                                                </span>
                                                            </>
                                                        )}
                                                    </NavLink>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-px">
                                        {section.items.map((item) => (
                                            <NavLink
                                                key={item.path}
                                                to={item.path}
                                                end={isParentPath(item.path)}
                                                className={({ isActive }) =>
                                                    cn(
                                                        'flex items-center h-9 rounded-lg transition-all duration-300 group/item relative',
                                                        isActive
                                                            ? 'bg-white/[0.06] text-ant-light'
                                                            : 'text-ant-light/55 hover:text-ant-light hover:bg-white/[0.035]',
                                                    )
                                                }
                                            >
                                                {({ isActive }) => (
                                                    <>
                                                        {isActive && (
                                                            <span
                                                                aria-hidden
                                                                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-ant-orange"
                                                            />
                                                        )}
                                                        <div className="w-[44px] h-9 flex items-center justify-center shrink-0">
                                                            <item.icon
                                                                className={cn(
                                                                    'w-[15px] h-[15px]',
                                                                    isActive
                                                                        ? 'text-ant-orange'
                                                                        : 'text-ant-light/50 group-hover/item:text-ant-light',
                                                                )}
                                                            />
                                                        </div>
                                                        <span className="font-medium text-[12px] tracking-tight opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                                                            {item.label}
                                                        </span>
                                                    </>
                                                )}
                                            </NavLink>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        <div className="mt-1 pt-1 border-t border-white/[0.05]">
                            <NavLink
                                to="/trash"
                                end={isParentPath('/trash')}
                                className={({ isActive }) =>
                                    cn(
                                        'flex items-center h-9 rounded-lg transition-all duration-300 group/item relative',
                                        isActive
                                            ? 'bg-white/[0.06] text-ant-light'
                                            : 'text-ant-light/45 hover:text-ant-light hover:bg-white/[0.035]',
                                    )
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        {isActive && (
                                            <span
                                                aria-hidden
                                                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-ant-orange"
                                            />
                                        )}
                                        <div className="w-[44px] h-9 flex items-center justify-center shrink-0">
                                            <Trash2
                                                className={cn(
                                                    'w-[15px] h-[15px]',
                                                    isActive
                                                        ? 'text-ant-orange'
                                                        : 'text-ant-light/45 group-hover/item:text-ant-light',
                                                )}
                                            />
                                        </div>
                                        <span className="font-medium text-[12px] tracking-tight opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                                            Trash
                                        </span>
                                    </>
                                )}
                            </NavLink>
                        </div>
                    </div>

                    {/* Profile */}
                    <div className="px-2 pt-2 pb-1.5 border-t border-white/[0.06]">
                        <NavLink
                            to="/profile"
                            end={isParentPath('/profile')}
                            className={({ isActive }) =>
                                cn(
                                    'flex items-center h-11 rounded-lg transition-all duration-300 group/profile relative',
                                    isActive
                                        ? 'bg-white/[0.06]'
                                        : 'hover:bg-white/[0.04]',
                                )
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    {isActive && (
                                        <span
                                            aria-hidden
                                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-ant-orange"
                                        />
                                    )}
                                    <div className="w-[44px] h-11 flex items-center justify-center shrink-0">
                                        <div
                                            className={cn(
                                                'w-8 h-8 rounded-full overflow-hidden bg-ant-ink-soft flex items-center justify-center transition-all duration-500 group-hover/profile:scale-105',
                                                isActive ? 'ring-2 ring-ant-orange' : 'ring-1 ring-white/10',
                                            )}
                                        >
                                            {isProfileLoading ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-ant-light" />
                                            ) : profile?.avatar_url ? (
                                                <img
                                                    src={profile.avatar_url}
                                                    className="w-full h-full object-cover"
                                                    alt=""
                                                />
                                            ) : (
                                                <UserIcon
                                                    className={cn(
                                                        'w-3.5 h-3.5',
                                                        isActive ? 'text-ant-orange' : 'text-ant-light/70',
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    <div className="ml-1.5 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-150 whitespace-nowrap overflow-hidden">
                                        <span className="block text-[11.5px] font-medium text-ant-light tracking-tight truncate max-w-[140px]">
                                            {profile?.name || 'User'}
                                        </span>
                                        <span className="flex items-center gap-1 mt-0.5">
                                            <span className="w-1 h-1 rounded-full bg-ant-green" />
                                            <span
                                                className={cn(
                                                    'text-[9px] font-medium uppercase tracking-[0.18em]',
                                                    isActive ? 'text-ant-orange' : 'text-ant-mid',
                                                )}
                                            >
                                                {profile?.role || 'Admin'}
                                            </span>
                                        </span>
                                    </div>
                                </>
                            )}
                        </NavLink>
                    </div>

                    {/* Actions */}
                    <div className="px-2 pb-3 flex items-center gap-1.5">
                        <button
                            onClick={handleLogout}
                            className="flex-1 flex items-center h-9 rounded-lg text-ant-light/40 hover:text-ant-rose hover:bg-white/[0.04] transition-all duration-300"
                            title="Logout"
                        >
                            <div className="w-[44px] h-9 flex items-center justify-center shrink-0">
                                <LogOut className="w-[14px] h-[14px]" />
                            </div>
                            <span className="font-medium text-[12px] tracking-tight opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                                Logout
                            </span>
                        </button>

                        <button
                            onClick={togglePin}
                            className={cn(
                                'w-9 h-9 shrink-0 flex items-center justify-center rounded-lg transition-all duration-300',
                                isPinned
                                    ? 'text-ant-light bg-white/[0.08]'
                                    : 'text-ant-light/35 hover:text-ant-light hover:bg-white/[0.05] opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100',
                            )}
                            title={isPinned ? 'Unpin Sidebar' : 'Pin Sidebar'}
                        >
                            <PanelLeftClose
                                className={cn(
                                    'w-4 h-4 transition-transform duration-300',
                                    !isPinned && 'rotate-180',
                                )}
                            />
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
