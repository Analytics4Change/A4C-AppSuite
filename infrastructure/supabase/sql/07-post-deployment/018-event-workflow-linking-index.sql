-- =====================================================
-- Migration: Event-Workflow Linking Indexes
-- =====================================================
-- Purpose: Enable bi-directional traceability between domain events and Temporal workflows
--
-- Context:
--   When Temporal workflows execute activities that emit domain events, we need to
--   track which workflow created each event. This enables:
--   - Complete audit trail (HIPAA compliance)
--   - Workflow debugging (query all events for a failed workflow)
--   - Event replay (reconstruct workflow state from event history)
--   - Performance monitoring (track workflow progress via event stream)
--
-- Event Metadata Structure:
--   event_metadata jsonb contains:
--   {
--     "workflow_id": "org-bootstrap-abc123",       # Deterministic workflow ID
--     "workflow_run_id": "uuid-v4-temporal-run",   # Temporal execution ID
--     "workflow_type": "organizationBootstrapWorkflow",
--     "activity_id": "createOrganizationActivity",  # Optional: which activity emitted
--     "timestamp": "2025-11-23T12:00:00.000Z"
--   }
--
-- Idempotency: Safe to run multiple times (CREATE INDEX IF NOT EXISTS)
-- Reversible: DROP INDEX statements provided in comments
--
-- Author: A4C Infrastructure Team
-- Created: 2025-11-23
-- =====================================================

-- Index 1: Query all events for a specific workflow
-- Use case: "Show me all events emitted during workflow org-bootstrap-abc123"
CREATE INDEX IF NOT EXISTS idx_domain_events_workflow_id
ON domain_events ((event_metadata->>'workflow_id'))
WHERE event_metadata->>'workflow_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_workflow_id IS
  'Enables efficient queries for all events emitted during a workflow execution.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''workflow_id'' = ''org-bootstrap-abc123'';';

-- Index 2: Query events for a specific Temporal execution (run ID)
-- Use case: "Show me all events from this exact workflow run (handles retries/replays)"
CREATE INDEX IF NOT EXISTS idx_domain_events_workflow_run_id
ON domain_events ((event_metadata->>'workflow_run_id'))
WHERE event_metadata->>'workflow_run_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_workflow_run_id IS
  'Enables queries for specific workflow run (Temporal execution ID).
   Useful for distinguishing between retries/replays of the same workflow.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''workflow_run_id'' = ''uuid-v4-run-id'';';

-- Index 3: Composite index for workflow + event type queries
-- Use case: "Show me all 'contact.added' events from workflow org-bootstrap-abc123"
CREATE INDEX IF NOT EXISTS idx_domain_events_workflow_type
ON domain_events ((event_metadata->>'workflow_id'), event_type)
WHERE event_metadata->>'workflow_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_workflow_type IS
  'Optimizes queries filtering by both workflow and event type.
   Example: SELECT * FROM domain_events
            WHERE event_metadata->>''workflow_id'' = ''org-bootstrap-abc123''
              AND event_type = ''contact.added'';';

-- Index 4: Activity attribution (optional, for detailed debugging)
-- Use case: "Show me all events emitted by createOrganizationActivity"
CREATE INDEX IF NOT EXISTS idx_domain_events_activity_id
ON domain_events ((event_metadata->>'activity_id'))
WHERE event_metadata->>'activity_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_activity_id IS
  'Enables queries for events emitted by specific workflow activities.
   Useful for debugging which activity failed or produced unexpected events.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''activity_id'' = ''createOrganizationActivity'';';

-- =====================================================
-- Rollback Instructions
-- =====================================================
-- To remove these indexes:
-- DROP INDEX IF EXISTS idx_domain_events_workflow_id;
-- DROP INDEX IF EXISTS idx_domain_events_workflow_run_id;
-- DROP INDEX IF EXISTS idx_domain_events_workflow_type;
-- DROP INDEX IF EXISTS idx_domain_events_activity_id;
-- =====================================================

-- =====================================================
-- Query Examples for Developers
-- =====================================================

-- Example 1: Find all events for a workflow
-- SELECT id, event_type, event_data, created_at
-- FROM domain_events
-- WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
-- ORDER BY created_at ASC;

-- Example 2: Count events by type for a workflow
-- SELECT event_type, COUNT(*) as count
-- FROM domain_events
-- WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
-- GROUP BY event_type
-- ORDER BY count DESC;

-- Example 3: Find the initiating event for a workflow
-- SELECT id, event_type, event_data, created_at
-- FROM domain_events
-- WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
-- ORDER BY created_at ASC
-- LIMIT 1;

-- Example 4: Find workflows that failed (have events with processing_error)
-- SELECT DISTINCT event_metadata->>'workflow_id' as workflow_id,
--        COUNT(*) as error_count
-- FROM domain_events
-- WHERE processing_error IS NOT NULL
--   AND event_metadata->>'workflow_id' IS NOT NULL
-- GROUP BY event_metadata->>'workflow_id'
-- ORDER BY error_count DESC;

-- Example 5: Trace workflow lineage (find bootstrap event → workflow → all events)
-- WITH bootstrap_event AS (
--   SELECT event_metadata->>'workflow_id' as workflow_id
--   FROM domain_events
--   WHERE event_type = 'organization.bootstrap.initiated'
--     AND stream_id = 'some-org-id'
--   LIMIT 1
-- )
-- SELECT de.event_type, de.created_at, de.event_data
-- FROM domain_events de
-- JOIN bootstrap_event be ON de.event_metadata->>'workflow_id' = be.workflow_id
-- ORDER BY de.created_at ASC;

-- =====================================================
