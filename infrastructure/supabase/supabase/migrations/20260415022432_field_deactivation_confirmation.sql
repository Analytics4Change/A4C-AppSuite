-- =============================================================================
-- 1. api.get_field_usage_count(p_field_key) — count clients with data for a field
-- =============================================================================

CREATE OR REPLACE FUNCTION api.get_field_usage_count(p_field_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_count integer;
BEGIN
    v_org_id := public.get_current_org_id();

    -- Permission check (same as other field config RPCs)
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM clients_projection
    WHERE organization_id = v_org_id
      AND custom_fields->>p_field_key IS NOT NULL
      AND custom_fields->>p_field_key != '';

    RETURN jsonb_build_object('success', true, 'count', v_count, 'field_key', p_field_key);
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_field_usage_count(text) TO authenticated;

-- =============================================================================
-- 2. api.get_category_field_count(p_category_id) — count active fields + names
-- =============================================================================

CREATE OR REPLACE FUNCTION api.get_category_field_count(p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_count integer;
    v_fields jsonb;
BEGIN
    v_org_id := public.get_current_org_id();

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    SELECT COUNT(*), COALESCE(jsonb_agg(display_name ORDER BY display_name), '[]'::jsonb)
    INTO v_count, v_fields
    FROM client_field_definitions_projection
    WHERE category_id = p_category_id
      AND organization_id = v_org_id
      AND is_active = true;

    RETURN jsonb_build_object('success', true, 'count', v_count, 'fields', v_fields);
END;
$$;

GRANT EXECUTE ON FUNCTION api.get_category_field_count(uuid) TO authenticated;

-- =============================================================================
-- 3. Update api.deactivate_field_category() — cascade via individual events (M1)
-- =============================================================================
-- Emits client_field_definition.deactivated for each active field in the category
-- before emitting client_field_category.deactivated. All events share the same
-- correlation_id for audit trail traceability.

CREATE OR REPLACE FUNCTION api.deactivate_field_category(
    p_category_id uuid,
    p_reason text DEFAULT 'Category deactivated',
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
    v_correlation_id uuid;
    v_category_name text;
    v_field record;
    v_result record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Verify category exists, belongs to this org, and is org-defined (not system)
    SELECT name INTO v_category_name
    FROM client_field_categories
    WHERE id = p_category_id AND organization_id = v_org_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category not found, is a system category, or already inactive');
    END IF;

    -- Cascade: emit deactivation events for each active field in this category
    FOR v_field IN
        SELECT id, field_key FROM client_field_definitions_projection
        WHERE category_id = p_category_id AND organization_id = v_org_id AND is_active = true
    LOOP
        PERFORM api.emit_domain_event(
            p_stream_id   := v_field.id,
            p_stream_type := 'client_field_definition',
            p_event_type  := 'client_field_definition.deactivated',
            p_event_data  := jsonb_build_object(
                'field_id', v_field.id,
                'organization_id', v_org_id,
                'reason', 'Category deactivated: ' || v_category_name
            ),
            p_event_metadata := jsonb_build_object(
                'user_id', auth.uid(),
                'organization_id', v_org_id,
                'correlation_id', v_correlation_id
            )
        );
    END LOOP;

    -- Emit category deactivation event
    PERFORM api.emit_domain_event(
        p_stream_id   := p_category_id,
        p_stream_type := 'client_field_category',
        p_event_type  := 'client_field_category.deactivated',
        p_event_data  := jsonb_build_object(
            'category_id', p_category_id,
            'organization_id', v_org_id
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', v_correlation_id
        )
    );

    -- Read-back guard
    SELECT id INTO v_result
    FROM client_field_categories
    WHERE id = p_category_id AND is_active = false;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_category_id
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'category_id', p_category_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'category_id', p_category_id);
END;
$$;
