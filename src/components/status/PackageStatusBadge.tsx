import { Badge } from '@/components/ui/badge';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { cn } from '@/lib/utils';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';

type Props = {
    /** Master package_statuses id — resolved FIRST (authoritative, id-keyed). */
    statusId?: string | null;
    /** Raw provider status / real_time label. */
    rawStatus?: string | null;
    /** Preferred label candidate (e.g. parcel.status_label). Tried before rawStatus. */
    fallbackLabel?: string | null;
    /** Raw provider color, used ONLY when no master matches. */
    rawColor?: string | null;
    /** Shown when both candidates are empty. */
    emptyLabel?: string;
    className?: string;
    iconClassName?: string;
};

/**
 * Single source of truth for rendering a parcel/tracking status.
 * Always prints the resolved MASTER (label + color + icon); the raw provider
 * label/color are used ONLY as a fallback when `package_statuses` has no match.
 */
export function PackageStatusBadge({
    statusId,
    rawStatus,
    fallbackLabel,
    rawColor,
    emptyLabel = 'Nouveau',
    className,
    iconClassName,
}: Props) {
    const { resolve, resolveById } = usePackageStatusResolver();
    // Id-authoritative first; fall back to text resolution for legacy call sites / unmapped rows.
    const r = (statusId ? resolveById(statusId) : null) ?? resolve(rawStatus, fallbackLabel, rawColor);

    const label = r?.label ?? emptyLabel;
    const color = r?.color ?? '#94a3b8';
    const icon = r?.icon ?? null;

    return (
        <Badge
            className={cn(
                'border-none text-[9px] font-semibold px-1.5 py-0.5 rounded shadow-none inline-flex items-center gap-1 max-w-[160px] whitespace-nowrap align-middle',
                className,
            )}
            style={{ backgroundColor: `${color}15`, color }}
            title={label}
        >
            {icon && <DynamicIcon name={icon} className={cn('w-2.5 h-2.5 shrink-0', iconClassName)} />}
            <span className="truncate">{label}</span>
        </Badge>
    );
}
