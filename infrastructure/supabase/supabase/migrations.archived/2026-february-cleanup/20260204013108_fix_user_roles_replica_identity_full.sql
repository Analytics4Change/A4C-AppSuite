-- =============================================================================
-- Migration: Fix replica identity for user_roles_projection
-- Purpose: Allow DELETE operations through Supabase Realtime replication
-- Issue: "cannot delete from table because it does not have a replica identity"
-- =============================================================================

-- The user_roles_projection table was added to supabase_realtime publication
-- (migration 20260126173806) but without proper replica identity for DELETEs.
--
-- The table has a UNIQUE constraint (not PRIMARY KEY) on (user_id, role_id, organization_id).
-- Since organization_id is nullable, we cannot use REPLICA IDENTITY USING INDEX.
--
-- Solution: Use REPLICA IDENTITY FULL - this sends the entire row in the
-- replication stream for DELETE operations. While it uses more bandwidth,
-- it's reliable and works with any table structure.

ALTER TABLE public.user_roles_projection REPLICA IDENTITY FULL;
