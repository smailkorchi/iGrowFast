// meta-ads-oauth
//
// Handles the Facebook Login for Business (FLfB) flow for connecting Meta Ad
// Accounts to DigiCom businesses.
//
// Two routes share one function:
//   POST /meta-ads-oauth           body: { action: 'start', business_id, return_to }
//                                   → { ok, auth_url }   (frontend then redirects)
//   GET  /meta-ads-oauth/callback  ?code=...&state=...
//                                   → 302 to `return_to` with ?oauth=success|error
//
// State token: HMAC-SHA256 signed payload { business_id, user_id, return_to,
// nonce, exp }. Secret lives in Postgres Vault (name = meta_oauth_state_secret).
// App Secret also in Vault (name = meta_app_secret). Both read via
// SECURITY DEFINER RPCs granted only to service_role.
//
// After callback, we:
//   1. exchange code → short-lived access_token
//   2. upgrade to long-lived token (fb_exchange_token flow)
//   3. call /me/adaccounts to list every ad account the user granted
//   4. upsert_meta_ads_connection for each → one connection row per ad account
//      (token stored per connection in Vault; rotating across re-connects)
//   5. try /act_X/adspixels for each to pre-populate pixel_id when possible
//   6. redirect the browser back to return_to
//
// Note on deploy convention: verify_jwt is FALSE because:
//   - /start is called by frontend with user Bearer (we verify ourselves)
//   - /callback is called by Meta's servers with NO Bearer (must not require JWT)

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

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes to complete OAuth

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

function htmlResponse(html: string, status = 200): Response {
    return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function redirect(to: string): Response {
    return new Response(null, { status: 302, headers: { Location: to } });
}

// ── HMAC state signing ──────────────────────────────────────────────────
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
        'raw',
        new TextEncoder().encode(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
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

// ── Meta helpers ────────────────────────────────────────────────────────
type GraphError = { error?: { message?: string; code?: number } };

async function graphGet(path: string, token: string, query: Record<string, string> = {}): Promise<any> {
    const params = new URLSearchParams({ ...query, access_token: token });
    const url = `${GRAPH_BASE}${path.startsWith('/') ? path : `/${path}`}?${params.toString()}`;
    const res = await fetch(url);
    const data = (await res.json()) as GraphError & Record<string, unknown>;
    if (!res.ok || data?.error) {
        throw new Error(data?.error?.message ?? `Graph ${res.status}`);
    }
    return data;
}

async function exchangeCodeForToken(code: string, appSecret: string): Promise<{
    access_token: string;
    expires_in?: number;
    token_type?: string;
}> {
    const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
    url.searchParams.set('client_id', META_APP_ID);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('redirect_uri', META_REDIRECT_URI);
    url.searchParams.set('code', code);
    const res = await fetch(url.toString());
    const j = (await res.json()) as any;
    if (!res.ok || !j.access_token) {
        throw new Error(`token exchange failed: ${j?.error?.message ?? JSON.stringify(j)}`);
    }
    return j;
}

async function upgradeToLongLived(
    shortToken: string,
    appSecret: string
): Promise<{ access_token: string; expires_in?: number }> {
    const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', META_APP_ID);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', shortToken);
    const res = await fetch(url.toString());
    const j = (await res.json()) as any;
    if (!res.ok || !j.access_token) {
        throw new Error(`long-lived exchange failed: ${j?.error?.message ?? JSON.stringify(j)}`);
    }
    return j;
}

// ── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(req.url);
    const isCallback = url.pathname.endsWith('/callback');

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    try {
        // ── Callback path ─────────────────────────────────────────────
        if (isCallback && req.method === 'GET') {
            return await handleCallback(url, admin);
        }

        // ── Start path (POST) ─────────────────────────────────────────
        if (req.method === 'POST') {
            return await handleStart(req, admin);
        }

        return jsonResponse({ ok: false, error: 'method not allowed' }, 405);
    } catch (e) {
        console.error('[meta-ads-oauth] fatal', e);
        if (isCallback) {
            return popupResultHtml({ ok: false, message: `[oauth_v1] ${(e as Error).message}` });
        }
        return jsonResponse({ ok: false, error: `[oauth_v1] ${(e as Error).message}` }, 500);
    }
});

// ── /start handler ──────────────────────────────────────────────────────
async function handleStart(req: Request, admin: ReturnType<typeof createClient>): Promise<Response> {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse({ ok: false, error: '[oauth_v1] missing authorization' });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return jsonResponse({ ok: false, error: '[oauth_v1] unauthorized' });

    const body = await req.json().catch(() => ({}));
    const { action, business_id, return_to } = body;

    if (action !== 'start') {
        return jsonResponse({ ok: false, error: `[oauth_v1] unknown action: ${action}` });
    }
    if (!business_id) return jsonResponse({ ok: false, error: '[oauth_v1] business_id required' });
    if (!return_to) return jsonResponse({ ok: false, error: '[oauth_v1] return_to required' });

    // RLS check: caller must be able to see this business (either as owner or
    // their assigned DigiCom Business).
    const { data: allowed, error: allowErr } = await userClient
        .from('users')
        .select('id, role, "DigiCom Business"')
        .eq('id', userData.user.id)
        .single();
    if (allowErr) return jsonResponse({ ok: false, error: `[oauth_v1] ${allowErr.message}` });
    const isOwner = (allowed as any)?.role === 'owner';
    const usersBiz = (allowed as any)?.['DigiCom Business'];
    if (!isOwner && usersBiz !== business_id) {
        return jsonResponse({ ok: false, error: '[oauth_v1] not permitted for this business' });
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

    // FLfB configuration drives the scopes + assets picker; we don't pass
    // scopes in the URL when using a config_id.
    const authUrl = new URL(FB_LOGIN_BASE);
    authUrl.searchParams.set('client_id', META_APP_ID);
    authUrl.searchParams.set('redirect_uri', META_REDIRECT_URI);
    authUrl.searchParams.set('config_id', META_CONFIG_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    return jsonResponse({ ok: true, auth_url: authUrl.toString() });
}

// ── /callback handler ───────────────────────────────────────────────────
// Small HTML page shown inside the OAuth popup that posts the result to the
// opener window and closes itself. Falls back to redirecting to `return_to`
// if `window.opener` is missing (i.e. the user came through a full-page flow
// because their browser blocked popups).
function popupResultHtml(payload: {
    ok: boolean;
    count?: number;
    message?: string;
    return_to?: string;
}): Response {
    const json = JSON.stringify(payload);
    const fallbackParams = payload.ok
        ? `oauth=success&count=${payload.count ?? 0}`
        : `oauth=error&message=${encodeURIComponent(payload.message ?? 'Unknown error')}`;
    const returnTo = payload.return_to ?? '/meta-ads';
    const html = `<!doctype html><html><head>
<meta charset="utf-8">
<title>${payload.ok ? 'Connected' : 'Connection failed'}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0f172a; color: #fff;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; max-width: 360px; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 8px; letter-spacing: -0.01em; }
  p { font-size: 13px; color: rgba(255,255,255,0.6); margin: 0; line-height: 1.5; }
  .ok { color: #10b981; }
  .err { color: #f87171; }
</style>
</head><body>
<div class="card">
  <h1 class="${payload.ok ? 'ok' : 'err'}">${payload.ok ? 'Connected!' : 'Connection failed'}</h1>
  <p>${payload.ok ? 'You can close this window.' : (payload.message ?? 'Unknown error')}</p>
</div>
<script>
(function(){
  var payload = ${json};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'meta-oauth', ...payload }, '*');
      setTimeout(function(){ window.close(); }, 120);
      return;
    }
  } catch (e) {}
  // Full-page fallback — navigate the current window back to DigiCom with
  // the status in the query string.
  window.location.replace(${JSON.stringify(returnTo)} + (${JSON.stringify(returnTo)}.indexOf('?') === -1 ? '?' : '&') + ${JSON.stringify(fallbackParams)});
})();
</script>
</body></html>`;
    return htmlResponse(html, 200);
}

async function handleCallback(url: URL, admin: ReturnType<typeof createClient>): Promise<Response> {
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const errorParam = url.searchParams.get('error');

    let state: StatePayload | null = null;
    if (stateParam) {
        try {
            state = await verifyState(await getStateSecret(admin), stateParam);
        } catch {
            return popupResultHtml({ ok: false, message: 'Invalid or expired state. Start over from DigiCom.' });
        }
    }

    const returnTo = state?.return_to ?? '/meta-ads';

    if (errorParam) {
        const errorDesc = url.searchParams.get('error_description') ?? errorParam;
        return popupResultHtml({ ok: false, message: errorDesc, return_to: returnTo });
    }

    if (!code || !state) {
        return popupResultHtml({ ok: false, message: 'missing code or state', return_to: returnTo });
    }

    try {
        // 1. exchange code → short-lived token
        const appSecret = await getAppSecret(admin);
        const shortTok = await exchangeCodeForToken(code, appSecret);

        // 2. upgrade to long-lived (60-day) token
        const longTok = await upgradeToLongLived(shortTok.access_token, appSecret);
        const accessToken = longTok.access_token;
        const expiresAt = longTok.expires_in
            ? new Date(Date.now() + longTok.expires_in * 1000).toISOString()
            : null;

        // 3. enumerate granted ad accounts
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
            return popupResultHtml({
                ok: false,
                message: 'No ad accounts were granted. Pick at least one during the Facebook consent screen.',
                return_to: returnTo,
            });
        }

        // 4. upsert one connection per ad account, try to grab a pixel per
        //    account, and mark the first connection as default.
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
            } catch {
                // no pixels on this account — non-fatal
            }

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

        return popupResultHtml({ ok: true, count: createdCount, return_to: returnTo });
    } catch (e) {
        return popupResultHtml({
            ok: false,
            message: `[oauth_v1] ${(e as Error).message}`,
            return_to: returnTo,
        });
    }
}
