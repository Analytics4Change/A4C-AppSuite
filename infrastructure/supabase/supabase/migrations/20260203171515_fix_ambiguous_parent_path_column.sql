-- =============================================================================
-- Migration: Fix ambiguous parent_path column reference
-- Purpose: Qualify parent_path in unit_children CTE to avoid ambiguity
-- =============================================================================

CREATE OR REPLACE FUNCTION "api"."get_organization_units"(
  "p_status" "text" DEFAULT 'all'::"text",
  "p_search_term" "text" DEFAULT NULL::"text"
)
RETURNS TABLE(
  "id" "uuid",
  "name" "text",
  "display_name" "text",
  "path" "text",
  "parent_path" "text",
  "parent_id" "uuid",
  "timezone" "text",
  "is_active" boolean,
  "child_count" bigint,
  "is_root_organization" boolean,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
)
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_scope_path LTREE;
BEGIN
  -- Get user's scope_path from effective_permissions (claims v4)
  v_scope_path := get_permission_scope('organization.view_ou');

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'Missing permission: organization.view_ou - user not associated with organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH all_units AS (
    -- Root organizations (depth = 1)
    SELECT
      o.id,
      o.name,
      o.display_name,
      o.path,
      o.parent_path,
      o.timezone,
      o.is_active,
      true AS is_root_org,
      o.created_at,
      o.updated_at
    FROM organizations_projection o
    WHERE nlevel(o.path) = 1
      AND v_scope_path @> o.path
      AND o.deleted_at IS NULL
    UNION ALL
    -- Sub-organizations (depth > 1)
    SELECT
      ou.id,
      ou.name,
      ou.display_name,
      ou.path,
      ou.parent_path,
      ou.timezone,
      ou.is_active,
      false AS is_root_org,
      ou.created_at,
      ou.updated_at
    FROM organization_units_projection ou
    WHERE v_scope_path @> ou.path
      AND ou.deleted_at IS NULL
  ),
  unit_children AS (
    -- FIX: Qualify parent_path with table alias and rename to avoid ambiguity
    SELECT
      oup.parent_path AS pp,
      COUNT(*) as cnt
    FROM organization_units_projection oup
    WHERE oup.deleted_at IS NULL
    GROUP BY oup.parent_path
  )
  SELECT
    u.id,
    u.name,
    u.display_name,
    u.path::TEXT,
    u.parent_path::TEXT,
    (
      SELECT COALESCE(
        (SELECT p.id FROM organization_units_projection p WHERE p.path = u.parent_path LIMIT 1),
        (SELECT o.id FROM organizations_projection o WHERE o.path = u.parent_path LIMIT 1)
      )
    ) AS parent_id,
    u.timezone,
    u.is_active,
    COALESCE(uc.cnt, 0) AS child_count,
    u.is_root_org AS is_root_organization,
    u.created_at,
    u.updated_at
  FROM all_units u
  LEFT JOIN unit_children uc ON uc.pp = u.path
  WHERE (
    p_status = 'all'
    OR (p_status = 'active' AND u.is_active = true)
    OR (p_status = 'inactive' AND u.is_active = false)
  )
  AND (
    p_search_term IS NULL
    OR u.name ILIKE '%' || p_search_term || '%'
    OR u.display_name ILIKE '%' || p_search_term || '%'
  )
  ORDER BY u.path ASC;
END;
$$;

COMMENT ON FUNCTION "api"."get_organization_units"("p_status" "text", "p_search_term" "text") IS
'List all organization units within user scope.
Uses get_permission_scope(organization.view_ou) for authorization (claims v4).
Fixed: Qualified parent_path column in unit_children CTE to avoid ambiguity.';
