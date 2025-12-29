-- =============================================================================
-- Migration: Add WHEN clauses to bootstrap triggers
-- Purpose: Performance optimization - filter at trigger level, not function level
-- =============================================================================
--
-- ANTI-PATTERN FIXED:
-- Two triggers were firing on ALL domain_events inserts but only handling
-- specific bootstrap events. The filtering was done inside the trigger
-- functions, causing unnecessary function call overhead for every event.
--
-- ARCHITECTURAL PRINCIPLE:
-- - process_domain_event_trigger: NO WHEN clause (main event router)
-- - All other triggers: MUST have WHEN clause to filter at trigger level
--
-- =============================================================================

-- 1. Fix trigger_notify_bootstrap_initiated
-- Purpose: Sends pg_notify to workflow worker when bootstrap starts
-- Was: Firing on ALL inserts, checking event_type inside function
-- Now: Only fires for organization.bootstrap.initiated events
DROP TRIGGER IF EXISTS trigger_notify_bootstrap_initiated ON domain_events;
CREATE TRIGGER trigger_notify_bootstrap_initiated
  BEFORE INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'organization.bootstrap.initiated')
  EXECUTE FUNCTION notify_workflow_worker_bootstrap();

COMMENT ON TRIGGER trigger_notify_bootstrap_initiated ON domain_events IS
  'Notifies workflow worker via PostgreSQL NOTIFY when organization.bootstrap.initiated events are inserted.
   Fires BEFORE INSERT, before the process_domain_event_trigger sets processed_at.
   Part of the event-driven workflow triggering pattern.';

-- 2. Fix bootstrap_workflow_trigger
-- Purpose: Handles cleanup when bootstrap fails (emits cancellation event)
-- Was: Firing on ALL inserts, checking stream_type + event_type inside function
-- Now: Only fires for organization.bootstrap.failed events
DROP TRIGGER IF EXISTS bootstrap_workflow_trigger ON domain_events;
CREATE TRIGGER bootstrap_workflow_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'organization.bootstrap.failed')
  EXECUTE FUNCTION handle_bootstrap_workflow();

COMMENT ON TRIGGER bootstrap_workflow_trigger ON domain_events IS
  'Handles cleanup for failed bootstrap events. Fires only on organization.bootstrap.failed.
   Emits organization.bootstrap.cancelled event when partial_cleanup_required is true.';
