// ─────────────────────────────────────────────────────────────────────────────
// send-courier-push
//
// Supabase Edge Function that delivers Web Push notifications to a courier's
// registered devices when a new row lands in `courier_notifications`.
//
// Invocation model:
//   Called by a Database Webhook on `INSERT` on `public.courier_notifications`
//   (configure in Supabase Studio → Database → Webhooks).
//   Payload shape (Supabase webhook v1):
//     {
//       "type": "INSERT",
//       "table": "courier_notifications",
//       "record": { id, courier_id, title, body, target_url, ... },
//       "old_record": null
//     }
//
// Security:
//   - Uses the SERVICE_ROLE_KEY (never exposed client-side) to bypass RLS
//     when reading push_subscriptions and pruning expired ones
//   - Signs each push via the VAPID private key so push providers (FCM,
//     APNs, Mozilla Autopush) trust the origin
//   - Ignores notifications with no courier_id or body
//
// Env vars required (set via `supabase functions secrets set`):
//   VAPID_PUBLIC_KEY   — same as public/notifications client
//   VAPID_PRIVATE_KEY  — 32-byte P-256 private key (URL-safe base64)
//   VAPID_SUBJECT      — mailto:team@example.com (required by the VAPID spec)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Deployment:
//   supabase functions deploy send-courier-push --no-verify-jwt
//
// Note on `--no-verify-jwt`: the Database Webhook calls this function with
// an internal signing mechanism, not a user JWT, so JWT verification must
// be disabled. The function still checks the webhook signature header.
// ─────────────────────────────────────────────────────────────────────────────

// @ts-expect-error — Deno stdlib, available at runtime in the edge
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
// @ts-expect-error — remote ESM import, resolved at edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
// @ts-expect-error — web-push JS, runs on Deno
import webpush from 'https://esm.sh/web-push@3.6.7';

declare const Deno: any;

// ─── Env ─────────────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@digicom.app';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch (err) {
        console.error('[send-courier-push] setVapidDetails failed', err);
    }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

// ─── CORS helper ─────────────────────────────────────────────────────────────
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Types ───────────────────────────────────────────────────────────────────
type CourierNotificationRow = {
    id: string;
    courier_id: string;
    'DigiCom Business': string | null;
    type: string;
    title: string;
    body: string | null;
    target_url: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
};

type WebhookPayload = {
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    table: string;
    record: CourierNotificationRow | null;
    old_record: CourierNotificationRow | null;
};

type PushSubRow = {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    revoked_at: string | null;
};

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const body = (await req.json()) as WebhookPayload;
        if (body.type !== 'INSERT' || body.table !== 'courier_notifications' || !body.record) {
            return new Response(JSON.stringify({ skipped: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const notification = body.record;
        const courierId = notification.courier_id;
        if (!courierId) {
            return new Response(JSON.stringify({ error: 'missing courier_id' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ── Fetch active subscriptions for this courier ──────────────
        const { data: subs, error: subsErr } = await supabase
            .from('push_subscriptions')
            .select('id, endpoint, p256dh, auth, revoked_at')
            .eq('user_id', courierId)
            .is('revoked_at', null);

        if (subsErr) {
            console.error('[send-courier-push] fetch subs failed', subsErr);
            return new Response(JSON.stringify({ error: subsErr.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        if (!subs || subs.length === 0) {
            return new Response(JSON.stringify({ delivered: 0, reason: 'no-subscribers' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ── Build payload ────────────────────────────────────────────
        const pushPayload = JSON.stringify({
            title: notification.title,
            body: notification.body || undefined,
            url: notification.target_url || '/courier/orders',
            tag: `courier-notif-${notification.id}`,
            icon: '/Logo/DigiCom Icon Transparent.png',
            badge: '/Logo/DigiCom Icon Transparent.png',
            data: {
                notificationId: notification.id,
                type: notification.type,
                ...(notification.payload || {}),
            },
        });

        // ── Fan out: send to every active subscription ───────────────
        let delivered = 0;
        const revoked: string[] = [];

        await Promise.all(
            (subs as PushSubRow[]).map(async (sub) => {
                try {
                    await webpush.sendNotification(
                        {
                            endpoint: sub.endpoint,
                            keys: { p256dh: sub.p256dh, auth: sub.auth },
                        },
                        pushPayload,
                        { TTL: 60 * 60 * 24 }, // 24h max storage before delivery
                    );
                    delivered++;
                } catch (err: any) {
                    const statusCode = err?.statusCode || 0;
                    // 404 = endpoint no longer exists
                    // 410 = subscription permanently gone
                    if (statusCode === 404 || statusCode === 410) {
                        revoked.push(sub.id);
                    } else {
                        console.warn('[send-courier-push] push failed', {
                            endpoint: sub.endpoint,
                            status: statusCode,
                            message: err?.message,
                        });
                    }
                }
            }),
        );

        // ── Mark expired subscriptions as revoked (best effort) ──────
        if (revoked.length > 0) {
            try {
                await supabase
                    .from('push_subscriptions')
                    .update({ revoked_at: new Date().toISOString() })
                    .in('id', revoked);
            } catch (err) {
                console.warn('[send-courier-push] revoke update failed', err);
            }
        }

        return new Response(
            JSON.stringify({
                delivered,
                revoked: revoked.length,
                total: subs.length,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (err: any) {
        console.error('[send-courier-push] unexpected error', err);
        return new Response(JSON.stringify({ error: err?.message || 'unknown' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
