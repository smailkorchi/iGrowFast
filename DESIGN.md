# Design

> **LOCKED IDENTITY.** The color tokens and type families below are the committed brand.
> They are captured verbatim from `src/index.css`, `tailwind.config.ts`, and
> `src/whatsapp/styles/whatsapp-base.css`. Do **not** change hue, value, or font family
> in any impeccable pass. Craft happens in layout, hierarchy, spacing, motion, and states.
> The main app and the WhatsApp inbox use the **same core palette** through two token
> namespaces; both must stay in sync.

## Theme

Light-first, Anthropic-adjacent restraint: ink-on-cream with a single warm accent.
Dense operational UI, low chroma, high legibility. A full `.dark` theme exists for the
main app. Brand color is carried by accent + typography, not by a tinted body wash.

## Color

Palette is shared. The main app maps it into shadcn HSL variables; the WhatsApp inbox
restates the identical hexes under its own `--color-*` namespace and adds two accents.

### Core palette (identical in both surfaces)

| Role         | Hex       | Main app token (HSL)        | Inbox token           |
|--------------|-----------|-----------------------------|-----------------------|
| Ink / fg     | `#141413` | `--foreground: 60 4% 8%`    | `--color-ink`         |
| Canvas / bg  | `#faf9f5` | `--background: 48 35% 97%`  | `--color-canvas`      |
| Surface      | `#e8e6dc` | `--secondary/--muted/--border: 47 25% 89%` | `--color-surface` |
| Muted fg     | —         | `--muted-foreground: 48 7% 50%` | `--color-muted: #b0aea5` |
| Card         | `#ffffff` | `--card: 0 0% 100%`         | (surface/canvas)      |
| Warm accent  | `#d97757` | `--accent/--ring: 17 60% 60%` | `--color-accent-warm` |
| Destructive  | `#c96356` | `--destructive: 8 52% 56%`  | —                     |

Primary CTA is **ink** (`#141413`), not the accent — orange is reserved for accents,
focus rings, and highlights.

### Inbox-only accents

| Role            | Hex       | Token                   |
|-----------------|-----------|-------------------------|
| Cool accent     | `#6a9bcc` | `--color-accent-cool`   |
| Natural accent  | `#788c5d` | `--color-accent-natural`|

### Dark theme (main app, `.dark`)

Canvas → `60 4% 8%` (`#141413`), fg → `48 35% 97%`, card `60 4% 12%`, surface `60 4% 16%`,
accent unchanged (`17 60% 60%`), borders/inputs at `48 35% 97% / 0.08`. Sidebar runs a
permanent dark shell (`--sidebar-background: 60 4% 8%` in light too).

## Typography

Three Google families, loaded in `index.html`, mapped in `tailwind.config.ts`:

- **Inter** — `font-sans`, body/UI (weights 400–700).
- **Poppins** — `font-display`, headings h1/h2/`.font-display` (400–700), `letter-spacing: -0.01em`.
- **Lora** — `font-serif` / `.font-serif-display`, serif display accents (400–600).

Anthropic surface scaffolding is scoped via `.ant-surface` so redesigned surfaces
(Dashboard, Sidebar) share the aesthetic while legacy pages keep their existing look.

## Radius & Elevation

- `--radius: 0.75rem`; Tailwind `lg = var(--radius)`, `md = radius-2px`, `sm = radius-4px`.
- Thin custom scrollbars (`.ant-scroll`, 6px, `#e8e6dc` thumb → `#b0aea5` hover).

## Components

shadcn/ui (`style: default`, base color `slate`, Lucide icons) over Radix primitives —
full set present (dialog, dropdown, select, tabs, toast, tooltip, popover, etc.).
Two visual systems coexist deliberately:

- **Main app** — shadcn HSL tokens; `.ant-surface` opt-in for the Anthropic redesign.
- **WhatsApp inbox** (`src/whatsapp/`) — isolated `.wa-root` / `.wa-mgmt` scoped CSS
  (`styles/whatsapp-base.css` + per-route CSS), ported 1:1 from WhatsApp Mancer.
  Keep the inbox's token namespace and scoping; do not merge it into the app's tokens.

## Motion

Reduced-motion is required on every animation (`prefers-reduced-motion`). Ease-out curves,
no bounce. `cobe` (globe), `motion`/framer available. Motion is restrained by register:
operational speed over decoration.

## Localization

`lang="fr"`, French primary. Arabic/RTL supported via `arabic-reshaper` + `bidi-js`;
layouts must survive RTL. Status is never color-only (color-blind + clarity).
