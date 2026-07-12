import { ReactNode } from 'react';

export interface AppAnnouncement {
    /** Stable id — bump when you publish a NEW announcement. */
    id: string;
    /** Master on/off switch. Set to false (or set ACTIVE_ANNOUNCEMENT = null) to stop showing it. */
    active: boolean;
    eyebrow: string;
    title: string;
    ctaLabel?: string;
    /** Optional custom mark for the header badge (replaces the megaphone). */
    icon?: ReactNode;
    body: ReactNode;
}

/** Official Supabase bolt mark, inlined so the announcement has no asset dependency. */
function SupabaseMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 109 113" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
            <path
                d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
                fill="url(#sb-ann-grad-a)"
            />
            <path
                d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
                fill="url(#sb-ann-grad-b)"
                fillOpacity="0.2"
            />
            <path
                d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z"
                fill="#3ECF8E"
            />
            <defs>
                <linearGradient id="sb-ann-grad-a" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#249361" />
                    <stop offset="1" stopColor="#3ECF8E" />
                </linearGradient>
                <linearGradient id="sb-ann-grad-b" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse">
                    <stop />
                    <stop offset="1" stopOpacity="0" />
                </linearGradient>
            </defs>
        </svg>
    );
}

/**
 * The currently-published announcement, shown to EVERY user once per login (after the
 * passkey nudge, before the dashboard). To retire it: set `active: false` and redeploy.
 * To announce something new: replace the fields + bump `id`.
 */
export const ACTIVE_ANNOUNCEMENT: AppAnnouncement | null = {
    id: 'supabase-selfhost-migration-2026-07',
    active: true,
    eyebrow: 'Annonce · Infrastructure',
    title: 'Migration vers notre propre serveur',
    ctaLabel: "J'ai compris",
    icon: <SupabaseMark className="h-5 w-5" />,
    body: (
        <>
            <p>
                Nous avons migré la plateforme du <strong>Supabase managé (cloud)</strong> vers notre
                <strong> propre serveur Supabase auto-hébergé</strong>, entièrement contrôlé par notre équipe.
            </p>
            <p>
                Résultat attendu : des <strong>opérations plus rapides</strong> partout dans l'application.
                <strong> Ressentez-vous la différence</strong> de vitesse et de fluidité au quotidien ?
                Faites-le-nous savoir.
            </p>
            <p className="text-white/85">
                Si vous constatez le <strong>moindre bug</strong>, une erreur ou un problème de quelque nature que ce
                soit — merci de le <strong>signaler immédiatement à l'équipe de développement</strong>.
            </p>
        </>
    ),
};
