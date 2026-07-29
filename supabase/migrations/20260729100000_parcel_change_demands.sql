-- Parcel change demands (TKT-8 follow-up): local source of truth for the
-- Coliaty parcel-change demands WE file. Created by the provider-integration
-- edge fn (service role) at demand creation; reconciled fail-open by the
-- provider-webhook when a payload referencing the demand ref arrives.
-- Coliaty documents no demand webhook, so status/raw stay tolerant.

BEGIN;

CREATE TABLE public.parcel_change_demands (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "DigiCom Business" uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id        uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    provider_id     uuid REFERENCES public.providers(id) ON DELETE SET NULL,
    tracking_code   text NOT NULL,
    ref             text NOT NULL,
    request_type    text NOT NULL CHECK (request_type IN ('CORRECT_INFORMATION', 'CHANGE_DESTINATION')),
    -- PENDING at creation; APPROVED/REJECTED when a webhook lets us conclude;
    -- UNKNOWN when a webhook referenced the demand without a recognizable verdict.
    status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'UNKNOWN')),
    provider_status_raw text,
    -- Snapshots at file time: old = order/parcel values then, new = requested.
    old_values      jsonb NOT NULL DEFAULT '{}'::jsonb,
    new_values      jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw             jsonb,
    created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    webhook_log_id  uuid REFERENCES public.webhook_logs(id) ON DELETE SET NULL
);

-- Composite: PCD refs are unique per Coliaty ACCOUNT (per provider row), not
-- globally — a cross-account ref collision must create a second row, never
-- overwrite another tenant's row via the service-role upsert.
CREATE UNIQUE INDEX parcel_change_demands_provider_ref_key ON public.parcel_change_demands (provider_id, ref);
CREATE INDEX idx_pcd_tracking_code ON public.parcel_change_demands (tracking_code);
CREATE INDEX idx_pcd_biz_created ON public.parcel_change_demands ("DigiCom Business", created_at DESC);
CREATE INDEX idx_pcd_order_id ON public.parcel_change_demands (order_id);

ALTER TABLE public.parcel_change_demands ENABLE ROW LEVEL SECURITY;

-- Tenant read-only: members see their business's demands. All writes go through
-- the service role (edge fns) — no INSERT/UPDATE/DELETE policy for users.
CREATE POLICY pcd_tenant_select ON public.parcel_change_demands
    FOR SELECT TO authenticated
    USING ("DigiCom Business" = (SELECT current_user_digicom_business_id()));

GRANT SELECT ON public.parcel_change_demands TO authenticated;

COMMIT;
