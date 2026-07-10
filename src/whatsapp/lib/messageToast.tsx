// WhatsApp inbound-message toast — visual clone of the order-status toast card
// (src/components/orders/OrderStatusToast.tsx): same ant-* palette, geometry
// and sonner toast.custom contract (top-right, ~7s, unstyled + per-toast
// classNames override). Rendered app-wide via the sonner <Sonner/> in App.tsx,
// NOT the WA module's own Toaster. Driven by lib/messageNotify.ts.

import { MessageCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// WhatsApp greens: the dot reads "new message", the darker tone keeps the
// instance pill legible on the light card.
const WA_GREEN = '#25d366'
const WA_GREEN_DARK = '#128c7e'

export type WaMessageToastPayload = {
    conversationId: string
    /** Resolved contact label (book name > push name > formatted phone). */
    name: string
    /** Kind-aware FR preview line (group sender prefix already applied). */
    preview: string
    /** INSTANCE profile picture (the receiving number, owner ruling) — not the peer's. */
    avatarUrl: string | null
    /** Instance display name (resolved by the caller; falls back to 'WhatsApp'). */
    instanceName: string
}

type RenderArgs = WaMessageToastPayload & {
    toastId: string | number
    onOpen: () => void
}

function WaMessageToastCard({ name, preview, avatarUrl, instanceName, toastId, onOpen }: RenderArgs) {
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
                        {avatarUrl ? (
                            <img
                                src={avatarUrl}
                                alt={name}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <MessageCircle className="h-5 w-5 text-ant-mid" />
                        )}
                    </div>
                    <span
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ant-paper"
                        style={{ backgroundColor: WA_GREEN }}
                    />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="font-display text-[13px] font-semibold leading-tight text-ant-ink truncate">
                        {name}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-tight text-ant-mid truncate">
                        {preview}
                    </div>
                </div>

                <div className="shrink-0">
                    <span
                        className="inline-flex max-w-[140px] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold truncate"
                        style={{
                            borderColor: `${WA_GREEN_DARK}40`,
                            backgroundColor: `${WA_GREEN_DARK}14`,
                            color: WA_GREEN_DARK,
                        }}
                        title={instanceName}
                    >
                        <span className="truncate">{instanceName}</span>
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
                <span className="font-serif italic text-[11px] text-ant-mid">WhatsApp</span>
                <span className="text-[11px] font-semibold text-ant-ink/70 group-hover:text-ant-ink transition-colors">
                    Ouvrir →
                </span>
            </div>
        </div>
    );
}

/**
 * Show a notification-style toast for a new inbound WhatsApp message.
 * Top-right placement, ~7s duration — the explicit duration is REQUIRED (the
 * global <Sonner duration={500}/> default would kill it in half a second).
 * Click anywhere on the card opens the conversation via the supplied callback;
 * the X dismisses without opening.
 */
export function showWaMessageToast(payload: WaMessageToastPayload, onOpen: () => void) {
    toast.custom(
        (id) => (
            <WaMessageToastCard {...payload} toastId={id} onOpen={onOpen} />
        ),
        {
            position: 'top-right',
            duration: 7000,
            // Strip sonner's wrapper completely (same contract as OrderStatusToast):
            // `unstyled` removes built-in defaults but does NOT override the global
            // `toastOptions.classNames.toast` from components/ui/sonner.tsx — those
            // still bleed behind the card. Override them per-toast.
            unstyled: true,
            classNames: {
                toast: '!bg-transparent !border-0 !shadow-none !p-0 !rounded-none !gap-0',
            },
        }
    );
}
