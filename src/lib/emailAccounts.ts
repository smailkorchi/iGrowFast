import { supabase } from '@/lib/supabase';
import { edgeFnErrorMessage } from '@/lib/edgeError';

export type EmailSecurity = 'ssl' | 'tls' | 'starttls' | 'none';

export interface EmailAccount {
    id: string;
    name: string;
    from_name: string | null;
    email_address: string;
    username: string;
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_security: EmailSecurity;
    imap_host: string | null;
    imap_port: number | null;
    imap_security: EmailSecurity | null;
    pop3_host: string | null;
    pop3_port: number | null;
    pop3_security: EmailSecurity | null;
    is_active: boolean;
    last_test_at: string | null;
    last_test_ok: boolean | null;
    last_test_error: string | null;
    created_at: string;
    updated_at: string;
}

// What the modal sends to the edge function. Ports are numbers|null; password is
// only present on create or when rotating.
export interface EmailAccountInput {
    name: string;
    from_name?: string | null;
    email_address: string;
    username: string;
    password?: string;
    smtp_host?: string | null;
    smtp_port?: number | null;
    smtp_security?: EmailSecurity;
    imap_host?: string | null;
    imap_port?: number | null;
    imap_security?: EmailSecurity | null;
    pop3_host?: string | null;
    pop3_port?: number | null;
    pop3_security?: EmailSecurity | null;
    is_active?: boolean;
}

const FN = 'manage-email-accounts';

// Reads go straight through RLS (owner-only SELECT). The password never leaves Vault.
export async function fetchEmailAccounts(): Promise<EmailAccount[]> {
    const { data, error } = await supabase
        .from('email_accounts')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as EmailAccount[];
}

async function invoke(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke(FN, { body });
    if (error || (data && (data as any).error)) {
        throw new Error(await edgeFnErrorMessage(error, data, 'Email account operation failed.'));
    }
    return data as any;
}

export const createEmailAccount = (account: EmailAccountInput) =>
    invoke({ action: 'create', account });

export const updateEmailAccount = (id: string, account: EmailAccountInput) =>
    invoke({ action: 'update', id, account });

export const toggleEmailAccount = (id: string, is_active: boolean) =>
    invoke({ action: 'toggle', id, is_active });

export const deleteEmailAccount = (id: string) =>
    invoke({ action: 'delete', id });

// Resolves to { ok, to } on success or { ok:false, error } when the SMTP send fails.
// Unlike the other actions, an SMTP failure is a 200 with { ok:false, error } — a
// normal outcome to surface, not an exception — so we read the body directly and
// only throw on a transport/auth-level failure.
export async function testEmailAccount(id: string, to?: string): Promise<{ ok: boolean; to?: string; error?: string }> {
    const { data, error } = await supabase.functions.invoke(FN, {
        body: { action: 'test', id, ...(to ? { to } : {}) },
    });
    if (data && typeof data === 'object' && 'ok' in data) {
        return data as { ok: boolean; to?: string; error?: string };
    }
    // No usable body — a transport/auth/edge error; surface the real message.
    throw new Error(await edgeFnErrorMessage(error, data, 'SMTP test failed.'));
}
