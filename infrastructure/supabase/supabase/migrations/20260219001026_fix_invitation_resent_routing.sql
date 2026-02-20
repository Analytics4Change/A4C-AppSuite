-- Fix invitation.resent event routing
--
-- The invite-user Edge Function (pre-v15) emitted invitation.resent events with
-- stream_type='organization', which routed them to process_organization_event()
-- instead of process_invitation_event(). The ELSE clause raised an exception,
-- causing the event to be marked with processing_error and the projection
-- to never receive the new token.
--
-- This migration:
-- 1. Adds a forwarding CASE for invitation.resent in process_organization_event()
--    to delegate to handle_invitation_resent() — handles old misrouted events
-- 2. Retries any failed invitation.resent events by clearing their error state

-- Step 1: Add forwarding CASE to process_organization_event
CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.activated' THEN PERFORM handle_organization_activated(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);
    WHEN 'organization.direct_care_settings_updated' THEN PERFORM handle_organization_direct_care_settings_updated(p_event);
    WHEN 'organization.bootstrap.initiated' THEN NULL;
    WHEN 'organization.bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'organization.bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'organization.bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);
    -- Forwarding CASE: invitation.resent events were emitted with stream_type='organization'
    -- by invite-user Edge Function (pre-v15). Forward to the correct handler.
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);
    ELSE
      RAISE EXCEPTION 'Unhandled event type % in process_organization_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

-- Step 2: Retry any failed invitation.resent events
-- These events had processing_error set because process_organization_event()
-- didn't have a CASE for them. Now that the forwarding CASE exists,
-- clearing the error will allow them to be reprocessed.
UPDATE domain_events
SET processed_at = NULL, processing_error = NULL
WHERE event_type = 'invitation.resent'
  AND processing_error IS NOT NULL;
