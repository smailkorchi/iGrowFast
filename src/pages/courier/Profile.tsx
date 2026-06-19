/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import NiceAvatar from 'react-nice-avatar';
import {
    Phone,
    Mail,
    MapPin,
    IdCard,
    Wallet,
    Coins,
    Loader2,
    LogOut,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

type CourierProfileRow = {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    avatar_url: string | null;
    commission_basis: string | null;
    commission_price: number | null;
    salary_amount: number | null;
    payment_type: string | null;
    cin_number: string | null;
};

const fmtMAD = (n: number | null | undefined) =>
    n === null || n === undefined || n === 0
        ? '—'
        : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

const CourierProfile = () => {
    const navigate = useNavigate();

    const { data: me, isLoading } = useQuery({
        queryKey: ['courier-profile-me'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, email, phone, address, avatar_url, avatar_config, commission_basis, commission_price, salary_amount, payment_type, cin_number')
                .eq('id', user.id)
                .maybeSingle();
            if (error) throw error;
            return data as CourierProfileRow | null;
        },
        staleTime: 60_000,
    });

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('activeBusinessId');
        navigate('/auth');
    };

    if (isLoading || !me) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-6 h-6 text-ant-mid animate-spin" />
                <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">Chargement…</p>
            </div>
        );
    }

    const firstName = (me.name || '').trim().split(/\s+/)[0] || 'Livreur';
    const initials = (me.name || '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('') || 'L';

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Livreur · Profil
                    </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Mon profil
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Vos informations — contact et rémunération.
                        </p>
                    </div>
                </div>
            </header>

            {/* Identity card (ink style, matches Dashboard ink status card) */}
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-ink" />
                <div className="p-4 md:p-6 flex items-center gap-4">
                    <div className="w-16 h-16 md:w-[72px] md:h-[72px] rounded-2xl border border-ant-line bg-ant-light flex items-center justify-center overflow-hidden shrink-0">
                        {me.avatar_url ? (
                            <img src={me.avatar_url} className="w-full h-full object-cover" alt="" />
                        ) : (me as any).avatar_config ? (
                            <NiceAvatar className="w-full h-full" style={{ width: '100%', height: '100%' }} shape="square" {...((me as any).avatar_config)} />
                        ) : (
                            <span className="font-display text-[22px] md:text-[26px] text-ant-ink">{initials}</span>
                        )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                        <p className="font-display text-[18px] md:text-[20px] text-ant-ink leading-tight truncate">
                            {me.name || firstName}
                        </p>
                        <p className="font-serif italic text-[12px] text-ant-mid truncate">
                            {me.email || '—'}
                        </p>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-ant-green" />
                            Livreur actif
                        </span>
                    </div>
                </div>
            </section>

            {/* Contact */}
            <Section title="Contact" indexLabel="01" indexColor="text-ant-orange" stripe="bg-ant-orange">
                <InfoRow icon={Phone} label="Téléphone" value={me.phone || '—'} />
                <InfoRow icon={Mail} label="Email" value={me.email || '—'} />
                <InfoRow icon={MapPin} label="Adresse" value={me.address || '—'} multiline />
                <InfoRow icon={IdCard} label="CIN" value={me.cin_number || '—'} mono />
            </Section>

            {/* Compensation */}
            <Section title="Rémunération" indexLabel="02" indexColor="text-ant-green" stripe="bg-ant-green">
                <InfoRow icon={Wallet} label="Type de paiement" value={me.payment_type || '—'} />
                <InfoRow icon={Coins} label="Base commission" value={me.commission_basis || '—'} />
                <InfoRow icon={Coins} label="Commission (MAD)" value={fmtMAD(me.commission_price)} tabular />
                <InfoRow icon={Coins} label="Salaire (MAD)" value={fmtMAD(me.salary_amount)} tabular />
            </Section>

            {/* Logout action (mobile-first, full-width) */}
            <button
                type="button"
                onClick={handleLogout}
                className="w-full h-11 rounded-full border border-ant-line bg-ant-paper text-ant-rose text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-rose/5 hover:border-ant-rose/40 active:scale-[0.98] transition-all"
            >
                <LogOut className="w-3.5 h-3.5" />
                Déconnexion
            </button>
        </div>
    );
};

export default CourierProfile;

function Section({
    title,
    indexLabel,
    indexColor,
    stripe,
    children,
}: {
    title: string;
    indexLabel: string;
    indexColor: string;
    stripe: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className={cn('h-[3px] w-full', stripe)} />
            <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                <div className="flex items-center gap-2">
                    <span className={cn('font-display text-[11px]', indexColor)}>{indexLabel}</span>
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        {title}
                    </span>
                </div>
            </div>
            <div className="p-4 md:p-6 space-y-3">{children}</div>
        </section>
    );
}

function InfoRow({
    icon: Icon,
    label,
    value,
    mono,
    multiline,
    tabular,
}: {
    icon: LucideIcon;
    label: string;
    value: string;
    mono?: boolean;
    multiline?: boolean;
    tabular?: boolean;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-ant-light flex items-center justify-center text-ant-mid shrink-0">
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                    {label}
                </div>
                <div
                    className={cn(
                        'text-[12px] font-medium text-ant-ink break-words',
                        mono && 'font-mono',
                        tabular && 'tabular-nums',
                        !multiline && 'truncate',
                    )}
                >
                    {value}
                </div>
            </div>
        </div>
    );
}
