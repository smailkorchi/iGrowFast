import type { SupabaseClient } from '@supabase/supabase-js';
import type { BonLivraisonHydrateResult, BonLivraisonParcelSnapshot } from './types';
import type { DevisClientBlock, DevisLine } from '@/lib/devis/types';

type CityRow = { name?: string | null } | null;

function mergeLine(map: Map<string, DevisLine>, label: string, qty: number, unitPrice: number, productId: string | null) {
  const key = label.trim();
  if (!key || qty <= 0) return;
  const prev = map.get(key);
  if (prev) {
    map.set(key, {
      ...prev,
      quantity: prev.quantity + qty,
      unit_price: unitPrice > 0 ? unitPrice : prev.unit_price,
      product_id: prev.product_id ?? productId,
    });
  } else {
    map.set(key, {
      label: key,
      quantity: qty,
      unit_price: unitPrice,
      product_id: productId,
    });
  }
}

function orderItemToLines(item: Record<string, unknown>, includeAccessories: boolean): DevisLine[] {
  const out: DevisLine[] = [];
  const qty = Number(item.quantity) || 0;
  const unit = Number(item.unit_price) || 0;
  const product = item.product as { name?: string; id?: string } | null;
  if (product?.name) {
    out.push({
      label: product.name,
      quantity: qty,
      unit_price: unit,
      product_id: product.id ?? null,
    });
  }
  if (!includeAccessories) return out;
  const accessory = item.accessory as { name?: string } | null;
  const accQty = Number(item.accessory_quantity) || 0;
  const accUnit = Number(item.accessory_unit_price) || 0;
  if (accessory?.name && accQty > 0) {
    out.push({
      label: accessory.name,
      quantity: accQty,
      unit_price: accUnit,
      product_id: null,
    });
  }
  return out;
}

function orderToClient(order: Record<string, unknown>): DevisClientBlock {
  const cityObj = order.city as CityRow;
  return {
    source: 'manual',
    name: String(order.name || 'Client'),
    phone: order.phone ? String(order.phone) : undefined,
    address: order.address ? String(order.address) : undefined,
    city: cityObj?.name ? String(cityObj.name) : undefined,
  };
}

function mergeOrderItemsIntoMap(
  map: Map<string, DevisLine>,
  order: Record<string, unknown>,
  includeAccessories: boolean,
) {
  const items = (order.items as Record<string, unknown>[]) || [];
  for (const item of items) {
    for (const line of orderItemToLines(item, includeAccessories)) {
      mergeLine(map, line.label, line.quantity, line.unit_price, line.product_id ?? null);
    }
  }
}

export async function hydrateBonLivraisonFromOrder(
  supabase: SupabaseClient,
  businessId: string,
  orderId: string,
): Promise<BonLivraisonHydrateResult | null> {
  const { data: order, error } = await supabase
    .from('orders')
    .select(
      `
      id, name, phone, address, delivery_note,
      city:master_cities(name),
      company:providers(id, name, logo_url),
      items:order_items(quantity, unit_price, product_id, accessory_id, accessory_quantity, accessory_unit_price, product:products(id, name), accessory:accessories(name))
    `,
    )
    .eq('id', orderId)
    .eq('DigiCom Business', businessId)
    .is('date_deleted', null)
    .maybeSingle();

  if (error || !order) return null;

  const o = order as Record<string, unknown>;
  const map = new Map<string, DevisLine>();
  /** BL rempli depuis la base : pas d’accessoires sur le document de livraison */
  mergeOrderItemsIntoMap(map, o, false);

  const { data: parcelRows } = await supabase
    .from('company_parcels')
    .select('id, tracking_code, reference, status_label')
    .eq('order_id', orderId)
    .eq('DigiCom Business', businessId);

  const parcels: BonLivraisonParcelSnapshot[] = (parcelRows || []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    tracking_code: p.tracking_code ? String(p.tracking_code) : null,
    reference: p.reference ? String(p.reference) : null,
    status_label: p.status_label ? String(p.status_label) : null,
    recipient_name: o.name ? String(o.name) : null,
    recipient_phone: o.phone ? String(o.phone) : null,
    order_id: orderId,
  }));

  const company = o.company as { name?: string; logo_url?: string | null } | null;
  const transport = company
    ? { provider_name: company.name ?? null, provider_logo_url: company.logo_url ?? null }
    : null;

  return {
    lines: Array.from(map.values()),
    linesSource: 'manual',
    client: orderToClient(o),
    parcels,
    transport,
    linked_reference: o.delivery_note ? String(o.delivery_note) : null,
    company_delivery_note_id: null,
    order_id: orderId,
    show_transport_default: !!transport?.provider_name,
  };
}

export async function hydrateBonLivraisonFromCompanyNote(
  supabase: SupabaseClient,
  businessId: string,
  noteId: string,
): Promise<BonLivraisonHydrateResult | null> {
  const { data: note, error: nErr } = await supabase
    .from('company_delivery_notes')
    .select('id, reference, provider:providers(name, logo_url)')
    .eq('id', noteId)
    .eq('DigiCom Business', businessId)
    .maybeSingle();

  if (nErr || !note) return null;

  const n = note as Record<string, unknown>;
  const provider = n.provider as { name?: string; logo_url?: string | null } | null;
  const transport = provider
    ? { provider_name: provider.name ?? null, provider_logo_url: provider.logo_url ?? null }
    : null;

  const { data: parcelRows, error: pErr } = await supabase
    .from('company_parcels')
    .select('id, tracking_code, reference, status_label, order_id')
    .eq('company_delivery_note_id', noteId)
    .eq('DigiCom Business', businessId);

  if (pErr) return null;

  const orderIds = [
    ...new Set(
      (parcelRows || [])
        .map((p: Record<string, unknown>) => p.order_id as string | null)
        .filter((id): id is string => !!id),
    ),
  ];

  const ordersMap = new Map<string, Record<string, unknown>>();
  if (orderIds.length > 0) {
    const { data: ordersData, error: oErr } = await supabase
      .from('orders')
      .select(
        `
        id, name, phone, address, delivery_note,
        city:master_cities(name),
        items:order_items(quantity, unit_price, product_id, accessory_id, accessory_quantity, accessory_unit_price, product:products(id, name), accessory:accessories(name))
      `,
      )
      .in('id', orderIds)
      .eq('DigiCom Business', businessId)
      .is('date_deleted', null);
    if (!oErr && ordersData) {
      for (const ord of ordersData) {
        ordersMap.set(String((ord as Record<string, unknown>).id), ord as Record<string, unknown>);
      }
    }
  }

  const map = new Map<string, DevisLine>();
  const phones = new Set<string>();
  const parcels: BonLivraisonParcelSnapshot[] = [];

  for (const row of parcelRows || []) {
    const pr = row as Record<string, unknown>;
    const oid = pr.order_id ? String(pr.order_id) : null;
    const ord = oid ? ordersMap.get(oid) : null;
    if (ord) {
      mergeOrderItemsIntoMap(map, ord, false);
      const phone = ord.phone ? String(ord.phone).replace(/[^0-9]/g, '') : '';
      if (phone) phones.add(phone);
    }

    parcels.push({
      id: pr.id as string,
      tracking_code: pr.tracking_code ? String(pr.tracking_code) : null,
      reference: pr.reference ? String(pr.reference) : null,
      status_label: pr.status_label ? String(pr.status_label) : null,
      recipient_name: ord?.name ? String(ord.name) : null,
      recipient_phone: ord?.phone ? String(ord.phone) : null,
      order_id: oid,
    });
  }

  let client: DevisClientBlock;
  const firstParcel = (parcelRows || [])[0] as Record<string, unknown> | undefined;
  const firstOid = firstParcel?.order_id ? String(firstParcel.order_id) : null;
  const first = firstOid ? ordersMap.get(firstOid) : null;
  client = first ? orderToClient(first) : { source: 'manual', name: '—' };

  return {
    lines: Array.from(map.values()),
    linesSource: 'manual',
    client,
    parcels,
    transport,
    linked_reference: n.reference ? String(n.reference) : null,
    company_delivery_note_id: noteId,
    order_id: null,
    show_transport_default: !!transport?.provider_name,
  };
}

export async function hydrateBonLivraisonFromCourierNote(
  supabase: SupabaseClient,
  businessId: string,
  noteId: string,
): Promise<BonLivraisonHydrateResult | null> {
  const { data: note, error: nErr } = await (supabase as any)
    .from('courier_delivery_notes')
    .select('id, reference, courier:users!courier_delivery_notes_courier_id_fkey(name)')
    .eq('id', noteId)
    .eq('DigiCom Business', businessId)
    .maybeSingle();

  if (nErr || !note) return null;

  const n = note as Record<string, unknown>;
  const courier = n.courier as { name?: string } | null;
  const transport = courier
    ? { provider_name: courier.name ?? null, provider_logo_url: null }
    : null;

  const { data: parcelRows, error: pErr } = await (supabase as any)
    .from('courier_parcels')
    .select('id, tracking_code, reference, status_label, order_id')
    .eq('courier_delivery_note_id', noteId)
    .eq('DigiCom Business', businessId);

  if (pErr) return null;

  const orderIds = [
    ...new Set(
      (parcelRows || [])
        .map((p: Record<string, unknown>) => p.order_id as string | null)
        .filter((id): id is string => !!id),
    ),
  ];

  const ordersMap = new Map<string, Record<string, unknown>>();
  if (orderIds.length > 0) {
    const { data: ordersData, error: oErr } = await supabase
      .from('orders')
      .select(
        `
        id, name, phone, address, delivery_note,
        city:master_cities(name),
        items:order_items(quantity, unit_price, product_id, accessory_id, accessory_quantity, accessory_unit_price, product:products(id, name), accessory:accessories(name))
      `,
      )
      .in('id', orderIds)
      .eq('DigiCom Business', businessId)
      .is('date_deleted', null);
    if (!oErr && ordersData) {
      for (const ord of ordersData) {
        ordersMap.set(String((ord as Record<string, unknown>).id), ord as Record<string, unknown>);
      }
    }
  }

  const map = new Map<string, DevisLine>();
  const phones = new Set<string>();
  const parcels: BonLivraisonParcelSnapshot[] = [];

  for (const row of parcelRows || []) {
    const pr = row as Record<string, unknown>;
    const oid = pr.order_id ? String(pr.order_id) : null;
    const ord = oid ? ordersMap.get(oid) : null;
    if (ord) {
      mergeOrderItemsIntoMap(map, ord, false);
      const phone = ord.phone ? String(ord.phone).replace(/[^0-9]/g, '') : '';
      if (phone) phones.add(phone);
    }

    parcels.push({
      id: pr.id as string,
      tracking_code: pr.tracking_code ? String(pr.tracking_code) : null,
      reference: pr.reference ? String(pr.reference) : null,
      status_label: pr.status_label ? String(pr.status_label) : null,
      recipient_name: ord?.name ? String(ord.name) : null,
      recipient_phone: ord?.phone ? String(ord.phone) : null,
      order_id: oid,
    });
  }

  let client: DevisClientBlock;
  const firstParcel = (parcelRows || [])[0] as Record<string, unknown> | undefined;
  const firstOid = firstParcel?.order_id ? String(firstParcel.order_id) : null;
  const first = firstOid ? ordersMap.get(firstOid) : null;
  client = first ? orderToClient(first) : { source: 'manual', name: '—' };

  return {
    lines: Array.from(map.values()),
    linesSource: 'manual',
    client,
    parcels,
    transport,
    linked_reference: n.reference ? String(n.reference) : null,
    company_delivery_note_id: noteId,
    order_id: null,
    show_transport_default: !!transport?.provider_name,
  };
}

/** Try company note first, fall back to courier note */
export async function hydrateBonLivraisonFromAnyNote(
  supabase: SupabaseClient,
  businessId: string,
  noteId: string,
): Promise<BonLivraisonHydrateResult | null> {
  const company = await hydrateBonLivraisonFromCompanyNote(supabase, businessId, noteId);
  if (company) return company;
  return hydrateBonLivraisonFromCourierNote(supabase, businessId, noteId);
}
