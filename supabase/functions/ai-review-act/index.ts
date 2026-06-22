// @ts-nocheck
import { runPendingSideEffects } from "../_shared/runPendingSideEffects.ts";
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ai-review-act — owner approve / reject / edit a sandboxed AI    ║
// ║  decision in the Review Queue.                                    ║
// ║                                                                    ║
// ║  Body: { decision_id, action, override_text? }                    ║
// ║    action: 'approve' | 'reject' | 'edit'                          ║
// ║    override_text: required when action='edit'                     ║
// ║                                                                    ║
// ║  Auth: caller's JWT must belong to admin/owner/super-admin of     ║
// ║  the decision's business.                                         ║
// ║                                                                    ║
// ║  Effects:                                                         ║
// ║   approve → send decision.tongue_output via evolution-client      ║
// ║   edit    → send override_text                                    ║
// ║   reject  → send fallback_text_when_paused (or nothing)           ║
// ║   then call ai_resolve_review() and bump skill approval counter   ║
// ║   for any sandbox-mode skills the decision used.                  ║
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json(405, { ok: false, error: "method not allowed" });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { ok: false, error: "missing auth" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad json" }); }
  const decisionId: string | undefined = body?.decision_id;
  const action: string | undefined = body?.action;
  const overrideText: string | undefined = typeof body?.override_text === "string" ? body.override_text.trim() : undefined;
  if (!decisionId) return json(200, { ok: false, error: "decision_id required" });
  if (action !== "approve" && action !== "reject" && action !== "edit") return json(200, { ok: false, error: "action must be approve|reject|edit" });
  if (action === "edit" && (!overrideText || overrideText.length < 1)) return json(200, { ok: false, error: "override_text required for edit" });

  // Auth (user JWT)
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userInfo } = await userClient.auth.getUser();
  const uid = userInfo?.user?.id;
  if (!uid) return json(401, { ok: false, error: "invalid jwt" });

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: profile } = await service.from("users").select("id, role, active, \"DigiCom Business\"").eq("id", uid).maybeSingle();
  if (!profile || profile.active === false) return json(403, { ok: false, error: "inactive user" });
  const isAdminOrOwner = profile.role === "admin" || profile.role === "owner" || profile.role === "super admin";
  if (!isAdminOrOwner) return json(403, { ok: false, error: "forbidden (admin/owner only)" });

  // Load decision + thread + instance + brain
  const { data: dec } = await service.from("ai_decisions").select("id, business_id, thread_id, tongue_output, redaction_map, tool_calls, sandbox").eq("id", decisionId).maybeSingle();
  if (!dec) return json(404, { ok: false, error: "decision not found" });
  if (profile.role !== "owner" && profile.role !== "super admin" && profile["DigiCom Business"] !== dec.business_id) {
    return json(403, { ok: false, error: "forbidden (cross-tenant)" });
  }
  if (!dec.sandbox) return json(200, { ok: false, error: "decision is not sandboxed (already sent or rejected)" });

  const { data: thread } = await service.from("wa_threads").select("id, business_id, instance_id, kind").eq("id", dec.thread_id).maybeSingle();
  if (!thread) return json(404, { ok: false, error: "thread not found" });
  const { data: instance } = await service.from("wa_instances").select("id, name, status").eq("id", thread.instance_id).maybeSingle();
  const { data: brain } = await service.from("ai_business_brain").select("fallback_text_when_paused").eq("business_id", dec.business_id).maybeSingle();
  // We need the original inbound message to know the wa_remote_jid for sending.
  const { data: inbound } = await service.from("wa_messages").select("wa_remote_jid").eq("id", (await service.from("ai_decisions").select("inbound_message_id").eq("id", decisionId).maybeSingle()).data?.inbound_message_id || "00000000-0000-0000-0000-000000000000").maybeSingle();

  // Determine the text to send.
  let textToSend: string | null = null;
  let outcomeAfter = "sent";
  if (action === "approve") {
    textToSend = dec.tongue_output ?? null;
  } else if (action === "edit") {
    textToSend = overrideText!;
  } else if (action === "reject") {
    textToSend = brain?.fallback_text_when_paused || null;
    outcomeAfter = "escalated";
  }

  let sentWaMsgId: string | null = null;
  let sendError: string | null = null;
  if (textToSend && instance?.status === "open" && inbound?.wa_remote_jid) {
    const number = inbound.wa_remote_jid.replace(/@s\.whatsapp\.net$/, "");
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evolution-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "send-text", payload: { instanceName: instance.name, number, text: textToSend, skipEcho: true } }),
      });
      const data = await r.json();
      sentWaMsgId = data?.key?.id || null;
      if (!r.ok || !sentWaMsgId) sendError = data?.error || `send-text ${r.status}`;
      else {
        // Echo into wa_messages
        await service.rpc("wa_dispatch_event", {
          p_evo_instance_name: instance.name,
          p_event_type: "send.message",
          p_payload: {
            key: { id: sentWaMsgId, remoteJid: inbound.wa_remote_jid, fromMe: true },
            message: { conversation: textToSend },
            messageType: "conversation",
            messageTimestamp: data?.messageTimestamp || Math.floor(Date.now() / 1000),
            status: data?.status || "PENDING",
            pushName: null,
          },
        });
      }
    } catch (e: any) {
      sendError = `evolution-client: ${e?.message || e}`;
    }
  }

  // Record review resolution. Decide outcome: if reject, escalated; if approve/edit and sent ok, sent; else failed.
  const finalOutcome = (action === "reject")
    ? "escalated"
    : (sentWaMsgId ? "sent" : "failed");
  await service.rpc("ai_resolve_review", {
    p_decision_id:    decisionId,
    p_action:         action,
    p_reviewer_id:    uid,
    p_override_text:  action === "edit" ? overrideText : null,
    p_outbound_wa_id: sentWaMsgId,
    p_outcome:        finalOutcome,
  });

  // On approve / edit: apply pending actions (e.g. create_order) and bump
  // skill approval counters for sandbox-mode skills used.
  let applyResults: any = null;
  let mediaSendResults: any[] = [];
  let catalogPickerResults: any[] = [];
  let bundleOfferResults: any[] = [];
  let reviewRequestResults: any[] = [];
  let deliveryNoteResults: any[] = [];
  if (action === "approve" || action === "edit") {
    // Run create_delivery_note actions BEFORE SQL apply: call provider-integration
    // create_parcel, INSERT company_parcels, write applied_ref_id back so the
    // SQL no-op marker just confirms 'applied'. Mirrors DeliveryNoteWizard
    // src/components/delivery/DeliveryNoteWizard.tsx (createParcelsMutation).
    {
      const { data: dnActions } = await service.from("ai_pending_actions")
        .select("id, payload")
        .eq("decision_id", decisionId)
        .eq("kind", "create_delivery_note")
        .eq("status", "pending");
      for (const dn of dnActions || []) {
        const payload = dn.payload || {};
        try {
          const parcelData = buildCarrierParcelData(payload);
          const cpRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/provider-integration`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ action: "create_parcel", provider_id: payload.provider_id, data: parcelData }),
          });
          const cpJson = await cpRes.json();
          if (!cpRes.ok || !cpJson?.success) {
            deliveryNoteResults.push({ action_id: dn.id, ok: false, error: cpJson?.error || `create_parcel ${cpRes.status}` });
            await service.from("ai_pending_actions").update({ status: "failed", applied_error: cpJson?.error || `create_parcel ${cpRes.status}` }).eq("id", dn.id);
            continue;
          }
          const carrierData = cpJson.data || {};
          const trackingCode = carrierData.tracking_code || carrierData.reference || carrierData.bar_code || null;
          const externalId   = carrierData.id ? String(carrierData.id) : (carrierData.external_id ? String(carrierData.external_id) : null);
          const statusLabel  = carrierData.status || carrierData.label || carrierData.statusLabel || "Nouveau";
          const statusColor  = carrierData.statusColor || carrierData.color || null;
          // Map raw status to internal package_statuses (best-effort).
          let mappedStatusId: string | null = null;
          let finalLabel = statusLabel;
          let finalColor = statusColor;
          try {
            const { data: matched } = await service.rpc("match_package_status", { p_status_value: statusLabel });
            if (matched && matched.length > 0) {
              mappedStatusId = matched[0].id;
              finalLabel = matched[0].label || statusLabel;
              finalColor = matched[0].color || statusColor;
            }
          } catch { /* fallback to raw */ }
          const { data: parcelRow, error: parcelErr } = await service
            .from("company_parcels")
            .insert({
              provider_id: payload.provider_id,
              order_id: payload.order_id,
              reference: trackingCode || "N/A",
              tracking_code: trackingCode,
              status_label: finalLabel,
              status_color: finalColor,
              external_id: externalId || "",
              provider_response: carrierData,
              status_id: mappedStatusId,
              "DigiCom Business": dec.business_id,
            })
            .select("id, tracking_code")
            .single();
          if (parcelErr) {
            deliveryNoteResults.push({ action_id: dn.id, ok: false, error: `parcel insert: ${parcelErr.message}`, tracking: trackingCode });
            await service.from("ai_pending_actions").update({ status: "failed", applied_error: `parcel insert: ${parcelErr.message}` }).eq("id", dn.id);
            continue;
          }
          // Persist tracking_number on orders for downstream tooling.
          await service.from("orders")
            .update({ tracking_number: trackingCode || null, processing: true, updated_at: new Date().toISOString() })
            .eq("id", payload.order_id);
          // Stamp the action so the SQL no-op marker can short-circuit.
          await service.from("ai_pending_actions").update({
            applied_ref_table: "company_parcels",
            applied_ref_id: parcelRow.id,
          }).eq("id", dn.id);
          deliveryNoteResults.push({
            action_id: dn.id, ok: true,
            order_id: payload.order_id,
            parcel_id: parcelRow.id,
            tracking_code: trackingCode,
            carrier: payload.provider_name,
          });
        } catch (e: any) {
          const err = e?.message || String(e);
          deliveryNoteResults.push({ action_id: dn.id, ok: false, error: err });
          await service.from("ai_pending_actions").update({ status: "failed", applied_error: err }).eq("id", dn.id);
        }
      }
    }
    // Run media / catalog_picker / bundle_offer / review_request side-effects
    // + the SQL dispatcher + memory-embed via the shared runner. Same code
    // path used by ai-router's auto-pilot (live-mode) flow — single source
    // of truth for "what happens to a decision after the text is sent".
    {
      const fx = await runPendingSideEffects({
        service,
        decisionId,
        businessId: dec.business_id,
        instance: instance ? { name: instance.name, status: instance.status } : null,
        inboundRemoteJid: inbound?.wa_remote_jid ?? null,
        sentWaMsgId: sentWaMsgId ?? null,
      });
      mediaSendResults     = fx.media_sends;
      catalogPickerResults = fx.catalog_pickers;
      bundleOfferResults   = fx.bundle_offers;
      reviewRequestResults = fx.review_requests;
      applyResults         = fx.applied_actions;
    }

    const slugs = Array.isArray(dec.tool_calls)
      ? Array.from(new Set(dec.tool_calls.map((c: any) => c?.skill_slug).filter(Boolean)))
      : [];
    for (const slug of slugs) {
      try {
        await service.rpc("ai_auto_promote_skill", { p_business_id: dec.business_id, p_skill_slug: slug });
      } catch { /* best effort */ }
    }
  } else if (action === "reject") {
    try { await service.rpc("ai_reject_pending_actions_for_decision", { p_decision_id: decisionId }); } catch {}
  }

  /* audit_logs feature removed — AI review outcome already persisted via ai_decisions */
  return json(200, {
    ok: !sendError && (action === "reject" || !!sentWaMsgId),
    outcome: finalOutcome,
    sent_wa_message_id: sentWaMsgId,
    applied_actions: applyResults,
    media_sends: mediaSendResults,
    catalog_pickers: catalogPickerResults,
    bundle_offers: bundleOfferResults,
    review_requests: reviewRequestResults,
    delivery_notes: deliveryNoteResults,
    error: sendError,
  });
});

// Build the per-provider parcel_data spread for provider-integration
// create_parcel. Mirrors src/components/delivery/DeliveryNoteWizard.tsx
// (createParcelsMutation, ~line 428) so the payload shape is byte-compatible
// across all 7 carriers. The owner-side code uses parcelPermissionFieldsFromProvider();
// here we pre-cached those flags on the action payload (provider_flags) so
// we can reproduce the same spread without re-querying providers.
function buildCarrierParcelData(payload: any): any {
  const flags    = payload?.provider_flags || {};
  const oldTrack = payload?.old_tracking || {};
  const isReplace = !!payload?.is_replace;
  const type     = String(payload?.provider_type || "").toLowerCase();

  // Per-provider permission fields (mirrors parcelPermissionFieldsFromProvider).
  const permFields: any = {};
  if (type.includes("coliaty")) {
    permFields.no_open = !!flags.coliaty_package_no_open;
  } else if (type.includes("ameex")) {
    permFields.fragile     = !!flags.ameex_parcel_fragile;
    permFields.open        = !!flags.ameex_parcel_open;
    permFields.try_on      = !!flags.ameex_parcel_try_on;
  } else if (type.includes("ozon")) {
    permFields.fragile     = !!flags.ozon_parcel_fragile;
    permFields.open        = !!flags.ozon_parcel_open;
  } else if (type.includes("quicklivraison")) {
    permFields.fragile     = !!flags.quicklivraison_parcel_fragile;
    permFields.open        = !!flags.quicklivraison_parcel_open;
    permFields.try_on      = !!flags.quicklivraison_parcel_try_on;
  } else if (type.includes("vitex")) {
    // Vitex reads fragile/open from provider row directly.
  } else if (type.includes("forcelog")) {
    permFields.fragile     = !!flags.forcelog_parcel_fragile;
    permFields.open        = !!flags.forcelog_parcel_open;
    permFields.carton      = !!flags.forcelog_parcel_carton;
  } else if (type.includes("sendit")) {
    permFields.try_on      = !!flags.sendit_allow_try;
  }

  // Per-provider exchange / replacement spread.
  let exchangeSpread: any = {};
  if (type.includes("coliaty")) {
    exchangeSpread = { replaceable: isReplace, old_tracking: isReplace ? (oldTrack.coliaty || "").trim() : "" };
  } else if (type.includes("ameex")) {
    exchangeSpread = { replaceable: isReplace, old_tracking: isReplace ? (oldTrack.ameex || "").trim() : "" };
  } else if (type.includes("quicklivraison")) {
    exchangeSpread = { replaceable: isReplace, old_tracking: isReplace ? (oldTrack.quicklivraison || "").trim() : "" };
  } else if (type.includes("vitex")) {
    exchangeSpread = { product_qty: payload?.parcel_data?.product_qty || 1 };
  } else if (type.includes("forcelog")) {
    exchangeSpread = {
      order_num: payload.order_id,
      district: "",
      replace_parcel_code: isReplace ? (oldTrack.forcelog || "").trim() : "",
    };
  } else if (type.includes("sendit")) {
    exchangeSpread = {
      order_num: payload.order_id,
      reference: String(payload.order_id).substring(0, 50),
      replace_parcel_code: isReplace ? (oldTrack.sendit || "").trim() : "",
    };
  } else {
    // Default fallback: only include replaceable when no perm fields set.
    if (Object.keys(permFields).length === 0) exchangeSpread = { replaceable: isReplace };
  }

  return { ...payload.parcel_data, ...permFields, ...exchangeSpread };
}
