import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMetaUpdateStatus } from '@/hooks/useMetaAds';

interface Props {
    connectionId: string;
    objectType: 'campaign' | 'adset' | 'ad';
    objectId: string;
    isActive: boolean;
    onStatusChanged?: () => void;
}

export const StatusToggle: React.FC<Props> = ({
    connectionId,
    objectType,
    objectId,
    isActive,
    onStatusChanged,
}) => {
    const updateStatus = useMetaUpdateStatus();
    const [optimistic, setOptimistic] = useState<boolean | null>(null);

    const active = optimistic ?? isActive;

    const toggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const next = !active;
        setOptimistic(next);
        try {
            await updateStatus.mutateAsync({
                connection_id: connectionId,
                object_type: objectType,
                object_id: objectId,
                status: next ? 'ACTIVE' : 'PAUSED',
            });
            onStatusChanged?.();
        } catch {
            setOptimistic(null);
        }
    };

    return (
        <button
            onClick={toggle}
            disabled={updateStatus.isPending}
            className={cn(
                'relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40',
                active ? 'bg-[#31a24c]' : 'bg-[#ccd0d5]',
                updateStatus.isPending && 'opacity-60'
            )}
        >
            <span
                className={cn(
                    'pointer-events-none inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 mt-[2px]',
                    active ? 'translate-x-[16px]' : 'translate-x-[2px]'
                )}
            />
            {updateStatus.isPending && (
                <Loader2 className="absolute -right-5 top-0.5 w-3.5 h-3.5 animate-spin text-[#8a8d91]" />
            )}
        </button>
    );
};
