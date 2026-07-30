-- Canonical reference for the email-normalizing BEFORE-row trigger.
-- Source migration: 20260730045737_normalize_email_at_the_source.sql
--
-- Attached to public.users and public.invitations_projection as
--   a_normalize_email_users / a_normalize_email_invitations
-- BEFORE INSERT OR UPDATE ... FOR EACH ROW.
--
-- The `a_` prefix is load-bearing: PostgreSQL fires BEFORE-row triggers in NAME
-- ORDER, so it guarantees no future trigger sorts ahead of this one and sees a
-- non-normalized NEW.email.
--
-- Paired with chk_users_email_normalized / chk_invitations_email_normalized.
-- The trigger upholds the invariant; the CHECK states it. Dropping the trigger
-- makes the CHECK reachable -- and because process_domain_event absorbs handler
-- exceptions into processing_error without re-raising, a reachable CHECK
-- degrades to a SILENT no-projection-row failure, not a visible error.

CREATE OR REPLACE FUNCTION public.a_normalize_email_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := btrim(lower(NEW.email));
  END IF;
  RETURN NEW;
END;
$function$;
