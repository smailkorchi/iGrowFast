import { useEffect } from 'react';
import { AuthBackground } from '@/components/auth/AuthBackground';

export interface AnnouncementDeckProps {
    /** Controls visibility. */
    open: boolean;
    /** Fired when the user finishes ("J'ai compris" on the last slide) or skips ("Passer"). */
    onAcknowledge: () => void;
}

/**
 * Full-screen "Quoi de neuf" announcement deck, shown once per login over the
 * dashboard (see AnnouncementGate).
 *
 * The deck is a self-contained HTML document — public/announcement-deck.html,
 * built by the slides pipeline — rendered inside a TRANSPARENT iframe so its
 * multi-step wizard and its vanilla-JS UI demos run pixel-identically with zero
 * re-implementation. Behind the iframe we render the very same <AuthBackground/>
 * as the sign-in screen, fully visible (no heavy dark veil): the deck's body and
 * backdrop are transparent, so the animated auth background shows around the card.
 *
 * When the user reaches the end ("J'ai compris") or skips ("Passer"), the deck
 * posts `{ type: 'igf-announcement-done' }` to this window; we relay it to
 * onAcknowledge, which clears the one-shot flag and closes the overlay.
 */
export function AnnouncementDeck({ open, onAcknowledge }: AnnouncementDeckProps) {
    // Lock body scroll while open (mirrors the Auth page behavior).
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Dismiss when the embedded deck signals completion.
    useEffect(() => {
        if (!open) return;
        const onMessage = (e: MessageEvent) => {
            const data = e.data as { type?: string } | null;
            if (data && data.type === 'igf-announcement-done') onAcknowledge();
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [open, onAcknowledge]);

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

            {/* The deck itself: a transparent iframe over the background. */}
            <iframe
                title="Nouveautés iGrowFast"
                src="/announcement-deck.html"
                className="absolute inset-0 h-full w-full border-0"
                style={{ background: 'transparent' }}
            />
        </div>
    );
}
