import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { edgeFnErrorMessage } from '@/lib/edgeError';
import {
    fieldLabelCls, PasswordField, ServerErrorPanel,
} from '@/components/users/DirectCreateUserDialog';
import { KeyRound, Loader2 } from 'lucide-react';

interface SetPasswordDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** The row this dialog acts on (null while closed). */
    user: { id: string; name?: string | null; email?: string | null } | null;
}

export const SetPasswordDialog = ({ isOpen, onClose, user }: SetPasswordDialogProps) => {
    const { toast } = useToast();

    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setPassword(''); setConfirmation(''); setErrors({}); setServerError(null);
    }, [isOpen, user]);

    const setPasswordMutation = useMutation({
        mutationFn: async () => {
            if (!user) return null;
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'set_password', user_id: user.id, new_password: password },
            });
            if (error) throw new Error(await edgeFnErrorMessage(error, data));
            return data;
        },
        onSuccess: () => {
            toast({
                title: 'Mot de passe mis à jour',
                description: `${user?.name || 'Cet utilisateur'} doit utiliser le nouveau mot de passe à la prochaine connexion.`,
            });
            onClose();
        },
        onError: (e: any) => setServerError(e?.message || 'Mise à jour du mot de passe impossible.'),
    });

    const busy = setPasswordMutation.isPending;

    const submit = (e: FormEvent) => {
        e.preventDefault();
        setServerError(null);
        const next: Record<string, string> = {};
        if (!password) next.password = 'Le mot de passe est requis.';
        else if (password.length < 8) next.password = 'Au moins 8 caractères.';
        if (confirmation !== password) next.confirmation = 'Les deux mots de passe ne correspondent pas.';
        setErrors(next);
        if (Object.keys(next).length > 0) return;
        setPasswordMutation.mutate();
    };

    const errCls = 'text-[11px] font-medium text-ant-rose';

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
            <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col">
                {/* Gradient hairline */}
                <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-orange/60 to-transparent" />
                <form onSubmit={submit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-ant-ink text-white flex items-center justify-center shrink-0 shadow-sm">
                                <KeyRound className="w-5 h-5" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0">
                                <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Identifiants
                                </div>
                                <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                    Définir le mot de passe
                                </DialogTitle>
                                <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                    <span className="not-italic font-semibold text-ant-ink">« {user?.name} »</span> — le nouveau mot de passe remplace l&rsquo;ancien immédiatement.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
                        <div className="space-y-1.5">
                            <label className={fieldLabelCls}>Nouveau mot de passe</label>
                            <PasswordField
                                value={password}
                                onChange={(v) => { setPassword(v); setErrors((s) => ({ ...s, password: '' })); }}
                                disabled={busy}
                            />
                            {errors.password && <p className={errCls}>{errors.password}</p>}
                        </div>

                        <div className="space-y-1.5">
                            <label className={fieldLabelCls}>Confirmation</label>
                            <PasswordField
                                value={confirmation}
                                onChange={(v) => { setConfirmation(v); setErrors((s) => ({ ...s, confirmation: '' })); }}
                                withGenerate={false}
                                disabled={busy}
                            />
                            {errors.confirmation && <p className={errCls}>{errors.confirmation}</p>}
                        </div>

                        <p className="text-[11px] text-ant-mid leading-snug">
                            Aucun email de confirmation ne sera envoyé — transmettez le mot de passe vous-même.
                        </p>

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
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                            {busy ? 'Mise à jour…' : 'Définir le mot de passe'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default SetPasswordDialog;
