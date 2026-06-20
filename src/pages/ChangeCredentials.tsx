import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthBackground } from '@/components/auth/AuthBackground';
import {
    checkCredentialToken, requestCredentialOtp, confirmCredentialChange, credReason, type CredTokenStatus,
} from '@/lib/credentialChange';
import { Loader2, ArrowRight, ArrowLeft, ShieldCheck, AtSign, Lock, Check, KeyRound } from 'lucide-react';
import { EyePasswordToggle } from '@/components/ui/EyePasswordToggle';

const ChangeCredentials = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [status, setStatus] = useState<CredTokenStatus | null>(null);
    const [checking, setChecking] = useState(true);
    const [step, setStep] = useState<0 | 1 | 2>(0); // 0 fields · 1 otp · 2 done
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [otp, setOtp] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const html = document.documentElement, body = document.body;
        const prev = { h: html.style.overscrollBehavior, b: body.style.overscrollBehavior, bg: body.style.backgroundColor };
        html.style.overscrollBehavior = 'none'; body.style.overscrollBehavior = 'none'; body.style.backgroundColor = '#141413';
        return () => { html.style.overscrollBehavior = prev.h; body.style.overscrollBehavior = prev.b; body.style.backgroundColor = prev.bg; };
    }, []);

    useEffect(() => {
        let active = true;
        (async () => {
            if (!token) { setStatus({ ok: false, reason: 'invalid' }); setChecking(false); return; }
            const res = await checkCredentialToken(token);
            if (active) { setStatus(res); setChecking(false); }
        })();
        return () => { active = false; };
    }, [token]);

    const wantsEmail = email.trim().length > 0;
    const wantsPassword = password.length > 0;
    const fieldsValid = useMemo(() => {
        if (!wantsEmail && !wantsPassword) return false;
        if (wantsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return false;
        if (wantsPassword && (password.length < 6 || password !== confirm)) return false;
        return true;
    }, [wantsEmail, wantsPassword, email, password, confirm]);

    const sendCode = async () => {
        if (!token || !fieldsValid) return;
        setBusy(true); setError(null);
        const res = await requestCredentialOtp(token);
        setBusy(false);
        if (!res.ok) { setError(credReason(res.reason)); return; }
        setStep(1);
    };

    const confirmChange = async () => {
        if (!token || otp.trim().length < 4) return;
        setBusy(true); setError(null);
        const res = await confirmCredentialChange({
            token, otp: otp.trim(),
            new_email: wantsEmail ? email.trim().toLowerCase() : null,
            new_password: wantsPassword ? password : null,
        });
        setBusy(false);
        if (!res.ok) { setError(credReason(res.reason)); return; }
        setStep(2);
        window.setTimeout(() => navigate('/auth', { replace: true }), 2200);
    };

    const inputCls = 'w-full h-12 pl-10 pr-4 rounded-xl border border-white/15 bg-white/[0.06] text-[15px] font-medium text-white placeholder:text-white/35 focus:outline-none focus:border-ant-orange/60 focus:ring-2 focus:ring-ant-orange/20 transition-all';

    return (
        <div className="relative min-h-[100svh] w-full overflow-hidden font-sans">
            <AuthBackground />
            <div className="relative z-10 min-h-[100svh] w-full flex flex-col items-center justify-center px-5 py-10">
                <div className="w-full max-w-md">
                    <div className="flex items-center gap-2.5 mb-6 justify-center">
                        <img src="/Logo/iGrowFast Logo Transparent.png" alt="iGrowFast" className="h-10 object-contain" />
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl shadow-[0_32px_80px_-24px_rgba(0,0,0,0.45)] overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-6 sm:p-7">
                            {checking ? (
                                <div className="py-16 flex flex-col items-center gap-3 text-white/60">
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    <p className="text-[13px]">Verifying your link…</p>
                                </div>
                            ) : !status?.ok ? (
                                <div className="py-12 text-center space-y-4">
                                    <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-rose/15 border border-ant-rose/30 flex items-center justify-center">
                                        <ShieldCheck className="w-5 h-5 text-ant-rose" />
                                    </div>
                                    <h1 className="font-display text-[20px] text-white">Link unavailable</h1>
                                    <p className="text-[13px] text-white/60">{credReason(status?.reason)}</p>
                                    <button onClick={() => navigate('/auth')} className="text-[12px] font-semibold text-ant-orange hover:underline">Go to sign in</button>
                                </div>
                            ) : step === 2 ? (
                                <div className="py-14 text-center space-y-4">
                                    <div className="mx-auto w-14 h-14 rounded-full bg-ant-green/15 border border-ant-green/30 flex items-center justify-center">
                                        <Check className="w-6 h-6 text-ant-green" />
                                    </div>
                                    <h1 className="font-display text-[22px] text-white">All set</h1>
                                    <p className="text-[13px] text-white/60">Your details were updated. Redirecting to sign in…</p>
                                    <Loader2 className="w-5 h-5 animate-spin text-white/40 mx-auto" />
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    <div className="space-y-1.5">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                            Secure update · Step {step + 1} of 2
                                        </div>
                                        <h1 className="font-display text-[24px] leading-tight tracking-[-0.02em] text-white">
                                            {step === 0 ? 'Update your login' : 'Enter the code'}
                                        </h1>
                                        <p className="font-serif italic text-[13px] text-white/60">
                                            {step === 0
                                                ? 'Set a new email and/or password. Leave a field blank to keep it.'
                                                : `We sent a 6-digit code to ${status.email ?? 'your current email'}.`}
                                        </p>
                                    </div>

                                    {step === 0 ? (
                                        <>
                                            <div className="space-y-3">
                                                <div className="relative">
                                                    <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                    <input className={inputCls} type="email" placeholder="New email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                                                </div>
                                                <div className="relative">
                                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                    <input className={`${inputCls} !pr-12`} type={showPw ? 'text' : 'password'} placeholder="New password (optional, min. 6)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                                                    <EyePasswordToggle revealed={showPw} onToggle={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors" />
                                                </div>
                                                {wantsPassword && (
                                                    <div className="relative">
                                                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                        <input className={inputCls} type={showPw ? 'text' : 'password'} placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                                                    </div>
                                                )}
                                            </div>
                                            {error && <p className="text-[12px] font-semibold text-ant-rose bg-ant-rose/10 border border-ant-rose/30 rounded-lg px-3 py-2">{error}</p>}
                                            <button onClick={sendCode} disabled={!fieldsValid || busy}
                                                className="w-full h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-60 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors">
                                                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending code…</> : <>Send verification code <ArrowRight className="w-4 h-4" /></>}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <div className="relative">
                                                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                <input className={`${inputCls} tracking-[0.4em] font-mono text-center`} inputMode="numeric" maxLength={6} placeholder="000000" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
                                            </div>
                                            {error && <p className="text-[12px] font-semibold text-ant-rose bg-ant-rose/10 border border-ant-rose/30 rounded-lg px-3 py-2">{error}</p>}
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => { setStep(0); setOtp(''); setError(null); }} className="h-12 px-4 rounded-full border border-white/15 text-white/70 hover:text-white text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                                                    <ArrowLeft className="w-4 h-4" /> Back
                                                </button>
                                                <button onClick={confirmChange} disabled={otp.trim().length < 6 || busy}
                                                    className="flex-1 h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-60 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors">
                                                    {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming…</> : <>Confirm changes <ArrowRight className="w-4 h-4" /></>}
                                                </button>
                                            </div>
                                            <button onClick={sendCode} disabled={busy} className="w-full text-center text-[12px] text-white/40 hover:text-white/70">Resend code</button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <p className="text-center text-[11px] text-white/30 mt-5">Secure link · single-use · expires in 2 hours</p>
                </div>
            </div>
        </div>
    );
};

export default ChangeCredentials;
