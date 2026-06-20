import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    checkInvitation, consumeInvitation, requestSignupOtp, checkSignupEmail,
    invitationReason, type InvitationStatus,
} from '@/lib/invitations';
import { AvatarStudio } from '@/components/users/AvatarStudio';
import { AuthBackground } from '@/components/auth/AuthBackground';
import { cn } from '@/lib/utils';
import { Loader2, ArrowRight, ArrowLeft, ShieldCheck, AtSign, Lock, User as UserIcon, Check, KeyRound, MailCheck, AlertCircle } from 'lucide-react';
import { EyePasswordToggle } from '@/components/ui/EyePasswordToggle';
import { PasswordStrengthBar } from '@/components/ui/PasswordStrengthBar';
import { scorePassword } from '@/lib/passwordStrength';

const ROLE_LABEL: Record<string, string> = {
    'super admin': 'Super admin', 'admin': 'Admin', 'commercial': 'Commercial',
    'courier': 'Courier', 'mediabuyer': 'Media buyer',
};

const Register = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [status, setStatus] = useState<InvitationStatus | null>(null);
    const [checking, setChecking] = useState(true);

    const [step, setStep] = useState<0 | 1 | 2 | 3>(0); // 0 avatar · 1 identity · 2 verify email · 3 done
    const [avatarConfig, setAvatarConfig] = useState<object | null>(null);
    const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Live email-deliverability check (syntax + typo + disposable + mailbox, server-side).
    // 'unknown' = the check itself failed (transient) — non-blocking; the OTP send re-validates.
    const [emailCheck, setEmailCheck] = useState<{ status: 'idle' | 'checking' | 'ok' | 'bad' | 'unknown'; reason?: string; suggestion?: string }>({ status: 'idle' });
    // Email-confirmation OTP step.
    const [otp, setOtp] = useState('');
    const [otpError, setOtpError] = useState<string | null>(null);
    const [sendingOtp, setSendingOtp] = useState(false);
    const [cooldown, setCooldown] = useState(0);   // seconds until resend is allowed again
    const [codeSent, setCodeSent] = useState(false);

    useEffect(() => {
        let active = true;
        (async () => {
            if (!token) { setStatus({ ok: false, reason: 'invalid' }); setChecking(false); return; }
            const res = await checkInvitation(token);
            if (active) { setStatus(res); setChecking(false); }
        })();
        return () => { active = false; };
    }, [token]);

    // Stop the macOS rubber-band overscroll from revealing the white <body>.
    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prev = {
            htmlOver: html.style.overscrollBehavior,
            bodyOver: body.style.overscrollBehavior,
            bodyBg: body.style.backgroundColor,
        };
        html.style.overscrollBehavior = 'none';
        body.style.overscrollBehavior = 'none';
        body.style.backgroundColor = '#141413'; // ant-ink — matches the AuthBackground
        return () => {
            html.style.overscrollBehavior = prev.htmlOver;
            body.style.overscrollBehavior = prev.bodyOver;
            body.style.backgroundColor = prev.bodyBg;
        };
    }, []);

    const emailFmtValid = useMemo(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()), [email]);

    // Debounced "is this email real" probe — only while on the identity step.
    useEffect(() => {
        if (step !== 1 || !token) return;
        const e = email.trim().toLowerCase();
        if (!emailFmtValid) { setEmailCheck({ status: 'idle' }); return; }
        setEmailCheck({ status: 'checking' });
        let active = true;
        const t = window.setTimeout(async () => {
            const res = await checkSignupEmail(token, e);
            if (!active) return;
            if (res.ok && res.deliverable) setEmailCheck({ status: 'ok' });
            else if (res.reason === 'error') setEmailCheck({ status: 'unknown' }); // transient — don't block
            else setEmailCheck({ status: 'bad', reason: res.reason, suggestion: res.suggestion });
        }, 600);
        return () => { active = false; window.clearTimeout(t); };
    }, [email, emailFmtValid, step, token]);

    // Resend cooldown ticker.
    useEffect(() => {
        if (cooldown <= 0) return;
        const id = window.setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
        return () => window.clearInterval(id);
    }, [cooldown]);

    const pwStrength = useMemo(() => scorePassword(password), [password]);
    const identityValid = useMemo(() =>
        name.trim().length >= 2 &&
        username.trim().length >= 3 &&
        emailFmtValid &&
        (emailCheck.status === 'ok' || emailCheck.status === 'unknown') &&
        pwStrength.valid,
        [name, username, emailFmtValid, emailCheck.status, pwStrength]);

    // Step 1 → 2: send the email-confirmation code. Reused as the resend handler on step 2,
    // where errors must surface on the OTP screen (otpError) rather than the step-1 error slot.
    const sendOtp = async (isResend = false) => {
        if (!token || sendingOtp) return;
        if (!isResend && !identityValid) return;
        if (isResend && cooldown > 0) return;
        const setErr = isResend ? setOtpError : setError;
        setSendingOtp(true);
        setErr(null);
        try {
            const res = await requestSignupOtp(token, email.trim().toLowerCase());
            if (!res.ok) {
                // Email turned out undeliverable/disposable server-side → reflect it on the field
                // and (if resending) bounce back to the identity step so it can be fixed.
                if (res.reason && ['disposable', 'no_mx', 'undeliverable', 'invalid_email', 'typo'].includes(res.reason)) {
                    setEmailCheck({ status: 'bad', reason: res.reason, suggestion: res.suggestion });
                    if (isResend) setStep(1);
                }
                setErr(invitationReason(res.reason));
                return;
            }
            setOtp(''); setOtpError(null); setCodeSent(true); setCooldown(30);
            if (!isResend) setStep(2);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSendingOtp(false);
        }
    };

    // Step 2 → 3: confirm the code (creates the account), auto sign-in, route by role.
    const finalize = async () => {
        if (!token || otp.trim().length < 6 || submitting) return;
        setSubmitting(true);
        setOtpError(null);
        try {
            const res = await consumeInvitation({
                token,
                name: name.trim(),
                username: username.trim(),
                email: email.trim().toLowerCase(),
                password,
                otp: otp.trim(),
                avatar_config: avatarConfig,
                avatar_data_url: avatarDataUrl,
            });
            if (!res.ok) {
                setOtpError(invitationReason(res.reason));
                // The verified email no longer matches what's being registered → fix it on step 1.
                if (res.reason === 'email_mismatch') setStep(1);
                setSubmitting(false);
                return;
            }

            // Auto sign-in, then route by role with the right business scope.
            const { error: signInErr } = await supabase.auth.signInWithPassword({
                email: email.trim().toLowerCase(), password,
            });
            if (signInErr) { navigate('/auth'); return; }

            const { data: { user } } = await supabase.auth.getUser();
            let role = res.target_role;
            if (user) {
                const { data: prof } = await supabase
                    .from('users').select('role, "DigiCom Business"').eq('id', user.id).single();
                if (prof) {
                    role = prof.role as string;
                    if (prof['DigiCom Business']) localStorage.setItem('activeBusinessId', prof['DigiCom Business']);
                }
            }
            setStep(3);
            const dest = role === 'commercial' ? '/seller/dashboard'
                : role === 'courier' ? '/courier/dashboard'
                : role === 'mediabuyer' ? '/mediabuyer/dashboard'
                : '/';
            window.setTimeout(() => navigate(dest, { replace: true }), 1800);
        } catch (e) {
            setOtpError((e as Error).message);
            setSubmitting(false);
        }
    };

    const inputCls = 'w-full h-12 pl-10 pr-4 rounded-xl border border-white/15 bg-white/[0.06] text-[15px] font-medium text-white placeholder:text-white/35 focus:outline-none focus:border-ant-orange/60 focus:ring-2 focus:ring-ant-orange/20 transition-all';

    return (
        <div className="relative min-h-[100svh] w-full overflow-hidden font-sans">
            <AuthBackground />
            <div className="relative z-10 min-h-[100svh] w-full flex flex-col items-center justify-center px-5 py-10">
            <div className={cn('w-full transition-[max-width] duration-300', status?.ok && step === 0 ? 'max-w-2xl' : 'max-w-md')}>
                <div className="flex items-center gap-2.5 mb-6 justify-center">
                    <img src="/Logo/iGrowFast Logo Transparent.png" alt="iGrowFast" className="h-10 object-contain" />
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl shadow-[0_32px_80px_-24px_rgba(0,0,0,0.45)] overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-6 sm:p-7">
                        {checking ? (
                            <div className="py-16 flex flex-col items-center gap-3 text-white/60">
                                <Loader2 className="w-6 h-6 animate-spin" />
                                <p className="text-[13px]">Verifying your invitation…</p>
                            </div>
                        ) : !status?.ok ? (
                            <div className="py-12 text-center space-y-4">
                                <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-rose/15 border border-ant-rose/30 flex items-center justify-center">
                                    <ShieldCheck className="w-5 h-5 text-ant-rose" />
                                </div>
                                <h1 className="font-display text-[20px] text-white">Invitation unavailable</h1>
                                <p className="text-[13px] text-white/60">{invitationReason(status?.reason)}</p>
                                <button onClick={() => navigate('/auth')} className="text-[12px] font-semibold text-ant-orange hover:underline">
                                    Go to sign in
                                </button>
                            </div>
                        ) : step === 3 ? (
                            <div className="py-14 text-center space-y-4">
                                <div className="mx-auto w-14 h-14 rounded-full bg-ant-green/15 border border-ant-green/30 flex items-center justify-center">
                                    <Check className="w-6 h-6 text-ant-green" />
                                </div>
                                <h1 className="font-display text-[22px] text-white">Welcome aboard</h1>
                                <p className="text-[13px] text-white/60">Setting up your workspace…</p>
                                <Loader2 className="w-5 h-5 animate-spin text-white/40 mx-auto" />
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        {ROLE_LABEL[status.target_role ?? ''] ?? 'New account'} · Step {step + 1} of 3
                                    </div>
                                    <h1 className="font-display text-[24px] leading-tight tracking-[-0.02em] text-white">
                                        {step === 0 ? 'Pick your look' : step === 1 ? 'Your details' : 'Confirm your email'}
                                    </h1>
                                    <p className="font-serif italic text-[13px] text-white/60">
                                        {step === 0
                                            ? 'Generate an avatar or upload a photo.'
                                            : step === 1
                                                ? 'Choose the email and password you’ll sign in with.'
                                                : `Enter the 6-digit code we sent to ${email.trim().toLowerCase()}.`}
                                    </p>
                                </div>

                                {step === 0 ? (
                                    <>
                                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                            <AvatarStudio onChange={(v) => { setAvatarConfig(v.config ?? null); setAvatarDataUrl(v.dataUrl ?? null); }} seed={email} />
                                        </div>
                                        <button
                                            onClick={() => setStep(1)}
                                            className="w-full h-12 rounded-full bg-white hover:bg-white/95 text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                                        >
                                            Continue <ArrowRight className="w-4 h-4" />
                                        </button>
                                    </>
                                ) : step === 1 ? (
                                    <>
                                        <div className="space-y-3">
                                            <div className="relative">
                                                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                <input className={inputCls} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                                            </div>
                                            <div className="relative">
                                                <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                <input className={inputCls} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" autoComplete="username" />
                                            </div>
                                            <div>
                                                <div className="relative">
                                                    <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                    <input className={`${inputCls} !pr-10`} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                                                    {emailCheck.status === 'checking' && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-white/50" />}
                                                    {emailCheck.status === 'ok' && <MailCheck className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-green" />}
                                                    {emailCheck.status === 'bad' && <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-rose" />}
                                                </div>
                                                {emailCheck.status === 'bad' && (
                                                    <p className="mt-1.5 text-[11px] font-medium text-ant-rose/90 flex flex-wrap items-center gap-1">
                                                        {invitationReason(emailCheck.reason)}
                                                        {emailCheck.reason === 'typo' && emailCheck.suggestion && (
                                                            <button type="button" onClick={() => setEmail(emailCheck.suggestion!)}
                                                                className="font-semibold text-ant-orange hover:underline">
                                                                Use {emailCheck.suggestion}
                                                            </button>
                                                        )}
                                                    </p>
                                                )}
                                                {emailCheck.status === 'unknown' && (
                                                    <p className="mt-1.5 text-[11px] font-medium text-white/45">Couldn’t verify right now — we’ll confirm with the code.</p>
                                                )}
                                            </div>
                                            <div className="relative">
                                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                <input className={`${inputCls} !pr-12`} type={showPw ? 'text' : 'password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                                                <EyePasswordToggle revealed={showPw} onToggle={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors" />
                                            </div>
                                            {password.length > 0 && <PasswordStrengthBar strength={pwStrength} className="text-white/70" />}
                                        </div>

                                        {error && (
                                            <p className="text-[12px] font-semibold text-ant-rose bg-ant-rose/10 border border-ant-rose/30 rounded-lg px-3 py-2">{error}</p>
                                        )}

                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setStep(0)}
                                                className="h-12 px-4 rounded-full border border-white/15 text-white/70 hover:text-white text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                                            >
                                                <ArrowLeft className="w-4 h-4" /> Back
                                            </button>
                                            <button
                                                onClick={() => sendOtp()}
                                                disabled={!identityValid || sendingOtp}
                                                className="flex-1 h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-60 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                                            >
                                                {sendingOtp ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending code…</> : <>Create my account <ArrowRight className="w-4 h-4" /></>}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-ant-orange/15 border border-ant-orange/30 flex items-center justify-center shrink-0">
                                                <MailCheck className="w-4 h-4 text-ant-orange" />
                                            </div>
                                            <p className="text-[12px] text-white/70 leading-snug">
                                                We sent a 6-digit code to <span className="font-semibold text-white">{email.trim().toLowerCase()}</span>. It expires in 10 minutes.
                                            </p>
                                        </div>
                                        {codeSent && !otpError && (
                                            <p className="text-[11px] font-medium text-ant-green flex items-center gap-1">
                                                <Check className="w-3 h-3" /> Code sent. Check your inbox (and spam).
                                            </p>
                                        )}
                                        <div className="relative">
                                            <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                            <input
                                                className={`${inputCls} tracking-[0.4em] font-mono text-center`}
                                                inputMode="numeric" maxLength={6} placeholder="000000" autoFocus
                                                value={otp}
                                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                                onKeyDown={(e) => { if (e.key === 'Enter') finalize(); }}
                                            />
                                        </div>

                                        {otpError && (
                                            <p className="text-[12px] font-semibold text-ant-rose bg-ant-rose/10 border border-ant-rose/30 rounded-lg px-3 py-2">{otpError}</p>
                                        )}

                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => { setStep(1); setOtp(''); setOtpError(null); setCodeSent(false); }}
                                                className="h-12 px-4 rounded-full border border-white/15 text-white/70 hover:text-white text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                                            >
                                                <ArrowLeft className="w-4 h-4" /> Back
                                            </button>
                                            <button
                                                onClick={finalize}
                                                disabled={otp.trim().length < 6 || submitting}
                                                className="flex-1 h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-60 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                                            >
                                                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming…</> : <>Confirm &amp; create <Check className="w-4 h-4" /></>}
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => sendOtp(true)} disabled={sendingOtp || cooldown > 0}
                                            className="w-full text-center text-[12px] text-white/40 hover:text-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {sendingOtp ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <p className="text-center text-[11px] text-white/30 mt-5">Secure invitation · single-use link</p>
            </div>
            </div>
        </div>
    );
};

export default Register;
