


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "api";


ALTER SCHEMA "api" OWNER TO "postgres";


COMMENT ON SCHEMA "api" IS 'API schema for PostgREST-accessible functions used by Edge Functions and external clients';





ALTER SCHEMA "public" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "ltree" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "plpgsql_check" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."address_type" AS ENUM (
    'physical',
    'mailing',
    'billing'
);


ALTER TYPE "public"."address_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."address_type" IS 'Classification of addresses: physical, mailing, billing';



CREATE TYPE "public"."contact_type" AS ENUM (
    'a4c_admin',
    'billing',
    'technical',
    'emergency',
    'stakeholder',
    'administrative'
);


ALTER TYPE "public"."contact_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."contact_type" IS 'Classification of contact persons: a4c_admin, billing, technical, emergency, stakeholder';



CREATE TYPE "public"."email_type" AS ENUM (
    'work',
    'personal',
    'billing',
    'support',
    'main'
);


ALTER TYPE "public"."email_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."email_type" IS 'Classification of email addresses: work, personal, billing, support, main';



CREATE TYPE "public"."partner_type" AS ENUM (
    'var',
    'family',
    'court',
    'other'
);


ALTER TYPE "public"."partner_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."partner_type" IS 'Classification of provider_partner organizations: VAR (reseller), family, court, other';



CREATE TYPE "public"."phone_type" AS ENUM (
    'mobile',
    'office',
    'fax',
    'emergency'
);


ALTER TYPE "public"."phone_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."phone_type" IS 'Classification of phone numbers: mobile, office, fax, emergency';



CREATE TYPE "public"."subdomain_status" AS ENUM (
    'pending',
    'dns_created',
    'verifying',
    'verified',
    'failed'
);


ALTER TYPE "public"."subdomain_status" OWNER TO "postgres";


COMMENT ON TYPE "public"."subdomain_status" IS 'Tracks subdomain provisioning lifecycle for organizations. Workflow: pending → dns_created → verifying → verified (or failed at any stage)';



CREATE OR REPLACE FUNCTION "api"."accept_invitation"("p_invitation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- DEPRECATED: No longer called. Event processor handles updates.
  RAISE WARNING 'api.accept_invitation is deprecated. Use invitation.accepted event instead.';

  UPDATE public.invitations_projection
  SET accepted_at = NOW()
  WHERE id = p_invitation_id;
END;
$$;


ALTER FUNCTION "api"."accept_invitation"("p_invitation_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."accept_invitation"("p_invitation_id" "uuid") IS 'DEPRECATED (2025-12-22): No longer called. The invitation.accepted event now handles all projection updates via process_invitation_event().';



CREATE OR REPLACE FUNCTION "api"."add_user_phone"("p_user_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text" DEFAULT NULL::"text", "p_country_code" "text" DEFAULT '+1'::"text", "p_is_primary" boolean DEFAULT false, "p_sms_capable" boolean DEFAULT false, "p_org_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_phone_id UUID;
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  v_phone_id := gen_random_uuid();

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.add_user_phone'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.phone.added',
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'phone_id', v_phone_id,
      'org_id', p_org_id,
      'label', p_label,
      'type', p_type,
      'number', p_number,
      'extension', p_extension,
      'country_code', p_country_code,
      'is_primary', p_is_primary,
      'sms_capable', p_sms_capable
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', v_phone_id,
    'eventId', v_event_id
  );
END;
$$;


ALTER FUNCTION "api"."add_user_phone"("p_user_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."add_user_phone"("p_user_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") IS 'Add a new phone for a user. p_org_id=NULL creates global phone, set creates org-specific.
p_reason provides optional audit context (e.g., "Admin added phone during onboarding").
Authorization: Platform admin, org admin, or user adding their own phone.';



CREATE OR REPLACE FUNCTION "api"."check_organization_by_name"("p_name" "text") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT o.id
  FROM organizations_projection o
  WHERE o.name = p_name
    AND o.subdomain_status IS NULL
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."check_organization_by_name"("p_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."check_organization_by_name"("p_name" "text") IS 'Check if organization exists by name (for orgs without subdomains). Used by Temporal workflow activities for idempotent organization creation. Function in api schema for PostgREST RPC access.';



CREATE OR REPLACE FUNCTION "api"."check_organization_by_slug"("p_slug" "text") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT o.id
  FROM organizations_projection o
  WHERE o.slug = p_slug
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."check_organization_by_slug"("p_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."check_organization_by_slug"("p_slug" "text") IS 'Check if organization exists by slug. Used by Temporal workflow activities for idempotent organization creation. Function in api schema for PostgREST RPC access.';



CREATE OR REPLACE FUNCTION "api"."check_pending_invitation"("p_email" "text", "p_org_id" "uuid") RETURNS TABLE("id" "uuid", "email" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT ip.id, ip.email, ip.expires_at
  FROM invitations_projection ip
  WHERE ip.email = p_email
    AND ip.organization_id = p_org_id
    AND ip.status = 'pending'
  ORDER BY ip.created_at DESC
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."check_pending_invitation"("p_email" "text", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."check_pending_invitation"("p_email" "text", "p_org_id" "uuid") IS 'Check if there is a pending invitation for the given email in the specified organization';



CREATE OR REPLACE FUNCTION "api"."check_user_exists"("p_email" "text") RETURNS TABLE("user_id" "uuid", "email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT u.id as user_id, u.email
  FROM users u
  WHERE u.email = p_email
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."check_user_exists"("p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."check_user_exists"("p_email" "text") IS 'Check if a user with the given email exists anywhere in the system';



CREATE OR REPLACE FUNCTION "api"."check_user_org_membership"("p_email" "text", "p_org_id" "uuid") RETURNS TABLE("user_id" "uuid", "is_active" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT u.id as user_id, u.is_active
  FROM users u
  INNER JOIN user_roles_projection urp ON u.id = urp.user_id
  WHERE u.email = p_email
    AND urp.organization_id = p_org_id
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."check_user_org_membership"("p_email" "text", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."check_user_org_membership"("p_email" "text", "p_org_id" "uuid") IS 'Check if a user with given email has membership (active or deactivated) in the specified organization';



CREATE OR REPLACE FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid" DEFAULT NULL::"uuid", "p_name" "text" DEFAULT NULL::"text", "p_display_name" "text" DEFAULT NULL::"text", "p_timezone" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $_$
DECLARE
  v_scope_path LTREE;
  v_parent_path LTREE;
  v_parent_timezone TEXT;
  v_root_org_id UUID;
  v_new_path LTREE;
  v_new_id UUID;
  v_slug TEXT;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_result RECORD;
BEGIN
  -- Validate required fields
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Get user's scope_path from JWT claims
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Find root organization for this scope
  SELECT o.id, o.path INTO v_root_org_id, v_parent_path
  FROM organizations_projection o
  WHERE o.path = (
    SELECT subpath(v_scope_path, 0, 2)  -- Get root org path (first 2 levels)
  )
  AND o.deleted_at IS NULL;

  IF v_root_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Root organization not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Could not find root organization for your scope'
      )
    );
  END IF;

  -- Determine parent path
  IF p_parent_id IS NULL THEN
    -- Use root org as parent
    SELECT o.path, o.timezone INTO v_parent_path, v_parent_timezone
    FROM organizations_projection o
    WHERE o.id = v_root_org_id;
  ELSE
    -- Get specified parent's details (could be root org or sub-org)
    SELECT o.path, o.timezone INTO v_parent_path, v_parent_timezone
    FROM organizations_projection o
    WHERE o.id = p_parent_id
      AND o.deleted_at IS NULL
      AND v_scope_path @> o.path;

    IF v_parent_path IS NULL THEN
      -- Try organization_units_projection
      SELECT ou.path, ou.timezone INTO v_parent_path, v_parent_timezone
      FROM organization_units_projection ou
      WHERE ou.id = p_parent_id
        AND ou.deleted_at IS NULL
        AND v_scope_path @> ou.path;
    END IF;

    IF v_parent_path IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Parent organization not found or not accessible',
        'errorDetails', jsonb_build_object(
          'code', 'NOT_FOUND',
          'message', 'Parent organization not found or outside your scope'
        )
      );
    END IF;

    -- Check if parent is inactive
    IF EXISTS (
      SELECT 1 FROM organization_units_projection
      WHERE path = v_parent_path AND is_active = false AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot create sub-unit under inactive parent',
        'errorDetails', jsonb_build_object(
          'code', 'PARENT_INACTIVE',
          'message', 'Reactivate the parent organization unit first'
        )
      );
    END IF;
  END IF;

  -- Generate slug from name (lowercase, replace non-alphanumeric with underscore)
  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');  -- Trim leading/trailing underscores

  -- Generate new path
  v_new_path := v_parent_path || v_slug::LTREE;

  -- Check for duplicate path in both tables
  IF EXISTS (
    SELECT 1 FROM organizations_projection WHERE path = v_new_path AND deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM organization_units_projection WHERE path = v_new_path AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'An organizational unit with this name already exists under the same parent',
      'errorDetails', jsonb_build_object(
        'code', 'DUPLICATE_NAME',
        'message', format('Unit "%s" already exists under this parent', p_name)
      )
    );
  END IF;

  -- Generate new ID
  v_new_id := gen_random_uuid();
  v_event_id := gen_random_uuid();

  -- Get next stream version for this new entity
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = v_new_id AND stream_type = 'organization_unit';

  -- CQRS: Emit organization_unit.created event (no direct projection write)
  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    v_new_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.created',
    jsonb_build_object(
      'organization_id', v_root_org_id,
      'name', trim(p_name),
      'display_name', COALESCE(nullif(trim(p_display_name), ''), trim(p_name)),
      'slug', v_slug,
      'path', v_new_path::TEXT,
      'parent_path', v_parent_path::TEXT,
      'timezone', COALESCE(p_timezone, v_parent_timezone, 'America/New_York')
    ),
    jsonb_build_object(
      'source', 'api.create_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Created sub-organization "%s" under %s', trim(p_name), v_parent_path::TEXT),
      'timestamp', now()
    )
  );

  -- Query projection for result (event processor should have populated it)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = v_new_id;

  IF v_result IS NULL THEN
    -- If not found, event processing may have failed - return with data from event
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_new_id,
        'name', trim(p_name),
        'displayName', COALESCE(nullif(trim(p_display_name), ''), trim(p_name)),
        'path', v_new_path::TEXT,
        'parentPath', v_parent_path::TEXT,
        'parentId', p_parent_id,
        'timeZone', COALESCE(p_timezone, v_parent_timezone, 'America/New_York'),
        'isActive', true,
        'childCount', 0,
        'isRootOrganization', false,
        'createdAt', now(),
        'updatedAt', now()
      )
    );
  END IF;

  -- Return success with created unit from projection
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_result.id,
      'name', v_result.name,
      'displayName', v_result.display_name,
      'path', v_result.path::TEXT,
      'parentPath', v_result.parent_path::TEXT,
      'parentId', p_parent_id,
      'timeZone', v_result.timezone,
      'isActive', v_result.is_active,
      'childCount', 0,
      'isRootOrganization', false,
      'createdAt', v_result.created_at,
      'updatedAt', v_result.updated_at
    )
  );
END;
$_$;


ALTER FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") IS 'Frontend RPC: Create sub-organization. Emits organization_unit.created event (CQRS).';



CREATE OR REPLACE FUNCTION "api"."create_role"("p_name" "text", "p_description" "text", "p_org_hierarchy_scope" "text" DEFAULT NULL::"text", "p_permission_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_cloned_from_role_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_role_id UUID;
  v_org_path LTREE;
  v_scope_path LTREE;
  v_perm_id UUID;
  v_user_perms UUID[];
  v_perm_name TEXT;
  v_event_metadata JSONB;
  v_perm_count INT := 0;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required',
      'errorDetails', jsonb_build_object('code', 'NO_ORG_CONTEXT', 'message', 'User must be in an organization context'));
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required',
      'errorDetails', jsonb_build_object('code', 'VALIDATION_ERROR', 'message', 'Role name cannot be empty'));
  END IF;

  SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
  v_scope_path := COALESCE(p_org_hierarchy_scope::LTREE, v_org_path);

  -- Use helper function for permission aggregation
  v_user_perms := public.get_user_aggregated_permissions(v_user_id);

  -- Use helper function for subset check
  IF NOT public.check_permissions_subset(p_permission_ids, v_user_perms) THEN
    -- Find which permission is violating
    FOREACH v_perm_id IN ARRAY p_permission_ids
    LOOP
      IF NOT (v_perm_id = ANY(v_user_perms)) THEN
        SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
        RETURN jsonb_build_object('success', false, 'error', 'Cannot grant permission you do not possess',
          'errorDetails', jsonb_build_object('code', 'SUBSET_ONLY_VIOLATION',
            'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::TEXT))));
      END IF;
    END LOOP;
  END IF;

  v_role_id := gen_random_uuid();

  v_event_metadata := jsonb_build_object(
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'reason', CASE WHEN p_cloned_from_role_id IS NOT NULL THEN 'Role duplicated via Role Management UI'
      ELSE 'Creating new role via Role Management UI' END
  );
  IF p_cloned_from_role_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object('cloned_from_role_id', p_cloned_from_role_id);
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.created',
    p_event_data := jsonb_build_object(
      'name', p_name,
      'description', p_description,
      'organization_id', v_org_id,
      'org_hierarchy_scope', v_scope_path::TEXT
    ),
    p_event_metadata := v_event_metadata
  );

  -- Emit permission grant events
  FOREACH v_perm_id IN ARRAY p_permission_ids
  LOOP
    v_perm_count := v_perm_count + 1;
    SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;

    PERFORM api.emit_domain_event(
      p_stream_id := v_role_id,
      p_stream_type := 'role',
      p_event_type := 'role.permission.granted',
      p_event_data := jsonb_build_object('permission_id', v_perm_id, 'permission_name', v_perm_name),
      p_event_metadata := jsonb_build_object(
        'user_id', v_user_id,
        'organization_id', v_org_id,
        'reason', CASE WHEN p_cloned_from_role_id IS NOT NULL THEN 'Permission cloned from source role'
          ELSE 'Initial permission grant during role creation' END
      )
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'role', jsonb_build_object(
    'id', v_role_id, 'name', p_name, 'description', p_description,
    'organizationId', v_org_id, 'orgHierarchyScope', v_scope_path::TEXT,
    'isActive', true, 'createdAt', now(), 'updatedAt', now()
  ));
END;
$$;


ALTER FUNCTION "api"."create_role"("p_name" "text", "p_description" "text", "p_org_hierarchy_scope" "text", "p_permission_ids" "uuid"[], "p_cloned_from_role_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."create_role"("p_name" "text", "p_description" "text", "p_org_hierarchy_scope" "text", "p_permission_ids" "uuid"[], "p_cloned_from_role_id" "uuid") IS 'Create a new role with permissions. Uses helper functions for subset-only delegation validation.';



CREATE OR REPLACE FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_result RECORD;
  v_affected_descendants JSONB;
  v_descendant_count INTEGER;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit
  SELECT * INTO v_existing
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Root organizations cannot be deactivated via this function.'
      )
    );
  END IF;

  -- Check if already deactivated
  IF v_existing.is_active = false THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::TEXT,
        'parentPath', v_existing.parent_path::TEXT,
        'timeZone', v_existing.timezone,
        'isActive', false,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      ),
      'message', 'Organization unit is already deactivated'
    );
  END IF;

  -- FIX: Collect all active descendants that will be affected by cascade deactivation
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::TEXT,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::INTEGER
  INTO v_affected_descendants, v_descendant_count
  FROM organization_units_projection ou
  WHERE ou.path <@ v_existing.path    -- Descendants of this OU (ltree containment)
    AND ou.id != p_unit_id            -- Exclude self
    AND ou.is_active = true           -- Only currently active ones
    AND ou.deleted_at IS NULL;

  -- CQRS: Emit organization_unit.deactivated event (no direct projection write)
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.deactivated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'path', v_existing.path::TEXT,
      'cascade_effect', 'role_assignment_blocked',
      'affected_descendants', v_affected_descendants,  -- FIX: Include descendants for cascade
      'total_descendants_affected', COALESCE(v_descendant_count, 0)
    ),
    jsonb_build_object(
      'source', 'api.deactivate_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Deactivated organization unit "%s" - role assignments to this OU and descendants blocked', v_existing.name),
      'timestamp', now()
    )
  );

  -- Query projection for result
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', COALESCE(v_result.id, p_unit_id),
      'name', COALESCE(v_result.name, v_existing.name),
      'displayName', COALESCE(v_result.display_name, v_existing.display_name),
      'path', COALESCE(v_result.path::TEXT, v_existing.path::TEXT),
      'parentPath', COALESCE(v_result.parent_path::TEXT, v_existing.parent_path::TEXT),
      'timeZone', COALESCE(v_result.timezone, v_existing.timezone),
      'isActive', COALESCE(v_result.is_active, false),
      'isRootOrganization', false,
      'createdAt', COALESCE(v_result.created_at, v_existing.created_at),
      'updatedAt', COALESCE(v_result.updated_at, now())
    )
  );
END;
$$;


ALTER FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") IS 'Frontend RPC: Freeze organizational unit. Emits organization_unit.deactivated event (CQRS).';



CREATE OR REPLACE FUNCTION "api"."deactivate_role"("p_role_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF NOT v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role already inactive',
      'errorDetails', jsonb_build_object('code', 'ALREADY_INACTIVE', 'message', 'Role is already deactivated')
    );
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.deactivated',
    p_event_data := jsonb_build_object('reason', 'Deactivated via Role Management UI'),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id,
      'reason', 'Role deactivation via UI'
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "api"."deactivate_role"("p_role_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."deactivate_role"("p_role_id" "uuid") IS 'Deactivate a role (soft freeze). Users with this role retain it but it cannot be assigned.';



CREATE OR REPLACE FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_child_count INTEGER;
  v_role_count INTEGER;
  v_event_id UUID;
  v_stream_version INTEGER;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit
  SELECT * INTO v_existing
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Root organizations cannot be deleted via this function.'
      )
    );
  END IF;

  -- Check for active children
  SELECT COUNT(*) INTO v_child_count
  FROM organization_units_projection
  WHERE parent_path = v_existing.path
    AND deleted_at IS NULL;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot delete: %s child unit(s) exist', v_child_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_CHILDREN',
        'count', v_child_count,
        'message', format('This unit has %s child unit(s). Delete or move them first.', v_child_count)
      )
    );
  END IF;

  -- Check for role assignments at or below this OU's scope
  -- Note: user_roles_projection uses hard-delete (no deleted_at column)
  SELECT COUNT(*) INTO v_role_count
  FROM user_roles_projection ur
  WHERE ur.scope_path IS NOT NULL
    AND ur.scope_path <@ v_existing.path;

  IF v_role_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot delete: %s role assignment(s) reference this unit', v_role_count),
      'errorDetails', jsonb_build_object(
        'code', 'HAS_ROLES',
        'count', v_role_count,
        'message', format('This unit has %s role assignment(s). Reassign them first.', v_role_count)
      )
    );
  END IF;

  -- CQRS: Emit organization_unit.deleted event (no direct projection write)
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.deleted',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'deleted_path', v_existing.path::TEXT,
      'had_role_references', false,
      'deletion_type', 'soft_delete'
    ),
    jsonb_build_object(
      'source', 'api.delete_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Soft-deleted organization unit "%s" after verifying zero role references', v_existing.name),
      'timestamp', now()
    )
  );

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', v_existing.id,
      'name', v_existing.name,
      'displayName', v_existing.display_name,
      'path', v_existing.path::TEXT,
      'parentPath', v_existing.parent_path::TEXT,
      'timeZone', v_existing.timezone,
      'isActive', false,
      'isRootOrganization', false,
      'createdAt', v_existing.created_at,
      'updatedAt', now(),
      'deletedAt', now()
    )
  );
END;
$$;


ALTER FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") IS 'Frontend RPC: Soft delete organizational unit. Emits organization_unit.deleted event (CQRS).';



CREATE OR REPLACE FUNCTION "api"."delete_role"("p_role_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
  v_user_count INTEGER;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role must be deactivated first',
      'errorDetails', jsonb_build_object('code', 'STILL_ACTIVE', 'message', 'Deactivate role before deletion')
    );
  END IF;

  SELECT COUNT(*) INTO v_user_count FROM user_roles_projection WHERE role_id = p_role_id;
  IF v_user_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role has user assignments',
      'errorDetails', jsonb_build_object(
        'code', 'HAS_USERS',
        'count', v_user_count,
        'message', format('%s users still assigned to this role', v_user_count)
      )
    );
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.deleted',
    p_event_data := jsonb_build_object('reason', 'Deleted via Role Management UI'),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id,
      'reason', 'Role deletion via UI'
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "api"."delete_role"("p_role_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."delete_role"("p_role_id" "uuid") IS 'Soft delete a role. Requires deactivation first and no user assignments.';



CREATE OR REPLACE FUNCTION "api"."dismiss_failed_event"("p_event_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_event RECORD;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Get the event
  SELECT id, event_type, stream_type, stream_id, processing_error, dismissed_at
  INTO v_event
  FROM domain_events
  WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event not found'
    );
  END IF;

  IF v_event.processing_error IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event has no processing error - cannot dismiss'
    );
  END IF;

  IF v_event.dismissed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event is already dismissed'
    );
  END IF;

  -- Dismiss the event
  UPDATE domain_events
  SET
    dismissed_at = NOW(),
    dismissed_by = v_user_id,
    dismiss_reason = p_reason
  WHERE id = p_event_id;

  -- Emit audit event
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.event_dismissed',
    jsonb_build_object(
      'target_event_id', p_event_id,
      'target_event_type', v_event.event_type,
      'target_stream_type', v_event.stream_type,
      'target_stream_id', v_event.stream_id,
      'reason', p_reason
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', COALESCE('Platform admin dismissed failed event: ' || p_reason, 'Platform admin dismissed failed event'),
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Event dismissed successfully'
  );
END;
$$;


ALTER FUNCTION "api"."dismiss_failed_event"("p_event_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."dismiss_failed_event"("p_event_id" "uuid", "p_reason" "text") IS 'Dismisses a failed domain event (marks as acknowledged).
Requires platform.admin permission.
Emits platform.admin.event_dismissed audit event.';



CREATE OR REPLACE FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
  v_correlation_id UUID;
  v_session_id UUID;
  v_trace_id TEXT;
  v_span_id TEXT;
  v_parent_span_id TEXT;
BEGIN
  -- Calculate next stream version
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_stream_id AND stream_type = p_stream_type;

  -- Extract tracing fields from metadata (if present)
  -- UUID fields: use explicit cast with validation
  BEGIN
    v_correlation_id := (p_event_metadata->>'correlation_id')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_correlation_id := NULL;
  END;

  BEGIN
    v_session_id := (p_event_metadata->>'session_id')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session_id := NULL;
  END;

  -- Text fields: direct extraction
  v_trace_id := p_event_metadata->>'trace_id';
  v_span_id := p_event_metadata->>'span_id';
  v_parent_span_id := p_event_metadata->>'parent_span_id';

  -- Insert event with tracing columns populated
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    correlation_id,
    session_id,
    trace_id,
    span_id,
    parent_span_id,
    created_at
  ) VALUES (
    p_stream_id,
    p_stream_type,
    v_stream_version,
    p_event_type,
    p_event_data,
    p_event_metadata,
    v_correlation_id,
    v_session_id,
    v_trace_id,
    v_span_id,
    v_parent_span_id,
    NOW()
  ) RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;


ALTER FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") IS 'Emit domain event with auto-calculated stream_version and tracing support.

Parameters:
  - p_stream_id: UUID of the aggregate (role, user, etc.)
  - p_stream_type: Type of aggregate (role, user, organization)
  - p_event_type: Event type following AsyncAPI contract
  - p_event_data: Event payload (business data)
  - p_event_metadata: Audit and tracing context (optional)

Tracing Fields (extracted from p_event_metadata if present):
  - correlation_id: UUID for business-level request correlation
  - session_id: UUID for user auth session
  - trace_id: W3C trace ID (32 hex chars)
  - span_id: W3C span ID (16 hex chars)
  - parent_span_id: Parent span for causation chain

Returns:
  UUID of the created event

Example with tracing:
  SELECT api.emit_domain_event(
    ''123e4567-e89b-12d3-a456-426614174000''::uuid,
    ''user'',
    ''user.created'',
    ''{"email": "test@example.com"}''::jsonb,
    ''{"user_id": "...", "correlation_id": "...", "trace_id": "..."}''::jsonb
  );

@see documentation/infrastructure/guides/event-observability.md
';



CREATE OR REPLACE FUNCTION "api"."emit_workflow_started_event"("p_stream_id" "uuid", "p_bootstrap_event_id" "uuid", "p_workflow_id" "text", "p_workflow_run_id" "text", "p_workflow_type" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
BEGIN
  -- Validate inputs
  IF p_stream_id IS NULL THEN
    RAISE EXCEPTION 'stream_id cannot be null';
  END IF;

  IF p_bootstrap_event_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_event_id cannot be null';
  END IF;

  IF p_workflow_id IS NULL OR p_workflow_id = '' THEN
    RAISE EXCEPTION 'workflow_id cannot be null or empty';
  END IF;

  IF p_workflow_run_id IS NULL OR p_workflow_run_id = '' THEN
    RAISE EXCEPTION 'workflow_run_id cannot be null or empty';
  END IF;

  -- Get next version for this organization stream
  SELECT COALESCE(MAX(stream_version), 0) + 1
  INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_stream_id
    AND stream_type = 'organization';

  -- Insert workflow started event into domain_events
  INSERT INTO public.domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    created_at
  ) VALUES (
    p_stream_id,
    'organization',
    v_stream_version,
    'organization.bootstrap.workflow_started',
    jsonb_build_object(
      'bootstrap_event_id', p_bootstrap_event_id,
      'workflow_id', p_workflow_id,
      'workflow_run_id', p_workflow_run_id,
      'workflow_type', COALESCE(p_workflow_type, 'organizationBootstrapWorkflow')
    ),
    jsonb_build_object(
      'triggered_by', 'event_listener',
      'trigger_time', NOW()::TEXT
    ),
    NOW()
  )
  RETURNING id INTO v_event_id;

  -- Log success
  RAISE NOTICE 'Emitted organization.bootstrap.workflow_started event: % for workflow: %',
    v_event_id, p_workflow_id;

  RETURN v_event_id;

EXCEPTION
  WHEN OTHERS THEN
    -- Log error details
    RAISE WARNING 'Failed to emit workflow_started event: % - %', SQLERRM, SQLSTATE;
    -- Re-raise exception
    RAISE;
END;
$$;


ALTER FUNCTION "api"."emit_workflow_started_event"("p_stream_id" "uuid", "p_bootstrap_event_id" "uuid", "p_workflow_id" "text", "p_workflow_run_id" "text", "p_workflow_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."emit_workflow_started_event"("p_stream_id" "uuid", "p_bootstrap_event_id" "uuid", "p_workflow_id" "text", "p_workflow_run_id" "text", "p_workflow_type" "text") IS 'Emits organization.bootstrap.workflow_started event after event listener starts Temporal workflow.

   Maintains event sourcing immutability by creating NEW event rather than updating existing event.

   Parameters:
     p_stream_id: Organization ID (stream_id from bootstrap.initiated event)
     p_bootstrap_event_id: ID of the organization.bootstrap.initiated event
     p_workflow_id: Temporal workflow ID (deterministic: org-bootstrap-{stream_id})
     p_workflow_run_id: Temporal workflow execution run ID
     p_workflow_type: Temporal workflow type name (default: organizationBootstrapWorkflow)

   Returns: UUID of the created workflow_started event

   Example Usage:
     SELECT api.emit_workflow_started_event(
       ''d8846196-8f69-46dc-af9a-87a57843c4e4'',
       ''b8309521-a46f-4d71-becb-1f138878425b'',
       ''org-bootstrap-d8846196-8f69-46dc-af9a-87a57843c4e4'',
       ''019ab7a4-a6bf-70a3-8394-7b09371e98ba'',
       ''organizationBootstrapWorkflow''
     );

   See: documentation/infrastructure/reference/events/organization-bootstrap-workflow-started.md';



CREATE OR REPLACE FUNCTION "api"."find_contacts_by_phone"("p_organization_id" "uuid", "p_phone_number" "text") RETURNS TABLE("contact_id" "uuid", "contact_name" "text", "contact_type" "public"."contact_type", "contact_email" "text", "is_shared" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_normalized_phone TEXT;
  v_phone_contact_count INT;
BEGIN
  -- Normalize phone number: remove non-digits for comparison
  v_normalized_phone := regexp_replace(p_phone_number, '[^0-9]', '', 'g');

  -- Count how many contacts have this phone (for is_shared flag)
  SELECT COUNT(DISTINCT cp.contact_id) INTO v_phone_contact_count
  FROM phones_projection p
  JOIN contact_phones cp ON cp.phone_id = p.id
  JOIN contacts_projection c ON c.id = cp.contact_id
  WHERE regexp_replace(p.number, '[^0-9]', '', 'g') = v_normalized_phone
    AND c.organization_id = p_organization_id
    AND p.deleted_at IS NULL
    AND c.deleted_at IS NULL;

  -- Return matching contacts
  RETURN QUERY
  SELECT
    c.id AS contact_id,
    CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
    c.type AS contact_type,
    c.email AS contact_email,
    (v_phone_contact_count > 1) AS is_shared
  FROM phones_projection p
  JOIN contact_phones cp ON cp.phone_id = p.id
  JOIN contacts_projection c ON c.id = cp.contact_id
  WHERE regexp_replace(p.number, '[^0-9]', '', 'g') = v_normalized_phone
    AND c.organization_id = p_organization_id
    AND p.deleted_at IS NULL
    AND c.deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "api"."find_contacts_by_phone"("p_organization_id" "uuid", "p_phone_number" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."find_contacts_by_phone"("p_organization_id" "uuid", "p_phone_number" "text") IS 'Find contacts by phone number. Used when admin enters a phone for a user to suggest contact linking. Returns is_shared=true if phone is used by multiple contacts (requires user confirmation).';



CREATE OR REPLACE FUNCTION "api"."get_addresses_by_org"("p_org_id" "uuid") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT a.id
  FROM addresses_projection a
  WHERE a.organization_id = p_org_id;
END;
$$;


ALTER FUNCTION "api"."get_addresses_by_org"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_addresses_by_org"("p_org_id" "uuid") IS 'Get addresses for an organization. SECURITY INVOKER - respects RLS.';



CREATE OR REPLACE FUNCTION "api"."get_assignable_roles"("p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("role_id" "uuid", "role_name" "text", "role_description" "text", "org_hierarchy_scope" "text", "permission_count" bigint, "is_assignable" boolean, "restriction_reason" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_user_perms UUID[];
  v_user_scopes extensions.ltree[];
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := COALESCE(p_org_id, public.get_current_org_id());

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  -- Get inviter's permissions and scopes
  v_user_perms := public.get_user_aggregated_permissions(v_user_id);
  v_user_scopes := public.get_user_scope_paths(v_user_id);

  RETURN QUERY
  SELECT
    r.id AS role_id,
    r.name AS role_name,
    r.description AS role_description,
    r.org_hierarchy_scope::TEXT AS org_hierarchy_scope,
    COALESCE(perm_counts.perm_count, 0) AS permission_count,
    -- Role is assignable if:
    -- 1. All its permissions are in inviter's permission set
    -- 2. Its scope is within inviter's scope hierarchy
    CASE
      WHEN NOT public.check_permissions_subset(
        COALESCE(role_perms.permissions, '{}'),
        v_user_perms
      ) THEN FALSE
      WHEN NOT public.check_scope_containment(
        r.org_hierarchy_scope,
        v_user_scopes
      ) THEN FALSE
      ELSE TRUE
    END AS is_assignable,
    -- Explain why not assignable (for debugging/UI)
    CASE
      WHEN NOT public.check_permissions_subset(
        COALESCE(role_perms.permissions, '{}'),
        v_user_perms
      ) THEN 'Role has permissions you do not possess'
      WHEN NOT public.check_scope_containment(
        r.org_hierarchy_scope,
        v_user_scopes
      ) THEN 'Role scope is outside your authority'
      ELSE NULL
    END AS restriction_reason
  FROM roles_projection r
  LEFT JOIN (
    SELECT rp.role_id, array_agg(rp.permission_id) AS permissions
    FROM role_permissions_projection rp
    GROUP BY rp.role_id
  ) role_perms ON role_perms.role_id = r.id
  LEFT JOIN (
    SELECT rp.role_id, COUNT(*) AS perm_count
    FROM role_permissions_projection rp
    GROUP BY rp.role_id
  ) perm_counts ON perm_counts.role_id = r.id
  WHERE r.organization_id = v_org_id
    AND r.is_active = TRUE
    AND r.deleted_at IS NULL
  ORDER BY r.name;
END;
$$;


ALTER FUNCTION "api"."get_assignable_roles"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_assignable_roles"("p_org_id" "uuid") IS 'Returns roles in the organization with assignability status based on inviter constraints (permission subset + scope hierarchy).';



CREATE OR REPLACE FUNCTION "api"."get_bootstrap_status"("p_bootstrap_id" "uuid") RETURNS TABLE("bootstrap_id" "uuid", "organization_id" "uuid", "status" "text", "current_stage" "text", "error_message" "text", "created_at" timestamp with time zone, "completed_at" timestamp with time zone, "domain" "text", "dns_configured" boolean, "invitations_sent" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user from JWT
  v_user_id := auth.uid();

  -- Allow access if:
  -- 1. User has platform.admin permission (platform-wide access)
  -- 2. User has a role in the organization being queried
  -- 3. User initiated the bootstrap (found in event metadata)
  IF v_user_id IS NOT NULL THEN
    IF NOT (
      -- Tier 1: Platform admin can view any organization
      public.has_platform_privilege()
      OR
      -- Tier 3: User has role in the organization being queried
      EXISTS (
        SELECT 1 FROM user_roles_projection
        WHERE user_id = v_user_id
          AND org_id = p_bootstrap_id
      )
      OR
      -- User initiated the bootstrap (check event metadata)
      EXISTS (
        SELECT 1 FROM domain_events
        WHERE stream_id = p_bootstrap_id
          AND event_type = 'organization.bootstrap.initiated'
          AND event_metadata->>'user_id' = v_user_id::TEXT
      )
    ) THEN
      -- Not authorized - return empty result (consistent with "not found" behavior)
      RETURN;
    END IF;
  END IF;

  -- The p_bootstrap_id is now the organization_id (unified ID system)
  RETURN QUERY
  SELECT * FROM get_bootstrap_status(p_bootstrap_id);
END;
$$;


ALTER FUNCTION "api"."get_bootstrap_status"("p_bootstrap_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_bootstrap_status"("p_bootstrap_id" "uuid") IS 'Get bootstrap workflow status for an organization.
Authorization:
- Platform admins (has_platform_privilege) can view any org
- Users with roles in the org can view
- Users who initiated the bootstrap can view';



CREATE OR REPLACE FUNCTION "api"."get_child_organizations"("p_parent_org_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "display_name" "text", "slug" "text", "type" "text", "path" "text", "parent_path" "text", "timezone" "text", "is_active" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_parent_path LTREE;
BEGIN
  -- Get parent's path first
  SELECT path INTO v_parent_path
  FROM organizations_projection
  WHERE id = p_parent_org_id;

  -- If parent not found, return empty
  IF v_parent_path IS NULL THEN
    RETURN;
  END IF;

  -- Find all children using ltree path matching
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
    o.updated_at
  FROM organizations_projection o
  WHERE o.parent_path = v_parent_path
  ORDER BY o.name ASC;
END;
$$;


ALTER FUNCTION "api"."get_child_organizations"("p_parent_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_child_organizations"("p_parent_org_id" "uuid") IS 'Frontend RPC: Get child organizations by parent org UUID using ltree hierarchy.';



CREATE OR REPLACE FUNCTION "api"."get_contacts_by_org"("p_org_id" "uuid") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT c.id
  FROM contacts_projection c
  WHERE c.organization_id = p_org_id;
END;
$$;


ALTER FUNCTION "api"."get_contacts_by_org"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_contacts_by_org"("p_org_id" "uuid") IS 'Get contacts for an organization. SECURITY INVOKER - respects RLS.';



CREATE OR REPLACE FUNCTION "api"."get_emails_by_org"("p_org_id" "uuid") RETURNS TABLE("id" "uuid", "organization_id" "uuid", "label" "text", "type" "public"."email_type", "address" "text", "is_primary" boolean, "is_active" boolean, "metadata" "jsonb", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.organization_id, e.label, e.type, e.address,
    e.is_primary, e.is_active, e.metadata,
    e.created_at, e.updated_at
  FROM emails_projection e
  WHERE e.organization_id = p_org_id
    AND e.deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "api"."get_emails_by_org"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_emails_by_org"("p_org_id" "uuid") IS 'Get emails for an organization. SECURITY INVOKER - respects RLS.';



CREATE OR REPLACE FUNCTION "api"."get_event_processing_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Emit audit event
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.processing_stats_viewed',
    jsonb_build_object('timestamp', NOW()),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin viewed event processing statistics',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  SELECT jsonb_build_object(
    'total_events', (SELECT COUNT(*) FROM domain_events),
    'failed_events', (SELECT COUNT(*) FROM domain_events WHERE processing_error IS NOT NULL AND dismissed_at IS NULL),
    'failed_last_24h', (
      SELECT COUNT(*) FROM domain_events
      WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
        AND created_at >= NOW() - INTERVAL '24 hours'
    ),
    'dismissed_count', (SELECT COUNT(*) FROM domain_events WHERE dismissed_at IS NOT NULL),
    'dismissed_last_24h', (
      SELECT COUNT(*) FROM domain_events
      WHERE dismissed_at IS NOT NULL
        AND dismissed_at >= NOW() - INTERVAL '24 hours'
    ),
    'failed_by_event_type', (
      SELECT COALESCE(jsonb_object_agg(de.event_type, cnt), '{}'::jsonb)
      FROM (
        SELECT event_type, COUNT(*) as cnt
        FROM domain_events
        WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
        GROUP BY event_type
        ORDER BY cnt DESC
        LIMIT 20
      ) de
    ),
    'failed_by_stream_type', (
      SELECT COALESCE(jsonb_object_agg(de.stream_type, cnt), '{}'::jsonb)
      FROM (
        SELECT stream_type, COUNT(*) as cnt
        FROM domain_events
        WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
        GROUP BY stream_type
        ORDER BY cnt DESC
      ) de
    ),
    'recent_failures', (
      SELECT COALESCE(jsonb_agg(row_to_json(de)), '[]'::jsonb)
      FROM (
        SELECT id, stream_type, event_type, processing_error, created_at
        FROM domain_events
        WHERE processing_error IS NOT NULL AND dismissed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 10
      ) de
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "api"."get_event_processing_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_event_processing_stats"() IS 'Returns event processing statistics for platform observability.
Requires platform.admin permission.
Emits platform.admin.processing_stats_viewed audit event.

Returns:
  total_events - Total events in system
  failed_events - Failed events not dismissed
  failed_last_24h - Failed events in last 24 hours (not dismissed)
  dismissed_count - Total dismissed events
  dismissed_last_24h - Events dismissed in last 24 hours
  failed_by_event_type - Breakdown by event type
  failed_by_stream_type - Breakdown by stream type
  recent_failures - 10 most recent failures';



CREATE OR REPLACE FUNCTION "api"."get_events_by_correlation"("p_correlation_id" "uuid", "p_limit" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "event_type" "text", "stream_id" "uuid", "stream_type" "text", "event_data" "jsonb", "event_metadata" "jsonb", "correlation_id" "uuid", "session_id" "uuid", "trace_id" "text", "span_id" "text", "parent_span_id" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.event_data,
    de.event_metadata,
    de.correlation_id,
    de.session_id,
    de.trace_id,
    de.span_id,
    de.parent_span_id,
    de.created_at
  FROM domain_events de
  WHERE de.correlation_id = p_correlation_id
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "api"."get_events_by_correlation"("p_correlation_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_events_by_session"("p_session_id" "uuid", "p_limit" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "event_type" "text", "stream_id" "uuid", "stream_type" "text", "event_data" "jsonb", "event_metadata" "jsonb", "correlation_id" "uuid", "session_id" "uuid", "trace_id" "text", "span_id" "text", "parent_span_id" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.event_data,
    de.event_metadata,
    de.correlation_id,
    de.session_id,
    de.trace_id,
    de.span_id,
    de.parent_span_id,
    de.created_at
  FROM domain_events de
  WHERE de.session_id = p_session_id
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "api"."get_events_by_session"("p_session_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_failed_events"("p_limit" integer DEFAULT 50, "p_event_type" "text" DEFAULT NULL::"text", "p_stream_type" "text" DEFAULT NULL::"text", "p_since" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("id" "uuid", "stream_id" "uuid", "stream_type" "text", "stream_version" integer, "event_type" "text", "event_data" "jsonb", "event_metadata" "jsonb", "processing_error" "text", "processed_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_result_count INT;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Emit audit event (use gen_random_uuid() for stream_id - each audit is standalone)
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.failed_events_viewed',
    jsonb_build_object(
      'filters', jsonb_build_object(
        'limit', p_limit,
        'event_type', p_event_type,
        'stream_type', p_stream_type,
        'since', p_since
      )
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin viewed failed events for observability monitoring',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  RETURN QUERY
  SELECT
    de.id,
    de.stream_id,
    de.stream_type,
    de.stream_version,
    de.event_type,
    de.event_data,
    de.event_metadata,
    de.processing_error,
    de.processed_at,
    de.created_at
  FROM domain_events de
  WHERE de.processing_error IS NOT NULL
    AND (p_event_type IS NULL OR de.event_type = p_event_type)
    AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
    AND (p_since IS NULL OR de.created_at >= p_since)
  ORDER BY de.created_at DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "api"."get_failed_events"("p_limit" integer, "p_event_type" "text", "p_stream_type" "text", "p_since" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_failed_events"("p_limit" integer, "p_event_type" "text", "p_stream_type" "text", "p_since" timestamp with time zone) IS 'Returns failed domain events for platform observability.
Requires platform.admin permission.
Emits platform.admin.failed_events_viewed audit event.';



CREATE OR REPLACE FUNCTION "api"."get_failed_events"("p_limit" integer DEFAULT 25, "p_offset" integer DEFAULT 0, "p_event_type" "text" DEFAULT NULL::"text", "p_stream_type" "text" DEFAULT NULL::"text", "p_since" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_include_dismissed" boolean DEFAULT false, "p_sort_by" "text" DEFAULT 'created_at'::"text", "p_sort_order" "text" DEFAULT 'desc'::"text") RETURNS TABLE("id" "uuid", "stream_id" "uuid", "stream_type" "text", "stream_version" integer, "event_type" "text", "event_data" "jsonb", "event_metadata" "jsonb", "processing_error" "text", "processed_at" timestamp with time zone, "created_at" timestamp with time zone, "dismissed_at" timestamp with time zone, "dismissed_by" "uuid", "dismiss_reason" "text", "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_total_count BIGINT;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  -- Validate sort parameters
  IF p_sort_by NOT IN ('created_at', 'event_type') THEN
    RAISE EXCEPTION 'Invalid sort_by value. Must be created_at or event_type';
  END IF;
  IF p_sort_order NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Invalid sort_order value. Must be asc or desc';
  END IF;

  v_user_id := auth.uid();

  -- Emit audit event
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.failed_events_viewed',
    jsonb_build_object(
      'filters', jsonb_build_object(
        'limit', p_limit,
        'offset', p_offset,
        'event_type', p_event_type,
        'stream_type', p_stream_type,
        'since', p_since,
        'include_dismissed', p_include_dismissed,
        'sort_by', p_sort_by,
        'sort_order', p_sort_order
      )
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin viewed failed events for observability monitoring',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  -- Get total count for pagination
  SELECT COUNT(*) INTO v_total_count
  FROM domain_events de
  WHERE de.processing_error IS NOT NULL
    AND (p_event_type IS NULL OR de.event_type = p_event_type)
    AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
    AND (p_since IS NULL OR de.created_at >= p_since)
    AND (p_include_dismissed OR de.dismissed_at IS NULL);

  -- Return results with dynamic sorting
  IF p_sort_by = 'created_at' AND p_sort_order = 'desc' THEN
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.created_at DESC
    LIMIT p_limit OFFSET p_offset;
  ELSIF p_sort_by = 'created_at' AND p_sort_order = 'asc' THEN
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.created_at ASC
    LIMIT p_limit OFFSET p_offset;
  ELSIF p_sort_by = 'event_type' AND p_sort_order = 'desc' THEN
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.event_type DESC, de.created_at DESC
    LIMIT p_limit OFFSET p_offset;
  ELSE -- event_type ASC
    RETURN QUERY
    SELECT
      de.id, de.stream_id, de.stream_type, de.stream_version, de.event_type,
      de.event_data, de.event_metadata, de.processing_error, de.processed_at,
      de.created_at, de.dismissed_at, de.dismissed_by, de.dismiss_reason,
      v_total_count
    FROM domain_events de
    WHERE de.processing_error IS NOT NULL
      AND (p_event_type IS NULL OR de.event_type = p_event_type)
      AND (p_stream_type IS NULL OR de.stream_type = p_stream_type)
      AND (p_since IS NULL OR de.created_at >= p_since)
      AND (p_include_dismissed OR de.dismissed_at IS NULL)
    ORDER BY de.event_type ASC, de.created_at DESC
    LIMIT p_limit OFFSET p_offset;
  END IF;
END;
$$;


ALTER FUNCTION "api"."get_failed_events"("p_limit" integer, "p_offset" integer, "p_event_type" "text", "p_stream_type" "text", "p_since" timestamp with time zone, "p_include_dismissed" boolean, "p_sort_by" "text", "p_sort_order" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_failed_events"("p_limit" integer, "p_offset" integer, "p_event_type" "text", "p_stream_type" "text", "p_since" timestamp with time zone, "p_include_dismissed" boolean, "p_sort_by" "text", "p_sort_order" "text") IS 'Returns failed domain events with pagination, sorting, and dismiss filtering.
Requires platform.admin permission.
Emits platform.admin.failed_events_viewed audit event.

Parameters:
  p_limit (default 25) - Max events per page
  p_offset (default 0) - Pagination offset
  p_event_type - Filter by event type
  p_stream_type - Filter by stream type
  p_since - Filter events created after timestamp
  p_include_dismissed (default false) - Include dismissed events
  p_sort_by (default created_at) - Sort column: created_at or event_type
  p_sort_order (default desc) - Sort direction: asc or desc';



CREATE OR REPLACE FUNCTION "api"."get_invitation_by_id"("p_invitation_id" "uuid") RETURNS TABLE("id" "uuid", "email" "text", "first_name" "text", "last_name" "text", "organization_id" "uuid", "roles" "jsonb", "token" "text", "status" "text", "expires_at" timestamp with time zone, "access_start_date" "date", "access_expiration_date" "date", "notification_preferences" "jsonb", "accepted_at" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'api'
    AS $$
DECLARE
  v_invitation_org_id UUID;
  v_current_user_email TEXT;
  v_has_org_admin BOOLEAN;
  v_has_platform_privilege BOOLEAN;
BEGIN
  -- Get invitation's organization
  SELECT i.organization_id INTO v_invitation_org_id
  FROM public.invitations_projection i
  WHERE i.id = p_invitation_id;
  
  IF v_invitation_org_id IS NULL THEN
    -- Invitation not found, return empty
    RETURN;
  END IF;
  
  -- Get current user context
  v_current_user_email := (current_setting('request.jwt.claims', true)::json->>'email');
  v_has_org_admin := has_org_admin_permission();
  v_has_platform_privilege := has_platform_privilege();
  
  -- Permission check: must be org admin for this org, platform admin, or the invited user
  IF NOT (
    v_has_platform_privilege 
    OR (v_has_org_admin AND v_invitation_org_id = get_current_org_id())
    OR EXISTS (
      SELECT 1 FROM public.invitations_projection i 
      WHERE i.id = p_invitation_id AND i.email = v_current_user_email
    )
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to view this invitation';
  END IF;
  
  -- Return the invitation
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.first_name,
    i.last_name,
    i.organization_id,
    i.roles,
    NULL::TEXT AS token,  -- Never expose tokens via API
    i.status,
    i.expires_at,
    i.access_start_date,
    i.access_expiration_date,
    i.notification_preferences,
    i.accepted_at,
    i.created_at,
    i.updated_at
  FROM public.invitations_projection i
  WHERE i.id = p_invitation_id;
END;
$$;


ALTER FUNCTION "api"."get_invitation_by_id"("p_invitation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_invitation_by_org_and_email"("p_org_id" "uuid", "p_email" "text") RETURNS TABLE("invitation_id" "uuid", "email" "text", "token" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT i.invitation_id, i.email, i.token, i.expires_at
  FROM invitations_projection i
  WHERE i.organization_id = p_org_id
    AND i.email = p_email
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."get_invitation_by_org_and_email"("p_org_id" "uuid", "p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_invitation_by_org_and_email"("p_org_id" "uuid", "p_email" "text") IS 'Get invitation by org and email. SECURITY INVOKER - respects RLS.';



CREATE OR REPLACE FUNCTION "api"."get_invitation_by_token"("p_token" "text") RETURNS TABLE("id" "uuid", "token" "text", "email" "text", "organization_id" "uuid", "organization_name" "text", "role" "text", "roles" "jsonb", "first_name" "text", "last_name" "text", "status" "text", "expires_at" timestamp with time zone, "accepted_at" timestamp with time zone, "correlation_id" "uuid", "contact_id" "uuid", "phones" "jsonb", "notification_preferences" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.token,
    i.email,
    i.organization_id,
    o.name as organization_name,
    -- Fix: Extract role from roles JSONB array when role column is NULL
    COALESCE(i.role, i.roles->0->>'roleName', i.roles->0->>'role_name') as role,
    i.roles,
    i.first_name,
    i.last_name,
    i.status,
    i.expires_at,
    i.accepted_at,
    i.correlation_id,
    i.contact_id,
    COALESCE(i.phones, '[]'::jsonb) as phones,
    COALESCE(i.notification_preferences, '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb) as notification_preferences
  FROM public.invitations_projection i
  LEFT JOIN public.organizations_projection o ON o.id = i.organization_id
  WHERE i.token = p_token;
END;
$$;


ALTER FUNCTION "api"."get_invitation_by_token"("p_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") IS 'Get invitation details by token for validation. Returns correlation_id for lifecycle tracing, contact_id for contact-user linking, first_name/last_name/roles for user creation, and phones/notification_preferences for Phase 6 invitation flow.';



CREATE OR REPLACE FUNCTION "api"."get_invitation_for_resend"("p_invitation_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("id" "uuid", "invitation_id" "uuid", "email" "text", "first_name" "text", "last_name" "text", "status" "text", "roles" "jsonb", "access_start_date" "date", "access_expiration_date" "date", "notification_preferences" "jsonb", "organization_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'api'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.invitation_id,
    i.email,
    i.first_name,
    i.last_name,
    i.status,
    i.roles,
    i.access_start_date,
    i.access_expiration_date,
    i.notification_preferences,
    i.organization_id
  FROM public.invitations_projection i
  WHERE i.id = p_invitation_id
    AND i.organization_id = p_org_id;
END;
$$;


ALTER FUNCTION "api"."get_invitation_for_resend"("p_invitation_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_invitation_for_resend"("p_invitation_id" "uuid", "p_org_id" "uuid") IS 'Get invitation details for resend operation. Returns both id and invitation_id for proper event correlation.';



CREATE OR REPLACE FUNCTION "api"."get_organization_by_id"("p_org_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "display_name" "text", "slug" "text", "type" "text", "path" "text", "parent_path" "text", "timezone" "text", "is_active" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "subdomain_status" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
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
    o.subdomain_status::TEXT
  FROM organizations_projection o
  WHERE o.id = p_org_id
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."get_organization_by_id"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_organization_by_id"("p_org_id" "uuid") IS 'Frontend RPC: Get single organization by UUID. Includes subdomain_status for redirect decisions.';



CREATE OR REPLACE FUNCTION "api"."get_organization_name"("p_org_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  org_name TEXT;
BEGIN
  SELECT name INTO org_name
  FROM organizations_projection
  WHERE id = p_org_id;

  RETURN org_name;
END;
$$;


ALTER FUNCTION "api"."get_organization_name"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_organization_status"("p_org_id" "uuid") RETURNS TABLE("is_active" boolean, "deleted_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT o.is_active, o.deleted_at
  FROM organizations_projection o
  WHERE o.id = p_org_id
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."get_organization_status"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_organization_status"("p_org_id" "uuid") IS 'Get organization status. SECURITY INVOKER - respects RLS.';



CREATE OR REPLACE FUNCTION "api"."get_organization_unit_by_id"("p_unit_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "display_name" "text", "path" "text", "parent_path" "text", "parent_id" "uuid", "timezone" "text", "is_active" boolean, "child_count" bigint, "is_root_organization" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
BEGIN
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Try root organization first (depth = 1)
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.path::TEXT,
    o.parent_path::TEXT,
    NULL::UUID AS parent_id,
    o.timezone,
    o.is_active,
    (SELECT COUNT(*) FROM organization_units_projection c WHERE c.parent_path = o.path AND c.deleted_at IS NULL) AS child_count,
    true AS is_root_organization,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND nlevel(o.path) = 1
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Try sub-organization (depth > 1)
  RETURN QUERY
  SELECT
    ou.id,
    ou.name,
    ou.display_name,
    ou.path::TEXT,
    ou.parent_path::TEXT,
    (
      SELECT COALESCE(
        (SELECT p.id FROM organization_units_projection p WHERE p.path = ou.parent_path LIMIT 1),
        (SELECT o.id FROM organizations_projection o WHERE o.path = ou.parent_path LIMIT 1)
      )
    ) AS parent_id,
    ou.timezone,
    ou.is_active,
    (SELECT COUNT(*) FROM organization_units_projection c WHERE c.parent_path = ou.path AND c.deleted_at IS NULL) AS child_count,
    false AS is_root_organization,
    ou.created_at,
    ou.updated_at
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."get_organization_unit_by_id"("p_unit_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_organization_unit_descendants"("p_unit_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "display_name" "text", "path" "text", "parent_path" "text", "parent_id" "uuid", "timezone" "text", "is_active" boolean, "child_count" bigint, "is_root_organization" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
  v_unit_path LTREE;
BEGIN
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get the unit's path (could be root org or sub-org)
  SELECT o.path INTO v_unit_path
  FROM organizations_projection o
  WHERE o.id = p_unit_id
    AND o.deleted_at IS NULL
    AND v_scope_path @> o.path;

  IF v_unit_path IS NULL THEN
    SELECT ou.path INTO v_unit_path
    FROM organization_units_projection ou
    WHERE ou.id = p_unit_id
      AND ou.deleted_at IS NULL
      AND v_scope_path @> ou.path;
  END IF;

  -- If unit not found or not in scope, return empty
  IF v_unit_path IS NULL THEN
    RETURN;
  END IF;

  -- Return all descendants from organization_units_projection
  RETURN QUERY
  SELECT
    ou.id,
    ou.name,
    ou.display_name,
    ou.path::TEXT,
    ou.parent_path::TEXT,
    (
      SELECT COALESCE(
        (SELECT p.id FROM organization_units_projection p WHERE p.path = ou.parent_path LIMIT 1),
        (SELECT o.id FROM organizations_projection o WHERE o.path = ou.parent_path LIMIT 1)
      )
    ) AS parent_id,
    ou.timezone,
    ou.is_active,
    (SELECT COUNT(*) FROM organization_units_projection c WHERE c.parent_path = ou.path AND c.deleted_at IS NULL) AS child_count,
    false AS is_root_organization,
    ou.created_at,
    ou.updated_at
  FROM organization_units_projection ou
  WHERE v_unit_path @> ou.path  -- Descendants of the unit
    AND ou.path != v_unit_path  -- Exclude the unit itself
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path  -- Must also be within user's scope
  ORDER BY ou.path ASC;
END;
$$;


ALTER FUNCTION "api"."get_organization_unit_descendants"("p_unit_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_organization_unit_descendants"("p_unit_id" "uuid") IS 'Frontend RPC: Get all descendants of an organizational unit.';



CREATE OR REPLACE FUNCTION "api"."get_organization_units"("p_status" "text" DEFAULT 'all'::"text", "p_search_term" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "name" "text", "display_name" "text", "path" "text", "parent_path" "text", "parent_id" "uuid", "timezone" "text", "is_active" boolean, "child_count" bigint, "is_root_organization" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
BEGIN
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims - user not associated with organization'
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
    SELECT
      au.parent_path AS parent,
      COUNT(*) AS cnt
    FROM all_units au
    WHERE au.parent_path IS NOT NULL
    GROUP BY au.parent_path
  )
  SELECT
    au.id,
    au.name,
    au.display_name,
    au.path::TEXT,
    au.parent_path::TEXT,
    (
      SELECT p.id FROM all_units p WHERE p.path = au.parent_path LIMIT 1
    ) AS parent_id,
    au.timezone,
    au.is_active,
    COALESCE(uc.cnt, 0) AS child_count,
    au.is_root_org AS is_root_organization,
    au.created_at,
    au.updated_at
  FROM all_units au
  LEFT JOIN unit_children uc ON uc.parent = au.path
  WHERE
    (
      p_status = 'all'
      OR (p_status = 'active' AND au.is_active = true)
      OR (p_status = 'inactive' AND au.is_active = false)
    )
    AND (
      p_search_term IS NULL
      OR au.name ILIKE '%' || p_search_term || '%'
      OR au.display_name ILIKE '%' || p_search_term || '%'
    )
  ORDER BY au.path ASC;
END;
$$;


ALTER FUNCTION "api"."get_organization_units"("p_status" "text", "p_search_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_organizations"("p_type" "text" DEFAULT NULL::"text", "p_is_active" boolean DEFAULT NULL::boolean, "p_search_term" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "name" "text", "display_name" "text", "slug" "text", "type" "text", "path" "text", "parent_path" "text", "timezone" "text", "is_active" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
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
    o.updated_at
  FROM organizations_projection o
  WHERE
    -- Filter by organization type (if provided and not 'all')
    (p_type IS NULL OR p_type = 'all' OR o.type::TEXT = p_type)
    -- Filter by active status (if provided and not 'all')
    AND (p_is_active IS NULL OR o.is_active = p_is_active)
    -- Search by name or slug (if provided)
    AND (
      p_search_term IS NULL
      OR o.name ILIKE '%' || p_search_term || '%'
      OR o.slug ILIKE '%' || p_search_term || '%'
    )
  ORDER BY o.name ASC;
END;
$$;


ALTER FUNCTION "api"."get_organizations"("p_type" "text", "p_is_active" boolean, "p_search_term" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_organizations"("p_type" "text", "p_is_active" boolean, "p_search_term" "text") IS 'Frontend RPC: Query organizations with optional filters (type, status, search). Returns actual database columns only.';



CREATE OR REPLACE FUNCTION "api"."get_organizations_paginated"("p_type" "text" DEFAULT NULL::"text", "p_is_active" boolean DEFAULT NULL::boolean, "p_search_term" "text" DEFAULT NULL::"text", "p_page" integer DEFAULT 1, "p_page_size" integer DEFAULT 20, "p_sort_by" "text" DEFAULT 'name'::"text", "p_sort_order" "text" DEFAULT 'asc'::"text") RETURNS TABLE("id" "uuid", "name" "text", "display_name" "text", "slug" "text", "type" "text", "path" "text", "parent_path" "text", "timezone" "text", "is_active" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $_$
DECLARE
  v_offset INTEGER;
  v_limit INTEGER;
  v_sort_column TEXT;
  v_sort_direction TEXT;
BEGIN
  -- Validate and sanitize pagination parameters
  v_limit := LEAST(GREATEST(p_page_size, 1), 100);  -- Clamp between 1 and 100
  v_offset := (GREATEST(p_page, 1) - 1) * v_limit;

  -- Validate sort column (whitelist to prevent SQL injection)
  v_sort_column := CASE p_sort_by
    WHEN 'name' THEN 'o.name'
    WHEN 'type' THEN 'o.type'
    WHEN 'created_at' THEN 'o.created_at'
    WHEN 'updated_at' THEN 'o.updated_at'
    ELSE 'o.name'  -- Default fallback
  END;

  -- Validate sort direction
  v_sort_direction := CASE WHEN LOWER(p_sort_order) = 'desc' THEN 'DESC' ELSE 'ASC' END;

  -- Execute query with dynamic sorting
  -- Using window function COUNT(*) OVER() for efficient total count
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
      COUNT(*) OVER() AS total_count
    FROM organizations_projection o
    WHERE
      -- Exclude soft-deleted organizations
      o.deleted_at IS NULL
      -- Filter by organization type (if provided)
      AND ($1 IS NULL OR o.type::TEXT = $1)
      -- Filter by active status (if provided)
      AND ($2 IS NULL OR o.is_active = $2)
      -- Search by name or slug (if provided)
      AND (
        $3 IS NULL
        OR o.name ILIKE ''%%'' || $3 || ''%%''
        OR o.slug ILIKE ''%%'' || $3 || ''%%''
        OR o.display_name ILIKE ''%%'' || $3 || ''%%''
      )
    ORDER BY %s %s
    LIMIT $4 OFFSET $5',
    v_sort_column,
    v_sort_direction
  )
  USING p_type, p_is_active, p_search_term, v_limit, v_offset;
END;
$_$;


ALTER FUNCTION "api"."get_organizations_paginated"("p_type" "text", "p_is_active" boolean, "p_search_term" "text", "p_page" integer, "p_page_size" integer, "p_sort_by" "text", "p_sort_order" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_organizations_paginated"("p_type" "text", "p_is_active" boolean, "p_search_term" "text", "p_page" integer, "p_page_size" integer, "p_sort_by" "text", "p_sort_order" "text") IS 'Frontend RPC: Query organizations with pagination, filtering, and sorting. Returns total_count for pagination UI. Used by OrganizationListPage.';



CREATE OR REPLACE FUNCTION "api"."get_pending_invitations_by_org"("p_org_id" "uuid") RETURNS TABLE("invitation_id" "uuid", "email" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT i.invitation_id, i.email
  FROM invitations_projection i
  WHERE i.organization_id = p_org_id
    AND i.status = 'pending';
END;
$$;


ALTER FUNCTION "api"."get_pending_invitations_by_org"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_pending_invitations_by_org"("p_org_id" "uuid") IS 'Get pending invitations for an organization. SECURITY INVOKER - respects RLS.';



CREATE OR REPLACE FUNCTION "api"."get_permission_ids_by_names"("p_names" "text"[]) RETURNS TABLE("id" "uuid", "name" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name
  FROM public.permissions_projection p
  WHERE p.name = ANY(p_names);
END;
$$;


ALTER FUNCTION "api"."get_permission_ids_by_names"("p_names" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_permission_ids_by_names"("p_names" "text"[]) IS 'Get permission IDs by names array. Called by Temporal activities for role.permission.granted events.';



CREATE OR REPLACE FUNCTION "api"."get_permissions"() RETURNS TABLE("id" "uuid", "name" "text", "applet" "text", "action" "text", "display_name" "text", "description" "text", "scope_type" "text", "requires_mfa" boolean)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_org_type TEXT;
BEGIN
  -- Get org_type from JWT custom claims
  v_org_type := COALESCE(
    auth.jwt()->'app_metadata'->>'org_type',
    auth.jwt()->>'org_type',
    'provider'  -- Default to provider (most restrictive) if not set
  );

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.applet,
    p.action,
    p.display_name,
    p.description,
    p.scope_type,
    p.requires_mfa
  FROM permissions_projection p
  WHERE
    -- Platform owners see everything
    -- Non-platform owners only see non-global permissions
    CASE
      WHEN v_org_type = 'platform_owner' THEN TRUE
      ELSE p.scope_type != 'global'
    END
  ORDER BY p.applet, p.action;
END;
$$;


ALTER FUNCTION "api"."get_permissions"() OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_permissions"() IS 'List available permissions filtered by org_type. Non-platform_owner users only see org/facility/program/client scoped permissions. Platform owners see all permissions including global scope.';



CREATE OR REPLACE FUNCTION "api"."get_person_phones"("p_contact_id" "uuid") RETURNS TABLE("id" "uuid", "source" "text", "label" "text", "phone_type" "public"."phone_type", "number" "text", "extension" "text", "country_code" "text", "sms_capable" boolean, "is_primary" boolean, "is_mirrored" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get user_id if contact is linked to a user
  SELECT c.user_id INTO v_user_id
  FROM contacts_projection c
  WHERE c.id = p_contact_id
    AND c.deleted_at IS NULL;

  -- Return contact phones
  RETURN QUERY
  SELECT
    p.id,
    'contact'::TEXT AS source,
    p.label,
    p.type AS phone_type,
    p.number,
    p.extension,
    p.country_code,
    (p.type = 'mobile')::BOOLEAN AS sms_capable,  -- Mobile phones assumed SMS capable
    COALESCE(p.is_primary, false) AS is_primary,
    false AS is_mirrored  -- Contact phones are never "mirrored"
  FROM phones_projection p
  JOIN contact_phones cp ON cp.phone_id = p.id
  WHERE cp.contact_id = p_contact_id
    AND p.deleted_at IS NULL
    AND COALESCE(p.is_active, true) = true;

  -- If contact has linked user, also return user phones
  IF v_user_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      up.id,
      'user'::TEXT AS source,
      up.label,
      up.type AS phone_type,
      up.number,
      up.extension,
      up.country_code,
      up.sms_capable,
      up.is_primary,
      (up.source_contact_phone_id IS NOT NULL) AS is_mirrored
    FROM user_phones up
    WHERE up.user_id = v_user_id
      AND up.is_active = true;
  END IF;
END;
$$;


ALTER FUNCTION "api"."get_person_phones"("p_contact_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_person_phones"("p_contact_id" "uuid") IS 'Get all phones for a person (contact + user if linked). Returns source to distinguish contact phones from user phones, and is_mirrored to identify auto-copied phones.';



CREATE OR REPLACE FUNCTION "api"."get_phones_by_org"("p_org_id" "uuid") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT p.id
  FROM phones_projection p
  WHERE p.organization_id = p_org_id;
END;
$$;


ALTER FUNCTION "api"."get_phones_by_org"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_phones_by_org"("p_org_id" "uuid") IS 'Get phones for an organization. SECURITY INVOKER - respects RLS.';



CREATE OR REPLACE FUNCTION "api"."get_role_by_id"("p_role_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "description" "text", "organization_id" "uuid", "org_hierarchy_scope" "text", "is_active" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "permissions" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    r.organization_id,
    r.org_hierarchy_scope::TEXT,
    r.is_active,
    r.created_at,
    r.updated_at,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'applet', p.applet,
        'action', p.action,
        'display_name', p.display_name,
        'description', p.description,
        'scope_type', p.scope_type
      ) ORDER BY p.applet, p.action), '[]'::jsonb)
      FROM role_permissions_projection rp
      JOIN permissions_projection p ON p.id = rp.permission_id
      WHERE rp.role_id = r.id
    ) AS permissions
  FROM roles_projection r
  WHERE
    r.id = p_role_id
    AND r.deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "api"."get_role_by_id"("p_role_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_role_by_id"("p_role_id" "uuid") IS 'Get a single role with its associated permissions including display names. Access controlled by RLS.';



CREATE OR REPLACE FUNCTION "api"."get_role_by_name"("p_org_id" "uuid", "p_role_name" "text") RETURNS TABLE("id" "uuid", "name" "text", "organization_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT r.id, r.name, r.organization_id
  FROM public.roles_projection r
  WHERE r.name = p_role_name
    AND (r.organization_id = p_org_id OR r.organization_id IS NULL)
  ORDER BY r.organization_id DESC NULLS LAST  -- Prefer org-specific over system role
  LIMIT 1;
$$;


ALTER FUNCTION "api"."get_role_by_name"("p_org_id" "uuid", "p_role_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_role_by_name"("p_org_id" "uuid", "p_role_name" "text") IS 'Look up role by name, preferring org-specific role over system role. Used by accept-invitation Edge Function.';



CREATE OR REPLACE FUNCTION "api"."get_role_by_name_and_org"("p_role_name" "text", "p_organization_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_role_id UUID;
BEGIN
  SELECT id INTO v_role_id
  FROM public.roles_projection
  WHERE name = p_role_name
    AND organization_id = p_organization_id;

  RETURN v_role_id;
END;
$$;


ALTER FUNCTION "api"."get_role_by_name_and_org"("p_role_name" "text", "p_organization_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_role_by_name_and_org"("p_role_name" "text", "p_organization_id" "uuid") IS 'Get role ID by name and organization. Returns NULL if not found. Called by Temporal activities.';



CREATE OR REPLACE FUNCTION "api"."get_role_permission_names"("p_role_id" "uuid") RETURNS "text"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_names TEXT[];
BEGIN
  SELECT ARRAY_AGG(p.name) INTO v_names
  FROM public.role_permissions_projection rp
  JOIN public.permissions_projection p ON p.id = rp.permission_id
  WHERE rp.role_id = p_role_id;

  RETURN COALESCE(v_names, ARRAY[]::TEXT[]);
END;
$$;


ALTER FUNCTION "api"."get_role_permission_names"("p_role_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_role_permission_names"("p_role_id" "uuid") IS 'Get array of permission names granted to a role. Returns empty array if none. Called by Temporal activities.';



CREATE OR REPLACE FUNCTION "api"."get_role_permission_templates"("p_role_name" "text") RETURNS TABLE("permission_name" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT rpt.permission_name
  FROM public.role_permission_templates rpt
  WHERE rpt.role_name = p_role_name
    AND rpt.is_active = TRUE;
END;
$$;


ALTER FUNCTION "api"."get_role_permission_templates"("p_role_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_role_permission_templates"("p_role_name" "text") IS 'Get canonical permission names for a role type. Used during org bootstrap to grant permissions.';



CREATE OR REPLACE FUNCTION "api"."get_roles"("p_status" "text" DEFAULT 'all'::"text", "p_search_term" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "name" "text", "description" "text", "organization_id" "uuid", "org_hierarchy_scope" "text", "is_active" boolean, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "permission_count" bigint, "user_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_org_type TEXT;
  v_has_platform_privilege BOOLEAN;
BEGIN
  -- Get current user context (called ONCE, not per row)
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();
  v_org_type := (auth.jwt()->>'org_type')::text;
  v_has_platform_privilege := public.has_platform_privilege();

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    r.organization_id,
    r.org_hierarchy_scope::TEXT,
    r.is_active,
    r.deleted_at,
    r.created_at,
    r.updated_at,
    COALESCE(pc.cnt, 0)::BIGINT AS permission_count,
    COALESCE(uc.cnt, 0)::BIGINT AS user_count
  FROM roles_projection r
  LEFT JOIN (
    SELECT rp.role_id, COUNT(*) as cnt
    FROM role_permissions_projection rp
    GROUP BY rp.role_id
  ) pc ON pc.role_id = r.id
  LEFT JOIN (
    SELECT ur.role_id, COUNT(*) as cnt
    FROM user_roles_projection ur
    GROUP BY ur.role_id
  ) uc ON uc.role_id = r.id
  WHERE
    r.deleted_at IS NULL
    -- Authorization: Three-tier check
    AND (
      -- Tier 3: User's organization roles (baseline tenant access)
      r.organization_id = v_org_id
      -- Tier 1: Global roles ONLY visible to platform_owner org type
      OR (r.organization_id IS NULL AND v_org_type = 'platform_owner')
      -- Tier 1: Platform admin override - sees all roles across all orgs
      OR v_has_platform_privilege
    )
    -- Status filter
    AND (p_status = 'all'
         OR (p_status = 'active' AND r.is_active = true)
         OR (p_status = 'inactive' AND r.is_active = false))
    -- Search filter
    AND (p_search_term IS NULL
         OR r.name ILIKE '%' || p_search_term || '%'
         OR r.description ILIKE '%' || p_search_term || '%')
  ORDER BY
    r.is_active DESC,
    r.name ASC;
END;
$$;


ALTER FUNCTION "api"."get_roles"("p_status" "text", "p_search_term" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_roles"("p_status" "text", "p_search_term" "text") IS 'List roles visible to current user.
- Tier 3: Users see their organization''s roles
- Tier 1: Global roles only visible to platform_owner org type
- Tier 1: Platform admins (has_platform_privilege) see all roles
Uses JWT-based authorization (no database queries for auth check).';



CREATE OR REPLACE FUNCTION "api"."get_trace_timeline"("p_trace_id" "text") RETURNS TABLE("id" "uuid", "event_type" "text", "stream_id" "uuid", "stream_type" "text", "span_id" "text", "parent_span_id" "text", "service_name" "text", "operation_name" "text", "duration_ms" integer, "status" "text", "created_at" timestamp with time zone, "depth" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
WITH RECURSIVE trace_tree AS (
  -- Root spans (no parent within this trace)
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.span_id,
    de.parent_span_id,
    de.event_metadata->>'service_name' as service_name,
    de.event_metadata->>'operation_name' as operation_name,
    (de.event_metadata->>'duration_ms')::int as duration_ms,
    COALESCE(de.event_metadata->>'status', 'ok') as status,
    de.created_at,
    0 as depth
  FROM domain_events de
  WHERE de.trace_id = p_trace_id
    AND (de.parent_span_id IS NULL
         OR de.parent_span_id NOT IN (
           SELECT d2.span_id FROM domain_events d2
           WHERE d2.trace_id = p_trace_id AND d2.span_id IS NOT NULL
         ))

  UNION ALL

  -- Child spans (recursive)
  SELECT
    de.id,
    de.event_type,
    de.stream_id,
    de.stream_type,
    de.span_id,
    de.parent_span_id,
    de.event_metadata->>'service_name',
    de.event_metadata->>'operation_name',
    (de.event_metadata->>'duration_ms')::int,
    COALESCE(de.event_metadata->>'status', 'ok'),
    de.created_at,
    t.depth + 1
  FROM domain_events de
  INNER JOIN trace_tree t ON de.parent_span_id = t.span_id
  WHERE de.trace_id = p_trace_id
)
SELECT * FROM trace_tree
ORDER BY depth, created_at;
$$;


ALTER FUNCTION "api"."get_trace_timeline"("p_trace_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."get_user_addresses"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "user_id" "uuid", "label" "text", "type" "text", "street1" "text", "street2" "text", "city" "text", "state" "text", "zip_code" "text", "country" "text", "is_primary" boolean, "is_active" boolean, "metadata" "jsonb", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_current_user_id uuid;
  v_current_org_id uuid;
BEGIN
  -- Get current user context
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();

  -- Authorization check
  IF NOT (
    -- Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Org admin viewing users in their org
    OR (public.has_org_admin_permission() AND EXISTS (
      SELECT 1 FROM user_organizations_projection uop
      WHERE uop.user_id = p_user_id AND uop.org_id = v_current_org_id
    ))
    -- User viewing their own addresses
    OR p_user_id = v_current_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ua.id,
    ua.user_id,
    ua.label,
    ua.type::text,
    ua.street1,
    ua.street2,
    ua.city,
    ua.state,
    ua.zip_code,
    ua.country,
    ua.is_primary,
    ua.is_active,
    ua.metadata,
    ua.created_at,
    ua.updated_at
  FROM user_addresses ua
  WHERE ua.user_id = p_user_id
    AND ua.is_active = true
  ORDER BY ua.is_primary DESC, ua.created_at DESC;
END;
$$;


ALTER FUNCTION "api"."get_user_addresses"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_addresses"("p_user_id" "uuid") IS 'Get addresses for a user (CQRS-compliant).
Authorization:
- Platform admins can view any user''s addresses
- Org admins can view addresses for users in their org
- Users can view their own addresses';



CREATE OR REPLACE FUNCTION "api"."get_user_addresses_for_org"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("address_id" "uuid", "address_type" character varying, "street_line1" character varying, "street_line2" character varying, "city" character varying, "state_province" character varying, "postal_code" character varying, "country" character varying, "is_primary" boolean, "is_verified" boolean, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_current_user_id UUID;
  v_current_org_id UUID;
  v_has_platform_privilege BOOLEAN;
  v_has_org_admin_permission BOOLEAN;
BEGIN
  -- Get current user context
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();
  v_has_platform_privilege := public.has_platform_privilege();
  v_has_org_admin_permission := public.has_org_admin_permission();

  -- Authorization check
  IF NOT (
    v_has_platform_privilege
    OR (v_has_org_admin_permission AND p_org_id = v_current_org_id)
    OR p_user_id = v_current_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions';
  END IF;

  RETURN QUERY
  SELECT
    ua.address_id,
    ua.address_type,
    ua.street_line1,
    ua.street_line2,
    ua.city,
    ua.state_province,
    ua.postal_code,
    ua.country,
    ua.is_primary,
    ua.is_verified,
    ua.created_at
  FROM user_addresses ua
  WHERE ua.user_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM user_organizations_projection uop
      WHERE uop.user_id = p_user_id AND uop.org_id = p_org_id
    )
  ORDER BY ua.is_primary DESC, ua.created_at DESC;
END;
$$;


ALTER FUNCTION "api"."get_user_addresses_for_org"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_addresses_for_org"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Gets addresses for a user within an organization context. Platform admins see all, org admins see their org users, users see their own.';



CREATE OR REPLACE FUNCTION "api"."get_user_by_id"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("id" "uuid", "email" "text", "first_name" "text", "last_name" "text", "name" "text", "is_active" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "last_login" timestamp with time zone, "current_organization_id" "uuid", "roles" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'api'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.name,
    u.is_active,
    u.created_at,
    u.updated_at,
    u.last_login,
    u.current_organization_id,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'role_id', ur.role_id,
        'role_name', r.name,
        'role_description', r.description,
        'organization_id', ur.organization_id,
        'scope_path', ur.scope_path,
        'role_valid_from', ur.role_valid_from,
        'role_valid_until', ur.role_valid_until,
        'org_hierarchy_scope', r.org_hierarchy_scope,
        'is_active', r.is_active
      ))
      FROM public.user_roles_projection ur
      JOIN public.roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
        AND ur.organization_id = p_org_id),
      '[]'::jsonb
    ) AS roles
  FROM public.users u
  WHERE u.id = p_user_id
    AND EXISTS (
      SELECT 1 FROM public.user_roles_projection ur
      WHERE ur.user_id = u.id AND ur.organization_id = p_org_id
    );
END;
$$;


ALTER FUNCTION "api"."get_user_by_id"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_by_id"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Get a single user with their roles for a given organization.
This RPC function follows the CQRS pattern - frontend should ALWAYS use this
instead of direct table queries with PostgREST embedding.

Parameters:
- p_user_id: User UUID (required)
- p_org_id: Organization UUID (required) - used to filter roles and verify membership

Returns:
- Single user record with roles as JSONB array
- Empty result set if user not found or not a member of the organization';



CREATE OR REPLACE FUNCTION "api"."get_user_notification_preferences"("p_user_id" "uuid", "p_organization_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User reading their own preferences
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Read from the new normalized projection table
  SELECT jsonb_build_object(
    'email', unp.email_enabled,
    'sms', jsonb_build_object(
      'enabled', unp.sms_enabled,
      'phoneId', unp.sms_phone_id
    ),
    'inApp', unp.in_app_enabled
  ) INTO v_result
  FROM user_notification_preferences_projection unp
  WHERE unp.user_id = p_user_id
    AND unp.organization_id = p_organization_id;

  -- Return defaults if no record found
  RETURN COALESCE(
    v_result,
    '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb
  );
END;
$$;


ALTER FUNCTION "api"."get_user_notification_preferences"("p_user_id" "uuid", "p_organization_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_notification_preferences"("p_user_id" "uuid", "p_organization_id" "uuid") IS 'Read user notification preferences for an organization from the normalized projection table.
Returns defaults if no record exists.
Authorization:
- Platform admins can read any user/org
- Org admins can read users in their org
- Users can read their own preferences';



CREATE OR REPLACE FUNCTION "api"."get_user_org_access"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("user_id" "uuid", "org_id" "uuid", "access_start_date" "date", "access_expiration_date" "date", "notification_preferences" "jsonb", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User viewing their own record
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    uop.user_id,
    uop.org_id,
    uop.access_start_date,
    uop.access_expiration_date,
    uop.notification_preferences,
    uop.created_at,
    uop.updated_at
  FROM public.user_organizations_projection uop
  WHERE uop.user_id = p_user_id
    AND uop.org_id = p_org_id;
END;
$$;


ALTER FUNCTION "api"."get_user_org_access"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_org_access"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Get user organization access details.
Authorization:
- Platform admins can view any user/org
- Org admins can view users in their org
- Users can view their own records';



CREATE OR REPLACE FUNCTION "api"."get_user_org_details"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("user_id" "uuid", "email" "text", "is_active" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT u.id as user_id, u.email, u.is_active
  FROM users u
  INNER JOIN user_roles_projection urp ON u.id = urp.user_id
  WHERE u.id = p_user_id
    AND urp.organization_id = p_org_id
  LIMIT 1;
END;
$$;


ALTER FUNCTION "api"."get_user_org_details"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_org_details"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Get user details including active status for a specific user in an organization';



CREATE OR REPLACE FUNCTION "api"."get_user_permissions"() RETURNS TABLE("permission_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := public.get_current_user_id();

  -- Return permissions for the current user only
  -- No RLS overhead since SECURITY DEFINER bypasses policies
  RETURN QUERY
  SELECT DISTINCT rp.permission_id
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = v_user_id;
END;
$$;


ALTER FUNCTION "api"."get_user_permissions"() OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_permissions"() IS 'Get permission IDs the current user possesses. Uses SECURITY DEFINER for performance (bypasses RLS, filters by user_id internally).';



CREATE OR REPLACE FUNCTION "api"."get_user_phones"("p_user_id" "uuid", "p_organization_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User reading their own phones
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Return user's global phones UNION org-specific phones if org specified
  RETURN (
    WITH all_phones AS (
      -- Global user phones
      SELECT
        up.id,
        up.label,
        up.type::text,
        up.number,
        up.extension,
        up.country_code,
        up.sms_capable,
        up.is_primary,
        up.is_active,
        (up.source_contact_phone_id IS NOT NULL) AS is_mirrored,
        'global'::text AS source,
        up.created_at
      FROM user_phones up
      WHERE up.user_id = p_user_id
        AND up.is_active = true

      UNION ALL

      -- Org-specific phones (only if org specified)
      SELECT
        uopo.id,
        uopo.label,
        uopo.type::text,
        uopo.number,
        uopo.extension,
        uopo.country_code,
        uopo.sms_capable,
        false AS is_primary,  -- Org phones don't have primary flag
        uopo.is_active,
        false AS is_mirrored,  -- Org phones are not mirrored
        'org'::text AS source,
        uopo.created_at
      FROM user_org_phone_overrides uopo
      WHERE uopo.user_id = p_user_id
        AND uopo.org_id = p_organization_id
        AND uopo.is_active = true
        AND p_organization_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', ap.id,
      'label', ap.label,
      'type', ap.type,
      'number', ap.number,
      'extension', ap.extension,
      'countryCode', ap.country_code,
      'smsCapable', ap.sms_capable,
      'isPrimary', ap.is_primary,
      'isActive', ap.is_active,
      'isMirrored', ap.is_mirrored,
      'source', ap.source
    ) ORDER BY ap.is_primary DESC, ap.created_at ASC), '[]'::jsonb)
    FROM all_phones ap
  );
END;
$$;


ALTER FUNCTION "api"."get_user_phones"("p_user_id" "uuid", "p_organization_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_phones"("p_user_id" "uuid", "p_organization_id" "uuid") IS 'Get user phones for notification settings. Returns global phones + org-specific phones if org specified.
Includes isMirrored flag to indicate phones auto-copied from contact profile.
source="global" for user_phones, source="org" for user_org_phone_overrides.
Authorization:
- Platform admins can read any user
- Org admins can read users in their org
- Users can read their own phones';



CREATE OR REPLACE FUNCTION "api"."get_user_phones_for_org"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("phone_id" "uuid", "phone_type" character varying, "phone_number" character varying, "extension" character varying, "is_primary" boolean, "is_verified" boolean, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_current_user_id UUID;
  v_current_org_id UUID;
  v_has_platform_privilege BOOLEAN;
  v_has_org_admin_permission BOOLEAN;
BEGIN
  -- Get current user context
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();
  v_has_platform_privilege := public.has_platform_privilege();
  v_has_org_admin_permission := public.has_org_admin_permission();

  -- Authorization check
  IF NOT (
    v_has_platform_privilege
    OR (v_has_org_admin_permission AND p_org_id = v_current_org_id)
    OR p_user_id = v_current_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions';
  END IF;

  RETURN QUERY
  SELECT
    up.phone_id,
    up.phone_type,
    up.phone_number,
    up.extension,
    up.is_primary,
    up.is_verified,
    up.created_at
  FROM user_phones up
  WHERE up.user_id = p_user_id
    AND EXISTS (
      SELECT 1 FROM user_organizations_projection uop
      WHERE uop.user_id = p_user_id AND uop.org_id = p_org_id
    )
  ORDER BY up.is_primary DESC, up.created_at DESC;
END;
$$;


ALTER FUNCTION "api"."get_user_phones_for_org"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_phones_for_org"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Gets phones for a user within an organization context. Platform admins see all, org admins see their org users, users see their own.';



CREATE OR REPLACE FUNCTION "api"."get_user_sms_phones"("p_user_id" "uuid", "p_organization_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
    -- User reading their own phones
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Return only SMS-capable phones for dropdown
  RETURN (
    WITH sms_phones AS (
      -- Global user phones (SMS-capable only)
      SELECT
        up.id,
        up.label,
        up.number,
        up.is_primary,
        (up.source_contact_phone_id IS NOT NULL) AS is_mirrored,
        up.created_at
      FROM user_phones up
      WHERE up.user_id = p_user_id
        AND up.is_active = true
        AND up.sms_capable = true

      UNION ALL

      -- Org-specific phones (SMS-capable only)
      SELECT
        uopo.id,
        uopo.label,
        uopo.number,
        false AS is_primary,
        false AS is_mirrored,
        uopo.created_at
      FROM user_org_phone_overrides uopo
      WHERE uopo.user_id = p_user_id
        AND uopo.org_id = p_organization_id
        AND uopo.is_active = true
        AND uopo.sms_capable = true
        AND p_organization_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sp.id,
      'label', sp.label,
      'number', sp.number,
      'isPrimary', sp.is_primary,
      'isMirrored', sp.is_mirrored
    ) ORDER BY sp.is_primary DESC, sp.created_at ASC), '[]'::jsonb)
    FROM sms_phones sp
  );
END;
$$;


ALTER FUNCTION "api"."get_user_sms_phones"("p_user_id" "uuid", "p_organization_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_user_sms_phones"("p_user_id" "uuid", "p_organization_id" "uuid") IS 'Get SMS-capable phones for notification preferences dropdown.
Returns only phones marked as SMS-capable.
Authorization:
- Platform admins can read any user
- Org admins can read users in their org
- Users can read their own phones';



CREATE OR REPLACE FUNCTION "api"."list_invitations"("p_org_id" "uuid", "p_status" "text"[] DEFAULT ARRAY['pending'::"text", 'expired'::"text"], "p_search_term" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "email" "text", "first_name" "text", "last_name" "text", "organization_id" "uuid", "roles" "jsonb", "token" "text", "status" "text", "expires_at" timestamp with time zone, "access_start_date" "date", "access_expiration_date" "date", "notification_preferences" "jsonb", "accepted_at" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'api'
    AS $$
DECLARE
  v_current_user_email TEXT;
  v_has_org_admin BOOLEAN;
  v_has_platform_privilege BOOLEAN;
BEGIN
  -- Get current user context
  v_current_user_email := (current_setting('request.jwt.claims', true)::json->>'email');
  v_has_org_admin := has_org_admin_permission();
  v_has_platform_privilege := has_platform_privilege();
  
  -- Permission check: must be org admin for this org OR platform admin
  IF NOT (v_has_platform_privilege OR (v_has_org_admin AND p_org_id = get_current_org_id())) THEN
    RAISE EXCEPTION 'Insufficient permissions to view invitations for this organization';
  END IF;
  
  -- Return invitations for the organization
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.first_name,
    i.last_name,
    i.organization_id,
    i.roles,
    NULL::TEXT AS token,  -- Never expose tokens via API
    i.status,
    i.expires_at,
    i.access_start_date,
    i.access_expiration_date,
    i.notification_preferences,
    i.accepted_at,
    i.created_at,
    i.updated_at
  FROM public.invitations_projection i
  WHERE i.organization_id = p_org_id
    AND (p_status IS NULL OR i.status = ANY(p_status))
    AND (p_search_term IS NULL 
         OR i.email ILIKE '%' || p_search_term || '%'
         OR i.first_name ILIKE '%' || p_search_term || '%'
         OR i.last_name ILIKE '%' || p_search_term || '%')
  ORDER BY i.created_at DESC;
END;
$$;


ALTER FUNCTION "api"."list_invitations"("p_org_id" "uuid", "p_status" "text"[], "p_search_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."list_roles_for_user"("p_user_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'active'::"text") RETURNS TABLE("id" "uuid", "name" "text", "description" "text", "is_global" boolean, "organization_id" "uuid", "is_active" boolean, "can_be_deleted" boolean, "user_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_org_type TEXT;
  v_has_platform_privilege BOOLEAN;
BEGIN
  -- Get current user context (called ONCE, not per row)
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();
  v_org_type := (auth.jwt()->>'org_type')::text;
  v_has_platform_privilege := public.has_platform_privilege();

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.description,
    (r.organization_id IS NULL) AS is_global,
    r.organization_id,
    r.is_active,
    r.can_be_deleted,
    (SELECT COUNT(*) FROM user_roles_projection ur WHERE ur.role_id = r.id) AS user_count
  FROM roles_projection r
  WHERE
    -- If user_id specified, filter to their roles
    (p_user_id IS NULL OR EXISTS (
      SELECT 1 FROM user_roles_projection ur
      WHERE ur.user_id = p_user_id AND ur.role_id = r.id
    ))
    -- Visibility rules
    AND (
      -- Global roles ONLY visible to platform_owner org type
      (r.organization_id IS NULL AND v_org_type = 'platform_owner')
      -- User's organization roles
      OR r.organization_id = v_org_id
      -- Platform admin override: sees all roles
      OR v_has_platform_privilege
    )
    -- Status filter
    AND (p_status = 'all'
         OR (p_status = 'active' AND r.is_active = true)
         OR (p_status = 'inactive' AND r.is_active = false))
  ORDER BY
    r.organization_id NULLS FIRST,
    r.name;
END;
$$;


ALTER FUNCTION "api"."list_roles_for_user"("p_user_id" "uuid", "p_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."list_roles_for_user"("p_user_id" "uuid", "p_status" "text") IS 'Lists roles, optionally filtered by user assignment.
Platform admins can see all roles across all organizations.
Regular users see global roles (if in platform_owner org) and their org roles.';



CREATE OR REPLACE FUNCTION "api"."list_user_org_access"("p_user_id" "uuid") RETURNS TABLE("user_id" "uuid", "org_id" "uuid", "org_name" "text", "org_type" "text", "access_start_date" "date", "access_expiration_date" "date", "is_currently_active" boolean, "notification_preferences" "jsonb", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- Authorization check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- User viewing their own org list
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    uop.user_id,
    uop.org_id,
    op.name AS org_name,
    op.type AS org_type,  -- NEW: Include org type from organizations_projection
    uop.access_start_date,
    uop.access_expiration_date,
    (
      (uop.access_start_date IS NULL OR uop.access_start_date <= CURRENT_DATE)
      AND (uop.access_expiration_date IS NULL OR uop.access_expiration_date >= CURRENT_DATE)
    ) AS is_currently_active,
    uop.notification_preferences,
    uop.created_at,
    uop.updated_at
  FROM public.user_organizations_projection uop
  JOIN public.organizations_projection op ON op.id = uop.org_id
  WHERE uop.user_id = p_user_id
  ORDER BY uop.created_at DESC;
END;
$$;


ALTER FUNCTION "api"."list_user_org_access"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."list_user_org_access"("p_user_id" "uuid") IS 'List all organization memberships for a user, including org type.
Authorization:
- Platform admins can view any user''s orgs
- Users can view their own org list';



CREATE OR REPLACE FUNCTION "api"."list_user_organizations"("p_user_id" "uuid" DEFAULT NULL::"uuid", "p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("user_id" "uuid", "org_id" "uuid", "organization_name" "text", "is_primary" boolean, "joined_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_current_user_id UUID;
  v_current_org_id UUID;
  v_has_platform_privilege BOOLEAN;
  v_has_org_admin_permission BOOLEAN;
BEGIN
  -- Get current user context (called ONCE, not per row)
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();
  v_has_platform_privilege := public.has_platform_privilege();
  v_has_org_admin_permission := public.has_org_admin_permission();

  RETURN QUERY
  SELECT
    uop.user_id,
    uop.org_id,
    op.name AS organization_name,
    uop.is_primary,
    uop.joined_at
  FROM user_organizations_projection uop
  JOIN organizations_projection op ON op.id = uop.org_id
  WHERE
    -- Filter by user_id if specified
    (p_user_id IS NULL OR uop.user_id = p_user_id)
    -- Filter by org_id if specified
    AND (p_org_id IS NULL OR uop.org_id = p_org_id)
    -- Authorization: platform admin sees all, org admin sees their org, users see their own
    AND (
      v_has_platform_privilege
      OR (v_has_org_admin_permission AND uop.org_id = v_current_org_id)
      OR uop.user_id = v_current_user_id
    )
  ORDER BY uop.is_primary DESC, op.name;
END;
$$;


ALTER FUNCTION "api"."list_user_organizations"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."list_user_organizations"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Lists user-organization memberships. Platform admins see all, org admins see their org, users see their own.';



CREATE OR REPLACE FUNCTION "api"."list_users"("p_org_id" "uuid", "p_status" "text" DEFAULT NULL::"text", "p_search_term" "text" DEFAULT NULL::"text", "p_sort_by" "text" DEFAULT 'name'::"text", "p_sort_desc" boolean DEFAULT false, "p_page" integer DEFAULT 1, "p_page_size" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "email" "text", "first_name" "text", "last_name" "text", "name" "text", "is_active" boolean, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "last_login" timestamp with time zone, "roles" "jsonb", "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'api'
    AS $$
DECLARE
  v_total_count BIGINT;
BEGIN
  -- Calculate total count for pagination
  SELECT COUNT(DISTINCT u.id)
  INTO v_total_count
  FROM public.users u
  WHERE EXISTS (
    SELECT 1 FROM public.user_roles_projection ur
    WHERE ur.user_id = u.id AND ur.organization_id = p_org_id
  )
  -- Status filter logic:
  -- 'active' = is_active = true AND deleted_at IS NULL
  -- 'deactivated' = is_active = false AND deleted_at IS NULL
  -- 'deleted' = deleted_at IS NOT NULL
  -- NULL (all) = no filter BUT exclude deleted by default
  AND (
    CASE
      WHEN p_status = 'active' THEN u.is_active = TRUE AND u.deleted_at IS NULL
      WHEN p_status = 'deactivated' THEN u.is_active = FALSE AND u.deleted_at IS NULL
      WHEN p_status = 'deleted' THEN u.deleted_at IS NOT NULL
      ELSE u.deleted_at IS NULL  -- Default: exclude deleted users
    END
  )
  AND (p_search_term IS NULL
       OR u.email ILIKE '%' || p_search_term || '%'
       OR u.name ILIKE '%' || p_search_term || '%');

  -- Return users with their roles
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.name,
    u.is_active,
    u.deleted_at,
    u.created_at,
    u.updated_at,
    u.last_login,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'role_id', ur.role_id,
        'role_name', r.name
      ))
      FROM public.user_roles_projection ur
      JOIN public.roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
        AND ur.organization_id = p_org_id),
      '[]'::jsonb
    ) AS roles,
    v_total_count AS total_count
  FROM public.users u
  WHERE EXISTS (
    SELECT 1 FROM public.user_roles_projection ur
    WHERE ur.user_id = u.id AND ur.organization_id = p_org_id
  )
  AND (
    CASE
      WHEN p_status = 'active' THEN u.is_active = TRUE AND u.deleted_at IS NULL
      WHEN p_status = 'deactivated' THEN u.is_active = FALSE AND u.deleted_at IS NULL
      WHEN p_status = 'deleted' THEN u.deleted_at IS NOT NULL
      ELSE u.deleted_at IS NULL
    END
  )
  AND (p_search_term IS NULL
       OR u.email ILIKE '%' || p_search_term || '%'
       OR u.name ILIKE '%' || p_search_term || '%')
  ORDER BY
    CASE WHEN NOT p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name' THEN u.name
        WHEN 'email' THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END ASC NULLS LAST,
    CASE WHEN p_sort_desc THEN
      CASE p_sort_by
        WHEN 'name' THEN u.name
        WHEN 'email' THEN u.email
        WHEN 'created_at' THEN u.created_at::TEXT
        ELSE u.name
      END
    END DESC NULLS LAST
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
END;
$$;


ALTER FUNCTION "api"."list_users"("p_org_id" "uuid", "p_status" "text", "p_search_term" "text", "p_sort_by" "text", "p_sort_desc" boolean, "p_page" integer, "p_page_size" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."list_users"("p_org_id" "uuid", "p_status" "text", "p_search_term" "text", "p_sort_by" "text", "p_sort_desc" boolean, "p_page" integer, "p_page_size" integer) IS 'List users in an organization with pagination and filtering. Status values: active, deactivated, deleted (or NULL for all non-deleted).';



CREATE OR REPLACE FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_result RECORD;
  v_inactive_ancestor_path LTREE;
  v_affected_descendants JSONB;
  v_descendant_count INTEGER;
BEGIN
  -- Get user's scope_path
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit
  SELECT * INTO v_existing
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope'
      )
    );
  END IF;

  -- Check if already active
  IF v_existing.is_active = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::TEXT,
        'parentPath', v_existing.parent_path::TEXT,
        'timeZone', v_existing.timezone,
        'isActive', true,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      ),
      'message', 'Organization unit is already active'
    );
  END IF;

  -- Check for inactive ancestors (cannot reactivate if parent is inactive)
  SELECT ou.path INTO v_inactive_ancestor_path
  FROM organization_units_projection ou
  WHERE v_existing.path <@ ou.path
    AND ou.path != v_existing.path
    AND ou.is_active = false
    AND ou.deleted_at IS NULL
  ORDER BY ou.depth DESC
  LIMIT 1;

  IF v_inactive_ancestor_path IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot reactivate while parent is inactive',
      'errorDetails', jsonb_build_object(
        'code', 'PARENT_INACTIVE',
        'message', format('Reactivate ancestor %s first', v_inactive_ancestor_path::TEXT)
      )
    );
  END IF;

  -- Collect all inactive descendants that will be affected by cascade reactivation
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', ou.id,
      'path', ou.path::TEXT,
      'name', ou.name
    )), '[]'::jsonb),
    COUNT(*)::INTEGER
  INTO v_affected_descendants, v_descendant_count
  FROM organization_units_projection ou
  WHERE ou.path <@ v_existing.path    -- Descendants of this OU (ltree containment)
    AND ou.id != p_unit_id            -- Exclude self
    AND ou.is_active = false          -- Only currently inactive ones
    AND ou.deleted_at IS NULL;

  -- CQRS: Emit organization_unit.reactivated event (no direct projection write)
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.reactivated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'path', v_existing.path::TEXT,
      'cascade_effect', 'role_assignment_allowed',
      'affected_descendants', v_affected_descendants,
      'total_descendants_affected', COALESCE(v_descendant_count, 0)
    ),
    jsonb_build_object(
      'source', 'api.reactivate_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Reactivated organization unit "%s" and %s descendant(s) - role assignments now allowed', v_existing.name, COALESCE(v_descendant_count, 0)),
      'timestamp', now()
    )
  );

  -- Query projection for result
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', COALESCE(v_result.id, p_unit_id),
      'name', COALESCE(v_result.name, v_existing.name),
      'displayName', COALESCE(v_result.display_name, v_existing.display_name),
      'path', COALESCE(v_result.path::TEXT, v_existing.path::TEXT),
      'parentPath', COALESCE(v_result.parent_path::TEXT, v_existing.parent_path::TEXT),
      'timeZone', COALESCE(v_result.timezone, v_existing.timezone),
      'isActive', COALESCE(v_result.is_active, true),
      'isRootOrganization', false,
      'createdAt', COALESCE(v_result.created_at, v_existing.created_at),
      'updatedAt', COALESCE(v_result.updated_at, now())
    ),
    'cascadeResult', jsonb_build_object(
      'descendantsReactivated', COALESCE(v_descendant_count, 0)
    )
  );
END;
$$;


ALTER FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") IS 'Frontend RPC: Unfreeze organizational unit and all descendants. Emits organization_unit.reactivated event with cascade (CQRS).';



CREATE OR REPLACE FUNCTION "api"."reactivate_role"("p_role_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role already active',
      'errorDetails', jsonb_build_object('code', 'ALREADY_ACTIVE', 'message', 'Role is already active')
    );
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_role_id,
    p_stream_type := 'role',
    p_event_type := 'role.reactivated',
    p_event_data := jsonb_build_object('reason', 'Reactivated via Role Management UI'),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', v_org_id,
      'reason', 'Role reactivation via UI'
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "api"."reactivate_role"("p_role_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."reactivate_role"("p_role_id" "uuid") IS 'Reactivate a previously deactivated role.';



CREATE OR REPLACE FUNCTION "api"."remove_user_phone"("p_phone_id" "uuid", "p_org_id" "uuid" DEFAULT NULL::"uuid", "p_hard_delete" boolean DEFAULT false, "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Get user_id from the phone
  IF p_org_id IS NULL THEN
    SELECT user_id INTO v_user_id FROM user_phones WHERE id = p_phone_id;
  ELSE
    SELECT user_id INTO v_user_id FROM user_org_phone_overrides WHERE id = p_phone_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Phone not found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR v_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.remove_user_phone'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := v_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.phone.removed',
    p_event_data := jsonb_build_object(
      'phone_id', p_phone_id,
      'org_id', p_org_id,
      'removal_type', CASE WHEN p_hard_delete THEN 'hard_delete' ELSE 'soft_delete' END
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', p_phone_id,
    'eventId', v_event_id
  );
END;
$$;


ALTER FUNCTION "api"."remove_user_phone"("p_phone_id" "uuid", "p_org_id" "uuid", "p_hard_delete" boolean, "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."remove_user_phone"("p_phone_id" "uuid", "p_org_id" "uuid", "p_hard_delete" boolean, "p_reason" "text") IS 'Remove (soft delete) or permanently delete a user phone. p_hard_delete=true for permanent deletion.
p_reason provides optional audit context.
Authorization: Platform admin, org admin, or user removing their own phone.';



CREATE OR REPLACE FUNCTION "api"."resend_invitation"("p_invitation_id" "uuid", "p_new_token" "text", "p_new_expires_at" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE invitations_projection
  SET
    token = p_new_token,
    expires_at = p_new_expires_at,
    status = 'pending',
    updated_at = NOW()
  WHERE id = p_invitation_id
    AND status IN ('pending', 'expired');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;


ALTER FUNCTION "api"."resend_invitation"("p_invitation_id" "uuid", "p_new_token" "text", "p_new_expires_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."resend_invitation"("p_invitation_id" "uuid", "p_new_token" "text", "p_new_expires_at" timestamp with time zone) IS 'Update an invitation with a new token and expiry date for resending';



CREATE OR REPLACE FUNCTION "api"."retry_failed_event"("p_event_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_event RECORD;
  v_result JSONB;
  v_retry_success BOOLEAN;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Get the event
  SELECT * INTO v_event FROM domain_events WHERE domain_events.id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event not found'
    );
  END IF;

  IF v_event.processing_error IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event has no processing error to retry'
    );
  END IF;

  -- Clear error and processed_at to trigger reprocessing
  -- The BEFORE UPDATE trigger (process_domain_event) will reprocess
  UPDATE domain_events
  SET
    processing_error = NULL,
    processed_at = NULL
  WHERE domain_events.id = p_event_id;

  -- Check if reprocessing succeeded
  SELECT processing_error INTO v_event.processing_error
  FROM domain_events WHERE domain_events.id = p_event_id;

  v_retry_success := (v_event.processing_error IS NULL);

  -- Emit audit event (use gen_random_uuid() for stream_id - each audit is standalone)
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.event_retry_attempted',
    jsonb_build_object(
      'target_event_id', p_event_id,
      'target_event_type', v_event.event_type,
      'target_stream_type', v_event.stream_type,
      'target_stream_id', v_event.stream_id,
      'original_error', v_event.processing_error,
      'retry_success', v_retry_success,
      'new_error', CASE WHEN v_retry_success THEN NULL ELSE v_event.processing_error END
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin attempted to retry failed event processing',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  IF v_retry_success THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Event reprocessed successfully'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reprocessing failed: ' || v_event.processing_error
    );
  END IF;
END;
$$;


ALTER FUNCTION "api"."retry_failed_event"("p_event_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."retry_failed_event"("p_event_id" "uuid") IS 'Retries processing a failed domain event.
Requires platform.admin permission.
Emits platform.admin.event_retry_attempted audit event.';



CREATE OR REPLACE FUNCTION "api"."revoke_invitation"("p_invitation_id" "uuid", "p_reason" "text" DEFAULT 'manual_revocation'::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE invitations_projection
  SET
    status = 'revoked',
    revoked_at = NOW(),
    revoke_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_invitation_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;


ALTER FUNCTION "api"."revoke_invitation"("p_invitation_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."revoke_invitation"("p_invitation_id" "uuid", "p_reason" "text") IS 'Revoke a pending invitation';



CREATE OR REPLACE FUNCTION "api"."soft_delete_organization_addresses"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_addresses
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "api"."soft_delete_organization_addresses"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."soft_delete_organization_addresses"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) IS 'Soft-delete all organization-address junctions for workflow compensation. Returns count of deleted records. Called by Temporal activities.';



CREATE OR REPLACE FUNCTION "api"."soft_delete_organization_contacts"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_contacts
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "api"."soft_delete_organization_contacts"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."soft_delete_organization_contacts"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) IS 'Soft-delete all organization-contact junctions for workflow compensation. Returns count of deleted records. Called by Temporal activities.';



CREATE OR REPLACE FUNCTION "api"."soft_delete_organization_phones"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_phones
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "api"."soft_delete_organization_phones"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."soft_delete_organization_phones"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) IS 'Soft-delete all organization-phone junctions for workflow compensation. Returns count of deleted records. Called by Temporal activities.';



CREATE OR REPLACE FUNCTION "api"."undismiss_failed_event"("p_event_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_event RECORD;
BEGIN
  -- Authorization: Require platform.admin permission
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION 'Access denied: platform.admin permission required';
  END IF;

  v_user_id := auth.uid();

  -- Get the event
  SELECT id, event_type, stream_type, stream_id, dismissed_at, dismissed_by, dismiss_reason
  INTO v_event
  FROM domain_events
  WHERE id = p_event_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event not found'
    );
  END IF;

  IF v_event.dismissed_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Event is not dismissed'
    );
  END IF;

  -- Undismiss the event
  UPDATE domain_events
  SET
    dismissed_at = NULL,
    dismissed_by = NULL,
    dismiss_reason = NULL
  WHERE id = p_event_id;

  -- Emit audit event
  INSERT INTO domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  )
  VALUES (
    gen_random_uuid(),
    'platform_admin',
    1,
    'platform.admin.event_undismissed',
    jsonb_build_object(
      'target_event_id', p_event_id,
      'target_event_type', v_event.event_type,
      'target_stream_type', v_event.stream_type,
      'target_stream_id', v_event.stream_id,
      'previous_dismissed_by', v_event.dismissed_by,
      'previous_dismiss_reason', v_event.dismiss_reason
    ),
    jsonb_build_object(
      'user_id', v_user_id,
      'reason', 'Platform admin reversed dismissal of failed event',
      'organization_id', (current_setting('request.jwt.claims', true)::jsonb->>'org_id')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Event undismissed successfully'
  );
END;
$$;


ALTER FUNCTION "api"."undismiss_failed_event"("p_event_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."undismiss_failed_event"("p_event_id" "uuid") IS 'Reverses dismissal of a failed domain event.
Requires platform.admin permission.
Emits platform.admin.event_undismissed audit event.';



CREATE OR REPLACE FUNCTION "api"."update_organization_status"("p_org_id" "uuid", "p_is_active" boolean, "p_deactivated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_deleted_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE organizations_projection
  SET
    is_active = p_is_active,
    deactivated_at = COALESCE(p_deactivated_at, deactivated_at),
    deleted_at = COALESCE(p_deleted_at, deleted_at)
  WHERE id = p_org_id;
END;
$$;


ALTER FUNCTION "api"."update_organization_status"("p_org_id" "uuid", "p_is_active" boolean, "p_deactivated_at" timestamp with time zone, "p_deleted_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_display_name" "text" DEFAULT NULL::"text", "p_timezone" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
  v_existing RECORD;
  v_event_id UUID;
  v_stream_version INTEGER;
  v_updated_fields TEXT[];
  v_previous_values JSONB;
  v_result RECORD;
BEGIN
  -- Get user's scope_path from JWT claims
  v_scope_path := get_current_scope_path();

  IF v_scope_path IS NULL THEN
    RAISE EXCEPTION 'No scope_path in JWT claims'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Get existing unit from organization_units_projection
  SELECT * INTO v_existing
  FROM organization_units_projection ou
  WHERE ou.id = p_unit_id
    AND ou.deleted_at IS NULL
    AND v_scope_path @> ou.path;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Organizational unit not found',
      'errorDetails', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Unit not found or outside your scope. Note: Root organizations use different update path.'
      )
    );
  END IF;

  -- Track what's being updated
  v_updated_fields := ARRAY[]::TEXT[];
  v_previous_values := '{}'::JSONB;

  -- FIX: Use array_append() instead of || operator to avoid "malformed array literal" error
  -- The || operator is ambiguous: PostgreSQL tries to parse 'name' as an array literal
  IF p_name IS NOT NULL AND p_name != v_existing.name THEN
    v_updated_fields := array_append(v_updated_fields, 'name');
    v_previous_values := v_previous_values || jsonb_build_object('name', v_existing.name);
  END IF;

  IF p_display_name IS NOT NULL AND p_display_name != v_existing.display_name THEN
    v_updated_fields := array_append(v_updated_fields, 'display_name');
    v_previous_values := v_previous_values || jsonb_build_object('display_name', v_existing.display_name);
  END IF;

  IF p_timezone IS NOT NULL AND p_timezone != v_existing.timezone THEN
    v_updated_fields := array_append(v_updated_fields, 'timezone');
    v_previous_values := v_previous_values || jsonb_build_object('timezone', v_existing.timezone);
  END IF;

  -- If nothing changed, return success with existing data
  IF array_length(v_updated_fields, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'unit', jsonb_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'displayName', v_existing.display_name,
        'path', v_existing.path::TEXT,
        'parentPath', v_existing.parent_path::TEXT,
        'timeZone', v_existing.timezone,
        'isActive', v_existing.is_active,
        'isRootOrganization', false,
        'createdAt', v_existing.created_at,
        'updatedAt', v_existing.updated_at
      )
    );
  END IF;

  -- CQRS Pattern: Emit organization_unit.updated event
  -- The event processor trigger will update the projection table
  v_event_id := gen_random_uuid();

  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM domain_events
  WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    v_event_id,
    p_unit_id,
    'organization_unit',
    v_stream_version,
    'organization_unit.updated',
    jsonb_build_object(
      'organization_unit_id', p_unit_id,
      'name', COALESCE(p_name, v_existing.name),
      'display_name', COALESCE(p_display_name, v_existing.display_name),
      'timezone', COALESCE(p_timezone, v_existing.timezone),
      'updatable_fields', to_jsonb(v_updated_fields),  -- Renamed from updated_fields
      'previous_values', v_previous_values
    ),
    jsonb_build_object(
      'source', 'api.update_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Updated organization unit fields: %s', array_to_string(v_updated_fields, ', ')),
      'timestamp', now()
    )
  );

  -- Query projection for result (event processor updates this via trigger)
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE id = p_unit_id;

  -- Return success with updated data
  RETURN jsonb_build_object(
    'success', true,
    'unit', jsonb_build_object(
      'id', COALESCE(v_result.id, p_unit_id),
      'name', COALESCE(v_result.name, p_name, v_existing.name),
      'displayName', COALESCE(v_result.display_name, p_display_name, v_existing.display_name),
      'path', COALESCE(v_result.path::TEXT, v_existing.path::TEXT),
      'parentPath', COALESCE(v_result.parent_path::TEXT, v_existing.parent_path::TEXT),
      'timeZone', COALESCE(v_result.timezone, p_timezone, v_existing.timezone),
      'isActive', COALESCE(v_result.is_active, v_existing.is_active),
      'isRootOrganization', false,
      'createdAt', COALESCE(v_result.created_at, v_existing.created_at),
      'updatedAt', COALESCE(v_result.updated_at, now())
    )
  );
END;
$$;


ALTER FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") IS 'Frontend RPC: Update organizational unit metadata. Emits organization_unit.updated event (CQRS pattern - trigger updates projection).';



CREATE OR REPLACE FUNCTION "api"."update_role"("p_role_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_permission_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_existing RECORD;
  v_current_perms UUID[];
  v_new_perms UUID[];
  v_to_grant UUID[];
  v_to_revoke UUID[];
  v_perm_id UUID;
  v_user_perms UUID[];
  v_perm_name TEXT;
BEGIN
  v_user_id := public.get_current_user_id();
  v_org_id := public.get_current_org_id();

  -- Get existing role (RLS will filter unauthorized access)
  SELECT * INTO v_existing FROM roles_projection
  WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Role not found',
      'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
    );
  END IF;

  IF NOT v_existing.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot update inactive role',
      'errorDetails', jsonb_build_object('code', 'INACTIVE_ROLE', 'message', 'Reactivate the role before making changes')
    );
  END IF;

  -- Emit role.updated event if name or description changed
  IF p_name IS NOT NULL OR p_description IS NOT NULL THEN
    PERFORM api.emit_domain_event(
      p_stream_id := p_role_id,
      p_stream_type := 'role',
      p_event_type := 'role.updated',
      p_event_data := jsonb_build_object(
        'name', COALESCE(p_name, v_existing.name),
        'description', COALESCE(p_description, v_existing.description)
      ),
      p_event_metadata := jsonb_build_object(
        'user_id', v_user_id,
        'organization_id', v_org_id,
        'reason', 'Role metadata update via Role Management UI'
      )
    );
  END IF;

  -- Handle permission changes
  IF p_permission_ids IS NOT NULL THEN
    -- Get current permissions
    SELECT array_agg(permission_id) INTO v_current_perms
    FROM role_permissions_projection WHERE role_id = p_role_id;
    v_current_perms := COALESCE(v_current_perms, '{}');
    v_new_perms := p_permission_ids;

    -- Use helper function for permission aggregation
    v_user_perms := public.get_user_aggregated_permissions(v_user_id);

    -- Permissions to grant (in new but not in current)
    v_to_grant := ARRAY(SELECT unnest(v_new_perms) EXCEPT SELECT unnest(v_current_perms));

    -- Use helper function for subset check on grants only
    IF NOT public.check_permissions_subset(v_to_grant, v_user_perms) THEN
      -- Find which permission is violating
      FOREACH v_perm_id IN ARRAY v_to_grant
      LOOP
        IF NOT (v_perm_id = ANY(v_user_perms)) THEN
          SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
          RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot grant permission you do not possess',
            'errorDetails', jsonb_build_object(
              'code', 'SUBSET_ONLY_VIOLATION',
              'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::TEXT))
            )
          );
        END IF;
      END LOOP;
    END IF;

    -- Permissions to revoke (in current but not in new)
    v_to_revoke := ARRAY(SELECT unnest(v_current_perms) EXCEPT SELECT unnest(v_new_perms));

    -- Emit grant events
    FOREACH v_perm_id IN ARRAY v_to_grant
    LOOP
      SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
      PERFORM api.emit_domain_event(
        p_stream_id := p_role_id,
        p_stream_type := 'role',
        p_event_type := 'role.permission.granted',
        p_event_data := jsonb_build_object(
          'permission_id', v_perm_id,
          'permission_name', v_perm_name
        ),
        p_event_metadata := jsonb_build_object(
          'user_id', v_user_id,
          'organization_id', v_org_id,
          'reason', 'Permission added via Role Management UI'
        )
      );
    END LOOP;

    -- Emit revoke events
    FOREACH v_perm_id IN ARRAY v_to_revoke
    LOOP
      SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
      PERFORM api.emit_domain_event(
        p_stream_id := p_role_id,
        p_stream_type := 'role',
        p_event_type := 'role.permission.revoked',
        p_event_data := jsonb_build_object(
          'permission_id', v_perm_id,
          'permission_name', v_perm_name,
          'revocation_reason', 'Permission removed via Role Management UI'
        ),
        p_event_metadata := jsonb_build_object(
          'user_id', v_user_id,
          'organization_id', v_org_id,
          'reason', 'Permission removed via Role Management UI'
        )
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "api"."update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_permission_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_permission_ids" "uuid"[]) IS 'Update role name/description and permissions. Uses helper functions for subset-only delegation validation.';



CREATE OR REPLACE FUNCTION "api"."update_user"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text" DEFAULT NULL::"text", "p_last_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'api'
    AS $$
DECLARE
  v_event_id UUID;
  v_current_user_id UUID;
  v_stream_version INT;
BEGIN
  v_current_user_id := auth.uid();

  -- Verify caller is authenticated
  IF v_current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify user exists and belongs to org
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles_projection
    WHERE user_id = p_user_id AND organization_id = p_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found in organization');
  END IF;

  -- Calculate next stream version for this user
  SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_user_id AND stream_type = 'user';

  -- Emit domain event with stream_version and complete metadata
  INSERT INTO public.domain_events (
    stream_type,
    stream_id,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    'user',
    p_user_id,
    v_stream_version,
    'user.profile.updated',
    jsonb_build_object(
      'user_id', p_user_id,
      'organization_id', p_org_id,
      'first_name', p_first_name,
      'last_name', p_last_name
    ),
    jsonb_build_object(
      -- Required (per event-metadata-schema.md)
      'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      -- Recommended
      'source', 'api',
      'user_id', v_current_user_id,
      'reason', 'User profile updated via UI',
      'service_name', 'api-rpc',
      'operation_name', 'update_user'
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('success', true, 'event_id', v_event_id);
END;
$$;


ALTER FUNCTION "api"."update_user"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."update_user"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text") IS 'Update user profile (first_name, last_name) via domain event';



CREATE OR REPLACE FUNCTION "api"."update_user_access_dates"("p_user_id" "uuid", "p_org_id" "uuid", "p_access_start_date" "date", "p_access_expiration_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_old_record record;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    -- Tier 1: Platform admin (cross-tenant access)
    public.has_platform_privilege()
    -- Tier 2: Org admin for this org
    OR public.has_org_admin_permission()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Validate dates
  IF p_access_start_date IS NOT NULL
     AND p_access_expiration_date IS NOT NULL
     AND p_access_start_date > p_access_expiration_date THEN
    RAISE EXCEPTION 'Start date must be before expiration date' USING ERRCODE = '22023';
  END IF;

  -- Get old values for event
  SELECT access_start_date, access_expiration_date
  INTO v_old_record
  FROM public.user_organizations_projection
  WHERE user_id = p_user_id AND org_id = p_org_id;

  -- Emit domain event
  PERFORM api.emit_domain_event(
    p_event_type := 'user.access_dates_updated',
    p_aggregate_type := 'user',
    p_aggregate_id := p_user_id,
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'org_id', p_org_id,
      'access_start_date', p_access_start_date,
      'access_expiration_date', p_access_expiration_date,
      'previous_start_date', v_old_record.access_start_date,
      'previous_expiration_date', v_old_record.access_expiration_date
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', public.get_current_user_id()
    )
  );

  -- Update the projection directly (event processor will also handle this)
  UPDATE public.user_organizations_projection
  SET
    access_start_date = p_access_start_date,
    access_expiration_date = p_access_expiration_date,
    updated_at = now()
  WHERE user_id = p_user_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User organization access record not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;


ALTER FUNCTION "api"."update_user_access_dates"("p_user_id" "uuid", "p_org_id" "uuid", "p_access_start_date" "date", "p_access_expiration_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."update_user_access_dates"("p_user_id" "uuid", "p_org_id" "uuid", "p_access_start_date" "date", "p_access_expiration_date" "date") IS 'Update user access dates in an organization.
Authorization:
- Platform admins can update any user/org
- Org admins can update users in their org';



CREATE OR REPLACE FUNCTION "api"."update_user_notification_preferences"("p_user_id" "uuid", "p_org_id" "uuid", "p_notification_preferences" "jsonb", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.update_user_notification_preferences'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := p_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.notification_preferences.updated',
    p_event_data := jsonb_build_object(
      'user_id', p_user_id,
      'org_id', p_org_id,
      'notification_preferences', p_notification_preferences
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'preferences', p_notification_preferences
  );
END;
$$;


ALTER FUNCTION "api"."update_user_notification_preferences"("p_user_id" "uuid", "p_org_id" "uuid", "p_notification_preferences" "jsonb", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."update_user_notification_preferences"("p_user_id" "uuid", "p_org_id" "uuid", "p_notification_preferences" "jsonb", "p_reason" "text") IS 'Update user notification preferences for an organization via domain event.
The event processor writes to the normalized projection table.
p_reason provides optional audit context (e.g., "User updated via settings page").
Authorization: Platform admin, org admin, or user updating their own preferences.';



CREATE OR REPLACE FUNCTION "api"."update_user_phone"("p_phone_id" "uuid", "p_label" "text" DEFAULT NULL::"text", "p_type" "text" DEFAULT NULL::"text", "p_number" "text" DEFAULT NULL::"text", "p_extension" "text" DEFAULT NULL::"text", "p_country_code" "text" DEFAULT NULL::"text", "p_is_primary" boolean DEFAULT NULL::boolean, "p_sms_capable" boolean DEFAULT NULL::boolean, "p_org_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  -- Get user_id from the phone
  IF p_org_id IS NULL THEN
    SELECT user_id INTO v_user_id FROM user_phones WHERE id = p_phone_id;
  ELSE
    SELECT user_id INTO v_user_id FROM user_org_phone_overrides WHERE id = p_phone_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Phone not found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorization: Three-tier check
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR v_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Build metadata with optional reason
  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.update_user_phone'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  -- Emit domain event
  v_event_id := api.emit_domain_event(
    p_stream_id := v_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.phone.updated',
    p_event_data := jsonb_build_object(
      'phone_id', p_phone_id,
      'org_id', p_org_id,
      'label', p_label,
      'type', p_type,
      'number', p_number,
      'extension', p_extension,
      'country_code', p_country_code,
      'is_primary', p_is_primary,
      'sms_capable', p_sms_capable
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'phoneId', p_phone_id,
    'eventId', v_event_id
  );
END;
$$;


ALTER FUNCTION "api"."update_user_phone"("p_phone_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."update_user_phone"("p_phone_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") IS 'Update an existing user phone. p_reason provides optional audit context.
Authorization: Platform admin, org admin, or user updating their own phone.';



CREATE OR REPLACE FUNCTION "api"."validate_role_assignment"("p_role_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_user_perms UUID[];
  v_user_scopes extensions.ltree[];
  v_role RECORD;
  v_role_perms UUID[];
  v_violations JSONB := '[]'::JSONB;
BEGIN
  -- Empty array is always valid (no-role invitations allowed)
  IF p_role_ids IS NULL OR array_length(p_role_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('valid', true, 'violations', '[]'::JSONB);
  END IF;

  v_user_id := public.get_current_user_id();
  v_user_perms := public.get_user_aggregated_permissions(v_user_id);
  v_user_scopes := public.get_user_scope_paths(v_user_id);

  -- Check each role
  FOR v_role IN
    SELECT r.id, r.name, r.org_hierarchy_scope
    FROM roles_projection r
    WHERE r.id = ANY(p_role_ids)
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
  LOOP
    -- Get role's permissions
    SELECT array_agg(permission_id) INTO v_role_perms
    FROM role_permissions_projection
    WHERE role_id = v_role.id;
    v_role_perms := COALESCE(v_role_perms, '{}');

    -- Check permission subset
    IF NOT public.check_permissions_subset(v_role_perms, v_user_perms) THEN
      v_violations := v_violations || jsonb_build_object(
        'role_id', v_role.id,
        'role_name', v_role.name,
        'error_code', 'SUBSET_ONLY_VIOLATION',
        'message', format('Role "%s" has permissions you do not possess', v_role.name)
      );
      CONTINUE;
    END IF;

    -- Check scope containment
    IF NOT public.check_scope_containment(v_role.org_hierarchy_scope, v_user_scopes) THEN
      v_violations := v_violations || jsonb_build_object(
        'role_id', v_role.id,
        'role_name', v_role.name,
        'error_code', 'SCOPE_HIERARCHY_VIOLATION',
        'message', format('Role "%s" scope is outside your authority', v_role.name)
      );
      CONTINUE;
    END IF;
  END LOOP;

  -- Check for roles that don't exist
  FOR v_role IN
    SELECT unnest(p_role_ids) AS id
    EXCEPT
    SELECT r.id FROM roles_projection r WHERE r.id = ANY(p_role_ids) AND r.is_active = TRUE
  LOOP
    v_violations := v_violations || jsonb_build_object(
      'role_id', v_role.id,
      'role_name', NULL,
      'error_code', 'ROLE_NOT_FOUND',
      'message', format('Role %s not found or inactive', v_role.id)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'valid', jsonb_array_length(v_violations) = 0,
    'violations', v_violations
  );
END;
$$;


ALTER FUNCTION "api"."validate_role_assignment"("p_role_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "api"."validate_role_assignment"("p_role_ids" "uuid"[]) IS 'Validates role assignment against inviter constraints. Returns violations for each role that fails permission subset or scope hierarchy checks.';



CREATE OR REPLACE FUNCTION "public"."check_permissions_subset"("p_required" "uuid"[], "p_available" "uuid"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  -- All required permissions must be in available set
  -- Empty required array always passes
  SELECT p_required <@ p_available;
$$;


ALTER FUNCTION "public"."check_permissions_subset"("p_required" "uuid"[], "p_available" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_permissions_subset"("p_required" "uuid"[], "p_available" "uuid"[]) IS 'Returns TRUE if all required permissions exist in available set. Pure function, no DB queries.';



CREATE OR REPLACE FUNCTION "public"."check_scope_containment"("p_target_scope" "extensions"."ltree", "p_user_scopes" "extensions"."ltree"[]) RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  -- If user has NULL in their scopes, they have global access
  IF NULL = ANY(p_user_scopes) THEN
    RETURN TRUE;
  END IF;

  -- If target scope is NULL, it means no scope restriction (global role)
  -- Only users with global access (NULL scope) can assign such roles
  IF p_target_scope IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if any user scope contains the target scope
  -- Using ltree @> operator: parent @> child means parent contains child
  RETURN EXISTS (
    SELECT 1 FROM unnest(p_user_scopes) AS user_scope
    WHERE user_scope @> p_target_scope
  );
END;
$$;


ALTER FUNCTION "public"."check_scope_containment"("p_target_scope" "extensions"."ltree", "p_user_scopes" "extensions"."ltree"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_scope_containment"("p_target_scope" "extensions"."ltree", "p_user_scopes" "extensions"."ltree"[]) IS 'Returns TRUE if target scope is within any user scope. NULL user scope = global access.';



CREATE OR REPLACE FUNCTION "public"."cleanup_old_bootstrap_failures"("p_days_old" integer DEFAULT 30) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_cleanup_count INTEGER;
BEGIN
  -- This function would clean up very old failed bootstrap attempts
  -- For now, just return count of what would be cleaned
  SELECT COUNT(*) INTO v_cleanup_count
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND created_at < NOW() - (p_days_old || ' days')::INTERVAL;

  RAISE NOTICE 'Would clean up % old failed bootstrap attempts', v_cleanup_count;

  -- In production, you might want to archive rather than delete
  -- DELETE FROM domain_events WHERE ...

  RETURN v_cleanup_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_bootstrap_failures"("p_days_old" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_old_bootstrap_failures"("p_days_old" integer) IS 'Clean up old failed bootstrap attempts for maintenance';



CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_user_record record;
  v_claims jsonb;
  v_org_id uuid;
  v_org_type text;
  v_user_role text;
  v_permissions text[];
  v_scope_path text;
  v_org_access_record record;
  v_access_blocked boolean := false;
  v_access_block_reason text;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization
  SELECT u.current_organization_id
  INTO v_org_id
  FROM public.users u
  WHERE u.id = v_user_id;

  -- =========================================================================
  -- ACCESS DATE VALIDATION
  -- =========================================================================

  -- Check user-level access dates from user_organizations_projection
  IF v_org_id IS NOT NULL THEN
    SELECT
      uop.access_start_date,
      uop.access_expiration_date
    INTO v_org_access_record
    FROM public.user_organizations_projection uop
    WHERE uop.user_id = v_user_id
      AND uop.org_id = v_org_id;

    -- Check if access hasn't started yet
    IF v_org_access_record.access_start_date IS NOT NULL
       AND v_org_access_record.access_start_date > CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_not_started';
    END IF;

    -- Check if access has expired
    IF v_org_access_record.access_expiration_date IS NOT NULL
       AND v_org_access_record.access_expiration_date < CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_expired';
    END IF;
  END IF;

  -- If access is blocked, return minimal claims with blocked flag
  IF v_access_blocked THEN
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', v_org_id,
        'org_type', NULL,
        'user_role', 'blocked',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'access_blocked', true,
        'access_block_reason', v_access_block_reason,
        'claims_version', 2
      )
    );
  END IF;

  -- =========================================================================
  -- EXISTING LOGIC (with role-level date filtering)
  -- =========================================================================

  -- Get user's role and scope, filtering by role-level access dates
  SELECT
    COALESCE(
      (SELECT r.name
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = v_user_id
         -- Filter by role-level access dates
         AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
         AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      'viewer'
    ) as role,
    COALESCE(
      (SELECT ur.scope_path::text
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = v_user_id
         -- Filter by role-level access dates
         AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
         AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      NULL
    ) as scope
  INTO v_user_role, v_scope_path;

  -- If no organization context, check for super_admin role
  IF v_org_id IS NULL THEN
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.user_roles_projection ur
          JOIN public.roles_projection r ON r.id = ur.role_id
          WHERE ur.user_id = v_user_id
            AND r.name = 'super_admin'
            AND ur.organization_id IS NULL
            -- Filter by role-level access dates
            AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
            AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
        ) THEN NULL  -- Super admin has NULL org_id (global scope)
        ELSE (
          SELECT o.id
          FROM public.organizations_projection o
          WHERE o.type = 'platform_owner'
          LIMIT 1
        )
      END
    INTO v_org_id;
  END IF;

  -- Get organization type for UI feature gating
  -- Super admins (NULL org_id) default to 'platform_owner' for consistency
  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text INTO v_org_type
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;
  END IF;

  -- Get user's permissions for the organization
  -- Super admins get all permissions
  IF v_user_role = 'super_admin' THEN
    SELECT array_agg(p.name)
    INTO v_permissions
    FROM public.permissions_projection p;
  ELSE
    -- Get permissions via role grants, filtering by role-level access dates
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM public.user_roles_projection ur
    JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN public.permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.organization_id = v_org_id OR ur.organization_id IS NULL)
      -- Filter by role-level access dates
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE);
  END IF;

  -- Default to empty array if no permissions
  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims by merging with existing claims
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'access_blocked', false,
    'claims_version', 2
  );

  -- Return the updated claims object
  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail authentication
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    -- Return minimal claims on error, preserving standard JWT fields
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', NULL,
        'org_type', NULL,
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'access_blocked', false,
        'claims_error', SQLERRM,
        'claims_version', 2
      )
    );
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") IS 'JWT custom claims hook with user-level and role-level access date validation (v2)';



CREATE OR REPLACE FUNCTION "public"."enqueue_workflow_from_bootstrap_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_pending_event_id UUID;
BEGIN
    -- Only process organization.bootstrap.initiated events
    IF NEW.event_type = 'organization.bootstrap.initiated' THEN
        -- Emit workflow.queue.pending event
        -- This will be caught by update_workflow_queue_projection trigger
        SELECT api.emit_domain_event(
            p_stream_id := NEW.stream_id,
            p_stream_type := 'workflow_queue',
            -- NOTE: p_stream_version removed - function auto-calculates it
            p_event_type := 'workflow.queue.pending',
            p_event_data := jsonb_build_object(
                'event_id', NEW.id,              -- Link to bootstrap event
                'event_type', NEW.event_type,    -- Original event type
                'event_data', NEW.event_data,    -- Original event payload
                'stream_id', NEW.stream_id,      -- Original stream ID
                'stream_type', NEW.stream_type   -- Original stream type
            ),
            p_event_metadata := jsonb_build_object(
                'triggered_by', 'enqueue_workflow_from_bootstrap_event',
                'source_event_id', NEW.id
            )
        ) INTO v_pending_event_id;

        -- Log for debugging (appears in Supabase logs)
        RAISE NOTICE 'Enqueued workflow job: event_id=%, pending_event_id=%',
            NEW.id, v_pending_event_id;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enqueue_workflow_from_bootstrap_event"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_workflow_from_bootstrap_event"() IS 'Automatically enqueues workflow jobs by emitting workflow.queue.pending event when organization.bootstrap.initiated event is inserted. Part of strict CQRS architecture for workflow queue management.';



CREATE OR REPLACE FUNCTION "public"."get_active_grants_for_consultant"("p_consultant_org_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("grant_id" "uuid", "provider_org_id" "uuid", "provider_org_name" "text", "scope" "text", "authorization_type" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ctag.id,
    ctag.provider_org_id,
    op.name,
    ctag.scope,
    ctag.authorization_type,
    ctag.expires_at
  FROM cross_tenant_access_grants_projection ctag
  JOIN organizations_projection op ON op.id = ctag.provider_org_id
  WHERE ctag.consultant_org_id = p_consultant_org_id
    AND ctag.status = 'active'
    AND (ctag.expires_at IS NULL OR ctag.expires_at > NOW())
    AND (p_user_id IS NULL OR ctag.consultant_user_id IS NULL OR ctag.consultant_user_id = p_user_id)
    AND op.is_active = true
    AND op.deleted_at IS NULL
  ORDER BY op.name, ctag.granted_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_active_grants_for_consultant"("p_consultant_org_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_active_grants_for_consultant"("p_consultant_org_id" "uuid", "p_user_id" "uuid") IS 'Returns all active grants for a consultant organization/user';



CREATE OR REPLACE FUNCTION "public"."get_base_domain"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Attempt to read from app.base_domain setting
  -- Falls back to analytics4change.com (production default) if not set
  RETURN COALESCE(
    current_setting('app.base_domain', true),
    'analytics4change.com'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'analytics4change.com';
END;
$$;


ALTER FUNCTION "public"."get_base_domain"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_base_domain"() IS 'Returns environment-specific base domain. Dev: firstovertheline.com, Prod: analytics4change.com. Reads from app.base_domain setting or defaults to analytics4change.com';



CREATE OR REPLACE FUNCTION "public"."get_bootstrap_status"("p_organization_id" "uuid") RETURNS TABLE("bootstrap_id" "uuid", "organization_id" "uuid", "status" "text", "current_stage" "text", "error_message" "text", "created_at" timestamp with time zone, "completed_at" timestamp with time zone, "domain" "text", "dns_configured" boolean, "invitations_sent" integer)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH org_events AS (
    -- Get all distinct event types for this organization
    SELECT DISTINCT de.event_type
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
  ),
  first_event AS (
    -- Get the first event timestamp for created_at
    SELECT MIN(de.created_at) AS ts
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
  ),
  completion_event AS (
    -- Get the completion timestamp if completed
    SELECT de.created_at AS ts, de.event_data->>'error_message' AS error_msg
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type IN ('organization.bootstrap.completed', 'organization.bootstrap.failed', 'organization.activated')
    ORDER BY de.created_at DESC
    LIMIT 1
  ),
  dns_event AS (
    -- Extract FQDN from DNS created event (contract: organization.subdomain.dns_created)
    SELECT COALESCE(de.event_data->>'full_subdomain', de.event_data->>'fqdn') AS fqdn
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type = 'organization.subdomain.dns_created'
    LIMIT 1
  ),
  invitation_count AS (
    -- Count invitation emails sent
    SELECT COUNT(*)::INTEGER AS cnt
    FROM domain_events de
    WHERE de.stream_id = p_organization_id
      AND de.event_type = 'invitation.email.sent'
  )
  SELECT
    p_organization_id AS bootstrap_id,
    p_organization_id AS organization_id,
    -- Determine overall status
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.activated') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.completed') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.failed') THEN 'failed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.cancelled') THEN 'cancelled'
      WHEN EXISTS (SELECT 1 FROM org_events) THEN 'running'
      ELSE 'unknown'
    END::TEXT,
    -- Determine current stage based on highest completed event
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.activated') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.bootstrap.completed') THEN 'completed'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'invitation.email.sent') THEN 'invitation_email'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'user.invited') THEN 'role_assignment'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.subdomain.verified') THEN 'dns_verification'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.subdomain.dns_created') THEN 'dns_provisioning'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'program.created') THEN 'program_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'phone.created') THEN 'phone_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'address.created') THEN 'address_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'contact.created') THEN 'contact_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.created') THEN 'organization_creation'
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type LIKE 'organization.bootstrap.%') THEN 'temporal_workflow_started'
      ELSE 'temporal_workflow_started'
    END::TEXT,
    ce.error_msg::TEXT,
    fe.ts,
    CASE
      WHEN EXISTS (SELECT 1 FROM org_events WHERE event_type IN ('organization.activated', 'organization.bootstrap.completed')) THEN ce.ts
      ELSE NULL
    END,
    -- NEW: domain from DNS event
    dns.fqdn::TEXT,
    -- NEW: dns_configured boolean (contract: organization.subdomain.dns_created)
    EXISTS (SELECT 1 FROM org_events WHERE event_type = 'organization.subdomain.dns_created'),
    -- NEW: invitations_sent count
    COALESCE(ic.cnt, 0)
  FROM first_event fe
  LEFT JOIN completion_event ce ON TRUE
  LEFT JOIN dns_event dns ON TRUE
  LEFT JOIN invitation_count ic ON TRUE
  WHERE fe.ts IS NOT NULL;  -- P0 #3: Only return rows if events exist for this organization
END;
$$;


ALTER FUNCTION "public"."get_bootstrap_status"("p_organization_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_bootstrap_status"("p_organization_id" "uuid") IS 'Get current status of a bootstrap process by bootstrap_id (tracks Temporal workflow progress)';



CREATE OR REPLACE FUNCTION "public"."get_current_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT (auth.jwt()->>'org_id')::uuid;
$$;


ALTER FUNCTION "public"."get_current_org_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_org_id"() IS 'Extracts org_id from JWT custom claims (Supabase Auth)';



CREATE OR REPLACE FUNCTION "public"."get_current_permissions"() RETURNS "text"[]
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(
      COALESCE(auth.jwt()->'permissions', '[]'::jsonb)
    )
  );
$$;


ALTER FUNCTION "public"."get_current_permissions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_permissions"() IS 'Extracts permissions array from JWT custom claims (Supabase Auth)';



CREATE OR REPLACE FUNCTION "public"."get_current_scope_path"() RETURNS "extensions"."ltree"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN auth.jwt()->>'scope_path' IS NOT NULL
    THEN (auth.jwt()->>'scope_path')::ltree
    ELSE NULL
  END;
$$;


ALTER FUNCTION "public"."get_current_scope_path"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_scope_path"() IS 'Extracts scope_path from JWT custom claims (Supabase Auth)';



CREATE OR REPLACE FUNCTION "public"."get_current_user_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
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
$$;


ALTER FUNCTION "public"."get_current_user_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_user_id"() IS 'Extracts current user ID from JWT (Supabase Auth UUID format). Supports testing override via app.current_user setting.';



CREATE OR REPLACE FUNCTION "public"."get_current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT auth.jwt()->>'user_role';
$$;


ALTER FUNCTION "public"."get_current_user_role"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_user_role"() IS 'Extracts user_role from JWT custom claims (Supabase Auth)';



CREATE OR REPLACE FUNCTION "public"."get_entity_version"("p_stream_id" "uuid", "p_stream_type" "text") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE(MAX(stream_version), 0)
  FROM domain_events
  WHERE stream_id = p_stream_id
    AND stream_type = p_stream_type
    AND processed_at IS NOT NULL;
$$;


ALTER FUNCTION "public"."get_entity_version"("p_stream_id" "uuid", "p_stream_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_entity_version"("p_stream_id" "uuid", "p_stream_type" "text") IS 'Gets the current version number for an entity stream';



CREATE OR REPLACE FUNCTION "public"."get_full_subdomain"("p_slug" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  IF p_slug IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN p_slug || '.' || get_base_domain();
END;
$$;


ALTER FUNCTION "public"."get_full_subdomain"("p_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_full_subdomain"("p_slug" "text") IS 'Computes full subdomain from slug and environment base domain. Example: get_full_subdomain(''acme'') returns ''acme.firstovertheline.com'' in dev environment';



CREATE OR REPLACE FUNCTION "public"."get_impersonation_session_details"("p_session_id" "text") RETURNS TABLE("session_id" "text", "super_admin_user_id" "uuid", "target_user_id" "uuid", "target_org_id" "uuid", "expires_at" timestamp with time zone, "status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    isp.session_id,
    isp.super_admin_user_id,
    isp.target_user_id,
    isp.target_org_id,
    isp.expires_at,
    isp.status
  FROM impersonation_sessions_projection isp
  WHERE isp.session_id = p_session_id;
END;
$$;


ALTER FUNCTION "public"."get_impersonation_session_details"("p_session_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_impersonation_session_details"("p_session_id" "text") IS 'Returns impersonation session details for Redis cache synchronization';



CREATE OR REPLACE FUNCTION "public"."get_org_impersonation_audit"("p_org_id" "uuid", "p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("session_id" "text", "super_admin_email" "text", "target_email" "text", "justification_reason" "text", "justification_reference_id" "text", "started_at" timestamp with time zone, "ended_at" timestamp with time zone, "total_duration_ms" integer, "renewal_count" integer, "actions_performed" integer, "status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    isp.session_id,
    isp.super_admin_email,
    isp.target_email,
    isp.justification_reason,
    isp.justification_reference_id,
    isp.started_at,
    isp.ended_at,
    isp.total_duration_ms,
    isp.renewal_count,
    isp.actions_performed,
    isp.status
  FROM impersonation_sessions_projection isp
  WHERE isp.target_org_id = p_org_id
    AND isp.started_at BETWEEN p_start_date AND p_end_date
  ORDER BY isp.started_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_org_impersonation_audit"("p_org_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_org_impersonation_audit"("p_org_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) IS 'Returns impersonation audit trail for an organization within a date range (default: last 30 days)';



CREATE OR REPLACE FUNCTION "public"."get_organization_ancestors"("p_org_path" "extensions"."ltree") RETURNS TABLE("id" "uuid", "name" "text", "path" "extensions"."ltree", "depth" integer, "is_active" boolean)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.name, o.path, o.depth, o.is_active
  FROM organizations_projection o
  WHERE p_org_path <@ o.path
    AND o.deleted_at IS NULL
  ORDER BY o.depth;
END;
$$;


ALTER FUNCTION "public"."get_organization_ancestors"("p_org_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_ancestors"("p_org_path" "extensions"."ltree") IS 'Returns all ancestor organizations for a given organization path';



CREATE OR REPLACE FUNCTION "public"."get_organization_descendants"("p_org_path" "extensions"."ltree") RETURNS TABLE("id" "uuid", "name" "text", "path" "extensions"."ltree", "depth" integer, "is_active" boolean)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.name, o.path, o.depth, o.is_active
  FROM organizations_projection o
  WHERE o.path <@ p_org_path
    AND o.deleted_at IS NULL
  ORDER BY o.path;
END;
$$;


ALTER FUNCTION "public"."get_organization_descendants"("p_org_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_descendants"("p_org_path" "extensions"."ltree") IS 'Returns all active descendant organizations for a given organization path';



CREATE OR REPLACE FUNCTION "public"."get_organization_subdomain"("p_org_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_slug TEXT;
BEGIN
  SELECT slug INTO v_slug
  FROM organizations_projection
  WHERE id = p_org_id;

  IF v_slug IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN get_full_subdomain(v_slug);
END;
$$;


ALTER FUNCTION "public"."get_organization_subdomain"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_subdomain"("p_org_id" "uuid") IS 'Gets full subdomain for organization by ID. Returns NULL if organization not found. Example: get_organization_subdomain(''...'') might return ''acme.analytics4change.com''';



CREATE OR REPLACE FUNCTION "public"."get_organization_unit_ancestors"("p_ou_path" "extensions"."ltree") RETURNS TABLE("id" "uuid", "name" "text", "path" "extensions"."ltree", "depth" integer, "is_active" boolean, "entity_type" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Return root organization (depth = 2)
  RETURN QUERY
  SELECT
    o.id, o.name, o.path, o.depth, o.is_active, 'organization'::TEXT as entity_type
  FROM organizations_projection o
  WHERE p_ou_path <@ o.path
    AND o.deleted_at IS NULL
  UNION ALL
  -- Return parent organization units (depth > 2)
  SELECT
    ou.id, ou.name, ou.path, ou.depth, ou.is_active, 'organization_unit'::TEXT as entity_type
  FROM organization_units_projection ou
  WHERE p_ou_path <@ ou.path
    AND ou.path != p_ou_path  -- Exclude self
    AND ou.deleted_at IS NULL
  ORDER BY depth;
END;
$$;


ALTER FUNCTION "public"."get_organization_unit_ancestors"("p_ou_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_unit_ancestors"("p_ou_path" "extensions"."ltree") IS 'Returns all ancestor organizations and OUs for a given OU path, including entity type';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."organization_units_projection" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text",
    "slug" "text" NOT NULL,
    "path" "extensions"."ltree" NOT NULL,
    "parent_path" "extensions"."ltree" NOT NULL,
    "depth" integer GENERATED ALWAYS AS ("extensions"."nlevel"("path")) STORED,
    "timezone" "text" DEFAULT 'America/New_York'::"text",
    "is_active" boolean DEFAULT true,
    "deactivated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_ends_with_slug" CHECK ((("extensions"."subpath"("path", ("extensions"."nlevel"("path") - 1), 1))::"text" = "slug")),
    CONSTRAINT "valid_ou_depth" CHECK (("extensions"."nlevel"("path") > 1)),
    CONSTRAINT "valid_parent_path" CHECK ((("parent_path" IS NOT NULL) AND ("path" OPERATOR("extensions".<@) "parent_path") AND ("extensions"."nlevel"("path") = ("extensions"."nlevel"("parent_path") + 1)))),
    CONSTRAINT "valid_slug" CHECK (("slug" ~ '^[a-z0-9_]+$'::"text"))
);


ALTER TABLE "public"."organization_units_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_units_projection" IS 'CQRS projection of organization_unit.* events - maintains sub-organization hierarchy (depth > 2)';



COMMENT ON COLUMN "public"."organization_units_projection"."organization_id" IS 'FK to root organization (provider) this unit belongs to';



COMMENT ON COLUMN "public"."organization_units_projection"."slug" IS 'ltree-safe identifier (a-z, 0-9, underscore only for PG15 compatibility)';



COMMENT ON COLUMN "public"."organization_units_projection"."path" IS 'Full ltree hierarchical path (e.g., root.org_acme_healthcare.north_campus.pediatrics)';



COMMENT ON COLUMN "public"."organization_units_projection"."parent_path" IS 'Direct parent ltree path (e.g., root.org_acme_healthcare.north_campus)';



COMMENT ON COLUMN "public"."organization_units_projection"."depth" IS 'Computed depth in hierarchy (always > 2 for OUs)';



COMMENT ON COLUMN "public"."organization_units_projection"."is_active" IS 'OU active status - when false, role assignments to this OU and descendants are blocked';



COMMENT ON COLUMN "public"."organization_units_projection"."deleted_at" IS 'Soft deletion timestamp (OUs are never physically deleted)';



CREATE OR REPLACE FUNCTION "public"."get_organization_unit_by_path"("p_path" "extensions"."ltree") RETURNS "public"."organization_units_projection"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_result organization_units_projection;
BEGIN
  SELECT * INTO v_result
  FROM organization_units_projection
  WHERE path = p_path
    AND deleted_at IS NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_organization_unit_by_path"("p_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_unit_by_path"("p_path" "extensions"."ltree") IS 'Retrieves an organization unit by its ltree path';



CREATE OR REPLACE FUNCTION "public"."get_organization_unit_descendants"("p_ou_path" "extensions"."ltree") RETURNS TABLE("id" "uuid", "name" "text", "path" "extensions"."ltree", "depth" integer, "is_active" boolean)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ou.id, ou.name, ou.path, ou.depth, ou.is_active
  FROM organization_units_projection ou
  WHERE ou.path <@ p_ou_path
    AND ou.deleted_at IS NULL
  ORDER BY ou.path;
END;
$$;


ALTER FUNCTION "public"."get_organization_unit_descendants"("p_ou_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_unit_descendants"("p_ou_path" "extensions"."ltree") IS 'Returns all active descendant organization units for a given OU path';



CREATE OR REPLACE FUNCTION "public"."get_user_active_impersonation_sessions"("p_user_id" "uuid") RETURNS TABLE("session_id" "text", "super_admin_email" "text", "target_email" "text", "target_org_name" "text", "started_at" timestamp with time zone, "expires_at" timestamp with time zone, "renewal_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    isp.session_id,
    isp.super_admin_email,
    isp.target_email,
    isp.target_org_name,
    isp.started_at,
    isp.expires_at,
    isp.renewal_count
  FROM impersonation_sessions_projection isp
  WHERE isp.status = 'active'
    AND (isp.super_admin_user_id = p_user_id OR isp.target_user_id = p_user_id)
  ORDER BY isp.started_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_user_active_impersonation_sessions"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_active_impersonation_sessions"("p_user_id" "uuid") IS 'Returns all active impersonation sessions for a user (as super admin or target)';



CREATE OR REPLACE FUNCTION "public"."get_user_active_roles"("p_user_id" "uuid", "p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("role_id" "uuid", "role_name" "text", "organization_id" "uuid", "scope_path" "extensions"."ltree")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        ur.role_id,
        r.name AS role_name,
        ur.organization_id,
        ur.scope_path
    FROM public.user_roles_projection ur
    JOIN public.roles_projection r ON r.id = ur.role_id
    LEFT JOIN public.user_organizations_projection uop
        ON uop.user_id = ur.user_id
        AND uop.org_id = ur.organization_id
    WHERE ur.user_id = p_user_id
      -- Filter by org if specified
      AND (p_org_id IS NULL OR ur.organization_id = p_org_id OR ur.organization_id IS NULL)
      -- Role-level date check
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
      -- User-org level date check (for org-scoped roles)
      AND (
          ur.organization_id IS NULL  -- Global roles (super_admin) skip org access check
          OR (
              (uop.access_start_date IS NULL OR uop.access_start_date <= CURRENT_DATE)
              AND (uop.access_expiration_date IS NULL OR uop.access_expiration_date >= CURRENT_DATE)
          )
      );
END;
$$;


ALTER FUNCTION "public"."get_user_active_roles"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_active_roles"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Get user''s active roles, respecting both org-level and role-level access dates';



CREATE OR REPLACE FUNCTION "public"."get_user_aggregated_permissions"("p_user_id" "uuid") RETURNS "uuid"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE(
    array_agg(DISTINCT rp.permission_id),
    '{}'::UUID[]
  )
  FROM user_roles_projection ur
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = p_user_id
    AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
    AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE);
$$;


ALTER FUNCTION "public"."get_user_aggregated_permissions"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_aggregated_permissions"("p_user_id" "uuid") IS 'Returns array of all permission IDs the user has across all active roles. Used for subset-only delegation validation.';



CREATE OR REPLACE FUNCTION "public"."get_user_claims_preview"("p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_result jsonb;
BEGIN
  -- Use provided user_id or current authenticated user
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated and no user_id provided';
  END IF;

  -- Simulate what the JWT hook would return
  SELECT auth.custom_access_token_hook(
    jsonb_build_object(
      'user_id', v_user_id::text,
      'claims', '{}'::jsonb
    )
  )->>'claims' INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_user_claims_preview"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_claims_preview"("p_user_id" "uuid") IS 'Preview what JWT custom claims would be for a user (debugging/testing only)';



CREATE OR REPLACE FUNCTION "public"."get_user_effective_address"("p_user_id" "uuid", "p_org_id" "uuid", "p_address_type" "public"."address_type" DEFAULT 'physical'::"public"."address_type") RETURNS TABLE("id" "uuid", "label" "text", "type" "public"."address_type", "street1" "text", "street2" "text", "city" "text", "state" "text", "zip_code" "text", "country" "text", "is_override" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Try org-specific override first
    RETURN QUERY
    SELECT
        ao.id,
        ao.label,
        ao.type,
        ao.street1,
        ao.street2,
        ao.city,
        ao.state,
        ao.zip_code,
        ao.country,
        true AS is_override
    FROM public.user_org_address_overrides ao
    WHERE ao.user_id = p_user_id
      AND ao.org_id = p_org_id
      AND ao.type = p_address_type
      AND ao.is_active = true
    LIMIT 1;

    -- If no override found, return global address
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            ua.id,
            ua.label,
            ua.type,
            ua.street1,
            ua.street2,
            ua.city,
            ua.state,
            ua.zip_code,
            ua.country,
            false AS is_override
        FROM public.user_addresses ua
        WHERE ua.user_id = p_user_id
          AND ua.type = p_address_type
          AND ua.is_active = true
        ORDER BY ua.is_primary DESC
        LIMIT 1;
    END IF;
END;
$$;


ALTER FUNCTION "public"."get_user_effective_address"("p_user_id" "uuid", "p_org_id" "uuid", "p_address_type" "public"."address_type") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_effective_address"("p_user_id" "uuid", "p_org_id" "uuid", "p_address_type" "public"."address_type") IS 'Get effective address for user in org context, checking override first then falling back to global';



CREATE OR REPLACE FUNCTION "public"."get_user_effective_phone"("p_user_id" "uuid", "p_org_id" "uuid", "p_phone_type" "public"."phone_type" DEFAULT 'mobile'::"public"."phone_type") RETURNS TABLE("id" "uuid", "label" "text", "type" "public"."phone_type", "number" "text", "extension" "text", "country_code" "text", "sms_capable" boolean, "is_override" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Try org-specific override first
    RETURN QUERY
    SELECT
        po.id,
        po.label,
        po.type,
        po.number,
        po.extension,
        po.country_code,
        po.sms_capable,
        true AS is_override
    FROM public.user_org_phone_overrides po
    WHERE po.user_id = p_user_id
      AND po.org_id = p_org_id
      AND po.type = p_phone_type
      AND po.is_active = true
    LIMIT 1;

    -- If no override found, return global phone
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            up.id,
            up.label,
            up.type,
            up.number,
            up.extension,
            up.country_code,
            up.sms_capable,
            false AS is_override
        FROM public.user_phones up
        WHERE up.user_id = p_user_id
          AND up.type = p_phone_type
          AND up.is_active = true
        ORDER BY up.is_primary DESC
        LIMIT 1;
    END IF;
END;
$$;


ALTER FUNCTION "public"."get_user_effective_phone"("p_user_id" "uuid", "p_org_id" "uuid", "p_phone_type" "public"."phone_type") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_effective_phone"("p_user_id" "uuid", "p_org_id" "uuid", "p_phone_type" "public"."phone_type") IS 'Get effective phone for user in org context, checking override first then falling back to global';



CREATE OR REPLACE FUNCTION "public"."get_user_scope_paths"("p_user_id" "uuid") RETURNS "extensions"."ltree"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE(
    array_agg(DISTINCT ur.scope_path),
    '{}'::extensions.ltree[]
  )
  FROM user_roles_projection ur
  WHERE ur.user_id = p_user_id
    AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
    AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE);
$$;


ALTER FUNCTION "public"."get_user_scope_paths"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_scope_paths"("p_user_id" "uuid") IS 'Returns array of all scope paths (ltree) the user has. NULL in array means global access.';



CREATE OR REPLACE FUNCTION "public"."get_user_sms_phone"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("id" "uuid", "number" "text", "country_code" "text", "is_override" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Try org-specific SMS-capable override first
    RETURN QUERY
    SELECT
        po.id,
        po.number,
        po.country_code,
        true AS is_override
    FROM public.user_org_phone_overrides po
    WHERE po.user_id = p_user_id
      AND po.org_id = p_org_id
      AND po.sms_capable = true
      AND po.is_active = true
    LIMIT 1;

    -- If no override found, return global SMS-capable phone
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            up.id,
            up.number,
            up.country_code,
            false AS is_override
        FROM public.user_phones up
        WHERE up.user_id = p_user_id
          AND up.sms_capable = true
          AND up.is_active = true
        ORDER BY up.is_primary DESC, up.type = 'mobile' DESC
        LIMIT 1;
    END IF;
END;
$$;


ALTER FUNCTION "public"."get_user_sms_phone"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_sms_phone"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Get SMS-capable phone for user in org context, for notification delivery';



CREATE OR REPLACE FUNCTION "public"."handle_bootstrap_cancelled"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
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
END;
$$;


ALTER FUNCTION "public"."handle_bootstrap_cancelled"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_bootstrap_completed"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
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
END;
$$;


ALTER FUNCTION "public"."handle_bootstrap_completed"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_bootstrap_failed"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
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
END;
$$;


ALTER FUNCTION "public"."handle_bootstrap_failed"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_bootstrap_workflow"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Only process newly inserted events that haven't been processed yet
  IF TG_OP = 'INSERT' AND NEW.processed_at IS NULL THEN

    -- Handle organization bootstrap events
    IF NEW.stream_type = 'organization' THEN

      CASE NEW.event_type

        -- When bootstrap fails, trigger cleanup if needed
        WHEN 'organization.bootstrap.failed' THEN
          -- Check if partial cleanup is required
          IF (NEW.event_data->>'partial_cleanup_required')::BOOLEAN = TRUE THEN
            -- Emit cleanup events for any partial resources
            INSERT INTO domain_events (
              stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
            ) VALUES (
              NEW.stream_id,
              'organization',
              (SELECT COALESCE(MAX(stream_version), 0) + 1 FROM domain_events WHERE stream_id = NEW.stream_id),
              'organization.bootstrap.cancelled',
              jsonb_build_object(
                'bootstrap_id', NEW.event_data->>'bootstrap_id',
                'cleanup_completed', TRUE,
                'cleanup_actions', to_jsonb(ARRAY['partial_resource_cleanup']),  -- FIX: Wrap TEXT[] with to_jsonb()
                'original_failure_stage', NEW.event_data->>'failure_stage'
              ),
              jsonb_build_object(
                'user_id', NEW.event_metadata->>'user_id',
                'organization_id', NEW.event_metadata->>'organization_id',
                'reason', 'Automated cleanup after bootstrap failure',
                'automated', TRUE
              ),
              NOW()
            );
          END IF;

        ELSE
          -- Not a bootstrap event that requires trigger action
          NULL;
      END CASE;

    END IF;

  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_bootstrap_workflow"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_bootstrap_workflow"() IS 'Trigger function to handle bootstrap workflow events and automated cleanup';



CREATE OR REPLACE FUNCTION "public"."handle_invitation_resent"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE invitations_projection
  SET
    token = safe_jsonb_extract_text(p_event.event_data, 'token'),
    expires_at = safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    status = 'pending',
    updated_at = p_event.created_at
  WHERE invitation_id = safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id');
END;
$$;


ALTER FUNCTION "public"."handle_invitation_resent"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_created"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO organizations_projection (
    id, name, slug, subdomain_status, is_active, path, parent_path,
    type, partner_type, referring_partner_id, metadata, tags, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    safe_jsonb_extract_text(p_event.event_data, 'name'),
    safe_jsonb_extract_text(p_event.event_data, 'slug'),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'), 'pending')::subdomain_status,
    true,
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'path')::ltree,
      p_event.stream_id::text::ltree
    ),
    COALESCE(
      safe_jsonb_extract_text(p_event.event_data, 'parent_path')::ltree,
      p_event.stream_id::text::ltree
    ),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), 'provider'),  -- TEXT, not enum
    (p_event.event_data->>'partner_type')::partner_type,
    (p_event.event_data->>'referring_partner_id')::UUID,
    COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
      '{}'::TEXT[]
    ),
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."handle_organization_created"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_organization_created"("p_event" "record") IS 'Organization created event handler - creates organization projection record.
Fixed 2026-01-20: Corrected column names (slug instead of subdomain, type instead of organization_type).';



CREATE OR REPLACE FUNCTION "public"."handle_organization_deactivated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organizations_projection
  SET
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_organization_deactivated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_deleted"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organizations_projection
  SET
    deleted_at = p_event.created_at,
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_organization_deleted"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_reactivated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organizations_projection
  SET
    is_active = true,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_organization_reactivated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_subdomain_dns_created"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organizations_projection
  SET subdomain_status = 'dns_created',
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_organization_subdomain_dns_created"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_subdomain_failed"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_error_message TEXT := p_event.event_data->>'error_message';
BEGIN
  UPDATE organizations_projection
  SET subdomain_status = 'failed',
      subdomain_metadata = jsonb_build_object(
        'failure_reason', COALESCE(v_error_message, 'Unknown error'),
        'failed_at', p_event.created_at
      ),
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_organization_subdomain_failed"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_subdomain_status_changed"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organizations_projection
  SET
    subdomain_status = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'status'), subdomain_status),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_organization_subdomain_status_changed"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_subdomain_verified"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organizations_projection
  SET subdomain_status = 'verified',
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_organization_subdomain_verified"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_unit_created"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Validate parent path exists
  IF NOT EXISTS (
    SELECT 1 FROM organizations_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
    UNION ALL
    SELECT 1 FROM organization_units_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
  ) THEN
    RAISE WARNING 'Parent path % does not exist for organization unit %',
      p_event.event_data->>'parent_path', p_event.stream_id;
  END IF;

  INSERT INTO organization_units_projection (
    id, organization_id, name, display_name, slug, path, parent_path,
    timezone, is_active, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
    safe_jsonb_extract_text(p_event.event_data, 'name'),
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), safe_jsonb_extract_text(p_event.event_data, 'name')),
    safe_jsonb_extract_text(p_event.event_data, 'slug'),
    (p_event.event_data->>'path')::LTREE,
    (p_event.event_data->>'parent_path')::LTREE,
    COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'UTC'),
    true,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    slug = EXCLUDED.slug,
    path = EXCLUDED.path,
    parent_path = EXCLUDED.parent_path,
    timezone = EXCLUDED.timezone,
    updated_at = EXCLUDED.updated_at;
END;
$$;


ALTER FUNCTION "public"."handle_organization_unit_created"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_unit_deactivated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Cascade deactivate using ltree containment
  UPDATE organization_units_projection
  SET
    is_active = false,
    deactivated_at = p_event.created_at,
    updated_at = p_event.created_at
  WHERE path <@ (p_event.event_data->>'path')::ltree
    AND is_active = true
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for deactivation event', p_event.stream_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_organization_unit_deactivated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_unit_deleted"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organization_units_projection
  SET
    deleted_at = p_event.created_at,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found or already deleted', p_event.stream_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_organization_unit_deleted"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_unit_reactivated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Cascade reactivate using ltree containment
  UPDATE organization_units_projection
  SET
    is_active = true,
    deactivated_at = NULL,
    updated_at = p_event.created_at
  WHERE path <@ (p_event.event_data->>'path')::ltree
    AND is_active = false
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for reactivation event', p_event.stream_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_organization_unit_reactivated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_unit_updated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE organization_units_projection
  SET
    name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
    display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
    timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;

  IF NOT FOUND THEN
    RAISE WARNING 'Organization unit % not found for update event', p_event.stream_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_organization_unit_updated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_organization_updated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
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
END;
$$;


ALTER FUNCTION "public"."handle_organization_updated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_permission_defined"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO permissions_projection (
    id, applet, action, description, scope_type, requires_mfa, created_at
  ) VALUES (
    p_event.stream_id,
    p_event.event_data->>'applet',
    p_event.event_data->>'action',
    p_event.event_data->>'description',
    p_event.event_data->>'scope_type',
    COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false),
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    scope_type = EXCLUDED.scope_type,
    requires_mfa = EXCLUDED.requires_mfa;
END;
$$;


ALTER FUNCTION "public"."handle_permission_defined"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_rbac_user_role_assigned"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path, assigned_at)
  VALUES (
    p_event.stream_id,
    (p_event.event_data->>'role_id')::UUID,
    CASE WHEN p_event.event_data->>'org_id' = '*' THEN NULL ELSE (p_event.event_data->>'org_id')::UUID END,
    CASE WHEN p_event.event_data->>'scope_path' = '*' THEN NULL ELSE (p_event.event_data->>'scope_path')::LTREE END,
    p_event.created_at
  )
  ON CONFLICT (user_id, role_id, org_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."handle_rbac_user_role_assigned"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_role_created"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO roles_projection (
    id, name, description, organization_id, org_hierarchy_scope,
    is_active, created_at, updated_at
  ) VALUES (
    p_event.stream_id,
    p_event.event_data->>'name',
    p_event.event_data->>'description',
    (p_event.event_data->>'organization_id')::UUID,
    (p_event.event_data->>'org_hierarchy_scope')::LTREE,
    true,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    organization_id = EXCLUDED.organization_id,
    org_hierarchy_scope = EXCLUDED.org_hierarchy_scope,
    updated_at = EXCLUDED.updated_at;
END;
$$;


ALTER FUNCTION "public"."handle_role_created"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_role_deactivated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE roles_projection SET
    is_active = false,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_role_deactivated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_role_deleted"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE roles_projection SET
    deleted_at = p_event.created_at,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_role_deleted"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_role_permission_granted"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
  VALUES (
    p_event.stream_id,
    (p_event.event_data->>'permission_id')::UUID,
    p_event.created_at
  )
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."handle_role_permission_granted"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_role_permission_revoked"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  DELETE FROM role_permissions_projection
  WHERE role_id = p_event.stream_id
    AND permission_id = (p_event.event_data->>'permission_id')::UUID;
END;
$$;


ALTER FUNCTION "public"."handle_role_permission_revoked"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_role_reactivated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE roles_projection SET
    is_active = true,
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_role_reactivated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_role_updated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE roles_projection SET
    name = COALESCE(p_event.event_data->>'name', name),
    description = COALESCE(p_event.event_data->>'description', description),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_role_updated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_access_dates_updated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  UPDATE user_organizations_projection
  SET
    access_start_date = (p_event.event_data->>'access_start_date')::DATE,
    access_expiration_date = (p_event.event_data->>'access_expiration_date')::DATE,
    updated_at = p_event.created_at
  WHERE user_id = v_user_id AND org_id = v_org_id;

  IF NOT FOUND THEN
    INSERT INTO user_organizations_projection (
      user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
    ) VALUES (
      v_user_id, v_org_id,
      (p_event.event_data->>'access_start_date')::DATE,
      (p_event.event_data->>'access_expiration_date')::DATE,
      p_event.created_at, p_event.created_at
    );
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_access_dates_updated"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_user_access_dates_updated"("p_event" "record") IS 'Handle user.access_dates.updated events - updates org membership access window (v2: fixed table name)';



CREATE OR REPLACE FUNCTION "public"."handle_user_address_added"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_address_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_address_id := (p_event.event_data->>'address_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    -- Global address
    INSERT INTO user_addresses (
      id, user_id, label, type, street1, street2, city, state, zip_code, country,
      is_primary, is_active, metadata, created_at, updated_at
    ) VALUES (
      v_address_id, v_user_id,
      p_event.event_data->>'label',
      (p_event.event_data->>'type')::address_type,
      p_event.event_data->>'street1',
      p_event.event_data->>'street2',
      p_event.event_data->>'city',
      p_event.event_data->>'state',
      p_event.event_data->>'zip_code',
      COALESCE(p_event.event_data->>'country', 'USA'),
      COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
      COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
      COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
      p_event.created_at,
      p_event.created_at
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    -- Org-specific override
    INSERT INTO user_org_address_overrides (
      id, user_id, org_id, label, type, street1, street2, city, state, zip_code, country,
      is_active, metadata, created_at, updated_at
    ) VALUES (
      v_address_id, v_user_id, v_org_id,
      p_event.event_data->>'label',
      (p_event.event_data->>'type')::address_type,
      p_event.event_data->>'street1',
      p_event.event_data->>'street2',
      p_event.event_data->>'city',
      p_event.event_data->>'state',
      p_event.event_data->>'zip_code',
      COALESCE(p_event.event_data->>'country', 'USA'),
      COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
      COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
      p_event.created_at,
      p_event.created_at
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_address_added"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_address_removed"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_address_id UUID;
  v_org_id UUID;
BEGIN
  v_address_id := (p_event.event_data->>'address_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
    IF v_org_id IS NULL THEN
      DELETE FROM user_addresses WHERE id = v_address_id;
    ELSE
      DELETE FROM user_org_address_overrides WHERE id = v_address_id;
    END IF;
  ELSE
    -- Soft delete (deactivate)
    IF v_org_id IS NULL THEN
      UPDATE user_addresses SET is_active = false, updated_at = p_event.created_at
      WHERE id = v_address_id;
    ELSE
      UPDATE user_org_address_overrides SET is_active = false, updated_at = p_event.created_at
      WHERE id = v_address_id;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_address_removed"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_address_updated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_address_id UUID;
  v_org_id UUID;
BEGIN
  v_address_id := (p_event.event_data->>'address_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    -- Global address update
    UPDATE user_addresses SET
      label = COALESCE(p_event.event_data->>'label', label),
      type = COALESCE((p_event.event_data->>'type')::address_type, type),
      street1 = COALESCE(p_event.event_data->>'street1', street1),
      street2 = p_event.event_data->>'street2',
      city = COALESCE(p_event.event_data->>'city', city),
      state = COALESCE(p_event.event_data->>'state', state),
      zip_code = COALESCE(p_event.event_data->>'zip_code', zip_code),
      country = COALESCE(p_event.event_data->>'country', country),
      is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
      is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
      metadata = COALESCE(p_event.event_data->'metadata', metadata),
      updated_at = p_event.created_at
    WHERE id = v_address_id;
  ELSE
    -- Org override update
    UPDATE user_org_address_overrides SET
      label = COALESCE(p_event.event_data->>'label', label),
      type = COALESCE((p_event.event_data->>'type')::address_type, type),
      street1 = COALESCE(p_event.event_data->>'street1', street1),
      street2 = p_event.event_data->>'street2',
      city = COALESCE(p_event.event_data->>'city', city),
      state = COALESCE(p_event.event_data->>'state', state),
      zip_code = COALESCE(p_event.event_data->>'zip_code', zip_code),
      country = COALESCE(p_event.event_data->>'country', country),
      is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
      metadata = COALESCE(p_event.event_data->'metadata', metadata),
      updated_at = p_event.created_at
    WHERE id = v_address_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_address_updated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_created"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_sms_enabled BOOLEAN;
  v_sms_phone_id UUID;
  v_in_app_enabled BOOLEAN;
  v_email_enabled BOOLEAN;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'organization_id')::UUID;

  -- Insert user record
  INSERT INTO users (
    id, email, name, first_name, last_name, current_organization_id,
    accessible_organizations, roles, metadata, is_active, created_at, updated_at
  ) VALUES (
    v_user_id,
    p_event.event_data->>'email',
    COALESCE(
      NULLIF(TRIM(CONCAT(p_event.event_data->>'first_name', ' ', p_event.event_data->>'last_name')), ''),
      p_event.event_data->>'name',
      p_event.event_data->>'email'
    ),
    p_event.event_data->>'first_name',
    p_event.event_data->>'last_name',
    v_org_id,
    ARRAY[v_org_id],
    '{}',
    jsonb_build_object(
      'auth_method', p_event.event_data->>'auth_method',
      'invited_via', p_event.event_data->>'invited_via'
    ),
    true,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
    current_organization_id = COALESCE(users.current_organization_id, EXCLUDED.current_organization_id),
    accessible_organizations = ARRAY(
      SELECT DISTINCT unnest(users.accessible_organizations || EXCLUDED.accessible_organizations)
    ),
    updated_at = p_event.created_at;

  -- Create user_organizations_projection record (access dates only, NO notification_preferences)
  INSERT INTO user_organizations_projection (
    user_id, org_id, access_start_date, access_expiration_date, created_at, updated_at
  ) VALUES (
    v_user_id,
    v_org_id,
    (p_event.event_data->>'access_start_date')::DATE,
    (p_event.event_data->>'access_expiration_date')::DATE,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (user_id, org_id) DO UPDATE SET
    access_start_date = COALESCE(EXCLUDED.access_start_date, user_organizations_projection.access_start_date),
    access_expiration_date = COALESCE(EXCLUDED.access_expiration_date, user_organizations_projection.access_expiration_date),
    updated_at = p_event.created_at;

  -- Create user_notification_preferences_projection record (normalized columns)
  -- Parse from nested JSONB with backwards compatibility for camelCase
  v_email_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'email')::BOOLEAN,
    true  -- Default to email enabled
  );
  v_sms_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'enabled')::BOOLEAN,
    false
  );
  v_sms_phone_id := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'phone_id')::UUID,
    (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::UUID  -- camelCase fallback
  );
  v_in_app_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'in_app')::BOOLEAN,
    (p_event.event_data->'notification_preferences'->>'inApp')::BOOLEAN,  -- camelCase fallback
    false
  );

  INSERT INTO user_notification_preferences_projection (
    user_id, organization_id, email_enabled, sms_enabled, sms_phone_id, in_app_enabled,
    created_at, updated_at
  ) VALUES (
    v_user_id,
    v_org_id,
    v_email_enabled,
    v_sms_enabled,
    v_sms_phone_id,
    v_in_app_enabled,
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE SET
    email_enabled = COALESCE(EXCLUDED.email_enabled, user_notification_preferences_projection.email_enabled),
    sms_enabled = COALESCE(EXCLUDED.sms_enabled, user_notification_preferences_projection.sms_enabled),
    sms_phone_id = COALESCE(EXCLUDED.sms_phone_id, user_notification_preferences_projection.sms_phone_id),
    in_app_enabled = COALESCE(EXCLUDED.in_app_enabled, user_notification_preferences_projection.in_app_enabled),
    updated_at = p_event.created_at;
END;
$$;


ALTER FUNCTION "public"."handle_user_created"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_user_created"("p_event" "record") IS 'Handle user.created events - creates user record, org membership, and notification preferences (v2: fixed table names and schema)';



CREATE OR REPLACE FUNCTION "public"."handle_user_invited"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_correlation_id UUID;
BEGIN
  v_correlation_id := (p_event.event_metadata->>'correlation_id')::UUID;

  INSERT INTO invitations_projection (
    invitation_id, organization_id, email, first_name, last_name,
    role, roles, token, expires_at, status,
    access_start_date, access_expiration_date, notification_preferences,
    phones, correlation_id, tags, created_at, updated_at
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
    COALESCE(p_event.event_data->'phones', '[]'::jsonb),
    v_correlation_id,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
      '{}'::TEXT[]
    ),
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (invitation_id) DO UPDATE SET
    token = EXCLUDED.token,
    expires_at = EXCLUDED.expires_at,
    status = 'pending',
    phones = EXCLUDED.phones,
    notification_preferences = EXCLUDED.notification_preferences,
    correlation_id = COALESCE(invitations_projection.correlation_id, EXCLUDED.correlation_id),
    updated_at = EXCLUDED.updated_at;
END;
$$;


ALTER FUNCTION "public"."handle_user_invited"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_notification_preferences_updated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_email_enabled BOOLEAN;
  v_sms_enabled BOOLEAN;
  v_sms_phone_id UUID;
  v_in_app_enabled BOOLEAN;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  -- Parse notification preferences from JSONB with backwards compatibility for camelCase
  v_email_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'email')::BOOLEAN,
    true
  );
  v_sms_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'enabled')::BOOLEAN,
    false
  );
  v_sms_phone_id := COALESCE(
    (p_event.event_data->'notification_preferences'->'sms'->>'phone_id')::UUID,
    (p_event.event_data->'notification_preferences'->'sms'->>'phoneId')::UUID  -- camelCase fallback
  );
  v_in_app_enabled := COALESCE(
    (p_event.event_data->'notification_preferences'->>'in_app')::BOOLEAN,
    (p_event.event_data->'notification_preferences'->>'inApp')::BOOLEAN,  -- camelCase fallback
    false
  );

  -- Update user_notification_preferences_projection (normalized table)
  UPDATE user_notification_preferences_projection
  SET
    email_enabled = v_email_enabled,
    sms_enabled = v_sms_enabled,
    sms_phone_id = v_sms_phone_id,
    in_app_enabled = v_in_app_enabled,
    updated_at = p_event.created_at
  WHERE user_id = v_user_id AND organization_id = v_org_id;

  -- Create record if it doesn't exist
  IF NOT FOUND THEN
    INSERT INTO user_notification_preferences_projection (
      user_id, organization_id, email_enabled, sms_enabled, sms_phone_id, in_app_enabled,
      created_at, updated_at
    ) VALUES (
      v_user_id, v_org_id,
      v_email_enabled, v_sms_enabled, v_sms_phone_id, v_in_app_enabled,
      p_event.created_at, p_event.created_at
    );
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_notification_preferences_updated"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_user_notification_preferences_updated"("p_event" "record") IS 'Handle user.notification_preferences.updated events - updates normalized preferences table (v2: fixed to use correct table with normalized columns)';



CREATE OR REPLACE FUNCTION "public"."handle_user_phone_added"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID;
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := (p_event.event_data->>'user_id')::UUID;
  v_phone_id := (p_event.event_data->>'phone_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    -- Global phone
    INSERT INTO user_phones (
      id, user_id, label, type, number, extension, country_code,
      is_primary, is_active, sms_capable, metadata, created_at, updated_at
    ) VALUES (
      v_phone_id, v_user_id,
      p_event.event_data->>'label',
      (p_event.event_data->>'type')::phone_type,
      p_event.event_data->>'number',
      p_event.event_data->>'extension',
      COALESCE(p_event.event_data->>'country_code', '+1'),
      COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
      COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
      COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
      COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
      p_event.created_at,
      p_event.created_at
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    -- Org-specific override
    INSERT INTO user_org_phone_overrides (
      id, user_id, org_id, label, type, number, extension, country_code,
      is_active, sms_capable, metadata, created_at, updated_at
    ) VALUES (
      v_phone_id, v_user_id, v_org_id,
      p_event.event_data->>'label',
      (p_event.event_data->>'type')::phone_type,
      p_event.event_data->>'number',
      p_event.event_data->>'extension',
      COALESCE(p_event.event_data->>'country_code', '+1'),
      COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
      COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
      COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
      p_event.created_at,
      p_event.created_at
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_phone_added"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_phone_removed"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
  v_phone_id := (p_event.event_data->>'phone_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
    IF v_org_id IS NULL THEN
      DELETE FROM user_phones WHERE id = v_phone_id;
    ELSE
      DELETE FROM user_org_phone_overrides WHERE id = v_phone_id;
    END IF;
  ELSE
    -- Soft delete (deactivate)
    IF v_org_id IS NULL THEN
      UPDATE user_phones SET is_active = false, updated_at = p_event.created_at
      WHERE id = v_phone_id;
    ELSE
      UPDATE user_org_phone_overrides SET is_active = false, updated_at = p_event.created_at
      WHERE id = v_phone_id;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_phone_removed"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_phone_updated"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_phone_id UUID;
  v_org_id UUID;
BEGIN
  v_phone_id := (p_event.event_data->>'phone_id')::UUID;
  v_org_id := (p_event.event_data->>'org_id')::UUID;

  IF v_org_id IS NULL THEN
    -- Global phone update
    UPDATE user_phones SET
      label = COALESCE(p_event.event_data->>'label', label),
      type = COALESCE((p_event.event_data->>'type')::phone_type, type),
      number = COALESCE(p_event.event_data->>'number', number),
      extension = p_event.event_data->>'extension',
      country_code = COALESCE(p_event.event_data->>'country_code', country_code),
      is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
      is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
      sms_capable = COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, sms_capable),
      metadata = COALESCE(p_event.event_data->'metadata', metadata),
      updated_at = p_event.created_at
    WHERE id = v_phone_id;
  ELSE
    -- Org override update
    UPDATE user_org_phone_overrides SET
      label = COALESCE(p_event.event_data->>'label', label),
      type = COALESCE((p_event.event_data->>'type')::phone_type, type),
      number = COALESCE(p_event.event_data->>'number', number),
      extension = p_event.event_data->>'extension',
      country_code = COALESCE(p_event.event_data->>'country_code', country_code),
      is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
      sms_capable = COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, sms_capable),
      metadata = COALESCE(p_event.event_data->'metadata', metadata),
      updated_at = p_event.created_at
    WHERE id = v_phone_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_phone_updated"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_role_assigned"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_platform_org_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
  v_org_id UUID;
  v_scope_path LTREE;
BEGIN
  -- Determine if this is a global scope assignment
  IF p_event.event_data->>'org_id' = '*'
     OR (p_event.event_data->>'org_id')::UUID = v_platform_org_id THEN
    v_org_id := NULL;
    v_scope_path := NULL;
  ELSE
    v_org_id := (p_event.event_data->>'org_id')::UUID;

    IF p_event.event_data->>'scope_path' IS NOT NULL
       AND p_event.event_data->>'scope_path' != '*' THEN
      v_scope_path := (p_event.event_data->>'scope_path')::LTREE;
    ELSE
      SELECT path INTO v_scope_path
      FROM organizations_projection
      WHERE id = v_org_id;
    END IF;

    IF v_org_id IS NOT NULL AND v_scope_path IS NULL THEN
      RAISE WARNING 'Cannot assign role: org_id % has no scope_path', v_org_id;
      RETURN;
    END IF;
  END IF;

  -- Insert role assignment with role-level access dates
  INSERT INTO user_roles_projection (
    user_id, role_id, organization_id, scope_path,
    role_valid_from, role_valid_until, assigned_at
  ) VALUES (
    p_event.stream_id,
    (p_event.event_data->>'role_id')::UUID,
    v_org_id,
    v_scope_path,
    (p_event.event_data->>'role_valid_from')::DATE,
    (p_event.event_data->>'role_valid_until')::DATE,
    p_event.created_at
  )
  ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO UPDATE SET
    role_valid_from = COALESCE(EXCLUDED.role_valid_from, user_roles_projection.role_valid_from),
    role_valid_until = COALESCE(EXCLUDED.role_valid_until, user_roles_projection.role_valid_until);

  -- Update user's roles array
  UPDATE users
  SET
    roles = ARRAY(
      SELECT DISTINCT unnest(roles || ARRAY[p_event.event_data->>'role_name'])
    ),
    updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$$;


ALTER FUNCTION "public"."handle_user_role_assigned"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_role_revoked"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_role_name TEXT;
BEGIN
  -- Look up the role name for updating users.roles array
  SELECT name INTO v_role_name
  FROM roles_projection
  WHERE id = (p_event.event_data->>'role_id')::UUID;

  -- Delete from user_roles_projection
  DELETE FROM user_roles_projection
  WHERE user_id = p_event.stream_id
    AND role_id = (p_event.event_data->>'role_id')::UUID;

  -- Update users.roles array (remove role_name)
  IF v_role_name IS NOT NULL THEN
    UPDATE users
    SET
      roles = array_remove(roles, v_role_name),
      updated_at = p_event.created_at
    WHERE id = p_event.stream_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."handle_user_role_revoked"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_user_role_revoked"("p_event" "record") IS 'Handles user.role.revoked events. Removes role from user_roles_projection
and updates the users.roles denormalized array.';



CREATE OR REPLACE FUNCTION "public"."handle_user_synced_from_auth"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO users (
    id, email, name, is_active, created_at, updated_at
  ) VALUES (
    (p_event.event_data->>'auth_user_id')::UUID,
    p_event.event_data->>'email',
    COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
    COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, users.name),
    is_active = EXCLUDED.is_active,
    updated_at = p_event.created_at;
END;
$$;


ALTER FUNCTION "public"."handle_user_synced_from_auth"("p_event" "record") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_scope" "text" DEFAULT 'organization_unit'::"text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Stub: Cross-tenant access not yet implemented
  -- When implemented, will use ltree containment to check if requested resource
  -- is within the granted organization_unit scope
  RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."has_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid", "p_scope" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid", "p_scope" "text") IS 'Stub: Cross-tenant access grant checking. Returns FALSE until fully implemented with ltree containment logic.';



CREATE OR REPLACE FUNCTION "public"."has_inactive_ou_ancestor"("p_path" "extensions"."ltree") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_has_inactive BOOLEAN;
BEGIN
  -- Check if any ancestor OU (depth > 2) is inactive
  SELECT EXISTS (
    SELECT 1
    FROM organization_units_projection
    WHERE p_path <@ path
      AND path != p_path  -- Exclude self
      AND is_active = false
      AND deleted_at IS NULL
  ) INTO v_has_inactive;

  RETURN v_has_inactive;
END;
$$;


ALTER FUNCTION "public"."has_inactive_ou_ancestor"("p_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_inactive_ou_ancestor"("p_path" "extensions"."ltree") IS 'Checks if any ancestor organization unit is inactive (for role assignment validation)';



CREATE OR REPLACE FUNCTION "public"."has_org_admin_permission"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  -- Check if user has org admin permission via JWT claims
  -- This replaces is_org_admin() which queried the database
  SELECT
    -- Check user_role claim for admin roles
    (current_setting('request.jwt.claims', true)::jsonb->>'user_role')
      IN ('provider_admin', 'partner_admin', 'super_admin')
    -- OR check permissions array for admin-level permissions
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        COALESCE((current_setting('request.jwt.claims', true)::jsonb)->'permissions', '[]'::jsonb)
      ) AS perm
      WHERE perm IN ('user.manage', 'user.role_assign', 'organization.manage')
    );
$$;


ALTER FUNCTION "public"."has_org_admin_permission"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_org_admin_permission"() IS 'JWT-claims-based check for org admin privileges. Replaces is_org_admin() which queried the database.
Returns true if user has provider_admin, partner_admin, or super_admin role, or has admin-level permissions.';



CREATE OR REPLACE FUNCTION "public"."has_permission"("p_permission" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT p_permission = ANY(get_current_permissions());
$$;


ALTER FUNCTION "public"."has_permission"("p_permission" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permission"("p_permission" "text") IS 'Checks if current user has a specific permission in their JWT claims';



CREATE OR REPLACE FUNCTION "public"."has_platform_privilege"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT 'platform.admin' = ANY(
    COALESCE(
      ARRAY(
        SELECT jsonb_array_elements_text(
          COALESCE(
            (current_setting('request.jwt.claims', true)::jsonb)->'permissions',
            '[]'::jsonb
          )
        )
      ),
      ARRAY[]::text[]
    )
  );
$$;


ALTER FUNCTION "public"."has_platform_privilege"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_platform_privilege"() IS 'Checks if current user has platform.admin permission in JWT claims.
This is the canonical pattern for platform owner privileged access.
Does NOT query the database - uses JWT claims only for performance.
Returns false on missing/malformed claims (fail-safe).

Usage:
  IF NOT has_platform_privilege() THEN
    RAISE EXCEPTION ''Access denied: platform.admin permission required'';
  END IF;

To grant access to new roles, add platform.admin permission to that role.
No code changes required.';



CREATE OR REPLACE FUNCTION "public"."is_impersonation_session_active"("p_session_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM impersonation_sessions_projection
    WHERE session_id = p_session_id
      AND status = 'active'
      AND expires_at > NOW()
  );
END;
$$;


ALTER FUNCTION "public"."is_impersonation_session_active"("p_session_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_impersonation_session_active"("p_session_id" "text") IS 'Checks if an impersonation session is currently active and not expired';



CREATE OR REPLACE FUNCTION "public"."is_provider_admin"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'provider_admin'
      AND ur.organization_id = p_org_id
  );
END;
$$;


ALTER FUNCTION "public"."is_provider_admin"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_provider_admin"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Checks if user has provider_admin role for specific organization';



CREATE OR REPLACE FUNCTION "public"."is_role_active"("p_role_valid_from" "date", "p_role_valid_until" "date") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN (p_role_valid_from IS NULL OR p_role_valid_from <= CURRENT_DATE)
       AND (p_role_valid_until IS NULL OR p_role_valid_until >= CURRENT_DATE);
END;
$$;


ALTER FUNCTION "public"."is_role_active"("p_role_valid_from" "date", "p_role_valid_until" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_role_active"("p_role_valid_from" "date", "p_role_valid_until" "date") IS 'Check if a role assignment is currently active based on valid_from and valid_until dates';



CREATE OR REPLACE FUNCTION "public"."is_subdomain_required"("p_type" "text", "p_partner_type" "public"."partner_type") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Subdomain required for providers (always have portal)
  IF p_type = 'provider' THEN
    RETURN TRUE;
  END IF;

  -- Subdomain required for VAR partners (they get portal access)
  IF p_type = 'provider_partner' AND p_partner_type = 'var' THEN
    RETURN TRUE;
  END IF;

  -- Subdomain NOT required for stakeholder partners (family, court, other)
  -- They don't get portal access, just limited dashboard views
  IF p_type = 'provider_partner' AND p_partner_type IN ('family', 'court', 'other') THEN
    RETURN FALSE;
  END IF;

  -- Subdomain NOT required for platform owner (A4C)
  -- Platform owner uses main domain, not tenant subdomain
  IF p_type = 'platform_owner' THEN
    RETURN FALSE;
  END IF;

  -- Default: subdomain not required (conservative approach)
  RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."is_subdomain_required"("p_type" "text", "p_partner_type" "public"."partner_type") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_subdomain_required"("p_type" "text", "p_partner_type" "public"."partner_type") IS 'Determines if subdomain provisioning is required based on organization type and partner type';



CREATE OR REPLACE FUNCTION "public"."is_var_partner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations_projection
    WHERE id = get_current_org_id()
      AND type = 'provider_partner'
      AND partner_type = 'var'
      AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_var_partner"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_var_partner"() IS 'Checks if current user''s organization is an active VAR partner. Uses SECURITY DEFINER to bypass RLS and prevent infinite recursion.';



CREATE OR REPLACE FUNCTION "public"."list_bootstrap_processes"("p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("bootstrap_id" "uuid", "organization_id" "uuid", "organization_name" "text", "organization_type" "text", "admin_email" "text", "status" "text", "created_at" timestamp with time zone, "completed_at" timestamp with time zone, "error_message" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH bootstrap_initiation AS (
    SELECT DISTINCT
      (de.event_data->>'bootstrap_id')::UUID AS bid,
      de.stream_id,
      de.event_data->>'organization_name' AS org_name,
      de.event_data->>'organization_type' AS org_type,
      de.event_data->>'admin_email' AS email,
      de.created_at AS initiated_at
    FROM domain_events de
    WHERE de.event_type IN ('organization.bootstrap.initiated', 'organization.bootstrap.temporal_initiated')
  ),
  bootstrap_status AS (
    SELECT
      (de.event_data->>'bootstrap_id')::UUID AS bid,
      CASE
        WHEN de.event_type = 'organization.bootstrap.completed' THEN 'completed'
        WHEN de.event_type = 'organization.bootstrap.failed' THEN 'failed'
        WHEN de.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
        ELSE 'processing'
      END AS current_status,
      CASE
        WHEN de.event_type = 'organization.bootstrap.completed' THEN de.created_at
        ELSE NULL
      END AS completed_time,
      de.event_data->>'error_message' AS error_msg,
      ROW_NUMBER() OVER (PARTITION BY de.event_data->>'bootstrap_id' ORDER BY de.created_at DESC) AS rn
    FROM domain_events de
    WHERE de.event_type LIKE 'organization.bootstrap.%'
      AND de.event_type NOT IN ('organization.bootstrap.initiated', 'organization.bootstrap.temporal_initiated')
  )
  SELECT
    bi.bid,
    bi.stream_id,
    bi.org_name,
    bi.org_type,
    bi.email,
    COALESCE(bs.current_status, 'processing'),
    bi.initiated_at,
    bs.completed_time,
    bs.error_msg
  FROM bootstrap_initiation bi
  LEFT JOIN bootstrap_status bs ON bi.bid = bs.bid AND bs.rn = 1
  ORDER BY bi.initiated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."list_bootstrap_processes"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_bootstrap_processes"("p_limit" integer, "p_offset" integer) IS 'List all bootstrap processes with their current status (admin dashboard)';



CREATE OR REPLACE FUNCTION "public"."notify_workflow_worker_bootstrap"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  notification_payload jsonb;
BEGIN
  -- Only notify for organization.bootstrap.initiated events
  -- Note: This runs BEFORE the CQRS projection trigger, so processed_at is always NULL
  IF NEW.event_type = 'organization.bootstrap.initiated' THEN

    -- Build notification payload with all necessary data for workflow start
    notification_payload := jsonb_build_object(
      'event_id', NEW.id,
      'event_type', NEW.event_type,
      'stream_id', NEW.stream_id,
      'stream_type', NEW.stream_type,
      'event_data', NEW.event_data,
      'event_metadata', NEW.event_metadata,
      'created_at', NEW.created_at
    );

    -- Send notification to workflow_events channel
    -- Worker subscribes to this channel and receives payload
    PERFORM pg_notify('workflow_events', notification_payload::text);

    -- Log for debugging (visible in Supabase logs)
    RAISE NOTICE 'Notified workflow worker: event_id=%, stream_id=%',
      NEW.id, NEW.stream_id;

  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_workflow_worker_bootstrap"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notify_workflow_worker_bootstrap"() IS 'Sends PostgreSQL NOTIFY message to workflow_events channel when organization.bootstrap.initiated events are inserted.
   Worker listens on this channel and starts Temporal workflows in response.
   Runs BEFORE the CQRS projection trigger to ensure notification always fires.';



CREATE OR REPLACE FUNCTION "public"."process_access_grant_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_grant_id UUID;
BEGIN
  CASE p_event.event_type
    
    -- Handle access grant creation
    WHEN 'access_grant.created' THEN
      -- CQRS-compliant: Insert into projection (only from events)
      INSERT INTO cross_tenant_access_grants_projection (
        id,
        consultant_org_id,
        consultant_user_id,
        provider_org_id,
        scope,
        scope_id,
        authorization_type,
        legal_reference,
        granted_by,
        granted_at,
        expires_at,
        permissions,
        terms,
        status,
        created_at,
        updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        safe_jsonb_extract_uuid(p_event.event_data, 'granted_by'),
        p_event.created_at,
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        COALESCE(p_event.event_data->'permissions', '[]'::jsonb),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    -- Handle access grant revocation  
    WHEN 'access_grant.revoked' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to revoked status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'revoked',
        revoked_at = p_event.created_at,
        revoked_by = safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by'),
        revocation_reason = safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
        revocation_details = safe_jsonb_extract_text(p_event.event_data, 'revocation_details'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant expiration
    WHEN 'access_grant.expired' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to expired status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'expired',
        expired_at = p_event.created_at,
        expiration_type = safe_jsonb_extract_text(p_event.event_data, 'expiration_type'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant suspension
    WHEN 'access_grant.suspended' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to suspended status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'suspended',
        suspended_at = p_event.created_at,
        suspended_by = safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
        suspension_reason = safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
        suspension_details = safe_jsonb_extract_text(p_event.event_data, 'suspension_details'),
        expected_resolution_date = safe_jsonb_extract_timestamp(p_event.event_data, 'expected_resolution_date'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant reactivation
    WHEN 'access_grant.reactivated' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection back to active status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'active',
        suspended_at = NULL,
        suspended_by = NULL,
        suspension_reason = NULL,
        suspension_details = NULL,
        expected_resolution_date = NULL,
        reactivated_at = p_event.created_at,
        reactivated_by = safe_jsonb_extract_uuid(p_event.event_data, 'reactivated_by'),
        resolution_details = safe_jsonb_extract_text(p_event.event_data, 'resolution_details'),
        -- Update expiration if modified during reactivation
        expires_at = COALESCE(
          safe_jsonb_extract_timestamp(p_event.event_data, 'new_expires_at'),
          expires_at
        ),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    ELSE
      RAISE WARNING 'Unknown access grant event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_access_grant_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_access_grant_event"("p_event" "record") IS 'Main access grant event processor - handles cross-tenant grant lifecycle with CQRS compliance';



CREATE OR REPLACE FUNCTION "public"."process_address_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type

    -- Handle address creation
    WHEN 'address.created' THEN
      INSERT INTO addresses_projection (
        id, organization_id, type, label,
        street1, street2, city, state, zip_code, country,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'street1'),
        safe_jsonb_extract_text(p_event.event_data, 'street2'),
        safe_jsonb_extract_text(p_event.event_data, 'city'),
        safe_jsonb_extract_text(p_event.event_data, 'state'),
        safe_jsonb_extract_text(p_event.event_data, 'zip_code'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), 'USA'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle address updates
    WHEN 'address.updated' THEN
      UPDATE addresses_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        street1 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street1'), street1),
        street2 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street2'), street2),
        city = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'city'), city),
        state = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'state'), state),
        zip_code = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'zip_code'), zip_code),
        country = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), country),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle address deletion (soft delete)
    WHEN 'address.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE addresses_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown address event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_address_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_address_event"("p_event" "record") IS 'Main address event processor - handles creation, updates, and soft deletion with CQRS projections';



CREATE OR REPLACE FUNCTION "public"."process_contact_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_contact_id UUID;
  v_user_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle contact creation
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
    WHEN 'contact.created' THEN
      INSERT INTO contacts_projection (
        id, organization_id, type, label,
        first_name, last_name, email, title, department,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'title'),
        safe_jsonb_extract_text(p_event.event_data, 'department'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle contact updates
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
    WHEN 'contact.updated' THEN
      UPDATE contacts_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        email = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'email'), email),
        title = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'title'), title),
        department = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'department'), department),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle contact deletion (soft delete)
    WHEN 'contact.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle contact-user linking (same person is both contact and user)
    -- Event emitted when user accepts invitation or admin manually links
    -- AUTO-MIRROR: Copy contact's SMS-capable phones to user_phones for notifications
    WHEN 'contact.user.linked' THEN
      v_contact_id := safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');
      v_user_id := safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

      -- Update contact with user_id
      UPDATE contacts_projection
      SET
        user_id = v_user_id,
        updated_at = p_event.created_at
      WHERE id = v_contact_id
        AND deleted_at IS NULL;

      -- Auto-mirror SMS-capable phones from contact to user
      -- Mobile phones are assumed SMS-capable by default
      INSERT INTO user_phones (
        id,
        user_id,
        label,
        type,
        number,
        extension,
        country_code,
        is_primary,
        is_active,
        sms_capable,
        metadata,
        source_contact_phone_id,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
        v_user_id,
        p.label,
        p.type,
        p.number,
        p.extension,
        COALESCE(p.country_code, '+1'),  -- Default US country code
        COALESCE(p.is_primary, false),
        true,  -- New mirrored phones are active by default
        true,  -- Mirrored phones assumed SMS capable (we only copy mobile/SMS phones)
        jsonb_build_object('mirrored_at', p_event.created_at, 'source', 'contact_link'),
        p.id,  -- Track source for audit
        p_event.created_at,
        p_event.created_at
      FROM phones_projection p
      JOIN contact_phones cp ON cp.phone_id = p.id
      WHERE cp.contact_id = v_contact_id
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_active, true) = true
        -- Only mirror mobile phones (SMS-capable)
        AND p.type = 'mobile'
      ON CONFLICT DO NOTHING;  -- Idempotent - don't duplicate if re-linked

    -- Handle contact-user unlinking
    -- Event emitted when user deleted or admin manually unlinks
    -- Note: We do NOT delete mirrored phones - they become user-managed
    WHEN 'contact.user.unlinked' THEN
      UPDATE contacts_projection
      SET
        user_id = NULL,
        updated_at = p_event.created_at
      WHERE id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND user_id = safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_contact_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_contact_event"("p_event" "record") IS 'Process contact domain events. Handles contact CRUD, contact-user linking with auto-mirror of SMS-capable phones.';



CREATE OR REPLACE FUNCTION "public"."process_domain_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  -- Skip already-processed events (idempotency)
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      CASE NEW.stream_type
        WHEN 'role' THEN PERFORM process_rbac_event(NEW);
        WHEN 'permission' THEN PERFORM process_rbac_event(NEW);
        WHEN 'client' THEN PERFORM process_client_event(NEW);
        WHEN 'medication' THEN PERFORM process_medication_event(NEW);
        WHEN 'medication_history' THEN PERFORM process_medication_history_event(NEW);
        WHEN 'dosage' THEN PERFORM process_dosage_event(NEW);
        WHEN 'user' THEN PERFORM process_user_event(NEW);
        WHEN 'organization' THEN PERFORM process_organization_event(NEW);
        WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
        WHEN 'contact' THEN PERFORM process_contact_event(NEW);
        WHEN 'address' THEN PERFORM process_address_event(NEW);
        WHEN 'phone' THEN PERFORM process_phone_event(NEW);
        WHEN 'email' THEN PERFORM process_email_event(NEW);  -- Added email routing
        WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);
        WHEN 'access_grant' THEN PERFORM process_access_grant_event(NEW);
        WHEN 'impersonation' THEN PERFORM process_impersonation_event(NEW);
        ELSE
          RAISE WARNING 'Unknown stream_type: %', NEW.stream_type;
      END CASE;
    END IF;

    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
      RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
      NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."process_domain_event"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_domain_event"() IS 'Main router that processes domain events and projects them to 3NF tables';



CREATE OR REPLACE FUNCTION "public"."process_email_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type

    -- Handle email creation
    WHEN 'email.created' THEN
      INSERT INTO emails_projection (
        id, organization_id, type, label,
        address, is_primary,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::email_type
          ELSE 'work'::email_type
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'address'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle email updates
    WHEN 'email.updated' THEN
      UPDATE emails_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::email_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        address = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'address'), address),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle email deletion (soft delete)
    WHEN 'email.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE emails_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown email event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_email_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_email_event"("p_event" "record") IS 'Main email event processor - handles creation, updates, and soft deletion with CQRS projections';



CREATE OR REPLACE FUNCTION "public"."process_impersonation_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_session_id TEXT;
  v_super_admin_user_id UUID;
  v_target_user_id UUID;
  v_previous_expires_at TIMESTAMPTZ;
  v_total_duration INTEGER;
BEGIN
  -- Extract common fields
  v_session_id := p_event.event_data->>'session_id';

  CASE p_event.event_type
    -- ========================================
    -- Impersonation Started
    -- ========================================
    WHEN 'impersonation.started' THEN
      INSERT INTO impersonation_sessions_projection (
        session_id,
        super_admin_user_id,
        super_admin_email,
        super_admin_name,
        super_admin_org_id,
        target_user_id,
        target_email,
        target_name,
        target_org_id,
        target_org_name,
        target_org_type,
        justification_reason,
        justification_reference_id,
        justification_notes,
        status,
        started_at,
        expires_at,
        duration_ms,
        total_duration_ms,
        renewal_count,
        actions_performed,
        ip_address,
        user_agent,
        created_at,
        updated_at
      ) VALUES (
        v_session_id,
        -- Super Admin
        (p_event.event_data->'super_admin'->>'user_id')::UUID,
        p_event.event_data->'super_admin'->>'email',
        p_event.event_data->'super_admin'->>'name',
        -- Super admin org_id: NULL for platform super_admin, UUID for org-scoped admin
        CASE
          WHEN p_event.event_data->'super_admin'->>'org_id' IS NULL THEN NULL
          WHEN p_event.event_data->'super_admin'->>'org_id' = '*' THEN NULL
          ELSE (p_event.event_data->'super_admin'->>'org_id')::UUID
        END,
        -- Target
        (p_event.event_data->'target'->>'user_id')::UUID,
        p_event.event_data->'target'->>'email',
        p_event.event_data->'target'->>'name',
        -- Target org_id (UUID format from Supabase Auth)
        (p_event.event_data->'target'->>'org_id')::UUID,
        p_event.event_data->'target'->>'org_name',
        p_event.event_data->'target'->>'org_type',
        -- Justification
        p_event.event_data->'justification'->>'reason',
        p_event.event_data->'justification'->>'reference_id',
        p_event.event_data->'justification'->>'notes',
        -- Session
        'active',
        NOW(),
        (p_event.event_data->'session_config'->>'expires_at')::TIMESTAMPTZ,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,  -- total = initial on start
        0,  -- renewal_count
        0,  -- actions_performed (tracked on end)
        -- Metadata
        p_event.event_data->>'ip_address',
        p_event.event_data->>'user_agent',
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (session_id) DO NOTHING;  -- Idempotent

    -- ========================================
    -- Impersonation Renewed
    -- ========================================
    WHEN 'impersonation.renewed' THEN
      -- Get previous expiration and calculate new total duration
      SELECT
        expires_at,
        total_duration_ms + (
          (p_event.event_data->>'new_expires_at')::TIMESTAMPTZ -
          (p_event.event_data->>'previous_expires_at')::TIMESTAMPTZ
        ) / 1000
      INTO v_previous_expires_at, v_total_duration
      FROM impersonation_sessions_projection
      WHERE session_id = v_session_id;

      UPDATE impersonation_sessions_projection
      SET
        expires_at = (p_event.event_data->>'new_expires_at')::TIMESTAMPTZ,
        total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
        renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
        updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation renewal event for non-existent session: %', v_session_id;
      END IF;

    -- ========================================
    -- Impersonation Ended
    -- ========================================
    WHEN 'impersonation.ended' THEN
      UPDATE impersonation_sessions_projection
      SET
        status = CASE
          WHEN p_event.event_data->>'reason' = 'timeout' THEN 'expired'
          ELSE 'ended'
        END,
        ended_at = (p_event.event_data->'summary'->>'ended_at')::TIMESTAMPTZ,
        ended_reason = p_event.event_data->>'reason',
        ended_by_user_id = (p_event.event_data->>'ended_by')::UUID,
        total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
        renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
        actions_performed = (p_event.event_data->>'actions_performed')::INTEGER,
        updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation end event for non-existent session: %', v_session_id;
      END IF;

    ELSE
      RAISE WARNING 'Unknown impersonation event type: %', p_event.event_type;
  END CASE;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error processing impersonation event %: % (Event ID: %)',
      p_event.event_type,
      SQLERRM,
      p_event.id;
    RAISE;
END;
$$;


ALTER FUNCTION "public"."process_impersonation_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_impersonation_event"("p_event" "record") IS 'Projects impersonation domain events (impersonation.started, impersonation.renewed, impersonation.ended) to impersonation_sessions_projection table';



CREATE OR REPLACE FUNCTION "public"."process_invitation_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_event_data JSONB;
  v_invitation_id UUID;
  v_org_id UUID;
  v_email TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_role TEXT;
  v_roles JSONB;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_user_id UUID;
  v_accepted_at TIMESTAMPTZ;
  v_expired_at TIMESTAMPTZ;
  v_reason TEXT;
BEGIN
  v_event_data := NEW.event_data;

  -- Handle user.invited event
  IF NEW.event_type = 'user.invited' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_org_id := (v_event_data->>'org_id')::UUID;
    v_email := v_event_data->>'email';
    v_first_name := v_event_data->>'first_name';
    v_last_name := v_event_data->>'last_name';
    v_token := v_event_data->>'token';
    v_expires_at := (v_event_data->>'expires_at')::TIMESTAMPTZ;

    -- Handle both legacy role (string) and new roles (array) format
    IF v_event_data ? 'roles' AND jsonb_typeof(v_event_data->'roles') = 'array' THEN
      -- New format: roles array
      v_roles := v_event_data->'roles';
      -- Extract first role name for legacy column compatibility
      v_role := v_roles->0->>'role_name';
    ELSE
      -- Legacy format: single role string
      v_role := v_event_data->>'role';
      v_roles := jsonb_build_array(
        jsonb_build_object('role_id', NULL, 'role_name', v_role)
      );
    END IF;

    -- Upsert into invitations_projection
    INSERT INTO invitations_projection (
      invitation_id, organization_id, email, first_name, last_name,
      role, roles, token, expires_at, status, created_at, updated_at
    ) VALUES (
      v_invitation_id, v_org_id, v_email, v_first_name, v_last_name,
      v_role, v_roles, v_token, v_expires_at, 'pending', NOW(), NOW()
    )
    ON CONFLICT (invitation_id) DO UPDATE SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      role = EXCLUDED.role,
      roles = EXCLUDED.roles,
      token = EXCLUDED.token,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW();

  -- Handle invitation.accepted event
  ELSIF NEW.event_type = 'invitation.accepted' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_user_id := (v_event_data->>'user_id')::UUID;
    v_accepted_at := (v_event_data->>'accepted_at')::TIMESTAMPTZ;

    -- Handle both legacy and new roles format for accepted event
    IF v_event_data ? 'roles' AND jsonb_typeof(v_event_data->'roles') = 'array' THEN
      v_roles := v_event_data->'roles';
      v_role := v_roles->0->>'role_name';
    ELSE
      v_role := v_event_data->>'role';
      v_roles := jsonb_build_array(
        jsonb_build_object('role_id', NULL, 'role_name', v_role)
      );
    END IF;

    UPDATE invitations_projection
    SET status = 'accepted',
        role = COALESCE(v_role, role),
        roles = CASE WHEN v_roles IS NOT NULL THEN v_roles ELSE roles END,
        accepted_at = v_accepted_at,
        updated_at = NOW()
    WHERE invitation_id = v_invitation_id;

  -- Handle invitation.expired event
  ELSIF NEW.event_type = 'invitation.expired' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_expired_at := (v_event_data->>'expired_at')::TIMESTAMPTZ;

    UPDATE invitations_projection
    SET status = 'expired',
        updated_at = NOW()
    WHERE invitation_id = v_invitation_id
      AND status = 'pending';

  -- Handle invitation.revoked event
  ELSIF NEW.event_type = 'invitation.revoked' THEN
    v_invitation_id := (v_event_data->>'invitation_id')::UUID;
    v_reason := v_event_data->>'reason';

    UPDATE invitations_projection
    SET status = 'revoked',
        updated_at = NOW()
    WHERE invitation_id = v_invitation_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."process_invitation_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_invitation_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_org_id UUID;
  v_invitation_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle user invitation
    WHEN 'user.invited' THEN
      v_org_id := (p_event.event_data->>'org_id')::UUID;
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      INSERT INTO invitations_projection (
        id,
        invitation_id,
        organization_id,
        email,
        first_name,
        last_name,
        roles,
        token,
        expires_at,
        access_start_date,
        access_expiration_date,
        notification_preferences,
        status,
        created_at,
        updated_at
      ) VALUES (
        v_invitation_id,
        v_invitation_id,
        v_org_id,
        p_event.event_data->>'email',
        p_event.event_data->>'first_name',
        p_event.event_data->>'last_name',
        p_event.event_data->'roles',
        p_event.event_data->>'token',
        (p_event.event_data->>'expires_at')::TIMESTAMPTZ,
        (p_event.event_data->>'access_start_date')::DATE,
        (p_event.event_data->>'access_expiration_date')::DATE,
        COALESCE(
          p_event.event_data->'notification_preferences',
          '{"email": true, "sms": {"enabled": false, "phone_id": null}, "in_app": false}'::jsonb
        ),
        'pending',
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        roles = EXCLUDED.roles,
        token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at,
        access_start_date = EXCLUDED.access_start_date,
        access_expiration_date = EXCLUDED.access_expiration_date,
        notification_preferences = EXCLUDED.notification_preferences,
        updated_at = p_event.created_at;

    -- Handle invitation accepted
    -- FIXED: Removed accepted_user_id column which doesn't exist
    WHEN 'invitation.accepted' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'accepted',
        accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation revoked
    WHEN 'invitation.revoked' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'revoked',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    -- Handle invitation expired
    WHEN 'invitation.expired' THEN
      v_invitation_id := (p_event.event_data->>'invitation_id')::UUID;

      UPDATE invitations_projection
      SET
        status = 'expired',
        updated_at = p_event.created_at
      WHERE id = v_invitation_id;

    ELSE
      RAISE WARNING 'Unknown invitation event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_invitation_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_invitation_event"("p_event" "record") IS 'Invitation event processor v3 - Fixed to not reference non-existent accepted_user_id column.';



CREATE OR REPLACE FUNCTION "public"."process_junction_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type

    -- Organization-Contact Links
    WHEN 'organization.contact.linked' THEN
      INSERT INTO organization_contacts (organization_id, contact_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
      )
      ON CONFLICT (organization_id, contact_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.contact.unlinked' THEN
      DELETE FROM organization_contacts
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');

    -- Organization-Address Links
    WHEN 'organization.address.linked' THEN
      INSERT INTO organization_addresses (organization_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (organization_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.address.unlinked' THEN
      DELETE FROM organization_addresses
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Organization-Phone Links
    WHEN 'organization.phone.linked' THEN
      INSERT INTO organization_phones (organization_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (organization_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.phone.unlinked' THEN
      DELETE FROM organization_phones
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Organization-Email Links (NEW)
    WHEN 'organization.email.linked' THEN
      INSERT INTO organization_emails (organization_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      )
      ON CONFLICT (organization_id, email_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.email.unlinked' THEN
      DELETE FROM organization_emails
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    -- Contact-Phone Links
    WHEN 'contact.phone.linked' THEN
      INSERT INTO contact_phones (contact_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (contact_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.phone.unlinked' THEN
      DELETE FROM contact_phones
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Contact-Address Links
    WHEN 'contact.address.linked' THEN
      INSERT INTO contact_addresses (contact_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (contact_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.address.unlinked' THEN
      DELETE FROM contact_addresses
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Contact-Email Links (NEW)
    WHEN 'contact.email.linked' THEN
      INSERT INTO contact_emails (contact_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      )
      ON CONFLICT (contact_id, email_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.email.unlinked' THEN
      DELETE FROM contact_emails
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    -- Phone-Address Links
    WHEN 'phone.address.linked' THEN
      INSERT INTO phone_addresses (phone_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (phone_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'phone.address.unlinked' THEN
      DELETE FROM phone_addresses
      WHERE phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    ELSE
      RAISE WARNING 'Unknown junction event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_junction_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_junction_event"("p_event" "record") IS 'Main junction event processor - handles link/unlink for all 8 junction table types (org-contact, org-address, org-phone, org-email, contact-phone, contact-address, contact-email, phone-address)';



CREATE OR REPLACE FUNCTION "public"."process_organization_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type
    -- Organization lifecycle
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);

    -- Subdomain lifecycle (NEW - fixes redirect bug)
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);

    -- Bootstrap
    WHEN 'bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);

    -- Invitations
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_organization_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_organization_event"("p_event" "record") IS 'Organization event router v2 - dispatches to individual handler functions.
Handlers: handle_organization_created/updated/deactivated/reactivated/deleted,
handle_organization_subdomain_status_changed, handle_bootstrap_completed/failed/cancelled,
handle_user_invited, handle_invitation_resent';



CREATE OR REPLACE FUNCTION "public"."process_organization_unit_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'organization_unit.created' THEN PERFORM handle_organization_unit_created(p_event);
    WHEN 'organization_unit.updated' THEN PERFORM handle_organization_unit_updated(p_event);
    WHEN 'organization_unit.deactivated' THEN PERFORM handle_organization_unit_deactivated(p_event);
    WHEN 'organization_unit.reactivated' THEN PERFORM handle_organization_unit_reactivated(p_event);
    WHEN 'organization_unit.deleted' THEN PERFORM handle_organization_unit_deleted(p_event);

    ELSE
      RAISE WARNING 'Unknown organization_unit event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_organization_unit_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_organization_unit_event"("p_event" "record") IS 'Organization unit event router v2 - dispatches to individual handler functions.
Handlers: handle_organization_unit_created/updated/deactivated/reactivated/deleted';



CREATE OR REPLACE FUNCTION "public"."process_phone_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type

    -- Handle phone creation
    WHEN 'phone.created' THEN
      INSERT INTO phones_projection (
        id, organization_id, type, label,
        number, extension, is_primary,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'number'),
        safe_jsonb_extract_text(p_event.event_data, 'extension'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle phone updates
    WHEN 'phone.updated' THEN
      UPDATE phones_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'number'), number),
        extension = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'extension'), extension),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle phone deletion (soft delete)
    WHEN 'phone.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE phones_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown phone event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_phone_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_phone_event"("p_event" "record") IS 'Main phone event processor - handles creation, updates, and soft deletion with CQRS projections';



CREATE OR REPLACE FUNCTION "public"."process_program_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type

    -- Handle program creation
    WHEN 'program.created' THEN
      INSERT INTO programs_projection (
        id, organization_id, name, type, description, capacity, current_occupancy,
        is_active, activated_at, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        (p_event.event_data->>'capacity')::INTEGER,
        COALESCE((p_event.event_data->>'current_occupancy')::INTEGER, 0),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        CASE
          WHEN safe_jsonb_extract_boolean(p_event.event_data, 'is_active') THEN p_event.created_at
          ELSE NULL
        END,
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle program updates
    WHEN 'program.updated' THEN
      UPDATE programs_projection
      SET
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
        description = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'description'), description),
        capacity = COALESCE((p_event.event_data->>'capacity')::INTEGER, capacity),
        current_occupancy = COALESCE((p_event.event_data->>'current_occupancy')::INTEGER, current_occupancy),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program activation
    WHEN 'program.activated' THEN
      UPDATE programs_projection
      SET
        is_active = true,
        activated_at = p_event.created_at,
        deactivated_at = NULL,
        deactivation_reason = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program deactivation
    WHEN 'program.deactivated' THEN
      UPDATE programs_projection
      SET
        is_active = false,
        deactivated_at = p_event.created_at,
        deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'reason'),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program deletion (logical)
    WHEN 'program.deleted' THEN
      UPDATE programs_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown program event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_program_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_program_event"("p_event" "record") IS 'Process program.* events and update programs_projection table';



CREATE OR REPLACE FUNCTION "public"."process_rbac_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type
    -- Role lifecycle
    WHEN 'role.created' THEN PERFORM handle_role_created(p_event);
    WHEN 'role.updated' THEN PERFORM handle_role_updated(p_event);
    WHEN 'role.deactivated' THEN PERFORM handle_role_deactivated(p_event);
    WHEN 'role.reactivated' THEN PERFORM handle_role_reactivated(p_event);
    WHEN 'role.deleted' THEN PERFORM handle_role_deleted(p_event);

    -- Role permissions
    WHEN 'role.permission.granted' THEN PERFORM handle_role_permission_granted(p_event);
    WHEN 'role.permission.revoked' THEN PERFORM handle_role_permission_revoked(p_event);

    -- Permission definition
    WHEN 'permission.defined' THEN PERFORM handle_permission_defined(p_event);

    -- User role assignment
    WHEN 'user.role.assigned' THEN PERFORM handle_rbac_user_role_assigned(p_event);
    WHEN 'user.role.revoked' THEN PERFORM handle_user_role_revoked(p_event);

    ELSE
      RAISE WARNING 'Unknown RBAC event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_rbac_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_rbac_event"("p_event" "record") IS 'RBAC event router v2 - dispatches to individual handler functions.
Handlers: handle_role_created/updated/deactivated/reactivated/deleted,
handle_role_permission_granted/revoked, handle_permission_defined,
handle_rbac_user_role_assigned, handle_user_role_revoked';



CREATE TABLE IF NOT EXISTS "public"."domain_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sequence_number" bigint NOT NULL,
    "stream_id" "uuid" NOT NULL,
    "stream_type" "text" NOT NULL,
    "stream_version" integer NOT NULL,
    "event_type" "text" NOT NULL,
    "event_data" "jsonb" NOT NULL,
    "event_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "processing_error" "text",
    "retry_count" integer DEFAULT 0,
    "correlation_id" "uuid",
    "session_id" "uuid",
    "trace_id" "text",
    "span_id" "text",
    "parent_span_id" "text",
    "dismissed_at" timestamp with time zone,
    "dismissed_by" "uuid",
    "dismiss_reason" "text",
    CONSTRAINT "event_data_not_empty" CHECK (("jsonb_typeof"("event_data") = 'object'::"text")),
    CONSTRAINT "valid_event_type" CHECK (("event_type" ~ '^[a-z_]+(\.[a-z_]+)+$'::"text"))
);


ALTER TABLE "public"."domain_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."domain_events" IS 'Event store - single source of truth for all state changes and audit trail';



COMMENT ON COLUMN "public"."domain_events"."stream_id" IS 'The aggregate/entity ID this event belongs to';



COMMENT ON COLUMN "public"."domain_events"."stream_type" IS 'The type of entity (client, medication, etc.)';



COMMENT ON COLUMN "public"."domain_events"."stream_version" IS 'Version number for this specific entity stream';



COMMENT ON COLUMN "public"."domain_events"."event_type" IS 'Event type in format: domain.action (e.g., client.admitted) or domain.subdomain.action (e.g., organization.bootstrap.initiated)';



COMMENT ON COLUMN "public"."domain_events"."event_data" IS 'The actual event payload with all data needed to project';



COMMENT ON COLUMN "public"."domain_events"."event_metadata" IS 'Context including user, reason, approvals - the WHY';



COMMENT ON COLUMN "public"."domain_events"."correlation_id" IS 'Business-level request correlation ID (UUID v4)';



COMMENT ON COLUMN "public"."domain_events"."session_id" IS 'User auth session ID from Supabase JWT';



COMMENT ON COLUMN "public"."domain_events"."trace_id" IS 'W3C Trace Context trace ID (32 hex chars)';



COMMENT ON COLUMN "public"."domain_events"."span_id" IS 'W3C Trace Context span ID (16 hex chars)';



COMMENT ON COLUMN "public"."domain_events"."parent_span_id" IS 'Parent span ID for causation chain tracking';



COMMENT ON COLUMN "public"."domain_events"."dismissed_at" IS 'Timestamp when event was dismissed by platform admin';



COMMENT ON COLUMN "public"."domain_events"."dismissed_by" IS 'User ID of platform admin who dismissed the event';



COMMENT ON COLUMN "public"."domain_events"."dismiss_reason" IS 'Optional reason for dismissing the event';



CREATE OR REPLACE FUNCTION "public"."process_rbac_events"("p_event" "public"."domain_events") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_permission_ids UUID[];
  v_permission_id UUID;
  v_existing_permissions UUID[];
  v_permissions_to_add UUID[];
  v_permissions_to_remove UUID[];
  v_display_name TEXT;
  v_applet TEXT;
  v_action TEXT;
BEGIN
  CASE p_event.event_type
    -- Permission Events
    WHEN 'permission.defined' THEN
      v_applet := p_event.event_data->>'applet';
      v_action := p_event.event_data->>'action';
      -- Use display_name from event if provided, otherwise generate from applet.action
      v_display_name := COALESCE(
        p_event.event_data->>'display_name',
        INITCAP(REPLACE(v_action, '_', ' ')) || ' ' || INITCAP(REPLACE(v_applet, '_', ' '))
      );

      INSERT INTO permissions_projection (
        id, applet, action, display_name, description, scope_type, requires_mfa, created_at
      ) VALUES (
        p_event.stream_id,
        v_applet,
        v_action,
        v_display_name,
        p_event.event_data->>'description',
        p_event.event_data->>'scope_type',
        COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, false),
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        scope_type = EXCLUDED.scope_type,
        requires_mfa = EXCLUDED.requires_mfa;

    -- Role Events
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (
        id, name, description, organization_id, org_hierarchy_scope, created_at, is_active
      ) VALUES (
        p_event.stream_id,
        p_event.event_data->>'name',
        p_event.event_data->>'description',
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
        p_event.created_at,
        TRUE
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now();

    WHEN 'role.updated' THEN
      UPDATE roles_projection
      SET
        name = COALESCE(p_event.event_data->>'name', name),
        description = COALESCE(p_event.event_data->>'description', description),
        updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.deactivated' THEN
      UPDATE roles_projection
      SET is_active = FALSE, updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.reactivated' THEN
      UPDATE roles_projection
      SET is_active = TRUE, updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.deleted' THEN
      UPDATE roles_projection
      SET deleted_at = now(), is_active = FALSE, updated_at = now()
      WHERE id = p_event.stream_id;

    WHEN 'role.permission.granted' THEN
      INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
      VALUES (
        p_event.stream_id,
        (p_event.event_data->>'permission_id')::UUID,
        p_event.created_at
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING;

    WHEN 'role.permission.revoked' THEN
      DELETE FROM role_permissions_projection
      WHERE role_id = p_event.stream_id
        AND permission_id = (p_event.event_data->>'permission_id')::UUID;

    WHEN 'role.permissions.sync' THEN
      -- Batch sync: add all new permissions, remove all old ones
      v_permission_ids := ARRAY(
        SELECT jsonb_array_elements_text(p_event.event_data->'permission_ids')::UUID
      );

      -- Get existing permissions for this role
      SELECT ARRAY_AGG(permission_id) INTO v_existing_permissions
      FROM role_permissions_projection
      WHERE role_id = p_event.stream_id;

      v_existing_permissions := COALESCE(v_existing_permissions, ARRAY[]::UUID[]);

      -- Calculate diff
      v_permissions_to_add := ARRAY(
        SELECT unnest(v_permission_ids) EXCEPT SELECT unnest(v_existing_permissions)
      );
      v_permissions_to_remove := ARRAY(
        SELECT unnest(v_existing_permissions) EXCEPT SELECT unnest(v_permission_ids)
      );

      -- Remove old permissions
      IF array_length(v_permissions_to_remove, 1) > 0 THEN
        DELETE FROM role_permissions_projection
        WHERE role_id = p_event.stream_id
          AND permission_id = ANY(v_permissions_to_remove);
      END IF;

      -- Add new permissions
      IF array_length(v_permissions_to_add, 1) > 0 THEN
        INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
        SELECT p_event.stream_id, unnest(v_permissions_to_add), p_event.created_at
        ON CONFLICT (role_id, permission_id) DO NOTHING;
      END IF;

    -- User Role Events
    WHEN 'user.role.assigned' THEN
      INSERT INTO user_roles_projection (user_id, role_id, organization_id, scope_path, assigned_at)
      VALUES (
        p_event.stream_id,
        (p_event.event_data->>'role_id')::UUID,
        CASE
          WHEN p_event.event_data->>'org_id' = '*' THEN NULL
          WHEN p_event.event_data->>'org_id' IS NOT NULL
          THEN (p_event.event_data->>'org_id')::UUID
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
      ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO NOTHING;

    WHEN 'user.role.revoked' THEN
      DELETE FROM user_roles_projection
      WHERE user_id = p_event.stream_id
        AND role_id = (p_event.event_data->>'role_id')::UUID
        AND (
          (organization_id IS NULL AND p_event.event_data->>'org_id' = '*')
          OR organization_id = (p_event.event_data->>'org_id')::UUID
        );

    ELSE
      -- Unknown event type - log but don't fail
      RAISE NOTICE 'process_rbac_events: Unknown event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_rbac_events"("p_event" "public"."domain_events") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_rbac_events"("p_event" "public"."domain_events") IS 'Process RBAC domain events (permissions, roles, user assignments). Updates projections. Supports display_name for permissions.';



CREATE OR REPLACE FUNCTION "public"."process_user_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_event_data JSONB;
  v_user_id UUID;
  v_email TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_name TEXT;
  v_organization_id UUID;
  v_is_active BOOLEAN;
BEGIN
  v_event_data := NEW.event_data;

  -- Handle user.created event
  IF NEW.event_type = 'user.created' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;
    v_email := v_event_data->>'email';
    v_first_name := v_event_data->>'first_name';
    v_last_name := v_event_data->>'last_name';
    v_organization_id := (v_event_data->>'organization_id')::UUID;

    -- Build display name from first/last if not provided
    v_name := COALESCE(
      v_event_data->>'name',
      TRIM(COALESCE(v_first_name, '') || ' ' || COALESCE(v_last_name, ''))
    );
    IF v_name = '' THEN v_name := NULL; END IF;

    -- Upsert into users table
    INSERT INTO users (
      id, email, name, first_name, last_name,
      current_organization_id, is_active, created_at, updated_at
    ) VALUES (
      v_user_id, v_email, v_name, v_first_name, v_last_name,
      v_organization_id, TRUE, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, users.name),
      first_name = COALESCE(EXCLUDED.first_name, users.first_name),
      last_name = COALESCE(EXCLUDED.last_name, users.last_name),
      current_organization_id = COALESCE(EXCLUDED.current_organization_id, users.current_organization_id),
      updated_at = NOW();

  -- Handle user.synced_from_auth event
  ELSIF NEW.event_type = 'user.synced_from_auth' THEN
    v_user_id := (v_event_data->>'auth_user_id')::UUID;
    v_email := v_event_data->>'email';
    v_name := v_event_data->>'name';
    v_is_active := COALESCE((v_event_data->>'is_active')::BOOLEAN, TRUE);

    -- Upsert into users table
    INSERT INTO users (id, email, name, is_active, created_at, updated_at)
    VALUES (v_user_id, v_email, v_name, v_is_active, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, users.name),
      is_active = EXCLUDED.is_active,
      updated_at = NOW();

  -- Handle user.deactivated event
  ELSIF NEW.event_type = 'user.deactivated' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;

    UPDATE users
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = v_user_id;

  -- Handle user.reactivated event
  ELSIF NEW.event_type = 'user.reactivated' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;

    UPDATE users
    SET is_active = TRUE, updated_at = NOW()
    WHERE id = v_user_id;

  -- Handle user.organization_switched event
  ELSIF NEW.event_type = 'user.organization_switched' THEN
    v_user_id := (v_event_data->>'user_id')::UUID;
    v_organization_id := (v_event_data->>'to_organization_id')::UUID;

    UPDATE users
    SET current_organization_id = v_organization_id, updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."process_user_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_user_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type
    -- User lifecycle
    WHEN 'user.created' THEN PERFORM handle_user_created(p_event);
    WHEN 'user.synced_from_auth' THEN PERFORM handle_user_synced_from_auth(p_event);
    WHEN 'user.role.assigned' THEN PERFORM handle_user_role_assigned(p_event);
    WHEN 'user.role.revoked' THEN PERFORM handle_user_role_revoked(p_event);

    -- Access dates
    WHEN 'user.access_dates.updated' THEN PERFORM handle_user_access_dates_updated(p_event);

    -- Notification preferences
    WHEN 'user.notification_preferences.updated' THEN PERFORM handle_user_notification_preferences_updated(p_event);

    -- Addresses
    WHEN 'user.address.added' THEN PERFORM handle_user_address_added(p_event);
    WHEN 'user.address.updated' THEN PERFORM handle_user_address_updated(p_event);
    WHEN 'user.address.removed' THEN PERFORM handle_user_address_removed(p_event);

    -- Phones
    WHEN 'user.phone.added' THEN PERFORM handle_user_phone_added(p_event);
    WHEN 'user.phone.updated' THEN PERFORM handle_user_phone_updated(p_event);
    WHEN 'user.phone.removed' THEN PERFORM handle_user_phone_removed(p_event);

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_user_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_user_event"("p_event" "record") IS 'User event router v5 - dispatches to individual handler functions.
Handlers: handle_user_created, handle_user_synced_from_auth,
handle_user_role_assigned, handle_user_role_revoked,
handle_user_access_dates_updated, handle_user_notification_preferences_updated,
handle_user_address_added/updated/removed, handle_user_phone_added/updated/removed';



CREATE OR REPLACE FUNCTION "public"."retry_failed_bootstrap"("p_bootstrap_id" "uuid", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_failed_event RECORD;
  v_new_bootstrap_id UUID;
  v_organization_id UUID;
BEGIN
  -- Find the failed bootstrap event
  SELECT * INTO v_failed_event
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bootstrap failure event not found for bootstrap_id: %', p_bootstrap_id;
  END IF;

  -- Generate new IDs for retry
  v_new_bootstrap_id := gen_random_uuid();
  v_organization_id := gen_random_uuid();

  -- NOTE: Actual retry orchestration is handled by Temporal
  -- This function just emits an event that Temporal can listen for
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
  ) VALUES (
    v_organization_id,
    'organization',
    1,
    'organization.bootstrap.retry_requested',
    jsonb_build_object(
      'bootstrap_id', v_new_bootstrap_id,
      'retry_of', p_bootstrap_id,
      'organization_name', v_failed_event.event_data->>'organization_name',
      'organization_type', v_failed_event.event_data->>'organization_type',
      'admin_email', v_failed_event.event_data->>'admin_email'
    ),
    jsonb_build_object(
      'user_id', p_user_id,
      'organization_id', v_organization_id::TEXT,
      'reason', format('Manual retry of failed bootstrap %s', p_bootstrap_id),
      'original_bootstrap_id', p_bootstrap_id
    ),
    NOW()
  );

  RETURN v_new_bootstrap_id;
END;
$$;


ALTER FUNCTION "public"."retry_failed_bootstrap"("p_bootstrap_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."retry_failed_bootstrap"("p_bootstrap_id" "uuid", "p_user_id" "uuid") IS 'Emit retry request event for Temporal to pick up and orchestrate';



CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_boolean"("p_data" "jsonb", "p_key" "text", "p_default" boolean DEFAULT false) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE((p_data->>p_key)::BOOLEAN, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_boolean"("p_data" "jsonb", "p_key" "text", "p_default" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_date"("p_data" "jsonb", "p_key" "text", "p_default" "date" DEFAULT NULL::"date") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE((p_data->>p_key)::DATE, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_date"("p_data" "jsonb", "p_key" "text", "p_default" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_organization_id"("p_data" "jsonb", "p_key" "text" DEFAULT 'organization_id'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_value TEXT;
  v_uuid UUID;
BEGIN
  v_value := p_data->>p_key;

  -- Handle NULL or empty
  IF v_value IS NULL OR v_value = '' THEN
    RETURN NULL;
  END IF;

  -- Cast as UUID (all organization IDs are now UUIDs with Supabase Auth)
  BEGIN
    v_uuid := v_value::UUID;
    RETURN v_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE WARNING 'Invalid UUID format for organization_id: %', v_value;
    RETURN NULL;
  END;
END;
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_organization_id"("p_data" "jsonb", "p_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."safe_jsonb_extract_organization_id"("p_data" "jsonb", "p_key" "text") IS 'Extract organization_id from event data as UUID (Supabase Auth migration completed Oct 2025)';



CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_text"("p_data" "jsonb", "p_key" "text", "p_default" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE(p_data->>p_key, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_text"("p_data" "jsonb", "p_key" "text", "p_default" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_timestamp"("p_data" "jsonb", "p_key" "text", "p_default" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE((p_data->>p_key)::TIMESTAMPTZ, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_timestamp"("p_data" "jsonb", "p_key" "text", "p_default" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_uuid"("p_data" "jsonb", "p_key" "text", "p_default" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT COALESCE((p_data->>p_key)::UUID, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_uuid"("p_data" "jsonb", "p_key" "text", "p_default" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_has_access boolean;
  v_result jsonb;
BEGIN
  -- Get current authenticated user from Supabase Auth
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user has access to the requested organization
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_projection ur
    WHERE ur.user_id = v_user_id
      AND (ur.organization_id = p_new_org_id OR ur.organization_id IS NULL)  -- NULL for super_admin
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'User does not have access to organization %', p_new_org_id;
  END IF;

  -- Update user's current organization
  UPDATE public.users
  SET current_organization_id = p_new_org_id,
      updated_at = NOW()
  WHERE id = v_user_id;

  -- Return new organization context (client should refresh JWT)
  RETURN jsonb_build_object(
    'success', true,
    'org_id', p_new_org_id,
    'message', 'Organization context updated. Please refresh your session to get updated JWT claims.'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to switch organization: %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") IS 'Updates user current organization context. Client must refresh JWT to get new claims.';



CREATE OR REPLACE FUNCTION "public"."sync_accessible_organizations"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_user_id uuid;
BEGIN
    -- Determine which user_id to update
    target_user_id := COALESCE(NEW.user_id, OLD.user_id);

    -- Update the accessible_organizations array from user_organizations_projection
    UPDATE public.users
    SET
        accessible_organizations = (
            SELECT COALESCE(array_agg(uop.org_id ORDER BY uop.created_at), ARRAY[]::uuid[])
            FROM public.user_organizations_projection uop
            WHERE uop.user_id = target_user_id
        ),
        updated_at = now()
    WHERE id = target_user_id;

    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_accessible_organizations"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_accessible_organizations"() IS 'Trigger function to keep users.accessible_organizations array in sync with user_organizations_projection table';



CREATE OR REPLACE FUNCTION "public"."update_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_workflow_queue_projection_from_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Process workflow.queue.pending event
    -- Creates new queue entry with status='pending'
    IF NEW.event_type = 'workflow.queue.pending' THEN
        INSERT INTO workflow_queue_projection (
            event_id,
            event_type,
            event_data,
            stream_id,
            stream_type,
            status,
            created_at,
            updated_at
        )
        VALUES (
            (NEW.event_data->>'event_id')::UUID,  -- Original bootstrap.initiated event ID
            NEW.event_data->>'event_type',         -- Original event type
            (NEW.event_data->'event_data')::JSONB, -- Original event payload
            NEW.stream_id,
            NEW.stream_type,
            'pending',
            NOW(),
            NOW()
        )
        ON CONFLICT (event_id) DO NOTHING;  -- Idempotent: skip if already exists

    -- Process workflow.queue.claimed event
    -- Updates status to 'processing' and records worker info
    ELSIF NEW.event_type = 'workflow.queue.claimed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'processing',
            worker_id = NEW.event_data->>'worker_id',
            claimed_at = (NEW.event_data->>'claimed_at')::TIMESTAMPTZ,
            workflow_id = NEW.event_data->>'workflow_id',
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'pending';  -- Only update if still pending (prevent race conditions)

    -- Process workflow.queue.completed event
    -- Updates status to 'completed' and records completion info
    ELSIF NEW.event_type = 'workflow.queue.completed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'completed',
            completed_at = (NEW.event_data->>'completed_at')::TIMESTAMPTZ,
            workflow_run_id = NEW.event_data->>'workflow_run_id',
            result = (NEW.event_data->'result')::JSONB,
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    -- Process workflow.queue.failed event
    -- Updates status to 'failed' and records error info
    ELSIF NEW.event_type = 'workflow.queue.failed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'failed',
            failed_at = (NEW.event_data->>'failed_at')::TIMESTAMPTZ,
            error_message = NEW.event_data->>'error_message',
            error_stack = NEW.event_data->>'error_stack',
            retry_count = COALESCE((NEW.event_data->>'retry_count')::INTEGER, 0),
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_workflow_queue_projection_from_event"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_workflow_queue_projection_from_event"() IS 'Processes workflow queue events and updates workflow_queue_projection. Implements strict CQRS: all projection updates happen via events. Idempotent: safe to replay events.';



CREATE OR REPLACE FUNCTION "public"."update_workflow_queue_projection_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_workflow_queue_projection_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_active_org_access"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_organizations_projection
        WHERE user_id = p_user_id
          AND org_id = p_org_id
          AND (access_start_date IS NULL OR access_start_date <= CURRENT_DATE)
          AND (access_expiration_date IS NULL OR access_expiration_date >= CURRENT_DATE)
    );
END;
$$;


ALTER FUNCTION "public"."user_has_active_org_access"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_has_active_org_access"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Check if user has active (non-expired, started) access to an organization';



CREATE OR REPLACE FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_permission_name" "text", "p_org_id" "uuid", "p_scope_path" "extensions"."ltree" DEFAULT NULL::"extensions"."ltree") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id
      AND p.name = p_permission_name
      AND (
        -- Super admin: NULL org_id means global scope
        ur.organization_id IS NULL
        OR
        -- Org-scoped: exact org match + hierarchical scope check
        (
          ur.organization_id = p_org_id
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
$$;


ALTER FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_permission_name" "text", "p_org_id" "uuid", "p_scope_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_permission_name" "text", "p_org_id" "uuid", "p_scope_path" "extensions"."ltree") IS 'Checks if user has specified permission within given org/scope context';



CREATE OR REPLACE FUNCTION "public"."user_organizations"("p_user_id" "uuid") RETURNS TABLE("org_id" "uuid", "role_name" "text", "scope_path" "extensions"."ltree")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ur.organization_id,
    r.name AS role_name,
    ur.scope_path
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  WHERE ur.user_id = p_user_id
  ORDER BY ur.organization_id, r.name;
END;
$$;


ALTER FUNCTION "public"."user_organizations"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_organizations"("p_user_id" "uuid") IS 'Returns all organizations where user has assigned roles';



CREATE OR REPLACE FUNCTION "public"."user_permissions"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("permission_name" "text", "applet" "text", "action" "text", "description" "text", "requires_mfa" boolean, "scope_type" "text", "role_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
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
      ur.organization_id IS NULL  -- Super admin sees all
      OR ur.organization_id = p_org_id
    )
  ORDER BY p.applet, p.action;
END;
$$;


ALTER FUNCTION "public"."user_permissions"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_permissions"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Returns all permissions for a user within a specific organization';



CREATE OR REPLACE FUNCTION "public"."validate_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_consultant_type TEXT;
  v_provider_type TEXT;
BEGIN
  -- Get organization types
  SELECT type INTO v_consultant_type 
  FROM organizations_projection 
  WHERE id = p_consultant_org_id AND is_active = true;
  
  SELECT type INTO v_provider_type 
  FROM organizations_projection 
  WHERE id = p_provider_org_id AND is_active = true;
  
  -- Validate organizations exist and are active
  IF v_consultant_type IS NULL OR v_provider_type IS NULL THEN
    RETURN false;
  END IF;
  
  -- Consultant must be provider_partner, provider must be provider
  IF v_consultant_type != 'provider_partner' OR v_provider_type != 'provider' THEN
    RETURN false;
  END IF;
  
  -- If user-specific grant, validate user belongs to consultant org
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_roles_projection
      WHERE user_id = p_user_id
        AND org_id = p_consultant_org_id
    ) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."validate_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid") IS 'Validates that cross-tenant access grant request meets business rules';



CREATE OR REPLACE FUNCTION "public"."validate_event_sequence"("p_event" "record") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_expected_version INTEGER;
BEGIN
  v_expected_version := get_entity_version(p_event.stream_id, p_event.stream_type) + 1;

  IF p_event.stream_version != v_expected_version THEN
    RAISE EXCEPTION 'Event version mismatch. Expected %, got %',
      v_expected_version,
      p_event.stream_version;
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."validate_event_sequence"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_event_sequence"("p_event" "record") IS 'Ensures events are processed in order';



CREATE OR REPLACE FUNCTION "public"."validate_organization_hierarchy"("p_path" "extensions"."ltree", "p_parent_path" "extensions"."ltree") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Root organizations (depth 2) should have no parent
  IF nlevel(p_path) = 2 THEN
    RETURN p_parent_path IS NULL;
  END IF;
  
  -- Sub-organizations must have valid parent
  IF nlevel(p_path) > 2 THEN
    IF p_parent_path IS NULL THEN
      RETURN false;
    END IF;
    
    -- Check that parent exists
    IF NOT EXISTS (SELECT 1 FROM organizations_projection WHERE path = p_parent_path) THEN
      RETURN false;
    END IF;
    
    -- Check that path is properly nested under parent
    RETURN p_path <@ p_parent_path;
  END IF;

  RETURN false;
END;
$$;


ALTER FUNCTION "public"."validate_organization_hierarchy"("p_path" "extensions"."ltree", "p_parent_path" "extensions"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_organization_hierarchy"("p_path" "extensions"."ltree", "p_parent_path" "extensions"."ltree") IS 'Validates that organization path structure follows ltree hierarchy rules';



CREATE OR REPLACE FUNCTION "public"."validate_role_scope_path_active"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_scope_path LTREE;
  v_scope_depth INTEGER;
  v_inactive_ancestor_path LTREE;
  v_inactive_ancestor_name TEXT;
BEGIN
  -- Get the scope_path being assigned
  v_scope_path := NEW.scope_path;

  -- Skip validation if scope_path is NULL (global roles)
  IF v_scope_path IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calculate depth
  v_scope_depth := nlevel(v_scope_path);

  -- Only validate for OU-level scopes (depth > 2)
  -- Root org scopes (depth = 2) are handled by organization.deactivated event
  IF v_scope_depth <= 2 THEN
    RETURN NEW;
  END IF;

  -- Check for inactive ancestors in organization_units_projection
  -- This includes the target OU itself (if it's deactivated)
  SELECT ou.path, ou.name
  INTO v_inactive_ancestor_path, v_inactive_ancestor_name
  FROM organization_units_projection ou
  WHERE v_scope_path <@ ou.path  -- scope_path is descendant of or equal to ou.path
    AND ou.is_active = false
    AND ou.deleted_at IS NULL  -- Not soft-deleted (those are completely blocked)
  ORDER BY ou.depth DESC  -- Get the most specific (deepest) inactive ancestor
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot assign role to inactive organization unit scope. Ancestor "%" (%) is deactivated.',
      v_inactive_ancestor_name,
      v_inactive_ancestor_path
      USING ERRCODE = 'check_violation',
            HINT = 'Reactivate the organization unit before assigning roles to it or its descendants.';
  END IF;

  -- Also check if the scope_path refers to a deleted OU
  IF EXISTS (
    SELECT 1
    FROM organization_units_projection
    WHERE path = v_scope_path
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot assign role to deleted organization unit scope: %',
      v_scope_path
      USING ERRCODE = 'check_violation',
            HINT = 'The organization unit has been deleted and cannot receive role assignments.';
  END IF;

  -- All checks passed
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_role_scope_path_active"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_role_scope_path_active"() IS 'Safety-net validation: Blocks role assignment to deactivated or deleted organization units. Checks ancestors for inactive status.';



CREATE TABLE IF NOT EXISTS "public"."_migrations_applied" (
    "id" integer NOT NULL,
    "migration_name" "text" NOT NULL,
    "migration_path" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"(),
    "checksum" "text",
    "execution_time_ms" integer,
    "applied_by" "text" DEFAULT 'github-actions'::"text"
);


ALTER TABLE "public"."_migrations_applied" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."_migrations_applied_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."_migrations_applied_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."_migrations_applied_id_seq" OWNED BY "public"."_migrations_applied"."id";



CREATE TABLE IF NOT EXISTS "public"."addresses_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."address_type" NOT NULL,
    "street1" "text" NOT NULL,
    "street2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip_code" "text" NOT NULL,
    "country" "text" DEFAULT 'US'::"text",
    "is_primary" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."addresses_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."addresses_projection" IS 'CQRS projection of address.* events - addresses associated with organizations';



COMMENT ON COLUMN "public"."addresses_projection"."organization_id" IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';



COMMENT ON COLUMN "public"."addresses_projection"."label" IS 'User-defined address label for identification (e.g., "Main Office", "Billing Department")';



COMMENT ON COLUMN "public"."addresses_projection"."type" IS 'Structured address type: physical (business location), mailing, billing';



COMMENT ON COLUMN "public"."addresses_projection"."state" IS 'US state abbreviation (2-letter code)';



COMMENT ON COLUMN "public"."addresses_projection"."zip_code" IS 'US zip code (5-digit or 9-digit format)';



COMMENT ON COLUMN "public"."addresses_projection"."is_primary" IS 'Primary address for the organization (only one per org enforced by unique index)';



COMMENT ON COLUMN "public"."addresses_projection"."is_active" IS 'Address active status';



COMMENT ON COLUMN "public"."addresses_projection"."deleted_at" IS 'Soft delete timestamp (cascades from org deletion)';



CREATE TABLE IF NOT EXISTS "public"."contact_addresses" (
    "contact_id" "uuid" NOT NULL,
    "address_id" "uuid" NOT NULL
);


ALTER TABLE "public"."contact_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."contact_addresses" IS 'Many-to-many junction: contacts ↔ addresses (contact group association)';



CREATE TABLE IF NOT EXISTS "public"."contact_emails" (
    "contact_id" "uuid" NOT NULL,
    "email_id" "uuid" NOT NULL
);


ALTER TABLE "public"."contact_emails" OWNER TO "postgres";


COMMENT ON TABLE "public"."contact_emails" IS 'Junction table linking contacts to their email addresses';



CREATE TABLE IF NOT EXISTS "public"."contact_phones" (
    "contact_id" "uuid" NOT NULL,
    "phone_id" "uuid" NOT NULL
);


ALTER TABLE "public"."contact_phones" OWNER TO "postgres";


COMMENT ON TABLE "public"."contact_phones" IS 'Many-to-many junction: contacts ↔ phones (contact group association)';



CREATE TABLE IF NOT EXISTS "public"."contacts_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."contact_type" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "title" "text",
    "department" "text",
    "is_primary" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "user_id" "uuid"
);


ALTER TABLE "public"."contacts_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."contacts_projection" IS 'CQRS projection of contact.* events - contact persons associated with organizations';



COMMENT ON COLUMN "public"."contacts_projection"."organization_id" IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';



COMMENT ON COLUMN "public"."contacts_projection"."label" IS 'User-defined contact label for identification (e.g., "John Smith - Billing Contact")';



COMMENT ON COLUMN "public"."contacts_projection"."type" IS 'Structured contact type: a4c_admin, billing, technical, emergency, stakeholder';



COMMENT ON COLUMN "public"."contacts_projection"."is_primary" IS 'Primary contact for the organization (only one per org enforced by unique index)';



COMMENT ON COLUMN "public"."contacts_projection"."is_active" IS 'Contact active status';



COMMENT ON COLUMN "public"."contacts_projection"."deleted_at" IS 'Soft delete timestamp (cascades from org deletion)';



COMMENT ON COLUMN "public"."contacts_projection"."user_id" IS 'Optional FK to users table. Set when contact is also a system user (e.g., provider admin). Populated via contact.user.linked event.';



CREATE TABLE IF NOT EXISTS "public"."cross_tenant_access_grants_projection" (
    "id" "uuid" NOT NULL,
    "consultant_org_id" "uuid" NOT NULL,
    "consultant_user_id" "uuid",
    "provider_org_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "scope_id" "uuid",
    "authorization_type" "text" NOT NULL,
    "legal_reference" "text",
    "granted_by" "uuid" NOT NULL,
    "granted_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone,
    "permissions" "jsonb" DEFAULT '[]'::"jsonb",
    "terms" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    "revoked_reason" "text",
    "suspended_at" timestamp with time zone,
    "suspended_by" "uuid",
    "suspension_reason" "text",
    "suspension_details" "text",
    "expected_resolution_date" timestamp with time zone,
    "reactivated_at" timestamp with time zone,
    "reactivated_by" "uuid",
    "reactivation_notes" "text",
    CONSTRAINT "cross_tenant_access_grants_projection_scope_check" CHECK (("scope" = ANY (ARRAY['organization_unit'::"text", 'client_specific'::"text"]))),
    CONSTRAINT "cross_tenant_access_grants_projection_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text", 'expired'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."cross_tenant_access_grants_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."cross_tenant_access_grants_projection" IS 'CQRS projection of access_grant.* events - enables provider_partner organizations to access provider data with full audit trail';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."consultant_org_id" IS 'provider_partner organization requesting access (UUID format)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."consultant_user_id" IS 'Specific user within consultant org (NULL for org-wide grant)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."provider_org_id" IS 'Target provider organization owning the data (UUID format)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."scope" IS 'Access scope: organization_unit (any OU via scope_id) or client_specific (specific client)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."scope_id" IS 'Specific resource UUID for facility, program, or client scope';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."authorization_type" IS 'Legal/business basis: var_contract, court_order, family_participation, social_services_assignment, emergency_access';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."legal_reference" IS 'Reference to legal document, contract number, case number, etc.';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."expires_at" IS 'Expiration timestamp for time-limited access (NULL for indefinite)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."permissions" IS 'JSONB array of specific permissions granted (default: standard set for grant type)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."terms" IS 'JSONB object with additional terms (read_only, data_retention_days, notification_required)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."status" IS 'Current grant status: active, revoked, expired, suspended';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."revoked_at" IS 'Timestamp when grant was permanently revoked';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."suspended_at" IS 'Timestamp when grant was temporarily suspended (can be reactivated)';



CREATE SEQUENCE IF NOT EXISTS "public"."domain_events_sequence_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."domain_events_sequence_number_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."domain_events_sequence_number_seq" OWNED BY "public"."domain_events"."sequence_number";



CREATE TABLE IF NOT EXISTS "public"."emails_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."email_type" NOT NULL,
    "address" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."emails_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."emails_projection" IS 'CQRS projection of email.* events - email addresses associated with organizations';



COMMENT ON COLUMN "public"."emails_projection"."organization_id" IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';



COMMENT ON COLUMN "public"."emails_projection"."label" IS 'User-defined email label for identification (e.g., "Main Office", "Billing Department")';



COMMENT ON COLUMN "public"."emails_projection"."type" IS 'Structured email type: work, personal, billing, support, main';



COMMENT ON COLUMN "public"."emails_projection"."address" IS 'Email address (e.g., "info@example.com")';



COMMENT ON COLUMN "public"."emails_projection"."is_primary" IS 'Primary email for the organization (only one per org enforced by unique index)';



COMMENT ON COLUMN "public"."emails_projection"."is_active" IS 'Email active status';



COMMENT ON COLUMN "public"."emails_projection"."deleted_at" IS 'Soft delete timestamp (cascades from org deletion)';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "current_organization_id" "uuid",
    "accessible_organizations" "uuid"[],
    "roles" "text"[],
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "last_login" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "first_name" "text",
    "last_name" "text",
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'Shadow table for Supabase Auth users, used for RLS and auditing';



COMMENT ON COLUMN "public"."users"."id" IS 'User UUID from Supabase Auth (auth.users.id)';



COMMENT ON COLUMN "public"."users"."current_organization_id" IS 'Currently selected organization context';



COMMENT ON COLUMN "public"."users"."accessible_organizations" IS 'Array of organization IDs user can access';



COMMENT ON COLUMN "public"."users"."roles" IS 'Array of role names from Zitadel (super_admin, administrator, clinician, specialist, parent, youth)';



COMMENT ON COLUMN "public"."users"."first_name" IS 'User first name, copied from invitation on acceptance';



COMMENT ON COLUMN "public"."users"."last_name" IS 'User last name, copied from invitation on acceptance';



COMMENT ON COLUMN "public"."users"."deleted_at" IS 'Soft-delete timestamp. When set, user is permanently deleted from the organization.';



CREATE OR REPLACE VIEW "public"."event_history_by_entity" AS
 SELECT "de"."stream_id" AS "entity_id",
    "de"."stream_type" AS "entity_type",
    "de"."event_type",
    "de"."stream_version" AS "version",
    "de"."event_data",
    ("de"."event_metadata" ->> 'reason'::"text") AS "change_reason",
    ("de"."event_metadata" ->> 'user_id'::"text") AS "changed_by_id",
    "u"."name" AS "changed_by_name",
    "u"."email" AS "changed_by_email",
    ("de"."event_metadata" ->> 'correlation_id'::"text") AS "correlation_id",
    "de"."created_at" AS "occurred_at",
    "de"."processed_at",
    "de"."processing_error"
   FROM ("public"."domain_events" "de"
     LEFT JOIN "public"."users" "u" ON (("u"."id" = (("de"."event_metadata" ->> 'user_id'::"text"))::"uuid")))
  ORDER BY "de"."stream_id", "de"."stream_version";


ALTER VIEW "public"."event_history_by_entity" OWNER TO "postgres";


COMMENT ON VIEW "public"."event_history_by_entity" IS 'Complete event history for any entity including who made changes and why';



CREATE TABLE IF NOT EXISTS "public"."event_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "stream_type" "text" NOT NULL,
    "event_schema" "jsonb" NOT NULL,
    "metadata_schema" "jsonb",
    "description" "text" NOT NULL,
    "example_data" "jsonb",
    "example_metadata" "jsonb",
    "is_active" boolean DEFAULT true,
    "requires_approval" boolean DEFAULT false,
    "allowed_roles" "text"[],
    "projection_function" "text",
    "projection_tables" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."event_types" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_types" IS 'Catalog of all valid event types with schemas and processing rules';



CREATE TABLE IF NOT EXISTS "public"."impersonation_sessions_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "text" NOT NULL,
    "super_admin_user_id" "uuid" NOT NULL,
    "super_admin_email" "text" NOT NULL,
    "target_user_id" "uuid" NOT NULL,
    "target_email" "text" NOT NULL,
    "target_org_id" "uuid" NOT NULL,
    "justification_reason" "text" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "renewal_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "duration_ms" integer,
    "total_duration_ms" integer DEFAULT 0,
    "actions_performed" integer DEFAULT 0,
    "ended_reason" "text",
    "ended_by_user_id" "uuid",
    "ip_address" "text",
    "user_agent" "text",
    "justification_details" "text",
    CONSTRAINT "impersonation_sessions_projection_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'ended'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."impersonation_sessions_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."impersonation_sessions_projection" IS 'CQRS projection of impersonation sessions. Source: domain_events with stream_type=impersonation. Tracks Super Admin impersonation sessions with full audit trail.';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."session_id" IS 'Unique session identifier (from event_data.session_id)';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."justification_reason" IS 'Category of justification: support_ticket, emergency, audit, training';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."status" IS 'Session status: active (currently running), ended (manually terminated or declined renewal), expired (timed out)';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."renewal_count" IS 'Number of times session was renewed (incremented by impersonation.renewed events)';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."total_duration_ms" IS 'Total session duration including all renewals (milliseconds)';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."actions_performed" IS 'Count of events emitted during session (updated by impersonation.ended event)';



CREATE TABLE IF NOT EXISTS "public"."invitations_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invitation_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "role" "text",
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "roles" "jsonb" DEFAULT '[]'::"jsonb",
    "access_start_date" "date",
    "access_expiration_date" "date",
    "notification_preferences" "jsonb" DEFAULT '{"sms": {"enabled": false, "phone_id": null}, "email": true, "in_app": false}'::"jsonb" NOT NULL,
    "correlation_id" "uuid",
    "contact_id" "uuid",
    "phones" "jsonb" DEFAULT '[]'::"jsonb",
    CONSTRAINT "chk_invitation_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'deleted'::"text"]))),
    CONSTRAINT "invitations_date_order_check" CHECK ((("access_start_date" IS NULL) OR ("access_expiration_date" IS NULL) OR ("access_start_date" <= "access_expiration_date")))
);


ALTER TABLE "public"."invitations_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."invitations_projection" IS 'CQRS projection of user invitations. Updated by UserInvited domain events from Temporal workflows. Queried by Edge Functions for invitation validation and acceptance.';



COMMENT ON COLUMN "public"."invitations_projection"."invitation_id" IS 'UUID from domain event (aggregate ID). Used for event correlation.';



COMMENT ON COLUMN "public"."invitations_projection"."role" IS 'DEPRECATED: Use roles (jsonb array) instead. Kept for backward compatibility with bootstrap workflow.';



COMMENT ON COLUMN "public"."invitations_projection"."token" IS '256-bit cryptographically secure URL-safe base64 token. Used in invitation email link.';



COMMENT ON COLUMN "public"."invitations_projection"."expires_at" IS 'Invitation expiration timestamp (7 days from creation). Edge Functions check this.';



COMMENT ON COLUMN "public"."invitations_projection"."status" IS 'Invitation lifecycle status: pending (initial), accepted (user accepted), expired (past expires_at), deleted (soft delete by cleanup script)';



COMMENT ON COLUMN "public"."invitations_projection"."tags" IS 'Development entity tracking tags. Examples: ["development", "test", "mode:development"]. Used by cleanup script to identify and delete test data.';



COMMENT ON COLUMN "public"."invitations_projection"."roles" IS 'Array of role assignments: [{role_id: UUID, role_name: string}]. Replaces legacy role column.';



COMMENT ON COLUMN "public"."invitations_projection"."access_start_date" IS 'First date the invited user can access the org after accepting (NULL = immediate)';



COMMENT ON COLUMN "public"."invitations_projection"."access_expiration_date" IS 'Date the invited user access will expire (NULL = no expiration)';



COMMENT ON COLUMN "public"."invitations_projection"."notification_preferences" IS 'Initial notification preferences for the user (copied to user_org_access on acceptance)';



COMMENT ON COLUMN "public"."invitations_projection"."correlation_id" IS 'Business-scoped correlation ID for complete lifecycle tracing. Generated at invitation creation, reused for resend/revoke/accept/expire events.';



COMMENT ON COLUMN "public"."invitations_projection"."contact_id" IS 'Optional FK to contacts_projection. Set when invitation is for a person who is also a contact (e.g., provider admin).';



COMMENT ON COLUMN "public"."invitations_projection"."phones" IS 'Array of phone numbers to create when invitation is accepted. Structure:
[{
  "label": "Mobile",
  "type": "mobile|office|fax|emergency",
  "number": "+15551234567",
  "countryCode": "+1",
  "smsCapable": true,
  "isPrimary": true
}]';



CREATE TABLE IF NOT EXISTS "public"."organization_addresses" (
    "organization_id" "uuid" NOT NULL,
    "address_id" "uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."organization_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_addresses" IS 'Many-to-many junction: organizations ↔ addresses (org-level association)';



COMMENT ON COLUMN "public"."organization_addresses"."deleted_at" IS 'Soft-delete timestamp (NULL = active, NOT NULL = deleted)';



CREATE TABLE IF NOT EXISTS "public"."organization_business_profiles_projection" (
    "organization_id" "uuid" NOT NULL,
    "organization_type" "text" NOT NULL,
    "mailing_address" "jsonb",
    "physical_address" "jsonb",
    "provider_profile" "jsonb",
    "partner_profile" "jsonb",
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "organization_business_profiles_projecti_organization_type_check" CHECK (("organization_type" = ANY (ARRAY['provider'::"text", 'provider_partner'::"text"])))
);


ALTER TABLE "public"."organization_business_profiles_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_business_profiles_projection" IS 'CQRS projection of organization.business_profile.* events - rich business data for top-level organizations only';



COMMENT ON COLUMN "public"."organization_business_profiles_projection"."organization_type" IS 'Type of business profile: provider (healthcare orgs) or provider_partner (VARs, families, courts)';



COMMENT ON COLUMN "public"."organization_business_profiles_projection"."mailing_address" IS 'Mailing address JSONB: {street, city, state, zip_code, country}';



COMMENT ON COLUMN "public"."organization_business_profiles_projection"."physical_address" IS 'Physical location address JSONB: {street, city, state, zip_code, country}';



COMMENT ON COLUMN "public"."organization_business_profiles_projection"."provider_profile" IS 'Provider-specific business data: billing info, admin contacts, program details, service types';



COMMENT ON COLUMN "public"."organization_business_profiles_projection"."partner_profile" IS 'Provider partner-specific business data: contact info, admin details, partner type';



CREATE TABLE IF NOT EXISTS "public"."organization_contacts" (
    "organization_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."organization_contacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_contacts" IS 'Many-to-many junction: organizations ↔ contacts (org-level association)';



COMMENT ON COLUMN "public"."organization_contacts"."deleted_at" IS 'Soft-delete timestamp (NULL = active, NOT NULL = deleted)';



CREATE TABLE IF NOT EXISTS "public"."organization_emails" (
    "organization_id" "uuid" NOT NULL,
    "email_id" "uuid" NOT NULL
);


ALTER TABLE "public"."organization_emails" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_emails" IS 'Junction table linking organizations to their email addresses';



CREATE TABLE IF NOT EXISTS "public"."organization_phones" (
    "organization_id" "uuid" NOT NULL,
    "phone_id" "uuid" NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."organization_phones" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_phones" IS 'Many-to-many junction: organizations ↔ phones (org-level association)';



COMMENT ON COLUMN "public"."organization_phones"."deleted_at" IS 'Soft-delete timestamp (NULL = active, NOT NULL = deleted)';



CREATE TABLE IF NOT EXISTS "public"."organizations_projection" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text",
    "slug" "text" NOT NULL,
    "type" "text" NOT NULL,
    "path" "extensions"."ltree" NOT NULL,
    "parent_path" "extensions"."ltree",
    "depth" integer GENERATED ALWAYS AS ("extensions"."nlevel"("path")) STORED,
    "tax_number" "text",
    "phone_number" "text",
    "timezone" "text" DEFAULT 'America/New_York'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "deactivated_at" timestamp with time zone,
    "deactivation_reason" "text",
    "deleted_at" timestamp with time zone,
    "deletion_reason" "text",
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "subdomain_status" "public"."subdomain_status",
    "cloudflare_record_id" "text",
    "dns_verified_at" timestamp with time zone,
    "subdomain_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "partner_type" "public"."partner_type",
    "referring_partner_id" "uuid",
    CONSTRAINT "chk_partner_type_required" CHECK ((("type" <> 'provider_partner'::"text") OR (("type" = 'provider_partner'::"text") AND ("partner_type" IS NOT NULL)))),
    CONSTRAINT "chk_subdomain_conditional" CHECK (((("public"."is_subdomain_required"("type", "partner_type") = true) AND ("subdomain_status" IS NOT NULL)) OR (("public"."is_subdomain_required"("type", "partner_type") = false) AND ("subdomain_status" IS NULL)))),
    CONSTRAINT "organizations_projection_type_check" CHECK (("type" = ANY (ARRAY['platform_owner'::"text", 'provider'::"text", 'provider_partner'::"text"])))
);


ALTER TABLE "public"."organizations_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."organizations_projection" IS 'CQRS projection of organization.* events - maintains hierarchical organization structure';



COMMENT ON COLUMN "public"."organizations_projection"."slug" IS 'URL-friendly identifier for routing';



COMMENT ON COLUMN "public"."organizations_projection"."type" IS 'Organization type: platform_owner (A4C), provider (healthcare), provider_partner (VARs/families/courts)';



COMMENT ON COLUMN "public"."organizations_projection"."path" IS 'ltree hierarchical path (e.g., root.org_acme_healthcare.north_campus)';



COMMENT ON COLUMN "public"."organizations_projection"."parent_path" IS 'Parent organization ltree path (NULL for root organizations)';



COMMENT ON COLUMN "public"."organizations_projection"."depth" IS 'Computed depth in hierarchy (2 = root org, 3+ = sub-organizations)';



COMMENT ON COLUMN "public"."organizations_projection"."is_active" IS 'Organization active status (affects authentication and role assignment)';



COMMENT ON COLUMN "public"."organizations_projection"."deleted_at" IS 'Logical deletion timestamp (organizations are never physically deleted)';



COMMENT ON COLUMN "public"."organizations_projection"."subdomain_status" IS 'Subdomain provisioning status (NULL = subdomain not required for this org type). Required for providers and VAR partners only.';



COMMENT ON COLUMN "public"."organizations_projection"."cloudflare_record_id" IS 'Cloudflare DNS record ID for {slug}.{BASE_DOMAIN} subdomain (from Cloudflare API response)';



COMMENT ON COLUMN "public"."organizations_projection"."dns_verified_at" IS 'Timestamp when DNS verification completed successfully (subdomain resolvable)';



COMMENT ON COLUMN "public"."organizations_projection"."subdomain_metadata" IS 'Additional subdomain provisioning metadata: dns_record details, verification attempts, errors';



COMMENT ON COLUMN "public"."organizations_projection"."tags" IS 'Development entity tracking tags. Enables cleanup scripts to identify test data. Example tags: ["development", "test", "mode:development"]. Query with: WHERE tags @> ARRAY[''development'']';



COMMENT ON COLUMN "public"."organizations_projection"."partner_type" IS 'Partner classification for provider_partner orgs: var (reseller, gets subdomain), family/court/other (stakeholders, no subdomain)';



COMMENT ON COLUMN "public"."organizations_projection"."referring_partner_id" IS 'UUID of referring VAR partner (nullable, tracks which partner brought this provider to platform)';



CREATE TABLE IF NOT EXISTS "public"."permissions_projection" (
    "id" "uuid" NOT NULL,
    "applet" "text" NOT NULL,
    "action" "text" NOT NULL,
    "name" "text" GENERATED ALWAYS AS ((("applet" || '.'::"text") || "action")) STORED,
    "description" "text" NOT NULL,
    "scope_type" "text" NOT NULL,
    "requires_mfa" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "display_name" "text",
    CONSTRAINT "permissions_projection_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['global'::"text", 'org'::"text"])))
);


ALTER TABLE "public"."permissions_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."permissions_projection" IS 'Projection of permission.defined events - defines atomic authorization units';



COMMENT ON COLUMN "public"."permissions_projection"."name" IS 'Generated permission identifier in format: applet.action';



COMMENT ON COLUMN "public"."permissions_projection"."scope_type" IS 'Hierarchical scope level: global, org, facility, program, or client';



COMMENT ON COLUMN "public"."permissions_projection"."requires_mfa" IS 'Whether MFA verification is required to use this permission';



COMMENT ON COLUMN "public"."permissions_projection"."display_name" IS 'Human-readable permission name for UI display (e.g., "Create Organization" instead of "organization.create")';



CREATE TABLE IF NOT EXISTS "public"."phone_addresses" (
    "phone_id" "uuid" NOT NULL,
    "address_id" "uuid" NOT NULL
);


ALTER TABLE "public"."phone_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."phone_addresses" IS 'Many-to-many junction: phones ↔ addresses (direct association, supports contact-less main office scenarios)';



CREATE TABLE IF NOT EXISTS "public"."phones_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."phone_type" NOT NULL,
    "number" "text" NOT NULL,
    "extension" "text",
    "country_code" "text" DEFAULT '+1'::"text",
    "is_primary" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."phones_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."phones_projection" IS 'CQRS projection of phone.* events - phone numbers associated with organizations';



COMMENT ON COLUMN "public"."phones_projection"."organization_id" IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';



COMMENT ON COLUMN "public"."phones_projection"."label" IS 'User-defined phone label for identification (e.g., "Main Office", "Emergency Hotline")';



COMMENT ON COLUMN "public"."phones_projection"."type" IS 'Structured phone type: mobile, office, fax, emergency';



COMMENT ON COLUMN "public"."phones_projection"."number" IS 'Phone number (raw or formatted, e.g., "+1-555-123-4567")';



COMMENT ON COLUMN "public"."phones_projection"."extension" IS 'Phone extension (optional, e.g., "x1234")';



COMMENT ON COLUMN "public"."phones_projection"."is_primary" IS 'Primary phone for the organization (only one per org enforced by unique index)';



COMMENT ON COLUMN "public"."phones_projection"."is_active" IS 'Phone active status';



COMMENT ON COLUMN "public"."phones_projection"."deleted_at" IS 'Soft delete timestamp (cascades from org deletion)';



CREATE TABLE IF NOT EXISTS "public"."role_permission_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_name" "text" NOT NULL,
    "permission_name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."role_permission_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."role_permission_templates" IS 'Seeded with canonical permissions for provider_admin (16), partner_admin (4), clinician (4), viewer (3). Platform owners can modify via SQL or future Admin UI.';



COMMENT ON COLUMN "public"."role_permission_templates"."role_name" IS 'Role type name (provider_admin, partner_admin, clinician, viewer)';



COMMENT ON COLUMN "public"."role_permission_templates"."permission_name" IS 'Permission identifier in format: applet.action (e.g., organization.view_ou)';



COMMENT ON COLUMN "public"."role_permission_templates"."is_active" IS 'Soft delete flag - FALSE removes permission from future bootstraps without affecting existing grants';



COMMENT ON COLUMN "public"."role_permission_templates"."created_by" IS 'Platform owner (super_admin) who added this template entry';



CREATE TABLE IF NOT EXISTS "public"."role_permissions_projection" (
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."role_permissions_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."role_permissions_projection" IS 'Projection of role.permission.* events - maps permissions to roles';



COMMENT ON COLUMN "public"."role_permissions_projection"."granted_at" IS 'Timestamp when permission was granted to role';



CREATE TABLE IF NOT EXISTS "public"."roles_projection" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "organization_id" "uuid",
    "org_hierarchy_scope" "extensions"."ltree",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    CONSTRAINT "roles_projection_scope_check" CHECK (((("name" = 'super_admin'::"text") AND ("organization_id" IS NULL) AND ("org_hierarchy_scope" IS NULL)) OR (("name" <> 'super_admin'::"text") AND ("organization_id" IS NOT NULL) AND ("org_hierarchy_scope" IS NOT NULL))))
);


ALTER TABLE "public"."roles_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."roles_projection" IS 'Projection of role.created events - defines collections of permissions';



COMMENT ON COLUMN "public"."roles_projection"."organization_id" IS 'Internal organization UUID for JOINs (NULL for super_admin with global scope)';



COMMENT ON COLUMN "public"."roles_projection"."org_hierarchy_scope" IS 'ltree path for hierarchical scoping (NULL for super_admin)';



COMMENT ON CONSTRAINT "roles_projection_scope_check" ON "public"."roles_projection" IS 'Ensures only super_admin (system role) has NULL org scope. All other roles (provider_admin, partner_admin, clinician, viewer) MUST have organization_id';



CREATE OR REPLACE VIEW "public"."unprocessed_events" AS
 SELECT "id",
    "stream_id",
    "stream_type",
    "event_type",
    "stream_version",
    "created_at",
    "processing_error",
    "retry_count",
    "age"("now"(), "created_at") AS "age",
    ("event_metadata" ->> 'user_id'::"text") AS "created_by"
   FROM "public"."domain_events" "de"
  WHERE (("processed_at" IS NULL) OR ("processing_error" IS NOT NULL))
  ORDER BY "created_at";


ALTER VIEW "public"."unprocessed_events" OWNER TO "postgres";


COMMENT ON VIEW "public"."unprocessed_events" IS 'Events that failed processing or are still pending';



CREATE TABLE IF NOT EXISTS "public"."user_addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."address_type" NOT NULL,
    "street1" "text" NOT NULL,
    "street2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip_code" "text" NOT NULL,
    "country" "text" DEFAULT 'USA'::"text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_addresses" IS 'User-global addresses that apply across all organizations unless overridden';



COMMENT ON COLUMN "public"."user_addresses"."label" IS 'Human-readable label (e.g., "Home", "Work")';



COMMENT ON COLUMN "public"."user_addresses"."type" IS 'Address type: physical, mailing, or billing';



COMMENT ON COLUMN "public"."user_addresses"."is_primary" IS 'Exactly one primary address per user (enforced by partial unique index)';



COMMENT ON COLUMN "public"."user_addresses"."metadata" IS 'Additional data: verified flag, coordinates, notes';



CREATE TABLE IF NOT EXISTS "public"."user_notification_preferences_projection" (
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "sms_enabled" boolean DEFAULT false NOT NULL,
    "sms_phone_id" "uuid",
    "in_app_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_notification_preferences_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_notification_preferences_projection" IS 'CQRS projection for user notification preferences. Normalized columns for email, SMS, and in-app notification settings per organization.';



COMMENT ON COLUMN "public"."user_notification_preferences_projection"."user_id" IS 'User ID - references auth.users';



COMMENT ON COLUMN "public"."user_notification_preferences_projection"."organization_id" IS 'Organization context for these preferences';



COMMENT ON COLUMN "public"."user_notification_preferences_projection"."email_enabled" IS 'Whether email notifications are enabled for this user in this org';



COMMENT ON COLUMN "public"."user_notification_preferences_projection"."sms_enabled" IS 'Whether SMS notifications are enabled for this user in this org';



COMMENT ON COLUMN "public"."user_notification_preferences_projection"."sms_phone_id" IS 'The user_phone to use for SMS notifications (NULL if SMS disabled)';



COMMENT ON COLUMN "public"."user_notification_preferences_projection"."in_app_enabled" IS 'Whether in-app notifications are enabled for this user in this org';



CREATE TABLE IF NOT EXISTS "public"."user_org_address_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."address_type" NOT NULL,
    "street1" "text" NOT NULL,
    "street2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip_code" "text" NOT NULL,
    "country" "text" DEFAULT 'USA'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_org_address_overrides" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_org_address_overrides" IS 'Per-organization address overrides when user needs different address for specific org';



COMMENT ON COLUMN "public"."user_org_address_overrides"."org_id" IS 'Organization this address override applies to';



CREATE TABLE IF NOT EXISTS "public"."user_org_phone_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."phone_type" NOT NULL,
    "number" "text" NOT NULL,
    "extension" "text",
    "country_code" "text" DEFAULT '+1'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sms_capable" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_org_phone_overrides" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_org_phone_overrides" IS 'Per-organization phone overrides when user needs different phone for specific org';



COMMENT ON COLUMN "public"."user_org_phone_overrides"."org_id" IS 'Organization this phone override applies to';



CREATE TABLE IF NOT EXISTS "public"."user_organizations_projection" (
    "user_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "access_start_date" "date",
    "access_expiration_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_org_access_date_order_check" CHECK ((("access_start_date" IS NULL) OR ("access_expiration_date" IS NULL) OR ("access_start_date" <= "access_expiration_date")))
);


ALTER TABLE "public"."user_organizations_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_organizations_projection" IS 'User-organization membership projection. Notification preferences moved to user_notification_preferences_projection table.';



COMMENT ON COLUMN "public"."user_organizations_projection"."access_start_date" IS 'First date user can access this org (NULL = immediate)';



COMMENT ON COLUMN "public"."user_organizations_projection"."access_expiration_date" IS 'Last date user can access this org (NULL = no expiration)';



CREATE TABLE IF NOT EXISTS "public"."user_phones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."phone_type" NOT NULL,
    "number" "text" NOT NULL,
    "extension" "text",
    "country_code" "text" DEFAULT '+1'::"text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sms_capable" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_contact_phone_id" "uuid"
);


ALTER TABLE "public"."user_phones" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_phones" IS 'User-global phone numbers that apply across all organizations unless overridden';



COMMENT ON COLUMN "public"."user_phones"."label" IS 'Human-readable label (e.g., "Personal Cell", "Work")';



COMMENT ON COLUMN "public"."user_phones"."type" IS 'Phone type: mobile, office, fax, or emergency';



COMMENT ON COLUMN "public"."user_phones"."is_primary" IS 'Exactly one primary phone per user (enforced by partial unique index)';



COMMENT ON COLUMN "public"."user_phones"."sms_capable" IS 'Whether this phone can receive SMS notifications';



COMMENT ON COLUMN "public"."user_phones"."source_contact_phone_id" IS 'If this phone was auto-mirrored from a contact phone, stores the source phone_id for audit trail. NULL for user-managed phones.';



CREATE TABLE IF NOT EXISTS "public"."user_roles_projection" (
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "scope_path" "extensions"."ltree",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role_valid_from" "date",
    "role_valid_until" "date",
    CONSTRAINT "user_roles_date_order_check" CHECK ((("role_valid_from" IS NULL) OR ("role_valid_until" IS NULL) OR ("role_valid_from" <= "role_valid_until"))),
    CONSTRAINT "user_roles_projection_check" CHECK (((("organization_id" IS NULL) AND ("scope_path" IS NULL)) OR (("organization_id" IS NOT NULL) AND ("scope_path" IS NOT NULL))))
);


ALTER TABLE "public"."user_roles_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_roles_projection" IS 'Projection of user.role.* events - assigns roles to users with org scoping';



COMMENT ON COLUMN "public"."user_roles_projection"."organization_id" IS 'Organization UUID (NULL for super_admin global access, specific UUID for scoped roles)';



COMMENT ON COLUMN "public"."user_roles_projection"."scope_path" IS 'ltree hierarchy path for granular scoping (NULL for global access)';



COMMENT ON COLUMN "public"."user_roles_projection"."assigned_at" IS 'Timestamp when role was assigned to user';



COMMENT ON COLUMN "public"."user_roles_projection"."role_valid_from" IS 'First date this role assignment is active (NULL = immediate)';



COMMENT ON COLUMN "public"."user_roles_projection"."role_valid_until" IS 'Last date this role assignment is active (NULL = no expiration)';



CREATE TABLE IF NOT EXISTS "public"."workflow_queue_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_data" "jsonb" NOT NULL,
    "stream_id" "uuid" NOT NULL,
    "stream_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "worker_id" "text",
    "claimed_at" timestamp with time zone,
    "workflow_id" "text",
    "workflow_run_id" "text",
    "completed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "error_stack" "text",
    "retry_count" integer DEFAULT 0,
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflow_queue_projection_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."workflow_queue_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."workflow_queue_projection" IS 'CQRS projection: Workflow job queue for Temporal workers. Updated via triggers processing domain events. Workers subscribe via Supabase Realtime (filter: status=eq.pending).';



ALTER TABLE ONLY "public"."_migrations_applied" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."_migrations_applied_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."domain_events" ALTER COLUMN "sequence_number" SET DEFAULT "nextval"('"public"."domain_events_sequence_number_seq"'::"regclass");



ALTER TABLE ONLY "public"."_migrations_applied"
    ADD CONSTRAINT "_migrations_applied_migration_name_key" UNIQUE ("migration_name");



ALTER TABLE ONLY "public"."_migrations_applied"
    ADD CONSTRAINT "_migrations_applied_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."addresses_projection"
    ADD CONSTRAINT "addresses_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_addresses"
    ADD CONSTRAINT "contact_addresses_contact_id_address_id_key" UNIQUE ("contact_id", "address_id");



ALTER TABLE ONLY "public"."contact_emails"
    ADD CONSTRAINT "contact_emails_pkey" PRIMARY KEY ("contact_id", "email_id");



ALTER TABLE ONLY "public"."contact_phones"
    ADD CONSTRAINT "contact_phones_contact_id_phone_id_key" UNIQUE ("contact_id", "phone_id");



ALTER TABLE ONLY "public"."contacts_projection"
    ADD CONSTRAINT "contacts_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cross_tenant_access_grants_projection"
    ADD CONSTRAINT "cross_tenant_access_grants_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_events"
    ADD CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_events"
    ADD CONSTRAINT "domain_events_sequence_number_key" UNIQUE ("sequence_number");



ALTER TABLE ONLY "public"."emails_projection"
    ADD CONSTRAINT "emails_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_types"
    ADD CONSTRAINT "event_types_event_type_key" UNIQUE ("event_type");



ALTER TABLE ONLY "public"."event_types"
    ADD CONSTRAINT "event_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."impersonation_sessions_projection"
    ADD CONSTRAINT "impersonation_sessions_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."impersonation_sessions_projection"
    ADD CONSTRAINT "impersonation_sessions_projection_session_id_key" UNIQUE ("session_id");



ALTER TABLE ONLY "public"."invitations_projection"
    ADD CONSTRAINT "invitations_projection_invitation_id_key" UNIQUE ("invitation_id");



ALTER TABLE ONLY "public"."invitations_projection"
    ADD CONSTRAINT "invitations_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations_projection"
    ADD CONSTRAINT "invitations_projection_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."organization_addresses"
    ADD CONSTRAINT "organization_addresses_organization_id_address_id_key" UNIQUE ("organization_id", "address_id");



ALTER TABLE ONLY "public"."organization_business_profiles_projection"
    ADD CONSTRAINT "organization_business_profiles_projection_pkey" PRIMARY KEY ("organization_id");



ALTER TABLE ONLY "public"."organization_contacts"
    ADD CONSTRAINT "organization_contacts_organization_id_contact_id_key" UNIQUE ("organization_id", "contact_id");



ALTER TABLE ONLY "public"."organization_emails"
    ADD CONSTRAINT "organization_emails_pkey" PRIMARY KEY ("organization_id", "email_id");



ALTER TABLE ONLY "public"."organization_phones"
    ADD CONSTRAINT "organization_phones_organization_id_phone_id_key" UNIQUE ("organization_id", "phone_id");



ALTER TABLE ONLY "public"."organization_units_projection"
    ADD CONSTRAINT "organization_units_projection_path_key" UNIQUE ("path");



ALTER TABLE ONLY "public"."organization_units_projection"
    ADD CONSTRAINT "organization_units_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations_projection"
    ADD CONSTRAINT "organizations_projection_path_key" UNIQUE ("path");



ALTER TABLE ONLY "public"."organizations_projection"
    ADD CONSTRAINT "organizations_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations_projection"
    ADD CONSTRAINT "organizations_projection_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."permissions_projection"
    ADD CONSTRAINT "permissions_projection_applet_action_key" UNIQUE ("applet", "action");



ALTER TABLE ONLY "public"."permissions_projection"
    ADD CONSTRAINT "permissions_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phone_addresses"
    ADD CONSTRAINT "phone_addresses_phone_id_address_id_key" UNIQUE ("phone_id", "address_id");



ALTER TABLE ONLY "public"."phones_projection"
    ADD CONSTRAINT "phones_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permission_templates"
    ADD CONSTRAINT "role_permission_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permission_templates"
    ADD CONSTRAINT "role_permission_templates_unique" UNIQUE ("role_name", "permission_name");



ALTER TABLE ONLY "public"."role_permissions_projection"
    ADD CONSTRAINT "role_permissions_projection_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles_projection"
    ADD CONSTRAINT "roles_projection_name_org_unique" UNIQUE ("name", "organization_id");



ALTER TABLE ONLY "public"."roles_projection"
    ADD CONSTRAINT "roles_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_events"
    ADD CONSTRAINT "unique_stream_version" UNIQUE ("stream_id", "stream_type", "stream_version");



ALTER TABLE ONLY "public"."user_addresses"
    ADD CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notification_preferences_projection"
    ADD CONSTRAINT "user_notification_preferences_projection_pkey" PRIMARY KEY ("user_id", "organization_id");



ALTER TABLE ONLY "public"."user_organizations_projection"
    ADD CONSTRAINT "user_org_access_pkey" PRIMARY KEY ("user_id", "org_id");



ALTER TABLE ONLY "public"."user_org_address_overrides"
    ADD CONSTRAINT "user_org_address_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_org_phone_overrides"
    ADD CONSTRAINT "user_org_phone_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_phones"
    ADD CONSTRAINT "user_phones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles_projection"
    ADD CONSTRAINT "user_roles_projection_user_id_role_id_org_id_key" UNIQUE NULLS NOT DISTINCT ("user_id", "role_id", "organization_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_queue_projection"
    ADD CONSTRAINT "workflow_queue_projection_event_id_unique" UNIQUE ("event_id");



ALTER TABLE ONLY "public"."workflow_queue_projection"
    ADD CONSTRAINT "workflow_queue_projection_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_access_grants_authorization_type" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("authorization_type");



CREATE INDEX "idx_access_grants_consultant_org" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("consultant_org_id");



CREATE INDEX "idx_access_grants_consultant_user" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("consultant_user_id") WHERE ("consultant_user_id" IS NOT NULL);



CREATE INDEX "idx_access_grants_expires" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("expires_at", "status") WHERE (("expires_at" IS NOT NULL) AND ("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])));



CREATE INDEX "idx_access_grants_granted_by" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("granted_by", "granted_at");



CREATE INDEX "idx_access_grants_lookup" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("consultant_org_id", "provider_org_id", "status") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_access_grants_provider_org" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("provider_org_id");



CREATE INDEX "idx_access_grants_scope" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("scope");



CREATE INDEX "idx_access_grants_status" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("status");



CREATE INDEX "idx_access_grants_suspended" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("expected_resolution_date") WHERE ("status" = 'suspended'::"text");



CREATE INDEX "idx_addresses_active" ON "public"."addresses_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_addresses_label" ON "public"."addresses_projection" USING "btree" ("label", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_addresses_one_primary_per_org" ON "public"."addresses_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_addresses_organization" ON "public"."addresses_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_addresses_primary" ON "public"."addresses_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_addresses_type" ON "public"."addresses_projection" USING "btree" ("type", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_addresses_zip" ON "public"."addresses_projection" USING "btree" ("zip_code") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contact_addresses_address" ON "public"."contact_addresses" USING "btree" ("address_id");



CREATE INDEX "idx_contact_addresses_contact" ON "public"."contact_addresses" USING "btree" ("contact_id");



CREATE UNIQUE INDEX "idx_contact_emails_unique" ON "public"."contact_emails" USING "btree" ("contact_id", "email_id");



CREATE INDEX "idx_contact_phones_contact" ON "public"."contact_phones" USING "btree" ("contact_id");



CREATE INDEX "idx_contact_phones_phone" ON "public"."contact_phones" USING "btree" ("phone_id");



CREATE INDEX "idx_contacts_active" ON "public"."contacts_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_email" ON "public"."contacts_projection" USING "btree" ("email") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_contacts_one_primary_per_org" ON "public"."contacts_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_organization" ON "public"."contacts_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contacts_primary" ON "public"."contacts_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_type" ON "public"."contacts_projection" USING "btree" ("type", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_contacts_unique_user_per_org" ON "public"."contacts_projection" USING "btree" ("organization_id", "user_id") WHERE (("user_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_user_id" ON "public"."contacts_projection" USING "btree" ("user_id") WHERE (("user_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_domain_events_activity_id" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'activity_id'::"text"))) WHERE (("event_metadata" ->> 'activity_id'::"text") IS NOT NULL);



COMMENT ON INDEX "public"."idx_domain_events_activity_id" IS 'Enables queries for events emitted by specific workflow activities.
   Useful for debugging which activity failed or produced unexpected events.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''activity_id'' = ''createOrganizationActivity'';';



CREATE INDEX "idx_domain_events_correlation" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'correlation_id'::"text"))) WHERE ("event_metadata" ? 'correlation_id'::"text");



CREATE INDEX "idx_domain_events_correlation_time" ON "public"."domain_events" USING "btree" ("correlation_id", "created_at" DESC) WHERE ("correlation_id" IS NOT NULL);



CREATE INDEX "idx_domain_events_created" ON "public"."domain_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_domain_events_dismissed" ON "public"."domain_events" USING "btree" ("dismissed_at") WHERE ("processing_error" IS NOT NULL);



COMMENT ON INDEX "public"."idx_domain_events_dismissed" IS 'Partial index for efficient dismiss status filtering on failed events';



CREATE INDEX "idx_domain_events_failed_created" ON "public"."domain_events" USING "btree" ("created_at" DESC) WHERE (("processing_error" IS NOT NULL) AND ("dismissed_at" IS NULL));



COMMENT ON INDEX "public"."idx_domain_events_failed_created" IS 'Composite index for paginated failed events sorted by created_at DESC';



CREATE INDEX "idx_domain_events_failed_type" ON "public"."domain_events" USING "btree" ("event_type", "created_at" DESC) WHERE (("processing_error" IS NOT NULL) AND ("dismissed_at" IS NULL));



COMMENT ON INDEX "public"."idx_domain_events_failed_type" IS 'Composite index for paginated failed events sorted by event_type';



CREATE INDEX "idx_domain_events_parent_span" ON "public"."domain_events" USING "btree" ("parent_span_id", "created_at") WHERE ("parent_span_id" IS NOT NULL);



CREATE INDEX "idx_domain_events_session_time" ON "public"."domain_events" USING "btree" ("session_id", "created_at" DESC) WHERE ("session_id" IS NOT NULL);



CREATE INDEX "idx_domain_events_stream" ON "public"."domain_events" USING "btree" ("stream_id", "stream_type");



CREATE INDEX "idx_domain_events_tags" ON "public"."domain_events" USING "gin" ((("event_metadata" -> 'tags'::"text"))) WHERE ("event_metadata" ? 'tags'::"text");



CREATE INDEX "idx_domain_events_trace_time" ON "public"."domain_events" USING "btree" ("trace_id", "created_at" DESC) WHERE ("trace_id" IS NOT NULL);



CREATE INDEX "idx_domain_events_type" ON "public"."domain_events" USING "btree" ("event_type");



CREATE INDEX "idx_domain_events_unprocessed" ON "public"."domain_events" USING "btree" ("processed_at") WHERE ("processed_at" IS NULL);



CREATE INDEX "idx_domain_events_user" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'user_id'::"text"))) WHERE ("event_metadata" ? 'user_id'::"text");



CREATE INDEX "idx_domain_events_workflow_id" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'workflow_id'::"text"))) WHERE (("event_metadata" ->> 'workflow_id'::"text") IS NOT NULL);



COMMENT ON INDEX "public"."idx_domain_events_workflow_id" IS 'Enables efficient queries for all events emitted during a workflow execution.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''workflow_id'' = ''org-bootstrap-abc123'';';



CREATE INDEX "idx_domain_events_workflow_run_id" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'workflow_run_id'::"text"))) WHERE (("event_metadata" ->> 'workflow_run_id'::"text") IS NOT NULL);



COMMENT ON INDEX "public"."idx_domain_events_workflow_run_id" IS 'Enables queries for specific workflow run (Temporal execution ID).
   Useful for distinguishing between retries/replays of the same workflow.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''workflow_run_id'' = ''uuid-v4-run-id'';';



CREATE INDEX "idx_domain_events_workflow_type" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'workflow_id'::"text")), "event_type") WHERE (("event_metadata" ->> 'workflow_id'::"text") IS NOT NULL);



COMMENT ON INDEX "public"."idx_domain_events_workflow_type" IS 'Optimizes queries filtering by both workflow and event type.
   Example: SELECT * FROM domain_events
            WHERE event_metadata->>''workflow_id'' = ''org-bootstrap-abc123''
              AND event_type = ''contact.added'';';



CREATE INDEX "idx_emails_active" ON "public"."emails_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_emails_address" ON "public"."emails_projection" USING "btree" ("address") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_emails_label" ON "public"."emails_projection" USING "btree" ("label", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_emails_one_primary_per_org" ON "public"."emails_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_emails_organization" ON "public"."emails_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_emails_primary" ON "public"."emails_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_emails_type" ON "public"."emails_projection" USING "btree" ("type", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_event_types_active" ON "public"."event_types" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_event_types_stream" ON "public"."event_types" USING "btree" ("stream_type");



CREATE INDEX "idx_impersonation_sessions_expires_at" ON "public"."impersonation_sessions_projection" USING "btree" ("expires_at") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_impersonation_sessions_justification" ON "public"."impersonation_sessions_projection" USING "btree" ("justification_reason");



CREATE INDEX "idx_impersonation_sessions_org_started" ON "public"."impersonation_sessions_projection" USING "btree" ("target_org_id", "started_at" DESC);



CREATE INDEX "idx_impersonation_sessions_started_at" ON "public"."impersonation_sessions_projection" USING "btree" ("started_at" DESC);



CREATE INDEX "idx_impersonation_sessions_status" ON "public"."impersonation_sessions_projection" USING "btree" ("status") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_impersonation_sessions_super_admin" ON "public"."impersonation_sessions_projection" USING "btree" ("super_admin_user_id");



CREATE INDEX "idx_impersonation_sessions_target_org" ON "public"."impersonation_sessions_projection" USING "btree" ("target_org_id");



CREATE INDEX "idx_impersonation_sessions_target_user" ON "public"."impersonation_sessions_projection" USING "btree" ("target_user_id");



CREATE INDEX "idx_invitations_contact_id" ON "public"."invitations_projection" USING "btree" ("contact_id") WHERE ("contact_id" IS NOT NULL);



CREATE INDEX "idx_invitations_projection_correlation_id" ON "public"."invitations_projection" USING "btree" ("correlation_id") WHERE ("correlation_id" IS NOT NULL);



CREATE INDEX "idx_invitations_projection_org_email" ON "public"."invitations_projection" USING "btree" ("organization_id", "email");



CREATE INDEX "idx_invitations_projection_roles" ON "public"."invitations_projection" USING "gin" ("roles");



CREATE INDEX "idx_invitations_projection_status" ON "public"."invitations_projection" USING "btree" ("status");



CREATE INDEX "idx_invitations_projection_tags" ON "public"."invitations_projection" USING "gin" ("tags");



CREATE INDEX "idx_invitations_projection_token" ON "public"."invitations_projection" USING "btree" ("token");



CREATE INDEX "idx_invitations_with_access_dates" ON "public"."invitations_projection" USING "btree" ("organization_id", "status") WHERE (("access_start_date" IS NOT NULL) OR ("access_expiration_date" IS NOT NULL));



CREATE INDEX "idx_migrations_applied_at" ON "public"."_migrations_applied" USING "btree" ("applied_at" DESC);



CREATE INDEX "idx_migrations_name" ON "public"."_migrations_applied" USING "btree" ("migration_name");



CREATE INDEX "idx_org_addresses_deleted_at" ON "public"."organization_addresses" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_mailing_address" ON "public"."organization_business_profiles_projection" USING "gin" ("mailing_address") WHERE ("mailing_address" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_partner_profile" ON "public"."organization_business_profiles_projection" USING "gin" ("partner_profile") WHERE ("partner_profile" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_provider_profile" ON "public"."organization_business_profiles_projection" USING "gin" ("provider_profile") WHERE ("provider_profile" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_type" ON "public"."organization_business_profiles_projection" USING "btree" ("organization_type");



CREATE INDEX "idx_org_contacts_deleted_at" ON "public"."organization_contacts" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE UNIQUE INDEX "idx_org_emails_unique" ON "public"."organization_emails" USING "btree" ("organization_id", "email_id");



CREATE INDEX "idx_org_phones_deleted_at" ON "public"."organization_phones" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_organization_addresses_address" ON "public"."organization_addresses" USING "btree" ("address_id");



CREATE INDEX "idx_organization_addresses_org" ON "public"."organization_addresses" USING "btree" ("organization_id");



CREATE INDEX "idx_organization_contacts_contact" ON "public"."organization_contacts" USING "btree" ("contact_id");



CREATE INDEX "idx_organization_contacts_org" ON "public"."organization_contacts" USING "btree" ("organization_id");



CREATE INDEX "idx_organization_phones_org" ON "public"."organization_phones" USING "btree" ("organization_id");



CREATE INDEX "idx_organization_phones_phone" ON "public"."organization_phones" USING "btree" ("phone_id");



CREATE INDEX "idx_organizations_active" ON "public"."organizations_projection" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_organizations_deleted" ON "public"."organizations_projection" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_organizations_is_active" ON "public"."organizations_projection" USING "btree" ("is_active");



CREATE INDEX "idx_organizations_parent_path" ON "public"."organizations_projection" USING "gist" ("parent_path") WHERE ("parent_path" IS NOT NULL);



CREATE INDEX "idx_organizations_partner_type" ON "public"."organizations_projection" USING "btree" ("partner_type") WHERE ("partner_type" IS NOT NULL);



CREATE INDEX "idx_organizations_path" ON "public"."organizations_projection" USING "gist" ("path");



CREATE INDEX "idx_organizations_path_btree" ON "public"."organizations_projection" USING "btree" ("path");



CREATE INDEX "idx_organizations_path_gist" ON "public"."organizations_projection" USING "gist" ("path");



CREATE INDEX "idx_organizations_projection_tags" ON "public"."organizations_projection" USING "gin" ("tags");



CREATE INDEX "idx_organizations_referring_partner" ON "public"."organizations_projection" USING "btree" ("referring_partner_id") WHERE ("referring_partner_id" IS NOT NULL);



CREATE INDEX "idx_organizations_slug" ON "public"."organizations_projection" USING "btree" ("slug");



CREATE INDEX "idx_organizations_subdomain_failed" ON "public"."organizations_projection" USING "btree" ("subdomain_status", "updated_at") WHERE ("subdomain_status" = 'failed'::"public"."subdomain_status");



CREATE INDEX "idx_organizations_subdomain_status" ON "public"."organizations_projection" USING "btree" ("subdomain_status") WHERE ("subdomain_status" <> 'verified'::"public"."subdomain_status");



CREATE INDEX "idx_organizations_type" ON "public"."organizations_projection" USING "btree" ("type");



CREATE INDEX "idx_ou_active" ON "public"."organization_units_projection" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_ou_deleted" ON "public"."organization_units_projection" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ou_organization_id" ON "public"."organization_units_projection" USING "btree" ("organization_id");



CREATE INDEX "idx_ou_parent_path_btree" ON "public"."organization_units_projection" USING "btree" ("parent_path");



CREATE INDEX "idx_ou_parent_path_gist" ON "public"."organization_units_projection" USING "gist" ("parent_path");



CREATE INDEX "idx_ou_path_btree" ON "public"."organization_units_projection" USING "btree" ("path");



CREATE INDEX "idx_ou_path_gist" ON "public"."organization_units_projection" USING "gist" ("path");



CREATE INDEX "idx_ou_slug" ON "public"."organization_units_projection" USING "btree" ("slug");



CREATE INDEX "idx_permissions_applet" ON "public"."permissions_projection" USING "btree" ("applet");



CREATE INDEX "idx_permissions_name" ON "public"."permissions_projection" USING "btree" ("name");



CREATE INDEX "idx_permissions_requires_mfa" ON "public"."permissions_projection" USING "btree" ("requires_mfa") WHERE ("requires_mfa" = true);



CREATE INDEX "idx_permissions_scope_type" ON "public"."permissions_projection" USING "btree" ("scope_type");



CREATE INDEX "idx_phone_addresses_address" ON "public"."phone_addresses" USING "btree" ("address_id");



CREATE INDEX "idx_phone_addresses_phone" ON "public"."phone_addresses" USING "btree" ("phone_id");



CREATE INDEX "idx_phones_active" ON "public"."phones_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_phones_label" ON "public"."phones_projection" USING "btree" ("label", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_phones_number" ON "public"."phones_projection" USING "btree" ("number") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_phones_one_primary_per_org" ON "public"."phones_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_phones_organization" ON "public"."phones_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_phones_primary" ON "public"."phones_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_phones_type" ON "public"."phones_projection" USING "btree" ("type", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_role_permission_templates_active" ON "public"."role_permission_templates" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_role_permission_templates_role" ON "public"."role_permission_templates" USING "btree" ("role_name") WHERE ("is_active" = true);



CREATE INDEX "idx_role_permissions_permission" ON "public"."role_permissions_projection" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role" ON "public"."role_permissions_projection" USING "btree" ("role_id");



CREATE INDEX "idx_role_permissions_role_id" ON "public"."role_permissions_projection" USING "btree" ("role_id");



CREATE INDEX "idx_roles_hierarchy_scope" ON "public"."roles_projection" USING "gist" ("org_hierarchy_scope") WHERE ("org_hierarchy_scope" IS NOT NULL);



CREATE INDEX "idx_roles_name" ON "public"."roles_projection" USING "btree" ("name");



CREATE INDEX "idx_roles_organization_id" ON "public"."roles_projection" USING "btree" ("organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_user_addresses_one_primary" ON "public"."user_addresses" USING "btree" ("user_id") WHERE (("is_primary" = true) AND ("is_active" = true));



CREATE INDEX "idx_user_addresses_type" ON "public"."user_addresses" USING "btree" ("user_id", "type") WHERE ("is_active" = true);



CREATE INDEX "idx_user_addresses_user" ON "public"."user_addresses" USING "btree" ("user_id") WHERE ("is_active" = true);



CREATE INDEX "idx_user_notification_prefs_sms_enabled" ON "public"."user_notification_preferences_projection" USING "btree" ("organization_id") WHERE ("sms_enabled" = true);



CREATE INDEX "idx_user_notification_prefs_sms_phone" ON "public"."user_notification_preferences_projection" USING "btree" ("sms_phone_id") WHERE ("sms_phone_id" IS NOT NULL);



CREATE INDEX "idx_user_notification_prefs_user" ON "public"."user_notification_preferences_projection" USING "btree" ("user_id");



CREATE INDEX "idx_user_org_access_expiring" ON "public"."user_organizations_projection" USING "btree" ("access_expiration_date") WHERE ("access_expiration_date" IS NOT NULL);



CREATE INDEX "idx_user_org_access_org" ON "public"."user_organizations_projection" USING "btree" ("org_id");



CREATE INDEX "idx_user_org_access_user" ON "public"."user_organizations_projection" USING "btree" ("user_id");



CREATE INDEX "idx_user_org_address_overrides_lookup" ON "public"."user_org_address_overrides" USING "btree" ("user_id", "org_id") WHERE ("is_active" = true);



CREATE INDEX "idx_user_org_address_overrides_user" ON "public"."user_org_address_overrides" USING "btree" ("user_id") WHERE ("is_active" = true);



CREATE INDEX "idx_user_org_phone_overrides_lookup" ON "public"."user_org_phone_overrides" USING "btree" ("user_id", "org_id") WHERE ("is_active" = true);



CREATE INDEX "idx_user_org_phone_overrides_sms" ON "public"."user_org_phone_overrides" USING "btree" ("user_id", "org_id") WHERE (("sms_capable" = true) AND ("is_active" = true));



CREATE INDEX "idx_user_org_phone_overrides_user" ON "public"."user_org_phone_overrides" USING "btree" ("user_id") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "idx_user_phones_one_primary" ON "public"."user_phones" USING "btree" ("user_id") WHERE (("is_primary" = true) AND ("is_active" = true));



CREATE INDEX "idx_user_phones_sms_capable" ON "public"."user_phones" USING "btree" ("user_id") WHERE (("sms_capable" = true) AND ("is_active" = true));



CREATE INDEX "idx_user_phones_source_contact_phone" ON "public"."user_phones" USING "btree" ("source_contact_phone_id") WHERE ("source_contact_phone_id" IS NOT NULL);



CREATE INDEX "idx_user_phones_type" ON "public"."user_phones" USING "btree" ("user_id", "type") WHERE ("is_active" = true);



CREATE INDEX "idx_user_phones_user" ON "public"."user_phones" USING "btree" ("user_id") WHERE ("is_active" = true);



CREATE INDEX "idx_user_roles_auth_lookup" ON "public"."user_roles_projection" USING "btree" ("user_id", "organization_id");



CREATE INDEX "idx_user_roles_expiring" ON "public"."user_roles_projection" USING "btree" ("role_valid_until") WHERE ("role_valid_until" IS NOT NULL);



CREATE INDEX "idx_user_roles_org" ON "public"."user_roles_projection" USING "btree" ("organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "idx_user_roles_pending_start" ON "public"."user_roles_projection" USING "btree" ("role_valid_from") WHERE ("role_valid_from" IS NOT NULL);



CREATE INDEX "idx_user_roles_projection_user_id" ON "public"."user_roles_projection" USING "btree" ("user_id");



CREATE INDEX "idx_user_roles_role" ON "public"."user_roles_projection" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_scope_path" ON "public"."user_roles_projection" USING "gist" ("scope_path") WHERE ("scope_path" IS NOT NULL);



CREATE INDEX "idx_user_roles_user" ON "public"."user_roles_projection" USING "btree" ("user_id");



CREATE INDEX "idx_users_current_organization" ON "public"."users" USING "btree" ("current_organization_id") WHERE ("current_organization_id" IS NOT NULL);



CREATE INDEX "idx_users_deleted_at" ON "public"."users" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_roles" ON "public"."users" USING "gin" ("roles");



CREATE INDEX "workflow_queue_projection_created_at_idx" ON "public"."workflow_queue_projection" USING "btree" ("created_at" DESC);



CREATE INDEX "workflow_queue_projection_event_type_idx" ON "public"."workflow_queue_projection" USING "btree" ("event_type");



CREATE INDEX "workflow_queue_projection_status_idx" ON "public"."workflow_queue_projection" USING "btree" ("status");



CREATE INDEX "workflow_queue_projection_stream_id_idx" ON "public"."workflow_queue_projection" USING "btree" ("stream_id");



CREATE INDEX "workflow_queue_projection_workflow_id_idx" ON "public"."workflow_queue_projection" USING "btree" ("workflow_id") WHERE ("workflow_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "bootstrap_workflow_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = 'organization.bootstrap.failed'::"text")) EXECUTE FUNCTION "public"."handle_bootstrap_workflow"();



COMMENT ON TRIGGER "bootstrap_workflow_trigger" ON "public"."domain_events" IS 'Handles cleanup for failed bootstrap events. Fires only on organization.bootstrap.failed.
   Emits organization.bootstrap.cancelled event when partial_cleanup_required is true.';



CREATE OR REPLACE TRIGGER "enqueue_workflow_from_bootstrap_event_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = 'organization.bootstrap.initiated'::"text")) EXECUTE FUNCTION "public"."enqueue_workflow_from_bootstrap_event"();



CREATE OR REPLACE TRIGGER "process_domain_event_trigger" BEFORE INSERT OR UPDATE ON "public"."domain_events" FOR EACH ROW EXECUTE FUNCTION "public"."process_domain_event"();



CREATE OR REPLACE TRIGGER "process_invitation_events_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = ANY (ARRAY['user.invited'::"text", 'invitation.accepted'::"text", 'invitation.expired'::"text", 'invitation.revoked'::"text"]))) EXECUTE FUNCTION "public"."process_invitation_event"();



CREATE OR REPLACE TRIGGER "process_user_events_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = ANY (ARRAY['user.created'::"text", 'user.synced_from_auth'::"text", 'user.deactivated'::"text", 'user.reactivated'::"text", 'user.organization_switched'::"text"]))) EXECUTE FUNCTION "public"."process_user_event"();



CREATE OR REPLACE TRIGGER "trg_sync_accessible_orgs" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_organizations_projection" FOR EACH ROW EXECUTE FUNCTION "public"."sync_accessible_organizations"();



CREATE OR REPLACE TRIGGER "trigger_notify_bootstrap_initiated" BEFORE INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = 'organization.bootstrap.initiated'::"text")) EXECUTE FUNCTION "public"."notify_workflow_worker_bootstrap"();



COMMENT ON TRIGGER "trigger_notify_bootstrap_initiated" ON "public"."domain_events" IS 'Notifies workflow worker via PostgreSQL NOTIFY when organization.bootstrap.initiated events are inserted.
   Fires BEFORE INSERT, before the process_domain_event_trigger sets processed_at.
   Part of the event-driven workflow triggering pattern.';



CREATE OR REPLACE TRIGGER "update_organizations_projection_timestamp" BEFORE UPDATE ON "public"."organizations_projection" FOR EACH ROW EXECUTE FUNCTION "public"."update_timestamp"();



CREATE OR REPLACE TRIGGER "update_workflow_queue_projection_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = ANY (ARRAY['workflow.queue.pending'::"text", 'workflow.queue.claimed'::"text", 'workflow.queue.completed'::"text", 'workflow.queue.failed'::"text"]))) EXECUTE FUNCTION "public"."update_workflow_queue_projection_from_event"();



CREATE OR REPLACE TRIGGER "validate_role_scope_active_trigger" BEFORE INSERT OR UPDATE OF "scope_path" ON "public"."user_roles_projection" FOR EACH ROW EXECUTE FUNCTION "public"."validate_role_scope_path_active"();



COMMENT ON TRIGGER "validate_role_scope_active_trigger" ON "public"."user_roles_projection" IS 'Prevents role assignment to deactivated or deleted organization unit scopes. Defense-in-depth validation.';



CREATE OR REPLACE TRIGGER "workflow_queue_projection_updated_at_trigger" BEFORE UPDATE ON "public"."workflow_queue_projection" FOR EACH ROW EXECUTE FUNCTION "public"."update_workflow_queue_projection_updated_at"();



ALTER TABLE ONLY "public"."addresses_projection"
    ADD CONSTRAINT "addresses_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."contact_addresses"
    ADD CONSTRAINT "contact_addresses_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "public"."addresses_projection"("id");



ALTER TABLE ONLY "public"."contact_addresses"
    ADD CONSTRAINT "contact_addresses_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");



ALTER TABLE ONLY "public"."contact_emails"
    ADD CONSTRAINT "contact_emails_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");



ALTER TABLE ONLY "public"."contact_emails"
    ADD CONSTRAINT "contact_emails_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "public"."emails_projection"("id");



ALTER TABLE ONLY "public"."contact_phones"
    ADD CONSTRAINT "contact_phones_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");



ALTER TABLE ONLY "public"."contact_phones"
    ADD CONSTRAINT "contact_phones_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "public"."phones_projection"("id");



ALTER TABLE ONLY "public"."contacts_projection"
    ADD CONSTRAINT "contacts_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."contacts_projection"
    ADD CONSTRAINT "contacts_projection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."emails_projection"
    ADD CONSTRAINT "emails_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."roles_projection"
    ADD CONSTRAINT "fk_roles_projection_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_roles_projection"
    ADD CONSTRAINT "fk_user_roles_projection_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invitations_projection"
    ADD CONSTRAINT "invitations_projection_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations_projection"
    ADD CONSTRAINT "invitations_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organization_addresses"
    ADD CONSTRAINT "organization_addresses_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "public"."addresses_projection"("id");



ALTER TABLE ONLY "public"."organization_addresses"
    ADD CONSTRAINT "organization_addresses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organization_business_profiles_projection"
    ADD CONSTRAINT "organization_business_profiles_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organization_contacts"
    ADD CONSTRAINT "organization_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");



ALTER TABLE ONLY "public"."organization_contacts"
    ADD CONSTRAINT "organization_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organization_emails"
    ADD CONSTRAINT "organization_emails_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "public"."emails_projection"("id");



ALTER TABLE ONLY "public"."organization_emails"
    ADD CONSTRAINT "organization_emails_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organization_phones"
    ADD CONSTRAINT "organization_phones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organization_phones"
    ADD CONSTRAINT "organization_phones_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "public"."phones_projection"("id");



ALTER TABLE ONLY "public"."organization_units_projection"
    ADD CONSTRAINT "organization_units_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organizations_projection"
    ADD CONSTRAINT "organizations_projection_referring_partner_id_fkey" FOREIGN KEY ("referring_partner_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."phone_addresses"
    ADD CONSTRAINT "phone_addresses_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "public"."addresses_projection"("id");



ALTER TABLE ONLY "public"."phone_addresses"
    ADD CONSTRAINT "phone_addresses_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "public"."phones_projection"("id");



ALTER TABLE ONLY "public"."phones_projection"
    ADD CONSTRAINT "phones_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."role_permissions_projection"
    ADD CONSTRAINT "role_permissions_projection_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions_projection"("id");



ALTER TABLE ONLY "public"."role_permissions_projection"
    ADD CONSTRAINT "role_permissions_projection_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles_projection"("id");



ALTER TABLE ONLY "public"."user_addresses"
    ADD CONSTRAINT "user_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notification_preferences_projection"
    ADD CONSTRAINT "user_notification_preferences_projection_sms_phone_id_fkey" FOREIGN KEY ("sms_phone_id") REFERENCES "public"."user_phones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_notification_preferences_projection"
    ADD CONSTRAINT "user_notification_preferences_projection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_organizations_projection"
    ADD CONSTRAINT "user_org_access_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations_projection"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_organizations_projection"
    ADD CONSTRAINT "user_org_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_org_address_overrides"
    ADD CONSTRAINT "user_org_address_overrides_user_org_fkey" FOREIGN KEY ("user_id", "org_id") REFERENCES "public"."user_organizations_projection"("user_id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_org_phone_overrides"
    ADD CONSTRAINT "user_org_phone_overrides_user_org_fkey" FOREIGN KEY ("user_id", "org_id") REFERENCES "public"."user_organizations_projection"("user_id", "org_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_phones"
    ADD CONSTRAINT "user_phones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles_projection"
    ADD CONSTRAINT "user_roles_projection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "addresses_org_admin_select" ON "public"."addresses_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "addresses_org_admin_select" ON "public"."addresses_projection" IS 'Allows org admins to view addresses in their organization';



ALTER TABLE "public"."addresses_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "addresses_projection_service_role_select" ON "public"."addresses_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "addresses_projection_service_role_select" ON "public"."addresses_projection" IS 'Allows Temporal workers (service_role) to read address data for cleanup activities';



CREATE POLICY "business_profiles_org_admin_select" ON "public"."organization_business_profiles_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "business_profiles_org_admin_select" ON "public"."organization_business_profiles_projection" IS 'Allows org admins to view business profiles in their organization';



ALTER TABLE "public"."contact_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_addresses_org_admin_select" ON "public"."contact_addresses" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."contacts_projection" "c"
  WHERE (("c"."id" = "contact_addresses"."contact_id") AND "public"."has_org_admin_permission"() AND ("c"."organization_id" = "public"."get_current_org_id"()) AND ("c"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
   FROM "public"."addresses_projection" "a"
  WHERE (("a"."id" = "contact_addresses"."address_id") AND ("a"."deleted_at" IS NULL))))));



COMMENT ON POLICY "contact_addresses_org_admin_select" ON "public"."contact_addresses" IS 'Allows org admins to view contact-address links in their organization';



ALTER TABLE "public"."contact_emails" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_emails_org_admin_select" ON "public"."contact_emails" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."contacts_projection" "c"
  WHERE (("c"."id" = "contact_emails"."contact_id") AND "public"."has_org_admin_permission"() AND ("c"."organization_id" = "public"."get_current_org_id"()) AND ("c"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
   FROM "public"."emails_projection" "e"
  WHERE (("e"."id" = "contact_emails"."email_id") AND ("e"."deleted_at" IS NULL))))));



COMMENT ON POLICY "contact_emails_org_admin_select" ON "public"."contact_emails" IS 'Allows organization admins to view contact-email links (JWT-claims pattern, both contact and email must be active)';



CREATE POLICY "contact_emails_super_admin_all" ON "public"."contact_emails" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "contact_emails_super_admin_all" ON "public"."contact_emails" IS 'Allows super admins full access to all contact-email links';



ALTER TABLE "public"."contact_phones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_phones_org_admin_select" ON "public"."contact_phones" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."contacts_projection" "c"
  WHERE (("c"."id" = "contact_phones"."contact_id") AND "public"."has_org_admin_permission"() AND ("c"."organization_id" = "public"."get_current_org_id"()) AND ("c"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
   FROM "public"."phones_projection" "p"
  WHERE (("p"."id" = "contact_phones"."phone_id") AND ("p"."deleted_at" IS NULL))))));



COMMENT ON POLICY "contact_phones_org_admin_select" ON "public"."contact_phones" IS 'Allows org admins to view contact-phone links in their organization';



CREATE POLICY "contacts_org_admin_select" ON "public"."contacts_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "contacts_org_admin_select" ON "public"."contacts_projection" IS 'Allows org admins to view contacts in their organization';



ALTER TABLE "public"."contacts_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_projection_service_role_select" ON "public"."contacts_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "contacts_projection_service_role_select" ON "public"."contacts_projection" IS 'Allows Temporal workers (service_role) to read contact data for cleanup activities';



ALTER TABLE "public"."cross_tenant_access_grants_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cross_tenant_grants_org_admin_select" ON "public"."cross_tenant_access_grants_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND (("consultant_org_id" = "public"."get_current_org_id"()) OR ("provider_org_id" = "public"."get_current_org_id"()))));



COMMENT ON POLICY "cross_tenant_grants_org_admin_select" ON "public"."cross_tenant_access_grants_projection" IS 'Allows org admins to view cross-tenant grants where their org is involved';



ALTER TABLE "public"."domain_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "domain_events_authenticated_insert" ON "public"."domain_events" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("public"."has_platform_privilege"() OR ((("event_metadata" ->> 'organization_id'::"text"))::"uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'org_id'::"text"))::"uuid")) AND ("length"(("event_metadata" ->> 'reason'::"text")) >= 10)));



COMMENT ON POLICY "domain_events_authenticated_insert" ON "public"."domain_events" IS 'Allows authenticated users to INSERT events. Validates org_id matches JWT claim and reason >= 10 chars.';



CREATE POLICY "domain_events_org_select" ON "public"."domain_events" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("public"."has_platform_privilege"() OR ((("event_metadata" ->> 'organization_id'::"text"))::"uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'org_id'::"text"))::"uuid"))));



COMMENT ON POLICY "domain_events_org_select" ON "public"."domain_events" IS 'Allows users to SELECT events belonging to their organization.';



CREATE POLICY "emails_org_admin_select" ON "public"."emails_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "emails_org_admin_select" ON "public"."emails_projection" IS 'Allows organization admins to view emails in their organization (JWT-claims pattern, excluding soft-deleted)';



ALTER TABLE "public"."emails_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "emails_projection_service_role_select" ON "public"."emails_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "emails_projection_service_role_select" ON "public"."emails_projection" IS 'Allows Temporal workers (service_role) to read email data for cleanup activities';



CREATE POLICY "emails_super_admin_all" ON "public"."emails_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "emails_super_admin_all" ON "public"."emails_projection" IS 'Allows super admins full access to all emails';



ALTER TABLE "public"."event_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_types_authenticated_select" ON "public"."event_types" FOR SELECT USING (("public"."get_current_user_id"() IS NOT NULL));



COMMENT ON POLICY "event_types_authenticated_select" ON "public"."event_types" IS 'Allows authenticated users to view event type definitions';



CREATE POLICY "impersonation_sessions_own_sessions_select" ON "public"."impersonation_sessions_projection" FOR SELECT USING ((("super_admin_user_id" = ("current_setting"('app.current_user'::"text"))::"uuid") OR ("target_user_id" = ("current_setting"('app.current_user'::"text"))::"uuid")));



COMMENT ON POLICY "impersonation_sessions_own_sessions_select" ON "public"."impersonation_sessions_projection" IS 'Allows users to view sessions where they were either the impersonator or the target';



ALTER TABLE "public"."impersonation_sessions_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "impersonation_sessions_provider_admin_select" ON "public"."impersonation_sessions_projection" FOR SELECT USING ((("target_org_id" = ("current_setting"('app.current_org'::"text"))::"uuid") AND (EXISTS ( SELECT 1
   FROM ("public"."user_roles_projection" "ur"
     JOIN "public"."roles_projection" "r" ON (("r"."id" = "ur"."role_id")))
  WHERE (("ur"."user_id" = ("current_setting"('app.current_user'::"text"))::"uuid") AND ("r"."name" = 'provider_admin'::"text") AND ("ur"."organization_id" = "impersonation_sessions_projection"."target_org_id"))))));



COMMENT ON POLICY "impersonation_sessions_provider_admin_select" ON "public"."impersonation_sessions_projection" IS 'Allows provider admins to view impersonation sessions that affected their organization';



CREATE POLICY "impersonation_sessions_super_admin_select" ON "public"."impersonation_sessions_projection" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles_projection" "ur"
     JOIN "public"."roles_projection" "r" ON (("r"."id" = "ur"."role_id")))
  WHERE (("ur"."user_id" = ("current_setting"('app.current_user'::"text"))::"uuid") AND ("r"."name" = 'super_admin'::"text") AND ("ur"."organization_id" IS NULL)))));



COMMENT ON POLICY "impersonation_sessions_super_admin_select" ON "public"."impersonation_sessions_projection" IS 'Allows super admins to view all impersonation sessions across all organizations';



CREATE POLICY "invitations_org_admin_select" ON "public"."invitations_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "invitations_org_admin_select" ON "public"."invitations_projection" IS 'Allows org admins to view invitations in their organization';



ALTER TABLE "public"."invitations_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_projection_service_role_select" ON "public"."invitations_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "invitations_projection_service_role_select" ON "public"."invitations_projection" IS 'Allows Temporal workers (service_role) to read invitation data for email activities';



CREATE POLICY "invitations_user_own_select" ON "public"."invitations_projection" FOR SELECT USING (("email" = (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'email'::"text")));



COMMENT ON POLICY "invitations_user_own_select" ON "public"."invitations_projection" IS 'Allows users to view their own invitation by email address';



CREATE POLICY "org_addresses_org_admin_select" ON "public"."organization_addresses" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."organizations_projection" "o"
  WHERE (("o"."id" = "organization_addresses"."organization_id") AND ("o"."deleted_at" IS NULL))))));



COMMENT ON POLICY "org_addresses_org_admin_select" ON "public"."organization_addresses" IS 'Allows org admins to view organization addresses';



CREATE POLICY "org_contacts_org_admin_select" ON "public"."organization_contacts" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."organizations_projection" "o"
  WHERE (("o"."id" = "organization_contacts"."organization_id") AND ("o"."deleted_at" IS NULL))))));



COMMENT ON POLICY "org_contacts_org_admin_select" ON "public"."organization_contacts" IS 'Allows org admins to view organization contacts';



CREATE POLICY "org_emails_org_admin_select" ON "public"."organization_emails" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."emails_projection" "e"
  WHERE (("e"."id" = "organization_emails"."email_id") AND ("e"."deleted_at" IS NULL))))));



COMMENT ON POLICY "org_emails_org_admin_select" ON "public"."organization_emails" IS 'Allows organization admins to view organization-email links (JWT-claims pattern, email must not be deleted)';



CREATE POLICY "org_emails_super_admin_all" ON "public"."organization_emails" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "org_emails_super_admin_all" ON "public"."organization_emails" IS 'Allows super admins full access to all organization-email links';



CREATE POLICY "org_phones_org_admin_select" ON "public"."organization_phones" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."organizations_projection" "o"
  WHERE (("o"."id" = "organization_phones"."organization_id") AND ("o"."deleted_at" IS NULL))))));



COMMENT ON POLICY "org_phones_org_admin_select" ON "public"."organization_phones" IS 'Allows org admins to view organization phones';



ALTER TABLE "public"."organization_addresses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_business_profiles_projection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_phones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_units_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_org_admin_select" ON "public"."organizations_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "organizations_org_admin_select" ON "public"."organizations_projection" IS 'Allows org admins to view their own organization';



ALTER TABLE "public"."organizations_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_projection_service_role_select" ON "public"."organizations_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "organizations_projection_service_role_select" ON "public"."organizations_projection" IS 'Allows Temporal workers (service_role) to read organization data for workflow activities';



CREATE POLICY "organizations_scope_delete" ON "public"."organizations_projection" FOR DELETE USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path") AND ("extensions"."nlevel"("path") > 2)));



COMMENT ON POLICY "organizations_scope_delete" ON "public"."organizations_projection" IS 'Allows users to delete sub-organizations within their scope_path. Child/role validation done in RPC.';



CREATE POLICY "organizations_scope_insert" ON "public"."organizations_projection" FOR INSERT WITH CHECK ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path") AND ("extensions"."nlevel"("path") > 2)));



COMMENT ON POLICY "organizations_scope_insert" ON "public"."organizations_projection" IS 'Allows users to create sub-organizations within their scope_path hierarchy. Root orgs require super_admin.';



CREATE POLICY "organizations_scope_select" ON "public"."organizations_projection" FOR SELECT USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "organizations_scope_select" ON "public"."organizations_projection" IS 'Allows users to view organizations within their scope_path hierarchy. Required for OU tree visualization.';



CREATE POLICY "organizations_scope_update" ON "public"."organizations_projection" FOR UPDATE USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path") AND ("extensions"."nlevel"("path") > 2))) WITH CHECK ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path") AND ("extensions"."nlevel"("path") > 2)));



COMMENT ON POLICY "organizations_scope_update" ON "public"."organizations_projection" IS 'Allows users to update sub-organizations within their scope_path. Root org updates require super_admin.';



CREATE POLICY "organizations_select" ON "public"."organizations_projection" FOR SELECT USING (("public"."has_platform_privilege"() OR ("id" = "public"."get_current_org_id"())));



CREATE POLICY "organizations_var_partner_referrals" ON "public"."organizations_projection" FOR SELECT USING (("public"."is_var_partner"() AND ("referring_partner_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "organizations_var_partner_referrals" ON "public"."organizations_projection" IS 'Allows VAR partners to view organizations they referred (where referring_partner_id = their org_id)';



CREATE POLICY "ou_org_admin_select" ON "public"."organization_units_projection" FOR SELECT USING ((("organization_id" IS NOT NULL) AND "public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "ou_org_admin_select" ON "public"."organization_units_projection" IS 'Allows org admins to view organization units in their organization';



CREATE POLICY "ou_scope_delete" ON "public"."organization_units_projection" FOR DELETE USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_delete" ON "public"."organization_units_projection" IS 'Allows users to delete organization units within their scope_path. Child/role validation in RPC.';



CREATE POLICY "ou_scope_insert" ON "public"."organization_units_projection" FOR INSERT WITH CHECK ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_insert" ON "public"."organization_units_projection" IS 'Allows users to create organization units within their scope_path hierarchy';



CREATE POLICY "ou_scope_select" ON "public"."organization_units_projection" FOR SELECT USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_select" ON "public"."organization_units_projection" IS 'Allows users to view organization units within their scope_path hierarchy';



CREATE POLICY "ou_scope_update" ON "public"."organization_units_projection" FOR UPDATE USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path"))) WITH CHECK ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_update" ON "public"."organization_units_projection" IS 'Allows users to update organization units within their scope_path hierarchy';



CREATE POLICY "permissions_authenticated_select" ON "public"."permissions_projection" FOR SELECT USING (("public"."get_current_user_id"() IS NOT NULL));



COMMENT ON POLICY "permissions_authenticated_select" ON "public"."permissions_projection" IS 'Allows authenticated users to view available permissions';



ALTER TABLE "public"."permissions_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_projection_service_role_select" ON "public"."permissions_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "permissions_projection_service_role_select" ON "public"."permissions_projection" IS 'Allows Temporal workers (service_role) to read permission definitions';



ALTER TABLE "public"."phone_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phone_addresses_org_admin_select" ON "public"."phone_addresses" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."phones_projection" "p"
  WHERE (("p"."id" = "phone_addresses"."phone_id") AND "public"."has_org_admin_permission"() AND ("p"."organization_id" = "public"."get_current_org_id"()) AND ("p"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
   FROM "public"."addresses_projection" "a"
  WHERE (("a"."id" = "phone_addresses"."address_id") AND ("a"."deleted_at" IS NULL))))));



COMMENT ON POLICY "phone_addresses_org_admin_select" ON "public"."phone_addresses" IS 'Allows org admins to view phone-address links in their organization';



CREATE POLICY "phones_org_admin_select" ON "public"."phones_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"()) AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "phones_org_admin_select" ON "public"."phones_projection" IS 'Allows org admins to view phones in their organization';



ALTER TABLE "public"."phones_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phones_projection_service_role_select" ON "public"."phones_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "phones_projection_service_role_select" ON "public"."phones_projection" IS 'Allows Temporal workers (service_role) to read phone data for cleanup activities';



CREATE POLICY "platform_admin_all" ON "public"."addresses_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."addresses_projection" IS 'Allows platform admins full access to all addresses';



CREATE POLICY "platform_admin_all" ON "public"."contact_addresses" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."contact_addresses" IS 'Allows platform admins full access to all contact-address links';



CREATE POLICY "platform_admin_all" ON "public"."contact_phones" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."contact_phones" IS 'Allows platform admins full access to all contact-phone links';



CREATE POLICY "platform_admin_all" ON "public"."contacts_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."contacts_projection" IS 'Allows platform admins full access to all contacts';



CREATE POLICY "platform_admin_all" ON "public"."cross_tenant_access_grants_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."cross_tenant_access_grants_projection" IS 'Allows platform admins full access to all cross-tenant access grants';



CREATE POLICY "platform_admin_all" ON "public"."event_types" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."event_types" IS 'Allows platform admins full access to event type definitions';



CREATE POLICY "platform_admin_all" ON "public"."invitations_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."invitations_projection" IS 'Allows platform admins full access to all invitations';



CREATE POLICY "platform_admin_all" ON "public"."organization_addresses" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."organization_addresses" IS 'Allows platform admins full access to all organization-address links';



CREATE POLICY "platform_admin_all" ON "public"."organization_business_profiles_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."organization_business_profiles_projection" IS 'Allows platform admins full access to all business profiles';



CREATE POLICY "platform_admin_all" ON "public"."organization_contacts" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."organization_contacts" IS 'Allows platform admins full access to all organization-contact links';



CREATE POLICY "platform_admin_all" ON "public"."organization_phones" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."organization_phones" IS 'Allows platform admins full access to all organization-phone links';



CREATE POLICY "platform_admin_all" ON "public"."organization_units_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."organization_units_projection" IS 'Allows platform admins full access to all organization units';



CREATE POLICY "platform_admin_all" ON "public"."organizations_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."organizations_projection" IS 'Allows platform admins full access to all organizations';



CREATE POLICY "platform_admin_all" ON "public"."permissions_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."permissions_projection" IS 'Allows platform admins full access to permission definitions';



CREATE POLICY "platform_admin_all" ON "public"."phone_addresses" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."phone_addresses" IS 'Allows platform admins full access to all phone-address links';



CREATE POLICY "platform_admin_all" ON "public"."phones_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."phones_projection" IS 'Allows platform admins full access to all phones';



CREATE POLICY "platform_admin_all" ON "public"."role_permissions_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."role_permissions_projection" IS 'Allows platform admins full access to all role-permission grants';



CREATE POLICY "platform_admin_all" ON "public"."roles_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."roles_projection" IS 'Allows platform admins full access to all roles';



CREATE POLICY "platform_admin_all" ON "public"."user_addresses" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."user_addresses" IS 'Allows platform admins full access to all user-address links';



CREATE POLICY "platform_admin_all" ON "public"."user_org_address_overrides" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."user_org_address_overrides" IS 'Allows platform admins full access to all user org address overrides';



CREATE POLICY "platform_admin_all" ON "public"."user_org_phone_overrides" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."user_org_phone_overrides" IS 'Allows platform admins full access to all user org phone overrides';



CREATE POLICY "platform_admin_all" ON "public"."user_organizations_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."user_organizations_projection" IS 'Allows platform admins full access to all user-organization memberships';



CREATE POLICY "platform_admin_all" ON "public"."user_phones" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."user_phones" IS 'Allows platform admins full access to all user-phone links';



CREATE POLICY "platform_admin_all" ON "public"."user_roles_projection" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."user_roles_projection" IS 'Allows platform admins full access to all user-role assignments';



CREATE POLICY "platform_admin_all" ON "public"."users" USING ("public"."has_platform_privilege"());



COMMENT ON POLICY "platform_admin_all" ON "public"."users" IS 'Allows platform admins full access to all users';



ALTER TABLE "public"."role_permission_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permission_templates_read" ON "public"."role_permission_templates" FOR SELECT USING (true);



CREATE POLICY "role_permission_templates_service_role_select" ON "public"."role_permission_templates" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "role_permission_templates_service_role_select" ON "public"."role_permission_templates" IS 'Allows Temporal workers (service_role) to read permission templates for role bootstrap';



CREATE POLICY "role_permission_templates_write" ON "public"."role_permission_templates" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles_projection" "ur"
     JOIN "public"."roles_projection" "r" ON (("r"."id" = "ur"."role_id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "role_permissions_global_select" ON "public"."role_permissions_projection" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."roles_projection" "r"
  WHERE (("r"."id" = "role_permissions_projection"."role_id") AND ("r"."organization_id" IS NULL)))) AND ("public"."get_current_user_id"() IS NOT NULL)));



COMMENT ON POLICY "role_permissions_global_select" ON "public"."role_permissions_projection" IS 'Allows authenticated users to view permissions for global roles';



CREATE POLICY "role_permissions_org_admin_select" ON "public"."role_permissions_projection" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."roles_projection" "r"
  WHERE (("r"."id" = "role_permissions_projection"."role_id") AND ("r"."organization_id" IS NOT NULL) AND "public"."has_org_admin_permission"() AND ("r"."organization_id" = "public"."get_current_org_id"())))));



COMMENT ON POLICY "role_permissions_org_admin_select" ON "public"."role_permissions_projection" IS 'Allows org admins to view role-permission grants for roles in their organization';



ALTER TABLE "public"."role_permissions_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_projection_service_role_select" ON "public"."role_permissions_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "role_permissions_projection_service_role_select" ON "public"."role_permissions_projection" IS 'Allows Temporal workers (service_role) to read role-permission mappings';



CREATE POLICY "roles_global_select" ON "public"."roles_projection" FOR SELECT USING ((("organization_id" IS NULL) AND ("public"."get_current_user_id"() IS NOT NULL)));



COMMENT ON POLICY "roles_global_select" ON "public"."roles_projection" IS 'Allows authenticated users to view global role templates';



CREATE POLICY "roles_org_admin_select" ON "public"."roles_projection" FOR SELECT USING ((("organization_id" IS NOT NULL) AND "public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "roles_org_admin_select" ON "public"."roles_projection" IS 'Allows org admins to view roles in their organization';



ALTER TABLE "public"."roles_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_projection_service_role_select" ON "public"."roles_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "roles_projection_service_role_select" ON "public"."roles_projection" IS 'Allows Temporal workers (service_role) to read role data for RBAC lookups';



ALTER TABLE "public"."user_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_addresses_org_admin_select" ON "public"."user_addresses" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_organizations_projection" "uoa"
  WHERE (("uoa"."user_id" = "user_addresses"."user_id") AND "public"."has_org_admin_permission"() AND ("uoa"."org_id" = "public"."get_current_org_id"())))));



COMMENT ON POLICY "user_addresses_org_admin_select" ON "public"."user_addresses" IS 'Allows org admins to view user addresses for users in their organization';



CREATE POLICY "user_addresses_own_all" ON "public"."user_addresses" USING (("user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "user_addresses_own_all" ON "public"."user_addresses" IS 'Allows users to manage their own addresses';



ALTER TABLE "public"."user_notification_preferences_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_notification_prefs_select_own" ON "public"."user_notification_preferences_projection" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'org_id'::"text"))::"uuid" = "organization_id")));



CREATE POLICY "user_notification_prefs_service_role" ON "public"."user_notification_preferences_projection" USING (("current_setting"('role'::"text") = 'service_role'::"text"));



CREATE POLICY "user_notification_prefs_update_own" ON "public"."user_notification_preferences_projection" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_org_access_org_admin_select" ON "public"."user_organizations_projection" FOR SELECT USING (("public"."has_org_admin_permission"() AND ("org_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "user_org_access_org_admin_select" ON "public"."user_organizations_projection" IS 'Allows org admins to view user-organization memberships in their organization';



ALTER TABLE "public"."user_org_address_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_org_address_overrides_org_admin_all" ON "public"."user_org_address_overrides" USING (("public"."has_org_admin_permission"() AND ("org_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "user_org_address_overrides_org_admin_all" ON "public"."user_org_address_overrides" IS 'Allows org admins full access to user address overrides in their organization';



CREATE POLICY "user_org_address_overrides_own_all" ON "public"."user_org_address_overrides" USING (("user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "user_org_address_overrides_own_all" ON "public"."user_org_address_overrides" IS 'Allows users to manage their own address overrides';



ALTER TABLE "public"."user_org_phone_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_org_phone_overrides_org_admin_all" ON "public"."user_org_phone_overrides" USING (("public"."has_org_admin_permission"() AND ("org_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "user_org_phone_overrides_org_admin_all" ON "public"."user_org_phone_overrides" IS 'Allows org admins full access to user phone overrides in their organization';



CREATE POLICY "user_org_phone_overrides_own_all" ON "public"."user_org_phone_overrides" USING (("user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "user_org_phone_overrides_own_all" ON "public"."user_org_phone_overrides" IS 'Allows users to manage their own phone overrides';



CREATE POLICY "user_organizations_org_admin_all" ON "public"."user_organizations_projection" USING (("public"."has_org_admin_permission"() AND ("org_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "user_organizations_org_admin_all" ON "public"."user_organizations_projection" IS 'Allows org admins full access to user-organization memberships in their organization';



CREATE POLICY "user_organizations_own_select" ON "public"."user_organizations_projection" FOR SELECT USING (("user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "user_organizations_own_select" ON "public"."user_organizations_projection" IS 'Allows users to view their own org access records';



ALTER TABLE "public"."user_organizations_projection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_phones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_phones_org_admin_select" ON "public"."user_phones" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_organizations_projection" "uoa"
  WHERE (("uoa"."user_id" = "user_phones"."user_id") AND "public"."has_org_admin_permission"() AND ("uoa"."org_id" = "public"."get_current_org_id"())))));



COMMENT ON POLICY "user_phones_org_admin_select" ON "public"."user_phones" IS 'Allows org admins to view user phones for users in their organization';



CREATE POLICY "user_phones_own_all" ON "public"."user_phones" USING (("user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "user_phones_own_all" ON "public"."user_phones" IS 'Allows users to manage their own phones';



CREATE POLICY "user_roles_org_admin_select" ON "public"."user_roles_projection" FOR SELECT USING ((("organization_id" IS NOT NULL) AND "public"."has_org_admin_permission"() AND ("organization_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "user_roles_org_admin_select" ON "public"."user_roles_projection" IS 'Allows org admins to view user-role assignments in their organization';



CREATE POLICY "user_roles_own_select" ON "public"."user_roles_projection" FOR SELECT USING (("user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "user_roles_own_select" ON "public"."user_roles_projection" IS 'Allows users to view their own role assignments';



ALTER TABLE "public"."user_roles_projection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_org_admin_select" ON "public"."users" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles_projection" "ur"
  WHERE (("ur"."user_id" = "users"."id") AND "public"."has_org_admin_permission"() AND ("ur"."organization_id" = "public"."get_current_org_id"())))));



COMMENT ON POLICY "users_org_admin_select" ON "public"."users" IS 'Allows org admins to view users with roles in their organization';



CREATE POLICY "users_own_profile_select" ON "public"."users" FOR SELECT USING (("id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "users_own_profile_select" ON "public"."users" IS 'Allows users to view their own profile';



CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING (("public"."has_platform_privilege"() OR ("id" = "auth"."uid"()) OR ("current_organization_id" = "public"."get_current_org_id"())));



ALTER TABLE "public"."workflow_queue_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflow_queue_projection_service_role_delete" ON "public"."workflow_queue_projection" FOR DELETE TO "service_role" USING (true);



CREATE POLICY "workflow_queue_projection_service_role_insert" ON "public"."workflow_queue_projection" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "workflow_queue_projection_service_role_select" ON "public"."workflow_queue_projection" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "workflow_queue_projection_service_role_update" ON "public"."workflow_queue_projection" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workflow_queue_projection";



GRANT USAGE ON SCHEMA "api" TO "anon";
GRANT USAGE ON SCHEMA "api" TO "authenticated";
GRANT USAGE ON SCHEMA "api" TO "service_role";



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO PUBLIC;
GRANT ALL ON SCHEMA "public" TO "anon";
GRANT ALL ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "api"."accept_invitation"("p_invitation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "api"."accept_invitation"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."accept_invitation"("p_invitation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."add_user_phone"("p_user_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."add_user_phone"("p_user_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."check_organization_by_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."check_organization_by_name"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."check_organization_by_slug"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."check_organization_by_slug"("p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."check_pending_invitation"("p_email" "text", "p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."check_user_exists"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."check_user_org_membership"("p_email" "text", "p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."deactivate_role"("p_role_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."delete_role"("p_role_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "api"."emit_workflow_started_event"("p_stream_id" "uuid", "p_bootstrap_event_id" "uuid", "p_workflow_id" "text", "p_workflow_run_id" "text", "p_workflow_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."find_contacts_by_phone"("p_organization_id" "uuid", "p_phone_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."find_contacts_by_phone"("p_organization_id" "uuid", "p_phone_number" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_assignable_roles"("p_org_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_child_organizations"("p_parent_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_child_organizations"("p_parent_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_event_processing_stats"() TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_events_by_correlation"("p_correlation_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_events_by_correlation"("p_correlation_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "api"."get_events_by_session"("p_session_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_events_by_session"("p_session_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "api"."get_failed_events"("p_limit" integer, "p_event_type" "text", "p_stream_type" "text", "p_since" timestamp with time zone) TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_invitation_by_id"("p_invitation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_invitation_for_resend"("p_invitation_id" "uuid", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_invitation_for_resend"("p_invitation_id" "uuid", "p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_organization_by_id"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_organization_by_id"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_organization_unit_by_id"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_organization_unit_by_id"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_organization_unit_descendants"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_organization_unit_descendants"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_organization_units"("p_status" "text", "p_search_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_organization_units"("p_status" "text", "p_search_term" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_organizations"("p_type" "text", "p_is_active" boolean, "p_search_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_organizations"("p_type" "text", "p_is_active" boolean, "p_search_term" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_organizations_paginated"("p_type" "text", "p_is_active" boolean, "p_search_term" "text", "p_page" integer, "p_page_size" integer, "p_sort_by" "text", "p_sort_order" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_organizations_paginated"("p_type" "text", "p_is_active" boolean, "p_search_term" "text", "p_page" integer, "p_page_size" integer, "p_sort_by" "text", "p_sort_order" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_permission_ids_by_names"("p_names" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "api"."get_person_phones"("p_contact_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_person_phones"("p_contact_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_role_by_id"("p_role_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_role_by_name"("p_org_id" "uuid", "p_role_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_role_by_name_and_org"("p_role_name" "text", "p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_role_permission_names"("p_role_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_role_permission_templates"("p_role_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_roles"("p_status" "text", "p_search_term" "text") TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_trace_timeline"("p_trace_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_trace_timeline"("p_trace_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_user_by_id"("p_user_id" "uuid", "p_org_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_user_notification_preferences"("p_user_id" "uuid", "p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_user_notification_preferences"("p_user_id" "uuid", "p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_user_org_access"("p_user_id" "uuid", "p_org_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_user_org_details"("p_user_id" "uuid", "p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_user_permissions"() TO "authenticated";



GRANT ALL ON FUNCTION "api"."get_user_phones"("p_user_id" "uuid", "p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_user_phones"("p_user_id" "uuid", "p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_user_sms_phones"("p_user_id" "uuid", "p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_user_sms_phones"("p_user_id" "uuid", "p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."list_invitations"("p_org_id" "uuid", "p_status" "text"[], "p_search_term" "text") TO "authenticated";



GRANT ALL ON FUNCTION "api"."list_users"("p_org_id" "uuid", "p_status" "text", "p_search_term" "text", "p_sort_by" "text", "p_sort_desc" boolean, "p_page" integer, "p_page_size" integer) TO "authenticated";



GRANT ALL ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."reactivate_role"("p_role_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."remove_user_phone"("p_phone_id" "uuid", "p_org_id" "uuid", "p_hard_delete" boolean, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."remove_user_phone"("p_phone_id" "uuid", "p_org_id" "uuid", "p_hard_delete" boolean, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."resend_invitation"("p_invitation_id" "uuid", "p_new_token" "text", "p_new_expires_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "api"."retry_failed_event"("p_event_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "api"."revoke_invitation"("p_invitation_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."soft_delete_organization_addresses"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "api"."soft_delete_organization_contacts"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "api"."soft_delete_organization_phones"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_permission_ids" "uuid"[]) TO "authenticated";



GRANT ALL ON FUNCTION "api"."update_user"("p_user_id" "uuid", "p_org_id" "uuid", "p_first_name" "text", "p_last_name" "text") TO "authenticated";



GRANT ALL ON FUNCTION "api"."update_user_access_dates"("p_user_id" "uuid", "p_org_id" "uuid", "p_access_start_date" "date", "p_access_expiration_date" "date") TO "authenticated";



GRANT ALL ON FUNCTION "api"."update_user_notification_preferences"("p_user_id" "uuid", "p_org_id" "uuid", "p_notification_preferences" "jsonb", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."update_user_notification_preferences"("p_user_id" "uuid", "p_org_id" "uuid", "p_notification_preferences" "jsonb", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."update_user_phone"("p_phone_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."update_user_phone"("p_phone_id" "uuid", "p_label" "text", "p_type" "text", "p_number" "text", "p_extension" "text", "p_country_code" "text", "p_is_primary" boolean, "p_sms_capable" boolean, "p_org_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."validate_role_assignment"("p_role_ids" "uuid"[]) TO "authenticated";

























































































































































GRANT ALL ON FUNCTION "public"."check_permissions_subset"("p_required" "uuid"[], "p_available" "uuid"[]) TO "authenticated";






REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."organization_units_projection" TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_user_aggregated_permissions"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_user_claims_preview"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_user_scope_paths"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_workflow_worker_bootstrap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") TO "authenticated";


















GRANT SELECT ON TABLE "public"."addresses_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."addresses_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."contact_emails" TO "service_role";
GRANT SELECT ON TABLE "public"."contact_emails" TO "authenticated";



GRANT SELECT ON TABLE "public"."contacts_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."contacts_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."cross_tenant_access_grants_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."cross_tenant_access_grants_projection" TO "service_role";



GRANT SELECT ON TABLE "public"."emails_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."emails_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."users" TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."impersonation_sessions_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."impersonation_sessions_projection" TO "service_role";



GRANT SELECT ON TABLE "public"."invitations_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."invitations_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."organization_business_profiles_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."organization_business_profiles_projection" TO "service_role";



GRANT SELECT ON TABLE "public"."organization_emails" TO "service_role";
GRANT SELECT ON TABLE "public"."organization_emails" TO "authenticated";



GRANT SELECT ON TABLE "public"."organizations_projection" TO "supabase_auth_admin";
GRANT SELECT ON TABLE "public"."organizations_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."organizations_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."permissions_projection" TO "supabase_auth_admin";
GRANT SELECT ON TABLE "public"."permissions_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."permissions_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."phones_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."phones_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."role_permission_templates" TO "service_role";
GRANT SELECT ON TABLE "public"."role_permission_templates" TO "authenticated";



GRANT SELECT ON TABLE "public"."role_permissions_projection" TO "supabase_auth_admin";
GRANT SELECT ON TABLE "public"."role_permissions_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."role_permissions_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."roles_projection" TO "supabase_auth_admin";
GRANT SELECT ON TABLE "public"."roles_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."roles_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."user_roles_projection" TO "supabase_auth_admin";
GRANT SELECT ON TABLE "public"."user_roles_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."user_roles_projection" TO "service_role";



GRANT SELECT ON TABLE "public"."workflow_queue_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."workflow_queue_projection" TO "authenticated";


































