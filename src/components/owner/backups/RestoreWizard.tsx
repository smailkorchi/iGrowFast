import { useEffect, useMemo, useState } from 'react';
import {
    AlertDialog, AlertDialogContent,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Calendar } from '@/components/ui/calendar';
import {
    AlertTriangle, ArrowRight, ArrowLeft, Loader2, CheckCircle2, XCircle, X,
    ShieldCheck, LifeBuoy, Clock, DatabaseBackup,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    backupAgent, sessionIsAal2, fmtEpoch, TZ_LABEL, unitRunning, unitFailed,
    type AgentStatus, type PitrBackup, type RestorePlan,
} from '@/lib/backupAgent';
import { TotpGate } from './TotpGate';
import { HoldToConfirmButton } from './HoldToConfirmButton';

type Mode = 'backup' | 'pitr';

export function RestoreWizard({ open, onClose, status, seedBackup }: {
    open: boolean; onClose: () => void; status?: AgentStatus; seedBackup?: PitrBackup | null;
}) {
    const { toast } = useToast();
    const [step, setStep] = useState(0);
    const [mode, setMode] = useState<Mode>('backup');
    const [backupLabel, setBackupLabel] = useState<string>('');
    const [day, setDay] = useState<Date | undefined>();
    const [time, setTime] = useState('12:00:00');
    const [aal2, setAal2] = useState(false);
    const [ack, setAck] = useState(false);
    const [typed, setTyped] = useState('');
    const [plan, setPlan] = useState<RestorePlan | null>(null);
    const [exec, setExec] = useState<'idle' | 'starting' | 'running' | 'done' | 'error'>('idle');
    const [aborting, setAborting] = useState(0);

    const backups = useMemo(() => (status?.pitr.backups ?? []).slice().reverse(), [status]);
    // earliest restorable instant = oldest base backup's STOP (when it became consistent),
    // matching the window shown on the dashboard. Using start would allow an un-restorable
    // instant in the oldest backup's start->stop band.
    const winStart = useMemo(() => {
        const s = (status?.pitr.backups ?? []).map((b) => b.stop).filter((x): x is number => x != null);
        return s.length ? Math.min(...s) : null;
    }, [status]);

    useEffect(() => {
        if (!open) { reset(); return; }
        if (seedBackup) { setMode('backup'); setBackupLabel(seedBackup.label); }
    }, [open, seedBackup]);

    const reset = () => {
        setStep(0); setMode('backup'); setBackupLabel(''); setDay(undefined); setTime('12:00:00');
        setAal2(false); setAck(false); setTyped(''); setPlan(null); setExec('idle'); setAborting(0);
    };

    // The owner picks a target in LOCAL (Morocco) time — a listed backup, or a
    // calendar day + HH:MM:SS. Everything is resolved to a single epoch, then:
    //   - targetIso     = canonical UTC "YYYY-MM-DD HH:MM:SS+00" sent to the backend
    //   - targetLocalStr= "YYYY-MM-DD HH:MM:SS" LOCAL, what the owner retypes to confirm
    //   - targetDisplay = pretty local (with tz label) shown in banners
    const resolvedEpoch = useMemo(() => {
        if (mode === 'backup') return backups.find((b) => b.label === backupLabel)?.stop ?? null;
        if (!day) return null;
        const [hh, mm, ss] = time.split(':').map((n) => parseInt(n || '0', 10));
        // components interpreted as browser-LOCAL time → correct UTC instant
        return Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh || 0, mm || 0, ss || 0).getTime() / 1000);
    }, [mode, backupLabel, backups, day, time]);

    const p2 = (n: number) => String(n).padStart(2, '0');
    const targetIso = useMemo(() => {
        if (resolvedEpoch == null) return null;
        const d = new Date(resolvedEpoch * 1000);
        return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+00`;
    }, [resolvedEpoch]);
    const targetLocalStr = useMemo(() => {
        if (resolvedEpoch == null) return '';
        const d = new Date(resolvedEpoch * 1000);
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    }, [resolvedEpoch]);
    const targetDisplay = resolvedEpoch != null ? fmtEpoch(resolvedEpoch) : '';
    const inWindow = resolvedEpoch != null && winStart != null && resolvedEpoch >= winStart && resolvedEpoch * 1000 <= Date.now();

    const fetchPlan = async () => {
        try {
            const p = await backupAgent.restorePlan({ mode: 'pitr', target_iso: targetIso });
            setPlan(p); return p;
        } catch (e) { toast({ variant: 'destructive', title: 'Plan indisponible', description: (e as Error).message }); return null; }
    };

    const [sawRunning, setSawRunning] = useState(false);
    const [launchedAt, setLaunchedAt] = useState(0);
    const doRestore = async () => {
        setExec('starting'); setSawRunning(false); setLaunchedAt(Date.now());
        try {
            const r = await backupAgent.restore({
                mode: 'pitr', target_iso: targetIso,
                confirm_timestamp: targetIso ?? '', safety_backup: true,   // server re-validates against its resolved UTC target
            });
            setExec('running');
            toast({ title: r.mode === 'swap' ? 'Restauration lancée' : 'Validation du point lancée', description: r.note });
        } catch (e) { setExec('error'); toast({ variant: 'destructive', title: 'Échec', description: (e as Error).message }); }
    };

    // Watch the real igf-restore unit. A oneshot reads "activating" while running,
    // "failed" on error. Do NOT conclude "done" until we've actually seen it run
    // (or a long grace elapses) — otherwise the first idle poll would falsely
    // report success while the safety-backup + clone + parity (up to ~30 min) run.
    useEffect(() => {
        if (exec !== 'running' || !status) return;
        const st = status.units['igf-restore'];
        if (unitRunning(st)) { setSawRunning(true); return; }
        if (unitFailed(st)) { setExec('error'); return; }
        if (sawRunning || (launchedAt && Date.now() - launchedAt > 45_000)) { setExec('done'); }
    }, [status, exec, sawRunning, launchedAt]);

    const armed = plan?.armed ?? false;
    const finalLabel = armed
        ? `RESTAURER VERS ${targetDisplay || 'CE POINT'} — REMPLACE LES DONNÉES`
        : `VALIDER CE POINT DE RESTAURATION`;

    return (
        <AlertDialog open={open}>
            <AlertDialogContent className="max-w-lg ant-surface p-0 overflow-hidden gap-0">
                {/* rose header */}
                <div className="bg-ant-rose text-ant-light px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-display text-[15px]">Restauration</span>
                    </div>
                    {exec === 'idle' && (
                        <button onClick={onClose} className="opacity-80 hover:opacity-100"><X className="w-4 h-4" /></button>
                    )}
                </div>

                <div className="p-5 space-y-4">
                    {/* STEP 0 — warning */}
                    {step === 0 && (
                        <div className="space-y-4">
                            <div className="rounded-xl border border-ant-rose/40 bg-ant-rose-soft/50 p-4 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-ant-rose shrink-0" />
                                <div className="space-y-1">
                                    <p className="font-display text-[14px] text-ant-ink">Ceci peut remplacer vos données en direct.</p>
                                    <p className="font-serif italic text-[12.5px] text-ant-muted leading-relaxed">
                                        Une restauration écrit par-dessus la base de production. Toutes les données créées
                                        après le point choisi seront perdues — sauf la sauvegarde de filet prise juste avant.
                                    </p>
                                </div>
                            </div>
                            <div className="flex justify-between">
                                <Button variant="ghost" onClick={onClose} className="rounded-full text-ant-mid">Annuler</Button>
                                <Button variant="outline" onClick={() => setStep(1)}
                                    className="rounded-full border-ant-rose text-ant-rose hover:bg-ant-rose hover:text-ant-light gap-1.5">
                                    J’ai compris, continuer <ArrowRight className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* STEP 1 — pick recovery point */}
                    {step === 1 && (
                        <div className="space-y-3">
                            <p className="font-display text-[13px] text-ant-ink">Choisir un point de récupération</p>
                            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="space-y-2">
                                <label className="flex items-center gap-2 text-[12.5px] text-ant-ink cursor-pointer">
                                    <RadioGroupItem value="backup" /> Depuis une sauvegarde listée
                                </label>
                                <label className="flex items-center gap-2 text-[12.5px] text-ant-ink cursor-pointer">
                                    <RadioGroupItem value="pitr" /> Un instant précis (à la seconde)
                                </label>
                            </RadioGroup>

                            {mode === 'backup' && (
                                <div className="rounded-lg border border-ant-line max-h-52 overflow-auto ant-scroll">
                                    {backups.map((b) => (
                                        <button key={b.label} onClick={() => setBackupLabel(b.label)}
                                            className={cn('w-full text-left px-3 py-2 flex items-center justify-between border-b border-ant-line-soft last:border-0',
                                                backupLabel === b.label ? 'bg-ant-orange-soft/40' : 'hover:bg-ant-light/60')}>
                                            <span className="text-[12px] text-ant-ink">
                                                {b.type === 'full' ? 'Complète' : 'Incr.'} · {fmtEpoch(b.stop)}
                                            </span>
                                            {backupLabel === b.label && <CheckCircle2 className="w-3.5 h-3.5 text-ant-orange" />}
                                        </button>
                                    ))}
                                    {!backups.length && <p className="px-3 py-4 text-[12px] text-ant-muted text-center">Aucune sauvegarde physique.</p>}
                                </div>
                            )}

                            {mode === 'pitr' && (
                                <div className="rounded-lg border border-ant-line p-3 space-y-2">
                                    <Calendar
                                        mode="single" selected={day} onSelect={setDay}
                                        disabled={(d) => (winStart != null && d.getTime() / 1000 < winStart - 86400) || d.getTime() > Date.now()}
                                        className="ant-calendar"
                                    />
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-3.5 h-3.5 text-ant-mid" />
                                        <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="HH:MM:SS"
                                            className={cn('h-8 w-28 tabular-nums text-[12px]', !inWindow && day && 'border-ant-rose')} />
                                        <span className="text-[11px] text-ant-muted">{TZ_LABEL}</span>
                                    </div>
                                    {targetIso && (
                                        <p className={cn('font-serif italic text-[11.5px]', inWindow ? 'text-ant-muted' : 'text-ant-rose')}>
                                            {inWindow ? `Cible : ${targetDisplay}` : `Hors de la fenêtre récupérable.`}
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="flex justify-between pt-1">
                                <Button variant="ghost" onClick={() => setStep(0)} className="rounded-full text-ant-mid gap-1.5"><ArrowLeft className="w-3.5 h-3.5" /> Retour</Button>
                                <Button disabled={!inWindow} onClick={() => { fetchPlan(); setStep(2); }}
                                    className="rounded-full bg-ant-ink text-ant-light hover:opacity-90 gap-1.5">Continuer <ArrowRight className="w-3.5 h-3.5" /></Button>
                            </div>
                        </div>
                    )}

                    {/* STEP 2 — safety net */}
                    {step === 2 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-ant-orange" /><p className="font-display text-[13px] text-ant-ink">Sauvegarde de filet</p></div>
                            <div className="rounded-lg border border-ant-line p-3 flex items-center justify-between">
                                <span className="text-[12.5px] text-ant-ink">Sauvegarder l’état actuel avant de restaurer</span>
                                <Switch checked disabled />
                            </div>
                            <p className="font-serif italic text-[12px] text-ant-muted leading-relaxed">
                                Obligatoire. Une sauvegarde complète de l’instant présent est prise en premier — si la
                                restauration échoue, retour automatique à cet état. C’est le filet de sécurité.
                            </p>
                            <div className="flex justify-between pt-1">
                                <Button variant="ghost" onClick={() => setStep(1)} className="rounded-full text-ant-mid gap-1.5"><ArrowLeft className="w-3.5 h-3.5" /> Retour</Button>
                                <Button onClick={() => setStep(3)} className="rounded-full bg-ant-ink text-ant-light hover:opacity-90 gap-1.5">Continuer <ArrowRight className="w-3.5 h-3.5" /></Button>
                            </div>
                        </div>
                    )}

                    {/* STEP 3 — confirmation gate stack */}
                    {step === 3 && (
                        <div className="space-y-3">
                            {!armed && plan && (
                                <div className="rounded-lg bg-ant-blue-soft/50 border border-ant-blue/20 p-3 text-[12px] text-ant-ink">
                                    Le serveur n’est pas armé pour l’écrasement en direct. Cette action <b>validera</b> le point
                                    de restauration (preuve qu’il est complet et restaurable), sans toucher la production.
                                </div>
                            )}
                            {!aal2 ? (
                                <TotpGate prompt="Authentification à deux facteurs requise" onVerified={() => setAal2(true)} />
                            ) : (
                                <>
                                    {armed && (
                                        <div className="rounded-lg bg-ant-rose-soft/50 border border-ant-rose/30 p-3 space-y-2">
                                            <p className="text-[12px] text-ant-ink leading-relaxed">
                                                Les commandes, paiements et utilisateurs créés après <b>{targetDisplay}</b> seront
                                                définitivement supprimés. La base entière sera restaurée à cet état.
                                            </p>
                                            <label className="flex items-start gap-2 text-[12px] text-ant-ink cursor-pointer">
                                                <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
                                                Je comprends que les données postérieures seront remplacées.
                                            </label>
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-[12px] text-ant-muted mb-1">Recopiez l’horodatage exact pour confirmer :</p>
                                        <code className="block text-[12px] bg-ant-line-soft rounded px-2 py-1 mb-1.5 text-ant-ink select-all">{targetLocalStr}</code>
                                        <Input value={typed} onChange={(e) => setTyped(e.target.value)}
                                            className={cn('h-9 text-[12px]', typed && typed !== targetLocalStr && 'border-ant-rose')} placeholder="…" />
                                        {typed && typed !== targetLocalStr && <p className="font-serif italic text-[11px] text-ant-rose mt-1">Le texte ne correspond pas.</p>}
                                    </div>

                                    {aborting > 0 ? (
                                        <div className="rounded-full bg-ant-rose/10 border border-ant-rose/30 px-4 py-3 flex items-center justify-between">
                                            <span className="text-[12px] text-ant-rose">Exécution dans {aborting}s…</span>
                                            <button onClick={() => setAborting(0)} className="inline-flex items-center gap-1 text-[12px] text-ant-ink hover:text-ant-rose"><X className="w-3.5 h-3.5" /> Annuler</button>
                                        </div>
                                    ) : (
                                        <HoldToConfirmButton
                                            label={finalLabel}
                                            disabled={typed !== targetLocalStr || (armed && !ack)}
                                            onConfirm={() => {
                                                let n = 3; setAborting(n);
                                                const iv = setInterval(() => {
                                                    n -= 1; setAborting(n);
                                                    if (n <= 0) { clearInterval(iv); setAborting(0); setStep(4); doRestore(); }
                                                }, 1000);
                                            }}
                                        />
                                    )}
                                    <Button variant="ghost" onClick={() => setStep(2)} className="rounded-full text-ant-mid gap-1.5 w-full"><ArrowLeft className="w-3.5 h-3.5" /> Retour</Button>
                                </>
                            )}
                        </div>
                    )}

                    {/* STEP 4 — execution */}
                    {step === 4 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2"><DatabaseBackup className="w-4 h-4 text-ant-orange" /><p className="font-display text-[13px] text-ant-ink">{armed ? 'Restauration' : 'Validation'} en cours</p></div>
                            <ol className="space-y-2">
                                {[
                                    { k: 'safety', t: 'Sauvegarde de filet' },
                                    { k: 'restore', t: armed ? 'Restauration' : 'Restauration dans un clone isolé' },
                                    { k: 'verify', t: 'Vérification post-restauration (12 points)' },
                                ].map((ph, i) => {
                                    const active = exec === 'running' || exec === 'starting';
                                    const done = exec === 'done';
                                    return (
                                        <li key={ph.k} className="flex items-center gap-2 text-[12.5px]">
                                            {done ? <CheckCircle2 className="w-4 h-4 text-ant-green" />
                                                : active ? <Loader2 className="w-4 h-4 animate-spin text-ant-blue" />
                                                    : <span className="w-4 h-4 rounded-full border border-ant-line inline-block" />}
                                            <span className={cn(done ? 'text-ant-ink' : 'text-ant-muted')}>{i + 1}. {ph.t}</span>
                                        </li>
                                    );
                                })}
                            </ol>
                            <p className="font-serif italic text-[11px] text-ant-muted">
                                {status?.log_tails?.['restore-execute.log'] ?? 'En cas d’échec, retour automatique au filet de sécurité.'}
                            </p>
                            {exec === 'done' && (
                                <div className="rounded-lg border border-ant-green/30 bg-ant-green-soft/40 p-3 text-[12.5px] text-ant-ink flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-ant-green" />
                                    {armed ? `Base restaurée à l’état du ${targetDisplay}.` : 'Point de restauration validé — complet et restaurable.'}
                                </div>
                            )}
                            {exec === 'error' && (
                                <div className="rounded-lg border border-ant-rose/30 bg-ant-rose-soft/40 p-3 text-[12.5px] text-ant-ink flex items-center gap-2">
                                    <XCircle className="w-4 h-4 text-ant-rose" /> Échec — retour automatique à l’état d’origine.
                                </div>
                            )}
                            {(exec === 'done' || exec === 'error') && (
                                <div className="flex justify-end"><Button onClick={onClose} variant="ghost" className="rounded-full text-ant-mid">Fermer</Button></div>
                            )}
                        </div>
                    )}
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
