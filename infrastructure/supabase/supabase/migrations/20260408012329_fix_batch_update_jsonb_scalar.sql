-- =============================================================================
-- Fix: api.batch_update_field_definitions — handle PostgREST jsonb scalar wrapping
-- =============================================================================
-- PostgREST (via Supabase SDK .rpc()) may pass a jsonb ARRAY parameter as a
-- jsonb STRING SCALAR containing the array text. When this happens,
-- jsonb_array_elements(p_changes) fails with:
--   "cannot extract elements from a scalar"
--
-- The fix: if p_changes arrives as a string scalar, unwrap it to a real array
-- using (p_changes #>> '{}')::jsonb before iterating.

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
    v_changes jsonb;
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

    -- PostgREST may deliver jsonb arrays as string scalars — unwrap if needed
    IF jsonb_typeof(p_changes) = 'string' THEN
        v_changes := (p_changes #>> '{}')::jsonb;
    ELSE
        v_changes := p_changes;
    END IF;

    -- v_changes is now a JSON array: [{"field_id": "...", "is_visible": true, ...}, ...]
    FOR v_change IN SELECT jsonb_array_elements(v_changes)
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
