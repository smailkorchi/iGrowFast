import { AlertTriangle, Loader2 } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

type ConfirmTone = 'danger' | 'warning' | 'info';

type ConfirmDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kicker?: string;
    title: string;
    description?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
    loading?: boolean;
    onConfirm: () => void;
};

const TONE: Record<ConfirmTone, { dot: string; stripe: string; bg: string }> = {
    danger: {
        dot: 'bg-ant-rose',
        stripe: 'bg-ant-rose hover:bg-ant-rose/90',
        bg: 'bg-ant-rose hover:bg-ant-rose/90',
    },
    warning: {
        dot: 'bg-ant-orange',
        stripe: 'bg-ant-orange hover:bg-ant-orange/90',
        bg: 'bg-ant-orange hover:bg-ant-orange/90',
    },
    info: {
        dot: 'bg-ant-ink',
        stripe: 'bg-ant-ink hover:bg-ant-ink/90',
        bg: 'bg-ant-ink hover:bg-ant-ink/90',
    },
};

export function ConfirmDialog({
    open,
    onOpenChange,
    kicker,
    title,
    description,
    confirmLabel = 'Supprimer',
    cancelLabel = 'Annuler',
    tone = 'danger',
    loading = false,
    onConfirm,
}: ConfirmDialogProps) {
    const palette = TONE[tone];
    const resolvedKicker =
        kicker ??
        (tone === 'danger' ? 'Suppression définitive' : tone === 'warning' ? 'Confirmation requise' : 'Action à confirmer');

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="rounded-2xl border border-ant-line bg-ant-paper">
                <AlertDialogHeader>
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className={cn('h-1.5 w-1.5 rounded-full', palette.dot)} />
                        {resolvedKicker}
                    </div>
                    <AlertDialogTitle className="font-display text-[18px] font-semibold text-ant-ink flex items-center gap-2">
                        {tone === 'danger' && <AlertTriangle className="w-5 h-5 text-ant-rose" strokeWidth={1.75} />}
                        {title}
                    </AlertDialogTitle>
                    {description ? (
                        <AlertDialogDescription className="font-serif italic text-[12px] text-ant-mid">
                            {description}
                        </AlertDialogDescription>
                    ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel
                        disabled={loading}
                        className="h-9 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink"
                    >
                        {cancelLabel}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={loading}
                        onClick={(e) => {
                            e.preventDefault();
                            onConfirm();
                        }}
                        className={cn(
                            'h-9 rounded-full text-[12px] font-semibold text-white transition-colors',
                            palette.bg,
                        )}
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                        ) : (
                            confirmLabel
                        )}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
