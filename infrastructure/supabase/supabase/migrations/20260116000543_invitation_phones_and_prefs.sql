-- ============================================================================
-- Migration: Invitation Phones Column
-- Purpose: Add phones array to invitations for phone collection during invite
-- Phase 6 of Notification Preferences plan
-- ============================================================================

-- ============================================================================
-- 1. Add phones column to invitations_projection
--    (notification_preferences already exists from earlier migration)
-- ============================================================================

-- Add phones column (JSONB array of phone objects)
ALTER TABLE invitations_projection
ADD COLUMN IF NOT EXISTS phones JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN invitations_projection.phones IS
'Array of phone numbers to create when invitation is accepted. Structure:
[{
  "label": "Mobile",
  "type": "mobile|office|fax|emergency",
  "number": "+15551234567",
  "countryCode": "+1",
  "smsCapable": true,
  "isPrimary": true
}]';

-- ============================================================================
-- 2. Update process_organization_event to include phones in user.invited
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_correlation_id UUID;
BEGIN
  CASE p_event.event_type
    -- ========================================
    -- organization.created
    -- ========================================
    WHEN 'organization.created' THEN
      INSERT INTO organizations_projection (
        id,
        name,
        subdomain,
        subdomain_status,
        is_active,
        parent_path,
        organization_type,
        metadata,
        tags,
        created_at,
        updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'subdomain'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'), 'pending'),
        true,
        COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'parent_path')::ltree,
          p_event.stream_id::text::ltree
        ),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'organization_type'), 'provider')::organization_type,
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
          '{}'::TEXT[]
        ),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    -- ========================================
    -- organization.updated
    -- ========================================
    WHEN 'organization.updated' THEN
      UPDATE organizations_projection
      SET
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        subdomain = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain'), subdomain),
        subdomain_status = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'), subdomain_status),
        organization_type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'organization_type')::organization_type, organization_type),
        metadata = CASE
          WHEN p_event.event_data ? 'metadata' THEN p_event.event_data->'metadata'
          ELSE metadata
        END,
        tags = CASE
          WHEN p_event.event_data ? 'tags' THEN
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')), '{}'::TEXT[])
          ELSE tags
        END,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.subdomain_status.changed
    -- ========================================
    WHEN 'organization.subdomain_status.changed' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'status'), subdomain_status),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.deactivated
    -- ========================================
    WHEN 'organization.deactivated' THEN
      UPDATE organizations_projection
      SET
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.reactivated
    -- ========================================
    WHEN 'organization.reactivated' THEN
      UPDATE organizations_projection
      SET
        is_active = true,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.deleted (soft delete)
    -- ========================================
    WHEN 'organization.deleted' THEN
      UPDATE organizations_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- bootstrap.completed
    -- ========================================
    WHEN 'bootstrap.completed' THEN
      IF p_event.stream_id IS NOT NULL THEN
        UPDATE organizations_projection
        SET
          metadata = jsonb_set(
            COALESCE(metadata, '{}'),
            '{bootstrap}',
            jsonb_build_object(
              'bootstrap_id', p_event.event_data->>'bootstrap_id',
              'completed_at', p_event.created_at,
              'workflow_id', p_event.event_data->>'workflowId'
            )
          ),
          updated_at = p_event.created_at
        WHERE id = p_event.stream_id;
      END IF;

    -- ========================================
    -- bootstrap.failed
    -- ========================================
    WHEN 'bootstrap.failed' THEN
      IF p_event.stream_id IS NOT NULL THEN
        UPDATE organizations_projection
        SET
          metadata = jsonb_set(
            COALESCE(metadata, '{}'),
            '{bootstrap}',
            jsonb_build_object(
              'bootstrap_id', p_event.event_data->>'bootstrap_id',
              'failed_at', p_event.created_at,
              'error', p_event.event_data->>'error',
              'workflow_id', p_event.event_data->>'workflowId'
            )
          ),
          updated_at = p_event.created_at
        WHERE id = p_event.stream_id;
      END IF;

    -- ========================================
    -- bootstrap.cancelled
    -- ========================================
    WHEN 'bootstrap.cancelled' THEN
      IF p_event.stream_id IS NOT NULL THEN
        UPDATE organizations_projection
        SET
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

    -- ========================================
    -- user.invited (initial invitation)
    -- Phase 6: Now includes phones from event data
    -- ========================================
    WHEN 'user.invited' THEN
      -- Extract correlation_id from event metadata
      v_correlation_id := (p_event.event_metadata->>'correlation_id')::UUID;

      INSERT INTO invitations_projection (
        invitation_id,
        organization_id,
        email,
        first_name,
        last_name,
        role,
        roles,
        token,
        expires_at,
        status,
        access_start_date,
        access_expiration_date,
        notification_preferences,
        phones,  -- Phase 6: phones array
        correlation_id,
        tags,
        created_at,
        updated_at
      ) VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'role'),
        COALESCE(p_event.event_data->'roles', '[]'::jsonb),
        safe_jsonb_extract_text(p_event.event_data, 'token'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        'pending',
        (p_event.event_data->>'access_start_date')::DATE,
        (p_event.event_data->>'access_expiration_date')::DATE,
        COALESCE(p_event.event_data->'notification_preferences', '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb),
        COALESCE(p_event.event_data->'phones', '[]'::jsonb),  -- Phase 6: phones with default
        v_correlation_id,
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
          '{}'::TEXT[]
        ),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (invitation_id) DO UPDATE SET
        -- Safety fallback: if user.invited is received for existing invitation,
        -- update token/expiry (maintains backwards compatibility)
        token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at,
        status = 'pending',
        -- Phase 6: Update phones and notification_preferences on retry
        phones = EXCLUDED.phones,
        notification_preferences = EXCLUDED.notification_preferences,
        -- Preserve original correlation_id (don't overwrite on retry)
        correlation_id = COALESCE(invitations_projection.correlation_id, EXCLUDED.correlation_id),
        updated_at = EXCLUDED.updated_at;

    -- ========================================
    -- invitation.resent (distinct resend event)
    -- Does NOT update correlation_id (preserve original)
    -- ========================================
    WHEN 'invitation.resent' THEN
      UPDATE invitations_projection
      SET
        token = safe_jsonb_extract_text(p_event.event_data, 'token'),
        expires_at = safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        status = 'pending',  -- Reset status in case it was expired
        updated_at = p_event.created_at
        -- correlation_id intentionally NOT updated (preserve original)
      WHERE invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id');

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;

END;
$$;

ALTER FUNCTION public.process_organization_event(record) OWNER TO postgres;

COMMENT ON FUNCTION public.process_organization_event(record) IS
'Organization event processor. Phase 6: Added phones column support in user.invited handler.';
