import { useEffect, useState } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    HardDrive, FileArchive, Image as ImageIcon, Server, ArrowRight, ArrowLeft,
    Loader2, CheckCircle2, XCircle, Layers, ShieldCheck, Activity, Download,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    backupAgent, sessionIsAal2, AgentError, type AgentStatus,
} from '@/lib/backupAgent';
import { TotpGate } from './TotpGate';

type JobKind = {
    key: string;               // trigger job id
    title: string; line: string; icon: LucideIcon;
    unit: string;              // status unit name to watch
    isPitr?: boolean;
};
const JOBS: JobKind[] = [
    { key: 'pitr-full', title: 'Physique / PITR', icon: HardDrive, unit: 'igf-pgbackrest-full', isPitr: true,
        line: 'Copie au niveau octet, restaurable à la seconde près. Reste sur nos serveurs.' },
    { key: 'pgdump', title: 'Logique / portable', icon: FileArchive, unit: 'igf-pgdump',
        line: 'Un fichier unique, chiffré, téléchargeable et restaurable ailleurs. Plus lent, plus flexible.' },
    { key: 'storage-mirror', title: 'Stockage', icon: ImageIcon, unit: 'igf-storage-mirror',
        line: 'Les fichiers uploadés par vos utilisateurs.' },
    { key: 'restic', title: 'Configuration', icon: Server, unit: 'igf-restic',
        line: 'L’état des 3 serveurs : système et logiciels.' },
];
const STEPS = [
    { label: 'Quoi', icon: Layers },
    { label: 'Confirmer', icon: ShieldCheck },
    { label: 'En cours', icon: Activity },
] as const;

export function ManualBackupWizard({ open, onClose, status }: {
    open: boolean; onClose: () => void; status?: AgentStatus;
}) {
    const { toast } = useToast();
    const [step, setStep] = useState<0 | 1 | 2>(0);
    const [sel, setSel] = useState<string>('pitr-full');
    const [pitrMode, setPitrMode] = useState<'pitr-full' | 'pitr-incr'>('pitr-full');
    const [needAal2, setNeedAal2] = useState(false);
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<'running' | 'done' | 'error' | null>(null);

    const job = JOBS.find((j) => j.key === sel)!;
    const runJobKey = job.isPitr ? pitrMode : job.key;
    const unitActive = status?.units?.[job.unit] === 'active';

    useEffect(() => {
        if (!open) { setStep(0); setSel('pitr-full'); setPitrMode('pitr-full'); setNeedAal2(false); setBusy(false); setOutcome(null); }
    }, [open]);

    // watch for completion while on step 2
    useEffect(() => {
        if (step !== 2 || outcome !== 'running' || !status) return;
        if (status.units[job.unit] !== 'active') {
            setOutcome('done');
            toast({ title: 'Sauvegarde terminée.' });
        }
    }, [status, step, outcome, job.unit, toast]);

    const launch = async () => {
        setBusy(true);
        try {
            if (!(await sessionIsAal2())) { setNeedAal2(true); setBusy(false); return; }
            await backupAgent.trigger(runJobKey);
            setStep(2); setOutcome('running');
        } catch (e) {
            if (e instanceof AgentError && e.code === 'aal2_required') { setNeedAal2(true); }
            else { setOutcome('error'); toast({ variant: 'destructive', title: 'Échec du déclenchement', description: (e as Error).message }); }
        } finally { setBusy(false); }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg ant-surface">
                <DialogHeader>
                    <DialogTitle className="font-display text-[18px] text-ant-ink">Sauvegarder maintenant</DialogTitle>
                    <DialogDescription className="font-serif italic text-[13px] text-ant-muted">
                        Déclenchement manuel — les sauvegardes tournent déjà automatiquement.
                    </DialogDescription>
                </DialogHeader>

                {/* stepper */}
                <div className="flex items-center gap-2 py-1">
                    {STEPS.map((s, i) => (
                        <div key={s.label} className="flex items-center gap-2">
                            <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium',
                                i === step ? 'text-ant-ink' : 'text-ant-mid')}>
                                <span className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px]',
                                    i < step ? 'bg-ant-green text-ant-light' : i === step ? 'bg-ant-orange text-ant-light' : 'bg-ant-line text-ant-mid')}>
                                    {i < step ? '✓' : i + 1}
                                </span>
                                {s.label}
                            </span>
                            {i < STEPS.length - 1 && <span className="w-6 h-px bg-ant-line" />}
                        </div>
                    ))}
                </div>

                {/* STEP 0 — what */}
                {step === 0 && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            {JOBS.map((j) => (
                                <button
                                    key={j.key}
                                    onClick={() => setSel(j.key)}
                                    className={cn('text-left rounded-xl border p-3 transition-all',
                                        sel === j.key ? 'border-ant-orange ring-2 ring-ant-orange/30 bg-ant-orange-soft/40' : 'border-ant-line hover:border-ant-mid')}
                                >
                                    <j.icon className={cn('w-4 h-4 mb-1.5', sel === j.key ? 'text-ant-orange' : 'text-ant-mid')} />
                                    <div className="font-display text-[12.5px] text-ant-ink">{j.title}</div>
                                    <div className="font-serif italic text-[11px] text-ant-muted leading-snug mt-0.5">{j.line}</div>
                                </button>
                            ))}
                        </div>
                        {job.isPitr && (
                            <RadioGroup value={pitrMode} onValueChange={(v) => setPitrMode(v as typeof pitrMode)} className="rounded-lg border border-ant-line p-3 space-y-2">
                                <label className="flex items-center gap-2 text-[12px] text-ant-ink cursor-pointer">
                                    <RadioGroupItem value="pitr-full" /> Complète <span className="text-ant-muted">— repart de zéro, longue</span>
                                </label>
                                <label className="flex items-center gap-2 text-[12px] text-ant-ink cursor-pointer">
                                    <RadioGroupItem value="pitr-incr" /> Incrémentale <span className="text-ant-muted">— seulement les changements, rapide</span>
                                </label>
                            </RadioGroup>
                        )}
                        <p className="rounded-lg bg-ant-line-soft p-3 text-[11px] text-ant-muted leading-relaxed">
                            <b className="text-ant-ink">Physique</b> = revenir en arrière sur nos serveurs, précis à la seconde.{' '}
                            <b className="text-ant-ink">Logique</b> = une copie portable, chiffrée, que vous emportez ailleurs.
                        </p>
                        <div className="flex justify-end pt-1">
                            <Button onClick={() => setStep(1)} className="rounded-full bg-ant-ink text-ant-light hover:opacity-90 gap-1.5">
                                Continuer <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* STEP 1 — confirm */}
                {step === 1 && (
                    <div className="space-y-3">
                        <p className="text-[13px] text-ant-ink">
                            Vous allez lancer : <b>{job.title}{job.isPitr ? (pitrMode === 'pitr-full' ? ' · complète' : ' · incrémentale') : ''}</b>.
                        </p>
                        <div className="rounded-lg bg-ant-blue-soft/50 border border-ant-blue/20 p-3 text-[12px] text-ant-ink">
                            Sans risque — une sauvegarde n’écrase jamais vos données.
                        </div>
                        {unitActive && (
                            <div className="rounded-lg bg-ant-orange-soft/50 border border-ant-orange/20 p-3 text-[12px] text-ant-ink">
                                Ce flux tourne déjà — il sera relancé à la fin.
                            </div>
                        )}
                        {needAal2 ? (
                            <TotpGate onVerified={launch} />
                        ) : (
                            <div className="flex items-center justify-between pt-1">
                                <Button variant="ghost" onClick={() => setStep(0)} className="rounded-full gap-1.5 text-ant-mid">
                                    <ArrowLeft className="w-3.5 h-3.5" /> Retour
                                </Button>
                                <Button onClick={launch} disabled={busy} className="rounded-full bg-ant-ink text-ant-light hover:opacity-90 gap-1.5">
                                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Lancer la sauvegarde
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {/* STEP 2 — running */}
                {step === 2 && (
                    <div className="space-y-3">
                        {outcome === 'running' && (
                            <div className="rounded-xl border border-ant-line p-4 flex items-center gap-3">
                                <Loader2 className="w-4 h-4 animate-spin text-ant-blue" />
                                <div className="min-w-0">
                                    <div className="font-display text-[13px] text-ant-ink">{job.title} en cours…</div>
                                    <div className="font-mono text-[11px] text-ant-muted truncate">
                                        {status?.log_tails?.[`${job.key}.log`] ?? 'traitement…'}
                                    </div>
                                </div>
                            </div>
                        )}
                        {outcome === 'done' && (
                            <div className="rounded-xl border border-ant-green/30 bg-ant-green-soft/40 p-4 flex items-center gap-3">
                                <CheckCircle2 className="w-4 h-4 text-ant-green" />
                                <div className="font-display text-[13px] text-ant-ink">Terminée.</div>
                                {job.key === 'pgdump' && (
                                    <a href="#" onClick={(e) => { e.preventDefault(); onClose(); }} className="ml-auto inline-flex items-center gap-1 text-[12px] text-ant-ink hover:text-ant-orange">
                                        <Download className="w-3.5 h-3.5" /> Voir les exports
                                    </a>
                                )}
                            </div>
                        )}
                        {outcome === 'error' && (
                            <div className="rounded-xl border border-ant-rose/30 bg-ant-rose-soft/40 p-4 flex items-center gap-3">
                                <XCircle className="w-4 h-4 text-ant-rose" />
                                <div className="font-display text-[13px] text-ant-ink">Échec du déclenchement.</div>
                            </div>
                        )}
                        <p className="font-serif italic text-[11px] text-ant-muted">
                            Vous pouvez fermer — le travail continue en arrière-plan, visible dans « Flux & santé ».
                        </p>
                        <div className="flex justify-end">
                            <Button onClick={onClose} variant="ghost" className="rounded-full text-ant-mid">Fermer</Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
