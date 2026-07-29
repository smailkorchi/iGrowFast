import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { edgeFnErrorMessage } from '@/lib/edgeError';
import { AlertCircle, Check, Copy, Eye, EyeOff, Loader2, RefreshCw, UserPlus } from 'lucide-react';

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
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const DirectCreateUserDialog = ({ isOpen, onClose, roleOptions }: DirectCreateUserDialogProps) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<string>('commercial');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setName(''); setUsername(''); setEmail(''); setPassword('');
        setRole(roleOptions.some((r) => r.value === 'commercial') ? 'commercial' : (roleOptions[0]?.value ?? 'commercial'));
        setErrors({}); setServerError(null);
    }, [isOpen, roleOptions]);

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
