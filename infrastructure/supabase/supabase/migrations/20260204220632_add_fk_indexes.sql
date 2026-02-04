-- =============================================================================
-- Migration: Add Missing Foreign Key Indexes
-- Purpose: Add indexes on foreign key columns to improve DELETE/UPDATE
--          performance on parent tables
-- Reference: Supabase advisor - "Unindexed Foreign Keys" info
-- =============================================================================

-- These indexes improve performance when:
-- - Deleting records from parent tables (cascading checks)
-- - Updating primary keys on parent tables
-- - Running JOIN queries against these columns

-- Note: CONCURRENTLY cannot be used within Supabase migrations (runs in pipeline).
-- For these small junction tables, regular CREATE INDEX is fine.

-- Index on contact_emails.email_id
-- Improves: DELETE FROM emails_projection, JOINs with emails_projection
CREATE INDEX IF NOT EXISTS idx_contact_emails_email_id
  ON contact_emails(email_id);

-- Index on organization_emails.email_id
-- Improves: DELETE FROM emails_projection, JOINs with emails_projection
CREATE INDEX IF NOT EXISTS idx_org_emails_email_id
  ON organization_emails(email_id);

-- Index on user_schedule_policies_projection.org_unit_id
-- Improves: DELETE FROM organization_units_projection, JOINs with OUs
CREATE INDEX IF NOT EXISTS idx_user_schedule_policies_org_unit
  ON user_schedule_policies_projection(org_unit_id);

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
