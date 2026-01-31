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
    Target
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { LogOut, User as UserIcon, Loader2 } from 'lucide-react';
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
            { icon: BarChart2, label: 'Analytics', path: '/analytics' },
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
            { icon: MapPin, label: 'Cities', path: '/cities' },
            { icon: Map, label: 'Zones', path: '/zones' },
            { icon: Download, label: 'Import Orders', path: '/import-orders' },
        ]
    }
];

const Sidebar = () => {
    const navigate = useNavigate();

    const { data: profile, isLoading } = useQuery({
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
        navigate('/auth');
    };

    return (
        <div className="fixed left-0 top-0 bottom-0 z-50 flex items-center">
            <div
                className={cn(
                    "group ml-4 flex flex-col h-[calc(100vh-2rem)] bg-brand-navy rounded-[32px] text-brand-white transition-all duration-300 ease-in-out overflow-hidden shadow-2xl border border-brand-white/10",
                    "w-[76px] hover:w-[260px]"
                )}
            >
                {/* Top Logo Section */}
                <div className="flex items-center h-20 shrink-0 px-3">
                    <div className="flex items-center w-full h-12 rounded-2xl relative">
                        <div className="w-[52px] h-12 flex items-center justify-center shrink-0">
                            <div className="w-10 h-10 rounded-full border-2 border-brand-white/20 flex items-center justify-center">
                                <Circle className="w-6 h-6 shrink-0" />
                            </div>
                        </div>
                        <span className="ml-1 font-bold text-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap overflow-hidden">
                            DigiCom
                        </span>
                    </div>
                </div>

                {/* Separator */}
                <div className="mx-6 border-t border-brand-white/10 mb-2" />

                {/* Navigation Sections */}
                <div className="flex-1 px-3 space-y-1 overflow-y-auto no-scrollbar pb-4">
                    {navigation.map((section, idx) => (
                        <div key={idx} className="space-y-1">
                            {section.label && (
                                <div className="px-4 pt-4 pb-1 text-[10px] uppercase tracking-wider text-brand-white/30 font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                    {section.label}
                                </div>
                            )}
                            {section.items.map((item) => (
                                <NavLink
                                    key={item.path}
                                    to={item.path}
                                    className={({ isActive }) => cn(
                                        "flex items-center h-11 rounded-2xl transition-all duration-200 group/item relative",
                                        "hover:bg-brand-white/10",
                                        isActive ? "bg-brand-white/20 text-brand-white" : "text-brand-white/60 hover:text-brand-white"
                                    )}
                                >
                                    <div className="w-[52px] h-11 flex items-center justify-center shrink-0">
                                        <item.icon className="w-5 h-5" />
                                    </div>
                                    <span className="font-medium text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                                        {item.label}
                                    </span>
                                </NavLink>
                            ))}
                        </div>
                    ))}
                </div>

                {/* Profile Section */}
                <div className="px-3 pb-2 border-t border-brand-white/10 pt-4">
                    <NavLink
                        to="/profile"
                        className={({ isActive }) => cn(
                            "flex items-center h-14 rounded-2xl transition-all duration-200 group/item relative",
                            "hover:bg-brand-white/10",
                            isActive ? "bg-brand-white/20 text-brand-white" : "text-brand-white/60 hover:text-brand-white"
                        )}
                    >
                        <div className="w-[52px] h-14 flex items-center justify-center shrink-0">
                            <div className="w-9 h-9 rounded-full overflow-hidden border border-brand-white/20 bg-brand-blue flex items-center justify-center">
                                {isLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : profile?.avatar_url ? (
                                    <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                                ) : (
                                    <UserIcon className="w-5 h-5 text-brand-white" />
                                )}
                            </div>
                        </div>
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity duration-300 overflow-hidden">
                            <span className="font-semibold text-sm whitespace-nowrap capitalize">{profile?.name || 'Loading...'}</span>
                            <span className="text-[10px] text-brand-white/50 whitespace-nowrap uppercase">{profile?.role || 'User'}</span>
                        </div>
                    </NavLink>
                </div>

                {/* Sign Out CTA */}
                <div className="px-3 pb-4">
                    <button
                        onClick={handleLogout}
                        className="flex items-center w-full h-11 rounded-2xl text-brand-red/60 hover:text-brand-red hover:bg-brand-red/10 transition-all duration-200"
                    >
                        <div className="w-[52px] h-11 flex items-center justify-center shrink-0">
                            <LogOut className="w-5 h-5" />
                        </div>
                        <span className="font-medium text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                            Sign Out
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
