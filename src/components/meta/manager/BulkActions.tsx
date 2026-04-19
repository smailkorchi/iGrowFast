import React, { useState } from 'react';
import { Loader2, Pause, Play, Archive } from 'lucide-react';
import { useMetaUpdateStatus } from '@/hooks/useMetaAds';
import { useToast } from '@/hooks/use-toast';

interface Props {
    connectionId: string;
    selectedIds: Set<string>;
    objectType: 'campaign' | 'adset' | 'ad';
    onDone: () => void;
}

export const BulkActions: React.FC<Props> = ({
    connectionId,
    selectedIds,
    objectType,
    onDone,
}) => {
    const updateStatus = useMetaUpdateStatus();
    const { toast } = useToast();
    const [busy, setBusy] = useState(false);

    if (selectedIds.size === 0) return null;

    const bulkAction = async (status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') => {
        setBusy(true);
        let ok = 0;
        let fail = 0;
        for (const id of selectedIds) {
            try {
                await updateStatus.mutateAsync({
                    connection_id: connectionId,
                    object_type: objectType,
                    object_id: id,
                    status,
                });
                ok++;
            } catch {
                fail++;
            }
        }
        toast({
            title: `${status.charAt(0) + status.slice(1).toLowerCase()}: ${ok} succeeded${fail ? `, ${fail} failed` : ''}`,
        });
        setBusy(false);
        onDone();
    };

    const label = objectType === 'campaign' ? 'campaign' : objectType === 'adset' ? 'ad set' : 'ad';

    return (
        <div className="sticky bottom-0 z-20 bg-ant-ink text-white rounded-b-lg flex items-center justify-between px-4 h-[52px]">
            <span className="text-[13px] font-semibold">
                {selectedIds.size} {label}{selectedIds.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                <button
                    onClick={() => bulkAction('ACTIVE')}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ant-green hover:bg-[#29903f] text-[12px] font-semibold transition disabled:opacity-50"
                >
                    <Play className="w-3.5 h-3.5" /> Activate
                </button>
                <button
                    onClick={() => bulkAction('PAUSED')}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ant-muted/25 hover:bg-ant-muted/40 text-[12px] font-semibold transition disabled:opacity-50"
                >
                    <Pause className="w-3.5 h-3.5" /> Pause
                </button>
                <button
                    onClick={() => bulkAction('ARCHIVED')}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ant-muted/25 hover:bg-ant-muted/40 text-[12px] font-semibold transition disabled:opacity-50"
                >
                    <Archive className="w-3.5 h-3.5" /> Archive
                </button>
            </div>
        </div>
    );
};
