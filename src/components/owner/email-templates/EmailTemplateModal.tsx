import { useEffect, useState } from 'react';
import { X, Loader2, Code2, AlignLeft, Eye, Wand2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import HtmlCodeEditor from './HtmlCodeEditor';
import EmailPreview from './EmailPreview';
import {
    htmlToPlainText,
    DEFAULT_TEMPLATE_HTML,
    type EmailTemplate,
    type EmailTemplateInput,
} from '@/lib/emailTemplates';

const labelClass = 'text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid';
const inputClass =
    'w-full h-9 px-3 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/15 transition-all';

const emptyForm = (): EmailTemplateInput => ({
    name: '', subject: '', preheader: '', html_body: DEFAULT_TEMPLATE_HTML, text_body: '', is_active: true,
});

interface EmailTemplateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: EmailTemplateInput) => void;
    initialData?: EmailTemplate | null;
    loading?: boolean;
}

const EmailTemplateModal = ({ isOpen, onClose, onSubmit, initialData, loading }: EmailTemplateModalProps) => {
    const isEdit = !!initialData;
    const [form, setForm] = useState<EmailTemplateInput>(emptyForm());
    const [tab, setTab] = useState('html');

    useEffect(() => {
        if (!isOpen) return;
        setTab('html');
        if (initialData) {
            setForm({
                name: initialData.name,
                subject: initialData.subject,
                preheader: initialData.preheader ?? '',
                html_body: initialData.html_body,
                text_body: initialData.text_body,
                is_active: initialData.is_active,
            });
        } else {
            setForm(emptyForm());
        }
    }, [isOpen, initialData]);

    const set = <K extends keyof EmailTemplateInput>(k: K, v: EmailTemplateInput[K]) =>
        setForm((f) => ({ ...f, [k]: v }));

    const canSave = form.name.trim().length > 0 && !loading;

    const handleSubmit = () => {
        if (!canSave) return;
        onSubmit(form);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn(
                'p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col',
                'w-[84vw] max-w-[1280px] h-[86vh]',
                'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] sm:rounded-2xl',
                'max-sm:!left-0 max-sm:!right-0 max-sm:!top-0 max-sm:!bottom-0',
                'max-sm:!translate-x-0 max-sm:!translate-y-0',
                'max-sm:!w-full max-sm:!max-w-none max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none',
                '[&>button.absolute]:hidden',
            )}>
                <div className="h-[3px] w-full bg-ant-orange shrink-0" />

                {/* Close */}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute top-3.5 right-3.5 z-20 w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                </button>

                {/* Body: left meta column · right tabs */}
                <div className="flex flex-col sm:flex-row flex-1 min-h-0">
                    {/* LEFT — stacked meta fields */}
                    <aside className="w-full sm:w-[296px] shrink-0 border-b sm:border-b-0 sm:border-r border-ant-line flex flex-col min-h-0">
                        <DialogHeader className="px-5 pt-4 pb-3 text-left space-y-1 shrink-0">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Email template · {isEdit ? 'Edit' : 'New'}
                                </span>
                            </div>
                            <DialogTitle className="font-display text-[19px] leading-[1.12] tracking-[-0.01em] text-ant-ink pr-8">
                                {isEdit ? 'Edit email template' : 'New email template'}
                            </DialogTitle>
                            <DialogDescription className="sr-only">
                                Author the HTML, plain-text fallback, and preview the email as it appears in an inbox.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="px-5 pb-5 pt-2 space-y-4 overflow-y-auto flex-1">
                            <div className="space-y-1.5">
                                <label className={labelClass}>Template name</label>
                                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                                    placeholder="Welcome email" className={inputClass} />
                            </div>
                            <div className="space-y-1.5">
                                <label className={labelClass}>Subject</label>
                                <input value={form.subject} onChange={(e) => set('subject', e.target.value)}
                                    placeholder="Welcome to iGrowFast" className={inputClass} />
                            </div>
                            <div className="space-y-1.5">
                                <label className={labelClass}>Preheader</label>
                                <input value={form.preheader ?? ''} onChange={(e) => set('preheader', e.target.value)}
                                    placeholder="Inbox preview snippet" className={inputClass} />
                                <p className="font-serif italic text-[11px] text-ant-mid leading-snug">
                                    The short line shown after the subject in the inbox.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <label className={labelClass}>Status</label>
                                <div className="flex items-center gap-2.5 h-9 px-3 bg-ant-light rounded-lg border border-ant-line">
                                    <Switch checked={form.is_active} onCheckedChange={(v) => set('is_active', v)}
                                        className="data-[state=checked]:bg-ant-green scale-90" />
                                    <span className="text-[11px] font-medium text-ant-ink">{form.is_active ? 'Active' : 'Disabled'}</span>
                                </div>
                            </div>
                        </div>
                    </aside>

                    {/* RIGHT — tabs get the room */}
                    <div className="flex-1 min-w-0 flex flex-col min-h-0">
                        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0 px-5 pt-4 pb-1">
                            <TabsList className="bg-ant-paper border border-ant-line rounded-xl p-1 h-auto inline-flex self-start shrink-0">
                                {[
                                    { v: 'html', label: 'HTML', icon: Code2 },
                                    { v: 'text', label: 'Plain text', icon: AlignLeft },
                                    { v: 'preview', label: 'Preview', icon: Eye },
                                ].map((t) => (
                                    <TabsTrigger key={t.v} value={t.v}
                                        className="rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-ant-mid gap-1.5 data-[state=active]:bg-ant-ink data-[state=active]:text-ant-paper transition-colors">
                                        <t.icon className="w-3.5 h-3.5" /> {t.label}
                                    </TabsTrigger>
                                ))}
                            </TabsList>

                            <TabsContent value="html" className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden">
                                <HtmlCodeEditor value={form.html_body} onChange={(v) => set('html_body', v)}
                                    placeholder="<!DOCTYPE html> …" language="html" />
                            </TabsContent>

                            <TabsContent value="text" className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden flex flex-col gap-2">
                                <div className="flex items-center justify-between shrink-0">
                                    <p className="font-serif italic text-[11.5px] text-ant-mid">
                                        Shown by clients that can't render HTML.
                                    </p>
                                    <button type="button" onClick={() => set('text_body', htmlToPlainText(form.html_body))}
                                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-light transition-colors">
                                        <Wand2 className="w-3 h-3" /> Generate from HTML
                                    </button>
                                </div>
                                <div className="flex-1 min-h-0">
                                    <HtmlCodeEditor value={form.text_body} onChange={(v) => set('text_body', v)}
                                        placeholder="Plain-text version of the email…" language="text" />
                                </div>
                            </TabsContent>

                            <TabsContent value="preview" className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden">
                                <EmailPreview html={form.html_body} subject={form.subject} preheader={form.preheader} />
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>

                {/* Footer */}
                <div className="shrink-0 px-5 py-3 flex flex-row justify-end gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <button type="button" onClick={onClose}
                        className="h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors">
                        Cancel
                    </button>
                    <button type="button" onClick={handleSubmit} disabled={!canSave}
                        className="h-11 px-6 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]">
                        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {isEdit ? 'Save changes' : 'Create template'}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default EmailTemplateModal;
