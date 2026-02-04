-- =============================================================================
-- Migration: Revert plpgsql_check Extension to Public Schema
-- Purpose: The Supabase CLI's db lint command expects plpgsql_check_function
--          to be in the public schema. Moving it to extensions breaks CI/CD.
-- Note: This is an acceptable exception to the "Extension in Public Schema"
--       advisory because plpgsql_check is specifically used by the CLI.
-- =============================================================================

-- Move extension back to public schema
DROP EXTENSION IF EXISTS plpgsql_check;
CREATE EXTENSION IF NOT EXISTS plpgsql_check SCHEMA public;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
