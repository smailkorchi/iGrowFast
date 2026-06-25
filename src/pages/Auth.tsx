import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowRight, ArrowLeft, ShieldCheck, AtSign, Lock, Check, KeyRound, Fingerprint } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AuthBackground } from '@/components/auth/AuthBackground';
import { requestPasswordReset } from '@/lib/credentialChange';
import { describePasskeyError, listOwnPasskeys, registerOwnPasskey } from '@/lib/selfSecurity';
import { EyePasswordToggle } from '@/components/ui/EyePasswordToggle';
import { ACTIVE_ANNOUNCEMENT } from '@/components/announcements/activeAnnouncement';

const loginSchema = z.object({
    identifier: z.string().min(3, 'Identifiant ou email requis'),
    password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Auth = () => {
    const [loading, setLoading] = useState(false);
    const [showPw, setShowPw] = useState(false);
    const [view, setView] = useState<'login' | 'forgot'>('login');
    const [resetId, setResetId] = useState('');
    const [resetSent, setResetSent] = useState(false);
    const [resetBusy, setResetBusy] = useState(false);
    const { toast } = useToast();
    const navigate = useNavigate();

    // Lock body overscroll so rubber-band scrolling doesn't reveal a blank canvas under the page.
    useEffect(() => {
        const html = document.documentElement, body = document.body;
        const prev = { h: html.style.overscrollBehavior, b: body.style.overscrollBehavior, bg: body.style.backgroundColor };
        html.style.overscrollBehavior = 'none'; body.style.overscrollBehavior = 'none'; body.style.backgroundColor = '#141413';
        return () => { html.style.overscrollBehavior = prev.h; body.style.overscrollBehavior = prev.b; body.style.backgroundColor = prev.bg; };
    }, []);

    const handleForgot = async (e: React.FormEvent) => {
        e.preventDefault();
        if (resetId.trim().length < 3) return;
        setResetBusy(true);
        try { await requestPasswordReset(resetId); } catch { /* generic */ }
        setResetBusy(false);
        setResetSent(true);
    };

    const [pending2FA, setPending2FA] = useState<null | { role: string | null; identifier: string }>(null);
    const [code2FA, setCode2FA] = useState('');
    const [verify2FABusy, setVerify2FABusy] = useState(false);
    const [err2FA, setErr2FA] = useState<string | null>(null);
    const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);
    const [passkeyPromptCtx, setPasskeyPromptCtx] = useState<{ role: string | null; identifier: string } | null>(null);
    const [settingUpPasskey, setSettingUpPasskey] = useState(false);

    // Final funnel for EVERY login path (password, 2FA, passkey login, passkey setup, skip).
    // When an announcement is live, arm a one-shot flag here; the authenticated app shell
    // (ProtectedRoute → AnnouncementGate) consumes it and renders the overlay ON the dashboard
    // after redirect — i.e. after the passkey nudge, which lives on this page.
    const proceed = (ctx: { role: string | null; identifier: string }) => {
        if (ACTIVE_ANNOUNCEMENT?.active) {
            try { sessionStorage.setItem('igf_pending_announcement', ACTIVE_ANNOUNCEMENT.id); } catch { /* storage unavailable */ }
        }
        toast({ title: 'Bienvenue', description: 'Connexion réussie à iGrowFast.' });
        const r = ctx.role;
        if (r === 'commercial') navigate('/seller/dashboard');
        else if (r === 'owner') navigate('/owner/dashboard');
        else if (r === 'courier') navigate('/courier/dashboard');
        else if (r === 'mediabuyer') navigate('/mediabuyer/dashboard');
        else navigate('/');
    };

    // After full auth: if the user has no passkey, show the setup nudge; otherwise continue.
    const afterAuth = async (ctx: { role: string | null; identifier: string }) => {
        try {
            const list = await listOwnPasskeys();
            if (list.length === 0) { setPasskeyPromptCtx(ctx); setShowPasskeyPrompt(true); return; }
        } catch { /* passkeys unavailable — skip the nudge */ }
        proceed(ctx);
    };
    const setupPasskeyNow = async () => {
        if (!passkeyPromptCtx) return;
        setSettingUpPasskey(true);
        try { await registerOwnPasskey(); proceed(passkeyPromptCtx); }
        catch (e) { const { cancelled, message } = describePasskeyError(e); if (!cancelled) toast({ title: 'Échec', description: message, variant: 'destructive' }); }
        finally { setSettingUpPasskey(false); }
    };
    const skipPasskey = () => { if (passkeyPromptCtx) proceed(passkeyPromptCtx); };

    const verify2FA = async () => {
        if (!pending2FA || code2FA.trim().length < 6) return;
        setVerify2FABusy(true); setErr2FA(null);
        try {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const factorId = factors?.totp?.[0]?.id;
            if (!factorId) throw new Error('Aucun authentificateur configuré.');
            const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code2FA.trim() });
            if (error) throw error;
            const ctx = { role: pending2FA.role, identifier: pending2FA.identifier };
            setPending2FA(null); setCode2FA('');
            await afterAuth(ctx);
        } catch (e) {
            setErr2FA((e as Error).message || 'Code incorrect.');
        } finally { setVerify2FABusy(false); }
    };

    const cancel2FA = async () => {
        await supabase.auth.signOut();
        setPending2FA(null); setCode2FA(''); setErr2FA(null);
    };

    const { register, handleSubmit, formState: { errors } } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
    });

    const handleLogin = async (values: LoginFormValues) => {
        setLoading(true);
        try {
            let email = values.identifier;

            if (!values.identifier.includes('@')) {
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('email')
                    .eq('username', values.identifier)
                    .single();

                if (userError || !user) {
                    throw new Error('Utilisateur introuvable avec cet identifiant.');
                }
                email = user.email;
            }

            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password: values.password,
            });

            if (error) throw error;

            const { data: profile } = await supabase
                .from('users')
                .select('role, active, "DigiCom Business"')
                .eq('id', data.user.id)
                .single();

            if (profile?.active === false) {
                await supabase.auth.signOut();
                throw new Error('Votre compte a été désactivé. Contactez votre administrateur.');
            }

            if (profile?.['DigiCom Business']) {
                localStorage.setItem('activeBusinessId', profile['DigiCom Business']);
            }

            const ctx = { role: profile?.role ?? null, identifier: values.identifier };

            // ── Two-factor gate (TOTP authenticator app, native MFA / AAL) ──
            const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aalData?.nextLevel === 'aal2' && aalData?.currentLevel === 'aal1') {
                setPending2FA({ ...ctx });
                setLoading(false);
                return;
            }

            await afterAuth(ctx);
        } catch (error) {
            toast({
                title: 'Connexion échouée',
                description: (error as Error).message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    // Passwordless sign-in via WebAuthn passkey. A passkey is strong on its own,
    // so it bypasses the password+TOTP gate.
    const handlePasskeyLogin = async () => {
        setLoading(true);
        try {
            const { data, error } = await (supabase.auth as any).signInWithPasskey();
            if (error) throw error;
            if (!data?.user) throw new Error('Connexion par clé d’accès échouée.');
            const { data: profile } = await supabase
                .from('users').select('role, active, "DigiCom Business"').eq('id', data.user.id).single();
            if (profile?.active === false) {
                await supabase.auth.signOut();
                throw new Error('Votre compte a été désactivé. Contactez votre administrateur.');
            }
            if (profile?.['DigiCom Business']) {
                localStorage.setItem('activeBusinessId', profile['DigiCom Business']);
            }
            proceed({ role: profile?.role ?? null, identifier: data.user.email ?? 'passkey' });
        } catch (e) {
            const { cancelled, message } = describePasskeyError(e);
            if (!cancelled) {
                toast({ title: 'Connexion échouée', description: message, variant: 'destructive' });
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-[100svh] w-full overflow-hidden">
            <AuthBackground />

            {showPasskeyPrompt ? (
              /* Passkey setup nudge — centered glass modal, form hidden, background kept */
              <div className="relative z-10 min-h-[100svh] w-full flex items-center justify-center px-5 py-8 pointer-events-none">
                <div className="w-full max-w-[440px] rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl shadow-[0_32px_80px_-24px_rgba(0,0,0,0.45)] overflow-hidden pointer-events-auto">
                  <div className="h-[3px] w-full bg-ant-orange" />
                  <div className="p-6 sm:p-7 space-y-5">
                    <div className="space-y-3">
                      <div className="h-12 w-12 rounded-2xl bg-ant-orange/15 border border-ant-orange/30 text-ant-orange flex items-center justify-center">
                        <Fingerprint className="w-6 h-6" strokeWidth={1.5} />
                      </div>
                      <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Connexion plus rapide
                      </div>
                      <h2 className="font-display text-[24px] sm:text-[26px] leading-tight tracking-[-0.02em] text-white">
                        Activez votre clé d’accès
                      </h2>
                      <p className="font-serif italic text-[13px] leading-relaxed text-white/70">
                        La prochaine fois, connectez-vous d’une empreinte ou d’un regard — sans mot de passe ni code. Plus rapide et plus sûr.
                      </p>
                    </div>
                    <div className="space-y-3">
                      <button type="button" onClick={setupPasskeyNow} disabled={settingUpPasskey}
                        className="w-full h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-70 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-[0.99]">
                        {settingUpPasskey ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Configuration…</> : <><Fingerprint className="w-4 h-4" strokeWidth={1.75} /> Configurer ma clé d’accès</>}
                      </button>
                      <button type="button" onClick={skipPasskey} disabled={settingUpPasskey}
                        className="w-full text-center text-[12px] text-white/50 hover:text-white/80 transition-colors cursor-pointer">
                        Plus tard
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
            <div className="relative z-10 min-h-[100svh] w-full flex flex-col lg:grid lg:grid-cols-2 lg:gap-10 px-5 py-8 sm:px-8 lg:px-16 lg:py-12 max-w-[1600px] mx-auto pointer-events-none">
                {/* Brand mark (mobile: top-left · desktop: part of left column) */}
                <div className="flex items-center gap-2.5 lg:col-span-2 pointer-events-auto w-fit">
                    <img src="/Logo/iGrowFast Logo Transparent.png" alt="iGrowFast" className="h-12 object-contain" />
                </div>

                {/* Desktop editorial column (hidden on mobile) */}
                <div className="hidden lg:flex flex-col justify-end pb-4 pr-8 max-w-[520px] pointer-events-auto">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Management · Console
                    </div>
                    <h1 className="font-display text-[44px] xl:text-[52px] leading-[1.02] tracking-[-0.03em] text-white mt-4">
                        Une console,<br />
                        <span className="font-serif italic font-light text-white/90">tout votre métier.</span>
                    </h1>
                    <p className="font-serif italic text-[15px] leading-relaxed text-white/70 mt-5 max-w-md">
                        Commandes, livraisons, paiements, campagnes — tout atterrit au même endroit. iGrowFast orchestre ce qui comptait hier sur dix onglets.
                    </p>
                </div>

                {/* Auth card — translucent glass over the background */}
                <div className="flex-1 flex items-center justify-center lg:justify-end py-6 lg:py-0 pointer-events-auto">
                    <div className="w-full max-w-[440px] rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl shadow-[0_32px_80px_-24px_rgba(0,0,0,0.45)] overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-6 sm:p-7 space-y-5">
                            {pending2FA ? (
                              <>
                                <div className="space-y-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Vérification
                                    </div>
                                    <h2 className="font-display text-[26px] sm:text-[28px] leading-tight tracking-[-0.02em] text-white">
                                        Double authentification
                                    </h2>
                                    <p className="font-serif italic text-[13px] leading-relaxed text-white/70">
                                        Entrez le code de votre application d’authentification.
                                    </p>
                                </div>
                                <div className="space-y-4">
                                    <input inputMode="numeric" maxLength={6} placeholder="000000" value={code2FA}
                                        onChange={(e) => setCode2FA(e.target.value.replace(/\D/g, ''))}
                                        className="w-full h-12 px-4 rounded-xl border border-white/15 bg-white/[0.06] text-center text-[20px] tracking-[0.4em] font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-ant-orange/60 focus:ring-2 focus:ring-ant-orange/20 transition-all" />
                                    {err2FA && (
                                        <p className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/40 bg-ant-rose/15 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" /> {err2FA}
                                        </p>
                                    )}
                                    <button type="button" onClick={verify2FA} disabled={verify2FABusy || code2FA.trim().length < 6}
                                        className="w-full h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-70 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-[0.99]">
                                        {verify2FABusy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Vérification…</> : <><ShieldCheck className="w-4 h-4" strokeWidth={1.75} /> Vérifier</>}
                                    </button>
                                    <div className="flex items-center">
                                        <button type="button" onClick={cancel2FA} className="text-[12px] text-white/50 hover:text-white/80 inline-flex items-center gap-1.5">
                                            <ArrowLeft className="w-3.5 h-3.5" /> Annuler
                                        </button>
                                    </div>
                                </div>
                              </>
                            ) : view === 'forgot' ? (
                              <>
                                <div className="space-y-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Récupération
                                    </div>
                                    <h2 className="font-display text-[26px] sm:text-[28px] leading-tight tracking-[-0.02em] text-white">
                                        Mot de passe oublié
                                    </h2>
                                    <p className="font-serif italic text-[13px] leading-relaxed text-white/70">
                                        Saisissez votre email ou identifiant. Si un compte existe, un lien sécurisé vous sera envoyé.
                                    </p>
                                </div>
                                {resetSent ? (
                                    <div className="space-y-4">
                                        <div className="flex items-start gap-3 rounded-xl border border-ant-green/30 bg-ant-green/10 p-4">
                                            <Check className="w-5 h-5 text-ant-green shrink-0 mt-0.5" strokeWidth={1.75} />
                                            <p className="text-[13px] text-white/80 leading-relaxed">
                                                Si un compte correspond, un lien de réinitialisation vient d'être envoyé. Vérifiez votre boîte mail (et les spams).
                                            </p>
                                        </div>
                                        <button type="button" onClick={() => { setView('login'); setResetSent(false); setResetId(''); }}
                                            className="w-full h-12 rounded-full bg-white hover:bg-white/95 text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors">
                                            <ArrowLeft className="w-4 h-4" strokeWidth={1.75} /> Retour à la connexion
                                        </button>
                                    </div>
                                ) : (
                                    <form onSubmit={handleForgot} className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label htmlFor="resetId" className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                                                Identifiant ou email
                                            </label>
                                            <div className="relative">
                                                <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" strokeWidth={1.75} />
                                                <input id="resetId" type="text" autoCapitalize="off" spellCheck={false}
                                                    placeholder="jane.doe / jane@igrowfast.com" value={resetId}
                                                    onChange={(e) => setResetId(e.target.value)}
                                                    className="w-full h-12 pl-10 pr-4 rounded-xl border border-white/15 bg-white/[0.06] text-[16px] font-medium text-white placeholder:font-serif placeholder:italic placeholder:text-white/35 focus:outline-none focus:border-ant-orange/60 focus:ring-2 focus:ring-ant-orange/20 focus:bg-white/[0.09] transition-all" />
                                            </div>
                                        </div>
                                        <button type="submit" disabled={resetBusy || resetId.trim().length < 3}
                                            className="w-full h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-70 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-[0.99]">
                                            {resetBusy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Envoi…</> : <><KeyRound className="w-4 h-4" strokeWidth={1.75} /> Envoyer le lien</>}
                                        </button>
                                        <button type="button" onClick={() => setView('login')}
                                            className="w-full text-center text-[12px] text-white/50 hover:text-white/80 inline-flex items-center justify-center gap-1.5">
                                            <ArrowLeft className="w-3.5 h-3.5" /> Retour à la connexion
                                        </button>
                                    </form>
                                )}
                              </>
                            ) : (
                              <>
                            <div className="space-y-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Connexion
                                </div>
                                <h2 className="font-display text-[26px] sm:text-[28px] leading-tight tracking-[-0.02em] text-white">
                                    Bon retour parmi nous
                                </h2>
                                <p className="font-serif italic text-[13px] leading-relaxed text-white/70">
                                    Accédez à votre tableau de bord — commandes, livraisons, paiements.
                                </p>
                            </div>

                            <form onSubmit={handleSubmit(handleLogin)} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label htmlFor="identifier" className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                                        Identifiant ou email
                                    </label>
                                    <div className="relative">
                                        <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" strokeWidth={1.75} />
                                        <input
                                            id="identifier"
                                            type="text"
                                            autoComplete="username"
                                            autoCapitalize="off"
                                            spellCheck={false}
                                            placeholder="jane.doe / jane@igrowfast.com"
                                            {...register('identifier')}
                                            className="w-full h-12 pl-10 pr-4 rounded-xl border border-white/15 bg-white/[0.06] text-[16px] font-medium text-white placeholder:font-serif placeholder:italic placeholder:text-white/35 focus:outline-none focus:border-ant-orange/60 focus:ring-2 focus:ring-ant-orange/20 focus:bg-white/[0.09] transition-all"
                                        />
                                    </div>
                                    {errors.identifier && (
                                        <p className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/40 bg-ant-rose/15 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                            {errors.identifier.message}
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="password" className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                                        Mot de passe
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" strokeWidth={1.75} />
                                        <input
                                            id="password"
                                            type={showPw ? 'text' : 'password'}
                                            autoComplete="current-password"
                                            placeholder="••••••••"
                                            {...register('password')}
                                            className="w-full h-12 pl-10 pr-12 rounded-xl border border-white/15 bg-white/[0.06] text-[16px] font-medium text-white placeholder:text-white/35 focus:outline-none focus:border-ant-orange/60 focus:ring-2 focus:ring-ant-orange/20 focus:bg-white/[0.09] transition-all"
                                        />
                                        <EyePasswordToggle
                                            revealed={showPw}
                                            onToggle={() => setShowPw(v => !v)}
                                            labels={{ show: 'Afficher le mot de passe', hide: 'Masquer le mot de passe' }}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors"
                                        />
                                    </div>
                                    {errors.password && (
                                        <p className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/40 bg-ant-rose/15 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                            {errors.password.message}
                                        </p>
                                    )}
                                </div>

                                <div className="flex justify-end -mt-1">
                                    <button type="button" onClick={() => { setView('forgot'); setResetSent(false); }}
                                        className="text-[11px] font-semibold text-white/55 hover:text-white transition-colors cursor-pointer">
                                        Mot de passe oublié ?
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-70 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-[0.99]"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                                            Connexion…
                                        </>
                                    ) : (
                                        <>
                                            Entrer dans la console
                                            <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                                        </>
                                    )}
                                </button>

                                <div className="relative flex items-center justify-center py-1">
                                    <span className="h-px flex-1 bg-white/10" />
                                    <span className="px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">ou</span>
                                    <span className="h-px flex-1 bg-white/10" />
                                </div>

                                <button type="button" onClick={handlePasskeyLogin} disabled={loading}
                                    className="w-full h-12 rounded-full border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-60 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors">
                                    <Fingerprint className="w-4 h-4" strokeWidth={1.75} /> Se connecter avec une clé d’accès
                                </button>
                            </form>
                              </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            )}
        </div>
    );
};

export default Auth;
