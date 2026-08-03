-- T23-D: wire the demand_received / demand_resolved emails.
--
-- Both templates exist and are active in public.email_templates but nothing fires them
-- today. This adds AFTER INSERT / AFTER UPDATE triggers on public.seller_demands and
-- public.mediabuyer_demands that hand off to the new supabase/functions/demand-notify edge
-- function via the existing public.app_invoke_edge(p_function_name, p_body) dispatcher (see
-- 20260629150000_revoke_app_invoke_edge_grants.sql for its signature/behavior: SECURITY
-- DEFINER, reads the service_role key from vault, net.http_post()s to
-- /functions/v1/<p_function_name> with that key as bearer). Same fail-open shape as the
-- auth.sessions login-alert trigger: the notification is wrapped in its own BEGIN/EXCEPTION
-- block so a dispatch problem can never roll back or block the demand insert/update.
--
-- demand_resolved fires once per logical answer: the two ways an answer can appear
-- (admin_response set, or status flipped to 'resolved') are OR'd inside a single trigger
-- function, so an UPDATE that does both in one statement still sends exactly one email.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_notify_demand_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM public.app_invoke_edge('demand-notify', jsonb_build_object(
      'table', TG_TABLE_NAME,
      'demand_id', NEW.id,
      'event', 'received'
    ));
  EXCEPTION WHEN OTHERS THEN
    -- Fail-open: a notification problem must never block the demand insert. Logged rather
    -- than swallowed silently — a notification that never fires and leaves no trace is the
    -- exact failure mode this system has already been bitten by.
    RAISE WARNING 'demand-notify (received) dispatch failed for %.%: %', TG_TABLE_NAME, NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_notify_demand_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.admin_response IS DISTINCT FROM OLD.admin_response AND coalesce(btrim(NEW.admin_response), '') <> '')
     OR (NEW.status = 'resolved' AND OLD.status <> 'resolved') THEN
    BEGIN
      PERFORM public.app_invoke_edge('demand-notify', jsonb_build_object(
        'table', TG_TABLE_NAME,
        'demand_id', NEW.id,
        'event', 'resolved'
      ));
    EXCEPTION WHEN OTHERS THEN
      -- Fail-open, but never silent (same reasoning as the insert trigger above).
      RAISE WARNING 'demand-notify (resolved) dispatch failed for %.%: %', TG_TABLE_NAME, NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Standing trap (Bucket A, 20260629440000): a SECURITY DEFINER trigger function is callable
-- as RPC via /rest/v1/rpc/<fn> unless EXECUTE is revoked from PUBLIC — triggers still fire
-- independently of EXECUTE privilege, so this only removes the RPC attack surface.
REVOKE EXECUTE ON FUNCTION public.tg_notify_demand_received() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_demand_resolved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_seller_demand_received ON public.seller_demands;
CREATE TRIGGER trg_notify_seller_demand_received
AFTER INSERT ON public.seller_demands
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_demand_received();

DROP TRIGGER IF EXISTS trg_notify_seller_demand_resolved ON public.seller_demands;
CREATE TRIGGER trg_notify_seller_demand_resolved
AFTER UPDATE ON public.seller_demands
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_demand_resolved();

DROP TRIGGER IF EXISTS trg_notify_mediabuyer_demand_received ON public.mediabuyer_demands;
CREATE TRIGGER trg_notify_mediabuyer_demand_received
AFTER INSERT ON public.mediabuyer_demands
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_demand_received();

DROP TRIGGER IF EXISTS trg_notify_mediabuyer_demand_resolved ON public.mediabuyer_demands;
CREATE TRIGGER trg_notify_mediabuyer_demand_resolved
AFTER UPDATE ON public.mediabuyer_demands
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_demand_resolved();

COMMIT;
