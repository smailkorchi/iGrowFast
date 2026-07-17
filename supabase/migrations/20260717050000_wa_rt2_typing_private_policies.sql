-- WA-RT-2 (2026-07-17): realtime auth for the wa-typing control channel (ban-safety).
-- The public wa-typing:<instance> channel let ANY authenticated seller (anon key +
-- instance UUID) publish 'attend' (pin the number ONLINE, defeating the ban-safe
-- offline revert) and 'open' (force peer presence-subscribe, bypassing the worker
-- throttle = the bot fingerprint that gets numbers BANNED). This adds the RLS layer
-- so that once the client + worker join wa-typing as private:true, only callers who
-- pass whatsapp.can_use_instance(instance) may receive OR publish — closing the
-- CROSS-tenant vector at the transport. (Same-business abuse is closed by the worker
-- 'open' rate-limit — see WA-RT-2 worker change.)
--
-- INERT until the channels go private: these policies govern realtime.messages, which
-- only mediates PRIVATE-channel broadcasts. While wa-typing stays public (client +
-- worker unchanged) they have zero effect. Additive/scoped: no existing INSERT policy
-- on realtime.messages, and the predicate returns false for non-wa-typing topics, so
-- other channels (wa:conv/biz/user, ecom:*) are unaffected. Worker publishes as
-- service_role (BYPASSRLS) — unaffected either way.
-- Owner: supabase_admin.

BEGIN;

-- Topic-parse gate, mirroring whatsapp.can_read_biz_topic (mig 035/051 pattern):
-- match `wa-typing:<uuid>` exactly, then delegate to the instance authz primitive.
CREATE OR REPLACE FUNCTION whatsapp.can_use_typing_topic(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  select case
    when p_topic ~ '^wa-typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then whatsapp.can_use_instance(substring(p_topic from 11)::uuid)
    else false
  end;
$function$;

-- Receive (SELECT) — authorized clients get typing/presence for their instance.
CREATE POLICY wa_typing_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (whatsapp.can_use_typing_topic(realtime.topic()));

-- Publish (INSERT/WITH CHECK) — authorized clients may broadcast attend/open.
-- Required because wa-typing is bidirectional (unlike the receive-only wa:* topics).
CREATE POLICY wa_typing_write ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (whatsapp.can_use_typing_topic(realtime.topic()));

COMMIT;
