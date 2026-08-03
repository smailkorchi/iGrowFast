-- T24 — monthly digest: rewrite the BODIES of the two performance templates so they read the
-- situation instead of dumping numbers.
--
-- Owner's requirement: "send to everyone, the templates must be smart, and able to handle the
-- profit, loss, or stagnation". `send-email` does plain {{var}} substitution with HTML-escaping,
-- NO conditionals, and a missing variable renders as an empty string silently (see
-- supabase/functions/send-email/index.ts:21-27, 143-145). So ALL judgement is computed upstream
-- and arrives here as pre-rendered strings; this file is layout only.
--
-- Scope: UPDATE the two existing rows by `key` (monthly_performance,
-- monthly_performance_mediabuyer). Sets subject, preheader, html_body, text_body ONLY — never
-- is_active, never email_account_id, never any other row, never an INSERT. Re-runnable: a plain
-- UPDATE to a literal value is idempotent by construction. The pre-flight guard makes a missing
-- row fail loudly instead of silently no-op'ing.
--
-- NOTE for the backend half — `preheader` is metadata for the owner UI only. The preheader that
-- actually reaches the inbox is the hidden <div> at the top of html_body (send-email never reads
-- the column). Both are kept identical here on purpose.
--
-- `net_profit` is deliberately NO LONGER RENDERED. It stays a supported variable (the sender may
-- keep passing it; an unused variable is inert), but the contract forbids showing a negative
-- profit as "Bénéfice net : −5 000", so the headline figure is now profit_label + profit_amount
-- (absolute). Same for the media-buyer side: nothing signed is ever printed as a bare figure.
--
-- MONEY CONTRACT (must match the sender): every money variable carries the NUMBER ONLY, with no
-- currency suffix — `{{currency}}` is appended by this markup, exactly as every other template in
-- this system does ({{paid_amount}} {{currency}}, {{ad_spend}} {{currency}}, …). That includes
-- `profit_amount`. In the comparison tables the currency is moved into the row LABEL so that a
-- previous-month value of « — » never renders as « — MAD ».
--
--
-- ============================ THE FIVE STATES, AS RENDERED ============================
-- (verdict_label / verdict_color / verdict_message are produced by the sender. Reviewer copy so
--  the wording can be judged without running anything. `{slot}` = filled by the sender.)
--
-- monthly_performance (business admins) — subject = "Votre bilan de {{month_label}} — {{verdict_label}}"
--
-- 1) growth   #788c5d  badge « En croissance »
--    subject   : Votre bilan de juillet 2026 — En croissance
--    preheader : DigiCom · En croissance — Le chiffre d'affaires progresse de +12,4 %…
--    message   : « Le chiffre d'affaires progresse de {revenue_delta} par rapport à
--                {prev_month_label} et le mois reste bénéficiaire, à {profit_amount} {currency}.
--                Identifiez ce qui a porté cette hausse — produit, source, ville — avant
--                d'augmenter les budgets. »
--
-- 2) decline  #b8792f  badge « En recul »
--    subject   : Votre bilan de juillet 2026 — En recul
--    message   : « Le chiffre d'affaires recule de {revenue_delta} par rapport à
--                {prev_month_label}, mais le mois reste bénéficiaire, à {profit_amount}
--                {currency}. Regardez d'abord le taux de livraison et les commandes non livrées :
--                c'est là que le chiffre d'affaires se perd le plus souvent. »
--
-- 3) loss     #a4463c  badge « Mois à perte »
--    subject   : Votre bilan de juillet 2026 — Mois à perte
--    hero      : « PERTE NETTE » / « 5 200,00 MAD » — never a minus sign, never "Bénéfice : −5 200"
--    message   : « Les charges du mois dépassent les recettes : la perte nette s'élève à
--                {profit_amount} {currency}. Le poste le plus rapide à corriger est le coût par
--                commande livrée — comparez la dépense et la marge par source avant de relancer. »
--
-- 4) flat     #6b6b6b  badge « Stable »
--    subject   : Votre bilan de juillet 2026 — Stable
--    message   : « Le chiffre d'affaires est resté au niveau de {prev_month_label} (écart
--                {revenue_delta}) et le mois est bénéficiaire, à {profit_amount} {currency}. Rien
--                ne s'est dégradé ; pour bouger la ligne il faut agir sur un levier précis —
--                panier moyen, taux de livraison ou volume. »
--    flat with NO previous month (comparisons unavailable, deltas = « — ») :
--                « Premier mois de référence : il n'y a pas encore d'historique pour situer ces
--                chiffres. Le mois est bénéficiaire, à {profit_amount} {currency} — ce niveau
--                servira de base de comparaison le mois prochain. »
--
-- 5) inactive #8a8a8a  badge « Aucune activité »
--    subject   : Votre bilan de juillet 2026 — Aucune activité
--    message   : « Aucune commande livrée ni dépense publicitaire n'a été enregistrée sur
--                {month_label}. Si votre activité a bien tourné, c'est que les commandes n'ont pas
--                été saisies ou que les statuts de livraison ne sont pas remontés — cela vaut une
--                vérification. »
--
-- monthly_performance_mediabuyer — subject = "Votre bilan publicitaire de {{month_label}} — {{verdict_label}}"
--
-- 1) growth   #788c5d  « En croissance »
--    « Vos commandes livrées attribuées progressent de {orders_delta} par rapport à
--      {prev_month_label}, et votre commission suit ({commission_delta}). Notez ce qui a
--      fonctionné ce mois-ci — créa, audience, source — pour le reproduire. »
-- 2) decline  #b8792f  « En recul »
--    « Vos commandes livrées attribuées reculent de {orders_delta} par rapport à
--      {prev_month_label}, pour une dépense de {total_spend} {currency} ({spend_delta}). Comparez
--      le coût par commande livrée entre vos sources avant d'arbitrer les budgets. »
-- 3) loss     #a4463c  « Rendement négatif »
--    « Sur {month_label}, la dépense publicitaire ({total_spend} {currency}) dépasse le revenu
--      attribué à vos campagnes. Le levier immédiat est le coût par commande livrée : coupez ou
--      retravaillez les sources qui coûtent le plus cher avant de remonter les budgets. »
--    /!\ pick this state only when the attribution IS computable (roas <> « — »); otherwise fall back.
-- 4) flat     #6b6b6b  « Stable »
--    « Vos volumes sont restés au niveau de {prev_month_label} (écart {orders_delta}) pour une
--      dépense comparable. Rien ne s'est dégradé ; pour progresser il faudra tester une nouvelle
--      créa ou une nouvelle source plutôt que de pousser l'existant. »
--    no previous month : « Premier mois de référence : il n'y a pas encore d'historique pour
--      situer ces chiffres. {delivered_orders} commandes livrées vous sont attribuées ce mois-ci —
--      cette base servira de comparaison le mois prochain. »
-- 5) inactive #8a8a8a  « Aucune activité »
--    « Aucune dépense publicitaire ni commande livrée ne vous est attribuée sur {month_label}. Si
--      vous avez fait tourner des campagnes, c'est que les dépenses n'ont pas été saisies au jour
--      et à la source correspondants — sans cette saisie, aucune commande ne peut vous être
--      attribuée. »
--
-- LAYOUT SURVIVAL (checked against every state):
--   · badge + panel border + hero top-rule are the ONLY things tinted by {{verdict_color}}; the
--     figures stay #141413 so a green number never contradicts an amber verdict.
--   · deltas are rendered in neutral ink — the template cannot know the sign, and colouring a
--     pre-rendered string by guessing is how a « — » ends up green.
--   · every comparison cell degrades to « — » on its own; the currency lives in the row label, so
--     no cell can ever read « — MAD ».
--   · `prev_month_label` appears exactly once, at the END of a caption that is a complete sentence
--     without it ("Comparaison avec le mois précédent"), so an empty value leaves no hole.
--   · an inactive month is a wall of zeros with a neutral grey badge and an explanatory message —
--     no congratulation, no alarm, no red.
-- =====================================================================================

BEGIN;

-- Pre-flight: this migration only ever UPDATEs. If a row is missing, fail loudly rather than
-- silently updating nothing (and never create it — template creation is the owner UI's job).
DO $guard$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(k, ', ')
    INTO missing
    FROM unnest(ARRAY['monthly_performance', 'monthly_performance_mediabuyer']) AS k
   WHERE NOT EXISTS (SELECT 1 FROM public.email_templates t WHERE t.key = k);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'email_templates row(s) missing, refusing to create them: %', missing;
  END IF;
END;
$guard$;


-- =====================================================================================
-- 1. monthly_performance — business admins
-- =====================================================================================
UPDATE public.email_templates SET
  subject   = 'Votre bilan de {{month_label}} — {{verdict_label}}',
  preheader = '{{business_name}} · {{verdict_label}} — {{verdict_message}}',
  html_body = $html$<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="x-apple-disable-message-reformatting">
<title>iGrowFast</title>
</head>
<body style="margin:0;padding:0;background:#faf9f5;-webkit-font-smoothing:antialiased;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">{{business_name}} &middot; {{verdict_label}} &mdash; {{verdict_message}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e8e6dc;border-radius:18px;overflow:hidden;">
<tr><td style="background:#141413;padding:20px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://app.igrowfast.com/Logo/iGrowFast%20Icon%20Transparent.png" width="30" height="30" alt="iGrowFast" style="display:block;border:0;outline:none;border-radius:8px;"></td>
<td style="vertical-align:middle;"><span style="font-family:'Poppins','Segoe UI',Arial,sans-serif;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:-0.01em;">iGrowFast<span style="color:#d97757;">.</span></span></td>
</tr></table>
</td></tr>
<tr><td style="height:3px;line-height:3px;font-size:0;background:#d97757;">&nbsp;</td></tr>
<tr><td style="padding:38px 36px 10px;"><!-- Variables — admin_name (users.name de l'admin · text) | business_name (businesses.name · text) | month_label (mois écoulé, ex. "juillet 2026" · text) | currency (devise, ex. "MAD" · text) | dashboard_url (lien tableau de bord · url) | verdict_label (badge court, ex. "En croissance" · text) | verdict_color (hex du badge/accent, ex. "#788c5d" · text) | verdict_message (1 à 2 phrases interprétant le mois · text) | profit_label ("Bénéfice net" si ≥ 0, "Perte nette" si < 0 · text) | profit_amount (valeur ABSOLUE, nombre formaté SANS devise · text) | profit_delta (écart signé vs mois précédent, ou "—" · text) | revenue_total (chiffre d'affaires, nombre SANS devise · text) | revenue_prev (CA du mois précédent, ou "—" · text) | revenue_delta (écart signé, ou "—" · text) | delivered_orders (commandes livrées · number) | orders_prev (commandes livrées du mois précédent, ou "—" · text) | orders_delta (écart signé, ou "—" · text) | prev_month_label (ex. "juin 2026", VIDE s'il n'y a pas de mois précédent · text) | delivery_rate (taux de livraison, ex. "62 %" · text) | ad_spend (dépenses publicitaires, nombre SANS devise · text) | new_customers (nouveaux clients · number) | top_product (produit le plus vendu, "—" s'il n'y en a pas · text) — RÈGLE : toute variable monétaire est un NOMBRE SEUL ; c'est le gabarit qui ajoute {{currency}}. -->
<p style="margin:0 0 14px;font-family:'Poppins',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#d97757;">Bilan mensuel</p>
<h1 style="margin:0 0 8px;font-family:'Poppins','Segoe UI',Arial,sans-serif;font-size:23px;line-height:1.25;font-weight:600;color:#141413;letter-spacing:-0.01em;">Votre bilan de {{month_label}}</h1>
<p style="margin:0 0 20px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.65;color:#44423d;">Bonjour {{admin_name}}, voici la performance de <strong style="color:#141413;">{{business_name}}</strong> sur le mois écoulé.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#faf9f5;border:1px solid #e8e6dc;border-left:4px solid {{verdict_color}};border-radius:12px;"><tr><td style="padding:16px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 11px;"><tr><td style="background:{{verdict_color}};border-radius:999px;padding:6px 14px;"><span style="font-family:'Poppins',Arial,sans-serif;font-size:12px;font-weight:700;color:#ffffff;letter-spacing:0.02em;line-height:1;">{{verdict_label}}</span></td></tr></table>
<p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.7;color:#141413;">{{verdict_message}}</p>
</td></tr></table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td align="center" style="padding:22px;background:#faf9f5;border:1px solid #e8e6dc;border-top:3px solid {{verdict_color}};border-radius:14px;">
<p style="margin:0 0 6px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#6b6a63;">{{profit_label}}</p>
<p style="margin:0 0 6px;font-family:'Poppins',Arial,sans-serif;font-size:32px;font-weight:700;color:#141413;letter-spacing:-0.01em;line-height:1.15;">{{profit_amount}} {{currency}}</p>
<p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;color:#6b6a63;">Écart vs mois précédent&nbsp;: <strong style="color:#141413;">{{profit_delta}}</strong></p>
</td></tr></table>

<p style="margin:0 0 8px;font-family:'Poppins',Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8a8880;">Comparaison avec le mois précédent {{prev_month_label}}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#faf9f5;border:1px solid #e8e6dc;border-radius:12px;"><tr><td style="padding:14px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;">
<tr>
<td width="31%" style="padding:0 0 7px;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8880;">Indicateur</td>
<td width="23%" style="padding:0 0 7px;text-align:right;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8880;">Ce mois</td>
<td width="23%" style="padding:0 0 7px;text-align:right;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8880;">Précédent</td>
<td width="23%" style="padding:0 0 7px;text-align:right;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8880;">Écart</td>
</tr>
<tr>
<td style="padding:7px 0;color:#6b6a63;border-top:1px solid #e8e6dc;">Chiffre d'affaires <span style="color:#b0aea5;">({{currency}})</span></td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:700;border-top:1px solid #e8e6dc;">{{revenue_total}}</td>
<td style="padding:7px 0;text-align:right;color:#8a8880;border-top:1px solid #e8e6dc;">{{revenue_prev}}</td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:600;border-top:1px solid #e8e6dc;">{{revenue_delta}}</td>
</tr>
<tr>
<td style="padding:7px 0;color:#6b6a63;border-top:1px solid #e8e6dc;">Commandes livrées</td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:700;border-top:1px solid #e8e6dc;">{{delivered_orders}}</td>
<td style="padding:7px 0;text-align:right;color:#8a8880;border-top:1px solid #e8e6dc;">{{orders_prev}}</td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:600;border-top:1px solid #e8e6dc;">{{orders_delta}}</td>
</tr>
</table>
</td></tr></table>

<p style="margin:0 0 8px;font-family:'Poppins',Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8a8880;">Le mois en détail</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background:#faf9f5;border:1px solid #e8e6dc;border-radius:12px;"><tr><td style="padding:14px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;">
<tr><td style="padding:5px 0;color:#6b6a63;">Taux de livraison</td><td style="padding:5px 0;text-align:right;color:#141413;font-weight:600;">{{delivery_rate}}</td></tr>
<tr><td style="padding:5px 0;color:#6b6a63;">Dépenses publicitaires <span style="color:#b0aea5;">({{currency}})</span></td><td style="padding:5px 0;text-align:right;color:#141413;font-weight:600;">{{ad_spend}}</td></tr>
<tr><td style="padding:5px 0;color:#6b6a63;">Nouveaux clients</td><td style="padding:5px 0;text-align:right;color:#141413;font-weight:600;">{{new_customers}}</td></tr>
<tr><td style="padding:5px 0;color:#6b6a63;">Produit le plus vendu</td><td style="padding:5px 0;text-align:right;color:#141413;font-weight:600;">{{top_product}}</td></tr>
</table>
</td></tr></table>

<p style="margin:0 0 18px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8880;">Les écarts sont calculés par rapport au mois précédent. Un tiret &laquo;&nbsp;&mdash;&nbsp;&raquo; signifie qu'aucune comparaison n'est possible.</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td style="border-radius:999px;background:#141413;"><a href="{{dashboard_url}}" style="display:inline-block;padding:13px 28px;font-family:'Poppins',Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Voir le tableau de bord</a></td></tr></table>
<p style="margin:20px 0 2px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;color:#6b6a63;">Au mois prochain,<br>L'équipe iGrowFast</p></td></tr>
<tr><td style="padding:22px 36px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e8e6dc;padding-top:18px;">
<p style="margin:0 0 5px;font-family:'Poppins',Arial,sans-serif;font-size:13px;font-weight:600;color:#141413;">iGrowFast<span style="color:#d97757;">.</span></p>
<p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b6a63;">Pilotez tout votre m&eacute;tier &mdash; commandes, livraisons, paiements et campagnes &mdash; au m&ecirc;me endroit.<br>Besoin d&rsquo;aide&nbsp;? <a href="mailto:support@igrowfast.com" style="color:#d97757;text-decoration:none;">support@igrowfast.com</a></p>
</td></tr></table>
</td></tr>
</table>
<p style="margin:14px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;color:#b0aea5;">&copy; iGrowFast &mdash; Tous droits r&eacute;serv&eacute;s.</p>
</td></tr></table>
</body>
</html>$html$,
  text_body = $txt$Votre bilan de {{month_label}} — {{business_name}}

{{verdict_label}}
{{verdict_message}}

{{profit_label}} : {{profit_amount}} {{currency}}
Écart vs mois précédent : {{profit_delta}}

COMPARAISON AVEC LE MOIS PRÉCÉDENT {{prev_month_label}}
(ce mois / précédent / écart)
Chiffre d'affaires ({{currency}}) : {{revenue_total}} / {{revenue_prev}} / {{revenue_delta}}
Commandes livrées : {{delivered_orders}} / {{orders_prev}} / {{orders_delta}}

LE MOIS EN DÉTAIL
Taux de livraison : {{delivery_rate}}
Dépenses publicitaires : {{ad_spend}} {{currency}}
Nouveaux clients : {{new_customers}}
Produit le plus vendu : {{top_product}}

Les écarts sont calculés par rapport au mois précédent. Un tiret « — » signifie qu'aucune comparaison n'est possible.

Voir le tableau de bord : {{dashboard_url}}

Au mois prochain,
L'équipe iGrowFast$txt$
WHERE key = 'monthly_performance';


-- =====================================================================================
-- 2. monthly_performance_mediabuyer — media buyers
-- =====================================================================================
UPDATE public.email_templates SET
  subject   = 'Votre bilan publicitaire de {{month_label}} — {{verdict_label}}',
  preheader = '{{business_name}} · {{verdict_label}} — {{verdict_message}}',
  html_body = $html$<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="x-apple-disable-message-reformatting">
<title>iGrowFast</title>
</head>
<body style="margin:0;padding:0;background:#faf9f5;-webkit-font-smoothing:antialiased;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">{{business_name}} &middot; {{verdict_label}} &mdash; {{verdict_message}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e8e6dc;border-radius:18px;overflow:hidden;">
<tr><td style="background:#141413;padding:20px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://app.igrowfast.com/Logo/iGrowFast%20Icon%20Transparent.png" width="30" height="30" alt="iGrowFast" style="display:block;border:0;outline:none;border-radius:8px;"></td>
<td style="vertical-align:middle;"><span style="font-family:'Poppins','Segoe UI',Arial,sans-serif;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:-0.01em;">iGrowFast<span style="color:#d97757;">.</span></span></td>
</tr></table>
</td></tr>
<tr><td style="height:3px;line-height:3px;font-size:0;background:#d97757;">&nbsp;</td></tr>
<tr><td style="padding:38px 36px 10px;"><!-- Variables — mb_name (users.name du media buyer · text) | business_name (businesses.name · text) | month_label (mois écoulé, ex. "juillet 2026" · text) | currency (devise · text) | dashboard_url (lien campagnes · url) | verdict_label (badge court, ex. "En croissance" · text) | verdict_color (hex du badge/accent, ex. "#788c5d" · text) | verdict_message (1 à 2 phrases interprétant le mois · text) | total_spend (dépense publicitaire, nombre SANS devise · text) | spend_delta (écart signé vs mois précédent, ou "—" · text) | delivered_orders (commandes livrées attribuées · number) | orders_delta (écart signé, ou "—" · text) | commission_earned (commission, nombre SANS devise · text) | commission_delta (écart signé, ou "—" · text) | prev_month_label (ex. "juin 2026", VIDE s'il n'y a pas de mois précédent · text) | campaigns_count (campagnes · number) | salary_earned (salaire fixe, nombre SANS devise · text) | roas (revenu attribué ÷ dépense, ex. "2,4x" ou "—" · text) | roas_note (ligne d'explication du ROAS · text) — RÈGLE : toute variable monétaire est un NOMBRE SEUL ; c'est le gabarit qui ajoute {{currency}}. -->
<p style="margin:0 0 14px;font-family:'Poppins',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#d97757;">Bilan mensuel &middot; Media Buyer</p>
<h1 style="margin:0 0 8px;font-family:'Poppins','Segoe UI',Arial,sans-serif;font-size:23px;line-height:1.25;font-weight:600;color:#141413;letter-spacing:-0.01em;">Votre bilan de {{month_label}}</h1>
<p style="margin:0 0 20px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.65;color:#44423d;">Bonjour {{mb_name}}, voici votre performance Media Buyer sur <strong style="color:#141413;">{{business_name}}</strong> le mois écoulé.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#faf9f5;border:1px solid #e8e6dc;border-left:4px solid {{verdict_color}};border-radius:12px;"><tr><td style="padding:16px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 11px;"><tr><td style="background:{{verdict_color}};border-radius:999px;padding:6px 14px;"><span style="font-family:'Poppins',Arial,sans-serif;font-size:12px;font-weight:700;color:#ffffff;letter-spacing:0.02em;line-height:1;">{{verdict_label}}</span></td></tr></table>
<p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.7;color:#141413;">{{verdict_message}}</p>
</td></tr></table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td align="center" style="padding:22px;background:#faf9f5;border:1px solid #e8e6dc;border-top:3px solid {{verdict_color}};border-radius:14px;">
<p style="margin:0 0 6px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#6b6a63;">Commission du mois</p>
<p style="margin:0 0 6px;font-family:'Poppins',Arial,sans-serif;font-size:32px;font-weight:700;color:#141413;letter-spacing:-0.01em;line-height:1.15;">{{commission_earned}} {{currency}}</p>
<p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;color:#6b6a63;">Écart vs mois précédent&nbsp;: <strong style="color:#141413;">{{commission_delta}}</strong></p>
</td></tr></table>

<p style="margin:0 0 8px;font-family:'Poppins',Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8a8880;">Comparaison avec le mois précédent {{prev_month_label}}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#faf9f5;border:1px solid #e8e6dc;border-radius:12px;"><tr><td style="padding:14px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;">
<tr>
<td width="46%" style="padding:0 0 7px;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8880;">Indicateur</td>
<td width="27%" style="padding:0 0 7px;text-align:right;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8880;">Ce mois</td>
<td width="27%" style="padding:0 0 7px;text-align:right;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8880;">Écart</td>
</tr>
<tr>
<td style="padding:7px 0;color:#6b6a63;border-top:1px solid #e8e6dc;">Dépense publicitaire <span style="color:#b0aea5;">({{currency}})</span></td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:700;border-top:1px solid #e8e6dc;">{{total_spend}}</td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:600;border-top:1px solid #e8e6dc;">{{spend_delta}}</td>
</tr>
<tr>
<td style="padding:7px 0;color:#6b6a63;border-top:1px solid #e8e6dc;">Commandes livrées attribuées</td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:700;border-top:1px solid #e8e6dc;">{{delivered_orders}}</td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:600;border-top:1px solid #e8e6dc;">{{orders_delta}}</td>
</tr>
<tr>
<td style="padding:7px 0;color:#6b6a63;border-top:1px solid #e8e6dc;">Commission <span style="color:#b0aea5;">({{currency}})</span></td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:700;border-top:1px solid #e8e6dc;">{{commission_earned}}</td>
<td style="padding:7px 0;text-align:right;color:#141413;font-weight:600;border-top:1px solid #e8e6dc;">{{commission_delta}}</td>
</tr>
</table>
</td></tr></table>

<p style="margin:0 0 8px;font-family:'Poppins',Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8a8880;">Le mois en détail</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;background:#faf9f5;border:1px solid #e8e6dc;border-radius:12px;"><tr><td style="padding:14px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;">
<tr><td style="padding:5px 0;color:#6b6a63;">Campagnes</td><td style="padding:5px 0;text-align:right;color:#141413;font-weight:600;">{{campaigns_count}}</td></tr>
<tr><td style="padding:5px 0;color:#6b6a63;">Salaire fixe <span style="color:#b0aea5;">({{currency}})</span></td><td style="padding:5px 0;text-align:right;color:#141413;font-weight:600;">{{salary_earned}}</td></tr>
<tr><td style="padding:5px 0;color:#6b6a63;">ROAS</td><td style="padding:5px 0;text-align:right;color:#141413;font-weight:600;">{{roas}}</td></tr>
</table>
</td></tr></table>
<p style="margin:0 0 18px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8880;">Calcul du ROAS&nbsp;: {{roas_note}}<br>Les écarts sont calculés par rapport au mois précédent. Un tiret &laquo;&nbsp;&mdash;&nbsp;&raquo; signifie qu'aucune comparaison n'est possible.</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td style="border-radius:999px;background:#141413;"><a href="{{dashboard_url}}" style="display:inline-block;padding:13px 28px;font-family:'Poppins',Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Voir mes campagnes</a></td></tr></table>
<p style="margin:20px 0 2px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;color:#6b6a63;">Au mois prochain,<br>L'équipe iGrowFast</p></td></tr>
<tr><td style="padding:22px 36px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e8e6dc;padding-top:18px;">
<p style="margin:0 0 5px;font-family:'Poppins',Arial,sans-serif;font-size:13px;font-weight:600;color:#141413;">iGrowFast<span style="color:#d97757;">.</span></p>
<p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b6a63;">Pilotez tout votre m&eacute;tier &mdash; commandes, livraisons, paiements et campagnes &mdash; au m&ecirc;me endroit.<br>Besoin d&rsquo;aide&nbsp;? <a href="mailto:support@igrowfast.com" style="color:#d97757;text-decoration:none;">support@igrowfast.com</a></p>
</td></tr></table>
</td></tr>
</table>
<p style="margin:14px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;color:#b0aea5;">&copy; iGrowFast &mdash; Tous droits r&eacute;serv&eacute;s.</p>
</td></tr></table>
</body>
</html>$html$,
  text_body = $txt$Votre bilan publicitaire de {{month_label}} — {{business_name}}

{{verdict_label}}
{{verdict_message}}

Commission du mois : {{commission_earned}} {{currency}}
Écart vs mois précédent : {{commission_delta}}

COMPARAISON AVEC LE MOIS PRÉCÉDENT {{prev_month_label}}
(ce mois / écart)
Dépense publicitaire ({{currency}}) : {{total_spend}} / {{spend_delta}}
Commandes livrées attribuées : {{delivered_orders}} / {{orders_delta}}
Commission ({{currency}}) : {{commission_earned}} / {{commission_delta}}

LE MOIS EN DÉTAIL
Campagnes : {{campaigns_count}}
Salaire fixe : {{salary_earned}} {{currency}}
ROAS : {{roas}}

Calcul du ROAS : {{roas_note}}
Les écarts sont calculés par rapport au mois précédent. Un tiret « — » signifie qu'aucune comparaison n'est possible.

Voir mes campagnes : {{dashboard_url}}

Au mois prochain,
L'équipe iGrowFast$txt$
WHERE key = 'monthly_performance_mediabuyer';

COMMIT;
