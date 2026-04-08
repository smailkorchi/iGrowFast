import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Users, UserCheck, UserX, Shield, ShoppingBag,
    Truck, Camera, Headphones,
} from 'lucide-react';
import {
    PieChart, Pie, Cell, Tooltip, Legend,
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const ROLE_COLORS: Record<string, string> = {
    'super admin': '#c93942',
    'admin': '#3b5e5e',
    'commercial': '#F97316',
    'mediabuyer': '#A855F7',
    'courier': '#14B8A6',
    'owner': '#3B82F6',
};

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    'super admin': Shield,
    'admin': Shield,
    'commercial': ShoppingBag,
    'mediabuyer': Camera,
    'courier': Truck,
    'owner': Headphones,
};

interface UsersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const UsersSection = ({ businessId, dateFilter }: UsersSectionProps) => {
    const { data: users, isLoading } = useQuery({
        queryKey: ['analytics-users', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, role, active, created_at, email')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!users) return null;

        const totalUsers = users.length;
        const activeUsers = users.filter(u => u.active).length;
        const inactiveUsers = totalUsers - activeUsers;

        const roleCounts: Record<string, { total: number; active: number }> = {};
        users.forEach(u => {
            const role = u.role || 'unknown';
            if (!roleCounts[role]) roleCounts[role] = { total: 0, active: 0 };
            roleCounts[role].total++;
            if (u.active) roleCounts[role].active++;
        });

        const roleDistribution = Object.entries(roleCounts)
            .map(([role, data]) => ({
                name: role,
                value: data.total,
                active: data.active,
                inactive: data.total - data.active,
                color: ROLE_COLORS[role] || '#6B7280',
            }))
            .sort((a, b) => b.value - a.value);

        const roleBarData = roleDistribution.map(r => ({
            role: r.name,
            active: r.active,
            inactive: r.inactive,
        }));

        return {
            totalUsers, activeUsers, inactiveUsers,
            roleDistribution, roleBarData,
        };
    }, [users]);

    return (
        <SectionWrapper
            id="users"
            title="Users & Team"
            description="User roles, activity status, and team composition"
            icon={Users}
            iconBg="bg-cyan-50"
            iconColor="text-cyan-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                        <StatCard title="Total Users" value={metrics.totalUsers} icon={Users} iconBg="bg-cyan-50" iconColor="text-cyan-600" />
                        <StatCard title="Active" value={metrics.activeUsers} icon={UserCheck} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                        <StatCard title="Inactive" value={metrics.inactiveUsers} icon={UserX} iconBg="bg-red-50" iconColor="text-red-500" />
                        <StatCard title="Roles" value={metrics.roleDistribution.length} icon={Shield} iconBg="bg-purple-50" iconColor="text-purple-600" />
                        <StatCard title="Active Rate" value={metrics.totalUsers > 0 ? ((metrics.activeUsers / metrics.totalUsers) * 100).toFixed(0) : '0'} suffix="%" icon={UserCheck} iconBg="bg-teal-50" iconColor="text-teal-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Users by Role</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={metrics.roleDistribution} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3} dataKey="value">
                                            {metrics.roleDistribution.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val: number) => `${val} users`} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Active vs Inactive by Role</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={metrics.roleBarData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="role" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Bar dataKey="active" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} name="Active" />
                                        <Bar dataKey="inactive" stackId="a" fill="#EF4444" radius={[8, 8, 0, 0]} name="Inactive" />
                                        <Legend />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="border-0 shadow-sm rounded-3xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold text-brand-navy">Role Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {metrics.roleDistribution.map((role) => {
                                    const RoleIcon = ROLE_ICONS[role.name] || Users;
                                    return (
                                        <div key={role.name} className="flex items-center gap-4 p-4 rounded-2xl bg-brand-navy/[0.02]">
                                            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: role.color + '20' }}>
                                                <RoleIcon className="w-5 h-5" style={{ color: role.color }} />
                                            </div>
                                            <div className="flex-1">
                                                <div className="text-sm font-bold text-brand-navy capitalize">{role.name}</div>
                                                <div className="text-xs text-gray-400">{role.value} total</div>
                                            </div>
                                            <div className="flex gap-2">
                                                <Badge className="bg-emerald-50 text-emerald-600 border-0 text-xs">{role.active} active</Badge>
                                                {role.inactive > 0 && (
                                                    <Badge className="bg-red-50 text-red-500 border-0 text-xs">{role.inactive}</Badge>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </SectionWrapper>
    );
};
