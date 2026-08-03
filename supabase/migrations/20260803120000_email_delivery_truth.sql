-- Email delivery truth (T22).
--
-- Until now public.email_log recorded a row only at two moments: an SMTP throw, or a
-- successful handoff. "sent" therefore meant "our own Stalwart accepted the submission",
-- not "the recipient's server accepted the message" — a real bounce 6 seconds later left
-- the row saying 'sent' forever, and ten other failure branches wrote nothing at all.
--
-- This migration gives the table the columns needed to carry the real outcome. The rows
-- are written by supabase/functions/send-email (queued -> sent/error) and updated by
-- supabase/functions/mail-events, which receives Stalwart's webhook delivery events.
--
-- The join key is Stalwart's own queue id: its DATA acknowledgement is
--   250 2.0.0 Message queued with id <queueId>
-- so the submitting client can capture it, and every delivery.* event carries it.
-- message_id is kept as a secondary key (bounce DSNs quote the original Message-ID).
--
-- NOTE: email_log/email_templates/email_accounts were created ad-hoc on the box and have
-- no CREATE migration in this repo. The CREATE TABLE IF NOT EXISTS below documents the
-- pre-existing shape so the table is reproducible from source; on the live box it is a
-- no-op and only the ALTERs apply.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_log (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key text,
    to_email     text NOT NULL,
    to_user_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
    account_id   uuid REFERENCES public.email_accounts(id) ON DELETE SET NULL,
    status       text NOT NULL DEFAULT 'sent',
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Outcome tracking. Nullable and additive: existing rows keep their meaning, and a send
-- that never reaches SMTP still leaves a 'queued' row instead of vanishing.
ALTER TABLE public.email_log
    ADD COLUMN IF NOT EXISTS queue_id       text,        -- Stalwart queue id from the 250 ack
    ADD COLUMN IF NOT EXISTS message_id     text,        -- RFC5322 Message-ID we generated
    ADD COLUMN IF NOT EXISTS sent_at        timestamptz, -- accepted by our MTA
    ADD COLUMN IF NOT EXISTS delivered_at   timestamptz, -- accepted by the recipient's MTA
    ADD COLUMN IF NOT EXISTS failed_at      timestamptz,
    ADD COLUMN IF NOT EXISTS failure_code   text,        -- e.g. '550 5.1.1'
    ADD COLUMN IF NOT EXISTS failure_reason text,
    ADD COLUMN IF NOT EXISTS updated_at     timestamptz NOT NULL DEFAULT now();

-- status vocabulary: queued -> sent -> delivered | bounced | deferred, or error (never left us).
-- Deliberately NOT a CHECK constraint: an unknown Stalwart event must be recordable rather
-- than rejected, and a failed write here would silently cost us the outcome of a real email.
COMMENT ON COLUMN public.email_log.status IS
    'queued | sent | delivered | bounced | deferred | error. sent = our MTA accepted it; delivered = the recipient MTA accepted it.';

CREATE INDEX IF NOT EXISTS email_log_queue_id_idx  ON public.email_log (queue_id)   WHERE queue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_log_message_id_idx ON public.email_log (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_log_status_idx     ON public.email_log (status, created_at DESC);

-- Raw webhook payloads. The exact envelope Stalwart posts is not documented in the binary,
-- so every event is kept verbatim: unmatched ones are the only way to discover the real
-- shape, and matched ones stay as evidence. Not a queue — mail-events writes here and moves on.
CREATE TABLE IF NOT EXISTS public.email_delivery_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type   text,
    queue_id     text,
    email_log_id uuid REFERENCES public.email_log(id) ON DELETE SET NULL,
    matched      boolean NOT NULL DEFAULT false,
    payload      jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_delivery_events_created_idx ON public.email_delivery_events (created_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_events_unmatched_idx ON public.email_delivery_events (created_at DESC) WHERE NOT matched;

-- STANDING TRAP: new tables inherit default privileges granting anon/authenticated FULL DML
-- (including TRUNCATE). Strip everything, then grant back ONLY what the owner-select policy
-- needs: RLS filters rows but does not restore table privileges, so without this GRANT the
-- policy below could never fire. This mirrors public.email_log, which keeps SELECT for
-- authenticated and gates it with the same is_owner() policy.
REVOKE ALL ON public.email_delivery_events FROM anon, authenticated;
GRANT SELECT ON public.email_delivery_events TO authenticated;
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

-- email_log already exposes an owner-only SELECT policy; mirror it here so the owner can
-- read delivery evidence in the dashboard without widening anything else.
DROP POLICY IF EXISTS email_delivery_events_owner_select ON public.email_delivery_events;
CREATE POLICY email_delivery_events_owner_select ON public.email_delivery_events
    FOR SELECT TO authenticated USING ((SELECT public.is_owner()));

COMMIT;
