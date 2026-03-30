-- Migration: fix_seed_field_definitions_schema_access
--
-- Bug fix: seedFieldDefinitions Temporal activity used direct .from() PostgREST
-- queries against public schema tables, but this Supabase project only exposes
-- the 'api' schema. All 3 read queries and the event INSERT failed with:
-- "The schema must be one of the following: api"
--
-- Fix: Create 2 read-only RPCs in api schema for template/category lookups.
-- The activity will also switch from .from('domain_events').insert() to
-- emitEvent() which already uses api.emit_domain_event().
--
-- Also adds api.deactivate_all_field_definitions() for compensation function.

-- =============================================================================
-- 1. api.list_field_definition_templates() — read templates for bootstrap seeding
-- =============================================================================

CREATE OR REPLACE FUNCTION api.list_field_definition_templates()
RETURNS TABLE (
    field_key text,
    category_slug text,
    display_name text,
    field_type text,
    is_visible boolean,
    is_required boolean,
    is_dimension boolean,
    sort_order integer,
    configurable_label text,
    conforming_dimension_mapping text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Read-only: returns all active field definition templates.
-- Called by seedFieldDefinitions Temporal activity during org bootstrap.
-- No org-scoping — templates are global (platform-managed).
-- No permission check — only called by service_role (Temporal worker).
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT
        t.field_key,
        t.category_slug,
        t.display_name,
        t.field_type,
        t.is_visible,
        t.is_required,
        t.is_dimension,
        t.sort_order,
        t.configurable_label,
        t.conforming_dimension_mapping
    FROM public.client_field_definition_templates t
    WHERE t.is_active = true
    ORDER BY t.category_slug, t.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION api.list_field_definition_templates() TO service_role;

-- =============================================================================
-- 2. api.list_system_field_categories() — read system categories for slug->id mapping
-- =============================================================================

CREATE OR REPLACE FUNCTION api.list_system_field_categories()
RETURNS TABLE (
    id uuid,
    slug text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Read-only: returns system field categories (organization_id IS NULL).
-- Called by seedFieldDefinitions Temporal activity to resolve category slugs to IDs.
-- No permission check — only called by service_role (Temporal worker).
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT c.id, c.slug
    FROM public.client_field_categories c
    WHERE c.organization_id IS NULL
      AND c.is_active = true
    ORDER BY c.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION api.list_system_field_categories() TO service_role;

-- =============================================================================
-- 3. api.deactivate_all_field_definitions(p_org_id) — compensation function
-- =============================================================================

CREATE OR REPLACE FUNCTION api.deactivate_all_field_definitions(
    p_org_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Compensation: deactivates all field definitions for an org.
-- Called by deleteFieldDefinitions Temporal compensation activity during Saga rollback.
-- Returns the number of deactivated rows.
DECLARE
    v_count integer;
BEGIN
    UPDATE public.client_field_definitions_projection
    SET is_active = false,
        updated_at = now()
    WHERE organization_id = p_org_id
      AND is_active = true;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION api.deactivate_all_field_definitions(uuid) TO service_role;

-- =============================================================================
-- 4. api.safety_net_deactivate_organization(p_org_id) — compensation safety net
-- =============================================================================
-- deactivate-organization.ts used direct .from('organizations_projection') which
-- fails against api-only PostgREST. This RPC provides the same safety-net direct
-- write through the api schema.

CREATE OR REPLACE FUNCTION api.safety_net_deactivate_organization(
    p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Safety-net compensation: directly deactivates an organization when the
-- event-driven path (emitBootstrapFailed -> handler) has already failed.
-- Intentional CQRS exception for last-resort rollback.
-- Returns JSON with org status or null if not found.
DECLARE
    v_org record;
    v_now timestamptz := now();
BEGIN
    -- Check current status (idempotency)
    SELECT id, is_active, deleted_at INTO v_org
    FROM public.organizations_projection
    WHERE id = p_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    IF NOT v_org.is_active AND v_org.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('found', true, 'already_deactivated', true);
    END IF;

    UPDATE public.organizations_projection
    SET is_active = false,
        deactivated_at = v_now,
        deleted_at = v_now,
        updated_at = v_now
    WHERE id = p_org_id;

    RETURN jsonb_build_object('found', true, 'deactivated', true, 'deactivated_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION api.safety_net_deactivate_organization(uuid) TO service_role;
