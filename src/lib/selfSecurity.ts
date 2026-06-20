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
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
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

export function otpReason(reason?: string): string {
    switch (reason) {
        case 'otp_expired': return 'Le code a expiré. Demandez-en un nouveau.';
        case 'otp_invalid': return 'Code incorrect. Réessayez.';
        case 'too_many_attempts': return 'Trop de tentatives. Demandez un nouveau code.';
        case 'email_taken': return 'Cet e-mail est déjà utilisé par un autre compte.';
        case 'invalid_email': return 'Adresse e-mail invalide.';
        case 'weak_password': return 'Le mot de passe doit faire au moins 6 caractères.';
        case 'unauthenticated': return 'Session expirée. Reconnectez-vous.';
        default: return 'Une erreur est survenue. Réessayez.';
    }
}
