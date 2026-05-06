import { cn } from '@/lib/utils';

export interface StatusQueueEntry {
  id: string;
  label: string;
  count: number;
  color: string;
}

interface StatusQueuePaneProps {
  title: string;
  totalLost: number;
  cohortSize: number;
  entries: StatusQueueEntry[];
  emptyText?: string;
  className?: string;
}

/**
 * Slim, editorial list. Title on the left, "−N of M" counter on the right, then a
 * dense table of rows — status name, count, and a horizontal share bar. Designed
 * to stack vertically inside a "Dropoff" column alongside a financials waterfall.
 */
export function StatusQueuePane({
  title,
  totalLost,
  cohortSize,
  entries,
  emptyText = 'Empty queue',
  className,
}: StatusQueuePaneProps) {
  const sorted = [...entries].sort((a, b) => b.count - a.count);
  const shareDenom = Math.max(1, totalLost);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h5 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
          {title}
        </h5>
        <span className="text-[10px] font-semibold tabular-nums text-ant-mid">
          <span className="text-ant-ink">−{totalLost.toLocaleString('fr-MA')}</span>
          <span className="mx-0.5 text-ant-line">/</span>
          <span>{cohortSize.toLocaleString('fr-MA')}</span>
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="font-serif-display text-[10px] text-ant-muted italic py-1">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {sorted.map((entry) => {
            const sharePct = (entry.count / shareDenom) * 100;
            return (
              <div key={entry.id} className="flex items-center gap-2">
                <span
                  className="w-[3px] h-3 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden
                />
                <span className="text-[10.5px] font-medium text-ant-ink truncate flex-1 min-w-0">
                  {entry.label}
                </span>
                <div className="w-16 h-[3px] rounded-full bg-ant-line overflow-hidden shrink-0">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, sharePct)}%`,
                      backgroundColor: entry.color,
                    }}
                  />
                </div>
                <span className="text-[10.5px] font-semibold text-ant-ink tabular-nums shrink-0 w-7 text-right">
                  {entry.count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
