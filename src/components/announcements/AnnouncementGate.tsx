import { useEffect, useState } from 'react';
import { AnnouncementModal } from '@/components/announcements/AnnouncementModal';
import { ACTIVE_ANNOUNCEMENT } from '@/components/announcements/activeAnnouncement';

const PENDING_KEY = 'igf_pending_announcement';

/**
 * Renders the active announcement overlay ON TOP of the dashboard, once per login.
 *
 * Flow: the Auth page arms a one-shot sessionStorage flag on every successful login. This gate
 * is mounted inside ProtectedRoute (so it sits over EVERY role's dashboard, after redirect and
 * after the passkey nudge). On mount it consumes the flag and shows the overlay; acknowledging
 * clears the flag so it doesn't reappear until the next login — and never appears at all once
 * ACTIVE_ANNOUNCEMENT is retired (active=false / null).
 */
export function AnnouncementGate() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!ACTIVE_ANNOUNCEMENT?.active) return;
        let pending: string | null = null;
        try { pending = sessionStorage.getItem(PENDING_KEY); } catch { /* storage unavailable */ }
        if (pending === ACTIVE_ANNOUNCEMENT.id) setOpen(true);
    }, []);

    const acknowledge = () => {
        try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        setOpen(false);
    };

    if (!ACTIVE_ANNOUNCEMENT?.active) return null;

    return (
        <AnnouncementModal
            open={open}
            onAcknowledge={acknowledge}
            eyebrow={ACTIVE_ANNOUNCEMENT.eyebrow}
            title={ACTIVE_ANNOUNCEMENT.title}
            ctaLabel={ACTIVE_ANNOUNCEMENT.ctaLabel}
            withBackground
        >
            {ACTIVE_ANNOUNCEMENT.body}
        </AnnouncementModal>
    );
}
