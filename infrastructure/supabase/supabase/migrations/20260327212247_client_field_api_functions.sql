-- Migration: client_field_api_functions
-- API functions for client field definitions and categories.
-- 5 field definition RPCs + 3 category RPCs.
-- Permission: organization.update for writes, org-member for reads (Decision 89).

-- =============================================================================
-- 1. api.create_field_definition
-- =============================================================================

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

    -- Validate field_key uniqueness for this org
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

    RETURN jsonb_build_object('success', true, 'field_id', v_field_id);
END;
$$;

-- =============================================================================
-- 2. api.update_field_definition
-- =============================================================================

CREATE OR REPLACE FUNCTION api.update_field_definition(
    p_field_id uuid,
    p_display_name text DEFAULT NULL,
    p_category_id uuid DEFAULT NULL,
    p_field_type text DEFAULT NULL,
    p_is_visible boolean DEFAULT NULL,
    p_is_required boolean DEFAULT NULL,
    p_is_dimension boolean DEFAULT NULL,
    p_sort_order integer DEFAULT NULL,
    p_validation_rules jsonb DEFAULT NULL,
    p_configurable_label text DEFAULT NULL,
    p_conforming_dimension_mapping text DEFAULT NULL,
    p_reason text DEFAULT 'Field definition updated',
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
    v_existing record;
    v_changes jsonb;
BEGIN
    v_org_id := public.get_current_org_id();

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Verify field exists
    SELECT id INTO v_existing
    FROM client_field_definitions_projection
    WHERE id = p_field_id AND organization_id = v_org_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Field definition not found');
    END IF;

    -- Build changes object (only non-null params)
    v_changes := jsonb_build_object('field_id', p_field_id, 'organization_id', v_org_id);

    IF p_display_name IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('display_name', p_display_name);
    END IF;
    IF p_category_id IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('category_id', p_category_id);
    END IF;
    IF p_field_type IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('field_type', p_field_type);
    END IF;
    IF p_is_visible IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('is_visible', p_is_visible);
    END IF;
    IF p_is_required IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('is_required', p_is_required);
    END IF;
    IF p_is_dimension IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('is_dimension', p_is_dimension);
    END IF;
    IF p_sort_order IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('sort_order', p_sort_order);
    END IF;
    IF p_validation_rules IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('validation_rules', p_validation_rules);
    END IF;
    IF p_configurable_label IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('configurable_label', p_configurable_label);
    END IF;
    IF p_conforming_dimension_mapping IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('conforming_dimension_mapping', p_conforming_dimension_mapping);
    END IF;

    -- Emit event
    PERFORM api.emit_domain_event(
        p_stream_id   := p_field_id,
        p_stream_type := 'client_field_definition',
        p_event_type  := 'client_field_definition.updated',
        p_event_data  := v_changes,
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    RETURN jsonb_build_object('success', true, 'field_id', p_field_id);
END;
$$;

-- =============================================================================
-- 3. api.deactivate_field_definition
-- =============================================================================

CREATE OR REPLACE FUNCTION api.deactivate_field_definition(
    p_field_id uuid,
    p_reason text DEFAULT 'Field definition deactivated',
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
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Verify field exists and is active
    IF NOT EXISTS (
        SELECT 1 FROM client_field_definitions_projection
        WHERE id = p_field_id AND organization_id = v_org_id AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Field definition not found or already inactive');
    END IF;

    -- Emit event
    PERFORM api.emit_domain_event(
        p_stream_id   := p_field_id,
        p_stream_type := 'client_field_definition',
        p_event_type  := 'client_field_definition.deactivated',
        p_event_data  := jsonb_build_object(
            'field_id', p_field_id,
            'organization_id', v_org_id
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    RETURN jsonb_build_object('success', true, 'field_id', p_field_id);
END;
$$;

-- =============================================================================
-- 4. api.list_field_definitions
-- =============================================================================
-- Decision 89: Relaxed read RLS — no permission check, org-member only.
-- Decision m4: p_include_inactive param.

CREATE OR REPLACE FUNCTION api.list_field_definitions(
    p_include_inactive boolean DEFAULT false
)
RETURNS TABLE(
    id uuid,
    category_id uuid,
    category_name text,
    category_slug text,
    field_key text,
    display_name text,
    field_type text,
    is_visible boolean,
    is_required boolean,
    validation_rules jsonb,
    is_dimension boolean,
    sort_order integer,
    configurable_label text,
    conforming_dimension_mapping text,
    is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
    v_org_id uuid;
BEGIN
    v_org_id := public.get_current_org_id();

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization context'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT
        fd.id,
        fd.category_id,
        c.name AS category_name,
        c.slug AS category_slug,
        fd.field_key,
        fd.display_name,
        fd.field_type,
        fd.is_visible,
        fd.is_required,
        fd.validation_rules,
        fd.is_dimension,
        fd.sort_order,
        fd.configurable_label,
        fd.conforming_dimension_mapping,
        fd.is_active
    FROM client_field_definitions_projection fd
    JOIN client_field_categories c ON c.id = fd.category_id
    WHERE fd.organization_id = v_org_id
      AND (p_include_inactive = true OR fd.is_active = true)
    ORDER BY c.sort_order, fd.sort_order;
END;
$$;

-- =============================================================================
-- 5. api.batch_update_field_definitions
-- =============================================================================
-- Decision 88/m2: Single network call for saving configuration page.
-- Emits individual client_field_definition.updated events per changed field
-- with shared correlation ID. Follows api.sync_schedule_assignments pattern.

CREATE OR REPLACE FUNCTION api.batch_update_field_definitions(
    p_changes jsonb,
    p_reason text DEFAULT 'Batch field configuration update',
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
    v_change jsonb;
    v_field_id uuid;
    v_event_data jsonb;
    v_updated_count integer := 0;
    v_failed jsonb := '[]'::jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- p_changes is a JSON array: [{"field_id": "...", "is_visible": true, "is_required": false, ...}, ...]
    FOR v_change IN SELECT jsonb_array_elements(p_changes)
    LOOP
        v_field_id := (v_change->>'field_id')::uuid;

        -- Verify field exists and belongs to this org
        IF NOT EXISTS (
            SELECT 1 FROM client_field_definitions_projection
            WHERE id = v_field_id AND organization_id = v_org_id AND is_active = true
        ) THEN
            v_failed := v_failed || jsonb_build_array(jsonb_build_object(
                'field_id', v_field_id, 'error', 'Field not found or inactive'
            ));
            CONTINUE;
        END IF;

        -- Build event_data with org context
        v_event_data := v_change || jsonb_build_object('organization_id', v_org_id);

        -- Emit individual update event
        PERFORM api.emit_domain_event(
            p_stream_id   := v_field_id,
            p_stream_type := 'client_field_definition',
            p_event_type  := 'client_field_definition.updated',
            p_event_data  := v_event_data,
            p_event_metadata := jsonb_build_object(
                'user_id', auth.uid(),
                'organization_id', v_org_id,
                'reason', p_reason,
                'correlation_id', v_correlation_id,
                'batch_operation', true
            )
        );

        v_updated_count := v_updated_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'updated_count', v_updated_count,
        'failed', v_failed,
        'correlation_id', v_correlation_id
    );
END;
$$;

-- =============================================================================
-- 6. api.create_field_category
-- =============================================================================

CREATE OR REPLACE FUNCTION api.create_field_category(
    p_name text,
    p_slug text,
    p_sort_order integer DEFAULT 0,
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
    v_category_id uuid;
BEGIN
    v_org_id := public.get_current_org_id();
    v_category_id := gen_random_uuid();

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Validate slug uniqueness for this org
    IF EXISTS (
        SELECT 1 FROM client_field_categories
        WHERE organization_id = v_org_id AND slug = p_slug AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category slug already exists for this organization');
    END IF;

    -- Emit event
    PERFORM api.emit_domain_event(
        p_stream_id   := v_category_id,
        p_stream_type := 'client_field_category',
        p_event_type  := 'client_field_category.created',
        p_event_data  := jsonb_build_object(
            'category_id', v_category_id,
            'organization_id', v_org_id,
            'name', p_name,
            'slug', p_slug,
            'sort_order', p_sort_order
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    RETURN jsonb_build_object('success', true, 'category_id', v_category_id);
END;
$$;

-- =============================================================================
-- 7. api.deactivate_field_category
-- =============================================================================

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
BEGIN
    v_org_id := public.get_current_org_id();

    -- Permission check
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Verify category exists, belongs to this org, and is org-defined (not system)
    IF NOT EXISTS (
        SELECT 1 FROM client_field_categories
        WHERE id = p_category_id AND organization_id = v_org_id AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category not found, is a system category, or already inactive');
    END IF;

    -- Emit event
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
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    RETURN jsonb_build_object('success', true, 'category_id', p_category_id);
END;
$$;

-- =============================================================================
-- 8. api.list_field_categories
-- =============================================================================

CREATE OR REPLACE FUNCTION api.list_field_categories()
RETURNS TABLE(
    id uuid,
    organization_id uuid,
    name text,
    slug text,
    sort_order integer,
    is_system boolean,
    is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
    v_org_id uuid;
BEGIN
    v_org_id := public.get_current_org_id();

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization context'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT
        c.id,
        c.organization_id,
        c.name,
        c.slug,
        c.sort_order,
        (c.organization_id IS NULL) AS is_system,
        c.is_active
    FROM client_field_categories c
    WHERE (c.organization_id IS NULL OR c.organization_id = v_org_id)
      AND c.is_active = true
    ORDER BY c.sort_order;
END;
$$;

-- =============================================================================
-- 9. GRANTS
-- =============================================================================

-- Field definitions
GRANT EXECUTE ON FUNCTION api.create_field_definition(text, text, uuid, text, boolean, boolean, boolean, integer, jsonb, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_field_definition(uuid, text, uuid, text, boolean, boolean, boolean, integer, jsonb, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.deactivate_field_definition(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.list_field_definitions(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION api.batch_update_field_definitions(jsonb, text, uuid) TO authenticated;

-- Categories
GRANT EXECUTE ON FUNCTION api.create_field_category(text, text, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.deactivate_field_category(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.list_field_categories() TO authenticated;

-- Service role (for bootstrap workflow)
GRANT EXECUTE ON FUNCTION api.create_field_definition(text, text, uuid, text, boolean, boolean, boolean, integer, jsonb, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION api.list_field_definitions(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION api.list_field_categories() TO service_role;
