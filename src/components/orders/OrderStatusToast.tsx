import { Package, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DynamicIcon } from '@/lib/renderReactIcon';

export type OrderStatusToastPayload = {
    orderId: string;
    orderName: string | null;
    trackingCode: string | null;
    providerLogo: string | null;
    providerName: string | null;
    statusLabel: string | null;
    statusColor: string | null;
    /** Master status icon (resolved by the caller). */
    statusIcon?: string | null;
    statusCategory?: string | null;
};

type RenderArgs = OrderStatusToastPayload & {
    toastId: string | number;
    onOpen: () => void;
};

function StatusToastCard({
    orderName,
    trackingCode,
    providerLogo,
    providerName,
    statusLabel,
    statusColor,
    statusIcon,
    onOpen,
    toastId,
}: RenderArgs) {
    const pillColor = statusColor || '#94a3b8';

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => {
                toast.dismiss(toastId);
                onOpen();
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toast.dismiss(toastId);
                    onOpen();
                }
            }}
            className={cn(
                'group w-[360px] cursor-pointer rounded-2xl border border-ant-line bg-ant-paper p-3',
                'shadow-[0_24px_60px_-24px_rgba(20,20,19,0.22)] transition-all',
                'hover:border-ant-ink/25 hover:shadow-[0_28px_72px_-24px_rgba(20,20,19,0.28)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ant-ink/40'
            )}
        >
            <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                    <div className="h-10 w-10 rounded-xl border border-ant-line bg-white flex items-center justify-center overflow-hidden">
                        {providerLogo ? (
                            <img
                                src={providerLogo}
                                alt={providerName || 'provider'}
                                className="h-full w-full object-contain p-1"
                            />
                        ) : (
                            <Package className="h-5 w-5 text-ant-mid" />
                        )}
                    </div>
                    <span
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ant-paper"
                        style={{ backgroundColor: pillColor }}
                    />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="font-display text-[13px] font-semibold leading-tight text-ant-ink truncate">
                        {orderName || 'Commande'}
                    </div>
                    {trackingCode && (
                        <div className="mt-0.5 font-mono text-[11px] leading-tight text-ant-mid truncate">
                            {trackingCode}
                        </div>
                    )}
                </div>

                <div className="shrink-0">
                    <span
                        className="inline-flex max-w-[140px] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold truncate"
                        style={{
                            borderColor: `${pillColor}40`,
                            backgroundColor: `${pillColor}14`,
                            color: pillColor,
                        }}
                        title={statusLabel || ''}
                    >
                        {statusIcon && <DynamicIcon name={statusIcon} className="w-3 h-3 shrink-0" />}
                        <span className="truncate">{statusLabel || 'Mise à jour'}</span>
                    </span>
                </div>

                {/* Dismiss WITHOUT opening — the whole card is the open button, so
                    the X must stop both click and keydown from bubbling. In-flow
                    (not absolute): the sonner wrapper clips negative offsets. */}
                <button
                    type="button"
                    aria-label="Fermer"
                    onClick={(e) => {
                        e.stopPropagation();
                        toast.dismiss(toastId);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ant-mid transition-colors hover:bg-ant-ink/10 hover:text-ant-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ant-ink/40"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-ant-line/60 pt-2">
                <span className="font-serif italic text-[11px] text-ant-mid">
                    {providerName || 'Transporteur'}
                </span>
                <span className="text-[11px] font-semibold text-ant-ink/70 group-hover:text-ant-ink transition-colors">
                    Ouvrir →
                </span>
            </div>
        </div>
    );
}

/**
 * Show a notification-style toast when an order's package status changes.
 * Top-right placement, ~7s duration. Click anywhere on the card opens the
 * order preview modal via the supplied callback.
 */
export function showOrderStatusToast(payload: OrderStatusToastPayload, onOpen: () => void) {
    toast.custom(
        (id) => (
            <StatusToastCard {...payload} toastId={id} onOpen={onOpen} />
        ),
        {
            position: 'top-right',
            duration: 7000,
            // Strip sonner's wrapper completely. `unstyled` removes built-in defaults but
            // does NOT override the global `toastOptions.classNames.toast` set in
            // components/ui/sonner.tsx (rounded-2xl + border + bg + shadow + padding) —
            // those still bleed behind the card. Override them per-toast.
            unstyled: true,
            classNames: {
                toast: '!bg-transparent !border-0 !shadow-none !p-0 !rounded-none !gap-0',
            },
        }
    );
}
