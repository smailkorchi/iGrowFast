import { supabase } from '@/lib/supabase';

// Roles an admin can invite (owner is excluded — owners are provisioned elsewhere).
export type InviteRole = 'super admin' | 'admin' | 'commercial' | 'courier' | 'mediabuyer';

export interface CreateInvitationInput {
    target_role: InviteRole;
    /** Invitee email the admin knows — where the link/reminder/revocation notices are sent. Verified server-side. */
    email: string;
    /** Admin-set authorization fields (everything that is NOT identity). Applied to the user on consume. */
    profile_payload: Record<string, unknown>;
    expires_in_days?: number;
}

export interface CreatedInvitation {
    ok: true;
    id: string;
    target_role: InviteRole;
    expires_at: string;
    email: string;
    token: string;
    link: string;
}

export interface InvitationStatus {
    ok: boolean;
    reason?: string;
    target_role?: string;
    expires_at?: string;
    detail?: string;
}

export interface ConsumeInput {
    token: string;
    name: string;
    username: string;
    email: string;
    password: string;
    /** 6-digit email-confirmation code issued by requestSignupOtp. */
    otp: string;
    /** Generated avatar config (stored as users.avatar_config, rendered live). */
    avatar_config?: unknown | null;
    /** Uploaded photo data URL (uploaded to storage → users.avatar_url). */
    avatar_data_url?: string | null;
}

export interface EmailCheckResult {
    ok: boolean;
    /** Set when ok: the domain can receive mail. */
    deliverable?: boolean;
    /** typo | disposable | no_mx | invalid_email | error */
    reason?: string;
    /** For reason 'typo': the corrected address to suggest. */
    suggestion?: string;
}

export interface SignupOtpResult {
    ok: boolean;
    reason?: string;
    suggestion?: string;
    detail?: string;
}

export interface ConsumeResult {
    ok: boolean;
    reason?: string;
    detail?: string;
    target_role?: string;
}

/**
 * Invoke an edge function and always resolve to its JSON body — even on non-2xx,
 * where supabase-js surfaces the response inside `error.context` instead of `data`.
 */
async function invokeJson<T>(fn: string, body: unknown): Promise<T> {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === 'function') {
            try {
                const text = await ctx.text();
                if (text) return JSON.parse(text) as T;
            } catch { /* fall through */ }
        }
        return { ok: false, reason: 'error', detail: error.message } as unknown as T;
    }
    return data as T;
}

export async function createInvitation(input: CreateInvitationInput): Promise<CreatedInvitation> {
    const res = await invokeJson<CreatedInvitation & { error?: string; detail?: string }>('create-invitation', {
        ...input,
        origin: window.location.origin,
    });
    if (!res?.ok) throw new Error(res?.error || res?.detail || 'Failed to create the invitation link.');
    return res;
}

export function checkInvitation(token: string): Promise<InvitationStatus> {
    return invokeJson<InvitationStatus>('check-invitation', { token });
}

export function consumeInvitation(input: ConsumeInput): Promise<ConsumeResult> {
    return invokeJson<ConsumeResult>('consume-invitation', input);
}

/** Verify an email is real/working (syntax + typo + disposable + mailbox-level) without side effects. */
export function checkSignupEmail(token: string, email: string): Promise<EmailCheckResult> {
    return invokeJson<EmailCheckResult>('signup-email', { action: 'check', token, email: email.trim().toLowerCase() });
}

/** Admin-side deliverability check for the invitee email — runs BEFORE an invite exists (no token gate). */
export function checkInviteEmail(email: string): Promise<EmailCheckResult> {
    return invokeJson<EmailCheckResult>('create-invitation', { action: 'check_email', email: email.trim().toLowerCase() });
}

/** Re-validate the email and send a 6-digit confirmation code to it (gated by a valid invite). */
export function requestSignupOtp(token: string, email: string): Promise<SignupOtpResult> {
    return invokeJson<SignupOtpResult>('signup-email', {
        action: 'send', token, email: email.trim().toLowerCase(), origin: window.location.origin,
    });
}

export interface SendInvitationResult {
    ok: boolean;
    reason?: string;
    detail?: string;
}

/** Email the (already-created) invitation link to its stored recipient via the `invitation` template. */
export function sendInvitationEmail(token: string): Promise<SendInvitationResult> {
    return invokeJson<SendInvitationResult>('send-invitation', {
        action: 'send', token, origin: window.location.origin,
    });
}

/** Card action — rotate the token + email the `invitation_reminder` template.
 *  `email` supplies a recipient when the invite has none on file (prompt-modal flow). */
export function remindInvitation(invitationId: string, email?: string): Promise<SendInvitationResult> {
    return invokeJson<SendInvitationResult>('send-invitation', {
        action: 'remind', invitation_id: invitationId, origin: window.location.origin,
        ...(email ? { email: email.trim().toLowerCase() } : {}),
    });
}

/** Card action — revoke the invitation (always) + email the `invitation_revoked` notice when an email is known. */
export function revokeInvitation(invitationId: string, email?: string): Promise<SendInvitationResult> {
    return invokeJson<SendInvitationResult>('send-invitation', {
        action: 'revoke', invitation_id: invitationId,
        ...(email ? { email: email.trim().toLowerCase() } : {}),
    });
}

/** Card action — hard-delete a revoked/expired invitation row (removes its card). */
export function deleteInvitation(invitationId: string): Promise<SendInvitationResult> {
    return invokeJson<SendInvitationResult>('send-invitation', { action: 'delete', invitation_id: invitationId });
}

export interface PendingInvitation {
    id: string;
    email: string | null;
    target_role: string;
    expires_at: string;
    created_at: string;
    consumed_at: string | null;
    revoked_at: string | null;
    reminder_sent_at: string | null;
}

// Human-readable copy for invitation problem states.
export function invitationReason(reason?: string): string {
    switch (reason) {
        case 'not_found':
        case 'invalid':
        case 'invalid_token': return 'This invitation link is invalid.';
        case 'expired': return 'This invitation has expired. Ask an admin for a new link.';
        case 'consumed':
        case 'invalid_or_used': return 'This invitation has already been used.';
        case 'revoked': return 'This invitation was revoked.';
        case 'email_taken': return 'That email is already registered. Use a different one.';
        case 'invalid_email': return 'Enter a valid email address.';
        case 'invalid_username': return 'Username must be at least 3 characters.';
        case 'invalid_name': return 'Enter your full name.';
        case 'weak_password': return 'Password too weak. Choose a stronger one.';
        // Email-deliverability check (signup-email action=check/send)
        case 'disposable': return 'Disposable or temporary email addresses are not allowed.';
        case 'no_mx': return 'This email domain can’t receive mail. Check the address.';
        case 'undeliverable': return 'This email address doesn’t exist or can’t receive mail.';
        case 'typo': return 'This email looks misspelled.';
        case 'too_many_sends': return 'Too many codes requested. Use the latest code, or ask an admin for a new link.';
        case 'resend_cooldown': return 'Please wait a few seconds before requesting another code.';
        // Email-confirmation OTP (consume-invitation)
        case 'otp_required': return 'Confirm your email first — request a code.';
        case 'otp_expired': return 'The code expired. Request a new one.';
        case 'otp_invalid': return 'Incorrect code. Check it and try again.';
        case 'too_many_attempts': return 'Too many attempts. Request a new code.';
        case 'email_mismatch': return 'This code was sent to a different email. Restart the step.';
        // Send-invitation (email the link)
        case 'send_failed': return 'The email could not be sent. Try again or copy the link instead.';
        case 'not_found': return 'This invitation no longer exists.';
        case 'forbidden': return 'You can’t send this invitation.';
        default: return 'Something went wrong. Please try again.';
    }
}

// Page list an admin can grant to an invited admin (mirrors src/pages/admin/Users.tsx `pages`).
export const USER_PAGES: { label: string; path: string }[] = [
    { label: 'Dashboard', path: '/' },
    { label: 'Orders', path: '/orders' },
    { label: 'Delivery Note', path: '/delivery-note' },
    { label: 'Return Note', path: '/return-note' },
    { label: 'Delivery Services', path: '/delivery-services' },
    { label: 'Payments', path: '/payments' },
    { label: 'Webhooks', path: '/webhooks' },
    { label: 'Transactions', path: '/transactions' },
    { label: 'Products', path: '/products' },
    { label: 'Accessories', path: '/accessories' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'Sales Channels', path: '/sales-channels' },
    { label: 'Customers', path: '/customers' },
    { label: 'Users', path: '/users' },
    { label: 'Collaborators — Sellers', path: '/collaborators/sellers' },
    { label: 'Collaborators — Couriers', path: '/collaborators/couriers' },
    { label: 'Collaborators — Media Buyers', path: '/collaborators/mediabuyers' },
    { label: 'Business — Overview', path: '/business' },
    { label: 'Business — Payments', path: '/business/payments' },
    { label: 'Demands', path: '/demands' },
    { label: 'Salaries', path: '/salaries' },
    { label: 'Product Ads', path: '/ads-history' },
    { label: 'Global Ads', path: '/campaigns' },
    { label: 'Expenses Details', path: '/expenses-details' },
    { label: 'Expenses Types', path: '/expenses-types' },
    { label: 'Import Orders', path: '/import-orders' },
    { label: 'Import Products', path: '/import-products' },
    { label: 'Import Accessories', path: '/import-accessories' },
    { label: 'Import Customers', path: '/import-customers' },
    { label: 'Profit Calculator', path: '/calculator' },
    { label: 'Devis', path: '/devis' },
    { label: 'Facture', path: '/facture' },
    { label: 'Bon de commande', path: '/bon-de-commande' },
    { label: 'Bon de livraison', path: '/bon-de-livraison' },
];
