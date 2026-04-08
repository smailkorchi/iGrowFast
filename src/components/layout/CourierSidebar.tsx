import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Package,
    Wallet,
    LogOut,
    PanelLeftClose,
    User as UserIcon,
    Loader2,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

type NavItem = {
    icon: LucideIcon;
    label: string;
    path: string;
};

const navigation: NavItem[] = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/courier/dashboard' },
    { icon: Package, label: 'Orders', path: '/courier/orders' },
    { icon: Wallet, label: 'Payments', path: '/courier/payments' },
];

const CourierSidebar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [isPinned, setIsPinned] = React.useState(() => {
        return localStorage.getItem('courierSidebarPinned') === 'true';
    });

    const togglePin = () => {
        setIsPinned(prev => {
            const next = !prev;
            localStorage.setItem('courierSidebarPinned', String(next));
            return next;
        });
    };

    const { data: profile, isLoading: isProfileLoading } = useQuery({
        queryKey: ['current-profile'],
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

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('activeBusinessId');
        navigate('/auth');
    };

    return (
        <>
            {/* Desktop Sidebar (md+) — mirrors OwnerSidebar aesthetic */}
            <aside className={cn(
                "hidden md:block relative flex-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group/sidebar",
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

                        {/* Navigation */}
                        <div className="flex-1 px-3 space-y-1 overflow-y-auto no-scrollbar pb-6 scroll-smooth">
                            <div className="space-y-0.5">
                                {navigation.map((item) => (
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
                                            <item.icon className="w-5 h-5" />
                                        </div>
                                        <span className="font-bold text-[13px] opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap relative z-10">
                                            {item.label}
                                        </span>
                                    </NavLink>
                                ))}
                            </div>
                        </div>

                        {/* Profile Section */}
                        <div className="px-3 pt-4 pb-2 border-t border-white/[0.03]">
                            <div className="flex items-center h-14 rounded-2xl overflow-hidden">
                                <div className="w-[52px] h-14 flex items-center justify-center shrink-0">
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white/10 bg-brand-navy-light flex items-center justify-center shadow-lg">
                                        {isProfileLoading ? (
                                            <Loader2 className="w-4 h-4 animate-spin text-brand-white" />
                                        ) : profile?.avatar_url ? (
                                            <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                                        ) : (
                                            <UserIcon className="w-4 h-4 text-brand-white" />
                                        )}
                                    </div>
                                </div>
                                <div className="ml-2 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-150 whitespace-nowrap overflow-hidden">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-bold text-brand-white tracking-tight truncate max-w-[120px]">
                                            {profile?.name || 'Courier'}
                                        </span>
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                            <span className="text-[8px] text-white/30 font-black uppercase tracking-[0.2em]">
                                                {profile?.role || 'Courier'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
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

            {/* Mobile Floating Dock (iOS-style) */}
            <nav
                aria-label="Courier navigation"
                className="md:hidden fixed left-1/2 -translate-x-1/2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 pointer-events-none"
            >
                <div className="pointer-events-auto flex items-center gap-1 px-2 py-2 bg-brand-navy/90 backdrop-blur-2xl rounded-full border border-white/10 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.55)]">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                aria-label={item.label}
                                title={item.label}
                                className={cn(
                                    "relative flex items-center justify-center w-11 h-11 rounded-full transition-all duration-300 active:scale-90",
                                    isActive
                                        ? "bg-white/[0.14] text-brand-white"
                                        : "text-white/55 hover:text-brand-white hover:bg-white/[0.05]"
                                )}
                            >
                                <item.icon className={cn("w-[18px] h-[18px] transition-transform duration-300", isActive && "scale-110")} />
                                {isActive && (
                                    <span className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-brand-white" />
                                )}
                            </NavLink>
                        );
                    })}
                    <div className="w-px h-6 bg-white/10 mx-0.5" />
                    <button
                        onClick={handleLogout}
                        aria-label="Logout"
                        title="Logout"
                        className="flex items-center justify-center w-11 h-11 rounded-full text-white/45 hover:text-red-400 hover:bg-red-400/5 transition-all duration-300 active:scale-90"
                    >
                        <LogOut className="w-[18px] h-[18px]" />
                    </button>
                </div>
            </nav>

            {/* Mobile Top Bar (avatar + brand) */}
            <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14 bg-brand-white/80 backdrop-blur-xl border-b border-brand-navy/5">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-brand-navy flex items-center justify-center overflow-hidden p-1.5">
                        <img src="/Logo/DigiCom Icon Transparent.png" alt="DigiCom" className="w-full h-full object-contain" />
                    </div>
                    <span className="font-black text-brand-navy text-lg tracking-tighter">
                        DigiCom<span className="text-brand-navy/20">.</span>
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end">
                        <span className="text-[11px] font-bold text-brand-navy leading-tight truncate max-w-[120px]">
                            {profile?.name || 'Courier'}
                        </span>
                        <span className="text-[8px] font-black uppercase tracking-[0.18em] text-brand-navy/40">
                            {profile?.role || 'Courier'}
                        </span>
                    </div>
                    <div className="w-8 h-8 rounded-full overflow-hidden border border-brand-navy/10 bg-brand-navy/5 flex items-center justify-center">
                        {isProfileLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-brand-navy" />
                        ) : profile?.avatar_url ? (
                            <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                        ) : (
                            <UserIcon className="w-4 h-4 text-brand-navy" />
                        )}
                    </div>
                </div>
            </header>
        </>
    );
};

export default CourierSidebar;
