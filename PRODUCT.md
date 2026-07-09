# Product

## Register

product

## Platform

web

## Users

Operators of Moroccan COD (cash-on-delivery) e-commerce businesses, using the tool
all day as their primary work surface. Multi-tenant, multi-role:

- **Sellers** — process and confirm orders, track deliveries and their own commission.
- **Media buyers** — manage ad campaigns/spend and see their attributed commission (never full margins/ROAS of others).
- **Couriers** — manage parcels and delivery statuses.
- **Super admins / admins** — run a business: users, finance, payouts, config.
- **Owner** — cross-business platform operator, confined to `/owner/*`.
- **WhatsApp agents** — work a shared multi-number WhatsApp inbox as the primary sales channel.

Context: high-volume, repetitive operational work in French (primary, `lang="fr"`) with
Arabic/RTL content in customer-facing data and messaging. Users switch between dense
tables, forms, dashboards, and a live chat inbox many times per session.

## Product Purpose

iGrowFast is the operational backbone for COD e-commerce: "pilotez votre e-commerce sans
dix onglets" — run orders, logistics, ad spend, payouts, and WhatsApp sales from one place
instead of ten tabs and spreadsheets. Success = fewer clicks per order, correct money
(commission/payout ledgers that reconcile), and an inbox that scales to many numbers/agents
without the operator losing the thread. Design serves the workflow; it is not the product.

## Brand Personality

Calm, confident, precise. Warm but no-nonsense. The register is Anthropic-adjacent
restraint: ink-on-cream, one deliberate accent, high information density without noise.
It should feel trustworthy with money and logistics, fast for repetitive high-volume work,
and human enough for non-technical operators — never flashy, never ceremonial.

Three-word anchor: **calm · precise · efficient** (with a warm, approachable edge).

## Anti-references

- Generic SaaS gradient cliché: purple gradients, hero-metric templates, identical
  icon+heading card grids, decorative glassmorphism.
- Cluttered legacy ERP: dense grey enterprise panels, tiny fonts, overwhelming toolbars.
- Consumer social flashiness: animation-heavy, emoji-loud, bright startup consumer look.
- Spreadsheet-as-app: raw data grids with no hierarchy or summarization, everything equal weight.

## Design Principles

1. **Density with hierarchy.** Operators need a lot on screen; earn it with clear
   weight and rhythm, never a flat wall of equal-priority data.
2. **Money must read as trustworthy.** Financial figures, statuses, and reconciliations
   are precise, unambiguous, and never conveyed by color alone.
3. **Role-appropriate truth.** Each role sees exactly its slice (MB hides ad spend and
   others' margins; owner is confined). The UI reflects the permission model, not a superset.
4. **Speed over ceremony.** Minimize clicks and decoration for repetitive work; keyboard
   and bulk actions beat pretty transitions.
5. **Identity is fixed.** The existing color tokens and type families are locked brand
   assets (see DESIGN.md). Craft happens in layout, hierarchy, motion, and states — not palette.

## Accessibility & Inclusion

- Target **WCAG 2.1 AA** contrast on body and interactive text.
- **Bilingual FR/AR with full RTL** support (arabic-reshaper + bidi-js already in stack);
  layouts must not break under RTL.
- **Reduced motion** honored on every animation via `prefers-reduced-motion` alternatives.
- **Color-blind safe status:** order/package/payment statuses always carry a text label or
  icon in addition to color.
