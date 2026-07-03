// google-analytics-fetch
//
// Proxies Google Analytics Data API (GA4) calls for authenticated DigiCom
// users. Multi-tenant: each business owns N rows in
// public.google_analytics_connections; RLS restricts which property a caller
// can query. The service account JSON lives in Postgres Vault and is read
// via the SECURITY DEFINER RPC `public.get_google_analytics_sa_key()`
// (granted to service_role only). JWT signing uses `jose` (mature lib),
// avoiding hand-rolled Web Crypto pkcs8 quirks.
//
// Deploy convention (matches other functions in this project):
//   verify_jwt: false   — we do auth ourselves via supabase.auth.getUser()
//
// Actions (POST JSON body):
//   { action: 'service_account_email' }
//       → { ok, email, project_id }                      (cheap; no vault read)
//   { action: 'verify_property',  property_id }
//       → { ok, property_id, sample_metrics }            (calls GA metadata)
//   { action: 'run_report',       property_id, report }
//   { action: 'batch_reports',    property_id, requests: [...] }   (max 5 / batch — split client-side)
//   { action: 'get_realtime',     property_id, report? }
//
// Error strategy: business / validation / Google API errors return HTTP 200
// with { ok: false, error } so supabase.functions.invoke surfaces the message
// instead of opaque FunctionsHttpError. Only unhandled exceptions return 500.
//
// All non-trivial errors include the [v7] prefix to make it obvious if a
// stale deployment is being hit during debugging.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// SA email is public info — it's the address customers paste into GA when
// granting Viewer access. Hardcoded to skip a vault round-trip on the cheap
// onboarding lookup; the private_key (which IS sensitive) still comes from
// vault on the actual API actions.
const SERVICE_ACCOUNT_EMAIL = 'analytics@digicom-493314.iam.gserviceaccount.com';
const PROJECT_ID = 'digicom-493314';

const CORS_HEADERS: HeadersInit = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    });
}

// ── Service account key (cached per cold start) ─────────────────────────
let SA_KEY_CACHE: CryptoKey | null = null;

async function getSaSigningKey(
    admin: ReturnType<typeof createClient>
): Promise<CryptoKey> {
    if (SA_KEY_CACHE) return SA_KEY_CACHE;
    const { data, error } = await admin.rpc('get_google_analytics_sa_key');
    if (error) throw new Error(`vault rpc failed: ${error.message}`);
    if (data == null) throw new Error('google_analytics_sa_key is empty');

    const saJsonText = typeof data === 'string' ? data : JSON.stringify(data);
    let sa: { private_key?: string };
    try {
        sa = JSON.parse(saJsonText);
    } catch (e) {
        throw new Error(`failed to parse SA json: ${(e as Error).message}`);
    }
    if (!sa.private_key) throw new Error('SA missing private_key field');

    try {
        SA_KEY_CACHE = (await importPKCS8(sa.private_key, 'RS256')) as CryptoKey;
    } catch (e) {
        const peek = sa.private_key.slice(0, 60).replace(/\n/g, '\\n');
        throw new Error(
            `jose importPKCS8 failed (pem_len=${sa.private_key.length}, peek="${peek}"): ${(e as Error).message}`
        );
    }
    return SA_KEY_CACHE;
}

// ── Access token (cached until ~1 min before expiry) ────────────────────
let TOKEN_CACHE: { token: string; expiresAt: number } | null = null;

async function getAccessToken(admin: ReturnType<typeof createClient>): Promise<string> {
    if (TOKEN_CACHE && TOKEN_CACHE.expiresAt > Date.now() + 60_000) {
        return TOKEN_CACHE.token;
    }
    const key = await getSaSigningKey(admin);

    const jwt = await new SignJWT({
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
    })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(SERVICE_ACCOUNT_EMAIL)
        .setAudience('https://oauth2.googleapis.com/token')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(key);

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) {
        throw new Error(`google token exchange failed: ${JSON.stringify(body)}`);
    }
    TOKEN_CACHE = {
        token: body.access_token,
        expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
}

// ── GA4 Data API helper ─────────────────────────────────────────────────
async function gaRequest(path: string, token: string, body?: unknown): Promise<any> {
    const url = `https://analyticsdata.googleapis.com/v1beta/${path}`;
    const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
        const msg = data?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(`GA4 API: ${msg}`);
    }
    return data;
}

// Accepts 'properties/123', 'GA4-123', '123' etc. Strips to digits only.
function normalizePropertyId(raw: string): string {
    const digits = String(raw ?? '').replace(/\D+/g, '');
    if (!digits) throw new Error('property_id is required (numeric GA4 property ID)');
    return digits;
}

// Defense-in-depth: even though service_role can fetch any property, we
// re-check using the caller's JWT-scoped client so RLS enforces that the
// caller's business actually has this property connected.
async function assertCallerCanAccessProperty(
    userClient: ReturnType<typeof createClient>,
    property_id: string
): Promise<void> {
    const { data, error } = await userClient
        .from('google_analytics_connections')
        .select('id')
        .eq('property_id', property_id)
        .limit(1);
    if (error) throw new Error(`rls check failed: ${error.message}`);
    if (!data || data.length === 0) {
        throw new Error('property not connected for this user');
    }
}

// ── Handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (req.method !== 'POST') {
        return jsonResponse({ ok: false, error: 'method not allowed' }, 405);
    }

    try {
        const authHeader = req.headers.get('authorization') ?? '';
        if (!authHeader.startsWith('Bearer ')) {
            return jsonResponse({ ok: false, error: 'missing authorization' });
        }

        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
            auth: { persistSession: false },
        });
        const { data: userData } = await userClient.auth.getUser();
        if (!userData?.user) {
            return jsonResponse({ ok: false, error: 'unauthorized' });
        }

        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false },
        });

        const body = await req.json().catch(() => ({}));
        const action: string = body?.action;
        if (!action) return jsonResponse({ ok: false, error: 'action is required' });

        if (action === 'service_account_email') {
            return jsonResponse({
                ok: true,
                email: SERVICE_ACCOUNT_EMAIL,
                project_id: PROJECT_ID,
                deploy_version: 7,
            });
        }

        if (action === 'verify_property') {
            try {
                // Onboarding probe against an arbitrary GA property the shared
                // service account can see — restrict to business admins (the UI
                // already gates add-connection to non-mediabuyers).
                const { data: prof } = await admin
                    .from('users').select('role').eq('id', userData.user.id).maybeSingle();
                if (!prof || !['super admin', 'admin'].includes(prof.role)) {
                    return jsonResponse({ ok: false, error: 'forbidden' }, 403);
                }
                const propertyId = normalizePropertyId(body.property_id);
                const token = await getAccessToken(admin);
                const meta = await gaRequest(`properties/${propertyId}/metadata`, token);
                return jsonResponse({
                    ok: true,
                    property_id: propertyId,
                    sample_metrics: (meta.metrics ?? []).slice(0, 3).map((m: any) => m.apiName),
                });
            } catch (e) {
                return jsonResponse({ ok: false, error: `[v7] ${(e as Error).message}` });
            }
        }

        try {
            const propertyId = normalizePropertyId(body.property_id);
            await assertCallerCanAccessProperty(userClient, propertyId);
            const token = await getAccessToken(admin);

            if (action === 'run_report') {
                const data = await gaRequest(
                    `properties/${propertyId}:runReport`,
                    token,
                    body.report ?? {}
                );
                return jsonResponse({ ok: true, data });
            }

            if (action === 'batch_reports') {
                // GA4 caps batchRunReports at 5 requests per call. Callers
                // must split larger batches client-side.
                const data = await gaRequest(
                    `properties/${propertyId}:batchRunReports`,
                    token,
                    { requests: body.requests ?? [] }
                );
                return jsonResponse({ ok: true, data });
            }

            if (action === 'get_realtime') {
                const data = await gaRequest(
                    `properties/${propertyId}:runRealtimeReport`,
                    token,
                    body.report ?? { metrics: [{ name: 'activeUsers' }] }
                );
                return jsonResponse({ ok: true, data });
            }

            return jsonResponse({ ok: false, error: `unknown action: ${action}` });
        } catch (e) {
            return jsonResponse({ ok: false, error: `[v7] ${(e as Error).message}` });
        }
    } catch (e) {
        console.error('[google-analytics-fetch] fatal', e);
        return jsonResponse({ ok: false, error: `[v7] ${(e as Error).message}` }, 500);
    }
});
