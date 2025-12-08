-- ============================================================================
-- A4C AppSuite - Consolidated Database Schema
-- ============================================================================
-- 
-- This file contains the complete database schema for the A4C platform.
-- All statements are IDEMPOTENT - safe to run multiple times.
--
-- Deployment: GitHub Actions via psql (not Supabase CLI migrations)
-- See: .github/workflows/supabase-deploy.yml
--
-- Generated: $(date -Iseconds)
-- 
-- PATTERNS USED:
--   - CREATE TABLE IF NOT EXISTS (tables)
--   - CREATE INDEX IF NOT EXISTS (indexes)
--   - CREATE OR REPLACE FUNCTION (functions)
--   - DROP TRIGGER IF EXISTS + CREATE TRIGGER (triggers)
--   - DROP POLICY IF EXISTS + CREATE POLICY (RLS policies)
--
-- NEVER drops tables with data. Safe for production use.
-- ============================================================================

BEGIN;



-- ============================================================================
-- SECTION: 00-extensions
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/00-extensions/001-uuid-ossp.sql
-- ----------------------------------------------------------------------------

-- Enable UUID generation extension
-- Required for gen_random_uuid() function
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Source: sql/00-extensions/002-pgcrypto.sql
-- ----------------------------------------------------------------------------

-- Enable pgcrypto extension
-- Required for encryption and hashing functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Source: sql/00-extensions/003-ltree.sql
-- ----------------------------------------------------------------------------

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

-- ============================================================================
-- SECTION: 01-events
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/01-events/001-domain-events-table.sql
-- ----------------------------------------------------------------------------

-- Domain Events Table
-- This is the single source of truth for all system changes
-- Events are immutable and append-only
CREATE TABLE IF NOT EXISTS domain_events (
  -- Event identification
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number BIGSERIAL UNIQUE NOT NULL, -- Global ordering

  -- Stream identification (the aggregate/entity this event belongs to)
  stream_id UUID NOT NULL, -- The entity ID (client_id, medication_id, etc.)
  stream_type TEXT NOT NULL, -- Entity type ('client', 'medication', 'user', etc.)
  stream_version INTEGER NOT NULL, -- Version within this specific stream

  -- Event details
  event_type TEXT NOT NULL, -- 'client.admitted', 'medication.prescribed', etc.
  event_data JSONB NOT NULL, -- The actual event payload

  -- Event metadata (the "why" and context)
  event_metadata JSONB NOT NULL DEFAULT '{}', -- {
    -- user_id: who initiated this
    -- reason: why this happened
    -- correlation_id: trace related events
    -- causation_id: what caused this event
    -- ip_address: where from
    -- user_agent: what client
    -- approval_chain: who approved
    -- notes: additional context
  -- }

  -- Processing status
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMPTZ, -- When successfully projected to 3NF
  processing_error TEXT, -- Error if projection failed
  retry_count INTEGER DEFAULT 0,

  -- Constraints
  CONSTRAINT unique_stream_version UNIQUE(stream_id, stream_type, stream_version),
  CONSTRAINT valid_event_type CHECK (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'), -- format: 'domain.action' or 'domain.subdomain.action'
  CONSTRAINT event_data_not_empty CHECK (jsonb_typeof(event_data) = 'object')
);

-- Indexes for performance (idempotent)
CREATE INDEX IF NOT EXISTS idx_domain_events_stream ON domain_events(stream_id, stream_type);
CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(event_type);
CREATE INDEX IF NOT EXISTS idx_domain_events_created ON domain_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_unprocessed ON domain_events(processed_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_domain_events_correlation ON domain_events((event_metadata->>'correlation_id'))
  WHERE event_metadata ? 'correlation_id';
CREATE INDEX IF NOT EXISTS idx_domain_events_user ON domain_events((event_metadata->>'user_id'))
  WHERE event_metadata ? 'user_id';

-- Comments for documentation
COMMENT ON TABLE domain_events IS 'Event store - single source of truth for all system changes';
COMMENT ON COLUMN domain_events.stream_id IS 'The aggregate/entity ID this event belongs to';
COMMENT ON COLUMN domain_events.stream_type IS 'The type of entity (client, medication, etc.)';
COMMENT ON COLUMN domain_events.stream_version IS 'Version number for this specific entity stream';
COMMENT ON COLUMN domain_events.event_type IS 'Event type in format: domain.action (e.g., client.admitted) or domain.subdomain.action (e.g., organization.bootstrap.initiated)';
COMMENT ON COLUMN domain_events.event_data IS 'The actual event payload with all data needed to project';
COMMENT ON COLUMN domain_events.event_metadata IS 'Context including user, reason, approvals - the WHY';

-- ----------------------------------------------------------------------------
-- Source: sql/01-events/002-domain-events-indexes.sql
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Domain Events Additional Indexes
-- ============================================================================
-- Purpose: Performance indexes for domain_events table queries
-- Created: 2025-11-19
--
-- This file contains additional indexes beyond the core table definition.
-- All indexes use IF NOT EXISTS for idempotency.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GIN Index for Tag-Based Queries
-- ----------------------------------------------------------------------------
-- Supports efficient cleanup of test/development data by metadata tags.
--
-- Tag Format Examples:
--   - 'development'           : Flag indicating dev environment
--   - 'mode:test'             : Workflow mode
--   - 'created:2025-11-19'    : Date created
--   - 'batch:phase4-verify'   : Batch ID for atomic cleanup
--
-- Query Pattern:
--   SELECT * FROM domain_events
--   WHERE event_metadata->'tags' ? 'development'
--     AND event_metadata->'tags' ? 'batch:xyz';
--
-- Cleanup Pattern:
--   DELETE FROM domain_events
--   WHERE event_metadata->'tags' ? 'development'
--     AND event_metadata->'tags' ? format('batch:%s', $1);
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_domain_events_tags
ON domain_events USING GIN ((event_metadata->'tags'))
WHERE event_metadata ? 'tags';

-- Note: Core indexes (stream, type, created, unprocessed, correlation, user)
-- are defined in 001-domain-events-table.sql


-- ----------------------------------------------------------------------------
-- Source: sql/01-events/002-event-types-table.sql
-- ----------------------------------------------------------------------------

-- Event Types Catalog
-- Documents all valid event types in the system
CREATE TABLE IF NOT EXISTS event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identification
  event_type TEXT UNIQUE NOT NULL, -- 'client.admitted', 'medication.prescribed'
  stream_type TEXT NOT NULL, -- Which entity type this applies to

  -- Event schema
  event_schema JSONB NOT NULL, -- JSON Schema for validating event_data
  metadata_schema JSONB, -- JSON Schema for validating event_metadata

  -- Documentation
  description TEXT NOT NULL,
  example_data JSONB,
  example_metadata JSONB,

  -- Configuration
  is_active BOOLEAN DEFAULT true,
  requires_approval BOOLEAN DEFAULT false,
  allowed_roles TEXT[], -- Which roles can emit this event

  -- Projection configuration
  projection_function TEXT, -- Name of function that processes this event
  projection_tables TEXT[], -- Which tables this event affects

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID  -- FK constraint deferred to avoid circular dependency (added in 02-tables/users/add-event-types-fk.sql)
);

-- Insert core event types
INSERT INTO event_types (event_type, stream_type, description, event_schema, projection_tables) VALUES
-- Client events
('client.registered', 'client', 'New client registered in system',
  '{"type": "object", "required": ["first_name", "last_name", "date_of_birth", "organization_id"]}',
  ARRAY['clients']),

('client.admitted', 'client', 'Client admitted to facility',
  '{"type": "object", "required": ["admission_date", "facility_id", "reason"]}',
  ARRAY['clients']),

('client.information_updated', 'client', 'Client information modified',
  '{"type": "object", "properties": {"changes": {"type": "object"}}}',
  ARRAY['clients']),

('client.discharged', 'client', 'Client discharged from facility',
  '{"type": "object", "required": ["discharge_date", "discharge_reason"]}',
  ARRAY['clients']),

-- Medication events
('medication.added_to_formulary', 'medication', 'New medication added to formulary',
  '{"type": "object", "required": ["name", "generic_name", "organization_id"]}',
  ARRAY['medications']),

('medication.prescribed', 'medication_history', 'Medication prescribed to client',
  '{"type": "object", "required": ["client_id", "medication_id", "dosage", "frequency", "start_date"]}',
  ARRAY['medication_history']),

('medication.administered', 'dosage', 'Medication dose administered',
  '{"type": "object", "required": ["medication_history_id", "administered_at", "administered_by", "amount"]}',
  ARRAY['dosage_info']),

('medication.skipped', 'dosage', 'Medication dose skipped',
  '{"type": "object", "required": ["medication_history_id", "scheduled_time", "skip_reason"]}',
  ARRAY['dosage_info']),

('medication.discontinued', 'medication_history', 'Medication discontinued',
  '{"type": "object", "required": ["medication_history_id", "discontinue_date", "reason"]}',
  ARRAY['medication_history']),

-- User events
('user.synced_from_auth', 'user', 'User synchronized from Supabase Auth',
  '{"type": "object", "required": ["auth_user_id", "email"]}',
  ARRAY['users']),

('user.organization_switched', 'user', 'User switched organization context',
  '{"type": "object", "required": ["user_id", "from_organization_id", "to_organization_id"]}',
  ARRAY['users', 'audit_log'])
ON CONFLICT (event_type) DO NOTHING;

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_event_types_stream ON event_types(stream_type);
CREATE INDEX IF NOT EXISTS idx_event_types_active ON event_types(is_active) WHERE is_active = true;

-- Comment
COMMENT ON TABLE event_types IS 'Catalog of all valid event types with schemas and processing rules';

-- ----------------------------------------------------------------------------
-- Source: sql/01-events/003-subdomain-status-enum.sql
-- ----------------------------------------------------------------------------

-- Subdomain provisioning status tracking
-- Used by organizations_projection.subdomain_status column
-- Tracks lifecycle: pending → dns_created → verifying → verified (or failed)

DO $$ BEGIN
  CREATE TYPE subdomain_status AS ENUM (
    'pending',      -- Subdomain provisioning initiated but not started
    'dns_created',  -- Cloudflare DNS record created successfully
    'verifying',    -- DNS verification in progress (polling)
    'verified',     -- DNS verified and subdomain active
    'failed'        -- Provisioning or verification failed
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE subdomain_status IS
  'Tracks subdomain provisioning lifecycle for organizations. Workflow: pending → dns_created → verifying → verified (or failed at any stage)';


-- ============================================================================
-- SECTION: 02-tables
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/indexes/idx_api_audit_log_client_ip.sql
-- ----------------------------------------------------------------------------

-- Index on client_ip
CREATE INDEX IF NOT EXISTS idx_api_audit_log_client_ip ON api_audit_log(client_ip);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/indexes/idx_api_audit_log_method_path.sql
-- ----------------------------------------------------------------------------

-- Index on request_method, request_path
CREATE INDEX IF NOT EXISTS idx_api_audit_log_method_path ON api_audit_log(request_method, request_path);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/indexes/idx_api_audit_log_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_organization ON api_audit_log(organization_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/indexes/idx_api_audit_log_request_id.sql
-- ----------------------------------------------------------------------------

-- Index on request_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_request_id ON api_audit_log(request_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/indexes/idx_api_audit_log_status.sql
-- ----------------------------------------------------------------------------

-- Index on response_status_code
CREATE INDEX IF NOT EXISTS idx_api_audit_log_status ON api_audit_log(response_status_code);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/indexes/idx_api_audit_log_timestamp.sql
-- ----------------------------------------------------------------------------

-- Index on request_timestamp DESC
CREATE INDEX IF NOT EXISTS idx_api_audit_log_timestamp ON api_audit_log(request_timestamp DESC);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/indexes/idx_api_audit_log_user.sql
-- ----------------------------------------------------------------------------

-- Index on auth_user_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_user ON api_audit_log(auth_user_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/api_audit_log/table.sql
-- ----------------------------------------------------------------------------

-- Api Audit Log Table
-- REST API specific audit logging with performance metrics
CREATE TABLE IF NOT EXISTS api_audit_log (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,

  -- API Request
  request_id TEXT UNIQUE NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  request_query_params JSONB,
  request_headers JSONB,
  request_body JSONB,
  request_size_bytes INTEGER,

  -- API Response
  response_timestamp TIMESTAMPTZ,
  response_status_code INTEGER,
  response_headers JSONB,
  response_body JSONB,
  response_size_bytes INTEGER,
  response_time_ms INTEGER,

  -- Authentication
  auth_method TEXT, -- bearer_token, api_key, oauth, etc.
  auth_user_id UUID,
  auth_organization_id UUID,
  auth_scopes TEXT[],

  -- Rate Limiting
  rate_limit_tier TEXT,
  rate_limit_remaining INTEGER,
  rate_limit_reset_at TIMESTAMPTZ,

  -- Error Information
  error_code TEXT,
  error_message TEXT,
  error_details JSONB,

  -- Performance Metrics
  database_queries_count INTEGER,
  database_time_ms INTEGER,
  cache_hits INTEGER,
  cache_misses INTEGER,

  -- Client Information
  client_ip INET,
  client_user_agent TEXT,
  client_version TEXT,
  client_sdk TEXT,

  -- HATEOAS Links (if applicable)
  hateoas_links JSONB,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE api_audit_log IS 'REST API specific audit logging with performance metrics';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/audit_log/indexes/idx_audit_log_created_at.sql
-- ----------------------------------------------------------------------------

-- Index on created_at DESC
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/audit_log/indexes/idx_audit_log_event_type.sql
-- ----------------------------------------------------------------------------

-- Index on event_type
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/audit_log/indexes/idx_audit_log_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_audit_log_organization ON audit_log(organization_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/audit_log/indexes/idx_audit_log_resource.sql
-- ----------------------------------------------------------------------------

-- Index on resource_type, resource_id
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/audit_log/indexes/idx_audit_log_session.sql
-- ----------------------------------------------------------------------------

-- Ensure session_id column exists (for schema drift in production)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Index on session_id
CREATE INDEX IF NOT EXISTS idx_audit_log_session ON audit_log(session_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/audit_log/indexes/idx_audit_log_user.sql
-- ----------------------------------------------------------------------------

-- Index on user_id
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/audit_log/table.sql
-- ----------------------------------------------------------------------------

-- Audit Log Table
-- CQRS projection for audit trail - General system audit trail for all data changes
CREATE TABLE IF NOT EXISTS audit_log (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,

  -- Event Information
  event_type TEXT NOT NULL, -- create, update, delete, access, export, print, etc.
  event_category TEXT NOT NULL, -- data_change, authentication, authorization, system
  event_name TEXT NOT NULL,
  event_description TEXT,

  -- Actor Information
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  user_roles TEXT[],
  impersonated_by UUID,

  -- Resource Information
  resource_type TEXT, -- table name or resource type
  resource_id UUID,
  resource_name TEXT,

  -- Change Details
  operation TEXT, -- INSERT, UPDATE, DELETE, SELECT
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],

  -- Request Context
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  request_id TEXT,
  request_method TEXT, -- GET, POST, PUT, DELETE, etc.
  request_path TEXT,

  -- Response
  response_status INTEGER,
  error_message TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE audit_log IS 'CQRS projection for audit trail - General system audit trail for all data changes';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/clients/indexes/idx_clients_dob.sql
-- ----------------------------------------------------------------------------

-- Index on date_of_birth
CREATE INDEX IF NOT EXISTS idx_clients_dob ON clients(date_of_birth);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/clients/indexes/idx_clients_name.sql
-- ----------------------------------------------------------------------------

-- Index on last_name, first_name
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(last_name, first_name);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/clients/indexes/idx_clients_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_clients_organization ON clients(organization_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/clients/indexes/idx_clients_status.sql
-- ----------------------------------------------------------------------------

-- Index on status
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/clients/table.sql
-- ----------------------------------------------------------------------------

-- Clients Table
-- Patient/client records with full medical information
CREATE TABLE IF NOT EXISTS clients (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,

  -- Basic Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),

  -- Contact Information
  email TEXT,
  phone TEXT,
  address JSONB DEFAULT '{}', -- {street, city, state, zip_code, country}

  -- Emergency Contact
  emergency_contact JSONB DEFAULT '{}', -- {name, relationship, phone, alternate_phone}

  -- Medical Information
  allergies TEXT[],
  medical_conditions TEXT[],
  blood_type TEXT,

  -- Administrative
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  admission_date DATE,
  discharge_date DATE,
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE clients IS 'Patient/client records with full medical information';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/dosage_info/indexes/idx_dosage_info_administered_by.sql
-- ----------------------------------------------------------------------------

-- Ensure administered_by column exists (for schema drift in production)
ALTER TABLE dosage_info ADD COLUMN IF NOT EXISTS administered_by UUID;

-- Index on administered_by
CREATE INDEX IF NOT EXISTS idx_dosage_info_administered_by ON dosage_info(administered_by);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/dosage_info/indexes/idx_dosage_info_client.sql
-- ----------------------------------------------------------------------------

-- Index on client_id
CREATE INDEX IF NOT EXISTS idx_dosage_info_client ON dosage_info(client_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/dosage_info/indexes/idx_dosage_info_medication_history.sql
-- ----------------------------------------------------------------------------

-- Index on medication_history_id
CREATE INDEX IF NOT EXISTS idx_dosage_info_medication_history ON dosage_info(medication_history_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/dosage_info/indexes/idx_dosage_info_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_dosage_info_organization ON dosage_info(organization_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/dosage_info/indexes/idx_dosage_info_scheduled_datetime.sql
-- ----------------------------------------------------------------------------

-- Index on scheduled_datetime
CREATE INDEX IF NOT EXISTS idx_dosage_info_scheduled_datetime ON dosage_info(scheduled_datetime);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/dosage_info/indexes/idx_dosage_info_status.sql
-- ----------------------------------------------------------------------------

-- Index on status
CREATE INDEX IF NOT EXISTS idx_dosage_info_status ON dosage_info(status);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/dosage_info/table.sql
-- ----------------------------------------------------------------------------

-- Dosage Info Table
-- Tracks actual medication administration events
CREATE TABLE IF NOT EXISTS dosage_info (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  medication_history_id UUID NOT NULL,
  client_id UUID NOT NULL,

  -- Administration Details
  scheduled_datetime TIMESTAMPTZ NOT NULL,
  administered_datetime TIMESTAMPTZ,
  administered_by UUID,

  -- Dosage
  scheduled_amount DECIMAL NOT NULL,
  administered_amount DECIMAL,
  unit TEXT NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'administered', 'skipped', 'refused', 'missed', 'late', 'early'
  )),

  -- Reasons and Notes
  skip_reason TEXT,
  refusal_reason TEXT,
  administration_notes TEXT,

  -- Vitals (if monitored)
  vitals_before JSONB DEFAULT '{}', -- {bp, hr, temp, etc.}
  vitals_after JSONB DEFAULT '{}',

  -- Side Effects
  side_effects_observed TEXT[],
  adverse_reaction BOOLEAN DEFAULT false,
  adverse_reaction_details TEXT,

  -- Verification
  verified_by UUID,
  verification_datetime TIMESTAMPTZ,

  -- Additional Data
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE dosage_info IS 'Tracks actual medication administration events';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/impersonation/001-impersonation_sessions_projection.sql
-- ----------------------------------------------------------------------------

-- Impersonation Sessions Projection Table
-- CQRS Projection for impersonation domain events
-- Source events: impersonation.started, impersonation.renewed, impersonation.ended
-- Stream type: 'impersonation'

CREATE TABLE IF NOT EXISTS impersonation_sessions_projection (
  -- Primary identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,

  -- Super Admin (the impersonator)
  super_admin_user_id UUID NOT NULL,
  super_admin_email TEXT NOT NULL,
  super_admin_name TEXT NOT NULL,
  super_admin_org_id UUID,  -- NULL for platform super_admin, UUID for org-scoped admin

  -- Target (the impersonated user)
  target_user_id UUID NOT NULL,
  target_email TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_org_id UUID NOT NULL,  -- Internal UUID of target organization
  target_org_name TEXT NOT NULL,
  target_org_type TEXT NOT NULL CHECK (target_org_type IN ('provider', 'provider_partner')),

  -- Justification
  justification_reason TEXT NOT NULL CHECK (justification_reason IN ('support_ticket', 'emergency', 'audit', 'training')),
  justification_reference_id TEXT,
  justification_notes TEXT,

  -- Session lifecycle
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  ended_reason TEXT CHECK (ended_reason IN ('manual_logout', 'timeout', 'renewal_declined', 'forced_by_admin')),
  ended_by_user_id UUID,  -- User ID if forced by another admin

  -- Session metrics
  duration_ms INTEGER NOT NULL,  -- Initial duration in milliseconds
  total_duration_ms INTEGER NOT NULL,  -- Total duration including renewals
  renewal_count INTEGER NOT NULL DEFAULT 0,
  actions_performed INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  ip_address TEXT,
  user_agent TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_super_admin
  ON impersonation_sessions_projection(super_admin_user_id);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_target_user
  ON impersonation_sessions_projection(target_user_id);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_target_org
  ON impersonation_sessions_projection(target_org_id);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_status
  ON impersonation_sessions_projection(status)
  WHERE status = 'active';  -- Partial index for active sessions only

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_started_at
  ON impersonation_sessions_projection(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_expires_at
  ON impersonation_sessions_projection(expires_at)
  WHERE status = 'active';  -- Partial index for session expiration checks

-- Session ID lookup (unique constraint provides implicit index)
-- Justification reason for compliance reports
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_justification
  ON impersonation_sessions_projection(justification_reason);

-- Composite index for org-scoped audit queries
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_org_started
  ON impersonation_sessions_projection(target_org_id, started_at DESC);

-- Ensure columns exist for schema drift in production
ALTER TABLE impersonation_sessions_projection ADD COLUMN IF NOT EXISTS total_duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE impersonation_sessions_projection ADD COLUMN IF NOT EXISTS renewal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE impersonation_sessions_projection ADD COLUMN IF NOT EXISTS actions_performed INTEGER NOT NULL DEFAULT 0;

-- Comments
COMMENT ON TABLE impersonation_sessions_projection IS 'CQRS projection of impersonation sessions. Source: domain_events with stream_type=impersonation. Tracks Super Admin impersonation sessions with full audit trail.';
COMMENT ON COLUMN impersonation_sessions_projection.session_id IS 'Unique session identifier (from event_data.session_id)';
COMMENT ON COLUMN impersonation_sessions_projection.status IS 'Session status: active (currently running), ended (manually terminated or declined renewal), expired (timed out)';
COMMENT ON COLUMN impersonation_sessions_projection.justification_reason IS 'Category of justification: support_ticket, emergency, audit, training';
COMMENT ON COLUMN impersonation_sessions_projection.renewal_count IS 'Number of times session was renewed (incremented by impersonation.renewed events)';
COMMENT ON COLUMN impersonation_sessions_projection.actions_performed IS 'Count of events emitted during session (updated by impersonation.ended event)';
COMMENT ON COLUMN impersonation_sessions_projection.total_duration_ms IS 'Total session duration including all renewals (milliseconds)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/invitations/invitations_projection.sql
-- ----------------------------------------------------------------------------

-- ========================================
-- Invitations Projection Table
-- ========================================
-- CQRS Read Model: Updated by UserInvited domain events from Temporal workflows
--
-- Purpose: Stores user invitation tokens and acceptance status
-- Event Source: UserInvited events (emitted by GenerateInvitationsActivity)
-- Updated By: process_user_invited_event() trigger
--
-- Naming Convention: All projection tables use _projection suffix for consistency
-- Related Tables: organizations_projection (foreign key)
-- Edge Functions: validate-invitation, accept-invitation query this table
-- ========================================

CREATE TABLE IF NOT EXISTS invitations_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Development entity tracking
  -- Tags: ['development', 'test', 'mode:development']
  -- Used by cleanup script to identify and delete test data
  tags TEXT[] DEFAULT '{}',

  CONSTRAINT chk_invitation_status CHECK (status IN ('pending', 'accepted', 'expired', 'deleted'))
);

-- ========================================
-- Indexes for Performance
-- ========================================

-- Primary lookup: Edge Functions validate token
CREATE INDEX IF NOT EXISTS idx_invitations_projection_token
ON invitations_projection(token);

-- Query invitations by organization
CREATE INDEX IF NOT EXISTS idx_invitations_projection_org_email
ON invitations_projection(organization_id, email);

-- Query by status (find pending invitations)
CREATE INDEX IF NOT EXISTS idx_invitations_projection_status
ON invitations_projection(status);

-- Development entity cleanup (GIN index for array contains)
CREATE INDEX IF NOT EXISTS idx_invitations_projection_tags
ON invitations_projection USING GIN(tags);

-- ========================================
-- Row Level Security (RLS)
-- ========================================
-- Enable RLS for multi-tenant data isolation
ALTER TABLE invitations_projection ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see invitations for their organization
-- Note: Service role bypasses RLS, Edge Functions use service role
-- CREATE POLICY "Users can view their organization's invitations"
-- ON invitations_projection FOR SELECT
-- USING (organization_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::UUID);

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON TABLE invitations_projection IS
'CQRS projection of user invitations. Updated by UserInvited domain events from Temporal workflows. Queried by Edge Functions for invitation validation and acceptance.';

COMMENT ON COLUMN invitations_projection.invitation_id IS
'UUID from domain event (aggregate ID). Used for event correlation.';

COMMENT ON COLUMN invitations_projection.token IS
'256-bit cryptographically secure URL-safe base64 token. Used in invitation email link.';

COMMENT ON COLUMN invitations_projection.expires_at IS
'Invitation expiration timestamp (7 days from creation). Edge Functions check this.';

COMMENT ON COLUMN invitations_projection.tags IS
'Development entity tracking tags. Examples: ["development", "test", "mode:development"]. Used by cleanup script to identify and delete test data.';

COMMENT ON COLUMN invitations_projection.status IS
'Invitation lifecycle status: pending (initial), accepted (user accepted), expired (past expires_at), deleted (soft delete by cleanup script)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medication_history/indexes/idx_medication_history_client.sql
-- ----------------------------------------------------------------------------

-- Index on client_id
CREATE INDEX IF NOT EXISTS idx_medication_history_client ON medication_history(client_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medication_history/indexes/idx_medication_history_is_prn.sql
-- ----------------------------------------------------------------------------

-- Ensure is_prn column exists (for schema drift in production)
ALTER TABLE medication_history ADD COLUMN IF NOT EXISTS is_prn BOOLEAN DEFAULT false;
ALTER TABLE medication_history ADD COLUMN IF NOT EXISTS prn_reason TEXT;

-- Index on is_prn
CREATE INDEX IF NOT EXISTS idx_medication_history_is_prn ON medication_history(is_prn);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medication_history/indexes/idx_medication_history_medication.sql
-- ----------------------------------------------------------------------------

-- Index on medication_id
CREATE INDEX IF NOT EXISTS idx_medication_history_medication ON medication_history(medication_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medication_history/indexes/idx_medication_history_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_medication_history_organization ON medication_history(organization_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medication_history/indexes/idx_medication_history_prescription_date.sql
-- ----------------------------------------------------------------------------

-- Index on prescription_date
CREATE INDEX IF NOT EXISTS idx_medication_history_prescription_date ON medication_history(prescription_date);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medication_history/indexes/idx_medication_history_status.sql
-- ----------------------------------------------------------------------------

-- Index on status
CREATE INDEX IF NOT EXISTS idx_medication_history_status ON medication_history(status);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medication_history/table.sql
-- ----------------------------------------------------------------------------

-- Medication History Table
-- Tracks all medication prescriptions and administration history
CREATE TABLE IF NOT EXISTS medication_history (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  client_id UUID NOT NULL,
  medication_id UUID NOT NULL,

  -- Prescription Details
  prescription_date DATE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  discontinue_date DATE,
  discontinue_reason TEXT,

  -- Prescriber Information
  prescriber_name TEXT,
  prescriber_npi TEXT, -- National Provider Identifier
  prescriber_license TEXT,

  -- Dosage Information
  dosage_amount DECIMAL,
  dosage_unit TEXT,
  dosage_form TEXT, -- Broad category (Solid, Liquid, etc.)
  frequency TEXT, -- Can be comma-separated or JSON array
  timings TEXT[], -- Timing conditions (morning, evening, bedtime, etc.)
  food_conditions TEXT[], -- Food restrictions (with_food, without_food, etc.)
  special_restrictions TEXT[], -- Special restrictions
  route TEXT, -- oral, injection, topical, etc.
  instructions TEXT,

  -- PRN (As Needed) Information
  is_prn BOOLEAN DEFAULT false,
  prn_reason TEXT,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued', 'on_hold')),

  -- Tracking
  refills_authorized INTEGER,
  refills_used INTEGER DEFAULT 0,
  last_filled_date DATE,
  pharmacy_name TEXT,
  pharmacy_phone TEXT,
  rx_number TEXT, -- Prescription number

  -- Inventory Tracking
  inventory_quantity DECIMAL,
  inventory_unit TEXT,

  -- Clinical Notes
  notes TEXT,
  side_effects_reported TEXT[],
  effectiveness_rating INTEGER CHECK (effectiveness_rating BETWEEN 1 AND 5),

  -- Compliance
  compliance_percentage DECIMAL,
  missed_doses_count INTEGER DEFAULT 0,

  -- Additional Data
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE medication_history IS 'Tracks all medication prescriptions and administration history';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medications/indexes/idx_medications_generic_name.sql
-- ----------------------------------------------------------------------------

-- Index on generic_name
CREATE INDEX IF NOT EXISTS idx_medications_generic_name ON medications(generic_name);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medications/indexes/idx_medications_is_active.sql
-- ----------------------------------------------------------------------------

-- Index on is_active
CREATE INDEX IF NOT EXISTS idx_medications_is_active ON medications(is_active);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medications/indexes/idx_medications_is_controlled.sql
-- ----------------------------------------------------------------------------

-- Ensure controlled substance columns exist (for schema drift in production)
ALTER TABLE medications ADD COLUMN IF NOT EXISTS is_psychotropic BOOLEAN DEFAULT false;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS is_controlled BOOLEAN DEFAULT false;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS controlled_substance_schedule TEXT;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS is_narcotic BOOLEAN DEFAULT false;

-- Index on is_controlled
CREATE INDEX IF NOT EXISTS idx_medications_is_controlled ON medications(is_controlled);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medications/indexes/idx_medications_name.sql
-- ----------------------------------------------------------------------------

-- Index on name
CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medications/indexes/idx_medications_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_medications_organization ON medications(organization_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medications/indexes/idx_medications_rxnorm.sql
-- ----------------------------------------------------------------------------

-- Index on rxnorm_cui
CREATE INDEX IF NOT EXISTS idx_medications_rxnorm ON medications(rxnorm_cui);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/medications/table.sql
-- ----------------------------------------------------------------------------

-- Medications Table
-- Medication catalog with comprehensive drug information
CREATE TABLE IF NOT EXISTS medications (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,

  -- Medication Information
  name TEXT NOT NULL,
  generic_name TEXT,
  brand_names TEXT[],
  rxnorm_cui TEXT, -- RXNorm Concept Unique Identifier
  ndc_codes TEXT[], -- National Drug Codes

  -- Classification
  category_broad TEXT,
  category_specific TEXT,
  drug_class TEXT,

  -- Flags
  is_psychotropic BOOLEAN DEFAULT false,
  is_controlled BOOLEAN DEFAULT false,
  controlled_substance_schedule TEXT, -- Schedule I-V
  is_narcotic BOOLEAN DEFAULT false,
  requires_monitoring BOOLEAN DEFAULT false,
  is_high_alert BOOLEAN DEFAULT false,

  -- Details
  active_ingredients JSONB DEFAULT '[]', -- [{name, strength, unit}]
  available_forms TEXT[], -- ['tablet', 'capsule', 'liquid', etc.]
  available_strengths TEXT[], -- ['5mg', '10mg', '20mg']

  -- Additional Information
  manufacturer TEXT,
  warnings TEXT[],
  black_box_warning TEXT,
  metadata JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_formulary BOOLEAN DEFAULT true,

  -- Audit
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE medications IS 'Medication catalog with comprehensive drug information';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/001-organizations_projection.sql
-- ----------------------------------------------------------------------------

-- Organizations Projection Table
-- CQRS projection maintained by organization event processors
-- Source of truth: organization.* events in domain_events table
CREATE TABLE IF NOT EXISTS organizations_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('platform_owner', 'provider', 'provider_partner')),

  -- Hierarchical structure using ltree
  path LTREE NOT NULL UNIQUE,
  parent_path LTREE,
  depth INTEGER GENERATED ALWAYS AS (nlevel(path)) STORED,

  -- Basic shared fields from creation event
  tax_number TEXT,
  phone_number TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  metadata JSONB DEFAULT '{}',

  -- Lifecycle management
  is_active BOOLEAN DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,
  deleted_at TIMESTAMPTZ,
  deletion_reason TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CHECK (
    -- Root organizations (depth 2) have no parent
    (nlevel(path) = 2 AND parent_path IS NULL)
    OR
    -- Sub-organizations (depth > 2) must have parent
    (nlevel(path) > 2 AND parent_path IS NOT NULL)
  )
);

-- Remove deprecated zitadel_org_id column (migration from Zitadel to Supabase Auth)
ALTER TABLE organizations_projection DROP COLUMN IF EXISTS zitadel_org_id;

-- Performance indexes for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_organizations_path_gist ON organizations_projection USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_organizations_path_btree ON organizations_projection USING BTREE (path);
CREATE INDEX IF NOT EXISTS idx_organizations_parent_path ON organizations_projection USING GIST (parent_path) 
  WHERE parent_path IS NOT NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations_projection(type);
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations_projection(is_active)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_organizations_deleted ON organizations_projection(deleted_at)
  WHERE deleted_at IS NULL;

-- Drop deprecated zitadel indexes
DROP INDEX IF EXISTS idx_organizations_zitadel_org;
DROP INDEX IF EXISTS idx_organizations_zitadel_org_id;

-- Comments for documentation
COMMENT ON TABLE organizations_projection IS 'CQRS projection of organization.* events - maintains hierarchical organization structure';
COMMENT ON COLUMN organizations_projection.path IS 'ltree hierarchical path (e.g., root.org_acme_healthcare.north_campus)';
COMMENT ON COLUMN organizations_projection.parent_path IS 'Parent organization ltree path (NULL for root organizations)';
COMMENT ON COLUMN organizations_projection.depth IS 'Computed depth in hierarchy (2 = root org, 3+ = sub-organizations)';
COMMENT ON COLUMN organizations_projection.type IS 'Organization type: platform_owner (A4C), provider (healthcare), provider_partner (VARs/families/courts)';
COMMENT ON COLUMN organizations_projection.slug IS 'URL-friendly identifier for routing';
COMMENT ON COLUMN organizations_projection.is_active IS 'Organization active status (affects authentication and role assignment)';
COMMENT ON COLUMN organizations_projection.deleted_at IS 'Logical deletion timestamp (organizations are never physically deleted)';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/002-organization_business_profiles_projection.sql
-- ----------------------------------------------------------------------------

-- Organization Business Profiles Projection Table
-- CQRS projection maintained by organization business profile event processors
-- Source of truth: organization.business_profile.* events in domain_events table
-- Contains rich business data for top-level organizations only
CREATE TABLE IF NOT EXISTS organization_business_profiles_projection (
  organization_id UUID PRIMARY KEY,
  organization_type TEXT NOT NULL CHECK (organization_type IN ('provider', 'provider_partner')),
  
  -- Common address fields
  mailing_address JSONB,
  physical_address JSONB,
  
  -- Type-specific business profiles stored as JSONB for flexibility
  provider_profile JSONB,      -- Only populated when organization_type = 'provider'
  partner_profile JSONB,       -- Only populated when organization_type = 'provider_partner'
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints to ensure data integrity
  CHECK (
    (organization_type = 'provider' AND provider_profile IS NOT NULL AND partner_profile IS NULL)
    OR
    (organization_type = 'provider_partner' AND partner_profile IS NOT NULL AND provider_profile IS NULL)
  )

  -- Note: Business profiles should only be created for root-level organizations (depth = 2)
  -- This validation is enforced in the event processor, not via CHECK constraint
  -- (CHECK constraints cannot contain subqueries in PostgreSQL)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_org_business_profiles_type ON organization_business_profiles_projection(organization_type);

-- GIN indexes for JSONB profile searches
CREATE INDEX IF NOT EXISTS idx_org_business_profiles_provider_profile 
  ON organization_business_profiles_projection USING GIN (provider_profile)
  WHERE provider_profile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_business_profiles_partner_profile 
  ON organization_business_profiles_projection USING GIN (partner_profile)
  WHERE partner_profile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_business_profiles_mailing_address 
  ON organization_business_profiles_projection USING GIN (mailing_address)
  WHERE mailing_address IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE organization_business_profiles_projection IS 
  'CQRS projection of organization.business_profile.* events - rich business data for top-level organizations only';
COMMENT ON COLUMN organization_business_profiles_projection.organization_type IS 
  'Type of business profile: provider (healthcare orgs) or provider_partner (VARs, families, courts)';
COMMENT ON COLUMN organization_business_profiles_projection.provider_profile IS 
  'Provider-specific business data: billing info, admin contacts, program details, service types';
COMMENT ON COLUMN organization_business_profiles_projection.partner_profile IS 
  'Provider partner-specific business data: contact info, admin details, partner type';
COMMENT ON COLUMN organization_business_profiles_projection.mailing_address IS 
  'Mailing address JSONB: {street, city, state, zip_code, country}';
COMMENT ON COLUMN organization_business_profiles_projection.physical_address IS 
  'Physical location address JSONB: {street, city, state, zip_code, country}';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/003-add-subdomain-columns.sql
-- ----------------------------------------------------------------------------

-- Add subdomain provisioning columns to organizations_projection
-- Part of Phase 2: Database Schema for Subdomain Support
-- Full subdomain computed as: {slug}.{BASE_DOMAIN} (environment-aware)

ALTER TABLE organizations_projection ADD COLUMN IF NOT EXISTS subdomain_status subdomain_status DEFAULT 'pending';
ALTER TABLE organizations_projection ADD COLUMN IF NOT EXISTS cloudflare_record_id TEXT;
ALTER TABLE organizations_projection ADD COLUMN IF NOT EXISTS dns_verified_at TIMESTAMPTZ;
ALTER TABLE organizations_projection ADD COLUMN IF NOT EXISTS subdomain_metadata JSONB DEFAULT '{}';

-- Index for querying organizations by provisioning status
-- Partial index excludes verified orgs (most common case) for efficiency
CREATE INDEX IF NOT EXISTS idx_organizations_subdomain_status
  ON organizations_projection(subdomain_status)
  WHERE subdomain_status != 'verified';

-- Index for finding failed provisioning attempts that need attention
CREATE INDEX IF NOT EXISTS idx_organizations_subdomain_failed
  ON organizations_projection(subdomain_status, updated_at)
  WHERE subdomain_status = 'failed';

-- Documentation
COMMENT ON COLUMN organizations_projection.subdomain_status
  IS 'Subdomain provisioning status - tracks DNS creation and verification lifecycle';

COMMENT ON COLUMN organizations_projection.cloudflare_record_id
  IS 'Cloudflare DNS record ID for {slug}.{BASE_DOMAIN} subdomain (from Cloudflare API response)';

COMMENT ON COLUMN organizations_projection.dns_verified_at
  IS 'Timestamp when DNS verification completed successfully (subdomain resolvable)';

COMMENT ON COLUMN organizations_projection.subdomain_metadata
  IS 'Additional subdomain provisioning metadata: dns_record details, verification attempts, errors';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/004-programs_projection.sql
-- ----------------------------------------------------------------------------

-- Programs Projection Table
-- CQRS projection maintained by program.* event processors
-- Source of truth: program.* events in audit_log/domain_events table

CREATE TABLE IF NOT EXISTS programs_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Program Information
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- residential, outpatient, day_treatment, iop, php, sober_living, mat

  -- Program Details
  description TEXT,
  capacity INTEGER,
  current_occupancy INTEGER DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT true,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_programs_organization
  ON programs_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_programs_type
  ON programs_projection(type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_programs_active
  ON programs_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE programs_projection IS 'CQRS projection of program.* events - treatment programs offered by organizations';
COMMENT ON COLUMN programs_projection.type IS 'Program type: residential, outpatient, day_treatment, iop, php, sober_living, mat';
COMMENT ON COLUMN programs_projection.capacity IS 'Maximum number of clients this program can serve (NULL = unlimited)';
COMMENT ON COLUMN programs_projection.current_occupancy IS 'Current number of active clients in program';
COMMENT ON COLUMN programs_projection.is_active IS 'Program active status (affects client enrollment)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/005-contacts_projection.sql
-- ----------------------------------------------------------------------------

-- Contacts Projection Table
-- CQRS projection maintained by contact.* event processors
-- Source of truth: contact.* events in audit_log/domain_events table

CREATE TABLE IF NOT EXISTS contacts_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Contact Label/Type
  label TEXT NOT NULL,  -- e.g., 'A4C Admin Contact', 'Billing Contact', 'Technical Contact'

  -- Contact Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,

  -- Optional fields
  title TEXT,           -- Job title
  department TEXT,

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_contacts_organization
  ON contacts_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts_projection(email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_primary
  ON contacts_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_active
  ON contacts_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary contact per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_one_primary_per_org
  ON contacts_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE contacts_projection IS 'CQRS projection of contact.* events - contact persons associated with organizations';
COMMENT ON COLUMN contacts_projection.label IS 'Contact type/label: A4C Admin Contact, Billing Contact, Technical Contact, etc.';
COMMENT ON COLUMN contacts_projection.is_primary IS 'Primary contact for the organization (only one per org)';
COMMENT ON COLUMN contacts_projection.is_active IS 'Contact active status';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/006-addresses_projection.sql
-- ----------------------------------------------------------------------------

-- Addresses Projection Table
-- CQRS projection maintained by address.* event processors
-- Source of truth: address.* events in audit_log/domain_events table

CREATE TABLE IF NOT EXISTS addresses_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Address Label/Type
  label TEXT NOT NULL,  -- e.g., 'Billing Address', 'Shipping Address', 'Main Office', 'Branch Office'

  -- Address Components
  street1 TEXT NOT NULL,
  street2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,  -- US state abbreviation
  zip_code TEXT NOT NULL,

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_addresses_organization
  ON addresses_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_label
  ON addresses_projection(label, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_primary
  ON addresses_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_active
  ON addresses_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary address per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_primary_per_org
  ON addresses_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE addresses_projection IS 'CQRS projection of address.* events - physical addresses associated with organizations';
COMMENT ON COLUMN addresses_projection.label IS 'Address type/label: Billing Address, Shipping Address, Main Office, etc.';
COMMENT ON COLUMN addresses_projection.state IS 'US state abbreviation (2-letter code)';
COMMENT ON COLUMN addresses_projection.zip_code IS 'US zip code (5-digit or 9-digit format)';
COMMENT ON COLUMN addresses_projection.is_primary IS 'Primary address for the organization (only one per org)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/007-phones_projection.sql
-- ----------------------------------------------------------------------------

-- Phones Projection Table
-- CQRS projection maintained by phone.* event processors
-- Source of truth: phone.* events in audit_log/domain_events table

CREATE TABLE IF NOT EXISTS phones_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Phone Label/Type
  label TEXT NOT NULL,  -- e.g., 'Billing Phone', 'Main Office', 'Emergency Contact', 'Fax'

  -- Phone Information
  number TEXT NOT NULL,  -- Formatted phone number (e.g., '(555) 123-4567')
  extension TEXT,        -- Optional phone extension
  type TEXT,  -- mobile, office, fax, emergency, other

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_phones_organization
  ON phones_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_label
  ON phones_projection(label, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_primary
  ON phones_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_active
  ON phones_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_type
  ON phones_projection(type, organization_id)
  WHERE deleted_at IS NULL;

-- Unique constraint: one primary phone per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_phones_one_primary_per_org
  ON phones_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE phones_projection IS 'CQRS projection of phone.* events - phone numbers associated with organizations';
COMMENT ON COLUMN phones_projection.label IS 'Phone type/label: Billing Phone, Main Office, Emergency Contact, Fax, etc.';
COMMENT ON COLUMN phones_projection.number IS 'US phone number in formatted display format';
COMMENT ON COLUMN phones_projection.extension IS 'Phone extension for office numbers (optional)';
COMMENT ON COLUMN phones_projection.type IS 'Phone type: mobile, office, fax, emergency, other';
COMMENT ON COLUMN phones_projection.is_primary IS 'Primary phone for the organization (only one per org)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/008-create-enums.sql
-- ----------------------------------------------------------------------------

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


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/009-add-partner-columns.sql
-- ----------------------------------------------------------------------------

-- Add Partner Type and Referring Partner Columns
-- Provider Onboarding Enhancement - Phase 1.1
-- Adds partner classification and referring partner relationship tracking

-- Add partner_type column (nullable, required only for provider_partner orgs)
ALTER TABLE organizations_projection
ADD COLUMN IF NOT EXISTS partner_type partner_type;

-- Add referring_partner_id column (nullable, tracks which VAR partner referred this provider)
-- Note: No ON DELETE action - event-driven deletion required (emit organization.updated events to clear references)
ALTER TABLE organizations_projection
ADD COLUMN IF NOT EXISTS referring_partner_id UUID REFERENCES organizations_projection(id);

-- Add CHECK constraint: partner_type required for provider_partner orgs
-- Note: Using DO block for idempotency since ALTER TABLE ADD CONSTRAINT doesn't support IF NOT EXISTS
DO $$ BEGIN
  ALTER TABLE organizations_projection
    ADD CONSTRAINT chk_partner_type_required
    CHECK (
      (type != 'provider_partner') OR
      (type = 'provider_partner' AND partner_type IS NOT NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create index on partner_type for filtering (VAR partners, stakeholder partners)
CREATE INDEX IF NOT EXISTS idx_organizations_partner_type
  ON organizations_projection(partner_type)
  WHERE partner_type IS NOT NULL;

-- Create index on referring_partner_id for relationship queries
CREATE INDEX IF NOT EXISTS idx_organizations_referring_partner
  ON organizations_projection(referring_partner_id)
  WHERE referring_partner_id IS NOT NULL;

-- Update documentation comments
COMMENT ON COLUMN organizations_projection.partner_type IS 'Partner classification for provider_partner orgs: var (reseller, gets subdomain), family/court/other (stakeholders, no subdomain)';
COMMENT ON COLUMN organizations_projection.referring_partner_id IS 'UUID of referring VAR partner (nullable, tracks which partner brought this provider to platform)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/010-contacts_projection_v2.sql
-- ----------------------------------------------------------------------------

-- Contacts Projection Table V2
-- Provider Onboarding Enhancement - Phase 1
-- CQRS projection maintained by contact.* event processors
-- Source of truth: contact.* events in domain_events table

-- Create contacts_projection with all required fields (idempotent)
-- Note: No ON DELETE CASCADE - event-driven deletion required (emit contact.deleted events via workflow)
CREATE TABLE IF NOT EXISTS contacts_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),

  -- Contact Classification
  label TEXT NOT NULL,           -- User-defined label (e.g., 'John - Main Contact', 'Billing Department')
  type contact_type NOT NULL,    -- Structured type: a4c_admin, billing, technical, emergency, stakeholder

  -- Contact Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,

  -- Optional fields
  title TEXT,           -- Job title (e.g., 'Chief Financial Officer')
  department TEXT,      -- Department (e.g., 'Finance', 'IT')

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- Soft delete support
);

-- Performance indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_contacts_organization
  ON contacts_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts_projection(email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_type
  ON contacts_projection(type, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_primary
  ON contacts_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_active
  ON contacts_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary contact per organization (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_contacts_one_primary_per_org') THEN
    CREATE UNIQUE INDEX idx_contacts_one_primary_per_org
      ON contacts_projection(organization_id)
      WHERE is_primary = true AND deleted_at IS NULL;
  END IF;
END $$;
-- Documentation
COMMENT ON TABLE contacts_projection IS 'CQRS projection of contact.* events - contact persons associated with organizations';
COMMENT ON COLUMN contacts_projection.organization_id IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';
COMMENT ON COLUMN contacts_projection.label IS 'User-defined contact label for identification (e.g., "John Smith - Billing Contact")';
COMMENT ON COLUMN contacts_projection.type IS 'Structured contact type: a4c_admin, billing, technical, emergency, stakeholder';
COMMENT ON COLUMN contacts_projection.is_primary IS 'Primary contact for the organization (only one per org enforced by unique index)';
COMMENT ON COLUMN contacts_projection.is_active IS 'Contact active status';
COMMENT ON COLUMN contacts_projection.deleted_at IS 'Soft delete timestamp (cascades from org deletion)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/011-addresses_projection_v2.sql
-- ----------------------------------------------------------------------------

-- Addresses Projection Table V2
-- Provider Onboarding Enhancement - Phase 1
-- CQRS projection maintained by address.* event processors
-- Source of truth: address.* events in domain_events table

-- Drop old table (no data to migrate - empty table)


-- Create new addresses_projection with all required fields
-- Note: No ON DELETE CASCADE - event-driven deletion required (emit address.deleted events via workflow)
CREATE TABLE IF NOT EXISTS addresses_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),

  -- Address Classification
  label TEXT NOT NULL,             -- User-defined label (e.g., 'Main Office', 'Billing Department')
  type address_type NOT NULL,      -- Structured type: physical, mailing, billing

  -- Address Information
  street1 TEXT NOT NULL,
  street2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,             -- State/Province code (e.g., 'CA', 'NY', 'ON')
  zip_code TEXT NOT NULL,          -- Postal/ZIP code
  country TEXT DEFAULT 'US',       -- ISO country code

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- Soft delete support
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_addresses_organization
  ON addresses_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_type
  ON addresses_projection(type, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_primary
  ON addresses_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_active
  ON addresses_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Index for zip code lookups (useful for geographic queries)
CREATE INDEX IF NOT EXISTS idx_addresses_zip
  ON addresses_projection(zip_code)
  WHERE deleted_at IS NULL;

-- Unique constraint: one primary address per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_primary_per_org
  ON addresses_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE addresses_projection IS 'CQRS projection of address.* events - addresses associated with organizations';
COMMENT ON COLUMN addresses_projection.organization_id IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';
COMMENT ON COLUMN addresses_projection.label IS 'User-defined address label for identification (e.g., "Main Office", "Billing Department")';
COMMENT ON COLUMN addresses_projection.type IS 'Structured address type: physical (business location), mailing, billing';
COMMENT ON COLUMN addresses_projection.is_primary IS 'Primary address for the organization (only one per org enforced by unique index)';
COMMENT ON COLUMN addresses_projection.is_active IS 'Address active status';
COMMENT ON COLUMN addresses_projection.deleted_at IS 'Soft delete timestamp (cascades from org deletion)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/012-phones_projection_v2.sql
-- ----------------------------------------------------------------------------

-- Phones Projection Table V2
-- Provider Onboarding Enhancement - Phase 1
-- CQRS projection maintained by phone.* event processors
-- Source of truth: phone.* events in domain_events table

-- Drop old table (no data to migrate - empty table)


-- Create new phones_projection with all required fields
-- Note: No ON DELETE CASCADE - event-driven deletion required (emit phone.deleted events via workflow)
CREATE TABLE IF NOT EXISTS phones_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),

  -- Phone Classification
  label TEXT NOT NULL,            -- User-defined label (e.g., 'Main Office', 'Emergency Line')
  type phone_type NOT NULL,       -- Structured type: mobile, office, fax, emergency

  -- Phone Information
  number TEXT NOT NULL,           -- Phone number (formatted or raw, e.g., '+1-555-123-4567' or '5551234567')
  extension TEXT,                 -- Phone extension (optional)
  country_code TEXT DEFAULT '+1', -- Country calling code (e.g., '+1' for US/Canada)

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- Soft delete support
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_phones_organization
  ON phones_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_type
  ON phones_projection(type, organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_number
  ON phones_projection(number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_primary
  ON phones_projection(organization_id, is_primary)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phones_active
  ON phones_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Unique constraint: one primary phone per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_phones_one_primary_per_org
  ON phones_projection(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE phones_projection IS 'CQRS projection of phone.* events - phone numbers associated with organizations';
COMMENT ON COLUMN phones_projection.organization_id IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';
COMMENT ON COLUMN phones_projection.label IS 'User-defined phone label for identification (e.g., "Main Office", "Emergency Hotline")';
COMMENT ON COLUMN phones_projection.type IS 'Structured phone type: mobile, office, fax, emergency';
COMMENT ON COLUMN phones_projection.number IS 'Phone number (raw or formatted, e.g., "+1-555-123-4567")';
COMMENT ON COLUMN phones_projection.extension IS 'Phone extension (optional, e.g., "x1234")';
COMMENT ON COLUMN phones_projection.is_primary IS 'Primary phone for the organization (only one per org enforced by unique index)';
COMMENT ON COLUMN phones_projection.is_active IS 'Phone active status';
COMMENT ON COLUMN phones_projection.deleted_at IS 'Soft delete timestamp (cascades from org deletion)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/013-junction-tables.sql
-- ----------------------------------------------------------------------------

-- Junction Tables for Many-to-Many Relationships
-- Provider Onboarding Enhancement - Phase 1
-- Minimal design: UNIQUE constraints only, no PK, no metadata
-- Rationale: domain_events table IS the audit trail (CQRS pattern)
-- Note: No ON DELETE CASCADE - event-driven deletion required (emit *.unlinked events via workflow)

-- ==============================================================================
-- Organization Junction Tables (org-level relationships)
-- ==============================================================================

-- Organization ↔ Contact Junction
-- Links organizations to contact persons

CREATE TABLE IF NOT EXISTS organization_contacts (
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  contact_id UUID NOT NULL REFERENCES contacts_projection(id),

  UNIQUE (organization_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_contacts_org
  ON organization_contacts(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_contacts_contact
  ON organization_contacts(contact_id);

COMMENT ON TABLE organization_contacts IS 'Many-to-many junction: organizations ↔ contacts (org-level association)';

-- Organization ↔ Address Junction
-- Links organizations to addresses

CREATE TABLE IF NOT EXISTS organization_addresses (
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  address_id UUID NOT NULL REFERENCES addresses_projection(id),

  UNIQUE (organization_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_addresses_org
  ON organization_addresses(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_addresses_address
  ON organization_addresses(address_id);

COMMENT ON TABLE organization_addresses IS 'Many-to-many junction: organizations ↔ addresses (org-level association)';

-- Organization ↔ Phone Junction
-- Links organizations to phone numbers

CREATE TABLE IF NOT EXISTS organization_phones (
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  phone_id UUID NOT NULL REFERENCES phones_projection(id),

  UNIQUE (organization_id, phone_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_phones_org
  ON organization_phones(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_phones_phone
  ON organization_phones(phone_id);

COMMENT ON TABLE organization_phones IS 'Many-to-many junction: organizations ↔ phones (org-level association)';

-- ==============================================================================
-- Contact Group Junction Tables (fully connected contact groups)
-- ==============================================================================
-- Used for Billing and Provider Admin sections where contact, address, and phone
-- are all linked together in a fully connected graph

-- Contact ↔ Address Junction
-- Links contacts to their addresses (e.g., billing contact to billing address)

CREATE TABLE IF NOT EXISTS contact_addresses (
  contact_id UUID NOT NULL REFERENCES contacts_projection(id),
  address_id UUID NOT NULL REFERENCES addresses_projection(id),

  UNIQUE (contact_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_addresses_contact
  ON contact_addresses(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_addresses_address
  ON contact_addresses(address_id);

COMMENT ON TABLE contact_addresses IS 'Many-to-many junction: contacts ↔ addresses (contact group association)';

-- Contact ↔ Phone Junction
-- Links contacts to their phone numbers (e.g., billing contact to billing phone)

CREATE TABLE IF NOT EXISTS contact_phones (
  contact_id UUID NOT NULL REFERENCES contacts_projection(id),
  phone_id UUID NOT NULL REFERENCES phones_projection(id),

  UNIQUE (contact_id, phone_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_phones_contact
  ON contact_phones(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_phones_phone
  ON contact_phones(phone_id);

COMMENT ON TABLE contact_phones IS 'Many-to-many junction: contacts ↔ phones (contact group association)';

-- Phone ↔ Address Junction
-- Links phone numbers to addresses (e.g., main office phone to main office address)
-- Enables direct phone-address queries without contact intermediary
-- Use case: Main office phone/address without specific contact person

CREATE TABLE IF NOT EXISTS phone_addresses (
  phone_id UUID NOT NULL REFERENCES phones_projection(id),
  address_id UUID NOT NULL REFERENCES addresses_projection(id),

  UNIQUE (phone_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_phone_addresses_phone
  ON phone_addresses(phone_id);

CREATE INDEX IF NOT EXISTS idx_phone_addresses_address
  ON phone_addresses(address_id);

COMMENT ON TABLE phone_addresses IS 'Many-to-many junction: phones ↔ addresses (direct association, supports contact-less main office scenarios)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/015-remove-program-infrastructure.sql
-- ----------------------------------------------------------------------------

-- Remove Deprecated Program Infrastructure
-- Programs feature deprecated - replaced with more flexible service offering model
--
-- This migration removes all program-related database objects:
-- - programs_projection table (CQRS projection)
-- - process_program_event() function (event processor)
-- - 'program' stream type routing from main event router
--
-- Data Status: programs_projection table is EMPTY (0 records as of 2025-01-16)
-- No data export required - greenfield removal
--
-- Safety: All changes use IF EXISTS for idempotency
-- Impact: Removes deprecated feature infrastructure cleanly
-- Rollback: Can recreate from git history if needed (file 004-programs_projection.sql)

-- ============================================================================
-- Drop Program Event Processor Function
-- ============================================================================

-- Drop the program event processor (was in file 007-process-organization-child-events.sql)
DROP FUNCTION IF EXISTS process_program_event(RECORD);
-- Note: COMMENT ON FUNCTION removed - function doesn't exist to comment on

-- ============================================================================
-- Drop Programs Projection Table
-- ============================================================================

-- Drop the programs projection table and all its indexes/constraints
DROP TABLE IF EXISTS programs_projection CASCADE;

-- ============================================================================
-- Update Main Event Router
-- ============================================================================

-- The main event router (001-main-event-router.sql) has a CASE statement with 'program' stream type
-- We need to remove that case, but since it's a CASE statement in a function,
-- we'll need to recreate the function without the program case.
-- This will be handled by updating file 001 directly (not in migration).

-- For now, the router will just ignore program events (log warning)
-- The 'program' CASE has been removed from file 001-main-event-router.sql

-- ============================================================================
-- Clean Up Event Types Table (Optional)
-- ============================================================================

-- Remove program event types from event_types table if they exist
-- This is optional since event_types is just documentation

DELETE FROM event_types
WHERE event_type LIKE 'program.%';

-- ============================================================================
-- Verification Queries (for manual testing)
-- ============================================================================

-- Verify program table dropped:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name = 'programs_projection';
-- Expected: 0 rows

-- Verify function dropped:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_name = 'process_program_event';
-- Expected: 0 rows

-- Verify event types cleaned:
-- SELECT * FROM event_types WHERE event_type LIKE 'program.%';
-- Expected: 0 rows (or table doesn't exist if event_types is not used)

-- ============================================================================
-- Migration Notes
-- ============================================================================

-- This migration is part of Phase 1.4 (Provider Onboarding Enhancement)
-- Programs feature was replaced with more flexible contact/address/phone model
-- Old programs_projection table was never populated (greenfield removal)
--
-- Files affected by this removal:
-- - 004-programs_projection.sql (table definition) - deprecated
-- - 007-process-organization-child-events.sql (event processor) - deprecated function
-- - 001-main-event-router.sql (router case) - needs manual update
--
-- See: dev/active/provider-onboarding-enhancement-context.md for full context


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/016-subdomain-conditional-logic.sql
-- ----------------------------------------------------------------------------

-- Update Subdomain Provisioning to be Conditional
-- Part of Phase 1.5: Provider Onboarding Enhancement
--
-- Subdomain Requirements by Organization Type:
-- - Provider organizations: ALWAYS require subdomain (tenant isolation + portal access)
-- - VAR partner organizations: Require subdomain (they get their own portal)
-- - Stakeholder partners (family, court, other): Do NOT require subdomain (no portal access)
-- - Platform owner (A4C): Does NOT require subdomain (NULL allowed)
--
-- Implementation:
-- - Make subdomain_status nullable (NULL = subdomain not required)
-- - Create validation function to determine subdomain requirement
-- - Add CHECK constraint to enforce conditional logic
-- - Update platform owner org to have NULL subdomain_status
--
-- Safety: All changes are idempotent and backward compatible
-- Impact: Enables flexible subdomain provisioning based on org type

-- ============================================================================
-- Make subdomain_status Nullable
-- ============================================================================

-- Change subdomain_status from DEFAULT 'pending' to nullable
-- Organizations that don't require subdomains will have NULL subdomain_status
ALTER TABLE organizations_projection
  ALTER COLUMN subdomain_status DROP DEFAULT,
  ALTER COLUMN subdomain_status DROP NOT NULL;

-- Update default for new orgs: NULL (will be set by validation logic)
ALTER TABLE organizations_projection
  ALTER COLUMN subdomain_status SET DEFAULT NULL;

-- ============================================================================
-- Create Subdomain Validation Function
-- ============================================================================

CREATE OR REPLACE FUNCTION is_subdomain_required(
  p_type TEXT,
  p_partner_type partner_type
) RETURNS BOOLEAN AS $$
BEGIN
  -- Subdomain required for providers (always have portal)
  IF p_type = 'provider' THEN
    RETURN TRUE;
  END IF;

  -- Subdomain required for VAR partners (they get portal access)
  IF p_type = 'provider_partner' AND p_partner_type = 'var' THEN
    RETURN TRUE;
  END IF;

  -- Subdomain NOT required for stakeholder partners (family, court, other)
  -- They don't get portal access, just limited dashboard views
  IF p_type = 'provider_partner' AND p_partner_type IN ('family', 'court', 'other') THEN
    RETURN FALSE;
  END IF;

  -- Subdomain NOT required for platform owner (A4C)
  -- Platform owner uses main domain, not tenant subdomain
  IF p_type = 'platform_owner' THEN
    RETURN FALSE;
  END IF;

  -- Default: subdomain not required (conservative approach)
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION is_subdomain_required IS
  'Determines if subdomain provisioning is required based on organization type and partner type';

-- ============================================================================
-- Add CHECK Constraint for Subdomain Conditional Logic
-- ============================================================================

-- Constraint: If subdomain required, subdomain_status cannot be NULL
-- If subdomain not required, subdomain_status MUST be NULL
ALTER TABLE organizations_projection
  DROP CONSTRAINT IF EXISTS chk_subdomain_conditional;

ALTER TABLE organizations_projection
  ADD CONSTRAINT chk_subdomain_conditional CHECK (
    -- If subdomain required, status cannot be NULL
    (is_subdomain_required(type, partner_type) = TRUE AND subdomain_status IS NOT NULL)
    OR
    -- If subdomain not required, status MUST be NULL
    (is_subdomain_required(type, partner_type) = FALSE AND subdomain_status IS NULL)
  );

-- ============================================================================
-- Update Existing Organizations
-- ============================================================================

-- Set subdomain_status to NULL for organizations that don't require subdomains
UPDATE organizations_projection
SET
  subdomain_status = NULL,
  cloudflare_record_id = NULL,
  dns_verified_at = NULL,
  subdomain_metadata = '{}'::jsonb,
  updated_at = NOW()
WHERE
  is_subdomain_required(type, partner_type) = FALSE
  AND subdomain_status IS NOT NULL;

-- Update documentation
COMMENT ON COLUMN organizations_projection.subdomain_status IS
  'Subdomain provisioning status (NULL = subdomain not required for this org type). Required for providers and VAR partners only.';

-- ============================================================================
-- Verification Queries (for manual testing)
-- ============================================================================

-- Verify subdomain_status is nullable:
-- SELECT column_name, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'organizations_projection' AND column_name = 'subdomain_status';
-- Expected: is_nullable = 'YES', column_default = NULL

-- Verify function works correctly:
-- SELECT
--   'provider' as type, NULL::partner_type as partner_type,
--   is_subdomain_required('provider', NULL) as required;
-- Expected: TRUE
--
-- SELECT
--   'provider_partner' as type, 'var'::partner_type as partner_type,
--   is_subdomain_required('provider_partner', 'var') as required;
-- Expected: TRUE
--
-- SELECT
--   'provider_partner' as type, 'family'::partner_type as partner_type,
--   is_subdomain_required('provider_partner', 'family') as required;
-- Expected: FALSE
--
-- SELECT
--   'platform_owner' as type, NULL::partner_type as partner_type,
--   is_subdomain_required('platform_owner', NULL) as required;
-- Expected: FALSE

-- Verify constraint works:
-- Test 1: Insert provider with NULL subdomain_status (should FAIL)
-- INSERT INTO organizations_projection (id, name, slug, type, path, created_at, partner_type, subdomain_status)
-- VALUES (gen_random_uuid(), 'Test Provider', 'test-provider', 'provider', 'root.test_provider', NOW(), NULL, NULL);
-- Expected: ERROR - constraint violation
--
-- Test 2: Insert stakeholder partner with 'pending' subdomain_status (should FAIL)
-- INSERT INTO organizations_projection (id, name, slug, type, path, created_at, partner_type, subdomain_status)
-- VALUES (gen_random_uuid(), 'Test Family', 'test-family', 'provider_partner', 'root.test_family', NOW(), 'family', 'pending');
-- Expected: ERROR - constraint violation
--
-- Test 3: Insert stakeholder partner with NULL subdomain_status (should SUCCEED)
-- INSERT INTO organizations_projection (id, name, slug, type, path, created_at, partner_type, subdomain_status)
-- VALUES (gen_random_uuid(), 'Test Family', 'test-family', 'provider_partner', 'root.test_family', NOW(), 'family', NULL);
-- Expected: Success

-- ============================================================================
-- Migration Notes
-- ============================================================================

-- This migration is part of Phase 1.5 (Provider Onboarding Enhancement)
-- Subdomain provisioning is now conditional based on org type:
-- - Provider orgs: subdomain REQUIRED (portal access)
-- - VAR partners: subdomain REQUIRED (portal access)
-- - Stakeholder partners: subdomain NOT required (no portal, just limited views)
-- - Platform owner: subdomain NOT required (uses main domain)
--
-- Event processors will check is_subdomain_required() and only provision DNS
-- for orgs where it returns TRUE. Temporal workflows will skip DNS provisioning
-- activities when subdomain_status is NULL.
--
-- See: dev/active/provider-onboarding-enhancement-context.md for full context


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/017-junction-soft-delete-support.sql
-- ----------------------------------------------------------------------------

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


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/add_tags_column.sql
-- ----------------------------------------------------------------------------

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


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/indexes/idx_is_active.sql
-- ----------------------------------------------------------------------------

-- Index on is_active for filtering active organizations
CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations_projection(is_active);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/organizations/indexes/idx_type.sql
-- ----------------------------------------------------------------------------

-- Index on type for filtering organizations by category
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations_projection(type);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/rbac/001-permissions_projection.sql
-- ----------------------------------------------------------------------------

-- Permissions Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: permission.defined events in domain_events table

CREATE TABLE IF NOT EXISTS permissions_projection (
  id UUID PRIMARY KEY,
  applet TEXT NOT NULL,
  action TEXT NOT NULL,
  name TEXT GENERATED ALWAYS AS (applet || '.' || action) STORED,
  description TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'facility', 'program', 'client')),
  requires_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (applet, action)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_permissions_applet ON permissions_projection(applet);
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions_projection(name);
CREATE INDEX IF NOT EXISTS idx_permissions_scope_type ON permissions_projection(scope_type);
CREATE INDEX IF NOT EXISTS idx_permissions_requires_mfa ON permissions_projection(requires_mfa) WHERE requires_mfa = TRUE;

-- Comments
COMMENT ON TABLE permissions_projection IS 'Projection of permission.defined events - defines atomic authorization units';
COMMENT ON COLUMN permissions_projection.name IS 'Generated permission identifier in format: applet.action';
COMMENT ON COLUMN permissions_projection.scope_type IS 'Hierarchical scope level: global, org, facility, program, or client';
COMMENT ON COLUMN permissions_projection.requires_mfa IS 'Whether MFA verification is required to use this permission';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/rbac/002-roles_projection.sql
-- ----------------------------------------------------------------------------

-- Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: role.created events in domain_events table

CREATE TABLE IF NOT EXISTS roles_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  organization_id UUID,  -- Internal UUID for JOINs (NULL for super_admin global scope)
  org_hierarchy_scope LTREE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- Remove deprecated zitadel_org_id column if it exists
ALTER TABLE roles_projection DROP COLUMN IF EXISTS zitadel_org_id;

-- Update constraint to handle role templates (super_admin, provider_admin, partner_admin)
ALTER TABLE roles_projection DROP CONSTRAINT IF EXISTS roles_projection_scope_check;
ALTER TABLE roles_projection ADD CONSTRAINT roles_projection_scope_check CHECK (
  (name IN ('super_admin', 'provider_admin', 'partner_admin') AND organization_id IS NULL AND org_hierarchy_scope IS NULL)
  OR
  (name NOT IN ('super_admin', 'provider_admin', 'partner_admin') AND organization_id IS NOT NULL AND org_hierarchy_scope IS NOT NULL)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles_projection(name);
CREATE INDEX IF NOT EXISTS idx_roles_organization_id ON roles_projection(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_hierarchy_scope ON roles_projection USING GIST(org_hierarchy_scope) WHERE org_hierarchy_scope IS NOT NULL;

-- Comments
COMMENT ON TABLE roles_projection IS 'Projection of role.created events - defines collections of permissions';
COMMENT ON COLUMN roles_projection.organization_id IS 'Internal organization UUID for JOINs (NULL for super_admin with global scope)';
COMMENT ON COLUMN roles_projection.org_hierarchy_scope IS 'ltree path for hierarchical scoping (NULL for super_admin)';
COMMENT ON CONSTRAINT roles_projection_scope_check ON roles_projection IS 'Ensures global role templates (super_admin, provider_admin, partner_admin) have NULL org scope, org-specific roles have org scope';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/rbac/003-role_permissions_projection.sql
-- ----------------------------------------------------------------------------

-- Role Permissions Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: role.permission.granted/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS role_permissions_projection (
  role_id UUID NOT NULL,
  permission_id UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (role_id, permission_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions_projection(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions_projection(permission_id);

-- Comments
COMMENT ON TABLE role_permissions_projection IS 'Projection of role.permission.* events - maps permissions to roles';
COMMENT ON COLUMN role_permissions_projection.granted_at IS 'Timestamp when permission was granted to role';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/rbac/004-user_roles_projection.sql
-- ----------------------------------------------------------------------------

-- User Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: user.role.assigned/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS user_roles_projection (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  org_id UUID,  -- NULL for super_admin global access, UUID for org-scoped roles
  scope_path LTREE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint with NULLS NOT DISTINCT (PostgreSQL 15+)
  -- Treats NULL as a distinct value, so (user, role, NULL) can only exist once
  -- This allows super_admin (org_id = NULL) to be assigned uniquely per user
  UNIQUE NULLS NOT DISTINCT (user_id, role_id, org_id),

  -- Constraint: global access (NULL org) requires NULL scope_path
  CHECK (
    (org_id IS NULL AND scope_path IS NULL)
    OR
    (org_id IS NOT NULL AND scope_path IS NOT NULL)
  )
);

-- Indexes for permission lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles_projection(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles_projection(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON user_roles_projection(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_scope_path ON user_roles_projection USING GIST(scope_path) WHERE scope_path IS NOT NULL;

-- Composite index for common authorization query pattern
CREATE INDEX IF NOT EXISTS idx_user_roles_auth_lookup ON user_roles_projection(user_id, org_id);

-- Comments
COMMENT ON TABLE user_roles_projection IS 'Projection of user.role.* events - assigns roles to users with org scoping';
COMMENT ON COLUMN user_roles_projection.org_id IS 'Organization UUID (NULL for super_admin global access, specific UUID for scoped roles)';
COMMENT ON COLUMN user_roles_projection.scope_path IS 'ltree hierarchy path for granular scoping (NULL for global access)';
COMMENT ON COLUMN user_roles_projection.assigned_at IS 'Timestamp when role was assigned to user';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/rbac/005-cross_tenant_access_grants_projection.sql
-- ----------------------------------------------------------------------------

-- Cross-Tenant Access Grants Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: access_grant.created/revoked events in domain_events table

CREATE TABLE IF NOT EXISTS cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_org_id UUID NOT NULL,
  consultant_user_id UUID,
  provider_org_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('full_org', 'facility', 'program', 'client_specific')),
  scope_id UUID,
  authorization_type TEXT NOT NULL CHECK (authorization_type IN ('var_contract', 'court_order', 'parental_consent', 'social_services_assignment', 'emergency_access')),
  legal_reference TEXT,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  permissions JSONB DEFAULT '[]'::JSONB,
  terms JSONB DEFAULT '{}'::JSONB,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'suspended')),
  
  -- Revocation fields
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revocation_reason TEXT,
  revocation_details TEXT,
  
  -- Expiration fields  
  expired_at TIMESTAMPTZ,
  expiration_type TEXT,
  
  -- Suspension fields
  suspended_at TIMESTAMPTZ,
  suspended_by UUID,
  suspension_reason TEXT,
  suspension_details TEXT,
  expected_resolution_date TIMESTAMPTZ,
  
  -- Reactivation fields
  reactivated_at TIMESTAMPTZ,
  reactivated_by UUID,
  resolution_details TEXT,
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint: facility, program, and client scopes require scope_id
  CHECK (
    (scope = 'full_org' AND scope_id IS NULL)
    OR
    (scope IN ('facility', 'program', 'client_specific') AND scope_id IS NOT NULL)
  )
);

-- Indexes for authorization lookups
CREATE INDEX IF NOT EXISTS idx_access_grants_consultant_org ON cross_tenant_access_grants_projection(consultant_org_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_consultant_user ON cross_tenant_access_grants_projection(consultant_user_id) WHERE consultant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_grants_provider_org ON cross_tenant_access_grants_projection(provider_org_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_scope ON cross_tenant_access_grants_projection(scope);
CREATE INDEX IF NOT EXISTS idx_access_grants_authorization_type ON cross_tenant_access_grants_projection(authorization_type);
CREATE INDEX IF NOT EXISTS idx_access_grants_status ON cross_tenant_access_grants_projection(status);

-- Composite index for common access check pattern (active grants)
CREATE INDEX IF NOT EXISTS idx_access_grants_lookup ON cross_tenant_access_grants_projection(consultant_org_id, provider_org_id, status)
  WHERE status = 'active';

-- Index for expiration cleanup and monitoring
CREATE INDEX IF NOT EXISTS idx_access_grants_expires ON cross_tenant_access_grants_projection(expires_at, status)
  WHERE expires_at IS NOT NULL AND status IN ('active', 'suspended');

-- Ensure suspension columns exist (for schema drift)
ALTER TABLE cross_tenant_access_grants_projection ADD COLUMN IF NOT EXISTS expected_resolution_date TIMESTAMPTZ;

-- Index for suspended grants monitoring
CREATE INDEX IF NOT EXISTS idx_access_grants_suspended ON cross_tenant_access_grants_projection(expected_resolution_date)
  WHERE status = 'suspended';

-- Index for audit queries by granter
CREATE INDEX IF NOT EXISTS idx_access_grants_granted_by ON cross_tenant_access_grants_projection(granted_by, granted_at);

-- Comments
COMMENT ON TABLE cross_tenant_access_grants_projection IS 'CQRS projection of access_grant.* events - enables provider_partner organizations to access provider data with full audit trail';
COMMENT ON COLUMN cross_tenant_access_grants_projection.consultant_org_id IS 'provider_partner organization requesting access (UUID format)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.consultant_user_id IS 'Specific user within consultant org (NULL for org-wide grant)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.provider_org_id IS 'Target provider organization owning the data (UUID format)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.scope IS 'Access scope level: full_org, facility, program, or client_specific';
COMMENT ON COLUMN cross_tenant_access_grants_projection.scope_id IS 'Specific resource UUID for facility, program, or client scope';
COMMENT ON COLUMN cross_tenant_access_grants_projection.authorization_type IS 'Legal/business basis: var_contract, court_order, parental_consent, social_services_assignment, emergency_access';
COMMENT ON COLUMN cross_tenant_access_grants_projection.legal_reference IS 'Reference to legal document, contract number, case number, etc.';
COMMENT ON COLUMN cross_tenant_access_grants_projection.permissions IS 'JSONB array of specific permissions granted (default: standard set for grant type)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.terms IS 'JSONB object with additional terms (read_only, data_retention_days, notification_required)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.status IS 'Current grant status: active, revoked, expired, suspended';
COMMENT ON COLUMN cross_tenant_access_grants_projection.expires_at IS 'Expiration timestamp for time-limited access (NULL for indefinite)';
COMMENT ON COLUMN cross_tenant_access_grants_projection.revoked_at IS 'Timestamp when grant was permanently revoked';
COMMENT ON COLUMN cross_tenant_access_grants_projection.suspended_at IS 'Timestamp when grant was temporarily suspended (can be reactivated)';


-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/users/indexes/idx_users_current_organization.sql
-- ----------------------------------------------------------------------------

-- Index on current_organization_id for filtering by organization context
CREATE INDEX IF NOT EXISTS idx_users_current_organization ON users(current_organization_id);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/users/indexes/idx_users_email.sql
-- ----------------------------------------------------------------------------

-- Index on email for user lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/users/indexes/idx_users_roles.sql
-- ----------------------------------------------------------------------------

-- GIN index on roles array for efficient role-based filtering
CREATE INDEX IF NOT EXISTS idx_users_roles ON users USING GIN(roles);

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/users/table.sql
-- ----------------------------------------------------------------------------

-- Users Table
-- Shadow table for Supabase Auth users, used for RLS and audit trails
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, -- Matches auth.users.id from Supabase Auth
  email TEXT NOT NULL,
  name TEXT,
  current_organization_id UUID,
  accessible_organizations UUID[], -- Array of organization IDs
  metadata JSONB DEFAULT '{}',
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE users IS 'Shadow table for Supabase Auth users, used for RLS and auditing';
COMMENT ON COLUMN users.id IS 'User UUID from Supabase Auth (auth.users.id)';
COMMENT ON COLUMN users.current_organization_id IS 'Currently selected organization context';
COMMENT ON COLUMN users.accessible_organizations IS 'Array of organization IDs user can access';

-- ----------------------------------------------------------------------------
-- Source: sql/02-tables/workflow_queue_projection/table.sql
-- ----------------------------------------------------------------------------

-- =====================================================================
-- WORKFLOW QUEUE PROJECTION TABLE
-- =====================================================================
-- Purpose: CQRS read model for workflow job queue
-- Pattern: Event-driven projection (updated via triggers)
-- Source: domain_events table (organization.bootstrap.initiated events)
-- Consumer: Temporal workers via Supabase Realtime subscription
--
-- CQRS Architecture:
-- - Write model: domain_events (immutable event store)
-- - Read model: workflow_queue_projection (mutable queue state)
-- - Updates: All status changes via events + triggers (strict CQRS)
--
-- Realtime Configuration:
-- - Added to supabase_realtime publication for worker subscriptions
-- - Workers filter: status=eq.pending to detect new jobs
-- - RLS policy: service_role can SELECT (workers use service_role key)
--
-- Status Lifecycle:
-- 1. pending    - Job created by trigger, awaiting worker claim
-- 2. processing - Worker claimed job via workflow.queue.claimed event
-- 3. completed  - Workflow succeeded via workflow.queue.completed event
-- 4. failed     - Workflow failed via workflow.queue.failed event
--
-- Related Events (see infrastructure/supabase/contracts/):
-- - workflow.queue.pending   - Creates new queue entry
-- - workflow.queue.claimed   - Updates to processing
-- - workflow.queue.completed - Updates to completed
-- - workflow.queue.failed    - Updates to failed
-- =====================================================================

-- Create workflow queue projection table (idempotent)
CREATE TABLE IF NOT EXISTS workflow_queue_projection (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event tracking (links to domain_events)
    event_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,

    -- Stream identification (from domain event)
    stream_id UUID NOT NULL,
    stream_type TEXT NOT NULL,

    -- Queue status
    status TEXT NOT NULL DEFAULT 'pending',

    -- Worker tracking
    worker_id TEXT,
    claimed_at TIMESTAMPTZ,

    -- Workflow tracking (Temporal)
    workflow_id TEXT,
    workflow_run_id TEXT,

    -- Completion tracking
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_message TEXT,
    error_stack TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Result storage
    result JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT workflow_queue_projection_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT workflow_queue_projection_event_id_unique
        UNIQUE (event_id)
);

-- Create indexes for query performance (idempotent)
CREATE INDEX IF NOT EXISTS workflow_queue_projection_status_idx
    ON workflow_queue_projection(status);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_event_type_idx
    ON workflow_queue_projection(event_type);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_stream_id_idx
    ON workflow_queue_projection(stream_id);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_created_at_idx
    ON workflow_queue_projection(created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_queue_projection_workflow_id_idx
    ON workflow_queue_projection(workflow_id)
    WHERE workflow_id IS NOT NULL;

-- Enable Row Level Security (required for Supabase)
ALTER TABLE workflow_queue_projection ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for service_role (workers)
DROP POLICY IF EXISTS "workflow_queue_projection_service_role_select"
    ON workflow_queue_projection;

CREATE POLICY "workflow_queue_projection_service_role_select"
    ON workflow_queue_projection
    FOR SELECT
    TO service_role
    USING (true);

-- Add table to Realtime publication (workers subscribe via Supabase Realtime)
DO $$
BEGIN
    -- Check if table is already in publication
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'workflow_queue_projection'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE workflow_queue_projection;
    END IF;
END $$;

-- Grant necessary permissions
GRANT SELECT ON workflow_queue_projection TO service_role;

-- Create updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION update_workflow_queue_projection_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at column (idempotent)
DROP TRIGGER IF EXISTS workflow_queue_projection_updated_at_trigger
    ON workflow_queue_projection;

CREATE TRIGGER workflow_queue_projection_updated_at_trigger
    BEFORE UPDATE ON workflow_queue_projection
    FOR EACH ROW
    EXECUTE FUNCTION update_workflow_queue_projection_updated_at();

-- Add comment for documentation
COMMENT ON TABLE workflow_queue_projection IS
    'CQRS projection: Workflow job queue for Temporal workers. '
    'Updated via triggers processing domain events. '
    'Workers subscribe via Supabase Realtime (filter: status=eq.pending).';


-- ============================================================================
-- SECTION: 03-functions
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/api/004-organization-queries.sql
-- ----------------------------------------------------------------------------

-- Organization Query RPC Functions for Frontend
-- These functions provide read access to organizations_projection via the 'api' schema
-- since PostgREST only exposes 'api' schema, not 'public' schema.
--
-- Matches frontend service: frontend/src/services/organization/SupabaseOrganizationQueryService.ts
-- Frontend calls: .schema('api').rpc('get_organizations', params)
--
-- IMPORTANT: Return columns MUST match actual database schema in:
-- infrastructure/supabase/sql/02-tables/organizations/001-organizations_projection.sql

-- Drop old function signatures to prevent ambiguity
DROP FUNCTION IF EXISTS api.get_organizations(TEXT, BOOLEAN, TEXT, TEXT);
DROP FUNCTION IF EXISTS api.get_organization_by_id(UUID);
DROP FUNCTION IF EXISTS api.get_child_organizations(UUID);

-- 1. Get organizations with optional filters
-- Maps to: SupabaseOrganizationQueryService.getOrganizations()
-- Frontend usage: Referring partner dropdown, organization lists
CREATE OR REPLACE FUNCTION api.get_organizations(
  p_type TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  slug TEXT,
  type TEXT,
  path TEXT,
  parent_path TEXT,
  timezone TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.slug,
    o.type::TEXT,
    o.path::TEXT,
    o.parent_path::TEXT,
    o.timezone,
    o.is_active,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE
    -- Filter by organization type (if provided and not 'all')
    (p_type IS NULL OR p_type = 'all' OR o.type::TEXT = p_type)
    -- Filter by active status (if provided and not 'all')
    AND (p_is_active IS NULL OR o.is_active = p_is_active)
    -- Search by name or slug (if provided)
    AND (
      p_search_term IS NULL
      OR o.name ILIKE '%' || p_search_term || '%'
      OR o.slug ILIKE '%' || p_search_term || '%'
    )
  ORDER BY o.name ASC;
END;
$$;

-- Grant execute to authenticated users (RLS policies on organizations_projection still apply)
GRANT EXECUTE ON FUNCTION api.get_organizations TO authenticated, service_role;

-- 2. Get single organization by ID
-- Maps to: SupabaseOrganizationQueryService.getOrganizationById()
-- Frontend usage: Organization detail pages
CREATE OR REPLACE FUNCTION api.get_organization_by_id(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  slug TEXT,
  type TEXT,
  path TEXT,
  parent_path TEXT,
  timezone TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.slug,
    o.type::TEXT,
    o.path::TEXT,
    o.parent_path::TEXT,
    o.timezone,
    o.is_active,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.id = p_org_id
  LIMIT 1;
END;
$$;

-- Grant execute to authenticated users (RLS policies on organizations_projection still apply)
GRANT EXECUTE ON FUNCTION api.get_organization_by_id TO authenticated, service_role;

-- 3. Get child organizations by parent org ID
-- Maps to: SupabaseOrganizationQueryService.getChildOrganizations()
-- Frontend usage: Organization hierarchy displays
CREATE OR REPLACE FUNCTION api.get_child_organizations(p_parent_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  display_name TEXT,
  slug TEXT,
  type TEXT,
  path TEXT,
  parent_path TEXT,
  timezone TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_path LTREE;
BEGIN
  -- Get parent's path first
  SELECT path INTO v_parent_path
  FROM organizations_projection
  WHERE id = p_parent_org_id;

  -- If parent not found, return empty
  IF v_parent_path IS NULL THEN
    RETURN;
  END IF;

  -- Find all children using ltree path matching
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.display_name,
    o.slug,
    o.type::TEXT,
    o.path::TEXT,
    o.parent_path::TEXT,
    o.timezone,
    o.is_active,
    o.created_at,
    o.updated_at
  FROM organizations_projection o
  WHERE o.parent_path = v_parent_path
  ORDER BY o.name ASC;
END;
$$;

-- Grant execute to authenticated users (RLS policies on organizations_projection still apply)
GRANT EXECUTE ON FUNCTION api.get_child_organizations TO authenticated, service_role;

-- Comment for documentation
COMMENT ON FUNCTION api.get_organizations IS 'Frontend RPC: Query organizations with optional filters (type, status, search). Returns actual database columns only.';
COMMENT ON FUNCTION api.get_organization_by_id IS 'Frontend RPC: Get single organization by UUID. Returns actual database columns only.';
COMMENT ON FUNCTION api.get_child_organizations IS 'Frontend RPC: Get child organizations by parent org UUID using ltree hierarchy.';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/api/emit_workflow_started_event.sql
-- ----------------------------------------------------------------------------

-- =====================================================
-- Function: Emit organization.bootstrap.workflow_started Event
-- =====================================================
-- Purpose: Records when event listener successfully starts a Temporal workflow
--
-- Called by: Event listener (workflow worker) after starting Temporal workflow
-- Event Type: organization.bootstrap.workflow_started
-- AsyncAPI Contract: infrastructure/supabase/contracts/organization-bootstrap-events.yaml
--
-- Architecture Pattern: Event Sourcing - Immutability
--   - Does NOT update existing domain_events (bootstrap.initiated)
--   - Creates NEW event to record workflow start
--   - Maintains complete audit trail
--
-- Author: A4C Infrastructure Team
-- Created: 2025-11-24
-- =====================================================

-- Drop existing function for idempotency
DROP FUNCTION IF EXISTS api.emit_workflow_started_event(UUID, UUID, TEXT, TEXT, TEXT);

-- Create function in api schema (accessible via Supabase RPC)
CREATE OR REPLACE FUNCTION api.emit_workflow_started_event(
  p_stream_id UUID,
  p_bootstrap_event_id UUID,
  p_workflow_id TEXT,
  p_workflow_run_id TEXT,
  p_workflow_type TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_stream_version INT;
BEGIN
  -- Validate inputs
  IF p_stream_id IS NULL THEN
    RAISE EXCEPTION 'stream_id cannot be null';
  END IF;

  IF p_bootstrap_event_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_event_id cannot be null';
  END IF;

  IF p_workflow_id IS NULL OR p_workflow_id = '' THEN
    RAISE EXCEPTION 'workflow_id cannot be null or empty';
  END IF;

  IF p_workflow_run_id IS NULL OR p_workflow_run_id = '' THEN
    RAISE EXCEPTION 'workflow_run_id cannot be null or empty';
  END IF;

  -- Get next version for this organization stream
  SELECT COALESCE(MAX(stream_version), 0) + 1
  INTO v_stream_version
  FROM public.domain_events
  WHERE stream_id = p_stream_id
    AND stream_type = 'organization';

  -- Insert workflow started event into domain_events
  INSERT INTO public.domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    created_at
  ) VALUES (
    p_stream_id,
    'organization',
    v_stream_version,
    'organization.bootstrap.workflow_started',
    jsonb_build_object(
      'bootstrap_event_id', p_bootstrap_event_id,
      'workflow_id', p_workflow_id,
      'workflow_run_id', p_workflow_run_id,
      'workflow_type', COALESCE(p_workflow_type, 'organizationBootstrapWorkflow')
    ),
    jsonb_build_object(
      'triggered_by', 'event_listener',
      'trigger_time', NOW()::TEXT
    ),
    NOW()
  )
  RETURNING id INTO v_event_id;

  -- Log success
  RAISE NOTICE 'Emitted organization.bootstrap.workflow_started event: % for workflow: %',
    v_event_id, p_workflow_id;

  RETURN v_event_id;

EXCEPTION
  WHEN OTHERS THEN
    -- Log error details
    RAISE WARNING 'Failed to emit workflow_started event: % - %', SQLERRM, SQLSTATE;
    -- Re-raise exception
    RAISE;
END;
$$;

-- =====================================================
-- Permissions
-- =====================================================
-- Grant execute permission to service_role (used by worker)
GRANT EXECUTE ON FUNCTION api.emit_workflow_started_event TO service_role;
GRANT EXECUTE ON FUNCTION api.emit_workflow_started_event TO postgres;

-- =====================================================
-- Documentation
-- =====================================================
COMMENT ON FUNCTION api.emit_workflow_started_event IS
  'Emits organization.bootstrap.workflow_started event after event listener starts Temporal workflow.

   Maintains event sourcing immutability by creating NEW event rather than updating existing event.

   Parameters:
     p_stream_id: Organization ID (stream_id from bootstrap.initiated event)
     p_bootstrap_event_id: ID of the organization.bootstrap.initiated event
     p_workflow_id: Temporal workflow ID (deterministic: org-bootstrap-{stream_id})
     p_workflow_run_id: Temporal workflow execution run ID
     p_workflow_type: Temporal workflow type name (default: organizationBootstrapWorkflow)

   Returns: UUID of the created workflow_started event

   Example Usage:
     SELECT api.emit_workflow_started_event(
       ''d8846196-8f69-46dc-af9a-87a57843c4e4'',
       ''b8309521-a46f-4d71-becb-1f138878425b'',
       ''org-bootstrap-d8846196-8f69-46dc-af9a-87a57843c4e4'',
       ''019ab7a4-a6bf-70a3-8394-7b09371e98ba'',
       ''organizationBootstrapWorkflow''
     );

   See: documentation/infrastructure/reference/events/organization-bootstrap-workflow-started.md';

-- =====================================================
-- Testing
-- =====================================================
-- Test 1: Verify function exists and has correct signature
-- SELECT routine_name, routine_type, data_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'api'
--   AND routine_name = 'emit_workflow_started_event';

-- Test 2: Verify permissions
-- SELECT grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_schema = 'api'
--   AND routine_name = 'emit_workflow_started_event';

-- Test 3: Test function with sample data
-- SELECT api.emit_workflow_started_event(
--   gen_random_uuid(),  -- stream_id
--   gen_random_uuid(),  -- bootstrap_event_id
--   'org-bootstrap-test',  -- workflow_id
--   'test-run-id',  -- workflow_run_id
--   'organizationBootstrapWorkflow'  -- workflow_type
-- );

-- Test 4: Verify event was created
-- SELECT id, event_type, event_data
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.workflow_started'
-- ORDER BY created_at DESC
-- LIMIT 1;


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/authorization/001-user_has_permission.sql
-- ----------------------------------------------------------------------------

-- User Permission Check Function
-- Queries CQRS projections to determine if a user has a specific permission
-- Supports both super_admin (global) and org-scoped permissions
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_permission_name TEXT,
  p_org_id UUID,
  p_scope_path LTREE DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id
      AND p.name = p_permission_name
      AND (
        -- Super admin: NULL org_id means global scope
        ur.org_id IS NULL
        OR
        -- Org-scoped: exact org match + hierarchical scope check
        (
          ur.org_id = p_org_id
          AND (
            -- No scope constraint specified
            p_scope_path IS NULL
            OR
            -- Scope within user's hierarchy
            -- User scope: org_123.facility_456
            -- Resource scope: org_123.facility_456.program_789
            -- Result: TRUE (user has access to descendants)
            p_scope_path <@ ur.scope_path
            OR
            -- Resource scope is within user's assigned scope
            ur.scope_path <@ p_scope_path
          )
        )
      )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION user_has_permission IS 'Checks if user has specified permission within given org/scope context';


-- Convenience function: Get all permissions for a user in an org
CREATE OR REPLACE FUNCTION user_permissions(
  p_user_id UUID,
  p_org_id UUID
) RETURNS TABLE (
  permission_name TEXT,
  applet TEXT,
  action TEXT,
  description TEXT,
  requires_mfa BOOLEAN,
  scope_type TEXT,
  role_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    p.name AS permission_name,
    p.applet,
    p.action,
    p.description,
    p.requires_mfa,
    p.scope_type,
    r.name AS role_name
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
  JOIN permissions_projection p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
    AND (
      ur.org_id IS NULL  -- Super admin sees all
      OR ur.org_id = p_org_id
    )
  ORDER BY p.applet, p.action;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION user_permissions IS 'Returns all permissions for a user within a specific organization';


-- Check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin(
  p_user_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'super_admin'
      AND ur.org_id IS NULL
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION is_super_admin IS 'Checks if user has super_admin role with global scope';


-- Check if user is provider admin for a specific org
CREATE OR REPLACE FUNCTION is_provider_admin(
  p_user_id UUID,
  p_org_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'provider_admin'
      AND ur.org_id = p_org_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION is_provider_admin IS 'Checks if user has provider_admin role for specific organization';


-- Get user's effective organizations (where they have any role)
CREATE OR REPLACE FUNCTION user_organizations(
  p_user_id UUID
) RETURNS TABLE (
  org_id UUID,
  role_name TEXT,
  scope_path LTREE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ur.org_id,
    r.name AS role_name,
    ur.scope_path
  FROM user_roles_projection ur
  JOIN roles_projection r ON r.id = ur.role_id
  WHERE ur.user_id = p_user_id
  ORDER BY ur.org_id, r.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION user_organizations IS 'Returns all organizations where user has assigned roles';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/authorization/002-authentication-helpers.sql
-- ----------------------------------------------------------------------------

-- Authentication Helper Functions
-- Provides JWT claims extraction and organization admin detection

-- ============================================================================
-- Current User ID Resolution
-- ============================================================================

-- Extract current user ID from JWT (Supabase Auth UUID format)
-- Supports testing override via app.current_user session variable
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_sub text;
BEGIN
  -- Check for testing override first
  BEGIN
    v_sub := current_setting('app.current_user', true);
    IF v_sub IS NOT NULL AND v_sub != '' THEN
      RETURN v_sub::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- No override set, continue to JWT extraction
  END;

  -- Extract 'sub' claim from JWT (Supabase Auth UUID format)
  v_sub := (auth.jwt()->>'sub')::text;

  IF v_sub IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_sub::uuid;
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_user_id IS
  'Extracts current user ID from JWT (Supabase Auth UUID format). Supports testing override via app.current_user setting.';


-- ============================================================================
-- JWT Custom Claims Extraction (Supabase Auth)
-- ============================================================================

-- Extract org_id from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT (auth.jwt()->>'org_id')::uuid;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_org_id IS
  'Extracts org_id from JWT custom claims (Supabase Auth)';


-- Extract user_role from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT auth.jwt()->>'user_role';
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_user_role IS
  'Extracts user_role from JWT custom claims (Supabase Auth)';


-- Extract permissions array from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_permissions()
RETURNS TEXT[]
LANGUAGE SQL
STABLE
AS $$
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(
      COALESCE(auth.jwt()->'permissions', '[]'::jsonb)
    )
  );
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_permissions IS
  'Extracts permissions array from JWT custom claims (Supabase Auth)';


-- Extract scope_path from JWT custom claims
CREATE OR REPLACE FUNCTION get_current_scope_path()
RETURNS LTREE
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN auth.jwt()->>'scope_path' IS NOT NULL
    THEN (auth.jwt()->>'scope_path')::ltree
    ELSE NULL
  END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_current_scope_path IS
  'Extracts scope_path from JWT custom claims (Supabase Auth)';


-- Check if current user has a specific permission
CREATE OR REPLACE FUNCTION has_permission(p_permission text)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT p_permission = ANY(get_current_permissions());
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION has_permission IS
  'Checks if current user has a specific permission in their JWT claims';


-- ============================================================================
-- Organization Admin Detection
-- ============================================================================

-- Check if user has provider_admin OR partner_admin role in organization
-- This is used by RLS policies to grant organizational administrative access
CREATE OR REPLACE FUNCTION is_org_admin(
  p_user_id UUID,
  p_org_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name IN ('provider_admin', 'partner_admin')
      AND ur.org_id = p_org_id
      AND r.deleted_at IS NULL
  );
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION is_org_admin IS
  'Returns true if user has provider_admin or partner_admin role in the specified organization';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql
-- ----------------------------------------------------------------------------

-- Supabase Auth JWT Custom Access Token Hook
-- Enriches JWT tokens with custom claims for RBAC and multi-tenant isolation
--
-- This hook is called by Supabase Auth when generating access tokens
-- It adds org_id, user_role, permissions, and scope_path to the JWT
--
-- Documentation: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook

-- ============================================================================
-- JWT Custom Claims Hook (Primary Entry Point)
-- ============================================================================
-- IMPORTANT: Hook MUST be in public schema for Supabase Auth to call it
-- See: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_user_record record;
  v_claims jsonb;
  v_org_id uuid;
  v_user_role text;
  v_permissions text[];
  v_scope_path text;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization and role information
  SELECT
    u.current_organization_id,
    COALESCE(
      (SELECT r.name
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      'viewer'
    ) as role,
    COALESCE(
      (SELECT ur.scope_path::text
       FROM public.user_roles_projection ur
       JOIN public.roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
       ORDER BY
         CASE
           WHEN r.name = 'super_admin' THEN 1
           WHEN r.name = 'provider_admin' THEN 2
           WHEN r.name = 'partner_admin' THEN 3
           ELSE 4
         END
       LIMIT 1
      ),
      NULL
    ) as scope
  INTO v_org_id, v_user_role, v_scope_path
  FROM public.users u
  WHERE u.id = v_user_id;

  -- If no organization context, check for super_admin role
  IF v_org_id IS NULL THEN
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.user_roles_projection ur
          JOIN public.roles_projection r ON r.id = ur.role_id
          WHERE ur.user_id = v_user_id
            AND r.name = 'super_admin'
            AND ur.org_id IS NULL
        ) THEN NULL  -- Super admin has NULL org_id (global scope)
        ELSE (
          SELECT o.id
          FROM public.organizations_projection o
          WHERE o.type = 'platform_owner'
          LIMIT 1
        )
      END
    INTO v_org_id;
  END IF;

  -- Get user's permissions for the organization
  -- Super admins get all permissions
  IF v_user_role = 'super_admin' THEN
    SELECT array_agg(p.name)
    INTO v_permissions
    FROM public.permissions_projection p;
  ELSE
    -- Get permissions via role grants
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM public.user_roles_projection ur
    JOIN public.role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN public.permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.org_id = v_org_id OR ur.org_id IS NULL);
  END IF;

  -- Default to empty array if no permissions
  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  -- Build custom claims by merging with existing claims
  -- CRITICAL: Preserve all standard JWT fields (aud, exp, iat, sub, email, phone, role, aal, session_id, is_anonymous)
  -- and add our custom claims (org_id, user_role, permissions, scope_path, claims_version)
  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'claims_version', 1
  );

  -- Return the updated claims object
  -- Supabase Auth expects: { "claims": { ... all standard JWT fields + custom fields ... } }
  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail authentication
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    -- Return minimal claims on error, preserving standard JWT fields
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', NULL,
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'claims_error', SQLERRM
      )
    );
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION public.custom_access_token_hook IS
  'Enriches Supabase Auth JWTs with custom claims: org_id, user_role, permissions, scope_path. Called automatically on token generation.';


-- ============================================================================
-- Helper Function: Switch Organization Context
-- ============================================================================

CREATE OR REPLACE FUNCTION public.switch_organization(
  p_new_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_has_access boolean;
  v_result jsonb;
BEGIN
  -- Get current authenticated user from Supabase Auth
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user has access to the requested organization
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_projection ur
    WHERE ur.user_id = v_user_id
      AND (ur.org_id = p_new_org_id OR ur.org_id IS NULL)  -- NULL for super_admin
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'User does not have access to organization %', p_new_org_id;
  END IF;

  -- Update user's current organization
  UPDATE public.users
  SET current_organization_id = p_new_org_id,
      updated_at = NOW()
  WHERE id = v_user_id;

  -- Return new organization context (client should refresh JWT)
  RETURN jsonb_build_object(
    'success', true,
    'org_id', p_new_org_id,
    'message', 'Organization context updated. Please refresh your session to get updated JWT claims.'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to switch organization: %', SQLERRM;
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION public.switch_organization IS
  'Updates user current organization context. Client must refresh JWT to get new claims.';


-- ============================================================================
-- Helper Function: Get User JWT Claims Preview
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_claims_preview(
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_result jsonb;
BEGIN
  -- Use provided user_id or current authenticated user
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated and no user_id provided';
  END IF;

  -- Simulate what the JWT hook would return
  SELECT auth.custom_access_token_hook(
    jsonb_build_object(
      'user_id', v_user_id::text,
      'claims', '{}'::jsonb
    )
  )->>'claims' INTO v_result;

  RETURN v_result;
END;
$$
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION public.get_user_claims_preview IS
  'Preview what JWT custom claims would be for a user (debugging/testing only)';


-- ============================================================================
-- Grant Permissions (Idempotent - GRANT statements can be run multiple times)
-- ============================================================================

-- Grant permissions for Supabase Auth to call the JWT hook
-- The supabase_auth_admin role is used by Supabase Auth to execute custom hooks
-- Note: These GRANT statements are idempotent and safe to run multiple times
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Grant read access to tables the JWT hook needs to query
-- The hook must be able to read user roles, permissions, and organization data
GRANT SELECT ON TABLE public.users TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.roles_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.organizations_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.permissions_projection TO supabase_auth_admin;
GRANT SELECT ON TABLE public.role_permissions_projection TO supabase_auth_admin;

-- Revoke execute from public roles for security
-- Only supabase_auth_admin should call the JWT hook function
-- Note: REVOKE is idempotent - safe to run even if privilege doesn't exist
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- Grant execute on helper functions to authenticated users
-- These are utility functions for user session management
GRANT EXECUTE ON FUNCTION public.switch_organization TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_claims_preview TO authenticated;


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/001-main-event-router.sql
-- ----------------------------------------------------------------------------

-- Main Event Router Function
-- Routes domain events to appropriate projection handlers
CREATE OR REPLACE FUNCTION process_domain_event()
RETURNS TRIGGER AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  v_start_time := clock_timestamp();

  -- Skip if already processed
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Check for junction events first (based on event_type pattern)
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      -- Route based on stream type
      CASE NEW.stream_type
        WHEN 'client' THEN
          PERFORM process_client_event(NEW);

        WHEN 'medication' THEN
          PERFORM process_medication_event(NEW);

        WHEN 'medication_history' THEN
          PERFORM process_medication_history_event(NEW);

        WHEN 'dosage' THEN
          PERFORM process_dosage_event(NEW);

        WHEN 'user' THEN
          PERFORM process_user_event(NEW);

        WHEN 'organization' THEN
          PERFORM process_organization_event(NEW);

        -- Organization child entities
        WHEN 'contact' THEN
          PERFORM process_contact_event(NEW);

        WHEN 'address' THEN
          PERFORM process_address_event(NEW);

        WHEN 'phone' THEN
          PERFORM process_phone_event(NEW);

        -- RBAC stream types
        WHEN 'permission' THEN
          PERFORM process_rbac_event(NEW);

        WHEN 'role' THEN
          PERFORM process_rbac_event(NEW);

        WHEN 'access_grant' THEN
          PERFORM process_access_grant_event(NEW);

        -- Impersonation stream type
        WHEN 'impersonation' THEN
          PERFORM process_impersonation_event(NEW);

        ELSE
          RAISE WARNING 'Unknown stream type: %', NEW.stream_type;
      END CASE;
    END IF;

    -- Mark as successfully processed
    NEW.processed_at = clock_timestamp();
    NEW.processing_error = NULL;

    -- Log processing time if it took too long (>100ms)
    IF (clock_timestamp() - v_start_time) > interval '100 milliseconds' THEN
      RAISE WARNING 'Event % took % to process',
        NEW.id,
        (clock_timestamp() - v_start_time);
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      -- Capture error details
      GET STACKED DIAGNOSTICS
        v_error_msg = MESSAGE_TEXT,
        v_error_detail = PG_EXCEPTION_DETAIL;

      -- Log error
      RAISE WARNING 'Failed to process event %: % - %',
        NEW.id,
        v_error_msg,
        v_error_detail;

      -- Update event with error info
      NEW.processing_error = format('Error: %s | Detail: %s', v_error_msg, v_error_detail);
      NEW.retry_count = COALESCE(NEW.retry_count, 0) + 1;

      -- Don't mark as processed so it can be retried
      NEW.processed_at = NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Helper function to get current state version for an entity
CREATE OR REPLACE FUNCTION get_entity_version(
  p_stream_id UUID,
  p_stream_type TEXT
) RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(stream_version), 0)
  FROM domain_events
  WHERE stream_id = p_stream_id
    AND stream_type = p_stream_type
    AND processed_at IS NOT NULL;
$$ LANGUAGE SQL STABLE
SET search_path = public, extensions, pg_temp;

-- Helper function to validate event sequence
CREATE OR REPLACE FUNCTION validate_event_sequence(
  p_event RECORD
) RETURNS BOOLEAN AS $$
DECLARE
  v_expected_version INTEGER;
BEGIN
  v_expected_version := get_entity_version(p_event.stream_id, p_event.stream_type) + 1;

  IF p_event.stream_version != v_expected_version THEN
    RAISE EXCEPTION 'Event version mismatch. Expected %, got %',
      v_expected_version,
      p_event.stream_version;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Function to safely extract and cast JSONB fields
CREATE OR REPLACE FUNCTION safe_jsonb_extract_text(
  p_data JSONB,
  p_key TEXT,
  p_default TEXT DEFAULT NULL
) RETURNS TEXT AS $$
  SELECT COALESCE(p_data->>p_key, p_default);
$$ LANGUAGE SQL IMMUTABLE
SET search_path = public, extensions, pg_temp;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_uuid(
  p_data JSONB,
  p_key TEXT,
  p_default UUID DEFAULT NULL
) RETURNS UUID AS $$
  SELECT COALESCE((p_data->>p_key)::UUID, p_default);
$$ LANGUAGE SQL IMMUTABLE
SET search_path = public, extensions, pg_temp;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_timestamp(
  p_data JSONB,
  p_key TEXT,
  p_default TIMESTAMPTZ DEFAULT NULL
) RETURNS TIMESTAMPTZ AS $$
  SELECT COALESCE((p_data->>p_key)::TIMESTAMPTZ, p_default);
$$ LANGUAGE SQL IMMUTABLE
SET search_path = public, extensions, pg_temp;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_date(
  p_data JSONB,
  p_key TEXT,
  p_default DATE DEFAULT NULL
) RETURNS DATE AS $$
  SELECT COALESCE((p_data->>p_key)::DATE, p_default);
$$ LANGUAGE SQL IMMUTABLE
SET search_path = public, extensions, pg_temp;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_boolean(
  p_data JSONB,
  p_key TEXT,
  p_default BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN AS $$
  SELECT COALESCE((p_data->>p_key)::BOOLEAN, p_default);
$$ LANGUAGE SQL IMMUTABLE
SET search_path = public, extensions, pg_temp;

-- Organization ID Resolution Functions
-- Extracts and validates organization UUIDs from event data

CREATE OR REPLACE FUNCTION safe_jsonb_extract_organization_id(
  p_data JSONB,
  p_key TEXT DEFAULT 'organization_id'
) RETURNS UUID AS $$
DECLARE
  v_value TEXT;
  v_uuid UUID;
BEGIN
  v_value := p_data->>p_key;

  -- Handle NULL or empty
  IF v_value IS NULL OR v_value = '' THEN
    RETURN NULL;
  END IF;

  -- Cast as UUID (all organization IDs are now UUIDs with Supabase Auth)
  BEGIN
    v_uuid := v_value::UUID;
    RETURN v_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE WARNING 'Invalid UUID format for organization_id: %', v_value;
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_domain_event IS 'Main router that processes domain events and projects them to 3NF tables';
COMMENT ON FUNCTION get_entity_version IS 'Gets the current version number for an entity stream';
COMMENT ON FUNCTION validate_event_sequence IS 'Ensures events are processed in order';
COMMENT ON FUNCTION safe_jsonb_extract_organization_id IS 'Extract organization_id from event data as UUID (Supabase Auth migration completed Oct 2025)';

-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/002-process-client-events.sql
-- ----------------------------------------------------------------------------

-- Process Client Events
-- Projects client-related events to the clients table
CREATE OR REPLACE FUNCTION process_client_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'client.registered' THEN
      INSERT INTO clients (
        id,
        organization_id,
        first_name,
        last_name,
        date_of_birth,
        gender,
        email,
        phone,
        address,
        emergency_contact,
        allergies,
        medical_conditions,
        blood_type,
        status,
        notes,
        metadata,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_date(p_event.event_data, 'date_of_birth'),
        safe_jsonb_extract_text(p_event.event_data, 'gender'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'phone'),
        COALESCE(p_event.event_data->'address', '{}'::JSONB),
        COALESCE(p_event.event_data->'emergency_contact', '{}'::JSONB),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'allergies', '[]'::JSONB)
        )),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'medical_conditions', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'blood_type'),
        'active',
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'client.admitted' THEN
      UPDATE clients
      SET
        admission_date = safe_jsonb_extract_date(p_event.event_data, 'admission_date'),
        status = 'active',
        metadata = metadata || jsonb_build_object(
          'admission_reason', safe_jsonb_extract_text(p_event.event_data, 'reason'),
          'facility_id', safe_jsonb_extract_text(p_event.event_data, 'facility_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.information_updated' THEN
      -- Apply partial updates from the changes object
      UPDATE clients
      SET
        first_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'first_name'),
          first_name
        ),
        last_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'last_name'),
          last_name
        ),
        email = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'email'),
          email
        ),
        phone = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'phone'),
          phone
        ),
        address = COALESCE(
          p_event.event_data->'changes'->'address',
          address
        ),
        emergency_contact = COALESCE(
          p_event.event_data->'changes'->'emergency_contact',
          emergency_contact
        ),
        allergies = CASE
          WHEN p_event.event_data->'changes' ? 'allergies' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'changes'->'allergies'))
          ELSE allergies
        END,
        medical_conditions = CASE
          WHEN p_event.event_data->'changes' ? 'medical_conditions' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'changes'->'medical_conditions'))
          ELSE medical_conditions
        END,
        blood_type = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'blood_type'),
          blood_type
        ),
        notes = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'notes'),
          notes
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.discharged' THEN
      UPDATE clients
      SET
        discharge_date = safe_jsonb_extract_date(p_event.event_data, 'discharge_date'),
        status = 'inactive',
        metadata = metadata || jsonb_build_object(
          'discharge_reason', safe_jsonb_extract_text(p_event.event_data, 'discharge_reason'),
          'discharge_notes', safe_jsonb_extract_text(p_event.event_data, 'notes')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.archived' THEN
      UPDATE clients
      SET
        status = 'archived',
        metadata = metadata || jsonb_build_object(
          'archive_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'archived_at', p_event.created_at
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown client event type: %', p_event.event_type;
  END CASE;

  -- Also record in audit log (with the reason!)
  INSERT INTO audit_log (
    organization_id,
    event_type,
    event_category,
    event_name,
    event_description,
    user_id,
    user_email,
    resource_type,
    resource_id,
    old_values,
    new_values,
    metadata
  ) VALUES (
    safe_jsonb_extract_organization_id(p_event.event_data),
    p_event.event_type,
    'data_change',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    safe_jsonb_extract_text(p_event.event_metadata, 'user_email'),
    'clients',
    p_event.stream_id,
    NULL, -- Could extract from previous events if needed
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_client_event IS 'Projects client events to the clients table and audit log';

-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/002-process-organization-events.sql
-- ----------------------------------------------------------------------------

-- Organization Event Processing Functions
-- Handles all organization lifecycle events with CQRS-compliant cascade logic
-- Source events: organization.* events in domain_events table

-- Main organization event processor
CREATE OR REPLACE FUNCTION process_organization_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_depth INTEGER;
  v_parent_type TEXT;
  v_deleted_path LTREE;
  v_role_record RECORD;
  v_child_org RECORD;
BEGIN
  CASE p_event.event_type
    
    -- Handle organization creation
    WHEN 'organization.created' THEN
      v_depth := nlevel((p_event.event_data->>'path')::LTREE);
      
      -- For sub-organizations, inherit parent type
      IF v_depth > 2 AND p_event.event_data->>'parent_path' IS NOT NULL THEN
        SELECT type INTO v_parent_type
        FROM organizations_projection 
        WHERE path = (p_event.event_data->>'parent_path')::LTREE;
        
        -- Override type with parent type for inheritance
        p_event.event_data := jsonb_set(p_event.event_data, '{type}', to_jsonb(v_parent_type));
      END IF;
      
      -- Insert into organizations projection
      -- Note: depth column is auto-generated from path via PostgreSQL generated column
      INSERT INTO organizations_projection (
        id, name, display_name, slug, type, path, parent_path,
        tax_number, phone_number, timezone, metadata, created_at,
        partner_type, referring_partner_id, subdomain_status
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        (p_event.event_data->>'path')::LTREE,
        CASE
          WHEN p_event.event_data ? 'parent_path'
          THEN (p_event.event_data->>'parent_path')::LTREE
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'tax_number'),
        safe_jsonb_extract_text(p_event.event_data, 'phone_number'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'America/New_York'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at,
        CASE
          WHEN p_event.event_data ? 'partner_type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'partner_type'))::partner_type
          ELSE NULL
        END,
        safe_jsonb_extract_uuid(p_event.event_data, 'referring_partner_id'),
        -- subdomain_status: set from event data if present, otherwise based on type/partner_type
        CASE
          WHEN p_event.event_data ? 'subdomain_status'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'subdomain_status'))::subdomain_status
          WHEN is_subdomain_required(
            safe_jsonb_extract_text(p_event.event_data, 'type'),
            CASE
              WHEN p_event.event_data ? 'partner_type'
              THEN (safe_jsonb_extract_text(p_event.event_data, 'partner_type'))::partner_type
              ELSE NULL
            END
          )
          THEN 'pending'::subdomain_status
          ELSE NULL
        END
      );

    -- Handle subdomain DNS record creation
    WHEN 'organization.subdomain.dns_created' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'verifying',
        cloudflare_record_id = safe_jsonb_extract_text(p_event.event_data, 'cloudflare_record_id'),
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{dns_record}',
          jsonb_build_object(
            'type', safe_jsonb_extract_text(p_event.event_data, 'dns_record_type'),
            'value', safe_jsonb_extract_text(p_event.event_data, 'dns_record_value'),
            'zone_id', safe_jsonb_extract_text(p_event.event_data, 'cloudflare_zone_id'),
            'created_at', p_event.created_at
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle successful subdomain verification
    WHEN 'organization.subdomain.verified' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'verified',
        dns_verified_at = (p_event.event_data->>'verified_at')::TIMESTAMPTZ,
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{verification}',
          jsonb_build_object(
            'method', safe_jsonb_extract_text(p_event.event_data, 'verification_method'),
            'attempts', (p_event.event_data->>'verification_attempts')::INTEGER,
            'verified_at', p_event.event_data->>'verified_at'
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle subdomain verification failure
    WHEN 'organization.subdomain.verification_failed' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'failed',
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{failure}',
          jsonb_build_object(
            'reason', safe_jsonb_extract_text(p_event.event_data, 'failure_reason'),
            'retry_count', (p_event.event_data->>'retry_count')::INTEGER,
            'will_retry', safe_jsonb_extract_boolean(p_event.event_data, 'will_retry'),
            'failed_at', p_event.created_at
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle business profile creation
    WHEN 'organization.business_profile.created' THEN
      INSERT INTO organization_business_profiles_projection (
        organization_id, organization_type, mailing_address, physical_address,
        provider_profile, partner_profile, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'organization_type'),
        p_event.event_data->'mailing_address',
        p_event.event_data->'physical_address',
        CASE 
          WHEN safe_jsonb_extract_text(p_event.event_data, 'organization_type') = 'provider'
          THEN p_event.event_data->'provider_profile'
          ELSE NULL
        END,
        CASE 
          WHEN safe_jsonb_extract_text(p_event.event_data, 'organization_type') = 'provider_partner'
          THEN p_event.event_data->'partner_profile'
          ELSE NULL
        END,
        p_event.created_at
      );

    -- Handle organization deactivation
    WHEN 'organization.deactivated' THEN
      -- Update organization status
      UPDATE organizations_projection 
      SET 
        is_active = false,
        deactivated_at = p_event.created_at,
        deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'deactivation_type'),
        updated_at = p_event.created_at
      WHERE 
        id = p_event.stream_id
        OR (
          safe_jsonb_extract_boolean(p_event.event_data, 'cascade_to_children')
          AND path <@ (SELECT path FROM organizations_projection WHERE id = p_event.stream_id)
        );

      -- If login is blocked, emit user session termination events
      IF safe_jsonb_extract_boolean(p_event.event_data, 'login_blocked') THEN
        -- This would emit user.session.terminated events
        -- Implementation depends on user session management system
        RAISE NOTICE 'Login blocked for organization %, would terminate user sessions', p_event.stream_id;
      END IF;

    -- Handle organization deletion (CQRS-compliant cascade via events)
    WHEN 'organization.deleted' THEN
      v_deleted_path := (p_event.event_data->>'deleted_path')::LTREE;
      
      -- Mark organization as deleted (logical delete)
      UPDATE organizations_projection 
      SET 
        deleted_at = p_event.created_at,
        deletion_reason = safe_jsonb_extract_text(p_event.event_data, 'deletion_strategy'),
        is_active = false,
        updated_at = p_event.created_at
      WHERE path::LTREE <@ v_deleted_path OR path = v_deleted_path;

      -- CQRS-COMPLIANT CASCADE: Emit role.deleted events for affected roles
      -- Only emit events, do NOT directly update role projections
      FOR v_role_record IN (
        SELECT id, name, org_hierarchy_scope 
        FROM roles_projection 
        WHERE 
          org_hierarchy_scope::LTREE <@ v_deleted_path         -- At or below deleted path
          OR v_deleted_path <@ org_hierarchy_scope::LTREE      -- Deleted path is child of role scope
      ) LOOP
        INSERT INTO domain_events (
          stream_id, stream_type, event_type, event_data, event_metadata, created_at
        ) VALUES (
          v_role_record.id,
          'role',
          'role.deleted',
          jsonb_build_object(
            'role_name', v_role_record.name,
            'org_hierarchy_scope', v_role_record.org_hierarchy_scope,
            'deletion_reason', 'organization_deleted',
            'organization_deletion_event_id', p_event.id
          ),
          jsonb_build_object(
            'user_id', p_event.event_metadata->>'user_id',
            'reason', format('Role %s deleted because organizational scope %s was deleted', 
                            v_role_record.name, v_role_record.org_hierarchy_scope),
            'automated', true
          ),
          p_event.created_at
        );
      END LOOP;

      -- Emit organization.deleted events for child organizations
      FOR v_child_org IN (
        SELECT id, path
        FROM organizations_projection
        WHERE path <@ v_deleted_path AND path != v_deleted_path AND deleted_at IS NULL
      ) LOOP
        INSERT INTO domain_events (
          stream_id, stream_type, event_type, event_data, event_metadata, created_at
        ) VALUES (
          v_child_org.id,
          'organization',
          'organization.deleted',
          jsonb_build_object(
            'organization_id', v_child_org.id,
            'deleted_path', v_child_org.path,
            'deletion_strategy', 'cascade_delete',
            'cascade_confirmed', true,
            'parent_deletion_event_id', p_event.id
          ),
          jsonb_build_object(
            'user_id', p_event.event_metadata->>'user_id',
            'reason', format('Child organization %s deleted due to parent organization deletion', v_child_org.path),
            'automated', true
          ),
          p_event.created_at
        );
      END LOOP;

    -- Handle organization reactivation
    WHEN 'organization.reactivated' THEN
      UPDATE organizations_projection 
      SET 
        is_active = true,
        deactivated_at = NULL,
        deactivation_reason = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle organization updates
    WHEN 'organization.updated' THEN
      UPDATE organizations_projection 
      SET 
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
        phone_number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'phone_number'), phone_number),
        timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle business profile updates
    WHEN 'organization.business_profile.updated' THEN
      UPDATE organization_business_profiles_projection 
      SET 
        mailing_address = COALESCE(p_event.event_data->'mailing_address', mailing_address),
        physical_address = COALESCE(p_event.event_data->'physical_address', physical_address),
        provider_profile = CASE 
          WHEN organization_type = 'provider' 
          THEN COALESCE(p_event.event_data->'provider_profile', provider_profile)
          ELSE provider_profile
        END,
        partner_profile = CASE 
          WHEN organization_type = 'provider_partner'
          THEN COALESCE(p_event.event_data->'partner_profile', partner_profile)
          ELSE partner_profile
        END,
        updated_at = p_event.created_at
      WHERE organization_id = p_event.stream_id;

    -- Handle bootstrap events (CQRS-compliant - no direct DB operations)
    WHEN 'organization.bootstrap.initiated' THEN
      -- Bootstrap initiation: Log and prepare for next stages
      -- Note: This event triggers the bootstrap orchestrator externally
      RAISE NOTICE 'Bootstrap initiated for org %, bootstrap_id: %',
        p_event.stream_id,
        p_event.event_data->>'bootstrap_id';

    WHEN 'organization.bootstrap.completed' THEN
      -- Bootstrap completion: Update organization metadata
      UPDATE organizations_projection 
      SET 
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{bootstrap}',
          jsonb_build_object(
            'bootstrap_id', p_event.event_data->>'bootstrap_id',
            'completed_at', p_event.created_at,
            'admin_role', p_event.event_data->>'admin_role_assigned',
            'permissions_granted', (p_event.event_data->>'permissions_granted')::INTEGER
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'organization.bootstrap.failed' THEN
      -- Bootstrap failure: Mark organization for cleanup if created
      UPDATE organizations_projection 
      SET 
        is_active = false,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{bootstrap}',
          jsonb_build_object(
            'bootstrap_id', p_event.event_data->>'bootstrap_id',
            'failed_at', p_event.created_at,
            'failure_stage', p_event.event_data->>'failure_stage',
            'error_message', p_event.event_data->>'error_message'
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'organization.bootstrap.cancelled' THEN
      -- Bootstrap cancellation: Final cleanup completed
      -- For cancelled bootstraps, organization may not exist in projection yet
      IF EXISTS (SELECT 1 FROM organizations_projection WHERE id = p_event.stream_id) THEN
        UPDATE organizations_projection 
        SET 
          deleted_at = p_event.created_at,
          deletion_reason = 'bootstrap_cancelled',
          is_active = false,
          metadata = jsonb_set(
            COALESCE(metadata, '{}'),
            '{bootstrap}',
            jsonb_build_object(
              'bootstrap_id', p_event.event_data->>'bootstrap_id',
              'cancelled_at', p_event.created_at,
              'cleanup_completed', p_event.event_data->>'cleanup_completed'
            )
          ),
          updated_at = p_event.created_at
        WHERE id = p_event.stream_id;
      END IF;

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Helper function to validate organization path hierarchy
CREATE OR REPLACE FUNCTION validate_organization_hierarchy(
  p_path LTREE,
  p_parent_path LTREE
) RETURNS BOOLEAN AS $$
BEGIN
  -- Root organizations (depth 2) should have no parent
  IF nlevel(p_path) = 2 THEN
    RETURN p_parent_path IS NULL;
  END IF;
  
  -- Sub-organizations must have valid parent
  IF nlevel(p_path) > 2 THEN
    IF p_parent_path IS NULL THEN
      RETURN false;
    END IF;
    
    -- Check that parent exists
    IF NOT EXISTS (SELECT 1 FROM organizations_projection WHERE path = p_parent_path) THEN
      RETURN false;
    END IF;
    
    -- Check that path is properly nested under parent
    RETURN p_path <@ p_parent_path;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to get organization hierarchy for queries
CREATE OR REPLACE FUNCTION get_organization_descendants(
  p_org_path LTREE
) RETURNS TABLE (
  id UUID,
  name TEXT,
  path LTREE,
  depth INTEGER,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.name, o.path, o.depth, o.is_active
  FROM organizations_projection o
  WHERE o.path <@ p_org_path
    AND o.deleted_at IS NULL
  ORDER BY o.path;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to get organization ancestors
CREATE OR REPLACE FUNCTION get_organization_ancestors(
  p_org_path LTREE
) RETURNS TABLE (
  id UUID,
  name TEXT,
  path LTREE,
  depth INTEGER,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.name, o.path, o.depth, o.is_active
  FROM organizations_projection o
  WHERE p_org_path <@ o.path
    AND o.deleted_at IS NULL
  ORDER BY o.depth;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION process_organization_event IS 
  'Main organization event processor - handles creation, updates, deactivation, deletion with CQRS-compliant cascade logic';
COMMENT ON FUNCTION validate_organization_hierarchy IS 
  'Validates that organization path structure follows ltree hierarchy rules';
COMMENT ON FUNCTION get_organization_descendants IS 
  'Returns all active descendant organizations for a given organization path';
COMMENT ON FUNCTION get_organization_ancestors IS 
  'Returns all ancestor organizations for a given organization path';

-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/003-process-medication-events.sql
-- ----------------------------------------------------------------------------

-- Process Medication Events
-- Projects medication-related events to medications, medication_history, and dosage_info tables
CREATE OR REPLACE FUNCTION process_medication_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'medication.added_to_formulary' THEN
      INSERT INTO medications (
        id,
        organization_id,
        name,
        generic_name,
        brand_names,
        rxnorm_cui,
        ndc_codes,
        category_broad,
        category_specific,
        drug_class,
        is_psychotropic,
        is_controlled,
        controlled_substance_schedule,
        is_narcotic,
        requires_monitoring,
        is_high_alert,
        active_ingredients,
        available_forms,
        available_strengths,
        manufacturer,
        warnings,
        black_box_warning,
        metadata,
        is_active,
        is_formulary,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'generic_name'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'brand_names', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'rxnorm_cui'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'ndc_codes', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'category_broad'),
        safe_jsonb_extract_text(p_event.event_data, 'category_specific'),
        safe_jsonb_extract_text(p_event.event_data, 'drug_class'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_psychotropic', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_controlled', false),
        safe_jsonb_extract_text(p_event.event_data, 'controlled_substance_schedule'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_narcotic', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'requires_monitoring', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_high_alert', false),
        COALESCE(p_event.event_data->'active_ingredients', '[]'::JSONB),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'available_forms', '[]'::JSONB)
        )),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'available_strengths', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'manufacturer'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'warnings', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'black_box_warning'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        true,
        true,
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'medication.updated' THEN
      -- Apply updates to medication catalog
      UPDATE medications
      SET
        name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'name'),
          name
        ),
        warnings = CASE
          WHEN p_event.event_data ? 'warnings' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'warnings'))
          ELSE warnings
        END,
        black_box_warning = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'black_box_warning'),
          black_box_warning
        ),
        is_formulary = COALESCE(
          safe_jsonb_extract_boolean(p_event.event_data, 'is_formulary'),
          is_formulary
        ),
        metadata = metadata || COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.removed_from_formulary' THEN
      UPDATE medications
      SET
        is_formulary = false,
        is_active = false,
        metadata = metadata || jsonb_build_object(
          'removal_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'removed_at', p_event.created_at
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown medication event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Process Medication History Events
CREATE OR REPLACE FUNCTION process_medication_history_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'medication.prescribed' THEN
      INSERT INTO medication_history (
        id,
        organization_id,
        client_id,
        medication_id,
        prescription_date,
        start_date,
        end_date,
        prescriber_name,
        prescriber_npi,
        prescriber_license,
        dosage_amount,
        dosage_unit,
        dosage_form,
        frequency,
        timings,
        food_conditions,
        special_restrictions,
        route,
        instructions,
        is_prn,
        prn_reason,
        status,
        refills_authorized,
        refills_used,
        pharmacy_name,
        pharmacy_phone,
        rx_number,
        inventory_quantity,
        inventory_unit,
        notes,
        metadata,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_id'),
        safe_jsonb_extract_date(p_event.event_data, 'prescription_date'),
        safe_jsonb_extract_date(p_event.event_data, 'start_date'),
        safe_jsonb_extract_date(p_event.event_data, 'end_date'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_name'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_npi'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_license'),
        (p_event.event_data->>'dosage_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'dosage_unit'),
        safe_jsonb_extract_text(p_event.event_data, 'dosage_form'),
        CASE
          WHEN jsonb_typeof(p_event.event_data->'frequency') = 'array'
          THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'frequency')), ', ')
          ELSE safe_jsonb_extract_text(p_event.event_data, 'frequency')
        END,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'timings', '[]'::JSONB))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'food_conditions', '[]'::JSONB))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'special_restrictions', '[]'::JSONB))),
        safe_jsonb_extract_text(p_event.event_data, 'route'),
        safe_jsonb_extract_text(p_event.event_data, 'instructions'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_prn', false),
        safe_jsonb_extract_text(p_event.event_data, 'prn_reason'),
        'active',
        COALESCE((p_event.event_data->>'refills_authorized')::INTEGER, 0),
        0,
        safe_jsonb_extract_text(p_event.event_data, 'pharmacy_name'),
        safe_jsonb_extract_text(p_event.event_data, 'pharmacy_phone'),
        safe_jsonb_extract_text(p_event.event_data, 'rx_number'),
        COALESCE((p_event.event_data->>'inventory_quantity')::DECIMAL, 0),
        safe_jsonb_extract_text(p_event.event_data, 'inventory_unit'),
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        jsonb_build_object(
          'prescription_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'approvals', p_event.event_metadata->'approval_chain',
          'medication_name', safe_jsonb_extract_text(p_event.event_data, 'medication_name'),
          'source', safe_jsonb_extract_text(p_event.event_metadata, 'source'),
          'controlled_substance', safe_jsonb_extract_boolean(p_event.event_metadata, 'controlled_substance', false),
          'therapeutic_purpose', safe_jsonb_extract_text(p_event.event_metadata, 'therapeutic_purpose')
        ),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'medication.refilled' THEN
      UPDATE medication_history
      SET
        refills_used = refills_used + 1,
        last_filled_date = safe_jsonb_extract_date(p_event.event_data, 'filled_date'),
        pharmacy_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'pharmacy_name'),
          pharmacy_name
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.discontinued' THEN
      UPDATE medication_history
      SET
        discontinue_date = safe_jsonb_extract_date(p_event.event_data, 'discontinue_date'),
        discontinue_reason = safe_jsonb_extract_text(p_event.event_data, 'reason'),
        status = 'discontinued',
        metadata = metadata || jsonb_build_object(
          'discontinue_details', p_event.event_metadata,
          'discontinued_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.modified' THEN
      -- Handle dosage or frequency changes
      UPDATE medication_history
      SET
        dosage_amount = COALESCE(
          (p_event.event_data->>'dosage_amount')::DECIMAL,
          dosage_amount
        ),
        dosage_unit = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'dosage_unit'),
          dosage_unit
        ),
        frequency = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'frequency'),
          frequency
        ),
        instructions = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'instructions'),
          instructions
        ),
        metadata = metadata || jsonb_build_object(
          'modification_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'modified_at', p_event.created_at,
          'modified_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown medication history event type: %', p_event.event_type;
  END CASE;

  -- Record in audit log
  INSERT INTO audit_log (
    organization_id,
    event_type,
    event_category,
    event_name,
    event_description,
    user_id,
    resource_type,
    resource_id,
    new_values,
    metadata
  ) VALUES (
    safe_jsonb_extract_organization_id(p_event.event_data),
    p_event.event_type,
    'medication_management',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    'medication_history',
    p_event.stream_id,
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Process Dosage Events
CREATE OR REPLACE FUNCTION process_dosage_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'medication.administered' THEN
      INSERT INTO dosage_info (
        id,
        organization_id,
        medication_history_id,
        client_id,
        scheduled_datetime,
        administered_datetime,
        administered_by,
        scheduled_amount,
        administered_amount,
        unit,
        status,
        administration_notes,
        vitals_before,
        vitals_after,
        side_effects_observed,
        metadata,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_history_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'scheduled_datetime'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'administered_at'),
        safe_jsonb_extract_uuid(p_event.event_data, 'administered_by'),
        (p_event.event_data->>'scheduled_amount')::DECIMAL,
        (p_event.event_data->>'administered_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'unit'),
        'administered',
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        p_event.event_data->'vitals_before',
        p_event.event_data->'vitals_after',
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'side_effects', '[]'::JSONB)
        )),
        jsonb_build_object(
          'administration_method', safe_jsonb_extract_text(p_event.event_data, 'method'),
          'witness', safe_jsonb_extract_text(p_event.event_data, 'witnessed_by')
        ),
        p_event.created_at
      );

    WHEN 'medication.skipped', 'medication.refused' THEN
      INSERT INTO dosage_info (
        id,
        organization_id,
        medication_history_id,
        client_id,
        scheduled_datetime,
        scheduled_amount,
        unit,
        status,
        skip_reason,
        refusal_reason,
        metadata,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_history_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'scheduled_datetime'),
        (p_event.event_data->>'scheduled_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'unit'),
        CASE p_event.event_type
          WHEN 'medication.skipped' THEN 'skipped'
          WHEN 'medication.refused' THEN 'refused'
        END,
        safe_jsonb_extract_text(p_event.event_data, 'skip_reason'),
        safe_jsonb_extract_text(p_event.event_data, 'refusal_reason'),
        jsonb_build_object(
          'recorded_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
          'reason_details', safe_jsonb_extract_text(p_event.event_metadata, 'reason')
        ),
        p_event.created_at
      );

    ELSE
      RAISE WARNING 'Unknown dosage event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_medication_event IS 'Projects medication catalog events to the medications table';
COMMENT ON FUNCTION process_medication_history_event IS 'Projects prescription events to the medication_history table';
COMMENT ON FUNCTION process_dosage_event IS 'Projects administration events to the dosage_info table';

-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/004-process-rbac-events.sql
-- ----------------------------------------------------------------------------

-- Process RBAC Events
-- Projects RBAC-related events to permission, role, and access grant projection tables
CREATE OR REPLACE FUNCTION process_rbac_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    -- ========================================
    -- Permission Events
    -- ========================================
    WHEN 'permission.defined' THEN
      INSERT INTO permissions_projection (
        id,
        applet,
        action,
        description,
        scope_type,
        requires_mfa,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'applet'),
        safe_jsonb_extract_text(p_event.event_data, 'action'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        safe_jsonb_extract_text(p_event.event_data, 'scope_type'),
        COALESCE((p_event.event_data->>'requires_mfa')::BOOLEAN, FALSE),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    -- ========================================
    -- Role Events
    -- ========================================
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (
        id,
        name,
        description,
        organization_id,
        org_hierarchy_scope,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        -- organization_id comes directly from event_data (NULL for super_admin)
        CASE
          WHEN p_event.event_data->>'organization_id' IS NOT NULL
          THEN (p_event.event_data->>'organization_id')::UUID
          ELSE NULL
        END,
        CASE
          WHEN p_event.event_data->>'org_hierarchy_scope' IS NOT NULL
          THEN (p_event.event_data->>'org_hierarchy_scope')::LTREE
          ELSE NULL
        END,
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'role.updated' THEN
      UPDATE roles_projection
      SET description = safe_jsonb_extract_text(p_event.event_data, 'description'),
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'role.deleted' THEN
      UPDATE roles_projection
      SET deleted_at = p_event.created_at,
          is_active = false,
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'role.permission.granted' THEN
      INSERT INTO role_permissions_projection (
        role_id,
        permission_id,
        granted_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'permission_id'),
        p_event.created_at
      )
      ON CONFLICT (role_id, permission_id) DO NOTHING;  -- Idempotent

    WHEN 'role.permission.revoked' THEN
      DELETE FROM role_permissions_projection
      WHERE role_id = p_event.stream_id
        AND permission_id = safe_jsonb_extract_uuid(p_event.event_data, 'permission_id');

    -- ========================================
    -- User Role Events
    -- ========================================
    WHEN 'user.role.assigned' THEN
      INSERT INTO user_roles_projection (
        user_id,
        role_id,
        org_id,
        scope_path,
        assigned_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'role_id'),
        -- Convert org_id: '*' becomes NULL, otherwise resolve to UUID
        CASE
          WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') = '*' THEN NULL
          WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') IS NOT NULL
          THEN safe_jsonb_extract_uuid(p_event.event_data, 'org_id')
          ELSE NULL
        END,
        CASE
          WHEN p_event.event_data->>'scope_path' = '*' THEN NULL
          WHEN p_event.event_data->>'scope_path' IS NOT NULL
          THEN (p_event.event_data->>'scope_path')::LTREE
          ELSE NULL
        END,
        p_event.created_at
      )
      ON CONFLICT (user_id, role_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::UUID)) DO NOTHING;  -- Idempotent

    WHEN 'user.role.revoked' THEN
      DELETE FROM user_roles_projection
      WHERE user_id = p_event.stream_id
        AND role_id = safe_jsonb_extract_uuid(p_event.event_data, 'role_id')
        AND COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::UUID) = COALESCE(
          CASE
            WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') = '*' THEN NULL
            WHEN safe_jsonb_extract_text(p_event.event_data, 'org_id') IS NOT NULL
            THEN safe_jsonb_extract_uuid(p_event.event_data, 'org_id')
            ELSE NULL
          END,
          '00000000-0000-0000-0000-000000000000'::UUID
        );

    -- ========================================
    -- Cross-Tenant Access Grant Events
    -- ========================================
    WHEN 'access_grant.created' THEN
      INSERT INTO cross_tenant_access_grants_projection (
        id,
        consultant_org_id,
        consultant_user_id,
        provider_org_id,
        scope,
        scope_id,
        granted_by,
        granted_at,
        expires_at,
        revoked_at,
        authorization_type,
        legal_reference,
        metadata
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at,
        CASE
          WHEN p_event.event_data->>'expires_at' IS NOT NULL
          THEN (p_event.event_data->>'expires_at')::TIMESTAMPTZ
          ELSE NULL
        END,
        NULL,  -- revoked_at initially NULL
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB)
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'access_grant.revoked' THEN
      UPDATE cross_tenant_access_grants_projection
      SET revoked_at = p_event.created_at,
          metadata = metadata || jsonb_build_object(
            'revocation_reason', safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
            'revoked_by', safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by')
          )
      WHERE id = safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');

    ELSE
      RAISE WARNING 'Unknown RBAC event type: %', p_event.event_type;
  END CASE;

  -- Also record in audit log (with the reason!)
  INSERT INTO audit_log (
    organization_id,
    event_type,
    event_category,
    event_name,
    event_description,
    user_id,
    user_email,
    resource_type,
    resource_id,
    old_values,
    new_values,
    metadata
  ) VALUES (
    CASE
      WHEN p_event.event_type LIKE 'access_grant.%' THEN
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id')
      WHEN p_event.event_type LIKE 'user.role.%' THEN
        safe_jsonb_extract_uuid(p_event.event_data, 'org_id')
      ELSE
        NULL  -- Permissions and roles are global
    END,
    p_event.event_type,
    'authorization_change',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    safe_jsonb_extract_text(p_event.event_metadata, 'user_email'),
    p_event.stream_type,
    p_event.stream_id,
    NULL,  -- Could extract from previous events if needed
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_rbac_event IS 'Projects RBAC events to permission, role, user_role, and access_grant projection tables with full audit trail';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/005-process-impersonation-events.sql
-- ----------------------------------------------------------------------------

-- Impersonation Event Processor
-- Projects impersonation domain events to impersonation_sessions_projection
-- Handles: impersonation.started, impersonation.renewed, impersonation.ended

CREATE OR REPLACE FUNCTION process_impersonation_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_session_id TEXT;
  v_super_admin_user_id UUID;
  v_target_user_id UUID;
  v_previous_expires_at TIMESTAMPTZ;
  v_total_duration INTEGER;
BEGIN
  -- Extract common fields
  v_session_id := p_event.event_data->>'session_id';

  CASE p_event.event_type
    -- ========================================
    -- Impersonation Started
    -- ========================================
    WHEN 'impersonation.started' THEN
      INSERT INTO impersonation_sessions_projection (
        session_id,
        super_admin_user_id,
        super_admin_email,
        super_admin_name,
        super_admin_org_id,
        target_user_id,
        target_email,
        target_name,
        target_org_id,
        target_org_name,
        target_org_type,
        justification_reason,
        justification_reference_id,
        justification_notes,
        status,
        started_at,
        expires_at,
        duration_ms,
        total_duration_ms,
        renewal_count,
        actions_performed,
        ip_address,
        user_agent,
        created_at,
        updated_at
      ) VALUES (
        v_session_id,
        -- Super Admin
        (p_event.event_data->'super_admin'->>'user_id')::UUID,
        p_event.event_data->'super_admin'->>'email',
        p_event.event_data->'super_admin'->>'name',
        -- Super admin org_id: NULL for platform super_admin, UUID for org-scoped admin
        CASE
          WHEN p_event.event_data->'super_admin'->>'org_id' IS NULL THEN NULL
          WHEN p_event.event_data->'super_admin'->>'org_id' = '*' THEN NULL
          ELSE (p_event.event_data->'super_admin'->>'org_id')::UUID
        END,
        -- Target
        (p_event.event_data->'target'->>'user_id')::UUID,
        p_event.event_data->'target'->>'email',
        p_event.event_data->'target'->>'name',
        -- Target org_id (UUID format from Supabase Auth)
        (p_event.event_data->'target'->>'org_id')::UUID,
        p_event.event_data->'target'->>'org_name',
        p_event.event_data->'target'->>'org_type',
        -- Justification
        p_event.event_data->'justification'->>'reason',
        p_event.event_data->'justification'->>'reference_id',
        p_event.event_data->'justification'->>'notes',
        -- Session
        'active',
        NOW(),
        (p_event.event_data->'session_config'->>'expires_at')::TIMESTAMPTZ,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,  -- total = initial on start
        0,  -- renewal_count
        0,  -- actions_performed (tracked on end)
        -- Metadata
        p_event.event_data->>'ip_address',
        p_event.event_data->>'user_agent',
        p_event.created_at,
        p_event.created_at
      )
      ON CONFLICT (session_id) DO NOTHING;  -- Idempotent

    -- ========================================
    -- Impersonation Renewed
    -- ========================================
    WHEN 'impersonation.renewed' THEN
      -- Get previous expiration and calculate new total duration
      SELECT
        expires_at,
        total_duration_ms + (
          (p_event.event_data->>'new_expires_at')::TIMESTAMPTZ -
          (p_event.event_data->>'previous_expires_at')::TIMESTAMPTZ
        ) / 1000
      INTO v_previous_expires_at, v_total_duration
      FROM impersonation_sessions_projection
      WHERE session_id = v_session_id;

      UPDATE impersonation_sessions_projection
      SET
        expires_at = (p_event.event_data->>'new_expires_at')::TIMESTAMPTZ,
        total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
        renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
        updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation renewal event for non-existent session: %', v_session_id;
      END IF;

    -- ========================================
    -- Impersonation Ended
    -- ========================================
    WHEN 'impersonation.ended' THEN
      UPDATE impersonation_sessions_projection
      SET
        status = CASE
          WHEN p_event.event_data->>'reason' = 'timeout' THEN 'expired'
          ELSE 'ended'
        END,
        ended_at = (p_event.event_data->'summary'->>'ended_at')::TIMESTAMPTZ,
        ended_reason = p_event.event_data->>'reason',
        ended_by_user_id = (p_event.event_data->>'ended_by')::UUID,
        total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
        renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
        actions_performed = (p_event.event_data->>'actions_performed')::INTEGER,
        updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation end event for non-existent session: %', v_session_id;
      END IF;

    ELSE
      RAISE WARNING 'Unknown impersonation event type: %', p_event.event_type;
  END CASE;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error processing impersonation event %: % (Event ID: %)',
      p_event.event_type,
      SQLERRM,
      p_event.id;
    RAISE;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_impersonation_event IS 'Projects impersonation domain events (impersonation.started, impersonation.renewed, impersonation.ended) to impersonation_sessions_projection table';


-- ========================================
-- Helper Functions for Impersonation
-- ========================================

-- Get active impersonation sessions for a user (either as super admin or target)
CREATE OR REPLACE FUNCTION get_user_active_impersonation_sessions(
  p_user_id UUID
) RETURNS TABLE (
  session_id TEXT,
  super_admin_email TEXT,
  target_email TEXT,
  target_org_name TEXT,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  renewal_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    isp.session_id,
    isp.super_admin_email,
    isp.target_email,
    isp.target_org_name,
    isp.started_at,
    isp.expires_at,
    isp.renewal_count
  FROM impersonation_sessions_projection isp
  WHERE isp.status = 'active'
    AND (isp.super_admin_user_id = p_user_id OR isp.target_user_id = p_user_id)
  ORDER BY isp.started_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_user_active_impersonation_sessions IS 'Returns all active impersonation sessions for a user (as super admin or target)';


-- Get impersonation audit trail for an organization
CREATE OR REPLACE FUNCTION get_org_impersonation_audit(
  p_org_id UUID,  -- Internal org UUID
  p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  session_id TEXT,
  super_admin_email TEXT,
  target_email TEXT,
  justification_reason TEXT,
  justification_reference_id TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  total_duration_ms INTEGER,
  renewal_count INTEGER,
  actions_performed INTEGER,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    isp.session_id,
    isp.super_admin_email,
    isp.target_email,
    isp.justification_reason,
    isp.justification_reference_id,
    isp.started_at,
    isp.ended_at,
    isp.total_duration_ms,
    isp.renewal_count,
    isp.actions_performed,
    isp.status
  FROM impersonation_sessions_projection isp
  WHERE isp.target_org_id = p_org_id
    AND isp.started_at BETWEEN p_start_date AND p_end_date
  ORDER BY isp.started_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_org_impersonation_audit IS 'Returns impersonation audit trail for an organization within a date range (default: last 30 days)';


-- Check if a session is currently active
CREATE OR REPLACE FUNCTION is_impersonation_session_active(
  p_session_id TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM impersonation_sessions_projection
    WHERE session_id = p_session_id
      AND status = 'active'
      AND expires_at > NOW()
  );
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION is_impersonation_session_active IS 'Checks if an impersonation session is currently active and not expired';


-- Get session details for Redis sync
CREATE OR REPLACE FUNCTION get_impersonation_session_details(
  p_session_id TEXT
) RETURNS TABLE (
  session_id TEXT,
  super_admin_user_id UUID,
  target_user_id UUID,
  target_org_id UUID,  -- Internal UUID
  expires_at TIMESTAMPTZ,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    isp.session_id,
    isp.super_admin_user_id,
    isp.target_user_id,
    isp.target_org_id,
    isp.expires_at,
    isp.status
  FROM impersonation_sessions_projection isp
  WHERE isp.session_id = p_session_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_impersonation_session_details IS 'Returns impersonation session details for Redis cache synchronization';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/006-process-access-grant-events.sql
-- ----------------------------------------------------------------------------

-- Access Grant Event Processing Functions
-- Handles cross-tenant access grant lifecycle events with CQRS compliance
-- Source events: access_grant.* events in domain_events table

-- Main access grant event processor
CREATE OR REPLACE FUNCTION process_access_grant_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_grant_id UUID;
BEGIN
  CASE p_event.event_type
    
    -- Handle access grant creation
    WHEN 'access_grant.created' THEN
      -- CQRS-compliant: Insert into projection (only from events)
      INSERT INTO cross_tenant_access_grants_projection (
        id,
        consultant_org_id,
        consultant_user_id,
        provider_org_id,
        scope,
        scope_id,
        authorization_type,
        legal_reference,
        granted_by,
        granted_at,
        expires_at,
        permissions,
        terms,
        status,
        created_at,
        updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        safe_jsonb_extract_uuid(p_event.event_data, 'granted_by'),
        p_event.created_at,
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        COALESCE(p_event.event_data->'permissions', '[]'::jsonb),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    -- Handle access grant revocation  
    WHEN 'access_grant.revoked' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to revoked status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'revoked',
        revoked_at = p_event.created_at,
        revoked_by = safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by'),
        revocation_reason = safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
        revocation_details = safe_jsonb_extract_text(p_event.event_data, 'revocation_details'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant expiration
    WHEN 'access_grant.expired' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to expired status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'expired',
        expired_at = p_event.created_at,
        expiration_type = safe_jsonb_extract_text(p_event.event_data, 'expiration_type'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant suspension
    WHEN 'access_grant.suspended' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection to suspended status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'suspended',
        suspended_at = p_event.created_at,
        suspended_by = safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
        suspension_reason = safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
        suspension_details = safe_jsonb_extract_text(p_event.event_data, 'suspension_details'),
        expected_resolution_date = safe_jsonb_extract_timestamp(p_event.event_data, 'expected_resolution_date'),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    -- Handle access grant reactivation
    WHEN 'access_grant.reactivated' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      
      -- Update projection back to active status
      UPDATE cross_tenant_access_grants_projection 
      SET 
        status = 'active',
        suspended_at = NULL,
        suspended_by = NULL,
        suspension_reason = NULL,
        suspension_details = NULL,
        expected_resolution_date = NULL,
        reactivated_at = p_event.created_at,
        reactivated_by = safe_jsonb_extract_uuid(p_event.event_data, 'reactivated_by'),
        resolution_details = safe_jsonb_extract_text(p_event.event_data, 'resolution_details'),
        -- Update expiration if modified during reactivation
        expires_at = COALESCE(
          safe_jsonb_extract_timestamp(p_event.event_data, 'new_expires_at'),
          expires_at
        ),
        updated_at = p_event.created_at
      WHERE id = v_grant_id;

    ELSE
      RAISE WARNING 'Unknown access grant event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Helper function to validate cross-tenant access requirements
CREATE OR REPLACE FUNCTION validate_cross_tenant_access(
  p_consultant_org_id UUID,
  p_provider_org_id UUID,
  p_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_consultant_type TEXT;
  v_provider_type TEXT;
BEGIN
  -- Get organization types
  SELECT type INTO v_consultant_type 
  FROM organizations_projection 
  WHERE id = p_consultant_org_id AND is_active = true;
  
  SELECT type INTO v_provider_type 
  FROM organizations_projection 
  WHERE id = p_provider_org_id AND is_active = true;
  
  -- Validate organizations exist and are active
  IF v_consultant_type IS NULL OR v_provider_type IS NULL THEN
    RETURN false;
  END IF;
  
  -- Consultant must be provider_partner, provider must be provider
  IF v_consultant_type != 'provider_partner' OR v_provider_type != 'provider' THEN
    RETURN false;
  END IF;
  
  -- If user-specific grant, validate user belongs to consultant org
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_roles_projection
      WHERE user_id = p_user_id
        AND org_id = p_consultant_org_id
    ) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to get active grants for consultant organization
CREATE OR REPLACE FUNCTION get_active_grants_for_consultant(
  p_consultant_org_id UUID,
  p_user_id UUID DEFAULT NULL
) RETURNS TABLE (
  grant_id UUID,
  provider_org_id UUID,
  provider_org_name TEXT,
  scope TEXT,
  authorization_type TEXT,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ctag.id,
    ctag.provider_org_id,
    op.name,
    ctag.scope,
    ctag.authorization_type,
    ctag.expires_at
  FROM cross_tenant_access_grants_projection ctag
  JOIN organizations_projection op ON op.id = ctag.provider_org_id
  WHERE ctag.consultant_org_id = p_consultant_org_id
    AND ctag.status = 'active'
    AND (ctag.expires_at IS NULL OR ctag.expires_at > NOW())
    AND (p_user_id IS NULL OR ctag.consultant_user_id IS NULL OR ctag.consultant_user_id = p_user_id)
    AND op.is_active = true
    AND op.deleted_at IS NULL
  ORDER BY op.name, ctag.granted_at DESC;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to check if specific access is granted
CREATE OR REPLACE FUNCTION has_cross_tenant_access(
  p_consultant_org_id UUID,
  p_provider_org_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_scope TEXT DEFAULT 'full_org'
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM cross_tenant_access_grants_projection 
    WHERE consultant_org_id = p_consultant_org_id
      AND provider_org_id = p_provider_org_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (p_user_id IS NULL OR consultant_user_id IS NULL OR consultant_user_id = p_user_id)
      AND (scope = p_scope OR scope = 'full_org') -- full_org grants access to everything
  );
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION process_access_grant_event IS 
  'Main access grant event processor - handles cross-tenant grant lifecycle with CQRS compliance';
COMMENT ON FUNCTION validate_cross_tenant_access IS 
  'Validates that cross-tenant access grant request meets business rules';
COMMENT ON FUNCTION get_active_grants_for_consultant IS 
  'Returns all active grants for a consultant organization/user';
COMMENT ON FUNCTION has_cross_tenant_access IS 
  'Checks if specific cross-tenant access is currently granted';

-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/007-process-organization-child-events.sql
-- ----------------------------------------------------------------------------

-- Organization Child Entity Event Processing Functions
-- Handles program, contact, address, and phone events for organizations
-- Source events: program.*, contact.*, address.*, phone.* events in domain_events table

-- Program Event Processor
CREATE OR REPLACE FUNCTION process_program_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Handle program creation
    WHEN 'program.created' THEN
      INSERT INTO programs_projection (
        id, organization_id, name, type, description, capacity, current_occupancy,
        is_active, activated_at, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        (p_event.event_data->>'capacity')::INTEGER,
        COALESCE((p_event.event_data->>'current_occupancy')::INTEGER, 0),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        CASE
          WHEN safe_jsonb_extract_boolean(p_event.event_data, 'is_active') THEN p_event.created_at
          ELSE NULL
        END,
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle program updates
    WHEN 'program.updated' THEN
      UPDATE programs_projection
      SET
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
        description = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'description'), description),
        capacity = COALESCE((p_event.event_data->>'capacity')::INTEGER, capacity),
        current_occupancy = COALESCE((p_event.event_data->>'current_occupancy')::INTEGER, current_occupancy),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program activation
    WHEN 'program.activated' THEN
      UPDATE programs_projection
      SET
        is_active = true,
        activated_at = p_event.created_at,
        deactivated_at = NULL,
        deactivation_reason = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program deactivation
    WHEN 'program.deactivated' THEN
      UPDATE programs_projection
      SET
        is_active = false,
        deactivated_at = p_event.created_at,
        deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'reason'),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle program deletion (logical)
    WHEN 'program.deleted' THEN
      UPDATE programs_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown program event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Contact Event Processor
CREATE OR REPLACE FUNCTION process_contact_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle contact creation
    WHEN 'contact.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this contact is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE contacts_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO contacts_projection (
        id, organization_id, label, first_name, last_name, email, title, department,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'title'),
        safe_jsonb_extract_text(p_event.event_data, 'department'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle contact updates
    WHEN 'contact.updated' THEN
      v_org_id := (SELECT organization_id FROM contacts_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE contacts_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE contacts_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        email = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'email'), email),
        title = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'title'), title),
        department = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'department'), department),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle contact deletion (logical)
    WHEN 'contact.deleted' THEN
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Address Event Processor
CREATE OR REPLACE FUNCTION process_address_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle address creation
    WHEN 'address.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this address is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE addresses_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO addresses_projection (
        id, organization_id, label, street1, street2, city, state, zip_code,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'street1'),
        safe_jsonb_extract_text(p_event.event_data, 'street2'),
        safe_jsonb_extract_text(p_event.event_data, 'city'),
        safe_jsonb_extract_text(p_event.event_data, 'state'),
        safe_jsonb_extract_text(p_event.event_data, 'zip_code'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle address updates
    WHEN 'address.updated' THEN
      v_org_id := (SELECT organization_id FROM addresses_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE addresses_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE addresses_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        street1 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street1'), street1),
        street2 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street2'), street2),
        city = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'city'), city),
        state = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'state'), state),
        zip_code = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'zip_code'), zip_code),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle address deletion (logical)
    WHEN 'address.deleted' THEN
      UPDATE addresses_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown address event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Phone Event Processor
CREATE OR REPLACE FUNCTION process_phone_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle phone creation
    WHEN 'phone.created' THEN
      v_org_id := safe_jsonb_extract_organization_id(p_event.event_data, 'organization_id');

      -- If this phone is marked as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE phones_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND deleted_at IS NULL;
      END IF;

      INSERT INTO phones_projection (
        id, organization_id, label, number, extension, type,
        is_primary, is_active, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        v_org_id,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'number'),
        safe_jsonb_extract_text(p_event.event_data, 'extension'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), true),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

    -- Handle phone updates
    WHEN 'phone.updated' THEN
      v_org_id := (SELECT organization_id FROM phones_projection WHERE id = p_event.stream_id);

      -- If setting as primary, clear any existing primary flag
      IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
        UPDATE phones_projection
        SET is_primary = false, updated_at = p_event.created_at
        WHERE organization_id = v_org_id AND is_primary = true AND id != p_event.stream_id AND deleted_at IS NULL;
      END IF;

      UPDATE phones_projection
      SET
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'number'), number),
        extension = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'extension'), extension),
        type = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'type'), type),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        is_active = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_active'), is_active),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id AND deleted_at IS NULL;

    -- Handle phone deletion (logical)
    WHEN 'phone.deleted' THEN
      UPDATE phones_projection
      SET
        deleted_at = p_event.created_at,
        is_active = false,
        is_primary = false,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown phone event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION process_program_event IS
  'Process program.* events and update programs_projection table';
COMMENT ON FUNCTION process_contact_event IS
  'Process contact.* events and update contacts_projection table - enforces single primary contact per organization';
COMMENT ON FUNCTION process_address_event IS
  'Process address.* events and update addresses_projection table - enforces single primary address per organization';
COMMENT ON FUNCTION process_phone_event IS
  'Process phone.* events and update phones_projection table - enforces single primary phone per organization';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/008-process-contact-events.sql
-- ----------------------------------------------------------------------------

-- Contact Event Processing Functions
-- Handles all contact lifecycle events with CQRS-compliant projections
-- Source events: contact.* events in domain_events table

-- Main contact event processor
CREATE OR REPLACE FUNCTION process_contact_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Handle contact creation
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
    WHEN 'contact.created' THEN
      INSERT INTO contacts_projection (
        id, organization_id, type, label,
        first_name, last_name, email, title, department,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'title'),
        safe_jsonb_extract_text(p_event.event_data, 'department'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle contact updates
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
    WHEN 'contact.updated' THEN
      UPDATE contacts_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        email = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'email'), email),
        title = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'title'), title),
        department = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'department'), department),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle contact deletion (soft delete)
    WHEN 'contact.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_contact_event IS
  'Main contact event processor - handles creation, updates, and soft deletion with CQRS projections';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/009-process-address-events.sql
-- ----------------------------------------------------------------------------

-- Address Event Processing Functions
-- Handles all address lifecycle events with CQRS-compliant projections
-- Source events: address.* events in domain_events table

-- Main address event processor
CREATE OR REPLACE FUNCTION process_address_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Handle address creation
    WHEN 'address.created' THEN
      INSERT INTO addresses_projection (
        id, organization_id, type, label,
        street1, street2, city, state, zip_code, country,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'street1'),
        safe_jsonb_extract_text(p_event.event_data, 'street2'),
        safe_jsonb_extract_text(p_event.event_data, 'city'),
        safe_jsonb_extract_text(p_event.event_data, 'state'),
        safe_jsonb_extract_text(p_event.event_data, 'zip_code'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), 'USA'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle address updates
    WHEN 'address.updated' THEN
      UPDATE addresses_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        street1 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street1'), street1),
        street2 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street2'), street2),
        city = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'city'), city),
        state = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'state'), state),
        zip_code = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'zip_code'), zip_code),
        country = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), country),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle address deletion (soft delete)
    WHEN 'address.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE addresses_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown address event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_address_event IS
  'Main address event processor - handles creation, updates, and soft deletion with CQRS projections';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/010-process-phone-events.sql
-- ----------------------------------------------------------------------------

-- Phone Event Processing Functions
-- Handles all phone lifecycle events with CQRS-compliant projections
-- Source events: phone.* events in domain_events table

-- Main phone event processor
CREATE OR REPLACE FUNCTION process_phone_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Handle phone creation
    WHEN 'phone.created' THEN
      INSERT INTO phones_projection (
        id, organization_id, type, label,
        number, extension, is_primary,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'number'),
        safe_jsonb_extract_text(p_event.event_data, 'extension'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle phone updates
    WHEN 'phone.updated' THEN
      UPDATE phones_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'number'), number),
        extension = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'extension'), extension),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle phone deletion (soft delete)
    WHEN 'phone.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE phones_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown phone event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_phone_event IS
  'Main phone event processor - handles creation, updates, and soft deletion with CQRS projections';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/event-processing/011-process-junction-events.sql
-- ----------------------------------------------------------------------------

-- Junction Table Event Processing Functions
-- Handles all junction link/unlink events with CQRS-compliant projections
-- Source events: *.linked and *.unlinked events in domain_events table
--
-- Supported junction types:
--   - organization.contact.linked/unlinked (org → contact)
--   - organization.address.linked/unlinked (org → address)
--   - organization.phone.linked/unlinked (org → phone)
--   - contact.phone.linked/unlinked (contact → phone)
--   - contact.address.linked/unlinked (contact → address)
--   - phone.address.linked/unlinked (phone → address)

-- Main junction event processor
CREATE OR REPLACE FUNCTION process_junction_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Organization-Contact Links
    WHEN 'organization.contact.linked' THEN
      INSERT INTO organization_contacts (organization_id, contact_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
      )
      ON CONFLICT (organization_id, contact_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.contact.unlinked' THEN
      DELETE FROM organization_contacts
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');

    -- Organization-Address Links
    WHEN 'organization.address.linked' THEN
      INSERT INTO organization_addresses (organization_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (organization_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.address.unlinked' THEN
      DELETE FROM organization_addresses
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Organization-Phone Links
    WHEN 'organization.phone.linked' THEN
      INSERT INTO organization_phones (organization_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (organization_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.phone.unlinked' THEN
      DELETE FROM organization_phones
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Contact-Phone Links
    WHEN 'contact.phone.linked' THEN
      INSERT INTO contact_phones (contact_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (contact_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.phone.unlinked' THEN
      DELETE FROM contact_phones
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Contact-Address Links
    WHEN 'contact.address.linked' THEN
      INSERT INTO contact_addresses (contact_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (contact_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.address.unlinked' THEN
      DELETE FROM contact_addresses
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Phone-Address Links
    WHEN 'phone.address.linked' THEN
      INSERT INTO phone_addresses (phone_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (phone_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'phone.address.unlinked' THEN
      DELETE FROM phone_addresses
      WHERE phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    ELSE
      RAISE WARNING 'Unknown junction event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_junction_event IS
  'Main junction event processor - handles link/unlink for all 6 junction table types (org-contact, org-address, org-phone, contact-phone, contact-address, phone-address)';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/events/001-emit-domain-event-api.sql
-- ----------------------------------------------------------------------------

-- API Schema Wrapper for Domain Events
-- ============================================================================
-- Purpose: Allow Edge Functions to emit domain events via PostgREST API
--
-- Background:
-- - Edge Functions use createClient().from('table') which goes through PostgREST
-- - PostgREST only exposes schemas configured in config.toml
-- - domain_events table exists in public schema but Edge Functions need api schema access
-- - Error without this wrapper: "The schema must be one of the following: api"
--
-- Solution:
-- - Create api schema with wrapper function
-- - Use SECURITY DEFINER to run with owner privileges (bypasses RLS)
-- - Edge Functions call via .rpc('emit_domain_event', {...})
-- ============================================================================

-- Create api schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS api;

-- API wrapper function for emitting domain events
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_stream_id UUID,
  p_stream_type TEXT,
  p_stream_version INTEGER,
  p_event_type TEXT,
  p_event_data JSONB,
  p_event_metadata JSONB
)
RETURNS UUID
SECURITY DEFINER  -- Runs with function owner privileges, bypasses RLS
SET search_path = public, pg_temp  -- Explicit schema to prevent injection
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Insert domain event into public.domain_events table
  -- SECURITY DEFINER allows this to bypass RLS policies
  INSERT INTO public.domain_events (
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata,
    created_at
  )
  VALUES (
    p_stream_id,
    p_stream_type,
    p_stream_version,
    p_event_type,
    p_event_data,
    p_event_metadata,
    NOW()
  )
  RETURNING id INTO v_event_id;

  -- Return the generated event ID for correlation
  RETURN v_event_id;
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, INTEGER, TEXT, JSONB, JSONB)
  TO authenticated, service_role;

-- Documentation
COMMENT ON SCHEMA api IS
  'API schema for PostgREST-accessible functions used by Edge Functions and external clients';

COMMENT ON FUNCTION api.emit_domain_event(UUID, TEXT, INTEGER, TEXT, JSONB, JSONB) IS
  'Wrapper function for emitting domain events from Edge Functions via PostgREST API.
   Uses SECURITY DEFINER to bypass RLS policies on domain_events table.

   Usage from Edge Function:
   const { data: eventId, error } = await supabaseAdmin.rpc("emit_domain_event", {
     p_stream_id: organizationId,
     p_stream_type: "organization",
     p_stream_version: 1,
     p_event_type: "organization.bootstrap.initiated",
     p_event_data: {...},
     p_event_metadata: {...}
   });

   Returns: UUID of the created event
   Throws: PostgreSQL error if validation fails (event_type format, unique constraint, etc.)';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/external-services/001-subdomain-helpers.sql
-- ----------------------------------------------------------------------------

-- Subdomain Helper Functions
-- Part of Phase 2: Database Schema for Subdomain Support
-- Environment-aware subdomain computation based on BASE_DOMAIN

-- Get base domain from environment or default
-- NOTE: app.base_domain should be set via connection string or pooler config
-- Example: SET app.base_domain = 'firstovertheline.com';
CREATE OR REPLACE FUNCTION get_base_domain() RETURNS TEXT AS $$
BEGIN
  -- Attempt to read from app.base_domain setting
  -- Falls back to analytics4change.com (production default) if not set
  RETURN COALESCE(
    current_setting('app.base_domain', true),
    'analytics4change.com'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'analytics4change.com';
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_base_domain() IS
  'Returns environment-specific base domain. Dev: firstovertheline.com, Prod: analytics4change.com. Reads from app.base_domain setting or defaults to analytics4change.com';


-- Compute full subdomain from slug and base domain
CREATE OR REPLACE FUNCTION get_full_subdomain(p_slug TEXT) RETURNS TEXT AS $$
BEGIN
  IF p_slug IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN p_slug || '.' || get_base_domain();
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_full_subdomain(TEXT) IS
  'Computes full subdomain from slug and environment base domain. Example: get_full_subdomain(''acme'') returns ''acme.firstovertheline.com'' in dev environment';


-- Get full subdomain for an organization by ID
CREATE OR REPLACE FUNCTION get_organization_subdomain(p_org_id UUID) RETURNS TEXT AS $$
DECLARE
  v_slug TEXT;
BEGIN
  SELECT slug INTO v_slug
  FROM organizations_projection
  WHERE id = p_org_id;

  IF v_slug IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN get_full_subdomain(v_slug);
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION get_organization_subdomain(UUID) IS
  'Gets full subdomain for organization by ID. Returns NULL if organization not found. Example: get_organization_subdomain(''...'') might return ''acme.analytics4change.com''';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/workflows/001-organization-idempotency-checks.sql
-- ----------------------------------------------------------------------------

/**
 * Organization Idempotency Check Functions
 *
 * Purpose:
 * - Provide RPC functions for Temporal workflow activities to check organization existence
 * - Functions created in 'api' schema (exposed by PostgREST in Supabase)
 * - Enable idempotent organization creation in workflow activities
 *
 * Schema Architecture:
 * - Functions live in 'api' schema (PostgREST exposed schema for RPC calls)
 * - Functions access data in 'public' schema via SECURITY DEFINER + search_path
 * - This is required because PostgREST only exposes the 'api' schema by default
 *
 * Security:
 * - SECURITY DEFINER: Functions run with creator privileges to access organizations_projection
 * - SET search_path = public: Prevents schema injection attacks while accessing public tables
 * - GRANT EXECUTE: Only authenticated and service_role can call these functions
 *
 * Usage (from Temporal workflow activities):
 * ```typescript
 * // Check organization with subdomain
 * const { data, error } = await supabase.rpc('check_organization_by_slug', {
 *   p_slug: 'test-provider-001'
 * });
 *
 * // Check organization without subdomain
 * const { data, error } = await supabase.rpc('check_organization_by_name', {
 *   p_name: 'Test Healthcare Provider'
 * });
 * ```
 *
 * Migration: 001-organization-idempotency-checks.sql
 * Created: 2025-11-21
 * Updated: 2025-11-21 - Moved functions to api schema
 * Phase: 4.1 - Workflow Testing
 */

-- Create api schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS api;

-- Grant usage on api schema (required for PostgREST RPC calls)
GRANT USAGE ON SCHEMA api TO anon, authenticated, service_role;

-- Drop old functions from public schema (cleanup from previous attempt)
DROP FUNCTION IF EXISTS public.check_organization_by_slug(TEXT);
DROP FUNCTION IF EXISTS public.check_organization_by_name(TEXT);

-- Function 1: Check organization by slug (for orgs with subdomains)
CREATE OR REPLACE FUNCTION api.check_organization_by_slug(p_slug TEXT)
RETURNS TABLE (id UUID)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id
  FROM organizations_projection o
  WHERE o.slug = p_slug
  LIMIT 1;
END;
$$;

-- Grant execute permissions on api schema function
GRANT EXECUTE ON FUNCTION api.check_organization_by_slug(TEXT) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION api.check_organization_by_slug(TEXT) IS
'Check if organization exists by slug. Used by Temporal workflow activities for idempotent organization creation. Function in api schema for PostgREST RPC access.';


-- Function 2: Check organization by name (for orgs without subdomains)
CREATE OR REPLACE FUNCTION api.check_organization_by_name(p_name TEXT)
RETURNS TABLE (id UUID)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id
  FROM organizations_projection o
  WHERE o.name = p_name
    AND o.subdomain_status IS NULL
  LIMIT 1;
END;
$$;

-- Grant execute permissions on api schema function
GRANT EXECUTE ON FUNCTION api.check_organization_by_name(TEXT) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION api.check_organization_by_name(TEXT) IS
'Check if organization exists by name (for orgs without subdomains). Used by Temporal workflow activities for idempotent organization creation. Function in api schema for PostgREST RPC access.';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/workflows/002-emit-domain-event.sql
-- ----------------------------------------------------------------------------

/**
 * Emit Domain Event RPC Function
 *
 * Purpose:
 * - Provide RPC function for Temporal workflow activities to emit domain events
 * - Function created in 'api' schema (exposed by PostgREST in Supabase)
 * - Inserts events into public.domain_events table
 *
 * Schema Architecture:
 * - Function lives in 'api' schema (PostgREST exposed schema for RPC calls)
 * - Function inserts into 'public' schema via SECURITY DEFINER + search_path
 * - This is required because PostgREST only exposes the 'api' schema by default
 *
 * Security:
 * - SECURITY DEFINER: Function runs with creator privileges to access domain_events
 * - SET search_path = public: Prevents schema injection attacks while accessing public tables
 * - GRANT EXECUTE: Only authenticated and service_role can call this function
 *
 * Usage (from Temporal workflow activities):
 * ```typescript
 * const { data, error } = await supabase
 *   .schema('api')
 *   .rpc('emit_domain_event', {
 *     p_event_id: '123e4567-e89b-12d3-a456-426614174000',
 *     p_event_type: 'organization.created',
 *     p_aggregate_type: 'organization',
 *     p_aggregate_id: 'org-uuid',
 *     p_event_data: { name: 'Acme Corp' },
 *     p_event_metadata: { workflow_id: 'workflow-123' }
 *   });
 * ```
 *
 * Migration: 002-emit-domain-event.sql
 * Created: 2025-11-21
 * Phase: 4.1 - Workflow Testing
 */

-- Function: Emit domain event (insert into public.domain_events)
CREATE OR REPLACE FUNCTION api.emit_domain_event(
  p_event_id UUID,
  p_event_type TEXT,
  p_aggregate_type TEXT,
  p_aggregate_id UUID,
  p_event_data JSONB,
  p_event_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert event into domain_events table
  -- Map parameters to actual column names:
  --   event_id -> id
  --   aggregate_id -> stream_id
  --   aggregate_type -> stream_type
  INSERT INTO domain_events (
    id,
    stream_id,
    stream_type,
    stream_version,
    event_type,
    event_data,
    event_metadata
  ) VALUES (
    p_event_id,
    p_aggregate_id,
    p_aggregate_type,
    (
      SELECT COALESCE(MAX(stream_version), 0) + 1
      FROM domain_events
      WHERE stream_id = p_aggregate_id
        AND stream_type = p_aggregate_type
    ),
    p_event_type,
    p_event_data,
    p_event_metadata
  )
  ON CONFLICT (id) DO NOTHING;  -- Idempotent

  RETURN p_event_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, UUID, JSONB, JSONB) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION api.emit_domain_event(UUID, TEXT, TEXT, UUID, JSONB, JSONB) IS
'Emit domain event into domain_events table. Used by Temporal workflow activities. Function in api schema for PostgREST RPC access.';


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/workflows/003-projection-queries.sql
-- ----------------------------------------------------------------------------

-- Projection Query RPC Functions for Workflow Activities
-- These functions provide read access to projection tables via the 'api' schema
-- since PostgREST only exposes 'api' schema, not 'public' schema.

-- 1. Get pending invitations by organization
CREATE OR REPLACE FUNCTION api.get_pending_invitations_by_org(p_org_id UUID)
RETURNS TABLE (
  invitation_id UUID,
  email TEXT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT i.invitation_id, i.email
  FROM invitations_projection i
  WHERE i.organization_id = p_org_id
    AND i.status = 'pending';
END;
$$;

-- 2. Get invitation by organization and email
CREATE OR REPLACE FUNCTION api.get_invitation_by_org_and_email(
  p_org_id UUID,
  p_email TEXT
)
RETURNS TABLE (
  invitation_id UUID,
  email TEXT,
  token TEXT,
  expires_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT i.invitation_id, i.email, i.token, i.expires_at
  FROM invitations_projection i
  WHERE i.organization_id = p_org_id
    AND i.email = p_email
  LIMIT 1;
END;
$$;

-- 3. Get organization status (for activate/deactivate checks)
-- FIXED: Use is_active (boolean) instead of status (text)
CREATE OR REPLACE FUNCTION api.get_organization_status(p_org_id UUID)
RETURNS TABLE (
  is_active BOOLEAN,
  deleted_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT o.is_active, o.deleted_at
  FROM organizations_projection o
  WHERE o.id = p_org_id
  LIMIT 1;
END;
$$;

-- 4. Update organization status (for activate/deactivate)
-- FIXED: Use is_active (boolean), deactivated_at instead of status, activated_at
CREATE OR REPLACE FUNCTION api.update_organization_status(
  p_org_id UUID,
  p_is_active BOOLEAN,
  p_deactivated_at TIMESTAMPTZ DEFAULT NULL,
  p_deleted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE organizations_projection
  SET
    is_active = p_is_active,
    deactivated_at = COALESCE(p_deactivated_at, deactivated_at),
    deleted_at = COALESCE(p_deleted_at, deleted_at)
  WHERE id = p_org_id;
END;
$$;

-- 5. Get organization name
CREATE OR REPLACE FUNCTION api.get_organization_name(p_org_id UUID)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  org_name TEXT;
BEGIN
  SELECT name INTO org_name
  FROM organizations_projection
  WHERE id = p_org_id;

  RETURN org_name;
END;
$$;

-- 6. Get contacts by organization
CREATE OR REPLACE FUNCTION api.get_contacts_by_org(p_org_id UUID)
RETURNS TABLE (
  id UUID
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id
  FROM contacts_projection c
  WHERE c.organization_id = p_org_id;
END;
$$;

-- 7. Get addresses by organization
CREATE OR REPLACE FUNCTION api.get_addresses_by_org(p_org_id UUID)
RETURNS TABLE (
  id UUID
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id
  FROM addresses_projection a
  WHERE a.organization_id = p_org_id;
END;
$$;

-- 8. Get phones by organization
CREATE OR REPLACE FUNCTION api.get_phones_by_org(p_org_id UUID)
RETURNS TABLE (
  id UUID
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id
  FROM phones_projection p
  WHERE p.organization_id = p_org_id;
END;
$$;


-- ----------------------------------------------------------------------------
-- Source: sql/03-functions/workflows/004-junction-soft-delete.sql
-- ----------------------------------------------------------------------------

-- Junction Table Soft-Delete Functions
-- Provider Onboarding Enhancement - Phase 4.1
-- RPC functions for saga compensation activities to soft-delete junction records
-- Rationale: Workflow activities need explicit control over junction lifecycle

-- ==============================================================================
-- Overview
-- ==============================================================================
-- These functions are called by Temporal workflow compensation activities:
-- - delete-contacts.ts → soft_delete_organization_contacts()
-- - delete-addresses.ts → soft_delete_organization_addresses()
-- - delete-phones.ts → soft_delete_organization_phones()
--
-- Pattern:
-- 1. Activity calls RPC to soft-delete junctions FIRST
-- 2. Activity queries entities via get_*_by_org()
-- 3. Activity emits entity.deleted events (audit trail)

-- ==============================================================================
-- Function: soft_delete_organization_contacts
-- ==============================================================================
CREATE OR REPLACE FUNCTION soft_delete_organization_contacts(
  p_org_id UUID,
  p_deleted_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_contacts
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION soft_delete_organization_contacts IS 'Soft-delete all organization-contact junctions for workflow compensation. Returns count of deleted records.';

-- ==============================================================================
-- Function: soft_delete_organization_addresses
-- ==============================================================================
CREATE OR REPLACE FUNCTION soft_delete_organization_addresses(
  p_org_id UUID,
  p_deleted_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_addresses
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION soft_delete_organization_addresses IS 'Soft-delete all organization-address junctions for workflow compensation. Returns count of deleted records.';

-- ==============================================================================
-- Function: soft_delete_organization_phones
-- ==============================================================================
CREATE OR REPLACE FUNCTION soft_delete_organization_phones(
  p_org_id UUID,
  p_deleted_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Update only active junction records (idempotent)
  UPDATE organization_phones
  SET deleted_at = p_deleted_at
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  -- Return count of soft-deleted records
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION soft_delete_organization_phones IS 'Soft-delete all organization-phone junctions for workflow compensation. Returns count of deleted records.';

-- ==============================================================================
-- Notes
-- ==============================================================================
-- - SECURITY DEFINER: Allows service role to execute (workflows use service role)
-- - Idempotent: WHERE deleted_at IS NULL ensures safe retry
-- - Return count: Workflow activities log count for verification
-- - No events: Activities emit entity.deleted events separately
-- - No triggers: Direct UPDATE, no cascade logic


-- ============================================================================
-- SECTION: 04-triggers
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/04-triggers/001-process-domain-event-trigger.sql
-- ----------------------------------------------------------------------------

-- Trigger to Process Domain Events
-- Automatically projects events to 3NF tables when they are inserted

-- Drop trigger if exists (idempotency)
DROP TRIGGER IF EXISTS process_domain_event_trigger ON domain_events;

CREATE TRIGGER process_domain_event_trigger
  BEFORE INSERT OR UPDATE ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_domain_event();

-- Optional: Create an async processing trigger using pg_net for better performance
-- This would process events asynchronously to avoid blocking inserts
-- Uncomment if pg_net extension is available:

-- CREATE OR REPLACE FUNCTION async_process_domain_event()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   -- Queue event for async processing
--   PERFORM net.http_post(
--     url := 'http://localhost:54321/functions/v1/process-event',
--     body := jsonb_build_object(
--       'event_id', NEW.id,
--       'event_type', NEW.event_type,
--       'stream_id', NEW.stream_id,
--       'stream_type', NEW.stream_type
--     )
--   );
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER async_process_event_trigger
--   AFTER INSERT ON domain_events
--   FOR EACH ROW
--   EXECUTE FUNCTION async_process_domain_event();

-- ----------------------------------------------------------------------------
-- Source: sql/04-triggers/bootstrap-event-listener.sql
-- ----------------------------------------------------------------------------

-- Bootstrap Event Listener (Temporal Integration)
-- Handles bootstrap status tracking and cleanup based on events emitted by Temporal workflows
-- CQRS-compliant: Only reacts to events, orchestration handled by Temporal

-- Function to handle bootstrap workflow events
CREATE OR REPLACE FUNCTION handle_bootstrap_workflow()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process newly inserted events that haven't been processed yet
  IF TG_OP = 'INSERT' AND NEW.processed_at IS NULL THEN

    -- Handle organization bootstrap events
    IF NEW.stream_type = 'organization' THEN

      CASE NEW.event_type

        -- When bootstrap fails, trigger cleanup if needed
        WHEN 'organization.bootstrap.failed' THEN
          -- Check if partial cleanup is required
          IF (NEW.event_data->>'partial_cleanup_required')::BOOLEAN = TRUE THEN
            -- Emit cleanup events for any partial resources
            INSERT INTO domain_events (
              stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
            ) VALUES (
              NEW.stream_id,
              'organization',
              (SELECT COALESCE(MAX(stream_version), 0) + 1 FROM domain_events WHERE stream_id = NEW.stream_id),
              'organization.bootstrap.cancelled',
              jsonb_build_object(
                'bootstrap_id', NEW.event_data->>'bootstrap_id',
                'cleanup_completed', TRUE,
                'cleanup_actions', ARRAY['partial_resource_cleanup'],
                'original_failure_stage', NEW.event_data->>'failure_stage'
              ),
              jsonb_build_object(
                'user_id', NEW.event_metadata->>'user_id',
                'organization_id', NEW.event_metadata->>'organization_id',
                'reason', 'Automated cleanup after bootstrap failure',
                'automated', TRUE
              ),
              NOW()
            );
          END IF;

        ELSE
          -- Not a bootstrap event that requires trigger action
          NULL;
      END CASE;

    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Create trigger for bootstrap workflow automation
DROP TRIGGER IF EXISTS bootstrap_workflow_trigger ON domain_events;
CREATE TRIGGER bootstrap_workflow_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION handle_bootstrap_workflow();

-- Function to manually retry failed bootstrap (delegates to Temporal)
CREATE OR REPLACE FUNCTION retry_failed_bootstrap(
  p_bootstrap_id UUID,
  p_user_id UUID
) RETURNS UUID AS $$
DECLARE
  v_failed_event RECORD;
  v_new_bootstrap_id UUID;
  v_organization_id UUID;
BEGIN
  -- Find the failed bootstrap event
  SELECT * INTO v_failed_event
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bootstrap failure event not found for bootstrap_id: %', p_bootstrap_id;
  END IF;

  -- Generate new IDs for retry
  v_new_bootstrap_id := gen_random_uuid();
  v_organization_id := gen_random_uuid();

  -- NOTE: Actual retry orchestration is handled by Temporal
  -- This function just emits an event that Temporal can listen for
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata, created_at
  ) VALUES (
    v_organization_id,
    'organization',
    1,
    'organization.bootstrap.retry_requested',
    jsonb_build_object(
      'bootstrap_id', v_new_bootstrap_id,
      'retry_of', p_bootstrap_id,
      'organization_name', v_failed_event.event_data->>'organization_name',
      'organization_type', v_failed_event.event_data->>'organization_type',
      'admin_email', v_failed_event.event_data->>'admin_email'
    ),
    jsonb_build_object(
      'user_id', p_user_id,
      'organization_id', v_organization_id::TEXT,
      'reason', format('Manual retry of failed bootstrap %s', p_bootstrap_id),
      'original_bootstrap_id', p_bootstrap_id
    ),
    NOW()
  );

  RETURN v_new_bootstrap_id;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Function to get bootstrap status
CREATE OR REPLACE FUNCTION get_bootstrap_status(
  p_bootstrap_id UUID
) RETURNS TABLE (
  bootstrap_id UUID,
  organization_id UUID,
  status TEXT,
  current_stage TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH bootstrap_events AS (
    SELECT
      de.stream_id AS org_id,
      de.event_type,
      de.event_data,
      de.created_at,
      ROW_NUMBER() OVER (ORDER BY de.created_at DESC) AS rn
    FROM domain_events de
    WHERE de.event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
      AND de.stream_type = 'organization'
      AND (de.event_type LIKE 'organization.bootstrap.%'
         OR de.event_type = 'organization.created')
  )
  SELECT
    p_bootstrap_id,
    be.org_id,
    CASE
      WHEN be.event_type = 'organization.bootstrap.completed' THEN 'completed'
      WHEN be.event_type = 'organization.bootstrap.failed' THEN 'failed'
      WHEN be.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'initiated'
      WHEN be.event_type = 'organization.bootstrap.temporal_initiated' THEN 'initiated'
      ELSE 'unknown'
    END,
    CASE
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'temporal_workflow_started'
      WHEN be.event_type = 'organization.bootstrap.temporal_initiated' THEN 'temporal_workflow_started'
      WHEN be.event_type = 'organization.created' THEN 'role_assignment'
      WHEN be.event_type = 'organization.bootstrap.completed' THEN 'completed'
      WHEN be.event_type = 'organization.bootstrap.failed' THEN be.event_data->>'failure_stage'
      ELSE 'unknown'
    END,
    be.event_data->>'error_message',
    be.created_at,
    CASE
      WHEN be.event_type = 'organization.bootstrap.completed' THEN be.created_at
      ELSE NULL
    END
  FROM bootstrap_events be
  WHERE be.rn = 1; -- Most recent event
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to list all bootstrap processes (for admin dashboard)
CREATE OR REPLACE FUNCTION list_bootstrap_processes(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  bootstrap_id UUID,
  organization_id UUID,
  organization_name TEXT,
  organization_type TEXT,
  admin_email TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH bootstrap_initiation AS (
    SELECT DISTINCT
      (de.event_data->>'bootstrap_id')::UUID AS bid,
      de.stream_id,
      de.event_data->>'organization_name' AS org_name,
      de.event_data->>'organization_type' AS org_type,
      de.event_data->>'admin_email' AS email,
      de.created_at AS initiated_at
    FROM domain_events de
    WHERE de.event_type IN ('organization.bootstrap.initiated', 'organization.bootstrap.temporal_initiated')
  ),
  bootstrap_status AS (
    SELECT
      (de.event_data->>'bootstrap_id')::UUID AS bid,
      CASE
        WHEN de.event_type = 'organization.bootstrap.completed' THEN 'completed'
        WHEN de.event_type = 'organization.bootstrap.failed' THEN 'failed'
        WHEN de.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
        ELSE 'processing'
      END AS current_status,
      CASE
        WHEN de.event_type = 'organization.bootstrap.completed' THEN de.created_at
        ELSE NULL
      END AS completed_time,
      de.event_data->>'error_message' AS error_msg,
      ROW_NUMBER() OVER (PARTITION BY de.event_data->>'bootstrap_id' ORDER BY de.created_at DESC) AS rn
    FROM domain_events de
    WHERE de.event_type LIKE 'organization.bootstrap.%'
      AND de.event_type NOT IN ('organization.bootstrap.initiated', 'organization.bootstrap.temporal_initiated')
  )
  SELECT
    bi.bid,
    bi.stream_id,
    bi.org_name,
    bi.org_type,
    bi.email,
    COALESCE(bs.current_status, 'processing'),
    bi.initiated_at,
    bs.completed_time,
    bs.error_msg
  FROM bootstrap_initiation bi
  LEFT JOIN bootstrap_status bs ON bi.bid = bs.bid AND bs.rn = 1
  ORDER BY bi.initiated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to clean up old failed bootstrap attempts
CREATE OR REPLACE FUNCTION cleanup_old_bootstrap_failures(
  p_days_old INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
  v_cleanup_count INTEGER;
BEGIN
  -- This function would clean up very old failed bootstrap attempts
  -- For now, just return count of what would be cleaned
  SELECT COUNT(*) INTO v_cleanup_count
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND created_at < NOW() - (p_days_old || ' days')::INTERVAL;

  RAISE NOTICE 'Would clean up % old failed bootstrap attempts', v_cleanup_count;

  -- In production, you might want to archive rather than delete
  -- DELETE FROM domain_events WHERE ...

  RETURN v_cleanup_count;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION handle_bootstrap_workflow IS
  'Trigger function that handles cleanup for failed bootstrap events emitted by Temporal workflows';
COMMENT ON FUNCTION retry_failed_bootstrap IS
  'Emit retry request event for Temporal to pick up and orchestrate';
COMMENT ON FUNCTION get_bootstrap_status IS
  'Get current status of a bootstrap process by bootstrap_id (tracks Temporal workflow progress)';
COMMENT ON FUNCTION list_bootstrap_processes IS
  'List all bootstrap processes with their current status (admin dashboard)';
COMMENT ON FUNCTION cleanup_old_bootstrap_failures IS
  'Clean up old failed bootstrap attempts for maintenance';


-- ----------------------------------------------------------------------------
-- Source: sql/04-triggers/enqueue_workflow_from_bootstrap_event.sql
-- ----------------------------------------------------------------------------

-- =====================================================================
-- ENQUEUE WORKFLOW FROM BOOTSTRAP EVENT TRIGGER
-- =====================================================================
-- Purpose: Automatically enqueue workflow job when bootstrap initiated
-- Pattern: Event-driven workflow queue population
-- Source Event: organization.bootstrap.initiated
-- Target Event: workflow.queue.pending
--
-- Flow:
-- 1. Edge Function emits organization.bootstrap.initiated event
-- 2. This trigger fires and emits workflow.queue.pending event
-- 3. update_workflow_queue_projection trigger creates queue entry
-- 4. Worker detects new queue entry via Realtime subscription
--
-- Why Two Events?
-- - organization.bootstrap.initiated: Domain event (business event)
-- - workflow.queue.pending: Infrastructure event (queue management)
-- - Separation of concerns: domain vs infrastructure
--
-- Idempotency:
-- - Uses emit_domain_event RPC which prevents duplicate event IDs
-- - Safe to replay bootstrap events
--
-- Related Files:
-- - Projection trigger: infrastructure/supabase/sql/04-triggers/update_workflow_queue_projection.sql
-- - Contracts: infrastructure/supabase/contracts/organization-bootstrap-events.yaml
-- =====================================================================

-- Create trigger function to enqueue workflow jobs (idempotent)
CREATE OR REPLACE FUNCTION enqueue_workflow_from_bootstrap_event()
RETURNS TRIGGER AS $$
DECLARE
    v_pending_event_id UUID;
BEGIN
    -- Only process organization.bootstrap.initiated events
    IF NEW.event_type = 'organization.bootstrap.initiated' THEN
        -- Emit workflow.queue.pending event
        -- This will be caught by update_workflow_queue_projection trigger
        SELECT api.emit_domain_event(
            p_stream_id := NEW.stream_id,
            p_stream_type := 'workflow_queue',
            p_stream_version := 1,
            p_event_type := 'workflow.queue.pending',
            p_event_data := jsonb_build_object(
                'event_id', NEW.id,              -- Link to bootstrap event
                'event_type', NEW.event_type,    -- Original event type
                'event_data', NEW.event_data,    -- Original event payload
                'stream_id', NEW.stream_id,      -- Original stream ID
                'stream_type', NEW.stream_type   -- Original stream type
            ),
            p_event_metadata := jsonb_build_object(
                'triggered_by', 'enqueue_workflow_from_bootstrap_event',
                'source_event_id', NEW.id
            )
        ) INTO v_pending_event_id;

        -- Log for debugging (appears in Supabase logs)
        RAISE NOTICE 'Enqueued workflow job: event_id=%, pending_event_id=%',
            NEW.id, v_pending_event_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS enqueue_workflow_from_bootstrap_event_trigger
    ON domain_events;

-- Create trigger on domain_events INSERT (idempotent)
CREATE TRIGGER enqueue_workflow_from_bootstrap_event_trigger
    AFTER INSERT ON domain_events
    FOR EACH ROW
    WHEN (NEW.event_type = 'organization.bootstrap.initiated')
    EXECUTE FUNCTION enqueue_workflow_from_bootstrap_event();

-- Add comment for documentation
COMMENT ON FUNCTION enqueue_workflow_from_bootstrap_event() IS
    'Automatically enqueues workflow jobs by emitting workflow.queue.pending event '
    'when organization.bootstrap.initiated event is inserted. '
    'Part of strict CQRS architecture for workflow queue management.';


-- ----------------------------------------------------------------------------
-- Source: sql/04-triggers/process_invitation_revoked.sql
-- ----------------------------------------------------------------------------

-- ========================================
-- Process InvitationRevoked Events
-- ========================================
-- Event-Driven Trigger: Updates invitations_projection when InvitationRevoked events are emitted
--
-- Event Source: domain_events table (event_type = 'InvitationRevoked')
-- Event Emitter: RevokeInvitationsActivity (Temporal workflow compensation)
-- Projection Target: invitations_projection
-- Pattern: CQRS Event Sourcing
-- ========================================

CREATE OR REPLACE FUNCTION process_invitation_revoked_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Update invitation status to 'deleted' based on event data
  UPDATE invitations_projection
  SET
    status = 'deleted',
    updated_at = (NEW.event_data->>'revoked_at')::TIMESTAMPTZ
  WHERE invitation_id = (NEW.event_data->>'invitation_id')::UUID
    AND status = 'pending';  -- Only revoke pending invitations (idempotent)

  -- Return NEW to continue trigger chain
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- ========================================
-- Register Trigger
-- ========================================
-- Fires AFTER INSERT on domain_events for InvitationRevoked events only

-- Drop trigger if exists (idempotency)
DROP TRIGGER IF EXISTS process_invitation_revoked_event ON domain_events;

CREATE TRIGGER process_invitation_revoked_event
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.event_type = 'invitation.revoked')
EXECUTE FUNCTION process_invitation_revoked_event();

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON FUNCTION process_invitation_revoked_event() IS
'Event processor for InvitationRevoked domain events. Updates invitations_projection status to deleted when workflow compensation revokes pending invitations. Idempotent (only updates pending invitations).';


-- ----------------------------------------------------------------------------
-- Source: sql/04-triggers/process_organization_bootstrap_initiated.sql
-- ----------------------------------------------------------------------------

-- =====================================================
-- Trigger: Process Organization Bootstrap Initiated Events
-- =====================================================
-- Purpose: Notify workflow worker when organization.bootstrap.initiated events are inserted
--
-- Architecture Pattern: Database Trigger → NOTIFY → Worker Listener → Start Temporal Workflow
--
-- Flow:
--   1. Edge Function emits 'organization.bootstrap.initiated' event
--   2. Event inserted into domain_events table
--   3. This trigger fires BEFORE INSERT (before CQRS projection trigger)
--   4. PostgreSQL NOTIFY sends message to 'workflow_events' channel
--   5. Workflow worker (listening on channel) receives notification
--   6. Worker starts Temporal workflow with event data
--   7. Worker updates event with workflow_id and workflow_run_id
--
-- Benefits:
--   - Decouples Edge Function from Temporal (no direct HTTP calls)
--   - Resilient: If worker is down, events accumulate and process when worker restarts
--   - Auditable: All workflow starts recorded as immutable events
--   - Observable: Easy to monitor unprocessed events
--
-- Idempotency: Notifies on INSERT (before CQRS projection trigger sets processed_at)
-- Runs BEFORE the process_domain_event_trigger to ensure notification always fires
--
-- Author: A4C Infrastructure Team
-- Created: 2025-11-23
-- =====================================================

-- Drop existing function and trigger if they exist (for re-deployment)
DROP TRIGGER IF EXISTS trigger_notify_bootstrap_initiated ON domain_events;
DROP FUNCTION IF EXISTS notify_workflow_worker_bootstrap() CASCADE;

-- =====================================================
-- Function: Notify Workflow Worker of Bootstrap Events
-- =====================================================
CREATE OR REPLACE FUNCTION notify_workflow_worker_bootstrap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_payload jsonb;
BEGIN
  -- Only notify for organization.bootstrap.initiated events
  -- Note: This runs BEFORE the CQRS projection trigger, so processed_at is always NULL
  IF NEW.event_type = 'organization.bootstrap.initiated' THEN

    -- Build notification payload with all necessary data for workflow start
    notification_payload := jsonb_build_object(
      'event_id', NEW.id,
      'event_type', NEW.event_type,
      'stream_id', NEW.stream_id,
      'stream_type', NEW.stream_type,
      'event_data', NEW.event_data,
      'event_metadata', NEW.event_metadata,
      'created_at', NEW.created_at
    );

    -- Send notification to workflow_events channel
    -- Worker subscribes to this channel and receives payload
    PERFORM pg_notify('workflow_events', notification_payload::text);

    -- Log for debugging (visible in Supabase logs)
    RAISE NOTICE 'Notified workflow worker: event_id=%, stream_id=%',
      NEW.id, NEW.stream_id;

  END IF;

  RETURN NEW;
END;
$$;

-- Add comment explaining the function
COMMENT ON FUNCTION notify_workflow_worker_bootstrap() IS
  'Sends PostgreSQL NOTIFY message to workflow_events channel when organization.bootstrap.initiated events are inserted.
   Worker listens on this channel and starts Temporal workflows in response.
   Runs BEFORE the CQRS projection trigger to ensure notification always fires.';

-- =====================================================
-- Trigger: Fire BEFORE INSERT on domain_events
-- =====================================================
-- Important: This must run BEFORE the process_domain_event_trigger (also BEFORE INSERT)
-- to ensure notification fires before CQRS projection processing sets processed_at
CREATE TRIGGER trigger_notify_bootstrap_initiated
  BEFORE INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION notify_workflow_worker_bootstrap();

-- Add comment explaining the trigger
COMMENT ON TRIGGER trigger_notify_bootstrap_initiated ON domain_events IS
  'Notifies workflow worker via PostgreSQL NOTIFY when organization.bootstrap.initiated events are inserted.
   Fires BEFORE INSERT, before the process_domain_event_trigger sets processed_at.
   Part of the event-driven workflow triggering pattern.';

-- =====================================================
-- Grant Permissions
-- =====================================================
-- Service role needs to execute this function when events are inserted
GRANT EXECUTE ON FUNCTION notify_workflow_worker_bootstrap() TO service_role;
GRANT EXECUTE ON FUNCTION notify_workflow_worker_bootstrap() TO postgres;

-- =====================================================
-- Testing / Verification
-- =====================================================

-- Test 1: Verify trigger exists
-- SELECT trigger_name, event_manipulation, action_statement
-- FROM information_schema.triggers
-- WHERE trigger_name = 'trigger_notify_bootstrap_initiated';

-- Test 2: Listen for notifications (run in separate session)
-- LISTEN workflow_events;
-- -- Then insert a test event in another session
-- -- You should see the notification payload

-- Test 3: Insert test event and verify notification
-- INSERT INTO domain_events (
--   stream_id,
--   stream_type,
--   stream_version,
--   event_type,
--   event_data,
--   event_metadata
-- ) VALUES (
--   gen_random_uuid(),
--   'Organization',
--   1,
--   'organization.bootstrap.initiated',
--   '{"name": "Test Org", "type": "provider"}'::jsonb,
--   '{"timestamp": "2025-11-23T12:00:00Z"}'::jsonb
-- );

-- Test 4: Verify only unprocessed events are notified
-- UPDATE domain_events
-- SET processed_at = NOW()
-- WHERE event_type = 'organization.bootstrap.initiated'
--   AND processed_at IS NULL;
-- -- Re-insert event - should still notify (new event, processed_at IS NULL)

-- =====================================================
-- Rollback Instructions
-- =====================================================
-- To remove this trigger and function:
-- DROP TRIGGER IF EXISTS trigger_notify_bootstrap_initiated ON domain_events;
-- DROP FUNCTION IF EXISTS notify_workflow_worker_bootstrap() CASCADE;
-- =====================================================

-- =====================================================
-- Monitoring Queries
-- =====================================================

-- Query 1: Find unprocessed bootstrap events
-- SELECT id, stream_id, created_at,
--        EXTRACT(EPOCH FROM (NOW() - created_at))::int as age_seconds
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.initiated'
--   AND processed_at IS NULL
-- ORDER BY created_at DESC;

-- Query 2: Find failed bootstrap events (have processing_error)
-- SELECT id, stream_id, created_at, processing_error, retry_count
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.initiated'
--   AND processing_error IS NOT NULL
-- ORDER BY created_at DESC;

-- Query 3: Monitor processing lag (time between event creation and processing)
-- SELECT
--   event_type,
--   COUNT(*) as total,
--   COUNT(*) FILTER (WHERE processed_at IS NULL) as unprocessed,
--   AVG(EXTRACT(EPOCH FROM (processed_at - created_at)))::int as avg_processing_time_seconds,
--   MAX(EXTRACT(EPOCH FROM (processed_at - created_at)))::int as max_processing_time_seconds
-- FROM domain_events
-- WHERE event_type = 'organization.bootstrap.initiated'
-- GROUP BY event_type;

-- =====================================================


-- ----------------------------------------------------------------------------
-- Source: sql/04-triggers/process_user_invited.sql
-- ----------------------------------------------------------------------------

-- ========================================
-- Process UserInvited Events
-- ========================================
-- Event-Driven Trigger: Updates invitations_projection when UserInvited events are emitted
--
-- Event Source: domain_events table (event_type = 'UserInvited')
-- Event Emitter: GenerateInvitationsActivity (Temporal workflow)
-- Projection Target: invitations_projection
-- Pattern: CQRS Event Sourcing
-- ========================================

CREATE OR REPLACE FUNCTION process_user_invited_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Extract event data and insert/update invitation projection
  INSERT INTO invitations_projection (
    invitation_id,
    organization_id,
    email,
    first_name,
    last_name,
    role,
    token,
    expires_at,
    tags
  )
  VALUES (
    -- Extract from event_data (JSONB)
    (NEW.event_data->>'invitation_id')::UUID,
    (NEW.event_data->>'org_id')::UUID,
    NEW.event_data->>'email',
    NEW.event_data->>'first_name',
    NEW.event_data->>'last_name',
    NEW.event_data->>'role',
    NEW.event_data->>'token',
    (NEW.event_data->>'expires_at')::TIMESTAMPTZ,

    -- Extract tags from event_metadata (JSONB array)
    -- Coalesce to empty array if tags not present
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(NEW.event_metadata->'tags')),
      '{}'::TEXT[]
    )
  )
  ON CONFLICT (invitation_id) DO NOTHING;  -- Idempotency: ignore duplicate events

  -- Return NEW to continue trigger chain
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- ========================================
-- Register Trigger
-- ========================================
-- Fires AFTER INSERT on domain_events for UserInvited events only

-- Drop trigger if exists (idempotency)
DROP TRIGGER IF EXISTS process_user_invited_event ON domain_events;

CREATE TRIGGER process_user_invited_event
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.event_type = 'user.invited')
EXECUTE FUNCTION process_user_invited_event();

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON FUNCTION process_user_invited_event() IS
'Event processor for UserInvited domain events. Updates invitations_projection with invitation data from Temporal workflows. Idempotent (ON CONFLICT DO NOTHING).';


-- ----------------------------------------------------------------------------
-- Source: sql/04-triggers/update_workflow_queue_projection.sql
-- ----------------------------------------------------------------------------

-- =====================================================================
-- WORKFLOW QUEUE PROJECTION TRIGGER
-- =====================================================================
-- Purpose: Process workflow queue events and update projection
-- Pattern: Event-driven projection (strict CQRS)
-- Source: domain_events table
-- Target: workflow_queue_projection table
--
-- Events Processed:
-- 1. workflow.queue.pending   - Create new queue entry (status=pending)
-- 2. workflow.queue.claimed   - Update to processing (worker claimed)
-- 3. workflow.queue.completed - Update to completed (workflow succeeded)
-- 4. workflow.queue.failed    - Update to failed (workflow error)
--
-- Idempotency:
-- - Uses UPSERT (INSERT ... ON CONFLICT) for all operations
-- - Duplicate events are handled gracefully
-- - Safe to replay events
--
-- Related Files:
-- - Table: infrastructure/supabase/sql/02-tables/workflow_queue_projection/table.sql
-- - Contracts: infrastructure/supabase/contracts/organization-bootstrap-events.yaml
-- =====================================================================

-- Create trigger function to update workflow queue projection (idempotent)
CREATE OR REPLACE FUNCTION update_workflow_queue_projection_from_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Process workflow.queue.pending event
    -- Creates new queue entry with status='pending'
    IF NEW.event_type = 'workflow.queue.pending' THEN
        INSERT INTO workflow_queue_projection (
            event_id,
            event_type,
            event_data,
            stream_id,
            stream_type,
            status,
            created_at,
            updated_at
        )
        VALUES (
            (NEW.event_data->>'event_id')::UUID,  -- Original bootstrap.initiated event ID
            NEW.event_data->>'event_type',         -- Original event type
            (NEW.event_data->'event_data')::JSONB, -- Original event payload
            NEW.stream_id,
            NEW.stream_type,
            'pending',
            NOW(),
            NOW()
        )
        ON CONFLICT (event_id) DO NOTHING;  -- Idempotent: skip if already exists

    -- Process workflow.queue.claimed event
    -- Updates status to 'processing' and records worker info
    ELSIF NEW.event_type = 'workflow.queue.claimed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'processing',
            worker_id = NEW.event_data->>'worker_id',
            claimed_at = (NEW.event_data->>'claimed_at')::TIMESTAMPTZ,
            workflow_id = NEW.event_data->>'workflow_id',
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'pending';  -- Only update if still pending (prevent race conditions)

    -- Process workflow.queue.completed event
    -- Updates status to 'completed' and records completion info
    ELSIF NEW.event_type = 'workflow.queue.completed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'completed',
            completed_at = (NEW.event_data->>'completed_at')::TIMESTAMPTZ,
            workflow_run_id = NEW.event_data->>'workflow_run_id',
            result = (NEW.event_data->'result')::JSONB,
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    -- Process workflow.queue.failed event
    -- Updates status to 'failed' and records error info
    ELSIF NEW.event_type = 'workflow.queue.failed' THEN
        UPDATE workflow_queue_projection
        SET
            status = 'failed',
            failed_at = (NEW.event_data->>'failed_at')::TIMESTAMPTZ,
            error_message = NEW.event_data->>'error_message',
            error_stack = NEW.event_data->>'error_stack',
            retry_count = COALESCE((NEW.event_data->>'retry_count')::INTEGER, 0),
            updated_at = NOW()
        WHERE event_id = (NEW.event_data->>'event_id')::UUID
          AND status = 'processing';  -- Only update if currently processing

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS update_workflow_queue_projection_trigger
    ON domain_events;

-- Create trigger on domain_events INSERT (idempotent)
CREATE TRIGGER update_workflow_queue_projection_trigger
    AFTER INSERT ON domain_events
    FOR EACH ROW
    WHEN (NEW.event_type IN (
        'workflow.queue.pending',
        'workflow.queue.claimed',
        'workflow.queue.completed',
        'workflow.queue.failed'
    ))
    EXECUTE FUNCTION update_workflow_queue_projection_from_event();

-- Add comment for documentation
COMMENT ON FUNCTION update_workflow_queue_projection_from_event() IS
    'Processes workflow queue events and updates workflow_queue_projection. '
    'Implements strict CQRS: all projection updates happen via events. '
    'Idempotent: safe to replay events.';


-- ============================================================================
-- SECTION: 05-views
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/05-views/event_history_by_entity.sql
-- ----------------------------------------------------------------------------

-- Event History by Entity View
-- Provides a complete event history for any entity with full context
CREATE OR REPLACE VIEW event_history_by_entity AS
SELECT
  de.stream_id AS entity_id,
  de.stream_type AS entity_type,
  de.event_type,
  de.stream_version AS version,
  de.event_data,
  de.event_metadata->>'reason' AS change_reason,
  de.event_metadata->>'user_id' AS changed_by_id,
  u.name AS changed_by_name,
  u.email AS changed_by_email,
  de.event_metadata->>'correlation_id' AS correlation_id,
  de.created_at AS occurred_at,
  de.processed_at,
  de.processing_error
FROM domain_events de
LEFT JOIN users u ON u.id = (de.event_metadata->>'user_id')::UUID
ORDER BY de.stream_id, de.stream_version;

-- Index for performance (create as materialized view for better performance)
COMMENT ON VIEW event_history_by_entity IS 'Complete event history for any entity including who made changes and why';

-- ----------------------------------------------------------------------------
-- Source: sql/05-views/unprocessed_events.sql
-- ----------------------------------------------------------------------------

-- Unprocessed Events View
-- Monitor events that failed to project or are pending processing
CREATE OR REPLACE VIEW unprocessed_events AS
SELECT
  de.id,
  de.stream_id,
  de.stream_type,
  de.event_type,
  de.stream_version,
  de.created_at,
  de.processing_error,
  de.retry_count,
  age(NOW(), de.created_at) AS age,
  de.event_metadata->>'user_id' AS created_by
FROM domain_events de
WHERE de.processed_at IS NULL
  OR de.processing_error IS NOT NULL
ORDER BY de.created_at ASC;

COMMENT ON VIEW unprocessed_events IS 'Events that failed processing or are still pending';

-- ============================================================================
-- SECTION: 06-rls
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/06-rls/001-core-projection-policies.sql
-- ----------------------------------------------------------------------------

-- Row-Level Security Policies for Core Projection Tables
-- Implements multi-tenant isolation with super_admin bypass

-- ============================================================================
-- Organizations Projection
-- ============================================================================

-- Super admins can view all organizations
DROP POLICY IF EXISTS organizations_super_admin_all ON organizations_projection;
CREATE POLICY organizations_super_admin_all
  ON organizations_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Provider/Partner admins can view their own organization
DROP POLICY IF EXISTS organizations_org_admin_select ON organizations_projection;
CREATE POLICY organizations_org_admin_select
  ON organizations_projection
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), id));

COMMENT ON POLICY organizations_super_admin_all ON organizations_projection IS
  'Allows super admins full access to all organizations';
COMMENT ON POLICY organizations_org_admin_select ON organizations_projection IS
  'Allows organization admins to view their own organization details';


-- ============================================================================
-- Organization Business Profiles Projection
-- ============================================================================

-- Super admins can view all business profiles
DROP POLICY IF EXISTS business_profiles_super_admin_all ON organization_business_profiles_projection;
CREATE POLICY business_profiles_super_admin_all
  ON organization_business_profiles_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Provider/Partner admins can view their own organization's profile
DROP POLICY IF EXISTS business_profiles_org_admin_select ON organization_business_profiles_projection;
CREATE POLICY business_profiles_org_admin_select
  ON organization_business_profiles_projection
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), organization_id));

COMMENT ON POLICY business_profiles_super_admin_all ON organization_business_profiles_projection IS
  'Allows super admins full access to all business profiles';
COMMENT ON POLICY business_profiles_org_admin_select ON organization_business_profiles_projection IS
  'Allows organization admins to view their own business profile';


-- ============================================================================
-- Users
-- ============================================================================

-- Super admins can view all users
DROP POLICY IF EXISTS users_super_admin_all ON users;
CREATE POLICY users_super_admin_all
  ON users
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view users in their organization
DROP POLICY IF EXISTS users_org_admin_select ON users;
CREATE POLICY users_org_admin_select
  ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM user_roles_projection ur
      WHERE ur.user_id = users.id
        AND is_org_admin(get_current_user_id(), ur.org_id)
    )
  );

-- Users can view their own profile
DROP POLICY IF EXISTS users_own_profile_select ON users;
CREATE POLICY users_own_profile_select
  ON users
  FOR SELECT
  USING (id = get_current_user_id());

COMMENT ON POLICY users_super_admin_all ON users IS
  'Allows super admins full access to all users';
COMMENT ON POLICY users_org_admin_select ON users IS
  'Allows organization admins to view users in their organization';
COMMENT ON POLICY users_own_profile_select ON users IS
  'Allows users to view their own profile';


-- ============================================================================
-- Permissions Projection
-- ============================================================================

-- Super admins can view all permissions
DROP POLICY IF EXISTS permissions_super_admin_all ON permissions_projection;
CREATE POLICY permissions_super_admin_all
  ON permissions_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- All authenticated users can view available permissions (read-only reference data)
DROP POLICY IF EXISTS permissions_authenticated_select ON permissions_projection;
CREATE POLICY permissions_authenticated_select
  ON permissions_projection
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

COMMENT ON POLICY permissions_super_admin_all ON permissions_projection IS
  'Allows super admins full access to permission definitions';
COMMENT ON POLICY permissions_authenticated_select ON permissions_projection IS
  'Allows authenticated users to view available permissions';


-- ============================================================================
-- Roles Projection
-- ============================================================================

-- Super admins can view all roles
DROP POLICY IF EXISTS roles_super_admin_all ON roles_projection;
CREATE POLICY roles_super_admin_all
  ON roles_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view roles in their organization
DROP POLICY IF EXISTS roles_org_admin_select ON roles_projection;
CREATE POLICY roles_org_admin_select
  ON roles_projection
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );

-- All authenticated users can view global roles (templates like provider_admin, partner_admin)
DROP POLICY IF EXISTS roles_global_select ON roles_projection;
CREATE POLICY roles_global_select
  ON roles_projection
  FOR SELECT
  USING (
    organization_id IS NULL
    AND get_current_user_id() IS NOT NULL
  );

COMMENT ON POLICY roles_super_admin_all ON roles_projection IS
  'Allows super admins full access to all roles';
COMMENT ON POLICY roles_org_admin_select ON roles_projection IS
  'Allows organization admins to view roles in their organization';
COMMENT ON POLICY roles_global_select ON roles_projection IS
  'Allows authenticated users to view global role templates';


-- ============================================================================
-- Role Permissions Projection
-- ============================================================================

-- Super admins can view all role permissions
DROP POLICY IF EXISTS role_permissions_super_admin_all ON role_permissions_projection;
CREATE POLICY role_permissions_super_admin_all
  ON role_permissions_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view permissions for roles in their organization
DROP POLICY IF EXISTS role_permissions_org_admin_select ON role_permissions_projection;
CREATE POLICY role_permissions_org_admin_select
  ON role_permissions_projection
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM roles_projection r
      WHERE r.id = role_permissions_projection.role_id
        AND r.organization_id IS NOT NULL
        AND is_org_admin(get_current_user_id(), r.organization_id)
    )
  );

-- All authenticated users can view permissions for global roles
DROP POLICY IF EXISTS role_permissions_global_select ON role_permissions_projection;
CREATE POLICY role_permissions_global_select
  ON role_permissions_projection
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM roles_projection r
      WHERE r.id = role_permissions_projection.role_id
        AND r.organization_id IS NULL
    )
    AND get_current_user_id() IS NOT NULL
  );

COMMENT ON POLICY role_permissions_super_admin_all ON role_permissions_projection IS
  'Allows super admins full access to all role-permission grants';
COMMENT ON POLICY role_permissions_org_admin_select ON role_permissions_projection IS
  'Allows organization admins to view permissions for roles in their organization';
COMMENT ON POLICY role_permissions_global_select ON role_permissions_projection IS
  'Allows authenticated users to view permissions for global roles';


-- ============================================================================
-- User Roles Projection
-- ============================================================================

-- Super admins can view all user-role assignments
DROP POLICY IF EXISTS user_roles_super_admin_all ON user_roles_projection;
CREATE POLICY user_roles_super_admin_all
  ON user_roles_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view user-role assignments in their organization
DROP POLICY IF EXISTS user_roles_org_admin_select ON user_roles_projection;
CREATE POLICY user_roles_org_admin_select
  ON user_roles_projection
  FOR SELECT
  USING (
    org_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), org_id)
  );

-- Users can view their own role assignments
DROP POLICY IF EXISTS user_roles_own_select ON user_roles_projection;
CREATE POLICY user_roles_own_select
  ON user_roles_projection
  FOR SELECT
  USING (user_id = get_current_user_id());

COMMENT ON POLICY user_roles_super_admin_all ON user_roles_projection IS
  'Allows super admins full access to all user-role assignments';
COMMENT ON POLICY user_roles_org_admin_select ON user_roles_projection IS
  'Allows organization admins to view role assignments in their organization';
COMMENT ON POLICY user_roles_own_select ON user_roles_projection IS
  'Allows users to view their own role assignments';


-- ============================================================================
-- Domain Events
-- ============================================================================

-- Super admins can view all domain events (audit trail)
DROP POLICY IF EXISTS domain_events_super_admin_all ON domain_events;
CREATE POLICY domain_events_super_admin_all
  ON domain_events
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view events for their organization
-- (This requires event_metadata to contain org_id - we'll implement this later)
-- For now, restrict to super_admin only for security

COMMENT ON POLICY domain_events_super_admin_all ON domain_events IS
  'Allows super admins full access to domain events for auditing';


-- ============================================================================
-- Event Types
-- ============================================================================

-- Super admins can manage event type definitions
DROP POLICY IF EXISTS event_types_super_admin_all ON event_types;
CREATE POLICY event_types_super_admin_all
  ON event_types
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- All authenticated users can view event type definitions (reference data)
DROP POLICY IF EXISTS event_types_authenticated_select ON event_types;
CREATE POLICY event_types_authenticated_select
  ON event_types
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

COMMENT ON POLICY event_types_super_admin_all ON event_types IS
  'Allows super admins full access to event type definitions';
COMMENT ON POLICY event_types_authenticated_select ON event_types IS
  'Allows authenticated users to view event type definitions';


-- ============================================================================
-- Phase 1: Enable RLS on Tables with Existing Policies
-- ============================================================================
-- These tables have policies defined but RLS was not enabled, meaning
-- the policies were not being enforced. This fixes security advisor issue 0007.

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_business_profiles_projection ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- Invitations Projection
-- ============================================================================

-- Super admins can view all invitations
DROP POLICY IF EXISTS invitations_super_admin_all ON invitations_projection;
CREATE POLICY invitations_super_admin_all
  ON invitations_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view their organization's invitations
DROP POLICY IF EXISTS invitations_org_admin_select ON invitations_projection;
CREATE POLICY invitations_org_admin_select
  ON invitations_projection
  FOR SELECT
  USING (is_org_admin(get_current_user_id(), organization_id));

-- Users can view their own invitation by email
DROP POLICY IF EXISTS invitations_user_own_select ON invitations_projection;
CREATE POLICY invitations_user_own_select
  ON invitations_projection
  FOR SELECT
  USING (email = (current_setting('request.jwt.claims', true)::json->>'email'));

COMMENT ON POLICY invitations_super_admin_all ON invitations_projection IS
  'Allows super admins full access to all invitations';
COMMENT ON POLICY invitations_org_admin_select ON invitations_projection IS
  'Allows organization admins to view invitations for their organization';
COMMENT ON POLICY invitations_user_own_select ON invitations_projection IS
  'Allows users to view their own invitation by email address';


-- ============================================================================
-- Audit Log
-- ============================================================================

-- Super admins can view all audit log entries
DROP POLICY IF EXISTS audit_log_super_admin_all ON audit_log;
CREATE POLICY audit_log_super_admin_all
  ON audit_log
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view their organization's audit entries
DROP POLICY IF EXISTS audit_log_org_admin_select ON audit_log;
CREATE POLICY audit_log_org_admin_select
  ON audit_log
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );

COMMENT ON POLICY audit_log_super_admin_all ON audit_log IS
  'Allows super admins full access to all audit log entries';
COMMENT ON POLICY audit_log_org_admin_select ON audit_log IS
  'Allows organization admins to view audit entries for their organization';


-- ============================================================================
-- API Audit Log
-- ============================================================================

-- Super admins can view all API audit log entries
DROP POLICY IF EXISTS api_audit_log_super_admin_all ON api_audit_log;
CREATE POLICY api_audit_log_super_admin_all
  ON api_audit_log
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view their organization's API audit entries
DROP POLICY IF EXISTS api_audit_log_org_admin_select ON api_audit_log;
CREATE POLICY api_audit_log_org_admin_select
  ON api_audit_log
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND is_org_admin(get_current_user_id(), organization_id)
  );

COMMENT ON POLICY api_audit_log_super_admin_all ON api_audit_log IS
  'Allows super admins full access to all API audit log entries';
COMMENT ON POLICY api_audit_log_org_admin_select ON api_audit_log IS
  'Allows organization admins to view API audit entries for their organization';


-- ============================================================================
-- Cross-Tenant Access Grants Projection
-- ============================================================================

-- Super admins can view all cross-tenant access grants
DROP POLICY IF EXISTS cross_tenant_grants_super_admin_all ON cross_tenant_access_grants_projection;
CREATE POLICY cross_tenant_grants_super_admin_all
  ON cross_tenant_access_grants_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view grants where their org is either the consultant or provider
DROP POLICY IF EXISTS cross_tenant_grants_org_admin_select ON cross_tenant_access_grants_projection;
CREATE POLICY cross_tenant_grants_org_admin_select
  ON cross_tenant_access_grants_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), consultant_org_id)
    OR is_org_admin(get_current_user_id(), provider_org_id)
  );

COMMENT ON POLICY cross_tenant_grants_super_admin_all ON cross_tenant_access_grants_projection IS
  'Allows super admins full access to all cross-tenant access grants';
COMMENT ON POLICY cross_tenant_grants_org_admin_select ON cross_tenant_access_grants_projection IS
  'Allows organization admins to view grants where their organization is consultant or provider';


-- ----------------------------------------------------------------------------
-- Source: sql/06-rls/002-clinical-table-policies.sql
-- ----------------------------------------------------------------------------

-- Row-Level Security Policies for Clinical Tables
-- CRITICAL FIX: These tables had RLS enabled but NO policies defined
-- Impact: Without policies, tables deny ALL access (production blocker)
-- Date: 2025-11-13
-- Ref: documentation/MIGRATION_REPORT.md Phase 7.4 (RLS Gaps)

-- ============================================================================
-- Clients Table
-- ============================================================================

-- Super admins can view all client records across all organizations
DROP POLICY IF EXISTS clients_super_admin_select ON clients;
CREATE POLICY clients_super_admin_select
  ON clients
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view clients in their own organization
DROP POLICY IF EXISTS clients_org_select ON clients;
CREATE POLICY clients_org_select
  ON clients
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Organization admins and users with permission can create clients
DROP POLICY IF EXISTS clients_insert ON clients;
CREATE POLICY clients_insert
  ON clients
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    is_org_admin(get_current_user_id(), organization_id) OR
    user_has_permission(get_current_user_id(), 'clients.create', organization_id)
  );

-- Super admins and users with permission can update clients
DROP POLICY IF EXISTS clients_update ON clients;
CREATE POLICY clients_update
  ON clients
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'clients.update', organization_id)
    )
  );

-- Super admins and users with permission can delete clients
-- NOTE: Prefer status='archived' over DELETE in most cases
DROP POLICY IF EXISTS clients_delete ON clients;
CREATE POLICY clients_delete
  ON clients
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'clients.delete', organization_id)
    )
  );

COMMENT ON POLICY clients_super_admin_select ON clients IS
  'Allows super admins to view all client records across all organizations';
COMMENT ON POLICY clients_org_select ON clients IS
  'Allows organization users to view clients in their own organization';
COMMENT ON POLICY clients_insert ON clients IS
  'Allows organization admins and authorized users to create client records';
COMMENT ON POLICY clients_update ON clients IS
  'Allows authorized users to update client records in their organization';
COMMENT ON POLICY clients_delete ON clients IS
  'Allows authorized users to delete client records (prefer archiving)';


-- ============================================================================
-- Medications Table
-- ============================================================================

-- Super admins can view all medications across all organizations
DROP POLICY IF EXISTS medications_super_admin_select ON medications;
CREATE POLICY medications_super_admin_select
  ON medications
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view medications in their own organization
DROP POLICY IF EXISTS medications_org_select ON medications;
CREATE POLICY medications_org_select
  ON medications
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Organization admins and pharmacy staff can create medications
DROP POLICY IF EXISTS medications_insert ON medications;
CREATE POLICY medications_insert
  ON medications
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND (
        is_org_admin(get_current_user_id(), organization_id)
        OR user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
      )
    )
  );

-- Super admins and pharmacy staff can update medications
DROP POLICY IF EXISTS medications_update ON medications;
CREATE POLICY medications_update
  ON medications
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );

-- Super admins and authorized pharmacy staff can delete medications
DROP POLICY IF EXISTS medications_delete ON medications;
CREATE POLICY medications_delete
  ON medications
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );

COMMENT ON POLICY medications_super_admin_select ON medications IS
  'Allows super admins to view all medication formularies across all organizations';
COMMENT ON POLICY medications_org_select ON medications IS
  'Allows organization users to view medications in their own formulary';
COMMENT ON POLICY medications_insert ON medications IS
  'Allows organization admins and pharmacy staff to add medications to formulary';
COMMENT ON POLICY medications_update ON medications IS
  'Allows pharmacy staff to update medication information';
COMMENT ON POLICY medications_delete ON medications IS
  'Allows authorized pharmacy staff to remove medications from formulary';


-- ============================================================================
-- Medication History Table
-- ============================================================================

-- Ensure prescribed_by column exists (referenced by RLS policies)
ALTER TABLE medication_history ADD COLUMN IF NOT EXISTS prescribed_by UUID;

-- Super admins can view all prescription records across all organizations
DROP POLICY IF EXISTS medication_history_super_admin_select ON medication_history;
CREATE POLICY medication_history_super_admin_select
  ON medication_history
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view prescription records in their own organization
DROP POLICY IF EXISTS medication_history_org_select ON medication_history;
CREATE POLICY medication_history_org_select
  ON medication_history
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Prescribers can create prescriptions in their organization
DROP POLICY IF EXISTS medication_history_insert ON medication_history;
CREATE POLICY medication_history_insert
  ON medication_history
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
    )
  );

-- Prescribers can update prescriptions in their organization
DROP POLICY IF EXISTS medication_history_update ON medication_history;
CREATE POLICY medication_history_update
  ON medication_history
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND (
        user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
        OR prescribed_by = get_current_user_id()
      )
    )
  );

-- Prescribers can discontinue prescriptions in their organization
DROP POLICY IF EXISTS medication_history_delete ON medication_history;
CREATE POLICY medication_history_delete
  ON medication_history
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
    )
  );

COMMENT ON POLICY medication_history_super_admin_select ON medication_history IS
  'Allows super admins to view all prescription records across all organizations';
COMMENT ON POLICY medication_history_org_select ON medication_history IS
  'Allows organization users to view prescription records in their own organization';
COMMENT ON POLICY medication_history_insert ON medication_history IS
  'Allows authorized prescribers to create prescriptions in their organization';
COMMENT ON POLICY medication_history_update ON medication_history IS
  'Allows prescribers to update their prescriptions in their organization';
COMMENT ON POLICY medication_history_delete ON medication_history IS
  'Allows authorized prescribers to discontinue prescriptions';


-- ============================================================================
-- Dosage Info Table
-- ============================================================================

-- Super admins can view all dosage records across all organizations
DROP POLICY IF EXISTS dosage_info_super_admin_select ON dosage_info;
CREATE POLICY dosage_info_super_admin_select
  ON dosage_info
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view dosage records in their own organization
DROP POLICY IF EXISTS dosage_info_org_select ON dosage_info;
CREATE POLICY dosage_info_org_select
  ON dosage_info
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Medication administrators can schedule doses
DROP POLICY IF EXISTS dosage_info_insert ON dosage_info;
CREATE POLICY dosage_info_insert
  ON dosage_info
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
    )
  );

-- Medication administrators and staff who administered can update doses
DROP POLICY IF EXISTS dosage_info_update ON dosage_info;
CREATE POLICY dosage_info_update
  ON dosage_info
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND (
        user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
        OR administered_by = get_current_user_id()
      )
    )
  );

-- Super admins and medication administrators can delete dosage records
DROP POLICY IF EXISTS dosage_info_delete ON dosage_info;
CREATE POLICY dosage_info_delete
  ON dosage_info
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
    )
  );

COMMENT ON POLICY dosage_info_super_admin_select ON dosage_info IS
  'Allows super admins to view all dosage records across all organizations';
COMMENT ON POLICY dosage_info_org_select ON dosage_info IS
  'Allows organization users to view dosage records in their own organization';
COMMENT ON POLICY dosage_info_insert ON dosage_info IS
  'Allows medication administrators to schedule doses in their organization';
COMMENT ON POLICY dosage_info_update ON dosage_info IS
  'Allows medication administrators and administering staff to update dose records';
COMMENT ON POLICY dosage_info_delete ON dosage_info IS
  'Allows medication administrators to delete dosage records';


-- ----------------------------------------------------------------------------
-- Source: sql/06-rls/002-var-partner-referrals.sql
-- ----------------------------------------------------------------------------

-- Row-Level Security Policy for VAR Partner Referrals
-- Allows VAR partners to view organizations they referred
-- Created: 2025-11-17
--
-- Authorization Model:
-- - Super admins: See all organizations (existing policy)
-- - VAR partners: See organizations where referring_partner_id = their org_id
-- - Regular users: See only their own organization (existing policy)
--
-- The referring_partner_id relationship IS the permission grant.
-- No additional delegation table needed.

-- ============================================================================
-- Organizations Projection - VAR Partner Referrals Policy
-- ============================================================================

-- VAR partners can view organizations they referred
DROP POLICY IF EXISTS organizations_var_partner_referrals ON organizations_projection;
CREATE POLICY organizations_var_partner_referrals
  ON organizations_projection
  FOR SELECT
  USING (
    -- Check if current user's organization is a VAR partner
    EXISTS (
      SELECT 1
      FROM organizations_projection var_org
      WHERE var_org.id = get_current_org_id()
        AND var_org.type = 'provider_partner'
        AND var_org.partner_type = 'var'
        AND var_org.is_active = true
    )
    -- Allow access to organizations where this VAR partner is the referring partner
    AND referring_partner_id = get_current_org_id()
  );

COMMENT ON POLICY organizations_var_partner_referrals ON organizations_projection IS
  'Allows VAR partners to view organizations they referred (where referring_partner_id = their org_id)';


-- ============================================================================
-- Policy Precedence and Interaction
-- ============================================================================
--
-- RLS policies are combined with OR logic, so a user can match multiple policies:
--
-- 1. organizations_super_admin_all (FOR ALL)
--    - Super admins see ALL organizations
--
-- 2. organizations_org_admin_select (FOR SELECT)
--    - Organization admins see THEIR OWN organization
--
-- 3. organizations_var_partner_referrals (FOR SELECT) [NEW]
--    - VAR partners see organizations they REFERRED
--
-- Example Access Scenarios:
--
-- A. Super Admin in A4C Platform Organization:
--    - Matches policy #1 → Sees ALL organizations
--
-- B. VAR Partner Admin in TechSolutions VAR:
--    - Matches policy #2 → Sees TechSolutions organization
--    - Matches policy #3 → Sees all organizations with referring_partner_id = TechSolutions ID
--    - Net result: TechSolutions + all referred organizations
--
-- C. Provider Admin in ABC Healthcare:
--    - Matches policy #2 → Sees ABC Healthcare organization only
--    - Does NOT match policy #3 (not a VAR partner)
--    - Net result: ABC Healthcare only
--
-- D. Regular User in ABC Healthcare:
--    - Does NOT match policy #2 (not an admin)
--    - Does NOT match policy #3 (not a VAR partner)
--    - Net result: No organizations visible
--    - Note: Users can still see their own org data via other tables (users, user_roles, etc.)


-- ----------------------------------------------------------------------------
-- Source: sql/06-rls/003-contact-address-phone-policies.sql
-- ----------------------------------------------------------------------------

-- Row-Level Security Policies for Contact, Address, Phone Projections
-- Provider Onboarding Enhancement - Phase 2
-- Implements multi-tenant isolation with super_admin bypass

-- ============================================================================
-- Contacts Projection
-- ============================================================================

-- Enable RLS on contacts_projection
ALTER TABLE contacts_projection ENABLE ROW LEVEL SECURITY;

-- Super admins can view all contacts
DROP POLICY IF EXISTS contacts_super_admin_all ON contacts_projection;
CREATE POLICY contacts_super_admin_all
  ON contacts_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view contacts in their organization
DROP POLICY IF EXISTS contacts_org_admin_select ON contacts_projection;
CREATE POLICY contacts_org_admin_select
  ON contacts_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL  -- Hide soft-deleted contacts
  );

COMMENT ON POLICY contacts_super_admin_all ON contacts_projection IS
  'Allows super admins full access to all contacts';
COMMENT ON POLICY contacts_org_admin_select ON contacts_projection IS
  'Allows organization admins to view contacts in their organization (excluding soft-deleted)';


-- ============================================================================
-- Addresses Projection
-- ============================================================================

-- Enable RLS on addresses_projection
ALTER TABLE addresses_projection ENABLE ROW LEVEL SECURITY;

-- Super admins can view all addresses
DROP POLICY IF EXISTS addresses_super_admin_all ON addresses_projection;
CREATE POLICY addresses_super_admin_all
  ON addresses_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view addresses in their organization
DROP POLICY IF EXISTS addresses_org_admin_select ON addresses_projection;
CREATE POLICY addresses_org_admin_select
  ON addresses_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL  -- Hide soft-deleted addresses
  );

COMMENT ON POLICY addresses_super_admin_all ON addresses_projection IS
  'Allows super admins full access to all addresses';
COMMENT ON POLICY addresses_org_admin_select ON addresses_projection IS
  'Allows organization admins to view addresses in their organization (excluding soft-deleted)';


-- ============================================================================
-- Phones Projection
-- ============================================================================

-- Enable RLS on phones_projection
ALTER TABLE phones_projection ENABLE ROW LEVEL SECURITY;

-- Super admins can view all phones
DROP POLICY IF EXISTS phones_super_admin_all ON phones_projection;
CREATE POLICY phones_super_admin_all
  ON phones_projection
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view phones in their organization
DROP POLICY IF EXISTS phones_org_admin_select ON phones_projection;
CREATE POLICY phones_org_admin_select
  ON phones_projection
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND deleted_at IS NULL  -- Hide soft-deleted phones
  );

COMMENT ON POLICY phones_super_admin_all ON phones_projection IS
  'Allows super admins full access to all phones';
COMMENT ON POLICY phones_org_admin_select ON phones_projection IS
  'Allows organization admins to view phones in their organization (excluding soft-deleted)';


-- ============================================================================
-- Junction Tables - Organization Contacts
-- ============================================================================

-- Enable RLS on organization_contacts
ALTER TABLE organization_contacts ENABLE ROW LEVEL SECURITY;

-- Super admins can view all organization-contact links
DROP POLICY IF EXISTS org_contacts_super_admin_all ON organization_contacts;
CREATE POLICY org_contacts_super_admin_all
  ON organization_contacts
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for their organization
DROP POLICY IF EXISTS org_contacts_org_admin_select ON organization_contacts;
CREATE POLICY org_contacts_org_admin_select
  ON organization_contacts
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_id
        AND c.organization_id = organization_id
        AND c.deleted_at IS NULL
    )
  );

COMMENT ON POLICY org_contacts_super_admin_all ON organization_contacts IS
  'Allows super admins full access to all organization-contact links';
COMMENT ON POLICY org_contacts_org_admin_select ON organization_contacts IS
  'Allows organization admins to view organization-contact links (both entities must belong to their org)';


-- ============================================================================
-- Junction Tables - Organization Addresses
-- ============================================================================

-- Enable RLS on organization_addresses
ALTER TABLE organization_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can view all organization-address links
DROP POLICY IF EXISTS org_addresses_super_admin_all ON organization_addresses;
CREATE POLICY org_addresses_super_admin_all
  ON organization_addresses
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for their organization
DROP POLICY IF EXISTS org_addresses_org_admin_select ON organization_addresses;
CREATE POLICY org_addresses_org_admin_select
  ON organization_addresses
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = address_id
        AND a.organization_id = organization_id
        AND a.deleted_at IS NULL
    )
  );

COMMENT ON POLICY org_addresses_super_admin_all ON organization_addresses IS
  'Allows super admins full access to all organization-address links';
COMMENT ON POLICY org_addresses_org_admin_select ON organization_addresses IS
  'Allows organization admins to view organization-address links (both entities must belong to their org)';


-- ============================================================================
-- Junction Tables - Organization Phones
-- ============================================================================

-- Enable RLS on organization_phones
ALTER TABLE organization_phones ENABLE ROW LEVEL SECURITY;

-- Super admins can view all organization-phone links
DROP POLICY IF EXISTS org_phones_super_admin_all ON organization_phones;
CREATE POLICY org_phones_super_admin_all
  ON organization_phones
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for their organization
DROP POLICY IF EXISTS org_phones_org_admin_select ON organization_phones;
CREATE POLICY org_phones_org_admin_select
  ON organization_phones
  FOR SELECT
  USING (
    is_org_admin(get_current_user_id(), organization_id)
    AND EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = phone_id
        AND p.organization_id = organization_id
        AND p.deleted_at IS NULL
    )
  );

COMMENT ON POLICY org_phones_super_admin_all ON organization_phones IS
  'Allows super admins full access to all organization-phone links';
COMMENT ON POLICY org_phones_org_admin_select ON organization_phones IS
  'Allows organization admins to view organization-phone links (both entities must belong to their org)';


-- ============================================================================
-- Junction Tables - Contact Phones
-- ============================================================================

-- Enable RLS on contact_phones
ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;

-- Super admins can view all contact-phone links
DROP POLICY IF EXISTS contact_phones_super_admin_all ON contact_phones;
CREATE POLICY contact_phones_super_admin_all
  ON contact_phones
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for contacts/phones in their organization
DROP POLICY IF EXISTS contact_phones_org_admin_select ON contact_phones;
CREATE POLICY contact_phones_org_admin_select
  ON contact_phones
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_id
        AND is_org_admin(get_current_user_id(), c.organization_id)
        AND c.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = phone_id
        AND p.deleted_at IS NULL
    )
  );

COMMENT ON POLICY contact_phones_super_admin_all ON contact_phones IS
  'Allows super admins full access to all contact-phone links';
COMMENT ON POLICY contact_phones_org_admin_select ON contact_phones IS
  'Allows organization admins to view contact-phone links (both contact and phone must belong to their org)';


-- ============================================================================
-- Junction Tables - Contact Addresses
-- ============================================================================

-- Enable RLS on contact_addresses
ALTER TABLE contact_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can view all contact-address links
DROP POLICY IF EXISTS contact_addresses_super_admin_all ON contact_addresses;
CREATE POLICY contact_addresses_super_admin_all
  ON contact_addresses
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for contacts/addresses in their organization
DROP POLICY IF EXISTS contact_addresses_org_admin_select ON contact_addresses;
CREATE POLICY contact_addresses_org_admin_select
  ON contact_addresses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts_projection c
      WHERE c.id = contact_id
        AND is_org_admin(get_current_user_id(), c.organization_id)
        AND c.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = address_id
        AND a.deleted_at IS NULL
    )
  );

COMMENT ON POLICY contact_addresses_super_admin_all ON contact_addresses IS
  'Allows super admins full access to all contact-address links';
COMMENT ON POLICY contact_addresses_org_admin_select ON contact_addresses IS
  'Allows organization admins to view contact-address links (both contact and address must belong to their org)';


-- ============================================================================
-- Junction Tables - Phone Addresses
-- ============================================================================

-- Enable RLS on phone_addresses
ALTER TABLE phone_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can view all phone-address links
DROP POLICY IF EXISTS phone_addresses_super_admin_all ON phone_addresses;
CREATE POLICY phone_addresses_super_admin_all
  ON phone_addresses
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- Organization admins can view links for phones/addresses in their organization
DROP POLICY IF EXISTS phone_addresses_org_admin_select ON phone_addresses;
CREATE POLICY phone_addresses_org_admin_select
  ON phone_addresses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM phones_projection p
      WHERE p.id = phone_id
        AND is_org_admin(get_current_user_id(), p.organization_id)
        AND p.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM addresses_projection a
      WHERE a.id = address_id
        AND a.deleted_at IS NULL
    )
  );

COMMENT ON POLICY phone_addresses_super_admin_all ON phone_addresses IS
  'Allows super admins full access to all phone-address links';
COMMENT ON POLICY phone_addresses_org_admin_select ON phone_addresses IS
  'Allows organization admins to view phone-address links (both phone and address must belong to their org)';


-- ----------------------------------------------------------------------------
-- Source: sql/06-rls/enable_rls_all_tables.sql
-- ----------------------------------------------------------------------------

-- Enable Row Level Security on all tables
-- This must be done before creating policies

-- Core tables (projections)
ALTER TABLE organizations_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE dosage_info ENABLE ROW LEVEL SECURITY;

-- RBAC tables (projections)
ALTER TABLE roles_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_tenant_access_grants_projection ENABLE ROW LEVEL SECURITY;

-- Impersonation tables (projections)
ALTER TABLE impersonation_sessions_projection ENABLE ROW LEVEL SECURITY;

-- Audit tables (might have different RLS requirements)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_audit_log ENABLE ROW LEVEL SECURITY;

-- Note: After enabling RLS, tables will deny all access by default
-- Policies must be created to allow appropriate access

-- ----------------------------------------------------------------------------
-- Source: sql/06-rls/impersonation-policies.sql
-- ----------------------------------------------------------------------------

-- Row-Level Security Policies for Impersonation Sessions
-- These policies must run AFTER RBAC tables (roles_projection, user_roles_projection) are created

-- Policy: Super admins can view all sessions
DROP POLICY IF EXISTS impersonation_sessions_super_admin_select ON impersonation_sessions_projection;
CREATE POLICY impersonation_sessions_super_admin_select
  ON impersonation_sessions_projection
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles_projection ur
      JOIN roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = current_setting('app.current_user')::UUID
        AND r.name = 'super_admin'
        AND ur.org_id IS NULL
    )
  );

-- Policy: Provider admins can view sessions affecting their organization
DROP POLICY IF EXISTS impersonation_sessions_provider_admin_select ON impersonation_sessions_projection;
CREATE POLICY impersonation_sessions_provider_admin_select
  ON impersonation_sessions_projection
  FOR SELECT
  USING (
    target_org_id = current_setting('app.current_org')::UUID
    AND EXISTS (
      SELECT 1 FROM user_roles_projection ur
      JOIN roles_projection r ON r.id = ur.role_id
      WHERE ur.user_id = current_setting('app.current_user')::UUID
        AND r.name = 'provider_admin'
        AND ur.org_id = target_org_id
    )
  );

-- Policy: Users can view their own impersonation sessions (as either super admin or target)
DROP POLICY IF EXISTS impersonation_sessions_own_sessions_select ON impersonation_sessions_projection;
CREATE POLICY impersonation_sessions_own_sessions_select
  ON impersonation_sessions_projection
  FOR SELECT
  USING (
    super_admin_user_id = current_setting('app.current_user')::UUID
    OR target_user_id = current_setting('app.current_user')::UUID
  );

COMMENT ON POLICY impersonation_sessions_super_admin_select ON impersonation_sessions_projection IS
  'Allows super admins to view all impersonation sessions across all organizations';
COMMENT ON POLICY impersonation_sessions_provider_admin_select ON impersonation_sessions_projection IS
  'Allows provider admins to view impersonation sessions that affected their organization';
COMMENT ON POLICY impersonation_sessions_own_sessions_select ON impersonation_sessions_projection IS
  'Allows users to view sessions where they were either the impersonator or the target';


-- ============================================================================
-- SECTION: 07-post-deployment
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/07-post-deployment/018-event-workflow-linking-index.sql
-- ----------------------------------------------------------------------------

-- =====================================================
-- Migration: Event-Workflow Linking Indexes
-- =====================================================
-- Purpose: Enable bi-directional traceability between domain events and Temporal workflows
--
-- Context:
--   When Temporal workflows execute activities that emit domain events, we need to
--   track which workflow created each event. This enables:
--   - Complete audit trail (HIPAA compliance)
--   - Workflow debugging (query all events for a failed workflow)
--   - Event replay (reconstruct workflow state from event history)
--   - Performance monitoring (track workflow progress via event stream)
--
-- Event Metadata Structure:
--   event_metadata jsonb contains:
--   {
--     "workflow_id": "org-bootstrap-abc123",       # Deterministic workflow ID
--     "workflow_run_id": "uuid-v4-temporal-run",   # Temporal execution ID
--     "workflow_type": "organizationBootstrapWorkflow",
--     "activity_id": "createOrganizationActivity",  # Optional: which activity emitted
--     "timestamp": "2025-11-23T12:00:00.000Z"
--   }
--
-- Idempotency: Safe to run multiple times (CREATE INDEX IF NOT EXISTS)
-- Reversible: DROP INDEX statements provided in comments
--
-- Author: A4C Infrastructure Team
-- Created: 2025-11-23
-- =====================================================

-- Index 1: Query all events for a specific workflow
-- Use case: "Show me all events emitted during workflow org-bootstrap-abc123"
CREATE INDEX IF NOT EXISTS idx_domain_events_workflow_id
ON domain_events ((event_metadata->>'workflow_id'))
WHERE event_metadata->>'workflow_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_workflow_id IS
  'Enables efficient queries for all events emitted during a workflow execution.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''workflow_id'' = ''org-bootstrap-abc123'';';

-- Index 2: Query events for a specific Temporal execution (run ID)
-- Use case: "Show me all events from this exact workflow run (handles retries/replays)"
CREATE INDEX IF NOT EXISTS idx_domain_events_workflow_run_id
ON domain_events ((event_metadata->>'workflow_run_id'))
WHERE event_metadata->>'workflow_run_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_workflow_run_id IS
  'Enables queries for specific workflow run (Temporal execution ID).
   Useful for distinguishing between retries/replays of the same workflow.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''workflow_run_id'' = ''uuid-v4-run-id'';';

-- Index 3: Composite index for workflow + event type queries
-- Use case: "Show me all 'contact.added' events from workflow org-bootstrap-abc123"
CREATE INDEX IF NOT EXISTS idx_domain_events_workflow_type
ON domain_events ((event_metadata->>'workflow_id'), event_type)
WHERE event_metadata->>'workflow_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_workflow_type IS
  'Optimizes queries filtering by both workflow and event type.
   Example: SELECT * FROM domain_events
            WHERE event_metadata->>''workflow_id'' = ''org-bootstrap-abc123''
              AND event_type = ''contact.added'';';

-- Index 4: Activity attribution (optional, for detailed debugging)
-- Use case: "Show me all events emitted by createOrganizationActivity"
CREATE INDEX IF NOT EXISTS idx_domain_events_activity_id
ON domain_events ((event_metadata->>'activity_id'))
WHERE event_metadata->>'activity_id' IS NOT NULL;

COMMENT ON INDEX idx_domain_events_activity_id IS
  'Enables queries for events emitted by specific workflow activities.
   Useful for debugging which activity failed or produced unexpected events.
   Example: SELECT * FROM domain_events WHERE event_metadata->>''activity_id'' = ''createOrganizationActivity'';';

-- =====================================================
-- Rollback Instructions
-- =====================================================
-- To remove these indexes:
-- DROP INDEX IF EXISTS idx_domain_events_workflow_id;
-- DROP INDEX IF EXISTS idx_domain_events_workflow_run_id;
-- DROP INDEX IF EXISTS idx_domain_events_workflow_type;
-- DROP INDEX IF EXISTS idx_domain_events_activity_id;
-- =====================================================

-- =====================================================
-- Query Examples for Developers
-- =====================================================

-- Example 1: Find all events for a workflow
-- SELECT id, event_type, event_data, created_at
-- FROM domain_events
-- WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
-- ORDER BY created_at ASC;

-- Example 2: Count events by type for a workflow
-- SELECT event_type, COUNT(*) as count
-- FROM domain_events
-- WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
-- GROUP BY event_type
-- ORDER BY count DESC;

-- Example 3: Find the initiating event for a workflow
-- SELECT id, event_type, event_data, created_at
-- FROM domain_events
-- WHERE event_metadata->>'workflow_id' = 'org-bootstrap-abc123'
-- ORDER BY created_at ASC
-- LIMIT 1;

-- Example 4: Find workflows that failed (have events with processing_error)
-- SELECT DISTINCT event_metadata->>'workflow_id' as workflow_id,
--        COUNT(*) as error_count
-- FROM domain_events
-- WHERE processing_error IS NOT NULL
--   AND event_metadata->>'workflow_id' IS NOT NULL
-- GROUP BY event_metadata->>'workflow_id'
-- ORDER BY error_count DESC;

-- Example 5: Trace workflow lineage (find bootstrap event → workflow → all events)
-- WITH bootstrap_event AS (
--   SELECT event_metadata->>'workflow_id' as workflow_id
--   FROM domain_events
--   WHERE event_type = 'organization.bootstrap.initiated'
--     AND stream_id = 'some-org-id'
--   LIMIT 1
-- )
-- SELECT de.event_type, de.created_at, de.event_data
-- FROM domain_events de
-- JOIN bootstrap_event be ON de.event_metadata->>'workflow_id' = be.workflow_id
-- ORDER BY de.created_at ASC;

-- =====================================================


-- ============================================================================
-- SECTION: 99-seeds
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Source: sql/99-seeds/001-minimal-permissions.sql
-- ----------------------------------------------------------------------------

-- Minimal Permissions Seed: 22 Core Permissions for Bootstrap
-- All permissions inserted via permission.defined events for event sourcing integrity
--
-- IDEMPOTENT: Can be run multiple times safely
-- Each permission is checked before insertion to prevent duplicates

-- ============================================================================
-- Organization Management Permissions (8)
-- ============================================================================

-- organization.create_root
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_root'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "create_root", "description": "Create new root tenant organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb
    );
  END IF;
END $$;

-- organization.create_sub
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_sub'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "create_sub", "description": "Create sub-organizations within organizational hierarchy", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization hierarchy management"}'::jsonb
    );
  END IF;
END $$;

-- organization.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "view", "description": "View organization details", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization visibility"}'::jsonb
    );
  END IF;
END $$;

-- organization.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "update", "description": "Update organization details and settings", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization management"}'::jsonb
    );
  END IF;
END $$;

-- organization.deactivate
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'deactivate'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "deactivate", "description": "Deactivate organization (soft delete, reversible)", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization lifecycle management"}'::jsonb
    );
  END IF;
END $$;

-- organization.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "delete", "description": "Permanently delete organization (irreversible)", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization lifecycle management"}'::jsonb
    );
  END IF;
END $$;

-- organization.business_profile_create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'business_profile_create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "business_profile_create", "description": "Create business profile for organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization profile management"}'::jsonb
    );
  END IF;
END $$;

-- organization.business_profile_update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'business_profile_update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "business_profile_update", "description": "Update business profile for organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Organization profile management"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- Role Management Permissions (5)
-- ============================================================================

-- role.create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "create", "description": "Create new roles within organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role management"}'::jsonb
    );
  END IF;
END $$;

-- role.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "view", "description": "View roles and their permissions", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role visibility"}'::jsonb
    );
  END IF;
END $$;

-- role.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "update", "description": "Modify role details and description", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role management"}'::jsonb
    );
  END IF;
END $$;

-- role.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "delete", "description": "Delete role (soft delete, removes from all users)", "scope_type": "org", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Role management"}'::jsonb
    );
  END IF;
END $$;

-- role.grant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'grant'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "grant", "description": "Assign roles to users", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User role assignment"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- Permission Management Permissions (3)
-- ============================================================================

-- permission.grant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'grant'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "grant", "description": "Grant permissions to roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: RBAC management"}'::jsonb
    );
  END IF;
END $$;

-- permission.revoke
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'revoke'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "revoke", "description": "Revoke permissions from roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: RBAC management"}'::jsonb
    );
  END IF;
END $$;

-- permission.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "view", "description": "View available permissions and grants", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Permission visibility"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- User Management Permissions (6)
-- ============================================================================

-- user.create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "create", "description": "Create new users in organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User management"}'::jsonb
    );
  END IF;
END $$;

-- user.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "view", "description": "View user profiles and details", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User visibility"}'::jsonb
    );
  END IF;
END $$;

-- user.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "update", "description": "Update user profile information", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User management"}'::jsonb
    );
  END IF;
END $$;

-- user.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "delete", "description": "Delete user account (soft delete)", "scope_type": "org", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User management"}'::jsonb
    );
  END IF;
END $$;

-- user.role_assign
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'role_assign'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "role_assign", "description": "Assign roles to users (creates user.role.assigned event)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User role management"}'::jsonb
    );
  END IF;
END $$;

-- user.role_revoke
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'user'
      AND event_data->>'action' = 'role_revoke'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "user", "action": "role_revoke", "description": "Revoke roles from users (creates user.role.revoked event)", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: User role management"}'::jsonb
    );
  END IF;
END $$;


-- ============================================================================
-- Verification
-- ============================================================================

-- Display count of permissions after seeding (for verification)
DO $$
DECLARE
  permission_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO permission_count
  FROM domain_events
  WHERE event_type = 'permission.defined';

  RAISE NOTICE 'Total permissions defined: %', permission_count;
  RAISE NOTICE 'Expected: 22 (8 organization + 5 role + 3 permission + 6 user)';

  IF permission_count < 22 THEN
    RAISE WARNING 'Permission count is less than expected! Check for errors.';
  ELSIF permission_count > 22 THEN
    RAISE NOTICE 'Permission count is higher than expected - may include additional custom permissions.';
  ELSE
    RAISE NOTICE '✓ All core permissions seeded successfully!';
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- Source: sql/99-seeds/002-bootstrap-org-roles.sql
-- ----------------------------------------------------------------------------

-- Bootstrap Organization & Roles
-- Creates the A4C platform organization and core role templates

-- ============================================================================
-- A4C Platform Organization
-- ============================================================================

-- Create Analytics4Change platform organization via event
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'organization', 1, 'organization.registered',
   '{
     "name": "Analytics4Change",
     "slug": "a4c",
     "org_type": "platform_owner",
     "parent_org_id": null,
     "settings": {
       "is_active": true,
       "is_internal": true,
       "description": "Platform owner organization"
     }
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating A4C platform organization"
   }'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

-- Create organization projection manually (no organization event processor yet in minimal bootstrap)
INSERT INTO organizations_projection (
  id,
  name,
  slug,
  type,
  path,
  parent_path,
  is_active,
  created_at
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Analytics4Change',
  'a4c',
  'platform_owner',
  'root.a4c'::LTREE,
  NULL,
  true,
  NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- Core Role Templates
-- ============================================================================

-- Super Admin Role (global scope, NULL org_id for platform-wide access)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'role', 1, 'role.created',
   '{
     "name": "super_admin",
     "description": "Platform administrator who manages tenant onboarding and permissions"
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating super_admin role for A4C platform staff"
   }'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

-- Provider Admin Role Template (permissions granted per organization during provisioning)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('22222222-2222-2222-2222-222222222222', 'role', 1, 'role.created',
   '{
     "name": "provider_admin",
     "description": "Organization administrator who manages their provider organization (permissions granted during org provisioning)"
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating provider_admin role template"
   }'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

-- Partner Admin Role Template (permissions granted per organization during provisioning)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('33333333-3333-3333-3333-333333333333', 'role', 1, 'role.created',
   '{
     "name": "partner_admin",
     "description": "Provider partner administrator who manages cross-tenant access (permissions granted during org provisioning)"
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating partner_admin role template"
   }'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;


-- ============================================================================
-- Notes
-- ============================================================================

-- Provider Admin and Partner Admin roles have NO permissions at this stage
-- Permissions are granted during organization provisioning workflows
-- This ensures proper scoping: provider_admin manages their org, not others
--
-- Super Admin is assigned all 22 permissions in the next seed file


-- ----------------------------------------------------------------------------
-- Source: sql/99-seeds/003-grant-super-admin-permissions.sql
-- ----------------------------------------------------------------------------

-- Grant All Permissions to Super Admin Role
-- Creates role.permission.granted events for all 22 permissions

DO $$
DECLARE
  perm_record RECORD;
  version_counter INT := 2;  -- Start at version 2 (version 1 was role.created)
  inserted_count INT := 0;
BEGIN
  -- Grant all 22 permissions to super_admin role
  -- These will be processed by the RBAC event triggers into role_permissions_projection

  FOR perm_record IN
    SELECT id, applet, action
    FROM permissions_projection
    WHERE applet IN ('organization', 'role', 'permission', 'user')
    ORDER BY applet, action  -- Deterministic ordering for consistent stream versions
  LOOP
    -- Only insert if event doesn't already exist (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM domain_events
      WHERE stream_id = '11111111-1111-1111-1111-111111111111'
        AND stream_type = 'role'
        AND stream_version = version_counter
    ) THEN
      INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
      VALUES (
        '11111111-1111-1111-1111-111111111111',  -- super_admin role stream_id
        'role',
        version_counter,
        'role.permission.granted',
        jsonb_build_object(
          'permission_id', perm_record.id,
          'permission_name', perm_record.applet || '.' || perm_record.action
        ),
        jsonb_build_object(
          'user_id', '00000000-0000-0000-0000-000000000000',
          'reason', 'Bootstrap: Granting ' || perm_record.applet || '.' || perm_record.action || ' to super_admin'
        )
      );
      inserted_count := inserted_count + 1;
    END IF;

    version_counter := version_counter + 1;
  END LOOP;

  -- Log summary
  RAISE NOTICE 'Granted % new permissions to super_admin role (% total checked)', inserted_count, version_counter - 2;
END $$;


-- ----------------------------------------------------------------------------
-- Source: sql/99-seeds/003-rbac-initial-setup.sql
-- ----------------------------------------------------------------------------

-- RBAC Initial Setup: Minimal Viable Permissions for Platform Bootstrap
-- This seed creates the foundational RBAC structure for:
-- 1. Super Admin: Manages tenant onboarding and A4C internal roles
-- 2. Provider Admin: Bootstrap role (permissions granted per organization later)
-- 3. Partner Admin: Bootstrap role (permissions granted per organization later)
--
-- IDEMPOTENT: Can be run multiple times safely
-- All inserts go through the event-sourced architecture

-- ========================================
-- Phase 1: Organization Management Permissions
-- Super Admin manages tenant/provider onboarding
-- ========================================

-- organization.create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "create", "description": "Create new tenant organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb
    );
  END IF;
END $$;

-- organization.suspend
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'suspend'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "suspend", "description": "Suspend organization access (e.g., payment issues)", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb
    );
  END IF;
END $$;

-- organization.activate
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'activate'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "activate", "description": "Activate or reactivate organization", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb
    );
  END IF;
END $$;

-- organization.search
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'search'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "organization", "action": "search", "description": "Search across all organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb
    );
  END IF;
END $$;


-- ========================================
-- Phase 2: A4C Internal Role Management Permissions
-- Super Admin manages roles within Analytics4Change organization
-- ========================================

-- a4c_role.create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'a4c_role'
      AND event_data->>'action' = 'create'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "a4c_role", "action": "create", "description": "Create roles within A4C organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb
    );
  END IF;
END $$;

-- a4c_role.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'a4c_role'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "a4c_role", "action": "view", "description": "View A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb
    );
  END IF;
END $$;

-- a4c_role.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'a4c_role'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "a4c_role", "action": "update", "description": "Modify A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb
    );
  END IF;
END $$;

-- a4c_role.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'a4c_role'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "a4c_role", "action": "delete", "description": "Delete A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb
    );
  END IF;
END $$;

-- a4c_role.assign
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'a4c_role'
      AND event_data->>'action' = 'assign'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "a4c_role", "action": "assign", "description": "Assign A4C roles to A4C staff users", "scope_type": "org", "requires_mfa": false}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb
    );
  END IF;
END $$;


-- ========================================
-- Phase 3: Meta-Permissions (RBAC Management)
-- Super Admin manages permissions and role grants
-- ========================================

-- permission.grant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'grant'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "grant", "description": "Grant permissions to roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb
    );
  END IF;
END $$;

-- permission.revoke
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'permission'
      AND event_data->>'action' = 'revoke'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "permission", "action": "revoke", "description": "Revoke permissions from roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb
    );
  END IF;
END $$;

-- role.grant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'role'
      AND event_data->>'action' = 'grant'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      gen_random_uuid(), 'permission', 1, 'permission.defined',
      '{"applet": "role", "action": "grant", "description": "Assign roles to users", "scope_type": "global", "requires_mfa": true}'::jsonb,
      '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb
    );
  END IF;
END $$;


-- ========================================
-- Initial Roles
-- ========================================

-- A4C Platform Organization (owner of the application)
-- Fixed UUID for idempotency
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'organization', 1, 'organization.registered',
   '{
     "name": "Analytics4Change",
     "slug": "a4c",
     "org_type": "platform_owner",
     "parent_org_id": null,
     "settings": {
       "is_active": true,
       "is_internal": true,
       "description": "Platform owner organization"
     }
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating A4C platform organization"}'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

-- Super Admin Role (global scope, NULL org_id for platform-wide access)
-- Fixed UUID for idempotency
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'role', 1, 'role.created',
   '{
     "name": "super_admin",
     "description": "Platform administrator who manages tenant onboarding and A4C internal roles"
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating super_admin role for A4C platform staff"}'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

-- Provider Admin Role Template (bootstrap only, actual roles created per organization)
-- Fixed UUID for idempotency
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('22222222-2222-2222-2222-222222222222', 'role', 1, 'role.created',
   '{
     "name": "provider_admin",
     "description": "Organization administrator who manages their own provider organization (permissions granted during org provisioning)",
     "org_hierarchy_scope": null
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating provider_admin role template"}'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

-- Partner Admin Role Template (bootstrap only, actual roles created per organization)
-- Fixed UUID for idempotency
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('33333333-3333-3333-3333-333333333333', 'role', 1, 'role.created',
   '{
     "name": "partner_admin",
     "description": "Provider partner administrator who manages cross-tenant access (permissions granted during org provisioning)",
     "org_hierarchy_scope": null
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating partner_admin role template"}'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;


-- ========================================
-- Grant All Permissions to Super Admin
-- ========================================

-- Grant all 16 permissions to super_admin role
-- These will be processed by the event triggers into role_permissions_projection table
-- IDEMPOTENT: Only grants permissions that haven't been granted yet

DO $$
DECLARE
  perm_record RECORD;
  version_counter INT;
BEGIN
  -- Get current version for super_admin role stream
  SELECT COALESCE(MAX(stream_version), 1) + 1 INTO version_counter
  FROM domain_events
  WHERE stream_id = '11111111-1111-1111-1111-111111111111';

  -- Grant permissions that haven't been granted yet
  FOR perm_record IN
    SELECT id, applet, action
    FROM permissions_projection
    WHERE applet IN ('organization', 'a4c_role', 'permission', 'role')
      -- Only select permissions not already granted
      AND id NOT IN (
        SELECT (event_data->>'permission_id')::UUID
        FROM domain_events
        WHERE stream_id = '11111111-1111-1111-1111-111111111111'
          AND event_type = 'role.permission.granted'
      )
  LOOP
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      '11111111-1111-1111-1111-111111111111',  -- super_admin role stream_id
      'role',
      version_counter,
      'role.permission.granted',
      jsonb_build_object(
        'permission_id', perm_record.id,
        'permission_name', perm_record.applet || '.' || perm_record.action
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Bootstrap: Granting ' || perm_record.applet || '.' || perm_record.action || ' to super_admin'
      )
    );

    version_counter := version_counter + 1;
  END LOOP;

  RAISE NOTICE 'Granted % new permissions to super_admin role', version_counter - 2;
END $$;


-- ========================================
-- Documentation
-- ========================================

COMMENT ON EXTENSION "uuid-ossp" IS 'Used for generating UUIDs for permission and role IDs';

-- Notes:
-- 1. Provider Admin and Partner Admin roles have NO permissions in this seed
--    - Permissions are granted during organization provisioning workflows
--    - This ensures proper scoping: provider_admin manages their org, not others
--
-- 2. Super Admin manages two distinct areas:
--    - Tenant/organization lifecycle (organization.*)
--    - A4C internal role delegation (a4c_role.*)
--
-- 3. Super Admin does NOT create provider roles like "clinician" or "specialist"
--    - Provider Admin creates those within their organization
--    - Example: "Lars granted medication.create to clinician role on 2025-10-20"
--      would be done by provider_admin, not super_admin
--
-- 4. Super Admin CAN impersonate any role via separate impersonation workflow
--    - Impersonation is audited and logged
--    - Super Admin acts under constraints of impersonated role


-- ----------------------------------------------------------------------------
-- Source: sql/99-seeds/004-organization-permissions-setup.sql
-- ----------------------------------------------------------------------------

-- Organization Permissions Setup
-- Initializes organization-related permissions via event sourcing
-- This script emits permission.defined events for organization lifecycle management
--
-- IDEMPOTENT: Can be run multiple times safely
-- Uses conditional DO blocks to check for existing permissions before insertion

-- ========================================
-- Organization Lifecycle Permissions
-- ========================================

-- organization.create_root
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_root'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'create_root',
        'name', 'organization.create_root',
        'description', 'Create top-level organizations (Platform Owner only)',
        'scope_type', 'global',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.create_root permission'
      )
    );
  END IF;
END $$;

-- organization.create_sub
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_sub'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'create_sub',
        'name', 'organization.create_sub',
        'description', 'Create sub-organizations within hierarchy',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.create_sub permission'
      )
    );
  END IF;
END $$;

-- organization.deactivate
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'deactivate'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'deactivate',
        'name', 'organization.deactivate',
        'description', 'Deactivate organizations (billing, compliance, operational)',
        'scope_type', 'org',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.deactivate permission'
      )
    );
  END IF;
END $$;

-- organization.delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'delete'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'delete',
        'name', 'organization.delete',
        'description', 'Delete organizations with cascade handling',
        'scope_type', 'global',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.delete permission'
      )
    );
  END IF;
END $$;

-- organization.business_profile_create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'business_profile_create'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'business_profile_create',
        'name', 'organization.business_profile_create',
        'description', 'Create business profiles (Platform Owner only)',
        'scope_type', 'global',
        'requires_mfa', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.business_profile_create permission'
      )
    );
  END IF;
END $$;

-- organization.business_profile_update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'business_profile_update'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'business_profile_update',
        'name', 'organization.business_profile_update',
        'description', 'Update business profiles',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.business_profile_update permission'
      )
    );
  END IF;
END $$;

-- organization.view
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'view'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'view',
        'name', 'organization.view',
        'description', 'View organization information and hierarchy',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.view permission'
      )
    );
  END IF;
END $$;

-- organization.update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'update'
  ) THEN
    INSERT INTO domain_events (
      stream_id, stream_type, stream_version, event_type, event_data, event_metadata
    ) VALUES (
      gen_random_uuid(),
      'permission',
      1,
      'permission.defined',
      jsonb_build_object(
        'applet', 'organization',
        'action', 'update',
        'name', 'organization.update',
        'description', 'Update organization information',
        'scope_type', 'org',
        'requires_mfa', false
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Platform initialization: defining organization.update permission'
      )
    );
  END IF;
END $$;

-- ========================================
-- Verification
-- ========================================

DO $$
DECLARE
  org_permission_count INTEGER;
BEGIN
  -- Count organization permissions
  SELECT COUNT(*) INTO org_permission_count
  FROM domain_events
  WHERE event_type = 'permission.defined'
    AND event_data->>'applet' = 'organization';

  RAISE NOTICE 'Total organization permissions defined: %', org_permission_count;
  RAISE NOTICE 'Organization permissions from this file: 8';
  RAISE NOTICE '✓ Organization permissions seeded successfully!';
END $$;


-- ----------------------------------------------------------------------------
-- Source: sql/99-seeds/004-platform-admin-users.sql
-- ----------------------------------------------------------------------------

-- Bootstrap Platform Admin Users
-- Creates platform admin users and assigns super_admin role
--
-- USAGE: To add more users, add entries to the platform_admin_users VALUES array
-- Each user needs their actual Supabase Auth UUID from: SELECT id FROM auth.users WHERE email = '<email>';

-- ============================================================================
-- Platform Admin User Creation
-- ============================================================================

DO $$
DECLARE
  user_record RECORD;
  v_stream_version INT;  -- Renamed to avoid ambiguity with column name
BEGIN
  -- Define platform admin users
  -- Format: (auth_user_id, email, full_name)
  FOR user_record IN
    SELECT * FROM (VALUES
      ('5a975b95-a14d-4ddd-bdb6-949033dab0b8'::UUID, 'lars.tice@gmail.com', 'Lars Tice')
      -- To add more users, uncomment and add entries here:
      -- ,('XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX'::UUID, 'admin2@example.com', 'Admin User 2')
      -- ,('YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY'::UUID, 'admin3@example.com', 'Admin User 3')
    ) AS t(auth_user_id, email, full_name)
  LOOP
    v_stream_version := 1;

    -- Create user.synced_from_auth event
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      user_record.auth_user_id,
      'user',
      v_stream_version,
      'user.synced_from_auth',
      jsonb_build_object(
        'email', user_record.email,
        'auth_user_id', user_record.auth_user_id::TEXT,
        'name', user_record.full_name,
        'is_active', true
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Bootstrap: Creating ' || user_record.full_name || ' as platform admin'
      )
    )
    ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

    -- Create user projection manually (no user event processor yet in minimal bootstrap)
    INSERT INTO users (
      id,
      email,
      name,
      is_active,
      created_at
    ) VALUES (
      user_record.auth_user_id,
      user_record.email,
      user_record.full_name,
      true,
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    -- Assign super_admin role to user (in A4C organization context)
    v_stream_version := v_stream_version + 1;

    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      user_record.auth_user_id,
      'user',
      v_stream_version,
      'user.role.assigned',
      jsonb_build_object(
        'role_id', '11111111-1111-1111-1111-111111111111',  -- super_admin role
        'role_name', 'super_admin',
        'org_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'  -- A4C organization (NULL for global role assignment)
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Bootstrap: Assigning super_admin role to ' || user_record.full_name
      )
    )
    ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

    RAISE NOTICE 'Created platform admin: % (%) with super_admin role', user_record.full_name, user_record.auth_user_id;
  END LOOP;
END $$;


-- ============================================================================
-- Verification
-- ============================================================================

-- Verify all users exist and have super_admin role
DO $$
DECLARE
  user_record RECORD;
  role_count INT;
BEGIN
  FOR user_record IN
    SELECT * FROM (VALUES
      ('5a975b95-a14d-4ddd-bdb6-949033dab0b8'::UUID, 'lars.tice@gmail.com', 'Lars Tice')
      -- Match the list above for verification
      -- ,('XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX'::UUID, 'admin2@example.com', 'Admin User 2')
      -- ,('YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY'::UUID, 'admin3@example.com', 'Admin User 3')
    ) AS t(auth_user_id, email, full_name)
  LOOP
    -- Verify user exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = user_record.auth_user_id) THEN
      RAISE WARNING '% (%) not found in users table', user_record.full_name, user_record.email;
      CONTINUE;
    END IF;

    -- Verify user has super_admin role
    SELECT COUNT(*) INTO role_count
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = user_record.auth_user_id
      AND r.name = 'super_admin';

    IF role_count = 0 THEN
      RAISE WARNING '% (%) does not have super_admin role yet', user_record.full_name, user_record.auth_user_id;
    ELSE
      RAISE NOTICE 'Verification passed: % (%) has super_admin role', user_record.full_name, user_record.auth_user_id;
    END IF;
  END LOOP;
END $$;


COMMIT;

-- ============================================================================
-- END OF CONSOLIDATED SCHEMA
-- ============================================================================
