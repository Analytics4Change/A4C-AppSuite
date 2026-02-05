-- =============================================================================
-- Migration: Consolidate workflow_queue_projection RLS Policies
-- Purpose: Replace 4 separate service_role policies with 1 FOR ALL policy
-- Reference: Supabase advisor - "Multiple Permissive Policies" warning
-- =============================================================================

-- Drop the 4 separate policies
DROP POLICY IF EXISTS "workflow_queue_projection_service_role_delete" ON workflow_queue_projection;
DROP POLICY IF EXISTS "workflow_queue_projection_service_role_insert" ON workflow_queue_projection;
DROP POLICY IF EXISTS "workflow_queue_projection_service_role_select" ON workflow_queue_projection;
DROP POLICY IF EXISTS "workflow_queue_projection_service_role_update" ON workflow_queue_projection;

-- Create single consolidated policy
CREATE POLICY "workflow_queue_service_role_all" ON workflow_queue_projection
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
