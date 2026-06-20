// meta-ads-oauth v3 — 302 redirect back to return_to
// Supabase edge functions force text/plain + strict CSP on HTML responses,
// so we can't serve a self-closing popup page from here. Instead we 302 back
// to the DigiCom frontend route, and that route detects it's inside a popup
// and posts to opener + closes itself.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const META_APP_ID = '1593064898437111';
const META_CONFIG_ID = '1393863525828876';
const META_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/meta-ads-oauth/callback`;
const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const FB_LOGIN_BASE = 'https://www.facebook.com/v21.0/dialog/oauth';
const STATE_TTL_MS = 15 * 60 * 1000;

const CORS_HEADERS: HeadersInit = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    });
}

function redirect(to: string): Response {
    return new Response(null, { status: 302, headers: { Location: to } });
}

function appendQuery(url: string, params: Record<string, string>): string {
    const sep = url.includes('?') ? '&' : '?';
    const qs = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    return `${url}${sep}${qs}`;
}

let STATE_SECRET_CACHE: string | null = null;
async function getStateSecret(admin: ReturnType<typeof createClient>): Promise<string> {
    if (STATE_SECRET_CACHE) return STATE_SECRET_CACHE;
    const { data, error } = await admin.rpc('get_meta_oauth_state_secret');
    if (error) throw new Error(`vault state secret rpc failed: ${error.message}`);
    if (!data) throw new Error('meta_oauth_state_secret missing from vault');
    STATE_SECRET_CACHE = typeof data === 'string' ? data : String(data);
    return STATE_SECRET_CACHE;
}

let APP_SECRET_CACHE: string | null = null;
async function getAppSecret(admin: ReturnType<typeof createClient>): Promise<string> {
    if (APP_SECRET_CACHE) return APP_SECRET_CACHE;
    const { data, error } = await admin.rpc('get_meta_app_secret');
    if (error) throw new Error(`vault app secret rpc failed: ${error.message}`);
    if (!data) throw new Error('meta_app_secret missing from vault');
    APP_SECRET_CACHE = typeof data === 'string' ? data : String(data);
    return APP_SECRET_CACHE;
}

function b64url(bytes: Uint8Array | string): string {
    let bin = '';
    if (typeof bytes === 'string') bin = bytes;
    else for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
}
async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
    const k = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(key),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
    return new Uint8Array(sig);
}

type StatePayload = {
    business_id: string;
    user_id: string;
    return_to: string;
    nonce: string;
    exp: number;
};

async function signState(secret: string, payload: StatePayload): Promise<string> {
    const body = b64url(JSON.stringify(payload));
    const sig = b64url(await hmacSha256(secret, body));
    return `${body}.${sig}`;
}
async function verifyState(secret: string, token: string): Promise<StatePayload> {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new Error('state token malformed');
    const expected = b64url(await hmacSha256(secret, body));
    if (expected !== sig) throw new Error('state signature invalid');
    const payload = JSON.parse(b64urlDecode(body)) as StatePayload;
    if (!payload.exp || Date.now() > payload.exp) throw new Error('state expired');
    if (!payload.business_id || !payload.user_id) throw new Error('state missing required fields');
    return payload;
}

type GraphError = { error?: { message?: string; code?: number } };

async function graphGet(path: string, token: string, query: Record<string, string> = {}): Promise<any> {
    const params = new URLSearchParams({ ...query, access_token: token });
    const url = `${GRAPH_BASE}${path.startsWith('/') ? path : `/${path}`}?${params.toString()}`;
    const res = await fetch(url);
    const data = (await res.json()) as GraphError & Record<string, unknown>;
    if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Graph ${res.status}`);
    return data;
}

async function exchangeCodeForToken(code: string, appSecret: string) {
    const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
    url.searchParams.set('client_id', META_APP_ID);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('redirect_uri', META_REDIRECT_URI);
    url.searchParams.set('code', code);
    const res = await fetch(url.toString());
    const j = (await res.json()) as any;
    if (!res.ok || !j.access_token) throw new Error(`token exchange failed: ${j?.error?.message ?? JSON.stringify(j)}`);
    return j as { access_token: string; expires_in?: number };
}

async function upgradeToLongLived(shortToken: string, appSecret: string) {
    const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', META_APP_ID);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', shortToken);
    const res = await fetch(url.toString());
    const j = (await res.json()) as any;
    if (!res.ok || !j.access_token) throw new Error(`long-lived exchange failed: ${j?.error?.message ?? JSON.stringify(j)}`);
    return j as { access_token: string; expires_in?: number };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(req.url);
    const isCallback = url.pathname.endsWith('/callback');

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    try {
        if (isCallback && req.method === 'GET') {
            return await handleCallback(url, admin);
        }
        if (req.method === 'POST') {
            return await handleStart(req, admin);
        }
        return jsonResponse({ ok: false, error: 'method not allowed' }, 405);
    } catch (e) {
        console.error('[meta-ads-oauth] fatal', e);
        if (isCallback) {
            // Best-effort: no state to know where to go, fall back to root
            return redirect(`/?oauth=error&message=${encodeURIComponent((e as Error).message)}`);
        }
        return jsonResponse({ ok: false, error: `[oauth_v3] ${(e as Error).message}` }, 500);
    }
});

async function handleStart(req: Request, admin: ReturnType<typeof createClient>): Promise<Response> {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse({ ok: false, error: '[oauth_v3] missing authorization' });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return jsonResponse({ ok: false, error: '[oauth_v3] unauthorized' });

    const body = await req.json().catch(() => ({}));
    const { action, business_id, return_to } = body;
    if (action !== 'start') return jsonResponse({ ok: false, error: `[oauth_v3] unknown action: ${action}` });
    if (!business_id) return jsonResponse({ ok: false, error: '[oauth_v3] business_id required' });
    if (!return_to) return jsonResponse({ ok: false, error: '[oauth_v3] return_to required' });

    const { data: allowed, error: allowErr } = await userClient
        .from('users')
        .select('id, role, "DigiCom Business"')
        .eq('id', userData.user.id)
        .single();
    if (allowErr) return jsonResponse({ ok: false, error: `[oauth_v3] ${allowErr.message}` });
    const role = (allowed as any)?.role;
    const isOwner = role === 'owner';
    const isAdmin = role === 'admin' || role === 'super admin';
    const usersBiz = (allowed as any)?.['DigiCom Business'];
    // Only owners and admins connect Meta ad accounts. Mediabuyers (and other roles)
    // use only the accounts an admin assigns them — they cannot initiate a connection.
    if (!isOwner && !(isAdmin && usersBiz === business_id)) {
        return jsonResponse({ ok: false, error: '[oauth_v3] not permitted for this business' });
    }

    const stateSecret = await getStateSecret(admin);
    const nonce = crypto.randomUUID();
    const state = await signState(stateSecret, {
        business_id,
        user_id: userData.user.id,
        return_to,
        nonce,
        exp: Date.now() + STATE_TTL_MS,
    });

    const authUrl = new URL(FB_LOGIN_BASE);
    authUrl.searchParams.set('client_id', META_APP_ID);
    authUrl.searchParams.set('redirect_uri', META_REDIRECT_URI);
    authUrl.searchParams.set('config_id', META_CONFIG_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    return jsonResponse({ ok: true, auth_url: authUrl.toString() });
}

async function handleCallback(url: URL, admin: ReturnType<typeof createClient>): Promise<Response> {
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const errorParam = url.searchParams.get('error');

    let state: StatePayload | null = null;
    if (stateParam) {
        try {
            state = await verifyState(await getStateSecret(admin), stateParam);
        } catch (e) {
            return redirect(`/?oauth=error&message=${encodeURIComponent('Invalid or expired state')}`);
        }
    }
    const returnTo = state?.return_to ?? '/';

    if (errorParam) {
        const errorDesc = url.searchParams.get('error_description') ?? errorParam;
        return redirect(appendQuery(returnTo, { oauth: 'error', message: errorDesc }));
    }
    if (!code || !state) {
        return redirect(appendQuery(returnTo, { oauth: 'error', message: 'missing code or state' }));
    }

    try {
        const appSecret = await getAppSecret(admin);
        const shortTok = await exchangeCodeForToken(code, appSecret);
        const longTok = await upgradeToLongLived(shortTok.access_token, appSecret);
        const accessToken = longTok.access_token;
        const expiresAt = longTok.expires_in
            ? new Date(Date.now() + longTok.expires_in * 1000).toISOString()
            : null;

        const accountsRes = await graphGet('/me/adaccounts', accessToken, {
            fields: 'id,name,currency,business',
            limit: '200',
        });
        const accounts: Array<{
            id: string;
            name: string;
            currency?: string;
            business?: { id: string; name?: string };
        }> = accountsRes.data ?? [];

        if (accounts.length === 0) {
            return redirect(appendQuery(returnTo, {
                oauth: 'error',
                message: 'No ad accounts were granted. Pick at least one during the Facebook consent screen.',
            }));
        }

        let createdCount = 0;
        let isFirst = true;
        for (const acc of accounts) {
            let pixelId: string | null = null;
            try {
                const px = await graphGet(`/${acc.id}/adspixels`, accessToken, {
                    fields: 'id,name',
                    limit: '1',
                });
                pixelId = px?.data?.[0]?.id ?? null;
            } catch { /* non-fatal */ }

            const { error } = await admin.rpc('upsert_meta_ads_connection', {
                p_business_id: state.business_id,
                p_ad_account_id: acc.id,
                p_display_name: acc.name,
                p_token: accessToken,
                p_business_id_meta: acc.business?.id ?? null,
                p_pixel_id: pixelId,
                p_is_default: isFirst,
                p_created_by: state.user_id,
                p_token_expires_at: expiresAt,
            });
            if (error) {
                console.error('upsert failed', acc.id, error);
                continue;
            }
            createdCount++;
            isFirst = false;
        }

        return redirect(appendQuery(returnTo, { oauth: 'success', count: String(createdCount) }));
    } catch (e) {
        return redirect(appendQuery(returnTo, {
            oauth: 'error',
            message: `[oauth_v3] ${(e as Error).message}`,
        }));
    }
}
