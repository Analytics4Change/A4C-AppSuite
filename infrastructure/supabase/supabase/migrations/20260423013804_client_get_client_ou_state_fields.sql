-- =============================================================================
-- Migration: Enrich api.get_client() placement_history with OU current-state
-- =============================================================================
-- Follow-up to 20260422052825 (client_ou_placement_and_edit_support). Adds
-- `organization_unit_is_active` and `organization_unit_deleted_at` to each
-- placement_history item in the api.get_client() response so the frontend can
-- distinguish active vs deactivated OUs without re-querying the OU directory.
--
-- Rationale (architect-reviewed):
--   * Phase 6 (PlacementCard) requires a three-state render: active name,
--     deactivated name with "(inactive)" suffix, null -> "--" placeholder. The
--     previous response returned only `organization_unit_name`, which made the
--     active/deactivated states indistinguishable.
--   * Keeps audit semantics intact: the history row (projection) is NOT
--     mutated when an OU is deactivated later; current-state annotation is
--     derived at read time via the same LEFT JOIN used for the name.
--   * Forward-compatible with Phase 5a (client edit OU picker), which needs
--     the same signals for the currently-assigned OU.
--
-- Scope:
--   * ONLY api.get_client() is redefined. No event types, no projection
--     changes, no handler changes. Idempotent: single CREATE OR REPLACE.
-- =============================================================================

CREATE OR REPLACE FUNCTION api.get_client(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_client jsonb;
    v_phones jsonb;
    v_emails jsonb;
    v_addresses jsonb;
    v_insurance jsonb;
    v_placements jsonb;
    v_funding jsonb;
    v_assignments jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.view', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.view');
    END IF;

    SELECT row_to_json(c)::jsonb INTO v_client
    FROM clients_projection c
    WHERE c.id = p_client_id AND c.organization_id = v_org_id;

    IF v_client IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) INTO v_phones
    FROM client_phones_projection p WHERE p.client_id = p_client_id AND p.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb) INTO v_emails
    FROM client_emails_projection e WHERE e.client_id = p_client_id AND e.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb) INTO v_addresses
    FROM client_addresses_projection a WHERE a.client_id = p_client_id AND a.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(i)::jsonb), '[]'::jsonb) INTO v_insurance
    FROM client_insurance_policies_projection i WHERE i.client_id = p_client_id AND i.is_active = true;

    -- Placement history: explicit fields + OU name/state from LEFT JOIN.
    -- OU current-state fields (is_active, deleted_at) are derived at read
    -- time; the history row itself is immutable per event-sourcing audit
    -- semantics.
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ph.id,
            'client_id', ph.client_id,
            'organization_id', ph.organization_id,
            'placement_arrangement', ph.placement_arrangement,
            'start_date', ph.start_date,
            'end_date', ph.end_date,
            'is_current', ph.is_current,
            'reason', ph.reason,
            'created_at', ph.created_at,
            'updated_at', ph.updated_at,
            'last_event_id', ph.last_event_id,
            'organization_unit_id', ph.organization_unit_id,
            'organization_unit_name', COALESCE(ou.display_name, ou.name),
            'organization_unit_is_active', ou.is_active,
            'organization_unit_deleted_at', ou.deleted_at
        ) ORDER BY ph.start_date DESC
    ), '[]'::jsonb) INTO v_placements
    FROM client_placement_history_projection ph
    LEFT JOIN organization_units_projection ou ON ou.id = ph.organization_unit_id
    WHERE ph.client_id = p_client_id;

    SELECT COALESCE(jsonb_agg(row_to_json(f)::jsonb), '[]'::jsonb) INTO v_funding
    FROM client_funding_sources_projection f WHERE f.client_id = p_client_id AND f.is_active = true;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ca.id, 'client_id', ca.client_id, 'contact_id', ca.contact_id,
        'organization_id', ca.organization_id, 'designation', ca.designation,
        'is_active', ca.is_active, 'assigned_at', ca.assigned_at,
        'created_at', ca.created_at, 'updated_at', ca.updated_at,
        'last_event_id', ca.last_event_id,
        'contact_name', cp.first_name || ' ' || cp.last_name,
        'contact_email', cp.email
    )), '[]'::jsonb) INTO v_assignments
    FROM client_contact_assignments_projection ca
    JOIN contacts_projection cp ON cp.id = ca.contact_id
    WHERE ca.client_id = p_client_id AND ca.is_active = true;

    RETURN jsonb_build_object('success', true, 'data', v_client || jsonb_build_object(
        'phones', v_phones,
        'emails', v_emails,
        'addresses', v_addresses,
        'insurance_policies', v_insurance,
        'placement_history', v_placements,
        'funding_sources', v_funding,
        'contact_assignments', v_assignments
    ));
END;
$$;

-- =============================================================================
-- Verification (run manually after apply)
-- =============================================================================
-- -- Confirm new keys exist in placement_history items for a client with OU:
-- SELECT jsonb_array_elements(
--     (api.get_client('<client-uuid>') -> 'data' -> 'placement_history')
-- ) ? 'organization_unit_is_active' AS has_is_active;
--
-- -- Confirm null-safety when placement has no OU:
-- -- placement with organization_unit_id IS NULL should have
-- -- organization_unit_is_active = null and organization_unit_deleted_at = null
-- =============================================================================
