import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';

export type ProviderHealth = {
    providerId: string;
    providerName: string;
    providerColor: string | null;
    lastReceivedAt: string | null;
    isActive: boolean;
};

export type WebhookHealthState = {
    providers: ProviderHealth[];
    activeCount: number;
    lastEventAt: string | null;
    recentTotal: number;
    recentProcessed: number;
    recentFailed: number;
    isListening: boolean;
    /** Incremented on each realtime webhook_log INSERT for pulse animation */
    pulse: number;
};

export function useWebhookHealth(activeBusinessId: string | null): WebhookHealthState {
    const [isListening, setIsListening] = useState(false);
    const [pulse, setPulse] = useState(0);
    const pulseRef = useRef(0);

    // Fetch active webhooks with provider info
    const { data: webhooks } = useQuery({
        queryKey: ['webhook-health-providers', activeBusinessId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('provider_webhooks')
                .select('id, provider_id, is_active, last_received_at, providers(name, color)')
                .eq('DigiCom Business', activeBusinessId!)
                .eq('is_active', true);
            if (error) throw error;
            return data;
        },
        enabled: !!activeBusinessId,
        refetchInterval: 60_000, // refresh every minute
    });

    // Fetch recent webhook_logs stats (last 1 hour)
    const { data: recentStats } = useQuery({
        queryKey: ['webhook-health-stats', activeBusinessId],
        queryFn: async () => {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            return await fetchAllRows('webhook_logs', 'id, processed, created_at', {
                filters: [
                    { column: 'DigiCom Business', op: 'eq', value: activeBusinessId! },
                    { column: 'created_at', op: 'gte', value: oneHourAgo },
                ],
            });
        },
        enabled: !!activeBusinessId,
        refetchInterval: 30_000, // refresh every 30s
    });

    // Realtime subscription on webhook_logs for live pulse
    useEffect(() => {
        if (!activeBusinessId) return;

        const channel = supabase
            .channel(`webhook-health-${activeBusinessId}`)
            .on(
                'postgres_changes' as any,
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'webhook_logs',
                },
                () => {
                    pulseRef.current += 1;
                    setPulse(pulseRef.current);
                }
            )
            .subscribe((status: string) => {
                setIsListening(status === 'SUBSCRIBED');
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeBusinessId]);

    // Build provider list
    const providers: ProviderHealth[] = (webhooks || []).map((wh: any) => ({
        providerId: wh.provider_id,
        providerName: (wh.providers as any)?.name || 'Unknown',
        providerColor: (wh.providers as any)?.color || null,
        lastReceivedAt: wh.last_received_at,
        isActive: wh.is_active,
    }));

    const logs = recentStats || [];
    const recentTotal = logs.length;
    const recentProcessed = logs.filter((l: any) => l.processed).length;
    const recentFailed = recentTotal - recentProcessed;
    const lastEventAt = logs.length > 0 ? logs[0].created_at : null;

    return {
        providers,
        activeCount: providers.length,
        lastEventAt,
        recentTotal,
        recentProcessed,
        recentFailed,
        isListening,
        pulse,
    };
}
