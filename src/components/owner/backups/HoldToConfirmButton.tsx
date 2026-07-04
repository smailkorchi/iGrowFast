import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Press-and-HOLD for `holdMs` to fire onConfirm. Releasing early aborts and
 * resets. A progress overlay fills the button as it's held. Deliberate friction
 * for the single most destructive control in the product.
 */
export function HoldToConfirmButton({ label, onConfirm, disabled, holdMs = 3000 }: {
    label: string; onConfirm: () => void; disabled?: boolean; holdMs?: number;
}) {
    const [pct, setPct] = useState(0);
    const raf = useRef<number | null>(null);
    const start = useRef<number>(0);
    const done = useRef(false);

    const stop = () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null; if (!done.current) setPct(0); };
    useEffect(() => () => stop(), []);

    const begin = () => {
        if (disabled) return;
        done.current = false;
        start.current = performance.now();
        const tick = (t: number) => {
            const p = Math.min(1, (t - start.current) / holdMs);
            setPct(p * 100);
            if (p >= 1) { done.current = true; setPct(100); onConfirm(); return; }
            raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
    };

    return (
        <button
            type="button"
            disabled={disabled}
            onMouseDown={begin} onMouseUp={stop} onMouseLeave={stop}
            onTouchStart={begin} onTouchEnd={stop}
            className={cn(
                'relative w-full overflow-hidden rounded-full px-5 py-3 text-[13px] font-semibold tracking-wide select-none',
                'text-ant-light transition-colors',
                disabled ? 'bg-ant-rose/40 cursor-not-allowed' : 'bg-ant-rose active:bg-ant-rose',
            )}
        >
            <span
                className="absolute inset-y-0 left-0 bg-ant-ink/25"
                style={{ width: `${pct}%`, transition: pct === 0 ? 'width 150ms' : 'none' }}
            />
            <span className="relative">{pct > 0 && pct < 100 ? 'Maintenez…' : label}</span>
        </button>
    );
}
