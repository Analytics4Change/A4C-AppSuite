CREATE OR REPLACE FUNCTION public.handle_client_field_definition_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_field_definitions_projection (
        id, organization_id, category_id, field_key, display_name, field_type,
        is_visible, is_required, validation_rules, is_dimension, sort_order,
        configurable_label, conforming_dimension_mapping,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'field_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'category_id')::uuid,
        p_event.event_data->>'field_key',
        p_event.event_data->>'display_name',
        COALESCE(p_event.event_data->>'field_type', 'text'),
        COALESCE((p_event.event_data->>'is_visible')::boolean, true),
        COALESCE((p_event.event_data->>'is_required')::boolean, false),
        p_event.event_data->'validation_rules',
        COALESCE((p_event.event_data->>'is_dimension')::boolean, false),
        COALESCE((p_event.event_data->>'sort_order')::integer, 0),
        p_event.event_data->>'configurable_label',
        p_event.event_data->>'conforming_dimension_mapping',
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (organization_id, field_key) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        display_name = EXCLUDED.display_name,
        field_type = EXCLUDED.field_type,
        is_visible = EXCLUDED.is_visible,
        is_required = EXCLUDED.is_required,
        validation_rules = EXCLUDED.validation_rules,
        is_dimension = EXCLUDED.is_dimension,
        sort_order = EXCLUDED.sort_order,
        configurable_label = EXCLUDED.configurable_label,
        conforming_dimension_mapping = EXCLUDED.conforming_dimension_mapping,
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;
END;
$function$;
