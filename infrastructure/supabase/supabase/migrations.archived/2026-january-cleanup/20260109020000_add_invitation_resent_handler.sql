-- Add invitation.resent event handler
--
-- Architectural change: Resend operations now emit a distinct 'invitation.resent'
-- event type instead of reusing 'user.invited' with is_resend flag.
-- This follows the principle: every user action should emit a distinct event.
--
-- The user.invited handler remains unchanged for initial invitations.
-- The invitation.resent handler updates the existing invitation with new token/expiry.

CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record) RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_org_id UUID;
  v_subdomain TEXT;
  v_org_name TEXT;
  v_org_type TEXT;
  v_parent_id UUID;
  v_parent_path LTREE;
  v_new_path LTREE;
  v_is_root BOOLEAN;
BEGIN
  CASE p_event.event_type

    -- ========================================
    -- organization.created
    -- ========================================
    WHEN 'organization.created' THEN
      v_org_id := p_event.stream_id;
      v_org_name := p_event.event_data->>'name';
      v_org_type := COALESCE(p_event.event_data->>'org_type', 'provider');
      v_parent_id := (p_event.event_data->>'parent_id')::UUID;
      v_subdomain := p_event.event_data->>'subdomain';
      v_is_root := (v_parent_id IS NULL);

      IF v_is_root THEN
        v_new_path := text2ltree(replace(v_org_id::text, '-', '_'));
      ELSE
        SELECT path INTO v_parent_path
        FROM organizations_projection
        WHERE id = v_parent_id;

        IF v_parent_path IS NULL THEN
          RAISE EXCEPTION 'Parent organization % not found', v_parent_id;
        END IF;
        v_new_path := v_parent_path || text2ltree(replace(v_org_id::text, '-', '_'));
      END IF;

      INSERT INTO organizations_projection (
        id, name, display_name, slug, org_type, path, parent_path, parent_id,
        subdomain, subdomain_status, timezone, is_active, created_at, updated_at
      ) VALUES (
        v_org_id,
        v_org_name,
        COALESCE(p_event.event_data->>'display_name', v_org_name),
        COALESCE(p_event.event_data->>'slug', lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]', '-', 'g'))),
        v_org_type,
        v_new_path,
        CASE WHEN v_is_root THEN NULL ELSE v_parent_path END,
        v_parent_id,
        v_subdomain,
        CASE
          WHEN v_subdomain IS NOT NULL THEN 'pending'
          ELSE 'not_required'
        END,
        COALESCE(p_event.event_data->>'timezone', 'America/New_York'),
        false,
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        subdomain = COALESCE(EXCLUDED.subdomain, organizations_projection.subdomain),
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
    -- ========================================
    WHEN 'user.invited' THEN
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
        updated_at = EXCLUDED.updated_at;

    -- ========================================
    -- invitation.resent (distinct resend event)
    -- ========================================
    WHEN 'invitation.resent' THEN
      UPDATE invitations_projection
      SET
        token = safe_jsonb_extract_text(p_event.event_data, 'token'),
        expires_at = safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        status = 'pending',  -- Reset status in case it was expired
        updated_at = p_event.created_at
      WHERE invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id');

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;

END;
$$;

COMMENT ON FUNCTION public.process_organization_event(record) IS
  'Organization event processor with distinct invitation.resent event support';
