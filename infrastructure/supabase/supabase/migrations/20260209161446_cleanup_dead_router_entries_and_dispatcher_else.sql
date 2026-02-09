-- ===========================================================================
-- Cleanup: Remove dead router entries, upgrade dispatcher ELSE to EXCEPTION
-- ===========================================================================
--
-- 1. Remove unreachable user.invited and invitation.resent CASE entries from
--    process_organization_event(). These event types are emitted with
--    stream_type='user' and stream_type='invitation' respectively, so they
--    never reach the organization router (stream_type='organization').
--
-- 2. Upgrade process_domain_event() ELSE from RAISE WARNING to RAISE EXCEPTION
--    so unknown stream_types are recorded in processing_error (visible in admin
--    dashboard) instead of being silently ignored. Add explicit no-op entries
--    for administrative stream_types that don't need projection handling.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Section 1: Remove dead code from process_organization_event()
-- ---------------------------------------------------------------------------
-- user.invited → routed via stream_type='user' → process_user_event()
-- invitation.resent → routed via stream_type='invitation' → process_invitation_event()
-- Neither can reach process_organization_event() (stream_type='organization')

CREATE OR REPLACE FUNCTION process_organization_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  CASE p_event.event_type
    -- Organization lifecycle
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.activated' THEN PERFORM handle_organization_activated(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);

    -- Subdomain lifecycle
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);

    -- Direct care settings
    WHEN 'organization.direct_care_settings_updated' THEN PERFORM handle_organization_direct_care_settings_updated(p_event);

    -- Bootstrap lifecycle
    WHEN 'organization.bootstrap.initiated' THEN NULL; -- informational, no projection update
    WHEN 'organization.bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'organization.bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'organization.bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);

    -- Unhandled event type
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_organization_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Section 2: Upgrade process_domain_event() ELSE to RAISE EXCEPTION
-- ---------------------------------------------------------------------------
-- Previously used RAISE WARNING for unknown stream_types, which silently
-- marked events as processed. Now raises EXCEPTION so unknown stream_types
-- are caught and recorded in processing_error.
--
-- Administrative stream_types that don't need projection handling are added
-- as explicit no-ops (NULL) so they don't trigger the EXCEPTION.

CREATE OR REPLACE FUNCTION process_domain_event() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  -- Skip already-processed events (idempotency)
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      CASE NEW.stream_type
        WHEN 'role' THEN PERFORM process_rbac_event(NEW);
        WHEN 'permission' THEN PERFORM process_rbac_event(NEW);
        WHEN 'client' THEN PERFORM process_client_event(NEW);
        WHEN 'medication' THEN PERFORM process_medication_event(NEW);
        WHEN 'medication_history' THEN PERFORM process_medication_history_event(NEW);
        WHEN 'dosage' THEN PERFORM process_dosage_event(NEW);
        WHEN 'user' THEN PERFORM process_user_event(NEW);
        WHEN 'organization' THEN PERFORM process_organization_event(NEW);
        WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
        WHEN 'contact' THEN PERFORM process_contact_event(NEW);
        WHEN 'address' THEN PERFORM process_address_event(NEW);
        WHEN 'phone' THEN PERFORM process_phone_event(NEW);
        WHEN 'email' THEN PERFORM process_email_event(NEW);
        WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);
        WHEN 'access_grant' THEN PERFORM process_access_grant_event(NEW);
        WHEN 'impersonation' THEN PERFORM process_impersonation_event(NEW);
        -- Administrative stream_types — no projection needed
        WHEN 'platform_admin' THEN NULL;
        WHEN 'workflow_queue' THEN NULL;
        WHEN 'test' THEN NULL;
        ELSE
          RAISE EXCEPTION 'Unknown stream_type "%" for event %', NEW.stream_type, NEW.id
            USING ERRCODE = 'P9002';
      END CASE;
    END IF;

    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
      RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
      NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
  END;

  RETURN NEW;
END;
$$;
