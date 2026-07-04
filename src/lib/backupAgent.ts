import { supabase } from '@/lib/supabase';

// Host-level backup agent (backup-api.igrowfast.com), independent of the compose stack.
const BASE = (import.meta.env.VITE_BACKUP_API_URL as string | undefined)
    ?? 'https://backup-api.igrowfast.com';

/* ── wire types (match the agent JSON) ───────────────────────────────────── */

export type PitrBackup = {
    type: string; label: string;
    start: number | null; stop: number | null;
    db_bytes: number | null; repo_bytes: number | null; error: string | null;
};
export type Heartbeat = { iso: string | null; age_sec: number; max_age_sec: number | null; fresh: boolean };
export type AgentStatus = {
    pitr: { status?: string; wal_min?: string; wal_max?: string; backups?: PitrBackup[]; error?: string };
    archiver: { archived?: number; failed?: number; last?: string; error?: string };
    disk?: { avail_bytes: number; used_pct: number };
    heartbeats: Record<string, Heartbeat>;
    drill_fresh: boolean;
    log_tails: Record<string, string>;
    units: Record<string, string>;
    generated: number;
};
export type BackupFile = { name: string; size: number; key: string };
export type BackupSet = { stamp: string; files: BackupFile[]; bytes: number };
export type RestorePlan = {
    ok: boolean; target: string | null; in_window: boolean | null;
    wal_min_time: string | null; latest_backup_epoch: number | null;
    repo_status: string; drill_fresh: boolean; armed: boolean;
    safety_backup: string; live_orders: number | null; warnings: string[];
};

/* ── auth'd transport ────────────────────────────────────────────────────── */

export class AgentError extends Error {
    constructor(public code: string, message?: string) { super(message ?? code); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new AgentError('no_session');
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session.access_token}` },
    });
    if (res.status === 401) throw new AgentError('unauthorized');
    if (res.status === 403) {
        const b = await res.json().catch(() => ({}));
        throw new AgentError(b?.error === 'aal2_required' ? 'aal2_required' : 'forbidden');
    }
    if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new AgentError(b?.error || `http_${res.status}`, b?.detail);
    }
    return res.json() as Promise<T>;
}

export const backupAgent = {
    status: () => call<AgentStatus>('/api/status'),
    backups: () => call<{ sets: BackupSet[] }>('/api/backups'),
    downloadUrl: (key: string) => call<{ url: string; expires_sec: number }>(`/api/download?key=${encodeURIComponent(key)}`),
    trigger: (job: string) => call<{ started: string; note: string }>(`/api/trigger/${job}`, { method: 'POST' }),
    restorePlan: (body: { mode: 'backup' | 'pitr'; backup_label?: string | null; target_iso?: string | null }) =>
        call<RestorePlan>('/api/restore/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    restore: (body: { mode: 'backup' | 'pitr'; target_iso?: string | null; confirm_timestamp: string; safety_backup: true }) =>
        call<{ started: boolean; mode: string; note: string }>('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
};

/* ── 2FA (aal2) helpers — reused by both wizards ─────────────────────────── */

/** True if the CURRENT session is already aal2 (TOTP-verified). */
export async function sessionIsAal2(): Promise<boolean> {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.currentLevel === 'aal2';
}
/** Whether the user has a verified TOTP factor at all (can they upgrade?). */
export async function hasTotpFactor(): Promise<boolean> {
    const { data } = await supabase.auth.mfa.listFactors();
    return !!data?.totp?.some((f) => f.status === 'verified');
}
/** Upgrade the current session to aal2 with a TOTP code. Returns true on success. */
export async function upgradeToAal2(code: string): Promise<boolean> {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f) => f.status === 'verified');
    if (!totp) return false;
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
    if (chErr || !ch) return false;
    const { error } = await supabase.auth.mfa.verify({ factorId: totp.id, challengeId: ch.id, code });
    return !error;
}

/* ── domain logic (pure) ─────────────────────────────────────────────────── */

export type Verdict = 'sain' | 'attention' | 'incident';

export function computeVerdict(s: AgentStatus): Verdict {
    const hbs = Object.values(s.heartbeats);
    const anyStale2x = hbs.some((h) => h.max_age_sec != null && h.age_sec > 2 * h.max_age_sec);
    const anyErr = (s.pitr.backups ?? []).some((b) => b.error);
    const disk = s.disk?.used_pct ?? 0;
    if (!s.drill_fresh || disk >= 90 || anyStale2x || anyErr) return 'incident';
    const allFresh = hbs.every((h) => h.fresh);
    if (!allFresh || disk >= 80 || (s.archiver.failed ?? 0) > 0) return 'attention';
    return 'sain';
}

export const VERDICT_META: Record<Verdict, { word: string; dot: string; chip: string; accent: string }> = {
    sain: { word: 'Protégé', dot: 'bg-ant-green', chip: 'bg-ant-green-soft text-ant-green', accent: 'bg-ant-green' },
    attention: { word: 'Attention', dot: 'bg-ant-orange', chip: 'bg-ant-orange-soft text-ant-orange', accent: 'bg-ant-orange' },
    incident: { word: 'Incident', dot: 'bg-ant-rose', chip: 'bg-ant-rose-soft text-ant-rose', accent: 'bg-ant-rose' },
};

/** Human, French, one-sentence statement of the SINGLE worst failing thing (or all-clear). */
export function worstFailureSentence(s: AgentStatus): string {
    if (!s.drill_fresh) return 'Restauration non prouvée ce mois-ci — lancez un test.';
    const err = (s.pitr.backups ?? []).find((b) => b.error);
    if (err) return `Une sauvegarde a échoué (${err.label}) — voir les points de restauration.`;
    const disk = s.disk?.used_pct ?? 0;
    if (disk >= 90) return `Disque presque plein (${disk} %) — risque pour les sauvegardes.`;
    const worst = Object.entries(s.heartbeats)
        .filter(([, h]) => h.max_age_sec != null && !h.fresh)
        .sort(([, a], [, b]) => (b.age_sec / (b.max_age_sec || 1)) - (a.age_sec / (a.max_age_sec || 1)))[0];
    if (worst) return `${streamLabel(worst[0])} en retard (${relFr(worst[1].age_sec)}).`;
    if ((s.archiver.failed ?? 0) > 0) return `${s.archiver.failed} archivage(s) WAL en échec.`;
    return `Tout est sain — restauration prouvée, fenêtre de ${walSpanFr(s)}.`;
}

// oneshot systemd units report "activating" while running, "active" (RemainAfterExit),
// "failed" on error, "inactive"/"dead" when finished. Treat the first two as running.
export function unitRunning(state: string | undefined): boolean {
    return state === 'active' || state === 'activating' || state === 'reloading';
}
export function unitFailed(state: string | undefined): boolean {
    return state === 'failed';
}
export function anyUnitActive(s: AgentStatus): boolean {
    return Object.values(s.units).some(unitRunning);
}
export function activeUnitLabel(s: AgentStatus): string | null {
    const u = Object.entries(s.units).find(([, v]) => unitRunning(v));
    return u ? unitLabel(u[0]) : null;
}

/* stream & unit labels ------------------------------------------------------ */

const STREAM_META: Record<string, { label: string; server: string; cadenceSec: number }> = {
    'vmi3390870/pgdump': { label: 'Dump logique', server: 'Box', cadenceSec: 86400 },
    'vmi3390870/pgbackrest-incr': { label: 'PITR incrémental', server: 'Box', cadenceSec: 86400 },
    'vmi3390870/pgbackrest-full': { label: 'PITR complet', server: 'Box', cadenceSec: 604800 },
    'vmi3390870/pgbackrest-verify': { label: 'Vérification dépôt', server: 'Box', cadenceSec: 604800 },
    'vmi3390870/restic': { label: 'Config serveur', server: 'Box', cadenceSec: 86400 },
    'vmi3390870/storage-mirror': { label: 'Miroir stockage', server: 'Box', cadenceSec: 86400 },
    'vmi3390870/restore-drill': { label: 'Exercice de restauration', server: 'Box', cadenceSec: 2592000 },
    'vmi3414204/restic': { label: 'Config serveur', server: 'Toolbox', cadenceSec: 86400 },
    'vmi3414204/db-pull': { label: 'Copie secondaire', server: 'Toolbox', cadenceSec: 604800 },
    'vmi3418398/restic': { label: 'Config serveur', server: 'WhatsApp', cadenceSec: 86400 },
};
export function streamLabel(key: string): string { return STREAM_META[key]?.label ?? key; }
export function streamServer(key: string): string { return STREAM_META[key]?.server ?? key.split('/')[0]; }
export function streamCadence(key: string): number { return STREAM_META[key]?.cadenceSec ?? 86400; }
/** How often the stream runs, as an honest descriptor (never a fake countdown). */
export function streamCadenceLabel(key: string): string {
    const c = streamCadence(key);
    if (c <= 3600) return 'continu';
    if (c <= 86400) return 'quotidien';
    if (c <= 604800) return 'hebdomadaire';
    return 'mensuel';
}

const UNIT_LABEL: Record<string, string> = {
    'igf-pgdump': 'Dump logique', 'igf-pgbackrest-incr': 'PITR incrémental',
    'igf-pgbackrest-full': 'PITR complet', 'igf-pgbackrest-verify': 'Vérification',
    'igf-restic': 'Config serveur', 'igf-storage-mirror': 'Miroir stockage',
    'igf-restore-drill': 'Exercice de restauration', 'igf-restore': 'Restauration',
};
export function unitLabel(u: string): string { return UNIT_LABEL[u] ?? u; }

/* formatters (French) ------------------------------------------------------- */

export function formatBytes(n: number | null | undefined): string {
    if (n == null) return '—';
    if (n < 1024) return `${n} o`;
    const u = ['Ko', 'Mo', 'Go', 'To']; let v = n / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}
export function relFr(sec: number): string {
    if (sec < 0) return 'à l’instant';
    if (sec < 60) return `il y a ${Math.floor(sec)} s`;
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    return `il y a ${Math.floor(sec / 86400)} j`;
}
export function inFr(sec: number): string {
    if (sec <= 0) return 'imminent';
    if (sec < 60) return `dans ${Math.floor(sec)} s`;
    if (sec < 3600) return `dans ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `dans ${Math.floor(sec / 3600)} h`;
    return `dans ${Math.floor(sec / 86400)} j`;
}
const UTC = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function fmtEpochUtc(sec: number | null | undefined): string { return sec ? `${UTC.format(new Date(sec * 1000))} UTC` : '—'; }
export function parseStamp(stamp: string): Date | null {
    const m = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}
/** Parse "YYYY-MM-DD HH:MM:SS+00" (pgBackRest wal_min_time) to Date. */
export function parsePgTime(s: string | null | undefined): Date | null {
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}
/** Earliest restorable instant (epoch sec) = when the oldest retained base backup
 *  became consistent (its stop). null if none. Matches the timestamp shown per row. */
export function walWindowStart(s: AgentStatus): number | null {
    const stops = (s.pitr.backups ?? []).map((b) => b.stop).filter((x): x is number => x != null);
    return stops.length ? Math.min(...stops) : null;
}
/** Human span of the recoverable window, e.g. "6 j 04 h". */
export function walSpanFr(s: AgentStatus): string {
    const start = walWindowStart(s);
    if (!start) return 'en cours de constitution';
    const sec = Math.max(0, s.generated - start);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
    if (d > 0) return `${d} j ${String(h).padStart(2, '0')} h`;
    if (h > 0) return `${h} h`;
    return `${Math.floor(sec / 60)} min`;
}
