/* eslint-disable no-restricted-globals */
/**
 * iGrowFast Service Worker
 *
 * Purpose:
 *   1. Handle Web Push notifications in the background (when the app is
 *      closed, minimized, or the screen is locked). This is the ONLY way
 *      to deliver notifications to iOS Safari and to Android Chrome when
 *      the tab is not in the foreground.
 *   2. Focus / open the relevant app page when the user taps a notification.
 *
 * This is a network-passthrough SW — it does NOT cache assets (the app is
 * already served via Vite/HTTP caching). Its only job is push delivery.
 *
 * Lifecycle:
 *   - install  → immediately activate (skipWaiting)
 *   - activate → claim all clients so the SW controls everything instantly
 *   - push     → deserialize payload + showNotification
 *   - click    → focus existing tab at target URL or open a new one
 */

const SW_VERSION = 'igrowfast-sw-v1';

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    // Take over immediately — no "waiting" phase.
    event.waitUntil(self.skipWaiting());
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    // Claim every open tab so push works without a reload.
    event.waitUntil(self.clients.claim());
});

// ─── Push event ──────────────────────────────────────────────────────────────
// The push payload (sent by the backend edge function) is expected to be JSON
// with this shape:
//   {
//     "title": "Nouveau colis attribué",
//     "body":  "3 nouveaux colis viennent d'être ajoutés",
//     "icon":  "/Logo/iGrowFast Icon Transparent.png",
//     "badge": "/Logo/iGrowFast Icon Transparent.png",
//     "url":   "/courier/orders",
//     "tag":   "courier-note-<uuid>",
//     "data":  { ...arbitrary... }
//   }
//
// We are defensive: if the payload is empty / invalid, we still surface a
// generic notification so the user isn't left wondering why their phone
// buzzed with nothing visible.
self.addEventListener('push', (event) => {
    /** @type {{ title?: string; body?: string; icon?: string; badge?: string; url?: string; tag?: string; data?: any }} */
    let payload = {};
    try {
        if (event.data) {
            payload = event.data.json();
        }
    } catch (err) {
        console.warn('[sw] push payload parse failed', err);
        try {
            if (event.data) payload = { body: event.data.text() };
        } catch {
            // ignore
        }
    }

    const title = payload.title || 'iGrowFast';
    const options = {
        body: payload.body || 'Nouvelle notification',
        icon: payload.icon || '/Logo/iGrowFast Icon Transparent.png',
        badge: payload.badge || '/Logo/iGrowFast Icon Transparent.png',
        tag: payload.tag, // undefined tag = unique notification every time
        renotify: !!payload.tag,
        requireInteraction: false,
        vibrate: [100, 50, 100],
        data: {
            url: payload.url || '/',
            ...(payload.data || {}),
        },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click ──────────────────────────────────────────────────────
// On click: focus an existing tab at the target URL if one exists, otherwise
// open a new tab. Also closes the notification.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        (async () => {
            const allClients = await self.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
            });

            // Try to find an existing tab already on (or close to) the target path.
            const absoluteTarget = new URL(targetUrl, self.location.origin).href;

            for (const client of allClients) {
                // Exact match → just focus
                if (client.url === absoluteTarget && 'focus' in client) {
                    return client.focus();
                }
            }

            // Same origin, different path → navigate and focus
            for (const client of allClients) {
                try {
                    const sameOrigin = new URL(client.url).origin === self.location.origin;
                    if (sameOrigin && 'navigate' in client && 'focus' in client) {
                        await client.navigate(absoluteTarget);
                        return client.focus();
                    }
                } catch {
                    // ignore malformed URLs
                }
            }

            // No tab open → open a new one
            if (self.clients.openWindow) {
                return self.clients.openWindow(absoluteTarget);
            }
        })(),
    );
});

// ─── Push subscription change ────────────────────────────────────────────────
// Some browsers rotate subscription credentials periodically. When that
// happens, we clear the old subscription — the client-side code will
// re-subscribe on next app open and persist the fresh endpoint.
self.addEventListener('pushsubscriptionchange', (event) => {
    console.warn('[sw] push subscription changed; client will re-subscribe on next visit');
    event.waitUntil(Promise.resolve());
});

// Log the version for debugging
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PING') {
        event.source && event.source.postMessage({ type: 'PONG', version: SW_VERSION });
    }
});
