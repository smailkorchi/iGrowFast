import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    checkInvitation, consumeInvitation, invitationReason, type InvitationStatus,
} from '@/lib/invitations';
import { AvatarStudio } from '@/components/users/AvatarStudio';
import { AuthBackground } from '@/components/auth/AuthBackground';
import { cn } from '@/lib/utils';
import { Loader2, ArrowRight, ArrowLeft, ShieldCheck, AtSign, Lock, User as UserIcon, Check } from 'lucide-react';
import { EyePasswordToggle } from '@/components/ui/EyePasswordToggle';

const ROLE_LABEL: Record<string, string> = {
    'super admin': 'Super admin', 'admin': 'Admin', 'commercial': 'Commercial',
    'courier': 'Courier', 'mediabuyer': 'Media buyer',
};

const Register = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [status, setStatus] = useState<InvitationStatus | null>(null);
    const [checking, setChecking] = useState(true);

    const [step, setStep] = useState<0 | 1 | 2>(0); // 0 avatar · 1 identity · 2 done
    const [avatarConfig, setAvatarConfig] = useState<object | null>(null);
    const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    const identityValid = useMemo(() =>
        name.trim().length >= 2 &&
        username.trim().length >= 3 &&
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
        password.length >= 6,
        [name, username, email, password]);

    const submit = async () => {
        if (!token || !identityValid) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await consumeInvitation({
                token,
                name: name.trim(),
                username: username.trim(),
                email: email.trim().toLowerCase(),
                password,
                avatar_config: avatarConfig,
                avatar_data_url: avatarDataUrl,
            });
            if (!res.ok) { setError(invitationReason(res.reason)); setSubmitting(false); return; }

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
            setStep(2);
            const dest = role === 'commercial' ? '/seller/dashboard'
                : role === 'courier' ? '/courier/dashboard'
                : role === 'mediabuyer' ? '/mediabuyer/dashboard'
                : '/';
            window.setTimeout(() => navigate(dest, { replace: true }), 1800);
        } catch (e) {
            setError((e as Error).message);
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
                        ) : step === 2 ? (
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
                                        {ROLE_LABEL[status.target_role ?? ''] ?? 'New account'} · Step {step + 1} of 2
                                    </div>
                                    <h1 className="font-display text-[24px] leading-tight tracking-[-0.02em] text-white">
                                        {step === 0 ? 'Pick your look' : 'Your details'}
                                    </h1>
                                    <p className="font-serif italic text-[13px] text-white/60">
                                        {step === 0
                                            ? 'Generate an avatar or upload a photo.'
                                            : 'Choose the email and password you’ll sign in with.'}
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
                                ) : (
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
                                            <div className="relative">
                                                <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                <input className={inputCls} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                                            </div>
                                            <div className="relative">
                                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                                                <input className={`${inputCls} !pr-12`} type={showPw ? 'text' : 'password'} placeholder="Password (min. 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                                                <EyePasswordToggle revealed={showPw} onToggle={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors" />
                                            </div>
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
                                                onClick={submit}
                                                disabled={!identityValid || submitting}
                                                className="flex-1 h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-60 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                                            >
                                                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <>Create my account <ArrowRight className="w-4 h-4" /></>}
                                            </button>
                                        </div>
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
