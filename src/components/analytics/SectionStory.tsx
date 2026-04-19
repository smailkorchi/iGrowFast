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
    /** 2–5 supporting stats rendered as a muted inline strip under the hero. */
    supporting?: SectionStoryStat[];
    /** Optional further detail: charts, tables, breakdowns. */
    children?: ReactNode;
}

const TONE_TEXT: Record<NonNullable<SectionStoryStat['tone']>, string> = {
    neutral: 'text-brand-navy',
    positive: 'text-emerald-600',
    negative: 'text-red-600',
    warning: 'text-amber-600',
};

/**
 * Story-led analytics section body. Opens with a single hero number, then a
 * plain-language insight, then a strip of supporting stats, then whatever
 * charts/tables the section wants to show as drill-down evidence.
 *
 * Keeps every section reading top-to-bottom like an editorial answer to
 * "what do I need to know?" instead of a dashboard of undifferentiated widgets.
 */
export function SectionStory({ hero, narrative, supporting, children }: SectionStoryProps) {
    const heroToneClass = hero.tone ? TONE_TEXT[hero.tone] : TONE_TEXT.neutral;
    const change = hero.change;
    const up = change !== undefined && change.pct >= 0;

    return (
        <div className="space-y-3">
            {/* HERO + NARRATIVE */}
            <div className="space-y-1.5">
                <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">
                        {hero.label}
                    </span>
                    {change !== undefined && (
                        <span
                            className={cn(
                                'inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums',
                                change.pct === 0
                                    ? 'text-gray-400'
                                    : up
                                        ? 'text-emerald-600'
                                        : 'text-red-500',
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
                                <span className="text-gray-400 font-medium ml-0.5">{change.label}</span>
                            )}
                        </span>
                    )}
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={cn('text-[28px] font-light tabular-nums tracking-tight leading-none', heroToneClass)}>
                        {hero.value}
                    </span>
                    {hero.suffix && (
                        <span className="text-[11px] font-medium text-gray-400">{hero.suffix}</span>
                    )}
                </div>
                <p className="text-[12px] text-gray-600 leading-snug">{narrative}</p>
            </div>

            {/* SUPPORTING STRIP */}
            {supporting && supporting.length > 0 && (
                <div
                    className="grid gap-px bg-gray-100 rounded-lg overflow-hidden border border-gray-100"
                    style={{ gridTemplateColumns: `repeat(${supporting.length}, minmax(0, 1fr))` }}
                >
                    {supporting.map((s) => (
                        <div key={s.label} className="bg-white px-3 py-2">
                            <div className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 truncate">
                                {s.label}
                            </div>
                            <div
                                className={cn(
                                    'text-[14px] font-semibold tabular-nums mt-0.5 leading-none truncate',
                                    s.tone ? TONE_TEXT[s.tone] : TONE_TEXT.neutral,
                                )}
                            >
                                {s.value}
                            </div>
                            {s.sub && (
                                <div className="text-[9px] text-gray-400 mt-0.5 tabular-nums truncate">
                                    {s.sub}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* DETAIL */}
            {children && <div className="space-y-2.5 pt-1">{children}</div>}
        </div>
    );
}
