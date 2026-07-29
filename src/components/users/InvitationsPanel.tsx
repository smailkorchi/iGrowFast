import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    MailCheck, BellRing, Ban, Trash2, Loader2, Clock, ShieldOff, Hourglass, Mail, AlertCircle, Send,
} from 'lucide-react';
import {
    remindInvitation, revokeInvitation, deleteInvitation, checkInviteEmail, invitationReason,
    type PendingInvitation,
} from '@/lib/invitations';

const ROLE_LABEL: Record<string, string> = {
    'super admin': 'Super admin', 'admin': 'Admin', 'commercial': 'Commercial',
    'courier': 'Courier', 'mediabuyer': 'Media buyer',
};

type Phase = 'pending' | 'revoked' | 'expired';
const phaseOf = (inv: PendingInvitation): Phase =>
    inv.revoked_at ? 'revoked' : (new Date(inv.expires_at).getTime() <= Date.now() ? 'expired' : 'pending');

function expiryLabel(iso: string): string {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} min left`;
    if (h < 24) return `${h}h left`;
    return `${Math.ceil(h / 24)}d left`;
}

/** Standalone email collector — shown when Remind/Revoke is used on an invite with no email on file. */
function EmailPromptDialog({ mode, busy, onSubmit, onClose }: {
    mode: 'remind' | 'revoke';
    busy: boolean;
    onSubmit: (email: string | null) => void;
    onClose: () => void;
}) {
    const [email, setEmail] = useState('');
    const [check, setCheck] = useState<{ status: 'idle' | 'checking' | 'ok' | 'bad' | 'unknown'; reason?: string; suggestion?: string }>({ status: 'idle' });
    const fmtValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

    useEffect(() => {
        const e = email.trim().toLowerCase();
        if (!fmtValid) { setCheck({ status: 'idle' }); return; }
        setCheck({ status: 'checking' });
        let active = true;
        const t = window.setTimeout(async () => {
            const res = await checkInviteEmail(e);
            if (!active) return;
            if (res.ok && res.deliverable) setCheck({ status: 'ok' });
            else if (res.reason === 'error') setCheck({ status: 'unknown' });
            else setCheck({ status: 'bad', reason: res.reason, suggestion: res.suggestion });
        }, 600);
        return () => { active = false; window.clearTimeout(t); };
    }, [email, fmtValid]);

    const canSend = fmtValid && (check.status === 'ok' || check.status === 'unknown') && !busy;
    const inputCls = 'h-11 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink focus-visible:ring-1 focus-visible:ring-ant-orange/40';

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col">
                {/* Gradient hairline — contextual hue: orange relance / rose révocation */}
                <div className={cn('h-[3px] w-full bg-gradient-to-r to-transparent',
                    mode === 'remind' ? 'from-ant-orange via-ant-orange/60' : 'from-ant-rose via-ant-rose/60')} />
                <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                    <div className="flex items-start gap-3">
                        <div className={cn('w-11 h-11 rounded-2xl text-white flex items-center justify-center shrink-0 shadow-sm',
                            mode === 'remind' ? 'bg-ant-ink' : 'bg-ant-rose')}>
                            <Mail className="w-5 h-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                <span className={cn('h-1.5 w-1.5 rounded-full', mode === 'remind' ? 'bg-ant-orange' : 'bg-ant-rose')} />
                                {mode === 'remind' ? 'Relance' : 'Révocation'}
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                {mode === 'remind' ? 'Qui faut-il relancer ?' : 'Prévenir la personne invitée ?'}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                Cette invitation n&rsquo;a aucun email enregistré. {mode === 'remind'
                                    ? 'Indiquez où envoyer la relance.'
                                    : 'Indiquez un email pour envoyer l’avis d’annulation — ou révoquez sans prévenir.'}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-3">
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                        <Input
                            type="email" autoFocus placeholder="name@email.com" value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && canSend) onSubmit(email.trim().toLowerCase()); }}
                            className={cn(inputCls, 'pl-9 pr-9')} autoComplete="off" autoCapitalize="off"
                        />
                        {check.status === 'checking' && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-ant-mid" />}
                        {check.status === 'ok' && <MailCheck className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-green" />}
                        {check.status === 'bad' && <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-rose" />}
                    </div>
                    {check.status === 'bad' && (
                        <p className="text-[11px] font-medium text-ant-rose/90 flex flex-wrap items-center gap-1">
                            {invitationReason(check.reason)}
                            {check.reason === 'typo' && check.suggestion && (
                                <button type="button" onClick={() => setEmail(check.suggestion!)} className="font-semibold text-ant-orange hover:underline">
                                    Utiliser {check.suggestion}
                                </button>
                            )}
                        </p>
                    )}
                    {check.status === 'unknown' && (
                        <p className="text-[11px] font-medium text-ant-mid">Vérification impossible pour l’instant — vous pouvez quand même envoyer.</p>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-ant-line flex items-center justify-between gap-2">
                    {mode === 'revoke' ? (
                        <Button variant="ghost" disabled={busy} onClick={() => onSubmit(null)}
                            className="h-10 px-3 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-rose gap-1.5">
                            <Ban className="w-4 h-4" /> Révoquer sans prévenir
                        </Button>
                    ) : <span />}
                    <Button
                        onClick={() => canSend && onSubmit(email.trim().toLowerCase())}
                        disabled={!canSend}
                        className={cn('h-10 px-5 rounded-full text-white text-[12px] font-semibold gap-2 disabled:opacity-50',
                            mode === 'remind' ? 'bg-ant-ink hover:bg-ant-ink/90' : 'bg-ant-rose hover:bg-ant-rose/90')}
                    >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : mode === 'remind' ? <BellRing className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                        {mode === 'remind' ? 'Envoyer la relance' : 'Révoquer et notifier'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function InvitationsPanel({ activeBusinessId }: { activeBusinessId: string | null }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [prompt, setPrompt] = useState<{ id: string; mode: 'remind' | 'revoke' } | null>(null);

    const { data: invites = [] } = useQuery({
        queryKey: ['invitations', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            // RLS already scopes to the caller's business + admin role; unused = not yet consumed.
            // user_invitations isn't in the generated types yet → cast (matches the mediabuyer_*_access pattern).
            const { data } = await (supabase as any)
                .from('user_invitations')
                .select('id, email, target_role, expires_at, created_at, consumed_at, revoked_at, reminder_sent_at')
                .is('consumed_at', null)
                .order('created_at', { ascending: false });
            return (data ?? []) as PendingInvitation[];
        },
        enabled: !!activeBusinessId,
    });

    const run = async (id: string, fn: () => Promise<{ ok: boolean; reason?: string; detail?: string }>, okMsg: string) => {
        setBusyId(id);
        try {
            const res = await fn();
            if (!res.ok) { toast({ title: 'Action failed', description: res.detail || res.reason || 'Try again.', variant: 'destructive' }); return false; }
            toast({ title: okMsg });
            queryClient.invalidateQueries({ queryKey: ['invitations'] });
            return true;
        } catch (e) {
            toast({ title: 'Action failed', description: (e as Error).message, variant: 'destructive' });
            return false;
        } finally {
            setBusyId(null);
        }
    };

    const remind = useMutation({ mutationFn: (v: { id: string; email?: string }) => run(v.id, () => remindInvitation(v.id, v.email), 'Reminder sent') });
    const revoke = useMutation({ mutationFn: (v: { id: string; email?: string | null }) => run(v.id, () => revokeInvitation(v.id, v.email ?? undefined), 'Invitation revoked') });
    const remove = useMutation({ mutationFn: (id: string) => run(id, () => deleteInvitation(id), 'Invitation removed') });

    const onRemind = (inv: PendingInvitation) => inv.email ? remind.mutate({ id: inv.id }) : setPrompt({ id: inv.id, mode: 'remind' });
    const onRevoke = (inv: PendingInvitation) => inv.email ? revoke.mutate({ id: inv.id }) : setPrompt({ id: inv.id, mode: 'revoke' });

    const submitPrompt = async (email: string | null) => {
        if (!prompt) return;
        const ok = prompt.mode === 'remind'
            ? await run(prompt.id, () => remindInvitation(prompt.id, email!), 'Reminder sent')
            : await run(prompt.id, () => revokeInvitation(prompt.id, email ?? undefined), 'Invitation revoked');
        if (ok) setPrompt(null);
    };

    const sorted = useMemo(() => {
        const order: Record<Phase, number> = { pending: 0, expired: 1, revoked: 2 };
        return [...invites].sort((a, b) => order[phaseOf(a)] - order[phaseOf(b)]);
    }, [invites]);

    if (!invites.length) return null;

    const pendingCount = invites.filter((i) => phaseOf(i) === 'pending').length;

    return (
        <section className="space-y-3">
            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="font-display text-ant-orange font-semibold">·</span> Invitations
                    </div>
                    <h2 className="font-display text-[22px] tracking-tight text-ant-ink">
                        Pending invites
                        <span className="ml-2 text-[13px] font-normal text-ant-mid tabular-nums">· {pendingCount} active</span>
                    </h2>
                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">
                        Outstanding links. Remind nudges them; revoke kills the link and notifies the invitee. Expired/revoked cards can be cleared.
                    </p>
                </div>
                <div className="hidden md:flex h-12 w-12 rounded-2xl border border-ant-orange/25 bg-ant-orange/10 items-center justify-center shrink-0 text-ant-orange">
                    <Mail className="w-5 h-5" strokeWidth={1.5} />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {sorted.map((inv) => {
                    const phase = phaseOf(inv);
                    const dead = phase !== 'pending';
                    const busy = busyId === inv.id;
                    return (
                        <div
                            key={inv.id}
                            className={cn(
                                'rounded-2xl border p-4 flex items-center gap-3 transition',
                                dead ? 'border-ant-line bg-ant-light/40' : 'border-ant-line bg-ant-paper',
                            )}
                        >
                            <div className={cn('w-10 h-10 rounded-xl border flex items-center justify-center shrink-0',
                                phase === 'pending' ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange'
                                    : phase === 'revoked' ? 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose'
                                    : 'bg-ant-ink/5 border-ant-line text-ant-mid')}>
                                {phase === 'pending' ? <Mail className="w-4 h-4" />
                                    : phase === 'revoked' ? <ShieldOff className="w-4 h-4" />
                                    : <Hourglass className="w-4 h-4" />}
                            </div>

                            <div className="min-w-0 flex-1">
                                <p className={cn('text-[13px] font-semibold truncate', dead ? 'text-ant-mid' : 'text-ant-ink')}>
                                    {inv.email || <span className="font-serif italic font-normal">No email on file</span>}
                                </p>
                                <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[11px] text-ant-mid">
                                    <span className="font-semibold uppercase tracking-[0.1em]">{ROLE_LABEL[inv.target_role] || inv.target_role}</span>
                                    <span className="text-ant-line">•</span>
                                    {phase === 'pending' ? (
                                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {expiryLabel(inv.expires_at)}</span>
                                    ) : phase === 'revoked' ? (
                                        <span className="inline-flex items-center gap-1 text-ant-rose"><ShieldOff className="w-3 h-3" /> Revoked</span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1"><Hourglass className="w-3 h-3" /> Expired</span>
                                    )}
                                    {phase === 'pending' && inv.reminder_sent_at && (
                                        <><span className="text-ant-line">•</span>
                                        <span className="inline-flex items-center gap-1 text-ant-green"><MailCheck className="w-3 h-3" /> Reminded</span></>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                                {dead ? (
                                    <button
                                        onClick={() => remove.mutate(inv.id)}
                                        disabled={busy}
                                        className="h-8 px-3 rounded-full border border-ant-line text-[11px] font-semibold text-ant-rose hover:bg-ant-rose/5 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                    >
                                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => onRemind(inv)}
                                            disabled={busy}
                                            title={inv.email ? 'Email a reminder (refreshes the link)' : 'Add an email and send a reminder'}
                                            className="h-8 px-3 rounded-full border border-ant-line text-[11px] font-semibold text-ant-ink hover:bg-ant-light inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                                        >
                                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5 text-ant-orange" />} Remind
                                        </button>
                                        <button
                                            onClick={() => onRevoke(inv)}
                                            disabled={busy}
                                            title="Kill the link + email a cancellation notice"
                                            className="h-8 px-3 rounded-full border border-ant-line text-[11px] font-semibold text-ant-rose hover:bg-ant-rose/5 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                        >
                                            <Ban className="w-3.5 h-3.5" /> Revoke
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {prompt && (
                <EmailPromptDialog
                    mode={prompt.mode}
                    busy={busyId === prompt.id}
                    onSubmit={submitPrompt}
                    onClose={() => setPrompt(null)}
                />
            )}
        </section>
    );
}

export default InvitationsPanel;
