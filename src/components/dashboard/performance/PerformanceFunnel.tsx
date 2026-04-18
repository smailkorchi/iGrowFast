import { cn } from '@/lib/utils';

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Conversion rate from the previous stage (0..100). Omit for the first stage. */
  ratePct?: number;
  /** Sub-text under count (e.g. "of all"). Omit if ratePct is set. */
  sub?: string;
  /** Hex accent for this segment (text and dot). */
  accent: string;
  /** Tailwind bg class for the segment fill. */
  fillClass: string;
}

interface PerformanceFunnelProps {
  stages: FunnelStage[];
  /** Compact variant used inside collapsed rows. */
  dense?: boolean;
  className?: string;
}

function rateToneClass(pct: number): string {
  if (pct >= 50) return 'text-emerald-700';
  if (pct >= 25) return 'text-amber-700';
  return 'text-red-600';
}

/**
 * Single continuous ribbon split into proportional segments. The whole funnel reads
 * left-to-right as one composition — no arrows, no separate chips. Each segment's
 * background width scales with its count relative to the largest stage, so the shape
 * itself telegraphs dropoff at a glance.
 */
export function PerformanceFunnel({ stages, dense, className }: PerformanceFunnelProps) {
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-2xl border border-gray-100 bg-white divide-x divide-gray-100',
        className,
      )}
    >
      {stages.map((stage) => {
        const widthPct = Math.max(10, (stage.count / max) * 100);
        return (
          <div
            key={stage.key}
            className={cn(
              'relative flex-1 min-w-0',
              dense ? 'px-3 py-2' : 'px-4 py-3',
            )}
          >
            <div
              className={cn('absolute inset-y-0 left-0 pointer-events-none', stage.fillClass)}
              style={{ width: `${widthPct}%` }}
              aria-hidden
            />
            <div className="relative z-10 flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'font-bold uppercase tracking-[0.18em]',
                  dense ? 'text-[9px]' : 'text-[10px]',
                )}
                style={{ color: stage.accent }}
              >
                {stage.label}
              </span>
              {stage.ratePct !== undefined && (
                <span className={cn('text-[10px] font-bold tabular-nums', rateToneClass(stage.ratePct))}>
                  {stage.ratePct.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="relative z-10 mt-0.5 flex items-baseline gap-1.5">
              <span
                className={cn(
                  'font-bold text-brand-navy tabular-nums leading-none',
                  dense ? 'text-lg' : 'text-2xl',
                )}
              >
                {stage.count.toLocaleString('fr-MA')}
              </span>
              {stage.sub && (
                <span className="text-[10px] text-gray-400 truncate">{stage.sub}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
