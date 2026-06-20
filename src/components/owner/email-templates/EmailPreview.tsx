import { useState } from 'react';
import { Monitor, Tablet, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

type Device = 'desktop' | 'tablet' | 'mobile';

const DEVICES: { key: Device; label: string; icon: typeof Monitor; width: number | null }[] = [
    { key: 'desktop', label: 'Desktop', icon: Monitor, width: null },
    { key: 'tablet', label: 'Tablet', icon: Tablet, width: 768 },
    { key: 'mobile', label: 'Mobile', icon: Smartphone, width: 390 },
];

interface EmailPreviewProps {
    html: string;
    subject: string;
    preheader?: string | null;
    fromName?: string;
    fromEmail?: string;
}

/**
 * Renders the email exactly as an inbox would: a faux inbox header (sender,
 * subject, preheader, time) above the HTML body in a sandboxed iframe. Scripts
 * are blocked (no allow-scripts) so untrusted markup can't execute. The device
 * switcher reflows the frame width to preview responsive behaviour.
 */
const EmailPreview = ({ html, subject, preheader, fromName = 'iGrowFast', fromEmail = 'no-reply@igrowfast.com' }: EmailPreviewProps) => {
    const [device, setDevice] = useState<Device>('desktop');
    const width = DEVICES.find((d) => d.key === device)?.width ?? null;
    const initials = (fromName || 'iG').trim().slice(0, 2).toUpperCase();

    return (
        <div className="flex flex-col h-full">
            {/* Device switcher */}
            <div className="flex items-center justify-center gap-1 pb-3 shrink-0">
                <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper">
                    {DEVICES.map((d) => {
                        const active = device === d.key;
                        return (
                            <button
                                key={d.key}
                                type="button"
                                onClick={() => setDevice(d.key)}
                                className={cn(
                                    'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-medium transition-colors',
                                    active ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink hover:bg-ant-light',
                                )}
                            >
                                <d.icon className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">{d.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Stage */}
            <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-ant-line bg-ant-light/50 p-4 flex justify-center">
                <div
                    className="bg-ant-paper rounded-2xl border border-ant-line shadow-[0_24px_60px_-30px_rgba(20,20,19,0.45)] overflow-hidden flex flex-col w-full transition-[max-width] duration-300"
                    style={{ maxWidth: width ? `${width}px` : '100%' }}
                >
                    {/* Inbox header */}
                    <div className="flex items-start gap-3 px-4 py-3 border-b border-ant-line bg-ant-paper shrink-0">
                        <div className="w-9 h-9 rounded-full bg-ant-ink text-ant-light flex items-center justify-center text-[12px] font-semibold shrink-0">
                            {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[12.5px] font-semibold text-ant-ink truncate">{fromName}</span>
                                <span className="text-[10.5px] text-ant-mid shrink-0 tabular-nums">now</span>
                            </div>
                            <p className="text-[13px] text-ant-ink leading-snug truncate">
                                {subject || <span className="text-ant-mid italic">No subject</span>}
                            </p>
                            <p className="text-[11.5px] text-ant-mid leading-snug truncate">
                                {preheader || fromEmail}
                            </p>
                        </div>
                    </div>

                    {/* Body */}
                    <iframe
                        title="Email preview"
                        sandbox=""
                        srcDoc={html || '<!doctype html><body style="margin:0;padding:24px;font-family:sans-serif;color:#8a8a85">Nothing to preview yet.</body>'}
                        className="w-full flex-1 min-h-[420px] bg-white border-0"
                    />
                </div>
            </div>
        </div>
    );
};

export default EmailPreview;
