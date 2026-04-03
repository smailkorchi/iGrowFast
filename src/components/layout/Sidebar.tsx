import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
    Home,
    Users,
    DollarSign,
    BarChart2,
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
    Upload,
    CheckCircle,
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
    Key,
    Briefcase,
    LayoutDashboard,
    FileSpreadsheet,
    Receipt,
    ClipboardList,
    PackageCheck,
    Smartphone,
    Bot
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
    icon?: any;
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
        icon: Truck,
        items: [
            { icon: FileText, label: 'Delivery Note', path: '/delivery-note' },
            { icon: Repeat, label: 'Return Note', path: '/return-note' },
            { icon: CreditCard, label: 'Payment', path: '/payments' },
            { icon: Globe, label: 'Delivery Services', path: '/delivery-services' },
            { icon: Zap, label: 'Webhooks', path: '/webhooks' },
        ]
    },
    {
        label: 'Inventory',
        icon: Package,
        items: [
            { icon: ArrowRightLeft, label: 'Transactions', path: '/transactions' },
            { icon: Box, label: 'Products', path: '/products' },
            { icon: Puzzle, label: 'Accessories', path: '/accessories' },
        ]
    },
    {
        items: [
            { icon: Target, label: 'Ads History', path: '/ads-history' },
        ]
    },
    {
        items: [
            { icon: Megaphone, label: 'Sales Channels', path: '/sales-channels' },
            { icon: Users, label: 'Customers', path: '/customers' },
            { icon: UserPlus, label: 'Users', path: '/users' },
        ]
    },
    {
        label: 'Sellers',
        icon: Store,
        items: [
            { icon: Users, label: 'Sellers', path: '/sellers' },
            { icon: MessageSquare, label: 'Demands', path: '/demands' },
            { icon: DollarSign, label: 'Salaries', path: '/salaries' },
        ]
    },
    {
        label: 'Business',
        icon: Briefcase,
        items: [
            { icon: LayoutDashboard, label: 'Overview', path: '/business' },
            { icon: Wallet, label: 'Payments', path: '/business/payments' },
        ]
    },
    {
        label: 'WhatsApp',
        icon: MessageSquare,
        items: [
            { icon: Smartphone, label: 'Instances', path: '/business/whatsapp/manager' },
            { icon: MessageSquare, label: 'Inbox', path: '/business/whatsapp/inbox' },
            { icon: Bot, label: 'Automations', path: '/business/whatsapp/automations' },
        ]
    },
    {
        label: 'Expenses',
        icon: Wallet,
        items: [
            { icon: List, label: 'Expenses Details', path: '/expenses-details' },
            { icon: Tag, label: 'Expenses Types', path: '/expenses-types' },
        ]
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
        ]
    },
    {
        label: 'Settings',
        icon: Settings,
        items: [
            { icon: Upload, label: 'Import Orders', path: '/import-orders' },
            { icon: Upload, label: 'Import Products', path: '/import-products' },
            { icon: Upload, label: 'Import Accessories', path: '/import-accessories' },
            { icon: Key, label: 'AI Keys', path: '/ai-keys' },
        ]
    },
];

const Sidebar = () => {
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
        <aside className={cn(
            "relative flex-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group/sidebar",
            isPinned ? "w-[276px]" : "w-[92px] hover:w-[276px]"
        )}>
            {/* 
                Fixed Container: 
                We use w-inherit logic manually via classes to ensure the labels and width expand correctly.
                The pointer-events-none on the fixed wrapper ensures it doesn't block the page, 
                while the pointer-events-auto on the actual sidebar allows interaction.
            */}
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
                                                {section.icon && <section.icon className="w-5 h-5" />}
                                            </div>
                                            <div className="flex-1 flex items-center justify-between pr-4 opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75">
                                                <span className="font-bold text-[13px] whitespace-nowrap">
                                                    {section.label}
                                                </span>
                                                <ChevronRight className={cn(
                                                    "w-4 h-4 transition-transform duration-300",
                                                    expandedSection === section.label && "rotate-90"
                                                )} />
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
                                                            <span className="font-bold text-[12px] opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap relative z-10">
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
                                                <span className="font-bold text-[13px] opacity-0 group-hover/sidebar-inner:opacity-100 group-data-[pinned=true]/sidebar-inner:opacity-100 transition-all duration-500 delay-75 whitespace-nowrap relative z-10">
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
                            to="/profile"
                            className={({ isActive }) => cn(
                                "flex items-center h-14 rounded-2xl transition-all duration-500 group/profile relative overflow-hidden",
                                "hover:bg-white/[0.05]",
                                "group-hover/sidebar-inner:bg-white/[0.02] group-data-[pinned=true]/sidebar-inner:bg-white/[0.02] group-hover/sidebar-inner:border group-data-[pinned=true]/sidebar-inner:border group-hover/sidebar-inner:border-white/[0.03] group-data-[pinned=true]/sidebar-inner:border-white/[0.03]",
                                isActive && "group-hover/sidebar-inner:bg-white/[0.08] group-data-[pinned=true]/sidebar-inner:bg-white/[0.08] group-hover/sidebar-inner:border-white/5 group-data-[pinned=true]/sidebar-inner:border-white/5"
                            )}
                        >
                            <div className="w-[52px] h-14 flex items-center justify-center shrink-0">
                                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white/10 bg-brand-navy-light flex items-center justify-center shadow-lg group-hover/profile:scale-105 transition-transform duration-500">
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
                                        {profile?.name || 'User'}
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

export default Sidebar;
