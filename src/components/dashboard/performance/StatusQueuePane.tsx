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
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h5 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.18em]">
          {title}
        </h5>
        <span className="text-[10px] font-bold tabular-nums text-gray-400">
          <span className="text-brand-navy">−{totalLost.toLocaleString('fr-MA')}</span>
          <span className="mx-1 text-gray-300">/</span>
          <span>{cohortSize.toLocaleString('fr-MA')}</span>
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-[10px] text-gray-400 italic py-1">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((entry) => {
            const sharePct = (entry.count / shareDenom) * 100;
            return (
              <div key={entry.id} className="flex items-center gap-2">
                <span
                  className="w-1 h-3.5 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden
                />
                <span className="text-[11px] font-semibold text-gray-700 truncate flex-1 min-w-0">
                  {entry.label}
                </span>
                <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden shrink-0">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, sharePct)}%`,
                      backgroundColor: entry.color,
                    }}
                  />
                </div>
                <span className="text-[11px] font-bold text-brand-navy tabular-nums shrink-0 w-7 text-right">
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
