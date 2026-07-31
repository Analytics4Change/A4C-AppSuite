CREATE OR REPLACE FUNCTION public.handle_invitation_resent(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- `token` is DELIBERATELY ABSENT from the SET list (20260731201018). It is
  -- written exactly once, by handle_user_invited's INSERT arm, and never
  -- modified thereafter. A resend extends the expiry and re-opens the status; it
  -- does not mint a new secret.
  --
  -- Before that migration this wrote `token` on every resend, which killed every
  -- previously emailed link and surfaced as "Invitation not found" —
  -- indistinguishable from never-existed / revoked / expired.
  --
  -- The WHERE predicates make uq_invitations_pending_org_email unreachable:
  --   * status IN ('pending','expired') — a replay cannot resurrect an accepted,
  --     revoked or deleted invitation.
  --   * NOT EXISTS(...) — a replay cannot create a second pending row for an
  --     address that already has one.
  -- Both are filters, not exception handlers, precisely because an exception here
  -- would be swallowed by process_domain_event and reported to the caller as
  -- success (codified pitfall: a constraint violation inside a handler fails
  -- silent). This is remedy (a) applied at the handler tier, so it covers every
  -- emitter including replay paths that have no wire tier.
  UPDATE invitations_projection ip
  SET
    expires_at = safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    status = 'pending',
    updated_at = p_event.created_at
  WHERE ip.invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id')
    AND ip.status IN ('pending', 'expired')
    AND NOT EXISTS (
      SELECT 1
        FROM invitations_projection other
       WHERE other.organization_id = ip.organization_id
         AND btrim(lower(other.email)) = btrim(lower(ip.email))
         AND other.status = 'pending'
         AND other.id <> ip.id
    );
END;
$function$;
