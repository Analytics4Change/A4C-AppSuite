-- =====================================================
-- Trigger: Process Organization Bootstrap Initiated Events
-- =====================================================
-- Purpose: Notify workflow worker when organization.bootstrap.initiated events are inserted
--
-- Architecture Pattern: Database Trigger → NOTIFY → Worker Listener → Start Temporal Workflow
--
-- Flow:
--   1. Edge Function emits 'organization.bootstrap.initiated' event
--   2. Event inserted into domain_events table
--   3. This trigger fires BEFORE INSERT (before CQRS projection trigger)
--   4. PostgreSQL NOTIFY sends message to 'workflow_events' channel
--   5. Workflow worker (listening on channel) receives notification
--   6. Worker starts Temporal workflow with event data
--   7. Worker updates event with workflow_id and workflow_run_id
--
-- Benefits:
--   - Decouples Edge Function from Temporal (no direct HTTP calls)
--   - Resilient: If worker is down, events accumulate and process when worker restarts
--   - Auditable: All workflow starts recorded as immutable events
--   - Observable: Easy to monitor unprocessed events
--
-- Idempotency: Notifies on INSERT (before CQRS projection trigger sets processed_at)
-- Runs BEFORE the process_domain_event_trigger to ensure notification always fires
--
-- Author: A4C Infrastructure Team
-- Created: 2025-11-23
-- =====================================================

-- Drop existing function and trigger if they exist (for re-deployment)
DROP TRIGGER IF EXISTS trigger_notify_bootstrap_initiated ON domain_events;
DROP FUNCTION IF EXISTS notify_workflow_worker_bootstrap() CASCADE;

-- =====================================================
-- Function: Notify Workflow Worker of Bootstrap Events
-- =====================================================
CREATE OR REPLACE FUNCTION notify_workflow_worker_bootstrap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_payload jsonb;
BEGIN
  -- Only notify for organization.bootstrap.initiated events
  -- Note: This runs BEFORE the CQRS projection trigger, so processed_at is always NULL
  IF NEW.event_type = 'organization.bootstrap.initiated' THEN

    -- Build notification payload with all necessary data for workflow start
    notification_payload := jsonb_build_object(
      'event_id', NEW.id,
      'event_type', NEW.event_type,
      'stream_id', NEW.stream_id,
      'stream_type', NEW.stream_type,
      'event_data', NEW.event_data,
      'event_metadata', NEW.event_metadata,
      'created_at', NEW.created_at
    );

    -- Send notification to workflow_events channel
    -- Worker subscribes to this channel and receives payload
    PERFORM pg_notify('workflow_events', notification_payload::text);

    -- Log for debugging (visible in Supabase logs)
    RAISE NOTICE 'Notified workflow worker: event_id=%, stream_id=%',
      NEW.id, NEW.stream_id;

  END IF;

  RETURN NEW;
END;
$$;

-- Add comment explaining the function
COMMENT ON FUNCTION notify_workflow_worker_bootstrap() IS
  'Sends PostgreSQL NOTIFY message to workflow_events channel when organization.bootstrap.initiated events are inserted.
   Worker listens on this channel and starts Temporal workflows in response.
   Runs BEFORE the CQRS projection trigger to ensure notification always fires.';

-- =====================================================
-- Trigger: Fire BEFORE INSERT on domain_events
-- =====================================================
-- Important: This must run BEFORE the process_domain_event_trigger (also BEFORE INSERT)
-- to ensure notification fires before CQRS projection processing sets processed_at
CREATE TRIGGER trigger_notify_bootstrap_initiated
  BEFORE INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION notify_workflow_worker_bootstrap();

-- Add comment explaining the trigger
COMMENT ON TRIGGER trigger_notify_bootstrap_initiated ON domain_events IS
  'Notifies workflow worker via PostgreSQL NOTIFY when organization.bootstrap.initiated events are inserted.
   Fires BEFORE INSERT, before the process_domain_event_trigger sets processed_at.
   Part of the event-driven workflow triggering pattern.';

-- =====================================================
-- Grant Permissions
-- =====================================================
-- Service role needs to execute this function when events are inserted
GRANT EXECUTE ON FUNCTION notify_workflow_worker_bootstrap() TO service_role;
GRANT EXECUTE ON FUNCTION notify_workflow_worker_bootstrap() TO postgres;

-- =====================================================
-- Testing / Verification
-- =====================================================

-- Test 1: Verify trigger exists
-- SELECT trigger_name, event_manipulation, action_statement
-- FROM information_schema.triggers
-- WHERE trigger_name = 'trigger_notify_bootstrap_initiated';

-- Test 2: Listen for notifications (run in separate session)
-- LISTEN workflow_events;
-- -- Then insert a test event in another session
-- -- You should see the notification payload

-- Test 3: Insert test event and verify notification
-- INSERT INTO domain_events (
--   stream_id,
--   stream_type,
--   stream_version,
--   event_type,
--   event_data,
--   event_metadata
-- ) VALUES (
--   gen_random_uuid(),
--   'Organization',
--   1,
--   'organization.bootstrap.initiated',
--   '{"name": "Test Org", "type": "provider"}'::jsonb,
--   '{"timestamp": "2025-11-23T12:00:00Z"}'::jsonb
-- );

-- Test 4: Verify only unprocessed events are notified
-- UPDATE domain_events
-- SET processed_at = NOW()
-- WHERE event_type = 'organization.bootstrap.initiated'
--   AND processed_at IS NULL;
-- -- Re-insert event - should still notify (new event, processed_at IS NULL)

-- =====================================================
-- Rollback Instructions
-- =====================================================
-- To remove this trigger and function:
-- DROP TRIGGER IF EXISTS trigger_notify_bootstrap_initiated ON domain_events;
-- DROP FUNCTION IF EXISTS notify_workflow_worker_bootstrap() CASCADE;
-- =====================================================

-- =====================================================
-- Monitoring Queries
-- =====================================================

-- Query 1: Find unprocessed bootstrap events
-- SELECT id, stream_id, created_at,
--        EXTRACT(EPOCH FROM (NOW() - created_at))::int as age_seconds
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.initiated'
--   AND processed_at IS NULL
-- ORDER BY created_at DESC;

-- Query 2: Find failed bootstrap events (have processing_error)
-- SELECT id, stream_id, created_at, processing_error, retry_count
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.initiated'
--   AND processing_error IS NOT NULL
-- ORDER BY created_at DESC;

-- Query 3: Monitor processing lag (time between event creation and processing)
-- SELECT
--   event_type,
--   COUNT(*) as total,
--   COUNT(*) FILTER (WHERE processed_at IS NULL) as unprocessed,
--   AVG(EXTRACT(EPOCH FROM (processed_at - created_at)))::int as avg_processing_time_seconds,
--   MAX(EXTRACT(EPOCH FROM (processed_at - created_at)))::int as max_processing_time_seconds
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.initiated'
-- GROUP BY event_type;

-- =====================================================
