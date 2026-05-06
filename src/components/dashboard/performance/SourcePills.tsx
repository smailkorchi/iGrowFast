import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface SourceStat {
  source: string;
  assigned: number;
  confirmed: number;
  delivered: number;
}

// Muted warm tones on an Anthropic palette — each source gets a soft wash with
// ink-tinted text. Keeps visual weight consistent with the rest of the dashboard.
const SOURCE_COLORS: Record<string, string> = {
  facebook: 'bg-ant-blue/15 text-ant-ink',
  instagram: 'bg-ant-orange/15 text-ant-ink',
  tiktok: 'bg-ant-ink/[0.06] text-ant-ink',
  whatsapp: 'bg-ant-green/15 text-ant-ink',
  'phone call': 'bg-ant-blue/10 text-ant-ink',
  connaissance: 'bg-ant-orange/[0.12] text-ant-ink',
  reorder: 'bg-ant-green/10 text-ant-ink',
  other: 'bg-ant-line-soft text-ant-muted',
};

interface SourcePillsProps {
  sources: SourceStat[];
  /** Only show the top N; remainder is collapsed into "+N more". Set to 0 for no limit. */
  limit?: number;
  className?: string;
  emptyText?: string;
}

export function SourcePills({ sources, limit = 0, className, emptyText = 'No source data' }: SourcePillsProps) {
  const sorted = [...sources].sort((a, b) => b.assigned - a.assigned);
  const visible = limit > 0 ? sorted.slice(0, limit) : sorted;
  const overflow = limit > 0 ? sorted.length - visible.length : 0;

  if (sorted.length === 0) {
    return <span className="font-serif-display text-[10px] text-ant-muted italic">{emptyText}</span>;
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {visible.map((s) => {
          const confRate = s.assigned > 0 ? (s.confirmed / s.assigned) * 100 : 0;
          const delRate = s.confirmed > 0 ? (s.delivered / s.confirmed) * 100 : 0;
          return (
            <Tooltip key={s.source}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full cursor-help capitalize',
                    SOURCE_COLORS[s.source] || SOURCE_COLORS.other,
                  )}
                >
                  {s.source}: <span className="font-semibold tabular-nums">{s.assigned}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="text-[11px] space-y-0.5">
                <div className="font-semibold capitalize">{s.source}</div>
                <div className="text-ant-muted">Assigned: <span className="font-semibold text-ant-ink">{s.assigned}</span></div>
                <div className="text-ant-muted">
                  Confirmed: <span className="font-semibold text-ant-ink">{s.confirmed}</span>
                  <span className="ml-1 text-ant-green">({confRate.toFixed(1)}%)</span>
                </div>
                <div className="text-ant-muted">
                  Delivered: <span className="font-semibold text-ant-ink">{s.delivered}</span>
                  <span className="ml-1 text-ant-green">({delRate.toFixed(1)}%)</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {overflow > 0 && (
          <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-ant-line-soft text-ant-muted">
            +{overflow} more
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}
