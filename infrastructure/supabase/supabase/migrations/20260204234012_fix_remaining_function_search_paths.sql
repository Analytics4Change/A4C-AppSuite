-- =============================================================================
-- Migration: Fix Remaining Function Search Paths
-- Purpose: Add SET search_path to SQL language functions that were missed
-- Reference: Supabase advisor - "Function Search Path Mutable" warning
-- =============================================================================

-- =============================================================================
-- API SCHEMA FUNCTIONS (SECURITY DEFINER - HIGH PRIORITY)
-- =============================================================================

-- api.get_role_by_name
CREATE OR REPLACE FUNCTION api.get_role_by_name(p_org_id uuid, p_role_name text)
RETURNS TABLE(id uuid, name text, organization_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT r.id, r.name, r.organization_id
  FROM public.roles_projection r
  WHERE r.name = p_role_name
    AND (r.organization_id = p_org_id OR r.organization_id IS NULL)
  ORDER BY r.organization_id DESC NULLS LAST  -- Prefer org-specific over system role
  LIMIT 1;
$function$;

-- api.get_trace_timeline
CREATE OR REPLACE FUNCTION api.get_trace_timeline(p_trace_id text)
RETURNS TABLE(
  id uuid,
  event_type text,
  stream_id uuid,
  stream_type text,
  span_id text,
  parent_span_id text,
  service_name text,
  operation_name text,
  duration_ms integer,
  status text,
  created_at timestamp with time zone,
  depth integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
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
$function$;

-- =============================================================================
-- PUBLIC SCHEMA FUNCTIONS
-- =============================================================================

-- public.has_permission (RLS helper function)
CREATE OR REPLACE FUNCTION public.has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb)->'effective_permissions',
        '[]'::jsonb
      )
    ) ep
    WHERE ep->>'p' = p_permission
  );
$function$;

-- public.check_permissions_subset
CREATE OR REPLACE FUNCTION public.check_permissions_subset(p_required uuid[], p_available uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $function$
  -- All required permissions must be in available set
  -- Empty required array always passes
  SELECT p_required <@ p_available;
$function$;

-- public.is_user_assigned_to_client
CREATE OR REPLACE FUNCTION public.is_user_assigned_to_client(p_user_id uuid, p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_client_assignments_projection
    WHERE user_id = p_user_id
      AND client_id = p_client_id
      AND is_active = true
      AND (assigned_until IS NULL OR assigned_until > now())
  );
$function$;

-- public.get_clients_assigned_to_user
CREATE OR REPLACE FUNCTION public.get_clients_assigned_to_user(p_user_id uuid, p_org_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(client_id uuid, assigned_at timestamp with time zone, notes text)
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT client_id, assigned_at, notes
  FROM user_client_assignments_projection
  WHERE user_id = p_user_id
    AND (p_org_id IS NULL OR organization_id = p_org_id)
    AND is_active = true
    AND (assigned_until IS NULL OR assigned_until > now())
  ORDER BY assigned_at;
$function$;

-- public.get_staff_assigned_to_client
CREATE OR REPLACE FUNCTION public.get_staff_assigned_to_client(p_client_id uuid, p_org_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(user_id uuid, assigned_at timestamp with time zone, notes text)
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT user_id, assigned_at, notes
  FROM user_client_assignments_projection
  WHERE client_id = p_client_id
    AND (p_org_id IS NULL OR organization_id = p_org_id)
    AND is_active = true
    AND (assigned_until IS NULL OR assigned_until > now())
  ORDER BY assigned_at;
$function$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
