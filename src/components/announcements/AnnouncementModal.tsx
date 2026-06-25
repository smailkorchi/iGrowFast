import { ReactNode, useEffect } from 'react';
import { Megaphone, ArrowRight, Loader2 } from 'lucide-react';
import { AuthBackground } from '@/components/auth/AuthBackground';

export interface AnnouncementModalProps {
    /** Controls visibility. */
    open: boolean;
    /** Fired when the user acknowledges (single mandatory CTA). */
    onAcknowledge: () => void;
    /** Small uppercase label above the title. */
    eyebrow?: string;
    title: string;
    /** Body content — plain paragraphs / JSX. */
    children: ReactNode;
    ctaLabel?: string;
    /** Disable the CTA while an async action runs. */
    busy?: boolean;
    /**
     * Render the animated auth background behind the dark veil. Leave false when the
     * modal is shown ON the Auth page (which already renders its own AuthBackground);
     * set true to reuse this modal anywhere else and still look like the auth screen.
     */
    withBackground?: boolean;
}

/**
 * Reusable full-screen announcement overlay. Floating glass card styled exactly like the
 * Auth page card (orange top accent, translucent glass, brand logo), over a dark veil.
 * Presentational only — drive its content from a config object so it can announce anything.
 */
export function AnnouncementModal({
    open,
    onAcknowledge,
    eyebrow = 'Annonce',
    title,
    children,
    ctaLabel = "J'ai compris",
    busy = false,
    withBackground = false,
}: AnnouncementModalProps) {
    // Lock body scroll while open (mirrors the Auth page behavior).
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center px-5 py-8 overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-title"
        >
            {withBackground && <AuthBackground />}

            {/* Dark veil over the background */}
            <div
                className="absolute inset-0 bg-ant-ink/80 backdrop-blur-sm"
                style={{
                    backgroundImage:
                        'radial-gradient(120% 80% at 50% 100%, rgba(20,20,19,0.55) 0%, rgba(20,20,19,0) 60%)',
                }}
                aria-hidden
            />

            {/* Card — same glass treatment as the auth card */}
            <div className="relative w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl shadow-[0_32px_80px_-24px_rgba(0,0,0,0.55)]">
                <div className="h-[3px] w-full bg-ant-orange" />
                <div className="p-6 sm:p-8 space-y-6">
                    {/* Brand mark — same logo as the auth page */}
                    <div className="flex items-center justify-between gap-3">
                        <img
                            src="/Logo/iGrowFast Logo Transparent.png"
                            alt="iGrowFast"
                            className="h-11 object-contain"
                        />
                        <div className="h-10 w-10 rounded-2xl bg-ant-orange/15 border border-ant-orange/30 text-ant-orange flex items-center justify-center shrink-0">
                            <Megaphone className="w-5 h-5" strokeWidth={1.5} />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> {eyebrow}
                        </div>
                        <h2
                            id="announcement-title"
                            className="font-display text-[26px] sm:text-[30px] leading-tight tracking-[-0.02em] text-white"
                        >
                            {title}
                        </h2>
                        <div className="space-y-3 text-[13.5px] leading-relaxed text-white/75 [&_strong]:font-semibold">
                            {children}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onAcknowledge}
                        disabled={busy}
                        className="w-full h-12 rounded-full bg-white hover:bg-white/95 disabled:opacity-70 disabled:cursor-not-allowed text-ant-ink text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-[0.99]"
                    >
                        {busy ? (
                            <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> …</>
                        ) : (
                            <>{ctaLabel} <ArrowRight className="w-4 h-4" strokeWidth={1.75} /></>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
