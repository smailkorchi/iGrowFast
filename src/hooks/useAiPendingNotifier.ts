// useAiPendingNotifier — subscribes to ai_decisions realtime for ONE business
// and fires sonar (audio chime) + browser notification on every NEW pending
// review row. Honors per-business prefs from ai_business_brain:
//   - notify_audio_enabled    bool   (default false)
//   - notify_browser_enabled  bool   (default true)
//   - notify_quiet_start/end  text   (HH:MM 24h, optional)
//
// Audio is synthesized live via Web Audio API (no asset file). Browser perm
// is requested lazily on the first attempt to fire a notification.
//
// Returns the live count of pending decisions so callers can render a badge.

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type Prefs = {
  notify_audio_enabled: boolean;
  notify_browser_enabled: boolean;
  notify_quiet_start: string | null;
  notify_quiet_end:   string | null;
};

export function useAiPendingNotifier(businessId: string | null | undefined) {
  const qc = useQueryClient();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const prefsRef = useRef<Prefs | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Load prefs once + cache
  const { data: prefs } = useQuery<Prefs | null>({
    queryKey: ['ai-notify-prefs', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      if (!businessId) return null;
      const { data } = await supabase
        .from('ai_business_brain')
        .select('notify_audio_enabled, notify_browser_enabled, notify_quiet_start, notify_quiet_end')
        .eq('business_id', businessId)
        .maybeSingle();
      return (data as Prefs | null) ?? {
        notify_audio_enabled: false,
        notify_browser_enabled: true,
        notify_quiet_start: null,
        notify_quiet_end: null,
      };
    },
  });
  useEffect(() => { prefsRef.current = prefs ?? null; }, [prefs]);

  // Initial pending count + realtime subscription
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;

    const fetchCount = async () => {
      const { count } = await supabase
        .from('ai_decisions')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('review_status', 'pending');
      if (!cancelled) setPendingCount(count ?? 0);
    };
    fetchCount();

    const channel = supabase
      .channel(`ai-pending-${businessId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ai_decisions', filter: `business_id=eq.${businessId}` },
        (payload: any) => {
          const row = payload?.new;
          if (row?.review_status === 'pending') {
            // Bump count + invalidate review-queue caches so the UI re-fetches
            setPendingCount((n) => (n ?? 0) + 1);
            qc.invalidateQueries({ queryKey: ['ai-review-queue', businessId] });
            qc.invalidateQueries({ queryKey: ['ai-pending-count', businessId] });
            fireNotification({
              prefs: prefsRef.current,
              title: 'New WhatsApp reply needs your approval',
              body:  describeDecision(row),
              audioCtxRef,
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ai_decisions', filter: `business_id=eq.${businessId}` },
        (payload: any) => {
          const before = payload?.old?.review_status;
          const after  = payload?.new?.review_status;
          // Decrement when a pending row leaves pending (approved/rejected/skipped).
          if (before === 'pending' && after !== 'pending') {
            setPendingCount((n) => Math.max(0, (n ?? 0) - 1));
            qc.invalidateQueries({ queryKey: ['ai-review-queue', businessId] });
            qc.invalidateQueries({ queryKey: ['ai-pending-count', businessId] });
          }
          // New pending appearing via UPDATE (rare — usually the brain inserts directly).
          if (before !== 'pending' && after === 'pending') {
            setPendingCount((n) => (n ?? 0) + 1);
            qc.invalidateQueries({ queryKey: ['ai-review-queue', businessId] });
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [businessId, qc]);

  return { pendingCount };
}

// ─── helpers ────────────────────────────────────────────────────────────

function describeDecision(row: any): string {
  const intent = row?.brain_intent?.intent || 'reply';
  const conf   = row?.brain_intent?.confidence;
  return conf != null
    ? `Intent: ${intent} · confidence ${Math.round(Number(conf) * 100)}%`
    : `Intent: ${intent}`;
}

function inQuietHours(prefs: Prefs | null): boolean {
  if (!prefs?.notify_quiet_start || !prefs?.notify_quiet_end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = prefs.notify_quiet_start.split(':').map(Number);
  const [eh, em] = prefs.notify_quiet_end.split(':').map(Number);
  if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) return false;
  const start = sh * 60 + sm;
  const end   = eh * 60 + em;
  // Wraparound (e.g. 22:00 → 08:00 spans midnight)
  if (start <= end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

function playChime(audioCtxRef: React.MutableRefObject<AudioContext | null>) {
  try {
    if (!audioCtxRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    // Two-tone "ping" — 880 Hz then 660 Hz, 200ms total, soft envelope.
    const t = ctx.currentTime;
    [
      { freq: 880, start: 0,    dur: 0.1 },
      { freq: 660, start: 0.08, dur: 0.16 },
    ].forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(0.18, t + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      osc.start(t + start);
      osc.stop(t + start + dur + 0.02);
    });
  } catch { /* audio is best-effort */ }
}

async function fireNotification({
  prefs, title, body, audioCtxRef,
}: {
  prefs: Prefs | null;
  title: string;
  body:  string;
  audioCtxRef: React.MutableRefObject<AudioContext | null>;
}) {
  if (!prefs) return;
  if (inQuietHours(prefs)) return;

  // Audio fires whether or not the page is in the foreground (browser
  // policies may block until first user gesture; that's expected).
  if (prefs.notify_audio_enabled) playChime(audioCtxRef);

  // Browser notification only when page is NOT visible (avoid double-buzz).
  if (prefs.notify_browser_enabled && typeof Notification !== 'undefined' && document.visibilityState !== 'visible') {
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: '/favicon.svg', tag: 'ai-pending' }); } catch { /* ignore */ }
    }
  }
}
