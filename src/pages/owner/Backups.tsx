import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    AlertCircle, ArrowUpRight, Download, Loader2, RefreshCcw, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    backupAgent, formatBytes, parseStamp,
    type AgentStatus, type BackupSet, type Heartbeat,
} from '@/lib/backupAgent';

/* ── formatting ──────────────────────────────────────────────────────────── */

const utcFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
});
const fmtUtc = (d: Date | null) => (d ? `${utcFmt.format(d)} UTC` : '—');
const fmtEpochUtc = (sec: number | null | undefined) =>
    sec ? fmtUtc(new Date(sec * 1000)) : '—';

function ilYA(sec: number): string {
    if (sec < 60) return `il y a ${sec} s`;
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    return `il y a ${Math.floor(sec / 86400)} j`;
}

/* ── stream labels ───────────────────────────────────────────────────────── */

const STREAMS: Record<string, { label: string; detail: string }> = {
    'vmi3390870/pgdump': { label: 'Dump logique nocturne', detail: 'base complète · chiffré age' },
    'vmi3390870/pgbackrest-incr': { label: 'PITR — incrémental', detail: 'pgBackRest · lun–sam 01:45' },
    'vmi3390870/pgbackrest-full': { label: 'PITR — complet', detail: 'pgBackRest · dimanche 01:45' },
    'vmi3390870/pgbackrest-verify': { label: 'PITR — vérification du dépôt', detail: 'intégrité · samedi 04:15' },
    'vmi3390870/restic': { label: 'Configuration serveur', detail: 'box principale · restic' },
    'vmi3390870/storage-mirror': { label: 'Miroir du stockage', detail: 'uploads utilisateurs · 02:30' },
    'vmi3390870/restore-drill': { label: 'Exercice de restauration', detail: 'preuve de restaurabilité' },
    'vmi3414204/restic': { label: 'Configuration serveur', detail: 'toolbox · restic' },
    'vmi3414204/db-pull': { label: 'Copie secondaire', detail: 'toolbox · dimanche 06:10' },
    'vmi3418398/restic': { label: 'Configuration serveur', detail: 'box WhatsApp · restic' },
};

/* ── shared section shell (Vue d'ensemble vocabulary) ────────────────────── */

function Section({ number, title, subtitle, accent, children }: {
    number: string; title: string; subtitle: string;
    accent: 'bg-ant-ink' | 'bg-ant-orange' | 'bg-ant-green' | 'bg-ant-rose';
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className={cn('h-[3px] w-full', accent)} />
            <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                <div className="flex items-center gap-2">
                    <span className="font-display text-[11px] text-ant-orange">{number}</span>
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        {title}
                    </span>
                </div>
                <p className="font-serif italic text-[12px] text-ant-mid mt-1">{subtitle}</p>
            </div>
            {children}
        </section>
    );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function OwnerBackups() {
    const { toast } = useToast();

    const status = useQuery<AgentStatus>({
        queryKey: ['backup-status'],
        queryFn: backupAgent.status,
        refetchInterval: 60_000,
        retry: 1,
    });
    const backups = useQuery<{ sets: BackupSet[] }>({
        queryKey: ['backup-sets'],
        queryFn: backupAgent.backups,
        retry: 1,
    });

    const s = status.data;

    const streams = useMemo(() => {
        if (!s) return [] as Array<[string, Heartbeat]>;
        return Object.entries(s.heartbeats)
            .filter(([k]) => !k.startsWith('_'))
            .sort(([a], [b]) => (STREAMS[a]?.label ?? a).localeCompare(STREAMS[b]?.label ?? b, 'fr'));
    }, [s]);

    const freshCount = streams.filter(([, hb]) => hb.fresh).length;
    const allFresh = streams.length > 0 && freshCount === streams.length;
    const archiverFailed = s?.archiver?.failed ?? 0;
    const drillGood = !!s?.drill_fresh;
    const pitrOk = s?.pitr?.status === 'ok';

    const download = async (key: string, name: string) => {
        try {
            const { url } = await backupAgent.downloadUrl(key);
            window.open(url, '_blank', 'noopener');
        } catch (e) {
            toast({
                variant: 'destructive',
                title: 'Téléchargement impossible',
                description: (e as Error).message === 'forbidden'
                    ? 'Ce compte n’est pas autorisé pour les sauvegardes.'
                    : `${name} — ${(e as Error).message}`,
            });
        }
    };

    const errMsg = status.error ? (status.error as Error).message : null;
    const forbidden = errMsg === 'forbidden' || errMsg === 'unauthorized';

    /* loading */
    if (status.isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-5 h-5 animate-spin text-ant-mid" />
            </div>
        );
    }

    /* agent unreachable / not authorized */
    if (status.isError || !s) {
        return (
            <div className="space-y-5 md:space-y-6">
                <PageHeader onRefresh={() => { status.refetch(); backups.refetch(); }} fetching={status.isFetching} />
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-rose" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <AlertCircle className="w-6 h-6 text-ant-rose" />
                        <div className="space-y-1">
                            <p className="font-display text-[14px] text-ant-ink">
                                {forbidden ? 'Accès non autorisé' : 'Agent de sauvegarde injoignable'}
                            </p>
                            <p className="font-serif italic text-[12px] text-ant-mid max-w-sm mx-auto">
                                {forbidden
                                    ? 'Ce compte ne dispose pas du privilège sauvegardes. Il se donne depuis la fiche utilisateur, par le compte racine.'
                                    : `L’agent ou son tunnel ne répond pas (${errMsg}). En soi un signal à investiguer.`}
                            </p>
                        </div>
                        {!forbidden && (
                            <button
                                type="button"
                                onClick={() => status.refetch()}
                                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors"
                            >
                                Réessayer
                            </button>
                        )}
                    </div>
                </section>
            </div>
        );
    }

    /* KPI hairline strip */
    const kpi: Array<{ title: string; value: string; sub: string; accent: string }> = [
        {
            title: 'Restauration',
            value: drillGood ? 'Prouvée' : 'À prouver',
            sub: drillGood ? 'exercice récent réussi' : 'lancer un exercice',
            accent: drillGood ? 'bg-ant-green' : 'bg-ant-orange',
        },
        {
            title: 'Dépôt PITR',
            value: pitrOk ? 'Sain' : (s.pitr?.status ?? 'Erreur'),
            sub: 'chiffré · Cloudflare R2',
            accent: pitrOk ? 'bg-ant-green' : 'bg-ant-rose',
        },
        {
            title: 'Archivage WAL',
            value: archiverFailed === 0 ? 'Continu' : `${archiverFailed} échecs`,
            sub: s.archiver?.last ? `dernier segment ${s.archiver.last.slice(11, 19)} UTC` : '—',
            accent: archiverFailed === 0 ? 'bg-ant-green' : 'bg-ant-rose',
        },
        {
            title: 'Flux',
            value: `${freshCount}/${streams.length}`,
            sub: allFresh ? 'tous à l’heure' : 'flux en retard',
            accent: allFresh ? 'bg-ant-ink' : 'bg-ant-rose',
        },
        {
            title: 'Dumps logiques',
            value: String(backups.data?.sets.length ?? '—'),
            sub: 'chiffrés · téléchargeables',
            accent: 'bg-ant-ink',
        },
        {
            title: 'Disque serveur',
            value: s.disk ? `${s.disk.used_pct}%` : '—',
            sub: s.disk ? `${formatBytes(s.disk.avail_bytes)} libres` : '—',
            accent: (s.disk?.used_pct ?? 0) >= 80 ? 'bg-ant-orange' : 'bg-ant-ink',
        },
    ];

    return (
        <div className="space-y-5 md:space-y-6">
            <PageHeader onRefresh={() => { status.refetch(); backups.refetch(); }} fetching={status.isFetching || backups.isFetching} />

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                {kpi.map((card) => (
                    <div key={card.title} className="bg-ant-paper p-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className={cn('w-1 h-4 rounded-full', card.accent)} />
                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate flex-1">
                                {card.title}
                            </span>
                        </div>
                        <p className="font-display text-[22px] leading-none tabular-nums text-ant-ink">
                            {card.value}
                        </p>
                        <p className="font-serif italic text-[11px] text-ant-mid leading-tight">
                            {card.sub}
                        </p>
                    </div>
                ))}
            </div>

            {/* 01 — streams */}
            <Section
                number="01"
                title="Flux de sauvegarde"
                subtitle="Chaque flux émet un battement après un passage réussi — la fraîcheur fait foi."
                accent="bg-ant-ink"
            >
                <div className="grid grid-cols-1 lg:grid-cols-2">
                    {streams.map(([key, hb], i) => {
                        const meta = STREAMS[key] ?? { label: key, detail: key.split('/')[0] };
                        return (
                            <div
                                key={key}
                                className={cn(
                                    'flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-ant-line',
                                    i >= streams.length - (streams.length % 2 === 0 ? 2 : 1) && 'lg:border-b-0',
                                    i === streams.length - 1 && 'border-b-0',
                                    i % 2 === 0 && 'lg:border-r lg:border-r-ant-line',
                                )}
                            >
                                <div className="min-w-0">
                                    <p className="font-display text-[13px] text-ant-ink leading-tight truncate">
                                        {meta.label}
                                    </p>
                                    <p className="font-serif italic text-[11px] text-ant-mid mt-0.5 truncate">
                                        {meta.detail}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-[11px] text-ant-mid tabular-nums">{ilYA(hb.age_sec)}</span>
                                    <span
                                        className={cn(
                                            'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[10px] font-medium tracking-wide',
                                            hb.fresh
                                                ? 'bg-ant-green/10 text-ant-green'
                                                : 'bg-ant-rose/10 text-ant-rose',
                                        )}
                                    >
                                        <span className={cn('w-1 h-1 rounded-full', hb.fresh ? 'bg-ant-green' : 'bg-ant-rose')} />
                                        {hb.fresh ? 'à l’heure' : 'en retard'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Section>

            {/* 02 — PITR chain */}
            <Section
                number="02"
                title="Restauration continue (PITR)"
                subtitle="Sauvegardes de base + archivage WAL — retour possible à n’importe quelle minute."
                accent="bg-ant-orange"
            >
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px]">
                        <thead>
                            <tr className="border-b border-ant-line">
                                {['Type', 'Horodatage (UTC)', 'Base', 'Dépôt R2'].map((h) => (
                                    <th key={h} className="text-left px-4 md:px-6 py-2.5 text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(s.pitr?.backups ?? []).slice().reverse().map((b) => (
                                <tr key={b.label} className="border-b border-ant-line last:border-b-0">
                                    <td className="px-4 md:px-6 py-3">
                                        <span className={cn(
                                            'inline-flex h-6 items-center px-2.5 rounded-full text-[10px] font-medium',
                                            b.type === 'full'
                                                ? 'bg-ant-orange/10 text-ant-orange'
                                                : 'bg-ant-ink/[0.05] text-ant-mid',
                                        )}>
                                            {b.type === 'full' ? 'complet' : b.type === 'incr' ? 'incrémental' : b.type}
                                        </span>
                                    </td>
                                    <td className="px-4 md:px-6 py-3 font-display text-[12.5px] text-ant-ink tabular-nums whitespace-nowrap">
                                        {fmtEpochUtc(b.stop)}
                                    </td>
                                    <td className="px-4 md:px-6 py-3 text-[12px] text-ant-mid tabular-nums">{formatBytes(b.db_bytes)}</td>
                                    <td className="px-4 md:px-6 py-3 text-[12px] text-ant-mid tabular-nums">{formatBytes(b.repo_bytes)}</td>
                                </tr>
                            ))}
                            {!(s.pitr?.backups ?? []).length && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-10 text-center font-serif italic text-[12px] text-ant-mid">
                                        Aucune sauvegarde PITR signalée.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {pitrOk && (
                    <div className="px-4 md:px-6 py-3 border-t border-ant-line flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-ant-green shrink-0" />
                        <p className="font-serif italic text-[11.5px] text-ant-mid">
                            Le journal WAL est archivé en continu — la fenêtre de restauration couvre chaque instant
                            depuis la plus ancienne sauvegarde complète.
                        </p>
                    </div>
                )}
            </Section>

            {/* 03 — logical dumps */}
            <Section
                number="03"
                title="Dumps logiques"
                subtitle="Exports complets chiffrés (age) — téléchargement par lien signé, valable 10 minutes."
                accent="bg-ant-green"
            >
                {backups.isLoading ? (
                    <div className="px-6 py-10 flex items-center justify-center gap-2 text-ant-mid">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="font-serif italic text-[12px]">Inventaire en cours…</span>
                    </div>
                ) : (
                    <div>
                        {(backups.data?.sets ?? []).map((set, i) => (
                            <div
                                key={set.stamp}
                                className={cn(
                                    'px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center gap-3 border-b border-ant-line last:border-b-0',
                                    i === 0 && 'bg-ant-light/40',
                                )}
                            >
                                <div className="md:w-64 shrink-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-display text-[13.5px] text-ant-ink tabular-nums">
                                            {fmtUtc(parseStamp(set.stamp))}
                                        </p>
                                        {i === 0 && (
                                            <span className="inline-flex h-5 items-center px-2 rounded-full bg-ant-green/10 text-ant-green text-[9px] font-medium uppercase tracking-[0.14em]">
                                                récent
                                            </span>
                                        )}
                                    </div>
                                    <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">
                                        {set.files.length} fichiers · {formatBytes(set.bytes)}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {set.files.map((f) => (
                                        <button
                                            key={f.key}
                                            onClick={() => download(f.key, f.name)}
                                            title={`${f.name} · ${formatBytes(f.size)}`}
                                            className="group inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-[11px] font-medium text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                        >
                                            <Download className="w-3 h-3 text-ant-mid group-hover:text-ant-light transition-colors" />
                                            {f.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {backups.data && !backups.data.sets.length && (
                            <p className="px-6 py-10 text-center font-serif italic text-[12px] text-ant-mid">
                                Aucun dump logique trouvé.
                            </p>
                        )}
                    </div>
                )}
            </Section>

            <p className="font-serif italic text-[11px] text-ant-mid/70 text-center">
                Lecture seule · actualisation automatique chaque minute · état généré à{' '}
                {new Date(s.generated * 1000).toISOString().slice(11, 19)} UTC
            </p>
        </div>
    );
}

/* ── header ──────────────────────────────────────────────────────────────── */

function PageHeader({ onRefresh, fetching }: { onRefresh: () => void; fetching: boolean }) {
    return (
        <header className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                    Platform · Sauvegardes
                </span>
            </div>
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                <div className="space-y-1.5">
                    <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                        Sauvegardes
                    </h1>
                    <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                        Santé de chaque flux, points de restauration et exports — en direct depuis le serveur.
                    </p>
                </div>
                <div className="flex items-center gap-1.5">
                    <a
                        href="https://backup-api.igrowfast.com/health"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                    >
                        Agent <ArrowUpRight className="w-3 h-3" />
                    </a>
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full bg-ant-ink text-ant-light text-[11px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_8px_20px_-8px_rgba(20,20,19,0.45)]"
                    >
                        <RefreshCcw className={cn('w-3 h-3', fetching && 'animate-spin')} />
                        Actualiser
                    </button>
                </div>
            </div>
        </header>
    );
}
