import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BusinessWhatsAppInbox from '@/pages/business/WhatsAppInbox';

const db = supabase as any;

/**
 * Seller-side WhatsApp inbox.
 *
 * Resolves the current user's allowed instances by reading their rows from
 * `whatsapp_user_instances`:
 *  - One or more rows with scope='all' → no restriction (the seller sees every
 *    instance of the business, present and future).
 *  - Rows with scope='explicit' → only those instance_ids are allowed.
 *
 * The actual UI is rendered by the existing business-side `<WhatsAppInbox />`,
 * with the resolved allowlist passed via `restrictToInstanceIds`. If the
 * allowlist contains exactly one instance, the inbox header automatically
 * locks the picker (no dropdown).
 */
export default function SellerWhatsAppInbox() {
  const [loading, setLoading] = useState(true);
  const [allowedIds, setAllowedIds] = useState<string[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id;
        if (!userId) {
          if (!cancelled) { setError('Not signed in.'); setLoading(false); }
          return;
        }

        const { data: rows, error: qErr } = await db
          .from('whatsapp_user_instances')
          .select('instance_id, scope')
          .eq('user_id', userId);
        if (qErr) throw qErr;

        if (cancelled) return;

        const list = rows || [];
        if (list.some((r: any) => r.scope === 'all')) {
          // Wildcard — no restriction. Pass undefined so the inbox loads all
          // instances of the active business (current default behavior).
          setAllowedIds(undefined);
        } else {
          const ids = list
            .map((r: any) => r.instance_id)
            .filter((x: any): x is string => !!x);
          setAllowedIds(ids);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load access.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="h-[calc(100vh-100px)] flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[calc(100vh-100px)] flex items-center justify-center">
        <p className="text-sm text-red-600 font-medium">{error}</p>
      </div>
    );
  }

  if (allowedIds && allowedIds.length === 0) {
    return (
      <div className="h-[calc(100vh-100px)] flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-gray-700">No WhatsApp access</p>
        <p className="text-xs text-gray-500 max-w-sm">
          You haven't been assigned any WhatsApp devices yet. Ask your administrator to grant access.
        </p>
      </div>
    );
  }

  return <BusinessWhatsAppInbox restrictToInstanceIds={allowedIds} />;
}
