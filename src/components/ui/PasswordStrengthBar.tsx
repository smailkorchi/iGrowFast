/**
 * PasswordStrengthBar — a minimalist, theme-agnostic strength meter.
 *
 * Four segments that fill and shift colour as the password gets stronger,
 * a tiny label, and compact requirement ticks. Colours are vivid strength
 * hues so it reads on both dark and light surfaces; the track and ticks use
 * `currentColor`, so set the text colour on the wrapper to match the form.
 *
 * Purely presentational — pass it the result of `scorePassword`.
 */
import { Check } from 'lucide-react';
import type { PasswordStrength } from '@/lib/passwordStrength';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordStrength';

const SEG_COLOR = ['#9ca3af', '#f43f5e', '#f59e0b', '#84cc16', '#22c55e']; // idx = score

export function PasswordStrengthBar({ strength, className }: { strength: PasswordStrength; className?: string }) {
    const { score, label, checks } = strength;
    const color = SEG_COLOR[score];

    const reqs: { ok: boolean; text: string }[] = [
        { ok: checks.length, text: `${MIN_PASSWORD_LENGTH}+ caractères` },
        { ok: checks.lower && checks.upper, text: 'Maj. & min.' },
        { ok: checks.digit, text: 'Chiffre' },
    ];

    return (
        <div className={className}>
            <div className="flex items-center gap-1.5">
                <div className="flex-1 flex gap-1">
                    {[1, 2, 3, 4].map((seg) => (
                        <span
                            key={seg}
                            className="h-1.5 flex-1 rounded-full transition-all duration-300"
                            style={{
                                backgroundColor: score >= seg ? color : 'currentColor',
                                opacity: score >= seg ? 1 : 0.15,
                            }}
                        />
                    ))}
                </div>
                <span
                    className="text-[10.5px] font-semibold tabular-nums w-[52px] text-right transition-colors duration-300"
                    style={{ color: score ? color : 'currentColor', opacity: score ? 1 : 0.4 }}
                >
                    {label || '—'}
                </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {reqs.map((r) => (
                    <span
                        key={r.text}
                        className="inline-flex items-center gap-1 text-[10.5px] font-medium transition-colors duration-200"
                        style={{ color: r.ok ? '#22c55e' : 'currentColor', opacity: r.ok ? 1 : 0.45 }}
                    >
                        <Check className="w-3 h-3 shrink-0" style={{ opacity: r.ok ? 1 : 0.5 }} /> {r.text}
                    </span>
                ))}
            </div>
        </div>
    );
}

export default PasswordStrengthBar;
