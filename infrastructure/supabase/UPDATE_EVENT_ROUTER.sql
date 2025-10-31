-- ============================================================================
-- UPDATE MAIN EVENT ROUTER
-- ============================================================================
-- This script updates the main event router to handle new stream types
-- Run this AFTER running DEPLOY_ORGANIZATION_MODULE.sql
-- ============================================================================

-- Replace the process_domain_event function with updated version
CREATE OR REPLACE FUNCTION process_domain_event()
RETURNS TRIGGER AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  v_start_time := clock_timestamp();

  -- Skip if already processed
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Route based on stream type
    CASE NEW.stream_type
      WHEN 'client' THEN
        PERFORM process_client_event(NEW);

      WHEN 'medication' THEN
        PERFORM process_medication_event(NEW);

      WHEN 'medication_history' THEN
        PERFORM process_medication_history_event(NEW);

      WHEN 'dosage' THEN
        PERFORM process_dosage_event(NEW);

      WHEN 'user' THEN
        PERFORM process_user_event(NEW);

      WHEN 'organization' THEN
        PERFORM process_organization_event(NEW);

      -- Organization child entities (NEW)
      WHEN 'program' THEN
        PERFORM process_program_event(NEW);

      WHEN 'contact' THEN
        PERFORM process_contact_event(NEW);

      WHEN 'address' THEN
        PERFORM process_address_event(NEW);

      WHEN 'phone' THEN
        PERFORM process_phone_event(NEW);

      -- RBAC stream types
      WHEN 'permission' THEN
        PERFORM process_rbac_event(NEW);

      WHEN 'role' THEN
        PERFORM process_rbac_event(NEW);

      WHEN 'access_grant' THEN
        PERFORM process_access_grant_event(NEW);

      -- Impersonation stream type
      WHEN 'impersonation' THEN
        PERFORM process_impersonation_event(NEW);

      ELSE
        RAISE WARNING 'Unknown stream type: %', NEW.stream_type;
    END CASE;

    -- Mark as successfully processed
    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

    -- Log processing time if it took too long (>100ms)
    IF (clock_timestamp() - v_start_time) > interval '100 milliseconds' THEN
      RAISE WARNING 'Event % took % to process',
        NEW.id,
        (clock_timestamp() - v_start_time);
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      -- Capture error details
      GET STACKED DIAGNOSTICS
        v_error_msg = MESSAGE_TEXT,
        v_error_detail = PG_EXCEPTION_DETAIL;

      -- Log error
      RAISE WARNING 'Failed to process event %: % - %',
        NEW.id,
        v_error_msg,
        v_error_detail;

      -- Update event with error info
      NEW.processing_error = format('Error: %s | Detail: %s', v_error_msg, v_error_detail);
      NEW.retry_count = COALESCE(NEW.retry_count, 0) + 1;

      -- Don't mark as processed so it can be retried
      NEW.processed_at = NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Display success message
DO $$
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Event Router Update Complete!';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'The main event router now handles:';
  RAISE NOTICE '  - program (NEW)';
  RAISE NOTICE '  - contact (NEW)';
  RAISE NOTICE '  - address (NEW)';
  RAISE NOTICE '  - phone (NEW)';
  RAISE NOTICE '';
  RAISE NOTICE 'All organization module database components are now deployed!';
  RAISE NOTICE '============================================================================';
END $$;
