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
      } catch (e) {
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
        <Loader2 className="w-5 h-5 text-brand-navy animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[calc(100vh-100px)] flex items-center justify-center">
        <p className="text-[11px] font-semibold text-red-600">{error}</p>
      </div>
    );
  }

  if (allowedIds && allowedIds.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5">
        <div className="rounded-xl border border-gray-100 bg-white p-3.5 flex flex-col items-center justify-center py-16 gap-3">
          <div className="text-center">
            <p className="text-[13px] font-semibold text-brand-navy">No WhatsApp Access</p>
            <p className="text-[11px] text-gray-400 mt-1 max-w-xs">
              You haven't been assigned any WhatsApp devices yet. Ask your administrator to grant access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <BusinessWhatsAppInbox restrictToInstanceIds={allowedIds} />;
}
