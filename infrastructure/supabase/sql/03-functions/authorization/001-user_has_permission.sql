-- User Permission Check Function
-- Queries CQRS projections to determine if a user has a specific permission
-- Supports both super_admin (global) and org-scoped permissions
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_permission_name TEXT,
  p_org_id TEXT,
  p_scope_path LTREE DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id
      AND p.name = p_permission_name
      AND (
        -- Super admin: wildcard org access (global scope)
        ur.org_id = '*'
        OR
        -- Org-scoped: exact org match + hierarchical scope check
        (
          ur.org_id = p_org_id
          AND (
            -- No scope constraint specified
            p_scope_path IS NULL
            OR
            -- Scope within user's hierarchy
            -- User scope: org_123.facility_456
            -- Resource scope: org_123.facility_456.program_789
            -- Result: TRUE (user has access to descendants)
            p_scope_path <@ ur.scope_path
            OR
            -- Resource scope is within user's assigned scope
            ur.scope_path <@ p_scope_path
          )
        )
      )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION user_has_permission IS 'Checks if user has specified permission within given org/scope context';


-- Convenience function: Get all permissions for a user in an org
CREATE OR REPLACE FUNCTION user_permissions(
  p_user_id UUID,
  p_org_id TEXT
) RETURNS TABLE (
  permission_name TEXT,
  applet TEXT,
  action TEXT,
  description TEXT,
  requires_mfa BOOLEAN,
  scope_type TEXT,
  role_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    p.name AS permission_name,
    p.applet,
    p.action,
    p.description,
    p.requires_mfa,
    p.scope_type,
    r.name AS role_name
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  JOIN permissions_projection p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
    AND (
      ur.org_id = '*'  -- Super admin sees all
      OR ur.org_id = p_org_id
    )
  ORDER BY p.applet, p.action;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION user_permissions IS 'Returns all permissions for a user within a specific organization';


-- Check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin(
  p_user_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'super_admin'
      AND ur.org_id = '*'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_super_admin IS 'Checks if user has super_admin role with global scope';


-- Check if user is provider admin for a specific org
CREATE OR REPLACE FUNCTION is_provider_admin(
  p_user_id UUID,
  p_org_id TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'provider_admin'
      AND ur.org_id = p_org_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_provider_admin IS 'Checks if user has provider_admin role for specific organization';


-- Get user's effective organizations (where they have any role)
CREATE OR REPLACE FUNCTION user_organizations(
  p_user_id UUID
) RETURNS TABLE (
  org_id TEXT,
  role_name TEXT,
  scope_path LTREE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ur.org_id,
    r.name AS role_name,
    ur.scope_path
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  WHERE ur.user_id = p_user_id
  ORDER BY ur.org_id, r.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION user_organizations IS 'Returns all organizations where user has assigned roles';
