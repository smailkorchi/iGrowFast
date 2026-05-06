import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

type Mode = 'off' | 'static' | 'dynamic' | 'agent';

interface ThreadState {
  ai_mode_resolved: Mode;
  default_mode: Mode | null;
  paused_until: string | null;
  last_human_takeover_at: string | null;
}

interface Props {
  threadId: string;
  /** Optional: render compactly (icon-only) when space-constrained. */
  compact?: boolean;
}

/**
 * Per-thread AI control. Shows resolved mode + override popover.
 * Renders a small pill in the WhatsApp inbox conversation header.
 */
export function AIThreadPill({ threadId, compact = false }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: state, isLoading } = useQuery<ThreadState | null>({
    queryKey: ['ai-thread-pill', threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const [thr, mode, brain] = await Promise.all([
        supabase.from('wa_threads').select('ai_mode_resolved, business_id').eq('id', threadId).maybeSingle(),
        supabase.from('ai_thread_mode').select('paused_until, last_human_takeover_at').eq('thread_id', threadId).maybeSingle(),
        // brain is needed to know if AI is even configured (default_mode)
        (async () => {
          const r1 = await supabase.from('wa_threads').select('business_id').eq('id', threadId).maybeSingle();
          if (!r1.data) return { data: null };
          return supabase.from('ai_business_brain').select('default_mode').eq('business_id', r1.data.business_id).maybeSingle();
        })(),
      ]);
      const resolved = (thr.data?.ai_mode_resolved as Mode) ?? 'off';
      return {
        ai_mode_resolved: resolved,
        default_mode: (brain.data?.default_mode as Mode) ?? null,
        paused_until: mode.data?.paused_until ?? null,
        last_human_takeover_at: mode.data?.last_human_takeover_at ?? null,
      };
    },
    refetchInterval: 15_000,
  });

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const setMode = useMutation({
    mutationFn: async ({ mode, pause_minutes }: { mode: Mode | null; pause_minutes?: number }) => {
      const { error } = await supabase.rpc('ai_set_thread_mode', {
        p_thread_id: threadId,
        p_mode: mode,
        p_pause_minutes: pause_minutes ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-thread-pill', threadId] });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: 'AI control failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  if (isLoading || !state) return null;
  // If business hasn't configured a brain default at all, hide the pill — there's nothing meaningful to control.
  if (state.default_mode == null) return null;

  const isPaused = state.paused_until != null && new Date(state.paused_until).getTime() > Date.now();
  const minsLeft = isPaused
    ? Math.max(0, Math.round((new Date(state.paused_until!).getTime() - Date.now()) / 60_000))
    : 0;
  const status: 'on' | 'paused' | 'off' =
    state.ai_mode_resolved === 'off'
      ? (isPaused ? 'paused' : 'off')
      : 'on';

  const cls =
    status === 'on'     ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25' :
    status === 'paused' ? 'bg-amber-500/15  text-amber-300  ring-1 ring-amber-500/30  hover:bg-amber-500/25' :
                          'bg-white/5      text-[#8696a0] ring-1 ring-white/10        hover:bg-white/10';

  const label =
    status === 'on'     ? 'AI on' :
    status === 'paused' ? `AI paused ${minsLeft}m` :
                          'AI off';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={status === 'on' ? 'AI is replying on this thread' : status === 'paused' ? `Resumes in ${minsLeft} minutes` : 'AI is disabled on this thread'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${cls}`}
      >
        {setMode.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <BrainCircuit className="w-3 h-3" />
        )}
        {!compact && <span>{label}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-xl shadow-xl bg-[#233138] border border-[#374045] py-1 animate-in fade-in slide-in-from-top-1 duration-150">
          {status === 'on' ? (
            <>
              <PopoverButton onClick={() => setMode.mutate({ mode: null, pause_minutes: 30 })} label="Pause for 30 min" muted="AI resumes after 30 min" />
              <PopoverButton onClick={() => setMode.mutate({ mode: null, pause_minutes: 24 * 60 })} label="Pause for 24 hours" muted="AI resumes tomorrow" />
              <PopoverButton onClick={() => setMode.mutate({ mode: 'off' })} label="Disable AI for this thread" muted="Override permanently — until you re-enable" danger />
            </>
          ) : status === 'paused' ? (
            <>
              <PopoverButton onClick={() => setMode.mutate({ mode: null })} label="Resume AI now" muted="Clears the pause window" />
              <PopoverButton onClick={() => setMode.mutate({ mode: 'off' })} label="Disable AI for this thread" muted="Override permanently — until you re-enable" danger />
            </>
          ) : (
            <>
              <PopoverButton onClick={() => setMode.mutate({ mode: null })} label="Enable AI for this thread" muted="Use the business default mode" />
              <PopoverButton onClick={() => setMode.mutate({ mode: 'agent' })} label="Force agent mode" muted="Even if business default is off" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PopoverButton({ onClick, label, muted, danger = false }: { onClick: () => void; label: string; muted?: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex flex-col items-start gap-0.5 px-3 py-2 transition-colors ${
        danger ? 'hover:bg-[#3b2a30] text-rose-300' : 'hover:bg-[#374045] text-[#e9edef]'
      }`}
    >
      <span className="text-[12.5px] font-medium leading-tight">{label}</span>
      {muted ? <span className={`text-[10.5px] leading-snug ${danger ? 'text-rose-300/70' : 'text-[#8696a0]'}`}>{muted}</span> : null}
    </button>
  );
}
