/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * NotificationPermissionDialog
 *
 * Shown once per session after a courier logs in. Explains the benefit
 * of enabling push notifications and handles three platform paths:
 *
 *   1. Android Chrome / desktop browsers → direct permission prompt
 *   2. iOS Safari in standalone PWA mode → direct permission prompt
 *   3. iOS Safari NOT installed → instructions to add to Home Screen
 *      (the ONLY way Web Push works on iPhones)
 *
 * UX priorities:
 *   - Mobile-first bottom sheet on small screens, centered card on desktop
 *   - Emerald brand glow on the hero icon, matching the rest of the app
 *   - Clear, non-technical copy in French (app locale)
 *   - "Plus tard" dismisses the dialog for the rest of the session —
 *     we never nag the user repeatedly on every page navigation
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Bell, Share, Plus, CheckCircle2, Smartphone, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    requestPermission,
    subscribeToPush,
    supportsForegroundNotifications,
    isIOS,
    isStandalonePWA,
    markPermissionDialogDismissed,
} from '@/lib/notifications';
import { useToast } from '@/hooks/use-toast';

type Props = {
    open: boolean;
    onClose: () => void;
    userId: string | null;
    businessId: string | null;
};

export default function NotificationPermissionDialog({ open, onClose, userId, businessId }: Props) {
    const { toast } = useToast();
    const [busy, setBusy] = useState(false);

    // Which screen to show?
    const iosNotInstalled = isIOS() && !isStandalonePWA();
    const unsupported = !supportsForegroundNotifications() && !iosNotInstalled;

    const handleEnable = async () => {
        if (!userId) return;
        setBusy(true);
        try {
            const state = await requestPermission();

            if (state === 'denied') {
                toast({
                    title: 'Notifications refusées',
                    description: 'Vous pouvez les réactiver dans les paramètres de votre navigateur.',
                    variant: 'destructive',
                });
                markPermissionDialogDismissed();
                onClose();
                return;
            }

            if (state === 'granted') {
                // Persist a push subscription so background notifications work
                const result = await subscribeToPush(userId, businessId);
                if (result.ok) {
                    toast({
                        title: 'Notifications activées',
                        description: 'Vous serez averti dès qu\'un nouveau colis vous sera attribué.',
                    });
                } else {
                    // Permission granted but push subscription failed — foreground
                    // notifications will still work while the app is open.
                    toast({
                        title: 'Notifications activées',
                        description: 'Les alertes en temps réel sont prêtes.',
                    });
                }
                markPermissionDialogDismissed();
                onClose();
                return;
            }

            // 'default' — user dismissed the native prompt without choosing
            toast({
                title: 'En attente',
                description: 'Touchez le bouton pour réessayer.',
            });
        } catch (err: any) {
            console.error('[notif-dialog] enable failed', err);
            toast({
                title: 'Erreur',
                description: err?.message || 'Impossible d\'activer les notifications.',
                variant: 'destructive',
            });
        } finally {
            setBusy(false);
        }
    };

    const handleLater = () => {
        markPermissionDialogDismissed();
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && handleLater()}>
            <DialogContent
                className={cn(
                    'p-0 border-none bg-brand-white overflow-hidden flex flex-col gap-0',
                    'sm:max-w-[440px] sm:rounded-[32px]',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!rounded-t-[32px] max-sm:!rounded-b-none'
                )}
            >
                {/* Mobile drag handle */}
                <div className="sm:hidden flex justify-center pt-3 pb-1">
                    <div className="w-12 h-1.5 rounded-full bg-brand-navy/10" />
                </div>

                {/* Close (desktop only — mobile uses swipe / backdrop) */}
                <button
                    type="button"
                    onClick={handleLater}
                    className="hidden sm:flex absolute top-5 right-5 w-9 h-9 rounded-full hover:bg-brand-navy/5 items-center justify-center text-brand-navy/40 hover:text-brand-navy/70 transition z-10"
                    aria-label="Fermer"
                >
                    <X className="w-4 h-4" />
                </button>

                {iosNotInstalled ? (
                    // ─── iOS: instruct to add to Home Screen ──────────────
                    <IosInstallScreen onClose={handleLater} />
                ) : unsupported ? (
                    // ─── Unsupported platform ─────────────────────────────
                    <UnsupportedScreen onClose={handleLater} />
                ) : (
                    // ─── Standard permission prompt ───────────────────────
                    <StandardScreen busy={busy} onEnable={handleEnable} onLater={handleLater} />
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─── Standard screen ─────────────────────────────────────────────────────────

function StandardScreen({
    busy,
    onEnable,
    onLater,
}: {
    busy: boolean;
    onEnable: () => void;
    onLater: () => void;
}) {
    return (
        <div className="px-6 pt-4 sm:pt-8 pb-6 sm:pb-8">
            <motion.div
                className="flex justify-center mb-6"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            >
                <div className="relative">
                    <motion.div
                        className="absolute inset-0 bg-emerald-300/40 blur-2xl rounded-full"
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <div className="relative w-20 h-20 rounded-[22px] bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/40">
                        <Bell className="w-9 h-9 text-white" strokeWidth={2.5} />
                    </div>
                    {/* Pulsing notification badge */}
                    <motion.div
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 ring-4 ring-brand-white flex items-center justify-center"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
                    >
                        <span className="text-[9px] font-black text-white">!</span>
                    </motion.div>
                </div>
            </motion.div>

            <DialogTitle className="text-center text-xl sm:text-2xl font-black text-brand-navy tracking-tight">
                Restez informé en temps réel
            </DialogTitle>
            <DialogDescription className="text-center text-xs sm:text-sm font-semibold text-brand-navy/55 mt-2 px-2">
                Recevez une notification dès qu'un nouveau colis vous est attribué — même si l'application est en arrière-plan.
            </DialogDescription>

            {/* Benefits */}
            <div className="mt-5 space-y-2.5">
                <Benefit text="Alerte instantanée pour chaque nouveau bon de livraison" />
                <Benefit text="Fonctionne même quand votre téléphone est verrouillé" />
                <Benefit text="Vous pouvez la désactiver à tout moment" />
            </div>

            {/* Actions */}
            <Button
                onClick={onEnable}
                disabled={busy}
                className="w-full mt-6 h-14 rounded-2xl font-black text-sm bg-brand-navy hover:bg-brand-navy/90 text-white shadow-xl shadow-brand-navy/25 disabled:opacity-60"
            >
                {busy ? (
                    <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Activation…
                    </>
                ) : (
                    <>
                        <Bell className="w-4 h-4 mr-2" />
                        Activer les notifications
                    </>
                )}
            </Button>

            <Button
                variant="ghost"
                onClick={onLater}
                disabled={busy}
                className="w-full mt-1 h-11 rounded-2xl font-semibold text-xs text-brand-navy/50 hover:bg-transparent hover:text-brand-navy/70"
            >
                Plus tard
            </Button>
        </div>
    );
}

// ─── iOS install screen ─────────────────────────────────────────────────────

function IosInstallScreen({ onClose }: { onClose: () => void }) {
    return (
        <div className="px-6 pt-4 sm:pt-8 pb-6 sm:pb-8">
            <motion.div
                className="flex justify-center mb-5"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            >
                <div className="relative">
                    <div className="absolute inset-0 bg-blue-300/40 blur-2xl rounded-full" />
                    <div className="relative w-20 h-20 rounded-[22px] bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/40">
                        <Smartphone className="w-9 h-9 text-white" strokeWidth={2.5} />
                    </div>
                </div>
            </motion.div>

            <DialogTitle className="text-center text-xl sm:text-2xl font-black text-brand-navy tracking-tight">
                Installer DigiCom
            </DialogTitle>
            <DialogDescription className="text-center text-xs sm:text-sm font-semibold text-brand-navy/55 mt-2 px-2">
                Pour recevoir les notifications sur iPhone, ajoutez DigiCom à votre écran d'accueil.
            </DialogDescription>

            {/* Numbered steps */}
            <div className="mt-6 space-y-3">
                <IosStep
                    number={1}
                    icon={Share}
                    title="Touchez Partager"
                    sub="Le bouton en bas de Safari"
                />
                <IosStep
                    number={2}
                    icon={Plus}
                    title='Choisissez "Sur l’écran d’accueil"'
                    sub="Dans le menu qui apparaît"
                />
                <IosStep
                    number={3}
                    icon={Smartphone}
                    title="Ouvrez DigiCom"
                    sub="Depuis l’icône sur votre écran d’accueil"
                />
            </div>

            <Button
                onClick={onClose}
                className="w-full mt-6 h-14 rounded-2xl font-black text-sm bg-brand-navy hover:bg-brand-navy/90 text-white shadow-xl shadow-brand-navy/25"
            >
                Compris
            </Button>
        </div>
    );
}

// ─── Unsupported screen ─────────────────────────────────────────────────────

function UnsupportedScreen({ onClose }: { onClose: () => void }) {
    return (
        <div className="px-6 pt-4 sm:pt-8 pb-6 sm:pb-8">
            <div className="flex justify-center mb-5">
                <div className="w-20 h-20 rounded-[22px] bg-brand-navy/10 flex items-center justify-center">
                    <Bell className="w-9 h-9 text-brand-navy/40" />
                </div>
            </div>
            <DialogTitle className="text-center text-xl font-black text-brand-navy tracking-tight">
                Notifications non prises en charge
            </DialogTitle>
            <DialogDescription className="text-center text-xs font-semibold text-brand-navy/55 mt-2 px-2">
                Votre navigateur ne prend pas en charge les notifications. Vous recevrez toujours les alertes en temps réel dans l'application quand elle est ouverte.
            </DialogDescription>
            <Button
                onClick={onClose}
                className="w-full mt-6 h-12 rounded-2xl font-bold text-sm bg-brand-navy hover:bg-brand-navy/90 text-white"
            >
                Compris
            </Button>
        </div>
    );
}

// ─── Reusable bits ───────────────────────────────────────────────────────────

function Benefit({ text }: { text: string }) {
    return (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-navy/[0.03] border border-brand-navy/5">
            <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center mt-0.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" strokeWidth={3} />
            </div>
            <p className="text-[11px] sm:text-xs font-semibold text-brand-navy/70 leading-snug">{text}</p>
        </div>
    );
}

function IosStep({
    number,
    icon: Icon,
    title,
    sub,
}: {
    number: number;
    icon: typeof Share;
    title: string;
    sub: string;
}) {
    return (
        <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/5">
            <div className="shrink-0 w-8 h-8 rounded-xl bg-brand-navy text-white flex items-center justify-center">
                <span className="text-xs font-black">{number}</span>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-brand-navy truncate">{title}</p>
                <p className="text-[10px] font-semibold text-brand-navy/45 truncate mt-0.5">{sub}</p>
            </div>
            <Icon className="w-4 h-4 text-brand-navy/35 shrink-0" />
        </div>
    );
}
