import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, MailPlus } from 'lucide-react';
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
import EmailTemplateCard from '@/components/owner/email-templates/EmailTemplateCard';
import EmailTemplateModal from '@/components/owner/email-templates/EmailTemplateModal';
import EmailTemplatePreviewModal from '@/components/owner/email-templates/EmailTemplatePreviewModal';
import {
    fetchEmailTemplates,
    createEmailTemplate,
    updateEmailTemplate,
    toggleEmailTemplate,
    deleteEmailTemplate,
    type EmailTemplate,
    type EmailTemplateInput,
} from '@/lib/emailTemplates';
import { fetchEmailAccounts } from '@/lib/emailAccounts';

const QK = ['email-templates'];

const OwnerEmailTemplates = () => {
    const { toast } = useToast();
    const qc = useQueryClient();

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<EmailTemplate | null>(null);
    const [previewTarget, setPreviewTarget] = useState<EmailTemplate | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<EmailTemplate | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const { data: templates, isLoading } = useQuery({ queryKey: QK, queryFn: fetchEmailTemplates, staleTime: 60_000 });
    const { data: accounts } = useQuery({ queryKey: ['email-accounts'], queryFn: fetchEmailAccounts, staleTime: 60_000 });
    const accountsById = new Map((accounts || []).map((a) => [a.id, a]));
    const invalidate = () => qc.invalidateQueries({ queryKey: QK });

    const senderFor = (t: EmailTemplate) => (t.email_account_id ? accountsById.get(t.email_account_id) : undefined);

    const saveMutation = useMutation({
        mutationFn: async (values: EmailTemplateInput) => {
            if (editing) return updateEmailTemplate(editing.id, values);
            return createEmailTemplate(values);
        },
        onSuccess: () => {
            toast({ title: editing ? 'Template updated' : 'Template created' });
            setModalOpen(false);
            setEditing(null);
            invalidate();
        },
        onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => deleteEmailTemplate(id),
        onSuccess: () => {
            toast({ title: 'Template deleted' });
            setDeleteTarget(null);
            invalidate();
        },
        onError: (e: any) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
    });

    const handleToggle = async (t: EmailTemplate) => {
        setTogglingId(t.id);
        try {
            await toggleEmailTemplate(t.id, !t.is_active);
            invalidate();
        } catch (e: any) {
            toast({ title: 'Could not change status', description: e.message, variant: 'destructive' });
        } finally {
            setTogglingId(null);
        }
    };

    const openAdd = () => { setEditing(null); setModalOpen(true); };
    const openEdit = (t: EmailTemplate) => { setEditing(t); setModalOpen(true); };

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Email templates
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Email templates
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Reusable email layouts the platform sends.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={openAdd}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)] self-start lg:self-auto"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add template
                    </button>
                </div>
            </header>

            {/* Content */}
            {isLoading ? (
                <div className="flex items-center justify-center py-20 text-ant-mid">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : !templates || templates.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="flex flex-col items-center justify-center text-center px-6 py-16 gap-3">
                        <div className="w-11 h-11 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center text-ant-mid">
                            <MailPlus className="w-5 h-5" />
                        </div>
                        <p className="font-serif italic text-[13px] text-ant-mid max-w-xs">
                            No templates yet. Create one with the HTML editor and preview how it lands in the inbox.
                        </p>
                        <button
                            type="button"
                            onClick={openAdd}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" /> Create your first template
                        </button>
                    </div>
                </section>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {templates.map((t) => (
                        <EmailTemplateCard
                            key={t.id}
                            template={t}
                            senderName={senderFor(t)?.from_name || senderFor(t)?.name}
                            senderEmail={senderFor(t)?.email_address}
                            onEdit={() => openEdit(t)}
                            onPreview={() => setPreviewTarget(t)}
                            onDelete={() => setDeleteTarget(t)}
                            onToggle={() => handleToggle(t)}
                            toggling={togglingId === t.id}
                        />
                    ))}
                </div>
            )}

            <EmailTemplateModal
                isOpen={modalOpen}
                onClose={() => { setModalOpen(false); setEditing(null); }}
                onSubmit={(v) => saveMutation.mutate(v)}
                initialData={editing}
                loading={saveMutation.isPending}
            />

            <EmailTemplatePreviewModal
                isOpen={!!previewTarget}
                onClose={() => setPreviewTarget(null)}
                template={previewTarget}
                fromName={previewTarget ? (senderFor(previewTarget)?.from_name || senderFor(previewTarget)?.name) : undefined}
                fromEmail={previewTarget ? senderFor(previewTarget)?.email_address : undefined}
                onEdit={() => { const t = previewTarget; setPreviewTarget(null); if (t) openEdit(t); }}
            />

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent className="rounded-2xl border-ant-line bg-ant-paper">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-display text-[18px] tracking-[-0.01em] text-ant-ink">
                            Delete email template
                        </AlertDialogTitle>
                        <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                            “{deleteTarget?.name}” will be permanently removed. This cannot be undone.
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
        </div>
    );
};

export default OwnerEmailTemplates;
