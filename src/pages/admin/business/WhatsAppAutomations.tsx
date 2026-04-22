import { Bot } from 'lucide-react';
import { format } from 'date-fns';

/**
 * WhatsApp Automations — coming soon placeholder.
 *
 * The original auto-replies CRUD implementation was intentionally removed while
 * a richer automations engine (keyword flows, media replies, time-of-day rules,
 * agent handoff) is designed. This page stays mounted so the sidebar entry
 * keeps its anchor; feature work lands back here when the engine is ready.
 */
export default function WhatsAppAutomations() {
    const today = format(new Date(), 'EEEE, MMMM d');

    return (
        <div className="ant-surface mx-auto max-w-[1440px] px-2 md:px-3 py-2 space-y-6">
            {/* Editorial header */}
            <header className="space-y-1.5 pt-1">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                    <span className="w-1 h-1 rounded-full bg-ant-orange" />
                    {today}
                </span>
                <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                    Automations
                </h1>
                <p className="font-serif-display text-[13px] text-ant-muted italic">
                    Keyword replies, drip flows, and agent handoff — in development.
                </p>
            </header>

            <div className="h-px bg-ant-line" />

            {/* Coming soon panel */}
            <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="relative px-6 md:px-12 py-16 md:py-20 text-center">
                    <div
                        aria-hidden
                        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ant-orange/40 to-transparent"
                    />

                    <div className="inline-flex items-center gap-3 mb-6">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-ant-orange/10 ring-1 ring-ant-orange/25">
                            <Bot className="w-6 h-6 text-ant-orange" strokeWidth={1.5} />
                        </div>
                        <span className="text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            Coming soon
                        </span>
                    </div>

                    <h2 className="font-display text-[36px] md:text-[44px] font-semibold text-ant-ink leading-[1.02] tracking-[-0.025em] mt-3">
                        A smarter inbox,<br className="hidden sm:inline" /> on autopilot.
                    </h2>

                    <p className="font-serif-display text-[14.5px] md:text-[15.5px] text-ant-muted italic leading-relaxed mt-4 max-w-[520px] mx-auto">
                        Trigger replies by keyword, chain messages into flows, and hand conversations off to a teammate when a customer needs a human. We&rsquo;re building it — sit tight.
                    </p>

                    <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-w-[560px] mx-auto">
                        <FeaturePill label="Keyword replies" />
                        <FeaturePill label="Multi-step flows" />
                        <FeaturePill label="Smart handoff" />
                    </div>

                    <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-ant-mid mt-10">
                        No action required · we&rsquo;ll announce it here
                    </p>
                </div>
            </div>
        </div>
    );
}

function FeaturePill({ label }: { label: string }) {
    return (
        <div className="rounded-full border border-ant-line bg-ant-light px-4 py-2 text-[11px] font-medium text-ant-ink">
            {label}
        </div>
    );
}
