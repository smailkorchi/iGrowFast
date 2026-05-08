/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * iGrowFast Notification Manager
 *
 * Cross-platform wrapper that handles:
 *   - Feature detection (ServiceWorker, PushManager, Notification API)
 *   - iOS Safari standalone mode detection (the ONLY way iOS Web Push works)
 *   - Permission request flow
 *   - Service worker registration
 *   - Push subscription creation + persistence to `push_subscriptions` table
 *   - Local showNotification (foreground fallback via the SW registration)
 *
 * Design notes:
 *   - All mutations are idempotent — calling ensure/subscribe twice is safe
 *   - Scoped to (user_id, business_id) so a single device + multiple business
 *     memberships creates distinct rows
 *   - Subscription data is stored in base64 form, decoded server-side
 */

import { supabase } from './supabase';

// ─── VAPID public key ────────────────────────────────────────────────────────
// This is a PUBLIC key — safe to ship in the client bundle. The PRIVATE
// counterpart lives in the edge function secrets (see supabase/functions/
// send-courier-push/README.md).
//
// To rotate:
//   1. Generate a new pair with web-push / openssl
//   2. Update this constant and the edge function secret
//   3. Old subscriptions become invalid — clients will re-subscribe on
//      next visit after the SW's `pushsubscriptionchange` event fires
export const VAPID_PUBLIC_KEY = 'BCqmIAuDYtNPSgqdA0uU-HcYWWDaejN9ImCL6V1q_cjje3XlUN6c_qs3lSKVZrn40aiQPtyolrXYC7SVI5GBH_U';

// ─── Feature detection ───────────────────────────────────────────────────────

/** Is this device an iPhone / iPad / iPod in Safari? */
export function isIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return (
        /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS 13+ reports as Mac — detect via touch points
        (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
    );
}

/** Is the app running as an installed PWA (standalone display mode)? */
export function isStandalonePWA(): boolean {
    if (typeof window === 'undefined') return false;
    const mq = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    // iOS Safari legacy: navigator.standalone
    const legacyIOS = (window.navigator as any).standalone === true;
    return mq || legacyIOS;
}

/**
 * Does this environment support the Web Push API at all?
 * On iOS this is true ONLY inside an installed PWA — outside, iOS Safari
 * pretends to support Notification but silently rejects requests.
 */
export function supportsWebPush(): boolean {
    if (typeof window === 'undefined') return false;
    if (!('serviceWorker' in navigator)) return false;
    if (!('PushManager' in window)) return false;
    if (!('Notification' in window)) return false;
    // iOS requires standalone mode for push to actually work
    if (isIOS() && !isStandalonePWA()) return false;
    return true;
}

/**
 * Can the app show foreground notifications (via Notification API)?
 * Broader than `supportsWebPush` — covers desktop browsers that don't
 * have PushManager.
 */
export function supportsForegroundNotifications(): boolean {
    if (typeof window === 'undefined') return false;
    if (!('Notification' in window)) return false;
    if (isIOS() && !isStandalonePWA()) return false;
    return true;
}

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function getPermissionState(): PermissionState {
    if (!supportsForegroundNotifications()) return 'unsupported';
    switch (Notification.permission) {
        case 'granted':
            return 'granted';
        case 'denied':
            return 'denied';
        default:
            return 'default';
    }
}

// ─── Service worker registration ─────────────────────────────────────────────

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return Promise.resolve(null);
    }
    if (swRegistrationPromise) return swRegistrationPromise;
    swRegistrationPromise = (async () => {
        try {
            // Check for an existing registration first to avoid redundant installs
            const existing = await navigator.serviceWorker.getRegistration('/');
            if (existing) {
                await navigator.serviceWorker.ready;
                return existing;
            }
            const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            await navigator.serviceWorker.ready;
            return reg;
        } catch (err) {
            console.warn('[notifications] service worker registration failed', err);
            return null;
        }
    })();
    return swRegistrationPromise;
}

// ─── Permission request ─────────────────────────────────────────────────────

/**
 * Requests notification permission. Safe to call multiple times — if
 * permission is already decided we short-circuit without triggering the
 * native prompt again.
 *
 * MUST be called from inside a user gesture (click handler) otherwise
 * browsers silently deny.
 */
export async function requestPermission(): Promise<PermissionState> {
    if (!supportsForegroundNotifications()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';

    try {
        const result = await Notification.requestPermission();
        if (result === 'granted') return 'granted';
        if (result === 'denied') return 'denied';
        return 'default';
    } catch (err) {
        console.warn('[notifications] requestPermission threw', err);
        return 'default';
    }
}

// ─── Push subscription ──────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export type SubscribeResult = {
    ok: boolean;
    reason?: 'unsupported' | 'denied' | 'sw-failed' | 'push-subscribe-failed' | 'db-failed';
    endpoint?: string;
};

/**
 * Registers the service worker, requests permission if needed, creates a
 * push subscription using the VAPID public key, and persists it in the
 * `push_subscriptions` table scoped to (user, business).
 *
 * Idempotent: calling twice does not duplicate rows — the upsert keys on
 * (user_id, endpoint) which is enforced by a UNIQUE constraint.
 */
export async function subscribeToPush(
    userId: string,
    businessId: string | null,
): Promise<SubscribeResult> {
    if (!supportsWebPush()) {
        return { ok: false, reason: 'unsupported' };
    }

    const reg = await ensureServiceWorker();
    if (!reg) {
        return { ok: false, reason: 'sw-failed' };
    }

    if (Notification.permission !== 'granted') {
        return { ok: false, reason: 'denied' };
    }

    // Try to reuse an existing subscription before creating a new one
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
        try {
            subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                // `applicationServerKey` accepts a BufferSource — the typed
                // Uint8Array view is compatible, we just need to pass its
                // underlying buffer to satisfy the lib.dom.d.ts signature.
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
            });
        } catch (err) {
            console.warn('[notifications] pushManager.subscribe failed', err);
            return { ok: false, reason: 'push-subscribe-failed' };
        }
    }

    const endpoint = subscription.endpoint;
    const p256dh = arrayBufferToBase64(subscription.getKey('p256dh'));
    const auth = arrayBufferToBase64(subscription.getKey('auth'));

    try {
        const { error } = await (supabase as any).from('push_subscriptions').upsert(
            {
                user_id: userId,
                'DigiCom Business': businessId,
                endpoint,
                p256dh,
                auth,
                user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
                platform: typeof navigator !== 'undefined' ? navigator.platform : null,
                revoked_at: null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,endpoint' },
        );
        if (error) {
            console.warn('[notifications] push_subscriptions upsert failed', error);
            return { ok: false, reason: 'db-failed', endpoint };
        }
        return { ok: true, endpoint };
    } catch (err) {
        console.warn('[notifications] push_subscriptions upsert threw', err);
        return { ok: false, reason: 'db-failed', endpoint };
    }
}

export async function unsubscribeFromPush(): Promise<boolean> {
    try {
        const reg = await ensureServiceWorker();
        if (!reg) return false;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return true;
        const endpoint = sub.endpoint;
        const ok = await sub.unsubscribe();

        // Mark server-side row as revoked (best effort)
        try {
            await (supabase as any)
                .from('push_subscriptions')
                .update({ revoked_at: new Date().toISOString() })
                .eq('endpoint', endpoint);
        } catch {
            // ignore
        }

        return ok;
    } catch (err) {
        console.warn('[notifications] unsubscribeFromPush failed', err);
        return false;
    }
}

// ─── Foreground notification helper ─────────────────────────────────────────

export type ShowNotificationOptions = {
    title: string;
    body?: string;
    url?: string;
    tag?: string;
    icon?: string;
    badge?: string;
};

/**
 * Shows a notification from within the app. Uses the service worker's
 * `showNotification` when available (best on mobile: works even when the
 * tab is backgrounded), falls back to `new Notification()` for browsers
 * without SW support.
 */
export async function showLocalNotification(opts: ShowNotificationOptions): Promise<boolean> {
    if (!supportsForegroundNotifications()) return false;
    if (Notification.permission !== 'granted') return false;

    const options: NotificationOptions = {
        body: opts.body,
        icon: opts.icon || '/Logo/iGrowFast Icon Transparent.png',
        badge: opts.badge || '/Logo/iGrowFast Icon Transparent.png',
        tag: opts.tag,
        // @ts-expect-error — `vibrate` is valid in NotificationOptions on most platforms
        vibrate: [100, 50, 100],
        data: { url: opts.url || '/' },
    };

    try {
        const reg = await ensureServiceWorker();
        if (reg) {
            await reg.showNotification(opts.title, options);
            return true;
        }
        // Fallback: plain Notification constructor
        // eslint-disable-next-line no-new
        new Notification(opts.title, options);
        return true;
    } catch (err) {
        console.warn('[notifications] showLocalNotification failed', err);
        return false;
    }
}

// ─── Dismiss state ──────────────────────────────────────────────────────────
// Tracks whether the user dismissed the permission dialog this session, so
// we don't nag them on every page navigation.

const DISMISS_KEY = 'igrowfast:notif:dismissed';

export function markPermissionDialogDismissed(): void {
    try {
        sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
        // ignore
    }
}

export function wasPermissionDialogDismissed(): boolean {
    try {
        return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
        return false;
    }
}
