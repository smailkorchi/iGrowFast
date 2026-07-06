# IGF design guide


# IGF Design System — Concrete Re-skin Guide

## 0. The one rule
IGF's admin skin is the "Anthropic" (`ant-*`) look, achieved with Tailwind utility classes + shadcn primitives (overridden inline) — NOT a component lib, NOT framer-heavy. Premium feel = hairline discipline (borders not shadows), editorial type (Poppins/Lora/Inter), `tabular-nums`, `rounded-full` pills, a `gap-px` hairline-grid KPI strip, and exactly three named shadows. Copy the class strings verbatim.

## 1. Tokens (Tailwind `ant-*`, static — same in light/dark, do NOT theme-flip)
- Neutrals: `ant-ink` #141413 (primary text + primary button fill), `ant-ink-soft` #2a2926, `ant-light` #faf9f5 (page bg), `ant-paper` #ffffff (card fill), `ant-line` #e8e6dc (ALL borders/dividers), `ant-line-soft` #f1efe8, `ant-mid` #b0aea5 (muted labels/icons/placeholders), `ant-muted` #6b6a63 (secondary text).
- Single accent: `ant-orange` #d97757 (dots, focus ring, section numbers, active) + `ant-orange-soft` #f4d9c9.
- Semantic only: `ant-green` #788c5d (success/live/positive) + `ant-green-soft`; `ant-rose` #c96356 (destructive/error/critical); `ant-blue` #6a9bcc (info) + `ant-blue-soft`. Never add a new hue.
- Radius ladder: `rounded-2xl` cards/dialogs/containers, `rounded-full` buttons+pills+chips+search, `rounded-xl` inputs+dropdowns+list items, `rounded-lg` tiny icon tiles. (`--radius` = 0.75rem.)
- Fonts (enforced by `.ant-surface`): `font-sans`=Inter (body), `font-display`=Poppins (ALL headings/numbers/semibold labels, tracking -0.01em), `font-serif`=Lora (used `italic` for descriptive subtext). Custom easing `ease-smooth` = cubic-bezier(0.23,1,0.32,1).
- Elevation vocabulary = THREE named shadows ONLY (never Tailwind `shadow-md/lg`): card hover `hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.18)]`; dropdown/popover `shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]`; dialog `shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]`.

## 2. Surface scope — MANDATORY opt-in
The look is SCOPED to `.ant-surface`. Page root MUST carry `ant-surface` or fonts + `#faf9f5` bg won't apply (`html:has(.ant-surface)` paints the overscroll gutter). Long scroll regions add `ant-scroll`. Import `cn` from `@/lib/utils` for conditional classes; lucide-react icons imported individually.

## 3. Page shell + editorial header (every admin page opens with this)
Root: `<div className="ant-surface min-h-screen">` then inner `<div className="px-4 md:px-8 py-6 md:py-8 space-y-6">` (`space-y-6` = the section rhythm). The layout (`AppLayout`) already gives `p-4 md:p-6` and NO max-width clamp — pages are full-bleed and self-pad.
Header block: `<header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">`
- Eyebrow: `<div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">` with leading `<span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />` + label.
- Title: `<h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">`.
- Subtitle: `<p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">`.
- Primary action button sits on the right of the header row.
The orange-dot eyebrow recurs on section heads, dialog heads, KPI labels. "Chapter" section heads swap the dot for a `<span className="font-display text-ant-orange font-semibold">01</span>` two-digit number.

## 4. KPI / stat strip (the signature hairline-grid trick)
Container: `<section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">` — `gap-px` over an `ant-line` bg + white `bg-ant-paper` cells = 1px seams inside one bordered frame. Adjust `grid-cols-*` to tile count.
Accent map (copy verbatim from Products.tsx L97 / Users.tsx L270):
```
const KPI_ACCENTS = {
  ink:    { dot: 'bg-ant-ink',    tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
  orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
  green:  { dot: 'bg-ant-green',  tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
  rose:   { dot: 'bg-ant-rose',   tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;
```
Single tile markup:
```
<div className="bg-ant-paper p-4">
  <div className="flex items-start justify-between gap-3">
    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
      <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />{label}
    </div>
    <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
      <Icon className="w-4 h-4" strokeWidth={1.75} />
    </div>
  </div>
  <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
    {value}<span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span>
  </p>
</div>
```
All numbers ALWAYS `tabular-nums font-display`; money/unit suffixes in a `text-ant-mid font-normal` sub-span. Icon strokeWidth 1.75.

## 5. Cards, pills, containers
- Container/table frame: `rounded-2xl border border-ant-line bg-ant-paper overflow-hidden`; dividers `border-ant-line`; header rows `bg-ant-light/50`; hover rows `hover:bg-ant-light/60 transition-colors`.
- Premium hover-elevation card: `relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper group transition-all hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.18)]`, topped by a status stripe `<div className={cn('h-[3px] w-full', stripe)} />` (green/orange/rose/`bg-ant-line`).
- Status/value pill (recurs everywhere): `inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums` + leading `<span className="h-1.5 w-1.5 rounded-full" />` dot. Color triads: green `bg-ant-green/10 border-ant-green/25 text-ant-green` (dot `bg-ant-green`); orange `/10 /25` for warn/in-progress; rose for critical; ink/mid for neutral. Data-driven DB colors use inline `style={{ backgroundColor: color+'12', borderColor: color+'40', color }}`.
- Avatar disc: `h-9 w-9 rounded-full bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink font-display font-semibold text-[12px]`.

## 6. Buttons (pages OVERRIDE shadcn variants via className)
Base primitive `import { Button } from '@/components/ui/button'` (variants default/destructive/outline/secondary/ghost/link; sizes default/sm/lg/icon; base `rounded-md`, `[&_svg]:size-4`). Admin recipes:
- Primary (ink pill): `bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer`. Idle icon often `<Sparkles className="w-3.5 h-3.5"/>`; loading `<Loader2 className="w-3.5 h-3.5 animate-spin"/>`.
- Secondary/outline: `variant="outline"` + `h-10 px-5 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 cursor-pointer disabled:opacity-60`.
- Ghost/cancel: `variant="ghost"` + `h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer`.
- Destructive: `bg-ant-rose hover:bg-ant-rose/90 text-white ...`. Success: `bg-ant-green hover:bg-ant-green/90`. Icon buttons `variant="ghost" size="icon" h-9 w-9 rounded-full hover:bg-ant-ink/5`.
- Pill segmented control: container `inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper`, each `rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer`, active `bg-ant-ink text-white`, inactive `text-ant-mid hover:text-ant-ink`.
Universal: `rounded-full`, `text-[12px] font-semibold` (or `text-[11px]` small), explicit `cursor-pointer`, icons `w-3.5 h-3.5`/`w-4 h-4` strokeWidth 1.75.

## 7. Inputs / labels (per-page consts)
```
inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40'
labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid'
```
Inputs are `rounded-xl` (not primitive rounded-md), thin `ring-1 ring-ant-orange/40` focus. Search: wrap `relative`, absolutely-position `<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid"/>`, input `pl-9 rounded-full`. Forms use react-hook-form + zod with shadcn `Form/*` from `@/components/ui/form`; `FormItem` `space-y-1.5`, `FormMessage className="text-ant-rose"`.

## 8. Dialogs (`import { Dialog, DialogContent, ... } from '@/components/ui/dialog'`)
Controlled: `<Dialog open={!!x} onOpenChange={(o)=>!o && setX(null)}>`. Shell overrides:
```
<DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
```
`p-0` kills default padding; sizes `max-w-md` (confirm), `max-w-3xl` (form, add `max-h-[92vh] flex flex-col`, body scrolls `ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6`). Anatomy: optional top accent `<div className="h-[3px] w-full bg-ant-green|bg-ant-rose"/>`; `DialogHeader` styled `px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5` with orange-dot eyebrow + `DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink"` + `DialogDescription className="font-serif italic text-[13px] text-ant-mid"`; body `px-6 py-5`; `DialogFooter className="px-6 py-4 border-t border-ant-line gap-2"` with ghost-cancel + colored-confirm. Form section heads use the `font-display text-ant-orange 01` numbered eyebrow. (Dialog primitive auto-includes an X close top-right + `bg-black/80` overlay.) Custom confirm flows can use `ConfirmDialog` from `@/components/ui/confirm-dialog` (tone danger/warning/info).

## 9. Empty / skeleton / toast / motion
- Empty state: `rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center`, centered `w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25` icon medallion (`<Icon className="w-5 h-5 text-ant-orange" strokeWidth={1.75}/>`), `font-display text-[18px] text-ant-ink tracking-tight` headline, `font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto` copy that switches on filtered-empty vs truly-empty, optional primary button.
- Skeleton: `import { Skeleton } from '@/components/ui/skeleton'` (`animate-pulse rounded-md bg-muted`) sized e.g. `h-56 rounded-2xl` / `h-14 rounded-2xl`; wrap KPI skeletons in the SAME `gap-px bg-ant-line rounded-2xl border` frame so loading matches loaded.
- Toasts: `import { useToast } from '@/hooks/use-toast'` (78 consumers; NOT sonner). `const { toast } = useToast(); toast({ title, description })`; errors add `variant: 'destructive'` (variants default/success/warning/destructive). Fire from react-query onSuccess/onError.
- Motion (framer-motion, restrained): entrance `<motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{duration:0.22}}>`, KPI stagger `delay:i*0.02`, section reveal `whileInView` `y:12 duration:0.35 viewport={{once:true}}`, collapsible `AnimatePresence` height 0→auto duration 0.25. Hover-lift via Tailwind `hover:-translate-y-[1px]` + shadow, NOT motion. No count-up libs — numbers are just `font-display font-semibold tabular-nums` + `.toLocaleString('fr-MA')`.

## 10. Two style layers — know which you're copying
`ui/` splits into (a) STOCK shadcn (HSL var tokens: button/dialog/input/select/dropdown/table/tooltip/badge/card) and (b) PREMIUM ant-* layer (toast/toaster/sonner/confirm-dialog). New premium pages mirror the ant-* language + the page recipes above (rounded-2xl, rounded-full pills, ant tokens, font-display titles, font-serif-italic subtext, the three shadows). Reference implementations to mirror 1:1: `src/pages/admin/Products.tsx`, `Customers.tsx`, `Users.tsx`.


# Numbers page re-skin spec


# WhatsApp Numbers page — per-element re-skin spec

## Ground truth (what changes vs what is frozen)
CRITICAL: WA already uses the IDENTICAL Anthropic palette — WA `theme.ts`/`app.css` define `--color-ink` #141413, `--color-accent-warm` #d97757 (=`ant-orange`), `--color-accent-natural` #788c5d (=`ant-green`), `--color-accent-cool` #6a9bcc (=`ant-blue`), canvas #faf9f5 (=`ant-light`), surface #e8e6dc (=`ant-line`), muted #b0aea5 (=`ant-mid`). The reskin is a DELIVERY-MECHANISM SWAP (WA scoped BEM CSS → IGF Tailwind + shadcn), not a color change. WA also uses Lora as BODY font; IGF uses Inter as body + Lora italic only for subtext — that IS a real change.

KEEP 1:1 (all data/logic — do NOT touch): every import from `../../lib/queries/instances` (`useInstances`, `useInstancesRealtime`, `useWorkerHealth`, `useInstance`, `useCreateInstance`, `usePairInstance`, `useDeleteInstance`, `useInstanceSyncMetrics`) and `../../lib/instancesApi` — all query keys, realtime channel subscriptions, mutation `meta:{silent:true}`, `onSuccess` cache patching, and every field read off `WhatsappInstance`/`WorkerHealthStatus`. Keep the WA util helpers `formatRelative` (`../../lib/relativeTime`), `formatElapsed`, `InstanceAvatar`, and `normalizeError` (`../../lib/toast/store`) as-is (pure format/logic). Keep the FR copy strings, the status/lifecycle label maps (`HEALTH_LABEL`, `StatusPill` LABEL, `LifecycleBadge` LABEL), the `needsPair`/`isConnecting`/`needsRepair`/`autoReconnect` derivations, the `Link to={/whatsapp/numbers/${id}}` routes, the CreateInstanceDialog validation (`trimmed`, `touched`, `canSubmit`), and the whole PairDialog phase machine (`phase` derivation, `refetchMs:2500 untilSynced`, auto-recover effect, sync-metrics tracker, `historySynced`/`stage`/`ready` logic, auto-advance).

DROP for these pages (delivery only): the `.wa-root` wrapper in `WhatsappNumbers.tsx` and `import './Numbers.css'` in `Numbers.tsx`; all WA BEM classes (`.numbers-page`, `.page-hero`, `.page__*`, `.metrics-grid`, `.metric-tile*`, `.numbers-grid`, `.instance-card*`, `.status-pill*`, `.lifecycle-badge*`, `.numbers-empty*`, `.instance-modal*`, `.pair-dialog*`, `.btn`/`.btn--primary`/`.btn--ghost`, `.form__input`); and all reliance on WA CSS vars (`var(--color-*)`, `var(--font-heading)`, `var(--font-body)`). Do NOT globally delete `Numbers.css`/`app.css`/`theme.ts` — the verbatim inbox still imports them; just stop referencing their classes/vars from the management pages. Replace WA `Toaster` on this page with IGF `useToast` from `@/hooks/use-toast` (the Numbers-page mutations are all silent, so the WA `Toaster` mount can be removed here; keep it only where the inbox needs it).

## WhatsappNumbers.tsx (mount)
Replace `<div className="wa-root"><AdminNumbers/><Toaster/></div>` with just `<AdminNumbers/>` (the page root itself becomes the `ant-surface`). Drop `import './styles/whatsapp.css'` and the WA `Toaster` import from this mount.

## Numbers.tsx — page shell + hero
Root `<section>` → `<div className="ant-surface min-h-screen"><div className="px-4 md:px-8 py-6 md:py-8 space-y-6">`. Keep `useInstancesRealtime()`, `useInstances()`, `useWorkerHealth()`, `primaryWorker`, `hasNone`, and the two `useState` (createOpen, pairId) exactly.
Hero header → the IGF editorial header:
```
<header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
  <div className="space-y-2">
    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
      <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />Admin · Connexions
    </div>
    <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">Numéros</h1>
    <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">Appairez des numéros WhatsApp Business, surveillez leur santé en temps réel, contrôlez la cadence.</p>
  </div>
  {!hasNone && (
    <Button onClick={() => setCreateOpen(true)} className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer">
      <Plus className="w-4 h-4" strokeWidth={1.75} />Ajouter un numéro
    </Button>
  )}
</header>
```
List section head → `<header className="flex items-center justify-between">` with `<h2 className="font-display text-[18px] text-ant-ink tracking-tight">Numéros connectés</h2>` and the count as a pill/`text-[12px] text-ant-mid tabular-nums` (`{isLoading ? '—' : \`${instances?.length ?? 0} au total\`}`).
Grid → `<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">` (replaces `.numbers-grid`), same map: `isLoading` → 3× `<InstanceCardSkeleton/>`, else `instances?.map(inst => <InstanceCard key={inst.id} instance={inst} onResumePair={setPairId}/>)`.

## MetricsTiles.tsx → IGF KPI strip (6 tiles)
Keep the `Props`, `HEALTH_LABEL`, the 6 `<Tile>` calls and their exact `worker?.*` field reads. Replace container + Tile with the IGF hairline-grid:
- Container: `<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">`.
- Add the `KPI_ACCENTS` map (§4 of guide). Rewrite `Tile` to the KPI tile markup (eyebrow row with dot + `text-[10px] uppercase tracking-[0.24em] text-ant-mid`, value `font-display text-[22px] font-semibold text-ant-ink tabular-nums`, sub `text-[12px] text-ant-mid`).
- Tile 1 (Worker): drive accent from health — `cool`(healthy)→`green`, `warm`(stale)→`orange`, `danger`(dead)→`rose`, else `ink`. Keep the health dot as the KPI icon-tile dot (`a.dot` via the accent). Value = `HEALTH_LABEL[...]` (string, still `font-display`).
- Tiles 2–6: value + sub map straight from the existing props (`queue_depth`/`${dispatching_count} en distribution`; `drain_rate_1m`/"par minute (fenêtre 1 min)"; `active_numbers`/`worker ${worker_id}`; `formatRelative(last_heartbeat_at)`/`v${version}`; `formatRelative(last_dispatch_at)`/`hostname`). Numeric tiles get an `Activity`/`Gauge`/`Radio`/`Clock`/`Send` lucide icon in the `a.tile` medallion, strokeWidth 1.75. Keep `queueDepth?` prop signature.

## InstanceCard.tsx → premium hover card
Keep every field read + `needsPair`/`isConnecting`/`autoReconnect`/`needsRepair` logic + the `Link` + the two SVG watchdog badges + the CTA `onClick` (preventDefault/stopPropagation/`onResumePair`). Reskin containers:
- Root: `<Link ... className="group relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper block transition-all hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.18)]">`.
- Replace `.instance-card__beam--{status}` with the top status stripe `<div className={cn('h-[3px] w-full', STATUS_STRIPE[instance.status])} aria-hidden/>` where connected→`bg-ant-green`, connecting→`bg-ant-orange`, error/disconnected→`bg-ant-rose`, pending→`bg-ant-line`.
- Body padding `p-4 space-y-3`. Head row: `<InstanceAvatar size={44} .../>` (keep) + title `<h3 className="font-display text-[15px] font-semibold text-ant-ink tracking-tight truncate">` + `wa_profile_name` `text-[12px] text-ant-mid truncate`. `worker_paused` chip → pill `inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid`.
- Meta row `flex flex-wrap items-center gap-1.5`: StatusPill + LifecycleBadge (see below) + watchdog badge. Repair badge → pill `bg-ant-rose/10 border-ant-rose/25 text-ant-rose`; Auto badge → `bg-ant-green/10 border-ant-green/25 text-ant-green` (keep the inline SVGs, size `w-3.5 h-3.5`).
- Phone row: number `font-display text-[18px] text-ant-ink tabular-nums`; placeholder `font-serif italic text-[13px] text-ant-mid`.
- Footer: `flex items-center justify-between border-t border-ant-line pt-3` two metrics, each label `text-[10px] uppercase tracking-[0.18em] text-ant-mid` + value `text-[12px] text-ant-ink tabular-nums` (keep `formatRelative`).
- CTA button (needsPair): `w-full h-9 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[11px] font-semibold cursor-pointer` (keep pending/reconnect label logic). Connecting shimmer → `flex items-center gap-2 text-[11px] text-ant-orange` with `<Loader2 className="w-3.5 h-3.5 animate-spin"/>`.
Skeleton: rebuild `InstanceCardSkeleton` with `import { Skeleton } from '@/components/ui/skeleton'` inside the same `rounded-2xl border border-ant-line bg-ant-paper` frame + `h-[3px] bg-ant-line` stripe; rows `Skeleton className="h-4 ..."` (widths 60/40/80/50%).

## StatusPill.tsx + LifecycleBadge.tsx → IGF pills (keep LABEL maps)
StatusPill: `<span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', STATUS_PILL[status])}>` + leading `<span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])}/>` + `{LABEL[status]}`. Map: connected→green triad, connecting→orange triad, pending→ink/mid neutral (`bg-ant-ink/6 border-ant-ink/15 text-ant-mid`, dot `bg-ant-mid`), disconnected→`bg-ant-mid/10 border-ant-mid/30 text-ant-muted`, error→rose triad.
LifecycleBadge: same pill shell; warming→orange, established→green, cooling→blue (`bg-ant-blue/10 border-ant-blue/25 text-ant-blue`), banned→rose. Keep the `LABEL[state]` text.

## EmptyState.tsx → IGF empty state (keep `onAdd`)
Drop the three-orb art. Replace with:
```
<div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
  <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
    <MessageCircle className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
  </div>
  <h3 className="font-display text-[18px] text-ant-ink tracking-tight">Aucun numéro WhatsApp connecté</h3>
  <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">Connectez un numéro WhatsApp Business pour commencer à recevoir des conversations. Appairez une fois, répartissez au sein de votre équipe. Reconnectez à tout moment.</p>
  <Button onClick={onAdd} className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"><Plus className="w-4 h-4"/>Ajouter un numéro</Button>
  <p className="text-[11px] text-ant-mid mt-3">L'appairage se fait par QR. Votre téléphone reste l'appareil principal.</p>
</div>
```

## CreateInstanceDialog.tsx → IGF Dialog (keep ALL logic)
Keep `useCreateInstance`, the two `useEffect` (focus/reset on open; ESC), `name`/`touched`/`inputRef`, `trimmed`/`error`/`canSubmit`/`submit`, `create.error` + `normalizeError`. Swap the hand-rolled backdrop/modal for shadcn `Dialog`:
- `<Dialog open={open} onOpenChange={(o)=>!o && onClose()}>` → `<DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">` (drop the custom `instance-modal__backdrop`/`__close`/`__beam` and the manual ESC listener since Dialog handles both; you may keep the ESC effect harmlessly).
- Header: `DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5"` with orange-dot eyebrow "Nouvelle connexion" + `DialogTitle className="font-display text-[20px] tracking-tight text-ant-ink"` "Ajouter un numéro WhatsApp".
- Body `<form onSubmit={submit} className="px-6 py-5 space-y-3">`: label `labelCls` ("Nom affiché") + hint `text-[11px] text-ant-mid`, `<Input ref={inputRef} className={inputCls} ... maxLength={80}>` (keep all handlers), error `<p className="text-[12px] text-ant-rose">`.
- Footer `DialogFooter className="px-6 py-4 border-t border-ant-line gap-2"`: ghost cancel (`variant="ghost" ... text-ant-mid hover:text-ant-ink hover:bg-ant-light rounded-full`) + primary submit ink pill `disabled={!canSubmit}` showing `{create.isPending ? 'Création…' : 'Créer et appairer'}` with `<Loader2 className="w-3.5 h-3.5 animate-spin"/>` when pending.

## PairDialog.tsx → IGF Dialog shell, keep the phase machine 1:1
Keep EVERYTHING logic-side: `useInstance(instanceId,{refetchMs:2500,untilSynced:true})`, `usePairInstance`, `useDeleteInstance`, `refreshKey`/`importOpen`/`continueClicked`, the `phase` derivation, all `useEffect` (kick pair, ESC, auto-recover on status transition), `handleCancel`, the `qr` fallback chain, `AnimatePresence`+`PhaseFade` framer transitions, and the whole `SyncingBody` (`useInstanceSyncMetrics`, tracker, `historySynced`, `stage`, `ready`, auto-advance) + `ReadyBody` + `ImportContactsModal`. Only re-skin chrome:
- Outer: wrap in shadcn `Dialog` (open when `instanceId != null`, `onOpenChange` guarded so it can't close during `phase==='syncing'` — mirror the existing `phase !== 'syncing'` backdrop guard + the disabled close button). `DialogContent` `p-0 rounded-2xl border-ant-line bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden`, width `max-w-lg` (qr/ready) / `max-w-[640px]` (syncing).
- Top progress stripe: `<div className={cn('h-[3px] w-full', phase==='syncing' ? 'bg-ant-orange animate-pulse' : phase==='ready' ? 'bg-ant-green' : 'bg-ant-line')}/>`.
- Header: `px-6 pt-6 pb-4 border-b border-ant-line` — eyebrow (orange dot, phase-specific text kept) + `font-display text-[20px] text-ant-ink` title with `{instance?.display_name}` and phone sub `text-[13px] text-ant-mid tabular-nums`; close button → ghost icon `h-9 w-9 rounded-full` disabled during syncing (keep the title/aria).
- QrBody: keep the QR `<img>` + shimmer + steps + refresh/cancel actions, but translate the inline `var(--color-*)` to ant hexes/classes: QR card `rounded-2xl border border-ant-line bg-white shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]`; "En attente du scan" chip → orange pill (`bg-ant-orange/10 border border-ant-orange/25 text-ant-orange`, pulsing dot `bg-ant-orange`); step number discs `rounded-full bg-ant-ink/5 border border-ant-line font-display tabular-nums`; step title `font-display text-[14px] text-ant-ink`, sub `font-serif italic text-[13px] text-ant-mid`; Cancel → outline rose pill (`border-ant-rose/28 text-ant-rose bg-white rounded-full`), Refresh → orange pill (`bg-ant-orange text-white rounded-full shadow-[0_8px_18px_-10px_rgba(217,119,87,0.6)]`). Keep the refresh spin/rotate SVG.
- SyncingBody: status strip → `rounded-xl` with `ready ? 'bg-ant-green/10 border-ant-green/25' : 'bg-ant-orange/10 border-ant-orange/25'`; the 3×2 metric grid → IGF KPI tiles (reuse the `Tile` atom but recolor via ant: numbers `font-display text-[1.7rem] font-semibold tabular-nums`, `accent`→ orange tinted `bg-ant-orange/8 border-ant-orange/25 text-ant-orange`, `warn`→ rose). Continue button → ink pill `is-ready` state, disabled `!canContinue`. Keep all metric field reads + copy.
- ReadyBody: keep avatar + green success ring/halo/check badge (already ant-green #788c5d), "Synchronisé" chip → green pill; seed card → `rounded-2xl border border-ant-line bg-ant-ink/2`, heading `font-display`, body `font-serif`; Skip → outline pill, Import → orange pill (keep `onSkip`/`onImport`). The `<code>` chips keep mono font (Fira Code) — acceptable, it's data-ish.
- Replace WA `--font-heading`→`font-display`(Poppins) and `--font-body`→ Inter (`font-sans`) throughout the inline styles (WA used Lora for body; IGF body is Inter).

## Detail page note
`InstanceCard` links to `/whatsapp/numbers/:id` (a detail management page, likely rendering `useInstanceStats`/`useDispatcherState`/`useRecentConversations`/`useInstanceAudit`/settings). It is ALSO a management page and should get the same treatment in a follow-up, but is out of scope for this element list. The inbox route (`/whatsapp/inbox/*`) stays verbatim WA — leave `.wa-root`, `Numbers.css`/`app.css`, and the WA `Toaster` intact there.
