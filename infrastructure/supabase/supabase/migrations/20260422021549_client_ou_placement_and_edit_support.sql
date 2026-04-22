-- =============================================================================
-- Migration: Client OU Placement Tracking & Edit Support
--
-- 1a. Add organization_unit_id to client_placement_history_projection
-- 1b. Update api.change_client_placement() — add OU param
-- 1c. Update handle_client_placement_changed() — store OU in history + denormalize
-- 1d. Update api.get_client() — join placement history to OU for display name
-- =============================================================================

-- =============================================================================
-- 1a. Add organization_unit_id to client_placement_history_projection
-- =============================================================================

ALTER TABLE client_placement_history_projection
  ADD COLUMN IF NOT EXISTS organization_unit_id uuid
  REFERENCES organization_units_projection(id);

CREATE INDEX IF NOT EXISTS idx_client_placement_history_ou
  ON client_placement_history_projection(organization_unit_id)
  WHERE is_current = true;

-- =============================================================================
-- 1b. Update api.change_client_placement() — add p_organization_unit_id param
-- =============================================================================

CREATE OR REPLACE FUNCTION api.change_client_placement(
    p_client_id uuid, p_placement_arrangement text, p_start_date date DEFAULT CURRENT_DATE,
    p_reason_text text DEFAULT NULL,
    p_organization_unit_id uuid DEFAULT NULL,
    p_reason text DEFAULT 'Placement changed', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_placement_id uuid := gen_random_uuid();
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.placement.changed',
        p_event_data := jsonb_build_object('placement_id', v_placement_id, 'organization_id', v_org_id,
            'placement_arrangement', p_placement_arrangement, 'organization_unit_id', p_organization_unit_id, 'start_date', p_start_date, 'reason', p_reason_text),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'placement_id', v_placement_id);
END;
$$;

-- =============================================================================
-- 1c. Update handle_client_placement_changed() — store OU + denormalize
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_placement_changed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_new_placement text;
    v_start_date date;
    v_ou_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_new_placement := p_event.event_data->>'placement_arrangement';
    v_start_date := (p_event.event_data->>'start_date')::date;
    v_ou_id := (p_event.event_data->>'organization_unit_id')::uuid;

    -- Close previous current placement
    UPDATE client_placement_history_projection SET
        is_current = false,
        end_date = v_start_date,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE client_id = v_client_id
      AND organization_id = v_org_id
      AND is_current = true;

    -- Insert new current placement
    INSERT INTO client_placement_history_projection (
        id, client_id, organization_id, placement_arrangement, organization_unit_id, start_date,
        is_current, reason, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'placement_id')::uuid,
        v_client_id,
        v_org_id,
        v_new_placement,
        v_ou_id,
        v_start_date,
        true,
        p_event.event_data->>'reason',
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT ON CONSTRAINT client_placement_history_projection_pkey DO UPDATE SET
        placement_arrangement = EXCLUDED.placement_arrangement,
        organization_unit_id = EXCLUDED.organization_unit_id,
        start_date = EXCLUDED.start_date,
        is_current = true,
        reason = EXCLUDED.reason,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;

    -- Denormalize current placement + OU onto clients_projection
    UPDATE clients_projection SET
        placement_arrangement = v_new_placement,
        organization_unit_id = v_ou_id,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;

-- =============================================================================
-- 1d. Update api.get_client() — LEFT JOIN placement to OU for display name
-- =============================================================================

CREATE OR REPLACE FUNCTION api.get_client(
    p_client_id uuid
)
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

    -- Main client record
    SELECT row_to_json(c)::jsonb INTO v_client
    FROM clients_projection c
    WHERE c.id = p_client_id AND c.organization_id = v_org_id;

    IF v_client IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    -- Sub-entities
    SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) INTO v_phones
    FROM client_phones_projection p WHERE p.client_id = p_client_id AND p.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb) INTO v_emails
    FROM client_emails_projection e WHERE e.client_id = p_client_id AND e.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb) INTO v_addresses
    FROM client_addresses_projection a WHERE a.client_id = p_client_id AND a.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(i)::jsonb), '[]'::jsonb) INTO v_insurance
    FROM client_insurance_policies_projection i WHERE i.client_id = p_client_id AND i.is_active = true;

    -- Placement history with OU name join
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ph.id,
            'client_id', ph.client_id,
            'organization_id', ph.organization_id,
            'organization_unit_id', ph.organization_unit_id,
            'organization_unit_name', ou.display_name,
            'placement_arrangement', ph.placement_arrangement,
            'start_date', ph.start_date,
            'end_date', ph.end_date,
            'is_current', ph.is_current,
            'reason', ph.reason,
            'created_at', ph.created_at,
            'updated_at', ph.updated_at,
            'last_event_id', ph.last_event_id
        ) ORDER BY ph.start_date DESC
    ), '[]'::jsonb) INTO v_placements
    FROM client_placement_history_projection ph
    LEFT JOIN organization_units_projection ou ON ou.id = ph.organization_unit_id
    WHERE ph.client_id = p_client_id;

    SELECT COALESCE(jsonb_agg(row_to_json(f)::jsonb), '[]'::jsonb) INTO v_funding
    FROM client_funding_sources_projection f WHERE f.client_id = p_client_id AND f.is_active = true;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ca.id,
        'contact_id', ca.contact_id,
        'designation', ca.designation,
        'assigned_at', ca.assigned_at,
        'contact_name', cp.first_name || ' ' || cp.last_name,
        'contact_email', cp.email
    )), '[]'::jsonb) INTO v_assignments
    FROM client_contact_assignments_projection ca
    JOIN contacts_projection cp ON cp.id = ca.contact_id
    WHERE ca.client_id = p_client_id AND ca.is_active = true;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_client || jsonb_build_object(
            'phones', v_phones,
            'emails', v_emails,
            'addresses', v_addresses,
            'insurance_policies', v_insurance,
            'placement_history', v_placements,
            'funding_sources', v_funding,
            'contact_assignments', v_assignments
        )
    );
END;
$$;
