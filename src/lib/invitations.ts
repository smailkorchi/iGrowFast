import { supabase } from '@/lib/supabase';

// Roles an admin can invite (owner is excluded — owners are provisioned elsewhere).
export type InviteRole = 'super admin' | 'admin' | 'commercial' | 'courier' | 'mediabuyer';

export interface CreateInvitationInput {
    target_role: InviteRole;
    /** Admin-set authorization fields (everything that is NOT identity). Applied to the user on consume. */
    profile_payload: Record<string, unknown>;
    expires_in_days?: number;
}

export interface CreatedInvitation {
    ok: true;
    id: string;
    target_role: InviteRole;
    expires_at: string;
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
    /** Generated avatar config (stored as users.avatar_config, rendered live). */
    avatar_config?: unknown | null;
    /** Uploaded photo data URL (uploaded to storage → users.avatar_url). */
    avatar_data_url?: string | null;
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
        case 'weak_password': return 'Password must be at least 6 characters.';
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
