-- =====================================================================
-- DEPRECATE WORKFLOW QUEUE TRIGGERS (Phase 2 - Architecture Simplification)
-- =====================================================================
-- Migration: 20241201000000_deprecate_workflow_queue_triggers
-- Purpose: Remove event-driven workflow queue triggering mechanism
-- Reason: Phase 2 Architecture Simplification (Option C)
--
-- OLD ARCHITECTURE (5 hops):
--   Frontend → Edge Function → PostgreSQL → Realtime → Worker → Temporal
--   - Edge Function emits organization.bootstrap.initiated event
--   - Trigger emits workflow.queue.pending event
--   - Projection trigger updates workflow_queue_projection
--   - Worker subscribes via Supabase Realtime
--   - Worker starts Temporal workflow
--
-- NEW ARCHITECTURE (2 hops):
--   Frontend → Edge Function → Temporal
--   - Edge Function starts Temporal workflow directly via RPC
--   - Domain events still emitted for audit trail
--   - Projections still updated for read models
--   - Workflow queue no longer used for triggering
--
-- CHANGES:
--   1. DROP TRIGGER enqueue_workflow_from_bootstrap_event_trigger
--   2. DROP FUNCTION enqueue_workflow_from_bootstrap_event()
--   3. DROP TRIGGER update_workflow_queue_projection_trigger
--   4. DROP FUNCTION update_workflow_queue_projection_from_event()
--   5. PRESERVE workflow_queue_projection table (historical data)
--
-- IMPACT:
--   - Prevents duplicate workflow executions (Edge Function + event listener)
--   - Removes ~600ms latency from workflow triggering
--   - Simplifies debugging (immediate error feedback)
--   - Removes dependency on PostgreSQL LISTEN/NOTIFY
--   - Removes dependency on Supabase Realtime WebSocket connection
--
-- ROLLBACK:
--   - Restore trigger files from git history:
--     * infrastructure/supabase/sql/04-triggers/enqueue_workflow_from_bootstrap_event.sql
--     * infrastructure/supabase/sql/04-triggers/update_workflow_queue_projection.sql
--   - Re-apply via psql
--
-- Related Files:
--   - Edge Function: infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts
--   - Worker: workflows/src/worker/index.ts
--   - Architecture Doc: dev/active/architecture-simplification-option-c.md
-- =====================================================================

BEGIN;

-- Drop trigger for enqueuing workflows from bootstrap events
DROP TRIGGER IF EXISTS enqueue_workflow_from_bootstrap_event_trigger
    ON domain_events;

-- Drop function for enqueuing workflows
DROP FUNCTION IF EXISTS enqueue_workflow_from_bootstrap_event();

-- Drop trigger for updating workflow queue projection
DROP TRIGGER IF EXISTS update_workflow_queue_projection_trigger
    ON domain_events;

-- Drop function for updating workflow queue projection
DROP FUNCTION IF EXISTS update_workflow_queue_projection_from_event();

-- Add deprecation notice to workflow_queue_projection table
-- (preserve table for historical data and potential future use)
COMMENT ON TABLE workflow_queue_projection IS
    'DEPRECATED (Phase 2 - 2024-12-01): Workflow queue no longer used for triggering. '
    'Workflows now triggered via direct Temporal RPC from Edge Function. '
    'Table preserved for historical data. '
    'See: dev/active/architecture-simplification-option-c.md';

-- Log migration completion
DO $$
BEGIN
    RAISE NOTICE 'Migration 20241201000000_deprecate_workflow_queue_triggers completed';
    RAISE NOTICE '  - Dropped trigger: enqueue_workflow_from_bootstrap_event_trigger';
    RAISE NOTICE '  - Dropped function: enqueue_workflow_from_bootstrap_event()';
    RAISE NOTICE '  - Dropped trigger: update_workflow_queue_projection_trigger';
    RAISE NOTICE '  - Dropped function: update_workflow_queue_projection_from_event()';
    RAISE NOTICE '  - Preserved table: workflow_queue_projection (historical data)';
    RAISE NOTICE '';
    RAISE NOTICE 'Phase 2 Architecture Simplification: Event-driven workflow triggering removed';
    RAISE NOTICE 'Workflows now started via direct Temporal RPC (Edge Function → Temporal)';
END $$;

COMMIT;
