-- Fix: users table has 'name' column, not 'display_name'
-- This caused 400 errors on get_schedule_template RPC calls
CREATE OR REPLACE FUNCTION api.get_schedule_template(p_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_template jsonb;
    v_users jsonb;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT row_to_json(t)::jsonb INTO v_template
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
            st.created_by
        FROM public.schedule_templates_projection st
        LEFT JOIN public.organization_units_projection ou ON ou.id = st.org_unit_id
        WHERE st.id = p_template_id AND st.organization_id = v_org_id
    ) t;

    IF v_template IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb)
    INTO v_users
    FROM (
        SELECT
            sa.id,
            sa.user_id,
            u.name AS user_name,
            u.email AS user_email,
            sa.effective_from,
            sa.effective_until,
            sa.is_active,
            sa.created_at
        FROM public.schedule_user_assignments_projection sa
        JOIN public.users u ON u.id = sa.user_id
        WHERE sa.schedule_template_id = p_template_id
        ORDER BY u.name
    ) a;

    RETURN jsonb_build_object(
        'success', true,
        'template', v_template,
        'assigned_users', v_users
    );
END;
$function$;
