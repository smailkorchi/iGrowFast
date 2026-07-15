import React, { useMemo } from 'react';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
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

/**
 * `users` section of admin_analytics_stats (D3). Window-INDEPENDENT by design:
 * "Users & Team" is a current-state / administrative view, so the fn computes
 * its fixed 30-day activity rule on now() internally and this section takes NO
 * dateFilter — it just rides the one page payload. truly_active = the active
 * flag AND (owner/admin/super admin exempt OR seller/courier on an order
 * touched in the last 30 days OR author of a campaign entry in the last 30
 * days). The orders activity scan deliberately omits `date_deleted` — the old
 * client omitted it too and parity comes first (recon 03 §12).
 */
export interface UsersSlice {
    total_users: number;
    active_users: number;
    inactive_users: number;
    /** Sorted total desc, role asc; `role` is 'unknown' when unset. */
    roles: Array<{ role: string; total: number; active: number }>;
}

interface UsersSectionProps {
    stats?: UsersSlice | null;
}

export const UsersSection = ({ stats }: UsersSectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        const roleDistribution = stats.roles.map(r => ({
            name: r.role,
            value: r.total,
            active: r.active,
            inactive: r.total - r.active,
            color: ROLE_COLORS[r.role] || '#6b6a63',
        }));

        return {
            totalUsers: stats.total_users,
            activeUsers: stats.active_users,
            inactiveUsers: stats.inactive_users,
            roleDistribution,
        };
    }, [stats]);

    return (
        <SectionWrapper
            id="users"
            title="Users & Team"
            description="Current team state. Active = flagged active AND order / campaign activity in the last 30 days (not scoped to the analytics date filter). Owner / admin exempt."
            icon={Users}
            iconColor="text-ant-mid"
            loading={!stats}
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
