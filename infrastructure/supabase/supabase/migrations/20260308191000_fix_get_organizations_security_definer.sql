-- Migration: Add SECURITY DEFINER to api.get_organizations
--
-- Root cause: api.get_organizations is SECURITY INVOKER while
-- api.get_organizations_paginated is SECURITY DEFINER. The LATERAL join
-- to user_phones fails for provider admins because user_phones has no
-- GRANT SELECT for the 'authenticated' role.
--
-- Fix: Recreate with SECURITY DEFINER (matching the paginated variant).
-- Function body is unchanged from 20260306214844.
--
-- ROLLBACK: Re-run 20260306214844 (which omits SECURITY DEFINER).

DROP FUNCTION IF EXISTS "api"."get_organizations"("text", boolean, "text");

CREATE OR REPLACE FUNCTION "api"."get_organizations"(
  "p_type" "text" DEFAULT NULL::"text",
  "p_is_active" boolean DEFAULT NULL::boolean,
  "p_search_term" "text" DEFAULT NULL::"text"
) RETURNS TABLE(
  "id" "uuid",
  "name" "text",
  "display_name" "text",
  "slug" "text",
  "type" "text",
  "path" "text",
  "parent_path" "text",
  "timezone" "text",
  "is_active" boolean,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "provider_admin_name" "text",
  "provider_admin_email" "text",
  "provider_admin_phone" "text"
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.slug,
    o.type::TEXT,
    o.path::TEXT,
    o.parent_path::TEXT,
    o.timezone,
    o.is_active,
    o.created_at,
    o.updated_at,
    pa.admin_name,
    pa.admin_email,
    pa.admin_phone
  FROM organizations_projection o
  LEFT JOIN LATERAL (
    SELECT
      u.name AS admin_name,
      u.email AS admin_email,
      up.number AS admin_phone
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
      AND r.name = 'provider_admin'
      AND r.is_active = true
      AND r.deleted_at IS NULL
    JOIN users u ON u.id = ur.user_id
      AND u.is_active = true
      AND u.deleted_at IS NULL
    LEFT JOIN user_phones up ON up.user_id = u.id
      AND up.is_primary = true
      AND up.is_active = true
    WHERE ur.organization_id = o.id
    ORDER BY ur.assigned_at DESC
    LIMIT 1
  ) pa ON true
  WHERE
    (p_type IS NULL OR p_type = 'all' OR o.type::TEXT = p_type)
    AND (p_is_active IS NULL OR o.is_active = p_is_active)
    AND (
      p_search_term IS NULL
      OR o.name ILIKE '%' || p_search_term || '%'
      OR o.slug ILIKE '%' || p_search_term || '%'
    )
  ORDER BY o.name ASC;
END;
$$;
