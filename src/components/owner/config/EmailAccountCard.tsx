import { format } from 'date-fns';
import {
    Mail, Pencil, Trash2, Power, PowerOff, SendHorizonal, Loader2,
    CheckCircle2, AlertTriangle, ArrowUpFromLine, ArrowDownToLine, Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EmailAccount } from '@/lib/emailAccounts';

interface EmailAccountCardProps {
    account: EmailAccount;
    onEdit: () => void;
    onDelete: () => void;
    onToggle: () => void;
    onTest: () => void;
    testing?: boolean;
    toggling?: boolean;
}

function ServerChip({ icon: Icon, label, host, port }: { icon: any; label: string; host: string | null; port: number | null }) {
    if (!host) return null;
    return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-ant-light border border-ant-line text-[10.5px] text-ant-ink">
            <Icon className="w-3 h-3 text-ant-mid shrink-0" />
            <span className="font-semibold uppercase tracking-[0.12em] text-ant-mid text-[9px]">{label}</span>
            <span className="tabular-nums truncate max-w-[180px]">{host}{port != null ? `:${port}` : ''}</span>
        </span>
    );
}

const EmailAccountCard = ({ account, onEdit, onDelete, onToggle, onTest, testing, toggling }: EmailAccountCardProps) => {
    const active = account.is_active;

    return (
        <div className="group relative rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/20 transition-colors shadow-[0_1px_2px_rgba(20,20,19,0.03)]">
            <div className={cn('h-[3px] w-full', active ? 'bg-ant-green' : 'bg-ant-line')} />
            <div className="p-4 space-y-3">
                {/* Identity */}
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn(
                            'w-10 h-10 rounded-xl border flex items-center justify-center shrink-0',
                            active ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-light border-ant-line text-ant-mid',
                        )}>
                            <Mail className="w-[18px] h-[18px]" />
                        </div>
                        <div className="min-w-0">
                            <p className="font-display text-[14px] text-ant-ink leading-tight truncate">{account.name}</p>
                            <p className="font-serif italic text-[11px] text-ant-mid truncate">{account.email_address}</p>
                        </div>
                    </div>
                    <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-semibold uppercase tracking-[0.14em] shrink-0',
                        active ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-mid/10 text-ant-mid',
                    )}>
                        <span className={cn('w-1 h-1 rounded-full', active ? 'bg-ant-green' : 'bg-ant-mid')} />
                        {active ? 'Active' : 'Inactive'}
                    </span>
                </div>

                {/* Server settings */}
                <div className="flex flex-wrap gap-1.5">
                    <ServerChip icon={ArrowUpFromLine} label="SMTP" host={account.smtp_host} port={account.smtp_port} />
                    <ServerChip icon={ArrowDownToLine} label="IMAP" host={account.imap_host} port={account.imap_port} />
                    <ServerChip icon={Inbox} label="POP3" host={account.pop3_host} port={account.pop3_port} />
                </div>

                {/* Last test outcome */}
                {account.last_test_at && (
                    <div className={cn(
                        'flex items-center gap-1.5 text-[10.5px]',
                        account.last_test_ok ? 'text-ant-green' : 'text-ant-rose',
                    )}>
                        {account.last_test_ok
                            ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                            : <AlertTriangle className="w-3 h-3 shrink-0" />}
                        <span className="truncate">
                            {account.last_test_ok
                                ? `Test passed · ${format(new Date(account.last_test_at), 'dd MMM, HH:mm')}`
                                : `Test failed: ${account.last_test_error || 'unknown error'}`}
                        </span>
                    </div>
                )}

                {/* Actions */}
                <div className="pt-3 border-t border-ant-line flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={onEdit}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-light transition-colors"
                    >
                        <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button
                        type="button"
                        onClick={onTest}
                        disabled={testing}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-light transition-colors disabled:opacity-60"
                    >
                        {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <SendHorizonal className="w-3 h-3" />}
                        Test
                    </button>
                    <button
                        type="button"
                        onClick={onToggle}
                        disabled={toggling}
                        className={cn(
                            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11px] font-medium transition-colors disabled:opacity-60',
                            active
                                ? 'border-ant-line bg-ant-paper text-ant-mid hover:bg-ant-light'
                                : 'border-ant-green/30 bg-ant-green/10 text-ant-green hover:bg-ant-green/15',
                        )}
                    >
                        {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : (active ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />)}
                        {active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-full border border-ant-line bg-ant-paper text-ant-mid hover:text-ant-rose hover:border-ant-rose/30 hover:bg-ant-rose/5 transition-colors"
                        aria-label="Delete"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmailAccountCard;
