# iGrowFast — Public Website Brand Guidelines

> Source of truth for building the public marketing site. Colors and type are
> extracted verbatim from the product (`src/index.css`, `tailwind.config.ts`,
> `DESIGN.md`). The public site MUST use the same palette and type families as the
> app so the brand reads as one system across marketing → product.

---

## 1. Brand Personality

Light-first, Anthropic-adjacent restraint: **ink on cream with a single warm accent.**
Low chroma, high legibility, generous whitespace, quiet confidence. Brand is carried by
**typography and one accent**, not by tinted washes or gradients.

- Do: calm, editorial, premium, operational-credible.
- Don't: neon gradients, drop-shadow soup, multi-accent rainbows, dark hero-by-default.

---

## 2. Color

### Core palette (locked)

| Role            | Hex       | Use                                              |
|-----------------|-----------|--------------------------------------------------|
| Ink / text      | `#141413` | Body text, headings, **primary buttons/CTA**     |
| Ink soft        | `#2a2926` | Secondary dark surfaces, footers                 |
| Canvas / bg     | `#faf9f5` | Page background (default)                         |
| Paper           | `#ffffff` | Cards, elevated panels                           |
| Surface / line  | `#e8e6dc` | Borders, dividers, muted fills, input outlines   |
| Line soft       | `#f1efe8` | Hairline separators, subtle zebra                 |
| Mid             | `#b0aea5` | Placeholder, disabled, low-emphasis icons        |
| Muted text      | `#6b6a63` | Captions, meta, secondary copy                   |
| **Warm accent** | `#d97757` | Links, focus rings, highlights, accent chips     |
| Accent soft     | `#f4d9c9` | Accent backgrounds, badges                        |
| Destructive     | `#c96356` | Errors, destructive actions                      |

### Secondary accents (use sparingly — data/illustration only)

| Role         | Hex       | Soft       |
|--------------|-----------|------------|
| Cool / blue  | `#6a9bcc` | `#d7e3f1`  |
| Green        | `#788c5d` | `#dbe3cb`  |
| Rose         | `#c96356` | —          |

### Rules
- **Primary CTA = ink `#141413`** with cream text. Orange `#d97757` is an *accent*, not a button fill.
- One accent per view. Never gradient two brand colors together.
- Focus ring is always orange `#d97757`.
- Maintain WCAG AA: ink on canvas/paper passes; never put muted text on the accent.

### CSS variables (drop-in for the public site)

```css
:root {
  --ink:        #141413;
  --ink-soft:   #2a2926;
  --canvas:     #faf9f5;
  --paper:      #ffffff;
  --line:       #e8e6dc;
  --line-soft:  #f1efe8;
  --mid:        #b0aea5;
  --muted:      #6b6a63;
  --accent:     #d97757;
  --accent-soft:#f4d9c9;
  --destructive:#c96356;
  --radius:     0.75rem; /* 12px */
}
```

---

## 3. Typography

Loaded from Google Fonts (`display=swap`). Preconnect to `fonts.googleapis.com`.

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Lora:wght@400;500;600&display=swap" rel="stylesheet" />
```

| Role            | Family    | Weights         | Fallback stack                       |
|-----------------|-----------|-----------------|--------------------------------------|
| **Display / headings** | Poppins   | 400/500/600/700 | `Poppins, Arial, sans-serif`         |
| **Body / UI**   | Inter     | 400/500/600/700 | `Inter, system-ui, sans-serif`       |
| **Serif / editorial** | Lora | 400/500/600     | `Lora, Georgia, serif`               |

- Headings: Poppins, `letter-spacing: -0.01em`, weight 600–700.
- Body: Inter, weight 400–500, line-height 1.5–1.6.
- Lora reserved for editorial pull-quotes / long-form only. Not for UI.

### Suggested type scale (public site)

| Token   | Size / line-height | Family  | Weight |
|---------|--------------------|---------|--------|
| Hero    | 56–72px / 1.05     | Poppins | 700    |
| H1      | 40px / 1.1         | Poppins | 700    |
| H2      | 30px / 1.15        | Poppins | 600    |
| H3      | 22px / 1.25        | Poppins | 600    |
| Body-lg | 18px / 1.6         | Inter   | 400    |
| Body    | 16px / 1.6         | Inter   | 400    |
| Small   | 14px / 1.5         | Inter   | 500    |
| Caption | 13px / 1.4         | Inter   | 500 (muted color) |

---

## 4. Shape, Spacing, Elevation

- **Radius:** `--radius: 0.75rem` (12px). Buttons/inputs `md` = 10px, chips `sm` = 8px, cards `lg` = 12px.
- **Container:** centered, max width `1400px` (`2xl`), horizontal padding `2rem`.
- **Spacing:** 4px base grid. Section vertical rhythm 96–128px on desktop, 64px mobile.
- **Borders:** 1px `#e8e6dc`. Prefer borders over shadows.
- **Shadows:** subtle only — e.g. `0 1px 2px rgba(20,20,19,.04), 0 8px 24px rgba(20,20,19,.06)`. No heavy/colored shadows.
- **Motion:** ease `cubic-bezier(0.23, 1, 0.32, 1)` ("smooth"), 200–400ms. Respect `prefers-reduced-motion`.

---

## 5. Component Cues

- **Primary button:** bg `#141413`, text `#faf9f5`, radius 10px, hover → `#2a2926`.
- **Secondary button:** bg transparent, 1px `#e8e6dc` border, text ink, hover bg `#f1efe8`.
- **Accent/text link:** `#d97757`, underline on hover.
- **Card:** bg `#ffffff`, 1px `#e8e6dc` border, radius 12px.
- **Input:** bg white, 1px `#e8e6dc`, focus ring `#d97757`.
- **Badge/pill:** bg `#f4d9c9`, text `#141413` (accent) or bg `#f1efe8` for neutral.

---

## 6. Do / Don't

**Do**
- Cream `#faf9f5` page background by default; white cards float on it.
- Ink CTAs, orange accents, lots of whitespace.
- One idea per section, editorial hierarchy.

**Don't**
- Don't make orange the button fill.
- Don't stack multiple accent hues in one section.
- Don't use gradients between brand colors.
- Don't ship a dark hero as the default marketing look.
- Don't alter any hex or swap font families — layout/spacing/motion is where craft lives.
