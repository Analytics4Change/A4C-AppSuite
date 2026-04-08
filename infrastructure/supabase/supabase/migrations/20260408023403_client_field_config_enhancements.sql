-- Migration: client_field_config_enhancements
-- Consolidated migration for client field configuration UI enhancements.
--
-- Contents:
--   1. M2 — Read-back guards for existing RPCs (create/update field def, create/deactivate category)
--   2. M4 — Server-side sort_order auto-assignment in api.create_field_category()
--   3. Item 7 — Category update: new RPC + handler + router CASE + event_types seed
--   4. Item 1 — 9 new contact designation field templates

-- =============================================================================
-- 1. M2 + M4: Recreate api.create_field_definition with read-back guard
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

    -- M2: Read-back guard
    SELECT id INTO v_result
    FROM client_field_definitions_projection
    WHERE id = v_field_id AND organization_id = v_org_id;

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

    RETURN jsonb_build_object('success', true, 'field_id', v_field_id);
END;
$$;

-- =============================================================================
-- 2. M2: Recreate api.update_field_definition with read-back guard
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
    v_result record;
    v_processing_error text;
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

    -- M2: Read-back guard — verify handler updated the projection
    SELECT id INTO v_result
    FROM client_field_definitions_projection
    WHERE id = p_field_id AND organization_id = v_org_id AND is_active = true;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_field_id
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'field_id', p_field_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'field_id', p_field_id);
END;
$$;

-- =============================================================================
-- 3. M2 + M4: Recreate api.create_field_category with read-back guard + auto sort_order
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
    v_result record;
    v_processing_error text;
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

    -- M4: Auto-assign sort_order if not explicitly provided (or 0)
    IF p_sort_order IS NULL OR p_sort_order = 0 THEN
        SELECT COALESCE(MAX(sort_order), 0) + 1 INTO p_sort_order
        FROM client_field_categories
        WHERE (organization_id IS NULL OR organization_id = v_org_id)
          AND is_active = true;
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

    -- M2: Read-back guard
    SELECT id INTO v_result
    FROM client_field_categories
    WHERE id = v_category_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = v_category_id
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'category_id', v_category_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'category_id', v_category_id);
END;
$$;

-- =============================================================================
-- 4. M2: Recreate api.deactivate_field_category with read-back guard
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
    v_result record;
    v_processing_error text;
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

    -- M2: Read-back guard — verify deactivation
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

-- =============================================================================
-- 5. Item 7: api.update_field_category — new RPC (m5: name only, slug immutable)
-- =============================================================================

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
    v_result record;
    v_processing_error text;
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

    -- Build changes (only non-null params, slug intentionally excluded)
    v_changes := jsonb_build_object('category_id', p_category_id, 'organization_id', v_org_id);
    IF p_name IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('name', p_name);
    END IF;
    IF p_sort_order IS NOT NULL THEN
        v_changes := v_changes || jsonb_build_object('sort_order', p_sort_order);
    END IF;

    -- Emit event
    PERFORM api.emit_domain_event(
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

    -- Read-back guard
    SELECT id INTO v_result
    FROM client_field_categories
    WHERE id = p_category_id AND organization_id = v_org_id AND is_active = true;

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

GRANT EXECUTE ON FUNCTION api.update_field_category(uuid, text, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_field_category(uuid, text, integer, text, uuid) TO service_role;

-- =============================================================================
-- 6. Item 7: handle_client_field_category_updated handler
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_field_category_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    UPDATE client_field_categories SET
        name       = COALESCE(p_event.event_data->>'name', name),
        sort_order = COALESCE((p_event.event_data->>'sort_order')::integer, sort_order),
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'category_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

-- =============================================================================
-- 7. Item 7: Add updated CASE to router
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_client_field_category_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    CASE p_event.event_type

        WHEN 'client_field_category.created' THEN
            PERFORM handle_client_field_category_created(p_event);

        WHEN 'client_field_category.updated' THEN
            PERFORM handle_client_field_category_updated(p_event);

        WHEN 'client_field_category.deactivated' THEN
            PERFORM handle_client_field_category_deactivated(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_field_category_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$$;

-- =============================================================================
-- 8. Item 7: Seed event type
-- =============================================================================

INSERT INTO event_types (event_type, stream_type, description, event_schema)
VALUES (
    'client_field_category.updated',
    'client_field_category',
    'A custom field category was updated (name or sort_order changed)',
    '{"type":"object","required":["category_id","organization_id"],"properties":{"category_id":{"type":"string","format":"uuid"},"organization_id":{"type":"string","format":"uuid"},"name":{"type":"string"},"sort_order":{"type":"integer"}}}'::jsonb
)
ON CONFLICT (event_type) DO NOTHING;

-- =============================================================================
-- 9. Item 1: 9 new contact designation field templates
-- =============================================================================

INSERT INTO client_field_definition_templates
    (field_key, category_slug, display_name, field_type, is_visible, is_required, is_locked, is_dimension, sort_order, validation_rules)
VALUES
    -- Clinical Profile (sort_order 11-17, after existing 10 clinical fields)
    ('assigned_clinician',      'clinical', 'Assigned Clinician',      'text', true, false, false, false, 11, '{"widget":"contact_assignment","designation":"clinician"}'::jsonb),
    ('therapist',               'clinical', 'Therapist',               'text', true, false, false, false, 12, '{"widget":"contact_assignment","designation":"therapist"}'::jsonb),
    ('psychiatrist',            'clinical', 'Psychiatrist',            'text', true, false, false, false, 13, '{"widget":"contact_assignment","designation":"psychiatrist"}'::jsonb),
    ('behavioral_analyst',      'clinical', 'Behavioral Analyst',      'text', true, false, false, false, 14, '{"widget":"contact_assignment","designation":"behavioral_analyst"}'::jsonb),
    ('primary_care_physician',  'clinical', 'Primary Care Physician',  'text', true, false, false, false, 15, '{"widget":"contact_assignment","designation":"primary_care_physician"}'::jsonb),
    ('prescriber',              'clinical', 'Prescriber',              'text', true, false, false, false, 16, '{"widget":"contact_assignment","designation":"prescriber"}'::jsonb),
    ('program_manager',         'clinical', 'Program Manager',         'text', true, false, false, false, 17, '{"widget":"contact_assignment","designation":"program_manager"}'::jsonb),
    -- Legal & Compliance (sort_order 7-8, after existing 6 legal fields)
    ('probation_officer',       'legal',    'Probation Officer',       'text', true, false, false, false, 7,  '{"widget":"contact_assignment","designation":"probation_officer"}'::jsonb),
    ('caseworker',              'legal',    'Caseworker',              'text', true, false, false, false, 8,  '{"widget":"contact_assignment","designation":"caseworker"}'::jsonb)
ON CONFLICT (field_key) DO NOTHING;
