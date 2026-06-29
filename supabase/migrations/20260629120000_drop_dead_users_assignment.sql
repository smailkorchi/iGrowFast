-- Phase 2: drop dead users.assignment (db #69). Round-robin auto-attribution weight.
--
-- The auto-attribution engine that consumed `assignment` was torn out (assign_id teardown,
-- migration 20260628180000). Left all-0 with ZERO DB-fn readers; only dangling UI remained
-- (Users "Order attribution" form field, Sellers "orders/day" KPI/display, explicit selects,
-- constant-0 writes). Phase 1 (commit 6b58016) removed every frontend ref + redeployed, so the
-- live site no longer selects the column. No FK/index/CHECK on assignment.
--
-- NB: orders.assignment_date (the seller-commission cohort window) is a DIFFERENT, live column.
-- Rollback: ALTER TABLE public.users ADD COLUMN assignment numeric DEFAULT 0;

ALTER TABLE public.users DROP COLUMN IF EXISTS assignment;
