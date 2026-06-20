import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Pencil, Trash2, Power, PowerOff, Loader2, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EmailTemplate } from '@/lib/emailTemplates';

// Emails are authored at a 600px content width; the thumbnail renders the iframe
// at that true width and scales it down to the card width so fixed-width layouts
// show their full column instead of a left-clipped slice.
const THUMB_W = 600;
const THUMB_H = 152;

interface EmailTemplateCardProps {
    template: EmailTemplate;
    onEdit: () => void;
    onDelete: () => void;
    onToggle: () => void;
    toggling?: boolean;
}

const EmailTemplateCard = ({ template, onEdit, onDelete, onToggle, toggling }: EmailTemplateCardProps) => {
    const active = template.is_active;
    const thumbRef = useRef<HTMLButtonElement>(null);
    const [scale, setScale] = useState(0.5);

    useEffect(() => {
        const el = thumbRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width;
            if (w) setScale(w / THUMB_W);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div className="group relative rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/20 transition-colors shadow-[0_1px_2px_rgba(20,20,19,0.03)] flex flex-col">
            <div className={cn('h-[3px] w-full', active ? 'bg-ant-green' : 'bg-ant-line')} />

            {/* Live thumbnail (top of the rendered email, scaled to fit) */}
            <button
                ref={thumbRef}
                type="button"
                onClick={onEdit}
                className="relative h-[152px] bg-white overflow-hidden border-b border-ant-line text-left block w-full"
                aria-label={`Edit ${template.name}`}
            >
                <iframe
                    title={`${template.name} preview`}
                    sandbox=""
                    tabIndex={-1}
                    srcDoc={template.html_body || '<!doctype html><body style="margin:0;padding:20px;font-family:sans-serif;color:#b8b8b3">Empty template</body>'}
                    className="absolute top-0 left-0 pointer-events-none bg-white border-0"
                    style={{
                        width: THUMB_W,
                        height: Math.ceil(THUMB_H / scale),
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                    }}
                />
                <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-ant-paper to-transparent pointer-events-none" />
                {!active && (
                    <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-ink/80 text-ant-light text-[9px] font-semibold uppercase tracking-[0.14em]">
                        Inactive
                    </span>
                )}
            </button>

            <div className="p-4 space-y-3 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                        <p className="font-display text-[14px] text-ant-ink leading-tight truncate">{template.name}</p>
                        <p className="font-serif italic text-[11px] text-ant-mid truncate flex items-center gap-1.5">
                            <Mail className="w-3 h-3 shrink-0" />
                            {template.subject || 'No subject'}
                        </p>
                    </div>
                    <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-semibold uppercase tracking-[0.14em] shrink-0',
                        active ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-mid/10 text-ant-mid',
                    )}>
                        <span className={cn('w-1 h-1 rounded-full', active ? 'bg-ant-green' : 'bg-ant-mid')} />
                        {active ? 'Active' : 'Inactive'}
                    </span>
                </div>

                <div className="mt-auto pt-3 border-t border-ant-line flex items-center gap-1.5">
                    <button type="button" onClick={onEdit}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-light transition-colors">
                        <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button type="button" onClick={onToggle} disabled={toggling}
                        aria-label={`${active ? 'Deactivate' : 'Activate'} ${template.name}`}
                        className={cn(
                            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11px] font-medium transition-colors disabled:opacity-60',
                            active
                                ? 'border-ant-line bg-ant-paper text-ant-mid hover:bg-ant-light'
                                : 'border-ant-green/30 bg-ant-green/10 text-ant-green hover:bg-ant-green/15',
                        )}>
                        {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : (active ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />)}
                        {active ? 'Deactivate' : 'Activate'}
                    </button>
                    <span className="ml-auto font-serif italic text-[10px] text-ant-mid tabular-nums hidden sm:block">
                        {template.updated_at ? format(new Date(template.updated_at), 'dd MMM') : ''}
                    </span>
                    <button type="button" onClick={onDelete}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-ant-line bg-ant-paper text-ant-mid hover:text-ant-rose hover:border-ant-rose/30 hover:bg-ant-rose/5 transition-colors"
                        aria-label={`Delete ${template.name}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmailTemplateCard;
