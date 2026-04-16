import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    AlertCircle,
    Check,
    ChevronsUpDown,
    Loader2,
    MoreVertical,
    Plus,
    Star,
    Trash2,
} from 'lucide-react';
import { FaFacebook } from 'react-icons/fa';
import { SiMeta } from 'react-icons/si';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {
    useMetaAccountSummary,
    useMetaConnections,
    useDeleteMetaConnection,
    useSetDefaultMetaConnection,
    useStartMetaOAuth,
    type MetaConnection,
} from '@/hooks/useMetaAds';
import { CreateCampaignWizard } from '@/components/meta/CreateCampaignWizard';
import { MetaAdsManager } from '@/components/meta/manager/MetaAdsManager';
import { META_THEME_VARS } from '@/components/meta/shared/metaTheme';

// ── Profile / business resolution ──────────────────────────────────────
function useCurrentProfile() {
    return useQuery({
        queryKey: ['current-profile-meta'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await supabase
                .from('users')
                .select('id, role, "DigiCom Business", name')
                .eq('id', user.id)
                .single();
            return data;
        },
    });
}

function useBusinessesForOwner(enabled: boolean) {
    return useQuery({
        queryKey: ['meta-owner-businesses'],
        enabled,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('businesses')
                .select('id, name')
                .order('name');
            if (error) throw error;
            return data ?? [];
        },
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════
const MetaAdsPage: React.FC = () => {
    const { toast } = useToast();
    const qc = useQueryClient();
    const { data: profile, isLoading: profileLoading } = useCurrentProfile();
    const isOwner = profile?.role === 'owner';
    const { data: businesses } = useBusinessesForOwner(!!isOwner);
    const startOAuth = useStartMetaOAuth();

    // ── OAuth popup listener ────────────────────────────────────────────
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (e.origin !== window.location.origin && e.origin !== 'null') return;
            const msg = e.data;
            if (!msg || msg.type !== 'meta-oauth') return;
            if (msg.ok) {
                const count = Number(msg.count) || 0;
                toast({
                    title: 'Meta Ads connected',
                    description: `${count} ad account${count === 1 ? '' : 's'} linked.`,
                });
                qc.invalidateQueries({ queryKey: ['meta-connections'] });
            } else {
                toast({
                    title: 'Connection failed',
                    description: msg.message ?? 'Unknown error',
                    variant: 'destructive',
                });
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    // ── OAuth full-page fallback ────────────────────────────────────────
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const oauth = params.get('oauth');
        if (!oauth) return;

        const payload =
            oauth === 'success'
                ? { ok: true, count: Number(params.get('count')) || 0 }
                : { ok: false, message: params.get('message') ?? 'Unknown error' };

        const insidePopup = (() => {
            try {
                return !!window.opener && window.opener !== window && !window.opener.closed;
            } catch {
                return false;
            }
        })();

        if (insidePopup) {
            try {
                window.opener.postMessage({ type: 'meta-oauth', ...payload }, window.location.origin);
            } catch { /* cross-origin */ }
            setTimeout(() => {
                try { window.close(); } catch {
                    window.history.replaceState({}, '', window.location.pathname);
                }
            }, 120);
            return;
        }

        if (payload.ok) {
            toast({
                title: 'Meta Ads connected',
                description: `${(payload as any).count} ad account${(payload as any).count === 1 ? '' : 's'} linked.`,
            });
            qc.invalidateQueries({ queryKey: ['meta-connections'] });
        } else {
            toast({
                title: 'Connection failed',
                description: (payload as any).message,
                variant: 'destructive',
            });
        }
        params.delete('oauth');
        params.delete('count');
        params.delete('message');
        const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
        window.history.replaceState({}, '', clean);
    }, []);

    const connectWithFacebook = async (forBusinessId: string) => {
        try {
            const authUrl = await startOAuth.mutateAsync({
                business_id: forBusinessId,
                return_to: window.location.origin + window.location.pathname,
            });
            const w = 600;
            const h = 720;
            const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
            const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
            const features = [
                'popup=yes',
                `width=${w}`,
                `height=${h}`,
                `left=${Math.round(left)}`,
                `top=${Math.round(top)}`,
                'menubar=no',
                'toolbar=no',
                'location=no',
                'status=no',
                'resizable=yes',
                'scrollbars=yes',
            ].join(',');
            const popup = window.open(authUrl, 'meta-oauth', features);
            if (!popup) {
                window.location.href = authUrl;
                return;
            }
            try { popup.focus(); } catch { /* ignore */ }
        } catch (e) {
            toast({
                title: 'Could not start connection',
                description: (e as Error).message,
                variant: 'destructive',
            });
        }
    };

    // ── Business & connection state ─────────────────────────────────────
    const [ownerBusinessId, setOwnerBusinessId] = useState<string | null>(() =>
        localStorage.getItem('meta_owner_business_id')
    );
    useEffect(() => {
        if (ownerBusinessId) localStorage.setItem('meta_owner_business_id', ownerBusinessId);
    }, [ownerBusinessId]);

    const businessId = useMemo(() => {
        if (isOwner) return ownerBusinessId;
        return (profile as { 'DigiCom Business'?: string } | null)?.['DigiCom Business'] ?? null;
    }, [isOwner, ownerBusinessId, profile]);

    const { data: allConnections, isLoading: connectionsLoading } = useMetaConnections();
    const connections = useMemo(() => {
        if (!allConnections || !businessId) return [];
        return allConnections.filter((c) => c['DigiCom Business'] === businessId);
    }, [allConnections, businessId]);

    const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
        () => localStorage.getItem('meta_active_connection')
    );
    const activeConnection = useMemo(() => {
        if (!connections.length) return null;
        const byId = connections.find((c) => c.id === activeConnectionId);
        return byId ?? connections.find((c) => c.is_default) ?? connections[0];
    }, [connections, activeConnectionId]);

    useEffect(() => {
        if (activeConnection) {
            localStorage.setItem('meta_active_connection', activeConnection.id);
            setActiveConnectionId(activeConnection.id);
        }
    }, [activeConnection?.id]);

    const [isCreateOpen, setCreateOpen] = useState(false);
    const { data: accountSummary } = useMetaAccountSummary(activeConnection?.id ?? null);

    // ── Render ──────────────────────────────────────────────────────────
    if (profileLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
            </div>
        );
    }

    if (isOwner && !businessId) {
        return (
            <div className="max-w-3xl mx-auto py-12" style={META_THEME_VARS}>
                <EmptyBusinessPicker
                    businesses={businesses ?? []}
                    onSelect={setOwnerBusinessId}
                />
            </div>
        );
    }

    return (
        <div style={META_THEME_VARS}>
            <div className="space-y-4">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-[#1877F2] flex items-center justify-center">
                            <SiMeta className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-[20px] font-bold text-[#1c1e21]">
                                Ads Manager
                            </h1>
                            <p className="text-[12px] text-[#606770]">
                                Campaigns, ad sets, ads & Pixel events
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {isOwner && businesses && (
                            <BusinessSwitcher
                                businesses={businesses}
                                value={ownerBusinessId}
                                onChange={setOwnerBusinessId}
                            />
                        )}
                    </div>
                </div>

                {/* Connection row */}
                {connectionsLoading ? (
                    <Skeleton className="h-16 w-full rounded-lg" />
                ) : connections.length === 0 ? (
                    <OnboardingCard
                        onConnect={() => connectWithFacebook(businessId!)}
                        isConnecting={startOAuth.isPending}
                    />
                ) : (
                    <div className="flex items-center gap-3">
                        <ConnectionSwitcher
                            connections={connections}
                            active={activeConnection}
                            onChange={(c) => setActiveConnectionId(c.id)}
                            businessId={businessId!}
                            onAdd={() => connectWithFacebook(businessId!)}
                        />
                    </div>
                )}

                {/* Main manager */}
                {connections.length > 0 && activeConnection && (
                    <MetaAdsManager
                        connection={activeConnection}
                        onCreateCampaign={() => setCreateOpen(true)}
                    />
                )}
            </div>

            {activeConnection && (
                <CreateCampaignWizard
                    open={isCreateOpen}
                    onOpenChange={setCreateOpen}
                    connectionId={activeConnection.id}
                    currency={accountSummary?.currency ?? 'USD'}
                />
            )}
        </div>
    );
};

export default MetaAdsPage;

// ═══════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════

const BusinessSwitcher: React.FC<{
    businesses: { id: string; name: string }[];
    value: string | null;
    onChange: (id: string) => void;
}> = ({ businesses, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const current = businesses.find((b) => b.id === value);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button className="flex items-center gap-2 h-8 px-3 rounded-md border border-[#ccd0d5] bg-white text-[13px] font-medium text-[#1c1e21] hover:bg-[#f7f8fa] transition min-w-[180px] justify-between">
                    <span className="truncate">{current?.name ?? 'Select business'}</span>
                    <ChevronsUpDown className="w-3 h-3 text-[#8a8d91]" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] p-1">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => { onChange(b.id); setOpen(false); }}
                        className={cn(
                            'w-full flex items-center justify-between px-3 py-2 rounded text-[13px] text-left hover:bg-[#f7f8fa]',
                            value === b.id && 'bg-[#ebf5ff]'
                        )}
                    >
                        <span className="truncate font-medium text-[#1c1e21]">{b.name}</span>
                        {value === b.id && <Check className="w-3.5 h-3.5 text-[#1877F2]" />}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
};

const EmptyBusinessPicker: React.FC<{
    businesses: { id: string; name: string }[];
    onSelect: (id: string) => void;
}> = ({ businesses, onSelect }) => (
    <div className="bg-white border border-[#e4e6eb] rounded-lg p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-lg bg-[#1877F2] flex items-center justify-center mb-4">
            <SiMeta className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-[18px] font-bold text-[#1c1e21] mb-1">Choose a business</h2>
        <p className="text-[13px] text-[#606770] mb-6">Select a business to view its Meta Ads.</p>
        <div className="max-w-md mx-auto space-y-1">
            {businesses.map((b) => (
                <button
                    key={b.id}
                    onClick={() => onSelect(b.id)}
                    className="w-full px-4 py-3 rounded-lg border border-[#e4e6eb] bg-white hover:bg-[#f7f8fa] hover:border-[#ccd0d5] transition text-left font-semibold text-[#1c1e21] text-[14px]"
                >
                    {b.name}
                </button>
            ))}
        </div>
    </div>
);

const ConnectionSwitcher: React.FC<{
    connections: MetaConnection[];
    active: MetaConnection | null;
    onChange: (c: MetaConnection) => void;
    businessId: string;
    onAdd: () => void;
}> = ({ connections, active, onChange, businessId, onAdd }) => {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();
    const setDefault = useSetDefaultMetaConnection();
    const del = useDeleteMetaConnection();

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button className="group flex items-center gap-3 h-10 px-3 rounded-lg bg-white border border-[#e4e6eb] hover:border-[#ccd0d5] transition min-w-[260px]">
                    <div className="w-7 h-7 rounded-md bg-[#1877F2] flex items-center justify-center shrink-0">
                        <FaFacebook className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                        <div className="text-[10px] text-[#8a8d91] font-semibold uppercase tracking-wider">
                            Ad Account
                        </div>
                        <div className="text-[13px] font-semibold text-[#1c1e21] truncate">
                            {active?.display_name ?? '--'}
                        </div>
                    </div>
                    <ChevronsUpDown className="w-3.5 h-3.5 text-[#8a8d91] shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[340px] p-1">
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8a8d91]">
                    Connected accounts
                </div>
                {connections.map((c) => (
                    <div
                        key={c.id}
                        className={cn(
                            'group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#f7f8fa]',
                            active?.id === c.id && 'bg-[#ebf5ff]'
                        )}
                    >
                        <button
                            onClick={() => { onChange(c); setOpen(false); }}
                            className="flex-1 flex items-center gap-3 text-left min-w-0"
                        >
                            <div className="w-7 h-7 rounded-md bg-[#f0f2f5] flex items-center justify-center shrink-0">
                                <FaFacebook className="w-3.5 h-3.5 text-[#1877F2]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[13px] font-semibold text-[#1c1e21] truncate">
                                        {c.display_name}
                                    </span>
                                    {c.is_default && (
                                        <Star className="w-3 h-3 fill-[#f0ad4e] text-[#f0ad4e] shrink-0" />
                                    )}
                                </div>
                                <div className="text-[11px] text-[#8a8d91] font-mono">
                                    {c.ad_account_id}
                                </div>
                            </div>
                            {active?.id === c.id && (
                                <Check className="w-3.5 h-3.5 text-[#1877F2] shrink-0" />
                            )}
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#e4e6eb] opacity-0 group-hover:opacity-100 transition">
                                    <MoreVertical className="w-3.5 h-3.5 text-[#606770]" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                    disabled={c.is_default}
                                    onClick={async () => {
                                        await setDefault.mutateAsync({ id: c.id, business_id: businessId });
                                        toast({ title: 'Default set', description: c.display_name });
                                    }}
                                >
                                    <Star className="w-3.5 h-3.5 mr-2" />
                                    Make default
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="text-[#e4405f]"
                                    onClick={async () => {
                                        await del.mutateAsync(c.id);
                                        toast({ title: 'Connection removed' });
                                    }}
                                >
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    Remove
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                ))}
                <div className="border-t border-[#e4e6eb] mt-1 pt-1">
                    <button
                        onClick={() => { setOpen(false); onAdd(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold text-[#1877F2] hover:bg-[#f7f8fa]"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Connect another account
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

const OnboardingCard: React.FC<{
    onConnect: () => void;
    isConnecting: boolean;
}> = ({ onConnect, isConnecting }) => (
    <div className="bg-white border border-[#e4e6eb] rounded-lg overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-5">
            <div className="md:col-span-2 p-8 bg-gradient-to-br from-[#1877F2] to-[#0b5fbf] text-white">
                <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center mb-4">
                    <FaFacebook className="w-5 h-5" />
                </div>
                <h2 className="text-[20px] font-bold mb-2">
                    Connect Meta Ads
                </h2>
                <p className="text-[13px] text-white/70 leading-relaxed">
                    One click. Pick which ad accounts and pixels to grant on Facebook's
                    consent screen, and everything lands here.
                </p>
            </div>
            <div className="md:col-span-3 p-8 space-y-4">
                <OnboardingStep num={1} title="Click Connect with Facebook" body="Redirected to Facebook's secure consent screen." />
                <OnboardingStep num={2} title="Pick ad accounts + pixels" body="Tick the ones you want DigiCom to manage." />
                <OnboardingStep num={3} title="Done -- dashboards populate instantly" body="Campaigns, spend, ROAS, pixel events -- live in seconds." />
                <button
                    onClick={onConnect}
                    disabled={isConnecting}
                    className="w-full h-10 rounded-lg bg-[#1877F2] hover:bg-[#166fe5] text-white text-[13px] font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
                >
                    {isConnecting ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Redirecting to Facebook...
                        </>
                    ) : (
                        <>
                            <FaFacebook className="w-4 h-4" />
                            Connect with Facebook
                        </>
                    )}
                </button>
            </div>
        </div>
    </div>
);

const OnboardingStep: React.FC<{ num: number; title: string; body: string }> = ({ num, title, body }) => (
    <div className="flex gap-3">
        <div className="w-6 h-6 rounded-full bg-[#1877F2] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {num}
        </div>
        <div>
            <div className="text-[13px] font-semibold text-[#1c1e21]">{title}</div>
            <div className="text-[12px] text-[#606770] mt-0.5">{body}</div>
        </div>
    </div>
);
