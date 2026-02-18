-- Add p_event_metadata to all schedule API functions that emit domain events.
-- Per infrastructure guidelines, all events must include user_id in event_metadata
-- for audit trail compliance. Also adds 'reason' when the function accepts p_reason.
--
-- Additionally wraps api.list_schedule_templates return in a success envelope
-- for consistency with all other api.* RPC functions, and treats p_status = 'all'
-- the same as NULL (no filter).

-- =============================================================================
-- 1. create_schedule_template — add p_event_metadata
-- =============================================================================
CREATE OR REPLACE FUNCTION api.create_schedule_template(
    p_name text,
    p_schedule jsonb,
    p_org_unit_id uuid DEFAULT NULL,
    p_user_ids uuid[] DEFAULT '{}'::uuid[]
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_template_id uuid;
    v_uid uuid;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();
    v_template_id := gen_random_uuid();

    -- Validate permission
    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = p_org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    -- Validate OU belongs to org if specified
    IF p_org_unit_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.organization_units_projection
            WHERE id = p_org_unit_id AND organization_id = v_org_id
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Organization unit not found');
        END IF;
    END IF;

    -- Validate all user_ids belong to this org
    IF array_length(p_user_ids, 1) > 0 THEN
        IF EXISTS (
            SELECT 1 FROM unnest(p_user_ids) AS uid
            WHERE NOT EXISTS (
                SELECT 1 FROM public.users u WHERE u.id = uid AND u.organization_id = v_org_id
            )
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'One or more users not found in organization');
        END IF;
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := v_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.created',
        p_event_data     := jsonb_build_object(
            'template_id', v_template_id,
            'organization_id', v_org_id,
            'schedule_name', p_name,
            'schedule', p_schedule,
            'org_unit_id', p_org_unit_id,
            'user_ids', to_jsonb(p_user_ids),
            'created_by', v_user_id
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', v_org_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'template_id', v_template_id
    );
END;
$function$;


-- =============================================================================
-- 2. update_schedule_template — add p_event_metadata
-- =============================================================================
CREATE OR REPLACE FUNCTION api.update_schedule_template(
    p_template_id uuid,
    p_name text DEFAULT NULL,
    p_schedule jsonb DEFAULT NULL,
    p_org_unit_id uuid DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_template RECORD;
    v_event_data jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF NOT v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot update an inactive template');
    END IF;

    -- Validate permission
    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    v_event_data := jsonb_build_object(
        'template_id', p_template_id,
        'organization_id', v_org_id
    );

    IF p_name IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object(
            'schedule_name', p_name,
            'previous_name', v_template.schedule_name
        );
    END IF;

    IF p_schedule IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object(
            'schedule', p_schedule,
            'previous_schedule', v_template.schedule
        );
    END IF;

    IF p_org_unit_id IS DISTINCT FROM v_template.org_unit_id THEN
        v_event_data := v_event_data || jsonb_build_object('org_unit_id', p_org_unit_id);
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.updated',
        p_event_data     := v_event_data,
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', v_org_id
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;


-- =============================================================================
-- 3. deactivate_schedule_template — add p_event_metadata with reason
-- =============================================================================
CREATE OR REPLACE FUNCTION api.deactivate_schedule_template(
    p_template_id uuid,
    p_reason text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_template RECORD;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF NOT v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template is already inactive');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.deactivated',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'organization_id', v_org_id,
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', v_org_id
        ) || CASE WHEN p_reason IS NOT NULL
             THEN jsonb_build_object('reason', p_reason)
             ELSE '{}'::jsonb END
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;


-- =============================================================================
-- 4. reactivate_schedule_template — add p_event_metadata
-- =============================================================================
CREATE OR REPLACE FUNCTION api.reactivate_schedule_template(
    p_template_id uuid
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_template RECORD;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template is already active');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.reactivated',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'organization_id', v_org_id
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', v_org_id
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;


-- =============================================================================
-- 5. delete_schedule_template — add p_event_metadata with reason
-- =============================================================================
CREATE OR REPLACE FUNCTION api.delete_schedule_template(
    p_template_id uuid,
    p_reason text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_template RECORD;
    v_user_count integer;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF v_template.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Template must be deactivated before deletion',
            'errorDetails', jsonb_build_object('code', 'STILL_ACTIVE')
        );
    END IF;

    -- Check for assigned users
    SELECT count(*) INTO v_user_count
    FROM public.schedule_user_assignments_projection
    WHERE schedule_template_id = p_template_id;

    IF v_user_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Cannot delete: %s user(s) still assigned', v_user_count),
            'errorDetails', jsonb_build_object('code', 'HAS_USERS', 'count', v_user_count)
        );
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.deleted',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'organization_id', v_org_id,
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', v_org_id
        ) || CASE WHEN p_reason IS NOT NULL
             THEN jsonb_build_object('reason', p_reason)
             ELSE '{}'::jsonb END
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;


-- =============================================================================
-- 6. assign_user_to_schedule — add p_event_metadata
-- =============================================================================
CREATE OR REPLACE FUNCTION api.assign_user_to_schedule(
    p_template_id uuid,
    p_user_id uuid,
    p_effective_from date DEFAULT NULL,
    p_effective_until date DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_caller_id uuid;
    v_template RECORD;
BEGIN
    v_org_id := public.get_current_org_id();
    v_caller_id := auth.uid();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF NOT v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot assign users to an inactive template');
    END IF;

    -- Validate user belongs to org
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = p_user_id AND organization_id = v_org_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found in organization');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.user_assigned',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'user_id', p_user_id,
            'organization_id', v_org_id,
            'effective_from', p_effective_from,
            'effective_until', p_effective_until
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;


-- =============================================================================
-- 7. unassign_user_from_schedule — add p_event_metadata with reason
-- =============================================================================
CREATE OR REPLACE FUNCTION api.unassign_user_from_schedule(
    p_template_id uuid,
    p_user_id uuid,
    p_reason text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_caller_id uuid;
BEGIN
    v_org_id := public.get_current_org_id();
    v_caller_id := auth.uid();

    -- Validate template exists in org
    IF NOT EXISTS (
        SELECT 1 FROM public.schedule_templates_projection
        WHERE id = p_template_id AND organization_id = v_org_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    -- Validate assignment exists
    IF NOT EXISTS (
        SELECT 1 FROM public.schedule_user_assignments_projection
        WHERE schedule_template_id = p_template_id AND user_id = p_user_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'User is not assigned to this schedule');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection
             WHERE id = (SELECT org_unit_id FROM public.schedule_templates_projection WHERE id = p_template_id)),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.user_unassigned',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'user_id', p_user_id,
            'organization_id', v_org_id,
            'reason', p_reason
        ),
        p_event_metadata := jsonb_build_object(
            'user_id', v_caller_id,
            'organization_id', v_org_id
        ) || CASE WHEN p_reason IS NOT NULL
             THEN jsonb_build_object('reason', p_reason)
             ELSE '{}'::jsonb END
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;


-- =============================================================================
-- 8. list_schedule_templates — wrap in success envelope, handle 'all' status
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
            (SELECT count(*) FROM public.schedule_user_assignments_projection sa
             WHERE sa.schedule_template_id = st.id) AS assigned_user_count
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
