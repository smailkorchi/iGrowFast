import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
    Home,
    Users,
    DollarSign,
    BarChart2,
    RefreshCcw,
    Lightbulb,
    Megaphone,
    Settings,
    Circle,
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
    MapPin,
    Map,
    Download,
    CheckCircle,
    ChevronRight,
    Target,
    Zap,
    Building2,
    LogOut,
    User as UserIcon,
    Loader2
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
            { icon: Home, label: 'Dashboard', path: '/' },
            { icon: BarChart2, label: 'Analytics', path: '/analytics' },
            { icon: ShoppingBag, label: 'Orders', path: '/orders' },
        ]
    },
    {
        label: 'Shipping',
        items: [
            { icon: FileText, label: 'Delivery Note', path: '/delivery-note' },
            { icon: Repeat, label: 'Return Note', path: '/return-note' },
            { icon: Globe, label: 'Delivery Services', path: '/delivery-services' },
            { icon: CreditCard, label: 'Payment', path: '/payments' },
            { icon: Zap, label: 'Webhooks', path: '/webhooks' },
        ]
    },
    {
        label: 'Inventory',
        items: [
            { icon: ArrowRightLeft, label: 'Transactions', path: '/transactions' },
            { icon: Box, label: 'Products', path: '/products' },
        ]
    },
    {
        items: [
            { icon: RefreshCcw, label: 'Status', path: '/status' },

            { icon: Megaphone, label: 'Sales Channels', path: '/sales-channels' },
            { icon: Users, label: 'Customers', path: '/customers' },
            { icon: UserPlus, label: 'Users', path: '/users' },
        ]
    },
    {
        label: 'Expenses',
        items: [
            { icon: Target, label: 'Ads History', path: '/ads-history' },
            { icon: List, label: 'Expenses Details', path: '/expenses-details' },
            { icon: Tag, label: 'Expenses Types', path: '/expenses-types' },
        ]
    },
    {
        label: 'Settings',
        items: [
            { icon: Building2, label: 'Businesses', path: '/businesses' },
            { icon: MapPin, label: 'Cities', path: '/cities' },
            { icon: Map, label: 'Zones', path: '/zones' },
            { icon: Download, label: 'Import Orders', path: '/import-orders' },
        ]
    }
];

const Sidebar = () => {
    const navigate = useNavigate();

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

    const { data: business, isLoading: isBusinessLoading, refetch: refetchBusiness } = useQuery({
        queryKey: ['current-business'],
        queryFn: async () => {
            const activeId = localStorage.getItem('activeBusinessId');
            if (!activeId) return null;

            const { data, error } = await supabase
                .from('businesses')
                .select('*')
                .eq('id', activeId)
                .single();

            if (error) return null;
            return data;
        }
    });

    React.useEffect(() => {
        const handleRefresh = () => refetchBusiness();
        window.addEventListener('businessSelected', handleRefresh);
        return () => window.removeEventListener('businessSelected', handleRefresh);
    }, [refetchBusiness]);

    const isLoading = isProfileLoading || isBusinessLoading;

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('activeBusinessId');
        navigate('/auth');
    };

    return (
        <div className="fixed left-0 top-0 bottom-0 z-50 flex items-center">
            <div
                className={cn(
                    "group ml-4 flex flex-col h-[calc(100vh-2rem)] bg-brand-navy rounded-[32px] text-brand-white transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden shadow-[0_32px_80px_-16px_rgba(0,0,0,0.5)] border border-white/5",
                    "w-[76px] hover:w-[260px]"
                )}
            >
                {/* Top Logo Section */}
                <div className="flex items-center h-20 shrink-0 px-3">
                    <div className="flex items-center w-full h-12 rounded-2xl relative">
                        <div className="w-[52px] h-12 flex items-center justify-center shrink-0">
                            <div className="w-9 h-9 rounded-xl bg-brand-white flex items-center justify-center shadow-xl group-hover:rotate-[360deg] transition-all duration-1000 overflow-hidden p-1.5">
                                <img
                                    src="/Logo/DigiCom Icon Transparent.png"
                                    alt="DigiCom"
                                    className="w-full h-full object-contain"
                                />
                            </div>
                        </div>
                        <span className="ml-3 font-black text-xl tracking-tighter opacity-0 group-hover:opacity-100 transition-all duration-500 delay-100 whitespace-nowrap overflow-hidden text-brand-white">
                            DigiCom<span className="text-white/20">.</span>
                        </span>
                    </div>
                </div>

                {/* Navigation Sections */}
                <div className="flex-1 px-3 space-y-5 overflow-y-auto no-scrollbar pb-6 scroll-smooth">
                    {navigation.map((section, idx) => (
                        <div key={idx} className="space-y-1.5">
                            {section.label && (
                                <div className="px-4 pb-0.5 text-[8px] uppercase tracking-[0.3em] text-brand-white/20 font-black opacity-0 group-hover:opacity-100 transition-all duration-300">
                                    {section.label}
                                </div>
                            )}
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
                                        <span className="font-bold text-[13px] opacity-0 group-hover:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap relative z-10">
                                            {item.label}
                                        </span>
                                    </NavLink>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Profile Section - Refined for both states */}
                <div className="px-3 pt-4 pb-2 border-t border-white/[0.03]">
                    <NavLink
                        to="/select-business"
                        className={({ isActive }) => cn(
                            "flex items-center h-14 rounded-2xl transition-all duration-500 group/profile relative overflow-hidden",
                            "hover:bg-white/[0.05]",
                            "group-hover:bg-white/[0.02] group-hover:border group-hover:border-white/[0.03]", // Capsule only shows when sidebar is expanded
                            isActive && "group-hover:bg-white/[0.08] group-hover:border-white/5"
                        )}
                    >
                        <div className="w-[52px] h-14 flex items-center justify-center shrink-0">
                            <div className="relative w-8 h-8 group-hover/profile:scale-105 transition-transform duration-500 flex items-center justify-center">
                                {/* Primary User Avatar - Anchored to Center */}
                                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-brand-navy bg-brand-navy-light flex items-center justify-center shadow-lg z-20 transition-all duration-700 group-hover:rotate-[-4deg] shrink-0 relative">
                                    {isProfileLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-brand-white" />
                                    ) : profile?.avatar_url ? (
                                        <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                                    ) : (
                                        <UserIcon className="w-4 h-4 text-brand-white" />
                                    )}
                                </div>
                                {/* Secondary Business Logo - Slides out when expanded */}
                                <div className={cn(
                                    "absolute top-0 left-0 rounded-full overflow-hidden border-2 border-brand-navy bg-white flex items-center justify-center shadow-lg z-10 transition-all duration-700",
                                    "w-8 h-8 opacity-0 pointer-events-none",
                                    "group-hover:opacity-100 group-hover:translate-x-3.5 group-hover:pointer-events-auto"
                                )}>
                                    {business?.logo ? (
                                        <img src={business.logo} className="w-full h-full object-contain" alt="" />
                                    ) : (
                                        <Building2 className="w-3 h-3 text-brand-navy/20" />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Text - Scaled down for better fit */}
                        <div className="ml-2 opacity-0 group-hover:opacity-100 transition-all duration-500 delay-150 whitespace-nowrap overflow-hidden">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-brand-white tracking-tight truncate max-w-[120px]">
                                    {business?.name || profile?.name}
                                </span>
                                <div className="flex items-center gap-1 mt-0.5">
                                    <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                    <span className="text-[8px] text-white/30 font-black uppercase tracking-[0.2em]">
                                        {profile?.role || 'Admin'}
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
                        <span className="font-bold text-xs opacity-0 group-hover:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap">
                            Logout
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
