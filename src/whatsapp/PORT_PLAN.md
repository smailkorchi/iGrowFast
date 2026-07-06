# WhatsApp inbox — isolated 1:1 port into the iGrowFast SPA

Source of truth: `/Users/ismailelqorchi/Desktop/WhatsApp Mancer/src/` (+ ssh wa-mancer for deployed truth).
Rule: copy VERBATIM, apply ONLY the enumerated transforms below. Never re-derive UI/interaction logic.

## Architecture (owner-confirmed)
- Isolated module `src/whatsapp/` — self-contained (own CSS/theme/components/queries), grafted as lazy routes.
- Reuse IGF's SINGLE supabase client + AuthProvider/session (NO second client → no dup GoTrue session).
- Inbox renders pixel-identical (WA's own scoped CSS); distinct from IGF admin chrome (correct for an inbox).

## The transform recipe (identical to the audited worker/edge-fn port)
1. Data reads:  `supabase.from('<WA_TABLE>')`            → `supabase.schema('whatsapp').from('<WA_TABLE>')`
2. RPCs:        `supabase.rpc('<WA_FN>', …)`              → `supabase.schema('whatsapp').rpc('<WA_FN>', …)`
3. Realtime:    `.on('postgres_changes',{schema:'public'`→ `{schema:'whatsapp'`
4. Client:      `import { supabase } from '../supabase'`  → module shim re-exporting IGF's client (cast permissive,
                exactly WA Mancer's own `supabase.rpc as unknown as …` pattern; row types from database.types).
5. Types:       `src/whatsapp/lib/database.types.ts` = WA's file (public block is WA-tables-only, 0 e-commerce),
                schema key relabeled public→whatsapp + a minimal empty `public` retained so the client's default
                schema stays valid and `.schema('whatsapp')` type-checks. Derived aliases (WhatsappInstance,
                ConversationDecrypted, WorkerHealthStatus, …) repointed to ['whatsapp'].
6. Env/edge:    NO change — `call()` in instancesApi.ts already POSTs to `${VITE_SUPABASE_URL}/functions/v1/*`
                with JWT-from-localStorage; IGF URL = api.igrowfast.com, all 21 edge fns deployed + E2E-proven.
7. Auth/profile: any `useAuth()/profile.role` from WA → IGF's auth context; role gating via IGF ProtectedRoute.
NON-WA `.from('users'/'businesses')` (if any appear in later pages) stay UNqualified (public).

## Page 1a manifest (Numbers list + Create + Pair — goal: pair a REAL number)
Data layer (foundation, shared by all pages):
- lib/database.types.ts            (relabeled)
- lib/supabase.ts                  (shim → @/lib/supabase)
- lib/instancesApi.ts              (transforms 1,2,4; call() unchanged)
- lib/queries/instances.ts         (transforms 1,2,3,4)
Presentation:
- routes/numbers/Numbers.tsx        + Numbers.css
- components/numbers/CreateInstanceDialog.tsx (114)
- components/numbers/InstanceCard.tsx (121)
- components/numbers/MetricsTiles.tsx (91)
- components/numbers/EmptyState.tsx (24)
- components/numbers/PairDialog.tsx (1057)  ← the pairing UX; war-hardened QR refresh, sync-progress, delete-unscanned
- styles/theme.ts (verbatim)
Route wiring: lazy `<AdminNumbers/>` under IGF admin routes at `/whatsapp/numbers` (super admin/admin).

## Gate for 1a (build → test → confirm, then 1b)
1. `npm run build` (tsc + vite) green — module compiles, IGF app unaffected.
2. Dev/preview: /whatsapp/numbers renders; MetricsTiles shows worker health (worker IS live).
3. LIVE: click "+ Ajouter", create → PairDialog opens → scan QR on a REAL phone → watch sync-progress →
   conversation history lands. Confirm instance row status=connected, worker claims the lease.
4. Confirm with owner. THEN page 1b (NumberDetail settings/stats).

## Later pages (unchanged order)
1b NumberDetail · 2 Conversations (admin inbox + shared parts.tsx/panels/conversations.css) ·
3 user/Whatsapp (agent, assignment-scoped) · 4 Contacts · 5 Assignment · 6 admin Dashboard · 7 Statistics ·
8 OWNER Log + Monitor (fleet — per blueprint, these go to owner not admin).
