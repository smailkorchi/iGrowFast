// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ai-tool-runner v3 — Phase-2 read-only skills + Phase-4 prepared  ║
// ║  write actions (deferred until owner approves in Review Queue).   ║
// ║                                                                    ║
// ║  Phase-4 write skill (create_order) does NOT touch live tables    ║
// ║  during the brain conversation. It validates inputs and inserts   ║
// ║  a row into ai_pending_actions with status='pending'. The brain   ║
// ║  composes a confirmation reply for the customer; sandbox queue    ║
// ║  catches it; owner approves → ai-review-act calls                  ║
// ║  ai_apply_pending_actions_for_decision which executes the action. ║
// ╚══════════════════════════════════════════════════════════════════╝
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const ENABLED_SKILLS = new Set([
  "answer_faq", "search_products", "lookup_order_by_phone", "explain_order_status",
  "check_delivery_zone", "validate_morocco_address", "quote_shipping_cost",
  "create_order", "confirm_cod_order", "recover_abandoned_cart", "send_payment_reminder",
  // Phase 4.5
  "apply_discount", "handle_exchange",
  // Phase 6 (owner-only analytics)
  "summarize_today_sales", "analyze_ads_roi",
  // Phase 9 (context + media)
  "get_business_info", "get_product_details", "send_product_media",
  // Phase 11 (pricing)
  "apply_pricing_rule",
  // Phase 16 (documents + carrier)
  "generate_devis", "generate_facture", "create_delivery_note",
  // Phase 17 (engagement + sales boosters)
  "recommend_product", "send_catalog_picker", "react_with_emoji",
  // Phase 18 (institutional memory)
  "record_business_learning",
  // Phase 19 (vision)
  "analyze_image",
  // Phase 20 (order CRUD)
  "edit_order", "cancel_order", "change_delivery_info",
  // Phase 21 (sales boosters)
  "upsell_cross_sell", "bundle_offer",
  // Phase 22 (quality + engagement)
  "identify_repeat_customer", "summarize_thread_for_human",
  "detect_spam_or_scam", "request_review_after_delivery",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json(405, { ok: false, error: "method not allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`;
  if (auth !== expected) return json(401, { ok: false, error: "service_role required" });

  const start = Date.now();
  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad json" }); }
  const { business_id, thread_id, skill_slug, args, tool_use_id, customer_phone } = body || {};
  if (!business_id || !skill_slug) return json(200, { ok: false, error: "business_id + skill_slug required" });
  if (!ENABLED_SKILLS.has(skill_slug)) return json(200, { ok: false, error: `skill not wired: ${skill_slug}`, latency_ms: Date.now() - start });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Load per-business config for this skill. Merge schema defaults with the
  // owner-saved overrides so handlers always receive a complete object.
  // If the skill row doesn't exist yet (owner hasn't configured), defaults
  // from the catalog schema kick in.
  const { data: skillRow } = await supabase
    .from("ai_skills")
    .select("id, config_schema")
    .eq("slug", skill_slug)
    .maybeSingle();
  let cfg: Record<string, any> = {};
  if (skillRow?.id) {
    const { data: bizRow } = await supabase
      .from("ai_business_skills")
      .select("config")
      .eq("business_id", business_id)
      .eq("skill_id", skillRow.id)
      .maybeSingle();
    const fields = (skillRow.config_schema as any)?.fields || [];
    cfg = mergeConfigDefaults(fields, bizRow?.config || {});
  }

  let out: any;
  try {
    switch (skill_slug) {
      case "answer_faq":               out = await runAnswerFaq(supabase, business_id, args || {}, thread_id); break;
      case "search_products":          out = await runSearchProducts(supabase, business_id, args || {}); break;
      case "lookup_order_by_phone":    out = await runLookupOrderByPhone(supabase, business_id, args || {}, customer_phone); break;
      case "explain_order_status":     out = await runExplainOrderStatus(supabase, business_id, args || {}, customer_phone); break;
      case "check_delivery_zone":      out = await runCheckDeliveryZone(supabase, business_id, args || {}); break;
      case "validate_morocco_address": out = await runValidateMoroccoAddress(supabase, args || {}); break;
      case "quote_shipping_cost":      out = await runQuoteShippingCost(supabase, business_id, args || {}); break;
      case "create_order":             out = await runCreateOrder(supabase, business_id, thread_id, tool_use_id, args || {}, cfg); break;
      case "confirm_cod_order":        out = await runConfirmCodOrder(supabase, business_id, args || {}); break;
      case "recover_abandoned_cart":   out = await runRecoverAbandonedCart(supabase, business_id, thread_id, customer_phone); break;
      case "send_payment_reminder":    out = await runSendPaymentReminder(supabase, business_id, args || {}, cfg); break;
      case "apply_discount":           out = await runApplyDiscount(supabase, business_id, thread_id, tool_use_id, args || {}, cfg); break;
      case "handle_exchange":          out = await runHandleExchange(supabase, business_id, thread_id, tool_use_id, args || {}, cfg); break;
      case "summarize_today_sales":    out = await runSummarizeSales(supabase, business_id, args || {}); break;
      case "analyze_ads_roi":          out = await runAnalyzeAdsRoi(supabase, business_id, args || {}); break;
      case "get_business_info":        out = await runGetBusinessInfo(supabase, business_id); break;
      case "get_product_details":      out = await runGetProductDetails(supabase, business_id, args || {}); break;
      case "send_product_media":       out = await runSendProductMedia(supabase, business_id, thread_id, tool_use_id, args || {}, cfg); break;
      case "apply_pricing_rule":       out = await runApplyPricingRule(supabase, business_id, args || {}); break;
      case "generate_devis":           out = await runGenerateDevis(supabase, business_id, thread_id, tool_use_id, args || {}, customer_phone, cfg); break;
      case "generate_facture":         out = await runGenerateFacture(supabase, business_id, thread_id, tool_use_id, args || {}, customer_phone, cfg); break;
      case "create_delivery_note":     out = await runCreateDeliveryNote(supabase, business_id, thread_id, tool_use_id, args || {}, customer_phone, cfg); break;
      case "recommend_product":        out = await runRecommendProduct(supabase, business_id, args || {}, cfg); break;
      case "send_catalog_picker":      out = await runSendCatalogPicker(supabase, business_id, thread_id, tool_use_id, args || {}, cfg); break;
      case "react_with_emoji":         out = await runReactWithEmoji(supabase, business_id, thread_id, args || {}, cfg); break;
      case "record_business_learning": out = await runRecordBusinessLearning(supabase, business_id, thread_id, tool_use_id, args || {}, cfg); break;
      case "analyze_image":            out = await runAnalyzeImage(supabase, business_id, thread_id, args || {}); break;
      case "edit_order":               out = await runEditOrder(supabase, business_id, thread_id, tool_use_id, args || {}, customer_phone, cfg); break;
      case "cancel_order":             out = await runCancelOrder(supabase, business_id, thread_id, tool_use_id, args || {}, customer_phone, cfg); break;
      case "change_delivery_info":     out = await runChangeDeliveryInfo(supabase, business_id, thread_id, tool_use_id, args || {}, customer_phone, cfg); break;
      case "upsell_cross_sell":        out = await runUpsellCrossSell(supabase, business_id, args || {}, cfg); break;
      case "bundle_offer":             out = await runBundleOffer(supabase, business_id, thread_id, tool_use_id, args || {}, cfg); break;
      case "identify_repeat_customer": out = await runIdentifyRepeatCustomer(supabase, business_id, args || {}, customer_phone, cfg); break;
      case "summarize_thread_for_human": out = await runSummarizeThreadForHuman(supabase, business_id, thread_id, args || {}); break;
      case "detect_spam_or_scam":      out = await runDetectSpamOrScam(supabase, business_id, thread_id, args || {}, cfg); break;
      case "request_review_after_delivery": out = await runRequestReviewAfterDelivery(supabase, business_id, thread_id, tool_use_id, args || {}, customer_phone, cfg); break;
      default: out = { ok: false, error: `unknown skill: ${skill_slug}` };
    }
  } catch (e: any) {
    out = { ok: false, error: `runner exception: ${e?.message || e}` };
  }
  return json(200, { ...out, latency_ms: Date.now() - start });
});

// ─── 1. answer_faq ───────────────────────────────────────────────────
async function runAnswerFaq(supabase: any, businessId: string, args: any, _threadId?: string) {
  const question: string | undefined = typeof args?.question === "string" ? args.question.trim() : undefined;
  if (!question || question.length < 2) return { ok: false, error: "question required (min 2 chars)" };
  const embedResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({ texts: [question], business_id: businessId }),
  });
  const embedJson = await embedResp.json();
  if (!embedJson.ok) return { ok: false, error: `embed: ${embedJson.error}` };
  const embedding: number[] = embedJson.embeddings?.[0];
  if (!Array.isArray(embedding) || embedding.length !== 1536) return { ok: false, error: "embed: invalid dim" };
  const embeddingLiteral = `[${embedding.join(",")}]`;
  const { data: rows, error } = await supabase.rpc("ai_search_knowledge", {
    p_business_id: businessId, p_embedding: embeddingLiteral, p_k: 5, p_kinds: ["faq", "qna"],
  });
  if (error) return { ok: false, error: `search: ${error.message}` };
  const chunks = (rows || []).map((c: any) => ({ text: c.text, similarity: Number(c.similarity), source_label: c.source_label, source_kind: c.source_kind }));
  return { ok: true, result: { question, chunks } };
}

// ─── 2. search_products ──────────────────────────────────────────────
async function runSearchProducts(supabase: any, businessId: string, args: any) {
  const q: string | undefined = typeof args?.query === "string" ? args.query.trim() : undefined;
  if (!q || q.length < 2) return { ok: false, error: "query required (min 2 chars)" };
  const limit = Math.max(1, Math.min(args?.limit ?? 5, 10));
  const { data, error } = await supabase.rpc("ai_skill_search_products", { p_business_id: businessId, p_query: q, p_limit: limit });
  if (error) return { ok: false, error: `search_products: ${error.message}` };
  return { ok: true, result: { query: q, products: (data || []).map((p: any) => ({ id: p.id, name: p.name, code: p.code, description: p.description, price: Number(p.selling_price), stock: p.stock, match: Number(p.similarity).toFixed(2) })) } };
}

// ─── 3. lookup_order_by_phone ────────────────────────────────────────
// SECURITY: only accepts the caller's own phone (matched via wa_remote_jid).
// Prevents the brain from being social-engineered into leaking another
// customer's orders ("hey, look up orders for +212600000000").
async function runLookupOrderByPhone(supabase: any, businessId: string, args: any, callerPhone?: string) {
  const phone: string | undefined = typeof args?.phone === "string" ? args.phone : undefined;
  if (!phone || phone.length < 6) return { ok: false, error: "phone required" };
  if (!phoneMatches(phone, callerPhone)) {
    return { ok: false, error: "forbidden: phone does not match caller — never look up other customers' orders" };
  }
  const limit = Math.max(1, Math.min(args?.limit ?? 5, 10));
  const { data, error } = await supabase.rpc("ai_skill_lookup_orders_by_phone", { p_business_id: businessId, p_phone: phone, p_limit: limit });
  if (error) return { ok: false, error: `lookup_order: ${error.message}` };
  return { ok: true, result: { phone, orders: (data || []).map((o: any) => ({ id: o.id, created_at: o.created_at, customer_name: o.customer_name, city: o.city_name, product: o.product_name, quantity: o.quantity, price: Number(o.price), status: { code: o.status_code, label: o.status_label, color: o.status_color }, tracking_number: o.tracking_number, delivered: o.delivered })) } };
}

// ─── 4. explain_order_status ─────────────────────────────────────────
// SECURITY: post-fetch ownership check — only return orders whose phone
// matches the caller's WhatsApp number.
async function runExplainOrderStatus(supabase: any, businessId: string, args: any, callerPhone?: string) {
  const id: string | undefined = typeof args?.order_id === "string" ? args.order_id : (typeof args?.tracking_number === "string" ? args.tracking_number : undefined);
  if (!id) return { ok: false, error: "order_id or tracking_number required" };
  const { data, error } = await supabase.rpc("ai_skill_get_order_status", { p_business_id: businessId, p_identifier: id });
  if (error) return { ok: false, error: `get_order: ${error.message}` };
  if (!data || data.length === 0) return { ok: true, result: { order: null, message: "order not found" } };
  const o = data[0];
  if (!phoneMatches(o.customer_phone, callerPhone)) {
    return { ok: false, error: "forbidden: order belongs to a different customer" };
  }
  return { ok: true, result: { order: { id: o.id, created_at: o.created_at, customer_name: o.customer_name, customer_phone: o.customer_phone, city: o.city_name, status: { code: o.status_code, label: o.status_label, color: o.status_color, category: o.status_category }, tracking_number: o.tracking_number, delivered: o.delivered, date_livraison: o.date_livraison, price: Number(o.price) } } };
}

// Normalize + compare two phone numbers. Strips +212/0 prefixes, non-digits.
function phoneMatches(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => {
    let d = s.replace(/\D/g, "");
    if (d.startsWith("212")) d = d.slice(3);
    if (d.startsWith("0")) d = d.slice(1);
    return d;
  };
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  // Allow last-9-digit suffix match (handles country code variations).
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

// ─── 5. check_delivery_zone ──────────────────────────────────────────
async function runCheckDeliveryZone(supabase: any, businessId: string, args: any) {
  const q: string | undefined = typeof args?.city === "string" ? args.city.trim() : undefined;
  if (!q || q.length < 2) return { ok: false, error: "city required" };
  const { data: matches, error: e1 } = await supabase.rpc("ai_skill_match_morocco_city", { p_query: q, p_limit: 3 });
  if (e1) return { ok: false, error: `city match: ${e1.message}` };
  if (!matches || matches.length === 0) return { ok: true, result: { matched: false, query: q } };
  const top = matches[0];
  const { data: quotes, error: e2 } = await supabase.rpc("ai_skill_quote_shipping", { p_business_id: businessId, p_master_city_id: top.id });
  if (e2) return { ok: false, error: `quote: ${e2.message}` };
  const offers = (quotes || []).map((r: any) => ({ provider_kind: r.provider_kind, provider_name: r.provider_name, fee: Number(r.fee) })).sort((a: any, b: any) => a.fee - b.fee);
  return { ok: true, result: { matched: true, query: q, city: { id: top.id, name: top.name, name_ar: top.name_ar, region: top.region, match: Number(top.similarity).toFixed(2) }, offers, cheapest: offers[0] || null, served: offers.length > 0, alternatives: matches.slice(1).map((m: any) => ({ id: m.id, name: m.name })) } };
}

// ─── 6. validate_morocco_address ─────────────────────────────────────
async function runValidateMoroccoAddress(supabase: any, args: any) {
  const q: string | undefined = typeof args?.address === "string" ? args.address.trim() : undefined;
  if (!q || q.length < 2) return { ok: false, error: "address required" };
  const { data, error } = await supabase.rpc("ai_skill_match_morocco_city", { p_query: q, p_limit: 5 });
  if (error) return { ok: false, error: `match_city: ${error.message}` };
  const matches = (data || []).map((m: any) => ({ id: m.id, name: m.name, name_ar: m.name_ar, region: m.region, match: Number(m.similarity).toFixed(2) }));
  return { ok: true, result: { address: q, city_matches: matches, best_match: matches[0] || null, confidence: matches[0] ? Number(matches[0].match) : 0 } };
}

// ─── 7. quote_shipping_cost ──────────────────────────────────────────
async function runQuoteShippingCost(supabase: any, businessId: string, args: any) {
  const cityName: string | undefined = typeof args?.city === "string" ? args.city.trim() : undefined;
  let masterCityId: string | undefined = typeof args?.master_city_id === "string" ? args.master_city_id : undefined;
  if (!cityName && !masterCityId) return { ok: false, error: "city or master_city_id required" };
  if (!masterCityId && cityName) {
    const { data, error } = await supabase.rpc("ai_skill_match_morocco_city", { p_query: cityName, p_limit: 1 });
    if (error) return { ok: false, error: `match_city: ${error.message}` };
    if (!data || data.length === 0) return { ok: true, result: { matched: false, query: cityName } };
    masterCityId = data[0].id;
  }
  const { data: quotes, error } = await supabase.rpc("ai_skill_quote_shipping", { p_business_id: businessId, p_master_city_id: masterCityId });
  if (error) return { ok: false, error: `quote: ${error.message}` };
  const offers = (quotes || []).map((r: any) => ({ provider_kind: r.provider_kind, provider_name: r.provider_name, fee: Number(r.fee), return_fee: r.return_fee != null ? Number(r.return_fee) : null })).sort((a: any, b: any) => a.fee - b.fee);
  return { ok: true, result: { master_city_id: masterCityId, offers, cheapest: offers[0] || null } };
}

// ─── 8. create_order (Phase 4 — DEFERRED EXECUTION) ─────────────────
// Multi-item: brain may pass either { product_id, quantity } (single line)
// OR { items: [{product_id, quantity}, ...] } (multi-line). Both shapes are
// validated against tenant + active flag, then collapsed into one items[]
// array on the payload — the SQL apply RPC already iterates payload->'items'.
async function runCreateOrder(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required (ai-router did not pass it)" };

  const name    = typeof args?.name === "string" ? args.name.trim() : "";
  const phone   = typeof args?.phone === "string" ? args.phone.trim() : "";
  const cityArg = typeof args?.city === "string" ? args.city.trim() : "";
  const address = typeof args?.address === "string" ? args.address.trim() : "";

  // Accept either single-line or items[] shape.
  type RawItem = { product_id: string; quantity: number };
  let rawItems: RawItem[] = [];
  if (Array.isArray(args?.items) && args.items.length > 0) {
    rawItems = args.items
      .filter((it: any) => it && typeof it.product_id === "string")
      .map((it: any) => ({
        product_id: String(it.product_id).trim(),
        quantity:   Number.isFinite(it.quantity) ? Math.floor(it.quantity) : 1,
      }));
  } else if (typeof args?.product_id === "string") {
    rawItems = [{
      product_id: args.product_id.trim(),
      quantity:   Number.isFinite(args?.quantity) ? Math.floor(args.quantity) : 1,
    }];
  }

  if (name.length < 2)             return { ok: false, error: "name required (min 2 chars)" };
  if (phone.replace(/\D/g, "").length < 6) return { ok: false, error: "phone required" };
  if (cityArg.length < 2)          return { ok: false, error: "city required" };
  if (address.length < 3)          return { ok: false, error: "address required" };
  if (rawItems.length === 0)       return { ok: false, error: "items[] or product_id+quantity required" };
  if (rawItems.length > 10)        return { ok: false, error: "max 10 items per order" };
  for (const it of rawItems) {
    if (!it.product_id)            return { ok: false, error: "each item needs product_id" };
    if (it.quantity < 1 || it.quantity > 50) return { ok: false, error: `quantity 1..50 for product ${it.product_id}` };
  }

  // Fetch + tenant-check every product in one round-trip.
  const productIds = Array.from(new Set(rawItems.map((it) => it.product_id)));
  const { data: prods } = await supabase.from("products")
    .select('id, name, selling_price, stock, active, "DigiCom Business"')
    .in("id", productIds);
  if (!prods || prods.length !== productIds.length) return { ok: false, error: "one or more products not found" };
  const byId = new Map<string, any>((prods as any[]).map((p) => [p.id, p]));
  for (const id of productIds) {
    const p = byId.get(id);
    if (!p) return { ok: false, error: `product ${id} not found` };
    if (p["DigiCom Business"] !== businessId) return { ok: false, error: `product ${id} belongs to another business` };
    if (p.active === false) return { ok: false, error: `product ${p.name} is inactive` };
  }

  const { data: cityMatches } = await supabase.rpc("ai_skill_match_morocco_city", { p_query: cityArg, p_limit: 1 });
  if (!cityMatches || cityMatches.length === 0) return { ok: false, error: `city not recognized: ${cityArg}` };
  const city = cityMatches[0];

  const { data: quotes } = await supabase.rpc("ai_skill_quote_shipping", { p_business_id: businessId, p_master_city_id: city.id });
  const offers = (quotes || []).map((r: any) => ({
    provider_kind: r.provider_kind,
    provider_id:   r.provider_id,
    provider_name: r.provider_name,
    fee: Number(r.fee),
  })).sort((a: any, b: any) => a.fee - b.fee);
  const shipping = offers[0]?.fee ?? 0;
  const cheapest = offers[0] || null;

  // Resolve every line via the pricing-rule engine so volume discounts/
  // fixed-price overrides are applied consistently with the manual flow.
  const items: any[] = [];
  let itemsTotal = 0;
  for (const it of rawItems) {
    const prod = byId.get(it.product_id)!;
    let unitPrice = Number(prod.selling_price);
    try {
      const { data: priced } = await supabase.rpc("ai_resolve_price", { p_business_id: businessId, p_product_id: it.product_id, p_quantity: it.quantity });
      if (priced && Number.isFinite(Number(priced.unit_price))) unitPrice = Number(priced.unit_price);
    } catch { /* fall back to selling_price */ }
    const lineTotal = unitPrice * it.quantity;
    itemsTotal += lineTotal;
    items.push({ product_id: prod.id, product_name: prod.name, quantity: it.quantity, unit_price: unitPrice, line_total: lineTotal });
  }
  const total = itemsTotal + shipping;
  if (total > 100000) return { ok: false, error: "total exceeds sanity cap" };

  const payload = {
    business_id: businessId,
    customer: { name, phone, address },
    city: { id: city.id, name: city.name },
    items,
    items_total: itemsTotal,
    shipping_fee: shipping,
    shipping_provider: cheapest?.provider_name || null,
    shipping_provider_id:   cheapest?.provider_id || null,
    shipping_provider_kind: cheapest?.provider_kind || null,
    total,
  };

  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  let actionId: string;
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "action already applied" };
    await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: "create_order", kind: "create_order",
      payload, status: "pending", expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
    }).eq("id", existing.id);
    actionId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
      business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
      skill_slug: "create_order", kind: "create_order",
      payload, status: "pending",
    }).select("id").maybeSingle();
    if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
    actionId = ins!.id;
  }

  return {
    ok: true,
    result: {
      prepared: true,
      action_id: actionId,
      summary: {
        items: items.map((it) => ({ product_name: it.product_name, quantity: it.quantity, unit_price: it.unit_price, line_total: it.line_total })),
        items_total: itemsTotal, shipping_fee: shipping,
        shipping_provider: offers[0]?.provider_name || null,
        total, currency: "MAD", city: city.name, delivery_method: "COD",
      },
      next_step: "Confirm with customer (re-state every line, total, address, COD); await yes/no.",
    },
  };
}

// ─── 9. confirm_cod_order — read-only formatter ─────────────────────
async function runConfirmCodOrder(_supabase: any, _businessId: string, args: any) {
  const summary = args?.summary;
  if (!summary || typeof summary !== "object") return { ok: false, error: "summary object required" };
  return { ok: true, result: { restated: summary, instruction: "Re-state to customer; await 'oui/yes/wakha' to proceed." } };
}

// ─── 10. recover_abandoned_cart ─────────────────────────────────────
// Looks for the customer's most recent live order in TWO places:
//   1. orders table — orders that were already created (within 60 min) and
//      are still editable (not delivered, not shipped, not cancelled). These
//      are the ones the brain should call edit_order on if the customer wants
//      to bump quantities / change items / change address.
//   2. ai_pending_actions — sandboxed drafts (pending/expired/rejected) that
//      never made it to the orders table. The brain uses this to recover the
//      thread of conversation if the owner hadn't approved yet.
//
// Real orders take precedence — they are the canonical truth. The brain MUST
// use the returned order_id with edit_order for any modification. Without
// this lookup the brain blindly calls create_order again, producing duplicate
// orders for the same customer (the bug Ismail hit on 2026-04-27).
async function runRecoverAbandonedCart(supabase: any, businessId: string, threadId: string, customerPhone?: string) {
  if (!threadId) return { ok: false, error: "thread_id required" };

  // ── 1. Live order in orders table (within last 60 minutes, editable) ──
  const cutoffIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let liveOrder: any = null;
  if (customerPhone && customerPhone.length >= 6) {
    const digits = customerPhone.replace(/\D/g, "").replace(/^212/, "").replace(/^0/, "");
    if (digits.length >= 6) {
      // Look up most recent non-deleted, non-shipped, non-delivered order for
      // this phone. We avoid an exact match because orders.phone may have
      // formatting artefacts ("+212", spaces). LIKE on the digits-only suffix
      // is what ai_skill_lookup_orders_by_phone does.
      const { data: rows } = await supabase
        .from("orders")
        .select(`id, name, phone, price, processing, delivered, created_at,
                 master_city_id, address,
                 master_cities(name),
                 order_items(product_id, quantity, products(name, selling_price))`)
        .eq("DigiCom Business", businessId)
        .is("date_deleted", null)
        .eq("delivered", false)
        .eq("processing", false)
        .gte("created_at", cutoffIso)
        .ilike("phone", `%${digits}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      liveOrder = rows?.[0] || null;
    }
  }
  if (liveOrder) {
    return {
      ok: true,
      result: {
        found: true,
        source: "orders",
        order_id: liveOrder.id,
        recipient_name: liveOrder.name,
        phone: liveOrder.phone,
        city: liveOrder.master_cities?.name || null,
        address: liveOrder.address,
        total_dh: Number(liveOrder.price ?? 0),
        items: (liveOrder.order_items || []).map((it: any) => ({
          product_id: it.product_id,
          product_name: it.products?.name,
          quantity: it.quantity,
          unit_price: Number(it.products?.selling_price ?? 0),
        })),
        created_at: liveOrder.created_at,
        instruction: "This is an EXISTING editable order. To modify items/quantity/address use edit_order with order_id=" + liveOrder.id + ". DO NOT call create_order — that would duplicate.",
      },
    };
  }

  // ── 2. Fallback: pending sandbox draft ────────────────────────────────
  const { data } = await supabase.from("ai_pending_actions")
    .select("id, kind, payload, status, created_at")
    .eq("business_id", businessId).eq("thread_id", threadId)
    .in("status", ["pending","expired","rejected"])
    .order("created_at", { ascending: false }).limit(1);
  if (!data || data.length === 0) return { ok: true, result: { found: false } };
  const a = data[0];
  return { ok: true, result: { found: true, source: "draft", kind: a.kind, status: a.status, summary: a.payload, when: a.created_at } };
}

// ─── 12. apply_discount (Phase 4.5 — DEFERRED) ──────────────────────
async function runApplyDiscount(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, cfg: Record<string, any> = {}) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id : undefined;
  const pct = Number.isFinite(args?.discount_pct) ? Number(args.discount_pct) : NaN;
  const reason: string | undefined = typeof args?.reason === "string" ? args.reason.trim() : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };
  if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return { ok: false, error: "discount_pct must be 0..50" };
  if (!reason || reason.length < 4) return { ok: false, error: "reason required (min 4 chars)" };

  // Tenant + price lookup
  const { data: order } = await supabase.from("orders")
    .select('id, name, phone, price, "DigiCom Business"').eq("id", orderId).maybeSingle();
  if (!order || order["DigiCom Business"] !== businessId) return { ok: false, error: "order not found for this business" };

  const old_price = Number(order.price ?? 0);
  const new_price = Math.max(0, Math.round(old_price * (1 - pct/100) * 100) / 100);
  const savingsDh = old_price - new_price;

  // Owner policy enforcement: if the brain proposes a discount over any
  // configured cap, refuse with a clear error message — the brain can
  // either re-propose within bounds or escalate to a human.
  const maxPct        = Number(cfg.max_pct_without_approval) || 0;        // 0 = no cap
  const maxFlatDh     = Number(cfg.max_flat_amount_dh) || 0;              // 0 = no cap
  const alwaysAboveDh = Number(cfg.always_require_approval_above_dh) || 0; // 0 = no cap
  if (maxPct > 0 && pct > maxPct) {
    return { ok: false, error: `discount_pct ${pct}% exceeds business policy max ${maxPct}%. Reduce or escalate to human.` };
  }
  if (maxFlatDh > 0 && savingsDh > maxFlatDh) {
    return { ok: false, error: `discount of ${savingsDh.toFixed(2)} dh exceeds business policy max ${maxFlatDh} dh. Reduce or escalate.` };
  }
  if (alwaysAboveDh > 0 && savingsDh > alwaysAboveDh) {
    // Not a refusal — the discount is allowed but the policy guarantees a
    // strict sandbox handoff (which is already enforced by FORCE_SANDBOX).
    // Surface this in the payload so the Review Queue can mark it explicitly.
  }

  const payload = {
    business_id: businessId, order_id: orderId,
    discount_pct: pct, reason,
    old_price, new_price, savings: savingsDh,
    customer_name: order.name, customer_phone: order.phone,
    requires_owner: alwaysAboveDh > 0 && savingsDh > alwaysAboveDh,
  };

  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  let actionId: string;
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "action already applied" };
    await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: "apply_discount", kind: "apply_discount",
      payload, status: "pending", expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
    }).eq("id", existing.id);
    actionId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
      business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
      skill_slug: "apply_discount", kind: "apply_discount",
      payload, status: "pending",
    }).select("id").maybeSingle();
    if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
    actionId = ins!.id;
  }

  return { ok: true, result: { prepared: true, action_id: actionId, summary: { discount_pct: pct, old_price, new_price, savings: old_price - new_price, currency: "MAD", reason }, next_step: "Re-state new price to customer; await confirmation." } };
}

// ─── 13. handle_exchange (Phase 4.5 — DEFERRED) ─────────────────────
async function runHandleExchange(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id : undefined;
  const reason: string | undefined = typeof args?.reason === "string" ? args.reason.trim() : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };
  if (!reason || reason.length < 4) return { ok: false, error: "reason required (min 4 chars)" };

  const { data: order } = await supabase.from("orders")
    .select('id, name, phone, price, delivered, "DigiCom Business"').eq("id", orderId).maybeSingle();
  if (!order || order["DigiCom Business"] !== businessId) return { ok: false, error: "order not found for this business" };

  const payload = {
    business_id: businessId, order_id: orderId, reason,
    customer_name: order.name, customer_phone: order.phone, price: Number(order.price ?? 0),
    delivered: !!order.delivered,
  };

  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  let actionId: string;
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "action already applied" };
    await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: "handle_exchange", kind: "handle_exchange",
      payload, status: "pending", expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
    }).eq("id", existing.id);
    actionId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
      business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
      skill_slug: "handle_exchange", kind: "handle_exchange",
      payload, status: "pending",
    }).select("id").maybeSingle();
    if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
    actionId = ins!.id;
  }

  return { ok: true, result: { prepared: true, action_id: actionId, summary: { reason, delivered: !!order.delivered }, next_step: "Acknowledge customer; explain owner will validate and process exchange." } };
}

// ─── 16. get_business_info ───────────────────────────────────────
async function runGetBusinessInfo(supabase: any, businessId: string) {
  const { data: b } = await supabase.from("businesses")
    .select("id, name, legal_form, legal_address, legal_city, postal_code, business_phone, business_email, website, ice, rc, identifiant_fiscal, patente, capital_social")
    .eq("id", businessId).maybeSingle();
  if (!b) return { ok: false, error: "business not found" };
  return { ok: true, result: {
    name: b.name,
    legal_form: b.legal_form,
    address: [b.legal_address, b.legal_city, b.postal_code].filter(Boolean).join(", "),
    phone: b.business_phone,
    email: b.business_email,
    website: b.website,
    ice: b.ice, rc: b.rc, if: b.identifiant_fiscal, patente: b.patente,
    capital_social: b.capital_social,
  } };
}

// ─── 17. get_product_details ─────────────────────────────────────
async function runGetProductDetails(supabase: any, businessId: string, args: any) {
  const id: string | undefined = typeof args?.product_id === "string" ? args.product_id : undefined;
  if (!id) return { ok: false, error: "product_id required" };
  const { data: p } = await supabase.from("products")
    .select('id, name, code, label, description, cost_price, selling_price, image_url, stock, active, "DigiCom Business"')
    .eq("id", id).maybeSingle();
  if (!p || p["DigiCom Business"] !== businessId) return { ok: false, error: "product not found for this business" };
  return { ok: true, result: {
    id: p.id, name: p.name, code: p.code, label: p.label,
    description: p.description,
    selling_price: Number(p.selling_price),
    stock: p.stock, active: p.active,
    has_image: !!p.image_url,
  } };
}

// ─── 18. send_product_media (Phase 9 — DEFERRED) ─────────────────
async function runSendProductMedia(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const ids: string[] = Array.isArray(args?.product_ids) ? args.product_ids : (typeof args?.product_id === "string" ? [args.product_id] : []);
  const caption: string | undefined = typeof args?.caption === "string" ? args.caption.trim() : undefined;
  if (ids.length === 0) return { ok: false, error: "product_ids array required" };
  if (ids.length > 5)   return { ok: false, error: "max 5 products per send" };

  // Fetch all + tenant + image_url check
  const { data: prods } = await supabase.from("products")
    .select('id, name, image_url, selling_price, "DigiCom Business"')
    .in("id", ids);
  if (!prods || prods.length !== ids.length) return { ok: false, error: "one or more products not found" };
  for (const p of prods as any[]) {
    if (p["DigiCom Business"] !== businessId) return { ok: false, error: "cross-tenant product" };
    if (!p.image_url) return { ok: false, error: `product '${p.name}' has no image` };
  }

  const payload = { business_id: businessId, products: prods.map((p: any) => ({ id: p.id, name: p.name, image_url: p.image_url, price: Number(p.selling_price) })), caption: caption || null };

  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  let actionId: string;
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "already applied" };
    await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: "send_product_media", kind: "send_product_media",
      payload, status: "pending", expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
    }).eq("id", existing.id);
    actionId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
      business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
      skill_slug: "send_product_media", kind: "send_product_media", payload, status: "pending",
    }).select("id").maybeSingle();
    if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
    actionId = ins!.id;
  }

  return { ok: true, result: {
    prepared: true, action_id: actionId,
    summary: { products: prods.map((p: any) => ({ name: p.name, price: Number(p.selling_price) })), caption: caption || null },
    next_step: "Compose a short sentence telling the customer you're sending the product image(s); owner approval will trigger the actual media send.",
  } };
}

// ─── 19. apply_pricing_rule ──────────────────────────────────────
async function runApplyPricingRule(supabase: any, businessId: string, args: any) {
  const productId: string | undefined = typeof args?.product_id === "string" ? args.product_id : undefined;
  const qty = Number.isFinite(args?.quantity) ? Math.max(1, Math.floor(args.quantity)) : 1;
  if (!productId) return { ok: false, error: "product_id required" };
  const { data, error } = await supabase.rpc("ai_resolve_price", { p_business_id: businessId, p_product_id: productId, p_quantity: qty });
  if (error) return { ok: false, error: `resolve_price: ${error.message}` };
  return { ok: true, result: data };
}

// ─── 14. summarize_today_sales — read-only owner analytics ─────────
async function runSummarizeSales(supabase: any, businessId: string, args: any) {
  const period = typeof args?.period === "string" ? args.period : "today";
  if (!["today","yesterday","this_week","last_7_days"].includes(period)) {
    return { ok: false, error: "period must be today|yesterday|this_week|last_7_days" };
  }
  const { data, error } = await supabase.rpc("ai_skill_summarize_sales", { p_business_id: businessId, p_period: period });
  if (error) return { ok: false, error: `summarize_sales: ${error.message}` };
  return { ok: true, result: data };
}

// ─── 15. analyze_ads_roi — read-only owner analytics ───────────────
async function runAnalyzeAdsRoi(supabase: any, businessId: string, args: any) {
  const days = Number.isFinite(args?.period_days) ? Math.max(1, Math.min(args.period_days, 90)) : 7;
  const { data, error } = await supabase.rpc("ai_skill_ads_roi", { p_business_id: businessId, p_period_days: days });
  if (error) return { ok: false, error: `ads_roi: ${error.message}` };
  return { ok: true, result: data };
}

// ─── 11. send_payment_reminder — read-only ──────────────────────────
async function runSendPaymentReminder(supabase: any, businessId: string, args: any) {
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };
  const { data, error } = await supabase.rpc("ai_skill_get_order_status", { p_business_id: businessId, p_identifier: orderId });
  if (error) return { ok: false, error: `lookup: ${error.message}` };
  if (!data || data.length === 0) return { ok: true, result: { order: null, message: "order not found" } };
  const o = data[0];
  if (!o.delivered) return { ok: true, result: { order: o, eligible: false, reason: "not delivered yet" } };
  return { ok: true, result: { order: { id: o.id, customer_name: o.customer_name, customer_phone: o.customer_phone, price: Number(o.price), date_livraison: o.date_livraison }, eligible: true, instruction: "Politely remind customer of unpaid balance." } };
}

// ════════════════════════════════════════════════════════════════════
// PHASE 16 — devis / facture / delivery-note (DEFERRED EXECUTION)
// ════════════════════════════════════════════════════════════════════
//
// All three follow the same pattern as create_order:
//   - validate inputs + tenant ownership
//   - assemble a complete payload
//   - upsert ai_pending_actions row keyed by tool_use_id
//   - return prepared:true so the brain composes a confirmation reply
// The actual DB insert / carrier API call only fires after the owner
// approves the message in the Review Queue.
// ════════════════════════════════════════════════════════════════════

// Shared: build the line items + monetary totals for a given order, and
// produce a snapshot fragment compatible with DevisSnapshot / FactureSnapshot
// (matches src/lib/devis/types.ts and src/lib/facture/types.ts so the
// admin Devis/Facture UI can preview / regenerate / re-render the PDF).
async function buildDocumentSnapshotForOrder(
  supabase: any,
  businessId: string,
  orderId: string,
  tvaRatePct: number,
  tvaIncluded: boolean,
) {
  const { data: order, error: oerr } = await supabase
    .from("orders")
    .select('id, name, phone, address, price, master_city_id, "DigiCom Business"')
    .eq("id", orderId).maybeSingle();
  if (oerr) return { ok: false as const, error: `order lookup: ${oerr.message}` };
  if (!order) return { ok: false as const, error: "order not found" };
  if (order["DigiCom Business"] !== businessId) return { ok: false as const, error: "order belongs to another business" };

  // Resolve city name from master_cities (best-effort).
  let cityName = "";
  if (order.master_city_id) {
    const { data: city } = await supabase.from("master_cities").select("name").eq("id", order.master_city_id).maybeSingle();
    cityName = city?.name || "";
  }

  // Order items (joined to products for label/price). order_items may have
  // unit_price overrides — use that when present, otherwise products.selling_price.
  const { data: items, error: ierr } = await supabase
    .from("order_items")
    .select("id, quantity, unit_price, product_id, products(id, name, code, label, selling_price)")
    .eq("order_id", orderId);
  if (ierr) return { ok: false as const, error: `items lookup: ${ierr.message}` };
  if (!items || items.length === 0) return { ok: false as const, error: "order has no items" };

  type Line = { label: string; quantity: number; unit_price: number; product_id?: string | null };
  const lines: Line[] = items
    .filter((it: any) => Number(it.quantity) > 0)
    .map((it: any) => {
      const prod = it.products || {};
      const label = prod.label || prod.name || prod.code || "Produit";
      const unit  = Number.isFinite(it.unit_price) && Number(it.unit_price) > 0
        ? Number(it.unit_price)
        : Number(prod.selling_price ?? 0);
      return { label, quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)), unit_price: unit, product_id: prod.id || it.product_id || null };
    });

  if (lines.length === 0) return { ok: false as const, error: "order items have zero quantities" };

  // Subtotals — same math the wizards use:
  //   tva_included=false → lines are HT, total_ttc = subtotal_ht + tva_amount
  //   tva_included=true  → lines are TTC, derive HT from TTC
  const grossSum = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const tvaRate = Math.max(0, Math.min(40, Number(tvaRatePct) || 0));
  let subtotal_ht: number;
  let tva_amount: number;
  let total_ttc: number;
  if (tvaIncluded) {
    total_ttc   = round2(grossSum);
    subtotal_ht = round2(grossSum / (1 + tvaRate / 100));
    tva_amount  = round2(total_ttc - subtotal_ht);
  } else {
    subtotal_ht = round2(grossSum);
    tva_amount  = round2(subtotal_ht * (tvaRate / 100));
    total_ttc   = round2(subtotal_ht + tva_amount);
  }

  // Business block — what the PDF header needs.
  const { data: biz } = await supabase
    .from("businesses")
    .select("name, legal_form, capital_social, legal_address, legal_city, postal_code, business_phone, business_email, website, ice, rc, identifiant_fiscal, patente, cnss, logo, cachet_url, signature_url")
    .eq("id", businessId).maybeSingle();

  const businessBlock = {
    source: "database" as const,
    name: biz?.name || "",
    ice: biz?.ice || null,
    rc: biz?.rc || null,
    identifiant_fiscal: biz?.identifiant_fiscal || null,
    patente: biz?.patente || null,
    cnss: biz?.cnss || null,
    legal_form: biz?.legal_form || null,
    capital_social: biz?.capital_social || null,
    legal_address: biz?.legal_address || null,
    legal_city: biz?.legal_city || null,
    postal_code: biz?.postal_code || null,
    business_phone: biz?.business_phone || null,
    business_email: biz?.business_email || null,
    website: biz?.website || null,
    logo_url: biz?.logo || null,
  };

  const clientBlock = {
    source: "orders" as const,
    name: order.name || "",
    phone: order.phone || "",
    address: order.address || "",
    city: cityName,
  };

  const stamps = {
    source: (biz?.cachet_url || biz?.signature_url) ? ("business" as const) : ("blank" as const),
    cachet_url:    biz?.cachet_url    || null,
    signature_url: biz?.signature_url || null,
  };

  return {
    ok: true as const,
    order: { id: order.id, total_in_db: Number(order.price ?? 0), city: cityName, customer_name: order.name, customer_phone: order.phone },
    snapshotCore: {
      business: businessBlock,
      lines: { source: "database" as const, items: lines },
      tva_included: tvaIncluded,
      tva_rate: tvaRate,
      subtotal_ht,
      tva_amount,
      total_ttc,
      client: clientBlock,
      stamps,
    },
    totals: { subtotal_ht, tva_amount, total_ttc, tva_rate: tvaRate },
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }

// ─── 20. generate_devis (Phase 16 — DEFERRED) ────────────────────────
// Prepares a DevisSnapshot for an existing order. After approval the
// SQL apply step inserts into public.devis with auto-numbered DEV-…-XXXX.
async function runGenerateDevis(
  supabase: any,
  businessId: string,
  threadId: string,
  toolUseId: string,
  args: any,
  callerPhone?: string,
) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id.trim() : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };

  const tvaRate     = Number.isFinite(args?.tva_rate) ? Number(args.tva_rate) : 20;
  const tvaIncluded = !!args?.tva_included;
  const validUntil: string | null = typeof args?.valid_until === "string" && args.valid_until.length > 0 ? args.valid_until : null;
  const notes:      string | null = typeof args?.notes === "string" && args.notes.length > 0 ? args.notes.slice(0, 1000) : null;

  const built = await buildDocumentSnapshotForOrder(supabase, businessId, orderId, tvaRate, tvaIncluded);
  if (!built.ok) return { ok: false, error: built.error };

  // Tenant safety: if the brain has a verified callerPhone, refuse to generate
  // a devis for an order that belongs to a different customer.
  if (callerPhone && built.order.customer_phone && !phoneMatches(built.order.customer_phone, callerPhone)) {
    return { ok: false, error: "forbidden: order belongs to a different customer" };
  }

  const snapshot: any = {
    ...built.snapshotCore,
    valid_until: validUntil,
    notes,
    thank_you_text: null,
  };

  const payload = {
    business_id: businessId,
    order_id: orderId,
    valid_until: validUntil,
    subtotal_ht: built.totals.subtotal_ht,
    tva_rate:    built.totals.tva_rate,
    tva_amount:  built.totals.tva_amount,
    total_ttc:   built.totals.total_ttc,
    snapshot,
  };

  return upsertPendingAction(
    supabase,
    { businessId, threadId, toolUseId, kind: "generate_devis", payload },
    {
      summary: {
        kind: "devis",
        order_id: orderId,
        customer_name: built.order.customer_name,
        line_count: built.snapshotCore.lines.items.length,
        subtotal_ht: built.totals.subtotal_ht,
        tva_rate: built.totals.tva_rate,
        tva_amount: built.totals.tva_amount,
        total_ttc: built.totals.total_ttc,
        currency: "MAD",
      },
      next_step: "Tell the customer you are preparing a quote (devis) and that the owner will approve it shortly. The PDF/number is generated only after approval.",
    },
  );
}

// ─── 21. generate_facture (Phase 16 — DEFERRED) ──────────────────────
async function runGenerateFacture(
  supabase: any,
  businessId: string,
  threadId: string,
  toolUseId: string,
  args: any,
  callerPhone?: string,
) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id.trim() : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };

  const tvaRate        = Number.isFinite(args?.tva_rate) ? Number(args.tva_rate) : 20;
  const tvaIncluded    = !!args?.tva_included;
  const dueDate:       string | null = typeof args?.due_date === "string" && args.due_date.length > 0 ? args.due_date : null;
  const paymentTerms:  string | null = typeof args?.payment_terms === "string" && args.payment_terms.length > 0 ? args.payment_terms.slice(0, 200) : null;
  const devisRef:      string | null = typeof args?.devis_reference === "string" && args.devis_reference.length > 0 ? args.devis_reference.slice(0, 50) : null;
  const notes:         string | null = typeof args?.notes === "string" && args.notes.length > 0 ? args.notes.slice(0, 1000) : null;

  const built = await buildDocumentSnapshotForOrder(supabase, businessId, orderId, tvaRate, tvaIncluded);
  if (!built.ok) return { ok: false, error: built.error };

  if (callerPhone && built.order.customer_phone && !phoneMatches(built.order.customer_phone, callerPhone)) {
    return { ok: false, error: "forbidden: order belongs to a different customer" };
  }

  // If devisRef provided, sanity-check it exists for this business so we
  // do not store a dangling reference. Soft warn — do not block.
  let devisRefChecked = devisRef;
  if (devisRef) {
    const { data: dv } = await supabase.from("devis").select("id").eq("business_id", businessId).eq("devis_number", devisRef).maybeSingle();
    if (!dv) devisRefChecked = null;
  }

  const snapshot: any = {
    ...built.snapshotCore,
    due_date: dueDate,
    payment_terms: paymentTerms,
    devis_reference: devisRefChecked,
    notes,
    thank_you_text: null,
  };

  const payload = {
    business_id: businessId,
    order_id: orderId,
    due_date: dueDate,
    payment_terms: paymentTerms,
    devis_reference: devisRefChecked,
    subtotal_ht: built.totals.subtotal_ht,
    tva_rate:    built.totals.tva_rate,
    tva_amount:  built.totals.tva_amount,
    total_ttc:   built.totals.total_ttc,
    snapshot,
  };

  return upsertPendingAction(
    supabase,
    { businessId, threadId, toolUseId, kind: "generate_facture", payload },
    {
      summary: {
        kind: "facture",
        order_id: orderId,
        customer_name: built.order.customer_name,
        line_count: built.snapshotCore.lines.items.length,
        subtotal_ht: built.totals.subtotal_ht,
        tva_rate: built.totals.tva_rate,
        tva_amount: built.totals.tva_amount,
        total_ttc: built.totals.total_ttc,
        currency: "MAD",
        devis_reference: devisRefChecked,
        due_date: dueDate,
        payment_terms: paymentTerms,
      },
      next_step: "Tell the customer the invoice (facture) is being prepared and will be sent after the owner approves it.",
    },
  );
}

// ─── 22. create_delivery_note (Phase 16 — DEFERRED) ──────────────────
// Pushes an EXISTING order to the configured carrier. The order MUST
// already have `company_id` set; the AI will not pick a carrier itself —
// owner stays in control of routing decisions.
async function runCreateDeliveryNote(
  supabase: any,
  businessId: string,
  threadId: string,
  toolUseId: string,
  args: any,
  callerPhone?: string,
) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id.trim() : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };

  // Load the order with everything provider-integration's create_parcel needs.
  const { data: order } = await supabase
    .from("orders")
    .select('id, name, phone, address, price, note, delivery_note, master_city_id, company_id, replace, "DigiCom Business", coliaty_old_tracking, ameex_old_tracking, quicklivraison_old_tracking, forcelog_old_tracking, sendit_old_tracking')
    .eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, error: "order not found" };
  if (order["DigiCom Business"] !== businessId) return { ok: false, error: "order belongs to another business" };
  if (callerPhone && order.phone && !phoneMatches(order.phone, callerPhone)) {
    return { ok: false, error: "forbidden: order belongs to a different customer" };
  }
  if (!order.company_id) {
    return { ok: false, error: "order has no carrier configured (orders.company_id is null) — owner must assign a delivery provider before pushing" };
  }
  if (!order.master_city_id) return { ok: false, error: "order has no city configured" };

  // Already pushed?
  const { data: existingParcel } = await supabase
    .from("company_parcels")
    .select("id, tracking_code, reference, status_label")
    .eq("order_id", orderId).limit(1);
  if (existingParcel && existingParcel.length > 0) {
    const ep = existingParcel[0];
    return { ok: false, error: `order already pushed to carrier (tracking ${ep.tracking_code || ep.reference || "?"})` };
  }

  // Provider info — needed by ai-review-act when it actually calls
  // provider-integration. Cache the per-provider permission flags now so
  // the Review Queue card can show them.
  const { data: provider } = await supabase
    .from("providers")
    .select("id, name, provider_type, business_id, \"DigiCom Business\", coliaty_package_no_open, ameex_parcel_replace, ameex_parcel_open, ameex_parcel_try_on, ameex_parcel_fragile, ozon_parcel_open, ozon_parcel_fragile, ozon_parcel_replace, quicklivraison_parcel_open, quicklivraison_parcel_try_on, quicklivraison_parcel_fragile, vitex_parcel_fragile, vitex_parcel_open, forcelog_parcel_fragile, forcelog_parcel_open, forcelog_parcel_carton, sendit_pickup_district_id, sendit_allow_try")
    .eq("id", order.company_id).maybeSingle();
  if (!provider) return { ok: false, error: "configured carrier not found in providers table" };
  if (provider["DigiCom Business"] !== businessId) return { ok: false, error: "carrier belongs to another business" };

  // Order items (provider's product_info text — same format as DeliveryNoteWizard)
  const { data: items } = await supabase
    .from("order_items")
    .select("quantity, products(code, name)")
    .eq("order_id", orderId);
  const productInfo = (items || [])
    .filter((it: any) => Number(it.quantity) > 0)
    .map((it: any) => `${it.products?.code || it.products?.name || "P"} x${Math.floor(Number(it.quantity) || 1)}`)
    .join(", ");
  const productQty = (items || []).reduce((s: number, it: any) => s + Math.floor(Number(it.quantity) || 0), 0) || 1;

  // City name (Sendit and others use it).
  let cityName = "";
  if (order.master_city_id) {
    const { data: c } = await supabase.from("master_cities").select("name").eq("id", order.master_city_id).maybeSingle();
    cityName = c?.name || "";
  }

  // The parcel_data object is identical to the one DeliveryNoteWizard
  // builds (src/components/delivery/DeliveryNoteWizard.tsx ~line 428).
  // ai-review-act assembles the per-provider permission/exchange spread
  // at send time, so we only stash the canonical fields here.
  const parcelData: any = {
    customer_name: order.name,
    customer_phone: order.phone,
    delivery_address: order.address,
    cod_amount: Number(order.price ?? 0),
    master_city_id: order.master_city_id,
    city_name: cityName,
    product_info: productInfo,
    product_qty: productQty,
    note: order.note || "",
    delivery_note: order.delivery_note || "",
  };

  const payload = {
    business_id: businessId,
    order_id: orderId,
    provider_id: order.company_id,
    provider_type: provider.provider_type,
    provider_name: provider.name,
    parcel_data: parcelData,
    customer_name: order.name,
    customer_phone: order.phone,
    cod_amount: Number(order.price ?? 0),
    is_replace: !!order.replace,
    old_tracking: {
      coliaty:        order.coliaty_old_tracking || null,
      ameex:          order.ameex_old_tracking || null,
      quicklivraison: order.quicklivraison_old_tracking || null,
      forcelog:       order.forcelog_old_tracking || null,
      sendit:         order.sendit_old_tracking || null,
    },
    // Cached so ai-review-act can build per-provider flag spread without re-querying.
    provider_flags: {
      coliaty_package_no_open:        provider.coliaty_package_no_open,
      ameex_parcel_replace:           provider.ameex_parcel_replace,
      ameex_parcel_open:              provider.ameex_parcel_open,
      ameex_parcel_try_on:            provider.ameex_parcel_try_on,
      ameex_parcel_fragile:           provider.ameex_parcel_fragile,
      ozon_parcel_open:               provider.ozon_parcel_open,
      ozon_parcel_fragile:            provider.ozon_parcel_fragile,
      ozon_parcel_replace:            provider.ozon_parcel_replace,
      quicklivraison_parcel_open:     provider.quicklivraison_parcel_open,
      quicklivraison_parcel_try_on:   provider.quicklivraison_parcel_try_on,
      quicklivraison_parcel_fragile:  provider.quicklivraison_parcel_fragile,
      vitex_parcel_fragile:           provider.vitex_parcel_fragile,
      vitex_parcel_open:              provider.vitex_parcel_open,
      forcelog_parcel_fragile:        provider.forcelog_parcel_fragile,
      forcelog_parcel_open:           provider.forcelog_parcel_open,
      forcelog_parcel_carton:         provider.forcelog_parcel_carton,
      sendit_pickup_district_id:      provider.sendit_pickup_district_id,
      sendit_allow_try:               provider.sendit_allow_try,
    },
  };

  return upsertPendingAction(
    supabase,
    { businessId, threadId, toolUseId, kind: "create_delivery_note", payload },
    {
      summary: {
        kind: "create_delivery_note",
        order_id: orderId,
        customer_name: order.name,
        cod_amount: Number(order.price ?? 0),
        carrier: provider.name,
        carrier_type: provider.provider_type,
        city: cityName,
        product_info: productInfo,
        is_exchange: !!order.replace,
      },
      next_step: "Tell the customer the order is being shipped and the tracking number will follow shortly. Do NOT promise a tracking number yet — it is generated only after the owner approves and the carrier API responds.",
    },
  );
}

// Shared upsert + standard response shape.
async function upsertPendingAction(
  supabase: any,
  args: { businessId: string; threadId: string; toolUseId: string; kind: string; payload: any },
  resp: { summary: any; next_step: string },
) {
  const { businessId, threadId, toolUseId, kind, payload } = args;
  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  let actionId: string;
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "action already applied" };
    await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: kind, kind,
      payload, status: "pending", expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", existing.id);
    actionId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
      business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
      skill_slug: kind, kind, payload, status: "pending",
    }).select("id").maybeSingle();
    if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
    actionId = ins!.id;
  }
  return { ok: true, result: { prepared: true, action_id: actionId, ...resp } };
}

// ─── Phase 17 ────────────────────────────────────────────────────────
// recommend_product, send_catalog_picker, react_with_emoji.

// ─── 23. recommend_product — read-only ────────────────────────────────
// Given a source product, return up to N other similar products from the
// same catalog. Used for cross-sell / upsell after the customer expresses
// interest in something specific. Cross-tenant safety enforced by the RPC.
async function runRecommendProduct(supabase: any, businessId: string, args: any, cfg: Record<string, any> = {}) {
  const productId: string | undefined = typeof args?.product_id === "string" ? args.product_id : undefined;
  if (!productId) return { ok: false, error: "product_id required" };
  // Cap by per-business config — owner setting wins over the brain's request.
  const cfgMax = Math.max(1, Math.min(Number(cfg.max_suggestions) || 3, 5));
  const limit  = Math.min(cfgMax, Math.max(1, Math.min(args?.limit ?? cfgMax, 5)));
  const minSim = Math.max(0.05, Math.min(Number(cfg.min_similarity) || 0.15, 0.5));
  const { data, error } = await supabase.rpc("ai_skill_recommend_products", {
    p_business_id: businessId, p_product_id: productId, p_limit: limit,
  });
  if (error) return { ok: false, error: `recommend_product: ${error.message}` };
  // Filter by min_similarity client-side (the RPC doesn't take it yet).
  const filtered = (data || []).filter((p: any) => Number(p.similarity) >= minSim);
  return { ok: true, result: {
    source_product_id: productId,
    suggestions: filtered.map((p: any) => ({
      id: p.id, name: p.name, code: p.code, description: p.description,
      price: Number(p.selling_price), stock: p.stock,
      match: Number(p.similarity).toFixed(2),
    })),
  } };
}

// ─── 24. send_catalog_picker — sandbox-required ───────────────────────
// Queues a WhatsApp interactive list of 2-10 products for the customer to
// tap. Owner approves in Review Queue → ai-review-act calls evolution-client
// `send-list` to actually push it.
async function runSendCatalogPicker(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, cfg: Record<string, any> = {}) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const ids: string[] = Array.isArray(args?.product_ids) ? args.product_ids.filter((x: any) => typeof x === "string") : [];
  // Owner-set hard cap on picker size.
  const cfgMaxItems = Math.max(2, Math.min(Number(cfg.max_products_per_picker) || 5, 10));
  if (ids.length < 2)             return { ok: false, error: "product_ids requires 2..10 ids" };
  if (ids.length > cfgMaxItems)   return { ok: false, error: `max ${cfgMaxItems} products in a picker (business config)` };

  // Owner-defined defaults — used if the brain didn't pass title/button_text.
  const cfgTitle      = typeof cfg.default_title       === "string" ? cfg.default_title       : "Voir nos options";
  const cfgButtonText = typeof cfg.default_button_text === "string" ? cfg.default_button_text : "Choisir";
  const title       = trimOrEmpty(args?.title,       60) || cfgTitle;
  const description = trimOrEmpty(args?.description, 100);
  const buttonText  = trimOrEmpty(args?.button_text, 20) || cfgButtonText;
  const footerText  = trimOrEmpty(args?.footer_text, 60);
  if (!title || !description || !buttonText) {
    return { ok: false, error: "title, description, button_text are required" };
  }

  // Cross-tenant check: every requested product must belong to this business
  // and be active. Mirrors the safety pattern in send_product_media.
  const { data: prods } = await supabase.from("products")
    .select('id, name, selling_price, stock, active, "DigiCom Business"')
    .in("id", ids);
  if (!prods || prods.length !== ids.length) return { ok: false, error: "one or more products not found" };
  for (const p of prods as any[]) {
    if (p["DigiCom Business"] !== businessId) return { ok: false, error: "cross-tenant product" };
    if (p.active === false) return { ok: false, error: `product '${p.name}' is inactive` };
  }
  // Preserve the requested order for the picker rows
  const byId = new Map<string, any>(); for (const p of prods as any[]) byId.set(p.id, p);
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  const payload = {
    business_id: businessId,
    title, description, button_text: buttonText, footer_text: footerText,
    products: ordered.map((p: any) => ({
      id: p.id, name: p.name, price: Number(p.selling_price), stock: p.stock,
    })),
  };

  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  let actionId: string;
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "already applied" };
    await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: "send_catalog_picker", kind: "send_catalog_picker",
      payload, status: "pending", expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
    }).eq("id", existing.id);
    actionId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
      business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
      skill_slug: "send_catalog_picker", kind: "send_catalog_picker", payload, status: "pending",
    }).select("id").maybeSingle();
    if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
    actionId = ins!.id;
  }

  return { ok: true, result: {
    prepared: true, action_id: actionId,
    summary: { count: ordered.length, title, button_text: buttonText },
    next_step: "Compose a brief sentence telling the customer the picker is on the way; owner approval will trigger the actual interactive list.",
  } };
}

// ─── 25. react_with_emoji — fire-and-forget ───────────────────────────
// Reacts immediately to the customer's most recent inbound message in the
// thread. No sandbox queue: a tap-back emoji is harmless, single-character,
// reversible (empty string removes), and used for fast acknowledgement.
async function runReactWithEmoji(supabase: any, businessId: string, threadId: string, args: any, cfg: Record<string, any> = {}) {
  const reaction: string = typeof args?.reaction === "string" ? args.reaction : "";
  if (reaction.length > 8) return { ok: false, error: "reaction must be a single emoji (or empty to remove)" };
  if (!threadId) return { ok: false, error: "thread_id required" };

  // Owner-set whitelist: brain may only use emojis the owner allowed.
  // Empty reaction is always permitted (it removes a previous reaction).
  const allowed: string[] = Array.isArray(cfg.allowed_emojis) && cfg.allowed_emojis.length
    ? cfg.allowed_emojis : ["👍","🙏","❤️","😊","✅"];
  if (reaction && !allowed.includes(reaction)) {
    return { ok: false, error: `emoji '${reaction}' not in allowed set (${allowed.join(" ")}) for this business` };
  }

  // Find the most recent inbound message in this thread.
  const { data: lastInbound } = await supabase
    .from("wa_messages")
    .select("id, instance_id, wa_message_id, wa_remote_jid, business_id, text_content")
    .eq("thread_id", threadId)
    .eq("direction", "in")
    .eq("business_id", businessId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastInbound?.wa_message_id || !lastInbound?.wa_remote_jid) {
    return { ok: false, error: "no inbound message found to react to" };
  }
  // Owner-set min length: don't react to short messages (avoid noisy thumbs
  // on every "ok" / "merci"). Empty reaction (removal) always allowed.
  const minLen = Math.max(0, Math.min(Number(cfg.min_message_length) || 0, 500));
  if (reaction && minLen > 0 && (lastInbound.text_content || "").length < minLen) {
    return { ok: false, error: `message too short to react (${(lastInbound.text_content || "").length} chars < min ${minLen})` };
  }
  const { data: instance } = await supabase
    .from("wa_instances")
    .select("name, status")
    .eq("id", lastInbound.instance_id)
    .maybeSingle();
  if (!instance?.name) return { ok: false, error: "instance not found" };
  if (instance.status !== "open") return { ok: false, error: `instance offline (${instance.status})` };

  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-client`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({
      action: "send-reaction",
      payload: {
        instanceName: instance.name,
        reaction,
        key: { id: lastInbound.wa_message_id, remoteJid: lastInbound.wa_remote_jid, fromMe: false },
      },
    }),
  });
  let data: any = null;
  try { data = await r.json(); } catch { /* ignore */ }
  if (!r.ok) return { ok: false, error: `react failed (${r.status}): ${data?.error || "unknown"}` };

  return { ok: true, result: {
    target_wa_message_id: lastInbound.wa_message_id,
    reaction: reaction || "(removed)",
  } };
}

// ─── 27. analyze_image — GPT-5.5 vision ───────────────────────────────
// Brain calls when the customer's last inbound message is an image.
// Pipeline: find the image media → fetch base64 via evolution-client →
// send to gpt-5.5 with vision input → return structured intent + desc +
// extracted_text. Cost is recorded against the business via ai_record_usage.
async function runAnalyzeImage(supabase: any, businessId: string, threadId: string, args: any) {
  if (!threadId) return { ok: false, error: "thread_id required" };
  const hint: string = typeof args?.hint === "string" ? args.hint.trim() : "";

  // 1. Find the most recent inbound IMAGE message in this thread.
  const { data: lastImg } = await supabase
    .from("wa_messages")
    .select("id, instance_id, wa_message_id, wa_remote_jid, message_kind, media_id, business_id, raw_payload")
    .eq("thread_id", threadId)
    .eq("direction", "in")
    .eq("business_id", businessId)
    .eq("message_kind", "image")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastImg?.wa_message_id || !lastImg?.wa_remote_jid) {
    return { ok: false, error: "no inbound image found in this thread" };
  }
  const { data: instance } = await supabase
    .from("wa_instances")
    .select("name, status").eq("id", lastImg.instance_id).maybeSingle();
  if (!instance?.name) return { ok: false, error: "instance not found" };

  // 2. Fetch image bytes via evolution-client get-media (returns base64).
  const mResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-client`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({
      action: "get-media",
      payload: { instanceName: instance.name, key: { id: lastImg.wa_message_id, remoteJid: lastImg.wa_remote_jid, fromMe: false } },
    }),
  });
  const mJson = await mResp.json();
  const b64: string | undefined = mJson?.base64 || mJson?.media || mJson?.body;
  const mime = (mJson?.mimetype as string | undefined) || "image/jpeg";
  if (!b64) return { ok: false, error: `image fetch failed: ${mJson?.error || "no body"}` };

  // 3. Resolve OpenAI key + gpt-5.5 model row (for cost tracking).
  const [{ data: oaiProv }, { data: model }] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("slug", "openai").maybeSingle(),
    supabase.from("ai_models").select("id, model_id").eq("model_id", "gpt-5.5").maybeSingle(),
  ]);
  if (!oaiProv?.id || !model?.id) return { ok: false, error: "gpt-5.5 not registered" };
  const { data: keyPlain } = await supabase.rpc("ai_decrypt_platform_key", { p_provider_id: oaiProv.id });
  if (!keyPlain) return { ok: false, error: "openai key missing" };

  // 4. Call gpt-5.5 with vision input. We ask for strict JSON so the brain
  // can act on the result. detail=auto trims cost on smaller images.
  const sysPrompt = [
    "You are a vision classifier for a Moroccan WhatsApp e-commerce shop.",
    "The customer just sent an image. Your job:",
    "  1. Classify INTENT into ONE of: product, damaged_item, address_screenshot, payment_receipt, id_photo, other",
    "  2. Write a SHORT description (max 200 chars) of what's visually in the image",
    "  3. Extract ANY visible text (printed, handwritten, screenshot text) into extracted_text",
    "  4. If intent=product, also propose a search_query (3-6 words in the customer's likely language) the brain can pass to search_products",
    "Return ONLY valid JSON: {\"intent\": ..., \"description\": ..., \"extracted_text\": ..., \"search_query\": ...} — no commentary, no markdown fences.",
  ].join("\n");
  const userContent: any[] = [
    { type: "text", text: hint ? `Context hint from the brain: ${hint}` : "Analyze this image." },
    { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "auto" } },
  ];
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${keyPlain}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.5",
      max_completion_tokens: 400,
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user",   content: userContent },
      ],
    }),
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, error: `gpt-5.5 vision ${r.status}: ${txt.slice(0, 200)}` };
  const j = JSON.parse(txt);
  const content: string = j?.choices?.[0]?.message?.content ?? "";
  let parsed: any = null;
  try { parsed = JSON.parse(content); }
  catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
  }
  if (!parsed) return { ok: false, error: "vision returned non-JSON content", raw: content.slice(0, 200) };

  // 5. Bill the call.
  const tokIn  = j?.usage?.prompt_tokens     ?? 0;
  const tokOut = j?.usage?.completion_tokens ?? 0;
  const costUsd = (tokIn * 5.00 + tokOut * 30.00) / 1_000_000;
  await supabase.rpc("ai_record_usage", {
    p_business_id: businessId, p_provider_id: oaiProv.id, p_model_id: model.id,
    p_tokens_in: tokIn, p_tokens_out: tokOut, p_audio_minutes: null, p_cost_usd: costUsd,
  });

  return { ok: true, result: {
    intent:         parsed.intent || "other",
    description:    parsed.description || null,
    extracted_text: parsed.extracted_text || null,
    search_query:   parsed.search_query || null,
    image_message_id: lastImg.wa_message_id,
    cost_usd: costUsd,
  } };
}

// ─── 28. edit_order — sandbox-required ────────────────────────────────
async function runEditOrder(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, callerPhone?: string, cfg: Record<string, any> = {}) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };

  // Tenant + caller-phone safety + cutoff window check
  const { data: alt } = await supabase.from("orders")
    .select('id, phone, delivered, date, order_status_id, "DigiCom Business"')
    .eq("id", orderId).maybeSingle();
  if (!alt || alt["DigiCom Business"] !== businessId) return { ok: false, error: "order not found for this business" };
  if (alt.delivered) return { ok: false, error: "order already delivered — cannot edit" };
  if (callerPhone && !phoneMatches(alt.phone, callerPhone)) return { ok: false, error: "forbidden: order is not for this caller" };
  const cutoffErr = await checkOrderEditCutoff(supabase, alt, cfg);
  if (cutoffErr) return { ok: false, error: cutoffErr };

  // Build the payload — only include keys the brain actually passed
  const payload: Record<string, unknown> = { order_id: orderId };
  if (args?.customer && typeof args.customer === "object") payload.customer = args.customer;
  if (args?.city && typeof args.city === "object")         payload.city     = args.city;
  if (Array.isArray(args?.items))                          payload.items    = args.items;
  if (Object.keys(payload).length === 1) return { ok: false, error: "nothing to edit — pass at least one of customer/city/items" };

  const actionId = await upsertPendingActionSimple(supabase, businessId, threadId, toolUseId, "edit_order", payload);
  if (!actionId.ok) return actionId;
  return { ok: true, result: {
    prepared: true, action_id: actionId.id,
    summary: { order_id: orderId, fields: Object.keys(payload).filter((k) => k !== "order_id") },
    next_step: "Compose a brief sentence telling the customer the change is being processed; owner approval applies it.",
  } };
}

// ─── 29. cancel_order — sandbox-required ──────────────────────────────
async function runCancelOrder(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, callerPhone?: string, cfg: Record<string, any> = {}) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id : undefined;
  const reason: string  = typeof args?.reason   === "string" ? args.reason.trim()  : "";
  if (!orderId)         return { ok: false, error: "order_id required" };
  if (reason.length < 3) return { ok: false, error: "reason required (min 3 chars)" };

  const { data: order } = await supabase.from("orders")
    .select('id, phone, delivered, date, order_status_id, "DigiCom Business"').eq("id", orderId).maybeSingle();
  if (!order || order["DigiCom Business"] !== businessId) return { ok: false, error: "order not found for this business" };
  if (order.delivered) return { ok: false, error: "order already delivered — cannot cancel" };
  if (callerPhone && !phoneMatches(order.phone, callerPhone)) return { ok: false, error: "forbidden: order is not for this caller" };
  const cutoffErr = await checkOrderEditCutoff(supabase, order, cfg);
  if (cutoffErr) return { ok: false, error: cutoffErr };

  const payload = { order_id: orderId, reason };
  const actionId = await upsertPendingActionSimple(supabase, businessId, threadId, toolUseId, "cancel_order", payload);
  if (!actionId.ok) return actionId;
  return { ok: true, result: {
    prepared: true, action_id: actionId.id,
    summary: { order_id: orderId, reason },
    next_step: "Compose a brief sentence acknowledging the cancellation request; owner approval will mark the order cancelled.",
  } };
}

// ─── 30. change_delivery_info — sandbox-required ──────────────────────
async function runChangeDeliveryInfo(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, callerPhone?: string, cfg: Record<string, any> = {}) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };

  const { data: order } = await supabase.from("orders")
    .select('id, phone, delivered, date, order_status_id, "DigiCom Business"').eq("id", orderId).maybeSingle();
  if (!order || order["DigiCom Business"] !== businessId) return { ok: false, error: "order not found for this business" };
  if (order.delivered) return { ok: false, error: "order already delivered — cannot change" };
  if (callerPhone && !phoneMatches(order.phone, callerPhone)) return { ok: false, error: "forbidden: order is not for this caller" };
  // change_delivery_info has its own cutoff key (cutoff_hours_before_shipment).
  // Use the same helper but with the change_delivery_info-specific name.
  const cutoffHours = Number(cfg.cutoff_hours_before_shipment) || 0;
  if (cutoffHours > 0 && order.date) {
    const placedAt = new Date(order.date as any).getTime();
    const ageHours = (Date.now() - placedAt) / 3_600_000;
    if (ageHours > cutoffHours) {
      return { ok: false, error: `order placed ${ageHours.toFixed(1)}h ago — past the ${cutoffHours}h delivery-info change window. Escalate to human.` };
    }
  }

  const payload: Record<string, unknown> = { order_id: orderId };
  if (typeof args?.recipient_name === "string") payload.recipient_name = args.recipient_name.trim();
  if (typeof args?.phone          === "string") payload.phone          = args.phone.trim();
  if (typeof args?.address        === "string") payload.address        = args.address.trim();
  if (typeof args?.master_city_id === "string") payload.master_city_id = args.master_city_id;
  if (Object.keys(payload).length === 1) return { ok: false, error: "nothing to change — pass at least one of recipient_name/phone/address/master_city_id" };

  const actionId = await upsertPendingActionSimple(supabase, businessId, threadId, toolUseId, "change_delivery_info", payload);
  if (!actionId.ok) return actionId;
  return { ok: true, result: {
    prepared: true, action_id: actionId.id,
    summary: { order_id: orderId, fields: Object.keys(payload).filter((k) => k !== "order_id") },
    next_step: "Compose a brief sentence confirming the new delivery info will be applied; owner approval finalizes the change.",
  } };
}

// ─── 31. upsell_cross_sell — read-only ────────────────────────────────
async function runUpsellCrossSell(supabase: any, businessId: string, args: any, cfg: Record<string, any> = {}) {
  const productId: string | undefined = typeof args?.product_id === "string" ? args.product_id : undefined;
  if (!productId) return { ok: false, error: "product_id required" };
  const cfgMax = Math.max(1, Math.min(Number(cfg.max_suggestions) || 3, 5));
  const limit  = Math.min(cfgMax, Math.max(1, Math.min(args?.limit ?? cfgMax, 5)));
  const premiumAllowed = cfg.premium_upsell_allowed !== false; // default true
  const excluded: string[] = Array.isArray(cfg.excluded_product_ids) ? cfg.excluded_product_ids : [];
  // Block recommending the anchor product itself or any owner-excluded id.
  if (excluded.includes(productId)) {
    return { ok: true, result: { anchor_product_id: productId, suggestions: [], note: "anchor product is excluded by business config" } };
  }
  const { data, error } = await supabase.rpc("ai_skill_upsell_cross_sell", {
    p_business_id: businessId, p_product_id: productId, p_limit: limit,
  });
  if (error) return { ok: false, error: `upsell_cross_sell: ${error.message}` };
  const filtered = (data || [])
    .filter((p: any) => !excluded.includes(p.id))
    .filter((p: any) => premiumAllowed || p.reason !== "premium version");
  return { ok: true, result: {
    anchor_product_id: productId,
    suggestions: filtered.map((p: any) => ({
      id: p.id, name: p.name, description: p.description,
      price: Number(p.selling_price), stock: p.stock, image_url: p.image_url,
      reason: p.reason, match: Number(p.similarity).toFixed(2),
    })),
  } };
}

// ─── 32. bundle_offer — sandbox-required ──────────────────────────────
async function runBundleOffer(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, cfg: Record<string, any> = {}) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const ids: string[] = Array.isArray(args?.product_ids) ? args.product_ids.filter((x: any) => typeof x === "string") : [];
  const bundlePrice: number = Number.isFinite(args?.bundle_price) ? Number(args.bundle_price) : NaN;
  const title       = trimOrEmpty(args?.title,       80);
  const description = trimOrEmpty(args?.description, 200);
  // Owner-set caps (with safe fallbacks)
  const cfgMaxSize = Math.max(2, Math.min(Number(cfg.max_bundle_size) || 5, 5));
  const cfgMinSavingsPct = Math.max(0, Math.min(Number(cfg.min_savings_pct) || 10, 50));
  if (ids.length < 2)        return { ok: false, error: "product_ids requires 2..5 ids" };
  if (ids.length > cfgMaxSize) return { ok: false, error: `max ${cfgMaxSize} products in a bundle (business config)` };
  if (!Number.isFinite(bundlePrice) || bundlePrice <= 0) return { ok: false, error: "bundle_price must be a positive number (in dh)" };
  if (!title || !description) return { ok: false, error: "title and description are required" };

  // Tenant safety + retail-price sum (so we can show savings)
  const { data: prods } = await supabase.from("products")
    .select('id, name, selling_price, image_url, "DigiCom Business"')
    .in("id", ids);
  if (!prods || prods.length !== ids.length) return { ok: false, error: "one or more products not found" };
  let retailSum = 0;
  for (const p of prods as any[]) {
    if (p["DigiCom Business"] !== businessId) return { ok: false, error: "cross-tenant product" };
    retailSum += Number(p.selling_price || 0);
  }
  if (bundlePrice >= retailSum) {
    return { ok: false, error: `bundle_price (${bundlePrice}) must be LESS than the sum of selling_prices (${retailSum}) — a bundle without a discount is not a bundle` };
  }
  const savings = retailSum - bundlePrice;
  const savingsPct = (savings / retailSum) * 100;
  if (savingsPct < cfgMinSavingsPct) {
    return { ok: false, error: `savings (${savingsPct.toFixed(1)}%) is below the business min (${cfgMinSavingsPct}%)` };
  }

  const byId = new Map<string, any>(); for (const p of prods as any[]) byId.set(p.id, p);
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  const payload = {
    business_id: businessId,
    title, description,
    bundle_price: bundlePrice,
    retail_sum:   retailSum,
    savings,
    products: ordered.map((p: any) => ({
      id: p.id, name: p.name, price: Number(p.selling_price), image_url: p.image_url,
    })),
  };

  const u = await upsertPendingActionSimple(supabase, businessId, threadId, toolUseId, "bundle_offer", payload);
  if (!u.ok) return u;
  return { ok: true, result: {
    prepared: true, action_id: u.id,
    summary: { count: ordered.length, bundle_price: bundlePrice, retail_sum: retailSum, savings },
    next_step: "Compose a brief sentence pitching the bundle; owner approval will send the actual offer message.",
  } };
}

// ─── 33. identify_repeat_customer — read-only ─────────────────────────
async function runIdentifyRepeatCustomer(supabase: any, businessId: string, args: any, callerPhone?: string, cfg: Record<string, any> = {}) {
  const phone: string | undefined = typeof args?.phone === "string" ? args.phone : undefined;
  if (!phone) return { ok: false, error: "phone required" };
  if (callerPhone && !phoneMatches(phone, callerPhone)) {
    return { ok: false, error: "forbidden: phone does not match caller — never look up other customers" };
  }
  const { data, error } = await supabase.rpc("ai_skill_identify_repeat_customer", {
    p_business_id: businessId, p_phone: phone,
  });
  if (error) return { ok: false, error: `identify_repeat_customer: ${error.message}` };

  const minOrders   = Math.max(1, Math.min(Number(cfg.min_orders_to_count) || 2, 10));
  const topProducts = Math.max(1, Math.min(Number(cfg.top_products_to_fetch) || 3, 5));
  // Apply business-tunable thresholds: customer is "repeat" only if they
  // hit the configured order count; cap top_products list to configured N.
  const totalOrders = Number(data?.total_orders ?? 0);
  if (data?.found && totalOrders < minOrders) {
    return { ok: true, result: { found: false, note: `customer has ${totalOrders} orders, below repeat threshold (${minOrders})` } };
  }
  if (data?.found && Array.isArray(data?.top_products)) {
    data.top_products = data.top_products.slice(0, topProducts);
  }
  return { ok: true, result: data };
}

// ─── 34. summarize_thread_for_human — GPT-5.5 short summary ───────────
async function runSummarizeThreadForHuman(supabase: any, businessId: string, threadId: string, args: any) {
  if (!threadId) return { ok: false, error: "thread_id required" };
  const hint: string = typeof args?.hint === "string" ? args.hint.trim() : "";

  const [{ data: oaiProv }, { data: model }] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("slug", "openai").maybeSingle(),
    supabase.from("ai_models").select("id, model_id").eq("model_id", "gpt-5.5").maybeSingle(),
  ]);
  if (!oaiProv?.id || !model?.id) return { ok: false, error: "gpt-5.5 not registered" };
  const { data: keyPlain } = await supabase.rpc("ai_decrypt_platform_key", { p_provider_id: oaiProv.id });
  if (!keyPlain) return { ok: false, error: "openai key missing" };

  const { data: msgs } = await supabase
    .from("wa_messages")
    .select("direction, text_content, received_at")
    .eq("thread_id", threadId)
    .eq("business_id", businessId)
    .order("received_at", { ascending: true })
    .limit(40);
  const transcript = (msgs || [])
    .map((m: any) => `${m.direction === "in" ? "Customer" : "Agent"}: ${(m.text_content || "").slice(0, 300)}`)
    .join("\n");

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${keyPlain}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.5",
      max_completion_tokens: 220,
      messages: [
        { role: "system", content: "You write 2-3 line handoff summaries for human agents taking over a WhatsApp conversation. Plain text, no JSON, no markdown. Format: line 1 = what the customer wants. line 2 = what the AI tried. line 3 = the unresolved point." },
        { role: "user",   content: `Conversation transcript (most recent last):\n${transcript}\n\nHint from the AI: ${hint || "(none)"}` },
      ],
    }),
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, error: `summarize ${r.status}: ${txt.slice(0, 200)}` };
  const j = JSON.parse(txt);
  const content: string = j?.choices?.[0]?.message?.content?.trim() ?? "";
  const tokIn  = j?.usage?.prompt_tokens     ?? 0;
  const tokOut = j?.usage?.completion_tokens ?? 0;
  const costUsd = (tokIn * 5.00 + tokOut * 30.00) / 1_000_000;
  await supabase.rpc("ai_record_usage", {
    p_business_id: businessId, p_provider_id: oaiProv.id, p_model_id: model.id,
    p_tokens_in: tokIn, p_tokens_out: tokOut, p_audio_minutes: null, p_cost_usd: costUsd,
  });
  return { ok: true, result: { summary: content, cost_usd: costUsd } };
}

// ─── 35. detect_spam_or_scam — GPT-5.5 short classifier ───────────────
async function runDetectSpamOrScam(supabase: any, businessId: string, threadId: string, args: any, cfg: Record<string, any> = {}) {
  const sample: string | undefined = typeof args?.sample === "string" ? args.sample.trim() : undefined;
  let textToScore = sample || "";
  if (!textToScore) {
    const { data: lastInbound } = await supabase.from("wa_messages")
      .select("text_content").eq("thread_id", threadId).eq("direction", "in")
      .eq("business_id", businessId).order("received_at", { ascending: false }).limit(1).maybeSingle();
    textToScore = (lastInbound?.text_content || "").slice(0, 1000);
  }
  if (!textToScore) return { ok: false, error: "no message to score" };

  // Allowlist short-circuit — if any owner-allowlisted phrase appears in the
  // message, never flag it. Saves an LLM call and avoids paying $0 for a
  // foregone conclusion.
  const allowlist: string[] = Array.isArray(cfg.allowlist_phrases) ? cfg.allowlist_phrases : [];
  const lower = textToScore.toLowerCase();
  for (const phrase of allowlist) {
    if (typeof phrase === "string" && phrase.length > 1 && lower.includes(phrase.toLowerCase())) {
      return { ok: true, result: {
        risk_score: 0, flags: [], suggested_action: "none",
        cost_usd: 0,
        note: `allowlisted phrase matched: "${phrase}"`,
      } };
    }
  }

  const [{ data: oaiProv }, { data: model }] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("slug", "openai").maybeSingle(),
    supabase.from("ai_models").select("id, model_id").eq("model_id", "gpt-5.5").maybeSingle(),
  ]);
  if (!oaiProv?.id || !model?.id) return { ok: false, error: "gpt-5.5 not registered" };
  const { data: keyPlain } = await supabase.rpc("ai_decrypt_platform_key", { p_provider_id: oaiProv.id });
  if (!keyPlain) return { ok: false, error: "openai key missing" };

  const sys = [
    "You score WhatsApp messages for a Moroccan e-commerce shop on risk of being SPAM, FAKE ORDER, ABUSIVE, or SCAM.",
    "Output STRICT JSON only: {\"risk_score\": 0..1, \"flags\": [string], \"suggested_action\": \"none\"|\"watch\"|\"escalate\"|\"block\"}",
    "Possible flags: repeated_no_show, abusive_language, fake_address, urgency_pressure, mass_spam, impersonation, threat, unrelated_promotion, request_for_external_payment.",
    "No commentary. No markdown fences. Just the JSON.",
  ].join("\n");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${keyPlain}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.5",
      max_completion_tokens: 150,
      messages: [
        { role: "system", content: sys },
        { role: "user",   content: textToScore },
      ],
    }),
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, error: `detect ${r.status}: ${txt.slice(0, 200)}` };
  const j = JSON.parse(txt);
  const content: string = j?.choices?.[0]?.message?.content ?? "";
  let parsed: any = null;
  try { parsed = JSON.parse(content); }
  catch { const m = content.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } } }
  if (!parsed) return { ok: false, error: "non-JSON from classifier", raw: content.slice(0, 200) };
  const tokIn  = j?.usage?.prompt_tokens     ?? 0;
  const tokOut = j?.usage?.completion_tokens ?? 0;
  const costUsd = (tokIn * 5.00 + tokOut * 30.00) / 1_000_000;
  await supabase.rpc("ai_record_usage", {
    p_business_id: businessId, p_provider_id: oaiProv.id, p_model_id: model.id,
    p_tokens_in: tokIn, p_tokens_out: tokOut, p_audio_minutes: null, p_cost_usd: costUsd,
  });
  const riskScore  = Math.max(0, Math.min(1, Number(parsed.risk_score) || 0));
  const flagThresh = Math.max(0.1, Math.min(Number(cfg.risk_threshold_to_flag) || 0.7, 0.95));
  const pauseThresh = Math.max(0.1, Math.min(Number(cfg.auto_pause_threshold)   || 0.9, 1.0));
  // Owner-tunable suggestion override:
  //   risk >= auto_pause_threshold        → block (per business policy)
  //   risk_threshold_to_flag <= risk < pause → at least "escalate"
  //   below flag threshold                → "none"
  let suggestedAction = parsed.suggested_action;
  if (riskScore >= pauseThresh)         suggestedAction = "block";
  else if (riskScore >= flagThresh)     suggestedAction = (suggestedAction === "block" ? "block" : "escalate");
  else                                  suggestedAction = "none";
  return { ok: true, result: {
    risk_score: riskScore,
    flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    suggested_action: suggestedAction,
    flag_threshold: flagThresh,
    pause_threshold: pauseThresh,
    cost_usd: costUsd,
  } };
}

// ─── 36. request_review_after_delivery — sandbox-required ─────────────
async function runRequestReviewAfterDelivery(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, callerPhone?: string) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const orderId: string | undefined = typeof args?.order_id === "string" ? args.order_id : undefined;
  if (!orderId) return { ok: false, error: "order_id required" };
  const toneHint: string = typeof args?.tone_hint === "string" ? args.tone_hint.trim() : "";

  const { data: order } = await supabase.from("orders")
    .select('id, name, phone, delivered, "DigiCom Business"').eq("id", orderId).maybeSingle();
  if (!order || order["DigiCom Business"] !== businessId) return { ok: false, error: "order not found for this business" };
  if (!order.delivered) return { ok: false, error: "order is not delivered yet — cannot request review" };
  if (callerPhone && !phoneMatches(order.phone, callerPhone)) return { ok: false, error: "forbidden: order is not for this caller" };

  const payload = { order_id: orderId, tone_hint: toneHint, recipient_name: order.name };
  const u = await upsertPendingActionSimple(supabase, businessId, threadId, toolUseId, "request_review_after_delivery", payload);
  if (!u.ok) return u;
  return { ok: true, result: {
    prepared: true, action_id: u.id,
    summary: { order_id: orderId, tone_hint: toneHint || "warm thanks" },
    next_step: "Compose a brief sentence acknowledging the request; owner approval will send the actual review-ask message.",
  } };
}

// Shared upsert helper (idempotent on tool_use_id) for the order CRUD trio
// + Phase 5-6 sandbox-required skills (bundle_offer, request_review_after_delivery).
// NOTE: distinct from upsertPendingAction() at the top of the file which has a
// richer signature used by document-generation skills (generate_devis, etc.).
async function upsertPendingActionSimple(
  supabase: any, businessId: string, threadId: string, toolUseId: string,
  kind: string, payload: Record<string, unknown>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "already applied" };
    const { error: upErr } = await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: kind, kind, payload, status: "pending",
      expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
    }).eq("id", existing.id);
    if (upErr) return { ok: false, error: `pending update: ${upErr.message}` };
    return { ok: true, id: existing.id };
  }
  const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
    business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
    skill_slug: kind, kind, payload, status: "pending",
  }).select("id").maybeSingle();
  if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
  return { ok: true, id: ins!.id };
}

function trimOrEmpty(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Per-business cutoff check shared by edit_order + cancel_order. Returns
// null if edits are still allowed, or a human-readable error string.
//   cutoff_hours_after_placed (number)   — block if order older than this
//   block_after_status_confirmed (bool)  — block once status category is confirmed/processed/paid
async function checkOrderEditCutoff(supabase: any, order: any, cfg: Record<string, any>): Promise<string | null> {
  const cutoffHours = Number(cfg.cutoff_hours_after_placed) || 0;
  if (cutoffHours > 0 && order?.date) {
    const placedAt = new Date(order.date as any).getTime();
    const ageHours = (Date.now() - placedAt) / 3_600_000;
    if (ageHours > cutoffHours) {
      return `order placed ${ageHours.toFixed(1)}h ago — past the ${cutoffHours}h edit window. Escalate to human.`;
    }
  }
  if (cfg.block_after_status_confirmed === true && order?.order_status_id) {
    const { data: stat } = await supabase
      .from("order_statuses").select("category").eq("id", order.order_status_id).maybeSingle();
    if (stat?.category && ["confirmed","processed","paid"].includes(stat.category)) {
      return `order status is '${stat.category}' — locked by business policy. Escalate.`;
    }
  }
  return null;
}

// Merge ai_skills.config_schema.fields[].default with the per-business
// saved config so handlers always receive a complete, ready-to-read object.
// Owner-saved value wins; otherwise the schema default kicks in.
function mergeConfigDefaults(fields: any[], saved: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...(saved || {}) };
  for (const f of fields || []) {
    if (out[f.key] === undefined && f.default !== undefined) {
      out[f.key] = f.default;
    }
  }
  return out;
}

// ─── 26. record_business_learning — sandbox-required ──────────────────
// Brain proposes a memory mid-conversation. Goes to ai_pending_actions
// pending. Owner approves in Review Queue → ai_apply_record_business_learning
// inserts the active memory row. ai-review-act then embeds it so the next
// conversations can vector-search it.
async function runRecordBusinessLearning(supabase: any, businessId: string, threadId: string, toolUseId: string, args: any, cfg: Record<string, any> = {}) {
  if (!toolUseId) return { ok: false, error: "tool_use_id required" };
  const memoryType: string = typeof args?.memory_type === "string" ? args.memory_type : "";
  const content: string    = typeof args?.content === "string"     ? args.content.trim() : "";
  const evidence: string   = typeof args?.evidence === "string"    ? args.evidence.trim() : "";
  const confidence: number = Number.isFinite(args?.confidence) ? Math.max(0, Math.min(1, args.confidence)) : 0.6;
  // Owner-tunable: if confidence >= threshold, the queued action will be
  // surfaced with `auto_approve: true` so the Review Queue UI can fast-path
  // it (or the dispatcher can promote it). Below threshold = standard sandbox.
  const autoApproveAt = Math.max(0.5, Math.min(Number(cfg.auto_approve_above_confidence) || 0.85, 1.0));
  const autoApprove = confidence >= autoApproveAt;

  const VALID_TYPES = new Set(["pattern","preference","warning","tactic","fact"]);
  if (!VALID_TYPES.has(memoryType)) return { ok: false, error: "memory_type must be pattern|preference|warning|tactic|fact" };
  if (content.length < 10)         return { ok: false, error: "content must be at least 10 chars" };
  if (content.length > 600)        return { ok: false, error: "content must be at most 600 chars" };

  const payload = { memory_type: memoryType, content, evidence: evidence || null, confidence, auto_approve: autoApprove };

  const { data: existing } = await supabase.from("ai_pending_actions")
    .select("id, status").eq("business_id", businessId).eq("tool_use_id", toolUseId).maybeSingle();
  let actionId: string;
  if (existing?.id) {
    if (existing.status === "applied") return { ok: false, error: "already applied" };
    await supabase.from("ai_pending_actions").update({
      thread_id: threadId, skill_slug: "record_business_learning", kind: "record_business_learning",
      payload, status: "pending", expires_at: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
    }).eq("id", existing.id);
    actionId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase.from("ai_pending_actions").insert({
      business_id: businessId, thread_id: threadId, tool_use_id: toolUseId,
      skill_slug: "record_business_learning", kind: "record_business_learning",
      payload, status: "pending",
    }).select("id").maybeSingle();
    if (insErr) return { ok: false, error: `pending insert: ${insErr.message}` };
    actionId = ins!.id;
  }
  return { ok: true, result: {
    prepared: true, action_id: actionId,
    summary: { memory_type: memoryType, content, confidence, auto_approve: autoApprove },
    next_step: autoApprove
      ? "High-confidence memory: marked for auto-approval (subject to business policy)."
      : "Continue the conversation normally. Owner will approve this memory in the Review Queue and it will become active for future conversations.",
  } };
}
