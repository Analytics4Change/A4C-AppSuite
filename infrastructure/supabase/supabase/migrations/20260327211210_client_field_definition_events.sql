-- Migration: client_field_definition_events
-- Adds event infrastructure for client field definitions:
--   1. Add 'client_field_definition' stream_type to process_domain_event() dispatcher
--   2. Create process_client_field_definition_event() router (3 event types)
--   3. Create 3 handlers: created, updated, deactivated

-- =============================================================================
-- 1. UPDATE DISPATCHER — add client_field_definition stream_type
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_domain_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_error_msg TEXT;
    v_error_detail TEXT;
BEGIN
    -- Skip already-processed events (idempotency)
    IF NEW.processed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        IF (NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked')
           AND NEW.event_type NOT IN ('contact.user.linked', 'contact.user.unlinked') THEN
            PERFORM process_junction_event(NEW);
        ELSE
            CASE NEW.stream_type
                WHEN 'role'                     THEN PERFORM process_rbac_event(NEW);
                WHEN 'permission'               THEN PERFORM process_rbac_event(NEW);
                WHEN 'user'                     THEN PERFORM process_user_event(NEW);
                WHEN 'organization'             THEN PERFORM process_organization_event(NEW);
                WHEN 'organization_unit'        THEN PERFORM process_organization_unit_event(NEW);
                WHEN 'schedule'                 THEN PERFORM process_schedule_event(NEW);
                WHEN 'contact'                  THEN PERFORM process_contact_event(NEW);
                WHEN 'address'                  THEN PERFORM process_address_event(NEW);
                WHEN 'phone'                    THEN PERFORM process_phone_event(NEW);
                WHEN 'email'                    THEN PERFORM process_email_event(NEW);
                WHEN 'invitation'               THEN PERFORM process_invitation_event(NEW);
                WHEN 'access_grant'             THEN PERFORM process_access_grant_event(NEW);
                WHEN 'impersonation'            THEN PERFORM process_impersonation_event(NEW);
                WHEN 'client_field_definition'  THEN PERFORM process_client_field_definition_event(NEW);
                -- Administrative stream_types — No projection needed
                WHEN 'platform_admin'           THEN NULL;
                WHEN 'workflow_queue'           THEN NULL;
                WHEN 'test'                     THEN NULL;
                ELSE
                    RAISE EXCEPTION 'Unknown stream_type "%" for event %', NEW.stream_type, NEW.id
                        USING ERRCODE = 'P9002';
            END CASE;
        END IF;

        NEW.processed_at = clock_timestamp();
        NEW.processing_error = NULL;

    EXCEPTION
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
            RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
            NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
    END;

    RETURN NEW;
END;
$function$;

-- =============================================================================
-- 2. ROUTER — process_client_field_definition_event
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_client_field_definition_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type

        WHEN 'client_field_definition.created' THEN
            PERFORM handle_client_field_definition_created(p_event);

        WHEN 'client_field_definition.updated' THEN
            PERFORM handle_client_field_definition_updated(p_event);

        WHEN 'client_field_definition.deactivated' THEN
            PERFORM handle_client_field_definition_deactivated(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_field_definition_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;

-- =============================================================================
-- 3. HANDLER — handle_client_field_definition_created
-- =============================================================================
-- Expected event_data:
--   field_id, organization_id, category_id, field_key, display_name, field_type,
--   is_visible, is_required, validation_rules, is_dimension, sort_order,
--   configurable_label, conforming_dimension_mapping

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

-- =============================================================================
-- 4. HANDLER — handle_client_field_definition_updated
-- =============================================================================
-- Expected event_data:
--   field_id, organization_id, and any changed fields (partial update)

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

-- =============================================================================
-- 5. HANDLER — handle_client_field_definition_deactivated
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_field_definition_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_field_definitions_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'field_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
