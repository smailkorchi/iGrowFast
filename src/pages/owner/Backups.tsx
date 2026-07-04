import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    HardDrive, FileArchive, Image as ImageIcon, Server, Key, Globe, RotateCw,
    AlertTriangle, Loader2, Lock, Download, ChevronDown, CheckCircle2, RefreshCcw,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import {
    Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from '@/components/ui/tooltip';
import {
    backupAgent, computeVerdict, VERDICT_META, worstFailureSentence, anyUnitActive,
    activeUnitLabel, walSpanFr, walWindowStart, streamLabel, streamServer, streamCadence,
    formatBytes, relFr, inFr, fmtEpochUtc, parseStamp,
    type AgentStatus, type BackupSet, type PitrBackup,
} from '@/lib/backupAgent';
import { ManualBackupWizard } from '@/components/owner/backups/ManualBackupWizard';
import { RestoreWizard } from '@/components/owner/backups/RestoreWizard';

/* ── tiny shared bits ────────────────────────────────────────────────────── */

function Section({ n, title, subtitle, children }: { n: string; title: string; subtitle: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className="h-[3px] w-full bg-ant-orange" />
            <div className="px-5 py-4 border-b border-ant-line">
                <div className="flex items-center gap-2">
                    <span className="font-display text-[12px] text-ant-orange">{n}</span>
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-ink font-medium">{title}</span>
                </div>
                <p className="font-serif italic text-[13px] text-ant-muted mt-1">{subtitle}</p>
            </div>
            {children}
        </section>
    );
}

function FreshnessBar({ ageSec, maxAge }: { ageSec: number; maxAge: number | null }) {
    const ratio = maxAge ? Math.min(1.2, ageSec / maxAge) : 0;
    const color = ratio > 1 ? 'bg-ant-rose' : ratio > 0.7 ? 'bg-ant-orange' : 'bg-ant-green';
    return (
        <div className="h-1.5 w-16 rounded-full bg-ant-line overflow-hidden">
            <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
    );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function OwnerBackups() {
    const { toast } = useToast();
    const [, forceTick] = useState(0);
    const [manualOpen, setManualOpen] = useState(false);
    const [restoreOpen, setRestoreOpen] = useState(false);
    const [seedBackup, setSeedBackup] = useState<PitrBackup | null>(null);
    const [openSet, setOpenSet] = useState<string | null>(null);

    const status = useQuery<AgentStatus>({ queryKey: ['backup-status'], queryFn: backupAgent.status, refetchInterval: (q) => (q.state.data && anyUnitActive(q.state.data) ? 5_000 : 10_000), retry: 1 });
    const backups = useQuery<{ sets: BackupSet[] }>({ queryKey: ['backup-sets'], queryFn: backupAgent.backups, refetchInterval: 60_000, retry: 1 });

    // re-render every second so relative times tick without refetching
    useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

    const s = status.data;
    const errMsg = status.error ? (status.error as Error).message : null;
    const forbidden = errMsg === 'forbidden' || errMsg === 'unauthorized';

    const verdict = s ? computeVerdict(s) : 'sain';
    const vm = VERDICT_META[verdict];
    const running = s ? anyUnitActive(s) : false;
    const activeLabel = s ? activeUnitLabel(s) : null;

    const download = async (key: string, name: string) => {
        try { const { url } = await backupAgent.downloadUrl(key); window.open(url, '_blank', 'noopener'); toast({ title: 'Lien valable 10 minutes.' }); }
        catch (e) { toast({ variant: 'destructive', title: 'Téléchargement impossible', description: (e as Error).message }); }
    };
    const openRestore = (b?: PitrBackup) => { setSeedBackup(b ?? null); setRestoreOpen(true); };

    /* forbidden / error / loading */
    if (forbidden) {
        return (
            <div className="ant-surface max-w-md mx-auto mt-24 rounded-2xl border border-ant-line bg-ant-paper p-8 text-center space-y-2">
                <Lock className="w-6 h-6 text-ant-mid mx-auto" />
                <p className="font-display text-[15px] text-ant-ink">Accès réservé</p>
                <p className="font-serif italic text-[13px] text-ant-muted">Ce compte ne dispose pas du privilège sauvegardes.</p>
            </div>
        );
    }
    if (status.isLoading) {
        return <div className="ant-surface flex items-center justify-center min-h-[60vh]"><Loader2 className="w-5 h-5 animate-spin text-ant-mid" /></div>;
    }
    if (!s) {
        return (
            <div className="ant-surface max-w-md mx-auto mt-24 rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] bg-ant-rose" />
                <div className="p-8 text-center space-y-3">
                    <AlertTriangle className="w-6 h-6 text-ant-rose mx-auto" />
                    <p className="font-display text-[14px] text-ant-ink">Agent de sauvegarde injoignable</p>
                    <p className="font-serif italic text-[12px] text-ant-muted">{errMsg} — l’agent ou son tunnel ne répond pas.</p>
                    <button onClick={() => status.refetch()} className="rounded-full bg-ant-ink text-ant-light text-[12px] px-4 h-9">Réessayer</button>
                </div>
            </div>
        );
    }

    const winStart = walWindowStart(s);
    const newestSet = backups.data?.sets[0];

    const kpi = [
        { label: 'POSTURE', value: vm.word, sub: `vérifié ${relFr(s.generated ? Math.floor(Date.now() / 1000) - s.generated : 0)}`, accent: vm.accent },
        { label: 'RESTAURATION', value: s.drill_fresh ? 'Prouvée' : 'Non prouvée', sub: 'clone == live', accent: s.drill_fresh ? 'bg-ant-green' : 'bg-ant-rose' },
        { label: 'FENÊTRE PITR', value: walSpanFr(s), sub: 'à la seconde', accent: 'bg-ant-blue' },
        { label: 'DERNIER DUMP', value: newestSet ? relFr(Math.floor((Date.now() - (parseStamp(newestSet.stamp)?.getTime() ?? 0)) / 1000)) : '—', sub: 'nuit · chiffré', accent: 'bg-ant-blue' },
        { label: 'STOCKAGE', value: s.disk ? `${s.disk.used_pct} %` : '—', sub: s.disk ? `${formatBytes(s.disk.avail_bytes)} libres` : '—', accent: (s.disk?.used_pct ?? 0) >= 80 ? 'bg-ant-orange' : 'bg-ant-green' },
    ];

    const estate: Array<{ icon: LucideIcon; title: string; line: string; keys: string[] }> = [
        { icon: HardDrive, title: 'PITR physique', line: 'octet près · toute seconde', keys: ['vmi3390870/pgbackrest-incr', 'vmi3390870/pgbackrest-full'] },
        { icon: FileArchive, title: 'Dumps logiques', line: 'portable · chiffré age', keys: ['vmi3390870/pgdump'] },
        { icon: ImageIcon, title: 'Miroir stockage', line: 'fichiers clients · quotidien', keys: ['vmi3390870/storage-mirror'] },
        { icon: Server, title: 'Config (restic)', line: '3 serveurs OS + stack', keys: ['vmi3390870/restic', 'vmi3414204/restic', 'vmi3418398/restic'] },
        { icon: Key, title: 'Secrets escrow', line: 'clés vault · age', keys: ['vmi3390870/restic'] },
        { icon: Globe, title: 'Sites 2 & 3', line: 'toolbox hebdo · Mac mensuel', keys: ['vmi3414204/db-pull'] },
    ];
    const rowFresh = (keys: string[]) => keys.every((k) => s.heartbeats[k]?.fresh ?? true);

    const streamKeys = Object.keys(s.heartbeats).filter((k) => !k.startsWith('_'));
    const byServer = ['Box', 'Toolbox', 'WhatsApp'].map((srv) => ({ srv, keys: streamKeys.filter((k) => streamServer(k) === srv).sort((a, b) => streamLabel(a).localeCompare(streamLabel(b), 'fr')) })).filter((g) => g.keys.length);

    return (
        <TooltipProvider>
            <div className="ant-surface bg-ant-light -m-4 md:-m-6 p-4 md:p-6">
                <div className="max-w-[1200px] mx-auto space-y-6">
                    {/* header */}
                    <header className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-muted">Plateforme · Sauvegardes</span>
                            </div>
                            <div className="flex items-center gap-3">
                                {running && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-ant-orange-soft/70 text-ant-orange px-2.5 py-1 text-[11px] font-medium">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange animate-pulse" /> En cours · {activeLabel}
                                    </span>
                                )}
                                <span className="font-mono text-[11px] text-ant-mid">MAJ {relFr(Math.floor(Date.now() / 1000) - s.generated)}</span>
                            </div>
                        </div>
                        <h1 className="font-display text-[28px] md:text-[32px] font-semibold tracking-tight text-ant-ink">Sauvegardes &amp; restauration</h1>
                        <p className="font-serif italic text-[14px] text-ant-muted">{worstFailureSentence(s)}</p>
                    </header>

                    {/* sticky verdict + action bar */}
                    <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 bg-ant-light/85 backdrop-blur border-b border-ant-line">
                        <div className="h-14 flex items-center justify-between">
                            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', vm.chip)}>
                                <span className={cn('w-1.5 h-1.5 rounded-full', vm.dot)} /> {vm.word}
                            </span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setManualOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-ant-ink text-ant-light px-4 py-2 text-[12px] font-medium hover:opacity-90 shadow-sm">
                                    <RotateCw className="w-3.5 h-3.5" /> Sauvegarder maintenant
                                </button>
                                {s.drill_fresh ? (
                                    <button onClick={() => openRestore()} className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose text-ant-rose px-4 py-2 text-[12px] font-medium hover:bg-ant-rose hover:text-ant-light">
                                        <AlertTriangle className="w-3.5 h-3.5" /> Restaurer
                                    </button>
                                ) : (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/40 text-ant-rose/50 px-4 py-2 text-[12px] font-medium cursor-not-allowed">
                                                <AlertTriangle className="w-3.5 h-3.5" /> Restaurer
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-[12px]">Indisponible : la restauration doit d’abord être prouvée par le test mensuel (drill).</TooltipContent>
                                    </Tooltip>
                                )}
                            </div>
                        </div>
                        {running && <div className="h-px w-full bg-ant-orange animate-pulse" />}
                    </div>

                    {/* KPI strip */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                        {kpi.map((k) => (
                            <div key={k.label} className="bg-ant-paper p-4 flex flex-col gap-1.5">
                                <span className={cn('h-1 w-8 rounded-full', k.accent)} />
                                <span className="text-[10px] uppercase tracking-[0.18em] text-ant-muted">{k.label}</span>
                                <span className="font-display text-[20px] leading-none tabular-nums text-ant-ink">{k.value}</span>
                                <span className="font-serif italic text-[11px] text-ant-muted">{k.sub}</span>
                            </div>
                        ))}
                    </div>

                    {/* 01 posture */}
                    <Section n="01" title="Posture — ce que nous protégeons" subtitle="Six lignes de défense, de la seconde près à l’hors-site.">
                        <div className="px-5 py-2">
                            {estate.map((e) => (
                                <div key={e.title} className="flex items-center justify-between py-2.5 border-b border-ant-line-soft last:border-0">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <e.icon className="w-4 h-4 text-ant-mid shrink-0" />
                                        <div className="min-w-0">
                                            <div className="font-display text-[13px] text-ant-ink leading-tight">{e.title}</div>
                                            <div className="font-serif italic text-[11px] text-ant-muted">{e.line}</div>
                                        </div>
                                    </div>
                                    <span className={cn('w-2 h-2 rounded-full shrink-0', rowFresh(e.keys) ? 'bg-ant-green' : 'bg-ant-rose')} />
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* 02 recovery points */}
                    <Section n="02" title="Points de restauration — revenir en arrière" subtitle="Une chaîne continue. Choisissez un instant, pas un fichier.">
                        <div className="px-5 py-4 space-y-4">
                            <div>
                                <div className="flex items-center justify-between text-[11px] font-mono text-ant-mid mb-1">
                                    <span>{winStart ? fmtEpochUtc(winStart) : '—'}</span><span>maintenant</span>
                                </div>
                                <div className="h-2 rounded-full bg-gradient-to-r from-ant-blue-soft to-ant-blue" />
                                <p className="font-serif italic text-[11px] text-ant-muted mt-1">Fenêtre récupérable — restauration à n’importe quelle seconde de cet intervalle.</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-[12px]">
                                    <thead><tr className="text-left text-[9px] uppercase tracking-[0.18em] text-ant-muted border-b border-ant-line">
                                        <th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Horodatage (UTC)</th>
                                        <th className="py-2 pr-3 font-medium">Base</th><th className="py-2 pr-3 font-medium">Dépôt</th>
                                        <th className="py-2 pr-3 font-medium">État</th><th className="py-2 font-medium"></th>
                                    </tr></thead>
                                    <tbody>
                                        {(s.pitr.backups ?? []).slice().reverse().map((b) => (
                                            <tr key={b.label} className={cn('border-b border-ant-line-soft last:border-0', b.error && 'bg-ant-rose-soft/30')}>
                                                <td className="py-2.5 pr-3"><span className={cn('inline-flex h-5 items-center px-2 rounded-full text-[10px] font-medium', b.type === 'full' ? 'bg-ant-orange-soft/70 text-ant-orange' : 'bg-ant-ink/[0.05] text-ant-muted')}>{b.type === 'full' ? 'complet' : 'incr'}</span></td>
                                                <td className="py-2.5 pr-3 text-ant-ink tabular-nums whitespace-nowrap">{fmtEpochUtc(b.stop)}</td>
                                                <td className="py-2.5 pr-3 text-ant-muted tabular-nums">{formatBytes(b.db_bytes)}</td>
                                                <td className="py-2.5 pr-3 text-ant-muted tabular-nums">{formatBytes(b.repo_bytes)}</td>
                                                <td className="py-2.5 pr-3">{b.error ? <span className="inline-flex items-center gap-1 text-ant-rose"><AlertTriangle className="w-3 h-3" /> erreur</span> : <CheckCircle2 className="w-3.5 h-3.5 text-ant-green" />}</td>
                                                <td className="py-2.5 text-right">
                                                    {s.drill_fresh && <button onClick={() => openRestore(b)} className="text-[11px] text-ant-rose hover:underline">Restaurer</button>}
                                                </td>
                                            </tr>
                                        ))}
                                        {!(s.pitr.backups ?? []).length && <tr><td colSpan={6} className="py-6 text-center font-serif italic text-ant-muted">Aucun point de restauration.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </Section>

                    {/* 03 streams */}
                    <Section n="03" title="Flux & santé — ce qui tourne" subtitle="Dix flux, trois serveurs. Archivage WAL toutes les 60 s.">
                        <div className="px-5 py-4 space-y-4">
                            <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                                {[
                                    { l: 'Archivés', v: s.archiver.archived ?? '—', c: 'text-ant-ink' },
                                    { l: 'Échoués', v: s.archiver.failed ?? 0, c: (s.archiver.failed ?? 0) > 0 ? 'text-ant-rose' : 'text-ant-green' },
                                    { l: 'Dernier segment', v: s.archiver.last ? `${s.archiver.last.slice(11, 19)} UTC` : '—', c: 'text-ant-muted' },
                                ].map((a) => (
                                    <div key={a.l} className="bg-ant-paper p-3">
                                        <div className="text-[9px] uppercase tracking-[0.18em] text-ant-muted">{a.l}</div>
                                        <div className={cn('font-display text-[16px] tabular-nums mt-0.5', a.c)}>{a.v}</div>
                                    </div>
                                ))}
                            </div>
                            {byServer.map((g) => (
                                <div key={g.srv}>
                                    <div className="text-[10px] uppercase tracking-[0.2em] text-ant-mid py-1.5 border-b border-ant-line-soft">— {g.srv} —</div>
                                    {g.keys.map((k) => {
                                        const hb = s.heartbeats[k];
                                        const nextIn = hb.iso ? Math.floor((new Date(hb.iso).getTime() + streamCadence(k) * 1000 - Date.now()) / 1000) : 0;
                                        return (
                                            <div key={k} className="flex items-center justify-between gap-3 py-2 border-b border-ant-line-soft last:border-0">
                                                <div className="min-w-0 flex-1"><div className="text-[12.5px] text-ant-ink truncate">{streamLabel(k)}</div></div>
                                                <div className="text-[11px] text-ant-muted tabular-nums w-20 text-right">{relFr(hb.age_sec)}</div>
                                                <div className="text-[11px] text-ant-mid tabular-nums w-20 text-right hidden sm:block">{inFr(nextIn)}</div>
                                                <FreshnessBar ageSec={hb.age_sec} maxAge={hb.max_age_sec} />
                                                <span className={cn('text-[10px] w-16 text-right', hb.fresh ? 'text-ant-green' : 'text-ant-rose')}>{hb.fresh ? 'à jour' : 'en retard'}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* 04 exports */}
                    <Section n="04" title="Exports téléchargeables — emporter une copie" subtitle="Dumps chiffrés, portables. Lien signé, 10 minutes.">
                        <div className="px-5 py-2">
                            {backups.isLoading && <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-ant-mid" /></div>}
                            {(backups.data?.sets ?? []).map((set) => (
                                <div key={set.stamp} className="border-b border-ant-line-soft last:border-0 py-2.5">
                                    <button onClick={() => setOpenSet(openSet === set.stamp ? null : set.stamp)} className="w-full flex items-center justify-between">
                                        <div className="text-left">
                                            <div className="font-display text-[12.5px] text-ant-ink tabular-nums">{fmtEpochUtc(parseStamp(set.stamp) ? parseStamp(set.stamp)!.getTime() / 1000 : null)}</div>
                                            <div className="font-serif italic text-[11px] text-ant-muted">{set.files.length} fichiers · {formatBytes(set.bytes)}</div>
                                        </div>
                                        <ChevronDown className={cn('w-4 h-4 text-ant-mid transition-transform', openSet === set.stamp && 'rotate-180')} />
                                    </button>
                                    {openSet === set.stamp && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {set.files.map((f) => (
                                                <button key={f.key} onClick={() => download(f.key, f.name)} title={`${f.name} · ${formatBytes(f.size)}`}
                                                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-ant-line text-[11px] text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors">
                                                    <Download className="w-3 h-3" /> {f.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {backups.data && !backups.data.sets.length && <p className="py-6 text-center font-serif italic text-[12px] text-ant-muted">Aucun export téléchargeable pour l’instant.</p>}
                        </div>
                    </Section>

                    {/* 05 actions */}
                    <Section n="05" title="Actions" subtitle="Lancer une sauvegarde, ou — en dernier recours — restaurer.">
                        <div className="p-5 grid sm:grid-cols-2 gap-3">
                            <button onClick={() => setManualOpen(true)} className="rounded-xl border border-ant-line p-4 text-left hover:border-ant-mid transition-colors">
                                <RotateCw className="w-4 h-4 text-ant-ink mb-2" />
                                <div className="font-display text-[13px] text-ant-ink">Sauvegarder maintenant</div>
                                <div className="font-serif italic text-[11px] text-ant-muted mt-0.5">Physique, logique, stockage ou configuration.</div>
                            </button>
                            <button onClick={() => s.drill_fresh && openRestore()} disabled={!s.drill_fresh}
                                className={cn('rounded-xl border p-4 text-left transition-colors', s.drill_fresh ? 'border-ant-rose/40 hover:border-ant-rose' : 'border-ant-line opacity-50 cursor-not-allowed')}>
                                <AlertTriangle className="w-4 h-4 text-ant-rose mb-2" />
                                <div className="font-display text-[13px] text-ant-ink">Restaurer…</div>
                                <div className="font-serif italic text-[11px] text-ant-rose mt-0.5">Remplace les données en direct. Accès protégé.</div>
                            </button>
                        </div>
                    </Section>

                    <p className="font-serif italic text-[11px] text-ant-muted/70 text-center pb-2">
                        Lecture seule · actualisation {running ? '5' : '10'} s · état généré à {new Date(s.generated * 1000).toISOString().slice(11, 19)} UTC
                    </p>
                </div>
            </div>

            <ManualBackupWizard open={manualOpen} onClose={() => setManualOpen(false)} status={s} />
            <RestoreWizard open={restoreOpen} onClose={() => setRestoreOpen(false)} status={s} seedBackup={seedBackup} />
        </TooltipProvider>
    );
}
