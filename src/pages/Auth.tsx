import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { logAction } from '@/lib/auditLog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowRight, ShieldCheck, AtSign, Lock } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AuthBackground } from '@/components/auth/AuthBackground';

const loginSchema = z.object({
    identifier: z.string().min(3, 'Identifiant ou email requis'),
    password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Auth = () => {
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const navigate = useNavigate();

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
                void logAction({
                    action: 'forbidden',
                    metadata: { reason: 'account_disabled', identifier: values.identifier, email },
                });
                throw new Error('Votre compte a été désactivé. Contactez votre administrateur.');
            }

            if (profile?.['DigiCom Business']) {
                localStorage.setItem('activeBusinessId', profile['DigiCom Business']);
            }

            void logAction({
                action: 'login',
                metadata: { identifier: values.identifier, role: profile?.role ?? null },
            });

            toast({
                title: 'Bienvenue',
                description: 'Connexion réussie à iGrowFast.',
            });

            if (profile?.role === 'commercial') {
                navigate('/seller/dashboard');
            } else if (profile?.role === 'owner') {
                navigate('/owner/dashboard');
            } else if (profile?.role === 'courier') {
                navigate('/courier/dashboard');
            } else if (profile?.role === 'mediabuyer') {
                navigate('/mediabuyer/dashboard');
            } else {
                navigate('/');
            }
        } catch (error) {
            void logAction({
                action: 'login_failed',
                metadata: {
                    identifier: values.identifier,
                    reason: (error as Error).message,
                },
            });
            toast({
                title: 'Connexion échouée',
                description: (error as Error).message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-[100svh] w-full overflow-hidden">
            <AuthBackground />

            {/* Content grid: mobile = single centered card, desktop = split copy + card.
                `pointer-events-none` on the grid lets ripples reach the canvas in
                empty regions; children re-enable pointer events where needed. */}
            <div className="relative z-10 min-h-[100svh] w-full flex flex-col lg:grid lg:grid-cols-2 lg:gap-10 px-5 py-8 sm:px-8 lg:px-16 lg:py-12 max-w-[1600px] mx-auto pointer-events-none">
                {/* Brand mark (mobile: top-left · desktop: part of left column) */}
                <div className="flex items-center gap-2.5 lg:col-span-2 pointer-events-auto w-fit">
                    <img src="/Logo/iGrowFast Logo Transparent.png" alt="iGrowFast" className="h-9 object-contain" />
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
                    <div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-3 pr-5 w-fit">
                        <div className="h-10 w-10 rounded-xl bg-ant-orange/15 border border-ant-orange/30 text-ant-orange flex items-center justify-center">
                            <ShieldCheck className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="leading-tight">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60">Session chiffrée</p>
                            <p className="font-display text-[14px] font-semibold text-white">TLS 1.3 · Cookies sécurisés</p>
                        </div>
                    </div>
                </div>

                {/* Auth card — translucent glass over the background */}
                <div className="flex-1 flex items-center justify-center lg:justify-end py-6 lg:py-0 pointer-events-auto">
                    <div className="w-full max-w-[440px] rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl shadow-[0_32px_80px_-24px_rgba(0,0,0,0.45)] overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-6 sm:p-7 space-y-5">
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
                                            type="password"
                                            autoComplete="current-password"
                                            placeholder="••••••••"
                                            {...register('password')}
                                            className="w-full h-12 pl-10 pr-4 rounded-xl border border-white/15 bg-white/[0.06] text-[16px] font-medium text-white placeholder:text-white/35 focus:outline-none focus:border-ant-orange/60 focus:ring-2 focus:ring-ant-orange/20 focus:bg-white/[0.09] transition-all"
                                        />
                                    </div>
                                    {errors.password && (
                                        <p className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/40 bg-ant-rose/15 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                            {errors.password.message}
                                        </p>
                                    )}
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
                            </form>

                            <div className="flex items-center gap-2 pt-3 border-t border-white/10">
                                <ShieldCheck className="w-3.5 h-3.5 text-white/50 shrink-0" strokeWidth={1.75} />
                                <p className="font-serif italic text-[11px] text-white/50">
                                    Session chiffrée · TLS 1.3 · Cookies sécurisés
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Auth;
