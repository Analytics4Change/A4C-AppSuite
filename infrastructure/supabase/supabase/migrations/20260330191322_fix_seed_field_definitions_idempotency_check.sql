-- Migration: fix_seed_field_definitions_idempotency_check
--
-- Bug fix: seedFieldDefinitions called api.list_field_definitions(p_org_id, p_include_inactive)
-- but the function signature is list_field_definitions(p_include_inactive) — no p_org_id param.
-- It uses get_current_org_id() from JWT, which is NULL for service_role.
--
-- Fix: Add api.check_field_definitions_exist(p_org_id) for service_role idempotency check.

CREATE OR REPLACE FUNCTION api.check_field_definitions_exist(
    p_org_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Returns true if any field definitions exist for the given org.
-- Called by seedFieldDefinitions Temporal activity for Layer 2 idempotency.
-- Uses explicit org_id param since service_role has no JWT org context.
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.client_field_definitions_projection
        WHERE organization_id = p_org_id
        LIMIT 1
    );
END;
$$;

GRANT EXECUTE ON FUNCTION api.check_field_definitions_exist(uuid) TO service_role;
