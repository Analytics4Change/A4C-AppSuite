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
    'stakeholder'
);


ALTER TYPE "public"."contact_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."contact_type" IS 'Classification of contact persons: a4c_admin, billing, technical, emergency, stakeholder';



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

  -- Collect all active descendants that will be affected by cascade deactivation
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
      'affected_descendants', v_affected_descendants,
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
  SELECT COUNT(*) INTO v_role_count
  FROM user_roles_projection ur
  WHERE ur.scope_path IS NOT NULL
    AND ur.scope_path <@ v_existing.path
    AND ur.deleted_at IS NULL;

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



CREATE OR REPLACE FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_stream_version" integer, "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Insert domain event into public.domain_events table
  -- SECURITY DEFINER allows this to bypass RLS policies
  INSERT INTO public.domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    created_at
  )
  VALUES (
    p_stream_id,
    p_stream_type,
    p_stream_version,
    p_event_type,
    p_event_data,
    p_event_metadata,
    NOW()
  )
  RETURNING id INTO v_event_id;

  -- Return the generated event ID for correlation
  RETURN v_event_id;
END;
$$;


ALTER FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_stream_version" integer, "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_stream_version" integer, "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") IS 'Wrapper function for emitting domain events from Edge Functions via PostgREST API.
   Uses SECURITY DEFINER to bypass RLS policies on domain_events table.

   Usage from Edge Function:
   const { data: eventId, error } = await supabaseAdmin.rpc("emit_domain_event", {
     p_stream_id: organizationId,
     p_stream_type: "organization",
     p_stream_version: 1,
     p_event_type: "organization.bootstrap.initiated",
     p_event_data: {...},
     p_event_metadata: {...}
   });

   Returns: UUID of the created event
   Throws: PostgreSQL error if validation fails (event_type format, unique constraint, etc.)';



CREATE OR REPLACE FUNCTION "api"."emit_domain_event"("p_event_id" "uuid", "p_event_type" "text", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_event_data" "jsonb", "p_event_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Insert event into domain_events table
  -- Map parameters to actual column names:
  --   event_id -> id
  --   aggregate_id -> stream_id
  --   aggregate_type -> stream_type
  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    p_event_id,
    p_aggregate_id,
    p_aggregate_type,
    (
      SELECT COALESCE(MAX(stream_version), 0) + 1
      FROM domain_events
      WHERE stream_id = p_aggregate_id
        AND stream_type = p_aggregate_type
    ),
    p_event_type,
    p_event_data,
    p_event_metadata
  )
  ON CONFLICT (id) DO NOTHING;  -- Idempotent

  RETURN p_event_id;
END;
$$;


ALTER FUNCTION "api"."emit_domain_event"("p_event_id" "uuid", "p_event_type" "text", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_event_data" "jsonb", "p_event_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."emit_domain_event"("p_event_id" "uuid", "p_event_type" "text", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_event_data" "jsonb", "p_event_metadata" "jsonb") IS 'Emit domain event into domain_events table. Used by Temporal workflow activities. Function in api schema for PostgREST RPC access.';



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



CREATE OR REPLACE FUNCTION "api"."get_bootstrap_status"("p_bootstrap_id" "uuid") RETURNS TABLE("bootstrap_id" "uuid", "organization_id" "uuid", "status" "text", "current_stage" "text", "error_message" "text", "created_at" timestamp with time zone, "completed_at" timestamp with time zone, "domain" "text", "dns_configured" boolean, "invitations_sent" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user from JWT (P1 #5: Authorization check)
  v_user_id := auth.uid();

  -- Allow access if:
  -- 1. User is super_admin (global access)
  -- 2. User has a role in the organization being queried
  -- 3. User initiated the bootstrap (found in event metadata)
  IF v_user_id IS NOT NULL THEN
    IF NOT (
      -- Super admin can view any organization
      EXISTS (
        SELECT 1 FROM user_roles_projection ur
        JOIN roles_projection r ON r.id = ur.role_id
        WHERE ur.user_id = v_user_id
          AND r.name = 'super_admin'
          AND ur.organization_id IS NULL
      )
      OR
      -- User has role in the organization being queried
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


COMMENT ON FUNCTION "api"."get_bootstrap_status"("p_bootstrap_id" "uuid") IS 'API wrapper for get_bootstrap_status with authorization check. Returns empty result if user is not authorized.';



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



CREATE OR REPLACE FUNCTION "api"."get_invitation_by_token"("p_token" "text") RETURNS TABLE("id" "uuid", "token" "text", "email" "text", "organization_id" "uuid", "organization_name" "text", "role" "text", "status" "text", "expires_at" timestamp with time zone, "accepted_at" timestamp with time zone)
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
    i.role,
    i.status,
    i.expires_at,
    i.accepted_at
  FROM public.invitations_projection i
  LEFT JOIN public.organizations_projection o ON o.id = i.organization_id
  WHERE i.token = p_token;
END;
$$;


ALTER FUNCTION "api"."get_invitation_by_token"("p_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") IS 'Get invitation details by token for validation. Called by accept-invitation Edge Function.';



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
      'path', v_existing.path::TEXT
    ),
    jsonb_build_object(
      'source', 'api.reactivate_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Reactivated organization unit "%s" - role assignments now allowed', v_existing.name),
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
    )
  );
END;
$$;


ALTER FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") IS 'Frontend RPC: Unfreeze organizational unit. Emits organization_unit.reactivated event (CQRS).';



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
  -- Get user's scope_path
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

  IF p_name IS NOT NULL AND p_name != v_existing.name THEN
    v_updated_fields := v_updated_fields || 'name';
    v_previous_values := v_previous_values || jsonb_build_object('name', v_existing.name);
  END IF;

  IF p_display_name IS NOT NULL AND p_display_name != v_existing.display_name THEN
    v_updated_fields := v_updated_fields || 'display_name';
    v_previous_values := v_previous_values || jsonb_build_object('display_name', v_existing.display_name);
  END IF;

  IF p_timezone IS NOT NULL AND p_timezone != v_existing.timezone THEN
    v_updated_fields := v_updated_fields || 'timezone';
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

  -- CQRS: Emit organization_unit.updated event (no direct projection write)
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
      'updated_fields', to_jsonb(v_updated_fields),
      'previous_values', v_previous_values
    ),
    jsonb_build_object(
      'source', 'api.update_organization_unit',
      'user_id', get_current_user_id(),
      'reason', format('Updated organization unit fields: %s', array_to_string(v_updated_fields, ', ')),
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


COMMENT ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") IS 'Frontend RPC: Update organizational unit metadata. Emits organization_unit.updated event (CQRS).';



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
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization and role information
  SELECT
    u.current_organization_id,
    COALESCE(
      (SELECT r.name
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
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
       WHERE ur.user_id = u.id
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
  INTO v_org_id, v_user_role, v_scope_path
  FROM public.users u
  WHERE u.id = v_user_id;

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
    -- Get permissions via role grants
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM public.user_roles_projection ur
    JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN public.permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.organization_id = v_org_id OR ur.organization_id IS NULL);
  END IF;

  -- Default to empty array if no permissions
  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims by merging with existing claims
  -- CRITICAL: Preserve all standard JWT fields (aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous)
  -- and add our custom claims (org_id, org_type, user_role, permissions, scope_path, claims_version)
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'claims_version', 1
  );

  -- Return the updated claims object
  -- Supabase Auth expects: { "claims": { ... all standard JWT fields + custom fields ... } }
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
        'claims_error', SQLERRM
      )
    );
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") IS 'Enriches Supabase Auth JWTs with custom claims: org_id, org_type, user_role, permissions, scope_path. Called automatically on token generation.';



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
            p_stream_version := 1,
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
                'cleanup_actions', to_jsonb(ARRAY['partial_resource_cleanup']),
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


COMMENT ON FUNCTION "public"."handle_bootstrap_workflow"() IS 'Trigger function that handles cleanup for failed bootstrap events emitted by Temporal workflows';



CREATE OR REPLACE FUNCTION "public"."has_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_scope" "text" DEFAULT 'full_org'::"text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM cross_tenant_access_grants_projection 
    WHERE consultant_org_id = p_consultant_org_id
      AND provider_org_id = p_provider_org_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (p_user_id IS NULL OR consultant_user_id IS NULL OR consultant_user_id = p_user_id)
      AND (scope = p_scope OR scope = 'full_org') -- full_org grants access to everything
  );
END;
$$;


ALTER FUNCTION "public"."has_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid", "p_scope" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid", "p_scope" "text") IS 'Checks if specific cross-tenant access is currently granted';



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



CREATE OR REPLACE FUNCTION "public"."has_permission"("p_permission" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT p_permission = ANY(get_current_permissions());
$$;


ALTER FUNCTION "public"."has_permission"("p_permission" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permission"("p_permission" "text") IS 'Checks if current user has a specific permission in their JWT claims';



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



CREATE OR REPLACE FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name IN ('provider_admin', 'partner_admin')
      AND ur.organization_id = p_org_id
      AND r.deleted_at IS NULL
  );
$$;


ALTER FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Returns true if user has provider_admin or partner_admin role in the specified organization';



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



CREATE OR REPLACE FUNCTION "public"."is_super_admin"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'super_admin'
      AND ur.organization_id IS NULL
  );
END;
$$;


ALTER FUNCTION "public"."is_super_admin"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_super_admin"("p_user_id" "uuid") IS 'Checks if user has super_admin role with global scope';



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



CREATE OR REPLACE FUNCTION "public"."process_client_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'client.created' THEN
      INSERT INTO clients (
        id,
        organization_id,
        first_name,
        last_name,
        date_of_birth,
        status,
        created_by,
        metadata
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_date(p_event.event_data, 'date_of_birth'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'status'), 'active'),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB)
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'client.updated' THEN
      UPDATE clients
      SET
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        date_of_birth = COALESCE(safe_jsonb_extract_date(p_event.event_data, 'date_of_birth'), date_of_birth),
        metadata = metadata || COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.discharged' THEN
      UPDATE clients
      SET
        discharge_date = safe_jsonb_extract_date(p_event.event_data, 'discharge_date'),
        status = 'inactive',
        metadata = metadata || jsonb_build_object(
          'discharge_reason', safe_jsonb_extract_text(p_event.event_data, 'discharge_reason'),
          'discharge_notes', safe_jsonb_extract_text(p_event.event_data, 'notes')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.archived' THEN
      UPDATE clients
      SET
        status = 'archived',
        metadata = metadata || jsonb_build_object(
          'archive_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'archived_at', p_event.created_at
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown client event type: %', p_event.event_type;
  END CASE;

  -- NOTE: audit_log INSERT removed (2025-12-22)
  -- domain_events table serves as the authoritative audit trail
END;
$$;


ALTER FUNCTION "public"."process_client_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_client_event"("p_event" "record") IS 'Projects client events to the clients table. Audit trail is in domain_events.';



CREATE OR REPLACE FUNCTION "public"."process_contact_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
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

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_contact_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_contact_event"("p_event" "record") IS 'Main contact event processor - handles creation, updates, and soft deletion with CQRS projections';



CREATE OR REPLACE FUNCTION "public"."process_domain_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  v_start_time := clock_timestamp();

  -- Skip if already processed
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Check for junction events first (based on event_type pattern)
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      -- Route based on stream type
      CASE NEW.stream_type
        WHEN 'client' THEN
          PERFORM process_client_event(NEW);

        WHEN 'medication' THEN
          PERFORM process_medication_event(NEW);

        WHEN 'medication_history' THEN
          PERFORM process_medication_history_event(NEW);

        WHEN 'dosage' THEN
          PERFORM process_dosage_event(NEW);

        WHEN 'user' THEN
          PERFORM process_user_event(NEW);

        WHEN 'organization' THEN
          PERFORM process_organization_event(NEW);

        WHEN 'organization_unit' THEN
          PERFORM process_organization_unit_event(NEW);

        -- Organization child entities
        WHEN 'contact' THEN
          PERFORM process_contact_event(NEW);

        WHEN 'address' THEN
          PERFORM process_address_event(NEW);

        WHEN 'phone' THEN
          PERFORM process_phone_event(NEW);

        -- Invitation stream type
        WHEN 'invitation' THEN
          PERFORM process_invitation_event(NEW);

        -- RBAC stream types
        WHEN 'permission' THEN
          PERFORM process_rbac_event(NEW);

        WHEN 'role' THEN
          PERFORM process_rbac_event(NEW);

        WHEN 'access_grant' THEN
          PERFORM process_access_grant_event(NEW);

        -- Impersonation stream type
        WHEN 'impersonation' THEN
          PERFORM process_impersonation_event(NEW);

        ELSE
          RAISE WARNING 'Unknown stream type: %', NEW.stream_type;
      END CASE;
    END IF;

    -- Mark as successfully processed
    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

    -- Log processing time if it took too long (>100ms)
    IF (clock_timestamp() - v_start_time) > interval '100 milliseconds' THEN
      RAISE WARNING 'Event % took % to process',
        NEW.id,
        (clock_timestamp() - v_start_time);
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      -- Capture error details
      GET STACKED DIAGNOSTICS
        v_error_msg = MESSAGE_TEXT,
        v_error_detail = PG_EXCEPTION_DETAIL;

      -- Log error
      RAISE WARNING 'Failed to process event %: % - %',
        NEW.id,
        v_error_msg,
        v_error_detail;

      -- Update event with error info
      NEW.processing_error = format('Error: %s | Detail: %s', v_error_msg, v_error_detail);
      NEW.retry_count = COALESCE(NEW.retry_count, 0) + 1;

      -- Don't mark as processed so it can be retried
      NEW.processed_at = NULL;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."process_domain_event"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_domain_event"() IS 'Main router that processes domain events and projects them to 3NF tables';



CREATE OR REPLACE FUNCTION "public"."process_dosage_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'medication.administered' THEN
      INSERT INTO dosage_info (
        id,
        organization_id,
        medication_history_id,
        client_id,
        scheduled_datetime,
        administered_datetime,
        administered_by,
        scheduled_amount,
        administered_amount,
        unit,
        status,
        administration_notes,
        vitals_before,
        vitals_after,
        side_effects_observed,
        metadata,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_history_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'scheduled_datetime'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'administered_at'),
        safe_jsonb_extract_uuid(p_event.event_data, 'administered_by'),
        (p_event.event_data->>'scheduled_amount')::DECIMAL,
        (p_event.event_data->>'administered_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'unit'),
        'administered',
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        p_event.event_data->'vitals_before',
        p_event.event_data->'vitals_after',
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'side_effects', '[]'::JSONB)
        )),
        jsonb_build_object(
          'administration_method', safe_jsonb_extract_text(p_event.event_data, 'method'),
          'witness', safe_jsonb_extract_text(p_event.event_data, 'witnessed_by')
        ),
        p_event.created_at
      );

    WHEN 'medication.skipped', 'medication.refused' THEN
      INSERT INTO dosage_info (
        id,
        organization_id,
        medication_history_id,
        client_id,
        scheduled_datetime,
        scheduled_amount,
        unit,
        status,
        skip_reason,
        refusal_reason,
        metadata,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_history_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'scheduled_datetime'),
        (p_event.event_data->>'scheduled_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'unit'),
        CASE p_event.event_type
          WHEN 'medication.skipped' THEN 'skipped'
          WHEN 'medication.refused' THEN 'refused'
        END,
        safe_jsonb_extract_text(p_event.event_data, 'skip_reason'),
        safe_jsonb_extract_text(p_event.event_data, 'refusal_reason'),
        jsonb_build_object(
          'recorded_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
          'reason_details', safe_jsonb_extract_text(p_event.event_metadata, 'reason')
        ),
        p_event.created_at
      );

    ELSE
      RAISE WARNING 'Unknown dosage event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_dosage_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_dosage_event"("p_event" "record") IS 'Projects administration events to the dosage_info table';



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



CREATE OR REPLACE FUNCTION "public"."process_invitation_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_role_id UUID;
  v_org_path LTREE;
  v_role_name TEXT;
BEGIN
  CASE p_event.event_type

    -- invitation.accepted
    WHEN 'invitation.accepted' THEN
      v_role_name := p_event.event_data->>'role';

      -- Mark invitation as accepted
      -- NOTE: Use stream_id (the invitation row id) not event_data.invitation_id
      UPDATE invitations_projection
      SET
        status = 'accepted',
        accepted_at = (p_event.event_data->>'accepted_at')::TIMESTAMPTZ,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      -- Get organization path for role scope
      SELECT path INTO v_org_path
      FROM organizations_projection
      WHERE id = (p_event.event_data->>'org_id')::UUID;

      -- Look up role by name for this organization
      IF v_role_name = 'super_admin' THEN
        SELECT id INTO v_role_id
        FROM roles_projection
        WHERE name = 'super_admin'
          AND organization_id IS NULL;
      ELSE
        SELECT id INTO v_role_id
        FROM roles_projection
        WHERE name = v_role_name
          AND organization_id = (p_event.event_data->>'org_id')::UUID;
      END IF;

      -- If role doesn't exist, create it
      IF v_role_id IS NULL THEN
        v_role_id := gen_random_uuid();

        IF v_role_name = 'super_admin' THEN
          INSERT INTO roles_projection (
            id, name, description, organization_id, org_hierarchy_scope,
            is_active, created_at, updated_at
          ) VALUES (
            v_role_id,
            'super_admin',
            'Platform super administrator with global access',
            NULL,
            NULL,
            true,
            p_event.created_at,
            p_event.created_at
          )
          ON CONFLICT (name, organization_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
          RETURNING id INTO v_role_id;

          RAISE NOTICE 'Created/found system role super_admin with ID %', v_role_id;
        ELSE
          INSERT INTO roles_projection (
            id, name, description, organization_id, org_hierarchy_scope,
            is_active, created_at, updated_at
          ) VALUES (
            v_role_id,
            v_role_name,
            format('%s role for organization', initcap(replace(v_role_name, '_', ' '))),
            (p_event.event_data->>'org_id')::UUID,
            v_org_path,
            true,
            p_event.created_at,
            p_event.created_at
          )
          ON CONFLICT (name, organization_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
          RETURNING id INTO v_role_id;

          RAISE NOTICE 'Created/found role % with ID % for org %', v_role_name, v_role_id, p_event.event_data->>'org_id';
        END IF;
      END IF;

      -- Create role assignment in user_roles_projection
      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        organization_id,
        scope_path,
        assigned_at
      ) VALUES (
        (p_event.event_data->>'user_id')::UUID,
        v_role_id,
        (p_event.event_data->>'org_id')::UUID,
        v_org_path,
        p_event.created_at
      )
      ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO NOTHING;

      -- Update user's roles array in users shadow table
      UPDATE users
      SET
        roles = ARRAY(
          SELECT DISTINCT unnest(COALESCE(roles, '{}') || ARRAY[v_role_name])
        ),
        accessible_organizations = ARRAY(
          SELECT DISTINCT unnest(COALESCE(accessible_organizations, '{}') || ARRAY[(p_event.event_data->>'org_id')::UUID])
        ),
        current_organization_id = COALESCE(current_organization_id, (p_event.event_data->>'org_id')::UUID),
        updated_at = p_event.created_at
      WHERE id = (p_event.event_data->>'user_id')::UUID;

    -- invitation.revoked
    WHEN 'invitation.revoked' THEN
      UPDATE invitations_projection
      SET
        status = 'deleted',
        updated_at = (p_event.event_data->>'revoked_at')::TIMESTAMPTZ
      WHERE id = p_event.stream_id
        AND status = 'pending';

    -- invitation.expired
    WHEN 'invitation.expired' THEN
      UPDATE invitations_projection
      SET
        status = 'expired',
        updated_at = (p_event.event_data->>'expired_at')::TIMESTAMPTZ
      WHERE id = p_event.stream_id
        AND status = 'pending';

    ELSE
      RAISE WARNING 'Unknown invitation event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_invitation_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_invitation_event"("p_event" "record") IS 'Router-based processor for invitation lifecycle events (accepted, revoked, expired). Handles role assignment on acceptance. Fixed 2025-12-22 to use stream_id instead of invitation_id.';



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


COMMENT ON FUNCTION "public"."process_junction_event"("p_event" "record") IS 'Main junction event processor - handles link/unlink for all 6 junction table types (org-contact, org-address, org-phone, contact-phone, contact-address, phone-address)';



CREATE OR REPLACE FUNCTION "public"."process_medication_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'medication.added_to_formulary' THEN
      INSERT INTO medications (
        id,
        organization_id,
        name,
        generic_name,
        brand_names,
        rxnorm_cui,
        ndc_codes,
        category_broad,
        category_specific,
        drug_class,
        is_psychotropic,
        is_controlled,
        controlled_substance_schedule,
        is_narcotic,
        requires_monitoring,
        is_high_alert,
        active_ingredients,
        available_forms,
        available_strengths,
        manufacturer,
        warnings,
        black_box_warning,
        metadata,
        is_active,
        is_formulary,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'generic_name'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'brand_names', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'rxnorm_cui'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'ndc_codes', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'category_broad'),
        safe_jsonb_extract_text(p_event.event_data, 'category_specific'),
        safe_jsonb_extract_text(p_event.event_data, 'drug_class'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_psychotropic', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_controlled', false),
        safe_jsonb_extract_text(p_event.event_data, 'controlled_substance_schedule'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_narcotic', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'requires_monitoring', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_high_alert', false),
        COALESCE(p_event.event_data->'active_ingredients', '[]'::JSONB),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'available_forms', '[]'::JSONB)
        )),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'available_strengths', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'manufacturer'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'warnings', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'black_box_warning'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        true,
        true,
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'medication.updated' THEN
      -- Apply updates to medication catalog
      UPDATE medications
      SET
        name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'name'),
          name
        ),
        warnings = CASE
          WHEN p_event.event_data ? 'warnings' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'warnings'))
          ELSE warnings
        END,
        black_box_warning = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'black_box_warning'),
          black_box_warning
        ),
        is_formulary = COALESCE(
          safe_jsonb_extract_boolean(p_event.event_data, 'is_formulary'),
          is_formulary
        ),
        metadata = metadata || COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.removed_from_formulary' THEN
      UPDATE medications
      SET
        is_formulary = false,
        is_active = false,
        metadata = metadata || jsonb_build_object(
          'removal_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'removed_at', p_event.created_at
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown medication event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_medication_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_medication_event"("p_event" "record") IS 'Projects medication catalog events to the medications table';



CREATE OR REPLACE FUNCTION "public"."process_medication_history_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'medication.prescribed' THEN
      INSERT INTO medication_history (
        id,
        organization_id,
        client_id,
        medication_id,
        prescription_date,
        start_date,
        end_date,
        prescriber_name,
        prescriber_npi,
        prescriber_license,
        dosage_amount,
        dosage_unit,
        dosage_form,
        frequency,
        timings,
        food_conditions,
        special_restrictions,
        route,
        instructions,
        is_prn,
        prn_reason,
        status,
        refills_authorized,
        refills_used,
        pharmacy_name,
        pharmacy_phone,
        rx_number,
        inventory_quantity,
        inventory_unit,
        notes,
        metadata,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_id'),
        safe_jsonb_extract_date(p_event.event_data, 'prescription_date'),
        safe_jsonb_extract_date(p_event.event_data, 'start_date'),
        safe_jsonb_extract_date(p_event.event_data, 'end_date'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_name'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_npi'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_license'),
        (p_event.event_data->>'dosage_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'dosage_unit'),
        safe_jsonb_extract_text(p_event.event_data, 'dosage_form'),
        CASE
          WHEN jsonb_typeof(p_event.event_data->'frequency') = 'array'
          THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'frequency')), ', ')
          ELSE safe_jsonb_extract_text(p_event.event_data, 'frequency')
        END,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'timings', '[]'::JSONB))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'food_conditions', '[]'::JSONB))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'special_restrictions', '[]'::JSONB))),
        safe_jsonb_extract_text(p_event.event_data, 'route'),
        safe_jsonb_extract_text(p_event.event_data, 'instructions'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_prn', false),
        safe_jsonb_extract_text(p_event.event_data, 'prn_reason'),
        'active',
        COALESCE((p_event.event_data->>'refills_authorized')::INTEGER, 0),
        0,
        safe_jsonb_extract_text(p_event.event_data, 'pharmacy_name'),
        safe_jsonb_extract_text(p_event.event_data, 'pharmacy_phone'),
        safe_jsonb_extract_text(p_event.event_data, 'rx_number'),
        COALESCE((p_event.event_data->>'inventory_quantity')::DECIMAL, 0),
        safe_jsonb_extract_text(p_event.event_data, 'inventory_unit'),
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        jsonb_build_object(
          'prescription_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'approvals', p_event.event_metadata->'approval_chain',
          'medication_name', safe_jsonb_extract_text(p_event.event_data, 'medication_name'),
          'source', safe_jsonb_extract_text(p_event.event_metadata, 'source'),
          'controlled_substance', safe_jsonb_extract_boolean(p_event.event_metadata, 'controlled_substance', false),
          'therapeutic_purpose', safe_jsonb_extract_text(p_event.event_metadata, 'therapeutic_purpose')
        ),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'medication.refilled' THEN
      UPDATE medication_history
      SET
        refills_used = refills_used + 1,
        last_filled_date = safe_jsonb_extract_date(p_event.event_data, 'filled_date'),
        pharmacy_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'pharmacy_name'),
          pharmacy_name
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.discontinued' THEN
      UPDATE medication_history
      SET
        discontinue_date = safe_jsonb_extract_date(p_event.event_data, 'discontinue_date'),
        discontinue_reason = safe_jsonb_extract_text(p_event.event_data, 'reason'),
        status = 'discontinued',
        metadata = metadata || jsonb_build_object(
          'discontinue_details', p_event.event_metadata,
          'discontinued_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.modified' THEN
      -- Handle dosage or frequency changes
      UPDATE medication_history
      SET
        dosage_amount = COALESCE(
          (p_event.event_data->>'dosage_amount')::DECIMAL,
          dosage_amount
        ),
        dosage_unit = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'dosage_unit'),
          dosage_unit
        ),
        frequency = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'frequency'),
          frequency
        ),
        instructions = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'instructions'),
          instructions
        ),
        metadata = metadata || jsonb_build_object(
          'modification_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'modified_at', p_event.created_at,
          'modified_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown medication history event type: %', p_event.event_type;
  END CASE;

  -- Record in audit log
  INSERT INTO audit_log (
    organization_id,
    event_type,
    event_category,
    event_name,
    event_description,
    user_id,
    resource_type,
    resource_id,
    new_values,
    metadata
  ) VALUES (
    safe_jsonb_extract_organization_id(p_event.event_data),
    p_event.event_type,
    'medication_management',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    'medication_history',
    p_event.stream_id,
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$;


ALTER FUNCTION "public"."process_medication_history_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_medication_history_event"("p_event" "record") IS 'Projects prescription events to the medication_history table';



CREATE OR REPLACE FUNCTION "public"."process_organization_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_depth INTEGER;
  v_parent_type TEXT;
  v_deleted_path LTREE;
  v_role_record RECORD;
  v_child_org RECORD;
BEGIN
  CASE p_event.event_type
    
    -- Handle organization creation
    WHEN 'organization.created' THEN
      v_depth := nlevel((p_event.event_data->>'path')::LTREE);
      
      -- For sub-organizations, inherit parent type
      IF v_depth > 2 AND p_event.event_data->>'parent_path' IS NOT NULL THEN
        SELECT type INTO v_parent_type
        FROM organizations_projection 
        WHERE path = (p_event.event_data->>'parent_path')::LTREE;
        
        -- Override type with parent type for inheritance
        p_event.event_data := jsonb_set(p_event.event_data, '{type}', to_jsonb(v_parent_type));
      END IF;
      
      -- Insert into organizations projection
      -- Note: depth column is auto-generated from path via PostgreSQL generated column
      INSERT INTO organizations_projection (
        id, name, display_name, slug, type, path, parent_path,
        tax_number, phone_number, timezone, metadata, created_at,
        partner_type, referring_partner_id, subdomain_status
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
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
            safe_jsonb_extract_text(p_event.event_data, 'type'),
            CASE
              WHEN p_event.event_data ? 'partner_type'
              THEN (safe_jsonb_extract_text(p_event.event_data, 'partner_type'))::partner_type
              ELSE NULL
            END
          )
          THEN 'pending'::subdomain_status
          ELSE NULL
        END
      );

    -- Handle subdomain DNS record creation
    WHEN 'organization.subdomain.dns_created' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'verifying',
        cloudflare_record_id = safe_jsonb_extract_text(p_event.event_data, 'cloudflare_record_id'),
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{dns_record}',
          jsonb_build_object(
            'type', safe_jsonb_extract_text(p_event.event_data, 'dns_record_type'),
            'value', safe_jsonb_extract_text(p_event.event_data, 'dns_record_value'),
            'zone_id', safe_jsonb_extract_text(p_event.event_data, 'cloudflare_zone_id'),
            'created_at', p_event.created_at
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle successful subdomain verification
    WHEN 'organization.subdomain.verified' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'verified',
        dns_verified_at = (p_event.event_data->>'verified_at')::TIMESTAMPTZ,
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{verification}',
          jsonb_build_object(
            'method', safe_jsonb_extract_text(p_event.event_data, 'verification_method'),
            'attempts', (p_event.event_data->>'verification_attempts')::INTEGER,
            'verified_at', p_event.event_data->>'verified_at'
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle subdomain verification failure
    WHEN 'organization.subdomain.verification_failed' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'failed',
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{failure}',
          jsonb_build_object(
            'reason', safe_jsonb_extract_text(p_event.event_data, 'failure_reason'),
            'retry_count', (p_event.event_data->>'retry_count')::INTEGER,
            'will_retry', safe_jsonb_extract_boolean(p_event.event_data, 'will_retry'),
            'failed_at', p_event.created_at
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle business profile creation
    WHEN 'organization.business_profile.created' THEN
      INSERT INTO organization_business_profiles_projection (
        organization_id, organization_type, mailing_address, physical_address,
        provider_profile, partner_profile, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'organization_type'),
        p_event.event_data->'mailing_address',
        p_event.event_data->'physical_address',
        CASE 
          WHEN safe_jsonb_extract_text(p_event.event_data, 'organization_type') = 'provider'
          THEN p_event.event_data->'provider_profile'
          ELSE NULL
        END,
        CASE 
          WHEN safe_jsonb_extract_text(p_event.event_data, 'organization_type') = 'provider_partner'
          THEN p_event.event_data->'partner_profile'
          ELSE NULL
        END,
        p_event.created_at
      );

    -- Handle organization deactivation
    WHEN 'organization.deactivated' THEN
      -- Update organization status
      UPDATE organizations_projection 
      SET 
        is_active = false,
        deactivated_at = p_event.created_at,
        deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'deactivation_type'),
        updated_at = p_event.created_at
      WHERE 
        id = p_event.stream_id
        OR (
          safe_jsonb_extract_boolean(p_event.event_data, 'cascade_to_children')
          AND path <@ (SELECT path FROM organizations_projection WHERE id = p_event.stream_id)
        );

      -- If login is blocked, emit user session termination events
      IF safe_jsonb_extract_boolean(p_event.event_data, 'login_blocked') THEN
        -- This would emit user.session.terminated events
        -- Implementation depends on user session management system
        RAISE NOTICE 'Login blocked for organization %, would terminate user sessions', p_event.stream_id;
      END IF;

    -- Handle organization deletion (CQRS-compliant cascade via events)
    WHEN 'organization.deleted' THEN
      v_deleted_path := (p_event.event_data->>'deleted_path')::LTREE;
      
      -- Mark organization as deleted (logical delete)
      UPDATE organizations_projection 
      SET 
        deleted_at = p_event.created_at,
        deletion_reason = safe_jsonb_extract_text(p_event.event_data, 'deletion_strategy'),
        is_active = false,
        updated_at = p_event.created_at
      WHERE path::LTREE <@ v_deleted_path OR path = v_deleted_path;

      -- CQRS-COMPLIANT CASCADE: Emit role.deleted events for affected roles
      -- Only emit events, do NOT directly update role projections
      FOR v_role_record IN (
        SELECT id, name, org_hierarchy_scope 
        FROM roles_projection 
        WHERE 
          org_hierarchy_scope::LTREE <@ v_deleted_path         -- At or below deleted path
          OR v_deleted_path <@ org_hierarchy_scope::LTREE      -- Deleted path is child of role scope
      ) LOOP
        INSERT INTO domain_events (
          stream_id, stream_type, event_type, event_data, event_metadata, created_at
        ) VALUES (
          v_role_record.id,
          'role',
          'role.deleted',
          jsonb_build_object(
            'role_name', v_role_record.name,
            'org_hierarchy_scope', v_role_record.org_hierarchy_scope,
            'deletion_reason', 'organization_deleted',
            'organization_deletion_event_id', p_event.id
          ),
          jsonb_build_object(
            'user_id', p_event.event_metadata->>'user_id',
            'reason', format('Role %s deleted because organizational scope %s was deleted', 
                            v_role_record.name, v_role_record.org_hierarchy_scope),
            'automated', true
          ),
          p_event.created_at
        );
      END LOOP;

      -- Emit organization.deleted events for child organizations
      FOR v_child_org IN (
        SELECT id, path
        FROM organizations_projection
        WHERE path <@ v_deleted_path AND path != v_deleted_path AND deleted_at IS NULL
      ) LOOP
        INSERT INTO domain_events (
          stream_id, stream_type, event_type, event_data, event_metadata, created_at
        ) VALUES (
          v_child_org.id,
          'organization',
          'organization.deleted',
          jsonb_build_object(
            'organization_id', v_child_org.id,
            'deleted_path', v_child_org.path,
            'deletion_strategy', 'cascade_delete',
            'cascade_confirmed', true,
            'parent_deletion_event_id', p_event.id
          ),
          jsonb_build_object(
            'user_id', p_event.event_metadata->>'user_id',
            'reason', format('Child organization %s deleted due to parent organization deletion', v_child_org.path),
            'automated', true
          ),
          p_event.created_at
        );
      END LOOP;

    -- Handle organization reactivation
    WHEN 'organization.reactivated' THEN
      UPDATE organizations_projection 
      SET 
        is_active = true,
        deactivated_at = NULL,
        deactivation_reason = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle organization updates
    WHEN 'organization.updated' THEN
      UPDATE organizations_projection 
      SET 
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
        phone_number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'phone_number'), phone_number),
        timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle business profile updates
    WHEN 'organization.business_profile.updated' THEN
      UPDATE organization_business_profiles_projection 
      SET 
        mailing_address = COALESCE(p_event.event_data->'mailing_address', mailing_address),
        physical_address = COALESCE(p_event.event_data->'physical_address', physical_address),
        provider_profile = CASE 
          WHEN organization_type = 'provider' 
          THEN COALESCE(p_event.event_data->'provider_profile', provider_profile)
          ELSE provider_profile
        END,
        partner_profile = CASE 
          WHEN organization_type = 'provider_partner'
          THEN COALESCE(p_event.event_data->'partner_profile', partner_profile)
          ELSE partner_profile
        END,
        updated_at = p_event.created_at
      WHERE organization_id = p_event.stream_id;

    -- Handle bootstrap events (CQRS-compliant - no direct DB operations)
    WHEN 'organization.bootstrap.initiated' THEN
      -- Bootstrap initiation: Log and prepare for next stages
      -- Note: This event triggers the bootstrap orchestrator externally
      RAISE NOTICE 'Bootstrap initiated for org %, bootstrap_id: %',
        p_event.stream_id,
        p_event.event_data->>'bootstrap_id';

    WHEN 'organization.bootstrap.completed' THEN
      -- Bootstrap completion: Update organization metadata
      UPDATE organizations_projection 
      SET 
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{bootstrap}',
          jsonb_build_object(
            'bootstrap_id', p_event.event_data->>'bootstrap_id',
            'completed_at', p_event.created_at,
            'admin_role', p_event.event_data->>'admin_role_assigned',
            'permissions_granted', (p_event.event_data->>'permissions_granted')::INTEGER
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'organization.bootstrap.failed' THEN
      -- Bootstrap failure: Mark organization for cleanup if created
      UPDATE organizations_projection 
      SET 
        is_active = false,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{bootstrap}',
          jsonb_build_object(
            'bootstrap_id', p_event.event_data->>'bootstrap_id',
            'failed_at', p_event.created_at,
            'failure_stage', p_event.event_data->>'failure_stage',
            'error_message', p_event.event_data->>'error_message'
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'organization.bootstrap.cancelled' THEN
      -- Bootstrap cancellation: Final cleanup completed
      -- For cancelled bootstraps, organization may not exist in projection yet
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
    -- user.invited
    -- ========================================
    -- User invited to organization (emitted by GenerateInvitationsActivity)
    -- Creates invitation record in invitations_projection
    -- NOTE: This event has stream_type='organization' because the invitation
    --       is conceptually part of the organization's bootstrap process
    WHEN 'user.invited' THEN
      INSERT INTO invitations_projection (
        invitation_id,
        organization_id,
        email,
        first_name,
        last_name,
        role,
        token,
        expires_at,
        status,
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
        safe_jsonb_extract_text(p_event.event_data, 'token'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        'pending',
        COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')),
          '{}'::TEXT[]
        ),
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (invitation_id) DO NOTHING;  -- Idempotent

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_organization_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_organization_event"("p_event" "record") IS 'Main organization event processor - handles creation, updates, deactivation, deletion with CQRS-compliant cascade logic';



CREATE OR REPLACE FUNCTION "public"."process_organization_unit_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_organization_id UUID;
BEGIN
  CASE p_event.event_type

    -- ========================================
    -- organization_unit.created
    -- ========================================
    -- New organization unit created within a provider hierarchy
    -- Requires: name, slug, path, parent_path, organization_id
    WHEN 'organization_unit.created' THEN
      -- Validate that parent path exists (either in organizations_projection or organization_units_projection)
      IF NOT EXISTS (
        SELECT 1 FROM organizations_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
        UNION ALL
        SELECT 1 FROM organization_units_projection WHERE path = (p_event.event_data->>'parent_path')::LTREE
      ) THEN
        RAISE WARNING 'Parent path % does not exist for organization unit %',
          p_event.event_data->>'parent_path', p_event.stream_id;
        -- Continue anyway - event may be replayed after parent exists
      END IF;

      -- Insert into organization units projection with ON CONFLICT for idempotency
      INSERT INTO organization_units_projection (
        id,
        organization_id,
        name,
        display_name,
        slug,
        path,
        parent_path,
        timezone,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        (p_event.event_data->>'path')::LTREE,
        (p_event.event_data->>'parent_path')::LTREE,
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'America/New_York'),
        true,  -- New OUs are active by default
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        -- Idempotency: Update to latest values (replay-safe)
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        slug = EXCLUDED.slug,
        path = EXCLUDED.path,
        parent_path = EXCLUDED.parent_path,
        timezone = EXCLUDED.timezone,
        updated_at = EXCLUDED.updated_at;

    -- ========================================
    -- organization_unit.updated
    -- ========================================
    -- Organization unit information updated (name, display_name, timezone)
    -- Note: Slug and path are immutable after creation
    WHEN 'organization_unit.updated' THEN
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

    -- ========================================
    -- organization_unit.deactivated
    -- ========================================
    -- Organization unit frozen - role assignments to this OU and descendants are blocked
    -- Cascade deactivation: updates parent AND all descendants using ltree path containment
    WHEN 'organization_unit.deactivated' THEN
      -- Batch update: deactivated OU + all active descendants
      UPDATE organization_units_projection
      SET
        is_active = false,
        deactivated_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE path <@ (p_event.event_data->>'path')::ltree  -- Parent + all descendants
        AND is_active = true                              -- Only currently active
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for deactivation event', p_event.stream_id;
      END IF;

      -- Note: Cascade deactivation applies to all descendants via ltree containment
      -- Reactivation does NOT cascade - each child must be reactivated individually

    -- ========================================
    -- organization_unit.reactivated
    -- ========================================
    -- Organization unit unfrozen - role assignments allowed again
    WHEN 'organization_unit.reactivated' THEN
      UPDATE organization_units_projection
      SET
        is_active = true,
        deactivated_at = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for reactivation event', p_event.stream_id;
      END IF;

    -- ========================================
    -- organization_unit.deleted
    -- ========================================
    -- Organization unit soft-deleted (requires zero role references)
    -- Soft delete: sets deleted_at timestamp, OU no longer visible in queries
    WHEN 'organization_unit.deleted' THEN
      UPDATE organization_units_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Organization unit % not found for deletion event', p_event.stream_id;
      END IF;

    -- ========================================
    -- organization_unit.moved (Future capability)
    -- ========================================
    -- Organization unit reparented to different parent
    -- Updates path and parent_path, cascades to all descendants
    WHEN 'organization_unit.moved' THEN
      -- This is a complex operation that needs to update paths of all descendants
      -- For now, log and skip - will be implemented when feature is needed
      RAISE NOTICE 'organization_unit.moved event received for %, but move functionality not yet implemented',
        p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown organization unit event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_organization_unit_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_organization_unit_event"("p_event" "record") IS 'Main organization unit event processor - handles creation, updates, deactivation, reactivation, deletion with idempotent operations';



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
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    -- Permission Events
    WHEN 'permission.defined' THEN
      INSERT INTO permissions_projection (
        id, applet, action, description, scope_type, requires_mfa, created_at
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

    -- Role Events
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (
        id, name, description, organization_id, org_hierarchy_scope, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
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
      INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
      VALUES (p_event.stream_id, safe_jsonb_extract_uuid(p_event.event_data, 'permission_id'), p_event.created_at)
      ON CONFLICT (role_id, permission_id) DO NOTHING;

    WHEN 'role.permission.revoked' THEN
      DELETE FROM role_permissions_projection
      WHERE role_id = p_event.stream_id
        AND permission_id = safe_jsonb_extract_uuid(p_event.event_data, 'permission_id');

    -- User Role Events
    WHEN 'user.role.assigned' THEN
      INSERT INTO user_roles_projection (user_id, role_id, organization_id, scope_path, assigned_at)
      VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'role_id'),
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
      ON CONFLICT ON CONSTRAINT user_roles_projection_user_id_role_id_org_id_key DO NOTHING;

    WHEN 'user.role.revoked' THEN
      DELETE FROM user_roles_projection
      WHERE user_id = p_event.stream_id
        AND role_id = safe_jsonb_extract_uuid(p_event.event_data, 'role_id')
        AND (
          (organization_id IS NULL AND (
            safe_jsonb_extract_text(p_event.event_data, 'org_id') IS NULL
            OR safe_jsonb_extract_text(p_event.event_data, 'org_id') = '*'
          ))
          OR (organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'org_id'))
        );

    -- Cross-Tenant Access Grant Events
    WHEN 'access_grant.created' THEN
      INSERT INTO cross_tenant_access_grants_projection (
        id, consultant_org_id, consultant_user_id, provider_org_id, scope, scope_id,
        granted_by, granted_at, expires_at, revoked_at, authorization_type, legal_reference, metadata
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at,
        CASE WHEN p_event.event_data->>'expires_at' IS NOT NULL
          THEN (p_event.event_data->>'expires_at')::TIMESTAMPTZ ELSE NULL END,
        NULL,
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

  -- NOTE: audit_log INSERT removed (2025-12-22)
  -- domain_events table serves as the authoritative audit trail
END;
$$;


ALTER FUNCTION "public"."process_rbac_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_rbac_event"("p_event" "record") IS 'Projects RBAC events to permission, role, user_role, and access_grant projection tables. Audit trail is in domain_events.';



CREATE OR REPLACE FUNCTION "public"."process_user_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_org_path LTREE;
BEGIN
  CASE p_event.event_type

    -- Handle user creation (from invitation acceptance)
    WHEN 'user.created' THEN
      INSERT INTO users (
        id,
        email,
        name,
        current_organization_id,
        accessible_organizations,
        roles,
        metadata,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        (p_event.event_data->>'user_id')::UUID,
        p_event.event_data->>'email',
        COALESCE(p_event.event_data->>'name', p_event.event_data->>'email'),
        (p_event.event_data->>'organization_id')::UUID,
        ARRAY[(p_event.event_data->>'organization_id')::UUID],
        '{}',  -- Roles populated by user.role.assigned events
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
        current_organization_id = COALESCE(users.current_organization_id, EXCLUDED.current_organization_id),
        accessible_organizations = ARRAY(
          SELECT DISTINCT unnest(users.accessible_organizations || EXCLUDED.accessible_organizations)
        ),
        updated_at = p_event.created_at;

    -- Handle user sync from Supabase Auth
    WHEN 'user.synced_from_auth' THEN
      INSERT INTO users (
        id,
        email,
        name,
        is_active,
        created_at,
        updated_at
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

    -- Handle role assignment
    WHEN 'user.role.assigned' THEN
      -- Get organization path for scope
      SELECT path INTO v_org_path
      FROM organizations_projection
      WHERE id = (p_event.event_data->>'org_id')::UUID;

      -- Insert role assignment
      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        org_id,
        scope_path,
        assigned_at
      ) VALUES (
        p_event.stream_id,  -- User ID is the stream_id
        (p_event.event_data->>'role_id')::UUID,
        (p_event.event_data->>'org_id')::UUID,
        COALESCE(
          (p_event.event_data->>'scope_path')::LTREE,
          v_org_path
        ),
        p_event.created_at
      )
      ON CONFLICT (user_id, role_id, org_id) DO NOTHING;  -- Idempotent

      -- Update user's roles array
      UPDATE users
      SET
        roles = ARRAY(
          SELECT DISTINCT unnest(roles || ARRAY[p_event.event_data->>'role_name'])
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_user_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_user_event"("p_event" "record") IS 'User event processor - handles user.created, user.synced_from_auth, user.role.assigned events. Creates/updates users shadow table and user_roles_projection.';



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



CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "date_of_birth" "date" NOT NULL,
    "email" "text",
    "status" "text" DEFAULT 'active'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "clients_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


COMMENT ON TABLE "public"."clients" IS 'Patient/client records with full medical information';



CREATE TABLE IF NOT EXISTS "public"."contact_addresses" (
    "contact_id" "uuid" NOT NULL,
    "address_id" "uuid" NOT NULL
);


ALTER TABLE "public"."contact_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."contact_addresses" IS 'Many-to-many junction: contacts ↔ addresses (contact group association)';



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
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."contacts_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."contacts_projection" IS 'CQRS projection of contact.* events - contact persons associated with organizations';



COMMENT ON COLUMN "public"."contacts_projection"."organization_id" IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';



COMMENT ON COLUMN "public"."contacts_projection"."label" IS 'User-defined contact label for identification (e.g., "John Smith - Billing Contact")';



COMMENT ON COLUMN "public"."contacts_projection"."type" IS 'Structured contact type: a4c_admin, billing, technical, emergency, stakeholder';



COMMENT ON COLUMN "public"."contacts_projection"."is_primary" IS 'Primary contact for the organization (only one per org enforced by unique index)';



COMMENT ON COLUMN "public"."contacts_projection"."is_active" IS 'Contact active status';



COMMENT ON COLUMN "public"."contacts_projection"."deleted_at" IS 'Soft delete timestamp (cascades from org deletion)';



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
    CONSTRAINT "cross_tenant_access_grants_projection_scope_check" CHECK (("scope" = ANY (ARRAY['full_org'::"text", 'facility'::"text", 'program'::"text", 'client_specific'::"text"]))),
    CONSTRAINT "cross_tenant_access_grants_projection_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text", 'expired'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."cross_tenant_access_grants_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."cross_tenant_access_grants_projection" IS 'CQRS projection of access_grant.* events - enables provider_partner organizations to access provider data with full audit trail';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."consultant_org_id" IS 'provider_partner organization requesting access (UUID format)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."consultant_user_id" IS 'Specific user within consultant org (NULL for org-wide grant)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."provider_org_id" IS 'Target provider organization owning the data (UUID format)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."scope" IS 'Access scope level: full_org, facility, program, or client_specific';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."scope_id" IS 'Specific resource UUID for facility, program, or client scope';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."authorization_type" IS 'Legal/business basis: var_contract, court_order, parental_consent, social_services_assignment, emergency_access';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."legal_reference" IS 'Reference to legal document, contract number, case number, etc.';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."expires_at" IS 'Expiration timestamp for time-limited access (NULL for indefinite)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."permissions" IS 'JSONB array of specific permissions granted (default: standard set for grant type)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."terms" IS 'JSONB object with additional terms (read_only, data_retention_days, notification_required)';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."status" IS 'Current grant status: active, revoked, expired, suspended';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."revoked_at" IS 'Timestamp when grant was permanently revoked';



COMMENT ON COLUMN "public"."cross_tenant_access_grants_projection"."suspended_at" IS 'Timestamp when grant was temporarily suspended (can be reactivated)';



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



CREATE SEQUENCE IF NOT EXISTS "public"."domain_events_sequence_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."domain_events_sequence_number_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."domain_events_sequence_number_seq" OWNED BY "public"."domain_events"."sequence_number";



CREATE TABLE IF NOT EXISTS "public"."dosage_info" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "medication_history_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "scheduled_datetime" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "administered_datetime" timestamp with time zone,
    "administered_by" "uuid",
    "scheduled_amount" numeric,
    "administered_amount" numeric,
    "unit" "text",
    "skip_reason" "text",
    "refusal_reason" "text",
    "administration_notes" "text",
    "vitals_before" "jsonb" DEFAULT '{}'::"jsonb",
    "vitals_after" "jsonb" DEFAULT '{}'::"jsonb",
    "side_effects_observed" "text"[],
    "adverse_reaction" boolean DEFAULT false,
    "adverse_reaction_details" "text",
    "verified_by" "uuid",
    "verification_datetime" timestamp with time zone,
    CONSTRAINT "dosage_info_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'administered'::"text", 'skipped'::"text", 'refused'::"text"])))
);


ALTER TABLE "public"."dosage_info" OWNER TO "postgres";


COMMENT ON TABLE "public"."dosage_info" IS 'Tracks actual medication administration events';



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
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'Shadow table for Supabase Auth users, used for RLS and auditing';



COMMENT ON COLUMN "public"."users"."id" IS 'User UUID from Supabase Auth (auth.users.id)';



COMMENT ON COLUMN "public"."users"."current_organization_id" IS 'Currently selected organization context';



COMMENT ON COLUMN "public"."users"."accessible_organizations" IS 'Array of organization IDs user can access';



COMMENT ON COLUMN "public"."users"."roles" IS 'Array of role names from Zitadel (super_admin, administrator, clinician, specialist, parent, youth)';



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
    "role" "text" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tags" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "chk_invitation_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'deleted'::"text"])))
);


ALTER TABLE "public"."invitations_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."invitations_projection" IS 'CQRS projection of user invitations. Updated by UserInvited domain events from Temporal workflows. Queried by Edge Functions for invitation validation and acceptance.';



COMMENT ON COLUMN "public"."invitations_projection"."invitation_id" IS 'UUID from domain event (aggregate ID). Used for event correlation.';



COMMENT ON COLUMN "public"."invitations_projection"."token" IS '256-bit cryptographically secure URL-safe base64 token. Used in invitation email link.';



COMMENT ON COLUMN "public"."invitations_projection"."expires_at" IS 'Invitation expiration timestamp (7 days from creation). Edge Functions check this.';



COMMENT ON COLUMN "public"."invitations_projection"."status" IS 'Invitation lifecycle status: pending (initial), accepted (user accepted), expired (past expires_at), deleted (soft delete by cleanup script)';



COMMENT ON COLUMN "public"."invitations_projection"."tags" IS 'Development entity tracking tags. Examples: ["development", "test", "mode:development"]. Used by cleanup script to identify and delete test data.';



CREATE TABLE IF NOT EXISTS "public"."medication_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "medication_id" "uuid" NOT NULL,
    "prescription_date" "date" NOT NULL,
    "start_date" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_prn" boolean DEFAULT false,
    "prn_reason" "text",
    "prescribed_by" "uuid",
    CONSTRAINT "medication_history_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'discontinued'::"text"])))
);


ALTER TABLE "public"."medication_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."medication_history" IS 'Tracks all medication prescriptions and administration history';



CREATE TABLE IF NOT EXISTS "public"."medications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "generic_name" "text",
    "rxnorm_cui" "text",
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_psychotropic" boolean DEFAULT false,
    "is_controlled" boolean DEFAULT false,
    "controlled_substance_schedule" "text",
    "is_narcotic" boolean DEFAULT false
);


ALTER TABLE "public"."medications" OWNER TO "postgres";


COMMENT ON TABLE "public"."medications" IS 'Medication catalog with comprehensive drug information';



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
    CONSTRAINT "permissions_projection_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['global'::"text", 'org'::"text", 'facility'::"text", 'program'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."permissions_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."permissions_projection" IS 'Projection of permission.defined events - defines atomic authorization units';



COMMENT ON COLUMN "public"."permissions_projection"."name" IS 'Generated permission identifier in format: applet.action';



COMMENT ON COLUMN "public"."permissions_projection"."scope_type" IS 'Hierarchical scope level: global, org, facility, program, or client';



COMMENT ON COLUMN "public"."permissions_projection"."requires_mfa" IS 'Whether MFA verification is required to use this permission';



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



CREATE TABLE IF NOT EXISTS "public"."user_roles_projection" (
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "scope_path" "extensions"."ltree",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_roles_projection_check" CHECK (((("organization_id" IS NULL) AND ("scope_path" IS NULL)) OR (("organization_id" IS NOT NULL) AND ("scope_path" IS NOT NULL))))
);


ALTER TABLE "public"."user_roles_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_roles_projection" IS 'Projection of user.role.* events - assigns roles to users with org scoping';



COMMENT ON COLUMN "public"."user_roles_projection"."organization_id" IS 'Organization UUID (NULL for super_admin global access, specific UUID for scoped roles)';



COMMENT ON COLUMN "public"."user_roles_projection"."scope_path" IS 'ltree hierarchy path for granular scoping (NULL for global access)';



COMMENT ON COLUMN "public"."user_roles_projection"."assigned_at" IS 'Timestamp when role was assigned to user';



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



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_addresses"
    ADD CONSTRAINT "contact_addresses_contact_id_address_id_key" UNIQUE ("contact_id", "address_id");



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



ALTER TABLE ONLY "public"."dosage_info"
    ADD CONSTRAINT "dosage_info_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."medication_history"
    ADD CONSTRAINT "medication_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medications"
    ADD CONSTRAINT "medications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_addresses"
    ADD CONSTRAINT "organization_addresses_organization_id_address_id_key" UNIQUE ("organization_id", "address_id");



ALTER TABLE ONLY "public"."organization_business_profiles_projection"
    ADD CONSTRAINT "organization_business_profiles_projection_pkey" PRIMARY KEY ("organization_id");



ALTER TABLE ONLY "public"."organization_contacts"
    ADD CONSTRAINT "organization_contacts_organization_id_contact_id_key" UNIQUE ("organization_id", "contact_id");



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



CREATE INDEX "idx_clients_dob" ON "public"."clients" USING "btree" ("date_of_birth");



CREATE INDEX "idx_clients_name" ON "public"."clients" USING "btree" ("last_name", "first_name");



CREATE INDEX "idx_clients_organization" ON "public"."clients" USING "btree" ("organization_id");



CREATE INDEX "idx_clients_status" ON "public"."clients" USING "btree" ("status");



CREATE INDEX "idx_contact_addresses_address" ON "public"."contact_addresses" USING "btree" ("address_id");



CREATE INDEX "idx_contact_addresses_contact" ON "public"."contact_addresses" USING "btree" ("contact_id");



CREATE INDEX "idx_contact_phones_contact" ON "public"."contact_phones" USING "btree" ("contact_id");



CREATE INDEX "idx_contact_phones_phone" ON "public"."contact_phones" USING "btree" ("phone_id");



CREATE INDEX "idx_contacts_active" ON "public"."contacts_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_email" ON "public"."contacts_projection" USING "btree" ("email") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_contacts_one_primary_per_org" ON "public"."contacts_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_organization" ON "public"."contacts_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contacts_primary" ON "public"."contacts_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_type" ON "public"."contacts_projection" USING "btree" ("type", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_domain_events_activity_id" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'activity_id'::"text"))) WHERE (("event_metadata" ->> 'activity_id'::"text") IS NOT NULL);



COMMENT ON INDEX "public"."idx_domain_events_activity_id" IS 'Enables queries for events emitted by specific workflow activities.
   Useful for debugging which activity failed or produced unexpected events.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''activity_id'' = ''createOrganizationActivity'';';



CREATE INDEX "idx_domain_events_correlation" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'correlation_id'::"text"))) WHERE ("event_metadata" ? 'correlation_id'::"text");



CREATE INDEX "idx_domain_events_created" ON "public"."domain_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_domain_events_stream" ON "public"."domain_events" USING "btree" ("stream_id", "stream_type");



CREATE INDEX "idx_domain_events_tags" ON "public"."domain_events" USING "gin" ((("event_metadata" -> 'tags'::"text"))) WHERE ("event_metadata" ? 'tags'::"text");



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



CREATE INDEX "idx_dosage_info_administered_by" ON "public"."dosage_info" USING "btree" ("administered_by");



CREATE INDEX "idx_dosage_info_client" ON "public"."dosage_info" USING "btree" ("client_id");



CREATE INDEX "idx_dosage_info_medication_history" ON "public"."dosage_info" USING "btree" ("medication_history_id");



CREATE INDEX "idx_dosage_info_organization" ON "public"."dosage_info" USING "btree" ("organization_id");



CREATE INDEX "idx_dosage_info_scheduled_datetime" ON "public"."dosage_info" USING "btree" ("scheduled_datetime");



CREATE INDEX "idx_dosage_info_status" ON "public"."dosage_info" USING "btree" ("status");



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



CREATE INDEX "idx_invitations_projection_org_email" ON "public"."invitations_projection" USING "btree" ("organization_id", "email");



CREATE INDEX "idx_invitations_projection_status" ON "public"."invitations_projection" USING "btree" ("status");



CREATE INDEX "idx_invitations_projection_tags" ON "public"."invitations_projection" USING "gin" ("tags");



CREATE INDEX "idx_invitations_projection_token" ON "public"."invitations_projection" USING "btree" ("token");



CREATE INDEX "idx_medication_history_client" ON "public"."medication_history" USING "btree" ("client_id");



CREATE INDEX "idx_medication_history_is_prn" ON "public"."medication_history" USING "btree" ("is_prn");



CREATE INDEX "idx_medication_history_medication" ON "public"."medication_history" USING "btree" ("medication_id");



CREATE INDEX "idx_medication_history_organization" ON "public"."medication_history" USING "btree" ("organization_id");



CREATE INDEX "idx_medication_history_prescription_date" ON "public"."medication_history" USING "btree" ("prescription_date");



CREATE INDEX "idx_medication_history_status" ON "public"."medication_history" USING "btree" ("status");



CREATE INDEX "idx_medications_generic_name" ON "public"."medications" USING "btree" ("generic_name");



CREATE INDEX "idx_medications_is_active" ON "public"."medications" USING "btree" ("is_active");



CREATE INDEX "idx_medications_is_controlled" ON "public"."medications" USING "btree" ("is_controlled");



CREATE INDEX "idx_medications_name" ON "public"."medications" USING "btree" ("name");



CREATE INDEX "idx_medications_organization" ON "public"."medications" USING "btree" ("organization_id");



CREATE INDEX "idx_medications_rxnorm" ON "public"."medications" USING "btree" ("rxnorm_cui");



CREATE INDEX "idx_migrations_applied_at" ON "public"."_migrations_applied" USING "btree" ("applied_at" DESC);



CREATE INDEX "idx_migrations_name" ON "public"."_migrations_applied" USING "btree" ("migration_name");



CREATE INDEX "idx_org_addresses_deleted_at" ON "public"."organization_addresses" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_mailing_address" ON "public"."organization_business_profiles_projection" USING "gin" ("mailing_address") WHERE ("mailing_address" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_partner_profile" ON "public"."organization_business_profiles_projection" USING "gin" ("partner_profile") WHERE ("partner_profile" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_provider_profile" ON "public"."organization_business_profiles_projection" USING "gin" ("provider_profile") WHERE ("provider_profile" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_type" ON "public"."organization_business_profiles_projection" USING "btree" ("organization_type");



CREATE INDEX "idx_org_contacts_deleted_at" ON "public"."organization_contacts" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



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



CREATE INDEX "idx_roles_hierarchy_scope" ON "public"."roles_projection" USING "gist" ("org_hierarchy_scope") WHERE ("org_hierarchy_scope" IS NOT NULL);



CREATE INDEX "idx_roles_name" ON "public"."roles_projection" USING "btree" ("name");



CREATE INDEX "idx_roles_organization_id" ON "public"."roles_projection" USING "btree" ("organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "idx_user_roles_auth_lookup" ON "public"."user_roles_projection" USING "btree" ("user_id", "organization_id");



CREATE INDEX "idx_user_roles_org" ON "public"."user_roles_projection" USING "btree" ("organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "idx_user_roles_role" ON "public"."user_roles_projection" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_scope_path" ON "public"."user_roles_projection" USING "gist" ("scope_path") WHERE ("scope_path" IS NOT NULL);



CREATE INDEX "idx_user_roles_user" ON "public"."user_roles_projection" USING "btree" ("user_id");



CREATE INDEX "idx_users_current_organization" ON "public"."users" USING "btree" ("current_organization_id") WHERE ("current_organization_id" IS NOT NULL);



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_roles" ON "public"."users" USING "gin" ("roles");



CREATE INDEX "workflow_queue_projection_created_at_idx" ON "public"."workflow_queue_projection" USING "btree" ("created_at" DESC);



CREATE INDEX "workflow_queue_projection_event_type_idx" ON "public"."workflow_queue_projection" USING "btree" ("event_type");



CREATE INDEX "workflow_queue_projection_status_idx" ON "public"."workflow_queue_projection" USING "btree" ("status");



CREATE INDEX "workflow_queue_projection_stream_id_idx" ON "public"."workflow_queue_projection" USING "btree" ("stream_id");



CREATE INDEX "workflow_queue_projection_workflow_id_idx" ON "public"."workflow_queue_projection" USING "btree" ("workflow_id") WHERE ("workflow_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "bootstrap_workflow_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW EXECUTE FUNCTION "public"."handle_bootstrap_workflow"();



CREATE OR REPLACE TRIGGER "enqueue_workflow_from_bootstrap_event_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = 'organization.bootstrap.initiated'::"text")) EXECUTE FUNCTION "public"."enqueue_workflow_from_bootstrap_event"();



CREATE OR REPLACE TRIGGER "process_domain_event_trigger" BEFORE INSERT OR UPDATE ON "public"."domain_events" FOR EACH ROW EXECUTE FUNCTION "public"."process_domain_event"();



CREATE OR REPLACE TRIGGER "trigger_notify_bootstrap_initiated" BEFORE INSERT ON "public"."domain_events" FOR EACH ROW EXECUTE FUNCTION "public"."notify_workflow_worker_bootstrap"();



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



ALTER TABLE ONLY "public"."contact_phones"
    ADD CONSTRAINT "contact_phones_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");



ALTER TABLE ONLY "public"."contact_phones"
    ADD CONSTRAINT "contact_phones_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "public"."phones_projection"("id");



ALTER TABLE ONLY "public"."contacts_projection"
    ADD CONSTRAINT "contacts_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "fk_clients_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."dosage_info"
    ADD CONSTRAINT "fk_dosage_info_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."medication_history"
    ADD CONSTRAINT "fk_medication_history_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."medications"
    ADD CONSTRAINT "fk_medications_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."roles_projection"
    ADD CONSTRAINT "fk_roles_projection_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_roles_projection"
    ADD CONSTRAINT "fk_user_roles_projection_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE RESTRICT;



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



CREATE POLICY "addresses_org_admin_select" ON "public"."addresses_projection" FOR SELECT USING (("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "addresses_org_admin_select" ON "public"."addresses_projection" IS 'Allows organization admins to view addresses in their organization (excluding soft-deleted)';



ALTER TABLE "public"."addresses_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "addresses_projection_service_role_select" ON "public"."addresses_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "addresses_projection_service_role_select" ON "public"."addresses_projection" IS 'Allows Temporal workers (service_role) to read address data for cleanup activities';



CREATE POLICY "addresses_super_admin_all" ON "public"."addresses_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "addresses_super_admin_all" ON "public"."addresses_projection" IS 'Allows super admins full access to all addresses';



CREATE POLICY "business_profiles_org_admin_select" ON "public"."organization_business_profiles_projection" FOR SELECT USING ("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id"));



COMMENT ON POLICY "business_profiles_org_admin_select" ON "public"."organization_business_profiles_projection" IS 'Allows organization admins to view their own business profile';



CREATE POLICY "business_profiles_super_admin_all" ON "public"."organization_business_profiles_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "business_profiles_super_admin_all" ON "public"."organization_business_profiles_projection" IS 'Allows super admins full access to all business profiles';



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_delete" ON "public"."clients" FOR DELETE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'clients.delete'::"text", "organization_id"))));



COMMENT ON POLICY "clients_delete" ON "public"."clients" IS 'Allows authorized users to delete client records (prefer archiving)';



CREATE POLICY "clients_insert" ON "public"."clients" FOR INSERT WITH CHECK (("public"."is_super_admin"("public"."get_current_user_id"()) OR "public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") OR "public"."user_has_permission"("public"."get_current_user_id"(), 'clients.create'::"text", "organization_id")));



COMMENT ON POLICY "clients_insert" ON "public"."clients" IS 'Allows organization admins and authorized users to create client records';



CREATE POLICY "clients_org_select" ON "public"."clients" FOR SELECT USING (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid"));



COMMENT ON POLICY "clients_org_select" ON "public"."clients" IS 'Allows organization users to view clients in their own organization';



CREATE POLICY "clients_select" ON "public"."clients" FOR SELECT USING (("public"."is_super_admin"("auth"."uid"()) OR ("organization_id" = "public"."get_current_org_id"())));



CREATE POLICY "clients_super_admin_select" ON "public"."clients" FOR SELECT USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "clients_super_admin_select" ON "public"."clients" IS 'Allows super admins to view all client records across all organizations';



CREATE POLICY "clients_update" ON "public"."clients" FOR UPDATE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'clients.update'::"text", "organization_id"))));



COMMENT ON POLICY "clients_update" ON "public"."clients" IS 'Allows authorized users to update client records in their organization';



ALTER TABLE "public"."contact_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_addresses_org_admin_select" ON "public"."contact_addresses" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."contacts_projection" "c"
  WHERE (("c"."id" = "contact_addresses"."contact_id") AND "public"."is_org_admin"("public"."get_current_user_id"(), "c"."organization_id") AND ("c"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
   FROM "public"."addresses_projection" "a"
  WHERE (("a"."id" = "contact_addresses"."address_id") AND ("a"."deleted_at" IS NULL))))));



COMMENT ON POLICY "contact_addresses_org_admin_select" ON "public"."contact_addresses" IS 'Allows organization admins to view contact-address links (both contact and address must belong to their org)';



CREATE POLICY "contact_addresses_super_admin_all" ON "public"."contact_addresses" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "contact_addresses_super_admin_all" ON "public"."contact_addresses" IS 'Allows super admins full access to all contact-address links';



ALTER TABLE "public"."contact_phones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_phones_org_admin_select" ON "public"."contact_phones" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."contacts_projection" "c"
  WHERE (("c"."id" = "contact_phones"."contact_id") AND "public"."is_org_admin"("public"."get_current_user_id"(), "c"."organization_id") AND ("c"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
   FROM "public"."phones_projection" "p"
  WHERE (("p"."id" = "contact_phones"."phone_id") AND ("p"."deleted_at" IS NULL))))));



COMMENT ON POLICY "contact_phones_org_admin_select" ON "public"."contact_phones" IS 'Allows organization admins to view contact-phone links (both contact and phone must belong to their org)';



CREATE POLICY "contact_phones_super_admin_all" ON "public"."contact_phones" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "contact_phones_super_admin_all" ON "public"."contact_phones" IS 'Allows super admins full access to all contact-phone links';



CREATE POLICY "contacts_org_admin_select" ON "public"."contacts_projection" FOR SELECT USING (("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "contacts_org_admin_select" ON "public"."contacts_projection" IS 'Allows organization admins to view contacts in their organization (excluding soft-deleted)';



ALTER TABLE "public"."contacts_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_projection_service_role_select" ON "public"."contacts_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "contacts_projection_service_role_select" ON "public"."contacts_projection" IS 'Allows Temporal workers (service_role) to read contact data for cleanup activities';



CREATE POLICY "contacts_super_admin_all" ON "public"."contacts_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "contacts_super_admin_all" ON "public"."contacts_projection" IS 'Allows super admins full access to all contacts';



ALTER TABLE "public"."cross_tenant_access_grants_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cross_tenant_grants_org_admin_select" ON "public"."cross_tenant_access_grants_projection" FOR SELECT USING (("public"."is_org_admin"("public"."get_current_user_id"(), "consultant_org_id") OR "public"."is_org_admin"("public"."get_current_user_id"(), "provider_org_id")));



COMMENT ON POLICY "cross_tenant_grants_org_admin_select" ON "public"."cross_tenant_access_grants_projection" IS 'Allows organization admins to view grants where their organization is consultant or provider';



CREATE POLICY "cross_tenant_grants_super_admin_all" ON "public"."cross_tenant_access_grants_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "cross_tenant_grants_super_admin_all" ON "public"."cross_tenant_access_grants_projection" IS 'Allows super admins full access to all cross-tenant access grants';



ALTER TABLE "public"."domain_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "domain_events_authenticated_insert" ON "public"."domain_events" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("public"."is_super_admin"("public"."get_current_user_id"()) OR ((("event_metadata" ->> 'organization_id'::"text"))::"uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'org_id'::"text"))::"uuid")) AND ("length"(("event_metadata" ->> 'reason'::"text")) >= 10)));



COMMENT ON POLICY "domain_events_authenticated_insert" ON "public"."domain_events" IS 'Allows authenticated users to INSERT events. Validates org_id matches JWT claim and reason >= 10 chars.';



CREATE POLICY "domain_events_org_select" ON "public"."domain_events" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("public"."is_super_admin"("public"."get_current_user_id"()) OR ((("event_metadata" ->> 'organization_id'::"text"))::"uuid" = ((("current_setting"('request.jwt.claims'::"text", true))::"jsonb" ->> 'org_id'::"text"))::"uuid"))));



COMMENT ON POLICY "domain_events_org_select" ON "public"."domain_events" IS 'Allows users to SELECT events belonging to their organization.';



CREATE POLICY "domain_events_super_admin_all" ON "public"."domain_events" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "domain_events_super_admin_all" ON "public"."domain_events" IS 'Allows super admins full access to domain events for auditing';



ALTER TABLE "public"."dosage_info" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dosage_info_delete" ON "public"."dosage_info" FOR DELETE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.administer'::"text", "organization_id"))));



COMMENT ON POLICY "dosage_info_delete" ON "public"."dosage_info" IS 'Allows medication administrators to delete dosage records';



CREATE POLICY "dosage_info_insert" ON "public"."dosage_info" FOR INSERT WITH CHECK (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.administer'::"text", "organization_id"))));



COMMENT ON POLICY "dosage_info_insert" ON "public"."dosage_info" IS 'Allows medication administrators to schedule doses in their organization';



CREATE POLICY "dosage_info_org_select" ON "public"."dosage_info" FOR SELECT USING (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid"));



COMMENT ON POLICY "dosage_info_org_select" ON "public"."dosage_info" IS 'Allows organization users to view dosage records in their own organization';



CREATE POLICY "dosage_info_super_admin_select" ON "public"."dosage_info" FOR SELECT USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "dosage_info_super_admin_select" ON "public"."dosage_info" IS 'Allows super admins to view all dosage records across all organizations';



CREATE POLICY "dosage_info_update" ON "public"."dosage_info" FOR UPDATE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND ("public"."user_has_permission"("public"."get_current_user_id"(), 'medications.administer'::"text", "organization_id") OR ("administered_by" = "public"."get_current_user_id"())))));



COMMENT ON POLICY "dosage_info_update" ON "public"."dosage_info" IS 'Allows medication administrators and administering staff to update dose records';



ALTER TABLE "public"."event_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_types_authenticated_select" ON "public"."event_types" FOR SELECT USING (("public"."get_current_user_id"() IS NOT NULL));



COMMENT ON POLICY "event_types_authenticated_select" ON "public"."event_types" IS 'Allows authenticated users to view event type definitions';



CREATE POLICY "event_types_super_admin_all" ON "public"."event_types" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "event_types_super_admin_all" ON "public"."event_types" IS 'Allows super admins full access to event type definitions';



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



CREATE POLICY "invitations_org_admin_select" ON "public"."invitations_projection" FOR SELECT USING ("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id"));



COMMENT ON POLICY "invitations_org_admin_select" ON "public"."invitations_projection" IS 'Allows organization admins to view invitations for their organization';



ALTER TABLE "public"."invitations_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_projection_service_role_select" ON "public"."invitations_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "invitations_projection_service_role_select" ON "public"."invitations_projection" IS 'Allows Temporal workers (service_role) to read invitation data for email activities';



CREATE POLICY "invitations_super_admin_all" ON "public"."invitations_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "invitations_super_admin_all" ON "public"."invitations_projection" IS 'Allows super admins full access to all invitations';



CREATE POLICY "invitations_user_own_select" ON "public"."invitations_projection" FOR SELECT USING (("email" = (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'email'::"text")));



COMMENT ON POLICY "invitations_user_own_select" ON "public"."invitations_projection" IS 'Allows users to view their own invitation by email address';



ALTER TABLE "public"."medication_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "medication_history_delete" ON "public"."medication_history" FOR DELETE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.prescribe'::"text", "organization_id"))));



COMMENT ON POLICY "medication_history_delete" ON "public"."medication_history" IS 'Allows authorized prescribers to discontinue prescriptions';



CREATE POLICY "medication_history_insert" ON "public"."medication_history" FOR INSERT WITH CHECK (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.prescribe'::"text", "organization_id"))));



COMMENT ON POLICY "medication_history_insert" ON "public"."medication_history" IS 'Allows authorized prescribers to create prescriptions in their organization';



CREATE POLICY "medication_history_org_select" ON "public"."medication_history" FOR SELECT USING (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid"));



COMMENT ON POLICY "medication_history_org_select" ON "public"."medication_history" IS 'Allows organization users to view prescription records in their own organization';



CREATE POLICY "medication_history_super_admin_select" ON "public"."medication_history" FOR SELECT USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "medication_history_super_admin_select" ON "public"."medication_history" IS 'Allows super admins to view all prescription records across all organizations';



CREATE POLICY "medication_history_update" ON "public"."medication_history" FOR UPDATE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND ("public"."user_has_permission"("public"."get_current_user_id"(), 'medications.prescribe'::"text", "organization_id") OR ("prescribed_by" = "public"."get_current_user_id"())))));



COMMENT ON POLICY "medication_history_update" ON "public"."medication_history" IS 'Allows prescribers to update their prescriptions in their organization';



ALTER TABLE "public"."medications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "medications_delete" ON "public"."medications" FOR DELETE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.manage'::"text", "organization_id"))));



COMMENT ON POLICY "medications_delete" ON "public"."medications" IS 'Allows authorized pharmacy staff to remove medications from formulary';



CREATE POLICY "medications_insert" ON "public"."medications" FOR INSERT WITH CHECK (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND ("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") OR "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.manage'::"text", "organization_id")))));



COMMENT ON POLICY "medications_insert" ON "public"."medications" IS 'Allows organization admins and pharmacy staff to add medications to formulary';



CREATE POLICY "medications_org_select" ON "public"."medications" FOR SELECT USING (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid"));



COMMENT ON POLICY "medications_org_select" ON "public"."medications" IS 'Allows organization users to view medications in their own formulary';



CREATE POLICY "medications_super_admin_select" ON "public"."medications" FOR SELECT USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "medications_super_admin_select" ON "public"."medications" IS 'Allows super admins to view all medication formularies across all organizations';



CREATE POLICY "medications_update" ON "public"."medications" FOR UPDATE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.manage'::"text", "organization_id"))));



COMMENT ON POLICY "medications_update" ON "public"."medications" IS 'Allows pharmacy staff to update medication information';



CREATE POLICY "org_addresses_org_admin_select" ON "public"."organization_addresses" FOR SELECT USING (("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."addresses_projection" "a"
  WHERE (("a"."id" = "organization_addresses"."address_id") AND ("a"."organization_id" = "a"."organization_id") AND ("a"."deleted_at" IS NULL))))));



COMMENT ON POLICY "org_addresses_org_admin_select" ON "public"."organization_addresses" IS 'Allows organization admins to view organization-address links (both entities must belong to their org)';



CREATE POLICY "org_addresses_super_admin_all" ON "public"."organization_addresses" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "org_addresses_super_admin_all" ON "public"."organization_addresses" IS 'Allows super admins full access to all organization-address links';



CREATE POLICY "org_contacts_org_admin_select" ON "public"."organization_contacts" FOR SELECT USING (("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."contacts_projection" "c"
  WHERE (("c"."id" = "organization_contacts"."contact_id") AND ("c"."organization_id" = "c"."organization_id") AND ("c"."deleted_at" IS NULL))))));



COMMENT ON POLICY "org_contacts_org_admin_select" ON "public"."organization_contacts" IS 'Allows organization admins to view organization-contact links (both entities must belong to their org)';



CREATE POLICY "org_contacts_super_admin_all" ON "public"."organization_contacts" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "org_contacts_super_admin_all" ON "public"."organization_contacts" IS 'Allows super admins full access to all organization-contact links';



CREATE POLICY "org_phones_org_admin_select" ON "public"."organization_phones" FOR SELECT USING (("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."phones_projection" "p"
  WHERE (("p"."id" = "organization_phones"."phone_id") AND ("p"."organization_id" = "p"."organization_id") AND ("p"."deleted_at" IS NULL))))));



COMMENT ON POLICY "org_phones_org_admin_select" ON "public"."organization_phones" IS 'Allows organization admins to view organization-phone links (both entities must belong to their org)';



CREATE POLICY "org_phones_super_admin_all" ON "public"."organization_phones" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "org_phones_super_admin_all" ON "public"."organization_phones" IS 'Allows super admins full access to all organization-phone links';



ALTER TABLE "public"."organization_addresses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_business_profiles_projection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_phones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_units_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_org_admin_select" ON "public"."organizations_projection" FOR SELECT USING ("public"."is_org_admin"("public"."get_current_user_id"(), "id"));



COMMENT ON POLICY "organizations_org_admin_select" ON "public"."organizations_projection" IS 'Allows organization admins to view their own organization details';



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



CREATE POLICY "organizations_select" ON "public"."organizations_projection" FOR SELECT USING (("public"."is_super_admin"("auth"."uid"()) OR ("id" = "public"."get_current_org_id"())));



CREATE POLICY "organizations_super_admin_all" ON "public"."organizations_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "organizations_super_admin_all" ON "public"."organizations_projection" IS 'Allows super admins full access to all organizations';



CREATE POLICY "organizations_var_partner_referrals" ON "public"."organizations_projection" FOR SELECT USING (("public"."is_var_partner"() AND ("referring_partner_id" = "public"."get_current_org_id"())));



COMMENT ON POLICY "organizations_var_partner_referrals" ON "public"."organizations_projection" IS 'Allows VAR partners to view organizations they referred (where referring_partner_id = their org_id)';



CREATE POLICY "ou_org_admin_select" ON "public"."organization_units_projection" FOR SELECT USING ((("organization_id" IS NOT NULL) AND "public"."is_org_admin"("public"."get_current_user_id"(), "organization_id")));



COMMENT ON POLICY "ou_org_admin_select" ON "public"."organization_units_projection" IS 'Allows organization admins to view all OUs within their organization';



CREATE POLICY "ou_scope_delete" ON "public"."organization_units_projection" FOR DELETE USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_delete" ON "public"."organization_units_projection" IS 'Allows users to delete organization units within their scope_path. Child/role validation in RPC.';



CREATE POLICY "ou_scope_insert" ON "public"."organization_units_projection" FOR INSERT WITH CHECK ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_insert" ON "public"."organization_units_projection" IS 'Allows users to create organization units within their scope_path hierarchy';



CREATE POLICY "ou_scope_select" ON "public"."organization_units_projection" FOR SELECT USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_select" ON "public"."organization_units_projection" IS 'Allows users to view organization units within their scope_path hierarchy';



CREATE POLICY "ou_scope_update" ON "public"."organization_units_projection" FOR UPDATE USING ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path"))) WITH CHECK ((("public"."get_current_scope_path"() IS NOT NULL) AND ("public"."get_current_scope_path"() OPERATOR("extensions".@>) "path")));



COMMENT ON POLICY "ou_scope_update" ON "public"."organization_units_projection" IS 'Allows users to update organization units within their scope_path hierarchy';



CREATE POLICY "ou_super_admin_all" ON "public"."organization_units_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "ou_super_admin_all" ON "public"."organization_units_projection" IS 'Allows super admins full access to all organization units';



CREATE POLICY "permissions_authenticated_select" ON "public"."permissions_projection" FOR SELECT USING (("public"."get_current_user_id"() IS NOT NULL));



COMMENT ON POLICY "permissions_authenticated_select" ON "public"."permissions_projection" IS 'Allows authenticated users to view available permissions';



ALTER TABLE "public"."permissions_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_projection_service_role_select" ON "public"."permissions_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "permissions_projection_service_role_select" ON "public"."permissions_projection" IS 'Allows Temporal workers (service_role) to read permission definitions';



CREATE POLICY "permissions_super_admin_all" ON "public"."permissions_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "permissions_super_admin_all" ON "public"."permissions_projection" IS 'Allows super admins full access to permission definitions';



CREATE POLICY "permissions_superadmin" ON "public"."permissions_projection" USING ("public"."is_super_admin"("auth"."uid"()));



ALTER TABLE "public"."phone_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phone_addresses_org_admin_select" ON "public"."phone_addresses" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."phones_projection" "p"
  WHERE (("p"."id" = "phone_addresses"."phone_id") AND "public"."is_org_admin"("public"."get_current_user_id"(), "p"."organization_id") AND ("p"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
   FROM "public"."addresses_projection" "a"
  WHERE (("a"."id" = "phone_addresses"."address_id") AND ("a"."deleted_at" IS NULL))))));



COMMENT ON POLICY "phone_addresses_org_admin_select" ON "public"."phone_addresses" IS 'Allows organization admins to view phone-address links (both phone and address must belong to their org)';



CREATE POLICY "phone_addresses_super_admin_all" ON "public"."phone_addresses" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "phone_addresses_super_admin_all" ON "public"."phone_addresses" IS 'Allows super admins full access to all phone-address links';



CREATE POLICY "phones_org_admin_select" ON "public"."phones_projection" FOR SELECT USING (("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "phones_org_admin_select" ON "public"."phones_projection" IS 'Allows organization admins to view phones in their organization (excluding soft-deleted)';



ALTER TABLE "public"."phones_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phones_projection_service_role_select" ON "public"."phones_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "phones_projection_service_role_select" ON "public"."phones_projection" IS 'Allows Temporal workers (service_role) to read phone data for cleanup activities';



CREATE POLICY "phones_super_admin_all" ON "public"."phones_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "phones_super_admin_all" ON "public"."phones_projection" IS 'Allows super admins full access to all phones';



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
  WHERE (("r"."id" = "role_permissions_projection"."role_id") AND ("r"."organization_id" IS NOT NULL) AND "public"."is_org_admin"("public"."get_current_user_id"(), "r"."organization_id")))));



COMMENT ON POLICY "role_permissions_org_admin_select" ON "public"."role_permissions_projection" IS 'Allows organization admins to view permissions for roles in their organization';



ALTER TABLE "public"."role_permissions_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_projection_service_role_select" ON "public"."role_permissions_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "role_permissions_projection_service_role_select" ON "public"."role_permissions_projection" IS 'Allows Temporal workers (service_role) to read role-permission mappings';



CREATE POLICY "role_permissions_super_admin_all" ON "public"."role_permissions_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "role_permissions_super_admin_all" ON "public"."role_permissions_projection" IS 'Allows super admins full access to all role-permission grants';



CREATE POLICY "role_permissions_superadmin" ON "public"."role_permissions_projection" USING ("public"."is_super_admin"("auth"."uid"()));



CREATE POLICY "roles_global_select" ON "public"."roles_projection" FOR SELECT USING ((("organization_id" IS NULL) AND ("public"."get_current_user_id"() IS NOT NULL)));



COMMENT ON POLICY "roles_global_select" ON "public"."roles_projection" IS 'Allows authenticated users to view global role templates';



CREATE POLICY "roles_org_admin_select" ON "public"."roles_projection" FOR SELECT USING ((("organization_id" IS NOT NULL) AND "public"."is_org_admin"("public"."get_current_user_id"(), "organization_id")));



COMMENT ON POLICY "roles_org_admin_select" ON "public"."roles_projection" IS 'Allows organization admins to view roles in their organization';



ALTER TABLE "public"."roles_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_projection_service_role_select" ON "public"."roles_projection" FOR SELECT TO "service_role" USING (true);



COMMENT ON POLICY "roles_projection_service_role_select" ON "public"."roles_projection" IS 'Allows Temporal workers (service_role) to read role data for RBAC lookups';



CREATE POLICY "roles_super_admin_all" ON "public"."roles_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "roles_super_admin_all" ON "public"."roles_projection" IS 'Allows super admins full access to all roles';



CREATE POLICY "roles_superadmin" ON "public"."roles_projection" USING ("public"."is_super_admin"("auth"."uid"()));



CREATE POLICY "user_roles_org_admin_select" ON "public"."user_roles_projection" FOR SELECT USING ((("organization_id" IS NOT NULL) AND "public"."is_org_admin"("public"."get_current_user_id"(), "organization_id")));



COMMENT ON POLICY "user_roles_org_admin_select" ON "public"."user_roles_projection" IS 'Allows organization admins to view role assignments in their organization';



CREATE POLICY "user_roles_own_select" ON "public"."user_roles_projection" FOR SELECT USING (("user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "user_roles_own_select" ON "public"."user_roles_projection" IS 'Allows users to view their own role assignments';



ALTER TABLE "public"."user_roles_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_super_admin_all" ON "public"."user_roles_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "user_roles_super_admin_all" ON "public"."user_roles_projection" IS 'Allows super admins full access to all user-role assignments';



CREATE POLICY "user_roles_superadmin" ON "public"."user_roles_projection" USING ("public"."is_super_admin"("auth"."uid"()));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_org_admin_select" ON "public"."users" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles_projection" "ur"
  WHERE (("ur"."user_id" = "users"."id") AND "public"."is_org_admin"("public"."get_current_user_id"(), "ur"."organization_id")))));



COMMENT ON POLICY "users_org_admin_select" ON "public"."users" IS 'Allows organization admins to view users in their organization';



CREATE POLICY "users_own_profile_select" ON "public"."users" FOR SELECT USING (("id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "users_own_profile_select" ON "public"."users" IS 'Allows users to view their own profile';



CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING (("public"."is_super_admin"("auth"."uid"()) OR ("id" = "auth"."uid"()) OR ("current_organization_id" = "public"."get_current_org_id"())));



CREATE POLICY "users_super_admin_all" ON "public"."users" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "users_super_admin_all" ON "public"."users" IS 'Allows super admins full access to all users';



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



GRANT ALL ON FUNCTION "api"."check_organization_by_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."check_organization_by_name"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."check_organization_by_slug"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."check_organization_by_slug"("p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."create_organization_unit"("p_parent_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."deactivate_organization_unit"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."delete_organization_unit"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_stream_version" integer, "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "api"."emit_domain_event"("p_stream_id" "uuid", "p_stream_type" "text", "p_stream_version" integer, "p_event_type" "text", "p_event_data" "jsonb", "p_event_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "api"."emit_domain_event"("p_event_id" "uuid", "p_event_type" "text", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_event_data" "jsonb", "p_event_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "api"."emit_domain_event"("p_event_id" "uuid", "p_event_type" "text", "p_aggregate_type" "text", "p_aggregate_id" "uuid", "p_event_data" "jsonb", "p_event_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "api"."emit_workflow_started_event"("p_stream_id" "uuid", "p_bootstrap_event_id" "uuid", "p_workflow_id" "text", "p_workflow_run_id" "text", "p_workflow_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_child_organizations"("p_parent_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_child_organizations"("p_parent_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."get_invitation_by_token"("p_token" "text") TO "service_role";



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



GRANT ALL ON FUNCTION "api"."get_role_by_name_and_org"("p_role_name" "text", "p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_role_permission_names"("p_role_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."get_role_permission_templates"("p_role_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "api"."reactivate_organization_unit"("p_unit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "api"."soft_delete_organization_addresses"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "api"."soft_delete_organization_contacts"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "api"."soft_delete_organization_phones"("p_org_id" "uuid", "p_deleted_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "api"."update_organization_unit"("p_unit_id" "uuid", "p_name" "text", "p_display_name" "text", "p_timezone" "text") TO "service_role";

























































































































































REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."organization_units_projection" TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_user_claims_preview"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_workflow_worker_bootstrap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") TO "authenticated";


















GRANT SELECT ON TABLE "public"."addresses_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."addresses_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."contacts_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."contacts_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."cross_tenant_access_grants_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."cross_tenant_access_grants_projection" TO "service_role";



GRANT SELECT ON TABLE "public"."users" TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."impersonation_sessions_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."impersonation_sessions_projection" TO "service_role";



GRANT SELECT ON TABLE "public"."invitations_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."invitations_projection" TO "authenticated";



GRANT SELECT ON TABLE "public"."organization_business_profiles_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."organization_business_profiles_projection" TO "service_role";



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


































A new version of Supabase CLI is available: v2.67.1 (currently installed v2.58.5)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
