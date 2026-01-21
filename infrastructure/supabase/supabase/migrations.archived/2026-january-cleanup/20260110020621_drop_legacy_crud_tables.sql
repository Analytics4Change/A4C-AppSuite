-- Migration: Drop legacy CRUD tables and their event processors
--
-- These tables predate the CQRS refactor and were never converted to projections:
-- - clients (should be clients_projection)
-- - medications (should be medications_projection)
-- - medication_history (should be medication_history_projection)
-- - dosage_info (should be dosage_info_projection)
--
-- Client/medication management will be redefined later with proper event-driven architecture.
-- All tables have 0 rows, so no data loss.
--
-- Also removes:
-- - Event processor functions that INSERT into these tables
-- - Event router cases for client/medication/dosage stream_types

-- ============================================================================
-- Step 1: Drop event processor functions (must happen before tables)
-- ============================================================================
DROP FUNCTION IF EXISTS process_client_event(record) CASCADE;
DROP FUNCTION IF EXISTS process_medication_event(record) CASCADE;
DROP FUNCTION IF EXISTS process_medication_history_event(record) CASCADE;
DROP FUNCTION IF EXISTS process_dosage_event(record) CASCADE;

-- ============================================================================
-- Step 2: Drop legacy CRUD tables
-- ============================================================================
-- Drop in FK dependency order (child tables first)
-- CASCADE handles FK constraints automatically
DROP TABLE IF EXISTS dosage_info CASCADE;
DROP TABLE IF EXISTS medication_history CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS medications CASCADE;

-- ============================================================================
-- Step 3: Update main event router to remove dropped stream_types
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."process_domain_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  v_start_time := clock_timestamp();

  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      CASE NEW.stream_type
        WHEN 'role' THEN PERFORM process_rbac_event(NEW);
        WHEN 'permission' THEN PERFORM process_rbac_event(NEW);
        WHEN 'user' THEN PERFORM process_user_event(NEW);
        WHEN 'organization' THEN PERFORM process_organization_event(NEW);
        WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
        WHEN 'contact' THEN PERFORM process_contact_event(NEW);
        WHEN 'address' THEN PERFORM process_address_event(NEW);
        WHEN 'phone' THEN PERFORM process_phone_event(NEW);
        WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);
        WHEN 'access_grant' THEN PERFORM process_access_grant_event(NEW);
        WHEN 'impersonation' THEN PERFORM process_impersonation_event(NEW);
        -- NOTE: client, medication, medication_history, dosage stream_types removed
        -- These were legacy CRUD tables that never followed CQRS naming convention
        ELSE
          RAISE WARNING 'Unknown stream_type: %', NEW.stream_type;
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
$$;

COMMENT ON FUNCTION "public"."process_domain_event"() IS 'Main router that processes domain events and projects them to 3NF tables. Routes by stream_type to specialized processors.';
