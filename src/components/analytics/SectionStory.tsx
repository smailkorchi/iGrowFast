import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface SectionStoryStat {
    label: string;
    value: string;
    /** Optional secondary label shown under the value, e.g. "per delivered". */
    sub?: string;
    tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}

interface SectionStoryProps {
    /** Headline metric — the single answer-at-a-glance number. */
    hero: {
        label: string;
        value: string;
        suffix?: string;
        tone?: 'neutral' | 'positive' | 'negative' | 'warning';
        change?: { pct: number; label?: string };
    };
    /** One plain-language sentence that tells the user what the numbers mean. */
    narrative: string;
    /** 2–6 supporting stats rendered as a muted strip under the hero. */
    supporting?: SectionStoryStat[];
    /** Optional further detail: charts, tables, breakdowns. */
    children?: ReactNode;
}

const TONE_TEXT: Record<NonNullable<SectionStoryStat['tone']>, string> = {
    neutral: 'text-ant-ink',
    positive: 'text-ant-green',
    negative: 'text-ant-rose',
    warning: 'text-ant-orange',
};

/**
 * Story-led analytics section body. Opens with a single hero number, then a
 * plain-language insight, then a strip of supporting stats, then whatever
 * charts/tables the section wants to show as drill-down evidence.
 *
 * Editorial rhythm: Poppins display for the hero, Lora italic for the narrative,
 * Inter for labels and data. Keeps every section reading top-to-bottom like an
 * answer to "what do I need to know?" instead of a wall of widgets.
 */
export function SectionStory({ hero, narrative, supporting, children }: SectionStoryProps) {
    const heroToneClass = hero.tone ? TONE_TEXT[hero.tone] : TONE_TEXT.neutral;
    const change = hero.change;
    const up = change !== undefined && change.pct >= 0;

    return (
        <div className="space-y-4">
            {/* HERO + NARRATIVE */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                <div className="space-y-1.5 max-w-[720px]">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[10px] uppercase tracking-[0.22em] font-medium text-ant-mid">
                            {hero.label}
                        </span>
                        {change !== undefined && (
                            <span
                                className={cn(
                                    'inline-flex items-center gap-0.5 text-[10.5px] font-semibold tabular-nums',
                                    change.pct === 0
                                        ? 'text-ant-mid'
                                        : up
                                            ? 'text-ant-green'
                                            : 'text-ant-rose',
                                )}
                            >
                                {change.pct === 0 ? (
                                    <Minus className="w-2.5 h-2.5" strokeWidth={2.5} />
                                ) : up ? (
                                    <TrendingUp className="w-2.5 h-2.5" strokeWidth={2.5} />
                                ) : (
                                    <TrendingDown className="w-2.5 h-2.5" strokeWidth={2.5} />
                                )}
                                {up && change.pct !== 0 && '+'}
                                {change.pct.toFixed(1)}%
                                {change.label && (
                                    <span className="text-ant-mid font-medium ml-0.5">{change.label}</span>
                                )}
                            </span>
                        )}
                    </div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span
                            className={cn(
                                'font-display text-[34px] md:text-[40px] font-semibold tabular-nums tracking-[-0.025em] leading-none',
                                heroToneClass,
                            )}
                        >
                            {hero.value}
                        </span>
                        {hero.suffix && (
                            <span className="text-[12px] font-medium text-ant-muted">{hero.suffix}</span>
                        )}
                    </div>
                    <p className="font-serif-display text-[13.5px] text-ant-muted leading-snug italic">
                        {narrative}
                    </p>
                </div>
            </div>

            {/* SUPPORTING STRIP */}
            {supporting && supporting.length > 0 && (
                <div
                    className="grid gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line"
                    style={{ gridTemplateColumns: `repeat(${Math.min(supporting.length, 6)}, minmax(0, 1fr))` }}
                >
                    {supporting.map((s) => (
                        <div key={s.label} className="bg-ant-paper px-3 py-2.5">
                            <div className="text-[9.5px] uppercase tracking-[0.18em] font-medium text-ant-mid truncate">
                                {s.label}
                            </div>
                            <div
                                className={cn(
                                    'font-display text-[17px] font-semibold tabular-nums mt-1 leading-none tracking-[-0.02em] truncate',
                                    s.tone ? TONE_TEXT[s.tone] : TONE_TEXT.neutral,
                                )}
                            >
                                {s.value}
                            </div>
                            {s.sub && (
                                <div className="text-[10px] text-ant-muted mt-1 tabular-nums truncate">
                                    {s.sub}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* DETAIL */}
            {children && <div className="space-y-3 pt-1">{children}</div>}
        </div>
    );
}
