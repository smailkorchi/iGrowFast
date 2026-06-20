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

export interface CredTokenStatus { ok: boolean; reason?: string; email?: string | null; name?: string | null; }
export interface CredResult { ok: boolean; reason?: string; detail?: string; email_changed?: boolean; password_changed?: boolean; }

export const checkCredentialToken = (token: string) => invokeJson<CredTokenStatus>('check-credential-token', { token });
export const requestCredentialOtp = (token: string) => invokeJson<{ ok: boolean; reason?: string }>('request-credential-otp', { token });
export const confirmCredentialChange = (p: { token: string; otp: string; new_email?: string | null; new_password?: string | null; }) =>
    invokeJson<CredResult>('confirm-credential-change', { ...p, origin: window.location.origin });

/** Admin action: email the target user a credential-change link. Throws on failure. */
export async function requestCredentialChange(userId: string): Promise<{ ok: boolean; email?: string }> {
    const res = await invokeJson<{ ok?: boolean; email?: string; error?: string }>('request-credential-change', {
        user_id: userId, origin: window.location.origin,
    });
    if (!res?.ok) throw new Error(res?.error || 'Could not send the link.');
    return { ok: true, email: res.email };
}

export function credReason(reason?: string): string {
    switch (reason) {
        case 'invalid': return 'This link is invalid.';
        case 'used': return 'This link has already been used.';
        case 'expired': return 'This link has expired. Ask an admin to send a new one.';
        case 'invalid_or_used': return 'This link is no longer valid.';
        case 'otp_expired': return 'The code expired. Request a new one.';
        case 'otp_invalid': return 'Incorrect code. Check it and try again.';
        case 'too_many_attempts': return 'Too many attempts. Request a new code.';
        case 'email_taken': return 'That email is already used by another account.';
        case 'invalid_email': return 'Enter a valid email address.';
        case 'weak_password': return 'Password must be at least 6 characters.';
        case 'nothing_to_change': return 'Enter a new email or a new password.';
        default: return 'Something went wrong. Please try again.';
    }
}
