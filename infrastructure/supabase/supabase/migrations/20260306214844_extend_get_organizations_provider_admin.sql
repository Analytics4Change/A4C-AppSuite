-- Migration: Extend api.get_organizations and api.get_organizations_paginated
-- with provider admin name, email, and primary phone number.
--
-- Read-path-only change: No events emitted, no handler changes, no projection writes.
-- Uses LEFT JOIN LATERAL for deterministic provider admin lookup (most recently assigned).
--
-- Indexes used:
--   idx_user_roles_org (organization_id) on user_roles_projection
--   idx_user_phones_one_primary (user_id WHERE is_primary AND is_active) on user_phones
--
-- ROLLBACK: Re-run the original function definitions from baseline_v4 migration
-- (search for 'api.get_organizations' in 20260212010625_baseline_v4.sql)

-- =============================================================================
-- 1. Drop + recreate api.get_organizations (return type changed, cannot use OR REPLACE)
-- =============================================================================
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
LANGUAGE "plpgsql"
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

-- =============================================================================
-- 2. Drop + recreate api.get_organizations_paginated (return type changed)
-- =============================================================================
DROP FUNCTION IF EXISTS "api"."get_organizations_paginated"("text", boolean, "text", integer, integer, "text", "text");

CREATE OR REPLACE FUNCTION "api"."get_organizations_paginated"(
  "p_type" "text" DEFAULT NULL::"text",
  "p_is_active" boolean DEFAULT NULL::boolean,
  "p_search_term" "text" DEFAULT NULL::"text",
  "p_page" integer DEFAULT 1,
  "p_page_size" integer DEFAULT 20,
  "p_sort_by" "text" DEFAULT 'name'::"text",
  "p_sort_order" "text" DEFAULT 'asc'::"text"
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
  "provider_admin_phone" "text",
  "total_count" bigint
) LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $_$
DECLARE
  v_offset INTEGER;
  v_limit INTEGER;
  v_sort_column TEXT;
  v_sort_direction TEXT;
BEGIN
  v_limit := LEAST(GREATEST(p_page_size, 1), 100);
  v_offset := (GREATEST(p_page, 1) - 1) * v_limit;

  v_sort_column := CASE p_sort_by
    WHEN 'name' THEN 'o.name'
    WHEN 'type' THEN 'o.type'
    WHEN 'created_at' THEN 'o.created_at'
    WHEN 'updated_at' THEN 'o.updated_at'
    ELSE 'o.name'
  END;

  v_sort_direction := CASE WHEN LOWER(p_sort_order) = 'desc' THEN 'DESC' ELSE 'ASC' END;

  RETURN QUERY EXECUTE format(
    'SELECT
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
      pa.admin_phone,
      COUNT(*) OVER() AS total_count
    FROM organizations_projection o
    LEFT JOIN LATERAL (
      SELECT
        u.name AS admin_name,
        u.email AS admin_email,
        up.number AS admin_phone
      FROM user_roles_projection ur
      JOIN roles_projection r ON r.id = ur.role_id
        AND r.name = ''provider_admin''
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
      o.deleted_at IS NULL
      AND ($1 IS NULL OR o.type::TEXT = $1)
      AND ($2 IS NULL OR o.is_active = $2)
      AND (
        $3 IS NULL
        OR o.name ILIKE ''%%%%'' || $3 || ''%%%%''
        OR o.slug ILIKE ''%%%%'' || $3 || ''%%%%''
        OR o.display_name ILIKE ''%%%%'' || $3 || ''%%%%''
      )
    ORDER BY %s %s
    LIMIT $4 OFFSET $5',
    v_sort_column,
    v_sort_direction
  )
  USING p_type, p_is_active, p_search_term, v_limit, v_offset;
END;
$_$;
