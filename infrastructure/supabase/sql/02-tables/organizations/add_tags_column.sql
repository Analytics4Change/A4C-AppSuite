-- ========================================
-- Add Tags Column to Organizations Projection
-- ========================================
-- Migration: Add development entity tracking to existing table
--
-- Purpose: Track development/test entities for cleanup
-- Usage: Temporal workflows tag entities created in development mode
-- Cleanup: Scripts query tags array to find and delete test data
-- ========================================

-- Add tags column if it doesn't already exist
ALTER TABLE organizations_projection
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Create GIN index for efficient array queries
-- GIN index supports: @> (contains), && (overlaps), <@ (contained by)
CREATE INDEX IF NOT EXISTS idx_organizations_projection_tags
ON organizations_projection USING GIN(tags);

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON COLUMN organizations_projection.tags IS
'Development entity tracking tags. Enables cleanup scripts to identify test data. Example tags: ["development", "test", "mode:development"]. Query with: WHERE tags @> ARRAY[''development'']';

-- ========================================
-- Example Queries
-- ========================================
-- Find all development organizations:
-- SELECT * FROM organizations_projection WHERE tags @> ARRAY['development'];
--
-- Find organizations with any of multiple tags:
-- SELECT * FROM organizations_projection WHERE tags && ARRAY['development', 'test'];
--
-- Count development entities:
-- SELECT COUNT(*) FROM organizations_projection WHERE tags @> ARRAY['development'];
