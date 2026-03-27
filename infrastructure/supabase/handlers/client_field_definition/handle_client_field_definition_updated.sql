CREATE OR REPLACE FUNCTION public.handle_client_field_definition_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_field_id uuid;
    v_org_id uuid;
BEGIN
    v_field_id := (p_event.event_data->>'field_id')::uuid;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;

    UPDATE client_field_definitions_projection SET
        display_name = COALESCE(
            p_event.event_data->>'display_name',
            display_name
        ),
        field_type = COALESCE(
            p_event.event_data->>'field_type',
            field_type
        ),
        category_id = COALESCE(
            (p_event.event_data->>'category_id')::uuid,
            category_id
        ),
        is_visible = COALESCE(
            (p_event.event_data->>'is_visible')::boolean,
            is_visible
        ),
        is_required = COALESCE(
            (p_event.event_data->>'is_required')::boolean,
            is_required
        ),
        validation_rules = CASE
            WHEN p_event.event_data ? 'validation_rules'
            THEN p_event.event_data->'validation_rules'
            ELSE validation_rules
        END,
        is_dimension = COALESCE(
            (p_event.event_data->>'is_dimension')::boolean,
            is_dimension
        ),
        sort_order = COALESCE(
            (p_event.event_data->>'sort_order')::integer,
            sort_order
        ),
        configurable_label = CASE
            WHEN p_event.event_data ? 'configurable_label'
            THEN p_event.event_data->>'configurable_label'
            ELSE configurable_label
        END,
        conforming_dimension_mapping = CASE
            WHEN p_event.event_data ? 'conforming_dimension_mapping'
            THEN p_event.event_data->>'conforming_dimension_mapping'
            ELSE conforming_dimension_mapping
        END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = v_field_id
      AND organization_id = v_org_id;
END;
$function$;
