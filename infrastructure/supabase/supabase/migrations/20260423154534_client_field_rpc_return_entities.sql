-- =============================================================================
-- Migration: client_field_rpc_return_entities
-- =============================================================================
-- Purpose: Phase 4a Blocker 2 — extend api.update_field_definition and
--          api.update_field_category to return the full refreshed entity in
--          their Pattern A v2 success envelope. Enables frontend ViewModels
--          to patch their lists in place after an update, eliminating the
--          post-update `loadData()` round-trip (full field+category refresh)
--          that was the "workaround" cost of Pattern A v1.
--
-- Current return shape (v2 read-back guard present but entity-less):
--   {success: true, field_id: p_field_id}
--   {success: true, category_id: p_category_id}
--
-- New return shape (adds the refreshed entity):
--   {success: true, field_id, field:    <FieldDefinition-shaped jsonb>}
--   {success: true, category_id, category: <FieldCategory-shaped jsonb>}
--
-- The entity JSON uses the same column set + computed fields as
-- api.list_field_definitions / api.list_field_categories, so frontend
-- consumers can drop the returned row directly into the observable list.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- No contract break — existing callers reading only {success, field_id}
-- continue to work; the new `field` / `category` key is additive.
-- =============================================================================


-- Field Definition ------------------------------------------------------------
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
    v_field jsonb;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    SELECT id INTO v_existing
    FROM client_field_definitions_projection
    WHERE id = p_field_id AND organization_id = v_org_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Field definition not found');
    END IF;

    v_changes := jsonb_build_object('field_id', p_field_id, 'organization_id', v_org_id);

    IF p_display_name IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('display_name', p_display_name); END IF;
    IF p_category_id IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('category_id', p_category_id); END IF;
    IF p_field_type IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('field_type', p_field_type); END IF;
    IF p_is_visible IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('is_visible', p_is_visible); END IF;
    IF p_is_required IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('is_required', p_is_required); END IF;
    IF p_is_dimension IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('is_dimension', p_is_dimension); END IF;
    IF p_sort_order IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('sort_order', p_sort_order); END IF;
    IF p_validation_rules IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('validation_rules', p_validation_rules); END IF;
    IF p_configurable_label IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('configurable_label', p_configurable_label); END IF;
    IF p_conforming_dimension_mapping IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('conforming_dimension_mapping', p_conforming_dimension_mapping); END IF;

    v_event_id := api.emit_domain_event(
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

    -- Pattern A v2 read-back: compose the list_field_definitions row shape
    -- (joins category for name/slug; includes all fields the frontend
    -- FieldDefinition type expects).
    SELECT jsonb_build_object(
        'id', fd.id,
        'category_id', fd.category_id,
        'category_name', c.name,
        'category_slug', c.slug,
        'field_key', fd.field_key,
        'display_name', fd.display_name,
        'field_type', fd.field_type,
        'is_visible', fd.is_visible,
        'is_required', fd.is_required,
        'validation_rules', fd.validation_rules,
        'is_dimension', fd.is_dimension,
        'sort_order', fd.sort_order,
        'configurable_label', fd.configurable_label,
        'conforming_dimension_mapping', fd.conforming_dimension_mapping,
        'is_active', fd.is_active
    )
    INTO v_field
    FROM client_field_definitions_projection fd
    JOIN client_field_categories c ON c.id = fd.category_id
    WHERE fd.id = p_field_id AND fd.organization_id = v_org_id AND fd.is_active = true;

    IF v_field IS NULL THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'field_id', p_field_id
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'field_id', p_field_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'field_id', p_field_id,
        'field', v_field
    );
END;
$$;


-- Field Category --------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_field_category(
    p_category_id uuid,
    p_name text DEFAULT NULL,
    p_sort_order integer DEFAULT NULL,
    p_reason text DEFAULT 'Category updated',
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
    v_changes jsonb;
    v_category jsonb;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM client_field_categories
        WHERE id = p_category_id AND organization_id = v_org_id AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category not found, is a system category, or already inactive');
    END IF;

    v_changes := jsonb_build_object('category_id', p_category_id, 'organization_id', v_org_id);
    IF p_name IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('name', p_name); END IF;
    IF p_sort_order IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('sort_order', p_sort_order); END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id   := p_category_id,
        p_stream_type := 'client_field_category',
        p_event_type  := 'client_field_category.updated',
        p_event_data  := v_changes,
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- Pattern A v2 read-back: compose the list_field_categories row shape
    -- with the `is_system` computed column (organization_id IS NULL).
    SELECT jsonb_build_object(
        'id', c.id,
        'organization_id', c.organization_id,
        'name', c.name,
        'slug', c.slug,
        'sort_order', c.sort_order,
        'is_system', (c.organization_id IS NULL),
        'is_active', c.is_active
    )
    INTO v_category
    FROM client_field_categories c
    WHERE c.id = p_category_id AND c.organization_id = v_org_id AND c.is_active = true;

    IF v_category IS NULL THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'category_id', p_category_id
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'category_id', p_category_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'category_id', p_category_id,
        'category', v_category
    );
END;
$$;


-- =============================================================================
-- VERIFICATION (run via psql / MCP execute_sql after apply):
--
-- -- Shape check: update_field_definition returns 'field' key
-- SELECT pg_get_functiondef(oid)::text LIKE '%''field'', v_field%'
-- FROM pg_proc WHERE proname='update_field_definition' AND pronamespace='api'::regnamespace;
-- -- Expect: t.
--
-- -- Shape check: update_field_category returns 'category' key
-- SELECT pg_get_functiondef(oid)::text LIKE '%''category'', v_category%'
-- FROM pg_proc WHERE proname='update_field_category' AND pronamespace='api'::regnamespace;
-- -- Expect: t.
-- =============================================================================
