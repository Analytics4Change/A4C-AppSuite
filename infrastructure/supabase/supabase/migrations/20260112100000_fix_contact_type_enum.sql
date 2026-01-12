-- Migration: Fix contact_type enum mismatch
-- Date: 2026-01-12
-- Description: Add 'administrative' to contact_type enum to align with AsyncAPI schema.
--              AsyncAPI is the source of truth. The PostgreSQL enum had 'a4c_admin'
--              but the typed events emit 'administrative'.
-- Related: org-type-column-bug also blocks event processing

-- Step 1: Add the new enum value
-- Note: ALTER TYPE ADD VALUE cannot run inside a transaction block.
-- Supabase handles this by running each migration statement individually.
ALTER TYPE contact_type ADD VALUE IF NOT EXISTS 'administrative';

-- Step 2: Migration note
-- The old 'a4c_admin' value will be kept for now to avoid breaking existing data.
-- After confirming no usage, it can be removed in a future migration.
-- UPDATE contacts_projection SET type = 'administrative' WHERE type = 'a4c_admin';
-- (commented out until we verify existing data)
