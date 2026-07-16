# Copy rules — igrowfast.com

Binding constraints on every word that ships on the public site. Each one traces
to a primary source in `../docs/website-recon/`. These are not style preferences.

---

## 1. Money flow — the copy IS the offence

Morocco, Loi 103-12 **Art 182**: holding out as a payment institution is punishable by
**3 months to 1 year imprisonment + 20,000–200,000 MAD**. Art 183 bites when money
actually moves. The offence under Art 182 is the *representation*, not the transaction —
so this is a copywriting constraint, not an engineering one.

| Never write | Write instead |
|---|---|
| "we pay your sellers" | "track what each seller is owed" |
| "wallet" | "balance", "statement" |
| "payouts" | "settlement records", "reconciliation" |
| "escrow" | — (no equivalent; do not imply custody) |
| "we handle your COD cash" | "we reconcile your COD cash" |

The product **tracks and reconciles**; it does not hold, move, or disburse funds.
Every sentence must remain true of a ledger.

> Note: the app itself has a `/seller/wallet` route. The marketing site must **not**
> mirror that vocabulary. Internal route names are not public claims.

---

## 2. WhatsApp / Meta

Meta Business Verification is a hard gate **before** App Review, and the website is a
submitted verification field — a reviewer reads this site while deciding.

- **Never** "built on the WhatsApp Business Platform", "official Cloud API",
  "Meta Partner", "official WhatsApp integration". All false today. A reviewer reading
  an official-API claim from an unapproved applicant infers either misrepresentation or
  unofficial-access use — the second is an independent basis for denial.
- **Never** the WhatsApp logo. The nominative-use carve-out explicitly withholds a
  general third-party marketing licence.
- **Never** WhatsApp chrome (`#25D366`) or a pixel clone of WhatsApp's UI.
- ✅ **"Works with WhatsApp"**, in text, as an adjective.
- Demos show **iGrowFast's own inbox** in the brand palette — which is what is
  actually being sold.

Only demo features the **official Cloud API supports**. Specifically **not**:
message edit, message delete (neither is available to a business in any form).
Typing indicators are supported. Groups are supported but capped at 8 participants.

---

## 3. The entity

- ✅ "iGrowFast LLC, a Wyoming limited liability company."
- **Never** name a founder, member, or organizer.
- **Never** publish the EIN.
- **Never** imply a US team, US office, US HQ, or US data storage. Processing happens
  on servers in **Germany**, and the privacy policy must say so plainly.
  Google Ads bans "an inaccurate business name that does not clearly represent the
  advertised business" — enforced by suspension **on detection, without warning,
  permanently**. The entity is real; the risk is entirely in overstated copy.
- The Sheridan address is the **registered address**. Never "our office".

---

## 4. Third-party names

- **Never** imply partnership, endorsement, sponsorship, or affiliation with anyone.
- Google marks: adjective + generic noun, ™ on first use, no logos without a granted
  Brand Permission Request. Attribution line required in the footer.
- **Never** "Powered by Claude" (needs Anthropic's prior written permission) or
  "Powered by GPT" (prohibited outright). If AI must be named:
  "iGrowFast is built on OpenAI and Anthropic technology."

---

## 5. Claims

- **No testimonials, case studies, or growth numbers** without a substantiation file.
  16 CFR 465: fake or AI-generated reviews carry **$53,088 per violation**.
  16 CFR 255 additionally requires typicality and material-connection disclosure.
- **No security or encryption claim** unless literally true end-to-end. Disclosure
  belongs in `/privacy`, never in marketing.
- **No price anywhere.** Plans are contact-sales. Any published price triggers the full
  ROSCA checkout stack and California ARL auto-renewal consent — and California's remedy
  for getting it wrong is that the goods are deemed an **unconditional gift**: a refund
  of everything ever charged.
- **Hermes does not exist.** It may appear **only** as an explicitly labeled
  "coming soon" — never in a feature list, never in a demo, never as shipping today.

---

## 6. Accessibility

WCAG 2.1 AA is a **target**, not a claim. Never repeat an overlay vendor's compliance
claim — the FTC fined accessiBe **$1M** for exactly that.
