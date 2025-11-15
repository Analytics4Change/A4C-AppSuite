


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




ALTER SCHEMA "public" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "ltree" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."subdomain_status" AS ENUM (
    'pending',
    'dns_created',
    'verifying',
    'verified',
    'failed'
);


ALTER TYPE "public"."subdomain_status" OWNER TO "postgres";


COMMENT ON TYPE "public"."subdomain_status" IS 'Tracks subdomain provisioning lifecycle for organizations. Workflow: pending → dns_created → verifying → verified (or failed at any stage)';



CREATE OR REPLACE FUNCTION "public"."cleanup_old_bootstrap_failures"("p_days_old" integer DEFAULT 30) RETURNS integer
    LANGUAGE "plpgsql"
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
    AS $$
DECLARE
  v_user_id uuid;
  v_user_record record;
  v_claims jsonb;
  v_org_id uuid;
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
            AND ur.org_id IS NULL
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
      AND (ur.org_id = v_org_id OR ur.org_id IS NULL);
  END IF;

  -- Default to empty array if no permissions
  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims by merging with existing claims
  -- CRITICAL: Preserve all standard JWT fields (aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous)
  -- and add our custom claims (org_id, user_role, permissions, scope_path, claims_version)
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
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
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'claims_error', SQLERRM
      )
    );
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") IS 'Enriches Supabase Auth JWTs with custom claims: org_id, user_role, permissions, scope_path. Called automatically on token generation.';



CREATE OR REPLACE FUNCTION "public"."get_active_grants_for_consultant"("p_consultant_org_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("grant_id" "uuid", "provider_org_id" "uuid", "provider_org_name" "text", "scope" "text", "authorization_type" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
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



CREATE OR REPLACE FUNCTION "public"."get_bootstrap_status"("p_bootstrap_id" "uuid") RETURNS TABLE("bootstrap_id" "uuid", "organization_id" "uuid", "status" "text", "current_stage" "text", "error_message" "text", "created_at" timestamp with time zone, "completed_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH bootstrap_events AS (
    SELECT
      de.stream_id AS org_id,
      de.event_type,
      de.event_data,
      de.created_at,
      ROW_NUMBER() OVER (ORDER BY de.created_at DESC) AS rn
    FROM domain_events de
    WHERE de.event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
      AND de.stream_type = 'organization'
      AND de.event_type LIKE 'organization.bootstrap.%'
         OR de.event_type LIKE 'organization.zitadel.%'
         OR de.event_type LIKE 'organization.created'
  )
  SELECT
    p_bootstrap_id,
    be.org_id,
    CASE
      WHEN be.event_type = 'organization.bootstrap.completed' THEN 'completed'
      WHEN be.event_type = 'organization.bootstrap.failed' THEN 'failed'
      WHEN be.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
      WHEN be.event_type = 'organization.zitadel.created' THEN 'processing'
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'initiated'
      WHEN be.event_type = 'organization.bootstrap.temporal_initiated' THEN 'initiated'
      ELSE 'unknown'
    END,
    CASE
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'zitadel_creation'
      WHEN be.event_type = 'organization.bootstrap.temporal_initiated' THEN 'temporal_workflow_started'
      WHEN be.event_type = 'organization.zitadel.created' THEN 'organization_creation'
      WHEN be.event_type = 'organization.created' THEN 'role_assignment'
      WHEN be.event_type = 'organization.bootstrap.completed' THEN 'completed'
      WHEN be.event_type = 'organization.bootstrap.failed' THEN be.event_data->>'failure_stage'
      ELSE 'unknown'
    END,
    be.event_data->>'error_message',
    be.created_at,
    CASE
      WHEN be.event_type = 'organization.bootstrap.completed' THEN be.created_at
      ELSE NULL
    END
  FROM bootstrap_events be
  WHERE be.rn = 1; -- Most recent event
END;
$$;


ALTER FUNCTION "public"."get_bootstrap_status"("p_bootstrap_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_bootstrap_status"("p_bootstrap_id" "uuid") IS 'Get current status of a bootstrap process by bootstrap_id (tracks Temporal workflow progress)';



CREATE OR REPLACE FUNCTION "public"."get_current_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT (auth.jwt()->>'org_id')::uuid;
$$;


ALTER FUNCTION "public"."get_current_org_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_org_id"() IS 'Extracts org_id from JWT custom claims (Supabase Auth)';



CREATE OR REPLACE FUNCTION "public"."get_current_permissions"() RETURNS "text"[]
    LANGUAGE "sql" STABLE
    AS $$
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(
      COALESCE(auth.jwt()->'permissions', '[]'::jsonb)
    )
  );
$$;


ALTER FUNCTION "public"."get_current_permissions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_permissions"() IS 'Extracts permissions array from JWT custom claims (Supabase Auth)';



CREATE OR REPLACE FUNCTION "public"."get_current_scope_path"() RETURNS "public"."ltree"
    LANGUAGE "sql" STABLE
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
    AS $$
DECLARE
  v_sub text;
  v_user_id uuid;
BEGIN
  -- Check for testing override first
  BEGIN
    v_sub := current_setting('app.current_user', true);
    IF v_sub IS NOT NULL AND v_sub != '' THEN
      -- Try as UUID first (Supabase Auth format)
      BEGIN
        RETURN v_sub::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        -- Fall back to Zitadel mapping (legacy)
        RETURN get_internal_user_id(v_sub);
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- No override set, continue to JWT extraction
  END;

  -- Extract 'sub' claim from JWT
  v_sub := (auth.jwt()->>'sub')::text;

  IF v_sub IS NULL THEN
    RETURN NULL;
  END IF;

  -- Try as UUID first (Supabase Auth format)
  BEGIN
    RETURN v_sub::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Fall back to Zitadel mapping (legacy)
    RETURN get_internal_user_id(v_sub);
  END;
END;
$$;


ALTER FUNCTION "public"."get_current_user_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_user_id"() IS 'Extracts current user ID from JWT. Supports Supabase Auth (direct UUID) and legacy Zitadel (via mapping). Supports testing override via app.current_user setting.';



CREATE OR REPLACE FUNCTION "public"."get_current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT auth.jwt()->>'user_role';
$$;


ALTER FUNCTION "public"."get_current_user_role"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_user_role"() IS 'Extracts user_role from JWT custom claims (Supabase Auth)';



CREATE OR REPLACE FUNCTION "public"."get_entity_version"("p_stream_id" "uuid", "p_stream_type" "text") RETURNS integer
    LANGUAGE "sql" STABLE
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



CREATE OR REPLACE FUNCTION "public"."get_internal_org_id"("p_zitadel_org_id" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT internal_org_id
  FROM zitadel_organization_mapping
  WHERE zitadel_org_id = p_zitadel_org_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_internal_org_id"("p_zitadel_org_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_internal_org_id"("p_zitadel_org_id" "text") IS 'Resolves Zitadel organization ID (TEXT) to internal surrogate UUID';



CREATE OR REPLACE FUNCTION "public"."get_internal_user_id"("p_zitadel_user_id" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT internal_user_id
  FROM zitadel_user_mapping
  WHERE zitadel_user_id = p_zitadel_user_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_internal_user_id"("p_zitadel_user_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_internal_user_id"("p_zitadel_user_id" "text") IS 'Resolves Zitadel user ID (TEXT) to internal surrogate UUID';



CREATE OR REPLACE FUNCTION "public"."get_org_impersonation_audit"("p_org_id" "uuid", "p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("session_id" "text", "super_admin_email" "text", "target_email" "text", "justification_reason" "text", "justification_reference_id" "text", "started_at" timestamp with time zone, "ended_at" timestamp with time zone, "total_duration_ms" integer, "renewal_count" integer, "actions_performed" integer, "status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
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



CREATE OR REPLACE FUNCTION "public"."get_organization_ancestors"("p_org_path" "public"."ltree") RETURNS TABLE("id" "uuid", "name" "text", "path" "public"."ltree", "depth" integer, "is_active" boolean)
    LANGUAGE "plpgsql" STABLE
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


ALTER FUNCTION "public"."get_organization_ancestors"("p_org_path" "public"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_ancestors"("p_org_path" "public"."ltree") IS 'Returns all ancestor organizations for a given organization path';



CREATE OR REPLACE FUNCTION "public"."get_organization_descendants"("p_org_path" "public"."ltree") RETURNS TABLE("id" "uuid", "name" "text", "path" "public"."ltree", "depth" integer, "is_active" boolean)
    LANGUAGE "plpgsql" STABLE
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


ALTER FUNCTION "public"."get_organization_descendants"("p_org_path" "public"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_organization_descendants"("p_org_path" "public"."ltree") IS 'Returns all active descendant organizations for a given organization path';



CREATE OR REPLACE FUNCTION "public"."get_organization_subdomain"("p_org_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
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



CREATE OR REPLACE FUNCTION "public"."get_user_active_impersonation_sessions"("p_user_id" "uuid") RETURNS TABLE("session_id" "text", "super_admin_email" "text", "target_email" "text", "target_org_name" "text", "started_at" timestamp with time zone, "expires_at" timestamp with time zone, "renewal_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
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



CREATE OR REPLACE FUNCTION "public"."get_zitadel_org_id"("p_internal_org_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT zitadel_org_id
  FROM zitadel_organization_mapping
  WHERE internal_org_id = p_internal_org_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_zitadel_org_id"("p_internal_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_zitadel_org_id"("p_internal_org_id" "uuid") IS 'Resolves internal surrogate UUID to Zitadel organization ID (TEXT)';



CREATE OR REPLACE FUNCTION "public"."get_zitadel_user_id"("p_internal_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT zitadel_user_id
  FROM zitadel_user_mapping
  WHERE internal_user_id = p_internal_user_id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_zitadel_user_id"("p_internal_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_zitadel_user_id"("p_internal_user_id" "uuid") IS 'Resolves internal surrogate UUID to Zitadel user ID (TEXT)';



CREATE OR REPLACE FUNCTION "public"."handle_bootstrap_workflow"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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
                'cleanup_actions', ARRAY['partial_resource_cleanup'],
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



CREATE OR REPLACE FUNCTION "public"."has_permission"("p_permission" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT p_permission = ANY(get_current_permissions());
$$;


ALTER FUNCTION "public"."has_permission"("p_permission" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permission"("p_permission" "text") IS 'Checks if current user has a specific permission in their JWT claims';



CREATE OR REPLACE FUNCTION "public"."is_impersonation_session_active"("p_session_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
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
$$;


ALTER FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_org_admin"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Returns true if user has provider_admin or partner_admin role in the specified organization';



CREATE OR REPLACE FUNCTION "public"."is_provider_admin"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."is_provider_admin"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_provider_admin"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Checks if user has provider_admin role for specific organization';



CREATE OR REPLACE FUNCTION "public"."is_super_admin"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'super_admin'
      AND ur.org_id IS NULL
  );
END;
$$;


ALTER FUNCTION "public"."is_super_admin"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_super_admin"("p_user_id" "uuid") IS 'Checks if user has super_admin role with global scope';



CREATE OR REPLACE FUNCTION "public"."list_bootstrap_processes"("p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("bootstrap_id" "uuid", "organization_id" "uuid", "organization_name" "text", "organization_type" "text", "admin_email" "text", "status" "text", "created_at" timestamp with time zone, "completed_at" timestamp with time zone, "error_message" "text")
    LANGUAGE "plpgsql" STABLE
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



CREATE OR REPLACE FUNCTION "public"."process_access_grant_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
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
    AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle address creation
    WHEN 'address.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this address is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE addresses_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO addresses_projection (
        id, organization_id, label, street1, street2, city, state, zip_code,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'street1'),
        safe_jsonb_extract_text(p_event.event_data, 'street2'),
        safe_jsonb_extract_text(p_event.event_data, 'city'),
        safe_jsonb_extract_text(p_event.event_data, 'state'),
        safe_jsonb_extract_text(p_event.event_data, 'zip_code'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle address updates
    WHEN 'address.updated' THEN
      v_org_id := (SELECT organization_id FROM addresses_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE addresses_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE addresses_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        street1 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street1'), street1),
        street2 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street2'), street2),
        city = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'city'), city),
        state = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'state'), state),
        zip_code = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'zip_code'), zip_code),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle address deletion (logical)
    WHEN 'address.deleted' THEN
      UPDATE addresses_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown address event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_address_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_address_event"("p_event" "record") IS 'Process address.* events and update addresses_projection table - enforces single primary address per organization';



CREATE OR REPLACE FUNCTION "public"."process_client_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'client.registered' THEN
      INSERT INTO clients (
        id,
        organization_id,
        first_name,
        last_name,
        date_of_birth,
        gender,
        email,
        phone,
        address,
        emergency_contact,
        allergies,
        medical_conditions,
        blood_type,
        status,
        notes,
        metadata,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_date(p_event.event_data, 'date_of_birth'),
        safe_jsonb_extract_text(p_event.event_data, 'gender'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'phone'),
        COALESCE(p_event.event_data->'address', '{}'::JSONB),
        COALESCE(p_event.event_data->'emergency_contact', '{}'::JSONB),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'allergies', '[]'::JSONB)
        )),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'medical_conditions', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'blood_type'),
        'active',
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'client.admitted' THEN
      UPDATE clients
      SET
        admission_date = safe_jsonb_extract_date(p_event.event_data, 'admission_date'),
        status = 'active',
        metadata = metadata || jsonb_build_object(
          'admission_reason', safe_jsonb_extract_text(p_event.event_data, 'reason'),
          'facility_id', safe_jsonb_extract_text(p_event.event_data, 'facility_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.information_updated' THEN
      -- Apply partial updates from the changes object
      UPDATE clients
      SET
        first_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'first_name'),
          first_name
        ),
        last_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'last_name'),
          last_name
        ),
        email = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'email'),
          email
        ),
        phone = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'phone'),
          phone
        ),
        address = COALESCE(
          p_event.event_data->'changes'->'address',
          address
        ),
        emergency_contact = COALESCE(
          p_event.event_data->'changes'->'emergency_contact',
          emergency_contact
        ),
        allergies = CASE
          WHEN p_event.event_data->'changes' ? 'allergies' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'changes'->'allergies'))
          ELSE allergies
        END,
        medical_conditions = CASE
          WHEN p_event.event_data->'changes' ? 'medical_conditions' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'changes'->'medical_conditions'))
          ELSE medical_conditions
        END,
        blood_type = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'blood_type'),
          blood_type
        ),
        notes = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'notes'),
          notes
        ),
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
    safe_jsonb_extract_organization_id(p_event.event_data),
    p_event.event_type,
    'data_change',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    safe_jsonb_extract_text(p_event.event_metadata, 'user_email'),
    'clients',
    p_event.stream_id,
    NULL, -- Could extract from previous events if needed
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$;


ALTER FUNCTION "public"."process_client_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_client_event"("p_event" "record") IS 'Projects client events to the clients table and audit log';



CREATE OR REPLACE FUNCTION "public"."process_contact_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle contact creation
    WHEN 'contact.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this contact is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE contacts_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO contacts_projection (
        id, organization_id, label, first_name, last_name, email, title, department,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'title'),
        safe_jsonb_extract_text(p_event.event_data, 'department'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle contact updates
    WHEN 'contact.updated' THEN
      v_org_id := (SELECT organization_id FROM contacts_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE contacts_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE contacts_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        email = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'email'), email),
        title = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'title'), title),
        department = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'department'), department),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle contact deletion (logical)
    WHEN 'contact.deleted' THEN
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_contact_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_contact_event"("p_event" "record") IS 'Process contact.* events and update contacts_projection table - enforces single primary contact per organization';



CREATE OR REPLACE FUNCTION "public"."process_domain_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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

      -- Organization child entities
      WHEN 'program' THEN
        PERFORM process_program_event(NEW);

      WHEN 'contact' THEN
        PERFORM process_contact_event(NEW);

      WHEN 'address' THEN
        PERFORM process_address_event(NEW);

      WHEN 'phone' THEN
        PERFORM process_phone_event(NEW);

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
        -- Convert super_admin org_id: NULL for platform super_admin, resolve Zitadel ID to UUID for org-scoped admin
        CASE
          WHEN p_event.event_data->'super_admin'->>'org_id' IS NULL THEN NULL
          WHEN p_event.event_data->'super_admin'->>'org_id' = '*' THEN NULL
          ELSE get_internal_org_id(p_event.event_data->'super_admin'->>'org_id')
        END,
        -- Target
        (p_event.event_data->'target'->>'user_id')::UUID,
        p_event.event_data->'target'->>'email',
        p_event.event_data->'target'->>'name',
        -- Convert target org_id: Zitadel ID to internal UUID
        get_internal_org_id(p_event.event_data->'target'->>'org_id'),
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



CREATE OR REPLACE FUNCTION "public"."process_medication_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
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
      INSERT INTO organizations_projection (
        id, name, display_name, slug, zitadel_org_id, type, path, parent_path, depth,
        tax_number, phone_number, timezone, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        (p_event.event_data->>'path')::LTREE,
        CASE
          WHEN p_event.event_data ? 'parent_path'
          THEN (p_event.event_data->>'parent_path')::LTREE
          ELSE NULL
        END,
        nlevel((p_event.event_data->>'path')::LTREE),
        safe_jsonb_extract_text(p_event.event_data, 'tax_number'),
        safe_jsonb_extract_text(p_event.event_data, 'phone_number'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'America/New_York'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

      -- Populate Zitadel organization mapping (if zitadel_org_id exists)
      IF safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id') IS NOT NULL THEN
        PERFORM upsert_org_mapping(
          p_event.stream_id,
          safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id'),
          safe_jsonb_extract_text(p_event.event_data, 'name')
        );
      END IF;

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

    WHEN 'organization.zitadel.created' THEN
      -- Zitadel org/user creation successful: Continue with organization creation
      -- Note: This triggers organization.created event emission externally
      RAISE NOTICE 'Zitadel org created: % for bootstrap %', 
        p_event.event_data->>'zitadel_org_id',
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

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;

END;
$$;


ALTER FUNCTION "public"."process_organization_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_organization_event"("p_event" "record") IS 'Main organization event processor - handles creation, updates, deactivation, deletion with CQRS-compliant cascade logic';



CREATE OR REPLACE FUNCTION "public"."process_phone_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle phone creation
    WHEN 'phone.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this phone is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE phones_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO phones_projection (
        id, organization_id, label, number, extension, type,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'number'),
        safe_jsonb_extract_text(p_event.event_data, 'extension'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle phone updates
    WHEN 'phone.updated' THEN
      v_org_id := (SELECT organization_id FROM phones_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE phones_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE phones_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'number'), number),
        extension = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'extension'), extension),
        type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle phone deletion (logical)
    WHEN 'phone.deleted' THEN
      UPDATE phones_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown phone event type: %', p_event.event_type;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."process_phone_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_phone_event"("p_event" "record") IS 'Process phone.* events and update phones_projection table - enforces single primary phone per organization';



CREATE OR REPLACE FUNCTION "public"."process_program_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
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
    AS $$
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
$$;


ALTER FUNCTION "public"."process_rbac_event"("p_event" "record") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_rbac_event"("p_event" "record") IS 'Projects RBAC events to permission, role, user_role, and access_grant projection tables with full audit trail';



CREATE OR REPLACE FUNCTION "public"."process_user_invited_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Extract event data and insert/update invitation projection
  INSERT INTO invitations_projection (
    invitation_id,
    organization_id,
    email,
    first_name,
    last_name,
    role,
    token,
    expires_at,
    tags
  )
  VALUES (
    -- Extract from event_data (JSONB)
    (NEW.event_data->>'invitation_id')::UUID,
    (NEW.event_data->>'org_id')::UUID,
    NEW.event_data->>'email',
    NEW.event_data->>'first_name',
    NEW.event_data->>'last_name',
    NEW.event_data->>'role',
    NEW.event_data->>'token',
    (NEW.event_data->>'expires_at')::TIMESTAMPTZ,

    -- Extract tags from event_metadata (JSONB array)
    -- Coalesce to empty array if tags not present
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(NEW.event_metadata->'tags')),
      '{}'::TEXT[]
    )
  )
  ON CONFLICT (invitation_id) DO NOTHING;  -- Idempotency: ignore duplicate events

  -- Return NEW to continue trigger chain
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."process_user_invited_event"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_user_invited_event"() IS 'Event processor for UserInvited domain events. Updates invitations_projection with invitation data from Temporal workflows. Idempotent (ON CONFLICT DO NOTHING).';



CREATE OR REPLACE FUNCTION "public"."retry_failed_bootstrap"("p_bootstrap_id" "uuid", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
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
    AS $$
  SELECT COALESCE((p_data->>p_key)::BOOLEAN, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_boolean"("p_data" "jsonb", "p_key" "text", "p_default" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_date"("p_data" "jsonb", "p_key" "text", "p_default" "date" DEFAULT NULL::"date") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT COALESCE((p_data->>p_key)::DATE, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_date"("p_data" "jsonb", "p_key" "text", "p_default" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_organization_id"("p_data" "jsonb", "p_key" "text" DEFAULT 'organization_id'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
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

  -- Try to cast as UUID first (handles internal UUID format)
  BEGIN
    v_uuid := v_value::UUID;
    RETURN v_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If cast fails, it's an external_id (Zitadel or mock), look it up
    RETURN get_organization_uuid_from_external_id(v_value);
  END;
END;
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_organization_id"("p_data" "jsonb", "p_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."safe_jsonb_extract_organization_id"("p_data" "jsonb", "p_key" "text") IS 'Extract organization_id from event data, supporting UUID, Zitadel ID, and mock ID formats';



CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_text"("p_data" "jsonb", "p_key" "text", "p_default" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT COALESCE(p_data->>p_key, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_text"("p_data" "jsonb", "p_key" "text", "p_default" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_timestamp"("p_data" "jsonb", "p_key" "text", "p_default" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT COALESCE((p_data->>p_key)::TIMESTAMPTZ, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_timestamp"("p_data" "jsonb", "p_key" "text", "p_default" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb_extract_uuid"("p_data" "jsonb", "p_key" "text", "p_default" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT COALESCE((p_data->>p_key)::UUID, p_default);
$$;


ALTER FUNCTION "public"."safe_jsonb_extract_uuid"("p_data" "jsonb", "p_key" "text", "p_default" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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
      AND (ur.org_id = p_new_org_id OR ur.org_id IS NULL)  -- NULL for super_admin
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



CREATE OR REPLACE FUNCTION "public"."upsert_org_mapping"("p_internal_org_id" "uuid", "p_zitadel_org_id" "text", "p_org_name" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO zitadel_organization_mapping (
    internal_org_id,
    zitadel_org_id,
    org_name,
    created_at
  ) VALUES (
    p_internal_org_id,
    p_zitadel_org_id,
    p_org_name,
    NOW()
  )
  ON CONFLICT (internal_org_id) DO UPDATE SET
    org_name = COALESCE(EXCLUDED.org_name, zitadel_organization_mapping.org_name),
    updated_at = NOW();

  RETURN p_internal_org_id;
END;
$$;


ALTER FUNCTION "public"."upsert_org_mapping"("p_internal_org_id" "uuid", "p_zitadel_org_id" "text", "p_org_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_org_mapping"("p_internal_org_id" "uuid", "p_zitadel_org_id" "text", "p_org_name" "text") IS 'Creates or updates organization ID mapping (idempotent)';



CREATE OR REPLACE FUNCTION "public"."upsert_user_mapping"("p_internal_user_id" "uuid", "p_zitadel_user_id" "text", "p_user_email" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO zitadel_user_mapping (
    internal_user_id,
    zitadel_user_id,
    user_email,
    created_at
  ) VALUES (
    p_internal_user_id,
    p_zitadel_user_id,
    p_user_email,
    NOW()
  )
  ON CONFLICT (internal_user_id) DO UPDATE SET
    user_email = COALESCE(EXCLUDED.user_email, zitadel_user_mapping.user_email),
    updated_at = NOW();

  RETURN p_internal_user_id;
END;
$$;


ALTER FUNCTION "public"."upsert_user_mapping"("p_internal_user_id" "uuid", "p_zitadel_user_id" "text", "p_user_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_user_mapping"("p_internal_user_id" "uuid", "p_zitadel_user_id" "text", "p_user_email" "text") IS 'Creates or updates user ID mapping (idempotent)';



CREATE OR REPLACE FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_permission_name" "text", "p_org_id" "uuid", "p_scope_path" "public"."ltree" DEFAULT NULL::"public"."ltree") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
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
        ur.org_id IS NULL
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
$$;


ALTER FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_permission_name" "text", "p_org_id" "uuid", "p_scope_path" "public"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_permission_name" "text", "p_org_id" "uuid", "p_scope_path" "public"."ltree") IS 'Checks if user has specified permission within given org/scope context';



CREATE OR REPLACE FUNCTION "public"."user_organizations"("p_user_id" "uuid") RETURNS TABLE("org_id" "uuid", "role_name" "text", "scope_path" "public"."ltree")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."user_organizations"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_organizations"("p_user_id" "uuid") IS 'Returns all organizations where user has assigned roles';



CREATE OR REPLACE FUNCTION "public"."user_permissions"("p_user_id" "uuid", "p_org_id" "uuid") RETURNS TABLE("permission_name" "text", "applet" "text", "action" "text", "description" "text", "requires_mfa" boolean, "scope_type" "text", "role_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
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
      ur.org_id IS NULL  -- Super admin sees all
      OR ur.org_id = p_org_id
    )
  ORDER BY p.applet, p.action;
END;
$$;


ALTER FUNCTION "public"."user_permissions"("p_user_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_permissions"("p_user_id" "uuid", "p_org_id" "uuid") IS 'Returns all permissions for a user within a specific organization';



CREATE OR REPLACE FUNCTION "public"."validate_cross_tenant_access"("p_consultant_org_id" "uuid", "p_provider_org_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
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



CREATE OR REPLACE FUNCTION "public"."validate_organization_hierarchy"("p_path" "public"."ltree", "p_parent_path" "public"."ltree") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
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


ALTER FUNCTION "public"."validate_organization_hierarchy"("p_path" "public"."ltree", "p_parent_path" "public"."ltree") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_organization_hierarchy"("p_path" "public"."ltree", "p_parent_path" "public"."ltree") IS 'Validates that organization path structure follows ltree hierarchy rules';


SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    "street1" "text" NOT NULL,
    "street2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip_code" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."addresses_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."addresses_projection" IS 'CQRS projection of address.* events - physical addresses associated with organizations';



COMMENT ON COLUMN "public"."addresses_projection"."label" IS 'Address type/label: Billing Address, Shipping Address, Main Office, etc.';



COMMENT ON COLUMN "public"."addresses_projection"."state" IS 'US state abbreviation (2-letter code)';



COMMENT ON COLUMN "public"."addresses_projection"."zip_code" IS 'US zip code (5-digit or 9-digit format)';



COMMENT ON COLUMN "public"."addresses_projection"."is_primary" IS 'Primary address for the organization (only one per org)';



CREATE TABLE IF NOT EXISTS "public"."api_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "request_id" "text" NOT NULL,
    "request_timestamp" timestamp with time zone NOT NULL,
    "request_method" "text" NOT NULL,
    "request_path" "text" NOT NULL,
    "response_status_code" integer,
    "response_time_ms" integer,
    "auth_user_id" "uuid",
    "client_ip" "inet",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."api_audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."api_audit_log" IS 'REST API specific audit logging with performance metrics';



CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "event_type" "text" NOT NULL,
    "event_category" "text" NOT NULL,
    "user_id" "uuid",
    "user_email" "text",
    "resource_type" "text",
    "resource_id" "uuid",
    "operation" "text",
    "old_values" "jsonb",
    "new_values" "jsonb",
    "ip_address" "inet",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'CQRS projection for audit trail - General system audit trail for all data changes';



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



CREATE TABLE IF NOT EXISTS "public"."contacts_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
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



COMMENT ON COLUMN "public"."contacts_projection"."label" IS 'Contact type/label: A4C Admin Contact, Billing Contact, Technical Contact, etc.';



COMMENT ON COLUMN "public"."contacts_projection"."is_primary" IS 'Primary contact for the organization (only one per org)';



COMMENT ON COLUMN "public"."contacts_projection"."is_active" IS 'Contact active status';



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


COMMENT ON TABLE "public"."domain_events" IS 'Event store - single source of truth for all system changes';



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
    CONSTRAINT "impersonation_sessions_projection_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'ended'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."impersonation_sessions_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."impersonation_sessions_projection" IS 'CQRS projection of impersonation sessions. Source: domain_events with stream_type=impersonation. Tracks Super Admin impersonation sessions with full audit trail.';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."session_id" IS 'Unique session identifier (from event_data.session_id)';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."justification_reason" IS 'Category of justification: support_ticket, emergency, audit, training';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."status" IS 'Session status: active (currently running), ended (manually terminated or declined renewal), expired (timed out)';



COMMENT ON COLUMN "public"."impersonation_sessions_projection"."renewal_count" IS 'Number of times session was renewed (incremented by impersonation.renewed events)';



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
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."medications" OWNER TO "postgres";


COMMENT ON TABLE "public"."medications" IS 'Medication catalog with comprehensive drug information';



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



CREATE TABLE IF NOT EXISTS "public"."organizations_projection" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text",
    "slug" "text" NOT NULL,
    "type" "text" NOT NULL,
    "path" "public"."ltree" NOT NULL,
    "parent_path" "public"."ltree",
    "depth" integer GENERATED ALWAYS AS ("public"."nlevel"("path")) STORED,
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
    "subdomain_status" "public"."subdomain_status" DEFAULT 'pending'::"public"."subdomain_status",
    "cloudflare_record_id" "text",
    "dns_verified_at" timestamp with time zone,
    "subdomain_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "tags" "text"[] DEFAULT '{}'::"text"[],
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



COMMENT ON COLUMN "public"."organizations_projection"."subdomain_status" IS 'Subdomain provisioning status - tracks DNS creation and verification lifecycle';



COMMENT ON COLUMN "public"."organizations_projection"."cloudflare_record_id" IS 'Cloudflare DNS record ID for {slug}.{BASE_DOMAIN} subdomain (from Cloudflare API response)';



COMMENT ON COLUMN "public"."organizations_projection"."dns_verified_at" IS 'Timestamp when DNS verification completed successfully (subdomain resolvable)';



COMMENT ON COLUMN "public"."organizations_projection"."subdomain_metadata" IS 'Additional subdomain provisioning metadata: dns_record details, verification attempts, errors';



COMMENT ON COLUMN "public"."organizations_projection"."tags" IS 'Development entity tracking tags. Enables cleanup scripts to identify test data. Example tags: ["development", "test", "mode:development"]. Query with: WHERE tags @> ARRAY[''development'']';



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



CREATE TABLE IF NOT EXISTS "public"."phones_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "number" "text" NOT NULL,
    "extension" "text",
    "type" "text",
    "is_primary" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."phones_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."phones_projection" IS 'CQRS projection of phone.* events - phone numbers associated with organizations';



COMMENT ON COLUMN "public"."phones_projection"."label" IS 'Phone type/label: Billing Phone, Main Office, Emergency Contact, Fax, etc.';



COMMENT ON COLUMN "public"."phones_projection"."number" IS 'US phone number in formatted display format';



COMMENT ON COLUMN "public"."phones_projection"."extension" IS 'Phone extension for office numbers (optional)';



COMMENT ON COLUMN "public"."phones_projection"."type" IS 'Phone type: mobile, office, fax, emergency, other';



COMMENT ON COLUMN "public"."phones_projection"."is_primary" IS 'Primary phone for the organization (only one per org)';



CREATE TABLE IF NOT EXISTS "public"."programs_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "description" "text",
    "capacity" integer,
    "current_occupancy" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "activated_at" timestamp with time zone,
    "deactivated_at" timestamp with time zone,
    "deactivation_reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."programs_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."programs_projection" IS 'CQRS projection of program.* events - treatment programs offered by organizations';



COMMENT ON COLUMN "public"."programs_projection"."type" IS 'Program type: residential, outpatient, day_treatment, iop, php, sober_living, mat';



COMMENT ON COLUMN "public"."programs_projection"."capacity" IS 'Maximum number of clients this program can serve (NULL = unlimited)';



COMMENT ON COLUMN "public"."programs_projection"."current_occupancy" IS 'Current number of active clients in program';



COMMENT ON COLUMN "public"."programs_projection"."is_active" IS 'Program active status (affects client enrollment)';



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
    "org_hierarchy_scope" "public"."ltree",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    CONSTRAINT "roles_projection_check" CHECK (((("name" = 'super_admin'::"text") AND ("organization_id" IS NULL) AND ("org_hierarchy_scope" IS NULL)) OR (("name" <> 'super_admin'::"text") AND ("organization_id" IS NOT NULL) AND ("org_hierarchy_scope" IS NOT NULL)))),
    CONSTRAINT "roles_projection_scope_check" CHECK (((("name" = ANY (ARRAY['super_admin'::"text", 'provider_admin'::"text", 'partner_admin'::"text"])) AND ("organization_id" IS NULL) AND ("org_hierarchy_scope" IS NULL)) OR (("name" <> ALL (ARRAY['super_admin'::"text", 'provider_admin'::"text", 'partner_admin'::"text"])) AND ("organization_id" IS NOT NULL) AND ("org_hierarchy_scope" IS NOT NULL))))
);


ALTER TABLE "public"."roles_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."roles_projection" IS 'Projection of role.created events - defines collections of permissions';



COMMENT ON COLUMN "public"."roles_projection"."organization_id" IS 'Internal organization UUID for JOINs (NULL for super_admin with global scope)';



COMMENT ON COLUMN "public"."roles_projection"."org_hierarchy_scope" IS 'ltree path for hierarchical scoping (NULL for super_admin)';



COMMENT ON CONSTRAINT "roles_projection_scope_check" ON "public"."roles_projection" IS 'Ensures global role templates (super_admin, provider_admin, partner_admin) have NULL org scope, org-specific roles have org scope';



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
    "org_id" "uuid",
    "scope_path" "public"."ltree",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_roles_projection_check" CHECK (((("org_id" IS NULL) AND ("scope_path" IS NULL)) OR (("org_id" IS NOT NULL) AND ("scope_path" IS NOT NULL))))
);


ALTER TABLE "public"."user_roles_projection" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_roles_projection" IS 'Projection of user.role.* events - assigns roles to users with org scoping';



COMMENT ON COLUMN "public"."user_roles_projection"."org_id" IS 'Organization UUID (NULL for super_admin global access, specific UUID for scoped roles)';



COMMENT ON COLUMN "public"."user_roles_projection"."scope_path" IS 'ltree hierarchy path for granular scoping (NULL for global access)';



COMMENT ON COLUMN "public"."user_roles_projection"."assigned_at" IS 'Timestamp when role was assigned to user';



CREATE TABLE IF NOT EXISTS "public"."zitadel_organization_mapping" (
    "internal_org_id" "uuid" NOT NULL,
    "zitadel_org_id" "text" NOT NULL,
    "org_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."zitadel_organization_mapping" OWNER TO "postgres";


COMMENT ON TABLE "public"."zitadel_organization_mapping" IS 'Maps external Zitadel organization IDs (TEXT) to internal surrogate UUIDs for consistent domain model';



COMMENT ON COLUMN "public"."zitadel_organization_mapping"."internal_org_id" IS 'Internal UUID surrogate key used in all domain tables (organizations_projection.id)';



COMMENT ON COLUMN "public"."zitadel_organization_mapping"."zitadel_org_id" IS 'External Zitadel organization ID (18-digit numeric string from Zitadel API)';



COMMENT ON COLUMN "public"."zitadel_organization_mapping"."org_name" IS 'Cached organization name from Zitadel for convenience (updated on sync)';



CREATE TABLE IF NOT EXISTS "public"."zitadel_user_mapping" (
    "internal_user_id" "uuid" NOT NULL,
    "zitadel_user_id" "text" NOT NULL,
    "user_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."zitadel_user_mapping" OWNER TO "postgres";


COMMENT ON TABLE "public"."zitadel_user_mapping" IS 'Maps external Zitadel user IDs (TEXT) to internal surrogate UUIDs for consistent domain model';



COMMENT ON COLUMN "public"."zitadel_user_mapping"."internal_user_id" IS 'Internal UUID surrogate key used in all domain tables (users.id)';



COMMENT ON COLUMN "public"."zitadel_user_mapping"."zitadel_user_id" IS 'External Zitadel user ID (string format from Zitadel API)';



COMMENT ON COLUMN "public"."zitadel_user_mapping"."user_email" IS 'Cached user email from Zitadel for convenience (updated on sync)';



ALTER TABLE ONLY "public"."_migrations_applied" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."_migrations_applied_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."domain_events" ALTER COLUMN "sequence_number" SET DEFAULT "nextval"('"public"."domain_events_sequence_number_seq"'::"regclass");



ALTER TABLE ONLY "public"."_migrations_applied"
    ADD CONSTRAINT "_migrations_applied_migration_name_key" UNIQUE ("migration_name");



ALTER TABLE ONLY "public"."_migrations_applied"
    ADD CONSTRAINT "_migrations_applied_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."addresses_projection"
    ADD CONSTRAINT "addresses_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_audit_log"
    ADD CONSTRAINT "api_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_audit_log"
    ADD CONSTRAINT "api_audit_log_request_id_key" UNIQUE ("request_id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."organization_business_profiles_projection"
    ADD CONSTRAINT "organization_business_profiles_projection_pkey" PRIMARY KEY ("organization_id");



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



ALTER TABLE ONLY "public"."phones_projection"
    ADD CONSTRAINT "phones_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programs_projection"
    ADD CONSTRAINT "programs_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions_projection"
    ADD CONSTRAINT "role_permissions_projection_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles_projection"
    ADD CONSTRAINT "roles_projection_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles_projection"
    ADD CONSTRAINT "roles_projection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_events"
    ADD CONSTRAINT "unique_stream_version" UNIQUE ("stream_id", "stream_type", "stream_version");



ALTER TABLE ONLY "public"."user_roles_projection"
    ADD CONSTRAINT "user_roles_projection_user_id_role_id_org_id_key" UNIQUE NULLS NOT DISTINCT ("user_id", "role_id", "org_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zitadel_organization_mapping"
    ADD CONSTRAINT "zitadel_organization_mapping_pkey" PRIMARY KEY ("internal_org_id");



ALTER TABLE ONLY "public"."zitadel_organization_mapping"
    ADD CONSTRAINT "zitadel_organization_mapping_zitadel_org_id_key" UNIQUE ("zitadel_org_id");



ALTER TABLE ONLY "public"."zitadel_user_mapping"
    ADD CONSTRAINT "zitadel_user_mapping_pkey" PRIMARY KEY ("internal_user_id");



ALTER TABLE ONLY "public"."zitadel_user_mapping"
    ADD CONSTRAINT "zitadel_user_mapping_zitadel_user_id_key" UNIQUE ("zitadel_user_id");



CREATE INDEX "idx_access_grants_authorization_type" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("authorization_type");



CREATE INDEX "idx_access_grants_consultant_org" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("consultant_org_id");



CREATE INDEX "idx_access_grants_consultant_user" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("consultant_user_id") WHERE ("consultant_user_id" IS NOT NULL);



CREATE INDEX "idx_access_grants_expires" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("expires_at", "status") WHERE (("expires_at" IS NOT NULL) AND ("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])));



CREATE INDEX "idx_access_grants_granted_by" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("granted_by", "granted_at");



CREATE INDEX "idx_access_grants_lookup" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("consultant_org_id", "provider_org_id", "status") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_access_grants_provider_org" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("provider_org_id");



CREATE INDEX "idx_access_grants_scope" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("scope");



CREATE INDEX "idx_access_grants_status" ON "public"."cross_tenant_access_grants_projection" USING "btree" ("status");



CREATE INDEX "idx_addresses_active" ON "public"."addresses_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_addresses_label" ON "public"."addresses_projection" USING "btree" ("label", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_addresses_one_primary_per_org" ON "public"."addresses_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_addresses_organization" ON "public"."addresses_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_addresses_primary" ON "public"."addresses_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_api_audit_log_client_ip" ON "public"."api_audit_log" USING "btree" ("client_ip");



CREATE INDEX "idx_api_audit_log_method_path" ON "public"."api_audit_log" USING "btree" ("request_method", "request_path");



CREATE INDEX "idx_api_audit_log_organization" ON "public"."api_audit_log" USING "btree" ("organization_id");



CREATE INDEX "idx_api_audit_log_request_id" ON "public"."api_audit_log" USING "btree" ("request_id");



CREATE INDEX "idx_api_audit_log_status" ON "public"."api_audit_log" USING "btree" ("response_status_code");



CREATE INDEX "idx_api_audit_log_timestamp" ON "public"."api_audit_log" USING "btree" ("request_timestamp" DESC);



CREATE INDEX "idx_api_audit_log_user" ON "public"."api_audit_log" USING "btree" ("auth_user_id");



CREATE INDEX "idx_audit_log_created_at" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_log_event_type" ON "public"."audit_log" USING "btree" ("event_type");



CREATE INDEX "idx_audit_log_organization" ON "public"."audit_log" USING "btree" ("organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "idx_audit_log_resource" ON "public"."audit_log" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_audit_log_user" ON "public"."audit_log" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_clients_dob" ON "public"."clients" USING "btree" ("date_of_birth");



CREATE INDEX "idx_clients_name" ON "public"."clients" USING "btree" ("last_name", "first_name");



CREATE INDEX "idx_clients_organization" ON "public"."clients" USING "btree" ("organization_id");



CREATE INDEX "idx_clients_status" ON "public"."clients" USING "btree" ("status");



CREATE INDEX "idx_contacts_active" ON "public"."contacts_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_email" ON "public"."contacts_projection" USING "btree" ("email") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_contacts_one_primary_per_org" ON "public"."contacts_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_contacts_organization" ON "public"."contacts_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_contacts_primary" ON "public"."contacts_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_domain_events_correlation" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'correlation_id'::"text"))) WHERE ("event_metadata" ? 'correlation_id'::"text");



CREATE INDEX "idx_domain_events_created" ON "public"."domain_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_domain_events_stream" ON "public"."domain_events" USING "btree" ("stream_id", "stream_type");



CREATE INDEX "idx_domain_events_type" ON "public"."domain_events" USING "btree" ("event_type");



CREATE INDEX "idx_domain_events_unprocessed" ON "public"."domain_events" USING "btree" ("processed_at") WHERE ("processed_at" IS NULL);



CREATE INDEX "idx_domain_events_user" ON "public"."domain_events" USING "btree" ((("event_metadata" ->> 'user_id'::"text"))) WHERE ("event_metadata" ? 'user_id'::"text");



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



CREATE INDEX "idx_medication_history_medication" ON "public"."medication_history" USING "btree" ("medication_id");



CREATE INDEX "idx_medication_history_organization" ON "public"."medication_history" USING "btree" ("organization_id");



CREATE INDEX "idx_medication_history_prescription_date" ON "public"."medication_history" USING "btree" ("prescription_date");



CREATE INDEX "idx_medication_history_status" ON "public"."medication_history" USING "btree" ("status");



CREATE INDEX "idx_medications_generic_name" ON "public"."medications" USING "btree" ("generic_name");



CREATE INDEX "idx_medications_is_active" ON "public"."medications" USING "btree" ("is_active");



CREATE INDEX "idx_medications_name" ON "public"."medications" USING "btree" ("name");



CREATE INDEX "idx_medications_organization" ON "public"."medications" USING "btree" ("organization_id");



CREATE INDEX "idx_medications_rxnorm" ON "public"."medications" USING "btree" ("rxnorm_cui");



CREATE INDEX "idx_migrations_applied_at" ON "public"."_migrations_applied" USING "btree" ("applied_at" DESC);



CREATE INDEX "idx_migrations_name" ON "public"."_migrations_applied" USING "btree" ("migration_name");



CREATE INDEX "idx_org_business_profiles_mailing_address" ON "public"."organization_business_profiles_projection" USING "gin" ("mailing_address") WHERE ("mailing_address" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_partner_profile" ON "public"."organization_business_profiles_projection" USING "gin" ("partner_profile") WHERE ("partner_profile" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_provider_profile" ON "public"."organization_business_profiles_projection" USING "gin" ("provider_profile") WHERE ("provider_profile" IS NOT NULL);



CREATE INDEX "idx_org_business_profiles_type" ON "public"."organization_business_profiles_projection" USING "btree" ("organization_type");



CREATE INDEX "idx_organizations_active" ON "public"."organizations_projection" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_organizations_deleted" ON "public"."organizations_projection" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_organizations_is_active" ON "public"."organizations_projection" USING "btree" ("is_active");



CREATE INDEX "idx_organizations_parent_path" ON "public"."organizations_projection" USING "gist" ("parent_path") WHERE ("parent_path" IS NOT NULL);



CREATE INDEX "idx_organizations_path" ON "public"."organizations_projection" USING "gist" ("path");



CREATE INDEX "idx_organizations_path_btree" ON "public"."organizations_projection" USING "btree" ("path");



CREATE INDEX "idx_organizations_path_gist" ON "public"."organizations_projection" USING "gist" ("path");



CREATE INDEX "idx_organizations_projection_tags" ON "public"."organizations_projection" USING "gin" ("tags");



CREATE INDEX "idx_organizations_slug" ON "public"."organizations_projection" USING "btree" ("slug");



CREATE INDEX "idx_organizations_subdomain_failed" ON "public"."organizations_projection" USING "btree" ("subdomain_status", "updated_at") WHERE ("subdomain_status" = 'failed'::"public"."subdomain_status");



CREATE INDEX "idx_organizations_subdomain_status" ON "public"."organizations_projection" USING "btree" ("subdomain_status") WHERE ("subdomain_status" <> 'verified'::"public"."subdomain_status");



CREATE INDEX "idx_organizations_type" ON "public"."organizations_projection" USING "btree" ("type");



CREATE INDEX "idx_permissions_applet" ON "public"."permissions_projection" USING "btree" ("applet");



CREATE INDEX "idx_permissions_name" ON "public"."permissions_projection" USING "btree" ("name");



CREATE INDEX "idx_permissions_requires_mfa" ON "public"."permissions_projection" USING "btree" ("requires_mfa") WHERE ("requires_mfa" = true);



CREATE INDEX "idx_permissions_scope_type" ON "public"."permissions_projection" USING "btree" ("scope_type");



CREATE INDEX "idx_phones_active" ON "public"."phones_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_phones_label" ON "public"."phones_projection" USING "btree" ("label", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_phones_one_primary_per_org" ON "public"."phones_projection" USING "btree" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_phones_organization" ON "public"."phones_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_phones_primary" ON "public"."phones_projection" USING "btree" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_phones_type" ON "public"."phones_projection" USING "btree" ("type", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_programs_active" ON "public"."programs_projection" USING "btree" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_programs_organization" ON "public"."programs_projection" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_programs_type" ON "public"."programs_projection" USING "btree" ("type") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_role_permissions_permission" ON "public"."role_permissions_projection" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role" ON "public"."role_permissions_projection" USING "btree" ("role_id");



CREATE INDEX "idx_roles_hierarchy_scope" ON "public"."roles_projection" USING "gist" ("org_hierarchy_scope") WHERE ("org_hierarchy_scope" IS NOT NULL);



CREATE INDEX "idx_roles_name" ON "public"."roles_projection" USING "btree" ("name");



CREATE INDEX "idx_roles_organization_id" ON "public"."roles_projection" USING "btree" ("organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "idx_user_roles_auth_lookup" ON "public"."user_roles_projection" USING "btree" ("user_id", "org_id");



CREATE INDEX "idx_user_roles_org" ON "public"."user_roles_projection" USING "btree" ("org_id") WHERE ("org_id" IS NOT NULL);



CREATE INDEX "idx_user_roles_role" ON "public"."user_roles_projection" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_scope_path" ON "public"."user_roles_projection" USING "gist" ("scope_path") WHERE ("scope_path" IS NOT NULL);



CREATE INDEX "idx_user_roles_user" ON "public"."user_roles_projection" USING "btree" ("user_id");



CREATE INDEX "idx_users_current_organization" ON "public"."users" USING "btree" ("current_organization_id") WHERE ("current_organization_id" IS NOT NULL);



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_roles" ON "public"."users" USING "gin" ("roles");



CREATE INDEX "idx_zitadel_org_mapping_internal_id" ON "public"."zitadel_organization_mapping" USING "btree" ("internal_org_id");



CREATE INDEX "idx_zitadel_org_mapping_zitadel_id" ON "public"."zitadel_organization_mapping" USING "btree" ("zitadel_org_id");



CREATE INDEX "idx_zitadel_user_mapping_email" ON "public"."zitadel_user_mapping" USING "btree" ("user_email") WHERE ("user_email" IS NOT NULL);



CREATE INDEX "idx_zitadel_user_mapping_internal_id" ON "public"."zitadel_user_mapping" USING "btree" ("internal_user_id");



CREATE INDEX "idx_zitadel_user_mapping_zitadel_id" ON "public"."zitadel_user_mapping" USING "btree" ("zitadel_user_id");



CREATE OR REPLACE TRIGGER "bootstrap_workflow_trigger" AFTER INSERT ON "public"."domain_events" FOR EACH ROW EXECUTE FUNCTION "public"."handle_bootstrap_workflow"();



CREATE OR REPLACE TRIGGER "process_domain_event_trigger" BEFORE INSERT OR UPDATE ON "public"."domain_events" FOR EACH ROW EXECUTE FUNCTION "public"."process_domain_event"();



CREATE OR REPLACE TRIGGER "process_user_invited_event" AFTER INSERT ON "public"."domain_events" FOR EACH ROW WHEN (("new"."event_type" = 'UserInvited'::"text")) EXECUTE FUNCTION "public"."process_user_invited_event"();



ALTER TABLE ONLY "public"."addresses_projection"
    ADD CONSTRAINT "addresses_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts_projection"
    ADD CONSTRAINT "contacts_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations_projection"
    ADD CONSTRAINT "invitations_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."organization_business_profiles_projection"
    ADD CONSTRAINT "organization_business_profiles_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");



ALTER TABLE ONLY "public"."phones_projection"
    ADD CONSTRAINT "phones_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."programs_projection"
    ADD CONSTRAINT "programs_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions_projection"
    ADD CONSTRAINT "role_permissions_projection_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions_projection"("id");



ALTER TABLE ONLY "public"."role_permissions_projection"
    ADD CONSTRAINT "role_permissions_projection_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles_projection"("id");



ALTER TABLE "public"."api_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


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



ALTER TABLE "public"."cross_tenant_access_grants_projection" ENABLE ROW LEVEL SECURITY;


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
  WHERE (("ur"."user_id" = ("current_setting"('app.current_user'::"text"))::"uuid") AND ("r"."name" = 'provider_admin'::"text") AND ("ur"."org_id" = "impersonation_sessions_projection"."target_org_id"))))));



COMMENT ON POLICY "impersonation_sessions_provider_admin_select" ON "public"."impersonation_sessions_projection" IS 'Allows provider admins to view impersonation sessions that affected their organization';



CREATE POLICY "impersonation_sessions_super_admin_select" ON "public"."impersonation_sessions_projection" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles_projection" "ur"
     JOIN "public"."roles_projection" "r" ON (("r"."id" = "ur"."role_id")))
  WHERE (("ur"."user_id" = ("current_setting"('app.current_user'::"text"))::"uuid") AND ("r"."name" = 'super_admin'::"text") AND ("ur"."org_id" IS NULL)))));



COMMENT ON POLICY "impersonation_sessions_super_admin_select" ON "public"."impersonation_sessions_projection" IS 'Allows super admins to view all impersonation sessions across all organizations';



ALTER TABLE "public"."invitations_projection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medication_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "medication_history_delete" ON "public"."medication_history" FOR DELETE USING (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.prescribe'::"text", "organization_id"))));



COMMENT ON POLICY "medication_history_delete" ON "public"."medication_history" IS 'Allows authorized prescribers to discontinue prescriptions';



CREATE POLICY "medication_history_insert" ON "public"."medication_history" FOR INSERT WITH CHECK (("public"."is_super_admin"("public"."get_current_user_id"()) OR (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid") AND "public"."user_has_permission"("public"."get_current_user_id"(), 'medications.prescribe'::"text", "organization_id"))));



COMMENT ON POLICY "medication_history_insert" ON "public"."medication_history" IS 'Allows authorized prescribers to create prescriptions in their organization';



CREATE POLICY "medication_history_org_select" ON "public"."medication_history" FOR SELECT USING (("organization_id" = (("auth"."jwt"() ->> 'org_id'::"text"))::"uuid"));



COMMENT ON POLICY "medication_history_org_select" ON "public"."medication_history" IS 'Allows organization users to view prescription records in their own organization';



CREATE POLICY "medication_history_super_admin_select" ON "public"."medication_history" FOR SELECT USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "medication_history_super_admin_select" ON "public"."medication_history" IS 'Allows super admins to view all prescription records across all organizations';



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



CREATE POLICY "organizations_org_admin_select" ON "public"."organizations_projection" FOR SELECT USING ("public"."is_org_admin"("public"."get_current_user_id"(), "id"));



COMMENT ON POLICY "organizations_org_admin_select" ON "public"."organizations_projection" IS 'Allows organization admins to view their own organization details';



ALTER TABLE "public"."organizations_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_select" ON "public"."organizations_projection" FOR SELECT USING (("public"."is_super_admin"("auth"."uid"()) OR ("id" = "public"."get_current_org_id"())));



CREATE POLICY "organizations_super_admin_all" ON "public"."organizations_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "organizations_super_admin_all" ON "public"."organizations_projection" IS 'Allows super admins full access to all organizations';



CREATE POLICY "permissions_authenticated_select" ON "public"."permissions_projection" FOR SELECT USING (("public"."get_current_user_id"() IS NOT NULL));



COMMENT ON POLICY "permissions_authenticated_select" ON "public"."permissions_projection" IS 'Allows authenticated users to view available permissions';



ALTER TABLE "public"."permissions_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_super_admin_all" ON "public"."permissions_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "permissions_super_admin_all" ON "public"."permissions_projection" IS 'Allows super admins full access to permission definitions';



CREATE POLICY "permissions_superadmin" ON "public"."permissions_projection" USING ("public"."is_super_admin"("auth"."uid"()));



ALTER TABLE "public"."role_permissions_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_super_admin_all" ON "public"."role_permissions_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "role_permissions_super_admin_all" ON "public"."role_permissions_projection" IS 'Allows super admins full access to all role-permission grants';



CREATE POLICY "role_permissions_superadmin" ON "public"."role_permissions_projection" USING ("public"."is_super_admin"("auth"."uid"()));



ALTER TABLE "public"."roles_projection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_super_admin_all" ON "public"."roles_projection" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "roles_super_admin_all" ON "public"."roles_projection" IS 'Allows super admins full access to all roles';



CREATE POLICY "roles_superadmin" ON "public"."roles_projection" USING ("public"."is_super_admin"("auth"."uid"()));



CREATE POLICY "user_roles_org_admin_select" ON "public"."user_roles_projection" FOR SELECT USING ((("org_id" IS NOT NULL) AND "public"."is_org_admin"("public"."get_current_user_id"(), "org_id")));



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
  WHERE (("ur"."user_id" = "users"."id") AND "public"."is_org_admin"("public"."get_current_user_id"(), "ur"."org_id")))));



COMMENT ON POLICY "users_org_admin_select" ON "public"."users" IS 'Allows organization admins to view users in their organization';



CREATE POLICY "users_own_profile_select" ON "public"."users" FOR SELECT USING (("id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "users_own_profile_select" ON "public"."users" IS 'Allows users to view their own profile';



CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING (("public"."is_super_admin"("auth"."uid"()) OR ("id" = "auth"."uid"()) OR ("current_organization_id" = "public"."get_current_org_id"())));



CREATE POLICY "users_super_admin_all" ON "public"."users" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "users_super_admin_all" ON "public"."users" IS 'Allows super admins full access to all users';



CREATE POLICY "zitadel_org_mapping_org_admin_select" ON "public"."zitadel_organization_mapping" FOR SELECT USING ("public"."is_org_admin"("public"."get_current_user_id"(), "internal_org_id"));



COMMENT ON POLICY "zitadel_org_mapping_org_admin_select" ON "public"."zitadel_organization_mapping" IS 'Allows organization admins to view their own Zitadel organization mapping';



CREATE POLICY "zitadel_org_mapping_super_admin_all" ON "public"."zitadel_organization_mapping" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "zitadel_org_mapping_super_admin_all" ON "public"."zitadel_organization_mapping" IS 'Allows super admins full access to all Zitadel organization mappings';



CREATE POLICY "zitadel_user_mapping_own_select" ON "public"."zitadel_user_mapping" FOR SELECT USING (("internal_user_id" = "public"."get_current_user_id"()));



COMMENT ON POLICY "zitadel_user_mapping_own_select" ON "public"."zitadel_user_mapping" IS 'Allows users to view their own Zitadel ID mapping';



CREATE POLICY "zitadel_user_mapping_super_admin_all" ON "public"."zitadel_user_mapping" USING ("public"."is_super_admin"("public"."get_current_user_id"()));



COMMENT ON POLICY "zitadel_user_mapping_super_admin_all" ON "public"."zitadel_user_mapping" IS 'Allows super admins full access to all Zitadel user mappings';





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "api" TO "anon";
GRANT USAGE ON SCHEMA "api" TO "authenticated";
GRANT USAGE ON SCHEMA "api" TO "service_role";



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO PUBLIC;
GRANT ALL ON SCHEMA "public" TO "anon";
GRANT ALL ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";

























































































































































REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."get_user_claims_preview"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."switch_organization"("p_new_org_id" "uuid") TO "authenticated";


















GRANT SELECT ON TABLE "public"."users" TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."organizations_projection" TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."permissions_projection" TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."role_permissions_projection" TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."roles_projection" TO "supabase_auth_admin";



GRANT SELECT ON TABLE "public"."user_roles_projection" TO "supabase_auth_admin";


































RESET ALL;

