import { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    Mail, Lock, Smartphone, Loader2, Check, KeyRound, ChevronRight, ArrowLeft, ArrowRight, X,
} from 'lucide-react';
import {
    requestSelfOtp, confirmSelfChange, otpReason,
    enrollTotp, verifyTotpEnroll, listVerifiedTotp, unenrollTotp,
} from '@/lib/selfSecurity';

const inputCls = 'h-11 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink focus-visible:ring-1 focus-visible:ring-ant-orange/40';
const primaryBtn = 'h-11 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50';
const ghostBtn = 'h-11 px-4 rounded-full border border-ant-line text-[12px] font-semibold text-ant-mid hover:text-ant-ink inline-flex items-center gap-1.5 cursor-pointer';

/** OTP-gated change of email OR password for the logged-in user (no link). */
function CredentialChangeDialog({ mode, open, onClose, onDone }: {
    mode: 'email' | 'password'; open: boolean; onClose: () => void; onDone: () => void;
}) {
    const { toast } = useToast();
    const [step, setStep] = useState<'input' | 'otp'>('input');
    const [value, setValue] = useState('');
    const [confirm, setConfirm] = useState('');
    const [otp, setOtp] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { if (open) { setStep('input'); setValue(''); setConfirm(''); setOtp(''); setError(null); } }, [open]);

    const inputValid = mode === 'email'
        ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
        : value.length >= 6 && value === confirm;

    const sendCode = async () => {
        if (!inputValid) return;
        setBusy(true); setError(null);
        const res = await requestSelfOtp();
        setBusy(false);
        if (!res.ok) { setError(otpReason(res.reason)); return; }
        setStep('otp');
    };
    const confirmChange = async () => {
        if (otp.trim().length < 6) return;
        setBusy(true); setError(null);
        const res = await confirmSelfChange({
            otp: otp.trim(),
            new_email: mode === 'email' ? value.trim().toLowerCase() : null,
            new_password: mode === 'password' ? value : null,
        });
        setBusy(false);
        if (!res.ok) { setError(otpReason(res.reason)); return; }
        toast({ title: mode === 'email' ? 'E-mail mis à jour' : 'Mot de passe mis à jour' });
        onDone(); onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl overflow-hidden">
                <div className="h-[3px] w-full bg-ant-orange" />
                <DialogHeader className="px-6 pt-5 pb-3">
                    <DialogTitle className="font-display text-[18px] text-ant-ink">
                        {mode === 'email' ? 'Changer l’e-mail' : 'Changer le mot de passe'}
                    </DialogTitle>
                    <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid">
                        {step === 'input'
                            ? 'Un code de confirmation sera envoyé à votre e-mail actuel.'
                            : 'Entrez le code reçu sur votre e-mail actuel.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="px-6 pb-5 space-y-3">
                    {step === 'input' ? (
                        <>
                            {mode === 'email' ? (
                                <Input type="email" placeholder="Nouvel e-mail" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} />
                            ) : (
                                <>
                                    <Input type="password" placeholder="Nouveau mot de passe (min. 6)" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} />
                                    <Input type="password" placeholder="Confirmer le mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
                                </>
                            )}
                            {error && <p className="text-[12px] font-semibold text-ant-rose">{error}</p>}
                            <div className="flex justify-end gap-2 pt-1">
                                <button onClick={onClose} className={ghostBtn}>Annuler</button>
                                <button onClick={sendCode} disabled={!inputValid || busy} className={primaryBtn}>
                                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} Envoyer le code
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <Input inputMode="numeric" maxLength={6} placeholder="000000" value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                className={cn(inputCls, 'text-center tracking-[0.4em] font-mono')} />
                            {error && <p className="text-[12px] font-semibold text-ant-rose">{error}</p>}
                            <div className="flex justify-between gap-2 pt-1">
                                <button onClick={() => { setStep('input'); setOtp(''); setError(null); }} className={ghostBtn}>
                                    <ArrowLeft className="w-4 h-4" /> Retour
                                </button>
                                <button onClick={confirmChange} disabled={otp.trim().length < 6 || busy} className={primaryBtn}>
                                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmer
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function TotpEnrollDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
    const { toast } = useToast();
    const [qr, setQr] = useState<string | null>(null);
    const [secret, setSecret] = useState<string | null>(null);
    const [factorId, setFactorId] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setCode(''); setError(null); setQr(null);
        (async () => {
            try {
                const data = await enrollTotp();
                setFactorId(data.id);
                setQr((data as any).totp?.qr_code ?? null);
                setSecret((data as any).totp?.secret ?? null);
            } catch (e) {
                setError((e as Error).message);
            }
        })();
    }, [open]);

    const verify = async () => {
        if (!factorId || code.trim().length < 6) return;
        setBusy(true); setError(null);
        try {
            await verifyTotpEnroll(factorId, code.trim());
            toast({ title: 'Application d’authentification activée' });
            onDone(); onClose();
        } catch (e) {
            setError((e as Error).message || 'Code incorrect.');
        } finally { setBusy(false); }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl overflow-hidden">
                <div className="h-[3px] w-full bg-ant-orange" />
                <DialogHeader className="px-6 pt-5 pb-3">
                    <DialogTitle className="font-display text-[18px] text-ant-ink">Application d’authentification</DialogTitle>
                    <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid">
                        Scannez le QR code avec Google Authenticator, Authy ou 1Password, puis entrez le code.
                    </DialogDescription>
                </DialogHeader>
                <div className="px-6 pb-5 space-y-3">
                    {qr ? (
                        <div className="flex flex-col items-center gap-2">
                            <img src={qr} alt="QR" className="w-44 h-44 rounded-xl border border-ant-line bg-white p-2" />
                            {secret && <p className="text-[10px] font-mono text-ant-mid break-all text-center">{secret}</p>}
                        </div>
                    ) : error ? null : (
                        <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-ant-mid" /></div>
                    )}
                    <Input inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres" value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                        className={cn(inputCls, 'text-center tracking-[0.4em] font-mono')} />
                    {error && <p className="text-[12px] font-semibold text-ant-rose">{error}</p>}
                    <div className="flex justify-end gap-2 pt-1">
                        <button onClick={onClose} className={ghostBtn}>Annuler</button>
                        <button onClick={verify} disabled={busy || code.trim().length < 6 || !factorId} className={primaryBtn}>
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Activer
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

const Row = ({ icon: Icon, title, subtitle, children }: { icon: typeof Mail; title: string; subtitle?: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-3 py-3.5 border-b border-ant-line last:border-0">
        <div className="w-9 h-9 rounded-lg bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink shrink-0">
            <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-ant-ink leading-tight">{title}</p>
            {subtitle && <p className="text-[11.5px] text-ant-mid truncate">{subtitle}</p>}
        </div>
        {children}
    </div>
);

export function SecuritySection({ email, chapter = '02' }: {
    email?: string | null; chapter?: string;
}) {
    const { toast } = useToast();
    const [dialog, setDialog] = useState<null | 'email' | 'password' | 'totp'>(null);
    const [totpActive, setTotpActive] = useState(false);
    const [totpFactorId, setTotpFactorId] = useState<string | null>(null);

    const refreshTotp = useCallback(async () => {
        try {
            const factors = await listVerifiedTotp();
            setTotpActive(factors.length > 0);
            setTotpFactorId(factors[0]?.id ?? null);
        } catch { /* ignore */ }
    }, []);
    useEffect(() => { refreshTotp(); }, [refreshTotp]);

    const disableTotp = async () => {
        if (!totpFactorId) return;
        try { await unenrollTotp(totpFactorId); await refreshTotp(); toast({ title: 'Application d’authentification désactivée' }); }
        catch (e) { toast({ title: 'Erreur', description: (e as Error).message, variant: 'destructive' }); }
    };

    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className="h-[2px] w-full bg-ant-orange/70" />
            <div className="px-5 md:px-6 pt-5 pb-2">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className="font-display text-ant-orange font-semibold">{chapter}</span> Sécurité
                </div>
            </div>
            <div className="px-5 md:px-6 pb-3">
                <Row icon={Mail} title="Adresse e-mail" subtitle={email ?? undefined}>
                    <button onClick={() => setDialog('email')} className={ghostBtn}>Modifier <ChevronRight className="w-3.5 h-3.5" /></button>
                </Row>
                <Row icon={Lock} title="Mot de passe" subtitle="Confirmé par code (OTP)">
                    <button onClick={() => setDialog('password')} className={ghostBtn}>Modifier <ChevronRight className="w-3.5 h-3.5" /></button>
                </Row>
                <Row icon={Smartphone} title="Application d’authentification (2FA)"
                    subtitle={totpActive ? 'Activée · TOTP' : 'Recommandé pour sécuriser la connexion'}>
                    {totpActive ? (
                        <button onClick={disableTotp} className={cn(ghostBtn, 'text-ant-rose hover:text-ant-rose')}>
                            <X className="w-3.5 h-3.5" /> Désactiver
                        </button>
                    ) : (
                        <button onClick={() => setDialog('totp')} className={ghostBtn}>Configurer <ArrowRight className="w-3.5 h-3.5" /></button>
                    )}
                </Row>
            </div>

            <CredentialChangeDialog mode="email" open={dialog === 'email'} onClose={() => setDialog(null)} onDone={() => { /* email mirrored server-side; user may need to re-login */ }} />
            <CredentialChangeDialog mode="password" open={dialog === 'password'} onClose={() => setDialog(null)} onDone={() => {}} />
            <TotpEnrollDialog open={dialog === 'totp'} onClose={() => setDialog(null)} onDone={refreshTotp} />
        </section>
    );
}

export default SecuritySection;
