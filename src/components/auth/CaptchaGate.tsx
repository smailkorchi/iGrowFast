// CaptchaGate — the pre-auth human check (Cloudflare Turnstile).
//
// Renders as a full-screen glass layer over the SAME AuthBackground as the
// login card, in the exact Auth design language (orange bar, eyebrow, display
// title, serif subtitle). The Turnstile widget is rendered ONCE and the layer
// merely fades out on pass (opacity + pointer-events, never unmounted): the
// widget instance must survive so a failed login can silently mint a fresh
// token via reset() — Turnstile tokens are single-use.
//
// Server-side enforcement lives in GoTrue (GOTRUE_SECURITY_CAPTCHA_*): this
// layer is the UX; the API is what actually refuses tokenless logins.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { SiCloudflare } from 'react-icons/si';

declare global {
    interface Window {
        turnstile?: {
            render: (el: HTMLElement, opts: Record<string, unknown>) => string;
            reset: (id?: string) => void;
            remove: (id: string) => void;
        };
    }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
    if (window.turnstile) return Promise.resolve();
    if (!scriptPromise) {
        scriptPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = SCRIPT_SRC;
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => { scriptPromise = null; reject(new Error('turnstile script failed')); };
            document.head.appendChild(s);
        });
    }
    return scriptPromise;
}

export interface CaptchaGateHandle {
    /** Mint a fresh token (silent for trusted visitors). Used after a failed
     *  login attempt — the previous token was consumed by GoTrue. */
    reset: () => void;
}

export const CaptchaGate = forwardRef<CaptchaGateHandle, {
    siteKey: string;
    /** true once the gate has been passed — fades the layer out (kept mounted). */
    passed: boolean;
    onToken: (token: string | null) => void;
}>(function CaptchaGate({ siteKey, passed, onToken }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;
    const [state, setState] = useState<'loading' | 'ready' | 'ok' | 'error'>('loading');

    useEffect(() => {
        let cancelled = false;
        void loadTurnstile()
            .then(() => {
                if (cancelled || !hostRef.current || widgetIdRef.current) return;
                widgetIdRef.current = window.turnstile!.render(hostRef.current, {
                    sitekey: siteKey,
                    theme: 'dark',
                    language: 'fr',
                    callback: (token: string) => { setState('ok'); onTokenRef.current(token); },
                    'expired-token-callback': () => {
                        onTokenRef.current(null);
                        try { window.turnstile?.reset(widgetIdRef.current ?? undefined); } catch { /* noop */ }
                    },
                    'error-callback': () => { setState('error'); onTokenRef.current(null); },
                });
                setState('ready');
            })
            .catch(() => { if (!cancelled) setState('error'); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteKey]);

    useImperativeHandle(ref, () => ({
        reset: () => {
            try { window.turnstile?.reset(widgetIdRef.current ?? undefined); } catch { /* noop */ }
        },
    }), []);

    return (
        <div
            aria-hidden={passed}
            className={
                'absolute inset-0 z-20 flex items-center justify-center px-5 py-8 ' +
                'transition-[opacity,transform] duration-700 ease-out ' +
                (passed ? 'opacity-0 -translate-y-3 pointer-events-none' : 'opacity-100 translate-y-0')
            }
        >
            <div className="w-full max-w-[440px] rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl shadow-[0_32px_80px_-24px_rgba(0,0,0,0.45)] overflow-hidden">
                <div className="h-[3px] w-full bg-ant-orange" />
                <div className="p-6 sm:p-8 space-y-6">
                    <div className="flex flex-col items-center text-center space-y-3">
                        <img
                            src="/Logo/iGrowFast Logo Transparent.png"
                            alt="iGrowFast"
                            className="h-12 object-contain"
                        />
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Sécurité · Accès console
                        </div>
                        <h2 className="font-display text-[26px] sm:text-[28px] leading-tight tracking-[-0.02em] text-white">
                            Vérification rapide
                        </h2>
                        <p className="font-serif italic text-[13px] leading-relaxed text-white/70 max-w-[320px]">
                            Une seconde — nous confirmons que vous êtes bien humain avant d'ouvrir la console.
                        </p>
                    </div>

                    {/* Widget well — Turnstile (300×65, dark) centered in a soft frame. */}
                    <div className="flex justify-center">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2.5 min-h-[86px] min-w-[321px] flex items-center justify-center">
                            {state === 'loading' && (
                                <span className="inline-flex items-center gap-2 text-[12px] text-white/50">
                                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                                    Chargement de la vérification…
                                </span>
                            )}
                            {state === 'error' && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/40 bg-ant-rose/15 px-3 py-1 text-[11px] font-semibold text-ant-rose">
                                    Vérification indisponible — rechargez la page.
                                </span>
                            )}
                            <div ref={hostRef} className={state === 'loading' || state === 'error' ? 'hidden' : ''} />
                        </div>
                    </div>

                    {state === 'ok' && (
                        <div className="flex justify-center">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/40 bg-ant-green/15 px-3 py-1 text-[11px] font-semibold text-ant-green">
                                <Check className="w-3.5 h-3.5" strokeWidth={2} /> Vérifié — ouverture…
                            </span>
                        </div>
                    )}

                    <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/45">
                        <SiCloudflare className="w-4 h-4 text-[#f38020]" aria-hidden />
                        Protégé par <span className="font-semibold text-white/60">Cloudflare Turnstile</span>
                    </div>
                </div>
            </div>
        </div>
    );
});
