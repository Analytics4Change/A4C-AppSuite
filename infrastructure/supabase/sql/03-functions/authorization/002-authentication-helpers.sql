-- Authentication Helper Functions
-- Provides JWT claims extraction and organization admin detection

-- ============================================================================
-- Current User ID Resolution
-- ============================================================================

-- Extract current user ID from JWT (Supabase Auth UUID format)
-- Supports testing override via app.current_user session variable
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_sub text;
BEGIN
  -- Check for testing override first
  BEGIN
    v_sub := current_setting('app.current_user', true);
    IF v_sub IS NOT NULL AND v_sub != '' THEN
      RETURN v_sub::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- No override set, continue to JWT extraction
  END;

  -- Extract 'sub' claim from JWT (Supabase Auth UUID format)
  v_sub := (auth.jwt()->>'sub')::text;

  IF v_sub IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_sub::uuid;
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_user_id IS
  'Extracts current user ID from JWT (Supabase Auth UUID format). Supports testing override via app.current_user setting.';


-- ============================================================================
-- JWT Custom Claims Extraction (Supabase Auth)
-- ============================================================================

-- Extract org_id from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT (auth.jwt()->>'org_id')::uuid;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_org_id IS
  'Extracts org_id from JWT custom claims (Supabase Auth)';


-- Extract user_role from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT auth.jwt()->>'user_role';
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_user_role IS
  'Extracts user_role from JWT custom claims (Supabase Auth)';


-- Extract permissions array from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_permissions()
RETURNS TEXT[]
LANGUAGE SQL
STABLE
AS $$
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(
      COALESCE(auth.jwt()->'permissions', '[]'::jsonb)
    )
  );
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_permissions IS
  'Extracts permissions array from JWT custom claims (Supabase Auth)';


-- Extract scope_path from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_scope_path()
RETURNS LTREE
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN auth.jwt()->>'scope_path' IS NOT NULL
    THEN (auth.jwt()->>'scope_path')::ltree
    ELSE NULL
  END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_scope_path IS
  'Extracts scope_path from JWT custom claims (Supabase Auth)';


-- Check if current user has a specific permission
CREATE OR REPLACE FUNCTION has_permission(p_permission text)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT p_permission = ANY(get_current_permissions());
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION has_permission IS
  'Checks if current user has a specific permission in their JWT claims';


-- ============================================================================
-- Organization Admin Detection
-- ============================================================================

-- Check if user has provider_admin OR partner_admin role in organization
-- This is used by RLS policies to grant organizational administrative access
CREATE OR REPLACE FUNCTION is_org_admin(
  p_user_id UUID,
  p_org_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name IN ('provider_admin', 'partner_admin')
      AND ur.org_id = p_org_id
      AND r.deleted_at IS NULL
  );
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION is_org_admin IS
  'Returns true if user has provider_admin or partner_admin role in the specified organization';
