-- =====================================================================
-- WORKFLOW QUEUE PROJECTION TRIGGER
-- =====================================================================
-- Purpose: Process workflow queue events and update projection
-- Pattern: Event-driven projection (strict CQRS)
-- Source: domain_events table
-- Target: workflow_queue_projection table
--
-- Events Processed:
-- 1. workflow.queue.pending   - Create new queue entry (status=pending)
-- 2. workflow.queue.claimed   - Update to processing (worker claimed)
-- 3. workflow.queue.completed - Update to completed (workflow succeeded)
-- 4. workflow.queue.failed    - Update to failed (workflow error)
--
-- Idempotency:
-- - Uses UPSERT (INSERT ... ON CONFLICT) for all operations
-- - Duplicate events are handled gracefully
-- - Safe to replay events
--
-- Related Files:
-- - Table: infrastructure/supabase/sql/02-tables/workflow_queue_projection/table.sql
-- - Contracts: infrastructure/supabase/contracts/organization-bootstrap-events.yaml
-- =====================================================================

-- Create trigger function to update workflow queue projection (idempotent)
CREATE OR REPLACE FUNCTION update_workflow_queue_projection_from_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Process workflow.queue.pending event
    -- Creates new queue entry with status='pending'
    IF NEW.event_type = 'workflow.queue.pending' THEN
        INSERT INTO workflow_queue_projection (
            event_id,
            event_type,
            event_data,
            stream_id,
            stream_type,
            status,
            created_at,
            updated_at
        )
        VALUES (
            (NEW.event_data->>'event_id')::UUID,  -- Original bootstrap.initiated event ID
            NEW.event_data->>'event_type',         -- Original event type
            (NEW.event_data->'event_data')::JSONB, -- Original event payload
            NEW.stream_id,
            NEW.stream_type,
            'pending',
            NOW(),
            NOW()
        )
        ON CONFLICT (event_id) DO NOTHING;  -- Idempotent: skip if already exists

    -- Process workflow.queue.claimed event
    -- Updates status to 'processing' and records worker info
    ELSIF NEW.event_type = 'workflow.queue.claimed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'processing',
            worker_id = NEW.event_data->>'worker_id',
            claimed_at = (NEW.event_data->>'claimed_at')::TIMESTAMPTZ,
            workflow_id = NEW.event_data->>'workflow_id',
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'pending';  -- Only update if still pending (prevent race conditions)

    -- Process workflow.queue.completed event
    -- Updates status to 'completed' and records completion info
    ELSIF NEW.event_type = 'workflow.queue.completed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'completed',
            completed_at = (NEW.event_data->>'completed_at')::TIMESTAMPTZ,
            workflow_run_id = NEW.event_data->>'workflow_run_id',
            result = (NEW.event_data->'result')::JSONB,
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    -- Process workflow.queue.failed event
    -- Updates status to 'failed' and records error info
    ELSIF NEW.event_type = 'workflow.queue.failed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'failed',
            failed_at = (NEW.event_data->>'failed_at')::TIMESTAMPTZ,
            error_message = NEW.event_data->>'error_message',
            error_stack = NEW.event_data->>'error_stack',
            retry_count = COALESCE((NEW.event_data->>'retry_count')::INTEGER, 0),
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS update_workflow_queue_projection_trigger
    ON domain_events;

-- Create trigger on domain_events INSERT (idempotent)
CREATE TRIGGER update_workflow_queue_projection_trigger
    AFTER INSERT ON domain_events
    FOR EACH ROW
    WHEN (NEW.event_type IN (
        'workflow.queue.pending',
        'workflow.queue.claimed',
        'workflow.queue.completed',
        'workflow.queue.failed'
    ))
    EXECUTE FUNCTION update_workflow_queue_projection_from_event();

-- Add comment for documentation
COMMENT ON FUNCTION update_workflow_queue_projection_from_event() IS
    'Processes workflow queue events and updates workflow_queue_projection. '
    'Implements strict CQRS: all projection updates happen via events. '
    'Idempotent: safe to replay events.';
