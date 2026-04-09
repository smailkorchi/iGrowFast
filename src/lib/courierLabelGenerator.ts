/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './supabase';
import QRCode from 'qrcode';

// ──────────────────────────────────────────────────────────────────────────
// Internal courier label generator.
// Builds a 100×100 mm sticker and a delivery-note PDF-ready HTML document
// purely on the client. No edge function involved. The visual style mirrors
// the AMEEX sticker the app already uses for external providers, but the
// sender block is the business, and every parcel's flags come from the
// courier_parcels snapshot written at wizard time.
// ──────────────────────────────────────────────────────────────────────────

type CourierParcelRow = {
    id: string;
    courier_id: string;
    reference: string | null;
    tracking_code: string | null;
    order_id: string | null;
    is_fragile: boolean | null;
    is_open: boolean | null;
    is_try_on: boolean | null;
    created_at: string | null;
};

type OrderItemRow = {
    id: string;
    quantity: number | null;
    product?: { id: string; name: string | null; code: string | null } | null;
};

type OrderRow = {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
    price: number | null;
    note: string | null;
    delivery_note: string | null;
    master_city_id: string | null;
    city?: { id: string; name: string | null; zone_id: string | null } | null;
    zone?: { id: string; name: string | null } | null;
    items?: OrderItemRow[] | null;
};

type BusinessRow = {
    id: string;
    name: string | null;
    logo: string | null;
    business_phone: string | null;
    legal_address: string | null;
    legal_city: string | null;
};

type CourierRow = {
    id: string;
    name: string | null;
    phone: string | null;
    avatar_url: string | null;
};

type NoteRow = {
    id: string;
    reference: string | null;
    created_at: string | null;
};

export type CourierPrintFormat = 'sticker' | 'note';

const BRAND_NAVY = '#2d6d6c';
const BRAND_DANGER = '#7f1d1d';
const BRAND_BORDER = '#1f3d3c';
const BRAND_BORDER_LIGHT = '#e5e7eb';

function escapeHtml(input: unknown): string {
    if (input == null) return '';
    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Generates a QR code as a base64 data URL, locally (no network dependency).
 * Uses ECC level **H** (30% recovery) so low print quality, smudges, and
 * partial damage still decode cleanly. Margin is 0 so we control the frame.
 *
 * The payload is intentionally minimal — just the short tracking code like
 * `CR-AB12CD34` — which makes modules large and maximizes scannability even
 * on cheap thermal printers. The courier Orders page filters its own scoped
 * row set by this tracking code, so the QR carries no sensitive data and no
 * cross-business leak is possible.
 */
async function buildQrDataUrl(text: string, size = 220): Promise<string> {
    if (!text) return '';
    try {
        return await QRCode.toDataURL(text, {
            errorCorrectionLevel: 'H',
            margin: 0,
            width: size,
            color: { dark: '#1f3d3c', light: '#ffffff' },
        });
    } catch (e) {
        console.warn('[courier-label] QR generation failed', { text, err: e });
        return '';
    }
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return iso;
    }
}

/** Truncates a zone name into a compact 3-letter code (e.g. "HUB AGADIR" → "AGA"). */
function zoneCode(zoneName: string | null | undefined): string {
    if (!zoneName) return '—';
    const words = zoneName.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/);
    // Prefer the last meaningful word (city), take first 3 chars uppercased.
    const city = words[words.length - 1] || words[0] || '';
    return city.slice(0, 3).toUpperCase() || '—';
}

function zoneHubLetter(zoneName: string | null | undefined): string {
    if (!zoneName) return 'U';
    const n = zoneName.toUpperCase();
    if (n.includes('HUB')) return 'H';
    if (n.includes('REG')) return 'R';
    return 'U';
}

// ── Data loading ────────────────────────────────────────────────────────────
async function loadNoteBundle(noteId: string) {
    console.log('[courier-label] loadNoteBundle: start', { noteId });

    const { data: note, error: noteErr } = await (supabase as any)
        .from('courier_delivery_notes')
        .select('id, reference, created_at, courier_id, "DigiCom Business"')
        .eq('id', noteId)
        .maybeSingle();
    console.log('[courier-label] note query result', { note, noteErr });
    if (noteErr) throw noteErr;
    if (!note) throw new Error('Courier delivery note not found');

    const businessId = note['DigiCom Business'];
    console.log('[courier-label] businessId from note', businessId);

    const [parcelsRes, businessRes, courierRes] = await Promise.all([
        (supabase as any)
            .from('courier_parcels')
            .select('id, courier_id, reference, tracking_code, order_id, is_fragile, is_open, is_try_on, created_at')
            .eq('courier_delivery_note_id', noteId),
        (supabase as any)
            .from('businesses')
            .select('id, name, logo, business_phone, legal_address, legal_city')
            .eq('id', businessId)
            .maybeSingle(),
        (supabase as any)
            .from('users')
            .select('id, name, phone, avatar_url')
            .eq('id', note.courier_id)
            .maybeSingle(),
    ]);
    console.log('[courier-label] parallel queries done', {
        parcelsCount: parcelsRes.data?.length,
        parcelsError: parcelsRes.error,
        business: businessRes.data,
        businessError: businessRes.error,
        courier: courierRes.data,
        courierError: courierRes.error,
    });
    if (parcelsRes.error) throw parcelsRes.error;
    if (businessRes.error) throw businessRes.error;
    if (courierRes.error) throw courierRes.error;

    const parcels = (parcelsRes.data || []) as CourierParcelRow[];
    const business = (businessRes.data || null) as BusinessRow | null;
    const courier = (courierRes.data || null) as CourierRow | null;

    const orderIds = parcels.map((p) => p.order_id).filter(Boolean) as string[];
    console.log('[courier-label] orderIds extracted', orderIds);

    let orders: OrderRow[] = [];
    if (orderIds.length > 0) {
        const { data, error } = await (supabase as any)
            .from('orders')
            .select(`
                id, name, phone, address, price, note, delivery_note, master_city_id,
                city:master_cities(id, name, zone_id),
                items:order_items(id, quantity, product:products(id, name, code))
            `)
            .in('id', orderIds);
        console.log('[courier-label] orders query result', { data, error });
        if (error) throw error;
        orders = (data || []) as OrderRow[];

        const zoneIds = Array.from(
            new Set(orders.map((o) => o.city?.zone_id).filter(Boolean) as string[]),
        );
        console.log('[courier-label] zoneIds extracted', zoneIds);
        if (zoneIds.length > 0) {
            const { data: zones, error: zonesError } = await (supabase as any)
                .from('zones')
                .select('id, name')
                .in('id', zoneIds);
            console.log('[courier-label] zones query result', { zones, zonesError });
            const zoneMap = new Map<string, { id: string; name: string | null }>(
                (zones || []).map((z: any) => [z.id as string, z]),
            );
            orders = orders.map((o) => ({
                ...o,
                zone: o.city?.zone_id ? zoneMap.get(o.city.zone_id) || null : null,
            }));
        }
    }

    console.log('[courier-label] loadNoteBundle: done', {
        parcels: parcels.length,
        orders: orders.length,
        hasBusiness: !!business,
        hasCourier: !!courier,
    });
    return { note: note as NoteRow & { courier_id: string }, parcels, orders, business, courier };
}

// ── Sticker template (100×100 mm) ──────────────────────────────────────────
function renderSticker(opts: {
    parcel: CourierParcelRow;
    order: OrderRow | null;
    business: BusinessRow | null;
    note: NoteRow;
    qrDataUrl: string;
}): string {
    const { parcel, order, business, note, qrDataUrl } = opts;
    const tracking = parcel.tracking_code || parcel.reference || '—';
    const zoneName = order?.zone?.name || '';
    const hubLetter = zoneHubLetter(zoneName);
    const zCode = zoneCode(zoneName);
    const fragile = !!parcel.is_fragile;
    const openFlag = parcel.is_open ? 'Oui' : 'Non';
    const tryFlag = parcel.is_try_on ? 'Oui' : 'Non';

    const senderName = business?.name || '—';
    const senderPhone = business?.business_phone || '';
    const senderDate = formatDate(note.created_at);
    const senderLogo = business?.logo || '';

    const receiverName = order?.name || '—';
    const receiverPhone = order?.phone || '';
    const receiverCity = order?.city?.name || '';
    const receiverAddress = order?.address || '';
    const cod = Number(order?.price || 0).toFixed(2);
    // Only the public order comment (delivery_note). Never the internal note.
    const comment = order?.delivery_note || '';

    // Product breakdown: "SKU x qty, SKU x qty"
    const items = (order?.items || []).filter((i) => (i?.quantity ?? 0) > 0);
    const productSummary = items.length
        ? items
              .map((i) => `${i.product?.code || i.product?.name || 'P'} ×${i.quantity ?? 0}`)
              .join(' · ')
        : '—';

    return `
<div class="sticker">
  <header class="sticker__top">
    <div class="sticker__brand">
      ${senderLogo ? `<img src="${escapeHtml(senderLogo)}" alt="" class="sticker__logo" />` : `<div class="sticker__logotext">${escapeHtml((senderName || '?').slice(0, 2).toUpperCase())}</div>`}
      <div class="sticker__brand-name" title="${escapeHtml(senderName)}">${escapeHtml(senderName)}</div>
    </div>
    <div class="sticker__ref">${escapeHtml(tracking)}</div>
  </header>

  <section class="sticker__flags">
    <div class="flag-box">
      <div class="flag-label">OUVRIR LE COLIS</div>
      <div class="flag-value">${escapeHtml(openFlag)}</div>
    </div>
    <div class="flag-box">
      <div class="flag-label">ESSAYAGE</div>
      <div class="flag-value">${escapeHtml(tryFlag)}</div>
    </div>
    <div class="flag-zone">
      <div class="zone-letter">${escapeHtml(hubLetter)}-1</div>
      <div class="zone-divider"></div>
      <div class="zone-code">${escapeHtml(zCode)}</div>
      ${fragile ? `<div class="zone-fragile">قابل للكسر - FRAGILE</div>` : ''}
    </div>
  </section>

  <section class="sticker__parties">
    <div class="party party--sender">
      <div class="party__title">Expéditeur</div>
      <div class="party__name">${escapeHtml(senderName)}</div>
      ${senderPhone ? `<div class="party__line">${escapeHtml(senderPhone)}</div>` : ''}
      <div class="party__line muted">${escapeHtml(senderDate)}</div>
      ${qrDataUrl ? `<div class="party__qr">
        <img src="${qrDataUrl}" alt="QR" />
        <div class="party__qr-label">Scan to assign</div>
      </div>` : ''}
    </div>
    <div class="party party--receiver">
      <div class="party__title">Destinataire</div>
      <div class="party__row"><span class="lbl">Nom:</span><span class="val">${escapeHtml(receiverName)}</span></div>
      <div class="party__row"><span class="lbl">Téléphone:</span><span class="val">${escapeHtml(receiverPhone)}</span></div>
      <div class="party__row"><span class="lbl">Ville:</span><span class="val strong">${escapeHtml(receiverCity)}</span></div>
      <div class="party__row"><span class="lbl">Adresse:</span><span class="val">${escapeHtml(receiverAddress)}</span></div>
      <div class="party__row"><span class="lbl">Produits:</span><span class="val">${escapeHtml(productSummary)}</span></div>
      <div class="party__row crbt"><span class="lbl">CRBT:</span><span class="val big">${escapeHtml(cod)} DH</span></div>
      <div class="party__row"><span class="lbl">Commentaire:</span><span class="val">${escapeHtml(comment)}</span></div>
    </div>
  </section>

  <footer class="sticker__foot">
    Cette commande est créée et gérée par <strong>DigiCom</strong> — la principale plateforme de gestion au Maroc.
  </footer>
</div>
    `;
}

// ── Delivery note page (A4) ────────────────────────────────────────────────
function renderDeliveryNote(opts: {
    parcels: CourierParcelRow[];
    orders: OrderRow[];
    note: NoteRow;
    business: BusinessRow | null;
    courier: CourierRow | null;
    qrMap: Map<string, string>;
}): string {
    const { parcels, orders, note, business, courier, qrMap } = opts;
    const orderMap = new Map<string, OrderRow>(orders.map((o) => [o.id, o]));
    const totalCod = parcels.reduce(
        (sum, p) => sum + Number((p.order_id && orderMap.get(p.order_id)?.price) || 0),
        0,
    );
    const senderLogo = business?.logo || '';
    const senderName = business?.name || '—';

    const rows = parcels
        .map((p, idx) => {
            const o = p.order_id ? orderMap.get(p.order_id) : null;
            const qrUrl = qrMap.get(p.id) || '';
            return `
              <tr>
                <td class="c">${idx + 1}</td>
                <td>${qrUrl ? `<img class="row-qr" src="${qrUrl}" alt="" />` : ''}</td>
                <td><strong>${escapeHtml(p.tracking_code || p.reference || '')}</strong></td>
                <td>${escapeHtml(o?.name || '—')}</td>
                <td>${escapeHtml(o?.phone || '')}</td>
                <td>${escapeHtml(o?.city?.name || '')}</td>
                <td class="r">${Number(o?.price || 0).toFixed(2)} DH</td>
              </tr>
            `;
        })
        .join('');

    return `
<div class="note">
  <header class="note__head">
    <div class="note__brand">
      ${senderLogo ? `<img src="${escapeHtml(senderLogo)}" class="note__logo" alt="" />` : ''}
      <div>
        <div class="note__title">${escapeHtml(senderName)}</div>
        <div class="note__sub">Bon de Livraison Coursier</div>
      </div>
    </div>
    <div class="note__meta">
      <div><span>Référence</span><strong>${escapeHtml(note.reference || '')}</strong></div>
      <div><span>Date</span><strong>${escapeHtml(formatDate(note.created_at))}</strong></div>
      <div><span>Coursier</span><strong>${escapeHtml(courier?.name || '—')}</strong></div>
      <div><span>Total colis</span><strong>${parcels.length}</strong></div>
    </div>
  </header>

  <table class="note__table">
    <thead>
      <tr>
        <th class="c w-8">#</th>
        <th class="c w-qr">QR</th>
        <th>Tracking</th>
        <th>Destinataire</th>
        <th>Téléphone</th>
        <th>Ville</th>
        <th class="r">CRBT</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="6" class="r"><strong>Total à encaisser</strong></td>
        <td class="r"><strong>${totalCod.toFixed(2)} DH</strong></td>
      </tr>
    </tfoot>
  </table>

  <section class="note__sign">
    <div>
      <div class="sign-label">Signature coursier</div>
      <div class="sign-box"></div>
      <div class="sign-name">${escapeHtml(courier?.name || '')}</div>
    </div>
    <div>
      <div class="sign-label">Signature ${escapeHtml(senderName)}</div>
      <div class="sign-box"></div>
    </div>
  </section>

  <footer class="note__foot">
    ${escapeHtml(senderName)} — document généré en interne · ${escapeHtml(formatDate(new Date().toISOString()))}
  </footer>
</div>
    `;
}

// ── Global CSS ──────────────────────────────────────────────────────────────
function baseStyles(format: CourierPrintFormat): string {
    if (format === 'sticker') {
        return `
@page { size: 100mm 100mm; margin: 0; }
* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  color-adjust: exact !important;
}
html, body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; color: #111827; }
.sheet { display: flex; flex-direction: column; gap: 12px; padding: 12px; }
.sticker {
  width: 100mm; height: 100mm; background: #ffffff; border: 2px solid ${BRAND_BORDER};
  display: flex; flex-direction: column; overflow: hidden; page-break-after: always;
}
.sticker__top {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px; border-bottom: 2px solid ${BRAND_BORDER};
  min-height: 38px;
}
.sticker__brand { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.sticker__logo { height: 28px; width: auto; max-width: 70px; object-fit: contain; flex-shrink: 0; }
.sticker__logotext {
  width: 30px; height: 30px; border-radius: 8px; background: ${BRAND_NAVY};
  color: #fff; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 12px;
  flex-shrink: 0;
}
.sticker__brand-name {
  font-size: 14px; font-weight: 900; letter-spacing: -0.01em; color: ${BRAND_NAVY};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0; flex: 1;
  line-height: 1.1;
}
.sticker__ref {
  font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 9px;
  padding: 4px 8px; border: 1.5px solid ${BRAND_BORDER}; border-radius: 4px;
  font-weight: 800; color: ${BRAND_NAVY}; flex-shrink: 0; white-space: nowrap;
}
.sticker__flags {
  display: grid; grid-template-columns: 1fr 1fr 110px; gap: 8px;
  padding: 8px 10px; background: #eef2f7; border-bottom: 2px solid ${BRAND_BORDER};
  align-items: center;
}
.flag-box { text-align: center; }
.flag-label { font-size: 7px; font-weight: 800; letter-spacing: 0.08em; color: ${BRAND_NAVY}; }
.flag-value {
  margin-top: 3px; border: 1.5px solid ${BRAND_BORDER}; border-radius: 999px;
  padding: 4px 0; font-weight: 900; font-size: 13px; color: ${BRAND_NAVY};
  background: #ffffff;
}
.flag-zone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.zone-row { display: flex; gap: 4px; align-items: center; }
.zone-letter, .zone-code {
  border: 1.5px solid ${BRAND_BORDER}; border-radius: 6px; padding: 3px 10px;
  font-weight: 900; font-size: 14px; color: ${BRAND_NAVY}; background: #ffffff;
}
.zone-fragile {
  background: ${BRAND_DANGER} !important; color: #fff !important; font-size: 8px; font-weight: 900;
  padding: 3px 8px; border-radius: 4px; white-space: nowrap;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
.sticker__parties {
  display: grid; grid-template-columns: 0.85fr 1.65fr; flex: 1; min-height: 0;
  border-bottom: 2px solid ${BRAND_BORDER};
}
.party { padding: 8px 10px; position: relative; min-width: 0; }
.party--sender { border-right: 2px dashed ${BRAND_BORDER}; }
.party__title {
  text-align: center; font-weight: 900; font-size: 11px; color: ${BRAND_NAVY};
  letter-spacing: -0.01em; padding-bottom: 3px;
  border-bottom: 2px solid ${BRAND_NAVY}; margin-bottom: 6px;
}
.party__name {
  font-weight: 900; font-size: 11px; color: ${BRAND_NAVY};
  word-break: break-word; line-height: 1.2;
}
.party__line { font-size: 9px; color: #374151; line-height: 1.3; word-break: break-word; }
.party__line.muted { color: #6b7280; }
.party__qr {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.party__qr img {
  width: 24mm;
  height: 24mm;
  display: block;
  image-rendering: pixelated;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
  background: #ffffff;
  padding: 1mm;
  border: 1px solid ${BRAND_BORDER_LIGHT};
  border-radius: 2px;
}
.party__qr-label {
  font-size: 6px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: ${BRAND_NAVY};
  text-transform: uppercase;
}
.party__row {
  display: flex; gap: 6px; font-size: 9px; line-height: 1.3; color: #111827;
  align-items: baseline; padding: 1px 0;
}
.party__row .lbl {
  font-weight: 900; color: ${BRAND_NAVY};
  min-width: 62px; flex-shrink: 0;
}
.party__row .val {
  font-weight: 600; min-width: 0; word-break: break-word;
}
.party__row .val.strong { font-weight: 900; font-size: 11px; }
.party__row.crbt { margin-top: 2px; }
.party__row .val.big { font-weight: 900; font-size: 14px; color: ${BRAND_NAVY}; }
.sticker__foot {
  padding: 5px 10px 6px; font-size: 7px; color: #4b5563; background: #ffffff;
  text-align: center; line-height: 1.4;
}
.sticker__foot strong { color: ${BRAND_NAVY}; font-weight: 900; }
@media print {
  html, body { background: #ffffff; }
  .sheet { padding: 0; gap: 0; }
  .sticker { box-shadow: none; }
}
        `;
    }

    // Delivery note
    return `
/* Margin 0 here so the browser does NOT inject its built-in header/footer
   (date · URL · page number) into the page-margin area. The visual margin
   is rebuilt via .sheet padding so the layout still breathes. */
@page { size: A4; margin: 0; }
* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  color-adjust: exact !important;
}
html, body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; color: #111827; }
.sheet { padding: 18mm 14mm; max-width: 210mm; margin: 0 auto; background: #ffffff; }
.note { display: flex; flex-direction: column; gap: 18px; }
.note__head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${BRAND_NAVY}; padding-bottom: 14px; }
.note__brand { display: flex; gap: 12px; align-items: center; }
.note__logo { height: 52px; width: auto; max-width: 140px; object-fit: contain; }
.note__title { font-size: 22px; font-weight: 900; color: ${BRAND_NAVY}; letter-spacing: -0.02em; }
.note__sub { font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.1em; }
.note__meta { display: grid; grid-template-columns: auto auto; gap: 4px 18px; font-size: 11px; text-align: right; }
.note__meta span { display: block; font-size: 8px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; }
.note__meta strong { color: ${BRAND_NAVY}; font-weight: 900; font-size: 12px; }

.note__table { width: 100%; border-collapse: collapse; font-size: 11px; }
.note__table th, .note__table td { padding: 8px 10px; border-bottom: 1px solid ${BRAND_BORDER_LIGHT}; }
.note__table thead th { background: ${BRAND_NAVY}; color: #ffffff; font-weight: 900; text-align: left; text-transform: uppercase; font-size: 9px; letter-spacing: 0.08em; border-bottom: none; }
.note__table tbody tr:nth-child(odd) { background: #f9fafb; }
.note__table tfoot td { background: #eef2f7; font-weight: 900; color: ${BRAND_NAVY}; font-size: 12px; }
.note__table .c { text-align: center; }
.note__table .r { text-align: right; }
.note__table .w-8 { width: 28px; }
.note__table .w-qr { width: 52px; }
.note__table .row-qr {
  width: 46px; height: 46px; display: block; margin: 0 auto;
  image-rendering: pixelated;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
  background: #ffffff;
  padding: 2px;
  border: 1px solid ${BRAND_BORDER_LIGHT};
  border-radius: 2px;
}

.note__sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; font-size: 11px; }
.sign-label { font-size: 9px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.sign-box { height: 72px; border: 1.5px solid ${BRAND_BORDER_LIGHT}; border-radius: 10px; background: #f9fafb; }
.sign-name { margin-top: 4px; font-weight: 700; color: #374151; }

.note__foot { margin-top: 16px; text-align: center; font-size: 9px; color: #9ca3af; }

@media print {
  html, body { background: #ffffff; }
  /* Keep the inner padding so the table doesn't touch the page edge. */
  .sheet { padding: 18mm 14mm; }
}
    `;
}

function loadingHtml(title: string): string {
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f5f5f5; color: #6b7280; }
  .wrap { display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 12px; }
  .spinner { width: 36px; height: 36px; border: 3px solid #d1d5db; border-top-color: ${BRAND_NAVY}; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .label { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
</style>
</head>
<body>
  <div class="wrap"><div class="spinner"></div><div class="label">Préparation de l'étiquette…</div></div>
</body>
</html>`;
}

// ── Public entrypoint ───────────────────────────────────────────────────────
// IMPORTANT: window.open must run synchronously inside the user gesture, BEFORE
// any await, otherwise the browser blocks the subsequent document write and
// the tab stays blank. We open a placeholder, then await + replace its body.
export async function printCourierDeliveryNote(noteId: string, format: CourierPrintFormat) {
    console.log('[courier-label] printCourierDeliveryNote: invoked', { noteId, format });

    // NOTE: do NOT pass `noopener` / `noreferrer` here — they sever the
    // reference and force window.open to return null, even with a valid user
    // gesture. We need the reference to write the document body.
    const win = window.open('', '_blank', 'width=900,height=1100');
    console.log('[courier-label] window.open result', { ok: !!win, closed: win?.closed });
    if (!win) {
        throw new Error('Pop-up blocked. Please allow pop-ups for this site to print labels.');
    }

    try {
        win.document.open();
        win.document.write(loadingHtml(format === 'sticker' ? 'Étiquette coursier' : 'Bon de livraison coursier'));
        win.document.close();
        console.log('[courier-label] loading placeholder written');
    } catch (e) {
        console.error('[courier-label] failed to write loading placeholder', e);
    }

    try {
        const { note, parcels, orders, business, courier } = await loadNoteBundle(noteId);

        if (parcels.length === 0) {
            console.warn('[courier-label] no parcels in this note, aborting');
            try { win.close(); } catch { /* ignore */ }
            throw new Error('No parcels in this delivery note to print.');
        }

        const orderMap = new Map(orders.map((o) => [o.id, o]));

        // Pre-generate a QR data URL for each parcel (ECC level H, local).
        // Payload = tracking code only (shortest possible → largest modules → best
        // scannability on low quality prints). No sensitive data is encoded.
        const qrEntries = await Promise.all(
            parcels.map(async (p) => {
                const code = p.tracking_code || p.reference || '';
                const dataUrl = code ? await buildQrDataUrl(code, format === 'sticker' ? 320 : 160) : '';
                return [p.id, dataUrl] as const;
            }),
        );
        const qrMap = new Map<string, string>(qrEntries);

        let body = '';
        if (format === 'sticker') {
            body = parcels
                .map((p) => renderSticker({
                    parcel: p,
                    order: p.order_id ? orderMap.get(p.order_id) || null : null,
                    business,
                    note,
                    qrDataUrl: qrMap.get(p.id) || '',
                }))
                .join('\n');
        } else {
            body = renderDeliveryNote({ parcels, orders, note, business, courier, qrMap });
        }
        console.log('[courier-label] body rendered', { format, bytes: body.length });

        const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(note.reference || 'Delivery note')}</title>
<style>${baseStyles(format)}</style>
</head>
<body>
<div class="sheet">${body}</div>
<script>
  console.log('[courier-label][popup] document loaded, images:', document.images.length);
  (function () {
    var imgs = Array.from(document.images || []);
    if (imgs.length === 0) { console.log('[courier-label][popup] no images, printing now'); window.print(); return; }
    var pending = imgs.length;
    var done = function () {
      if (--pending <= 0) {
        console.log('[courier-label][popup] all images loaded, printing in 250ms');
        setTimeout(function () { window.print(); }, 250);
      }
    };
    imgs.forEach(function (img) {
      if (img.complete) { done(); return; }
      img.addEventListener('load', done);
      img.addEventListener('error', function (e) { console.warn('[courier-label][popup] image error', img.src, e); done(); });
    });
  })();
</script>
</body>
</html>`;

        console.log('[courier-label] html assembled', { bytes: html.length, popupClosed: win.closed });
        if (win.closed) {
            console.warn('[courier-label] popup was closed before write, aborting');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        console.log('[courier-label] document.write completed');
    } catch (err) {
        console.error('[courier-label] printCourierDeliveryNote failed', err);
        try { win.close(); } catch { /* ignore */ }
        throw err;
    }
}
