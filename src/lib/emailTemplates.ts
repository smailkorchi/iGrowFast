import { supabase } from '@/lib/supabase';

export interface EmailTemplate {
    id: string;
    name: string;
    subject: string;
    preheader: string | null;
    html_body: string;
    text_body: string;
    is_active: boolean;
    email_account_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface EmailTemplateInput {
    name: string;
    subject: string;
    preheader?: string | null;
    html_body: string;
    text_body: string;
    is_active: boolean;
    email_account_id?: string | null;
}

// Owner-only CRUD straight through RLS — templates hold no secrets.
export async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
    const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as EmailTemplate[];
}

export async function createEmailTemplate(input: EmailTemplateInput): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
        .from('email_templates')
        .insert({ ...normalize(input), created_by: user?.id ?? null });
    if (error) throw new Error(error.message);
}

export async function updateEmailTemplate(id: string, input: EmailTemplateInput): Promise<void> {
    const { error } = await supabase
        .from('email_templates')
        .update(normalize(input))
        .eq('id', id);
    if (error) throw new Error(error.message);
}

export async function toggleEmailTemplate(id: string, is_active: boolean): Promise<void> {
    const { error } = await supabase.from('email_templates').update({ is_active }).eq('id', id);
    if (error) throw new Error(error.message);
}

export async function deleteEmailTemplate(id: string): Promise<void> {
    const { error } = await supabase.from('email_templates').delete().eq('id', id);
    if (error) throw new Error(error.message);
}

function normalize(input: EmailTemplateInput) {
    return {
        name: input.name.trim(),
        subject: input.subject.trim(),
        preheader: input.preheader?.trim() ? input.preheader.trim() : null,
        html_body: input.html_body,
        text_body: input.text_body,
        is_active: input.is_active,
        email_account_id: input.email_account_id || null,
    };
}

// Best-effort HTML → plain text for the text part of an email.
export function htmlToPlainText(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export const DEFAULT_TEMPLATE_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#141413;padding:28px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:600;letter-spacing:-0.01em;">iGrowFast<span style="color:#e8825a;">.</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px;color:#141413;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;">Welcome aboard</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f3c;">
                  Replace this with your message. Use inline styles for the best inbox rendering.
                </p>
                <a href="#" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:999px;">
                  Get started
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #ececea;color:#8a8a85;font-size:12px;">
                © iGrowFast · You received this because you have an account.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
