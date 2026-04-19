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
  if (pct >= 50) return 'text-ant-green';
  if (pct >= 25) return 'text-ant-orange';
  return 'text-ant-rose';
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
        'flex overflow-hidden rounded-md border border-ant-line bg-ant-paper divide-x divide-ant-line',
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
              dense ? 'px-2 py-1' : 'px-2.5 py-1.5',
            )}
          >
            <div
              className={cn('absolute inset-y-0 left-0 pointer-events-none', stage.fillClass)}
              style={{ width: `${widthPct}%` }}
              aria-hidden
            />
            <div className="relative z-10 flex items-baseline justify-between gap-1.5">
              <span
                className={cn(
                  'font-medium uppercase tracking-[0.18em]',
                  dense ? 'text-[8.5px]' : 'text-[9.5px]',
                )}
                style={{ color: stage.accent }}
              >
                {stage.label}
              </span>
              {stage.ratePct !== undefined && (
                <span className={cn('text-[9px] font-semibold tabular-nums', rateToneClass(stage.ratePct))}>
                  {stage.ratePct.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="relative z-10 mt-0.5 flex items-baseline gap-1">
              <span
                className={cn(
                  'font-display font-semibold text-ant-ink tabular-nums leading-none tracking-[-0.02em]',
                  dense ? 'text-[13px]' : 'text-[16px]',
                )}
              >
                {stage.count.toLocaleString('fr-MA')}
              </span>
              {stage.sub && (
                <span className="text-[9px] text-ant-mid truncate">{stage.sub}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
