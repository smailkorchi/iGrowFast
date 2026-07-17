import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    Home,
    BarChart2,
    Megaphone,
    CreditCard,
    MessageSquare,
    ShoppingCart,
    Target,
    LineChart,
    ChevronRight,
    LogOut,
    PanelLeftClose,
    Loader2,
    type LucideIcon,
} from 'lucide-react';
import { SiMeta } from 'react-icons/si';
import { FaGoogle } from 'react-icons/fa';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/users/UserAvatar';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';

type SidebarIcon = LucideIcon | React.ComponentType<{ className?: string }>;

type NavItem = {
    icon: SidebarIcon;
    label: string;
    path: string;
};

type NavSection = {
    label?: string;
    icon?: SidebarIcon;
    items: NavItem[];
};

// Google Analytics / Meta Ads are inserted right under Statistiques at runtime,
// but only for the integrations this media buyer was granted access to.
const GA_NAV: NavItem = { icon: FaGoogle, label: 'Google Analytics', path: '/mediabuyer/google-analytics' };
const META_NAV: NavItem = { icon: SiMeta, label: 'Meta Ads', path: '/mediabuyer/meta-ads' };

const baseNavigation: NavSection[] = [
    {
        items: [
            { icon: Home, label: 'Tableau de bord', path: '/mediabuyer/dashboard' },
            { icon: BarChart2, label: 'Statistiques', path: '/mediabuyer/statistics' },
        ],
    },
    {
        label: 'Publicités',
        icon: Megaphone,
        items: [
            { icon: Target, label: 'Campagnes globales', path: '/mediabuyer/campaigns' },
            { icon: LineChart, label: 'Publicités produits', path: '/mediabuyer/product-ads' },
        ],
    },
    {
        items: [
            { icon: ShoppingCart, label: 'Commandes', path: '/mediabuyer/orders' },
            { icon: CreditCard, label: 'Paiements', path: '/mediabuyer/payments' },
            { icon: MessageSquare, label: 'Demandes', path: '/mediabuyer/demands' },
        ],
    },
];

const isParentPath = (path: string) => path === '/mediabuyer/dashboard';

const isSectionActive = (pathname: string, label: string): boolean => {
    const section = baseNavigation.find((s) => s.label === label);
    if (!section) return false;
    return section.items.some((item) => pathname === item.path || pathname.startsWith(item.path + '/'));
};

const MediaBuyerSidebar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [isPinned, setIsPinned] = React.useState(() => {
        return localStorage.getItem('sidebarPinned') === 'true';
    });

    const [expandedSection, setExpandedSection] = React.useState<string | null>(() => {
        let active: string | null = null;
        baseNavigation.forEach((section) => {
            if (section.label && isSectionActive(location.pathname, section.label)) {
                active = section.label;
            }
        });
        return active;
    });

    const toggleSection = (label: string) => {
        setExpandedSection((prev) => (prev === label ? null : label));
    };

    React.useEffect(() => {
        baseNavigation.forEach((section) => {
            if (section.label && isSectionActive(location.pathname, section.label)) {
                const label = section.label;
                setExpandedSection((prev) => (prev !== label ? label : prev));
            }
        });
    }, [location.pathname]);

    const togglePin = () => {
        setIsPinned(prev => {
            const next = !prev;
            localStorage.setItem('sidebarPinned', String(next));
            return next;
        });
    };

    // Canonical shared profile (['current-profile'], PROFILE_COLS, staleTime
    // 5min, getSession) — same hook as the admin/owner/courier/seller sidebars.
    const { data: profile, isLoading: isProfileLoading } = useCurrentProfile();

    // Show the GA / Meta nav items only for integrations this media buyer can access.
    // RLS scopes these tables to the buyer's allow-list, so a count > 0 means "has access".
    const { data: hasGa } = useQuery({
        queryKey: ['mb-sidebar-has-ga'],
        queryFn: async () => {
            const { count } = await supabase
                .from('google_analytics_connections')
                .select('id', { count: 'exact', head: true });
            return (count ?? 0) > 0;
        },
        staleTime: 5 * 60 * 1000, // allow-list changes are rare admin actions
    });
    const { data: hasMeta } = useQuery({
        queryKey: ['mb-sidebar-has-meta'],
        queryFn: async () => {
            const { count } = await supabase
                .from('meta_ads_connections')
                .select('id', { count: 'exact', head: true });
            return (count ?? 0) > 0;
        },
        staleTime: 5 * 60 * 1000, // allow-list changes are rare admin actions
    });

    const navigation = React.useMemo(() => {
        const extras: NavItem[] = [];
        if (hasGa) extras.push(GA_NAV);
        if (hasMeta) extras.push(META_NAV);
        if (extras.length === 0) return baseNavigation;
        const nav = baseNavigation.map((s) => ({ ...s, items: [...s.items] }));
        nav[0].items.push(...extras); // directly under "Statistiques" in the top group
        return nav;
    }, [hasGa, hasMeta]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/auth');
    };

    return (
        <aside
            className={cn(
                'ant-surface relative flex-none transition-all duration-700 ease-smooth group/sidebar',
                isPinned ? 'w-[232px]' : 'w-[72px] hover:w-[232px]',
            )}
        >
            <div
                className={cn(
                    'fixed left-0 top-0 bottom-0 flex items-center z-50 transition-all duration-700 ease-smooth pointer-events-none',
                    isPinned ? 'w-[232px]' : 'w-[72px] group-hover/sidebar:w-[232px]',
                )}
            >
                <div
                    className={cn(
                        'flex flex-col ml-3 h-[calc(100vh-1.5rem)] bg-ant-ink rounded-[20px] text-ant-light transition-all duration-700 ease-smooth overflow-hidden border border-white/[0.06] pointer-events-auto shadow-[0_24px_60px_-24px_rgba(20,20,19,0.55)]',
                        isPinned
                            ? 'w-[216px] group/sidebar-inner'
                            : 'w-[60px] group-hover/sidebar:w-[216px] group/sidebar-inner',
                    )}
                    data-pinned={isPinned}
                >
                    {/* Brand */}
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

                    {/* Nav */}
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
                                                'overflow-hidden transition-all duration-500 ease-smooth',
                                                expandedSection === section.label
                                                    ? 'max-h-[320px] opacity-100 mt-0.5'
                                                    : 'max-h-0 opacity-0',
                                            )}
                                        >
                                            <div className="relative ml-[22px] pl-3 border-l border-white/[0.07] space-y-px">
                                                {section.items.map((item) => (
                                                    <NavLink
                                                        key={item.path}
                                                        to={item.path}
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
                    </div>

                    {/* Profile → /mediabuyer/profile */}
                    <div className="px-2 pt-2 pb-1.5 border-t border-white/[0.06]">
                        <NavLink to="/mediabuyer/profile" className="flex items-center h-11 rounded-lg hover:bg-white/[0.04] transition-colors">
                            <div className="w-[44px] h-11 flex items-center justify-center shrink-0">
                                <div className="w-8 h-8 rounded-full overflow-hidden bg-ant-ink-soft flex items-center justify-center ring-1 ring-white/10">
                                    {isProfileLoading ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-ant-light" />
                                    ) : (
                                        <UserAvatar url={profile?.avatar_url} config={(profile as any)?.avatar_config} name={profile?.name} className="w-full h-full" />
                                    )}
                                </div>
                            </div>
                            <div className="ml-1.5 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-150 whitespace-nowrap overflow-hidden">
                                <span className="block text-[11.5px] font-medium text-ant-light tracking-tight truncate max-w-[140px]">
                                    {profile?.name || 'Media Buyer'}
                                </span>
                                <span className="flex items-center gap-1 mt-0.5">
                                    <span className="w-1 h-1 rounded-full bg-ant-green" />
                                    <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-ant-mid">
                                        Media Buyer
                                    </span>
                                </span>
                            </div>
                        </NavLink>
                    </div>

                    {/* Actions */}
                    <div className="px-2 pb-3 flex items-center gap-1.5">
                        <button
                            onClick={handleLogout}
                            className="flex-1 flex items-center h-9 rounded-lg text-ant-light/40 hover:text-ant-rose hover:bg-white/[0.04] transition-all duration-300"
                            title="Déconnexion"
                        >
                            <div className="w-[44px] h-9 flex items-center justify-center shrink-0">
                                <LogOut className="w-[14px] h-[14px]" />
                            </div>
                            <span className="font-medium text-[12px] tracking-tight opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                                Déconnexion
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
                            title={isPinned ? 'Détacher' : 'Épingler'}
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

export default MediaBuyerSidebar;
