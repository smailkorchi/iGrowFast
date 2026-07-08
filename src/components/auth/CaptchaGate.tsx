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

// Official Cloudflare brand mark (Simple Icons path — the real cloud, not a
// generic cloud glyph), brand orange #F38020.
function CloudflareLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="#f38020" aria-hidden className={className}>
            <path d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727" />
        </svg>
    );
}

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
                        <CloudflareLogo className="w-4 h-4" />
                        Protégé par <span className="font-semibold text-white/60">Cloudflare Turnstile</span>
                    </div>
                </div>
            </div>
        </div>
    );
});
