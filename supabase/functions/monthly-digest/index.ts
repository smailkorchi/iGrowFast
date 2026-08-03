// @ts-nocheck
// T24 monthly digest dispatcher. Sends `monthly_performance` to every business admin and
// `monthly_performance_mediabuyer` to every media buyer, once per month, for the month that just
// ended (Africa/Casablanca).
//
// send-email does plain {{var}} substitution with HTML-escaping and NO conditionals, and a missing
// variable silently renders as an empty string. So every piece of judgement lives here: this
// function decides the month's STATE and hands the template pre-rendered strings. The template
// only lays them out.
//
// The numbers themselves are NOT computed here either — they come from
// public.business_monthly_digest / public.mediabuyer_monthly_digest, which wrap the same
// aggregates the Dashboard, Analytics and Payments pages read (see
// supabase/migrations/20260803150000_monthly_digest.sql for why, and for the impersonation those
// wrappers perform). This function formats and interprets; it never re-derives a figure.
//
// Internal-only: deliberately NOT in main/index.ts's PUBLIC_FUNCTIONS, so the router's global
// VERIFY_JWT already blocks anonymous callers; the check below narrows to service-role only,
// mirroring demand-notify / auth-login-alert.
//
// Input: { month?: 'YYYY-MM-01', dry_run?: boolean, only_business?: uuid, only_user?: uuid,
//          audience?: 'business' | 'mediabuyer' | 'all' }
//   month        — defaults to the month that just ended in Africa/Casablanca.
//   dry_run      — computes and RETURNS every variable without sending anything. This is how a
//                  run is reviewed before it ever mails a human.
//   only_*       — narrows recipients (a single business, or a single user) for testing.
//   audience     — which half to send; the two cron schedules pin one each so neither mails the
//                  other's recipients.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

function decodeJwtRole(jwt: string): string | null {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4)))?.role ?? null;
  } catch { return null; }
}

const ADMIN_ROLES = ["super admin", "business owner", "admin"];
const TPL_BUSINESS = "monthly_performance";
const TPL_MEDIABUYER = "monthly_performance_mediabuyer";
// Single-currency app — same constant the payout statements use (src/lib/sendPayoutStatement.ts:27).
const CURRENCY = "MAD";
// Em-dash for "not comparable", and the REAL minus sign (U+2212) for negative deltas, per contract.
const DASH = "—";
const MINUS = "−";
// Whole-run wall-clock budget. The router kills this isolate at 60s (main/index.ts); stopping
// ourselves a little short means the caller gets truthful counts instead of nothing. A re-run is
// safe and resumes where this left off, because the email_log check below skips what already went.
const TIME_BUDGET_MS = 45_000;

// Badge text + accent colour per state — the exact palette fixed by the shared contract.
const VERDICT: Record<string, { label: string; color: string }> = {
  growth:   { label: "En croissance",   color: "#788c5d" },
  decline:  { label: "En recul",        color: "#b8792f" },
  loss:     { label: "Mois à perte",    color: "#a4463c" },
  flat:     { label: "Stable",          color: "#6b6b6b" },
  inactive: { label: "Aucune activité", color: "#8a8a8a" },
};

const FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin",
                   "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// ───────────────────────────── month arithmetic (Africa/Casablanca) ─────────────────────────────
type YM = { y: number; m: number }; // m is 1-12

const casaParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const o: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
};
const casaNowYM = (now: Date): YM => { const p = casaParts(now); return { y: p.year, m: p.month }; };
const prevYM = (ym: YM): YM => (ym.m === 1 ? { y: ym.y - 1, m: 12 } : { y: ym.y, m: ym.m - 1 });
const nextYM = (ym: YM): YM => (ym.m === 12 ? { y: ym.y + 1, m: 1 } : { y: ym.y, m: ym.m + 1 });
const ymToIso = (ym: YM) => `${ym.y}-${String(ym.m).padStart(2, "0")}-01`;
const ymFromIso = (s: string): YM | null => {
  const m = /^(\d{4})-(\d{2})-01$/.exec(String(s || "").trim());
  if (!m) return null;
  const ym = { y: Number(m[1]), m: Number(m[2]) };
  return ym.m >= 1 && ym.m <= 12 ? ym : null;
};
const monthLabelFr = (ym: YM, capitalized: boolean) => {
  const s = `${FR_MONTHS[ym.m - 1]} ${ym.y}`;
  return capitalized ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};
// The UTC instant at which a Casablanca calendar month begins. Casablanca is UTC+1 but drops to
// UTC+0 for Ramadan, so the offset is read from the zone rather than assumed.
const casaMonthStartUtc = (ym: YM): Date => {
  const guess = Date.UTC(ym.y, ym.m - 1, 1, 0, 0, 0);
  const p = casaParts(new Date(guess));
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return new Date(guess - (asIfUtc - guess));
};

// ─────────────────────────────────── formatting ────────────────────────────────────
// fr-FR grouping emits U+202F (narrow no-break space), which renders as a tofu box in several
// mail clients — stripped to a plain space, exactly as src/lib/sendPayoutStatement.ts:31 does.
const detofu = (s: string) => s.replace(/[  ]/g, " ");
const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v: unknown) => detofu(nf2.format(num(v)));
const moneyC = (v: unknown) => `${money(v)} ${CURRENCY}`;
const int = (v: unknown) => detofu(nf0.format(Math.round(num(v))));
const rate = (v: unknown) => `${detofu(nf1.format(num(v)))} %`;
const plural = (n: number, one: string, many: string) => (Math.abs(n) > 1 ? many : one);

// Signed delta, one decimal, real minus for negatives, em-dash when incomparable.
// Sign is taken from the ROUNDED value so a −0.04 % change can never print "−0,0 %".
const deltaPct = (cur: number, prev: number, comparable: boolean): string => {
  if (!comparable || prev === 0) return DASH;
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(p)) return DASH;
  const r = Math.round(p * 10) / 10;
  return `${r < 0 ? MINUS : "+"}${detofu(nf1.format(Math.abs(r)))} %`;
};
// Same magnitude, unsigned — for prose like "recule de 8,1 %", where the sign is in the verb.
const absPct = (cur: number, prev: number): string =>
  detofu(nf1.format(Math.abs(Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10))) + " %";

// ──────────────────────────── variable builders (one per template) ────────────────────────────
// A month counts as "having data" when it had delivered orders, ad spend or revenue. A previous
// month with none of those is treated as no previous month at all: every comparison degrades to
// the em-dash and the state falls back to inactive / loss / flat on this month's figures alone —
// the contract's rule against printing "+∞%" or "NaN".
const businessHasData = (p: Record<string, unknown> | null) =>
  !!p && (num(p.delivered_orders) > 0 || num(p.ad_spend) !== 0 || num(p.revenue_total) !== 0);

function businessVars(args: {
  adminName: string; businessName: string; monthYm: YM; dashboardUrl: string;
  cur: Record<string, unknown>; prev: Record<string, unknown> | null;
}) {
  const { adminName, businessName, monthYm, dashboardUrl, cur, prev } = args;
  const hasPrev = businessHasData(prev);

  const revenue = num(cur.revenue_total);
  const profit = num(cur.net_profit);
  const adSpend = num(cur.ad_spend);
  const delivered = num(cur.delivered_orders);
  const prevRevenue = hasPrev ? num(prev!.revenue_total) : 0;
  const prevDelivered = hasPrev ? num(prev!.delivered_orders) : 0;
  const prevProfit = hasPrev ? num(prev!.net_profit) : 0;

  const revComparable = hasPrev && prevRevenue !== 0;

  // State machine — exactly the five states of the contract, in its order of precedence.
  const inactive = delivered === 0 && adSpend === 0;
  let state: string;
  if (inactive) state = "inactive";
  else if (profit < 0) state = "loss";
  else if (!revComparable) state = "flat";
  else {
    const p = ((revenue - prevRevenue) / Math.abs(prevRevenue)) * 100;
    state = p > 5 ? "growth" : p < -5 ? "decline" : "flat";
  }

  const monthCap = monthLabelFr(monthYm, true);
  const monthLower = monthLabelFr(monthYm, false);
  const prevLabel = hasPrev ? monthLabelFr(prevYM(monthYm), false) : "";
  const revenueDelta = deltaPct(revenue, prevRevenue, revComparable);

  let verdictMessage: string;
  if (state === "inactive") {
    verdictMessage = `Aucune commande livrée et aucune dépense publicitaire n'ont été enregistrées en ${monthLower}. `
      + `Il n'y a donc rien à analyser ce mois-ci.`;
  } else if (state === "loss") {
    // The explanation is built only from figures that are actually non-zero. Naming a 0,00
    // revenue or a 0,00 ad spend as the cause of a loss reads like a bug and tells the reader
    // nothing — a losing month with no spend is a different situation from an overspent one.
    let lossCause: string;
    if (adSpend > 0) {
      lossCause = `Le chiffre d'affaires livré atteint ${moneyC(revenue)} pour ${moneyC(adSpend)} `
        + `de dépenses publicitaires : c'est du côté des coûts qu'il faut regarder en premier.`;
    } else if (revenue > 0) {
      lossCause = `Le chiffre d'affaires livré atteint ${moneyC(revenue)}, insuffisant pour couvrir `
        + `les charges du mois.`;
    } else {
      lossCause = `Aucun chiffre d'affaires n'a été enregistré sur la période : la perte correspond `
        + `donc aux charges seules. Si des commandes ont bien été livrées, vérifiez qu'elles sont `
        + `marquées comme payées.`;
    }
    verdictMessage = `${monthCap} se solde par une perte nette de ${moneyC(Math.abs(profit))}. ` + lossCause;
  } else if (state === "growth") {
    verdictMessage = `Le chiffre d'affaires progresse de ${absPct(revenue, prevRevenue)} par rapport à ${prevLabel}, `
      + `à ${moneyC(revenue)}. Vous avez livré ${int(delivered)} ${plural(delivered, "commande", "commandes")} `
      + `pour un bénéfice net de ${moneyC(profit)}.`;
  } else if (state === "decline") {
    verdictMessage = `Le chiffre d'affaires recule de ${absPct(revenue, prevRevenue)} par rapport à ${prevLabel}, `
      + `à ${moneyC(revenue)}. Le mois reste bénéficiaire (${moneyC(profit)}), mais le volume livré se réduit.`;
  } else if (revComparable) {
    verdictMessage = `Le chiffre d'affaires reste stable par rapport à ${prevLabel} (${revenueDelta}), `
      + `à ${moneyC(revenue)}, pour un bénéfice net de ${moneyC(profit)}.`;
  } else if (hasPrev) {
    // The previous month exists but booked no revenue, so the percentage is undefined. Say that,
    // rather than the "no previous month" sentence below — the two are different facts.
    verdictMessage = `Le chiffre d'affaires du mois s'élève à ${moneyC(revenue)}, pour un bénéfice net de `
      + `${moneyC(profit)}. Aucun chiffre d'affaires n'ayant été enregistré en ${prevLabel}, la comparaison `
      + `n'est pas possible.`;
  } else {
    verdictMessage = `Le chiffre d'affaires du mois s'élève à ${moneyC(revenue)}, pour un bénéfice net de `
      + `${moneyC(profit)}. Aucune donnée du mois précédent n'est disponible pour la comparaison.`;
  }

  return {
    // Existing variables — kept working, same shape the live template already renders.
    admin_name: adminName,
    business_name: businessName,
    currency: CURRENCY,
    dashboard_url: dashboardUrl,
    month_label: monthCap,
    revenue_total: money(revenue),
    // Signed, with the real minus sign, so a legacy "{{net_profit}} {{currency}}" tile still reads
    // correctly on a losing month. The new layout should use profit_label + profit_amount instead.
    net_profit: profit < 0 ? `${MINUS}${money(Math.abs(profit))}` : money(profit),
    ad_spend: money(adSpend),
    delivered_orders: int(delivered),
    delivery_rate: rate(cur.delivery_rate),
    new_customers: int(cur.new_customers),
    top_product: String(cur.top_product ?? "").trim() || DASH,
    // New variables.
    verdict_label: VERDICT[state].label,
    verdict_color: VERDICT[state].color,
    verdict_message: verdictMessage,
    profit_label: profit < 0 ? "Perte nette" : "Bénéfice net",
    // Bare number: the template renders `{{profit_amount}} {{currency}}`, matching every
    // other money variable in this system. Emitting the suffix here would print 'MAD MAD'.
    profit_amount: money(Math.abs(profit)),
    prev_month_label: prevLabel,
    revenue_delta: revenueDelta,
    orders_delta: deltaPct(delivered, prevDelivered, hasPrev && prevDelivered !== 0),
    profit_delta: deltaPct(profit, prevProfit, hasPrev && prevProfit !== 0),
    revenue_prev: hasPrev ? money(prevRevenue) : DASH,
    orders_prev: hasPrev ? int(prevDelivered) : DASH,
  };
}

const mbHasData = (p: Record<string, unknown> | null) =>
  !!p && (num(p.delivered_orders) > 0 || num(p.total_spend) !== 0 || num(p.attributed_orders) > 0);

function mediabuyerVars(args: {
  mbName: string; businessName: string; monthYm: YM; dashboardUrl: string; paymentType: string;
  cur: Record<string, unknown>; prev: Record<string, unknown> | null;
}) {
  const { mbName, businessName, monthYm, dashboardUrl, paymentType, cur, prev } = args;
  const hasPrev = mbHasData(prev);

  const delivered = num(cur.delivered_orders);
  const spend = num(cur.total_spend);
  const campaigns = num(cur.campaigns_count);
  const commission = num(cur.commission_earned);
  const salary = num(cur.salary_earned);
  const attrRevenue = num(cur.attributed_revenue);
  const attrOrders = num(cur.attributed_orders);
  const prevDelivered = hasPrev ? num(prev!.delivered_orders) : 0;
  const prevSpend = hasPrev ? num(prev!.total_spend) : 0;
  const prevCommission = hasPrev ? num(prev!.commission_earned) : 0;

  // ROAS has no source column — it is attributed revenue ÷ spend, over the payout system's own
  // attribution (the RPC sums revenue across mediabuyer_month_orders). It is only published when
  // it can be trusted:
  //   * spend must be > 0 (never 0 and never a division error), and
  //   * for a commission media buyer, the LIVE attributed order count must still equal the
  //     delivered count frozen into mediabuyer_payments. If months of edits have landed since the
  //     close, the numerator (live) and the denominator (frozen) describe different data — the
  //     contract's rule is to emit the em-dash rather than invent a figure. Salaried buyers are
  //     exempt from that check because mb_month_earned reports 0 delivered for them by design, so
  //     there is nothing to reconcile against.
  const attributionAgrees = paymentType === "salary" || attrOrders === delivered;
  const roasOk = spend > 0 && attributionAgrees && Number.isFinite(attrRevenue / spend);
  const roas = roasOk ? `${detofu(nf1.format(attrRevenue / spend))}x` : DASH;
  const roasNote = roasOk ? "Revenu attribué ÷ dépense publicitaire" : "Non calculable ce mois";

  // The five states, mapped onto what a media buyer actually controls:
  //   inactive — nothing delivered and nothing spent (same test as the business digest);
  //   loss     — the ads returned less than they cost (only assertable when ROAS is trustworthy);
  //   growth / decline / flat — measured on DELIVERED ORDERS, the output they are paid on, not on
  //   spend (a buyer whose spend rose is not thereby "growing").
  const inactive = delivered === 0 && spend === 0;
  const ordersComparable = hasPrev && prevDelivered !== 0;
  let state: string;
  if (inactive) state = "inactive";
  else if (roasOk && attrRevenue < spend) state = "loss";
  else if (!ordersComparable) state = "flat";
  else {
    const p = ((delivered - prevDelivered) / Math.abs(prevDelivered)) * 100;
    state = p > 5 ? "growth" : p < -5 ? "decline" : "flat";
  }

  const monthCap = monthLabelFr(monthYm, true);
  const monthLower = monthLabelFr(monthYm, false);
  const prevLabel = hasPrev ? monthLabelFr(prevYM(monthYm), false) : "";
  const ordersDelta = deltaPct(delivered, prevDelivered, ordersComparable);

  let verdictMessage: string;
  if (state === "inactive") {
    verdictMessage = `Aucune commande livrée et aucune dépense publicitaire n'ont été enregistrées en ${monthLower}. `
      + `Il n'y a donc rien à analyser ce mois-ci.`;
  } else if (state === "loss") {
    verdictMessage = `Vos campagnes ont coûté ${moneyC(spend)} pour ${moneyC(attrRevenue)} de chiffre d'affaires `
      + `attribué : sur ${monthLower}, la dépense dépasse le revenu qu'elle a généré.`;
  } else if (state === "growth") {
    verdictMessage = `Vos commandes livrées progressent de ${absPct(delivered, prevDelivered)} par rapport à `
      + `${prevLabel}, à ${int(delivered)}. Dépense publicitaire : ${moneyC(spend)} sur ${int(campaigns)} `
      + `${plural(campaigns, "campagne", "campagnes")}.`;
  } else if (state === "decline") {
    verdictMessage = `Vos commandes livrées reculent de ${absPct(delivered, prevDelivered)} par rapport à `
      + `${prevLabel}, à ${int(delivered)}, pour ${moneyC(spend)} de dépense publicitaire.`;
  } else if (ordersComparable) {
    verdictMessage = `Vos commandes livrées sont stables par rapport à ${prevLabel} (${ordersDelta}), `
      + `à ${int(delivered)}, pour ${moneyC(spend)} de dépense publicitaire.`;
  } else if (hasPrev) {
    // The previous month exists but shows no delivered orders — either it really had none, or the
    // buyer is salaried and mb_month_earned reports 0 delivered for them by design. Either way the
    // percentage is undefined; say the volume is not comparable rather than deny the month existed.
    verdictMessage = `Votre activité de ${monthLower} se solde par ${int(delivered)} `
      + `${plural(delivered, "commande livrée", "commandes livrées")} et ${moneyC(spend)} de dépense `
      + `publicitaire. Le volume livré n'est pas comparable à ${prevLabel}.`;
  } else {
    verdictMessage = `Vous avez livré ${int(delivered)} ${plural(delivered, "commande", "commandes")} en ${monthLower}, `
      + `pour ${moneyC(spend)} de dépense publicitaire. Aucune donnée du mois précédent n'est disponible `
      + `pour la comparaison.`;
  }

  return {
    // Existing variables.
    business_name: businessName,
    campaigns_count: int(campaigns),
    commission_earned: money(commission),
    currency: CURRENCY,
    dashboard_url: dashboardUrl,
    delivered_orders: int(delivered),
    mb_name: mbName,
    month_label: monthCap,
    roas,
    salary_earned: money(salary),
    total_spend: money(spend),
    // New variables.
    verdict_label: VERDICT[state].label,
    verdict_color: VERDICT[state].color,
    verdict_message: verdictMessage,
    prev_month_label: prevLabel,
    spend_delta: deltaPct(spend, prevSpend, hasPrev && prevSpend !== 0),
    orders_delta: ordersDelta,
    commission_delta: deltaPct(commission, prevCommission, hasPrev && prevCommission !== 0),
    roas_note: roasNote,
  };
}

// ───────────────────────────────────── dispatcher ─────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // Only an internal service-role caller (pg_cron via app_invoke_edge, or an operator holding
    // the key) may run this — it reads whole-business money and mails humans.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    if (jwt !== SERVICE && decodeJwtRole(jwt) !== "service_role") return json({ ok: false, reason: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const onlyBusiness = body?.only_business ? String(body.only_business) : null;
    const onlyUser = body?.only_user ? String(body.only_user) : null;
    const audience = ["business", "mediabuyer", "all"].includes(String(body?.audience ?? ""))
      ? String(body.audience) : "all";

    const now = new Date();
    // Default month = the one that just ended, in Africa/Casablanca.
    const monthYm = body?.month ? ymFromIso(String(body.month)) : prevYM(casaNowYM(now));
    if (!monthYm) return json({ ok: false, reason: "bad_month", detail: "expected YYYY-MM-01" }, 400);
    const monthIso = ymToIso(monthYm);

    // Idempotency window = the calendar month this RUN happens in (Casablanca). A monthly job that
    // is retried, or invoked twice by hand, must not mail the same person twice; the log row
    // send-email writes for the first send is what makes the second run skip. Note the deliberate
    // consequence: within one calendar month a recipient receives at most ONE mail per template,
    // so a same-month backfill of a DIFFERENT month is suppressed too — delete the email_log row
    // if a deliberate re-send is ever needed.
    const runYm = casaNowYM(now);
    const runStart = casaMonthStartUtc(runYm).toISOString();
    const runEnd = casaMonthStartUtc(nextYM(runYm)).toISOString();

    // APP_URL is the app origin (SITE_URL points at the marketing site — a link built from it would
    // 404). Same fallback demand-notify uses.
    const origin = (Deno.env.get("APP_URL") || "https://app.igrowfast.com").replace(/\/$/, "");

    const counts = { eligible: 0, sent: 0, skipped: 0, failed: 0 };
    const skips: Array<Record<string, unknown>> = [];
    const failures: Array<Record<string, unknown>> = [];
    const previews: Array<Record<string, unknown>> = [];

    const skip = (reason: string, extra: Record<string, unknown>) => {
      counts.skipped++;
      const row = { reason, ...extra };
      skips.push(row);
      console.log("[monthly-digest] skip", JSON.stringify(row));
    };

    const { data: bizRows } = await service.from("businesses").select("id, name");
    const bizName = new Map<string, string>((bizRows ?? []).map((b: any) => [String(b.id), b.name || ""]));

    // One RPC round-trip per business (business digest) / per media buyer (MB digest), memoised so
    // several admins of the same business share a single computation.
    const bizDigest = new Map<string, any>();
    const getBusinessDigest = async (businessId: string) => {
      if (!bizDigest.has(businessId)) {
        const { data, error } = await service.rpc("business_monthly_digest",
          { p_business: businessId, p_month: monthIso });
        if (error) throw new Error(`business_monthly_digest(${businessId}): ${error.message}`);
        bizDigest.set(businessId, data ?? null);
      }
      return bizDigest.get(businessId);
    };

    const sendOne = async (key: string, to: string, vars: Record<string, unknown>, userId: string) => {
      if (dryRun) { previews.push({ template_key: key, to, user_id: userId, vars }); counts.sent++; return; }
      try {
        const resp = await fetch(`${url}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
          body: JSON.stringify({ key, to, user_id: userId, vars }),
        });
        const out = await resp.json().catch(() => ({}));
        if (resp.ok && out?.ok === true) counts.sent++;
        else { counts.failed++; failures.push({ to, template_key: key, detail: out?.detail || out?.error || resp.status }); }
      } catch (e) {
        counts.failed++;
        failures.push({ to, template_key: key, detail: (e as Error).message });
      }
    };

    // Already mailed this template to this address inside the run month? Then this is a re-run.
    // Deliberately NOT consulted in dry_run: a reviewer must still see every computed variable
    // after a real run has happened, so `sent` in a dry run means "would send", not "will send".
    const alreadySent = async (key: string, to: string) => {
      const { data } = await service.from("email_log")
        .select("id").eq("template_key", key).eq("to_email", to)
        .gte("created_at", runStart).lt("created_at", runEnd).limit(1);
      return Array.isArray(data) && data.length > 0;
    };

    const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

    // ── business admins ──
    if (audience === "business" || audience === "all") {
      let q = service.from("users")
        .select('id, name, email, "DigiCom Business"')
        .in("role", ADMIN_ROLES).eq("active", true).is("archived_at", null)
        .not("DigiCom Business", "is", null);
      if (onlyBusiness) q = q.eq("DigiCom Business", onlyBusiness);
      if (onlyUser) q = q.eq("id", onlyUser);
      const { data: admins, error: aErr } = await q;
      if (aErr) throw new Error(`admin recipients: ${aErr.message}`);

      for (const u of admins ?? []) {
        counts.eligible++;
        const businessId = String(u["DigiCom Business"]);
        const to = String(u.email ?? "").trim();
        if (!to) { skip("no_email", { user_id: u.id, business_id: businessId, template_key: TPL_BUSINESS }); continue; }
        if (outOfTime()) { skip("time_budget", { user_id: u.id, to, template_key: TPL_BUSINESS }); continue; }
        if (!dryRun && await alreadySent(TPL_BUSINESS, to)) {
          skip("already_sent_this_month", { user_id: u.id, to, template_key: TPL_BUSINESS }); continue;
        }

        const digest = await getBusinessDigest(businessId);
        // jsonb null ⇒ the business has no admin the wrapper could impersonate, so no figures
        // exist to report. Logged rather than mailed as a page of zeros.
        if (!digest || !digest.current) {
          skip("no_digest", { user_id: u.id, to, business_id: businessId, template_key: TPL_BUSINESS }); continue;
        }

        await sendOne(TPL_BUSINESS, to, businessVars({
          adminName: u.name || "",
          businessName: bizName.get(businessId) || "votre entreprise",
          monthYm, dashboardUrl: `${origin}/`,
          cur: digest.current, prev: digest.previous ?? null,
        }), String(u.id));
      }
    }

    // ── media buyers ──
    if (audience === "mediabuyer" || audience === "all") {
      let q = service.from("users")
        .select('id, name, email, "DigiCom Business"')
        .eq("role", "mediabuyer").eq("active", true).is("archived_at", null)
        .not("DigiCom Business", "is", null);
      if (onlyBusiness) q = q.eq("DigiCom Business", onlyBusiness);
      if (onlyUser) q = q.eq("id", onlyUser);
      const { data: mbs, error: mErr } = await q;
      if (mErr) throw new Error(`mediabuyer recipients: ${mErr.message}`);

      for (const u of mbs ?? []) {
        counts.eligible++;
        const businessId = String(u["DigiCom Business"]);
        const to = String(u.email ?? "").trim();
        if (!to) { skip("no_email", { user_id: u.id, business_id: businessId, template_key: TPL_MEDIABUYER }); continue; }
        if (outOfTime()) { skip("time_budget", { user_id: u.id, to, template_key: TPL_MEDIABUYER }); continue; }
        if (!dryRun && await alreadySent(TPL_MEDIABUYER, to)) {
          skip("already_sent_this_month", { user_id: u.id, to, template_key: TPL_MEDIABUYER }); continue;
        }

        const { data: digest, error: dErr } = await service.rpc("mediabuyer_monthly_digest",
          { p_mb: String(u.id), p_business: businessId, p_month: monthIso });
        if (dErr) throw new Error(`mediabuyer_monthly_digest(${u.id}): ${dErr.message}`);
        if (!digest || !digest.current) {
          skip("no_digest", { user_id: u.id, to, business_id: businessId, template_key: TPL_MEDIABUYER }); continue;
        }

        await sendOne(TPL_MEDIABUYER, to, mediabuyerVars({
          mbName: u.name || "",
          businessName: bizName.get(businessId) || "votre entreprise",
          monthYm, dashboardUrl: `${origin}/mediabuyer/campaigns`,
          paymentType: String(digest.payment_type || "commission"),
          cur: digest.current, prev: digest.previous ?? null,
        }), String(u.id));
      }
    }

    return json({
      ok: true, month: monthIso, audience, dry_run: dryRun,
      run_window: { from: runStart, to: runEnd },
      ...counts, skips, failures,
      ...(dryRun ? { previews } : {}),
    }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
