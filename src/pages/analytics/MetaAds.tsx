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
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-[#1877F2]" />
            </div>
        );
    }

    if (isOwner && !businessId) {
        return (
            <div
                className="mx-auto max-w-[640px] px-3 md:px-5 py-6"
                style={META_THEME_VARS}
            >
                <EmptyBusinessPicker
                    businesses={businesses ?? []}
                    onSelect={setOwnerBusinessId}
                />
            </div>
        );
    }

    return (
        <div
            className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3"
            style={META_THEME_VARS}
        >
            {/* Header — matches /analytics compact style */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-[#1877F2] flex items-center justify-center shrink-0">
                        <SiMeta className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            Meta Ads Manager
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            Campaigns · ad sets · ads · pixel events
                        </p>
                    </div>
                </div>
                {isOwner && businesses && (
                    <BusinessSwitcher
                        businesses={businesses}
                        value={ownerBusinessId}
                        onChange={setOwnerBusinessId}
                    />
                )}
            </header>

            {/* Connection row */}
            {connectionsLoading ? (
                <Skeleton className="h-12 w-full rounded-xl" />
            ) : connections.length === 0 ? (
                <OnboardingCard
                    onConnect={() => connectWithFacebook(businessId!)}
                    isConnecting={startOAuth.isPending}
                />
            ) : (
                <div className="flex items-center gap-2">
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
                <button className="flex items-center gap-2 h-7 px-2.5 rounded-md border border-gray-200 bg-white text-[11px] font-semibold text-brand-navy hover:bg-gray-50 transition min-w-[180px] justify-between">
                    <span className="truncate">{current?.name ?? 'Select business'}</span>
                    <ChevronsUpDown className="w-3 h-3 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[240px] p-1">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => { onChange(b.id); setOpen(false); }}
                        className={cn(
                            'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-left hover:bg-gray-100',
                            value === b.id && 'bg-gray-100'
                        )}
                    >
                        <span className="truncate text-brand-navy">{b.name}</span>
                        {value === b.id && <Check className="w-3 h-3 text-brand-navy" />}
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
    <div className="bg-white border border-gray-100 rounded-xl p-5 text-center">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#1877F2] mb-2.5">
            <SiMeta className="w-4 h-4 text-white" />
        </div>
        <h2 className="text-[14px] font-semibold text-brand-navy">Choose a business</h2>
        <p className="text-[11px] text-gray-500 mt-0.5 mb-3">Select a business to view its Meta Ads.</p>
        <div className="max-w-sm mx-auto space-y-1">
            {businesses.map((b) => (
                <button
                    key={b.id}
                    onClick={() => onSelect(b.id)}
                    className="w-full px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition text-left text-[11px] font-semibold text-brand-navy"
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
                <button className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-white border border-gray-200 hover:border-gray-300 transition min-w-[220px]">
                    <FaFacebook className="w-3 h-3 text-[#1877F2] shrink-0" />
                    <div className="flex-1 text-left min-w-0">
                        <div className="text-[9px] text-gray-400 font-bold uppercase tracking-[0.14em] leading-none">
                            Ad account
                        </div>
                        <div className="text-[11px] font-semibold text-brand-navy truncate leading-tight">
                            {active?.display_name ?? '—'}
                        </div>
                    </div>
                    <ChevronsUpDown className="w-3 h-3 text-gray-400 shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-1">
                <div className="px-2.5 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">
                    Connected accounts
                </div>
                {connections.map((c) => (
                    <div
                        key={c.id}
                        className={cn(
                            'group flex items-center gap-1 px-1.5 py-1.5 rounded-md hover:bg-gray-50',
                            active?.id === c.id && 'bg-gray-50'
                        )}
                    >
                        <button
                            onClick={() => { onChange(c); setOpen(false); }}
                            className="flex-1 flex items-center gap-2 text-left min-w-0"
                        >
                            <FaFacebook className="w-3.5 h-3.5 text-[#1877F2] shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                    <span className="text-[11px] font-semibold text-brand-navy truncate">
                                        {c.display_name}
                                    </span>
                                    {c.is_default && (
                                        <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" />
                                    )}
                                </div>
                                <div className="text-[10px] text-gray-400 font-mono">
                                    {c.ad_account_id}
                                </div>
                            </div>
                            {active?.id === c.id && (
                                <Check className="w-3 h-3 text-brand-navy shrink-0" />
                            )}
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white opacity-0 group-hover:opacity-100 transition">
                                    <MoreVertical className="w-3 h-3 text-gray-500" />
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
                                    className="text-red-600"
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
                <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                        onClick={() => { setOpen(false); onAdd(); }}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#1877F2] hover:bg-gray-50"
                    >
                        <Plus className="w-3 h-3" />
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
    <div className="bg-white border border-gray-100 rounded-xl p-3.5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5">
            <div className="md:col-span-2 p-3 rounded-xl bg-[#1877F2]/[0.04] border border-[#1877F2]/15">
                <div className="flex items-center gap-1.5">
                    <FaFacebook className="w-3.5 h-3.5 text-[#1877F2]" />
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">
                        Connect
                    </span>
                </div>
                <h2 className="text-[14px] font-semibold text-brand-navy tracking-tight mt-1">
                    Meta Ads
                </h2>
                <p className="text-[11px] text-gray-500 leading-snug mt-1">
                    One click. Pick which ad accounts and pixels to grant on Facebook's
                    consent screen — everything lands here.
                </p>
            </div>
            <div className="md:col-span-3 space-y-3">
                <OnboardingStep num={1} title="Click Connect with Facebook" body="Redirected to Facebook's secure consent screen." />
                <OnboardingStep num={2} title="Pick ad accounts + pixels" body="Tick the ones you want DigiCom to manage." />
                <OnboardingStep num={3} title="Done — dashboards populate instantly" body="Campaigns, spend, ROAS, pixel events — live in seconds." />
                <button
                    onClick={onConnect}
                    disabled={isConnecting}
                    className="w-full h-8 rounded-md bg-[#1877F2] hover:bg-[#166fe5] text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-60"
                >
                    {isConnecting ? (
                        <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Redirecting to Facebook…
                        </>
                    ) : (
                        <>
                            <FaFacebook className="w-3.5 h-3.5" />
                            Connect with Facebook
                        </>
                    )}
                </button>
            </div>
        </div>
    </div>
);

const OnboardingStep: React.FC<{ num: number; title: string; body: string }> = ({ num, title, body }) => (
    <div className="flex gap-2">
        <div className="w-5 h-5 rounded-full bg-[#1877F2] text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
            {num}
        </div>
        <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-brand-navy">{title}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">{body}</div>
        </div>
    </div>
);
