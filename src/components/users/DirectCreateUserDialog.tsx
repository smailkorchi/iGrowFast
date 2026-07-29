import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { edgeFnErrorMessage } from '@/lib/edgeError';
import { USER_PAGES } from '@/lib/invitations';
import {
    AlertCircle, BarChart3, Bike, Check, Copy, Crown, Eye, EyeOff, Loader2, Megaphone,
    Package, RefreshCw, Search, Shield, UserPlus, Wallet, type LucideIcon,
} from 'lucide-react';

export interface RoleOption {
    value: string;
    label: string;
}

export const fieldInputCls =
    'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';
export const fieldLabelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';

/** Strong random password — crypto RNG, no dependency. */
export const generateStrongPassword = (length = 16): string => {
    // Ambiguous glyphs (0/O, 1/l/I) removed so a typed hand-off can't be misread.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
    const buf = new Uint32Array(length);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => alphabet[n % alphabet.length]).join('');
};

/** Password input + show/hide, « Générer » and copy affordances. Shared with SetPasswordDialog. */
export const PasswordField = ({
    value,
    onChange,
    placeholder = '••••••••',
    withGenerate = true,
    disabled,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    withGenerate?: boolean;
    disabled?: boolean;
}) => {
    const [show, setShow] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const t = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(t);
    }, [copied]);

    const copy = async () => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
        } catch {
            // Clipboard denied — the value is visible via the show toggle.
        }
    };

    return (
        <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
                <Input
                    type={show ? 'text' : 'password'}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    autoComplete="new-password"
                    className={cn(fieldInputCls, 'pr-9 font-mono')}
                />
                <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink transition-colors duration-200 motion-reduce:transition-none cursor-pointer"
                >
                    {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
            </div>
            {withGenerate && (
                <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => { onChange(generateStrongPassword()); setShow(true); }}
                    className="h-10 px-3.5 rounded-xl border border-ant-line text-[11px] font-semibold text-ant-ink hover:bg-ant-light gap-1.5 shrink-0 cursor-pointer transition-colors duration-200 motion-reduce:transition-none"
                >
                    <RefreshCw className="w-3.5 h-3.5 text-ant-orange" />
                    Générer
                </Button>
            )}
            <Button
                type="button"
                variant="ghost"
                onClick={copy}
                disabled={disabled || !value}
                aria-label="Copier le mot de passe"
                className={cn(
                    'h-10 w-10 p-0 rounded-xl border border-ant-line shrink-0 cursor-pointer transition-colors duration-200 motion-reduce:transition-none disabled:opacity-40',
                    copied ? 'text-ant-green' : 'text-ant-mid hover:text-ant-ink hover:bg-ant-light',
                )}
            >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
        </div>
    );
};

/** Inline server-error panel — the server's French message, verbatim. */
export const ServerErrorPanel = ({ message }: { message: string }) => (
    <div className="flex items-start gap-2.5 rounded-xl border border-ant-rose/30 bg-ant-rose/10 px-3.5 py-3">
        <AlertCircle className="w-3.5 h-3.5 text-ant-rose shrink-0 mt-0.5" />
        <p className="text-[11.5px] font-medium text-ant-rose leading-snug">{message}</p>
    </div>
);

interface DirectCreateUserDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** All assignable roles, labels from the page's ROLE_META. */
    roleOptions: RoleOption[];
    /** Needed to list this business's products / GA properties / Meta ad accounts. */
    activeBusinessId: string | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Section header used by the per-role access blocks — mirrors the invite wizard's. */
const ConfigSection = ({
    icon: Icon, title, hint, children,
}: { icon: LucideIcon; title: string; hint?: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border border-ant-line p-4 space-y-3">
        <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink shrink-0">
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ant-ink leading-none">{title}</p>
                {hint && <p className="text-[11px] text-ant-mid mt-1">{hint}</p>}
            </div>
        </div>
        {children}
    </div>
);

export const DirectCreateUserDialog = ({ isOpen, onClose, roleOptions, activeBusinessId }: DirectCreateUserDialogProps) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<string>('commercial');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);

    // Per-role access & terms — the same fields the invite wizard sets (buildPayload).
    const [pages, setPages] = useState<Record<string, boolean>>({});
    const [commissionPrice, setCommissionPrice] = useState(0);
    const [commissionBasis, setCommissionBasis] = useState<'per_order' | 'per_unit'>('per_order');
    const [paymentType, setPaymentType] = useState<'commission' | 'salary'>('commission');
    const [salaryAmount, setSalaryAmount] = useState(0);
    const [productIds, setProductIds] = useState<string[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [gaMode, setGaMode] = useState<'none' | 'all' | 'specific'>('none');
    const [gaIds, setGaIds] = useState<string[]>([]);
    const [metaMode, setMetaMode] = useState<'none' | 'all' | 'specific'>('none');
    const [metaIds, setMetaIds] = useState<string[]>([]);
    const [phone, setPhone] = useState('');
    const [parcelFragile, setParcelFragile] = useState(false);
    const [parcelOpen, setParcelOpen] = useState(false);
    const [parcelTryOn, setParcelTryOn] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setName(''); setUsername(''); setEmail(''); setPassword('');
        setRole(roleOptions.some((r) => r.value === 'commercial') ? 'commercial' : (roleOptions[0]?.value ?? 'commercial'));
        setErrors({}); setServerError(null);
    }, [isOpen, roleOptions]);

    // Config never carries across roles — a role switch starts from that role's defaults.
    useEffect(() => {
        setPages({}); setCommissionPrice(0); setCommissionBasis('per_order');
        setPaymentType('commission'); setSalaryAmount(0); setProductIds([]); setProductSearch('');
        setGaMode('none'); setGaIds([]); setMetaMode('none'); setMetaIds([]);
        setPhone(''); setParcelFragile(false); setParcelOpen(false); setParcelTryOn(false);
        setErrors((s) => ({ ...s, commission_price: '', salary_amount: '' }));
    }, [role]);

    const { data: products } = useQuery({
        queryKey: ['direct-create-products', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('products').select('id, name, code')
                .eq('active', true).eq('DigiCom Business', activeBusinessId).order('name');
            return data ?? [];
        },
        enabled: isOpen && role === 'commercial' && !!activeBusinessId,
    });

    const { data: gaConns } = useQuery({
        queryKey: ['direct-create-ga-conns', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('google_analytics_connections')
                .select('id, display_name, property_id').eq('DigiCom Business', activeBusinessId).order('display_name');
            return data ?? [];
        },
        enabled: isOpen && role === 'mediabuyer' && !!activeBusinessId,
    });

    const { data: metaConns } = useQuery({
        queryKey: ['direct-create-meta-conns', activeBusinessId],
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

    /** Role config keys, at the top level of userData — same shape the invite wizard emits. */
    const buildConfig = (): Record<string, unknown> => {
        const base: Record<string, unknown> = { active: true };
        if (role === 'admin') return { ...base, permissions: { pages } };
        if (role === 'super admin' || role === 'business owner') return base;
        if (role === 'commercial') return {
            ...base, commission_price: commissionPrice, commission_basis: commissionBasis,
            payment_type: paymentType, salary_amount: salaryAmount, products: productIds,
        };
        if (role === 'courier') return {
            ...base, courier_parcel_fragile: parcelFragile, courier_parcel_open: parcelOpen,
            courier_parcel_try_on: parcelTryOn, phone: phone || null,
        };
        if (role === 'mediabuyer') return {
            ...base, payment_type: paymentType, salary_amount: salaryAmount, commission_price: commissionPrice,
            // business_id is required by manage-users' applyGa/MetaAccess helpers — without it
            // the grant rows are silently skipped.
            ga_access: { mode: gaMode, ids: gaMode === 'specific' ? gaIds : [], business_id: activeBusinessId },
            meta_access: { mode: metaMode, ids: metaMode === 'specific' ? metaIds : [], business_id: activeBusinessId },
        };
        return base;
    };

    const createMutation = useMutation({
        mutationFn: async () => {
            // Business scoping is server-side: manage-users stamps the caller's own business.
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'create',
                    userData: {
                        email: email.trim().toLowerCase(),
                        password,
                        name: name.trim(),
                        username: username.trim(),
                        role,
                        ...buildConfig(),
                    },
                },
            });
            if (error) throw new Error(await edgeFnErrorMessage(error, data));
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast({
                title: 'Utilisateur créé — identifiants actifs immédiatement',
                description: `${email.trim().toLowerCase()} peut se connecter dès maintenant.`,
            });
            onClose();
        },
        onError: (e: any) => setServerError(e?.message || 'Création impossible.'),
    });

    const validate = () => {
        const next: Record<string, string> = {};
        if (!name.trim()) next.name = 'Le nom est requis.';
        if (!username.trim()) next.username = "Le nom d'utilisateur est requis.";
        if (!email.trim()) next.email = "L'email est requis.";
        else if (!EMAIL_RE.test(email.trim())) next.email = "Format d'email invalide.";
        if (!password) next.password = 'Le mot de passe est requis.';
        else if (password.length < 8) next.password = 'Au moins 8 caractères.';
        if (!role) next.role = 'Le rôle est requis.';
        if (role === 'commercial' || role === 'mediabuyer') {
            if (!Number.isFinite(commissionPrice) || commissionPrice < 0) next.commission_price = 'Montant invalide.';
            if (!Number.isFinite(salaryAmount) || salaryAmount < 0) next.salary_amount = 'Montant invalide.';
        }
        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const submit = (e: FormEvent) => {
        e.preventDefault();
        setServerError(null);
        if (!validate()) return;
        createMutation.mutate();
    };

    const busy = createMutation.isPending;
    const errCls = 'text-[11px] font-medium text-ant-rose';
    const pillBtn = (active: boolean) => cn(
        'h-9 px-3.5 rounded-full text-[11px] font-semibold border transition-colors duration-200 motion-reduce:transition-none cursor-pointer disabled:opacity-60',
        active ? 'bg-ant-ink text-white border-ant-ink shadow-sm' : 'border-ant-line text-ant-mid hover:text-ant-ink hover:border-ant-ink/30',
    );
    const toggleId = (arr: string[], setArr: (v: string[]) => void, id: string) =>
        setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
    const checkBox = (on: boolean, accent: 'ink' | 'orange') => cn(
        'w-4 h-4 rounded-md flex items-center justify-center shrink-0 border',
        on ? (accent === 'ink' ? 'bg-ant-ink border-ant-ink text-white' : 'bg-ant-orange border-ant-orange text-white') : 'border-ant-line',
    );

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
            <DialogContent className="max-w-xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[92vh] flex flex-col">
                <form onSubmit={submit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Création directe
                        </div>
                        <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                            Créer un utilisateur
                        </DialogTitle>
                        <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                            Vous choisissez l&rsquo;identité et le mot de passe. Le compte est actif immédiatement, sans confirmation par email.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className={fieldLabelCls}>Nom</label>
                                <Input
                                    value={name}
                                    onChange={(e) => { setName(e.target.value); setErrors((s) => ({ ...s, name: '' })); }}
                                    placeholder="Ex. Yassine Alami"
                                    className={fieldInputCls}
                                    disabled={busy}
                                    autoFocus
                                />
                                {errors.name && <p className={errCls}>{errors.name}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <label className={fieldLabelCls}>Nom d&rsquo;utilisateur</label>
                                <Input
                                    value={username}
                                    onChange={(e) => { setUsername(e.target.value); setErrors((s) => ({ ...s, username: '' })); }}
                                    placeholder="Ex. yassine"
                                    className={fieldInputCls}
                                    disabled={busy}
                                    autoCapitalize="off"
                                />
                                {errors.username && <p className={errCls}>{errors.username}</p>}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className={fieldLabelCls}>Email</label>
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => { setEmail(e.target.value); setErrors((s) => ({ ...s, email: '' })); }}
                                placeholder="nom@email.com"
                                className={fieldInputCls}
                                disabled={busy}
                                autoComplete="off"
                                autoCapitalize="off"
                            />
                            {errors.email && <p className={errCls}>{errors.email}</p>}
                        </div>

                        <div className="space-y-1.5">
                            <label className={fieldLabelCls}>Mot de passe</label>
                            <PasswordField
                                value={password}
                                onChange={(v) => { setPassword(v); setErrors((s) => ({ ...s, password: '' })); }}
                                disabled={busy}
                            />
                            {errors.password && <p className={errCls}>{errors.password}</p>}
                            <p className="text-[11px] text-ant-mid leading-snug">
                                Aucun email de confirmation ne sera envoyé — transmettez les identifiants vous-même.
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <label className={fieldLabelCls}>Rôle</label>
                            <Select value={role} onValueChange={(v) => setRole(v)} disabled={busy}>
                                <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink focus:ring-1 focus:ring-ant-orange/40">
                                    <SelectValue placeholder="Choisir un rôle" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                    {roleOptions.map((r) => (
                                        <SelectItem key={r.value} value={r.value} className="text-[12px]">
                                            {r.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {errors.role && <p className={errCls}>{errors.role}</p>}
                        </div>

                        {/* ── Accès & conditions du rôle ── */}
                        {(role === 'super admin' || role === 'business owner') && (
                            <div className="rounded-2xl border border-ant-line bg-ant-light px-4 py-5 text-center">
                                <Crown className="w-5 h-5 text-ant-mid mx-auto mb-2" />
                                <p className="text-[12px] text-ant-mid">Accès illimité à l&rsquo;entreprise.</p>
                            </div>
                        )}

                        {role === 'admin' && (
                            <ConfigSection icon={Shield} title="Accès aux pages" hint="Cochez les pages que cet admin peut ouvrir.">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {USER_PAGES.map((p) => {
                                        const on = !!pages[p.path];
                                        return (
                                            <button
                                                key={p.path}
                                                type="button"
                                                disabled={busy}
                                                onClick={() => setPages((s) => ({ ...s, [p.path]: !on }))}
                                                className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors duration-200 motion-reduce:transition-none cursor-pointer disabled:opacity-60',
                                                    on ? 'border-ant-ink bg-ant-ink/5' : 'border-ant-line hover:border-ant-ink/20')}
                                            >
                                                <span className={checkBox(on, 'ink')}>{on && <Check className="w-3 h-3" />}</span>
                                                <span className="text-[12px] text-ant-ink truncate">{p.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </ConfigSection>
                        )}

                        {(role === 'commercial' || role === 'mediabuyer') && (
                            <ConfigSection icon={Wallet} title="Rémunération" hint="Comment cette personne est payée.">
                                <div className="flex items-center gap-2">
                                    <button type="button" disabled={busy} onClick={() => setPaymentType('commission')} className={pillBtn(paymentType === 'commission')}>Commission</button>
                                    <button type="button" disabled={busy} onClick={() => setPaymentType('salary')} className={pillBtn(paymentType === 'salary')}>Salaire</button>
                                </div>
                                {paymentType === 'salary' ? (
                                    <div className="space-y-1.5">
                                        <label className={fieldLabelCls}>Salaire mensuel (DH)</label>
                                        <Input
                                            type="number" min={0} disabled={busy} className={cn(fieldInputCls, 'tabular-nums')}
                                            value={salaryAmount}
                                            onChange={(e) => { setSalaryAmount(Number(e.target.value) || 0); setErrors((s) => ({ ...s, salary_amount: '' })); }}
                                        />
                                        {errors.salary_amount && <p className={errCls}>{errors.salary_amount}</p>}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className={fieldLabelCls}>Commission (DH)</label>
                                            <Input
                                                type="number" min={0} disabled={busy} className={cn(fieldInputCls, 'tabular-nums')}
                                                value={commissionPrice}
                                                onChange={(e) => { setCommissionPrice(Number(e.target.value) || 0); setErrors((s) => ({ ...s, commission_price: '' })); }}
                                            />
                                            {errors.commission_price && <p className={errCls}>{errors.commission_price}</p>}
                                        </div>
                                        {role === 'commercial' && (
                                            <div className="space-y-1.5">
                                                <label className={fieldLabelCls}>Base de calcul</label>
                                                <div className="flex items-center gap-2">
                                                    <button type="button" disabled={busy} onClick={() => setCommissionBasis('per_order')} className={pillBtn(commissionBasis === 'per_order')}>Par commande</button>
                                                    <button type="button" disabled={busy} onClick={() => setCommissionBasis('per_unit')} className={pillBtn(commissionBasis === 'per_unit')}>Par unité</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </ConfigSection>
                        )}

                        {role === 'commercial' && (
                            <ConfigSection icon={Package} title={`Produits assignés · ${productIds.length}`} hint="Les produits que ce commercial peut vendre.">
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button" disabled={busy}
                                        onClick={() => setProductIds((products ?? []).map((p: any) => p.id))}
                                        className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-ink hover:border-ant-ink/30 transition-colors duration-200 motion-reduce:transition-none cursor-pointer disabled:opacity-60"
                                    >
                                        Tout sélectionner
                                    </button>
                                    <button
                                        type="button" disabled={busy || productIds.length === 0}
                                        onClick={() => setProductIds([])}
                                        className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:border-ant-ink/30 transition-colors duration-200 motion-reduce:transition-none cursor-pointer disabled:opacity-40"
                                    >
                                        Vider
                                    </button>
                                </div>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                    <Input
                                        className={cn(fieldInputCls, 'pl-9')} placeholder="Rechercher un produit…" disabled={busy}
                                        value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                                    />
                                </div>
                                <div className="max-h-44 overflow-y-auto ant-scroll grid grid-cols-1 gap-1.5">
                                    {filteredProducts.map((p: any) => {
                                        const on = productIds.includes(p.id);
                                        return (
                                            <button
                                                key={p.id} type="button" disabled={busy}
                                                onClick={() => toggleId(productIds, setProductIds, p.id)}
                                                className={cn('flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors duration-200 motion-reduce:transition-none cursor-pointer disabled:opacity-60',
                                                    on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20')}
                                            >
                                                <span className={checkBox(on, 'orange')}>{on && <Check className="w-3 h-3" />}</span>
                                                <span className="text-[12px] text-ant-ink truncate">{p.name} <span className="text-ant-mid">· {p.code}</span></span>
                                            </button>
                                        );
                                    })}
                                    {filteredProducts.length === 0 && <p className="text-[11px] text-ant-mid px-1">Aucun produit trouvé.</p>}
                                </div>
                            </ConfigSection>
                        )}

                        {role === 'mediabuyer' && (
                            <>
                                <ConfigSection icon={BarChart3} title="Google Analytics" hint="Les propriétés GA que ce media buyer peut consulter.">
                                    <div className="flex items-center gap-2">
                                        {(['none', 'all', 'specific'] as const).map((m) => (
                                            <button key={m} type="button" disabled={busy} onClick={() => setGaMode(m)} className={pillBtn(gaMode === m)}>
                                                {m === 'none' ? 'Aucun accès' : m === 'all' ? 'Toutes' : 'Spécifiques'}
                                            </button>
                                        ))}
                                    </div>
                                    {gaMode === 'specific' && (
                                        <div className="grid grid-cols-1 gap-1.5 pt-1">
                                            {(gaConns ?? []).map((c: any) => {
                                                const on = gaIds.includes(c.id);
                                                return (
                                                    <button
                                                        key={c.id} type="button" disabled={busy}
                                                        onClick={() => toggleId(gaIds, setGaIds, c.id)}
                                                        className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors duration-200 motion-reduce:transition-none cursor-pointer disabled:opacity-60',
                                                            on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20')}
                                                    >
                                                        <span className={checkBox(on, 'orange')}>{on && <Check className="w-3 h-3" />}</span>
                                                        <span className="text-[12px] text-ant-ink truncate">{c.display_name} <span className="text-ant-mid">· {c.property_id}</span></span>
                                                    </button>
                                                );
                                            })}
                                            {(!gaConns || gaConns.length === 0) && (
                                                <p className="text-[11px] text-ant-mid">Aucune propriété GA connectée à cette entreprise.</p>
                                            )}
                                        </div>
                                    )}
                                </ConfigSection>

                                <ConfigSection icon={Megaphone} title="Meta Ads" hint="Les comptes publicitaires que ce media buyer peut utiliser.">
                                    <div className="flex items-center gap-2">
                                        {(['none', 'all', 'specific'] as const).map((m) => (
                                            <button key={m} type="button" disabled={busy} onClick={() => setMetaMode(m)} className={pillBtn(metaMode === m)}>
                                                {m === 'none' ? 'Aucun accès' : m === 'all' ? 'Tous' : 'Spécifiques'}
                                            </button>
                                        ))}
                                    </div>
                                    {metaMode === 'specific' && (
                                        <div className="grid grid-cols-1 gap-1.5 pt-1">
                                            {(metaConns ?? []).map((c: any) => {
                                                const on = metaIds.includes(c.id);
                                                return (
                                                    <button
                                                        key={c.id} type="button" disabled={busy}
                                                        onClick={() => toggleId(metaIds, setMetaIds, c.id)}
                                                        className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors duration-200 motion-reduce:transition-none cursor-pointer disabled:opacity-60',
                                                            on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20')}
                                                    >
                                                        <span className={checkBox(on, 'orange')}>{on && <Check className="w-3 h-3" />}</span>
                                                        <span className="text-[12px] text-ant-ink truncate">{c.display_name || c.ad_account_id} <span className="text-ant-mid">· {c.ad_account_id}</span></span>
                                                    </button>
                                                );
                                            })}
                                            {(!metaConns || metaConns.length === 0) && (
                                                <p className="text-[11px] text-ant-mid">Aucun compte publicitaire Meta connecté à cette entreprise.</p>
                                            )}
                                        </div>
                                    )}
                                </ConfigSection>
                            </>
                        )}

                        {role === 'courier' && (
                            <ConfigSection icon={Bike} title="Livraison" hint="Téléphone et permissions colis.">
                                <div className="space-y-1.5">
                                    <label className={fieldLabelCls}>Téléphone</label>
                                    <Input
                                        className={fieldInputCls} placeholder="+212 6 00 00 00 00" disabled={busy}
                                        value={phone} onChange={(e) => setPhone(e.target.value)}
                                    />
                                </div>
                                {([['Colis fragiles', parcelFragile, setParcelFragile],
                                   ['Ouverture à la livraison', parcelOpen, setParcelOpen],
                                   ['Essayage autorisé', parcelTryOn, setParcelTryOn]] as const).map(([label, val, set]) => (
                                    <div key={label} className="flex items-center justify-between h-11 px-4 rounded-xl border border-ant-line bg-ant-paper">
                                        <span className="text-[12px] font-semibold text-ant-ink">{label}</span>
                                        <Switch
                                            checked={val as boolean}
                                            disabled={busy}
                                            onCheckedChange={set as (v: boolean) => void}
                                            className="data-[state=checked]:bg-ant-green"
                                        />
                                    </div>
                                ))}
                            </ConfigSection>
                        )}

                        {serverError && <ServerErrorPanel message={serverError} />}
                    </div>

                    <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onClose}
                            disabled={busy}
                            className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer transition-colors duration-200 motion-reduce:transition-none"
                        >
                            Annuler
                        </Button>
                        <Button
                            type="submit"
                            disabled={busy}
                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 cursor-pointer disabled:opacity-60 transition-colors duration-200 motion-reduce:transition-none"
                        >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                            {busy ? 'Création…' : 'Créer l’utilisateur'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default DirectCreateUserDialog;
