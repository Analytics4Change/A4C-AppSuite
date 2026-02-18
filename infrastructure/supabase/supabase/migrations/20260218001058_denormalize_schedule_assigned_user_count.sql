-- =============================================================================
-- Denormalize assigned_user_count on schedule_templates_projection
--
-- Architect finding m3 (4.3): Replace correlated subquery in
-- list_schedule_templates with a stored column maintained by handlers.
-- =============================================================================

-- 1. Add column
ALTER TABLE schedule_templates_projection
    ADD COLUMN IF NOT EXISTS assigned_user_count integer NOT NULL DEFAULT 0;

-- 2. Backfill from existing assignments
UPDATE schedule_templates_projection st
SET assigned_user_count = sub.cnt
FROM (
    SELECT schedule_template_id, count(*)::integer AS cnt
    FROM schedule_user_assignments_projection
    GROUP BY schedule_template_id
) sub
WHERE sub.schedule_template_id = st.id;


-- =============================================================================
-- 3. Update handle_schedule_created — recount after creating assignments
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_schedule_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_template_id uuid;
    v_user_id uuid;
    v_user_ids jsonb;
BEGIN
    v_template_id := (p_event.event_data->>'template_id')::uuid;

    -- Insert template
    INSERT INTO schedule_templates_projection (
        id, organization_id, org_unit_id, schedule_name, schedule,
        created_by, created_at, updated_at, last_event_id
    ) VALUES (
        v_template_id,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'org_unit_id')::uuid,
        p_event.event_data->>'schedule_name',
        p_event.event_data->'schedule',
        (p_event.event_data->>'created_by')::uuid,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (id) DO UPDATE SET
        schedule_name = EXCLUDED.schedule_name,
        schedule = EXCLUDED.schedule,
        org_unit_id = EXCLUDED.org_unit_id,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;

    -- Create initial assignments if user_ids provided
    v_user_ids := p_event.event_data->'user_ids';
    IF v_user_ids IS NOT NULL AND jsonb_array_length(v_user_ids) > 0 THEN
        FOR v_user_id IN SELECT jsonb_array_elements_text(v_user_ids)::uuid
        LOOP
            INSERT INTO schedule_user_assignments_projection (
                schedule_template_id, user_id, organization_id,
                created_at, updated_at, last_event_id
            ) VALUES (
                v_template_id,
                v_user_id,
                (p_event.event_data->>'organization_id')::uuid,
                p_event.created_at,
                p_event.created_at,
                p_event.id
            ) ON CONFLICT (schedule_template_id, user_id) DO NOTHING;
        END LOOP;
    END IF;

    -- Recount assigned users (idempotent)
    UPDATE schedule_templates_projection
    SET assigned_user_count = (
        SELECT count(*)::integer FROM schedule_user_assignments_projection
        WHERE schedule_template_id = v_template_id
    )
    WHERE id = v_template_id;
END;
$function$;


-- =============================================================================
-- 4. Update handle_schedule_user_assigned — recount after insert
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_schedule_user_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_template_id uuid;
BEGIN
    v_template_id := (p_event.event_data->>'template_id')::uuid;

    INSERT INTO schedule_user_assignments_projection (
        schedule_template_id, user_id, organization_id,
        effective_from, effective_until,
        created_at, updated_at, last_event_id
    ) VALUES (
        v_template_id,
        (p_event.event_data->>'user_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'effective_from')::date,
        (p_event.event_data->>'effective_until')::date,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (schedule_template_id, user_id) DO UPDATE SET
        effective_from = EXCLUDED.effective_from,
        effective_until = EXCLUDED.effective_until,
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;

    -- Recount assigned users (idempotent — handles both INSERT and ON CONFLICT)
    UPDATE schedule_templates_projection
    SET assigned_user_count = (
        SELECT count(*)::integer FROM schedule_user_assignments_projection
        WHERE schedule_template_id = v_template_id
    )
    WHERE id = v_template_id;
END;
$function$;


-- =============================================================================
-- 5. Update handle_schedule_user_unassigned — recount after delete
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_schedule_user_unassigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_template_id uuid;
BEGIN
    v_template_id := (p_event.event_data->>'template_id')::uuid;

    DELETE FROM schedule_user_assignments_projection
    WHERE schedule_template_id = v_template_id
      AND user_id = (p_event.event_data->>'user_id')::uuid;

    -- Recount assigned users (idempotent — handles replay where row already deleted)
    UPDATE schedule_templates_projection
    SET assigned_user_count = (
        SELECT count(*)::integer FROM schedule_user_assignments_projection
        WHERE schedule_template_id = v_template_id
    )
    WHERE id = v_template_id;
END;
$function$;


-- =============================================================================
-- 6. Update list_schedule_templates — read column instead of correlated subquery
-- =============================================================================
CREATE OR REPLACE FUNCTION api.list_schedule_templates(
    p_org_id uuid DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_search text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_result jsonb;
BEGIN
    v_org_id := COALESCE(p_org_id, public.get_current_org_id());

    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.schedule_name), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            st.id,
            st.organization_id,
            st.org_unit_id,
            ou.name AS org_unit_name,
            st.schedule_name,
            st.schedule,
            st.is_active,
            st.created_at,
            st.updated_at,
            st.assigned_user_count
        FROM public.schedule_templates_projection st
        LEFT JOIN public.organization_units_projection ou ON ou.id = st.org_unit_id
        WHERE st.organization_id = v_org_id
          AND (p_status IS NULL OR p_status = 'all'
               OR (p_status = 'active' AND st.is_active = true)
               OR (p_status = 'inactive' AND st.is_active = false))
          AND (p_search IS NULL
               OR st.schedule_name ILIKE '%' || p_search || '%')
    ) t;

    RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$function$;

GRANT EXECUTE ON FUNCTION api.list_schedule_templates(uuid, text, text) TO authenticated;
