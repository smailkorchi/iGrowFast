import { supabase } from '@/lib/supabase';

// Base URL of the host-level backup agent (backup-api.igrowfast.com).
// Falls back to the production host so the page works even if the env var is
// absent in a given build; override with VITE_BACKUP_API_URL for staging.
const BASE = (import.meta.env.VITE_BACKUP_API_URL as string | undefined)
    ?? 'https://backup-api.igrowfast.com';

export type PitrBackup = {
    type: string;
    label: string;
    start: number | null;
    stop: number | null;
    db_bytes: number | null;
    repo_bytes: number | null;
    error: string | null;
};

export type Heartbeat = {
    iso: string | null;
    age_sec: number;
    max_age_sec: number | null;
    fresh: boolean;
};

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

/** Authenticated GET/POST against the agent using the live Supabase session JWT. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('No active session');
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            ...(init?.headers ?? {}),
            Authorization: `Bearer ${session.access_token}`,
        },
    });
    if (res.status === 401) throw new Error('unauthorized');
    if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error === 'aal2_required' ? 'aal2_required' : 'forbidden');
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export const backupAgent = {
    status: () => call<AgentStatus>('/api/status'),
    backups: () => call<{ sets: BackupSet[] }>('/api/backups'),
    /** Returns a short-lived presigned R2 URL for a logical/ object. */
    downloadUrl: (key: string) =>
        call<{ url: string; expires_sec: number }>(`/api/download?key=${encodeURIComponent(key)}`),
    /** aal2 (TOTP) session required; throws 'aal2_required' otherwise. */
    trigger: (job: string) =>
        call<{ started: string; note: string }>(`/api/trigger/${job}`, { method: 'POST' }),
};

export function formatBytes(n: number | null | undefined): string {
    if (n == null) return '—';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatAge(sec: number): string {
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
}

/** Parse a dump-set stamp (YYYYMMDDTHHMMSSZ) into a Date. */
export function parseStamp(stamp: string): Date | null {
    const m = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}
