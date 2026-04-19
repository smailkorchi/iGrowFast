import { cn } from '@/lib/utils';

export interface StackedSegment {
  id: string;
  label: string;
  count: number;
  color: string;
}

interface StackedProportionBarProps {
  segments: StackedSegment[];
  /** Override the denominator (defaults to sum of segment counts). */
  total?: number;
  className?: string;
  height?: number;
}

/**
 * One flat horizontal bar split into proportional color segments. Useful as the
 * visual spine for "how is this total distributed" sections — confirmation
 * statuses, pending-age buckets, source mix, etc. Title-attribute tooltips
 * surface the segment label/count on hover without pulling in a tooltip lib.
 */
export function StackedProportionBar({
  segments,
  total,
  className,
  height = 6,
}: StackedProportionBarProps) {
  const sorted = [...segments].sort((a, b) => b.count - a.count);
  const sum = total ?? sorted.reduce((s, x) => s + x.count, 0);
  if (sum <= 0) {
    return (
      <div
        className={cn('rounded-full bg-gray-100', className)}
        style={{ height }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className={cn('flex w-full overflow-hidden rounded-full bg-gray-50', className)}
      style={{ height }}
      role="img"
      aria-label={`Distribution across ${sorted.length} segments`}
    >
      {sorted.map((s) => {
        const pct = (s.count / sum) * 100;
        if (pct <= 0) return null;
        return (
          <span
            key={s.id}
            title={`${s.label}: ${s.count.toLocaleString('fr-MA')} (${pct.toFixed(1)}%)`}
            className="h-full transition-[width] duration-500"
            style={{ width: `${pct}%`, backgroundColor: s.color }}
          />
        );
      })}
    </div>
  );
}
