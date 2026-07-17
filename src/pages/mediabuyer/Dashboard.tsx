import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    format,
    parseISO,
} from 'date-fns';
import {
    ArrowRight,
    BarChart3,
    AlertTriangle,
    Megaphone,
    CheckCircle2,
    ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    ResponsiveContainer,
    CartesianGrid,
    Tooltip,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useMediaBuyerStats } from '@/hooks/useMediaBuyerStats';
import { todayBusinessYmd, shiftYmd } from '@/lib/dateBuckets';
import { fmtCur, fmtNum } from '@/lib/formatNumbers';
import { getPlatformColor, getPlatformIcon } from '@/lib/campaignConstants';

type Profile = {
    id: string;
    name: string;
    avatar_url: string | null;
    payment_type: 'commission' | 'salary' | null;
    commission_price: number | null;
    salary_amount: number | null;
};

const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const currentUserId = useCurrentUserId();

    const todayKey = todayBusinessYmd();
    const currentMonth = todayKey.slice(0, 7);

    type Preset = 'all' | 'mtd' | 'lastmonth' | '30d' | '7d';
    const [preset, setPreset] = useState<Preset>('all');

    const filterRange = useMemo<{ from: string; to: string; label: string }>(() => {
        const y = Number(todayKey.slice(0, 4));
        const m = Number(todayKey.slice(5, 7));
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const lastDay = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
        switch (preset) {
            case '7d':
                return { from: shiftYmd(todayKey, -6), to: todayKey, label: '7 derniers jours' };
            case '30d':
                return { from: shiftYmd(todayKey, -29), to: todayKey, label: '30 derniers jours' };
            case 'mtd':
                return { from: `${currentMonth}-01`, to: todayKey, label: 'Ce mois-ci' };
            case 'lastmonth': {
                const ly = m === 1 ? y - 1 : y;
                const lm = m === 1 ? 12 : m - 1;
                const key = `${ly}-${pad2(lm)}`;
                return { from: `${key}-01`, to: `${key}-${pad2(lastDay(ly, lm))}`, label: 'Mois dernier' };
            }
            case 'all':
            default:
                return { from: '2020-01-01', to: todayKey, label: 'Depuis le début' };
        }
    }, [preset, todayKey, currentMonth]);

    // ONE mb_dashboard_stats call per window (D2) — it also carries the
    // today-entry campaign ids and the current-month earnings block that the
    // separate campaign_daily_entries + useMediaBuyerEarnings queries used to fetch.
    const {
        totals,
        perCampaign,
        campaigns,
        currency,
        isLoading: loadingStats,
        todayEntryCampaignIds,
        monthEarnings: myEarnings,
    } = useMediaBuyerStats(filterRange);

    // Sparkline shows the last 14 days ONLY — request exactly that window.
    // (Was an all-time RPC whose full daily array got filtered to 14 points.)
    const sparklineRange = useMemo(() => ({ from: shiftYmd(todayKey, -13), to: todayKey }), [todayKey]);
    const { daily } = useMediaBuyerStats(sparklineRange);

    const { data: profile } = useQuery<Profile | null>({
        queryKey: ['mb-dash-profile', currentUserId],
        queryFn: async () => {
            if (!currentUserId) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, payment_type, commission_price, salary_amount')
                .eq('id', currentUserId)
                .single();
            return (data || null) as Profile | null;
        },
        enabled: !!currentUserId,
        staleTime: 5 * 60 * 1000, // own identity row — near-static
    });

    const sparklineStart = shiftYmd(todayKey, -13);
    const sparklineData = useMemo(() => {
        return daily
            .filter((d) => d.date >= sparklineStart)
            .map((d) => ({
                date: format(parseISO(d.date), 'dd MMM'),
                Livré: d.delivered,
                Revenu: Number(d.revenue.toFixed(2)),
            }));
    }, [daily, sparklineStart]);

    const activeCampaigns = useMemo(() => campaigns.filter((c) => c.status === 'active'), [campaigns]);
    const needsAttention = useMemo(
        () => activeCampaigns.filter((c) => !todayEntryCampaignIds.has(c.id)),
        [activeCampaigns, todayEntryCampaignIds]
    );
    const topCampaigns = useMemo(() => perCampaign.filter((c) => c.spend > 0).slice(0, 5), [perCampaign]);

    const firstName = (profile?.name || 'vous').split(' ')[0];
    const greeting = (() => {
        const h = new Date().getHours();
        if (h < 12) return 'Bonjour';
        if (h < 18) return 'Bon après-midi';
        return 'Bonsoir';
    })();

    const presetOptions: Array<{ k: Preset; label: string }> = [
        { k: 'all', label: 'Tout' },
        { k: 'mtd', label: 'Ce mois' },
        { k: 'lastmonth', label: 'Mois dernier' },
        { k: '30d', label: '30j' },
        { k: '7d', label: '7j' },
    ];

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Media Buyer · Tableau de bord
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            {greeting}, {firstName}
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            {activeCampaigns.length} campagne{activeCampaigns.length !== 1 ? 's' : ''} active{activeCampaigns.length !== 1 ? 's' : ''} · performance en temps réel.
                        </p>
                    </div>
                    <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto no-scrollbar">
                        {presetOptions.map(({ k, label }) => (
                            <button
                                key={k}
                                type="button"
                                onClick={() => setPreset(k)}
                                className={cn(
                                    'shrink-0 h-8 px-3 rounded-full text-[11px] font-medium transition-all',
                                    preset === k
                                        ? 'bg-ant-ink text-ant-light shadow-[0_6px_18px_-6px_rgba(20,20,19,0.35)]'
                                        : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            {loadingStats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="bg-ant-paper p-4">
                            <Skeleton className="h-3 w-16 mb-2" />
                            <Skeleton className="h-6 w-20" />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    <KpiTile label="Dépenses" value={fmtCur(totals.spend, currency)} accent="bg-ant-rose" />
                    <KpiTile label="Revenus" value={fmtCur(totals.revenue, currency)} accent="bg-ant-green" />
                    <KpiTile label="Livrées" value={fmtNum(totals.delivered)} accent="bg-ant-green" />
                    <KpiTile label="Confirmées" value={fmtNum(totals.confirmed)} accent="bg-ant-ink" />
                </div>
            )}

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
                {/* Left column */}
                <div className="lg:col-span-2 space-y-4 md:space-y-5">
                    {/* Sparkline */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[11px] text-ant-orange">01</span>
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        14 derniers jours
                                    </span>
                                </div>
                                <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                    Livraisons vs revenus quotidiens
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate('/mediabuyer/statistics')}
                                className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors shrink-0"
                            >
                                Toutes les stats <ArrowRight className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="p-3 md:p-5">
                            {sparklineData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center border border-dashed border-ant-line rounded-xl">
                                    <BarChart3 className="w-6 h-6 text-ant-mid" />
                                    <p className="font-serif italic text-[12px] text-ant-mid">
                                        Aucune donnée pour l'instant. Ajoutez des entrées quotidiennes pour voir les tendances.
                                    </p>
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height={200}>
                                    <AreaChart data={sparklineData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="mbDashDelivGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#141413" stopOpacity={0.16} />
                                                <stop offset="95%" stopColor="#141413" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="mbDashRevGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#2D7A3E" stopOpacity={0.28} />
                                                <stop offset="95%" stopColor="#2D7A3E" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6dc" vertical={false} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b6a63' }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 10, fill: '#6b6a63' }} axisLine={false} tickLine={false} width={40} />
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: 10,
                                                border: '1px solid #e8e6dc',
                                                background: '#ffffff',
                                                boxShadow: '0 8px 24px rgba(20,20,19,0.08)',
                                                fontSize: 11,
                                            }}
                                        />
                                        <Area type="monotone" dataKey="Livré" stroke="#141413" strokeWidth={1.75} fill="url(#mbDashDelivGrad)" />
                                        <Area type="monotone" dataKey="Revenu" stroke="#2D7A3E" strokeWidth={1.75} fill="url(#mbDashRevGrad)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </section>

                    {/* Top campaigns */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[11px] text-ant-orange">02</span>
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        Top campagnes
                                    </span>
                                </div>
                                <p className="font-serif italic text-[12px] text-ant-mid mt-1 truncate">
                                    Triées par revenu · {filterRange.label.toLowerCase()}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate('/mediabuyer/campaigns')}
                                className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors shrink-0"
                            >
                                Toutes <ArrowRight className="w-3 h-3" />
                            </button>
                        </div>
                        {topCampaigns.length === 0 ? (
                            <div className="p-8 flex flex-col items-center justify-center gap-2 text-center">
                                <Megaphone className="w-6 h-6 text-ant-mid" />
                                <p className="font-serif italic text-[12px] text-ant-mid">Aucune donnée de campagne.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-ant-line">
                                {topCampaigns.map((c, i) => (
                                    <button
                                        key={c.id}
                                        onClick={() => navigate(`/mediabuyer/campaigns/${c.id}`)}
                                        className="w-full flex items-center gap-3 px-4 md:px-6 py-3 hover:bg-ant-light/50 transition-colors text-left"
                                    >
                                        <span className="font-display text-[11px] tabular-nums text-ant-mid w-6 shrink-0">
                                            {String(i + 1).padStart(2, '0')}
                                        </span>
                                        <div
                                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                                            style={{ backgroundColor: getPlatformColor(c.platform) }}
                                        >
                                            {getPlatformIcon(c.platform, 'w-3.5 h-3.5')}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-display text-[13px] text-ant-ink truncate leading-tight">{c.name}</p>
                                            <p className="text-[11px] text-ant-mid truncate mt-0.5">
                                                {fmtNum(c.delivered)} livrées · ROAS {c.roas == null ? '—' : c.roas.toFixed(2) + 'x'}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-display text-[14px] tabular-nums text-ant-ink leading-none">
                                                {fmtCur(c.revenue, currency)}
                                            </p>
                                            <p className="text-[10px] tabular-nums text-ant-mid mt-1">{fmtCur(c.spend, currency)} dépensés</p>
                                        </div>
                                        <ChevronRight className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                </div>

                {/* Right column */}
                <div className="lg:col-span-1 space-y-4 md:space-y-5">
                    {/* Needs attention */}
                    <section className={cn(
                        'rounded-2xl border overflow-hidden',
                        needsAttention.length > 0
                            ? 'border-ant-orange/30 bg-ant-orange/5'
                            : 'border-ant-line bg-ant-paper',
                    )}>
                        <div className={cn('h-[3px] w-full', needsAttention.length > 0 ? 'bg-ant-orange' : 'bg-ant-green')} />
                        <div className="px-4 md:px-5 py-3.5 border-b border-ant-line">
                            {needsAttention.length > 0 ? (
                                <>
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="w-3.5 h-3.5 text-ant-orange shrink-0" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-orange">
                                            À compléter
                                        </span>
                                    </div>
                                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                        Aucune entrée pour aujourd'hui
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-ant-green shrink-0" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-green">
                                            Tout à jour
                                        </span>
                                    </div>
                                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                        Entrées du jour enregistrées
                                    </p>
                                </>
                            )}
                        </div>
                        <div className="p-3">
                            {needsAttention.length > 0 ? (
                                <div className="space-y-1.5">
                                    {needsAttention.slice(0, 5).map((c) => (
                                        <button
                                            key={c.id}
                                            onClick={() => navigate(`/mediabuyer/campaigns/${c.id}/manage`)}
                                            className="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-ant-paper border border-ant-orange/25 hover:border-ant-orange/45 transition-colors text-left"
                                        >
                                            <div
                                                className="w-6 h-6 rounded-lg flex items-center justify-center text-white shrink-0"
                                                style={{ backgroundColor: getPlatformColor(c.platform) }}
                                            >
                                                {getPlatformIcon(c.platform, 'w-3 h-3')}
                                            </div>
                                            <p className="flex-1 text-[12px] font-medium text-ant-ink truncate">{c.name}</p>
                                            <ChevronRight className="w-3.5 h-3.5 text-ant-orange shrink-0" />
                                        </button>
                                    ))}
                                    {needsAttention.length > 5 && (
                                        <p className="font-serif italic text-[11px] text-ant-mid text-center pt-1">
                                            +{needsAttention.length - 5} autre{needsAttention.length - 5 > 1 ? 's' : ''}
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="font-serif italic text-[12px] text-ant-mid text-center py-2">
                                    Toutes les campagnes actives ont leurs dépenses et leads du jour.
                                </p>
                            )}
                        </div>
                    </section>

                    {/* Quick actions */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <div className="px-4 md:px-5 py-3.5 border-b border-ant-line">
                            <div className="flex items-center gap-2">
                                <span className="font-display text-[11px] text-ant-orange">03</span>
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Actions rapides
                                </span>
                            </div>
                        </div>
                        <div className="p-2">
                            <QuickAction label="Créer une campagne" onClick={() => navigate('/mediabuyer/campaigns/new')} />
                            <QuickAction label="Voir les statistiques" onClick={() => navigate('/mediabuyer/statistics')} />
                            <QuickAction label="Voir les paiements" onClick={() => navigate('/mediabuyer/payments')} />
                            <QuickAction label="Toutes les campagnes" onClick={() => navigate('/mediabuyer/campaigns')} />
                        </div>
                    </section>

                    {/* Month earnings ink card */}
                    {myEarnings && (
                        <section className="rounded-2xl bg-ant-ink text-ant-light p-4 md:p-5 space-y-3">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                    Ce mois · Vos gains
                                </span>
                            </div>
                            <p className="font-display text-[28px] tabular-nums leading-none text-ant-light">
                                {fmtCur(myEarnings.remaining_amount, currency)}
                            </p>
                            <p className="font-serif italic text-[11px] text-ant-light/60">
                                à percevoir · {fmtNum(myEarnings.delivered_orders)} livrées sur {fmtNum(myEarnings.campaigns_count)} campagne{myEarnings.campaigns_count !== 1 ? 's' : ''}
                            </p>
                            <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/45">
                                    Livrées
                                </span>
                                <span className="font-display text-[13px] tabular-nums text-ant-green">
                                    {fmtNum(myEarnings.delivered_orders)}
                                </span>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
};

const KpiTile: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">
                {label}
            </span>
        </div>
        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
            {value}
        </p>
    </div>
);

const QuickAction: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
    <button
        onClick={onClick}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-ant-light transition-colors text-left group/qa"
    >
        <span className="text-[12px] font-medium text-ant-ink">{label}</span>
        <ChevronRight className="w-3.5 h-3.5 text-ant-mid group-hover/qa:text-ant-ink" />
    </button>
);

export default Dashboard;
