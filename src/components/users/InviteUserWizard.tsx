import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { FaWhatsapp } from 'react-icons/fa';
import {
    Crown, Shield, Headphones, Bike, Target, ArrowRight, ArrowLeft, Loader2, Copy, Check,
    Link as LinkIcon, Search, SlidersHorizontal, UserPlus, Package, Wallet, Sparkles,
    BarChart3, Megaphone, Mail, MailCheck, AlertCircle, Send, type LucideIcon,
} from 'lucide-react';
import {
    createInvitation, checkInviteEmail, sendInvitationEmail, invitationReason,
    USER_PAGES, type InviteRole,
} from '@/lib/invitations';

interface RoleMeta {
    key: InviteRole;
    label: string;
    desc: string;
    icon: LucideIcon;
    tile: string;   // icon tile classes
    ring: string;   // selected ring color
    dot: string;
}

const ROLES: RoleMeta[] = [
    { key: 'super admin', label: 'Super admin', desc: 'Unrestricted access to the business.', icon: Crown, tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose', ring: 'ring-ant-rose/60', dot: 'bg-ant-rose' },
    { key: 'admin', label: 'Admin', desc: 'Operational owner with chosen page access.', icon: Shield, tile: 'bg-ant-ink/6 border-ant-ink/20 text-ant-ink', ring: 'ring-ant-ink/50', dot: 'bg-ant-ink' },
    { key: 'commercial', label: 'Commercial', desc: 'Sells, talks to customers, earns commission.', icon: Headphones, tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange', ring: 'ring-ant-orange/60', dot: 'bg-ant-orange' },
    { key: 'courier', label: 'Courier', desc: 'Delivers parcels to the customer’s door.', icon: Bike, tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green', ring: 'ring-ant-green/60', dot: 'bg-ant-green' },
    { key: 'mediabuyer', label: 'Media buyer', desc: 'Runs the ads across every platform.', icon: Target, tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange', ring: 'ring-ant-orange/60', dot: 'bg-ant-orange' },
];

const STEPS = [
    { label: 'Role', icon: UserPlus },
    { label: 'Access', icon: SlidersHorizontal },
    { label: 'Link', icon: LinkIcon },
] as const;

interface InviteUserWizardProps {
    isOpen: boolean;
    onClose: () => void;
    activeBusinessId: string | null;
}

export const InviteUserWizard = ({ isOpen, onClose, activeBusinessId }: InviteUserWizardProps) => {
    const { toast } = useToast();
    const [step, setStep] = useState<0 | 1 | 2>(0);
    const [role, setRole] = useState<InviteRole | null>(null);

    // Authorization fields (admin-set; never the invitee's identity).
    const [pages, setPages] = useState<Record<string, boolean>>({});
    const [commissionPrice, setCommissionPrice] = useState(0);
    const [commissionBasis, setCommissionBasis] = useState<'per_order' | 'per_unit'>('per_order');
    const [paymentType, setPaymentType] = useState<'commission' | 'salary'>('commission');
    const [salaryAmount, setSalaryAmount] = useState(0);
    const [productIds, setProductIds] = useState<string[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [waMode, setWaMode] = useState<'none' | 'all' | 'specific'>('none');
    const [waInstanceIds, setWaInstanceIds] = useState<string[]>([]);
    // Media-buyer integration scoping (which GA properties / Meta ad accounts they may see).
    const [gaMode, setGaMode] = useState<'none' | 'all' | 'specific'>('none');
    const [gaIds, setGaIds] = useState<string[]>([]);
    const [metaMode, setMetaMode] = useState<'none' | 'all' | 'specific'>('none');
    const [metaIds, setMetaIds] = useState<string[]>([]);
    const [parcelFragile, setParcelFragile] = useState(false);
    const [parcelOpen, setParcelOpen] = useState(false);
    const [parcelTryOn, setParcelTryOn] = useState(false);
    const [phone, setPhone] = useState('');

    const [generating, setGenerating] = useState(false);
    const [link, setLink] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Invitee email (captured on step 1, BEFORE generating) — where the link / reminders / revocation go.
    // Verified server-side with the same deliverability checks as registration.
    const [inviteEmail, setInviteEmail] = useState('');
    const [emailCheck, setEmailCheck] = useState<{ status: 'idle' | 'checking' | 'ok' | 'bad' | 'unknown'; reason?: string; suggestion?: string }>({ status: 'idle' });
    // Step 2 "Send" button (emails the link to the stored invitee).
    const [createdEmail, setCreatedEmail] = useState<string | null>(null); // email actually stored on the invite (null = none)
    const [sending, setSending] = useState(false);
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);

    const reset = () => {
        setStep(0); setRole(null); setPages({}); setCommissionPrice(0); setCommissionBasis('per_order');
        setPaymentType('commission'); setSalaryAmount(0); setProductIds([]); setProductSearch('');
        setWaMode('none'); setWaInstanceIds([]); setParcelFragile(false); setParcelOpen(false);
        setParcelTryOn(false); setPhone(''); setLink(null); setToken(null); setCopied(false); setGenerating(false);
        setGaMode('none'); setGaIds([]); setMetaMode('none'); setMetaIds([]);
        setInviteEmail(''); setEmailCheck({ status: 'idle' }); setSending(false); setSentTo(null); setSendError(null); setCreatedEmail(null);
    };

    useEffect(() => { if (isOpen) reset(); }, [isOpen]);

    const roleMeta = ROLES.find((r) => r.key === role);

    const { data: products } = useQuery({
        queryKey: ['invite-products', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('products').select('id, name, code')
                .eq('active', true).eq('DigiCom Business', activeBusinessId).order('name');
            return data ?? [];
        },
        enabled: isOpen && role === 'commercial' && !!activeBusinessId,
    });

    const { data: waInstances } = useQuery({
        queryKey: ['invite-wa-instances', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await (supabase as any).from('whatsapp_instances')
                .select('id, instance_name, phone_number, status')
                .eq('business_id', activeBusinessId).eq('status', 'open').order('created_at');
            return data ?? [];
        },
        enabled: isOpen && role === 'commercial' && !!activeBusinessId,
    });

    const { data: gaConns } = useQuery({
        queryKey: ['invite-ga-conns', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('google_analytics_connections')
                .select('id, display_name, property_id').eq('DigiCom Business', activeBusinessId).order('display_name');
            return data ?? [];
        },
        enabled: isOpen && role === 'mediabuyer' && !!activeBusinessId,
    });

    const { data: metaConns } = useQuery({
        queryKey: ['invite-meta-conns', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('meta_ads_connections')
                .select('id, display_name, ad_account_id').eq('DigiCom Business', activeBusinessId).order('display_name');
            return data ?? [];
        },
        enabled: isOpen && role === 'mediabuyer' && !!activeBusinessId,
    });

    const filteredProducts = useMemo(() => (products ?? []).filter((p: any) =>
        p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.code?.toLowerCase().includes(productSearch.toLowerCase())), [products, productSearch]);

    const buildPayload = (): Record<string, unknown> => {
        const base: Record<string, unknown> = { active: true };
        if (role === 'admin') return { ...base, permissions: { pages } };
        if (role === 'super admin') return base;
        if (role === 'commercial') return {
            ...base, commission_price: commissionPrice, commission_basis: commissionBasis,
            payment_type: paymentType, salary_amount: salaryAmount, assignment: 0, products: productIds,
            whatsapp_access: { mode: waMode, instance_ids: waMode === 'specific' ? waInstanceIds : [] },
        };
        if (role === 'courier') return {
            ...base, courier_parcel_fragile: parcelFragile, courier_parcel_open: parcelOpen,
            courier_parcel_try_on: parcelTryOn, phone: phone || null,
        };
        if (role === 'mediabuyer') return {
            ...base, payment_type: paymentType, salary_amount: salaryAmount, commission_price: commissionPrice,
            ga_access: { mode: gaMode, ids: gaMode === 'specific' ? gaIds : [] },
            meta_access: { mode: metaMode, ids: metaMode === 'specific' ? metaIds : [] },
        };
        return base;
    };

    const emailFmtValid = useMemo(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.trim()), [inviteEmail]);
    // Email is OPTIONAL — it never gates creation. The live check is a hint only.

    // Debounced deliverability probe on the Access step (admin-gated, no invite token yet).
    useEffect(() => {
        if (step !== 1) return;
        const e = inviteEmail.trim().toLowerCase();
        if (!emailFmtValid) { setEmailCheck({ status: 'idle' }); return; }
        setEmailCheck({ status: 'checking' });
        let active = true;
        const t = window.setTimeout(async () => {
            const res = await checkInviteEmail(e);
            if (!active) return;
            if (res.ok && res.deliverable) setEmailCheck({ status: 'ok' });
            else if (res.reason === 'error') setEmailCheck({ status: 'unknown' });
            else setEmailCheck({ status: 'bad', reason: res.reason, suggestion: res.suggestion });
        }, 600);
        return () => { active = false; window.clearTimeout(t); };
    }, [inviteEmail, emailFmtValid, step]);

    const generate = async () => {
        if (!role) return;
        setGenerating(true);
        try {
            const res = await createInvitation({
                target_role: role, email: inviteEmail.trim().toLowerCase(), profile_payload: buildPayload(),
            });
            setLink(res.link);
            setToken(res.token);
            setCreatedEmail(res.email ?? null);
            setSentTo(null); setSendError(null);
            setStep(2);
        } catch (e) {
            toast({ title: 'Could not create link', description: (e as Error).message, variant: 'destructive' });
        } finally {
            setGenerating(false);
        }
    };

    const copy = async () => {
        if (!link) return;
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const sendInvite = async () => {
        if (!token || sending) return;
        setSending(true); setSendError(null);
        try {
            const res = await sendInvitationEmail(token);
            if (!res.ok) { setSendError(invitationReason(res.reason)); return; }
            setSentTo(inviteEmail.trim().toLowerCase());
        } catch (e) {
            setSendError((e as Error).message);
        } finally {
            setSending(false);
        }
    };

    const toggle = (arr: string[], setArr: (v: string[]) => void, id: string) =>
        setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

    const inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink focus-visible:ring-1 focus-visible:ring-ant-orange/40';
    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';
    const pillBtn = (active: boolean) => cn(
        'h-9 px-3.5 rounded-full text-[11px] font-semibold border transition cursor-pointer',
        active ? 'bg-ant-ink text-white border-ant-ink shadow-sm' : 'border-ant-line text-ant-mid hover:text-ant-ink hover:border-ant-ink/30',
    );

    const SectionHeader = ({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) => (
        <div className="flex items-center gap-2.5 mb-3">
            <div className="w-7 h-7 rounded-lg bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink">
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div>
                <p className="text-[13px] font-semibold text-ant-ink leading-none">{title}</p>
                {hint && <p className="text-[11px] text-ant-mid mt-1">{hint}</p>}
            </div>
        </div>
    );

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col">
                {/* Premium header with gradient hairline */}
                <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-orange/60 to-transparent" />
                <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-ant-ink text-white flex items-center justify-center shrink-0 shadow-sm">
                            <Sparkles className="w-5 h-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Invite teammate
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                {step === 0 ? 'Choose a role' : step === 1 ? 'Set access & terms' : 'Share the invite link'}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                {step === 0 ? 'They’ll set their own name, email, password and avatar.'
                                    : step === 1 ? 'You control role and authorization — never their credentials.'
                                    : 'Single-use link · expires in 7 days.'}
                            </DialogDescription>
                        </div>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-2">
                        {STEPS.map((s, i) => {
                            const Icon = s.icon;
                            const done = i < step;
                            const current = i === step;
                            return (
                                <div key={s.label} className="flex items-center gap-2 flex-1 last:flex-none">
                                    <div className={cn('inline-flex items-center gap-2 px-2.5 h-7 rounded-full border text-[10px] font-semibold uppercase tracking-[0.12em] transition',
                                        current ? 'bg-ant-ink text-white border-ant-ink'
                                            : done ? 'bg-ant-green/10 text-ant-green border-ant-green/30'
                                            : 'bg-ant-light text-ant-mid border-ant-line')}>
                                        {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                                        {s.label}
                                    </div>
                                    {i < STEPS.length - 1 && (
                                        <div className={cn('h-px flex-1 transition', done ? 'bg-ant-green/40' : 'bg-ant-line')} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </DialogHeader>

                <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6">
                    {/* STEP 0 — ROLE CARDS */}
                    {step === 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {ROLES.map((r) => {
                                const Icon = r.icon;
                                const active = role === r.key;
                                return (
                                    <button
                                        key={r.key}
                                        onClick={() => setRole(r.key)}
                                        className={cn(
                                            'group relative text-left p-4 rounded-2xl border bg-ant-paper transition-all cursor-pointer flex items-start gap-3.5 overflow-hidden',
                                            active ? cn('border-transparent ring-2 shadow-[0_16px_40px_-20px_rgba(20,20,19,0.3)]', r.ring)
                                                : 'border-ant-line hover:border-ant-ink/30 hover:shadow-sm',
                                        )}
                                    >
                                        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border', r.tile)}>
                                            <Icon className="w-5 h-5" strokeWidth={1.75} />
                                        </div>
                                        <div className="min-w-0 pr-5">
                                            <p className="font-display text-[14.5px] font-semibold text-ant-ink leading-tight">{r.label}</p>
                                            <p className="text-[11.5px] text-ant-mid leading-snug mt-0.5">{r.desc}</p>
                                        </div>
                                        <span className={cn(
                                            'absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center transition',
                                            active ? cn('text-white', r.dot) : 'border border-ant-line text-transparent group-hover:border-ant-ink/30',
                                        )}>
                                            <Check className="w-3 h-3" />
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* STEP 1 — AUTHORIZATION */}
                    {step === 1 && (
                        <div className="space-y-5">
                            {/* selected-role banner */}
                            {roleMeta && (
                                <div className="flex items-center gap-3 p-3 rounded-2xl border border-ant-line bg-ant-light">
                                    <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', roleMeta.tile)}>
                                        <roleMeta.icon className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="text-[13px] font-semibold text-ant-ink leading-none">{roleMeta.label}</p>
                                        <p className="text-[11px] text-ant-mid mt-1">{roleMeta.desc}</p>
                                    </div>
                                </div>
                            )}

                            {/* Invitee email — required before the link is generated; verified server-side. */}
                            <div className="rounded-2xl border border-ant-line p-4 space-y-2">
                                <SectionHeader icon={Mail} title="Invitee email" hint="Optional — add it to email the invite (and reminders). You can also leave it and add it later." />
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                    <Input
                                        type="email" placeholder="name@email.com" value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        className={cn(inputCls, 'pl-9 pr-9')} autoComplete="off" autoCapitalize="off"
                                    />
                                    {emailCheck.status === 'checking' && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-ant-mid" />}
                                    {emailCheck.status === 'ok' && <MailCheck className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-green" />}
                                    {emailCheck.status === 'bad' && <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-rose" />}
                                </div>
                                {emailCheck.status === 'bad' && (
                                    <p className="text-[11px] font-medium text-ant-rose/90 flex flex-wrap items-center gap-1">
                                        {invitationReason(emailCheck.reason)}
                                        {emailCheck.reason === 'typo' && emailCheck.suggestion && (
                                            <button type="button" onClick={() => setInviteEmail(emailCheck.suggestion!)} className="font-semibold text-ant-orange hover:underline">
                                                Use {emailCheck.suggestion}
                                            </button>
                                        )}
                                    </p>
                                )}
                                {emailCheck.status === 'unknown' && (
                                    <p className="text-[11px] font-medium text-ant-mid">Couldn’t verify right now — you can still proceed.</p>
                                )}
                            </div>

                            {role === 'super admin' && (
                                <div className="rounded-2xl border border-ant-rose/25 bg-ant-rose/5 p-6 text-center">
                                    <Crown className="w-6 h-6 text-ant-rose mx-auto mb-2" />
                                    <p className="text-[13px] font-semibold text-ant-ink">Unrestricted access</p>
                                    <p className="text-[12px] text-ant-mid mt-1">Super admins reach every page. Nothing to configure here.</p>
                                </div>
                            )}

                            {role === 'admin' && (
                                <div className="rounded-2xl border border-ant-line p-4">
                                    <SectionHeader icon={Shield} title="Page access" hint="Tick the pages this admin can open." />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                        {USER_PAGES.map((p) => {
                                            const on = !!pages[p.path];
                                            return (
                                                <button key={p.path} onClick={() => setPages((s) => ({ ...s, [p.path]: !on }))}
                                                    className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer',
                                                        on ? 'border-ant-ink bg-ant-ink/5' : 'border-ant-line hover:border-ant-ink/20')}>
                                                    <span className={cn('w-4 h-4 rounded-md flex items-center justify-center shrink-0 border',
                                                        on ? 'bg-ant-ink border-ant-ink text-white' : 'border-ant-line')}>
                                                        {on && <Check className="w-3 h-3" />}
                                                    </span>
                                                    <span className="text-[12px] text-ant-ink truncate">{p.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {(role === 'commercial' || role === 'mediabuyer') && (
                                <div className="rounded-2xl border border-ant-line p-4 space-y-5">
                                    <SectionHeader icon={Wallet} title="Payment" hint="How this teammate gets paid." />
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setPaymentType('commission')} className={pillBtn(paymentType === 'commission')}>Commission</button>
                                        <button onClick={() => setPaymentType('salary')} className={pillBtn(paymentType === 'salary')}>Salary</button>
                                    </div>
                                    {paymentType === 'salary' ? (
                                        <div className="space-y-1.5">
                                            <label className={labelCls}>Monthly salary (DH)</label>
                                            <Input type="number" className={inputCls} value={salaryAmount} onChange={(e) => setSalaryAmount(Number(e.target.value))} />
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <label className={labelCls}>Commission (DH)</label>
                                                <Input type="number" className={inputCls} value={commissionPrice} onChange={(e) => setCommissionPrice(Number(e.target.value))} />
                                            </div>
                                            {role === 'commercial' && (
                                                <div className="space-y-1.5">
                                                    <label className={labelCls}>Basis</label>
                                                    <div className="flex items-center gap-2">
                                                        <button onClick={() => setCommissionBasis('per_order')} className={pillBtn(commissionBasis === 'per_order')}>Per order</button>
                                                        <button onClick={() => setCommissionBasis('per_unit')} className={pillBtn(commissionBasis === 'per_unit')}>Per unit</button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {role === 'commercial' && (
                                <>
                                    <div className="rounded-2xl border border-ant-line p-4 space-y-3">
                                        <SectionHeader icon={FaWhatsapp as unknown as LucideIcon} title="WhatsApp inbox" hint="Which inboxes this commercial can use." />
                                        <div className="flex items-center gap-2">
                                            {(['none', 'all', 'specific'] as const).map((m) => (
                                                <button key={m} onClick={() => setWaMode(m)} className={pillBtn(waMode === m)}>
                                                    {m === 'none' ? 'None' : m === 'all' ? 'All instances' : 'Specific'}
                                                </button>
                                            ))}
                                        </div>
                                        {waMode === 'specific' && (
                                            <div className="grid grid-cols-1 gap-1.5 pt-1">
                                                {(waInstances ?? []).map((i: any) => {
                                                    const on = waInstanceIds.includes(i.id);
                                                    return (
                                                        <button key={i.id} onClick={() => toggle(waInstanceIds, setWaInstanceIds, i.id)}
                                                            className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer',
                                                                on ? 'border-ant-green bg-ant-green/5' : 'border-ant-line hover:border-ant-ink/20')}>
                                                            <span className={cn('w-4 h-4 rounded-md flex items-center justify-center shrink-0 border',
                                                                on ? 'bg-ant-green border-ant-green text-white' : 'border-ant-line')}>
                                                                {on && <Check className="w-3 h-3" />}
                                                            </span>
                                                            <span className="text-[12px] text-ant-ink">{i.instance_name || i.phone_number || i.id}</span>
                                                        </button>
                                                    );
                                                })}
                                                {(!waInstances || waInstances.length === 0) && (
                                                    <p className="text-[11px] text-ant-mid">No connected WhatsApp instances.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-2xl border border-ant-line p-4 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <SectionHeader icon={Package} title={`Assigned products · ${productIds.length}`} hint="Products this commercial can sell." />
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setProductIds((products ?? []).map((p: any) => p.id))}
                                                    className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-ink hover:border-ant-ink/30 transition cursor-pointer"
                                                >
                                                    Select all
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setProductIds([])}
                                                    disabled={productIds.length === 0}
                                                    className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:border-ant-ink/30 transition cursor-pointer disabled:opacity-40"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                            <Input className={cn(inputCls, 'pl-9')} placeholder="Search products…" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                                        </div>
                                        <div className="max-h-44 overflow-y-auto ant-scroll grid grid-cols-1 gap-1.5">
                                            {filteredProducts.map((p: any) => {
                                                const on = productIds.includes(p.id);
                                                return (
                                                    <button key={p.id} onClick={() => toggle(productIds, setProductIds, p.id)}
                                                        className={cn('flex items-center gap-2.5 p-2 rounded-xl border text-left transition cursor-pointer',
                                                            on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20')}>
                                                        <span className={cn('w-4 h-4 rounded-md flex items-center justify-center shrink-0 border', on ? 'bg-ant-orange border-ant-orange text-white' : 'border-ant-line')}>
                                                            {on && <Check className="w-3 h-3" />}
                                                        </span>
                                                        <span className="text-[12px] text-ant-ink truncate">{p.name} <span className="text-ant-mid">· {p.code}</span></span>
                                                    </button>
                                                );
                                            })}
                                            {filteredProducts.length === 0 && <p className="text-[11px] text-ant-mid px-1">No products found.</p>}
                                        </div>
                                    </div>
                                </>
                            )}

                            {role === 'mediabuyer' && (
                                <>
                                    {/* Google Analytics access */}
                                    <div className="rounded-2xl border border-ant-line p-4 space-y-3">
                                        <SectionHeader icon={BarChart3} title="Google Analytics" hint="Which GA properties this media buyer can view." />
                                        <div className="flex items-center gap-2">
                                            {(['none', 'all', 'specific'] as const).map((m) => (
                                                <button key={m} onClick={() => setGaMode(m)} className={pillBtn(gaMode === m)}>
                                                    {m === 'none' ? 'No access' : m === 'all' ? 'All properties' : 'Specific'}
                                                </button>
                                            ))}
                                        </div>
                                        {gaMode === 'specific' && (
                                            <div className="grid grid-cols-1 gap-1.5 pt-1">
                                                {(gaConns ?? []).map((c: any) => {
                                                    const on = gaIds.includes(c.id);
                                                    return (
                                                        <button key={c.id} onClick={() => toggle(gaIds, setGaIds, c.id)}
                                                            className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer',
                                                                on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20')}>
                                                            <span className={cn('w-4 h-4 rounded-md flex items-center justify-center shrink-0 border',
                                                                on ? 'bg-ant-orange border-ant-orange text-white' : 'border-ant-line')}>
                                                                {on && <Check className="w-3 h-3" />}
                                                            </span>
                                                            <span className="text-[12px] text-ant-ink truncate">{c.display_name} <span className="text-ant-mid">· {c.property_id}</span></span>
                                                        </button>
                                                    );
                                                })}
                                                {(!gaConns || gaConns.length === 0) && (
                                                    <p className="text-[11px] text-ant-mid">No GA properties connected to this business.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Meta Ads access */}
                                    <div className="rounded-2xl border border-ant-line p-4 space-y-3">
                                        <SectionHeader icon={Megaphone} title="Meta Ads" hint="Which ad accounts this media buyer can use." />
                                        <div className="flex items-center gap-2">
                                            {(['none', 'all', 'specific'] as const).map((m) => (
                                                <button key={m} onClick={() => setMetaMode(m)} className={pillBtn(metaMode === m)}>
                                                    {m === 'none' ? 'No access' : m === 'all' ? 'All accounts' : 'Specific'}
                                                </button>
                                            ))}
                                        </div>
                                        {metaMode === 'specific' && (
                                            <div className="grid grid-cols-1 gap-1.5 pt-1">
                                                {(metaConns ?? []).map((c: any) => {
                                                    const on = metaIds.includes(c.id);
                                                    return (
                                                        <button key={c.id} onClick={() => toggle(metaIds, setMetaIds, c.id)}
                                                            className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer',
                                                                on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20')}>
                                                            <span className={cn('w-4 h-4 rounded-md flex items-center justify-center shrink-0 border',
                                                                on ? 'bg-ant-orange border-ant-orange text-white' : 'border-ant-line')}>
                                                                {on && <Check className="w-3 h-3" />}
                                                            </span>
                                                            <span className="text-[12px] text-ant-ink truncate">{c.display_name || c.ad_account_id} <span className="text-ant-mid">· {c.ad_account_id}</span></span>
                                                        </button>
                                                    );
                                                })}
                                                {(!metaConns || metaConns.length === 0) && (
                                                    <p className="text-[11px] text-ant-mid">No Meta ad accounts connected to this business.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {role === 'courier' && (
                                <div className="rounded-2xl border border-ant-line p-4 space-y-4">
                                    <SectionHeader icon={Bike} title="Delivery handling" hint="Phone and parcel permissions." />
                                    <div className="space-y-1.5">
                                        <label className={labelCls}>Phone number</label>
                                        <Input className={inputCls} placeholder="+212 6 00 00 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} />
                                    </div>
                                    {([['Fragile parcels', parcelFragile, setParcelFragile],
                                       ['Open on delivery', parcelOpen, setParcelOpen],
                                       ['Try-on allowed', parcelTryOn, setParcelTryOn]] as const).map(([label, val, set]) => (
                                        <div key={label} className="flex items-center justify-between h-11 px-4 rounded-xl border border-ant-line bg-ant-paper">
                                            <span className="text-[12px] font-semibold text-ant-ink">{label}</span>
                                            <Switch checked={val as boolean} onCheckedChange={set as (v: boolean) => void} className="data-[state=checked]:bg-ant-green" />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 2 — LINK + COPY + SEND */}
                    {step === 2 && link && (
                        <div className="space-y-5">
                            <div className="rounded-2xl border border-ant-green/30 bg-gradient-to-b from-ant-green/8 to-transparent p-5 text-center">
                                <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-green/15 border border-ant-green/30 flex items-center justify-center mb-3">
                                    <Check className="w-6 h-6 text-ant-green" />
                                </div>
                                <p className="font-display text-[16px] font-semibold text-ant-ink">Invite link ready</p>
                                <p className="text-[12px] text-ant-mid mt-1">
                                    {createdEmail
                                        ? <>For <span className="font-semibold text-ant-ink break-all">{createdEmail}</span> · single-use · expires in 7 days.</>
                                        : <>Single-use · expires in 7 days. No email on file — copy the link, or add an email later from the invitations list to send it.</>}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className={labelCls}>Invitation link</label>
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1 min-w-0">
                                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                        <Input readOnly value={link} className={cn(inputCls, 'pl-9 font-mono text-[11px]')} onFocus={(e) => e.currentTarget.select()} />
                                    </div>
                                    <Button onClick={copy} className={cn('h-10 rounded-xl gap-1.5 px-4 text-[12px] font-semibold text-white transition shrink-0', copied ? 'bg-ant-green hover:bg-ant-green/90' : 'bg-ant-ink hover:bg-ant-ink/90')}>
                                        {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                                    </Button>
                                    {createdEmail && (
                                        <Button
                                            onClick={sendInvite}
                                            disabled={sending || !!sentTo}
                                            title={`Email the invitation to ${createdEmail}`}
                                            className={cn('h-10 rounded-xl gap-1.5 px-4 text-[12px] font-semibold text-white transition shrink-0 disabled:opacity-60',
                                                sentTo ? 'bg-ant-green hover:bg-ant-green/90' : 'bg-ant-orange hover:bg-ant-orange/90')}
                                        >
                                            {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                                                : sentTo ? <><MailCheck className="w-3.5 h-3.5" /> Sent</>
                                                : <><Send className="w-3.5 h-3.5" /> Send</>}
                                        </Button>
                                    )}
                                </div>
                                {sentTo && !sendError && (
                                    <p className="text-[11px] font-medium text-ant-green flex items-center gap-1">
                                        <Check className="w-3 h-3" /> Invitation emailed to {sentTo}.
                                    </p>
                                )}
                                {sendError && (
                                    <p className="text-[11px] font-semibold text-ant-rose bg-ant-rose/10 border border-ant-rose/30 rounded-lg px-3 py-2">{sendError}</p>
                                )}
                                <p className="text-[11px] text-ant-mid">
                                    {createdEmail
                                        ? 'The branded invitation is emailed to the address you entered. You can also copy the link to share it yourself.'
                                        : 'Copy the link to share it yourself, or add an email later from the invitations list to send it (and enable reminders).'}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                <div className="px-6 py-4 border-t border-ant-line flex items-center justify-between gap-2 bg-ant-paper">
                    {step === 1 ? (
                        <Button variant="ghost" onClick={() => setStep(0)} className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink gap-1.5">
                            <ArrowLeft className="w-4 h-4" /> Role
                        </Button>
                    ) : step === 2 ? (
                        <Button variant="ghost" onClick={reset} className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink gap-1.5">
                            <UserPlus className="w-4 h-4" /> New invite
                        </Button>
                    ) : <span />}

                    {step === 0 && (
                        <Button onClick={() => role && setStep(1)} disabled={!role} className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 disabled:opacity-50">
                            Continue <ArrowRight className="w-4 h-4" />
                        </Button>
                    )}
                    {step === 1 && (
                        <Button onClick={generate} disabled={generating} className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 disabled:opacity-50">
                            {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><LinkIcon className="w-4 h-4" /> Generate link</>}
                        </Button>
                    )}
                    {step === 2 && (
                        <Button onClick={onClose} className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold">
                            Done
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default InviteUserWizard;
