-- Junction Tables Soft-Delete Support
-- Provider Onboarding Enhancement - Phase 4.1
-- Adds deleted_at column to junction tables for workflow saga compensation
-- Rationale: Prevents orphaned junction records during workflow rollback

-- ==============================================================================
-- Problem
-- ==============================================================================
-- Saga compensation activities emitted events but didn't modify junction tables
-- Event processors soft-delete projections but not junctions
-- Result: Orphaned junction records after workflow compensation

-- ==============================================================================
-- Solution
-- ==============================================================================
-- 1. Add deleted_at TIMESTAMPTZ column (NULL = active, NOT NULL = deleted)
-- 2. Add partial indexes on deleted_at (performance for deleted records queries)
-- 3. Create soft-delete RPC functions for workflow activities

-- ==============================================================================
-- Organization Junction Tables
-- ==============================================================================

-- Organization ↔ Contact Junction
ALTER TABLE organization_contacts
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_org_contacts_deleted_at
  ON organization_contacts(deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN organization_contacts.deleted_at IS 'Soft-delete timestamp (NULL = active, NOT NULL = deleted)';

-- Organization ↔ Address Junction
ALTER TABLE organization_addresses
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_org_addresses_deleted_at
  ON organization_addresses(deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN organization_addresses.deleted_at IS 'Soft-delete timestamp (NULL = active, NOT NULL = deleted)';

-- Organization ↔ Phone Junction
ALTER TABLE organization_phones
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_org_phones_deleted_at
  ON organization_phones(deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN organization_phones.deleted_at IS 'Soft-delete timestamp (NULL = active, NOT NULL = deleted)';

-- ==============================================================================
-- Notes
-- ==============================================================================
-- - Idempotent: IF NOT EXISTS ensures safe re-execution
-- - Partial indexes: Only index deleted records (performance)
-- - No triggers: Workflow activities call RPC functions directly
-- - RPC functions: See 03-functions/workflows/004-junction-soft-delete.sql
