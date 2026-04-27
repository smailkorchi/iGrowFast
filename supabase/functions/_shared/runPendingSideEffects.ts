// runPendingSideEffects — single source of truth for executing the
// non-SQL side-effects of a brain decision (catalog picker, product
// media, bundle offer, review-ask). Used by:
//   - ai-review-act  → when the owner approves a sandboxed decision
//   - ai-router      → when auto-pilot mode sends a decision live
//
// What it does, in order:
//   1. Runs evolution-client side-effects for 4 pending-action kinds
//      whose payloads are already prepared by ai-tool-runner:
//        send_product_media, send_catalog_picker,
//        bundle_offer, request_review_after_delivery
//   2. Calls the SQL dispatcher `ai_apply_pending_actions_for_decision`
//      which marks each pending row applied (and runs any DB-side apply
//      function — create_order, edit_order, etc.).
//   3. Backfills embeddings for newly-created business_memory rows so
//      they become vector-searchable on the next conversation.
//
// Returns a results bundle the caller can log to audit_logs / return
// to the client.
//
// NOT included here: create_delivery_note. That one has carrier-specific
// payload shaping (buildCarrierParcelData) that lives in ai-review-act and
// is sandbox-only by policy. If we ever auto-pilot deliveries, lift it.
//
// Deno-bundleable; no external imports beyond fetch + the supabase client
// passed in. Both functions run with service-role.

export type SideEffectResults = {
  applied_actions: any;
  media_sends: any[];
  catalog_pickers: any[];
  bundle_offers: any[];
  review_requests: any[];
};

export async function runPendingSideEffects(args: {
  service: any;                 // service-role supabase client
  decisionId: string;           // ai_decisions.id
  businessId: string;
  instance: { name: string; status: string } | null;
  inboundRemoteJid: string | null;
  sentWaMsgId: string | null;   // the just-sent outbound wa_id (if any)
}): Promise<SideEffectResults> {
  const { service, decisionId, businessId, instance, inboundRemoteJid, sentWaMsgId } = args;

  const out: SideEffectResults = {
    applied_actions: null,
    media_sends: [],
    catalog_pickers: [],
    bundle_offers: [],
    review_requests: [],
  };

  const canSend = !!sentWaMsgId && instance?.status === "open" && !!inboundRemoteJid;
  const number = inboundRemoteJid ? inboundRemoteJid.replace(/@s\.whatsapp\.net$/, "") : "";

  // ── 1. send_product_media ──────────────────────────────────────────
  if (canSend) {
    const { data: mediaActions } = await service.from("ai_pending_actions")
      .select("id, kind, payload")
      .eq("decision_id", decisionId)
      .eq("kind", "send_product_media")
      .eq("status", "pending");
    for (const ma of mediaActions || []) {
      const products = (ma.payload?.products || []) as any[];
      for (const p of products) {
        if (!p?.image_url) continue;
        try {
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-client`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({
              action: "send-media",
              payload: {
                instanceName: instance!.name,
                number,
                mediatype: "image",
                caption: ma.payload?.caption || `${p.name}${p.price ? ` — ${p.price} dh` : ""}`,
                media: p.image_url,
                fileName: `${p.name}.jpg`,
              },
            }),
          });
          const d = await r.json();
          out.media_sends.push({ product: p.name, ok: r.ok && !!d?.key?.id, error: r.ok ? null : (d?.error || `${r.status}`) });
        } catch (e: any) {
          out.media_sends.push({ product: p.name, ok: false, error: e?.message || String(e) });
        }
      }
    }
  }

  // ── 2. send_catalog_picker ─────────────────────────────────────────
  if (canSend) {
    const { data: pickerActions } = await service.from("ai_pending_actions")
      .select("id, payload")
      .eq("decision_id", decisionId)
      .eq("kind", "send_catalog_picker")
      .eq("status", "pending");
    for (const pa of pickerActions || []) {
      const payload = pa.payload || {};
      const products = (payload.products || []) as any[];
      if (products.length === 0) continue;
      try {
        const sections = [{
          title: payload.title || "Options",
          rows: products.map((p: any) => ({
            title:       (p.name || "").slice(0, 24),
            description: p.price ? `${p.price} dh${p.stock != null ? ` · stock ${p.stock}` : ""}` : "",
            rowId:       `product:${p.id}`,
          })),
        }];
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-client`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            action: "send-list",
            payload: {
              instanceName: instance!.name,
              number,
              title:       payload.title       || "Options",
              description: payload.description || "Choose one",
              buttonText:  payload.button_text || "Open list",
              footerText:  payload.footer_text || undefined,
              sections,
            },
          }),
        });
        const d = await r.json();
        out.catalog_pickers.push({ count: products.length, ok: r.ok && !!d?.key?.id, error: r.ok ? null : (d?.error || `${r.status}`) });
      } catch (e: any) {
        out.catalog_pickers.push({ count: products.length, ok: false, error: e?.message || String(e) });
      }
    }
  }

  // ── 3. bundle_offer ───────────────────────────────────────────────
  if (canSend) {
    const { data: bundleActions } = await service.from("ai_pending_actions")
      .select("id, payload")
      .eq("decision_id", decisionId)
      .eq("kind", "bundle_offer")
      .eq("status", "pending");
    for (const ba of bundleActions || []) {
      const p = ba.payload || {};
      const products = (p.products || []) as any[];
      if (products.length === 0) continue;
      const lines = products.map((it: any, i: number) => `  ${i + 1}. ${it.name} — ${it.price} dh`).join("\n");
      const txt = [
        `🎁 *${p.title}*`,
        p.description,
        ``,
        lines,
        ``,
        `Total séparé : *${p.retail_sum} dh*`,
        `Prix bundle : *${p.bundle_price} dh*`,
        `Tu économises : *${p.savings} dh* ✅`,
      ].join("\n");
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-client`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ action: "send-text", payload: { instanceName: instance!.name, number, text: txt } }),
        });
        const d = await r.json();
        out.bundle_offers.push({ count: products.length, ok: r.ok && !!d?.key?.id, error: r.ok ? null : (d?.error || `${r.status}`) });
      } catch (e: any) {
        out.bundle_offers.push({ count: products.length, ok: false, error: e?.message || String(e) });
      }
    }
  }

  // ── 4. request_review_after_delivery ──────────────────────────────
  if (canSend) {
    const { data: revActions } = await service.from("ai_pending_actions")
      .select("id, payload")
      .eq("decision_id", decisionId)
      .eq("kind", "request_review_after_delivery")
      .eq("status", "pending");
    for (const ra of revActions || []) {
      const p = ra.payload || {};
      const name = p.recipient_name ? String(p.recipient_name).split(" ")[0] : "";
      const txt = [
        `salam${name ? ` ${name}` : ""} 👋`,
        `kif s7yt mn la commande dyalek? 🙏`,
        `ila kont contente, 3afak 3tina avis (5 étoiles 🌟) bach n9adro nkmlo nkhdmo mzyan.`,
        `ila kant chi mochkila — golina nzido n7lha m3ak.`,
      ].join("\n");
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-client`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ action: "send-text", payload: { instanceName: instance!.name, number, text: txt } }),
        });
        const d = await r.json();
        out.review_requests.push({ order_id: p.order_id, ok: r.ok && !!d?.key?.id, error: r.ok ? null : (d?.error || `${r.status}`) });
      } catch (e: any) {
        out.review_requests.push({ order_id: p.order_id, ok: false, error: e?.message || String(e) });
      }
    }
  }

  // ── 5. SQL dispatcher: marks each pending applied + runs DB-side apply
  try {
    const r = await service.rpc("ai_apply_pending_actions_for_decision", { p_decision_id: decisionId });
    out.applied_actions = r.data;
  } catch (e: any) {
    out.applied_actions = [{ error: e?.message || "apply failed" }];
  }

  // ── 6. Embed newly-created business_memory rows so RAG can find them
  try {
    const memoryActionIds: string[] = (Array.isArray(out.applied_actions) ? out.applied_actions : [])
      .filter((r: any) => r?.kind === "record_business_learning" && r?.ok && r?.ref_id)
      .map((r: any) => r.ref_id as string);
    if (memoryActionIds.length > 0) {
      const { data: memRows } = await service.from("ai_business_memory")
        .select("id, content, business_id")
        .in("id", memoryActionIds);
      for (const mr of memRows || []) {
        try {
          const er = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ texts: [mr.content], business_id: mr.business_id }),
          });
          const ej = await er.json();
          if (ej?.ok && Array.isArray(ej.embeddings?.[0])) {
            const literal = `[${ej.embeddings[0].join(",")}]`;
            await service.from("ai_business_memory").update({ embedding: literal }).eq("id", mr.id);
          }
        } catch { /* memory still usable without embedding */ }
      }
    }
  } catch { /* non-fatal */ }

  return out;
}
