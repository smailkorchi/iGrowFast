// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// Roles allowed to administer accounts. Source of truth = the DB row for the
// caller's auth.uid(), never JWT metadata (user_metadata is user-editable).
// 'owner' is included because the owner console (owner/Users.tsx,
// owner/Businesses.tsx) provisions owner accounts and a new business's first
// super-admin through this function. The owner's own "DigiCom Business" is
// NULL (unscoped), so the create-time tenant-force below no-ops for it and the
// owner supplies the target business explicitly; super-admin/admin callers are
// pinned to their own business.
const ADMIN_ROLES = ["super admin", "business owner", "admin", "owner"];

// Business owner is protected: only the platform owner, or a business owner
// acting within their OWN business, may create, edit, delete, or suspend a
// business-owner account. The DB trigger can't see the real caller through
// these service-role writes, so this function enforces it.
const BIZ_OWNER_PROTECTED_MSG = "Le propriétaire de l'entreprise ne peut être géré que par un propriétaire ou la plateforme.";
const LAST_BIZ_OWNER_MSG = "Impossible de retirer le dernier propriétaire de l'entreprise.";

// Central tenant guard for every target-bearing action (update, delete,
// archive, set_password): a non-owner caller and the target must both have a
// business set, and it must be the SAME business. Previously only business-owner
// targets got a tenant check — an admin of business X could otherwise manage
// an ordinary user of business Y by UUID.
function requireSameTenant(me: any, target: any): Response | null {
  if (me.role === "owner") return null;
  const meBiz = me["DigiCom Business"];
  const targetBiz = target?.["DigiCom Business"];
  if (!meBiz || !targetBiz || meBiz !== targetBiz) {
    return json({ error: "Accès refusé — utilisateur d'une autre entreprise." }, 403);
  }
  return null;
}

// Map raw Postgres / GoTrue errors to messages a human can act on.
// supabase-js AuthApiError can surface an opaque body whose .message is "{}"
// with no usable .code, so regex-parsing alone is unreliable — the caller passes
// a `context` so we can give an actionable message even when the error is opaque.
function friendlyError(err: any, context?: "email" | "password" | "create"): Error {
  let serialized = "";
  try { serialized = JSON.stringify(err); } catch { /* ignore */ }

  // Safe shape log (no PII values) to aid ops debugging.
  try {
    console.error("manage-users error shape:", JSON.stringify({
      context,
      status: err?.status ?? err?.statusCode,
      code: err?.code,
      name: err?.name,
      msgType: typeof err?.message,
      msgLen: typeof err?.message === "string" ? err.message.length : null,
      keys: err && typeof err === "object" ? Object.keys(err) : null,
    }));
  } catch { /* ignore */ }

  const hay = [
    err?.message, err?.code, err?.error_description, err?.msg,
    err?.details, err?.hint, err?.name, serialized,
  ].filter((p) => p !== undefined && p !== null && p !== "")
   .map(String).join(" | ").toLowerCase();

  if (/users_username/.test(hay)) {
    return new Error("That username is already taken in this business. Choose a different one.");
  }
  if (/users_email_key|email_exists|already.*registered|registered.*another|email.*already.*(use|exist)|duplicate.*email/.test(hay)) {
    return new Error("That email is already used by another account on the platform. Emails are unique platform-wide.");
  }
  if (/email_address_invalid|invalid.*email|email.*invalid|invalid format/.test(hay)) {
    return new Error("That email address is not valid.");
  }
  if (/weak.*password|password.*at least|password should be|password.*short|password.*requirement/.test(hay)) {
    return new Error("Password doesn't meet the requirements: at least 6 characters, including an uppercase letter, a lowercase letter, and a number.");
  }
  if (/duplicate key/.test(hay)) {
    return new Error("A unique field (email or username) is already in use.");
  }

  // Context-aware fallback when the provider returns an opaque error.
  if (context === "email" || context === "create") {
    return new Error("That email can't be used — it's already registered to another account or is not a valid address.");
  }
  if (context === "password") {
    return new Error("Password doesn't meet the requirements: at least 6 characters, including an uppercase letter, a lowercase letter, and a number.");
  }
  const raw = (typeof err?.message === "string" && err.message.trim() && err.message.trim() !== "{}")
    ? err.message.trim() : "";
  return new Error(raw || "Operation failed. Please review the fields and try again.");
}

// ── WhatsApp instance assignment helper ────────────────────────────────────
// access shape: { mode: 'none'|'all'|'specific', instance_ids?: string[], business_id?: string }
async function applyWhatsappAccess(supabase: any, userId: string, access: any) {
  if (!access || !access.mode) return;
  // Wipe existing assignments first — this function is the source of truth
  await supabase.from("whatsapp_user_instances").delete().eq("user_id", userId);

  if (access.mode === "none") return;

  const businessId = access.business_id;
  if (!businessId) {
    throw new Error("whatsapp_access.business_id is required when mode is not 'none'");
  }

  if (access.mode === "all") {
    await supabase.from("whatsapp_user_instances").insert({
      user_id: userId,
      business_id: businessId,
      instance_id: null,
      scope: "all",
    });
    return;
  }

  if (access.mode === "specific") {
    const ids: string[] = Array.isArray(access.instance_ids) ? access.instance_ids : [];
    if (ids.length === 0) return;
    const rows = ids.map((iid) => ({
      user_id: userId,
      business_id: businessId,
      instance_id: iid,
      scope: "explicit",
    }));
    const { error } = await supabase.from("whatsapp_user_instances").insert(rows);
    if (error) throw error;
  }
}

// ── Mediabuyer Google Analytics property scoping ────────────────────
// access shape: { mode: 'none'|'all'|'specific', ids?: string[], business_id?: string }
async function applyGaAccess(supabase: any, userId: string, access: any) {
  if (!access || !access.mode) return;
  await supabase.from("mediabuyer_ga_access").delete().eq("user_id", userId);
  if (access.mode === "none") return;
  const businessId = access.business_id;
  if (!businessId) return;
  if (access.mode === "all") {
    await supabase.from("mediabuyer_ga_access")
      .insert({ user_id: userId, business_id: businessId, ga_connection_id: null, scope: "all" });
    return;
  }
  if (access.mode === "specific") {
    const ids: string[] = Array.isArray(access.ids) ? access.ids.filter(Boolean) : [];
    if (ids.length === 0) return;
    const { data: valid } = await supabase.from("google_analytics_connections")
      .select("id").eq("DigiCom Business", businessId).in("id", ids);
    const allowed = (valid ?? []).map((r: any) => r.id);
    if (allowed.length === 0) return;
    await supabase.from("mediabuyer_ga_access").insert(
      allowed.map((id: string) => ({ user_id: userId, business_id: businessId, ga_connection_id: id, scope: "explicit" })));
  }
}

// ── Mediabuyer Meta ad-account scoping ──────────────────────────────
async function applyMetaAccess(supabase: any, userId: string, access: any) {
  if (!access || !access.mode) return;
  await supabase.from("mediabuyer_meta_access").delete().eq("user_id", userId);
  if (access.mode === "none") return;
  const businessId = access.business_id;
  if (!businessId) return;
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // ── Caller authorization (complete mediation) ─────────────────────────
    // The router now requires a valid JWT to reach this function, but any
    // authenticated user of any role would pass that gate. Because this
    // function runs on the service_role key (above RLS/column policies), it
    // must authorize the caller itself: resolve the bearer to a user, then
    // require an admin role from the DB (not from JWT metadata).
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const caller = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } },
    );
    // getUser(jwt) — explicit token. The no-arg form needs a client session, which
    // this stateless service client never has, so it 401'd every call.
    const { data: { user: callerUser }, error: callerErr } = await caller.auth.getUser(jwt);
    if (callerErr || !callerUser) return json({ error: "unauthorized" }, 401);
    const { data: me } = await supabaseClient
      .from("users")
      .select('role, "DigiCom Business", backup_root, active, archived_at')
      .eq("id", callerUser.id)
      .maybeSingle();
    if (!me || !ADMIN_ROLES.includes(me.role)) return json({ error: "forbidden" }, 403);
    // Liveness gate: an archived/suspended admin's still-valid JWT must be
    // useless here — the DB row is the source of truth, re-checked every call.
    if (me.active !== true || me.archived_at) return json({ error: "Compte désactivé." }, 403);

    const body = await req.json();
    const { action, userData, userId } = body;

    // userId feeds PostgREST filters below — validate the shape up front so
    // filter injection is structurally impossible, not merely unprofitable.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const cand of [userId, body.user_id]) {
      if (cand !== undefined && !UUID_RE.test(String(cand))) {
        return json({ error: "userId invalide." }, 400);
      }
    }

    if (action === "create") {
      // backup_admin is grantable ONLY by the backup_root account; backup_root is
      // never settable through the app. Destructuring strips both from `rest` so
      // they can't ride in via the service-role writes below.
      const { email, password, name, username, role, whatsapp_access, ga_access, meta_access, backup_admin, backup_root: _backupRootIgnored, ...rest } = userData;
      // A BO caller creating a "business owner" is structurally same-business
      // already (the tenant-force below pins `rest["DigiCom Business"]` to
      // me["DigiCom Business"]); only super admin / admin callers are blocked.
      if (role === "business owner" && me.role !== "owner" && me.role !== "business owner") {
        return json({ error: BIZ_OWNER_PROTECTED_MSG }, 403);
      }
      // The PLATFORM 'owner' role can never be minted through this API by a
      // non-owner caller — a BO promoting a peer to platform owner would be a
      // full privilege escalation (mirrors the DB trigger's boundary guard).
      if (role === "owner" && me.role !== "owner") {
        return json({ error: "Seule la plateforme peut gérer le rôle propriétaire de la plateforme." }, 403);
      }
      if (me.backup_root === true && typeof backup_admin === "boolean") {
        rest.backup_admin = backup_admin;
      }
      // Tenant scoping: a created account always belongs to the caller's own
      // business, regardless of any "DigiCom Business" the client supplied.
      // (Owner rows are the exception — enforce_owner_unscoped() nulls it.)
      if (me["DigiCom Business"]) rest["DigiCom Business"] = me["DigiCom Business"];

      const { data: authData, error: authError } = await supabaseClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, username, role },
      });

      if (authError) throw friendlyError(authError, "create");

      const { data: profileData, error: profileError } = await supabaseClient
        .from("users")
        .insert([{
          id: authData.user.id,
          email,
          name,
          username,
          role,
          ...rest,
        }])
        .select()
        .single();

      if (profileError) {
        // Compensate: roll back the auth user so we don't leave an orphan that
        // blocks future creates with the same email.
        const { error: delErr } = await supabaseClient.auth.admin.deleteUser(authData.user.id);
        if (delErr) {
          console.error("create rollback failed — orphan auth user:", authData.user.id, delErr);
        }
        throw friendlyError(profileError);
      }

      // Apply WhatsApp instance assignments (sellers only — caller decides)
      try {
        await applyWhatsappAccess(supabaseClient, authData.user.id, whatsapp_access);
      } catch (waErr) {
        console.error("applyWhatsappAccess (create) failed:", waErr);
      }
      try {
        await applyGaAccess(supabaseClient, authData.user.id, ga_access);
        await applyMetaAccess(supabaseClient, authData.user.id, meta_access);
      } catch (accErr) {
        console.error("applyGa/MetaAccess (create) failed:", accErr);
      }

      return new Response(JSON.stringify(profileData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "update") {
      // Same rule as create: only the backup_root caller may set backup_admin;
      // backup_root itself is never accepted from the client.
      const { email, password, whatsapp_access, ga_access, meta_access, backup_admin, backup_root: _backupRootIgnored, ...rest } = userData;
      // System-managed columns: archived_at is written only by archive_user_checked
      // / hard_delete_user_checked; active is owned by account-status-change. Strip
      // both from the update payload for every caller, including the owner.
      delete rest.archived_at;
      delete rest.active;
      // Business moves are PLATFORM-OWNER-ONLY. Without this strip, a BO could
      // relocate himself (or a peer) into another business through this
      // service-role write — the DB trigger cannot see the real caller here
      // (auth.uid() is NULL), so the edge is the enforcer for tenant moves.
      if (me.role !== "owner") {
        delete rest["DigiCom Business"];
      }
      if (me.backup_root === true && typeof backup_admin === "boolean") {
        rest.backup_admin = backup_admin;
      }

      // Archived-user guard: fetch the target once (role/business for the
      // ownership checks below, archived_at for the stale-flow refusal) and
      // reuse it — an archived target may never be edited, by any caller.
      const { data: targetUser } = await supabaseClient
        .from("users").select('role, "DigiCom Business", archived_at').eq("id", userId).maybeSingle();
      const tenantErr = requireSameTenant(me, targetUser);
      if (tenantErr) return tenantErr;
      if (targetUser?.archived_at) {
        return json({ error: "Utilisateur archivé — aucune modification possible." }, 403);
      }

      if (me.role !== "owner") {
        // Platform-owner boundary: no non-owner caller may set (or strip) the
        // platform 'owner' role — mirrors the DB trigger's boundary guard.
        if (rest.role === "owner") {
          return json({ error: "Seule la plateforme peut gérer le rôle propriétaire de la plateforme." }, 403);
        }
        if (targetUser?.role === "owner") {
          return json({ error: "Seule la plateforme peut gérer le rôle propriétaire de la plateforme." }, 403);
        }
        const sameBiz = me.role === "business owner" &&
          targetUser?.["DigiCom Business"] === me["DigiCom Business"];
        if ((targetUser?.role === "business owner" || rest.role === "business owner") && !sameBiz) {
          return json({ error: BIZ_OWNER_PROTECTED_MSG }, 403);
        }
        // Last-BO rule: a business must never lose its last business owner.
        // Platform-owner callers bypass this (handled by the `me.role !== "owner"` guard above).
        if (targetUser?.role === "business owner" && rest.role && rest.role !== "business owner") {
          const { count } = await supabaseClient
            .from("users")
            .select("id", { count: "exact", head: true })
            .eq("role", "business owner")
            .eq("DigiCom Business", targetUser["DigiCom Business"])
            .eq("active", true)
            .is("archived_at", null)
            .neq("id", userId);
          if (!count) {
            return json({ error: LAST_BIZ_OWNER_MSG }, 403);
          }
        }
      }

      // Read the current auth login email so we only touch GoTrue when something
      // actually changed. Forwarding an unchanged email made GoTrue treat every
      // edit (even password-only) as an email change and reject it with 422.
      let currentAuthEmail: string | null = null;
      {
        const { data: cur, error: curErr } = await supabaseClient.auth.admin.getUserById(userId);
        if (curErr) throw friendlyError(curErr);
        currentAuthEmail = cur?.user?.email ?? null;
      }

      const submittedEmail = typeof email === "string" ? email.trim() : "";
      const emailChanged = submittedEmail.length > 0 &&
        submittedEmail.toLowerCase() !== (currentAuthEmail ?? "").toLowerCase();

      const authUpdates: Record<string, unknown> = {};
      if (emailChanged) {
        authUpdates.email = submittedEmail;
        authUpdates.email_confirm = true; // admin-initiated change, no confirmation round-trip
      }
      if (password) authUpdates.password = password;

      if (Object.keys(authUpdates).length > 0) {
        const { error: authError } = await supabaseClient.auth.admin.updateUserById(
          userId,
          authUpdates,
        );
        if (authError) throw friendlyError(authError, emailChanged ? "email" : "password");
      }

      // auth.users is the source of truth for the login email; the profile email
      // always mirrors it. This both prevents and self-heals drift on every edit.
      const canonicalEmail = emailChanged ? submittedEmail : currentAuthEmail;
      const profilePatch: Record<string, unknown> = { ...rest };
      if (canonicalEmail) profilePatch.email = canonicalEmail;

      const { data: profileData, error: profileError } = await supabaseClient
        .from("users")
        .update(profilePatch)
        .eq("id", userId)
        .is("archived_at", null)
        .select()
        .single();

      if (profileError) {
        // 0-row update (race with a concurrent archive between our read above
        // and this write) makes .single() report "no rows" — surface that as
        // the same archived refusal instead of a generic error.
        if (profileError.code === "PGRST116") {
          return json({ error: "Utilisateur archivé — aucune modification possible." }, 409);
        }
        throw friendlyError(profileError);
      }

      try {
        await applyWhatsappAccess(supabaseClient, userId, whatsapp_access);
      } catch (waErr) {
        console.error("applyWhatsappAccess (update) failed:", waErr);
      }
      try {
        await applyGaAccess(supabaseClient, userId, ga_access);
        await applyMetaAccess(supabaseClient, userId, meta_access);
      } catch (accErr) {
        console.error("applyGa/MetaAccess (update) failed:", accErr);
      }

      return new Response(JSON.stringify(profileData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "delete") {
      // Capture identity BEFORE deletion so the notice can be emailed afterwards.
      const { data: doomed } = await supabaseClient
        .from("users").select('name, email, role, "DigiCom Business"').eq("id", userId).maybeSingle();
      if (!doomed) return json({ error: "Utilisateur introuvable." }, 404);

      const tenantErr = requireSameTenant(me, doomed);
      if (tenantErr) return tenantErr;

      // Platform-owner boundary: service-role writes bypass the DB trigger, so
      // the edge must refuse — only the platform deletes a platform owner.
      if (doomed.role === "owner" && me.role !== "owner") {
        return json({ error: "Seule la plateforme peut gérer le rôle propriétaire de la plateforme." }, 403);
      }

      if (doomed?.role === "business owner") {
        const sameBiz = me.role === "business owner" &&
          doomed["DigiCom Business"] === me["DigiCom Business"];
        if (me.role !== "owner" && !sameBiz) {
          return json({ error: BIZ_OWNER_PROTECTED_MSG }, 403);
        }
        // Last-BO rule: a business must never lose its last business owner.
        // Platform-owner callers bypass this (they may orphan deliberately).
        if (me.role !== "owner") {
          const { count } = await supabaseClient
            .from("users")
            .select("id", { count: "exact", head: true })
            .eq("role", "business owner")
            .eq("DigiCom Business", doomed["DigiCom Business"])
            .eq("active", true)
            .is("archived_at", null)
            .neq("id", userId);
          if (!count) {
            return json({ error: LAST_BIZ_OWNER_MSG }, 403);
          }
        }
      }

      // (a) Soft-delete auth FIRST: kills login/sessions immediately and is
      // reversible. If it fails, abort — nothing else has happened yet.
      const { error: softAuthError } = await supabaseClient.auth.admin.deleteUser(userId, true);
      if (softAuthError) {
        console.error("delete: soft auth delete failed", userId, softAuthError);
        return json({ error: "Suppression échouée — réessayez." }, 500);
      }

      // (b) Atomic eligibility check + profile delete inside the DB: the RPC
      // locks the user row, recounts references, and deletes in the same
      // transaction — no TOCTOU window for a fresh reference to slip in. On
      // failure here the soft-deleted auth row is the only residue —
      // login-dead but recoverable (the profile row still exists).
      const { error: rpcError } = await supabaseClient
        .rpc("hard_delete_user_checked", { p_user_id: userId });
      if (rpcError) {
        const msg = String(rpcError.message || "");
        if (/historique d'activité/.test(msg)) {
          return json({ error: msg }, 403);
        }
        if (/introuvable/.test(msg)) {
          return json({ error: msg }, 404);
        }
        console.error("delete: hard_delete_user_checked failed", userId, rpcError);
        return json({ error: msg || "Suppression échouée." }, 500);
      }

      // (c) Hard-delete the auth row. Failure here is harmless residue (the
      // account is already soft-deleted — login-dead) — document and succeed.
      const { error: authError } = await supabaseClient.auth.admin.deleteUser(userId);
      if (authError) {
        console.error("delete: hard auth cleanup failed after profile delete succeeded — auth residue", userId, authError);
      }

      // Best-effort "Compte supprimé" email — never affects the deletion result.
      try {
        if (doomed?.email) {
          const ROLE_FR: Record<string, string> = {
            "super admin": "Super administrateur", "business owner": "Propriétaire d'entreprise", "admin": "Administrateur", "commercial": "Commercial",
            "courier": "Livreur", "mediabuyer": "Media buyer", "owner": "Propriétaire",
          };
          let businessName = "votre entreprise";
          if (doomed["DigiCom Business"]) {
            const { data: biz } = await supabaseClient.from("businesses").select("name").eq("id", doomed["DigiCom Business"]).maybeSingle();
            if (biz?.name) businessName = biz.name;
          }
          const nowFr = (() => {
            try { return new Date().toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }); }
            catch { return new Date().toISOString(); }
          })();
          const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
            body: JSON.stringify({
              key: "account_deleted", to: doomed.email,
              vars: {
                user_name: doomed.name || "",
                role_label: ROLE_FR[doomed.role] || String(doomed.role || ""),
                business_name: businessName,
                deleted_at: nowFr,
              },
            }),
          });
        }
      } catch (e) {
        console.error("account_deleted email failed:", e);
      }

      return new Response(JSON.stringify({ success: true, ...(authError ? { auth_residual: true } : {}) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "archive") {
      const { data: target } = await supabaseClient
        .from("users").select('role, "DigiCom Business"').eq("id", userId).maybeSingle();
      if (!target) return json({ error: "Utilisateur introuvable." }, 404);

      const tenantErr = requireSameTenant(me, target);
      if (tenantErr) return tenantErr;

      // Platform-owner boundary: only the platform can archive a platform owner.
      if (target.role === "owner" && me.role !== "owner") {
        return json({ error: "Seule la plateforme peut gérer le rôle propriétaire de la plateforme." }, 403);
      }

      if (target.role === "business owner") {
        const sameBiz = me.role === "business owner" &&
          target["DigiCom Business"] === me["DigiCom Business"];
        if (me.role !== "owner" && !sameBiz) {
          return json({ error: BIZ_OWNER_PROTECTED_MSG }, 403);
        }
      }

      // Atomic archive: locks the business row and recounts active,
      // non-archived business owners INSIDE the same transaction (no TOCTOU
      // window for a concurrent archive of the last two owners), then flips
      // the row. Also rejects an already-archived target.
      const { error: rpcError } = await supabaseClient
        .rpc("archive_user_checked", { p_user_id: userId, p_enforce_last_bo: me.role !== "owner" });
      if (rpcError) {
        const msg = String(rpcError.message || "");
        if (/déjà archivé/.test(msg)) return json({ error: msg }, 409);
        if (/dernier propriétaire/.test(msg)) return json({ error: LAST_BIZ_OWNER_MSG }, 403);
        if (/introuvable/.test(msg)) return json({ error: msg }, 404);
        console.error("archive: archive_user_checked failed", userId, rpcError);
        return json({ error: msg || "Archivage échoué." }, 500);
      }

      // Soft delete (second arg true): kills sessions + blocks login, keeps the
      // auth row and reserves the email. If it fails after the public archive
      // already succeeded, no revert is needed — active=false already blocks
      // the app via the existing suspension handling, so it's fail-safe.
      const { error: authError } = await supabaseClient.auth.admin.deleteUser(userId, true);
      if (authError) {
        console.error("archive: soft auth delete failed after public archive succeeded", userId, authError);
        return json({ success: true, auth_soft_delete: false });
      }

      return json({ success: true });
    }

    if (action === "set_password") {
      const { user_id, new_password } = body;
      if (typeof new_password !== "string" || new_password.length < 8) {
        return json({ error: "Mot de passe trop court (8 caractères minimum)." }, 400);
      }
      const { data: targetUser } = await supabaseClient
        .from("users").select('"DigiCom Business", archived_at').eq("id", user_id).maybeSingle();
      const tenantErr = requireSameTenant(me, targetUser);
      if (tenantErr) return tenantErr;
      if (targetUser?.archived_at) {
        return json({ error: "Utilisateur archivé — aucune modification possible." }, 403);
      }
      if (me.role !== "owner") {
        const sameBiz = me.role === "business owner" &&
          targetUser?.["DigiCom Business"] === me["DigiCom Business"];
        if (!sameBiz) return json({ error: "forbidden" }, 403);
      }

      const { error: pwError } = await supabaseClient.auth.admin.updateUserById(user_id, { password: new_password });
      if (pwError) throw friendlyError(pwError, "password");

      return json({ success: true });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
