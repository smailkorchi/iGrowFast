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
    { icon: LayoutDashboard, label: 'Tableau de bord', path: '/courier/dashboard' },
    { icon: Package, label: 'Commandes', path: '/courier/orders' },
    { icon: Wallet, label: 'Paiements', path: '/courier/payments' },
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
            {/* Desktop Sidebar (md+) — matches admin Sidebar aesthetic */}
            <aside
                className={cn(
                    'hidden md:block ant-surface relative flex-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group/sidebar',
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
                                    <div className="w-8 h-8 rounded-[10px] bg-ant-light flex items-center justify-center overflow-hidden p-1 transition-transform duration-700 group-hover/sidebar-inner:rotate-[360deg] group-data-[pinned=true]/sidebar-inner:rotate-[360deg]">
                                        <img
                                            src="/Logo/DigiCom Icon Transparent.png"
                                            alt="DigiCom"
                                            className="w-full h-full object-contain"
                                        />
                                    </div>
                                </div>
                                <span className="ml-2 font-display font-semibold text-[15px] tracking-tight text-ant-light opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-100 whitespace-nowrap overflow-hidden">
                                    DigiCom
                                    <span className="text-ant-orange">.</span>
                                </span>
                            </div>
                        </div>

                        <div className="mx-3 border-t border-white/[0.06]" />

                        {/* Nav */}
                        <div className="flex-1 px-2 pt-2 space-y-0.5 overflow-y-auto overflow-x-hidden no-scrollbar pb-3 scroll-smooth">
                            {navigation.map((item) => (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
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

                        {/* Profile */}
                        <div className="px-2 pt-2 pb-1.5 border-t border-white/[0.06]">
                            <NavLink
                                to="/courier/profile"
                                aria-label="Mon profil"
                                title="Mon profil"
                                className={({ isActive }) => cn(
                                    'flex items-center h-11 rounded-lg transition-all duration-300 relative',
                                    isActive
                                        ? 'bg-white/[0.06]'
                                        : 'hover:bg-white/[0.035]',
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
                                        <div className="w-[44px] h-11 flex items-center justify-center shrink-0">
                                            <div className={cn(
                                                'w-8 h-8 rounded-full overflow-hidden bg-ant-ink-soft flex items-center justify-center ring-1 transition-all duration-300',
                                                isActive ? 'ring-ant-orange/60' : 'ring-white/10',
                                            )}>
                                                {isProfileLoading ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-ant-light" />
                                                ) : profile?.avatar_url ? (
                                                    <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                                                ) : (
                                                    <UserIcon className="w-3.5 h-3.5 text-ant-light/70" />
                                                )}
                                            </div>
                                        </div>
                                        <div className="ml-1.5 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-150 whitespace-nowrap overflow-hidden">
                                            <span className={cn(
                                                'block text-[11.5px] font-medium tracking-tight truncate max-w-[140px]',
                                                isActive ? 'text-ant-light' : 'text-ant-light',
                                            )}>
                                                {profile?.name || 'Livreur'}
                                            </span>
                                            <span className="flex items-center gap-1 mt-0.5">
                                                <span className="w-1 h-1 rounded-full bg-ant-green" />
                                                <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-ant-mid">
                                                    Livreur
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

            {/* Mobile Top Bar — editorial Anthropic style */}
            <header className="md:hidden sticky top-0 z-40 bg-ant-light/85 backdrop-blur-xl border-b border-ant-line">
                <div className="flex items-center justify-between px-3 h-12">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-ant-ink flex items-center justify-center overflow-hidden p-1">
                            <img src="/Logo/DigiCom Icon Transparent.png" alt="DigiCom" className="w-full h-full object-contain" />
                        </div>
                        <span className="font-display font-semibold text-[15px] tracking-tight text-ant-ink">
                            DigiCom<span className="text-ant-orange">.</span>
                        </span>
                    </div>
                    <NavLink
                        to="/courier/profile"
                        aria-label="Mon profil"
                        title="Mon profil"
                        className={({ isActive }) => cn(
                            'flex items-center gap-2 rounded-full pl-2 pr-1 py-1 transition-colors active:scale-[0.98]',
                            isActive ? 'bg-ant-ink/5' : 'hover:bg-ant-ink/5',
                        )}
                    >
                        {({ isActive }) => (
                            <>
                                <div className="flex flex-col items-end leading-tight">
                                    <span className="text-[11px] font-semibold text-ant-ink truncate max-w-[140px]">
                                        {profile?.name || 'Livreur'}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <span className="w-1 h-1 rounded-full bg-ant-green" />
                                        <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-ant-mid">
                                            Livreur
                                        </span>
                                    </span>
                                </div>
                                <div className={cn(
                                    'w-8 h-8 rounded-full overflow-hidden bg-ant-paper border flex items-center justify-center transition-colors',
                                    isActive ? 'border-ant-orange' : 'border-ant-line',
                                )}>
                                    {isProfileLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-ant-ink" />
                                    ) : profile?.avatar_url ? (
                                        <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                                    ) : (
                                        <UserIcon className="w-4 h-4 text-ant-ink/70" />
                                    )}
                                </div>
                            </>
                        )}
                    </NavLink>
                </div>
            </header>

            {/* Mobile Floating Dock — ink pill */}
            <nav
                aria-label="Navigation livreur"
                className="md:hidden fixed left-1/2 -translate-x-1/2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 pointer-events-none"
            >
                <div className="pointer-events-auto flex items-center gap-0.5 px-1.5 py-1.5 bg-ant-ink/95 backdrop-blur-2xl rounded-full border border-white/[0.08] shadow-[0_20px_50px_-12px_rgba(20,20,19,0.55)]">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                aria-label={item.label}
                                title={item.label}
                                className={cn(
                                    'relative flex items-center justify-center h-11 min-w-[44px] rounded-full transition-all duration-300 active:scale-95',
                                    isActive
                                        ? 'bg-white/[0.1] text-ant-light px-3.5 gap-1.5'
                                        : 'text-ant-light/55 hover:text-ant-light hover:bg-white/[0.05] w-11',
                                )}
                            >
                                <item.icon className={cn('w-[17px] h-[17px] transition-transform duration-300 shrink-0', isActive && 'text-ant-orange')} />
                                {isActive && (
                                    <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                                        {item.label.split(' ')[0]}
                                    </span>
                                )}
                            </NavLink>
                        );
                    })}
                    <span className="w-px h-5 bg-white/10 mx-0.5" />
                    <button
                        onClick={handleLogout}
                        aria-label="Déconnexion"
                        title="Déconnexion"
                        className="flex items-center justify-center w-11 h-11 rounded-full text-ant-light/45 hover:text-ant-rose hover:bg-white/[0.04] transition-all duration-300 active:scale-95"
                    >
                        <LogOut className="w-[17px] h-[17px]" />
                    </button>
                </div>
            </nav>
        </>
    );
};

export default CourierSidebar;
