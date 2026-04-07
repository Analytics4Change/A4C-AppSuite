-- Migration: client_api_functions
-- Creates ~24 API RPCs + 1 validation helper for client management (Phase B3).
-- Permission: client.create, client.view, client.update, client.discharge
-- Pattern: api.create_field_definition (20260327212247)

-- =============================================================================
-- 0. Validation helper: validate_client_required_fields (public schema)
-- Reads org field definitions to enforce per-org required fields.
-- Returns array of missing field keys (empty = valid).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_client_required_fields(
    p_org_id uuid,
    p_client_data jsonb
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_missing text[] := '{}';
    v_field record;
BEGIN
    FOR v_field IN
        SELECT field_key
        FROM client_field_definitions_projection
        WHERE organization_id = p_org_id
          AND is_required = true
          AND is_visible = true
          AND is_active = true
          AND is_locked = false  -- locked fields validated separately (always required)
    LOOP
        IF NOT (p_client_data ? v_field.field_key)
           OR p_client_data->>v_field.field_key IS NULL
           OR p_client_data->>v_field.field_key = '' THEN
            v_missing := array_append(v_missing, v_field.field_key);
        END IF;
    END LOOP;

    RETURN v_missing;
END;
$$;

-- =============================================================================
-- 1. api.register_client — Permission: client.create
-- =============================================================================

CREATE OR REPLACE FUNCTION api.register_client(
    p_client_data jsonb,
    p_reason text DEFAULT 'Client registered',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_client_id uuid;
    v_missing_fields text[];
    v_result record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    v_client_id := COALESCE((p_client_data->>'id')::uuid, gen_random_uuid());

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.create', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.create');
    END IF;

    -- Validate 7 mandatory fields
    IF p_client_data->>'first_name' IS NULL OR p_client_data->>'first_name' = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'first_name is required');
    END IF;
    IF p_client_data->>'last_name' IS NULL OR p_client_data->>'last_name' = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'last_name is required');
    END IF;
    IF p_client_data->>'date_of_birth' IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'date_of_birth is required');
    END IF;
    IF p_client_data->>'gender' IS NULL OR p_client_data->>'gender' = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'gender is required');
    END IF;
    IF p_client_data->>'admission_date' IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'admission_date is required');
    END IF;
    IF NOT (p_client_data ? 'allergies') THEN
        RETURN jsonb_build_object('success', false, 'error', 'allergies is required');
    END IF;
    IF NOT (p_client_data ? 'medical_conditions') THEN
        RETURN jsonb_build_object('success', false, 'error', 'medical_conditions is required');
    END IF;

    -- Validate org-specific required fields
    v_missing_fields := public.validate_client_required_fields(v_org_id, p_client_data);
    IF array_length(v_missing_fields, 1) > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Missing required fields: ' || array_to_string(v_missing_fields, ', ')
        );
    END IF;

    -- Emit event
    PERFORM api.emit_domain_event(
        p_stream_id   := v_client_id,
        p_stream_type := 'client',
        p_event_type  := 'client.registered',
        p_event_data  := p_client_data || jsonb_build_object(
            'organization_id', v_org_id
        ),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- Read-back guard
    SELECT id, first_name, last_name, status INTO v_result
    FROM clients_projection WHERE id = v_client_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = v_client_id AND event_type = 'client.registered'
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown')
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'client', jsonb_build_object(
            'id', v_result.id,
            'first_name', v_result.first_name,
            'last_name', v_result.last_name,
            'status', v_result.status
        )
    );
END;
$$;

-- =============================================================================
-- 2. api.update_client — Permission: client.update
-- =============================================================================

CREATE OR REPLACE FUNCTION api.update_client(
    p_client_id uuid,
    p_changes jsonb,
    p_reason text DEFAULT 'Client information updated',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    -- Verify client exists in this org
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    -- Emit event
    PERFORM api.emit_domain_event(
        p_stream_id   := p_client_id,
        p_stream_type := 'client',
        p_event_type  := 'client.information_updated',
        p_event_data  := jsonb_build_object(
            'organization_id', v_org_id,
            'changes', p_changes
        ),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- 3. api.admit_client — Permission: client.update
-- =============================================================================

CREATE OR REPLACE FUNCTION api.admit_client(
    p_client_id uuid,
    p_admission_data jsonb,
    p_reason text DEFAULT 'Client admitted',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id   := p_client_id,
        p_stream_type := 'client',
        p_event_type  := 'client.admitted',
        p_event_data  := p_admission_data || jsonb_build_object('organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- 4. api.discharge_client — Permission: client.discharge
-- =============================================================================

CREATE OR REPLACE FUNCTION api.discharge_client(
    p_client_id uuid,
    p_discharge_data jsonb,
    p_reason text DEFAULT 'Client discharged',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.discharge', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.discharge');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id AND status = 'active') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found or not active');
    END IF;

    -- Validate 3 mandatory discharge fields (Decision 78)
    IF p_discharge_data->>'discharge_date' IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'discharge_date is required');
    END IF;
    IF p_discharge_data->>'discharge_outcome' IS NULL OR p_discharge_data->>'discharge_outcome' = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'discharge_outcome is required');
    END IF;
    IF p_discharge_data->>'discharge_reason' IS NULL OR p_discharge_data->>'discharge_reason' = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'discharge_reason is required');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id   := p_client_id,
        p_stream_type := 'client',
        p_event_type  := 'client.discharged',
        p_event_data  := p_discharge_data || jsonb_build_object('organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- 5. api.list_clients — Permission: client.view
-- =============================================================================

CREATE OR REPLACE FUNCTION api.list_clients(
    p_status text DEFAULT 'active',
    p_search_term text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_result jsonb;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.view', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.view');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb) INTO v_result
    FROM (
        SELECT
            id, first_name, last_name, middle_name, preferred_name,
            date_of_birth, gender, status, mrn, external_id,
            admission_date, organization_unit_id, placement_arrangement,
            initial_risk_level, created_at
        FROM clients_projection
        WHERE organization_id = v_org_id
          AND (p_status IS NULL OR status = p_status)
          AND (p_search_term IS NULL OR (
            first_name ILIKE '%' || p_search_term || '%'
            OR last_name ILIKE '%' || p_search_term || '%'
            OR mrn ILIKE '%' || p_search_term || '%'
            OR external_id ILIKE '%' || p_search_term || '%'
          ))
        ORDER BY last_name, first_name
    ) c;

    RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

-- =============================================================================
-- 6. api.get_client — Permission: client.view
-- Full record with sub-entity data via lateral joins.
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

    SELECT COALESCE(jsonb_agg(row_to_json(ph)::jsonb ORDER BY ph.start_date DESC), '[]'::jsonb) INTO v_placements
    FROM client_placement_history_projection ph WHERE ph.client_id = p_client_id;

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

-- =============================================================================
-- 7-12. Sub-entity CRUD: Phone
-- =============================================================================

CREATE OR REPLACE FUNCTION api.add_client_phone(
    p_client_id uuid,
    p_phone_number text,
    p_phone_type text DEFAULT 'mobile',
    p_is_primary boolean DEFAULT false,
    p_reason text DEFAULT 'Phone added',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_phone_id uuid := gen_random_uuid();
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id, p_stream_type := 'client',
        p_event_type := 'client.phone.added',
        p_event_data := jsonb_build_object(
            'phone_id', v_phone_id, 'organization_id', v_org_id,
            'phone_number', p_phone_number, 'phone_type', p_phone_type, 'is_primary', p_is_primary
        ),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );
    RETURN jsonb_build_object('success', true, 'phone_id', v_phone_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.update_client_phone(
    p_client_id uuid, p_phone_id uuid,
    p_phone_number text DEFAULT NULL, p_phone_type text DEFAULT NULL, p_is_primary boolean DEFAULT NULL,
    p_reason text DEFAULT 'Phone updated', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.phone.updated',
        p_event_data := jsonb_build_object('phone_id', p_phone_id, 'organization_id', v_org_id)
            || CASE WHEN p_phone_number IS NOT NULL THEN jsonb_build_object('phone_number', p_phone_number) ELSE '{}'::jsonb END
            || CASE WHEN p_phone_type IS NOT NULL THEN jsonb_build_object('phone_type', p_phone_type) ELSE '{}'::jsonb END
            || CASE WHEN p_is_primary IS NOT NULL THEN jsonb_build_object('is_primary', p_is_primary) ELSE '{}'::jsonb END,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'phone_id', p_phone_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.remove_client_phone(
    p_client_id uuid, p_phone_id uuid,
    p_reason text DEFAULT 'Phone removed', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.phone.removed',
        p_event_data := jsonb_build_object('phone_id', p_phone_id, 'organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'phone_id', p_phone_id);
END;
$$;

-- =============================================================================
-- 13-15. Sub-entity CRUD: Email (same pattern as phone)
-- =============================================================================

CREATE OR REPLACE FUNCTION api.add_client_email(
    p_client_id uuid, p_email text, p_email_type text DEFAULT 'personal', p_is_primary boolean DEFAULT false,
    p_reason text DEFAULT 'Email added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_email_id uuid := gen_random_uuid();
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.email.added',
        p_event_data := jsonb_build_object('email_id', v_email_id, 'organization_id', v_org_id, 'email', p_email, 'email_type', p_email_type, 'is_primary', p_is_primary),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'email_id', v_email_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.update_client_email(
    p_client_id uuid, p_email_id uuid, p_email text DEFAULT NULL, p_email_type text DEFAULT NULL, p_is_primary boolean DEFAULT NULL,
    p_reason text DEFAULT 'Email updated', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.email.updated',
        p_event_data := jsonb_build_object('email_id', p_email_id, 'organization_id', v_org_id)
            || CASE WHEN p_email IS NOT NULL THEN jsonb_build_object('email', p_email) ELSE '{}'::jsonb END
            || CASE WHEN p_email_type IS NOT NULL THEN jsonb_build_object('email_type', p_email_type) ELSE '{}'::jsonb END
            || CASE WHEN p_is_primary IS NOT NULL THEN jsonb_build_object('is_primary', p_is_primary) ELSE '{}'::jsonb END,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'email_id', p_email_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.remove_client_email(
    p_client_id uuid, p_email_id uuid,
    p_reason text DEFAULT 'Email removed', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.email.removed',
        p_event_data := jsonb_build_object('email_id', p_email_id, 'organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'email_id', p_email_id);
END;
$$;

-- =============================================================================
-- 16-18. Sub-entity CRUD: Address
-- =============================================================================

CREATE OR REPLACE FUNCTION api.add_client_address(
    p_client_id uuid, p_street1 text, p_city text, p_state text, p_zip text,
    p_address_type text DEFAULT 'home', p_street2 text DEFAULT NULL, p_country text DEFAULT 'US', p_is_primary boolean DEFAULT false,
    p_reason text DEFAULT 'Address added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_address_id uuid := gen_random_uuid();
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.address.added',
        p_event_data := jsonb_build_object('address_id', v_address_id, 'organization_id', v_org_id,
            'address_type', p_address_type, 'street1', p_street1, 'street2', p_street2,
            'city', p_city, 'state', p_state, 'zip', p_zip, 'country', p_country, 'is_primary', p_is_primary),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'address_id', v_address_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.update_client_address(
    p_client_id uuid, p_address_id uuid,
    p_address_type text DEFAULT NULL, p_street1 text DEFAULT NULL, p_street2 text DEFAULT NULL,
    p_city text DEFAULT NULL, p_state text DEFAULT NULL, p_zip text DEFAULT NULL, p_country text DEFAULT NULL, p_is_primary boolean DEFAULT NULL,
    p_reason text DEFAULT 'Address updated', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_data jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;

    v_data := jsonb_build_object('address_id', p_address_id, 'organization_id', v_org_id);
    IF p_address_type IS NOT NULL THEN v_data := v_data || jsonb_build_object('address_type', p_address_type); END IF;
    IF p_street1 IS NOT NULL THEN v_data := v_data || jsonb_build_object('street1', p_street1); END IF;
    IF p_street2 IS NOT NULL THEN v_data := v_data || jsonb_build_object('street2', p_street2); END IF;
    IF p_city IS NOT NULL THEN v_data := v_data || jsonb_build_object('city', p_city); END IF;
    IF p_state IS NOT NULL THEN v_data := v_data || jsonb_build_object('state', p_state); END IF;
    IF p_zip IS NOT NULL THEN v_data := v_data || jsonb_build_object('zip', p_zip); END IF;
    IF p_country IS NOT NULL THEN v_data := v_data || jsonb_build_object('country', p_country); END IF;
    IF p_is_primary IS NOT NULL THEN v_data := v_data || jsonb_build_object('is_primary', p_is_primary); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.address.updated',
        p_event_data := v_data,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'address_id', p_address_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.remove_client_address(
    p_client_id uuid, p_address_id uuid,
    p_reason text DEFAULT 'Address removed', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.address.removed',
        p_event_data := jsonb_build_object('address_id', p_address_id, 'organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'address_id', p_address_id);
END;
$$;

-- =============================================================================
-- 19-21. Sub-entity CRUD: Insurance
-- =============================================================================

CREATE OR REPLACE FUNCTION api.add_client_insurance(
    p_client_id uuid, p_policy_type text, p_payer_name text,
    p_policy_number text DEFAULT NULL, p_group_number text DEFAULT NULL,
    p_subscriber_name text DEFAULT NULL, p_subscriber_relation text DEFAULT NULL,
    p_coverage_start_date date DEFAULT NULL, p_coverage_end_date date DEFAULT NULL,
    p_reason text DEFAULT 'Insurance added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_policy_id uuid := gen_random_uuid();
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.insurance.added',
        p_event_data := jsonb_build_object('policy_id', v_policy_id, 'organization_id', v_org_id,
            'policy_type', p_policy_type, 'payer_name', p_payer_name, 'policy_number', p_policy_number,
            'group_number', p_group_number, 'subscriber_name', p_subscriber_name, 'subscriber_relation', p_subscriber_relation,
            'coverage_start_date', p_coverage_start_date, 'coverage_end_date', p_coverage_end_date),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'policy_id', v_policy_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.update_client_insurance(
    p_client_id uuid, p_policy_id uuid,
    p_payer_name text DEFAULT NULL, p_policy_number text DEFAULT NULL, p_group_number text DEFAULT NULL,
    p_subscriber_name text DEFAULT NULL, p_subscriber_relation text DEFAULT NULL,
    p_coverage_start_date date DEFAULT NULL, p_coverage_end_date date DEFAULT NULL,
    p_reason text DEFAULT 'Insurance updated', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_data jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;

    v_data := jsonb_build_object('policy_id', p_policy_id, 'organization_id', v_org_id);
    IF p_payer_name IS NOT NULL THEN v_data := v_data || jsonb_build_object('payer_name', p_payer_name); END IF;
    IF p_policy_number IS NOT NULL THEN v_data := v_data || jsonb_build_object('policy_number', p_policy_number); END IF;
    IF p_group_number IS NOT NULL THEN v_data := v_data || jsonb_build_object('group_number', p_group_number); END IF;
    IF p_subscriber_name IS NOT NULL THEN v_data := v_data || jsonb_build_object('subscriber_name', p_subscriber_name); END IF;
    IF p_subscriber_relation IS NOT NULL THEN v_data := v_data || jsonb_build_object('subscriber_relation', p_subscriber_relation); END IF;
    IF p_coverage_start_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('coverage_start_date', p_coverage_start_date); END IF;
    IF p_coverage_end_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('coverage_end_date', p_coverage_end_date); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.insurance.updated',
        p_event_data := v_data,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'policy_id', p_policy_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.remove_client_insurance(
    p_client_id uuid, p_policy_id uuid,
    p_reason text DEFAULT 'Insurance removed', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.insurance.removed',
        p_event_data := jsonb_build_object('policy_id', p_policy_id, 'organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'policy_id', p_policy_id);
END;
$$;

-- =============================================================================
-- 22-23. Placement
-- =============================================================================

CREATE OR REPLACE FUNCTION api.change_client_placement(
    p_client_id uuid, p_placement_arrangement text, p_start_date date DEFAULT CURRENT_DATE,
    p_reason_text text DEFAULT NULL,
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
            'placement_arrangement', p_placement_arrangement, 'start_date', p_start_date, 'reason', p_reason_text),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'placement_id', v_placement_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.end_client_placement(
    p_client_id uuid, p_end_date date DEFAULT CURRENT_DATE, p_reason_text text DEFAULT NULL,
    p_reason text DEFAULT 'Placement ended', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.placement.ended',
        p_event_data := jsonb_build_object('organization_id', v_org_id, 'end_date', p_end_date, 'reason', p_reason_text),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- 24-26. Sub-entity CRUD: Funding Source (Decision 76)
-- =============================================================================

CREATE OR REPLACE FUNCTION api.add_client_funding_source(
    p_client_id uuid, p_source_type text, p_source_name text,
    p_reference_number text DEFAULT NULL, p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL,
    p_custom_fields jsonb DEFAULT '{}'::jsonb,
    p_reason text DEFAULT 'Funding source added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_funding_source_id uuid := gen_random_uuid();
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.funding_source.added',
        p_event_data := jsonb_build_object('funding_source_id', v_funding_source_id, 'organization_id', v_org_id,
            'source_type', p_source_type, 'source_name', p_source_name, 'reference_number', p_reference_number,
            'start_date', p_start_date, 'end_date', p_end_date, 'custom_fields', p_custom_fields),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'funding_source_id', v_funding_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.update_client_funding_source(
    p_client_id uuid, p_funding_source_id uuid,
    p_source_type text DEFAULT NULL, p_source_name text DEFAULT NULL, p_reference_number text DEFAULT NULL,
    p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL, p_custom_fields jsonb DEFAULT NULL,
    p_reason text DEFAULT 'Funding source updated', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_data jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;

    v_data := jsonb_build_object('funding_source_id', p_funding_source_id, 'organization_id', v_org_id);
    IF p_source_type IS NOT NULL THEN v_data := v_data || jsonb_build_object('source_type', p_source_type); END IF;
    IF p_source_name IS NOT NULL THEN v_data := v_data || jsonb_build_object('source_name', p_source_name); END IF;
    IF p_reference_number IS NOT NULL THEN v_data := v_data || jsonb_build_object('reference_number', p_reference_number); END IF;
    IF p_start_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('start_date', p_start_date); END IF;
    IF p_end_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('end_date', p_end_date); END IF;
    IF p_custom_fields IS NOT NULL THEN v_data := v_data || jsonb_build_object('custom_fields', p_custom_fields); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.funding_source.updated',
        p_event_data := v_data,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'funding_source_id', p_funding_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.remove_client_funding_source(
    p_client_id uuid, p_funding_source_id uuid,
    p_reason text DEFAULT 'Funding source removed', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.funding_source.removed',
        p_event_data := jsonb_build_object('funding_source_id', p_funding_source_id, 'organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'funding_source_id', p_funding_source_id);
END;
$$;

-- =============================================================================
-- 27. Contact assignment
-- =============================================================================

CREATE OR REPLACE FUNCTION api.assign_client_contact(
    p_client_id uuid, p_contact_id uuid, p_designation text,
    p_reason text DEFAULT 'Contact assigned', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_assignment_id uuid := gen_random_uuid();
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;
    IF NOT EXISTS (SELECT 1 FROM contacts_projection WHERE id = p_contact_id AND organization_id = v_org_id AND deleted_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'error', 'Contact not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.contact.assigned',
        p_event_data := jsonb_build_object('assignment_id', v_assignment_id, 'organization_id', v_org_id,
            'contact_id', p_contact_id, 'designation', p_designation),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'assignment_id', v_assignment_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.unassign_client_contact(
    p_client_id uuid, p_contact_id uuid, p_designation text,
    p_reason text DEFAULT 'Contact unassigned', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.contact.unassigned',
        p_event_data := jsonb_build_object('organization_id', v_org_id, 'contact_id', p_contact_id, 'designation', p_designation),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );
    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- GRANTS — all api functions to authenticated + service_role
-- =============================================================================

GRANT EXECUTE ON FUNCTION api.register_client TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.update_client TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.admit_client TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.discharge_client TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.list_clients TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_client TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.add_client_phone TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.update_client_phone TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.remove_client_phone TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.add_client_email TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.update_client_email TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.remove_client_email TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.add_client_address TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.update_client_address TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.remove_client_address TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.add_client_insurance TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.update_client_insurance TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.remove_client_insurance TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.add_client_funding_source TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.update_client_funding_source TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.remove_client_funding_source TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.change_client_placement TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.end_client_placement TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.assign_client_contact TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.unassign_client_contact TO authenticated, service_role;
