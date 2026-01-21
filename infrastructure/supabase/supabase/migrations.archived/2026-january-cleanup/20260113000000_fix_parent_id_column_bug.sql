-- Fix organization.created handler to match organizations_projection schema
--
-- Bug: Previous migrations introduced non-existent columns:
--   - parent_id (table uses parent_path ltree instead)
--   - subdomain (table uses subdomain_status enum + subdomain_metadata jsonb)
--
-- This migration restores the correct INSERT aligned with baseline_v2 schema.

CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record) RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_correlation_id UUID;  -- Used for user.invited handler
BEGIN
  CASE p_event.event_type

    -- ========================================
    -- organization.created
    -- Aligned with baseline_v2 schema (no subdomain or parent_id columns)
    -- ========================================
    WHEN 'organization.created' THEN
      -- Insert into organizations projection using schema-correct columns
      -- Note: path comes from event_data (computed by workflow), not built here
      INSERT INTO organizations_projection (
        id, name, display_name, slug, type, path, parent_path,
        tax_number, phone_number, timezone, metadata, created_at,
        partner_type, referring_partner_id, subdomain_status
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), 'provider'),
        (p_event.event_data->>'path')::LTREE,
        CASE
          WHEN p_event.event_data ? 'parent_path'
          THEN (p_event.event_data->>'parent_path')::LTREE
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'tax_number'),
        safe_jsonb_extract_text(p_event.event_data, 'phone_number'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'America/New_York'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at,
        CASE
          WHEN p_event.event_data ? 'partner_type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'partner_type'))::partner_type
          ELSE NULL
        END,
        safe_jsonb_extract_uuid(p_event.event_data, 'referring_partner_id'),
        -- subdomain_status: set from event data if present, otherwise based on type/partner_type
        CASE
          WHEN p_event.event_data ? 'subdomain_status'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'))::subdomain_status
          WHEN is_subdomain_required(
            COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), 'provider'),
            CASE
              WHEN p_event.event_data ? 'partner_type'
              THEN (safe_jsonb_extract_text(p_event.event_data, 'partner_type'))::partner_type
              ELSE NULL
            END
          )
          THEN 'pending'::subdomain_status
          ELSE NULL
        END
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        updated_at = p_event.created_at;

    -- ========================================
    -- organization.updated
    -- ========================================
    WHEN 'organization.updated' THEN
      UPDATE organizations_projection
      SET
        name = COALESCE(p_event.event_data->>'name', name),
        display_name = COALESCE(p_event.event_data->>'display_name', display_name),
        timezone = COALESCE(p_event.event_data->>'timezone', timezone),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.activated
    -- ========================================
    WHEN 'organization.activated' THEN
      UPDATE organizations_projection
      SET
        is_active = true,
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
    -- organization.deleted (soft delete)
    -- ========================================
    WHEN 'organization.deleted' THEN
      UPDATE organizations_projection
      SET
        deleted_at = p_event.created_at,
        deletion_reason = COALESCE(p_event.event_data->>'reason', 'manual_deletion'),
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.subdomain.dns_created
    -- ========================================
    WHEN 'organization.subdomain.dns_created' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'dns_created',
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{dns}',
          jsonb_build_object(
            'record_id', p_event.event_data->>'record_id',
            'fqdn', p_event.event_data->>'fqdn',
            'created_at', p_event.created_at
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.subdomain.verified
    -- ========================================
    WHEN 'organization.subdomain.verified' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'verified',
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.subdomain.failed
    -- ========================================
    WHEN 'organization.subdomain.failed' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'failed',
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{dns_error}',
          to_jsonb(p_event.event_data->>'error')
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.bootstrap.failed
    -- ========================================
    WHEN 'organization.bootstrap.failed' THEN
      UPDATE organizations_projection
      SET
        is_active = false,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{bootstrap_error}',
          jsonb_build_object(
            'failure_stage', p_event.event_data->>'failure_stage',
            'error_message', p_event.event_data->>'error_message'
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- ========================================
    -- organization.bootstrap.cancelled
    -- ========================================
    WHEN 'organization.bootstrap.cancelled' THEN
      IF EXISTS (SELECT 1 FROM organizations_projection WHERE id = p_event.stream_id) THEN
        UPDATE organizations_projection
        SET
          deleted_at = p_event.created_at,
          deletion_reason = 'bootstrap_cancelled',
          is_active = false,
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
    -- Stores correlation_id from event metadata for lifecycle tracing
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
        correlation_id,  -- Store for lifecycle tracing
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
        p_event.event_data->'notification_preferences',
        v_correlation_id,  -- Store correlation_id from event metadata
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

COMMENT ON FUNCTION public.process_organization_event(record) IS
  'Organization event processor. Fixed: removed non-existent parent_id column from INSERT (uses parent_path ltree instead).';
