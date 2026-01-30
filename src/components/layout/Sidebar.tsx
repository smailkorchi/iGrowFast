import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    Home,
    Users,
    DollarSign,
    BarChart2,
    RefreshCcw,
    Lightbulb,
    Megaphone,
    Settings,
    Circle
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
    { icon: Home, label: 'Dashboard', path: '/' },
    { icon: Users, label: 'Customers', path: '/customers' },
    { icon: DollarSign, label: 'Revenue', path: '/payments' },
    { icon: BarChart2, label: 'Performance', path: '/analytics' },
    { icon: RefreshCcw, label: 'Retention', path: '/status' },
    { icon: Lightbulb, label: 'Insights', path: '/import-status' },
    { icon: Megaphone, label: 'Marketing', path: '/sales-channels' },
];

const Sidebar = () => {
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
                <div className="mx-6 border-t border-brand-white/10 mb-4" />

                {/* Navigation Items */}
                <div className="flex-1 px-3 space-y-2 overflow-y-auto no-scrollbar">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) => cn(
                                "flex items-center h-12 rounded-2xl transition-all duration-200 group/item relative",
                                "hover:bg-brand-white/10",
                                isActive ? "bg-brand-white/20 text-brand-white" : "text-brand-white/60 hover:text-brand-white"
                            )}
                        >
                            <div className="w-[52px] h-12 flex items-center justify-center shrink-0">
                                <item.icon className="w-5 h-5" />
                            </div>
                            <span className="font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                                {item.label}
                            </span>

                            {/* Tooltip for collapsed state (optional, but let's keep it clean as per screenshot) */}
                        </NavLink>
                    ))}
                </div>

                {/* Bottom Section */}
                <div className="p-3 space-y-2 mb-4">
                    <NavLink
                        to="/users"
                        className={({ isActive }) => cn(
                            "flex items-center h-12 rounded-2xl transition-all duration-200 group/item",
                            "hover:bg-brand-white/10",
                            isActive ? "bg-brand-white/20 text-brand-white" : "text-brand-white/60 hover:text-brand-white"
                        )}
                    >
                        <div className="w-[52px] h-12 flex items-center justify-center shrink-0">
                            <Settings className="w-5 h-5" />
                        </div>
                        <span className="font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                            Settings
                        </span>
                    </NavLink>

                    <NavLink
                        to="/profile"
                        className={({ isActive }) => cn(
                            "flex items-center h-12 rounded-2xl transition-all duration-200 group/item",
                            "hover:bg-brand-white/10",
                            isActive ? "bg-brand-white/20 text-brand-white" : "text-brand-white/60 hover:text-brand-white"
                        )}
                    >
                        <div className="w-[52px] h-12 flex items-center justify-center shrink-0">
                            <div className="w-8 h-8 rounded-full overflow-hidden border border-brand-white/20 bg-brand-blue flex items-center justify-center">
                                <Users className="w-4 h-4 text-brand-white" />
                            </div>
                        </div>
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity duration-300 overflow-hidden">
                            <span className="font-semibold text-sm whitespace-nowrap">Sarah Chen</span>
                            <span className="text-[10px] text-brand-white/50 whitespace-nowrap">Super Admin</span>
                        </div>
                    </NavLink>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
