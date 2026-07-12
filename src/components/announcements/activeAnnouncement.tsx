export interface AppAnnouncement {
    /** Stable id — bump when you publish a NEW announcement so it re-shows once to every user. */
    id: string;
    /** Master on/off switch. Set to false (or ACTIVE_ANNOUNCEMENT = null) to stop showing it. */
    active: boolean;
}

/**
 * The currently-published announcement, shown to EVERY user once per login (after the passkey
 * nudge, before the dashboard). The content lives in the deck itself
 * (public/announcement-deck.html, rendered by AnnouncementDeck) — this config only gates it.
 *
 * To retire it: set `active: false` and redeploy.
 * To publish a new deck: rebuild announcement-deck.html and bump `id`.
 */
export const ACTIVE_ANNOUNCEMENT: AppAnnouncement | null = {
    id: 'whats-new-whatsapp-orders-2026-07',
    active: true,
};
