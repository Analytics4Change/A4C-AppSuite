-- Migration: Add Subdomain Event Handlers
--
-- Bug Fix: organization.subdomain.verified events were falling through to ELSE
-- in process_organization_event(), causing subdomain_status to remain 'pending'
-- instead of being updated to 'verified'. This blocked correct redirect after
-- invitation acceptance.
--
-- Pattern: Per event-handler-pattern.md, create separate handler functions
-- for each event type with thin router dispatch.

-- ============================================
-- handle_organization_subdomain_verified()
-- ============================================
-- Updates subdomain_status to 'verified' when DNS verification completes
CREATE OR REPLACE FUNCTION handle_organization_subdomain_verified(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection
  SET subdomain_status = 'verified',
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ============================================
-- handle_organization_subdomain_dns_created()
-- ============================================
-- Updates subdomain_status to 'dns_created' when DNS record is provisioned
CREATE OR REPLACE FUNCTION handle_organization_subdomain_dns_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection
  SET subdomain_status = 'dns_created',
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ============================================
-- handle_organization_subdomain_failed()
-- ============================================
-- Updates subdomain_status to 'failed' with error details when DNS fails
CREATE OR REPLACE FUNCTION handle_organization_subdomain_failed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_error_message TEXT := p_event.event_data->>'error_message';
BEGIN
  UPDATE organizations_projection
  SET subdomain_status = 'failed',
      subdomain_metadata = jsonb_build_object(
        'failure_reason', COALESCE(v_error_message, 'Unknown error'),
        'failed_at', p_event.created_at
      ),
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ============================================
-- Update process_organization_event router
-- ============================================
-- Add CASE lines for the new subdomain event types
CREATE OR REPLACE FUNCTION process_organization_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- Organization lifecycle
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);

    -- Subdomain lifecycle (NEW - fixes redirect bug)
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);

    -- Bootstrap
    WHEN 'bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);

    -- Invitations
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;
END;
$$;
