import { X, Pencil } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import EmailPreview from './EmailPreview';
import type { EmailTemplate } from '@/lib/emailTemplates';

interface EmailTemplatePreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    template: EmailTemplate | null;
    onEdit?: () => void;
    fromName?: string;
    fromEmail?: string;
}

/** Read-only preview of a template — inbox render + device switcher, no editing. */
const EmailTemplatePreviewModal = ({ isOpen, onClose, template, onEdit, fromName, fromEmail }: EmailTemplatePreviewModalProps) => {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn(
                'p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col',
                'w-[84vw] max-w-[1120px] h-[86vh]',
                'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] sm:rounded-2xl',
                'max-sm:!left-0 max-sm:!right-0 max-sm:!top-0 max-sm:!bottom-0',
                'max-sm:!translate-x-0 max-sm:!translate-y-0',
                'max-sm:!w-full max-sm:!max-w-none max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none',
                '[&>button.absolute]:hidden',
            )}>
                <div className="h-[3px] w-full bg-ant-orange shrink-0" />

                <DialogHeader className="px-5 pt-4 pb-3 shrink-0 border-b border-ant-line text-left space-y-0">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Email template · Preview
                                </span>
                            </div>
                            <DialogTitle className="font-display text-[19px] leading-[1.12] tracking-[-0.01em] text-ant-ink truncate">
                                {template?.name || 'Preview'}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12px] text-ant-mid truncate">
                                {template?.subject || 'No subject'}
                            </DialogDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {onEdit && (
                                <button
                                    type="button"
                                    onClick={onEdit}
                                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                                >
                                    <Pencil className="w-3.5 h-3.5" /> Edit
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close"
                                className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 min-h-0 p-5">
                    {template && (
                        <EmailPreview
                            html={template.html_body}
                            subject={template.subject}
                            preheader={template.preheader}
                            fromName={fromName}
                            fromEmail={fromEmail}
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default EmailTemplatePreviewModal;
