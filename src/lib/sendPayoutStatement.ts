/**
 * Client-side orchestrator for collaborator PAYOUT statements (seller / media buyer / courier).
 *
 * Fired the moment an admin records a payment. For each role it:
 *   1. gathers the breakdown (ledger totals + per-order/per-day detail),
 *   2. builds the branded PDF (react-pdf, reusing the role generator),
 *   3. posts it (base64) to the `send-payout-statement` edge function, which
 *      emails the collaborator with the PDF attached and the business's super
 *      admins in CC.
 *
 * Best-effort: callers invoke these fire-and-forget AFTER the payment commits,
 * so a mail/PDF failure never blocks or reverses the recorded payment.
 */
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { buildSellerPayoutPdfBase64, type SellerPayoutPdfInput } from '@/lib/sellerPayoutPdf';
import { buildMediaBuyerPayoutPdfBase64, type MediaBuyerPayoutPdfInput } from '@/lib/mediabuyerPayoutPdf';
import { buildCourierPayoutPdfBase64, type CourierPayoutPdfInput } from '@/lib/courierPayoutPdf';
import { getPlatformSource } from '@/lib/campaignConstants';

const CURRENCY = 'MAD';
const fmtMAD = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtDateFr = (iso: string | null) => {
  if (!iso) return '—';
  try { return format(new Date(iso), 'dd MMMM yyyy à HH:mm', { locale: fr }); } catch { return '—'; }
};
const monthLabel = (month: string | null): string => {
  if (!month) return '';
  try {
    const d = parseISO(`${month.slice(0, 7)}-01`);
    const s = format(d, 'LLLL yyyy', { locale: fr });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch { return month; }
};

type BusinessBranding = {
  name: string; logo: string | null;
  ice: string | null; rc: string | null;
  legal_address: string | null; legal_city: string | null;
  business_phone: string | null; business_email: string | null;
};

async function fetchBusinessBranding(businessId: string): Promise<BusinessBranding> {
  const { data } = await (supabase as any)
    .from('businesses')
    .select('name, logo, ice, rc, legal_address, legal_city, business_phone, business_email')
    .eq('id', businessId)
    .maybeSingle();
  return {
    name: data?.name || 'iGrowFast',
    logo: data?.logo ?? null,
    ice: data?.ice ?? null,
    rc: data?.rc ?? null,
    legal_address: data?.legal_address ?? null,
    legal_city: data?.legal_city ?? null,
    business_phone: data?.business_phone ?? null,
    business_email: data?.business_email ?? null,
  };
}

async function invokeEdge(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-payout-statement', { body });
  if (error) throw error;
  if (data && (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { reason?: string; detail?: string }).detail || (data as { reason?: string }).reason || 'send_failed');
  }
}

// ─── SELLER ───────────────────────────────────────────────────────────────────
export async function sendSellerPayoutEmail(params: {
  sellerId: string;
  businessId: string;
  amountPaid: number;        // this disbursement
  paidAtIso: string;
  accruedTotal: number;      // live total owed (lifetime accrued)
  paidBefore: number;        // Σ paid across rows BEFORE this disbursement
}): Promise<void> {
  const { sellerId, businessId, amountPaid, paidAtIso, accruedTotal, paidBefore } = params;

  const [{ data: seller }, branding] = await Promise.all([
    (supabase as any).from('users').select('name, avatar_url').eq('id', sellerId).maybeSingle(),
    fetchBusinessBranding(businessId),
  ]);

  // Open ticket (current month) for carried_in / month_earned / period label.
  const { data: openTicket } = await (supabase as any)
    .from('seller_ledger')
    .select('payout_month, carried_in, month_earned, delivered_orders')
    .eq('seller_id', sellerId).eq('DigiCom Business', businessId).eq('period_state', 'open')
    .order('payout_month', { ascending: false }).limit(1).maybeSingle();

  const month: string | null = openTicket?.payout_month ?? null;

  // Per-order commission detail for the open month.
  let orders: SellerPayoutPdfInput['orders'] = [];
  if (month) {
    const { data: rows } = await (supabase as any).rpc('seller_month_orders', {
      p_seller: sellerId, p_business: businessId, p_month: `${month.slice(0, 7)}-01`,
    });
    orders = ((rows || []) as Array<Record<string, unknown>>).map((r) => ({
      order_id: String(r.order_id),
      client: (r.client as string) ?? null,
      phone: (r.phone as string) ?? null,
      tracking: (r.tracking as string) ?? null,
      units: Number(r.units || 0),
      commission: Number(r.commission || 0),
      delivered_at: (r.delivered_at as string) ?? null,
    }));
  }

  // Orders still in transit (processing) for this seller.
  let processingOrders = 0;
  const { data: transitPkgs } = await (supabase as any)
    .from('package_statuses').select('id').eq('category', 'in_transit');
  const transitIds = ((transitPkgs || []) as Array<{ id: string }>).map((p) => p.id);
  if (transitIds.length) {
    const { count } = await (supabase as any)
      .from('orders').select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId).eq('DigiCom Business', businessId)
      .is('date_deleted', null).in('package_status_id', transitIds);
    processingOrders = count || 0;
  }

  const alreadyPaid = Number(paidBefore || 0) + Number(amountPaid || 0);
  const totalOwed = Number(accruedTotal || 0);
  const remainingOwed = Math.max(0, totalOwed - alreadyPaid);
  const statusLabel = remainingOwed <= 0.01 ? 'Payé' : 'Partiel';
  const deliveredOrders = orders.length || Number(openTicket?.delivered_orders || 0);
  const period = monthLabel(month) || 'la période en cours';
  const reference = `VC-${(month || '').replace('-', '').slice(0, 6) || 'NA'}-${sellerId.slice(0, 6).toUpperCase()}`;

  const pdfInput: SellerPayoutPdfInput = {
    reference,
    period_label: period,
    status_label: statusLabel,
    paid_at: paidAtIso,
    currency: CURRENCY,
    paid_amount: amountPaid,
    month_earned: Number(openTicket?.month_earned || 0),
    carried_in: Number(openTicket?.carried_in || 0),
    total_owed: totalOwed,
    already_paid: alreadyPaid,
    remaining_owed: remainingOwed,
    delivered_orders: deliveredOrders,
    processing_orders: processingOrders,
    orders,
    business: branding,
    seller: { name: seller?.name || 'Commercial', avatar_url: seller?.avatar_url ?? null },
  };

  const { base64, filename } = await buildSellerPayoutPdfBase64(pdfInput);

  await invokeEdge({
    role: 'seller',
    business_id: businessId,
    recipient_user_id: sellerId,
    pdf_base64: base64,
    pdf_filename: filename,
    vars: {
      user_name: seller?.name || 'Commercial',
      business_name: branding.name,
      paid_amount: fmtMAD(amountPaid),
      currency: CURRENCY,
      paid_at: fmtDateFr(paidAtIso),
      status_label: statusLabel,
      period_label: period,
      month_earned: fmtMAD(Number(openTicket?.month_earned || 0)),
      carried_in: fmtMAD(Number(openTicket?.carried_in || 0)),
      total_owed: fmtMAD(totalOwed),
      already_paid: fmtMAD(alreadyPaid),
      remaining_owed: fmtMAD(remainingOwed),
      delivered_orders: String(deliveredOrders),
      processing_orders: String(processingOrders),
    },
  });
}

// ─── MEDIA BUYER ────────────────────────────────────────────────────────────────
export async function sendMediaBuyerPayoutEmail(params: {
  payoutId: string;
  businessId: string;
  amountPaid: number;
  paidAtIso: string;
}): Promise<void> {
  const { payoutId, businessId, amountPaid, paidAtIso } = params;

  const { data: payout } = await (supabase as any)
    .from('mediabuyer_payments')
    .select('mediabuyer_id, payout_month, total_amount, paid_amount, commission_earned, total_spend, delivered_orders, campaigns_count')
    .eq('id', payoutId).maybeSingle();
  if (!payout?.mediabuyer_id) throw new Error('mb_payout_not_found');

  const mbId: string = payout.mediabuyer_id;
  const month: string = String(payout.payout_month || '').slice(0, 7);

  const [{ data: mb }, branding] = await Promise.all([
    (supabase as any).from('users').select('name, avatar_url, commission_price').eq('id', mbId).maybeSingle(),
    fetchBusinessBranding(businessId),
  ]);

  // Per-day spend rows for the month (transparency table).
  const from = `${month}-01`;
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const to = `${month}-${String(last).padStart(2, '0')}`;
  const { data: entries } = await (supabase as any)
    .from('campaign_daily_entries')
    .select('entry_date, platform, spend')
    .eq('DigiCom Business', businessId).eq('created_by', mbId)
    .gte('entry_date', from).lte('entry_date', to)
    .order('entry_date', { ascending: true });
  const daily = ((entries || []) as Array<{ entry_date: string; platform: string; spend: number | string }>).map((e) => ({
    date: e.entry_date,
    source: getPlatformSource(e.platform) || e.platform || null,
    spend: Number(e.spend || 0),
  }));

  const alreadyPaid = Number(payout.paid_amount || 0) + Number(amountPaid || 0);
  const totalAmount = Number(payout.total_amount || 0);
  const remainingOwed = Math.max(0, totalAmount - alreadyPaid);
  const statusLabel = remainingOwed <= 0.01 ? 'Payé' : 'Partiel';
  const period = monthLabel(month);
  const reference = `VM-${month.replace('-', '')}-${mbId.slice(0, 6).toUpperCase()}`;

  const pdfInput: MediaBuyerPayoutPdfInput = {
    reference,
    period_label: period,
    status_label: statusLabel,
    paid_at: paidAtIso,
    currency: CURRENCY,
    paid_amount: amountPaid,
    commission_earned: Number(payout.commission_earned || 0),
    total_spend: Number(payout.total_spend || 0),
    delivered_orders: Number(payout.delivered_orders || 0),
    campaigns_count: Number(payout.campaigns_count || 0),
    commission_price: Number(mb?.commission_price || 0) || null,
    already_paid: alreadyPaid,
    remaining_owed: remainingOwed,
    daily,
    business: branding,
    mediabuyer: { name: mb?.name || 'Media Buyer', avatar_url: mb?.avatar_url ?? null },
  };

  const { base64, filename } = await buildMediaBuyerPayoutPdfBase64(pdfInput);

  await invokeEdge({
    role: 'mediabuyer',
    business_id: businessId,
    recipient_user_id: mbId,
    pdf_base64: base64,
    pdf_filename: filename,
    vars: {
      user_name: mb?.name || 'Media Buyer',
      business_name: branding.name,
      paid_amount: fmtMAD(amountPaid),
      currency: CURRENCY,
      paid_at: fmtDateFr(paidAtIso),
      status_label: statusLabel,
      period_label: period,
      commission_earned: fmtMAD(Number(payout.commission_earned || 0)),
      total_spend: fmtMAD(Number(payout.total_spend || 0)),
      delivered_orders: String(Number(payout.delivered_orders || 0)),
      campaigns_count: String(Number(payout.campaigns_count || 0)),
      already_paid: fmtMAD(alreadyPaid),
      remaining_owed: fmtMAD(remainingOwed),
    },
  });
}

// ─── COURIER ────────────────────────────────────────────────────────────────────
export type CourierNoteForEmail = {
  id: string;
  reference: string;
  total_amount: number;
  total_shipping_fees: number;
  net_amount: number;
  order_count: number;
  created_at: string;
  line_items: { id: string; order_id: string; tracking_code: string | null; amount: number; shipping_fee: number }[];
  courier: { id: string; name: string; avatar_url: string | null } | null;
};

export async function sendCourierPayoutEmail(params: {
  note: CourierNoteForEmail;
  businessId: string;
  paidAtIso: string;
}): Promise<void> {
  const { note, businessId, paidAtIso } = params;
  if (!note.courier?.id) throw new Error('courier_missing');

  const branding = await fetchBusinessBranding(businessId);

  const pdfInput: CourierPayoutPdfInput = {
    reference: note.reference,
    status: 'paid',
    total_amount: Number(note.total_amount || 0),
    total_shipping_fees: Number(note.total_shipping_fees || 0),
    net_amount: Number(note.net_amount || 0),
    order_count: Number(note.order_count || 0),
    paid_at: paidAtIso,
    created_at: note.created_at,
    line_items: (note.line_items || []).map((li) => ({
      id: li.id, tracking_code: li.tracking_code, amount: Number(li.amount || 0), shipping_fee: Number(li.shipping_fee || 0),
    })),
    business: { name: branding.name, logo: branding.logo },
    courier: { name: note.courier.name, avatar_url: note.courier.avatar_url },
  };

  const { base64, filename } = await buildCourierPayoutPdfBase64(pdfInput);

  await invokeEdge({
    role: 'courier',
    business_id: businessId,
    recipient_user_id: note.courier.id,
    pdf_base64: base64,
    pdf_filename: filename,
    vars: {
      user_name: note.courier.name || 'Livreur',
      business_name: branding.name,
      reference: note.reference,
      paid_amount: fmtMAD(Number(note.total_shipping_fees || 0)),
      currency: CURRENCY,
      paid_at: fmtDateFr(paidAtIso),
      status_label: 'Payé',
      order_count: String(Number(note.order_count || 0)),
      total_collected: fmtMAD(Number(note.total_amount || 0)),
      net_to_business: fmtMAD(Number(note.net_amount || 0)),
    },
  });
}
