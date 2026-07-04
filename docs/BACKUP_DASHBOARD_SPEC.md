# BUILD SPEC — `/owner/backups` "Sauvegardes & Restauration"

## SYNTHESIS DECISIONS (backbone + grafts, conflicts resolved)

- **Backbone = Direction C (editorial-enterprise):** single vertical scroll, numbered section cards reusing the approved `OwnerPlatformDashboard` "Vue d'ensemble" vocabulary verbatim. This is the de-risking move — owner already approved this language and rejected two prior attempts.
- **Graft from B (ops-control-room):** (1) a **sticky verdict+action bar** carrying a miniature verdict chip so the verdict survives the scroll — this closes C's single worst weakness (verdict lost on scroll). (2) Hero verdict that **names the single worst failing thing** in plain French, never a generic "problème". (3) Page-level **thin orange progress line** whenever any unit is active. (4) Restore safety: **outline-until-final** danger button, **focus-on-Cancel**, **hold-to-confirm**. (5) API honesty: `restore-drill` is NOT the restore job — a real `POST /api/restore` contract is specified below.
- **Graft from A (supabase-faithful):** (1) **rose (`ant-rose`) reserved exclusively** for the restore/failure flow — nowhere else on the page. (2) `drill_fresh` as the **single source of truth** that both renders the trust tile AND gates restore. (3) **3-second abort window** before the POST fires. (4) streams **grouped by server** with separator sub-headers.
- **Conflicts resolved:**
  - *Verdict persistence:* C loses it on scroll → adopt B's sticky mini-verdict bar. **Decision: keep it.**
  - *Restore endpoint honesty:* C conflated `restore-drill` with a live restore → **Decision: define real `POST /api/restore` with a mandatory dry-run `POST /api/restore/plan` step.**
  - *Time-window validation:* validate the **resolved instant** (date + HH:MM:SS) against `wal_min..wal_max`, not just the day.
  - *Manual-backup multi-select (C) vs single (A/B):* multi-select bloats the progress UX and was under-specified → **Decision: single job per run** (PITR keeps a full/incr sub-toggle). Owner re-runs the wizard for a second job.
  - *Actions placement:* C puts Actions last (section 05); B wants the CTA always reachable → **Decision: keep Actions as section 05 for the narrative, but the two primary buttons ALSO live in the sticky bar, always reachable.**

---

## A. PAGE SKELETON

Container: `max-w-[1200px] mx-auto px-6 md:px-8 py-8 bg-ant-light`, single column, `space-y-8`. Route: `/owner/backups`, owner-gated (same guard as other `/owner/*` pages).

### Header (editorial)
- Kicker row: `<span class="inline-block w-1.5 h-1.5 rounded-full bg-ant-orange">` + `text-[11px] font-sans uppercase tracking-[0.22em] text-ant-muted` → `PLATEFORME · SAUVEGARDES`. Right side: live "running now" chip (see B) + refresh clock `font-mono text-[11px] text-ant-mid` "MAJ il y a Ns".
- H1: `font-display text-[28px] md:text-[32px] font-semibold tracking-tight text-ant-ink` → **"Sauvegardes & restauration"**.
- Subtitle: `font-serif italic text-[15px] text-ant-muted` — restates the live verdict in words (bound, see B): e.g. *"Tout est sain — restauration prouvée, fenêtre de 6 jours."*

### Sticky verdict + action bar (grafted from B)
`sticky top-0 z-20 h-14 -mx-6 md:-mx-8 px-6 md:px-8 border-b border-ant-line bg-ant-light/80 backdrop-blur flex items-center justify-between`. Under it, a **1px full-width active line**: `h-px bg-ant-orange animate-pulse`, rendered only when `anyUnitActive`.
- Left: miniature verdict chip `rounded-full px-3 py-1 text-xs inline-flex items-center gap-1.5` with a leading dot; bg/text bound to verdict state (green-soft/orange-soft/rose-soft). Text = the verdict word only ("Protégé" / "Attention" / "Incident").
- Right: `[ Sauvegarder maintenant ]` primary ink pill (`rounded-full bg-ant-ink text-ant-light px-5 py-2.5 shadow-sm hover:opacity-90`) + `[ Restaurer ]` restore trigger (`rounded-full border border-ant-rose text-ant-rose px-5 py-2.5 hover:bg-ant-rose hover:text-ant-light`, disabled `opacity-40 cursor-not-allowed` when `!drill_fresh`).

### KPI verdict strip (hairline 1×5)
`grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line`. Each tile `bg-ant-paper p-4 flex flex-col gap-1`: accent bar `h-1 w-8 rounded-full` (colored per that tile's own health), label `text-[10px] uppercase tracking-[0.18em] text-ant-muted`, number `font-display text-2xl tabular-nums text-ant-ink`, sub `font-serif italic text-xs text-ant-muted`.

| # | Label | Value | Sub | Accent | Binds |
|---|---|---|---|---|---|
| 1 | POSTURE | Sain/Attention/Incident | "vérifié il y a Ns" | green/orange/rose | computed verdict |
| 2 | RESTAURATION | Prouvée / Non prouvée | "clone == live" | green / rose | `drill_fresh` |
| 3 | FENÊTRE PITR | span "6 j 04 h" | "à la seconde" | blue | `pitr.wal_min → now` |
| 4 | DERNIER DUMP | "il y a 7 h" | "nuit · chiffré" | blue / orange | newest `/api/backups` set stamp |
| 5 | STOCKAGE | "38 %" | "148 Go libres" | green/orange/rose | `disk.used_pct`, `disk.avail_bytes` |

### 01 · POSTURE — CE QUE NOUS PROTÉGEONS
Numbered section card: `rounded-2xl border border-ant-line bg-ant-paper overflow-hidden`, top accent bar `h-[3px] bg-ant-orange`. Header block `p-5 border-b border-ant-line`: `01` `font-display text-sm text-ant-orange` + title `text-xs uppercase tracking-[0.22em] text-ant-ink font-medium` + subtitle `font-serif italic text-sm text-ant-muted mt-1` → *"Six lignes de défense, de la seconde près à l'hors-site."*
Body `p-5`: **estate legend**, 6 rows, each `flex items-center justify-between py-2.5 border-b border-ant-line-soft`:
`◆ icon` + title + plain-FR one-liner (`text-sm text-ant-ink-soft`) + freshness dot + `text-ant-muted` "dernier: il y a …". Rows (icon lucide → copy):
1. `HardDrive` **PITR physique** — "octet près · toute seconde"
2. `FileArchive` **Dumps logiques** — "portable · chiffré age"
3. `Image` **Miroir stockage** — "fichiers clients · quotidien"
4. `Server` **Config (restic)** — "3 serveurs OS + stack"
5. `Key` **Secrets escrow** — "clés vault · age"
6. `Globe` **Sites 2 & 3** — "toolbox hebdo · Mac mensuel"
Freshness dot per row derives from the matching `heartbeats` stream(s).

### 02 · POINTS DE RESTAURATION — REVENIR EN ARRIÈRE
Accent `h-[3px] bg-ant-orange`. Subtitle *"Une chaîne continue. Choisissez un instant, pas un fichier."*
- **Recoverable window band:** label "Fenêtre récupérable", a `h-2 rounded-full bg-gradient-to-r from-ant-blue-soft to-ant-blue` full-width, ends captioned `wal_min` (left) and "maintenant" (right) in `font-mono text-[11px] text-ant-mid`. Binds `pitr.wal_min`, `pitr.wal_max`/now.
- **PITR chain timeline:** the last 6 `pitr.backups`. Full markers `w-3 h-3 rounded-full bg-ant-ink`, incr `w-2.5 h-2.5 rounded-full border-2 border-ant-mid bg-ant-paper`, connector `h-px bg-ant-line`. Each rendered from `type`, label under marker.
- **Table** (shadcn `Table`): columns Type · Étiquette · Début (`start` epoch→FR) · Durée (`stop-start`) · Taille DB (`db_bytes`) · Dépôt (`repo_bytes`) · État (`error` → rose `AlertTriangle`, else green `✓`). Each row has a ghost-pill `[ Restaurer ]` that deep-links the restore wizard pre-seeded with that set (disabled when `!drill_fresh`). Numbers `tabular-nums`, errors highlighted `bg-ant-rose-soft`.

### 03 · FLUX & SANTÉ — CE QUI TOURNE
Accent `h-[3px] bg-ant-orange`. Subtitle *"Huit flux, trois serveurs. Archivage WAL toutes les 60 s."*
- **Archiver mini-strip:** 3 tiles Archivés / Échoués / Dernier binding `archiver.archived`, `archiver.failed` (rose number if >0), `archiver.last`.
- **Streams table** (shadcn `Table`), grouped by server with `separator` sub-headers `— BOX — / — TOOLBOX — / — WHATSAPP —` (`text-[11px] uppercase tracking-[0.2em] text-ant-mid`). One row per `heartbeats` key. Columns: **Flux** (human label mapped from `host/job`) · **Serveur** · **Dernier** (relative from `iso`) · **Prochain** (computed from hardcoded cadence table) · **Fraîcheur** (`Progress h-1.5`, fill = `age_sec/max_age_sec`, green <70% / orange 70–100% / rose >100%; badge text À jour / En retard / Bloqué) · **État** (`units[job]==="active"` → `Loader2` spin `text-ant-blue` "En cours" + `log_tails` last line `font-mono text-xs text-ant-muted` under the row; else Idle dot).

### 04 · EXPORTS TÉLÉCHARGEABLES — EMPORTER UNE COPIE
Accent `h-[3px] bg-ant-orange`. Subtitle *"Dumps chiffrés, portables. Lien signé, 10 minutes."* Binds `/api/backups.sets`.
Per set: a `Collapsible` row — `stamp` (FR) · `bytes` · `files.length` fichiers · `[ ▾ fichiers ]` (expands per-file list: `name`, `size`, each with `[ ⤓ ]` calling `/api/download?key=` → open `url`, toast "lien valable 10 min") · `[ Télécharger ]` primary-ghost.

### 05 · ACTIONS
Accent `h-[3px] bg-ant-orange`. Subtitle *"Lancer une sauvegarde, ou — en dernier recours — restaurer."*
Two large tiles side by side: **Sauvegarder maintenant** (ink pill, `RotateCw`) opens the manual wizard; **Restaurer…** (rose outline, `AlertTriangle`) opens the restore wizard. Under the restore tile, `font-serif italic text-xs text-ant-rose`: *"Remplace les données en direct. Accès protégé."* When `!drill_fresh` the restore tile is disabled with a `Tooltip` (see D).

### Final ASCII wireframe

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  • PLATEFORME · SAUVEGARDES                        ● En cours · pgdump  MAJ 4s •  │  header
│  Sauvegardes & restauration                                                      │  Poppins 28-32
│  ⌊italic⌋ Tout est sain — restauration prouvée, fenêtre de 6 jours.              │  Lora italic
├────────────────────────────────────────────────────────────────────────────────┤
│ ● Protégé                              [ Sauvegarder maintenant ]  [ Restaurer ] │  STICKY bar
│ ───────────────────────── thin orange animate-pulse line if anyUnitActive ────── │
│ ┌────────┬────────┬────────┬────────┬────────┐  gap-px on ant-line               │  KPI 1×5
│ │▎POSTURE│▎RESTAU.│▎FENÊTRE│▎DERNIER│▎STOCK. │                                   │
│ │ Sain   │ Prouvée│ 6j 04h │ il y a │  38 %  │                                   │
│ │⌊12 s⌋  │⌊clone⌋ │⌊à la s⌋│ 7h nuit│⌊148Go⌋ │                                   │
│ └────────┴────────┴────────┴────────┴────────┘                                   │
│ ▔▔▔ 01  POSTURE — CE QUE NOUS PROTÉGEONS   ⌊six lignes de défense⌋               │
│   ◆ PITR physique   octet · toute seconde    ● Sain  dernier il y a 2m           │
│   ◆ Dumps logiques  portable · chiffré       ● Sain  dernier il y a 7h           │
│   ◆ Miroir stockage · Config · Secrets · Sites 2&3 …                             │
│ ▔▔▔ 02  POINTS DE RESTAURATION — REVENIR EN ARRIÈRE                              │
│   Fenêtre récupérable  wal_min ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ maintenant               │
│   Chaîne PITR   ●────●────●────○────○────○   (full=● incr=○)                     │
│   Type Étiquette Début Durée TailleDB Dépôt État        [ Restaurer ]            │
│ ▔▔▔ 03  FLUX & SANTÉ — CE QUI TOURNE                                             │
│   Archivés 1284 · Échoués 0 · Dernier il y a 41s                                 │
│   — BOX —     WAL archiver  il y a 41s  dans 19s  ▓▓▓▓░ ● En cours ⟳            │
│   — TOOLBOX — Restic        il y a 1j   dans 6j   ▓▓▓░░ ○ Idle                   │
│   — WHATSAPP— …                                                                  │
│ ▔▔▔ 04  EXPORTS TÉLÉCHARGEABLES                                                  │
│   2026-07-03T02:00Z  12.4 Go  4 fichiers  [▾ fichiers]  [ Télécharger ]          │
│ ▔▔▔ 05  ACTIONS                                                                  │
│   [ ⟳ Sauvegarder maintenant ]     [ ⚠ Restaurer… ] (disabled si !drill_fresh)   │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## B. LIVE-STATUS DESIGN

**Data fetching:** react-query/SWR. `/api/status` every **10 s**; tighten to **5 s** while `anyUnitActive`. `/api/backups` every **60 s**. Relative timestamps re-render client-side every **1 s** (no fetch). `tabular-nums` on every number; on refresh mutate in place (no layout jump). First mount only: `Skeleton` blocks shaped like each card.

**Headline verdict (single computed enum):**
```
anyUnitActive = Object.values(units).some(v => v === "active")
allFresh      = Object.values(heartbeats).every(h => h.fresh)
anyStale2x    = Object.values(heartbeats).some(h => h.age_sec > 2 * h.max_age_sec)
anyBackupErr  = pitr.backups.some(b => b.error)

Incident  if  !drill_fresh || disk.used_pct >= 90 || anyStale2x || anyBackupErr
Attention if  (not Incident) && ( !allFresh || disk.used_pct >= 80 || archiver.failed > 0 )
Sain      otherwise
```
Colors: Sain → `ant-green`/`green-soft`; Attention → `ant-orange`/`orange-soft`; Incident → `ant-rose`/`rose-soft`. Bound to: header subtitle text, KPI POSTURE tile, sticky mini chip.

**Name the single worst failing thing (grafted from B):** the header subtitle and POSTURE sub do NOT say "problème". Compute the first matching cause in priority order and print the sentence:
1. `!drill_fresh` → *"Restauration non prouvée ce mois-ci — lancez un test."*
2. `anyBackupErr` → *"Une sauvegarde a échoué — voir Points de restauration."*
3. `disk.used_pct >= 90` → *"Disque presque plein (N %) — risque pour les sauvegardes."*
4. `anyStale2x` / `!allFresh` → *"{flux} en retard depuis {durée}."* (worst-offender stream by `age_sec/max_age_sec`)
5. `archiver.failed > 0` → *"{N} archivages WAL échoués."*
Else → *"Tout est sain — restauration prouvée, fenêtre de {span}."*

**"Running now" indicator (from `units`):**
- Header live chip: rendered only if `anyUnitActive`. `inline-flex items-center gap-1.5 rounded-full bg-ant-orange-soft text-ant-orange px-3 py-1 text-xs` + `bg-ant-orange animate-pulse` dot + label "En cours · {jobLabel}" (first active unit).
- Sticky-bar 1px active line: `h-px bg-ant-orange animate-pulse` full-width, only when `anyUnitActive`.
- Section 03 row: active stream swaps État to `Loader2` + surfaces `log_tails[matchingFile]` last line.

**Per-stream last-run / next-run:** `Dernier` = relative from `heartbeats[key].iso`. `Prochain` = `lastRun + cadence`, cadence from a hardcoded map keyed by job (**WAL archiver 60 s, pgdump nightly 02:00, storage-mirror nightly, restic daily, drill monthly, toolbox pull weekly, Mac pull monthly**), rendered relative ("dans 19 s" / "dans 6 j" / next clock time). Freshness `Progress` fill = `age_sec/max_age_sec`.

**States:**
- **Loading (first mount):** `Skeleton` for header verdict, KPI strip, and each card body. No full-page spinner.
- **Empty:** `/api/backups` returns `sets: []` → section 04 shows `font-serif italic text-ant-muted` "Aucun export téléchargeable pour l'instant." `pitr.backups: []` → section 02 table empty row "Aucun point de restauration physique."
- **Error (fetch fail / non-200):** keep last-good data dimmed `opacity-60`; header refresh clock turns `text-ant-rose` "Échec MAJ — nouvel essai…"; toast (sonner) once. Never blank the page.
- **Forbidden (401/403):** whole page replaced by a centered card `Lock` + "Accès réservé au propriétaire." (defense-in-depth; route guard should already prevent reaching it).
- **aal2 needed for an action:** never blocks the read view; handled inside each wizard (see C/D).

---

## C. MANUAL-BACKUP WIZARD — "Sauvegarder maintenant"

`Dialog`, `max-w-lg`. `STEPS = [{label:"Quoi", icon:Layers},{label:"Confirmer", icon:ShieldCheck},{label:"En cours", icon:Activity}]` rendered as the `InviteUserWizard` numbered-dot row (active dot = `ant-orange`). Step index state. **Single job per run.**

### Step 1 — Que sauvegarder ?
Four big selectable tiles (`rounded-xl border border-ant-line p-4 hover:border-ant-mid`, selected = `ring-2 ring-ant-orange bg-ant-orange-soft`), **radio semantics (pick one)**. Each = icon + title + serif-italic plain line, mapped to real trigger job:

- **Physique / PITR** — `HardDrive` → default job `pitr-full`. When selected, a `RadioGroup` appears: **Complète** (`pitr-full`) / **Incrémentale** (`pitr-incr`) with helper *"Complète = repart de zéro, longue. Incrémentale = seulement les changements, rapide."* Tile line: *"Copie au niveau octet, restaurable à la seconde près. Reste sur nos serveurs."*
- **Logique / portable** — `FileArchive` → `pgdump`. *"Un fichier unique, chiffré, que vous pouvez télécharger et restaurer ailleurs. Plus lent, plus flexible."*
- **Stockage** — `Image` → `storage-mirror`. *"Les fichiers uploadés par vos utilisateurs."*
- **Configuration** — `Server` → `restic`. *"L'état des 3 serveurs : système et logiciels."*

**Physical-vs-logical explainer band** (always visible under tiles, `bg-ant-line-soft rounded-lg p-3 text-xs text-ant-muted`):
> *"Physique = revenir en arrière sur nos serveurs, précis à la seconde. Logique = une copie portable, chiffrée, que vous emportez ailleurs. Les deux tournent déjà automatiquement — ceci est un déclenchement manuel."*

Footer: `[← Retour]` disabled; `[Continuer →]` ink pill, disabled until a tile chosen.

### Step 2 — Confirmer
Recap: "Vous allez lancer : **{job label}**." `bg-ant-blue-soft` info `Alert`: *"Sans risque — une sauvegarde n'écrase jamais vos données."* If `units[job]==="active"`: `Alert` "{job} tourne déjà, elle sera relancée à la fin."
**aal2 handling:** trigger endpoints require aal2. If session is not aal2, this step swaps the primary button for `<InputOTP maxLength={6}>` ("Confirmez avec votre code d'authentification"), `Loader2` on verify; only after aal2 upgrade does the button reappear. Primary `[Lancer la sauvegarde]` (`Loader2` while POSTing `/api/trigger/{job}`).

### Step 3 — En cours
On `202`: dialog stays open. Poll `/api/status` at 5 s. Show target unit: `Loader2` spin + job label + indeterminate `Progress` + streaming `log_tails[jobFile]` last line `font-mono text-xs`. When `units[job]` flips `active→inactive` AND (a new set appears in `/api/backups` or `pitr.backups`) AND no `error` → green `CheckCircle2` "Terminée · {taille} · il y a Ns"; footer button → "Fermer"; for `pgdump` show inline `[Télécharger]`; sonner toast "Sauvegarde terminée.". On `error` → rose row + error text + `[Réessayer]`. Copy: dialog may be closed while running — job continues, visible in section 03.

Tone: calm, declarative, no hype. "Copie au niveau octet." not "Puissante protection !".

---

## D. RESTORE WIZARD — "Restaurer" (the dangerous control)

**Rose (`ant-rose`) reserved exclusively for this flow.** `AlertDialog` (non-dismissible backdrop, no outside-click close), `max-w-lg`, header bar `bg-ant-rose text-ant-light`. `STEPS = [Avertissement, Point, Filet, Confirmation, Exécution]`.

**Visibility / eligibility gate (before wizard exists):** the `[Restaurer]` buttons (sticky bar, section 05, per-row in 02) are **disabled** unless `drill_fresh === true`. Disabled → `Tooltip`: *"Indisponible : la restauration doit d'abord être prouvée par le test mensuel (drill). Dernier test échoué ou trop ancien."* with an inline `[Lancer un drill]` (triggers `restore-drill`). The wizard cannot be opened when `!drill_fresh`.

### Step 0 — Avertissement (blocking splash)
Full-width `bg-ant-rose-soft border border-ant-rose` panel, `AlertTriangle`, `font-display` "Ceci remplace vos données en direct." Body: *"La restauration écrit par-dessus la base de production actuelle. Toutes les données créées après le point choisi seront perdues, sauf sauvegarde de filet (étape suivante)."* Single `[J'ai compris, continuer]` rose-**outline**. **Default focus stays on Cancel/X** (grafted from B — prevents Enter-key advance).

### Step 1 — Choisir un point de récupération
`RadioGroup`, two mutually exclusive modes:
- **Depuis une sauvegarde listée** → `Select`/list of `pitr.backups` (same rows as §02): "Full · 03 juil 02:00 · 12.4 Go". Pre-selected if deep-linked from a §02 row.
- **Un instant précis (point-in-time)** → ant-themed `Calendar` (react-day-picker) with `disabled` matcher = days outside `[wal_min, wal_max/now]` + a time `Input` (HH:MM:SS, `tabular-nums`). **Validate the resolved instant** (date+time combined) against `wal_min..now`; if outside → field turns `border-ant-rose` + helper *"Hors de la fenêtre récupérable ({wal_min} → maintenant)."* Live echo: *"Cible : 30 juin 2026 à 14:32:07 (il y a 2 j 16 h)."*

The §02 recoverable-window band is repeated at the top of this step with a moving marker at the chosen instant, so the owner SEES where he lands.

### Step 2 — Sauvegarde de filet (pre-restore safety backup, forced)
Explicit, non-skippable. A `Switch` **defaulted ON and locked ON**: "Prendre une sauvegarde complète de l'état actuel avant de restaurer (obligatoire)." Copy: *"Si la restauration échoue, retour automatique à cet instant. C'est le filet de sécurité."* States it will run `pitr-full` first. Advancing triggers nothing yet.

### Step 3 — Confirmation (hard gate stack, strict order — cannot advance without clearing each)
1. **aal2 TOTP** — `<InputOTP maxLength={6}>`, "Authentification à deux facteurs requise." Backend rejects non-aal2 regardless.
2. **Consequence acknowledgement** — `bg-ant-rose-soft border-ant-rose` panel with **domain-specific copy (grafted from C):**
   > *"Les commandes, paiements et utilisateurs créés après {cible} seront définitivement supprimés. La base entière sera restaurée à l'état du {cible}."*
   Required checkbox: *"Je comprends que les données postérieures à cet instant seront remplacées."*
3. **Typed timestamp confirmation** — `Input` where the owner types the exact target string shown (`2026-06-30 14:32:07` or the set label). Compare strict-equal; mismatch → `border-ant-rose` + "Le texte ne correspond pas." Helper: *"Recopiez l'horodatage exact pour confirmer."*
4. **Final button** — `bg-ant-rose text-ant-light rounded-full w-full`, label **"RESTAURER VERS {cible} — REMPLACE LES DONNÉES"**, enabled only when 1+2+3 satisfied. **Outline-until-final (grafted from B):** every earlier action in the flow is rose-*outline*; solid rose appears ONLY here. On press: **hold-to-confirm 3 s** (press-and-hold, `Progress` fills the button) — release early aborts. After hold completes, a **3-second abort countdown (grafted from A)** with an `[Annuler]` `X` before the POST actually fires.

### Step 4 — Exécution
Locked view (no dismiss, no X while running). First calls **`POST /api/restore/plan` (dry-run)** and shows the plan summary, then on user's held confirm calls **`POST /api/restore`**. Ordered live checklist, each `Loader2 → CheckCircle2`, driven by `units` + `log_tails`:
1. "Sauvegarde de filet prise ✓" (label + download hint)
2. "Restauration en cours…" (`Progress` + log tail)
3. "Vérification post-restauration…"
Auto-rollback promise stated live: *"En cas d'échec, retour automatique à la sauvegarde de filet."* Success → green banner "Restauration terminée — base à l'état du {cible}." + sonner. Failure → rose banner "Échec — retour automatique effectué à l'état d'origine." + error tail.

### Backend contract the frontend needs (NEW — do not reuse `restore-drill`)
`restore-drill` proves a clone == live; it is NOT a live restore. Add:

**`POST /api/restore/plan`** (dry-run, aal2 required) — request:
```
{ "mode": "backup" | "pitr",
  "backup_label": "full-20260703" | null,   // when mode=backup
  "target_iso":   "2026-06-30T14:32:07Z" | null }  // when mode=pitr, must be within wal_min..wal_max
```
response `200`:
```
{ "ok": true,
  "resolved_target_iso": "2026-06-30T14:32:07Z",
  "within_window": true,
  "safety_backup_job": "pitr-full",
  "est_data_loss_after": "2026-06-30T14:32:07Z",
  "warnings": [ "…" ] }
```
`422` `{ ok:false, reason:"out_of_window", wal_min, wal_max }` when target invalid.

**`POST /api/restore`** (destructive, aal2 required) — request:
```
{ "mode": "backup" | "pitr",
  "backup_label": "full-20260703" | null,
  "target_iso":   "2026-06-30T14:32:07Z" | null,
  "confirm_timestamp": "2026-06-30 14:32:07",  // must equal what UI displayed; server re-validates
  "safety_backup": true }                      // must be true; server refuses false
```
response `202` `{ ok:true, restore_id, phases:["safety","restore","verify"] }`. Server enforces: aal2, `within_window`, `safety_backup===true`, `confirm_timestamp` matches resolved target. Progress observed via existing `/api/status` `units` (`restore` unit) + `log_tails`; on failure server auto-rolls-back to the safety backup and reports it. Frontend must surface `restore_id` for support.

---

## E. COMPONENT INVENTORY (files to create)

Route tree under the owner section (mirror existing `/owner/*` pages). Suggested `src/pages/owner/backups/` + `src/components/owner/backups/`.

- **`BackupsPage.tsx`** — route entry; owns react-query for `/api/status` + `/api/backups`; computes `verdict`, `anyUnitActive`, worst-offender sentence; renders header, sticky bar, KPI strip, sections 01–05; loading/empty/error/forbidden states.
- **`useBackupStatus.ts`** — hook: polls `/api/status` (10 s / 5 s when active), exposes typed status + derived `verdict`, `anyUnitActive`, `worstFailure`.
- **`useBackupSets.ts`** — hook: polls `/api/backups` (60 s); download helper hitting `/api/download?key=`.
- **`backupDomain.ts`** — pure logic: verdict enum, worst-offender sentence, stream label map (`host/job` → FR), cadence table, next-run computation, byte/duration/relative-time FR formatters.
- **`StickyVerdictBar.tsx`** — sticky mini verdict chip + 2 action buttons + active line.
- **`VerdictKpiStrip.tsx`** — 1×5 hairline KPI tiles.
- **`PostureCard.tsx`** (§01) — 6-row estate legend with freshness dots.
- **`RecoveryPointsCard.tsx`** (§02) — window band + PITR timeline + physical backups table with per-row Restaurer.
- **`PitrWindowBand.tsx`** — reusable gradient band + optional moving marker (used in §02 and restore step 1).
- **`StreamsCard.tsx`** (§03) — archiver mini-strip + server-grouped streams table with freshness `Progress` + live État.
- **`ExportsCard.tsx`** (§04) — collapsible dump sets + per-file presigned download.
- **`ActionsCard.tsx`** (§05) — two action tiles; wires both wizards; restore gate tooltip.
- **`ManualBackupWizard.tsx`** — Dialog, 3 steps, 4 job tiles, PITR full/incr sub-toggle, explainer band, aal2 OTP, post-trigger progress.
- **`RestoreWizard.tsx`** — AlertDialog, steps 0–4, gate stack, hold-to-confirm + 3 s abort, plan+restore calls, live phases.
- **`HoldToConfirmButton.tsx`** — custom press-and-hold button filling a `Progress` over 3 s; fires callback on completion, aborts on early release.
- **`AbortCountdown.tsx`** — 3 s countdown with Annuler before firing the POST.
- **`TotpGate.tsx`** — reusable `InputOTP` aal2 upgrade (shared by both wizards).
- **`FreshnessBar.tsx`** — `Progress` colored by `age_sec/max_age_sec`.
- **`backupsApi.ts`** — typed client: `getStatus`, `getBackups`, `getDownload`, `trigger(job)`, `restorePlan`, `restore`.
- **`types.ts`** — TS interfaces for `/api/status`, `/api/backups`, restore plan/exec payloads.

Reused shadcn primitives (no new deps): `dialog`, `alert-dialog`, `tabs`(not used — single scroll), `badge`, `progress`, `tooltip`, `skeleton`, `input-otp`, `table`, `select`, `switch`, `radio-group`, `collapsible`, `calendar`, `scroll-area`, `separator`, `sonner`. Icons (lucide): `HardDrive, FileArchive, Image, Server, Key, Globe, ShieldCheck, ShieldAlert, Activity, Layers, Loader2, CheckCircle2, AlertTriangle, Lock, RotateCw, Download, Clock, CalendarClock, ArrowLeft, ArrowRight`.

**Design invariants to enforce in review:** rose (`ant-rose`/`rose-soft`) appears ONLY in the restore wizard + failure states; every subtitle is `font-serif italic`; every number `tabular-nums`; verdict is reachable at all scroll positions via the sticky chip; the restore final button is the only solid-rose element and only enabled after all gates; `restore-drill` is never called as a restore.