import { cn } from '@/lib/utils';

export interface FinancialsWaterfallProps {
  revenue: number;
  cogs: number;
  /** Optional accessory COGS; rendered as a separate row when > 0. */
  accessoryCogs?: number;
  adsShare: number;
  commission: number;
  shipping: number;
  net: number;
  /** Optional label for the revenue row. Default "Revenue". */
  revenueLabel?: string;
  /** Optional label for the COGS row. Default "COGS". */
  cogsLabel?: string;
  className?: string;
}

interface Row {
  label: string;
  value: number;
  sign: '+' | '−' | '=';
  tone: 'revenue' | 'cost' | 'net';
}

/**
 * Editorial waterfall: revenue at the top, subtractions underneath (each with a bar
 * proportional to revenue), and a bold net line at the bottom. Ties the "delivered
 * orders produced this much gross / kept this much net" story into one composition.
 */
export function FinancialsWaterfall({
  revenue,
  cogs,
  accessoryCogs,
  adsShare,
  commission,
  shipping,
  net,
  revenueLabel = 'Revenue',
  cogsLabel = 'COGS',
  className,
}: FinancialsWaterfallProps) {
  const rows: Row[] = [
    { label: revenueLabel, value: revenue, sign: '+', tone: 'revenue' },
    { label: cogsLabel, value: cogs, sign: '−', tone: 'cost' },
    ...(accessoryCogs !== undefined && accessoryCogs > 0
      ? ([{ label: 'Accessories', value: accessoryCogs, sign: '−', tone: 'cost' }] as Row[])
      : []),
    { label: 'Ads share', value: adsShare, sign: '−', tone: 'cost' },
    { label: 'Commission', value: commission, sign: '−', tone: 'cost' },
    { label: 'Shipping', value: shipping, sign: '−', tone: 'cost' },
    { label: 'Net contribution', value: net, sign: '=', tone: 'net' },
  ];

  const scale = Math.max(1, revenue);

  return (
    <div className={cn('space-y-1', className)}>
      {rows.map((row, i) => {
        const widthPct = scale > 0 ? (Math.abs(row.value) / scale) * 100 : 0;
        const isNet = row.tone === 'net';
        const netPositive = net >= 0;

        const amountClass = isNet
          ? netPositive
            ? 'text-ant-green'
            : 'text-ant-rose'
          : row.tone === 'revenue'
            ? 'text-ant-ink'
            : 'text-ant-muted';

        const barClass = isNet
          ? netPositive
            ? 'bg-ant-green'
            : 'bg-ant-rose'
          : row.tone === 'revenue'
            ? 'bg-ant-ink/70'
            : 'bg-ant-mid/50';

        return (
          <div key={row.label} className={cn(isNet && i > 0 && 'pt-1.5 border-t border-ant-line mt-1')}>
            <div className="flex items-baseline justify-between gap-2 text-[10px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={cn(
                    'inline-flex items-center justify-center w-3 text-[9.5px] font-semibold tabular-nums',
                    row.sign === '+' && 'text-ant-ink',
                    row.sign === '−' && 'text-ant-mid',
                    row.sign === '=' && (netPositive ? 'text-ant-green' : 'text-ant-rose'),
                  )}
                >
                  {row.sign}
                </span>
                <span
                  className={cn(
                    'font-medium truncate',
                    isNet ? 'text-ant-ink uppercase tracking-[0.2em] text-[9.5px] font-semibold' : 'text-ant-muted',
                  )}
                >
                  {row.label}
                </span>
              </div>
              <span className={cn('font-semibold tabular-nums', isNet ? 'font-display text-[13px] font-semibold tracking-[-0.01em]' : 'text-[11px]', amountClass)}>
                {Math.round(row.value).toLocaleString('fr-MA')}
                <span className="text-[9px] text-ant-mid font-medium ml-0.5">MAD</span>
              </span>
            </div>
            <div className="h-[3px] w-full rounded-full bg-ant-line-soft overflow-hidden mt-1">
              <div
                className={cn('h-full rounded-full', barClass)}
                style={{ width: `${Math.min(100, widthPct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
