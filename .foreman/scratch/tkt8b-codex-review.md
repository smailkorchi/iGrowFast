Adversarial cross-review of an UNCOMMITTED feature (read-only sandbox; review subject = working-tree diff vs HEAD plus the untracked migration file). Try to REFUTE correctness — real defects only.

FEATURE: "Parcel change demand lifecycle" — persist Coliaty parcel-change demands we file (new table), reconcile their status from webhooks tolerantly, and render them as diff cards in the parcel tracking modal.

SURFACES (run `git diff`, `git status`; read the untracked migration):
1. supabase/migrations/20260729100000_parcel_change_demands.sql — new table `parcel_change_demands`, tenant SELECT-only RLS (writes = service role only), unique ref index.
2. supabase/functions/provider-integration/index.ts — in `create_parcel_change_demand`: `assertParcelChangeAccess` now returns {userId, businessId, parcelOrderId}; after adapter success a FAIL-OPEN upsert (onConflict ref) records the demand with old_values (orders row snapshot: phone/name/price/address + master_cities name embed) and new_values (submitted; city stored as human label via package_city_label).
3. supabase/functions/provider-webhook/index.ts — new fail-open branch before status matching: PCD-ref regex (uppercased, no trailing hyphen), verdict from STATUS-ish fields first (whole-payload fallback), first-conclusion-wins (verdict update gated .in PENDING/UNKNOWN), no-verdict → UNKNOWN only-if-PENDING, always provider_status_raw/resolved_at/webhook_log_id; early return `demand_reconciled` when the payload carries no status candidates (duplicate of the pipeline's candidate list); otherwise normal pipeline untouched.
4. src/components/orders/ParcelTrackingDialog.tsx — demands query (gated open, keyed by tracking code, defensive users embed), timeline interleave by created_at, monochrome diff cards, « Infos modifiées » chip when APPROVED exists.
5. src/components/orders/ParcelChangeDemandDialog.tsx — sends package_city_label; invalidates ['parcel-change-demands', trackingCode] on success.

KNOWN + ACCEPTED (do not re-report): duplicated status-candidate list can diverge from the pipeline's (commented); demand cards render only when tracking history exists; isLast highlight stays on provider events; UNKNOWN whole-payload verdict fallback when no status fields exist; migration not yet applied (deploy step follows); `(supabase as any)` for the untyped new table; the older TKT-8 findings already dispositioned.

ATTACK: SQL/RLS holes in the migration (policy scope, grants, FK cascades); the upsert (can a retry cross businesses via ref collision? onConflict semantics vs RLS-off service role); webhook branch (can it corrupt normal status flow? early-return misfires? biz scoping with unquoted .eq on "DigiCom Business"?); frontend merge (date parsing edge cases, key collisions in React lists, demand data leaking across parcels via query cache); the package_city_label seam (edge forwards to Coliaty? check the adapter payload builder doesn't include it); TypeScript hazards tsc misses.

OUTPUT: first line PASS / FAIL / PASS_WITH_NOTES; findings ranked with file:line + concrete failure scenario + one-line fix. Say explicitly if nothing material refutes.
