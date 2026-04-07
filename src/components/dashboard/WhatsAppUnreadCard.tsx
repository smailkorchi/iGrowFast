import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { supabase } from '@/lib/supabase';

const db = supabase as any;

interface InstanceUnread {
  id: string;
  instance_name: string;
  profile_pic: string | null;
  unread: number;
}

interface Props {
  businessId: string;
  /**
   * Optional allowlist of instance IDs (used by sellers).
   * - undefined → no restriction (admin/owner usage)
   * - non-empty array → only those instances are aggregated
   * - empty array → render nothing (caller should not mount in this case)
   */
  restrictToInstanceIds?: string[];
  /** Where to navigate when the card is clicked */
  inboxPath?: string;
}

/**
 * Dashboard card showing total unread WhatsApp messages across all open
 * instances of the active business. Updates live via realtime when new
 * messages arrive or unread counters change.
 */
export function WhatsAppUnreadCard({ businessId, restrictToInstanceIds, inboxPath = '/business/whatsapp/inbox' }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InstanceUnread[]>([]);

  // ── Loader ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!businessId) return;
    let query: any = db
      .from('whatsapp_instances')
      .select('id, instance_name, profile_pic')
      .eq('business_id', businessId)
      .eq('status', 'open')
      .order('created_at', { ascending: true });

    // Seller scope: filter to allowed instances. Empty allowlist → render empty.
    if (restrictToInstanceIds !== undefined) {
      if (restrictToInstanceIds.length === 0) {
        setRows([]); setLoading(false); return;
      }
      query = query.in('id', restrictToInstanceIds);
    }

    const { data: instances } = await query;
    if (!instances) { setLoading(false); return; }

    const ids = instances.map((i: any) => i.id);
    if (ids.length === 0) { setRows([]); setLoading(false); return; }

    const { data: convs } = await db
      .from('whatsapp_conversations')
      .select('instance_id, unread_count')
      .in('instance_id', ids)
      .gt('unread_count', 0);

    const totals: Record<string, number> = {};
    for (const c of convs || []) {
      totals[c.instance_id] = (totals[c.instance_id] || 0) + (c.unread_count || 0);
    }

    setRows(instances.map((i: any) => ({
      id: i.id,
      instance_name: i.instance_name,
      profile_pic: i.profile_pic,
      unread: totals[i.id] || 0,
    })));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, restrictToInstanceIds?.join(',')]);

  useEffect(() => { load(); }, [load]);

  // ── Realtime: re-aggregate whenever a conversation row updates ────
  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`dash-wa-unread-${businessId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_conversations',
        filter: `business_id=eq.${businessId}`,
      }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [businessId, load]);

  const total = rows.reduce((s, r) => s + r.unread, 0);
  const activeInstances = rows.filter(r => r.unread > 0);

  return (
    <div
      onClick={() => navigate(inboxPath)}
      className="group relative h-full w-full flex-1 flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-white via-emerald-50/30 to-teal-50/20 border border-emerald-100/50 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all cursor-pointer"
    >
      {/* Subtle decorative blob */}
      <div className="absolute -top-16 -right-16 w-48 h-48 bg-emerald-200/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex flex-col flex-1 min-h-0 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#25D366]/10 flex items-center justify-center">
              <FaWhatsapp className="w-5 h-5 text-[#25D366]" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700/70">WhatsApp</p>
              <p className="text-sm font-medium text-gray-900">Unread messages</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
        </div>

        {/* Big number */}
        <div className="flex items-baseline gap-2 mb-5">
          {loading ? (
            <Loader2 className="w-7 h-7 animate-spin text-gray-300" />
          ) : (
            <>
              <span className="text-5xl font-extralight text-gray-900 tabular-nums tracking-tight">
                {total.toLocaleString()}
              </span>
              <span className="text-xs font-medium text-gray-400">
                across {rows.length} {rows.length === 1 ? 'device' : 'devices'}
              </span>
            </>
          )}
        </div>

        {/* Per-instance breakdown — fills remaining height, scrolls when overflowing */}
        {!loading && rows.length > 0 && (
          <div
            className="flex-1 min-h-0 -mx-2 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none]"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {activeInstances.length === 0 ? (
              <p className="text-[11px] text-gray-400 font-light italic px-2">All caught up.</p>
            ) : (
              <div className="space-y-1">
                {activeInstances.map(r => (
                  <div
                    key={r.id}
                    onClick={() => navigate(inboxPath)}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-emerald-50/60 transition-colors cursor-pointer"
                  >
                    <div className="w-7 h-7 rounded-full overflow-hidden bg-emerald-100 flex items-center justify-center shrink-0 ring-1 ring-emerald-200/40">
                      {r.profile_pic ? (
                        <img src={r.profile_pic} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[9px] font-bold text-emerald-700">
                          {r.instance_name.substring(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="text-[12px] text-gray-700 font-medium truncate flex-1">{r.instance_name}</span>
                    <span className="text-[11px] font-bold text-white bg-[#25D366] rounded-full px-2 py-0.5 tabular-nums shrink-0 min-w-[24px] text-center">
                      {r.unread}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="text-[11px] text-gray-400 font-light italic">No connected devices.</p>
        )}
      </div>
    </div>
  );
}
