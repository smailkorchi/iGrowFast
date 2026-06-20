import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AvatarStudio, type AvatarValue } from '@/components/users/AvatarStudio';
import { saveOwnAvatar } from '@/lib/profile';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AvatarEditDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    seed?: string;
}

/** Dark dialog (matches AvatarStudio's styling) for self-service avatar — upload or generate. */
export const AvatarEditDialog = ({ isOpen, onClose, onSaved, seed }: AvatarEditDialogProps) => {
    const { toast } = useToast();
    const [value, setValue] = useState<AvatarValue>({});
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!value.config && !value.dataUrl) { onClose(); return; }
        setSaving(true);
        try {
            await saveOwnAvatar(value);
            onSaved();
            onClose();
            toast({ title: 'Avatar mis à jour' });
        } catch (e) {
            toast({ title: 'Échec', description: (e as Error).message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-2xl p-0 border border-white/10 bg-brand-navy rounded-2xl overflow-hidden">
                <div className="h-[3px] w-full bg-ant-orange" />
                <DialogHeader className="px-6 pt-5 pb-3">
                    <DialogTitle className="font-display text-[18px] text-white">Votre avatar</DialogTitle>
                    <DialogDescription className="font-serif italic text-[12.5px] text-white/55">
                        Générez un avatar ou importez une photo.
                    </DialogDescription>
                </DialogHeader>
                <div className="px-6 pb-5">
                    <AvatarStudio onChange={setValue} seed={seed} />
                </div>
                <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-2">
                    <button onClick={onClose}
                        className="h-10 px-4 rounded-full text-[12px] font-semibold text-white/60 hover:text-white transition cursor-pointer">
                        Annuler
                    </button>
                    <button onClick={save} disabled={saving || (!value.config && !value.dataUrl)}
                        className={cn('h-10 px-5 rounded-full bg-white text-ant-ink text-[12px] font-semibold inline-flex items-center gap-2 cursor-pointer transition disabled:opacity-50',
                            'hover:bg-white/90')}>
                        {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enregistrement…</> : <><Check className="w-3.5 h-3.5" /> Enregistrer</>}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AvatarEditDialog;
