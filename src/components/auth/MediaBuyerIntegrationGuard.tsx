import React from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * Gate a mediabuyer integration route (Google Analytics / Meta Ads) on actual access.
 * RLS scopes the connection tables to the buyer's allow-list, so a count > 0 means
 * the buyer was granted at least one property/account. With no grant the route
 * redirects to the dashboard — the page isn't reachable by direct URL either.
 */
export function MediaBuyerIntegrationGuard({ integration, children }: {
    integration: 'ga' | 'meta';
    children: React.ReactNode;
}) {
    const table = integration === 'ga' ? 'google_analytics_connections' : 'meta_ads_connections';
    const { data: hasAccess, isLoading } = useQuery({
        queryKey: ['mb-integration-guard', integration],
        queryFn: async () => {
            const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });
            return (count ?? 0) > 0;
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="w-6 h-6 animate-spin text-ant-mid" />
            </div>
        );
    }
    if (!hasAccess) return <Navigate to="/mediabuyer/dashboard" replace />;
    return <>{children}</>;
}

export default MediaBuyerIntegrationGuard;
