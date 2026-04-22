-- Migration: field_category_reactivate_delete
--
-- Brings custom field definitions and custom field categories to lifecycle
-- parity with Roles / Organization Units / Users / Schedules. Adds reactivate
-- and hard-delete paths; updates inactive-aware list + count helpers.
--
-- Lifecycle contract (final):
--   Deactivate (existing) -> is_active = false, row preserved, UI shows "Inactive".
--   Reactivate (new)      -> is_active = true (field: not locked; category: not system).
--   Hard Delete (new)     -> physical DELETE of projection row.
--     Field precondition  : is_active = false AND get_field_usage_count = 0.
--     Category precondition: is_active = false AND no rows in
--                            client_field_definitions_projection for that
--                            category_id (active OR inactive). Hard-deleted
--                            child fields are physically gone, so they do not
--                            block the category delete.
--
-- Cascade semantics (unchanged from prior deactivation migration):
--   Category deactivation cascades to child fields via individual events.
--   Reactivation does NOT cascade: user reactivates each field individually.

-- =============================================================================
-- 1. api.reactivate_field_definition
-- =============================================================================

CREATE OR REPLACE FUNCTION api.reactivate_field_definition(
    p_field_id uuid,
    p_reason text DEFAULT 'Field definition reactivated',
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

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Precondition: row exists, belongs to this org, and is currently inactive
    IF NOT EXISTS (
        SELECT 1 FROM client_field_definitions_projection
        WHERE id = p_field_id AND organization_id = v_org_id AND is_active = false
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Field definition not found or already active');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id   := p_field_id,
        p_stream_type := 'client_field_definition',
        p_event_type  := 'client_field_definition.reactivated',
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

    -- Read-back guard
    SELECT id INTO v_result
    FROM client_field_definitions_projection
    WHERE id = p_field_id AND is_active = true;

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
-- 2. api.delete_field_definition
-- =============================================================================
-- Preconditions: is_active = false AND zero client usage (custom_fields JSONB).
-- Emits client_field_definition.deleted; handler physically removes the row.

CREATE OR REPLACE FUNCTION api.delete_field_definition(
    p_field_id uuid,
    p_reason text DEFAULT 'Field definition deleted',
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
    v_field record;
    v_usage_count integer;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Preconditions 1 & 2: field exists, belongs to this org, and is inactive
    SELECT id, field_key, display_name, is_active INTO v_field
    FROM client_field_definitions_projection
    WHERE id = p_field_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Field definition not found');
    END IF;

    IF v_field.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Field must be deactivated before it can be deleted'
        );
    END IF;

    -- Precondition 3: no client rows reference this field_key in custom_fields
    SELECT COUNT(*) INTO v_usage_count
    FROM clients_projection
    WHERE organization_id = v_org_id
      AND custom_fields->>v_field.field_key IS NOT NULL
      AND custom_fields->>v_field.field_key != '';

    IF v_usage_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format(
                'Cannot delete -- %s client(s) have data for "%s". Leave it deactivated instead.',
                v_usage_count, v_field.display_name
            ),
            'field_id', p_field_id,
            'usage_count', v_usage_count
        );
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id   := p_field_id,
        p_stream_type := 'client_field_definition',
        p_event_type  := 'client_field_definition.deleted',
        p_event_data  := jsonb_build_object(
            'field_id', p_field_id,
            'organization_id', v_org_id,
            'field_key', v_field.field_key
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- Read-back guard: row should be gone
    IF EXISTS (
        SELECT 1 FROM client_field_definitions_projection WHERE id = p_field_id
    ) THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_field_id
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed -- row still present'),
            'field_id', p_field_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'field_id', p_field_id);
END;
$$;

-- =============================================================================
-- 3. api.reactivate_field_category
-- =============================================================================
-- System categories (organization_id IS NULL) cannot be reactivated because
-- they are not event-sourced and cannot be deactivated in the first place.

CREATE OR REPLACE FUNCTION api.reactivate_field_category(
    p_category_id uuid,
    p_reason text DEFAULT 'Category reactivated',
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

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Precondition: org-defined (not system), belongs to this org, currently inactive
    IF NOT EXISTS (
        SELECT 1 FROM client_field_categories
        WHERE id = p_category_id AND organization_id = v_org_id AND is_active = false
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Category not found, is a system category, or already active'
        );
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id   := p_category_id,
        p_stream_type := 'client_field_category',
        p_event_type  := 'client_field_category.reactivated',
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

    SELECT id INTO v_result
    FROM client_field_categories
    WHERE id = p_category_id AND is_active = true;

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
-- 4. api.delete_field_category
-- =============================================================================
-- Preconditions: is_active = false AND no rows in
-- client_field_definitions_projection for that category_id (active OR inactive).
-- Hard-deleted fields are physically gone, so they do not block this check.

CREATE OR REPLACE FUNCTION api.delete_field_category(
    p_category_id uuid,
    p_reason text DEFAULT 'Category deleted',
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
    v_category record;
    v_child_count integer;
    v_child_names jsonb;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    -- Preconditions 1 & 2: exists, org-defined (not system), owned by this org, and inactive
    SELECT id, name, is_active INTO v_category
    FROM client_field_categories
    WHERE id = p_category_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category not found or is a system category');
    END IF;

    IF v_category.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Category must be deactivated before it can be deleted'
        );
    END IF;

    -- Precondition 3: zero child rows (any is_active) in field definitions projection
    SELECT COUNT(*), COALESCE(jsonb_agg(display_name ORDER BY display_name), '[]'::jsonb)
    INTO v_child_count, v_child_names
    FROM client_field_definitions_projection
    WHERE category_id = p_category_id AND organization_id = v_org_id;

    IF v_child_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format(
                'Cannot delete -- category "%s" still has %s field(s). Delete those fields first.',
                v_category.name, v_child_count
            ),
            'category_id', p_category_id,
            'child_count', v_child_count,
            'child_names', v_child_names
        );
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id   := p_category_id,
        p_stream_type := 'client_field_category',
        p_event_type  := 'client_field_category.deleted',
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

    IF EXISTS (
        SELECT 1 FROM client_field_categories WHERE id = p_category_id
    ) THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_category_id
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed -- row still present'),
            'category_id', p_category_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'category_id', p_category_id);
END;
$$;

-- =============================================================================
-- 5. Event handlers (public schema)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_field_definition_reactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    UPDATE client_field_definitions_projection SET
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'field_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_client_field_definition_deleted(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    DELETE FROM client_field_definitions_projection
    WHERE id = (p_event.event_data->>'field_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_client_field_category_reactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    UPDATE client_field_categories SET
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'category_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_client_field_category_deleted(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    DELETE FROM client_field_categories
    WHERE id = (p_event.event_data->>'category_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$$;

-- =============================================================================
-- 6. Router updates -- add 2 CASE branches to each router
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_client_field_definition_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    CASE p_event.event_type

        WHEN 'client_field_definition.created' THEN
            PERFORM handle_client_field_definition_created(p_event);

        WHEN 'client_field_definition.updated' THEN
            PERFORM handle_client_field_definition_updated(p_event);

        WHEN 'client_field_definition.deactivated' THEN
            PERFORM handle_client_field_definition_deactivated(p_event);

        WHEN 'client_field_definition.reactivated' THEN
            PERFORM handle_client_field_definition_reactivated(p_event);

        WHEN 'client_field_definition.deleted' THEN
            PERFORM handle_client_field_definition_deleted(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_field_definition_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$$;

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

        WHEN 'client_field_category.reactivated' THEN
            PERFORM handle_client_field_category_reactivated(p_event);

        WHEN 'client_field_category.deleted' THEN
            PERFORM handle_client_field_category_deleted(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_field_category_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$$;

-- =============================================================================
-- 7. Inactive-aware helpers
-- =============================================================================
-- api.list_field_categories(p_include_inactive) -- support the Inactive filter.
-- Must drop-and-recreate because parameter list changes.

DROP FUNCTION IF EXISTS api.list_field_categories();

CREATE OR REPLACE FUNCTION api.list_field_categories(
    p_include_inactive boolean DEFAULT false
)
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
      AND (p_include_inactive OR c.is_active = true)
    ORDER BY c.sort_order;
END;
$$;

-- api.get_category_field_count(p_category_id, p_include_inactive)
-- Extended to optionally include inactive fields so the category-delete gate
-- matches the RPC precondition (active + inactive must equal zero).

DROP FUNCTION IF EXISTS api.get_category_field_count(uuid);

CREATE OR REPLACE FUNCTION api.get_category_field_count(
    p_category_id uuid,
    p_include_inactive boolean DEFAULT false
)
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

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    SELECT COUNT(*), COALESCE(jsonb_agg(display_name ORDER BY display_name), '[]'::jsonb)
    INTO v_count, v_fields
    FROM client_field_definitions_projection
    WHERE category_id = p_category_id
      AND organization_id = v_org_id
      AND (p_include_inactive OR is_active = true);

    RETURN jsonb_build_object('success', true, 'count', v_count, 'fields', v_fields);
END;
$$;

-- =============================================================================
-- 8. event_types seed -- 4 new event types
-- =============================================================================

INSERT INTO "public"."event_types" (
    "event_type", "stream_type", "event_schema", "description",
    "projection_function", "projection_tables", "is_active"
)
VALUES
    (
        'client_field_definition.reactivated',
        'client_field_definition',
        '{"type": "object", "required": ["field_id", "organization_id"]}'::jsonb,
        'A previously deactivated field definition has been reactivated. Restores visibility in configuration UI without re-seeding defaults.',
        'handle_client_field_definition_reactivated',
        ARRAY['client_field_definitions_projection'],
        true
    ),
    (
        'client_field_definition.deleted',
        'client_field_definition',
        '{"type": "object", "required": ["field_id", "organization_id", "field_key"]}'::jsonb,
        'A field definition has been permanently deleted. Emitted only after deactivation and when no clients have data for the field_key.',
        'handle_client_field_definition_deleted',
        ARRAY['client_field_definitions_projection'],
        true
    ),
    (
        'client_field_category.reactivated',
        'client_field_category',
        '{"type": "object", "required": ["category_id", "organization_id"]}'::jsonb,
        'A previously deactivated org-defined field category has been reactivated. Does not cascade -- child fields remain in their current state.',
        'handle_client_field_category_reactivated',
        ARRAY['client_field_categories'],
        true
    ),
    (
        'client_field_category.deleted',
        'client_field_category',
        '{"type": "object", "required": ["category_id", "organization_id"]}'::jsonb,
        'An org-defined field category has been permanently deleted. Emitted only after deactivation and when no field definitions reference the category.',
        'handle_client_field_category_deleted',
        ARRAY['client_field_categories'],
        true
    )
ON CONFLICT ("event_type") DO NOTHING;

-- =============================================================================
-- 9. GRANTs
-- =============================================================================

GRANT EXECUTE ON FUNCTION api.reactivate_field_definition(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.delete_field_definition(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.reactivate_field_category(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api.delete_field_category(uuid, text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION api.list_field_categories(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION api.list_field_categories(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION api.get_category_field_count(uuid, boolean) TO authenticated;
