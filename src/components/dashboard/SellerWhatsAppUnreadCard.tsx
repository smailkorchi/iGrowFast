import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { WhatsAppUnreadCard } from './WhatsAppUnreadCard';

type WaUserInstanceRow = { instance_id: string | null; scope: string | null };

interface Props {
  businessId: string;
}

/**
 * Seller-side wrapper for the WhatsApp unread card.
 *
 * Resolves the current seller's allowed WhatsApp instances and forwards them
 * to <WhatsAppUnreadCard />. Renders nothing if the seller has no access.
 */
export function SellerWhatsAppUnreadCard({ businessId }: Props) {
  const [loading, setLoading] = useState(true);
  const [allowedIds, setAllowedIds] = useState<string[] | undefined>(undefined);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) { if (!cancelled) setLoading(false); return; }

      const { data: rows } = await supabase
        .from('whatsapp_user_instances')
        .select('instance_id, scope')
        .eq('user_id', userId);
      if (cancelled) return;

      const list = (rows || []) as WaUserInstanceRow[];
      if (list.length === 0) {
        setHasAccess(false);
        setLoading(false);
        return;
      }

      setHasAccess(true);
      if (list.some((r) => r.scope === 'all')) {
        // Wildcard — pass undefined so the card aggregates every business instance
        setAllowedIds(undefined);
      } else {
        const ids = list
          .map((r) => r.instance_id)
          .filter((x): x is string => !!x);
        setAllowedIds(ids);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !hasAccess) return null;

  return (
    <WhatsAppUnreadCard
      businessId={businessId}
      restrictToInstanceIds={allowedIds}
      inboxPath="/seller/whatsapp/inbox"
    />
  );
}
