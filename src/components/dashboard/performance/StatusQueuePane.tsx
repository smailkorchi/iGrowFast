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
        <h5 className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.14em]">
          {title}
        </h5>
        <span className="text-[9px] font-bold tabular-nums text-gray-400">
          <span className="text-brand-navy">−{totalLost.toLocaleString('fr-MA')}</span>
          <span className="mx-0.5 text-gray-300">/</span>
          <span>{cohortSize.toLocaleString('fr-MA')}</span>
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-[9px] text-gray-400 italic py-1">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {sorted.map((entry) => {
            const sharePct = (entry.count / shareDenom) * 100;
            return (
              <div key={entry.id} className="flex items-center gap-1.5">
                <span
                  className="w-[3px] h-3 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden
                />
                <span className="text-[10px] font-medium text-gray-700 truncate flex-1 min-w-0">
                  {entry.label}
                </span>
                <div className="w-14 h-[3px] rounded-full bg-gray-100 overflow-hidden shrink-0">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, sharePct)}%`,
                      backgroundColor: entry.color,
                    }}
                  />
                </div>
                <span className="text-[10px] font-semibold text-brand-navy tabular-nums shrink-0 w-6 text-right">
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
