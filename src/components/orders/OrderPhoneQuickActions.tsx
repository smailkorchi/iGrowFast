import { Phone, MessageSquare } from 'lucide-react';
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

function useContactLinks(phone: string | null | undefined) {
    const raw = (phone || '').trim();
    if (!raw) return null;
    return {
        tel: telHref(raw),
        sms: smsHref(raw),
    };
}

function ContactChannelItems({
    tel,
    sms,
}: {
    tel: string;
    sms: string;
}) {
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
        </>
    );
}

const contentClass =
    'min-w-[168px] rounded-xl border border-ant-ink/10 p-1 shadow-xl z-50 bg-popover text-popover-foreground';

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
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ant-ink/[0.05] hover:bg-ant-ink text-ant-mid hover:text-white text-[11px] font-bold transition-all duration-200 shrink-0',
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
                            'w-8 h-8 rounded-lg flex items-center justify-center text-ant-mid hover:text-ant-ink hover:bg-ant-ink/5 transition-colors shrink-0',
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
                <ContactChannelItems tel={links.tel} sms={links.sms} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** Nested "Contact → call / SMS" inside an existing DropdownMenu (overflow menu). */
export function OrderContactSubmenu({ phone }: { phone: string | null | undefined }) {
    const links = useContactLinks(phone);
    if (!links) return null;

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger
                className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold flex items-center outline-none data-[state=open]:bg-ant-ink/[0.06] focus:bg-ant-ink/[0.06]"
                onClick={(e) => e.stopPropagation()}
            >
                <Phone className="w-3.5 h-3.5" />
                Contact
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
                className={cn(contentClass, 'p-1.5')}
                onClick={(e) => e.stopPropagation()}
            >
                <ContactChannelItems tel={links.tel} sms={links.sms} />
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
                        'h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-ant-ink/35 hover:text-ant-ink hover:bg-ant-ink/10',
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
                <ContactChannelItems tel={links.tel} sms={links.sms} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
