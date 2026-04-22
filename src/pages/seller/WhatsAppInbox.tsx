import { useEffect, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BusinessWhatsAppInbox from '@/pages/admin/business/WhatsAppInbox';

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
      <div className="ant-surface min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-ant-mid animate-spin" strokeWidth={1.5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ant-surface min-h-screen flex items-center justify-center px-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-3 py-1.5 text-[12px] font-semibold text-ant-rose">
          <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
          {error}
        </div>
      </div>
    );
  }

  if (allowedIds && allowedIds.length === 0) {
    return (
      <div className="ant-surface min-h-screen">
        <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
          <header className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
              <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
              Commercial · WhatsApp
            </div>
            <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
              Boîte de réception
            </h1>
          </header>
          <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className="h-[3px] w-full bg-ant-orange" />
            <div className="p-10 flex flex-col items-center gap-3 text-center">
              <div className="h-12 w-12 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
              </div>
              <div className="space-y-1 max-w-md">
                <h2 className="font-display text-[16px] font-semibold text-ant-ink">Aucun accès WhatsApp</h2>
                <p className="font-serif italic text-[12px] text-ant-mid">
                  Aucune instance WhatsApp ne vous a été attribuée. Contactez un administrateur pour obtenir l&apos;accès.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return <BusinessWhatsAppInbox restrictToInstanceIds={allowedIds} />;
}
