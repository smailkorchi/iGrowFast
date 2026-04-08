import { useEffect, useRef } from 'react';
import type { SupabaseClient, RealtimeChannel, RealtimePostgresInsertPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  whatsappNotificationStore,
  type WhatsAppNotification,
} from '@/lib/whatsappNotificationStore';
import { WhatsAppNotificationStack } from './WhatsAppNotificationCard';

// whatsapp_* tables are not yet in database.types.ts; cast to untyped client for .from() calls.
// All column types below verified via MCP against the live schema.
const db = supabase as unknown as SupabaseClient;

// whatsapp_messages row (INSERT payload)
type WaMessageRow = {
  message_id: string;
  conversation_id: string | null;
  remote_jid: string;
  instance_id: string;
  sender_jid: string | null;
  direction: string;
  type: string;
  content: string | null;
  created_at: string;
  business_id: string;
};

type WaConversationRow = {
  id: string;
  jid: string;
  display_name: string | null;
  profile_pic: string | null;
  type: string;
};

type WaContactRow = { name: string | null; profile_pic: string | null };
type WaInstanceRow = { id: string; instance_name: string; profile_pic: string | null };
type WaUserInstanceRow = { instance_id: string | null; scope: string };
type WaUserProfile = { id: string; role: string | null; 'DigiCom Business': string | null };

// Truncate long previews so cards don't grow huge.
const MAX_PREVIEW = 140;
function buildPreview(type: string | null, content: string | null): string {
  if (!type) return content || '';
  switch (type) {
    case 'imageMessage':    return content ? `📷 ${content}` : '📷 Photo';
    case 'videoMessage':    return content ? `🎥 ${content}` : '🎥 Video';
    case 'audioMessage':    return '🎙️ Voice message';
    case 'documentMessage': return `📎 ${content || 'Document'}`;
    case 'stickerMessage':  return '🏷 Sticker';
    case 'locationMessage': return '📍 Location';
    case 'contactMessage':  return '👤 Contact';
    default:                return (content || '').slice(0, MAX_PREVIEW);
  }
}

// Format a phone JID into a human-readable string.
function jidToDisplayPhone(jid: string | null): string {
  if (!jid) return '';
  return '+' + jid.split('@')[0];
}

// Resolve the bag of metadata required to render a notification card.
// One DB round-trip per inbound message — cheap.
async function resolveNotificationContext(messageRow: WaMessageRow): Promise<WhatsAppNotification | null> {
  try {
    const messageId = messageRow.message_id;
    if (!messageId) return null;

    // Conversation row → display name + jid + profile pic
    let conv: WaConversationRow | null = null;
    if (messageRow.conversation_id) {
      const { data } = await db
        .from('whatsapp_conversations')
        .select('id, jid, display_name, profile_pic, type')
        .eq('id', messageRow.conversation_id)
        .maybeSingle();
      conv = data as WaConversationRow | null;
    }
    // Fallback: look up by (instance_id, jid) if conversation_id is null
    if (!conv && messageRow.remote_jid && messageRow.instance_id) {
      const { data } = await db
        .from('whatsapp_conversations')
        .select('id, jid, display_name, profile_pic, type')
        .eq('instance_id', messageRow.instance_id)
        .eq('jid', messageRow.remote_jid)
        .maybeSingle();
      conv = data as WaConversationRow | null;
    }

    // Group messages: prefer the actual sender (sender_jid) over the group jid
    const isGroup = messageRow.remote_jid?.endsWith?.('@g.us');
    let senderName: string = '';
    let senderAvatarUrl: string | null = null;

    if (isGroup && messageRow.sender_jid) {
      // Look up the group participant in whatsapp_contacts
      const { data: contact } = await db
        .from('whatsapp_contacts')
        .select('name, profile_pic')
        .eq('phone_number', messageRow.sender_jid)
        .maybeSingle();
      const contactRow = contact as WaContactRow | null;
      senderName = contactRow?.name || jidToDisplayPhone(messageRow.sender_jid);
      senderAvatarUrl = contactRow?.profile_pic || null;
    } else {
      senderName = conv?.display_name || jidToDisplayPhone(messageRow.remote_jid) || 'Unknown';
      senderAvatarUrl = conv?.profile_pic || null;
    }

    // Group title prefix → "Group Name: Sender Name"
    let displayName = senderName;
    if (isGroup && conv?.display_name) {
      displayName = `${conv.display_name} · ${senderName}`;
    }

    // Instance row → instance name + profile pic
    const { data: instData } = await db
      .from('whatsapp_instances')
      .select('id, instance_name, profile_pic')
      .eq('id', messageRow.instance_id)
      .maybeSingle();
    const inst = instData as WaInstanceRow | null;

    if (!inst) return null;

    return {
      id: messageId,
      messageId,
      conversationId: messageRow.conversation_id || null,
      remoteJid: messageRow.remote_jid,
      instanceId: messageRow.instance_id,
      instanceName: inst.instance_name,
      instanceAvatarUrl: inst.profile_pic || null,
      senderName: displayName,
      senderAvatarUrl,
      preview: buildPreview(messageRow.type, messageRow.content) || '(empty message)',
      type: messageRow.type || 'conversation',
      createdAt: messageRow.created_at ? new Date(messageRow.created_at).getTime() : Date.now(),
    };
  } catch (e) {
    console.error('[whatsapp-notifications] resolveNotificationContext failed:', e);
    return null;
  }
}

/**
 * Mounted once at the very top of the React tree. Establishes a single global
 * realtime subscription to whatsapp_messages INSERTs for the active business,
 * filters them according to the viewer's role and assigned instances, then
 * pushes results into the notification store. Renders the visual stack.
 */
const log = (...args: unknown[]) => console.log('[wa-notif]', ...args);

export function WhatsAppNotificationsProvider({ children }: { children: React.ReactNode }) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const setupEpochRef = useRef(0);                        // monotonic counter to discard stale async setups
  const allowedInstanceIdsRef = useRef<Set<string> | 'all' | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());      // persistent — never cleared

  useEffect(() => {
    let unmounted = false;

    const teardown = (reason: string) => {
      if (channelRef.current) {
        log('teardown', reason);
        try { supabase.removeChannel(channelRef.current); } catch (e) { log('teardown error', e); }
        channelRef.current = null;
      }
    };

    // Resolve viewer scope and (re)subscribe. Idempotent — calling twice in a
    // row only keeps the latest channel.
    const setupForCurrentSession = async (trigger: string) => {
      const epoch = ++setupEpochRef.current;
      log('setup start', { trigger, epoch });

      // Tear down any existing channel BEFORE awaiting anything async, so a
      // burst of triggers can never leave dangling channels.
      teardown('setup');

      const { data: { session } } = await supabase.auth.getSession();
      if (unmounted || epoch !== setupEpochRef.current) { log('stale 1', epoch); return; }
      const userId = session?.user?.id || null;
      if (!userId) { log('no session'); return; }

      const { data: profileData } = await db
        .from('users')
        .select('id, role, "DigiCom Business"')
        .eq('id', userId)
        .maybeSingle();
      const profile = profileData as WaUserProfile | null;
      if (unmounted || epoch !== setupEpochRef.current) { log('stale 2', epoch); return; }
      if (!profile) { log('no profile'); return; }

      const role: string = profile.role || '';

      // Roles without any WhatsApp access — skip subscription entirely.
      if (role === 'courier') {
        log('skip subscribe: role has no WA access', { role });
        allowedInstanceIdsRef.current = new Set();
        return;
      }

      const isSeller = role === 'commercial';

      let businessId: string | null = null;
      if (isSeller) {
        businessId = profile['DigiCom Business'] || null;
      } else {
        businessId = localStorage.getItem('activeBusinessId');
      }
      if (!businessId) { log('no businessId', { role }); return; }

      if (isSeller) {
        const { data: rows } = await db
          .from('whatsapp_user_instances')
          .select('instance_id, scope')
          .eq('user_id', userId);
        if (unmounted || epoch !== setupEpochRef.current) { log('stale 3', epoch); return; }
        const list = (rows || []) as WaUserInstanceRow[];
        if (list.some((r) => r.scope === 'all')) {
          allowedInstanceIdsRef.current = 'all';
        } else {
          const ids = list.map((r) => r.instance_id).filter((x): x is string => !!x);
          if (ids.length === 0) {
            allowedInstanceIdsRef.current = new Set();
            log('seller has no WA access — skip subscribe');
            return;
          }
          allowedInstanceIdsRef.current = new Set<string>(ids);
        }
      } else {
        allowedInstanceIdsRef.current = 'all';
      }

      // Use a stable channel name per (user, business) so we don't pile up
      // ghost channels on the server when this runs multiple times.
      const channelName = `wa-notif-${userId}-${businessId}`;
      log('subscribing', { channelName, businessId, role, allowed: allowedInstanceIdsRef.current === 'all' ? 'all' : Array.from(allowedInstanceIdsRef.current as Set<string>) });

      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'whatsapp_messages',
            filter: `business_id=eq.${businessId}`,
          },
          async (payload: RealtimePostgresInsertPayload<WaMessageRow>) => {
            const row = payload.new;
            log('event recv', { msg_id: row?.message_id, dir: row?.direction, inst: row?.instance_id });
            if (!row) return;

            if (row.direction !== 'incoming') { log('skip outgoing'); return; }

            if (seenIdsRef.current.has(row.message_id)) { log('skip dedupe', row.message_id); return; }
            seenIdsRef.current.add(row.message_id);
            if (seenIdsRef.current.size > 500) {
              const arr = Array.from(seenIdsRef.current);
              seenIdsRef.current = new Set(arr.slice(-300));
            }

            const allowed = allowedInstanceIdsRef.current;
            if (allowed && allowed !== 'all' && !allowed.has(row.instance_id)) {
              log('skip not-allowed instance', row.instance_id);
              return;
            }

            const { activeChatJid } = whatsappNotificationStore.getSnapshot();
            if (activeChatJid && row.remote_jid === activeChatJid) {
              log('skip active chat', row.remote_jid);
              return;
            }

            const notification = await resolveNotificationContext(row);
            if (!notification) { log('resolve failed', row.message_id); return; }
            log('PUSH', notification.senderName, '→', notification.preview);
            whatsappNotificationStore.push(notification);
          },
        )
        .subscribe((status, err) => {
          log('channel status', status, err || '');
        });

      // Final stale check before assigning — the epoch may have advanced
      // while we awaited the inserts above.
      if (unmounted || epoch !== setupEpochRef.current) {
        log('stale final, removing fresh channel', epoch);
        try { supabase.removeChannel(channel); } catch { /* ignore */ }
        return;
      }
      channelRef.current = channel;
      log('setup done', { epoch, channelName });
    };

    // Initial setup — runs once on mount.
    setupForCurrentSession('mount');

    // Auth listener — only react to events that ACTUALLY change scope.
    // Critically: ignore INITIAL_SESSION (fires synchronously on subscribe and
    // would cause an immediate redundant teardown/resubscribe) and ignore
    // TOKEN_REFRESHED (periodic; not relevant to our scope).
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setupForCurrentSession(`auth:${event}`);
      } else {
        log('auth event ignored', event);
      }
    });

    // Cross-tab business switches.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'activeBusinessId') setupForCurrentSession('storage:business');
    };
    window.addEventListener('storage', onStorage);

    // Expose a debug helper.
    (window as unknown as { __waNotif: unknown }).__waNotif = {
      reload: () => setupForCurrentSession('manual:reload'),
      state: () => ({
        channel: channelRef.current?.state,
        allowed: allowedInstanceIdsRef.current,
        seenSize: seenIdsRef.current.size,
        active: whatsappNotificationStore.getSnapshot(),
      }),
      test: () => whatsappNotificationStore.push({
        id: `test-${Date.now()}`,
        messageId: `test-${Date.now()}`,
        conversationId: null,
        remoteJid: 'test@s.whatsapp.net',
        instanceId: 'test',
        instanceName: 'Test instance',
        instanceAvatarUrl: null,
        senderName: 'Test sender',
        senderAvatarUrl: null,
        preview: 'This is a test notification',
        type: 'conversation',
        createdAt: Date.now(),
      }),
    };
    log('provider mounted; debug: window.__waNotif');

    return () => {
      unmounted = true;
      teardown('unmount');
      authSub?.subscription.unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <>
      {children}
      <WhatsAppNotificationStack />
    </>
  );
}
