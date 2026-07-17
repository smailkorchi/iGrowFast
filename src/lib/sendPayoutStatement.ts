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
import { resolveStamps } from '@/lib/businessStamps';
// PDF builders are dynamically imported at each call site below so @react-pdf (~1.5 MB)
// stays OFF the eager bundle — it loads only when a payout statement is actually generated.
import type { SellerPayoutPdfInput, SellerPayoutPdfOrder } from '@/lib/sellerPayoutPdf';
import type { MediaBuyerPayoutPdfInput } from '@/lib/mediabuyerPayoutPdf';
import type { CourierPayoutPdfInput } from '@/lib/courierPayoutPdf';
import type { CourierReturnPdfInput } from '@/lib/courierReturnPdf';
import { attributePaymentOrders } from '@/lib/payoutOrderAttribution';
import { getPlatformSource } from '@/lib/campaignConstants';

const CURRENCY = 'MAD';
const fmtMAD = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(n) || 0)
    .replace(/[  ]/g, ' '); // narrow/no-break space → regular space (Helvetica has no glyph)
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
  legal_form: string | null; capital_social: string | null;
  ice: string | null; rc: string | null; patente: string | null;
  identifiant_fiscal: string | null; cnss: string | null;
  legal_address: string | null; legal_city: string | null; postal_code: string | null;
  business_phone: string | null; business_email: string | null; website: string | null;
  cachet_url: string | null; signature_url: string | null;
};

async function fetchBusinessBranding(businessId: string): Promise<BusinessBranding> {
  const { data } = await (supabase as any)
    .from('businesses')
    .select('name, logo, legal_form, capital_social, ice, rc, patente, identifiant_fiscal, cnss, legal_address, legal_city, postal_code, business_phone, business_email, website, cachet_url, signature_url')
    .eq('id', businessId)
    .maybeSingle();
  // Stamps live in the PRIVATE business-stamps bucket — resolve to signed URLs
  // so the client-side PDF embed step can fetch them (#44).
  return resolveStamps({
    name: data?.name || 'iGrowFast',
    logo: data?.logo ?? null,
    legal_form: data?.legal_form ?? null,
    capital_social: data?.capital_social ?? null,
    ice: data?.ice ?? null,
    rc: data?.rc ?? null,
    patente: data?.patente ?? null,
    identifiant_fiscal: data?.identifiant_fiscal ?? null,
    cnss: data?.cnss ?? null,
    legal_address: data?.legal_address ?? null,
    legal_city: data?.legal_city ?? null,
    postal_code: data?.postal_code ?? null,
    business_phone: data?.business_phone ?? null,
    business_email: data?.business_email ?? null,
    website: data?.website ?? null,
    cachet_url: data?.cachet_url ?? null,
    signature_url: data?.signature_url ?? null,
  });
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
    .from('package_statuses').select('id').eq('is_shipped', true);
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

  // FIFO: this payment settles the OLDEST still-unpaid orders. Its money window runs from
  // what was paid before it (paidBefore) to what is paid after it; carried-in (prior-month
  // debt) is settled first. Only the orders inside that window appear on this statement.
  const carriedInNum = Number(openTicket?.carried_in || 0);
  const paidBeforeNum = Number(paidBefore || 0);
  const slice = attributePaymentOrders(orders, carriedInNum, paidBeforeNum, paidBeforeNum + Number(amountPaid || 0));
  // Delivered orders still awaiting settlement after this payment (the "(restant)" counterpart).
  const settledCumulative = attributePaymentOrders(orders, carriedInNum, 0, alreadyPaid).orders.length;
  const remainingOrders = Math.max(0, orders.length - settledCumulative);

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
    report_portion: slice.reportPortion,
    remaining_orders: remainingOrders,
    orders: slice.orders as SellerPayoutPdfOrder[],
    business: branding,
    seller: { name: seller?.name || 'Commercial', avatar_url: seller?.avatar_url ?? null },
  };

  const { buildSellerPayoutPdfBase64 } = await import('@/lib/sellerPayoutPdf');
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
      delivered_orders: String(slice.orders.length),
      remaining_orders: String(remainingOrders),
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
    .select('mediabuyer_id, payout_month, total_amount, paid_amount, carried_in, commission_earned, total_spend, delivered_orders, campaigns_count')
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

  // `paid_amount` is read back AFTER pay_mediabuyer committed this disbursement, so it is
  // already the cumulative total paid — do NOT add amountPaid again (that double-counted it,
  // wrongly showing "Payé / reste 0" on a partial). The seller path passes a pre-payment value.
  const alreadyPaid = Number(payout.paid_amount || 0);
  const totalAmount = Number(payout.total_amount || 0);
  const remainingOwed = Math.max(0, totalAmount - alreadyPaid);
  const statusLabel = remainingOwed <= 0.01 ? 'Payé' : 'Partiel';
  const period = monthLabel(month);
  const reference = `VM-${month.replace('-', '')}-${mbId.slice(0, 6).toUpperCase()}`;

  // Day→source tree of the orders THIS payment settled (FIFO oldest-first, like sellers),
  // with the day's ad-spend and the MB's revenue (commission_price per delivered order).
  const carriedIn = Number(payout.carried_in || 0);
  const paidBefore = Math.max(0, alreadyPaid - Number(amountPaid || 0));
  const { data: mbOrderRows } = await (supabase as any).rpc('mediabuyer_month_orders', {
    p_mb: mbId, p_business: businessId, p_month: `${month}-01`,
  });
  const mbOrders = ((mbOrderRows || []) as Array<Record<string, unknown>>).map((r) => ({
    order_id: String(r.order_id),
    client: (r.client as string) ?? null,
    phone: (r.phone as string) ?? null,
    tracking: (r.tracking as string) ?? null,
    units: Number(r.units || 0),
    commission: Number(r.commission || 0),
    delivered_at: (r.delivered_at as string) ?? null,
    bucket_date: String(r.bucket_date),
    source: (r.source as string) ?? null,
  }));
  const mbSlice = attributePaymentOrders(mbOrders, carriedIn, paidBefore, alreadyPaid);
  const spendByBucket = new Map<string, number>();
  for (const d of daily) {
    const k = `${d.date}|${(d.source || '').toLowerCase()}`;
    spendByBucket.set(k, (spendByBucket.get(k) || 0) + Number(d.spend || 0));
  }
  type TreeGroup = { date: string; source: string | null; spend: number; revenue: number; orders: Array<{ order_id: string; client: string | null; phone: string | null; tracking: string | null; units: number; paidPortion: number; partial: boolean }> };
  const groupMap = new Map<string, TreeGroup>();
  for (const o of mbSlice.orders as unknown as Array<Record<string, unknown>>) {
    const srcRaw = String(o.source || '');
    const k = `${String(o.bucket_date)}|${srcRaw.toLowerCase()}`;
    let g = groupMap.get(k);
    if (!g) {
      const srcDisplay = srcRaw ? srcRaw.charAt(0).toUpperCase() + srcRaw.slice(1) : null;
      g = { date: String(o.bucket_date), source: srcDisplay, spend: spendByBucket.get(k) || 0, revenue: 0, orders: [] };
      groupMap.set(k, g);
    }
    g.revenue += Number(o.paidPortion || 0);
    g.orders.push({
      order_id: String(o.order_id), client: (o.client as string) ?? null, phone: (o.phone as string) ?? null,
      tracking: (o.tracking as string) ?? null, units: Number(o.units || 0),
      paidPortion: Number(o.paidPortion || 0), partial: !!o.partial,
    });
  }
  const mbTree = Array.from(groupMap.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

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
    tree: mbTree,
    business: branding,
    mediabuyer: { name: mb?.name || 'Media Buyer', avatar_url: mb?.avatar_url ?? null },
  };

  const { buildMediaBuyerPayoutPdfBase64 } = await import('@/lib/mediabuyerPayoutPdf');
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

// Courier DELIVERY/PAYMENT note (sent from the Payments page on mark-paid) — a
// transaction record (not a salary "versement"): COD collected, delivery fees kept, net remitted.
export async function sendCourierPaymentNoteEmail(params: {
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
    business: branding,
    courier: { name: note.courier.name, avatar_url: note.courier.avatar_url },
  };

  const { buildCourierPayoutPdfBase64 } = await import('@/lib/courierPayoutPdf');
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

export type CourierReturnNoteForEmail = {
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

// Courier RETURN note (sent from the Return Notes page on mark-received) — a transaction
// record of the returned parcels and the return fees the courier kept.
export async function sendCourierReturnNoteEmail(params: {
  note: CourierReturnNoteForEmail;
  businessId: string;
  receivedAtIso: string;
}): Promise<void> {
  const { note, businessId, receivedAtIso } = params;
  if (!note.courier?.id) throw new Error('courier_missing');

  const branding = await fetchBusinessBranding(businessId);

  const pdfInput: CourierReturnPdfInput = {
    reference: note.reference,
    total_amount: Number(note.total_amount || 0),
    total_shipping_fees: Number(note.total_shipping_fees || 0),
    net_amount: Number(note.net_amount || 0),
    order_count: Number(note.order_count || 0),
    received_at: receivedAtIso,
    created_at: note.created_at,
    line_items: (note.line_items || []).map((li) => ({
      id: li.id, tracking_code: li.tracking_code, amount: Number(li.amount || 0), shipping_fee: Number(li.shipping_fee || 0),
    })),
    business: branding,
    courier: { name: note.courier.name, avatar_url: note.courier.avatar_url },
  };

  const { buildCourierReturnPdfBase64 } = await import('@/lib/courierReturnPdf');
  const { base64, filename } = await buildCourierReturnPdfBase64(pdfInput);

  await invokeEdge({
    role: 'courier_return',
    business_id: businessId,
    recipient_user_id: note.courier.id,
    pdf_base64: base64,
    pdf_filename: filename,
    vars: {
      user_name: note.courier.name || 'Livreur',
      business_name: branding.name,
      reference: note.reference,
      return_fees: fmtMAD(Number(note.total_shipping_fees || 0)),
      currency: CURRENCY,
      received_at: fmtDateFr(receivedAtIso),
      order_count: String(Number(note.order_count || 0)),
      parcels_value: fmtMAD(Number(note.total_amount || 0)),
      net_amount: fmtMAD(Number(note.net_amount || 0)),
    },
  });
}
