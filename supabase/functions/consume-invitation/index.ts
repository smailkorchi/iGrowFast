// @ts-nocheck
// Public (anon-key) self-registration. The invitee supplies their own identity
// (name, username, email, password, avatar); the role + authorization payload
// come from the admin-issued invitation. Atomic claim → create auth user →
// write profile → apply WhatsApp access → finalize, rolling back on any failure.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;
// Keys the invitee owns or that are not `users` columns — never copied from the payload blob.
const PAYLOAD_STRIP = new Set([
  "name", "username", "email", "password", "avatar_url", "avatar_config", "id", "role",
  "DigiCom Business", "whatsapp_access", "ga_access", "meta_access", "created_at", "updated_at",
]);

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string; ext: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const contentType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") ? "jpg"
    : contentType.includes("webp") ? "webp" : "png";
  return { bytes, contentType, ext };
}

function friendly(err: any): string {
  const hay = [err?.message, err?.code, err?.details, err?.hint, err?.error_description]
    .filter(Boolean).map(String).join(" | ").toLowerCase();
  if (/users_username/.test(hay)) return "That username is already taken in this business. Choose another.";
  if (/email|registered|duplicate key/.test(hay)) return "That email is already used by another account.";
  if (/weak.*password|password/.test(hay)) return "Password doesn't meet the requirements.";
  return (typeof err?.message === "string" && err.message.trim() && err.message.trim() !== "{}")
    ? err.message.trim() : "Registration failed. Review the fields and try again.";
}

// Mirror of manage-users' applyWhatsappAccess so invited commercials keep inbox scoping.
async function applyWhatsappAccess(supabase: any, userId: string, access: any) {
  if (!access || !access.mode) return;
  await supabase.from("whatsapp_user_instances").delete().eq("user_id", userId);
  if (access.mode === "none") return;
  const businessId = access.business_id;
  if (!businessId) return;
  if (access.mode === "all") {
    await supabase.from("whatsapp_user_instances").insert({
      user_id: userId, business_id: businessId, instance_id: null, scope: "all",
    });
    return;
  }
  if (access.mode === "specific") {
    const ids: string[] = Array.isArray(access.instance_ids) ? access.instance_ids : [];
    if (ids.length === 0) return;
    await supabase.from("whatsapp_user_instances").insert(
      ids.map((iid) => ({ user_id: userId, business_id: businessId, instance_id: iid, scope: "explicit" })),
    );
  }
}

// Per-mediabuyer Google Analytics property scoping (admin-assigned).
// access = { mode: 'none'|'all'|'specific', ids: string[] (ga_connection ids) }.
async function applyGaAccess(supabase: any, userId: string, businessId: string, access: any) {
  if (!access || !access.mode) return;
  await supabase.from("mediabuyer_ga_access").delete().eq("user_id", userId);
  if (access.mode === "none") return;
  if (access.mode === "all") {
    await supabase.from("mediabuyer_ga_access")
      .insert({ user_id: userId, business_id: businessId, ga_connection_id: null, scope: "all" });
    return;
  }
  if (access.mode === "specific") {
    const ids: string[] = Array.isArray(access.ids) ? access.ids.filter(Boolean) : [];
    if (ids.length === 0) return;
    // Only grant properties that actually belong to this business.
    const { data: valid } = await supabase.from("google_analytics_connections")
      .select("id").eq("DigiCom Business", businessId).in("id", ids);
    const allowed = (valid ?? []).map((r: any) => r.id);
    if (allowed.length === 0) return;
    await supabase.from("mediabuyer_ga_access").insert(
      allowed.map((id: string) => ({ user_id: userId, business_id: businessId, ga_connection_id: id, scope: "explicit" })));
  }
}

// Per-mediabuyer Meta ad-account scoping (admin-assigned).
// access = { mode: 'none'|'all'|'specific', ids: string[] (meta_ads_connection ids) }.
async function applyMetaAccess(supabase: any, userId: string, businessId: string, access: any) {
  if (!access || !access.mode) return;
  await supabase.from("mediabuyer_meta_access").delete().eq("user_id", userId);
  if (access.mode === "none") return;
  if (access.mode === "all") {
    await supabase.from("mediabuyer_meta_access")
      .insert({ user_id: userId, business_id: businessId, meta_connection_id: null, scope: "all" });
    return;
  }
  if (access.mode === "specific") {
    const ids: string[] = Array.isArray(access.ids) ? access.ids.filter(Boolean) : [];
    if (ids.length === 0) return;
    const { data: valid } = await supabase.from("meta_ads_connections")
      .select("id").eq("DigiCom Business", businessId).in("id", ids);
    const allowed = (valid ?? []).map((r: any) => r.id);
    if (allowed.length === 0) return;
    await supabase.from("mediabuyer_meta_access").insert(
      allowed.map((id: string) => ({ user_id: userId, business_id: businessId, meta_connection_id: id, scope: "explicit" })));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let inviteId: string | null = null;
  let createdUserId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    const name = String(body?.name ?? "").trim();
    const username = String(body?.username ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const otp = String(body?.otp ?? "").trim();
    // Invitee may send either a ready URL or a data URL (generated/uploaded avatar) to store server-side.
    const avatarDataUrl = typeof body?.avatar_data_url === "string" ? body.avatar_data_url : null;
    const avatarConfig = body?.avatar_config && typeof body.avatar_config === "object" ? body.avatar_config : null;
    let avatarUrl = body?.avatar_url ? String(body.avatar_url) : null;

    if (!TOKEN_RE.test(token)) return json({ ok: false, reason: "invalid_token" }, 400);
    if (name.length < 2) return json({ ok: false, reason: "invalid_name" }, 400);
    if (username.length < 3) return json({ ok: false, reason: "invalid_username" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, reason: "invalid_email" }, 400);
    if (password.length < 6) return json({ ok: false, reason: "weak_password" }, 400);
    if (!/^\d{6}$/.test(otp)) return json({ ok: false, reason: "otp_invalid" }, 400);

    const tokenHash = await sha256Hex(token);

    // 0) Verify the email-confirmation OTP BEFORE claiming the invite, so a wrong/
    //    expired code never burns a still-valid invitation. The OTP was issued by
    //    signup-email (action=send) and stored on the invitation row.
    const { data: inv, error: invErr } = await service.from("user_invitations")
      .select("id, signup_otp_hash, signup_otp_email, signup_otp_expires_at, signup_otp_attempts")
      .eq("token_hash", `\\x${tokenHash}`).is("consumed_at", null).is("revoked_at", null).maybeSingle();
    if (invErr) return json({ ok: false, reason: "error", detail: invErr.message }, 500);
    if (!inv) return json({ ok: false, reason: "invalid_or_used" }, 400);
    if (!inv.signup_otp_hash || !inv.signup_otp_expires_at) return json({ ok: false, reason: "otp_required" }, 400);
    if (new Date(inv.signup_otp_expires_at) < new Date()) return json({ ok: false, reason: "otp_expired" }, 400);
    if ((inv.signup_otp_attempts ?? 0) >= 5) return json({ ok: false, reason: "too_many_attempts" }, 429);
    if (String(inv.signup_otp_email ?? "").toLowerCase() !== email) return json({ ok: false, reason: "email_mismatch" }, 400);
    const otpHashHex = await sha256Hex(otp);
    if (otpHashHex !== String(inv.signup_otp_hash).replace(/^\\x/, "")) {
      await service.from("user_invitations")
        .update({ signup_otp_attempts: (inv.signup_otp_attempts ?? 0) + 1 }).eq("id", inv.id);
      return json({ ok: false, reason: "otp_invalid" }, 400);
    }
    await service.from("user_invitations")
      .update({ email_verified_at: new Date().toISOString() }).eq("id", inv.id);

    // 1) Atomic single-use claim.
    const { data: claim, error: claimErr } = await service.rpc("invitation_claim", {
      p_token_hash: `\\x${tokenHash}`,
    });
    if (claimErr) return json({ ok: false, reason: "error", detail: claimErr.message }, 500);
    if (!claim?.ok) return json({ ok: false, reason: claim?.reason ?? "invalid_or_used" }, 400);

    inviteId = claim.id;
    const targetRole = claim.target_role;
    const businessId = claim.business_id;
    const payload = (claim.profile_payload && typeof claim.profile_payload === "object")
      ? claim.profile_payload : {};

    // 2) Create the auth user (invitee-chosen credentials).
    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name, username, role: targetRole },
    });
    if (authError) {
      await service.rpc("invitation_rollback", { p_invite_id: inviteId });
      const dup = /registered|exist|duplicate/i.test(JSON.stringify(authError));
      return json({ ok: false, reason: dup ? "email_taken" : "create_failed", detail: friendly(authError) },
        dup ? 409 : 400);
    }
    createdUserId = authData.user.id;

    // 2b) Store the chosen avatar (generated or uploaded) via service role — the invitee is anon.
    if (avatarDataUrl) {
      try {
        const decoded = dataUrlToBytes(avatarDataUrl);
        if (decoded) {
          const path = `invites/${createdUserId}.${decoded.ext}`;
          const { error: upErr } = await service.storage.from("avatar")
            .upload(path, decoded.bytes, { contentType: decoded.contentType, upsert: true });
          if (!upErr) {
            avatarUrl = service.storage.from("avatar").getPublicUrl(path).data.publicUrl;
          }
        }
      } catch (avErr) {
        console.error("avatar upload (consume) failed:", avErr);
      }
    }

    // 3) Build the profile row: invitee identity + admin-set authorization payload.
    const cleanPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (!PAYLOAD_STRIP.has(k)) cleanPayload[k] = v;
    }
    const { error: profileError } = await service.from("users").insert([{
      id: createdUserId,
      email, name, username,
      role: targetRole,
      "DigiCom Business": businessId,
      avatar_url: avatarUrl,
      avatar_config: avatarConfig,
      ...cleanPayload,
    }]);
    if (profileError) {
      await service.auth.admin.deleteUser(createdUserId);
      await service.rpc("invitation_rollback", { p_invite_id: inviteId });
      return json({ ok: false, reason: "profile_failed", detail: friendly(profileError) }, 400);
    }

    // 4) WhatsApp instance scoping (commercials), business injected from the invite.
    try {
      const wa = payload?.whatsapp_access;
      if (wa && wa.mode && wa.mode !== "none") {
        await applyWhatsappAccess(service, createdUserId, { ...wa, business_id: businessId });
      }
    } catch (waErr) {
      console.error("applyWhatsappAccess (consume) failed:", waErr);
    }

    // 4b) Media-buyer GA / Meta visibility scoping (admin-assigned), business from the invite.
    try {
      if (payload?.ga_access) await applyGaAccess(service, createdUserId, businessId, payload.ga_access);
      if (payload?.meta_access) await applyMetaAccess(service, createdUserId, businessId, payload.meta_access);
    } catch (accErr) {
      console.error("applyGa/MetaAccess (consume) failed:", accErr);
    }

    // 5) Mark the invitation consumed.
    await service.rpc("invitation_finalize", { p_invite_id: inviteId, p_new_user: createdUserId });

    return json({ ok: true, target_role: targetRole }, 200);
  } catch (e) {
    if (createdUserId) { try { await service.auth.admin.deleteUser(createdUserId); } catch { /* ignore */ } }
    if (inviteId) { try { await service.rpc("invitation_rollback", { p_invite_id: inviteId }); } catch { /* ignore */ } }
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
