import { useQuery } from '@tanstack/react-query';
import {
    ShieldCheck, ShieldAlert, Database, HardDrive, Download, Loader2,
    RefreshCcw, CheckCircle2, XCircle, Clock, Archive, HeartPulse, FileArchive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    backupAgent, formatBytes, formatAge, parseStamp,
    type AgentStatus, type BackupSet,
} from '@/lib/backupAgent';

const fmtUtc = (d: Date | null) =>
    d ? d.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';

function StatCard({ icon: Icon, label, value, tone = 'neutral', sub }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string; value: React.ReactNode; sub?: string;
    tone?: 'good' | 'bad' | 'warn' | 'neutral';
}) {
    const toneCls = {
        good: 'text-ant-green', bad: 'text-ant-rose',
        warn: 'text-ant-orange', neutral: 'text-ant-ink',
    }[tone];
    return (
        <div className="ant-surface rounded-2xl p-4 flex items-start gap-3">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-ant-ink/[0.04]', toneCls)}>
                <Icon className="w-[17px] h-[17px]" />
            </div>
            <div className="min-w-0">
                <div className="font-display text-[9px] uppercase tracking-[0.2em] text-ant-mid">{label}</div>
                <div className={cn('font-display text-[19px] leading-tight tracking-tight mt-0.5', toneCls)}>{value}</div>
                {sub && <div className="text-[11px] text-ant-mid mt-0.5 truncate">{sub}</div>}
            </div>
        </div>
    );
}

function HealthPill({ fresh }: { fresh: boolean }) {
    return (
        <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
            fresh ? 'bg-ant-green/10 text-ant-green' : 'bg-ant-rose/10 text-ant-rose',
        )}>
            {fresh ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {fresh ? 'fresh' : 'stale'}
        </span>
    );
}

const JOB_LABELS: Record<string, string> = {
    'vmi3390870/pgdump': 'Nightly logical dump',
    'vmi3390870/pgbackrest-incr': 'PITR incremental',
    'vmi3390870/pgbackrest-full': 'PITR full',
    'vmi3390870/restic': 'Config backup (box)',
    'vmi3390870/storage-mirror': 'Storage mirror',
    'vmi3390870/restore-drill': 'Restore drill',
    'vmi3414204/restic': 'Config backup (toolbox)',
    'vmi3414204/db-pull': 'Second-location pull',
};

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
    const drillGood = !!s?.drill_fresh;
    const archiverBad = (s?.archiver?.failed ?? 0) > 0;

    const download = async (key: string) => {
        try {
            const { url } = await backupAgent.downloadUrl(key);
            window.open(url, '_blank', 'noopener');
        } catch (e: any) {
            toast({
                variant: 'destructive',
                title: 'Download failed',
                description: e.message === 'forbidden'
                    ? 'Your account is not authorized for backups.'
                    : e.message,
            });
        }
    };

    const authError = status.error && (status.error as Error).message;
    const forbidden = authError === 'forbidden' || authError === 'unauthorized';

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Disaster Recovery
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Backups
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Live health of every backup stream, and the recovery points you can restore from.
                        </p>
                    </div>
                    <button
                        onClick={() => { status.refetch(); backups.refetch(); }}
                        className="self-start inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium text-ant-ink bg-ant-ink/[0.04] hover:bg-ant-ink/[0.08] transition-colors"
                    >
                        <RefreshCcw className={cn('w-3.5 h-3.5', (status.isFetching || backups.isFetching) && 'animate-spin')} />
                        Refresh
                    </button>
                </div>
            </header>

            {forbidden && (
                <div className="ant-surface rounded-2xl p-6 flex items-center gap-3 text-ant-rose">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <div className="text-[13px]">
                        This account does not have backup access. Ask the backup administrator to grant it.
                    </div>
                </div>
            )}

            {status.isLoading && (
                <div className="ant-surface rounded-2xl p-10 flex items-center justify-center gap-2 text-ant-mid">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading backup status…
                </div>
            )}

            {status.isError && !forbidden && (
                <div className="ant-surface rounded-2xl p-6 flex items-center gap-3 text-ant-rose">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <div className="text-[13px]">
                        Could not reach the backup agent ({authError}). The agent or its tunnel may be down —
                        this itself is worth investigating.
                    </div>
                </div>
            )}

            {s && !forbidden && (
                <>
                    {/* Top-line posture */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <StatCard
                            icon={drillGood ? ShieldCheck : ShieldAlert}
                            label="Restore proven"
                            tone={drillGood ? 'good' : 'warn'}
                            value={drillGood ? 'Yes' : 'Unverified'}
                            sub={drillGood ? 'drill passed recently' : 'run a restore drill'}
                        />
                        <StatCard
                            icon={Archive}
                            label="PITR repo"
                            tone={s.pitr?.status === 'ok' ? 'good' : 'bad'}
                            value={s.pitr?.status ?? '—'}
                            sub={s.pitr?.wal_max ? `WAL → ${s.pitr.wal_max.slice(-8)}` : undefined}
                        />
                        <StatCard
                            icon={Database}
                            label="WAL archiver"
                            tone={archiverBad ? 'bad' : 'good'}
                            value={archiverBad ? `${s.archiver.failed} failed` : 'Healthy'}
                            sub={s.archiver?.last ? `last ${s.archiver.last.slice(0, 19)}Z` : undefined}
                        />
                        <StatCard
                            icon={HardDrive}
                            label="Box disk"
                            tone={(s.disk?.used_pct ?? 0) >= 80 ? 'warn' : 'neutral'}
                            value={s.disk ? `${s.disk.used_pct}%` : '—'}
                            sub={s.disk ? `${formatBytes(s.disk.avail_bytes)} free` : undefined}
                        />
                    </div>

                    {/* Job heartbeats */}
                    <section className="ant-surface rounded-2xl p-4 md:p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <HeartPulse className="w-4 h-4 text-ant-orange" />
                            <h2 className="font-display text-[14px] tracking-tight text-ant-ink">Backup streams</h2>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                            {Object.entries(s.heartbeats)
                                .filter(([k]) => !k.startsWith('_'))
                                .sort(([a], [b]) => (JOB_LABELS[a] ?? a).localeCompare(JOB_LABELS[b] ?? b))
                                .map(([key, hb]) => (
                                    <div key={key} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-ant-ink/[0.02]">
                                        <div className="min-w-0">
                                            <div className="text-[12.5px] text-ant-ink truncate">{JOB_LABELS[key] ?? key}</div>
                                            <div className="text-[10.5px] text-ant-mid">
                                                {hb.age_sec >= 0 ? formatAge(hb.age_sec) : '—'}
                                                <span className="text-ant-mid/50"> · {key.split('/')[0]}</span>
                                            </div>
                                        </div>
                                        <HealthPill fresh={hb.fresh} />
                                    </div>
                                ))}
                        </div>
                    </section>

                    {/* Recovery points: PITR chain */}
                    <section className="ant-surface rounded-2xl p-4 md:p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <Clock className="w-4 h-4 text-ant-orange" />
                            <h2 className="font-display text-[14px] tracking-tight text-ant-ink">Point-in-time recovery chain</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[12px] min-w-[520px]">
                                <thead>
                                    <tr className="text-ant-mid text-left">
                                        <th className="font-medium py-1.5 pr-3">Type</th>
                                        <th className="font-medium py-1.5 pr-3">Taken (UTC)</th>
                                        <th className="font-medium py-1.5 pr-3">DB size</th>
                                        <th className="font-medium py-1.5 pr-3">Repo size</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(s.pitr?.backups ?? []).slice().reverse().map((b) => (
                                        <tr key={b.label} className="border-t border-ant-ink/[0.06]">
                                            <td className="py-1.5 pr-3">
                                                <span className={cn(
                                                    'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                                    b.type === 'full' ? 'bg-ant-orange/10 text-ant-orange' : 'bg-ant-ink/[0.06] text-ant-mid',
                                                )}>{b.type}</span>
                                            </td>
                                            <td className="py-1.5 pr-3 text-ant-ink tabular-nums">
                                                {b.stop ? new Date(b.stop * 1000).toISOString().slice(0, 19).replace('T', ' ') : '—'}
                                            </td>
                                            <td className="py-1.5 pr-3 text-ant-mid tabular-nums">{formatBytes(b.db_bytes)}</td>
                                            <td className="py-1.5 pr-3 text-ant-mid tabular-nums">{formatBytes(b.repo_bytes)}</td>
                                        </tr>
                                    ))}
                                    {!(s.pitr?.backups ?? []).length && (
                                        <tr><td colSpan={4} className="py-3 text-ant-mid text-center">No PITR backups reported.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {s.pitr?.wal_min && s.pitr?.wal_max && (
                            <p className="text-[11px] text-ant-mid mt-2">
                                Continuous WAL archived — restore to any moment from the oldest full backup up to now.
                            </p>
                        )}
                    </section>

                    {/* Logical dumps: downloadable */}
                    <section className="ant-surface rounded-2xl p-4 md:p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <FileArchive className="w-4 h-4 text-ant-orange" />
                            <h2 className="font-display text-[14px] tracking-tight text-ant-ink">Logical dumps</h2>
                            <span className="text-[11px] text-ant-mid">· age-encrypted, downloadable</span>
                        </div>
                        {backups.isLoading && (
                            <div className="flex items-center gap-2 text-ant-mid text-[12px] py-3">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Listing dumps…
                            </div>
                        )}
                        <div className="space-y-2">
                            {(backups.data?.sets ?? []).map((set) => (
                                <div key={set.stamp} className="rounded-xl border border-ant-ink/[0.06] p-3">
                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <div className="text-[12.5px] font-medium text-ant-ink">
                                            {fmtUtc(parseStamp(set.stamp))}
                                        </div>
                                        <div className="text-[11px] text-ant-mid">{formatBytes(set.bytes)}</div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {set.files.map((f) => (
                                            <button
                                                key={f.key}
                                                onClick={() => download(f.key)}
                                                className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] text-ant-ink bg-ant-ink/[0.04] hover:bg-ant-ink/[0.08] transition-colors"
                                                title={`Download ${f.name} (${formatBytes(f.size)})`}
                                            >
                                                <Download className="w-3 h-3" />
                                                {f.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {backups.data && !backups.data.sets.length && (
                                <div className="text-ant-mid text-[12px] py-3 text-center">No logical dumps found.</div>
                            )}
                        </div>
                    </section>

                    <p className="text-[10.5px] text-ant-mid/70 text-center pt-1">
                        Read-only view · status refreshes every 60s · generated {new Date(s.generated * 1000).toISOString().slice(11, 19)}Z
                    </p>
                </>
            )}
        </div>
    );
}
