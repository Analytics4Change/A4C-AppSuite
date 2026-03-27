-- Migration: client_field_category_events
-- Adds event infrastructure for client field categories (Decision 87 — M5 remediation):
--   1. Add 'client_field_category' stream_type to process_domain_event() dispatcher
--   2. Create process_client_field_category_event() router (2 event types)
--   3. Create 2 handlers: created, deactivated

-- =============================================================================
-- 1. UPDATE DISPATCHER — add client_field_category stream_type
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
                WHEN 'client_field_category'    THEN PERFORM process_client_field_category_event(NEW);
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
-- 2. ROUTER — process_client_field_category_event
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_client_field_category_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type

        WHEN 'client_field_category.created' THEN
            PERFORM handle_client_field_category_created(p_event);

        WHEN 'client_field_category.deactivated' THEN
            PERFORM handle_client_field_category_deactivated(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_field_category_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;

-- =============================================================================
-- 3. HANDLER — handle_client_field_category_created
-- =============================================================================
-- Expected event_data:
--   category_id, organization_id, name, slug, sort_order

CREATE OR REPLACE FUNCTION public.handle_client_field_category_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_field_categories (
        id, organization_id, name, slug, sort_order,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'category_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'name',
        p_event.event_data->>'slug',
        COALESCE((p_event.event_data->>'sort_order')::integer, 0),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (organization_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;
END;
$function$;

-- =============================================================================
-- 4. HANDLER — handle_client_field_category_deactivated
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_field_category_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_field_categories SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'category_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
