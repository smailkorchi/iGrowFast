import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    Home,
    ShoppingBag,
    CreditCard,
    MessageSquare,
    Target,
    LogOut,
    User as UserIcon,
    Loader2,
    Building2,
    ChevronRight,
    BarChart2
} from 'lucide-react';
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

const navigation: NavSection[] = [
    {
        items: [
            { icon: Home, label: 'Dashboard', path: '/seller/dashboard' },
            { icon: ShoppingBag, label: 'Orders', path: '/seller/orders' },
            { icon: BarChart2, label: 'Statistics', path: '/seller/statistics' },
        ]
    },
    {
        label: 'Finance',
        items: [
            { icon: CreditCard, label: 'Payments', path: '/seller/payments' },
            { icon: Target, label: 'My Wallet', path: '/seller/wallet' },
        ]
    },
    {
        label: 'Support',
        items: [
            { icon: MessageSquare, label: 'Demands', path: '/seller/demands' },
        ]
    },
    {
        label: 'Account',
        items: [
            { icon: UserIcon, label: 'Profile', path: '/seller/profile' },
        ]
    }
];

const SellerSidebar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    // State for expanded section (Accordion behavior)
    const [expandedSection, setExpandedSection] = React.useState<string | null>(() => {
        let activeSection = null;
        navigation.forEach(section => {
            if (section.label && section.items.some(item => location.pathname === item.path)) {
                activeSection = section.label;
            }
        });
        return activeSection;
    });

    const toggleSection = (label: string) => {
        setExpandedSection(prev => prev === label ? null : label);
    };

    // Auto-expand when path changes
    React.useEffect(() => {
        navigation.forEach(section => {
            if (section.label && expandedSection !== section.label && section.items.some(item => location.pathname === item.path)) {
                setExpandedSection(section.label);
            }
        });
    }, [location.pathname]);

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

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/auth');
    };

    return (
        <aside className="relative flex-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group/sidebar w-[92px] hover:w-[276px]">
            <div className="fixed left-0 top-0 bottom-0 flex items-center z-50 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] w-[92px] group-hover/sidebar:w-[276px] pointer-events-none">
                <div
                    className={cn(
                        "flex flex-col ml-4 h-[calc(100vh-2rem)] bg-brand-navy rounded-[32px] text-brand-white transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden shadow-[0_32px_80px_-16px_rgba(0,0,0,0.5)] border border-white/5 pointer-events-auto",
                        "w-[76px] group-hover/sidebar:w-[260px] group/sidebar-inner"
                    )}
                >
                    {/* Top Logo Section */}
                    <div className="flex items-center h-20 shrink-0 px-3">
                        <div className="flex items-center w-full h-12 rounded-2xl relative">
                            <div className="w-[52px] h-12 flex items-center justify-center shrink-0">
                                <div className="w-9 h-9 rounded-xl bg-brand-white flex items-center justify-center shadow-xl group-hover/sidebar-inner:rotate-[360deg] transition-all duration-1000 overflow-hidden p-1.5">
                                    <img
                                        src="/Logo/DigiCom Icon Transparent.png"
                                        alt="DigiCom"
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                            </div>
                            <span className="ml-3 font-black text-xl tracking-tighter opacity-0 group-hover/sidebar-inner:opacity-100 transition-all duration-500 delay-100 whitespace-nowrap overflow-hidden text-brand-white">
                                DigiCom<span className="text-white/20">.</span>
                            </span>
                        </div>
                    </div>

                    {/* Navigation Sections */}
                    <div className="flex-1 px-3 space-y-1 overflow-y-auto no-scrollbar pb-6 scroll-smooth">
                        {navigation.map((section, idx) => (
                            <div key={idx} className="space-y-1">
                                {section.label ? (
                                    <>
                                        <button
                                            onClick={() => toggleSection(section.label!)}
                                            className={cn(
                                                "flex items-center w-full h-11 rounded-2xl transition-all duration-300 group/item relative overflow-hidden",
                                                "hover:bg-white/[0.04]",
                                                (expandedSection === section.label || section.items.some(item => location.pathname === item.path))
                                                    ? "text-brand-white"
                                                    : "text-brand-white/40 hover:text-brand-white"
                                            )}
                                        >
                                            <div className="w-[52px] h-11 flex items-center justify-center shrink-0 relative z-10 transition-transform duration-300 group-hover/item:scale-110">
                                                <div className="w-5 h-5 flex items-center justify-center">
                                                    {/* We can pick the first item's icon or a generic one if needed, but for now just use text/chevron */}
                                                    <ChevronRight className={cn(
                                                        "w-4 h-4 transition-transform duration-300",
                                                        expandedSection === section.label && "rotate-90"
                                                    )} />
                                                </div>
                                            </div>
                                            <div className="flex-1 flex items-center justify-between pr-4 opacity-0 group-hover/sidebar-inner:opacity-100 transition-all duration-500 delay-75">
                                                <span className="font-bold text-[13px] whitespace-nowrap">
                                                    {section.label}
                                                </span>
                                            </div>
                                        </button>

                                        <div className={cn(
                                            "space-y-0.5 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
                                            expandedSection === section.label ? "max-h-[400px] opacity-100 mt-1" : "max-h-0 opacity-0"
                                        )}>
                                            {section.items.map((item) => (
                                                <NavLink
                                                    key={item.path}
                                                    to={item.path}
                                                    className={({ isActive }) => cn(
                                                        "flex items-center h-10 rounded-xl transition-all duration-300 group/subitem relative overflow-hidden ml-1",
                                                        "hover:bg-white/[0.04]",
                                                        isActive ? "bg-white/[0.08] text-brand-white shadow-sm" : "text-brand-white/50 hover:text-brand-white"
                                                    )}
                                                >
                                                    {({ isActive }) => (
                                                        <>
                                                            <div className="w-[48px] h-10 flex items-center justify-center shrink-0 relative z-10 transition-transform duration-300 group-hover/subitem:scale-110">
                                                                <item.icon className={cn("w-4 h-4", isActive ? "text-brand-white" : "text-brand-white/40 group-hover/subitem:text-brand-white")} />
                                                            </div>
                                                            <span className="font-bold text-[12px] opacity-0 group-hover/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap relative z-10">
                                                                {item.label}
                                                            </span>
                                                        </>
                                                    )}
                                                </NavLink>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-0.5">
                                        {section.items.map((item) => (
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
                                                <span className="font-bold text-[13px] opacity-0 group-hover/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap relative z-10">
                                                    {item.label}
                                                </span>
                                            </NavLink>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Profile Section */}
                    <div className="px-3 pt-4 pb-2 border-t border-white/[0.03]">
                        <NavLink
                            to="/seller/profile"
                            className={({ isActive }) => cn(
                                "flex items-center h-14 rounded-2xl transition-all duration-500 group/profile relative overflow-hidden",
                                "hover:bg-white/[0.05]",
                                "group-hover/sidebar-inner:bg-white/[0.02] group-hover/sidebar-inner:border group-hover/sidebar-inner:border-white/[0.03]",
                                isActive && "group-hover/sidebar-inner:bg-white/[0.08] group-hover/sidebar-inner:border-white/5"
                            )}
                        >
                            <div className="w-[52px] h-14 flex items-center justify-center shrink-0">
                                <div className="relative w-8 h-8 group-hover/profile:scale-105 transition-transform duration-500 flex items-center justify-center">
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-brand-navy bg-brand-navy-light flex items-center justify-center shadow-lg z-20 transition-all duration-700 group-hover/sidebar-inner:rotate-[-4deg] shrink-0 relative">
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

                            <div className="ml-2 opacity-0 group-hover/sidebar-inner:opacity-100 transition-all duration-500 delay-150 whitespace-nowrap overflow-hidden">
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

                    {/* Sign Out */}
                    <div className="px-3 pb-4">
                        <button
                            onClick={handleLogout}
                            className="flex items-center w-full h-11 rounded-2xl text-white/10 hover:text-red-400 hover:bg-red-400/5 transition-all duration-300"
                        >
                            <div className="w-[52px] h-11 flex items-center justify-center shrink-0">
                                <LogOut className="w-4 h-4" />
                            </div>
                            <span className="font-bold text-xs opacity-0 group-hover/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                                Logout
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default SellerSidebar;
