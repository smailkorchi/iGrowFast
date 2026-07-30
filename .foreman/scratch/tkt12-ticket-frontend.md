# TICKET F6 — adaptive delete dialog + archive UX (Users page)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), make the Users-page delete flow adaptive (hard delete vs archive with receipts) and give archived users their proper console presence. Contracts: RPC `user_deletion_profile(p_user_id)` returns `{commandes, paiements, colis, notes, campagnes, demandes, historique, total, hard_deletable}` (call via `supabase.rpc(...)` with the user's session — it self-gates); manage-users actions: `delete` (403s with French error when referenced), NEW `archive` `{action:'archive', userId}`, and update/set_password now refuse archived targets. House anatomy = the freshly unified dialog standard on this page (rounded-[20px], gradient hairline, icon tile, 12.5px serif description, max-h flex-col, French).

## EXPECTED OUTCOME
1. **Adaptive delete dialog** (replace the current confirmation at src/pages/admin/Users.tsx ~:761-805): on open, fetch the RPC (loading skeleton inside the dialog). Then one of two faces:
   - `hard_deletable: true` → the existing destructive face (rose gradient hairline, Trash2 rose tile): « Supprimer cet utilisateur ? » / « Action irréversible » → button « Supprimer définitivement » → existing delete mutation.
   - `hard_deletable: false` → the ARCHIVE face (ink/orange tile `Archive` icon, orange hairline): headline « Cet utilisateur a un historique d'activité », the receipts as a compact list showing ONLY non-zero categories with French labels + tabular counts (Commandes, Paiements, Colis, Notes, Campagnes, Demandes, Historique), an explanation line: « L'archivage désactive définitivement le compte et la connexion. L'historique et les attributions restent intacts. », primary button « Archiver l'utilisateur » → new mutation POSTing `{action:'archive', userId}`. NO hard-delete affordance on this face.
   - RPC error → error panel with message verbatim + « Fermer ».
   - Success paths: toasts « Utilisateur supprimé » / « Utilisateur archivé », invalidate the users list query.
2. **Archived presence**:
   - The users list query (~:402-416) gains `.is('archived_at', null)` by default; a filter control « Afficher les archivés » (house toggle/chip pattern near the search input) flips to a query INCLUDING archived (key the react-query cache on the toggle).
   - Archived rows render with a muted « Archivé » badge (Archive icon, `bg-ant-ink/5 text-ant-mid`) REPLACING the Live/Off pill, card visually muted (e.g. opacity-70), and the row-actions menu reduced to NOTHING actionable (render no dropdown, or a disabled state) — tombstones are view-only.
   - Select `archived_at` in the list query.
3. All copy French; states complete (dialog fetch loading/error, mutation pending, disabled buttons).

## VERIFY BEFORE REPORTING
`npx tsc -b` exit 0 (restore tsconfig.app.tsbuildinfo). `git status --porcelain -- src/` = write set only.

## MUST NOT
Touch supabase/** (sibling worker owns manage-users). Alter the other dialogs' anatomy. Spawn subagents.

## WRITE SET
`src/pages/admin/Users.tsx` (+ a small new component file under src/components/users/ if the adaptive dialog reads cleaner extracted — report it).

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; changes file:line; tsc tail; deviations.
