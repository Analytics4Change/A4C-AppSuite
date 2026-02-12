-- =============================================================================
-- Migration: Add Primary Keys to Junction Tables
-- Purpose: Convert UNIQUE constraints to PRIMARY KEY constraints for better
--          query performance and ORM compatibility
-- Reference: Supabase advisor - "No Primary Key" info
-- =============================================================================

-- =============================================================================
-- STEP 1: Create UUIDv7 Generator Function
-- =============================================================================
-- UUIDv7 (RFC 9562) provides time-ordered UUIDs for better B-tree index locality.
-- Benefits over random UUIDv4:
--   - 50% faster index operations (no page splits from random insertions)
--   - Monotonically increasing (improves write performance)
--   - Still globally unique
--
-- Note: Native UUIDv7 will be in PostgreSQL 18. This is for PostgreSQL 17.

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  unix_ts_ms BIGINT;
  buffer BYTEA;
BEGIN
  -- Get current timestamp in milliseconds since Unix epoch
  unix_ts_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;

  -- Build 16-byte buffer: 6 bytes timestamp + 2 bytes ver/rand_a + 8 bytes rand_b
  buffer := E'\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000\\000'::bytea;

  -- Set timestamp bytes (48 bits = 6 bytes, big-endian)
  -- Note: Apply mask to BIGINT first, then cast to INT to avoid overflow
  buffer := set_byte(buffer, 0, ((unix_ts_ms >> 40) & 255)::int);
  buffer := set_byte(buffer, 1, ((unix_ts_ms >> 32) & 255)::int);
  buffer := set_byte(buffer, 2, ((unix_ts_ms >> 24) & 255)::int);
  buffer := set_byte(buffer, 3, ((unix_ts_ms >> 16) & 255)::int);
  buffer := set_byte(buffer, 4, ((unix_ts_ms >> 8) & 255)::int);
  buffer := set_byte(buffer, 5, (unix_ts_ms & 255)::int);

  -- Fill remaining 10 bytes with cryptographically random data
  buffer := overlay(buffer PLACING gen_random_bytes(10) FROM 7);

  -- Set version nibble to 7 (0111) in byte 6 (bits 4-7)
  buffer := set_byte(buffer, 6, (get_byte(buffer, 6) & 15) | 112);

  -- Set variant to 10xx in byte 8 (bits 6-7)
  buffer := set_byte(buffer, 8, (get_byte(buffer, 8) & 63) | 128);

  -- Convert to UUID string format
  RETURN encode(buffer, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION uuid_generate_v7() IS 'Generates RFC 9562 UUIDv7 - time-ordered UUID with millisecond precision';

-- =============================================================================
-- STEP 2: Convert Simple Junction Tables to Composite PKs
-- =============================================================================
-- For tables with simple (col_a, col_b) UNIQUE constraints,
-- convert to PRIMARY KEY for better performance.

-- contact_phones: (contact_id, phone_id) -> PK
ALTER TABLE contact_phones
  DROP CONSTRAINT IF EXISTS contact_phones_contact_id_phone_id_key;
ALTER TABLE contact_phones
  ADD PRIMARY KEY (contact_id, phone_id);

-- contact_addresses: (contact_id, address_id) -> PK
ALTER TABLE contact_addresses
  DROP CONSTRAINT IF EXISTS contact_addresses_contact_id_address_id_key;
ALTER TABLE contact_addresses
  ADD PRIMARY KEY (contact_id, address_id);

-- phone_addresses: (phone_id, address_id) -> PK
ALTER TABLE phone_addresses
  DROP CONSTRAINT IF EXISTS phone_addresses_phone_id_address_id_key;
ALTER TABLE phone_addresses
  ADD PRIMARY KEY (phone_id, address_id);

-- organization_contacts: (organization_id, contact_id) -> PK
ALTER TABLE organization_contacts
  DROP CONSTRAINT IF EXISTS organization_contacts_organization_id_contact_id_key;
ALTER TABLE organization_contacts
  ADD PRIMARY KEY (organization_id, contact_id);

-- organization_addresses: (organization_id, address_id) -> PK
ALTER TABLE organization_addresses
  DROP CONSTRAINT IF EXISTS organization_addresses_organization_id_address_id_key;
ALTER TABLE organization_addresses
  ADD PRIMARY KEY (organization_id, address_id);

-- organization_phones: (organization_id, phone_id) -> PK
ALTER TABLE organization_phones
  DROP CONSTRAINT IF EXISTS organization_phones_organization_id_phone_id_key;
ALTER TABLE organization_phones
  ADD PRIMARY KEY (organization_id, phone_id);

-- =============================================================================
-- STEP 3: Add Surrogate PK to user_roles_projection
-- =============================================================================
-- user_roles_projection has UNIQUE NULLS NOT DISTINCT (user_id, role_id, organization_id)
-- Because organization_id can be NULL (for super_admin), we can't use composite PK.
-- Solution: Add surrogate UUID column using UUIDv7 for time-ordering.

-- Add the id column with UUIDv7 default
ALTER TABLE user_roles_projection
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v7();

-- Backfill any NULL ids (for existing rows)
UPDATE user_roles_projection
SET id = uuid_generate_v7()
WHERE id IS NULL;

-- Make id NOT NULL and add as PK
ALTER TABLE user_roles_projection
  ALTER COLUMN id SET NOT NULL;

-- Add primary key (idempotent - check if exists first)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_roles_projection'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE user_roles_projection ADD PRIMARY KEY (id);
  END IF;
END $$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
