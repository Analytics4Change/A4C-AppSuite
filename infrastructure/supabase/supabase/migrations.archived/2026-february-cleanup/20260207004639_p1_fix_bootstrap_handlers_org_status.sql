-- =============================================================================
-- P1 Migration: Fix Bootstrap Handlers + Organization Status
-- =============================================================================
-- From CQRS dual-write audit (dev/active/cqrs-dual-write-audit.md):
--   Migration 3b: Fix update_organization_status
--
-- Fixes:
--   P0: Router event type mismatch (bootstrap.* -> organization.bootstrap.*)
--   P0: Missing router CASE for organization.bootstrap.initiated
--   P1: handle_bootstrap_completed now sets is_active = true
--   P1: handle_bootstrap_failed now sets is_active = false, deactivated_at, deleted_at
--   P1: handle_bootstrap_cancelled now sets is_active = false, deactivated_at
--   P1: New handle_organization_activated handler (for admin UI)
--   P1: handle_organization_deactivated now sets deactivated_at, deleted_at
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Update handle_bootstrap_completed: add is_active = true
--    Fix: removed workflowId (not in typed contract, always NULL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_bootstrap_completed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection SET
      is_active = true,
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'completed_at', p_event.created_at
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Update handle_bootstrap_failed: add is_active, deactivated_at, deleted_at
--    Fix: error field name (error -> error_message to match emitted data)
--    Fix: removed workflowId (not in typed contract, always NULL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_bootstrap_failed(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection SET
      is_active = false,
      deactivated_at = p_event.created_at,
      deleted_at = p_event.created_at,
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'failed_at', p_event.created_at,
          'error', p_event.event_data->>'error_message'
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Update handle_bootstrap_cancelled: add is_active, deactivated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_bootstrap_cancelled(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_event.stream_id IS NOT NULL THEN
    UPDATE organizations_projection SET
      is_active = false,
      deactivated_at = p_event.created_at,
      metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{bootstrap}',
        jsonb_build_object(
          'bootstrap_id', p_event.event_data->>'bootstrap_id',
          'cancelled_at', p_event.created_at,
          'cleanup_completed', p_event.event_data->>'cleanup_completed'
        )
      ),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Create handle_organization_activated (for admin UI, not bootstrap)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_activated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection SET
    is_active = true,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Update handle_organization_deactivated: add deactivated_at, deleted_at
--    (for admin UI deactivation, not bootstrap)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_organization_deactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE organizations_projection SET
    is_active = false,
    deactivated_at = COALESCE(
      (p_event.event_data->>'deactivated_at')::timestamptz,
      p_event.created_at
    ),
    deleted_at = COALESCE(
      (p_event.event_data->>'deleted_at')::timestamptz,
      (p_event.event_data->>'deactivated_at')::timestamptz,
      p_event.created_at
    ),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Fix process_organization_event router:
--    - bootstrap.* -> organization.bootstrap.* (P0: event type mismatch)
--    - Add organization.bootstrap.initiated (no-op)
--    - Add organization.activated CASE
-- ---------------------------------------------------------------------------
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

    -- Bootstrap lifecycle (fixed: organization.bootstrap.* to match emitted event types)
    WHEN 'organization.bootstrap.initiated' THEN NULL; -- informational, no projection update
    WHEN 'organization.bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'organization.bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'organization.bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);

    -- Invitations
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);

    -- Unhandled event type
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_organization_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$$;
