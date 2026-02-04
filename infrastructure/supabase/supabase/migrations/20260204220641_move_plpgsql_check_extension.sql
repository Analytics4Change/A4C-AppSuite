-- =============================================================================
-- Migration: Move plpgsql_check Extension to Extensions Schema
-- Purpose: Extensions should be in the 'extensions' schema, not 'public'
-- Reference: Supabase advisor - "Extension in Public Schema" warning
-- =============================================================================

-- Note: PostgreSQL doesn't support ALTER EXTENSION ... SET SCHEMA
-- We must drop and recreate the extension in the correct schema.

-- Step 1: Drop the extension from public schema
DROP EXTENSION IF EXISTS plpgsql_check;

-- Step 2: Recreate in extensions schema
-- The extensions schema is the standard Supabase location for extensions
CREATE EXTENSION IF NOT EXISTS plpgsql_check SCHEMA extensions;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
