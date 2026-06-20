import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mail, User as UserIcon, X, Loader2, Server, ArrowDownToLine, ArrowUpFromLine, Inbox } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { EmailAccount, EmailAccountInput, EmailSecurity } from '@/lib/emailAccounts';

const SECURITY_OPTIONS: { value: EmailSecurity; label: string }[] = [
    { value: 'ssl', label: 'SSL / TLS' },
    { value: 'starttls', label: 'STARTTLS' },
    { value: 'none', label: 'None' },
];

// 'ssl' and 'tls' both mean implicit TLS; the UI exposes them as one "SSL / TLS"
// option. Map any stored value that isn't a distinct UI option onto 'ssl' so the
// Select never renders blank when editing an out-of-band 'tls' row.
const uiSecurity = (v?: EmailSecurity | null): EmailSecurity =>
    v === 'starttls' || v === 'none' ? v : 'ssl';

const makeSchema = (isEdit: boolean) =>
    z.object({
        name: z.string().trim().min(1, 'Required'),
        from_name: z.string().trim().optional(),
        email_address: z.string().trim().email('Enter a valid email'),
        username: z.string().trim().min(1, 'Required'),
        password: isEdit ? z.string().optional() : z.string().min(1, 'Required'),
        is_active: z.boolean(),
        smtp_host: z.string().trim().optional(),
        smtp_port: z.string().trim().optional(),
        smtp_security: z.enum(['ssl', 'tls', 'starttls', 'none']),
        imap_host: z.string().trim().optional(),
        imap_port: z.string().trim().optional(),
        imap_security: z.enum(['ssl', 'tls', 'starttls', 'none']),
        pop3_host: z.string().trim().optional(),
        pop3_port: z.string().trim().optional(),
        pop3_security: z.enum(['ssl', 'tls', 'starttls', 'none']),
    });

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

const inputClass =
    'w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all';

const labelClass = 'text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid';

interface EmailAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: EmailAccountInput) => void;
    initialData?: EmailAccount | null;
    loading?: boolean;
}

const EmailAccountModal = ({ isOpen, onClose, onSubmit, initialData, loading }: EmailAccountModalProps) => {
    const isEdit = !!initialData;

    const form = useForm<FormValues>({
        resolver: zodResolver(makeSchema(isEdit)),
        defaultValues: {
            name: '', from_name: '', email_address: '', username: '', password: '', is_active: true,
            smtp_host: '', smtp_port: '', smtp_security: 'ssl',
            imap_host: '', imap_port: '', imap_security: 'ssl',
            pop3_host: '', pop3_port: '', pop3_security: 'ssl',
        },
    });

    useEffect(() => {
        if (!isOpen) return;
        if (initialData) {
            form.reset({
                name: initialData.name ?? '',
                from_name: initialData.from_name ?? '',
                email_address: initialData.email_address ?? '',
                username: initialData.username ?? '',
                password: '',
                is_active: initialData.is_active,
                smtp_host: initialData.smtp_host ?? '',
                smtp_port: initialData.smtp_port != null ? String(initialData.smtp_port) : '',
                smtp_security: uiSecurity(initialData.smtp_security),
                imap_host: initialData.imap_host ?? '',
                imap_port: initialData.imap_port != null ? String(initialData.imap_port) : '',
                imap_security: uiSecurity(initialData.imap_security),
                pop3_host: initialData.pop3_host ?? '',
                pop3_port: initialData.pop3_port != null ? String(initialData.pop3_port) : '',
                pop3_security: uiSecurity(initialData.pop3_security),
            });
        } else {
            form.reset({
                name: '', from_name: '', email_address: '', username: '', password: '', is_active: true,
                smtp_host: '', smtp_port: '', smtp_security: 'ssl',
                imap_host: '', imap_port: '', imap_security: 'ssl',
                pop3_host: '', pop3_port: '', pop3_security: 'ssl',
            });
        }
    }, [isOpen, initialData]); // eslint-disable-line react-hooks/exhaustive-deps

    const toPort = (v?: string) => {
        const n = parseInt(String(v ?? '').trim(), 10);
        return Number.isFinite(n) ? n : null;
    };

    const handleSubmit = (v: FormValues) => {
        const payload: EmailAccountInput = {
            name: v.name.trim(),
            from_name: v.from_name?.trim() || null,
            email_address: v.email_address.trim(),
            username: v.username.trim(),
            is_active: v.is_active,
            smtp_host: v.smtp_host?.trim() || null,
            smtp_port: toPort(v.smtp_port),
            smtp_security: v.smtp_security,
            imap_host: v.imap_host?.trim() || null,
            imap_port: toPort(v.imap_port),
            imap_security: v.imap_host?.trim() ? v.imap_security : null,
            pop3_host: v.pop3_host?.trim() || null,
            pop3_port: toPort(v.pop3_port),
            pop3_security: v.pop3_host?.trim() ? v.pop3_security : null,
        };
        if (v.password && v.password.length > 0) payload.password = v.password;
        onSubmit(payload);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn(
                'max-w-xl p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                'sm:rounded-2xl',
                'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                'max-sm:!translate-x-0 max-sm:!translate-y-0',
                'max-sm:!w-full max-sm:!max-w-none',
                'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                '[&>button.absolute]:hidden',
            )}>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col h-full overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                        <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            SMTP · {isEdit ? 'Edit' : 'New'}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                        {isEdit ? 'Edit email account' : 'Add email account'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        Credentials are encrypted at rest and used by the app to send mail.
                                    </DialogDescription>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                    aria-label="Close"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                            {/* Identity */}
                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className={labelClass}>Account name</FormLabel>
                                        <FormControl>
                                            <input placeholder="Hostinger Support" {...field} className={inputClass} />
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="from_name" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className={labelClass}>From name</FormLabel>
                                        <FormControl>
                                            <input placeholder="iGrowFast" {...field} className={inputClass} />
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                            </div>

                            <FormField control={form.control} name="email_address" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className={labelClass}>Email address</FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                            <input type="email" placeholder="support@yourdomain.com" {...field}
                                                className={cn(inputClass, 'pl-10')} />
                                        </div>
                                    </FormControl>
                                    <FormMessage className="text-[10px] text-ant-rose" />
                                </FormItem>
                            )} />

                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="username" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className={labelClass}>Username</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                                <input placeholder="support@yourdomain.com" {...field}
                                                    className={cn(inputClass, 'pl-10')} />
                                            </div>
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="password" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className={labelClass}>Password</FormLabel>
                                        <FormControl>
                                            <input type="password" placeholder={isEdit ? '••••••••' : 'SMTP password'} {...field}
                                                className={inputClass} />
                                        </FormControl>
                                        {isEdit && (
                                            <FormDescription className="font-serif italic text-[11px] text-ant-mid">
                                                Leave blank to keep current
                                            </FormDescription>
                                        )}
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                            </div>

                            {/* Status */}
                            <FormField control={form.control} name="is_active" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className={labelClass}>Status</FormLabel>
                                    <div className="flex items-center gap-2.5 h-10 px-3.5 bg-ant-light rounded-xl border border-ant-line">
                                        <Switch checked={field.value} onCheckedChange={field.onChange}
                                            className="data-[state=checked]:bg-ant-green scale-90" />
                                        <span className="text-[11px] font-medium text-ant-ink">
                                            {field.value ? 'Active' : 'Disabled'}
                                        </span>
                                    </div>
                                </FormItem>
                            )} />

                            {/* Server settings */}
                            <div className="pt-1 space-y-2.5">
                                <div className="flex items-center gap-2">
                                    <Server className="w-3.5 h-3.5 text-ant-mid" />
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        Server settings
                                    </span>
                                </div>

                                <ServerRow
                                    form={form}
                                    icon={ArrowUpFromLine}
                                    title="Outgoing · SMTP"
                                    accent="text-ant-orange"
                                    required
                                    hostName="smtp_host" portName="smtp_port" secName="smtp_security"
                                    hostPlaceholder="smtp.hostinger.com" portPlaceholder="465"
                                />
                                <ServerRow
                                    form={form}
                                    icon={ArrowDownToLine}
                                    title="Incoming · IMAP"
                                    accent="text-ant-ink"
                                    hostName="imap_host" portName="imap_port" secName="imap_security"
                                    hostPlaceholder="imap.hostinger.com" portPlaceholder="993"
                                />
                                <ServerRow
                                    form={form}
                                    icon={Inbox}
                                    title="Incoming · POP3"
                                    accent="text-ant-mid"
                                    hostName="pop3_host" portName="pop3_port" secName="pop3_security"
                                    hostPlaceholder="pop.hostinger.com" portPlaceholder="995"
                                />
                            </div>
                        </div>

                        <div className="shrink-0 px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                            <button type="button" onClick={onClose}
                                className="flex-1 sm:flex-initial h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors">
                                Cancel
                            </button>
                            <button type="submit" disabled={loading}
                                className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]">
                                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {isEdit ? 'Save changes' : 'Create account'}
                            </button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

// One protocol row: icon/title + hostname (flex) + port (narrow) + security select.
function ServerRow({ form, icon: Icon, title, accent, required, hostName, portName, secName, hostPlaceholder, portPlaceholder }: any) {
    return (
        <div className="rounded-xl border border-ant-line bg-ant-light/40 p-3 space-y-2.5">
            <div className="flex items-center gap-1.5">
                <Icon className={cn('w-3.5 h-3.5', accent)} />
                <span className="text-[11px] font-semibold text-ant-ink tracking-tight">{title}</span>
                {required && <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-orange">Required</span>}
            </div>
            <div className="flex gap-2">
                <FormField control={form.control} name={hostName} render={({ field }: any) => (
                    <FormItem className="flex-1 min-w-0 space-y-0">
                        <FormControl>
                            <input placeholder={hostPlaceholder} {...field}
                                className="w-full h-9 px-3 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/15 transition-all" />
                        </FormControl>
                    </FormItem>
                )} />
                <FormField control={form.control} name={portName} render={({ field }: any) => (
                    <FormItem className="w-[72px] shrink-0 space-y-0">
                        <FormControl>
                            <input inputMode="numeric" placeholder={portPlaceholder} {...field}
                                className="w-full h-9 px-3 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink tabular-nums placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/15 transition-all" />
                        </FormControl>
                    </FormItem>
                )} />
                <FormField control={form.control} name={secName} render={({ field }: any) => (
                    <FormItem className="w-[112px] shrink-0 space-y-0">
                        <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger className="h-9 rounded-lg border-ant-line bg-ant-paper text-[12px] px-3">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                {SECURITY_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value} className="text-[12px]">{o.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormItem>
                )} />
            </div>
        </div>
    );
}

export default EmailAccountModal;
