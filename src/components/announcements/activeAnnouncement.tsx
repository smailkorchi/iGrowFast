import { ReactNode } from 'react';

export interface AppAnnouncement {
    /** Stable id — bump when you publish a NEW announcement. */
    id: string;
    /** Master on/off switch. Set to false (or set ACTIVE_ANNOUNCEMENT = null) to stop showing it. */
    active: boolean;
    eyebrow: string;
    title: string;
    ctaLabel?: string;
    body: ReactNode;
}

/**
 * The currently-published announcement, shown to EVERY user once per login (after the
 * passkey nudge, before the dashboard). To retire it: set `active: false` and redeploy.
 * To announce something new: replace the fields + bump `id`.
 */
export const ACTIVE_ANNOUNCEMENT: AppAnnouncement | null = {
    id: 'status-engine-overhaul-2026-06',
    active: true,
    eyebrow: 'Annonce · Mise à jour technique',
    title: 'Refonte du système de statuts',
    ctaLabel: "J'ai compris",
    body: (
        <>
            <p>
                Nous venons de déployer une <strong>refonte technique majeure du système de statuts</strong> sur
                l'ensemble de la plateforme — aussi bien les statuts de commande que les statuts de colis et de livraison.
            </p>
            <p>
                Jusqu'ici, ces statuts reposaient en partie sur des libellés en texte libre qui pouvaient diverger d'un
                module à l'autre. Désormais, tout s'appuie sur une <strong>source unique et centralisée</strong> — un
                statut maître accompagné d'indicateurs sémantiques. Les commandes, les livraisons, les paiements, les
                commissions et les statistiques lisent tous exactement la même référence.
            </p>
            <p>
                Concrètement : davantage de cohérence, plus aucune dérive de libellés, et un comportement des statuts
                entièrement maîtrisable depuis l'administration.
            </p>
            <p className="text-white/85">
                Cette migration a été testée et vérifiée, mais elle touche un composant sensible du système. Si vous
                constatez le <strong>moindre bug</strong>, une anomalie, un statut incorrect, un chiffre de
                livraison / paiement / commission qui paraît faux, ou tout comportement inhabituel — merci de le
                <strong> signaler immédiatement au département développement</strong>.
            </p>
        </>
    ),
};
