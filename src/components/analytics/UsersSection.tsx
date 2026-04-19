import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Users, Shield, ShoppingBag, Truck, Camera, Headphones,
} from 'lucide-react';

const ROLE_COLORS: Record<string, string> = {
    'super admin': '#8d8b84',
    'admin': '#141413',
    'commercial': '#6a9bcc',
    'mediabuyer': '#b0aea5',
    'courier': '#c96356',
    'owner': '#788c5d',
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

    // Recent activity proxy — any order assigned as seller/courier in the last 30 days,
    // or any campaign entry authored in the last 30 days. Used with users.active to mark
    // a team member as truly active (flag AND recent activity, per §17).
    const { data: recentActivity } = useQuery({
        queryKey: ['analytics-users-recent-activity', businessId],
        queryFn: async () => {
            const since = new Date();
            since.setDate(since.getDate() - 30);
            const sinceIso = since.toISOString();
            const [orderRes, entryRes] = await Promise.all([
                supabase
                    .from('orders')
                    .select('seller_id, courier_id, updated_at')
                    .eq('DigiCom Business', businessId)
                    .gte('updated_at', sinceIso),
                (supabase as any)
                    .from('campaign_daily_entries')
                    .select('created_by, entry_date')
                    .eq('DigiCom Business', businessId)
                    .gte('entry_date', sinceIso.slice(0, 10)),
            ]);
            const active = new Set<string>();
            (orderRes.data || []).forEach((r: { seller_id?: string | null; courier_id?: string | null }) => {
                if (r.seller_id) active.add(r.seller_id);
                if (r.courier_id) active.add(r.courier_id);
            });
            (entryRes.data || []).forEach((r: { created_by?: string | null }) => {
                if (r.created_by) active.add(r.created_by);
            });
            return active;
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!users) return null;

        const recentlyActiveIds: Set<string> = recentActivity || new Set<string>();
        const isTrulyActive = (u: { id: string; active?: boolean | null; role?: string | null }) => {
            if (!u.active) return false;
            // Owner/admin users aren't expected to produce order/campaign activity — accept the flag alone.
            if (u.role === 'owner' || u.role === 'admin' || u.role === 'super admin') return true;
            return recentlyActiveIds.has(u.id);
        };

        const totalUsers = users.length;
        const activeUsers = users.filter(isTrulyActive).length;
        const inactiveUsers = totalUsers - activeUsers;

        const roleCounts: Record<string, { total: number; active: number }> = {};
        users.forEach(u => {
            const role = u.role || 'unknown';
            if (!roleCounts[role]) roleCounts[role] = { total: 0, active: 0 };
            roleCounts[role].total++;
            if (isTrulyActive(u)) roleCounts[role].active++;
        });

        const roleDistribution = Object.entries(roleCounts)
            .map(([role, data]) => ({
                name: role,
                value: data.total,
                active: data.active,
                inactive: data.total - data.active,
                color: ROLE_COLORS[role] || '#6b6a63',
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
    }, [users, recentActivity]);

    return (
        <SectionWrapper
            id="users"
            title="Users & Team"
            description="Active = flagged active AND activity in the last 30 days. Owner/admin exempt."
            icon={Users}
            iconColor="text-ant-mid"
            loading={isLoading}
        >
            {metrics && (() => {
                const activeRate = metrics.totalUsers > 0 ? (metrics.activeUsers / metrics.totalUsers) * 100 : 0;
                const rateTone: 'positive' | 'warning' | 'negative' =
                    activeRate >= 80 ? 'positive' : activeRate >= 50 ? 'warning' : 'negative';
                const topRole = [...metrics.roleDistribution].sort((a, b) => b.value - a.value)[0];
                const narrative = metrics.totalUsers === 0
                    ? 'No users on the team yet.'
                    : `${metrics.activeUsers.toLocaleString('fr-MA')} of ${metrics.totalUsers.toLocaleString('fr-MA')} users are active across ${metrics.roleDistribution.length} roles.${
                          topRole ? ` Largest role: ${topRole.name} with ${topRole.value} members.` : ''
                      }${metrics.inactiveUsers > 0 ? ` ${metrics.inactiveUsers} user${metrics.inactiveUsers > 1 ? 's' : ''} inactive.` : ''}`;

                return (
                    <SectionStory
                        hero={{
                            label: 'active team',
                            value: `${metrics.activeUsers.toLocaleString('fr-MA')}`,
                            suffix: `of ${metrics.totalUsers}`,
                            tone: rateTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Total users', value: metrics.totalUsers.toLocaleString('fr-MA') },
                            { label: 'Active', value: metrics.activeUsers.toLocaleString('fr-MA'), tone: 'positive' },
                            { label: 'Inactive', value: metrics.inactiveUsers.toLocaleString('fr-MA'), tone: metrics.inactiveUsers > 0 ? 'negative' : 'neutral' },
                            { label: 'Roles', value: metrics.roleDistribution.length.toString() },
                            { label: 'Active rate', value: `${activeRate.toFixed(0)}%`, tone: rateTone },
                        ]}
                    >

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <CardTitle className="text-[12px] font-semibold text-ant-ink">Team by role</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-1.5">
                                {metrics.roleDistribution.map((role) => {
                                    const RoleIcon = ROLE_ICONS[role.name] || Users;
                                    return (
                                        <div
                                            key={role.name}
                                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-ant-line flex-1 min-w-[150px] max-w-[240px]"
                                        >
                                            <RoleIcon className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[11px] font-semibold text-ant-ink capitalize leading-tight truncate">
                                                    {role.name}
                                                </div>
                                                <div className="text-[10px] text-ant-mid tabular-nums">{role.value} total</div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0 tabular-nums">
                                                <span className="text-[10px] font-semibold text-ant-green">{role.active}</span>
                                                {role.inactive > 0 && (
                                                    <>
                                                        <span className="text-[9px] text-ant-mid">/</span>
                                                        <span className="text-[10px] font-semibold text-ant-rose">{role.inactive}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
