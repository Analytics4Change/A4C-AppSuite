/**
 * Organization Idempotency Check Functions
 *
 * Purpose:
 * - Provide RPC functions for Temporal workflow activities to check organization existence
 * - Functions created in 'api' schema (exposed by PostgREST in Supabase)
 * - Enable idempotent organization creation in workflow activities
 *
 * Schema Architecture:
 * - Functions live in 'api' schema (PostgREST exposed schema for RPC calls)
 * - Functions access data in 'public' schema via SECURITY DEFINER + search_path
 * - This is required because PostgREST only exposes the 'api' schema by default
 *
 * Security:
 * - SECURITY DEFINER: Functions run with creator privileges to access organizations_projection
 * - SET search_path = public: Prevents schema injection attacks while accessing public tables
 * - GRANT EXECUTE: Only authenticated and service_role can call these functions
 *
 * Usage (from Temporal workflow activities):
 * ```typescript
 * // Check organization with subdomain
 * const { data, error } = await supabase.rpc('check_organization_by_slug', {
 *   p_slug: 'test-provider-001'
 * });
 *
 * // Check organization without subdomain
 * const { data, error } = await supabase.rpc('check_organization_by_name', {
 *   p_name: 'Test Healthcare Provider'
 * });
 * ```
 *
 * Migration: 001-organization-idempotency-checks.sql
 * Created: 2025-11-21
 * Updated: 2025-11-21 - Moved functions to api schema
 * Phase: 4.1 - Workflow Testing
 */

-- Create api schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS api;

-- Grant usage on api schema (required for PostgREST RPC calls)
GRANT USAGE ON SCHEMA api TO anon, authenticated, service_role;

-- Drop old functions from public schema (cleanup from previous attempt)
DROP FUNCTION IF EXISTS public.check_organization_by_slug(TEXT);
DROP FUNCTION IF EXISTS public.check_organization_by_name(TEXT);

-- Function 1: Check organization by slug (for orgs with subdomains)
CREATE OR REPLACE FUNCTION api.check_organization_by_slug(p_slug TEXT)
RETURNS TABLE (id UUID)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id
  FROM organizations_projection o
  WHERE o.slug = p_slug
  LIMIT 1;
END;
$$;

-- Grant execute permissions on api schema function
GRANT EXECUTE ON FUNCTION api.check_organization_by_slug(TEXT) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION api.check_organization_by_slug(TEXT) IS
'Check if organization exists by slug. Used by Temporal workflow activities for idempotent organization creation. Function in api schema for PostgREST RPC access.';


-- Function 2: Check organization by name (for orgs without subdomains)
CREATE OR REPLACE FUNCTION api.check_organization_by_name(p_name TEXT)
RETURNS TABLE (id UUID)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
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

-- Grant execute permissions on api schema function
GRANT EXECUTE ON FUNCTION api.check_organization_by_name(TEXT) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION api.check_organization_by_name(TEXT) IS
'Check if organization exists by name (for orgs without subdomains). Used by Temporal workflow activities for idempotent organization creation. Function in api schema for PostgREST RPC access.';
