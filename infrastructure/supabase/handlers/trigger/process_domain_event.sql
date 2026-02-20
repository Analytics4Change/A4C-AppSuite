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
                WHEN 'role'              THEN PERFORM process_rbac_event(NEW);
                WHEN 'permission'        THEN PERFORM process_rbac_event(NEW);
                WHEN 'user'              THEN PERFORM process_user_event(NEW);
                WHEN 'organization'      THEN PERFORM process_organization_event(NEW);
                WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
                WHEN 'schedule'          THEN PERFORM process_schedule_event(NEW);
                WHEN 'contact'           THEN PERFORM process_contact_event(NEW);
                WHEN 'address'           THEN PERFORM process_address_event(NEW);
                WHEN 'phone'             THEN PERFORM process_phone_event(NEW);
                WHEN 'email'             THEN PERFORM process_email_event(NEW);
                WHEN 'invitation'        THEN PERFORM process_invitation_event(NEW);
                WHEN 'access_grant'      THEN PERFORM process_access_grant_event(NEW);
                WHEN 'impersonation'     THEN PERFORM process_impersonation_event(NEW);
                -- Administrative stream_types — No projection needed
                WHEN 'platform_admin'    THEN NULL;
                WHEN 'workflow_queue'    THEN NULL;
                WHEN 'test'              THEN NULL;
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
