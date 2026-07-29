import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { edgeFnErrorMessage } from '@/lib/edgeError';
import { fieldLabelCls, ServerErrorPanel, type RoleOption } from '@/components/users/DirectCreateUserDialog';
import { Loader2, Shield } from 'lucide-react';

interface ChangeRoleDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** The row this dialog acts on (null while closed). */
    user: { id: string; name?: string | null; role?: string | null } | null;
    /** All assignable roles, labels from the page's ROLE_META. */
    roleOptions: RoleOption[];
}

export const ChangeRoleDialog = ({ isOpen, onClose, user, roleOptions }: ChangeRoleDialogProps) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const currentRole = String(user?.role || '');
    const [role, setRole] = useState<string>(currentRole);
    const [serverError, setServerError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setRole(String(user?.role || ''));
        setServerError(null);
    }, [isOpen, user]);

    const changeRoleMutation = useMutation({
        mutationFn: async () => {
            if (!user) return null;
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'update', userId: user.id, userData: { role } },
            });
            if (error) throw new Error(await edgeFnErrorMessage(error, data));
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast({ title: 'Rôle mis à jour', description: `${user?.name || 'Cet utilisateur'} est désormais ${labelFor(roleOptions, role)}.` });
            onClose();
        },
        onError: (e: any) => setServerError(e?.message || 'Changement de rôle impossible.'),
    });

    const busy = changeRoleMutation.isPending;
    const unchanged = !role || role === currentRole;

    const submit = (e: FormEvent) => {
        e.preventDefault();
        setServerError(null);
        if (unchanged) return;
        changeRoleMutation.mutate();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
            <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                <form onSubmit={submit}>
                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Autorisation
                        </div>
                        <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                            Changer le rôle
                        </DialogTitle>
                        <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                            <span className="not-italic font-semibold text-ant-ink">&ldquo;{user?.name}&rdquo;</span> — le nouveau rôle s&rsquo;applique dès la confirmation.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="px-6 py-5 space-y-4">
                        <div className="space-y-1.5">
                            <span className={fieldLabelCls}>Rôle actuel</span>
                            <div>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2.5 py-1 text-[11px] font-semibold text-ant-ink">
                                    <Shield className="w-3 h-3 text-ant-mid" />
                                    {labelFor(roleOptions, currentRole)}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className={fieldLabelCls}>Nouveau rôle</label>
                            <Select value={role} onValueChange={setRole} disabled={busy}>
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
                            disabled={busy || unchanged}
                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 cursor-pointer disabled:opacity-50 transition-colors duration-200 motion-reduce:transition-none"
                        >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                            {busy ? 'Mise à jour…' : 'Confirmer le rôle'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const labelFor = (options: RoleOption[], value: string) =>
    options.find((o) => o.value === value)?.label || value || '—';

export default ChangeRoleDialog;
