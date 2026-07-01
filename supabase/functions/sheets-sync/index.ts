// sheets-sync
//
// Pulls rows from a connected Google Sheet and hands them to the SECURITY DEFINER RPC
// `ingest_sheet_rows()`, which maps/resolves/dedups and creates inert PENDING draft orders.
//
// Actions (POST JSON):
//   { action: 'sync_channel', channel_id }  — sync one channel (the "Check now" button / per-channel cron)
//   { action: 'poll' }                       — sync all active, scheduled, due channels (pg_cron)
//
// Google auth: service-account JSON in Vault (secret `google_sheets_sa_key`), read via the
// service_role-only RPC `get_google_sheets_sa_key()`; scope spreadsheets.readonly, mirroring
// google-analytics-fetch (jose RS256 + token exchange, token cached per cold start).
//
// Deploy: verify_jwt = false. Invoked by pg_cron (service key) or an authenticated client. The RPC is
// business-scoped to the channel, so a caller can only ever cause a channel to ingest into its OWN business.
//
// v1 note: reads the whole tab each sync and relies on the (channel, external_row_id) dedup in staging +
// the orders idempotency index. The Drive modifiedTime gate + fingerprinted cursor delta (cheap re-reads at
// scale) are a documented future optimization; poll only runs for opt-in non-manual channels, so it's bounded.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// The Google SA JSON lives in Vault (secret `google_sheets_sa_key`), not the edge env; this
// service_role client reads it via the SECURITY DEFINER RPC `get_google_sheets_sa_key()`.
const saClient = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...CORS } });

async function saJson(): Promise<{ client_email: string; private_key: string }> {
  const { data, error } = await saClient.rpc('get_google_sheets_sa_key');
  if (error) throw new Error(`get_google_sheets_sa_key RPC failed: ${error.message}`);
  const raw = String(data ?? '').trim();
  if (!raw) throw new Error('google_sheets_sa_key is missing/empty in vault');
  // Tolerate the secret stored as raw JSON (default) or base64(JSON), with whitespace,
  // URL-safe alphabet, or missing padding.
  let txt: string;
  if (raw.startsWith('{')) {
    txt = raw; // raw JSON
  } else {
    let b64 = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    try {
      txt = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    } catch {
      throw new Error('google_sheets_sa_key is neither raw JSON nor valid base64-encoded JSON');
    }
  }
  let sa: { client_email?: string; private_key?: string };
  try {
    sa = JSON.parse(txt);
  } catch (e) {
    throw new Error(`google_sheets_sa_key is not valid JSON: ${(e as Error)?.message ?? e}`);
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('google_sheets_sa_key JSON is missing client_email/private_key');
  }
  return { client_email: sa.client_email, private_key: sa.private_key };
}

let TOKEN: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  if (TOKEN && TOKEN.exp > Date.now() + 60_000) return TOKEN.token;
  const sa = await saJson();
  const key = await importPKCS8(sa.private_key, 'RS256');
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/spreadsheets.readonly' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const b = await res.json();
  if (!res.ok || !b.access_token) throw new Error('google token exchange failed: ' + JSON.stringify(b));
  TOKEN = { token: b.access_token, exp: Date.now() + b.expires_in * 1000 };
  return TOKEN.token;
}

// Spreadsheet column letter for a 0-based index (0 -> A, 26 -> AA) — used when the sheet has no header.
function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function readSheet(spreadsheetId: string, tab: string | null): Promise<string[][]> {
  const t = await googleToken();
  const range = tab ? encodeURIComponent(tab) : 'A:ZZ';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${t}` } });
  const b = await res.json();
  if (!res.ok) throw new Error('sheets api: ' + (b?.error?.message ?? `HTTP ${res.status}`));
  return (b.values ?? []) as string[][];
}

// deno-lint-ignore no-explicit-any
async function syncChannel(admin: any, ch: any) {
  const startRow = Math.max(1, ch.start_row ?? 1);
  let values: string[][];
  try {
    values = await readSheet(ch.spreadsheet_id, ch.spreadsheet_name);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await admin.from('sales_channels').update({ sync_status: 'error', sync_error: msg }).eq('id', ch.id);
    return { channel_id: ch.id, ok: false, error: msg };
  }

  // Header handling: a header row is ALWAYS row 1 (mapped by name). Data starts at start_row, clamped below
  // the header so the header can never be ingested as an order. With no header, columns are addressed by
  // letter (A, B, ...) so a positional column_map can still work.
  const hasHeader = ch.has_header !== false;
  let startData = startRow;
  if (hasHeader && startData < 2) startData = 2; // data must sit below the row-1 header
  const headerIdx = hasHeader ? 0 : -1;
  const headers = hasHeader
    ? (values[0] ?? []).map((h) => String(h ?? '').trim())
    : (values[startData - 1] ?? []).map((_, idx) => colLetter(idx));
  if (hasHeader && !headers.some((h) => h)) {
    return { channel_id: ch.id, ok: false, error: 'no header found in row 1 — turn off "First row is a header" if your sheet has none' };
  }

  const rows: Array<{ rn: number; raw: Record<string, string> }> = [];
  for (let i = startData - 1; i < values.length; i++) {
    if (i === headerIdx) continue; // never ingest the header row, even if start_row points at it
    const cells = values[i] ?? [];
    if (!cells.some((c) => String(c ?? '').trim() !== '')) continue; // skip blank rows
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) raw[h] = String(cells[idx] ?? '').trim();
    });
    rows.push({ rn: i + 1, raw });
  }
  if (!rows.length) return { channel_id: ch.id, ok: true, inserted: 0, skipped: 0, needs_review: 0, empty: true };

  const { data, error } = await admin.rpc('ingest_sheet_rows', { p_channel_id: ch.id, p_rows: rows });
  if (error) {
    await admin.from('sales_channels').update({ sync_status: 'error', sync_error: error.message }).eq('id', ch.id);
    return { channel_id: ch.id, ok: false, error: error.message };
  }
  return { channel_id: ch.id, ...data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* empty body => poll */ }
  const action = (body?.action as string) ?? 'poll';

  try {
    if (action === 'sync_channel') {
      if (!body.channel_id) return json({ ok: false, error: 'channel_id required' });
      const { data: ch, error } = await admin.from('sales_channels').select('*').eq('id', body.channel_id).single();
      if (error || !ch) return json({ ok: false, error: 'channel not found' });
      if (!ch.spreadsheet_id) return json({ ok: false, error: 'channel has no spreadsheet_id' });
      return json(await syncChannel(admin, ch));
    }

    if (action === 'poll') {
      const { data: chs } = await admin
        .from('sales_channels')
        .select('*')
        .eq('is_active', true)
        .neq('sync_cadence', 'manual')
        .not('spreadsheet_id', 'is', null);
      const due = (chs ?? []).filter((ch: { last_synced_at: string | null; sync_cadence: string }) => {
        if (!ch.last_synced_at) return true;
        const ageMin = (Date.now() - new Date(ch.last_synced_at).getTime()) / 60_000;
        return ch.sync_cadence === '15min' ? ageMin >= 15 : ageMin >= 60;
      });
      const results = [];
      for (const ch of due) results.push(await syncChannel(admin, ch));
      return json({ ok: true, polled: due.length, results });
    }

    return json({ ok: false, error: 'unknown action: ' + action });
  } catch (e) {
    console.error('[sheets-sync] fatal', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
