-- Fix: Read-back guard in api.create_field_definition() fails after
-- re-creating a previously deactivated field.
--
-- Root cause: The handler uses ON CONFLICT (organization_id, field_key)
-- which updates the EXISTING row (retaining its original id). The read-back
-- guard looked for the NEW v_field_id, which never appears in the projection.
--
-- Fix: Query by field_key + organization_id instead of id.

CREATE OR REPLACE FUNCTION api.create_field_definition(
    p_field_key text,
    p_display_name text,
    p_category_id uuid,
    p_field_type text DEFAULT 'text',
    p_is_visible boolean DEFAULT true,
    p_is_required boolean DEFAULT false,
    p_is_dimension boolean DEFAULT false,
    p_sort_order integer DEFAULT 0,
    p_validation_rules jsonb DEFAULT NULL,
    p_configurable_label text DEFAULT NULL,
    p_conforming_dimension_mapping text DEFAULT NULL,
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
    v_field_id uuid;
    v_result record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    v_field_id := gen_random_uuid();

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Validate category exists and is accessible
    IF NOT EXISTS (
        SELECT 1 FROM client_field_categories
        WHERE id = p_category_id
          AND (organization_id IS NULL OR organization_id = v_org_id)
          AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category not found or inactive');
    END IF;

    -- Validate field_key uniqueness for this org (only active fields)
    IF EXISTS (
        SELECT 1 FROM client_field_definitions_projection
        WHERE organization_id = v_org_id AND field_key = p_field_key AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Field key already exists for this organization');
    END IF;

    -- Emit event
    PERFORM api.emit_domain_event(
        p_stream_id   := v_field_id,
        p_stream_type := 'client_field_definition',
        p_event_type  := 'client_field_definition.created',
        p_event_data  := jsonb_build_object(
            'field_id', v_field_id,
            'organization_id', v_org_id,
            'category_id', p_category_id,
            'field_key', p_field_key,
            'display_name', p_display_name,
            'field_type', p_field_type,
            'is_visible', p_is_visible,
            'is_required', p_is_required,
            'is_dimension', p_is_dimension,
            'sort_order', p_sort_order,
            'validation_rules', p_validation_rules,
            'configurable_label', p_configurable_label,
            'conforming_dimension_mapping', p_conforming_dimension_mapping
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- M2: Read-back guard — query by field_key (not id) because ON CONFLICT
    -- may have updated an existing row with a different id
    SELECT id INTO v_result
    FROM client_field_definitions_projection
    WHERE organization_id = v_org_id AND field_key = p_field_key AND is_active = true;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = v_field_id
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'field_id', v_field_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'field_id', v_result.id);
END;
$$;
