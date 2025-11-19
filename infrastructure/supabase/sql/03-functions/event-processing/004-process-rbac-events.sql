-- Process RBAC Events
-- Projects RBAC-related events to permission, role, and access grant projection tables
CREATE OR REPLACE FUNCTION process_rbac_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    -- ========================================
    -- Permission Events
    -- ========================================
    WHEN 'permission.defined' THEN
      INSERT INTO permissions_projection (
        id,
        applet,
        action,
        description,
        scope_type,
        requires_mfa,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'applet'),
        safe_jsonb_extract_text(p_event.event_data, 'action'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        safe_jsonb_extract_text(p_event.event_data, 'scope_type'),
        COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, FALSE),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    -- ========================================
    -- Role Events
    -- ========================================
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (
        id,
        name,
        description,
        organization_id,
        org_hierarchy_scope,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        -- organization_id comes directly from event_data (NULL for super_admin)
        CASE
          WHEN p_event.event_data->>'organization_id' IS NOT NULL
          THEN (p_event.event_data->>'organization_id')::UUID
          ELSE NULL
        END,
        CASE
          WHEN p_event.event_data->>'org_hierarchy_scope' IS NOT NULL
          THEN (p_event.event_data->>'org_hierarchy_scope')::LTREE
          ELSE NULL
        END,
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'role.updated' THEN
      UPDATE roles_projection
      SET description = safe_jsonb_extract_text(p_event.event_data, 'description'),
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'role.deleted' THEN
      UPDATE roles_projection
      SET deleted_at = p_event.created_at,
          is_active = false,
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'role.permission.granted' THEN
      INSERT INTO role_permissions_projection (
        role_id,
        permission_id,
        granted_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'permission_id'),
        p_event.created_at
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING;  -- Idempotent

    WHEN 'role.permission.revoked' THEN
      DELETE FROM role_permissions_projection
      WHERE role_id = p_event.stream_id
        AND permission_id = safe_jsonb_extract_uuid(p_event.event_data, 'permission_id');

    -- ========================================
    -- User Role Events
    -- ========================================
    WHEN 'user.role.assigned' THEN
      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        org_id,
        scope_path,
        assigned_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'role_id'),
        -- Convert org_id: '*' becomes NULL, otherwise resolve to UUID
        CASE
          WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') = '*' THEN NULL
          WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') IS NOT NULL
          THEN safe_jsonb_extract_uuid(p_event.event_data, 'org_id')
          ELSE NULL
        END,
        CASE
          WHEN p_event.event_data->>'scope_path' = '*' THEN NULL
          WHEN p_event.event_data->>'scope_path' IS NOT NULL
          THEN (p_event.event_data->>'scope_path')::LTREE
          ELSE NULL
        END,
        p_event.created_at
      )
      ON CONFLICT (user_id, role_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::UUID)) DO NOTHING;  -- Idempotent

    WHEN 'user.role.revoked' THEN
      DELETE FROM user_roles_projection
      WHERE user_id = p_event.stream_id
        AND role_id = safe_jsonb_extract_uuid(p_event.event_data, 'role_id')
        AND COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::UUID) = COALESCE(
          CASE
            WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') = '*' THEN NULL
            WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') IS NOT NULL
            THEN safe_jsonb_extract_uuid(p_event.event_data, 'org_id')
            ELSE NULL
          END,
          '00000000-0000-0000-0000-000000000000'::UUID
        );

    -- ========================================
    -- Cross-Tenant Access Grant Events
    -- ========================================
    WHEN 'access_grant.created' THEN
      INSERT INTO cross_tenant_access_grants_projection (
        id,
        consultant_org_id,
        consultant_user_id,
        provider_org_id,
        scope,
        scope_id,
        granted_by,
        granted_at,
        expires_at,
        revoked_at,
        authorization_type,
        legal_reference,
        metadata
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at,
        CASE
          WHEN p_event.event_data->>'expires_at' IS NOT NULL
          THEN (p_event.event_data->>'expires_at')::TIMESTAMPTZ
          ELSE NULL
        END,
        NULL,  -- revoked_at initially NULL
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB)
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'access_grant.revoked' THEN
      UPDATE cross_tenant_access_grants_projection
      SET revoked_at = p_event.created_at,
          metadata = metadata || jsonb_build_object(
            'revocation_reason', safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
            'revoked_by', safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by')
          )
      WHERE id = safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');

    ELSE
      RAISE WARNING 'Unknown RBAC event type: %', p_event.event_type;
  END CASE;

  -- Also record in audit log (with the reason!)
  INSERT INTO audit_log (
    organization_id,
    event_type,
    event_category,
    event_name,
    event_description,
    user_id,
    user_email,
    resource_type,
    resource_id,
    old_values,
    new_values,
    metadata
  ) VALUES (
    CASE
      WHEN p_event.event_type LIKE 'access_grant.%' THEN
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id')
      WHEN p_event.event_type LIKE 'user.role.%' THEN
        safe_jsonb_extract_uuid(p_event.event_data, 'org_id')
      ELSE
        NULL  -- Permissions and roles are global
    END,
    p_event.event_type,
    'authorization_change',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    safe_jsonb_extract_text(p_event.event_metadata, 'user_email'),
    p_event.stream_type,
    p_event.stream_id,
    NULL,  -- Could extract from previous events if needed
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_rbac_event IS 'Projects RBAC events to permission, role, user_role, and access_grant projection tables with full audit trail';
