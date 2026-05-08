/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
                const result = await subscribeToPush(userId, businessId);
                if (result.ok) {
                    toast({
                        title: 'Notifications activées',
                        description: 'Vous serez averti dès qu\'un nouveau colis vous sera attribué.',
                    });
                } else {
                    toast({
                        title: 'Notifications activées',
                        description: 'Les alertes en temps réel sont prêtes.',
                    });
                }
                markPermissionDialogDismissed();
                onClose();
                return;
            }

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
                    'p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:max-w-[460px] sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}
            >
                {/* Mobile drag handle */}
                <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                    <div className="w-10 h-1 rounded-full bg-ant-line" />
                </div>

                {/* Top stripe */}
                <div className="h-[3px] w-full bg-ant-orange shrink-0" />

                {/* Close (desktop) */}
                <button
                    type="button"
                    onClick={handleLater}
                    className="hidden sm:flex absolute top-5 right-5 w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light items-center justify-center text-ant-ink transition-colors z-10"
                    aria-label="Fermer"
                >
                    <X className="w-3.5 h-3.5" />
                </button>

                {iosNotInstalled ? (
                    <IosInstallScreen onClose={handleLater} />
                ) : unsupported ? (
                    <UnsupportedScreen onClose={handleLater} />
                ) : (
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
        <div className="px-6 pt-6 pb-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <motion.div
                className="flex justify-center mb-5"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
                <div className="relative">
                    <motion.div
                        className="absolute inset-0 bg-ant-orange/25 blur-2xl rounded-full"
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <div className="relative w-16 h-16 rounded-2xl bg-ant-ink flex items-center justify-center">
                        <Bell className="w-7 h-7 text-ant-light" strokeWidth={1.75} />
                    </div>
                    <motion.span
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ant-orange ring-2 ring-ant-paper"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
                    />
                </div>
            </motion.div>

            <div className="flex items-center justify-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                    Notifications · Temps réel
                </span>
            </div>
            <DialogTitle className="font-display text-center text-[20px] leading-[1.1] text-ant-ink tracking-[-0.01em]">
                Restez informé en temps réel
            </DialogTitle>
            <DialogDescription className="font-serif italic text-center text-[12px] text-ant-mid mt-2 max-w-sm mx-auto">
                Recevez une notification dès qu'un nouveau colis vous est attribué — même si l'application est en arrière-plan.
            </DialogDescription>

            {/* Benefits */}
            <div className="mt-5 space-y-2">
                <Benefit text="Alerte instantanée pour chaque nouveau bon de livraison" />
                <Benefit text="Fonctionne même quand votre téléphone est verrouillé" />
                <Benefit text="Vous pouvez la désactiver à tout moment" />
            </div>

            {/* Actions */}
            <button
                type="button"
                onClick={onEnable}
                disabled={busy}
                className="w-full mt-6 h-12 rounded-full bg-ant-ink text-ant-light font-medium text-[13px] flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 active:scale-[0.98] transition-all shadow-[0_12px_30px_-12px_rgba(20,20,19,0.5)]"
            >
                {busy ? (
                    <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Activation…
                    </>
                ) : (
                    <>
                        <Bell className="w-3.5 h-3.5" />
                        Activer les notifications
                    </>
                )}
            </button>

            <button
                type="button"
                onClick={onLater}
                disabled={busy}
                className="w-full mt-2 h-10 rounded-full text-[12px] text-ant-mid hover:text-ant-ink transition-colors"
            >
                Plus tard
            </button>
        </div>
    );
}

// ─── iOS install screen ─────────────────────────────────────────────────────

function IosInstallScreen({ onClose }: { onClose: () => void }) {
    return (
        <div className="px-6 pt-6 pb-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <motion.div
                className="flex justify-center mb-5"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
                <div className="relative">
                    <div className="absolute inset-0 bg-ant-orange/20 blur-2xl rounded-full" />
                    <div className="relative w-16 h-16 rounded-2xl bg-ant-ink flex items-center justify-center overflow-hidden p-2.5">
                        <img
                            src="/Logo/iGrowFast Icon Transparent.png"
                            alt="iGrowFast"
                            className="w-full h-full object-contain"
                        />
                    </div>
                </div>
            </motion.div>

            <div className="flex items-center justify-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                    Installation · iOS
                </span>
            </div>
            <DialogTitle className="font-display text-center text-[20px] leading-[1.1] text-ant-ink tracking-[-0.01em]">
                Installer iGrowFast
            </DialogTitle>
            <DialogDescription className="font-serif italic text-center text-[12px] text-ant-mid mt-2 max-w-sm mx-auto">
                Pour recevoir les notifications sur iPhone, ajoutez iGrowFast à votre écran d'accueil.
            </DialogDescription>

            {/* Numbered steps */}
            <div className="mt-5 space-y-2">
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
                    title="Ouvrez iGrowFast"
                    sub="Depuis l’icône sur votre écran d’accueil"
                />
            </div>

            <button
                type="button"
                onClick={onClose}
                className="w-full mt-6 h-12 rounded-full bg-ant-ink text-ant-light font-medium text-[13px] hover:bg-ant-ink/95 active:scale-[0.98] transition-all shadow-[0_12px_30px_-12px_rgba(20,20,19,0.5)]"
            >
                Compris
            </button>
        </div>
    );
}

// ─── Unsupported screen ─────────────────────────────────────────────────────

function UnsupportedScreen({ onClose }: { onClose: () => void }) {
    return (
        <div className="px-6 pt-6 pb-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="flex justify-center mb-5">
                <div className="w-16 h-16 rounded-2xl bg-ant-light border border-ant-line flex items-center justify-center">
                    <Bell className="w-7 h-7 text-ant-mid" strokeWidth={1.75} />
                </div>
            </div>
            <div className="flex items-center justify-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                    Compatibilité
                </span>
            </div>
            <DialogTitle className="font-display text-center text-[18px] leading-[1.1] text-ant-ink tracking-[-0.01em]">
                Notifications non prises en charge
            </DialogTitle>
            <DialogDescription className="font-serif italic text-center text-[12px] text-ant-mid mt-2 max-w-sm mx-auto">
                Votre navigateur ne prend pas en charge les notifications. Vous recevrez toujours les alertes en temps réel dans l'application quand elle est ouverte.
            </DialogDescription>
            <button
                type="button"
                onClick={onClose}
                className="w-full mt-6 h-12 rounded-full bg-ant-ink text-ant-light font-medium text-[13px] hover:bg-ant-ink/95 active:scale-[0.98] transition-all shadow-[0_12px_30px_-12px_rgba(20,20,19,0.5)]"
            >
                Compris
            </button>
        </div>
    );
}

// ─── Reusable bits ───────────────────────────────────────────────────────────

function Benefit({ text }: { text: string }) {
    return (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-ant-light border border-ant-line">
            <div className="shrink-0 w-5 h-5 rounded-full bg-ant-green/15 flex items-center justify-center mt-0.5">
                <CheckCircle2 className="w-3 h-3 text-ant-green" strokeWidth={2.25} />
            </div>
            <p className="text-[12px] font-medium text-ant-ink leading-snug">{text}</p>
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
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-ant-light border border-ant-line">
            <div className="shrink-0 w-8 h-8 rounded-full bg-ant-ink text-ant-light flex items-center justify-center">
                <span className="font-display text-[12px]">{number}</span>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-ant-ink truncate">{title}</p>
                <p className="font-serif italic text-[11px] text-ant-mid truncate mt-0.5">{sub}</p>
            </div>
            <Icon className="w-4 h-4 text-ant-mid shrink-0" />
        </div>
    );
}
