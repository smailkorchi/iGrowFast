import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';

export type ResolvedPackageStatus = {
    id: string;
    code: string;
    label: string;
    color: string | null;
    icon: string | null;
};

type PkgStatusRow = ResolvedPackageStatus & {
    delivery_service_statuses: string[] | null;
};

/**
 * Single source of truth for resolving a parcel/tracking status to its MASTER
 * `package_statuses` row. Loads the table ONCE (cached, shared with the existing
 * `['package-statuses-icons']` query key — no extra fetch) and returns a memoized
 * sync resolver.
 *
 * Matching order is identical to the legacy inline `matchPkgStatus`:
 *   delivery_service_statuses (case-insensitive) -> label -> code.
 * Candidates are tried `fallbackLabel` first, then `rawOrLabel`.
 *
 * Rule enforced app-wide: always show the resolved master (label + color + icon);
 * the raw provider value is used ONLY as a fallback when nothing matches.
 */
export function usePackageStatusResolver() {
    const { data: rows } = useQuery({
        queryKey: ['package-statuses-icons'],
        queryFn: async () => {
            const { data } = await supabase
                .from('package_statuses')
                .select('id, code, label, color, icon, delivery_service_statuses')
                .eq('active', true)
                .eq('show_in_courier', true);
            return (data || []) as PkgStatusRow[];
        },
        staleTime: 5 * 60 * 1000,
    });

    return useMemo(() => {
        const list = rows ?? [];

        const byDss = new Map<string, PkgStatusRow>();
        const byLabel = new Map<string, PkgStatusRow>();
        const byCode = new Map<string, PkgStatusRow>();
        for (const r of list) {
            r.delivery_service_statuses?.forEach((s) => {
                if (s) byDss.set(s.toLowerCase(), r);
            });
            if (r.label) byLabel.set(r.label.toLowerCase(), r);
            if (r.code) byCode.set(r.code.toLowerCase(), r);
        }

        /** Resolve raw/label to a master row. Returns null when unmatched. */
        const match = (
            rawOrLabel?: string | null,
            fallbackLabel?: string | null,
        ): ResolvedPackageStatus | null => {
            if (!list.length) return null;
            const candidates = [fallbackLabel, rawOrLabel].filter(Boolean) as string[];
            for (const c of candidates) {
                const lower = c.toLowerCase();
                const hit = byDss.get(lower) || byLabel.get(lower) || byCode.get(lower);
                if (hit) return hit;
            }
            return null;
        };

        /**
         * Render-ready resolver: master label+color+icon, raw ONLY as fallback.
         * `rawColor` (provider color) is used purely when no master matches.
         */
        const resolve = (
            rawOrLabel?: string | null,
            fallbackLabel?: string | null,
            rawColor?: string | null,
        ): { label: string; color: string | null; icon: string | null } | null => {
            const m = match(rawOrLabel, fallbackLabel);
            if (m) return { label: m.label, color: m.color, icon: m.icon };
            const raw = fallbackLabel || rawOrLabel;
            if (!raw) return null;
            return { label: raw, color: rawColor ?? null, icon: null };
        };

        return { rows: list, match, resolve, isReady: list.length > 0 };
    }, [rows]);
}
