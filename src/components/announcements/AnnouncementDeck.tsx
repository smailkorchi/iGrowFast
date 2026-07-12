import { useEffect, useRef, useState } from 'react';
import { AuthBackground } from '@/components/auth/AuthBackground';

export interface AnnouncementDeckProps {
    /** Controls visibility. */
    open: boolean;
    /** Fired when the user finishes ("J'ai compris"), skips ("Passer"), or the embed fails. */
    onAcknowledge: () => void;
}

/**
 * Full-screen "Quoi de neuf" announcement deck, shown once per login over the dashboard
 * (see AnnouncementGate).
 *
 * The deck is a self-contained document — public/announcement-deck.html, built by the slides
 * pipeline — rendered inside a TRANSPARENT iframe via `srcdoc` (NOT `src`). The site sends
 * `X-Frame-Options: DENY` on every response, which blocks a network-loaded frame; srcdoc content
 * is inline (there is no HTTP framing response) so it renders while DENY — our clickjacking
 * protection — stays fully in force. Behind the iframe we render the same <AuthBackground/> as the
 * sign-in screen, fully visible (no heavy veil).
 *
 * Safety net so the overlay can NEVER block the dashboard:
 *   - the HTML is fetched (a plain same-origin GET; XFO does not apply to fetch). If the fetch
 *     fails, we dismiss immediately.
 *   - the deck posts `igf-announcement-ready` once it boots and `igf-announcement-done` when the
 *     user finishes/skips. If we never hear "ready" within a few seconds, a failsafe auto-dismisses.
 */
export function AnnouncementDeck({ open, onAcknowledge }: AnnouncementDeckProps) {
    const [html, setHtml] = useState<string | null>(null);
    // Keep the latest callback without re-running the effect below.
    const ackRef = useRef(onAcknowledge);
    ackRef.current = onAcknowledge;

    // Lock body scroll while open (mirrors the Auth page behavior).
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Fetch the deck, wire messaging, and arm the failsafe.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        let ready = false;

        fetch('/announcement-deck.html', { credentials: 'omit' })
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((t) => { if (!cancelled) setHtml(t); })
            .catch(() => { if (!cancelled) ackRef.current(); }); // never block on a failed load

        const onMessage = (e: MessageEvent) => {
            const type = (e.data as { type?: string } | null)?.type;
            if (type === 'igf-announcement-ready') ready = true;
            else if (type === 'igf-announcement-done') ackRef.current();
        };
        window.addEventListener('message', onMessage);

        // If the embed never signals it's alive, dismiss rather than trap the user.
        const failsafe = window.setTimeout(() => { if (!ready) ackRef.current(); }, 8000);

        return () => {
            cancelled = true;
            window.removeEventListener('message', onMessage);
            window.clearTimeout(failsafe);
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[120] overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Nouveautés iGrowFast"
        >
            {/* Same background as the auth page — visible, no extra dark veil. */}
            <AuthBackground />

            {/* The deck itself: a transparent iframe rendered from inline HTML (srcdoc bypasses
                X-Frame-Options while the DENY policy stays in force). */}
            {html && (
                <iframe
                    title="Nouveautés iGrowFast"
                    srcDoc={html}
                    className="absolute inset-0 h-full w-full border-0"
                    style={{ background: 'transparent' }}
                />
            )}
        </div>
    );
}
