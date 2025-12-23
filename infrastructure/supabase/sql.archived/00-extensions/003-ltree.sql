-- Enable ltree extension for hierarchical data structures
-- Required for organization hierarchy management with PostgreSQL ltree
--
-- Security: Installing in 'extensions' schema prevents exposure through Supabase APIs
-- and resolves security advisor warning 0014_extension_in_public
--
-- Note: All functions use SET search_path = public, extensions, pg_temp;
-- so ltree types and operators are automatically available without schema qualification

-- Create extensions schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS extensions;

-- Create extension in extensions schema (for new installations)
CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA extensions;

-- Move existing ltree extension from public to extensions schema (idempotent)
-- This handles the case where ltree was previously installed in public schema
DO $$
BEGIN
  -- Check if ltree is in public schema and move it
  IF EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON e.extnamespace = n.oid
    WHERE e.extname = 'ltree' AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION ltree SET SCHEMA extensions;
    RAISE NOTICE 'Moved ltree extension from public to extensions schema';
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON EXTENSION ltree IS 'Hierarchical tree-like data type for organization paths and permission scoping';