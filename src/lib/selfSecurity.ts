import { supabase } from '@/lib/supabase';

async function invokeJson<T>(fn: string, body: unknown): Promise<T> {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === 'function') {
            try { const t = await ctx.text(); if (t) return JSON.parse(t) as T; } catch { /* fall through */ }
        }
        return { ok: false, reason: 'error', detail: error.message } as unknown as T;
    }
    return data as T;
}

export interface OtpResult { ok: boolean; reason?: string; detail?: string; verified?: boolean; }

/** Email a fresh OTP to the logged-in user's current email. */
export const requestSelfOtp = () => invokeJson<OtpResult>('self-credential-otp', {});

/** Verify the OTP; pass new_email/new_password to apply, or neither to just verify (login-2FA). */
export const confirmSelfChange = (p: { otp: string; new_email?: string | null; new_password?: string | null }) =>
    invokeJson<OtpResult>('self-credential-confirm', { ...p, origin: window.location.origin });

// ── TOTP authenticator via Supabase native MFA ──
export async function enrollTotp() {
    // Clear any stale UNVERIFIED totp factor left by an abandoned enroll
    // (GoTrue rejects a second factor with the same friendly name → 422).
    const { data: list } = await supabase.auth.mfa.listFactors();
    const stale = (list?.all ?? []).filter((f) => f.factor_type === 'totp' && f.status !== 'verified');
    for (const f of stale) {
        try { await supabase.auth.mfa.unenroll({ factorId: f.id }); } catch { /* ignore */ }
    }
    // issuer = brand shown in the authenticator app (else GoTrue falls back to its host, e.g. 127.0.0.1:3030).
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator', issuer: 'iGrowFast' });
    if (error) throw error;
    return data; // { id, type, totp: { qr_code, secret, uri } }
}
export async function verifyTotpEnroll(factorId: string, code: string) {
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) throw ch.error;
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
    if (error) throw error;
}
export async function listVerifiedTotp() {
    const { data } = await supabase.auth.mfa.listFactors();
    return (data?.totp ?? []).filter((f) => f.status === 'verified');
}
export async function unenrollTotp(factorId: string) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
}

// ── WebAuthn passkey (experimental) ──
export interface PasskeyItem { id: string; friendly_name?: string; created_at: string; last_used_at?: string }

export async function registerOwnPasskey() {
    const { data, error } = await (supabase.auth as any).registerPasskey();
    if (error) throw error;
    return data;
}
export async function listOwnPasskeys(): Promise<PasskeyItem[]> {
    const { data, error } = await (supabase.auth as any).passkey.list();
    if (error) throw error;
    return (data ?? []) as PasskeyItem[];
}
export async function deleteOwnPasskey(passkeyId: string) {
    const { error } = await (supabase.auth as any).passkey.delete({ passkeyId });
    if (error) throw error;
}

/** Map WebAuthn/passkey errors to friendly FR text; flag user cancellations so callers can stay silent. */
export function describePasskeyError(e: unknown): { cancelled: boolean; message: string } {
    const err = e as { name?: string; message?: string };
    const m = `${err?.name ?? ''} ${err?.message ?? ''}`.toLowerCase();
    if (m.includes('notallowed') || m.includes('aborterror') || m.includes('timed out or was not allowed') || m.includes('not allowed') || m.includes('cancel') || m.includes('abort')) {
        return { cancelled: true, message: 'Connexion par clé d’accès annulée.' };
    }
    if (m.includes('no credential') || m.includes('no passkey') || m.includes('not found')) {
        return { cancelled: false, message: 'Aucune clé d’accès trouvée sur cet appareil.' };
    }
    return { cancelled: false, message: 'La clé d’accès a échoué. Réessayez.' };
}

/** True when a GoTrue/apply error message is about password policy (length, weak, leaked). */
function isPasswordPolicyDetail(detail?: string): boolean {
    return /password|weak|pwned|leak|caract|at least|short|guess/i.test(detail ?? '');
}

export function otpReason(reason?: string, detail?: string): string {
    switch (reason) {
        case 'otp_expired': return 'Le code a expiré. Demandez-en un nouveau.';
        case 'otp_invalid': return 'Code incorrect. Réessayez.';
        case 'too_many_attempts': return 'Trop de tentatives. Demandez un nouveau code.';
        case 'email_taken': return 'Cet e-mail est déjà utilisé par un autre compte.';
        case 'invalid_email': return 'Adresse e-mail invalide.';
        case 'weak_password': return 'Mot de passe trop faible. Choisissez un mot de passe plus fort.';
        case 'unauthenticated': return 'Session expirée. Reconnectez-vous.';
        case 'apply_failed':
            return isPasswordPolicyDetail(detail)
                ? 'Ce mot de passe est refusé : trop faible ou déjà compromis. Choisissez-en un autre.'
                : (detail || 'La modification a échoué. Réessayez.');
        default:
            return isPasswordPolicyDetail(detail)
                ? 'Ce mot de passe est refusé : trop faible ou déjà compromis. Choisissez-en un autre.'
                : 'Une erreur est survenue. Réessayez.';
    }
}
