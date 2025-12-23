-- Enums for Provider Onboarding Enhancement
-- Partner type classification, contact/address/phone types
-- Part of Phase 1: Database Schema & Event Contracts

-- Partner Type Enum
-- Classifies provider_partner organizations by their relationship type
DO $$ BEGIN
  CREATE TYPE partner_type AS ENUM (
    'var',      -- Value-Added Reseller (gets subdomain, resells platform)
    'family',   -- Family/Community partner (stakeholder, no subdomain)
    'court',    -- Court system partner (stakeholder, no subdomain)
    'other'     -- Other partnership type (catch-all for non-standard partners)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE partner_type IS 'Classification of provider_partner organizations: VAR (reseller), family, court, other';

-- Contact Type Enum
-- Classifies contacts by their role/purpose
DO $$ BEGIN
  CREATE TYPE contact_type AS ENUM (
    'a4c_admin',    -- A4C administrative contact
    'billing',      -- Billing/financial contact
    'technical',    -- Technical support contact
    'emergency',    -- Emergency contact
    'stakeholder'   -- General stakeholder contact
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE contact_type IS 'Classification of contact persons: a4c_admin, billing, technical, emergency, stakeholder';

-- Address Type Enum
-- Classifies addresses by their purpose
DO $$ BEGIN
  CREATE TYPE address_type AS ENUM (
    'physical',  -- Physical business location
    'mailing',   -- Mailing address (may differ from physical)
    'billing'    -- Billing address
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE address_type IS 'Classification of addresses: physical, mailing, billing';

-- Phone Type Enum
-- Classifies phone numbers by their purpose
DO $$ BEGIN
  CREATE TYPE phone_type AS ENUM (
    'mobile',    -- Mobile/cell phone
    'office',    -- Office landline
    'fax',       -- Fax number
    'emergency'  -- Emergency contact number
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE phone_type IS 'Classification of phone numbers: mobile, office, fax, emergency';
