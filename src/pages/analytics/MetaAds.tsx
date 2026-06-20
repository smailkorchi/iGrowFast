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
    // Mediabuyers run campaigns on assigned ad accounts but cannot connect/remove/set-default.
    const canManage = profile?.role !== 'mediabuyer';
    const { data: businesses } = useBusinessesForOwner(!!isOwner);
    const startOAuth = useStartMetaOAuth();

    // ── OAuth popup listener ────────────────────────────────────────────
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            // Strict origin check. Previously `e.origin === 'null'` was also
            // accepted as a fallback for sandboxed / file:// contexts, but that
            // opens the listener to messages from any sandboxed iframe on any
            // page a user might visit. Legitimate OAuth popups opened from
            // this page always post back with `window.location.origin`.
            if (e.origin !== window.location.origin) return;
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

    // Clear a stale stored business id when it no longer appears in the
    // owner's accessible businesses list (business removed or access
    // revoked). Without this guard the page kept a stuck id and rendered
    // a misleading "no connections yet" onboarding card for a phantom business.
    useEffect(() => {
        if (!isOwner || !businesses || !ownerBusinessId) return;
        if (!businesses.some((b) => b.id === ownerBusinessId)) {
            localStorage.removeItem('meta_owner_business_id');
            setOwnerBusinessId(null);
        }
    }, [isOwner, businesses, ownerBusinessId]);

    const { data: connections = [], isLoading: connectionsLoading } = useMetaConnections(businessId);

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
            <div className="ant-surface flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-ant-ink" />
            </div>
        );
    }

    if (isOwner && !businessId) {
        return (
            <div
                className="ant-surface mx-auto max-w-[640px] px-3 md:px-5 py-6"
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
            className="ant-surface px-2 md:px-3 py-2 space-y-4"
            style={META_THEME_VARS}
        >
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        Meta · Facebook · Instagram
                    </span>
                    <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#1877F2] shrink-0">
                            <SiMeta className="w-4 h-4 text-white" />
                        </span>
                        <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                            Meta Ads
                        </h1>
                    </div>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Campaigns, ad sets, ads and pixel events — live.
                    </p>
                </div>
                {isOwner && businesses && (
                    <BusinessSwitcher
                        businesses={businesses}
                        value={ownerBusinessId}
                        onChange={setOwnerBusinessId}
                    />
                )}
            </header>

            <div className="h-px bg-ant-line" />

            {/* Connection row */}
            {connectionsLoading ? (
                <Skeleton className="h-12 w-full rounded-xl bg-ant-line-soft" />
            ) : connections.length === 0 ? (
                canManage ? (
                    <OnboardingCard
                        onConnect={() => connectWithFacebook(businessId!)}
                        isConnecting={startOAuth.isPending}
                    />
                ) : (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper p-8 text-center">
                        <p className="text-[13px] font-semibold text-ant-ink">Aucun compte publicitaire assigné</p>
                        <p className="text-[12px] text-ant-mid mt-1">Demandez à un administrateur de vous donner accès à un compte Meta Ads.</p>
                    </div>
                )
            ) : (
                <div className="flex items-center gap-2">
                    <ConnectionSwitcher
                        connections={connections}
                        active={activeConnection}
                        onChange={(c) => setActiveConnectionId(c.id)}
                        businessId={businessId!}
                        onAdd={() => connectWithFacebook(businessId!)}
                        canManage={canManage}
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
                <button className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-ant-line bg-ant-paper text-[11px] font-medium text-ant-ink hover:border-ant-ink/25 transition min-w-[200px] justify-between">
                    <span className="truncate">{current?.name ?? 'Select business'}</span>
                    <ChevronsUpDown className="w-3 h-3 text-ant-mid" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="ant-surface w-[260px] p-1 rounded-xl border-ant-line bg-ant-paper">
                {businesses.map((b) => (
                    <button
                        key={b.id}
                        onClick={() => { onChange(b.id); setOpen(false); }}
                        className={cn(
                            'w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11.5px] font-medium text-left hover:bg-ant-line-soft transition',
                            value === b.id && 'bg-ant-line-soft'
                        )}
                    >
                        <span className="truncate text-ant-ink">{b.name}</span>
                        {value === b.id && <Check className="w-3 h-3 text-ant-orange" />}
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
    <div className="rounded-2xl border border-ant-line bg-ant-paper p-6 text-center">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#1877F2] mb-3">
            <SiMeta className="w-5 h-5 text-white" />
        </div>
        <h2 className="font-display text-[20px] font-semibold text-ant-ink tracking-tight">Choose a business</h2>
        <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-4">Select a business to view its Meta Ads.</p>
        <div className="max-w-sm mx-auto space-y-1.5">
            {businesses.map((b) => (
                <button
                    key={b.id}
                    onClick={() => onSelect(b.id)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ant-line bg-ant-paper hover:border-ant-ink/25 hover:bg-ant-line-soft transition text-left text-[12px] font-medium text-ant-ink"
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
    canManage: boolean;
}> = ({ connections, active, onChange, businessId, onAdd, canManage }) => {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();
    const setDefault = useSetDefaultMetaConnection();
    const del = useDeleteMetaConnection();

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button className="flex items-center gap-2.5 h-9 px-3.5 rounded-full bg-ant-paper border border-ant-line hover:border-ant-ink/25 transition min-w-[240px]">
                    <FaFacebook className="w-3.5 h-3.5 text-[#1877F2] shrink-0" />
                    <div className="flex-1 text-left min-w-0">
                        <div className="text-[9px] text-ant-mid font-medium uppercase tracking-[0.2em] leading-none">
                            Ad account
                        </div>
                        <div className="text-[11.5px] font-medium text-ant-ink truncate leading-tight mt-0.5">
                            {active?.display_name ?? '—'}
                        </div>
                    </div>
                    <ChevronsUpDown className="w-3 h-3 text-ant-mid shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="ant-surface w-[340px] p-1.5 rounded-xl border-ant-line bg-ant-paper">
                <div className="px-2.5 pt-1 pb-1.5 text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-mid">
                    Connected accounts
                </div>
                {connections.map((c) => (
                    <div
                        key={c.id}
                        className={cn(
                            'group flex items-center gap-1 px-1.5 py-1.5 rounded-lg hover:bg-ant-line-soft',
                            active?.id === c.id && 'bg-ant-line-soft'
                        )}
                    >
                        <button
                            onClick={() => { onChange(c); setOpen(false); }}
                            className="flex-1 flex items-center gap-2 text-left min-w-0"
                        >
                            <FaFacebook className="w-3.5 h-3.5 text-[#1877F2] shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11.5px] font-semibold text-ant-ink truncate">
                                        {c.display_name}
                                    </span>
                                    {c.is_default && (
                                        <Star className="w-3 h-3 fill-ant-orange text-ant-orange shrink-0" />
                                    )}
                                </div>
                                <div className="text-[10px] text-ant-mid font-mono">
                                    {c.ad_account_id}
                                </div>
                            </div>
                            {active?.id === c.id && (
                                <Check className="w-3 h-3 text-ant-orange shrink-0" />
                            )}
                        </button>
                        {canManage && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-ant-paper opacity-0 group-hover:opacity-100 transition">
                                    <MoreVertical className="w-3 h-3 text-ant-muted" />
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
                                    className="text-ant-rose"
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
                        )}
                    </div>
                ))}
                {canManage && (
                <div className="border-t border-ant-line mt-1 pt-1">
                    <button
                        onClick={() => { setOpen(false); onAdd(); }}
                        className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11.5px] font-semibold text-[#1877F2] hover:bg-ant-line-soft"
                    >
                        <Plus className="w-3 h-3" />
                        Connect another account
                    </button>
                </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

const OnboardingCard: React.FC<{
    onConnect: () => void;
    isConnecting: boolean;
}> = ({ onConnect, isConnecting }) => (
    <div className="rounded-2xl border border-ant-line bg-ant-paper p-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
            <div className="md:col-span-2 p-4 rounded-xl bg-ant-light border border-ant-line">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#1877F2] mb-3">
                    <FaFacebook className="w-4 h-4 text-white" />
                </div>
                <div className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                    Connect
                </div>
                <h2 className="font-display text-[20px] font-semibold text-ant-ink tracking-tight mt-1">
                    Meta Ads
                </h2>
                <p className="font-serif-display text-[12.5px] text-ant-muted italic leading-relaxed mt-2">
                    One click. Pick which ad accounts and pixels to grant on Facebook's consent screen — everything lands here.
                </p>
            </div>
            <div className="md:col-span-3 space-y-4">
                <OnboardingStep num={1} title="Click Connect with Facebook" body="Redirected to Facebook's secure consent screen." />
                <OnboardingStep num={2} title="Pick ad accounts + pixels" body="Tick the ones you want iGrowFast to manage." />
                <OnboardingStep num={3} title="Dashboards populate instantly" body="Campaigns, spend, ROAS, pixel events — live in seconds." />
                <button
                    onClick={onConnect}
                    disabled={isConnecting}
                    className="w-full h-11 rounded-full bg-[#1877F2] hover:bg-[#166fe5] text-white text-[12px] font-medium flex items-center justify-center gap-2 transition disabled:opacity-60"
                >
                    {isConnecting ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Redirecting to Facebook…
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
        <div className="font-display w-7 h-7 rounded-full border border-ant-line bg-ant-paper text-[#1877F2] text-[11px] font-semibold tabular-nums flex items-center justify-center shrink-0 tracking-[0.04em]">
            {String(num).padStart(2, '0')}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
            <div className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">{title}</div>
            <div className="text-[11.5px] text-ant-muted mt-0.5 leading-snug">{body}</div>
        </div>
    </div>
);
