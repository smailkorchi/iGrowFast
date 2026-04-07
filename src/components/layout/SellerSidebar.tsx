import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    Home,
    ShoppingBag,
    CreditCard,
    MessageSquare,
    Target,
    LogOut,
    PanelLeftClose,
    User as UserIcon,
    Loader2,
    Building2,
    ChevronRight,
    BarChart2,
    Truck,
    FileText,
    Package,
    Puzzle
} from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

type NavItem = {
    icon: any;
    label: string;
    path: string;
};

type NavSection = {
    label?: string;
    items: NavItem[];
};

const navigation: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/seller/dashboard' },
    { icon: ShoppingBag, label: 'Orders', path: '/seller/orders' },
    { icon: Package, label: 'Products', path: '/seller/products' },
    { icon: Puzzle, label: 'Accessories', path: '/seller/accessories' },
    { icon: Truck, label: 'Delivery notes', path: '/seller/delivery-note' },
    { icon: FileText, label: 'Return notes', path: '/seller/return-note' },
    { icon: BarChart2, label: 'Statistics', path: '/seller/statistics' },
    { icon: CreditCard, label: 'Payments', path: '/seller/payments' },
    { icon: Target, label: 'My Wallet', path: '/seller/wallet' },
    { icon: MessageSquare, label: 'Demands', path: '/seller/demands' },
    { icon: UserIcon, label: 'Profile', path: '/seller/profile' },
];

const SellerSidebar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [isPinned, setIsPinned] = React.useState(() => {
        return localStorage.getItem('sidebarPinned') === 'true';
    });

    const togglePin = () => {
        setIsPinned(prev => {
            const next = !prev;
            localStorage.setItem('sidebarPinned', String(next));
            return next;
        });
    };



    const { data: profile, isLoading: isProfileLoading } = useQuery({
        queryKey: ['seller-profile'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;

            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) return null;
            return data;
        }
    });

    // ── WhatsApp access for the current seller ─────────────────────────
    // Visible when: at least one row exists in whatsapp_user_instances for the
    // current user (any scope). Hidden otherwise. The actual filtering of
    // which instances they see happens inside SellerWhatsAppInbox.
    const { data: hasWhatsAppAccess } = useQuery({
        queryKey: ['seller-wa-access', profile?.id],
        queryFn: async () => {
            if (!profile?.id) return false;
            const { count } = await (supabase as any)
                .from('whatsapp_user_instances')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', profile.id);
            return (count || 0) > 0;
        },
        enabled: !!profile?.id,
    });

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/auth');
    };

    // Build the final navigation list — insert WhatsApp right after Orders if the seller has access.
    const visibleNavigation: NavItem[] = React.useMemo(() => {
        if (!hasWhatsAppAccess) return navigation;
        const ordersIdx = navigation.findIndex(n => n.path === '/seller/orders');
        const waItem: NavItem = { icon: FaWhatsapp as any, label: 'WhatsApp', path: '/seller/whatsapp/inbox' };
        if (ordersIdx === -1) return [...navigation, waItem];
        return [
            ...navigation.slice(0, ordersIdx + 1),
            waItem,
            ...navigation.slice(ordersIdx + 1),
        ];
    }, [hasWhatsAppAccess]);

    return (
        <aside className={cn(
            "relative flex-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group/sidebar",
            isPinned ? "w-[276px]" : "w-[92px] hover:w-[276px]"
        )}>
            <div className={cn(
                "fixed left-0 top-0 bottom-0 flex items-center z-50 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] pointer-events-none",
                isPinned ? "w-[276px]" : "w-[92px] group-hover/sidebar:w-[276px]"
            )}>
                <div
                    className={cn(
                        "flex flex-col ml-4 h-[calc(100vh-2rem)] bg-brand-navy rounded-[32px] text-brand-white transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden shadow-[0_32px_80px_-16px_rgba(0,0,0,0.5)] border border-white/5 pointer-events-auto",
                        isPinned ? "w-[260px] group/sidebar-inner" : "w-[76px] group-hover/sidebar:w-[260px] group/sidebar-inner"
                    )}
                    data-pinned={isPinned}
                >
                    {/* Top Logo Section */}
                    <div className="flex items-center h-20 shrink-0 px-3">
                        <div className="flex items-center w-full h-12 rounded-2xl relative">
                            <div className="w-[52px] h-12 flex items-center justify-center shrink-0">
                                <div className="w-9 h-9 rounded-xl bg-brand-white flex items-center justify-center shadow-xl group-hover/sidebar-inner:rotate-[360deg] group-data-[pinned=true]/sidebar-inner:rotate-[360deg] transition-all duration-1000 overflow-hidden p-1.5">
                                    <img
                                        src="/Logo/DigiCom Icon Transparent.png"
                                        alt="DigiCom"
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                            </div>
                            <span className="ml-3 font-black text-xl tracking-tighter opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-100 whitespace-nowrap overflow-hidden text-brand-white">
                                DigiCom<span className="text-white/20">.</span>
                            </span>
                        </div>
                    </div>

                    {/* Navigation Items */}
                    <div className="flex-1 px-3 space-y-1 overflow-y-auto no-scrollbar pb-6 scroll-smooth">
                        {visibleNavigation.map((item, idx) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                className={({ isActive }) => cn(
                                    "flex items-center h-11 rounded-2xl transition-all duration-300 group/item relative overflow-hidden",
                                    "hover:bg-white/[0.04]",
                                    isActive ? "bg-white/[0.08] text-brand-white shadow-sm" : "text-brand-white/40 hover:text-brand-white"
                                )}
                            >
                                <div className="w-[52px] h-11 flex items-center justify-center shrink-0 relative z-10 transition-transform duration-300 group-hover/item:scale-110">
                                    <item.icon className={cn("w-5 h-5", idx === 0 && "transition-all duration-1000")} />
                                </div>
                                <span className="font-bold text-[13px] opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap relative z-10">
                                    {item.label}
                                </span>
                            </NavLink>
                        ))}
                    </div>

                    {/* Profile Section */}
                    <div className="px-3 pt-4 pb-2 border-t border-white/[0.03]">
                        <NavLink
                            to="/seller/profile"
                            className={({ isActive }) => cn(
                                "flex items-center h-14 rounded-2xl transition-all duration-500 group/profile relative overflow-hidden",
                                "hover:bg-white/[0.05]",
                                "group-hover/sidebar-inner:bg-white/[0.02] group-data-[pinned=true]/sidebar-inner:bg-white/[0.02] group-hover/sidebar-inner:border group-data-[pinned=true]/sidebar-inner:border group-hover/sidebar-inner:border-white/[0.03] group-data-[pinned=true]/sidebar-inner:border-white/[0.03]",
                                isActive && "group-hover/sidebar-inner:bg-white/[0.08] group-data-[pinned=true]/sidebar-inner:bg-white/[0.08] group-hover/sidebar-inner:border-white/5 group-data-[pinned=true]/sidebar-inner:border-white/5"
                            )}
                        >
                            <div className="w-[52px] h-14 flex items-center justify-center shrink-0">
                                <div className="relative w-8 h-8 group-hover/profile:scale-105 transition-transform duration-500 flex items-center justify-center">
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-brand-navy bg-brand-navy-light flex items-center justify-center shadow-lg z-20 transition-all duration-700 group-hover/sidebar-inner:rotate-[-4deg] group-data-[pinned=true]/sidebar-inner:rotate-[-4deg] shrink-0 relative">
                                        {isProfileLoading ? (
                                            <Loader2 className="w-4 h-4 animate-spin text-brand-white" />
                                        ) : profile?.avatar_url ? (
                                            <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                                        ) : (
                                            <UserIcon className="w-4 h-4 text-brand-white" />
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="ml-2 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-150 whitespace-nowrap overflow-hidden">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-brand-white tracking-tight truncate max-w-[120px]">
                                        {profile?.name || 'Seller'}
                                    </span>
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                        <span className="text-[8px] text-white/30 font-black uppercase tracking-[0.2em]">
                                            Seller
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </NavLink>
                    </div>

                    {/* Sign Out & Pin Toggle */}
                    <div className="px-3 pb-4 flex items-center gap-2">
                        <button
                            onClick={handleLogout}
                            className="flex-1 flex items-center h-11 rounded-2xl text-white/10 hover:text-red-400 hover:bg-red-400/5 transition-all duration-300 overflow-hidden"
                            title="Logout"
                        >
                            <div className="w-[52px] h-11 flex items-center justify-center shrink-0">
                                <LogOut className="w-4 h-4" />
                            </div>
                            <span className="font-bold text-[13px] opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                                Logout
                            </span>
                        </button>

                        <button
                            onClick={togglePin}
                            className={cn(
                                "w-11 h-11 shrink-0 flex items-center justify-center rounded-2xl transition-all duration-300",
                                isPinned
                                    ? "text-brand-white bg-white/10"
                                    : "text-white/30 hover:text-brand-white hover:bg-white/5 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100"
                            )}
                            title={isPinned ? "Unpin Sidebar" : "Pin Sidebar"}
                        >
                            <PanelLeftClose className={cn("w-5 h-5 transition-transform duration-300", !isPinned && "rotate-180")} />
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default SellerSidebar;
