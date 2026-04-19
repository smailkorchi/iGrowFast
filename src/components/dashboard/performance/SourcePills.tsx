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

const SOURCE_COLORS: Record<string, string> = {
  facebook: 'bg-blue-50 text-blue-700',
  instagram: 'bg-pink-50 text-pink-700',
  tiktok: 'bg-slate-100 text-slate-800',
  whatsapp: 'bg-emerald-50 text-emerald-700',
  'phone call': 'bg-sky-50 text-sky-700',
  connaissance: 'bg-amber-50 text-amber-700',
  reorder: 'bg-teal-50 text-teal-700',
  other: 'bg-gray-100 text-gray-600',
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
    return <span className="text-[9px] text-gray-400 italic">{emptyText}</span>;
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
                    'inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full cursor-help',
                    SOURCE_COLORS[s.source] || SOURCE_COLORS.other,
                  )}
                >
                  {s.source}: {s.assigned}
                </span>
              </TooltipTrigger>
              <TooltipContent className="text-[11px] space-y-0.5">
                <div className="font-bold capitalize">{s.source}</div>
                <div className="text-gray-500">Assigned: <span className="font-semibold text-brand-navy">{s.assigned}</span></div>
                <div className="text-gray-500">
                  Confirmed: <span className="font-semibold text-brand-navy">{s.confirmed}</span>
                  <span className="ml-1 text-emerald-600">({confRate.toFixed(1)}%)</span>
                </div>
                <div className="text-gray-500">
                  Delivered: <span className="font-semibold text-brand-navy">{s.delivered}</span>
                  <span className="ml-1 text-emerald-600">({delRate.toFixed(1)}%)</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {overflow > 0 && (
          <span className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
            +{overflow} more
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}
