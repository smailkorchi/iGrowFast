// ─────────────────────────────────────────────────────────────────────────────
// log-action
//
// Writes a forensic entry to public.audit_logs. Proxies the client request so
// the ipgeolocation.io API key never leaves the Edge runtime, and so that the
// server can stamp the real client IP + geolocation + user agent on each row.
//
// Invocation model:
//   Called from the browser via `supabase.functions.invoke('log-action', {...})`
//   from src/lib/auditLog.ts -> logAction().
//
// Auth model (verify_jwt = false, deliberate):
//   We accept unauthenticated calls ONLY for a small whitelist of auth-related
//   actions ('login_failed', 'login', 'signup', 'password_reset') — because at
//   the moment a login fails the caller has no JWT yet, and we still want to
//   record the attempt with IP + geo. For every other action a valid JWT is
//   required; if absent the function returns 401.
//
//   If `verify_jwt` were set to `true`, the Supabase gateway would reject
//   unauthenticated invocations before this function could run, and we would
//   lose the ability to log failed-login attempts.
//
// Env secrets (set via `supabase functions secrets set`):
//   IPGEO_API_KEY              - ipgeolocation.io API key
//   SUPABASE_URL               - auto-populated
//   SUPABASE_SERVICE_ROLE_KEY  - auto-populated (used to insert via log_audit RPC)
//   SUPABASE_ANON_KEY          - auto-populated (used only to verify caller JWT)
//
// Deployment:
//   supabase functions deploy log-action --no-verify-jwt
// ─────────────────────────────────────────────────────────────────────────────

// @ts-expect-error Deno stdlib available at runtime
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
// @ts-expect-error remote ESM
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const IPGEO_API_KEY = Deno.env.get('IPGEO_API_KEY') ?? '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

// Per-instance in-memory cache of geo lookups keyed by IP. 10 min TTL keeps
// our quota with ipgeolocation.io down during bursts without sacrificing
// freshness for mobile users who move between networks.
const geoCache = new Map<string, { at: number; data: any }>();
const GEO_TTL_MS = 10 * 60 * 1000;

async function resolveGeo(ip: string): Promise<any | null> {
    if (!ip || !IPGEO_API_KEY) return null;
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.')) {
        return { country: 'Local', country_code: 'LO', city: 'Local', isp: null };
    }
    const cached = geoCache.get(ip);
    if (cached && Date.now() - cached.at < GEO_TTL_MS) return cached.data;
    try {
        const url = `https://api.ipgeolocation.io/ipgeo?apiKey=${encodeURIComponent(IPGEO_API_KEY)}&ip=${encodeURIComponent(ip)}`;
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) return null;
        const j = await res.json();
        const data = {
            country: j.country_name ?? null,
            country_code: j.country_code2 ?? null,
            region: j.state_prov ?? null,
            city: j.city ?? null,
            latitude: j.latitude ? Number(j.latitude) : null,
            longitude: j.longitude ? Number(j.longitude) : null,
            isp: j.isp ?? null,
            org: j.organization ?? null,
            timezone: j.time_zone?.name ?? null,
        };
        geoCache.set(ip, { at: Date.now(), data });
        return data;
    } catch (err) {
        console.warn('[log-action] geo lookup failed', err);
        return null;
    }
}

function extractIp(req: Request): string {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0]!.trim();
    const cf = req.headers.get('cf-connecting-ip');
    if (cf) return cf.trim();
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
    return '';
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

    // Optional JWT: we verify it ourselves because verify_jwt is disabled at
    // the gateway (see header comment). Authenticated callers get their actor
    // snapshot; unauthenticated callers are only allowed for auth-event logs.
    let authUser: { id: string; email?: string | null } | null = null;
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (bearer && bearer !== SUPABASE_ANON_KEY) {
        const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${bearer}` } },
        });
        const { data } = await anon.auth.getUser(bearer);
        authUser = data?.user ?? null;
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return jsonResponse(400, { error: 'Invalid JSON body' });
    }

    const action = String(body.action ?? 'custom');
    const metadata = body.metadata ?? null;

    // Whitelist of actions that can be logged without a valid JWT. Anything
    // else requires an authenticated caller to prevent forged platform events.
    const anonAllowed = ['login_failed', 'login', 'signup', 'password_reset'];
    if (!authUser && !anonAllowed.includes(action)) {
        return jsonResponse(401, { error: 'Unauthenticated' });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    let actorRow: {
        id: string;
        name: string | null;
        email: string | null;
        role: string | null;
        avatar_url: string | null;
        'DigiCom Business': string | null;
    } | null = null;
    if (authUser) {
        const { data } = await admin
            .from('users')
            .select('id,name,email,role,avatar_url,"DigiCom Business"')
            .eq('id', authUser.id)
            .maybeSingle();
        actorRow = data as typeof actorRow;
    }

    const ip = extractIp(req);
    const userAgent = req.headers.get('user-agent') ?? null;
    const geo = await resolveGeo(ip);

    const actor_role = actorRow?.role ?? null;
    const business_id = body.business_id ?? actorRow?.['DigiCom Business'] ?? null;
    const scope = body.scope ?? (actor_role === 'owner' || !business_id ? 'platform' : 'business');

    const payload = {
        scope,
        business_id,
        actor_id: actorRow?.id ?? authUser?.id ?? null,
        actor_role,
        actor_name: actorRow?.name ?? authUser?.email ?? null,
        actor_email: actorRow?.email ?? authUser?.email ?? metadata?.email ?? null,
        actor_avatar_url: actorRow?.avatar_url ?? null,
        action,
        entity_table: body.entity_table ?? null,
        entity_id: body.entity_id != null ? String(body.entity_id) : null,
        entity_label: body.entity_label ?? null,
        changes: body.changes ?? null,
        metadata,
        ip,
        user_agent: userAgent,
        geo,
        session_id: body.session_id ?? null,
    };

    const { data, error } = await admin.rpc('log_audit', { payload } as unknown as never);
    if (error) {
        console.error('[log-action] log_audit failed', error);
        return jsonResponse(500, { error: error.message });
    }

    return jsonResponse(200, { id: data });
});
