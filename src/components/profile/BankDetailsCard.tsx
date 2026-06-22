import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Lock, CreditCard, Info, Save, Loader2 } from 'lucide-react';

type BankProfile = {
    bank_name?: string | null;
    bank_account_holder?: string | null;
    bank_rib?: string | null;
    cin_number?: string | null;
} | null | undefined;

/**
 * Self-service bank coordinates (RIB / titulaire / CIN) for a collaborator. Each field locks
 * once saved (only an admin can change a locked field). Lives on the self-profile page.
 */
export const BankDetailsCard: React.FC<{ profile: BankProfile; currentUserId: string | null; chapter?: string }> = ({ profile, currentUserId, chapter = '02' }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [draft, setDraft] = useState({
        bank_name: '',
        bank_account_holder: '',
        bank_rib: '',
        cin_number: '',
    });

    useEffect(() => {
        setDraft({
            bank_name: profile?.bank_name || '',
            bank_account_holder: profile?.bank_account_holder || '',
            bank_rib: profile?.bank_rib || '',
            cin_number: profile?.cin_number || '',
        });
    }, [profile?.bank_name, profile?.bank_account_holder, profile?.bank_rib, profile?.cin_number]);

    const lock = {
        bank_name: !!profile?.bank_name,
        bank_account_holder: !!profile?.bank_account_holder,
        bank_rib: !!profile?.bank_rib,
        cin_number: !!profile?.cin_number,
    };

    const anyEditable = !lock.bank_name || !lock.bank_account_holder || !lock.bank_rib || !lock.cin_number;
    const allLocked = lock.bank_name && lock.bank_account_holder && lock.bank_rib && lock.cin_number;

    const hasDirtyChanges = useMemo(() => {
        if (!lock.bank_name && draft.bank_name.trim() !== (profile?.bank_name || '')) return true;
        if (!lock.bank_account_holder && draft.bank_account_holder.trim() !== (profile?.bank_account_holder || '')) return true;
        if (!lock.bank_rib && draft.bank_rib.trim() !== (profile?.bank_rib || '')) return true;
        if (!lock.cin_number && draft.cin_number.trim() !== (profile?.cin_number || '')) return true;
        return false;
    }, [draft, profile, lock]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!currentUserId) throw new Error('Non connecté');
            const patch: Record<string, string> = {};
            if (!lock.bank_name && draft.bank_name.trim()) patch.bank_name = draft.bank_name.trim();
            if (!lock.bank_account_holder && draft.bank_account_holder.trim()) patch.bank_account_holder = draft.bank_account_holder.trim();
            if (!lock.bank_rib && draft.bank_rib.trim()) patch.bank_rib = draft.bank_rib.trim();
            if (!lock.cin_number && draft.cin_number.trim()) patch.cin_number = draft.cin_number.trim();

            if (Object.keys(patch).length === 0) throw new Error('Rien à enregistrer');

            const { error } = await (supabase as any).from('users').update(patch).eq('id', currentUserId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['profile-self'] });
            toast({ title: 'Coordonnées enregistrées', description: 'Les champs sauvegardés sont verrouillés. Contactez un admin pour les modifier.' });
        },
        onError: (err: any) => toast({ title: 'Échec', description: err.message, variant: 'destructive' }),
    });

    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className="h-[2px] w-full bg-ant-orange/70" />
            <div className="px-5 md:px-6 py-4 md:py-5 border-b border-ant-line flex items-center justify-between gap-3">
                <div>
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                        <span className="font-display text-ant-orange font-semibold">{chapter}</span> Coordonnées bancaires
                    </div>
                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                        Indispensables pour recevoir vos paiements
                    </p>
                </div>
                {allLocked && (
                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-ant-line bg-ant-light text-[10px] font-medium uppercase tracking-[0.14em] text-ant-mid shrink-0">
                        <Lock className="w-3 h-3" />
                        Verrouillé
                    </span>
                )}
            </div>

            <div className="p-4 md:p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <EditableBankField
                        label="Banque"
                        icon={CreditCard}
                        value={draft.bank_name}
                        onChange={(v) => setDraft((d) => ({ ...d, bank_name: v }))}
                        locked={lock.bank_name}
                        placeholder="ex. Attijariwafa Bank"
                    />
                    <EditableBankField
                        label="Titulaire du compte"
                        value={draft.bank_account_holder}
                        onChange={(v) => setDraft((d) => ({ ...d, bank_account_holder: v }))}
                        locked={lock.bank_account_holder}
                        placeholder="Nom légal complet"
                    />
                    <EditableBankField
                        label="RIB"
                        value={draft.bank_rib}
                        onChange={(v) => setDraft((d) => ({ ...d, bank_rib: v }))}
                        locked={lock.bank_rib}
                        placeholder="24 chiffres"
                        mono
                    />
                    <EditableBankField
                        label="CIN"
                        value={draft.cin_number}
                        onChange={(v) => setDraft((d) => ({ ...d, cin_number: v }))}
                        locked={lock.cin_number}
                        placeholder="Numéro carte d'identité"
                    />
                </div>

                {anyEditable && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-ant-line">
                        <p className="font-serif italic text-[11px] text-ant-mid max-w-md">
                            Une fois enregistrés, ces champs sont verrouillés. Pour les modifier plus tard, contactez un admin.
                        </p>
                        <button
                            type="button"
                            onClick={() => saveMutation.mutate()}
                            disabled={!hasDirtyChanges || saveMutation.isPending}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)] shrink-0"
                        >
                            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Enregistrer
                        </button>
                    </div>
                )}

                {!allLocked && (
                    <div className="rounded-xl border border-ant-orange/25 bg-ant-orange/5 p-3 flex items-start gap-2">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ant-orange" />
                        <p className="font-serif italic text-[11px] text-ant-ink leading-relaxed">
                            Vos coordonnées bancaires sont incomplètes. L'administrateur en a besoin pour vous verser vos gains.
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
};

const EditableBankField: React.FC<{
    label: string;
    icon?: typeof CreditCard;
    value: string;
    onChange: (v: string) => void;
    locked: boolean;
    placeholder?: string;
    mono?: boolean;
}> = ({ label, value, onChange, locked, placeholder, mono }) => (
    <div className={cn(
        'rounded-xl p-3 border space-y-1.5 transition-colors',
        locked
            ? 'bg-ant-light border-ant-line'
            : 'bg-ant-paper border-ant-line focus-within:border-ant-ink focus-within:ring-2 focus-within:ring-ant-orange/20',
    )}>
        <div className="flex items-center justify-between">
            <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">{label}</p>
            {locked && <Lock className="w-3 h-3 text-ant-mid/70" />}
        </div>
        {locked ? (
            <p className={cn('text-[12px] font-medium text-ant-ink break-all', mono && 'font-mono tracking-tight')}>
                {value || '—'}
            </p>
        ) : (
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={cn(
                    'w-full bg-transparent text-[12px] font-medium text-ant-ink placeholder:text-ant-mid/60 focus:outline-none',
                    mono && 'font-mono tracking-tight',
                )}
            />
        )}
    </div>
);

export default BankDetailsCard;
