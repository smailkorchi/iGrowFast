// In-app fan-out for ecom:biz broadcast events (W7 R1a).
//
// EXACTLY ONE realtime channel per client may hold the private topic
// `ecom:biz:<business_id>` — Phoenix replaces a second join on the same topic
// from the same socket, and the app shares a single supabase client (the WA
// module re-exports it). The channel is therefore owned by the layout-mounted
// <EcomBizRealtime/> (src/components/realtime/EcomBizRealtime.tsx), which
// republishes every event on this zero-dependency module bus. Anything else
// that needs the events (page-local toasts, the WA chat-orders bridge running
// under its own QueryClient) subscribes HERE — never opens its own channel.

export interface EcomOrderPayload {
    op: 'INSERT' | 'UPDATE' | 'DELETE';
    /** order id */
    id: string;
    /** normalized customer phone (matches the WA chat-orders query key) */
    phone: string | null;
    /** INSERT of a sheet-imported draft awaiting review (SheetReview) */
    review_pending?: boolean;
    /** UPDATE on a soft-deleted order (toast gate) */
    deleted?: boolean;
    /** present only when package_status_id changed — the status toast renders
     *  from this with zero follow-up queries */
    pkg?: {
        package_status_id: string | null;
        name: string | null;
        seller_id: string | null;
        tracking_code: string | null;
        provider_name: string | null;
        provider_type: string | null;
        provider_logo_url: string | null;
    };
}

export interface EcomParcelPayload {
    op: 'INSERT' | 'UPDATE' | 'DELETE';
    tbl: 'company' | 'courier';
    order_id: string | null;
}

export interface EcomStockPayload {
    op: 'INSERT' | 'UPDATE' | 'DELETE';
    tbl: 'product' | 'accessory';
    id: string;
}

export interface EcomWebhookPayload {
    op: 'INSERT';
    /** webhook_logs row id */
    id: string;
}

export type EcomBusEvent =
    | { type: 'order'; payload: EcomOrderPayload }
    | { type: 'parcel'; payload: EcomParcelPayload }
    | { type: 'stock'; payload: EcomStockPayload }
    | { type: 'webhook'; payload: EcomWebhookPayload }
    /** channel re-subscribed after an error/timeout — broadcast is at-most-once,
     *  so subscribers should reconcile (broad refetch) on this signal */
    | { type: 'reconnect' }
    /** live subscription state of the layout-owned ecom:biz channel */
    | { type: 'status'; subscribed: boolean };

type Listener = (event: EcomBusEvent) => void;

const listeners = new Set<Listener>();
let channelSubscribed = false;

/** Current subscription state of the layout-owned ecom:biz channel. */
export function getEcomChannelSubscribed(): boolean {
    return channelSubscribed;
}

/** Subscribe to ecom events. Returns the unsubscribe function. */
export function subscribeEcomBus(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** Publish an event to every subscriber (isolation: one throwing listener never blocks the rest). */
export function publishEcomBus(event: EcomBusEvent): void {
    if (event.type === 'status') channelSubscribed = event.subscribed;
    for (const fn of [...listeners]) {
        try { fn(event); } catch { /* listener errors are its own problem */ }
    }
}
