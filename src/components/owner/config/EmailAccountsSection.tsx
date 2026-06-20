import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Mail, Loader2, MailPlus } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import ConfigSection from './ConfigSection';
import EmailAccountCard from './EmailAccountCard';
import EmailAccountModal from './EmailAccountModal';
import {
    fetchEmailAccounts,
    createEmailAccount,
    updateEmailAccount,
    toggleEmailAccount,
    deleteEmailAccount,
    testEmailAccount,
    type EmailAccount,
    type EmailAccountInput,
} from '@/lib/emailAccounts';

const QK = ['email-accounts'];

const EmailAccountsSection = () => {
    const { toast } = useToast();
    const qc = useQueryClient();

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<EmailAccount | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<EmailAccount | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const { data: accounts, isLoading } = useQuery({ queryKey: QK, queryFn: fetchEmailAccounts });

    const invalidate = () => qc.invalidateQueries({ queryKey: QK });

    const saveMutation = useMutation({
        mutationFn: async (values: EmailAccountInput) => {
            if (editing) return updateEmailAccount(editing.id, values);
            return createEmailAccount(values);
        },
        onSuccess: () => {
            toast({ title: editing ? 'Email account updated' : 'Email account created' });
            setModalOpen(false);
            setEditing(null);
            invalidate();
        },
        onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => deleteEmailAccount(id),
        onSuccess: () => {
            toast({ title: 'Email account deleted' });
            setDeleteTarget(null);
            invalidate();
        },
        onError: (e: any) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
    });

    const handleToggle = async (acc: EmailAccount) => {
        setTogglingId(acc.id);
        try {
            await toggleEmailAccount(acc.id, !acc.is_active);
            invalidate();
        } catch (e: any) {
            toast({ title: 'Could not change status', description: e.message, variant: 'destructive' });
        } finally {
            setTogglingId(null);
        }
    };

    const handleTest = async (acc: EmailAccount) => {
        setTestingId(acc.id);
        try {
            const res = await testEmailAccount(acc.id);
            if (res?.ok) toast({ title: 'Test email sent', description: `Delivered to ${res.to}` });
            else toast({ title: 'Test failed', description: res?.error || 'SMTP send failed', variant: 'destructive' });
        } catch (e: any) {
            toast({ title: 'Test failed', description: e.message, variant: 'destructive' });
        } finally {
            setTestingId(null);
            invalidate();
        }
    };

    const openAdd = () => { setEditing(null); setModalOpen(true); };
    const openEdit = (acc: EmailAccount) => { setEditing(acc); setModalOpen(true); };

    const addButton = (
        <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
        >
            <Plus className="w-3.5 h-3.5" />
            Add account
        </button>
    );

    return (
        <>
            <ConfigSection
                icon={Mail}
                kicker="Email · SMTP"
                title="Email accounts"
                description="SMTP/IMAP/POP3 mailboxes the platform sends mail through."
                action={addButton}
            >
                {isLoading ? (
                    <div className="flex items-center justify-center py-12 text-ant-mid">
                        <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                ) : !accounts || accounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-12 gap-3">
                        <div className="w-11 h-11 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center text-ant-mid">
                            <MailPlus className="w-5 h-5" />
                        </div>
                        <p className="font-serif italic text-[13px] text-ant-mid max-w-xs">
                            No email accounts yet. Add an SMTP mailbox so the platform can send mail.
                        </p>
                        <button
                            type="button"
                            onClick={openAdd}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" /> Add your first account
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {accounts.map((acc) => (
                            <EmailAccountCard
                                key={acc.id}
                                account={acc}
                                onEdit={() => openEdit(acc)}
                                onDelete={() => setDeleteTarget(acc)}
                                onToggle={() => handleToggle(acc)}
                                onTest={() => handleTest(acc)}
                                testing={testingId === acc.id}
                                toggling={togglingId === acc.id}
                            />
                        ))}
                    </div>
                )}
            </ConfigSection>

            <EmailAccountModal
                isOpen={modalOpen}
                onClose={() => { setModalOpen(false); setEditing(null); }}
                onSubmit={(v) => saveMutation.mutate(v)}
                initialData={editing}
                loading={saveMutation.isPending}
            />

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent className="rounded-2xl border-ant-line bg-ant-paper">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-display text-[18px] tracking-[-0.01em] text-ant-ink">
                            Delete email account
                        </AlertDialogTitle>
                        <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                            “{deleteTarget?.name}” will be removed and its stored password permanently destroyed. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-full h-10 text-[12px]">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
                            disabled={deleteMutation.isPending}
                            className="rounded-full h-10 text-[12px] bg-ant-rose text-white hover:bg-ant-rose/90"
                        >
                            {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default EmailAccountsSection;
