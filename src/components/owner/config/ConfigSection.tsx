import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface ConfigSectionProps {
    icon: LucideIcon;
    kicker: string;
    title: string;
    description?: string;
    /** Right-aligned slot in the header — typically an "Add" button. */
    action?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * Generic container for a Config sub-section. Every future config block (SMTP,
 * webhooks, branding, …) renders inside one of these so the page stays uniform.
 */
const ConfigSection: React.FC<ConfigSectionProps> = ({ icon: Icon, kicker, title, description, action, children }) => {
    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <header className="px-5 pt-4 pb-4 border-b border-ant-line flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center text-ant-ink shrink-0">
                        <Icon className="w-[18px] h-[18px]" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                            {kicker}
                        </span>
                        <h2 className="font-display text-[16px] tracking-[-0.01em] text-ant-ink leading-tight">
                            {title}
                        </h2>
                        {description && (
                            <p className="font-serif italic text-[12px] text-ant-mid leading-relaxed">
                                {description}
                            </p>
                        )}
                    </div>
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </header>
            <div className="p-5">{children}</div>
        </section>
    );
};

export default ConfigSection;
