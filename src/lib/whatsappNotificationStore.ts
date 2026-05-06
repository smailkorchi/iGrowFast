// ─────────────────────────────────────────────────────────────────────────────
// Tiny global pub-sub for WhatsApp notification state.
//
// Tracks two things:
//   1. The conversation that is CURRENTLY OPEN in the inbox (so the global
//      notifications provider can suppress notifications for that chat).
//   2. The list of "active" notification cards being displayed.
//
// No external dependency — uses React's useSyncExternalStore.
// ─────────────────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react';

export interface WhatsAppNotification {
  id: string;                   // unique key (= message_id)
  messageId: string;
  conversationId: string | null;
  remoteJid: string;            // jid of the chat the message belongs to
  instanceId: string;
  instanceName: string;
  instanceAvatarUrl: string | null;
  senderName: string;           // pushName or formatted phone
  senderAvatarUrl: string | null;
  preview: string;              // message text or media label
  type: string;                 // conversation | imageMessage | audioMessage | …
  createdAt: number;            // epoch ms
}

interface State {
  /** jid of the chat currently open in the inbox (null = none) */
  activeChatJid: string | null;
  /** instance the inbox is currently scoped to */
  activeChatInstance: string | null;
  /** notification cards currently visible (newest first) */
  notifications: WhatsAppNotification[];
}

// IMPORTANT: `state` is replaced (not mutated) on every change so that
// `useSyncExternalStore` can detect a new snapshot reference and re-render.
let state: State = {
  activeChatJid: null,
  activeChatInstance: null,
  notifications: [],
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const whatsappNotificationStore = {
  // ── Subscriptions ──────────────────────────────────────────────────
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  getSnapshot(): State {
    return state;
  },

  // ── Active chat tracker ────────────────────────────────────────────
  setActiveChat(jid: string | null, instanceName: string | null) {
    if (state.activeChatJid === jid && state.activeChatInstance === instanceName) return;
    state = { ...state, activeChatJid: jid, activeChatInstance: instanceName };
    emit();
  },

  // ── Notification stack ─────────────────────────────────────────────
  push(n: WhatsAppNotification) {
    // Dedupe by messageId — never show the same message twice
    if (state.notifications.find(x => x.messageId === n.messageId)) return;
    state = { ...state, notifications: [n, ...state.notifications].slice(0, 6) };
    emit();
  },
  dismiss(id: string) {
    const next = state.notifications.filter(n => n.id !== id);
    if (next.length === state.notifications.length) return;
    state = { ...state, notifications: next };
    emit();
  },
  clear() {
    if (state.notifications.length === 0) return;
    state = { ...state, notifications: [] };
    emit();
  },
};

// ── Hooks ──────────────────────────────────────────────────────────────────
export function useWhatsAppNotificationsState(): State {
  return useSyncExternalStore(
    whatsappNotificationStore.subscribe,
    whatsappNotificationStore.getSnapshot,
    whatsappNotificationStore.getSnapshot,
  );
}
