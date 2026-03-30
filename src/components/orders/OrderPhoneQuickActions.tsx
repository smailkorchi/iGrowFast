import { Phone, MessageSquare } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function telHref(phone: string) {
    const t = phone.trim().replace(/\s/g, '');
    return t ? `tel:${t}` : '#';
}

function smsHref(phone: string) {
    const t = phone.trim().replace(/\s/g, '');
    return t ? `sms:${t}` : '#';
}

function waHref(phone: string) {
    const d = phone.replace(/\D/g, '');
    return d ? `https://wa.me/${d}` : '#';
}

function useContactLinks(phone: string | null | undefined) {
    const raw = (phone || '').trim();
    if (!raw) return null;
    return {
        raw,
        tel: telHref(raw),
        sms: smsHref(raw),
        wa: waHref(raw),
        hasWa: /\d/.test(raw),
    };
}

function ContactChannelItems({ tel, sms, wa, hasWa }: { tel: string; sms: string; wa: string; hasWa: boolean }) {
    return (
        <>
            <DropdownMenuItem asChild className="rounded-lg cursor-pointer gap-2 font-bold text-sm">
                <a href={tel} className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
                    <Phone className="h-4 w-4 shrink-0" />
                    Phone call
                </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="rounded-lg cursor-pointer gap-2 font-bold text-sm">
                <a href={sms} className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    SMS
                </a>
            </DropdownMenuItem>
            {hasWa ? (
                <DropdownMenuItem asChild className="rounded-lg cursor-pointer gap-2 font-bold text-sm">
                    <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2"
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <FaWhatsapp className="h-4 w-4 shrink-0 text-[#25D366]" />
                        WhatsApp
                    </a>
                </DropdownMenuItem>
            ) : (
                <DropdownMenuItem disabled className="rounded-lg font-bold text-sm opacity-50">
                    <FaWhatsapp className="h-4 w-4 shrink-0 text-[#25D366]" />
                    WhatsApp
                </DropdownMenuItem>
            )}
        </>
    );
}

const contentClass =
    'min-w-[168px] rounded-xl border border-brand-navy/10 p-1 shadow-xl z-50 bg-popover text-popover-foreground';

type OrderPhoneContactDropdownProps = {
    phone: string | null | undefined;
    className?: string;
    variant?: 'icon' | 'contact';
    align?: 'start' | 'center' | 'end';
};

/** Standalone dropdown: icon (e.g. next to view) or labeled Contact (card footer). */
export function OrderPhoneContactDropdown({
    phone,
    className,
    variant = 'icon',
    align = 'end',
}: OrderPhoneContactDropdownProps) {
    const links = useContactLinks(phone);
    if (!links) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {variant === 'contact' ? (
                    <button
                        type="button"
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-navy/[0.05] hover:bg-brand-navy text-brand-navy/50 hover:text-white text-[11px] font-bold transition-all duration-200 shrink-0',
                            className
                        )}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Phone className="w-3.5 h-3.5" />
                        Contact
                    </button>
                ) : (
                    <button
                        type="button"
                        className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5 transition-colors shrink-0',
                            className
                        )}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Contact options"
                    >
                        <Phone className="w-4 h-4" />
                    </button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align={align}
                className={contentClass}
                onClick={(e) => e.stopPropagation()}
            >
                <ContactChannelItems tel={links.tel} sms={links.sms} wa={links.wa} hasWa={links.hasWa} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** Nested "Contact → call / SMS / WhatsApp" inside an existing DropdownMenu (overflow menu). */
export function OrderContactSubmenu({ phone }: { phone: string | null | undefined }) {
    const links = useContactLinks(phone);
    if (!links) return null;

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger
                className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold flex items-center outline-none data-[state=open]:bg-brand-navy/[0.06] focus:bg-brand-navy/[0.06]"
                onClick={(e) => e.stopPropagation()}
            >
                <Phone className="w-3.5 h-3.5" />
                Contact
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
                className={cn(contentClass, 'p-1.5')}
                onClick={(e) => e.stopPropagation()}
            >
                <ContactChannelItems tel={links.tel} sms={links.sms} wa={links.wa} hasWa={links.hasWa} />
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

/** Compact icon dropdown (form field, order preview header). */
export function OrderPhoneQuickActions({ phone, className }: { phone: string | null | undefined; className?: string }) {
    const links = useContactLinks(phone);
    if (!links) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-brand-navy/35 hover:text-brand-navy hover:bg-brand-navy/10',
                        className
                    )}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Contact options"
                >
                    <Phone className="h-3.5 w-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className={contentClass}
                onClick={(e) => e.stopPropagation()}
            >
                <ContactChannelItems tel={links.tel} sms={links.sms} wa={links.wa} hasWa={links.hasWa} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
