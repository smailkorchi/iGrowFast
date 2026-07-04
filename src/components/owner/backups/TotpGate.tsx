import { useEffect, useState } from 'react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { hasTotpFactor, upgradeToAal2 } from '@/lib/backupAgent';
import { cn } from '@/lib/utils';

/**
 * Blocks until the session is aal2. Calls onVerified() once the current session
 * has been upgraded with a valid TOTP code. If the account has no verified TOTP
 * factor at all, shows a hard stop (2FA must be enrolled in the profile first).
 */
export function TotpGate({ onVerified, prompt }: { onVerified: () => void; prompt?: string }) {
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [hasFactor, setHasFactor] = useState<boolean | null>(null);

    useEffect(() => { hasTotpFactor().then(setHasFactor); }, []);

    const submit = async (value: string) => {
        setBusy(true); setErr(null);
        const ok = await upgradeToAal2(value);
        setBusy(false);
        if (ok) { onVerified(); return; }
        setErr('Code invalide. Réessayez.'); setCode('');
    };

    if (hasFactor === false) {
        return (
            <div className="rounded-xl border border-ant-rose/30 bg-ant-rose-soft/50 p-4 flex items-start gap-3">
                <ShieldAlert className="w-4 h-4 text-ant-rose shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p className="font-display text-[13px] text-ant-ink">Authentification à deux facteurs requise</p>
                    <p className="font-serif italic text-[12px] text-ant-muted">
                        Activez d’abord la 2FA (TOTP) sur votre profil pour utiliser cette action.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-ant-line bg-ant-light/60 p-4 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-ant-ink">
                <ShieldCheck className="w-4 h-4 text-ant-orange" />
                <span className="font-display text-[13px]">{prompt ?? 'Confirmez avec votre code d’authentification'}</span>
            </div>
            <InputOTP
                maxLength={6}
                value={code}
                onChange={(v) => { setCode(v); if (v.length === 6) submit(v); }}
                disabled={busy}
            >
                <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
                </InputOTPGroup>
            </InputOTP>
            {busy && <Loader2 className="w-4 h-4 animate-spin text-ant-mid" />}
            {err && <p className={cn('font-serif italic text-[12px] text-ant-rose')}>{err}</p>}
        </div>
    );
}
