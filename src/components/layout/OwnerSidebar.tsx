import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    Building2,
    LayoutDashboard,
    Users,
    CreditCard,
    Receipt,
    LogOut,
    PanelLeftClose,
    User as UserIcon,
    Loader2,
    RefreshCcw,
    MapPin,
    Map,
    History,
    BrainCircuit,
    Mails,
    Settings,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/users/UserAvatar';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

type NavItem = {
    icon: LucideIcon | React.ComponentType<{ className?: string }>;
    label: string;
    path: string;
};

const navigation: NavItem[] = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/owner/dashboard' },
    { icon: Building2, label: 'Businesses', path: '/owner/businesses' },
    { icon: CreditCard, label: 'Plans', path: '/owner/plans' },
    { icon: Receipt, label: 'Payments', path: '/owner/payments' },
    { icon: Users, label: 'Users', path: '/owner/users' },
    { icon: RefreshCcw, label: 'Status', path: '/owner/status' },
    { icon: MapPin, label: 'Cities', path: '/owner/cities' },
    { icon: Map, label: 'Zones', path: '/owner/zones' },
    { icon: History, label: 'Activity Log', path: '/owner/activity-log' },
    { icon: BrainCircuit, label: 'AI Platform', path: '/owner/ai' },
    { icon: Mails, label: 'Email Templates', path: '/owner/email-templates' },
    { icon: Settings, label: 'Config', path: '/owner/config' },
];

const isParentPath = (path: string) => path === '/owner/dashboard';

const OwnerSidebar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [isPinned, setIsPinned] = React.useState(() => {
        return localStorage.getItem('ownerSidebarPinned') === 'true';
    });

    const togglePin = () => {
        setIsPinned(prev => {
            const next = !prev;
            localStorage.setItem('ownerSidebarPinned', String(next));
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

    const isActivePath = (path: string, isEnd: boolean) => {
        if (isEnd) return location.pathname === path;
        return location.pathname === path || location.pathname.startsWith(path + '/');
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

                    {/* Kicker — "Owner" scope label */}
                    <div className="mx-3 pb-2 border-b border-white/[0.06]">
                        <div className="flex items-center gap-1.5 h-5 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-150">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                            <span className="font-display text-[9px] uppercase tracking-[0.22em] text-ant-light/55">
                                Platform · Owner
                            </span>
                        </div>
                    </div>

                    {/* Nav */}
                    <div className="flex-1 px-2 pt-2 space-y-0.5 overflow-y-auto overflow-x-hidden no-scrollbar pb-3 scroll-smooth">
                        {navigation.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                end={isParentPath(item.path)}
                                className={({ isActive }) => cn(
                                    'flex items-center h-9 rounded-lg transition-all duration-300 group/item relative',
                                    isActive
                                        ? 'bg-white/[0.06] text-ant-light'
                                        : 'text-ant-light/55 hover:text-ant-light hover:bg-white/[0.035]',
                                )}
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

                    {/* Profile (display only — owner is confined to the platform dashboard) */}
                    <div className="px-2 pt-2 pb-1.5 border-t border-white/[0.06]">
                        <div className="flex items-center h-11 rounded-lg group/profile relative">
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
                                    {profile?.name || 'Owner'}
                                </span>
                                <span className="flex items-center gap-1 mt-0.5">
                                    <span className="w-1 h-1 rounded-full bg-ant-green" />
                                    <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-ant-mid">
                                        {profile?.role || 'Owner'}
                                    </span>
                                </span>
                            </div>
                        </div>
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

export default OwnerSidebar;
