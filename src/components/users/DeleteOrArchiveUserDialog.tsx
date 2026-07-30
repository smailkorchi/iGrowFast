import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Archive, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Adaptive suppression dialog for the Users console.
 *
 * The server decides the face: `user_deletion_profile` (mig 20260730100000)
 * counts the target's MEANINGFUL operational/financial references and returns
 * `hard_deletable`. Zero references → the destructive face (real delete).
 * Otherwise → the ARCHIVE face with receipts: load-bearing users are never
 * hard-deleted (the payment ledgers cascade, so a "successful" delete would
 * silently destroy money history).
 */
type DeletionProfile = {
    commandes: number;
    paiements: number;
    colis: number;
    notes: number;
    campagnes: number;
    demandes: number;
    historique: number;
    total: number;
    hard_deletable: boolean;
};

const RECEIPT_ROWS: Array<{ key: keyof DeletionProfile; label: string }> = [
    { key: 'commandes', label: 'Commandes' },
    { key: 'paiements', label: 'Paiements' },
    { key: 'colis', label: 'Colis' },
    { key: 'notes', label: 'Notes' },
    { key: 'campagnes', label: 'Campagnes' },
    { key: 'demandes', label: 'Demandes' },
    { key: 'historique', label: 'Historique' },
];

const DIALOG_SHELL =
    'max-w-md p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col';

export const DeleteOrArchiveUserDialog: React.FC<{
    /** Target row — `null` keeps the dialog closed and the profile query idle. */
    user: any | null;
    onClose: () => void;
    onHardDelete: () => void;
    hardDeletePending: boolean;
    onArchive: () => void;
    archivePending: boolean;
}> = ({ user, onClose, onHardDelete, hardDeletePending, onArchive, archivePending }) => {
    const busy = hardDeletePending || archivePending;

    const { data: profile, isLoading, error } = useQuery<DeletionProfile>({
        queryKey: ['user-deletion-profile', user?.id],
        enabled: !!user?.id,
        gcTime: 0,          // every re-open re-reads the live reference counts
        retry: false,
        queryFn: async () => {
            // RPC newer than the generated types → untyped rpc cast (house escape hatch).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error: rpcError } = await (supabase as any).rpc('user_deletion_profile', {
                p_user_id: user.id,
            });
            if (rpcError) throw new Error(rpcError.message);
            return data as DeletionProfile;
        },
    });

    const receipts = profile
        ? RECEIPT_ROWS.map((r) => ({ ...r, count: Number(profile[r.key] ?? 0) })).filter((r) => r.count > 0)
        : [];

    const face: 'loading' | 'error' | 'delete' | 'archive' =
        isLoading || !user ? 'loading'
            : error ? 'error'
                : profile?.hard_deletable ? 'delete'
                    : 'archive';

    const hairline =
        face === 'archive' ? 'from-ant-orange via-ant-orange/60'
            : face === 'loading' ? 'from-ant-ink via-ant-ink/40'
                : 'from-ant-rose via-ant-rose/60';

    return (
        <Dialog open={!!user} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
            <DialogContent className={DIALOG_SHELL}>
                {/* Gradient hairline — contextual hue: ink analysing / orange archive / rose destructive */}
                <div className={cn('h-[3px] w-full bg-gradient-to-r to-transparent', hairline)} />

                <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                    <div className="flex items-start gap-3">
                        <div
                            className={cn(
                                'w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm',
                                face === 'archive' || face === 'loading' ? 'bg-ant-ink text-white' : 'bg-ant-rose text-white',
                            )}
                        >
                            {face === 'loading' && <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.75} />}
                            {face === 'archive' && <Archive className="w-5 h-5" strokeWidth={1.75} />}
                            {face === 'delete' && <Trash2 className="w-5 h-5" strokeWidth={1.75} />}
                            {face === 'error' && <AlertTriangle className="w-5 h-5" strokeWidth={1.75} />}
                        </div>
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                <span
                                    className={cn(
                                        'h-1.5 w-1.5 rounded-full',
                                        face === 'archive' ? 'bg-ant-orange' : face === 'loading' ? 'bg-ant-ink' : 'bg-ant-rose',
                                    )}
                                />
                                {face === 'loading' ? 'Vérification'
                                    : face === 'archive' ? 'Archivage'
                                        : face === 'delete' ? 'Action irréversible'
                                            : 'Vérification impossible'}
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                {face === 'loading' ? <>Analyse de l&rsquo;activité&nbsp;…</>
                                    : face === 'archive' ? <>Cet utilisateur a un historique d&rsquo;activité</>
                                        : face === 'delete' ? <>Supprimer cet utilisateur&nbsp;?</>
                                            : <>Vérification impossible</>}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                {face === 'loading' ? (
                                    <>Nous comptons les références de <span className="not-italic font-semibold text-ant-ink">« {user?.name} »</span> avant de choisir l&rsquo;action.</>
                                ) : face === 'archive' ? (
                                    <><span className="not-italic font-semibold text-ant-ink">« {user?.name} »</span> est rattaché à des données opérationnelles&nbsp;: la suppression définitive est impossible.</>
                                ) : face === 'delete' ? (
                                    <><span className="not-italic font-semibold text-ant-ink">« {user?.name} »</span> n&rsquo;a aucune référence opérationnelle. Le compte sera retiré de l&rsquo;authentification et de la base.</>
                                ) : (
                                    <>L&rsquo;activité de <span className="not-italic font-semibold text-ant-ink">« {user?.name} »</span> n&rsquo;a pas pu être vérifiée. Aucune action n&rsquo;a été effectuée.</>
                                )}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {face === 'loading' && (
                    <div className="px-6 py-5 space-y-2">
                        <Skeleton className="h-9 rounded-xl" />
                        <Skeleton className="h-9 rounded-xl" />
                        <Skeleton className="h-9 w-2/3 rounded-xl" />
                    </div>
                )}

                {face === 'error' && (
                    <div className="px-6 py-5">
                        <div className="rounded-2xl border border-ant-rose/25 bg-ant-rose/5 px-4 py-3.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-rose">Erreur</p>
                            <p className="text-[12.5px] text-ant-ink leading-snug mt-1 break-words">
                                {(error as Error)?.message || 'Erreur inconnue.'}
                            </p>
                        </div>
                    </div>
                )}

                {face === 'archive' && (
                    <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
                        <div className="space-y-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                Données rattachées
                            </p>
                            <div className="rounded-2xl border border-ant-line bg-ant-light/40 overflow-hidden">
                                {receipts.length === 0 ? (
                                    <p className="px-4 py-3 font-serif italic text-[12px] text-ant-mid">
                                        Références détectées côté serveur.
                                    </p>
                                ) : (
                                    receipts.map((r, i) => (
                                        <div
                                            key={String(r.key)}
                                            className={cn(
                                                'flex items-center justify-between px-4 py-2.5',
                                                i > 0 && 'border-t border-ant-line',
                                            )}
                                        >
                                            <span className="text-[12px] font-medium text-ant-ink">{r.label}</span>
                                            <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums">
                                                {r.count}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                        <p className="font-serif italic text-[12.5px] text-ant-mid leading-relaxed">
                            L&rsquo;archivage désactive définitivement le compte et la connexion. L&rsquo;historique et les
                            attributions restent intacts.
                        </p>
                    </div>
                )}

                <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                    {face === 'error' ? (
                        <Button
                            onClick={onClose}
                            className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-ink hover:bg-ant-ink/90 text-white cursor-pointer"
                        >
                            Fermer
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="ghost"
                                onClick={onClose}
                                disabled={busy}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                            >
                                Annuler
                            </Button>
                            {face === 'delete' && (
                                <Button
                                    onClick={onHardDelete}
                                    disabled={hardDeletePending}
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                                >
                                    {hardDeletePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                    Supprimer définitivement
                                </Button>
                            )}
                            {face === 'archive' && (
                                <Button
                                    onClick={onArchive}
                                    disabled={archivePending}
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-ink hover:bg-ant-ink/90 text-white gap-2 cursor-pointer"
                                >
                                    {archivePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                                    Archiver l&rsquo;utilisateur
                                </Button>
                            )}
                            {face === 'loading' && (
                                <Button
                                    disabled
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-ink/40 text-white gap-2"
                                >
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Vérification&nbsp;…
                                </Button>
                            )}
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
