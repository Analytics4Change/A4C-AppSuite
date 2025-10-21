-- ============================================================================
-- CONSOLIDATED DEPLOYMENT SCRIPT FOR SUPABASE
-- ============================================================================
--
-- This file contains all SQL migration scripts consolidated into a single file
-- for deployment via Supabase Studio SQL Editor.
--
-- IMPORTANT: This script must be run in a transaction to ensure atomicity.
--
-- Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
--
-- Deployment Order:
-- 1. Extensions (00-extensions/)
-- 2. Event Sourcing Infrastructure (01-events/)
-- 3. Tables and Projections (02-tables/)
-- 4. Functions (03-functions/)
-- 5. Triggers (04-triggers/)
-- 6. Views (05-views/)
-- 7. Row Level Security (06-rls/)
-- 8. Seed Data (99-seeds/)
--
-- ============================================================================

BEGIN;


-- ============================================================================
-- 00-extensions
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: 00-extensions/001-uuid-ossp.sql
-- ----------------------------------------------------------------------------

-- Enable UUID generation extension
-- Required for gen_random_uuid() function
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- File: 00-extensions/002-pgcrypto.sql
-- ----------------------------------------------------------------------------

-- Enable pgcrypto extension
-- Required for encryption and hashing functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- File: 00-extensions/003-ltree.sql
-- ----------------------------------------------------------------------------

-- Enable ltree extension for hierarchical data structures
-- Required for organization hierarchy management with PostgreSQL ltree
CREATE EXTENSION IF NOT EXISTS ltree;

-- Add comments for documentation
COMMENT ON EXTENSION ltree IS 'Hierarchical tree-like data type for organization paths and permission scoping';

-- ============================================================================
-- 00-reference
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: 00-reference/zitadel-bootstrap-reference.sql
-- ----------------------------------------------------------------------------

-- Zitadel Bootstrap Service
-- Handles Zitadel API integration for organization bootstrap with retry/circuit breaker patterns
-- CQRS-compliant: Only emits events, never directly updates projections

-- Circuit breaker state management for Zitadel API
CREATE TABLE IF NOT EXISTS zitadel_circuit_breaker (
  service_name TEXT PRIMARY KEY DEFAULT 'zitadel_management_api',
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_failure_time TIMESTAMPTZ,
  next_retry_time TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize circuit breaker state
INSERT INTO zitadel_circuit_breaker (service_name) 
VALUES ('zitadel_management_api') 
ON CONFLICT (service_name) DO NOTHING;

-- Circuit breaker configuration
CREATE OR REPLACE FUNCTION get_circuit_breaker_config()
RETURNS TABLE (
  failure_threshold INTEGER,
  timeout_seconds INTEGER,
  retry_delay_seconds INTEGER
) AS $$
BEGIN
  RETURN QUERY SELECT 
    3 as failure_threshold,      -- Open circuit after 3 failures
    300 as timeout_seconds,      -- Keep circuit open for 5 minutes
    30 as retry_delay_seconds;   -- Wait 30 seconds between retries
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check circuit breaker state
CREATE OR REPLACE FUNCTION check_circuit_breaker(
  p_service_name TEXT DEFAULT 'zitadel_management_api'
) RETURNS TEXT AS $$
DECLARE
  v_state TEXT;
  v_failure_count INTEGER;
  v_next_retry_time TIMESTAMPTZ;
  v_config RECORD;
BEGIN
  -- Get current state
  SELECT state, failure_count, next_retry_time 
  INTO v_state, v_failure_count, v_next_retry_time
  FROM zitadel_circuit_breaker 
  WHERE service_name = p_service_name;
  
  -- Get configuration
  SELECT * INTO v_config FROM get_circuit_breaker_config();
  
  -- Handle circuit breaker logic
  CASE v_state
    WHEN 'closed' THEN
      RETURN 'closed';
      
    WHEN 'open' THEN
      -- Check if enough time has passed to try half-open
      IF NOW() >= v_next_retry_time THEN
        -- Transition to half-open
        UPDATE zitadel_circuit_breaker 
        SET state = 'half_open', updated_at = NOW()
        WHERE service_name = p_service_name;
        RETURN 'half_open';
      ELSE
        RETURN 'open';
      END IF;
      
    WHEN 'half_open' THEN
      RETURN 'half_open';
      
    ELSE
      RETURN 'closed';
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to record circuit breaker success
CREATE OR REPLACE FUNCTION record_circuit_breaker_success(
  p_service_name TEXT DEFAULT 'zitadel_management_api'
) RETURNS VOID AS $$
BEGIN
  -- Reset circuit breaker on success
  UPDATE zitadel_circuit_breaker 
  SET 
    state = 'closed',
    failure_count = 0,
    last_failure_time = NULL,
    next_retry_time = NULL,
    updated_at = NOW()
  WHERE service_name = p_service_name;
END;
$$ LANGUAGE plpgsql;

-- Function to record circuit breaker failure
CREATE OR REPLACE FUNCTION record_circuit_breaker_failure(
  p_service_name TEXT DEFAULT 'zitadel_management_api'
) RETURNS VOID AS $$
DECLARE
  v_config RECORD;
  v_failure_count INTEGER;
BEGIN
  SELECT * INTO v_config FROM get_circuit_breaker_config();
  
  -- Increment failure count
  UPDATE zitadel_circuit_breaker 
  SET 
    failure_count = failure_count + 1,
    last_failure_time = NOW(),
    updated_at = NOW()
  WHERE service_name = p_service_name;
  
  -- Get updated failure count
  SELECT failure_count INTO v_failure_count
  FROM zitadel_circuit_breaker 
  WHERE service_name = p_service_name;
  
  -- Open circuit if threshold exceeded
  IF v_failure_count >= v_config.failure_threshold THEN
    UPDATE zitadel_circuit_breaker 
    SET 
      state = 'open',
      next_retry_time = NOW() + (v_config.timeout_seconds || ' seconds')::INTERVAL,
      updated_at = NOW()
    WHERE service_name = p_service_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Bootstrap orchestrator function (Saga coordinator)
-- CRITICAL: This function ONLY emits events, never updates projections directly
CREATE OR REPLACE FUNCTION orchestrate_organization_bootstrap(
  p_bootstrap_id UUID,
  p_organization_type TEXT,
  p_organization_name TEXT,
  p_admin_email TEXT,
  p_slug TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_organization_id UUID;
  v_circuit_state TEXT;
  v_contact_info JSONB;
BEGIN
  -- Generate organization ID
  v_organization_id := gen_random_uuid();
  
  -- Check circuit breaker before proceeding
  v_circuit_state := check_circuit_breaker();
  IF v_circuit_state = 'open' THEN
    -- Emit bootstrap failure event
    INSERT INTO domain_events (
      stream_id, stream_type, event_type, event_data, event_metadata, created_at
    ) VALUES (
      v_organization_id,
      'organization',
      'organization.bootstrap.failed',
      jsonb_build_object(
        'bootstrap_id', p_bootstrap_id,
        'failure_stage', 'zitadel_org_creation',
        'error_message', 'Zitadel API circuit breaker is open',
        'partial_cleanup_required', false
      ),
      jsonb_build_object(
        'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
        'reason', 'Bootstrap failed: Zitadel API temporarily unavailable'
      ),
      NOW()
    );
    
    RAISE EXCEPTION 'Zitadel API circuit breaker is open. Please try again later.';
  END IF;
  
  -- Prepare contact info
  v_contact_info := jsonb_build_object(
    'timezone', 'America/New_York'
  );
  
  -- Emit bootstrap initiated event
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    v_organization_id,
    'organization',
    'organization.bootstrap.initiated',
    jsonb_build_object(
      'bootstrap_id', p_bootstrap_id,
      'organization_type', p_organization_type,
      'organization_name', p_organization_name,
      'admin_email', p_admin_email,
      'slug', COALESCE(p_slug, replace(lower(p_organization_name), ' ', '_')),
      'contact_info', v_contact_info
    ),
    jsonb_build_object(
      'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
      'reason', format('Initiating bootstrap for %s organization: %s', p_organization_type, p_organization_name)
    ),
    NOW()
  );
  
  -- NOTE: The actual Zitadel API calls would be handled by an external service
  -- that listens for organization.bootstrap.initiated events and emits
  -- organization.zitadel.created or organization.bootstrap.failed events
  
  RETURN v_organization_id;
END;
$$ LANGUAGE plpgsql;

-- Function to simulate Zitadel organization creation (for testing)
-- In production, this would be replaced by actual HTTP API calls
CREATE OR REPLACE FUNCTION simulate_zitadel_org_creation(
  p_event_data JSONB,
  p_organization_id UUID,
  p_user_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_bootstrap_id UUID;
  v_organization_name TEXT;
  v_admin_email TEXT;
  v_organization_type TEXT;
  v_slug TEXT;
  v_zitadel_org_id TEXT;
  v_zitadel_user_id TEXT;
  v_circuit_state TEXT;
  v_retry_count INTEGER DEFAULT 0;
  v_max_retries INTEGER DEFAULT 3;
  v_delay_seconds INTEGER[] DEFAULT ARRAY[1, 2, 4, 8]; -- Exponential backoff
BEGIN
  -- Extract data from bootstrap event
  v_bootstrap_id := (p_event_data->>'bootstrap_id')::UUID;
  v_organization_name := p_event_data->>'organization_name';
  v_admin_email := p_event_data->>'admin_email';
  v_organization_type := p_event_data->>'organization_type';
  v_slug := p_event_data->>'slug';
  
  -- Retry loop with exponential backoff
  WHILE v_retry_count <= v_max_retries LOOP
    BEGIN
      -- Check circuit breaker
      v_circuit_state := check_circuit_breaker();
      IF v_circuit_state = 'open' THEN
        RAISE EXCEPTION 'Circuit breaker is open';
      END IF;
      
      -- Simulate Zitadel API call
      -- In production: HTTP POST to Zitadel Management API
      -- For simulation: generate mock IDs
      v_zitadel_org_id := 'zitadel_' || replace(v_slug, '_', '') || '_' || extract(epoch from now())::TEXT;
      v_zitadel_user_id := 'user_' || replace(v_admin_email, '@', '_at_') || '_' || extract(epoch from now())::TEXT;
      
      -- Simulate potential failure (10% chance for testing)
      IF random() < 0.1 THEN
        RAISE EXCEPTION 'Simulated Zitadel API failure';
      END IF;
      
      -- Success: Record circuit breaker success
      PERFORM record_circuit_breaker_success();
      
      -- Emit success event
      INSERT INTO domain_events (
        stream_id, stream_type, event_type, event_data, event_metadata, created_at
      ) VALUES (
        p_organization_id,
        'organization',
        'organization.zitadel.created',
        jsonb_build_object(
          'bootstrap_id', v_bootstrap_id,
          'zitadel_org_id', v_zitadel_org_id,
          'zitadel_user_id', v_zitadel_user_id,
          'admin_email', v_admin_email,
          'organization_name', v_organization_name,
          'organization_type', v_organization_type,
          'slug', v_slug,
          'invitation_sent', true
        ),
        jsonb_build_object(
          'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
          'reason', format('Zitadel organization and user created successfully for %s', v_organization_name)
        ),
        NOW()
      );
      
      -- Success - exit retry loop
      EXIT;
      
    EXCEPTION
      WHEN OTHERS THEN
        v_retry_count := v_retry_count + 1;
        
        -- Record circuit breaker failure
        PERFORM record_circuit_breaker_failure();
        
        -- If max retries exceeded, emit failure event
        IF v_retry_count > v_max_retries THEN
          INSERT INTO domain_events (
            stream_id, stream_type, event_type, event_data, event_metadata, created_at
          ) VALUES (
            p_organization_id,
            'organization',
            'organization.bootstrap.failed',
            jsonb_build_object(
              'bootstrap_id', v_bootstrap_id,
              'failure_stage', 'zitadel_org_creation',
              'error_message', SQLERRM,
              'partial_cleanup_required', false
            ),
            jsonb_build_object(
              'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
              'reason', format('Zitadel organization creation failed after %s retries: %s', v_max_retries, SQLERRM)
            ),
            NOW()
          );
          RETURN;
        END IF;
        
        -- Wait with exponential backoff
        IF v_retry_count <= array_length(v_delay_seconds, 1) THEN
          PERFORM pg_sleep(v_delay_seconds[v_retry_count]);
        ELSE
          PERFORM pg_sleep(8); -- Max delay
        END IF;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to continue bootstrap after Zitadel creation
-- Emits organization.created and role assignment events
CREATE OR REPLACE FUNCTION continue_bootstrap_after_zitadel(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_bootstrap_id UUID;
  v_zitadel_org_id TEXT;
  v_organization_type TEXT;
  v_organization_name TEXT;
  v_slug TEXT;
  v_ltree_path LTREE;
  v_admin_role TEXT;
BEGIN
  -- Extract data from Zitadel creation event
  v_bootstrap_id := (p_event.event_data->>'bootstrap_id')::UUID;
  v_zitadel_org_id := p_event.event_data->>'zitadel_org_id';
  v_organization_type := p_event.event_data->>'organization_type';
  v_organization_name := p_event.event_data->>'organization_name';
  v_slug := p_event.event_data->>'slug';
  
  -- Generate ltree path for root organization
  v_ltree_path := ('root.org_' || v_slug)::LTREE;
  
  -- Determine admin role based on organization type
  v_admin_role := CASE v_organization_type
    WHEN 'provider' THEN 'provider_admin'
    WHEN 'provider_partner' THEN 'partner_admin'
    ELSE 'provider_admin'
  END;
  
  -- Emit organization.created event
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    p_event.stream_id,
    'organization',
    'organization.created',
    jsonb_build_object(
      'name', v_organization_name,
      'display_name', v_organization_name,
      'slug', v_slug,
      'zitadel_org_id', v_zitadel_org_id,
      'type', v_organization_type,
      'path', v_ltree_path::TEXT,
      'parent_path', NULL,
      'timezone', 'America/New_York',
      'metadata', jsonb_build_object(
        'bootstrap_id', v_bootstrap_id,
        'admin_email', p_event.event_data->>'admin_email'
      )
    ),
    jsonb_build_object(
      'user_id', p_event.event_metadata->>'user_id',
      'reason', format('Creating organization record for bootstrapped %s: %s', v_organization_type, v_organization_name)
    ),
    NOW()
  );
  
  -- Emit user.role.assigned event for the admin
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    (p_event.event_data->>'zitadel_user_id')::UUID,
    'user',
    'user.role.assigned',
    jsonb_build_object(
      'role_name', v_admin_role,
      'org_id', p_event.stream_id::TEXT,
      'scope_path', v_ltree_path::TEXT,
      'assigned_by', p_event.event_metadata->>'user_id',
      'zitadel_user_id', p_event.event_data->>'zitadel_user_id'
    ),
    jsonb_build_object(
      'user_id', p_event.event_metadata->>'user_id',
      'reason', format('Assigning %s role to bootstrap admin for %s', v_admin_role, v_organization_name)
    ),
    NOW()
  );
  
  -- Finally, emit bootstrap completion event
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    p_event.stream_id,
    'organization',
    'organization.bootstrap.completed',
    jsonb_build_object(
      'bootstrap_id', v_bootstrap_id,
      'organization_id', p_event.stream_id,
      'admin_role_assigned', v_admin_role,
      'permissions_granted', 0, -- Will be calculated by RBAC event processor
      'zitadel_org_id', v_zitadel_org_id,
      'ltree_path', v_ltree_path::TEXT
    ),
    jsonb_build_object(
      'user_id', p_event.event_metadata->>'user_id',
      'reason', format('Bootstrap completed successfully for %s: %s', v_organization_type, v_organization_name)
    ),
    NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE zitadel_circuit_breaker IS 
  'Circuit breaker state for Zitadel API to handle failures gracefully';
COMMENT ON FUNCTION orchestrate_organization_bootstrap IS 
  'CQRS-compliant bootstrap orchestrator - emits events only, never updates projections directly';
COMMENT ON FUNCTION simulate_zitadel_org_creation IS 
  'Simulates Zitadel API calls with retry/circuit breaker (replace with actual HTTP calls in production)';
COMMENT ON FUNCTION continue_bootstrap_after_zitadel IS 
  'Continues bootstrap process after successful Zitadel org creation by emitting organization.created events';

-- ============================================================================
-- 01-events
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: 01-events/001-domain-events-table.sql
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

-- Indexes for performance
CREATE INDEX idx_domain_events_stream ON domain_events(stream_id, stream_type);
CREATE INDEX idx_domain_events_type ON domain_events(event_type);
CREATE INDEX idx_domain_events_created ON domain_events(created_at DESC);
CREATE INDEX idx_domain_events_unprocessed ON domain_events(processed_at)
  WHERE processed_at IS NULL;
CREATE INDEX idx_domain_events_correlation ON domain_events((event_metadata->>'correlation_id'))
  WHERE event_metadata ? 'correlation_id';
CREATE INDEX idx_domain_events_user ON domain_events((event_metadata->>'user_id'))
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
-- File: 01-events/002-event-types-table.sql
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
('user.synced_from_zitadel', 'user', 'User synchronized from Zitadel',
  '{"type": "object", "required": ["zitadel_user_id", "email", "roles"]}',
  ARRAY['users']),

('user.organization_switched', 'user', 'User switched organization context',
  '{"type": "object", "required": ["user_id", "from_organization_id", "to_organization_id"]}',
  ARRAY['users', 'audit_log']);

-- Index for lookups
CREATE INDEX idx_event_types_stream ON event_types(stream_type);
CREATE INDEX idx_event_types_active ON event_types(is_active) WHERE is_active = true;

-- Comment
COMMENT ON TABLE event_types IS 'Catalog of all valid event types with schemas and processing rules';

-- ----------------------------------------------------------------------------
-- File: 01-events/003-subdomain-status-enum.sql
-- ----------------------------------------------------------------------------

-- Subdomain provisioning status tracking
-- Used by organizations_projection.subdomain_status column
-- Tracks lifecycle: pending → dns_created → verifying → verified (or failed)

CREATE TYPE subdomain_status AS ENUM (
  'pending',      -- Subdomain provisioning initiated but not started
  'dns_created',  -- Cloudflare DNS record created successfully
  'verifying',    -- DNS verification in progress (polling)
  'verified',     -- DNS verified and subdomain active
  'failed'        -- Provisioning or verification failed
);

COMMENT ON TYPE subdomain_status IS
  'Tracks subdomain provisioning lifecycle for organizations. Workflow: pending → dns_created → verifying → verified (or failed at any stage)';


-- ============================================================================
-- 02-tables
-- ============================================================================


-- ============================================================================
-- api_audit_log
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: api_audit_log/table.sql
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

-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_api_audit_log_client_ip.sql
-- ----------------------------------------------------------------------------

-- Index on client_ip
CREATE INDEX IF NOT EXISTS idx_api_audit_log_client_ip ON api_audit_log(client_ip);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_api_audit_log_method_path.sql
-- ----------------------------------------------------------------------------

-- Index on request_method, request_path
CREATE INDEX IF NOT EXISTS idx_api_audit_log_method_path ON api_audit_log(request_method, request_path);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_api_audit_log_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_organization ON api_audit_log(organization_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_api_audit_log_request_id.sql
-- ----------------------------------------------------------------------------

-- Index on request_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_request_id ON api_audit_log(request_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_api_audit_log_status.sql
-- ----------------------------------------------------------------------------

-- Index on response_status_code
CREATE INDEX IF NOT EXISTS idx_api_audit_log_status ON api_audit_log(response_status_code);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_api_audit_log_timestamp.sql
-- ----------------------------------------------------------------------------

-- Index on request_timestamp DESC
CREATE INDEX IF NOT EXISTS idx_api_audit_log_timestamp ON api_audit_log(request_timestamp DESC);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_api_audit_log_user.sql
-- ----------------------------------------------------------------------------

-- Index on auth_user_id
CREATE INDEX IF NOT EXISTS idx_api_audit_log_user ON api_audit_log(auth_user_id);

-- ============================================================================
-- audit_log
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: audit_log/table.sql
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

-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_audit_log_created_at.sql
-- ----------------------------------------------------------------------------

-- Index on created_at DESC
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_audit_log_event_type.sql
-- ----------------------------------------------------------------------------

-- Index on event_type
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_audit_log_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_audit_log_organization ON audit_log(organization_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_audit_log_resource.sql
-- ----------------------------------------------------------------------------

-- Index on resource_type, resource_id
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_audit_log_session.sql
-- ----------------------------------------------------------------------------

-- Index on session_id
CREATE INDEX IF NOT EXISTS idx_audit_log_session ON audit_log(session_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_audit_log_user.sql
-- ----------------------------------------------------------------------------

-- Index on user_id
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);

-- ============================================================================
-- clients
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: clients/table.sql
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

-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_clients_dob.sql
-- ----------------------------------------------------------------------------

-- Index on date_of_birth
CREATE INDEX IF NOT EXISTS idx_clients_dob ON clients(date_of_birth);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_clients_name.sql
-- ----------------------------------------------------------------------------

-- Index on last_name, first_name
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(last_name, first_name);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_clients_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_clients_organization ON clients(organization_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_clients_status.sql
-- ----------------------------------------------------------------------------

-- Index on status
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ============================================================================
-- dosage_info
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: dosage_info/table.sql
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

-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_dosage_info_administered_by.sql
-- ----------------------------------------------------------------------------

-- Index on administered_by
CREATE INDEX IF NOT EXISTS idx_dosage_info_administered_by ON dosage_info(administered_by);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_dosage_info_client.sql
-- ----------------------------------------------------------------------------

-- Index on client_id
CREATE INDEX IF NOT EXISTS idx_dosage_info_client ON dosage_info(client_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_dosage_info_medication_history.sql
-- ----------------------------------------------------------------------------

-- Index on medication_history_id
CREATE INDEX IF NOT EXISTS idx_dosage_info_medication_history ON dosage_info(medication_history_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_dosage_info_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_dosage_info_organization ON dosage_info(organization_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_dosage_info_scheduled_datetime.sql
-- ----------------------------------------------------------------------------

-- Index on scheduled_datetime
CREATE INDEX IF NOT EXISTS idx_dosage_info_scheduled_datetime ON dosage_info(scheduled_datetime);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_dosage_info_status.sql
-- ----------------------------------------------------------------------------

-- Index on status
CREATE INDEX IF NOT EXISTS idx_dosage_info_status ON dosage_info(status);

-- ============================================================================
-- impersonation
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: impersonation/001-impersonation_sessions_projection.sql
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
CREATE INDEX idx_impersonation_sessions_super_admin
  ON impersonation_sessions_projection(super_admin_user_id);

CREATE INDEX idx_impersonation_sessions_target_user
  ON impersonation_sessions_projection(target_user_id);

CREATE INDEX idx_impersonation_sessions_target_org
  ON impersonation_sessions_projection(target_org_id);

CREATE INDEX idx_impersonation_sessions_status
  ON impersonation_sessions_projection(status)
  WHERE status = 'active';  -- Partial index for active sessions only

CREATE INDEX idx_impersonation_sessions_started_at
  ON impersonation_sessions_projection(started_at DESC);

CREATE INDEX idx_impersonation_sessions_expires_at
  ON impersonation_sessions_projection(expires_at)
  WHERE status = 'active';  -- Partial index for session expiration checks

-- Session ID lookup (unique constraint provides implicit index)
-- Justification reason for compliance reports
CREATE INDEX idx_impersonation_sessions_justification
  ON impersonation_sessions_projection(justification_reason);

-- Composite index for org-scoped audit queries
CREATE INDEX idx_impersonation_sessions_org_started
  ON impersonation_sessions_projection(target_org_id, started_at DESC);

-- Comments
COMMENT ON TABLE impersonation_sessions_projection IS 'CQRS projection of impersonation sessions. Source: domain_events with stream_type=impersonation. Tracks Super Admin impersonation sessions with full audit trail.';
COMMENT ON COLUMN impersonation_sessions_projection.session_id IS 'Unique session identifier (from event_data.session_id)';
COMMENT ON COLUMN impersonation_sessions_projection.status IS 'Session status: active (currently running), ended (manually terminated or declined renewal), expired (timed out)';
COMMENT ON COLUMN impersonation_sessions_projection.justification_reason IS 'Category of justification: support_ticket, emergency, audit, training';
COMMENT ON COLUMN impersonation_sessions_projection.renewal_count IS 'Number of times session was renewed (incremented by impersonation.renewed events)';
COMMENT ON COLUMN impersonation_sessions_projection.actions_performed IS 'Count of events emitted during session (updated by impersonation.ended event)';
COMMENT ON COLUMN impersonation_sessions_projection.total_duration_ms IS 'Total session duration including all renewals (milliseconds)';


-- ============================================================================
-- medication_history
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: medication_history/table.sql
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

-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_medication_history_client.sql
-- ----------------------------------------------------------------------------

-- Index on client_id
CREATE INDEX IF NOT EXISTS idx_medication_history_client ON medication_history(client_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medication_history_is_prn.sql
-- ----------------------------------------------------------------------------

-- Index on is_prn
CREATE INDEX IF NOT EXISTS idx_medication_history_is_prn ON medication_history(is_prn);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medication_history_medication.sql
-- ----------------------------------------------------------------------------

-- Index on medication_id
CREATE INDEX IF NOT EXISTS idx_medication_history_medication ON medication_history(medication_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medication_history_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_medication_history_organization ON medication_history(organization_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medication_history_prescription_date.sql
-- ----------------------------------------------------------------------------

-- Index on prescription_date
CREATE INDEX IF NOT EXISTS idx_medication_history_prescription_date ON medication_history(prescription_date);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medication_history_status.sql
-- ----------------------------------------------------------------------------

-- Index on status
CREATE INDEX IF NOT EXISTS idx_medication_history_status ON medication_history(status);

-- ============================================================================
-- medications
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: medications/table.sql
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

-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_medications_generic_name.sql
-- ----------------------------------------------------------------------------

-- Index on generic_name
CREATE INDEX IF NOT EXISTS idx_medications_generic_name ON medications(generic_name);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medications_is_active.sql
-- ----------------------------------------------------------------------------

-- Index on is_active
CREATE INDEX IF NOT EXISTS idx_medications_is_active ON medications(is_active);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medications_is_controlled.sql
-- ----------------------------------------------------------------------------

-- Index on is_controlled
CREATE INDEX IF NOT EXISTS idx_medications_is_controlled ON medications(is_controlled);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medications_name.sql
-- ----------------------------------------------------------------------------

-- Index on name
CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medications_organization.sql
-- ----------------------------------------------------------------------------

-- Index on organization_id
CREATE INDEX IF NOT EXISTS idx_medications_organization ON medications(organization_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_medications_rxnorm.sql
-- ----------------------------------------------------------------------------

-- Index on rxnorm_cui
CREATE INDEX IF NOT EXISTS idx_medications_rxnorm ON medications(rxnorm_cui);

-- ============================================================================
-- organizations
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: organizations/001-organizations_projection.sql
-- ----------------------------------------------------------------------------

-- Organizations Projection Table
-- CQRS projection maintained by organization event processors
-- Source of truth: organization.* events in domain_events table
CREATE TABLE IF NOT EXISTS organizations_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT UNIQUE NOT NULL,
  zitadel_org_id TEXT UNIQUE, -- NULL for sub-organizations without separate Zitadel org
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
    -- Root organizations (depth 2) can have Zitadel org
    (nlevel(path) = 2 AND parent_path IS NULL)
    OR
    -- Sub-organizations (depth > 2) must have parent
    (nlevel(path) > 2 AND parent_path IS NOT NULL)
  )
);

-- Performance indexes for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_organizations_path_gist ON organizations_projection USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_organizations_path_btree ON organizations_projection USING BTREE (path);
CREATE INDEX IF NOT EXISTS idx_organizations_parent_path ON organizations_projection USING GIST (parent_path) 
  WHERE parent_path IS NOT NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations_projection(type);
CREATE INDEX IF NOT EXISTS idx_organizations_zitadel_org ON organizations_projection(zitadel_org_id) 
  WHERE zitadel_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations_projection(is_active) 
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_organizations_deleted ON organizations_projection(deleted_at) 
  WHERE deleted_at IS NULL;

-- Comments for documentation
COMMENT ON TABLE organizations_projection IS 'CQRS projection of organization.* events - maintains hierarchical organization structure';
COMMENT ON COLUMN organizations_projection.path IS 'ltree hierarchical path (e.g., root.org_acme_healthcare.north_campus)';
COMMENT ON COLUMN organizations_projection.parent_path IS 'Parent organization ltree path (NULL for root organizations)';
COMMENT ON COLUMN organizations_projection.depth IS 'Computed depth in hierarchy (2 = root org, 3+ = sub-organizations)';
COMMENT ON COLUMN organizations_projection.zitadel_org_id IS 'Zitadel Organization ID (NULL for sub-organizations)';
COMMENT ON COLUMN organizations_projection.type IS 'Organization type: platform_owner (A4C), provider (healthcare), provider_partner (VARs/families/courts)';
COMMENT ON COLUMN organizations_projection.slug IS 'URL-friendly identifier for routing';
COMMENT ON COLUMN organizations_projection.is_active IS 'Organization active status (affects authentication and role assignment)';
COMMENT ON COLUMN organizations_projection.deleted_at IS 'Logical deletion timestamp (organizations are never physically deleted)';

-- ----------------------------------------------------------------------------
-- File: organizations/002-organization_business_profiles_projection.sql
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
-- File: organizations/003-add-subdomain-columns.sql
-- ----------------------------------------------------------------------------

-- Add subdomain provisioning columns to organizations_projection
-- Part of Phase 2: Database Schema for Subdomain Support
-- Full subdomain computed as: {slug}.{BASE_DOMAIN} (environment-aware)

ALTER TABLE organizations_projection
  ADD COLUMN subdomain_status subdomain_status DEFAULT 'pending',
  ADD COLUMN cloudflare_record_id TEXT,
  ADD COLUMN dns_verified_at TIMESTAMPTZ,
  ADD COLUMN subdomain_metadata JSONB DEFAULT '{}';

-- Index for querying organizations by provisioning status
-- Partial index excludes verified orgs (most common case) for efficiency
CREATE INDEX idx_organizations_subdomain_status
  ON organizations_projection(subdomain_status)
  WHERE subdomain_status != 'verified';

-- Index for finding failed provisioning attempts that need attention
CREATE INDEX idx_organizations_subdomain_failed
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


-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_external_id.sql
-- ----------------------------------------------------------------------------

-- Index on zitadel_org_id for fast lookups when syncing with Zitadel
CREATE INDEX IF NOT EXISTS idx_organizations_zitadel_org_id ON organizations_projection(zitadel_org_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_is_active.sql
-- ----------------------------------------------------------------------------

-- Index on is_active for filtering active organizations
CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations_projection(is_active);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_type.sql
-- ----------------------------------------------------------------------------

-- Index on type for filtering organizations by category
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations_projection(type);

-- ============================================================================
-- rbac
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: rbac/001-permissions_projection.sql
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
-- File: rbac/002-roles_projection.sql
-- ----------------------------------------------------------------------------

-- Roles Projection Table
-- This is a CQRS projection maintained by event processors
-- Source of truth: role.created events in domain_events table

CREATE TABLE IF NOT EXISTS roles_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  organization_id UUID,  -- Internal UUID for JOINs (NULL for super_admin global scope)
  zitadel_org_id TEXT,  -- External Zitadel org ID (for Zitadel API lookups)
  org_hierarchy_scope LTREE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,

  -- Constraint: super_admin has NULL org scoping, all others must have org scope
  CONSTRAINT roles_projection_scope_check CHECK (
    (name = 'super_admin' AND organization_id IS NULL AND zitadel_org_id IS NULL AND org_hierarchy_scope IS NULL)
    OR
    (name != 'super_admin' AND organization_id IS NOT NULL AND zitadel_org_id IS NOT NULL AND org_hierarchy_scope IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles_projection(name);
CREATE INDEX IF NOT EXISTS idx_roles_organization_id ON roles_projection(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_zitadel_org ON roles_projection(zitadel_org_id) WHERE zitadel_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_hierarchy_scope ON roles_projection USING GIST(org_hierarchy_scope) WHERE org_hierarchy_scope IS NOT NULL;

-- Comments
COMMENT ON TABLE roles_projection IS 'Projection of role.created events - defines collections of permissions';
COMMENT ON COLUMN roles_projection.organization_id IS 'Internal organization UUID for JOINs (NULL for super_admin with global scope)';
COMMENT ON COLUMN roles_projection.zitadel_org_id IS 'External Zitadel organization ID for API lookups (NULL for super_admin)';
COMMENT ON COLUMN roles_projection.org_hierarchy_scope IS 'ltree path for hierarchical scoping (NULL for super_admin)';
COMMENT ON CONSTRAINT roles_projection_scope_check ON roles_projection IS 'Ensures super_admin has global scope, all others have org scope';


-- ----------------------------------------------------------------------------
-- File: rbac/003-role_permissions_projection.sql
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
-- File: rbac/004-user_roles_projection.sql
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
-- File: rbac/005-cross_tenant_access_grants_projection.sql
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


-- ============================================================================
-- users
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: users/table.sql
-- ----------------------------------------------------------------------------

-- Users Table
-- Shadow table for Zitadel users, used for RLS and audit trails
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zitadel_user_id TEXT UNIQUE NOT NULL, -- Zitadel User ID (external identifier)
  email TEXT NOT NULL,
  name TEXT,
  current_organization_id UUID,
  accessible_organizations UUID[], -- Array of organization IDs
  roles TEXT[], -- Array of role names from Zitadel
  metadata JSONB DEFAULT '{}',
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE users IS 'Shadow table for Zitadel users, used for RLS and auditing';
COMMENT ON COLUMN users.zitadel_user_id IS 'Zitadel User ID (external identifier from Zitadel API)';
COMMENT ON COLUMN users.current_organization_id IS 'Currently selected organization context';
COMMENT ON COLUMN users.accessible_organizations IS 'Array of organization IDs user can access';
COMMENT ON COLUMN users.roles IS 'Array of role names from Zitadel (super_admin, administrator, clinician, specialist, parent, youth)';

-- ============================================================================
-- indexes
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: indexes/idx_users_current_organization.sql
-- ----------------------------------------------------------------------------

-- Index on current_organization_id for filtering by organization context
CREATE INDEX IF NOT EXISTS idx_users_current_organization ON users(current_organization_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_users_email.sql
-- ----------------------------------------------------------------------------

-- Index on email for user lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_users_external_id.sql
-- ----------------------------------------------------------------------------

-- Index on zitadel_user_id for fast lookups when syncing with Zitadel
CREATE INDEX IF NOT EXISTS idx_users_zitadel_user_id ON users(zitadel_user_id);

-- ----------------------------------------------------------------------------
-- File: indexes/idx_users_roles.sql
-- ----------------------------------------------------------------------------

-- GIN index on roles array for efficient role-based filtering
CREATE INDEX IF NOT EXISTS idx_users_roles ON users USING GIN(roles);

-- ============================================================================
-- zitadel_mappings
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: zitadel_mappings/001-zitadel_organization_mapping.sql
-- ----------------------------------------------------------------------------

-- Zitadel Organization ID Mapping Table
-- Maps external Zitadel organization IDs to internal UUID surrogate keys
-- This enables consistent UUID-based JOINs across all domain tables

CREATE TABLE IF NOT EXISTS zitadel_organization_mapping (
  -- Internal surrogate key (used throughout our domain tables)
  internal_org_id UUID PRIMARY KEY,

  -- External Zitadel organization ID (string format from Zitadel API)
  zitadel_org_id TEXT UNIQUE NOT NULL,

  -- Cached organization name for convenience (synced from Zitadel)
  org_name TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes for bi-directional lookups
CREATE INDEX IF NOT EXISTS idx_zitadel_org_mapping_zitadel_id
  ON zitadel_organization_mapping(zitadel_org_id);

CREATE INDEX IF NOT EXISTS idx_zitadel_org_mapping_internal_id
  ON zitadel_organization_mapping(internal_org_id);

-- Comments
COMMENT ON TABLE zitadel_organization_mapping IS
  'Maps external Zitadel organization IDs (TEXT) to internal surrogate UUIDs for consistent domain model';
COMMENT ON COLUMN zitadel_organization_mapping.internal_org_id IS
  'Internal UUID surrogate key used in all domain tables (organizations_projection.id)';
COMMENT ON COLUMN zitadel_organization_mapping.zitadel_org_id IS
  'External Zitadel organization ID (18-digit numeric string from Zitadel API)';
COMMENT ON COLUMN zitadel_organization_mapping.org_name IS
  'Cached organization name from Zitadel for convenience (updated on sync)';


-- ----------------------------------------------------------------------------
-- File: zitadel_mappings/002-zitadel_user_mapping.sql
-- ----------------------------------------------------------------------------

-- Zitadel User ID Mapping Table
-- Maps external Zitadel user IDs to internal UUID surrogate keys
-- This enables consistent UUID-based JOINs across all domain tables

CREATE TABLE IF NOT EXISTS zitadel_user_mapping (
  -- Internal surrogate key (used throughout our domain tables)
  internal_user_id UUID PRIMARY KEY,

  -- External Zitadel user ID (string format from Zitadel API)
  zitadel_user_id TEXT UNIQUE NOT NULL,

  -- Cached user email for convenience (synced from Zitadel)
  user_email TEXT,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes for bi-directional lookups
CREATE INDEX IF NOT EXISTS idx_zitadel_user_mapping_zitadel_id
  ON zitadel_user_mapping(zitadel_user_id);

CREATE INDEX IF NOT EXISTS idx_zitadel_user_mapping_internal_id
  ON zitadel_user_mapping(internal_user_id);

CREATE INDEX IF NOT EXISTS idx_zitadel_user_mapping_email
  ON zitadel_user_mapping(user_email)
  WHERE user_email IS NOT NULL;

-- Comments
COMMENT ON TABLE zitadel_user_mapping IS
  'Maps external Zitadel user IDs (TEXT) to internal surrogate UUIDs for consistent domain model';
COMMENT ON COLUMN zitadel_user_mapping.internal_user_id IS
  'Internal UUID surrogate key used in all domain tables (users.id)';
COMMENT ON COLUMN zitadel_user_mapping.zitadel_user_id IS
  'External Zitadel user ID (string format from Zitadel API)';
COMMENT ON COLUMN zitadel_user_mapping.user_email IS
  'Cached user email from Zitadel for convenience (updated on sync)';


-- ============================================================================
-- 03-functions
-- ============================================================================


-- ============================================================================
-- authorization
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: authorization/001-user_has_permission.sql
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION user_organizations IS 'Returns all organizations where user has assigned roles';


-- ============================================================================
-- event-processing
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: event-processing/001-main-event-router.sql
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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE SQL STABLE;

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
$$ LANGUAGE plpgsql;

-- Function to safely extract and cast JSONB fields
CREATE OR REPLACE FUNCTION safe_jsonb_extract_text(
  p_data JSONB,
  p_key TEXT,
  p_default TEXT DEFAULT NULL
) RETURNS TEXT AS $$
  SELECT COALESCE(p_data->>p_key, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_uuid(
  p_data JSONB,
  p_key TEXT,
  p_default UUID DEFAULT NULL
) RETURNS UUID AS $$
  SELECT COALESCE((p_data->>p_key)::UUID, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_timestamp(
  p_data JSONB,
  p_key TEXT,
  p_default TIMESTAMPTZ DEFAULT NULL
) RETURNS TIMESTAMPTZ AS $$
  SELECT COALESCE((p_data->>p_key)::TIMESTAMPTZ, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_date(
  p_data JSONB,
  p_key TEXT,
  p_default DATE DEFAULT NULL
) RETURNS DATE AS $$
  SELECT COALESCE((p_data->>p_key)::DATE, p_default);
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION safe_jsonb_extract_boolean(
  p_data JSONB,
  p_key TEXT,
  p_default BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN AS $$
  SELECT COALESCE((p_data->>p_key)::BOOLEAN, p_default);
$$ LANGUAGE SQL IMMUTABLE;

-- Organization ID Resolution Functions
-- Supports both internal UUIDs and external Zitadel organization IDs
-- Also supports mock organization IDs during development

CREATE OR REPLACE FUNCTION get_organization_uuid_from_external_id(
  p_external_id TEXT
) RETURNS UUID AS $$
  SELECT id
  FROM organizations_projection
  WHERE zitadel_org_id = p_external_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

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

  -- Try to cast as UUID first (handles internal UUID format)
  BEGIN
    v_uuid := v_value::UUID;
    RETURN v_uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- If cast fails, it's an external_id (Zitadel or mock), look it up
    RETURN get_organization_uuid_from_external_id(v_value);
  END;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION process_domain_event IS 'Main router that processes domain events and projects them to 3NF tables';
COMMENT ON FUNCTION get_entity_version IS 'Gets the current version number for an entity stream';
COMMENT ON FUNCTION validate_event_sequence IS 'Ensures events are processed in order';
COMMENT ON FUNCTION get_organization_uuid_from_external_id IS 'Resolve Zitadel/mock organization external_id to internal UUID';
COMMENT ON FUNCTION safe_jsonb_extract_organization_id IS 'Extract organization_id from event data, supporting UUID, Zitadel ID, and mock ID formats';

-- ----------------------------------------------------------------------------
-- File: event-processing/002-process-client-events.sql
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_client_event IS 'Projects client events to the clients table and audit log';

-- ----------------------------------------------------------------------------
-- File: event-processing/002-process-organization-events.sql
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
      INSERT INTO organizations_projection (
        id, name, display_name, slug, zitadel_org_id, type, path, parent_path, depth,
        tax_number, phone_number, timezone, metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        (p_event.event_data->>'path')::LTREE,
        CASE
          WHEN p_event.event_data ? 'parent_path'
          THEN (p_event.event_data->>'parent_path')::LTREE
          ELSE NULL
        END,
        nlevel((p_event.event_data->>'path')::LTREE),
        safe_jsonb_extract_text(p_event.event_data, 'tax_number'),
        safe_jsonb_extract_text(p_event.event_data, 'phone_number'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'America/New_York'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      );

      -- Populate Zitadel organization mapping (if zitadel_org_id exists)
      IF safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id') IS NOT NULL THEN
        PERFORM upsert_org_mapping(
          p_event.stream_id,
          safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id'),
          safe_jsonb_extract_text(p_event.event_data, 'name')
        );
      END IF;

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

    WHEN 'organization.zitadel.created' THEN
      -- Zitadel org/user creation successful: Continue with organization creation
      -- Note: This triggers organization.created event emission externally
      RAISE NOTICE 'Zitadel org created: % for bootstrap %', 
        p_event.event_data->>'zitadel_org_id',
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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE;

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
-- File: event-processing/003-process-medication-events.sql
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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_medication_event IS 'Projects medication catalog events to the medications table';
COMMENT ON FUNCTION process_medication_history_event IS 'Projects prescription events to the medication_history table';
COMMENT ON FUNCTION process_dosage_event IS 'Projects administration events to the dosage_info table';

-- ----------------------------------------------------------------------------
-- File: event-processing/004-process-rbac-events.sql
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
      );

    -- ========================================
    -- Role Events
    -- ========================================
    WHEN 'role.created' THEN
      INSERT INTO roles_projection (
        id,
        name,
        description,
        organization_id,
        zitadel_org_id,
        org_hierarchy_scope,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'description'),
        -- Resolve Zitadel org ID to internal UUID (NULL for super_admin)
        CASE
          WHEN safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id') IS NOT NULL
          THEN get_internal_org_id(safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id'))
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'zitadel_org_id'),
        CASE
          WHEN p_event.event_data->>'org_hierarchy_scope' IS NOT NULL
          THEN (p_event.event_data->>'org_hierarchy_scope')::LTREE
          ELSE NULL
        END,
        p_event.created_at
      );

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
      );

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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_rbac_event IS 'Projects RBAC events to permission, role, user_role, and access_grant projection tables with full audit trail';


-- ----------------------------------------------------------------------------
-- File: event-processing/005-process-impersonation-events.sql
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
        -- Convert super_admin org_id: NULL for platform super_admin, resolve Zitadel ID to UUID for org-scoped admin
        CASE
          WHEN p_event.event_data->'super_admin'->>'org_id' IS NULL THEN NULL
          WHEN p_event.event_data->'super_admin'->>'org_id' = '*' THEN NULL
          ELSE get_internal_org_id(p_event.event_data->'super_admin'->>'org_id')
        END,
        -- Target
        (p_event.event_data->'target'->>'user_id')::UUID,
        p_event.event_data->'target'->>'email',
        p_event.event_data->'target'->>'name',
        -- Convert target org_id: Zitadel ID to internal UUID
        get_internal_org_id(p_event.event_data->'target'->>'org_id'),
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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_impersonation_session_details IS 'Returns impersonation session details for Redis cache synchronization';


-- ----------------------------------------------------------------------------
-- File: event-processing/006-process-access-grant-events.sql
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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE;

-- Comments for documentation
COMMENT ON FUNCTION process_access_grant_event IS 
  'Main access grant event processor - handles cross-tenant grant lifecycle with CQRS compliance';
COMMENT ON FUNCTION validate_cross_tenant_access IS 
  'Validates that cross-tenant access grant request meets business rules';
COMMENT ON FUNCTION get_active_grants_for_consultant IS 
  'Returns all active grants for a consultant organization/user';
COMMENT ON FUNCTION has_cross_tenant_access IS 
  'Checks if specific cross-tenant access is currently granted';

-- ============================================================================
-- external-services
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: external-services/001-subdomain-helpers.sql
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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_organization_subdomain(UUID) IS
  'Gets full subdomain for organization by ID. Returns NULL if organization not found. Example: get_organization_subdomain(''...'') might return ''acme.analytics4change.com''';


-- ============================================================================
-- zitadel-mappings
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: zitadel-mappings/001-id-resolution-functions.sql
-- ----------------------------------------------------------------------------

-- Zitadel ID Resolution Helper Functions
-- Provides bi-directional mapping between Zitadel IDs and internal UUIDs

-- ============================================================================
-- Organization ID Resolution
-- ============================================================================

-- Resolve Zitadel organization ID → Internal UUID
CREATE OR REPLACE FUNCTION get_internal_org_id(
  p_zitadel_org_id TEXT
) RETURNS UUID AS $$
  SELECT internal_org_id
  FROM zitadel_organization_mapping
  WHERE zitadel_org_id = p_zitadel_org_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Resolve Internal UUID → Zitadel organization ID
CREATE OR REPLACE FUNCTION get_zitadel_org_id(
  p_internal_org_id UUID
) RETURNS TEXT AS $$
  SELECT zitadel_org_id
  FROM zitadel_organization_mapping
  WHERE internal_org_id = p_internal_org_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Get or create organization mapping (upsert pattern)
CREATE OR REPLACE FUNCTION upsert_org_mapping(
  p_internal_org_id UUID,
  p_zitadel_org_id TEXT,
  p_org_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
BEGIN
  INSERT INTO zitadel_organization_mapping (
    internal_org_id,
    zitadel_org_id,
    org_name,
    created_at
  ) VALUES (
    p_internal_org_id,
    p_zitadel_org_id,
    p_org_name,
    NOW()
  )
  ON CONFLICT (internal_org_id) DO UPDATE SET
    org_name = COALESCE(EXCLUDED.org_name, zitadel_organization_mapping.org_name),
    updated_at = NOW();

  RETURN p_internal_org_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- User ID Resolution
-- ============================================================================

-- Resolve Zitadel user ID → Internal UUID
CREATE OR REPLACE FUNCTION get_internal_user_id(
  p_zitadel_user_id TEXT
) RETURNS UUID AS $$
  SELECT internal_user_id
  FROM zitadel_user_mapping
  WHERE zitadel_user_id = p_zitadel_user_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Resolve Internal UUID → Zitadel user ID
CREATE OR REPLACE FUNCTION get_zitadel_user_id(
  p_internal_user_id UUID
) RETURNS TEXT AS $$
  SELECT zitadel_user_id
  FROM zitadel_user_mapping
  WHERE internal_user_id = p_internal_user_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Get or create user mapping (upsert pattern)
CREATE OR REPLACE FUNCTION upsert_user_mapping(
  p_internal_user_id UUID,
  p_zitadel_user_id TEXT,
  p_user_email TEXT DEFAULT NULL
) RETURNS UUID AS $$
BEGIN
  INSERT INTO zitadel_user_mapping (
    internal_user_id,
    zitadel_user_id,
    user_email,
    created_at
  ) VALUES (
    p_internal_user_id,
    p_zitadel_user_id,
    p_user_email,
    NOW()
  )
  ON CONFLICT (internal_user_id) DO UPDATE SET
    user_email = COALESCE(EXCLUDED.user_email, zitadel_user_mapping.user_email),
    updated_at = NOW();

  RETURN p_internal_user_id;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION get_internal_org_id IS
  'Resolves Zitadel organization ID (TEXT) to internal surrogate UUID';
COMMENT ON FUNCTION get_zitadel_org_id IS
  'Resolves internal surrogate UUID to Zitadel organization ID (TEXT)';
COMMENT ON FUNCTION upsert_org_mapping IS
  'Creates or updates organization ID mapping (idempotent)';
COMMENT ON FUNCTION get_internal_user_id IS
  'Resolves Zitadel user ID (TEXT) to internal surrogate UUID';
COMMENT ON FUNCTION get_zitadel_user_id IS
  'Resolves internal surrogate UUID to Zitadel user ID (TEXT)';
COMMENT ON FUNCTION upsert_user_mapping IS
  'Creates or updates user ID mapping (idempotent)';


-- ============================================================================
-- 04-triggers
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: 04-triggers/001-process-domain-event-trigger.sql
-- ----------------------------------------------------------------------------

-- Trigger to Process Domain Events
-- Automatically projects events to 3NF tables when they are inserted
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
-- File: 04-triggers/bootstrap-event-listener.sql
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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE plpgsql;

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
      AND de.event_type LIKE 'organization.bootstrap.%'
         OR de.event_type LIKE 'organization.zitadel.%'
         OR de.event_type LIKE 'organization.created'
  )
  SELECT
    p_bootstrap_id,
    be.org_id,
    CASE
      WHEN be.event_type = 'organization.bootstrap.completed' THEN 'completed'
      WHEN be.event_type = 'organization.bootstrap.failed' THEN 'failed'
      WHEN be.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
      WHEN be.event_type = 'organization.zitadel.created' THEN 'processing'
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'initiated'
      WHEN be.event_type = 'organization.bootstrap.temporal_initiated' THEN 'initiated'
      ELSE 'unknown'
    END,
    CASE
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'zitadel_creation'
      WHEN be.event_type = 'organization.bootstrap.temporal_initiated' THEN 'temporal_workflow_started'
      WHEN be.event_type = 'organization.zitadel.created' THEN 'organization_creation'
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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql STABLE;

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
$$ LANGUAGE plpgsql;

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


-- ============================================================================
-- 05-views
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: 05-views/event_history_by_entity.sql
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
-- File: 05-views/unprocessed_events.sql
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
-- 06-rls
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: 06-rls/enable_rls_all_tables.sql
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
-- File: 06-rls/impersonation-policies.sql
-- ----------------------------------------------------------------------------

-- Row-Level Security Policies for Impersonation Sessions
-- These policies must run AFTER RBAC tables (roles_projection, user_roles_projection) are created

-- Policy: Super admins can view all sessions
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
-- 99-seeds
-- ============================================================================


-- ----------------------------------------------------------------------------
-- File: 99-seeds/003-rbac-initial-setup.sql
-- ----------------------------------------------------------------------------

-- RBAC Initial Setup: Minimal Viable Permissions for Platform Bootstrap
-- This seed creates the foundational RBAC structure for:
-- 1. Super Admin: Manages tenant onboarding and A4C internal roles
-- 2. Provider Admin: Bootstrap role (permissions granted per organization later)
-- 3. Partner Admin: Bootstrap role (permissions granted per organization later)
--
-- All inserts go through the event-sourced architecture

-- ========================================
-- Phase 1: Organization Management Permissions
-- Super Admin manages tenant/provider onboarding
-- ========================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- organization.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "create", "description": "Create new tenant organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "view", "description": "View organization details and hierarchy", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "update", "description": "Modify organization settings and configuration", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.deactivate
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "deactivate", "description": "Deactivate organization (soft delete, reversible)", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.suspend
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "suspend", "description": "Suspend organization access (e.g., payment issues)", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.activate
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "activate", "description": "Activate or reactivate organization", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.search
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "search", "description": "Search across all organizations", "scope_type": "global", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb),

  -- organization.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "organization", "action": "delete", "description": "Permanently delete organization (irreversible)", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin tenant onboarding"}'::jsonb);


-- ========================================
-- Phase 2: A4C Internal Role Management Permissions
-- Super Admin manages roles within Analytics4Change organization
-- ========================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- a4c_role.create
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "create", "description": "Create roles within A4C organization", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.view
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "view", "description": "View A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.update
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "update", "description": "Modify A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.delete
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "delete", "description": "Delete A4C internal roles", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb),

  -- a4c_role.assign
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "a4c_role", "action": "assign", "description": "Assign A4C roles to A4C staff users", "scope_type": "org", "requires_mfa": false}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin role delegation within A4C"}'::jsonb);


-- ========================================
-- Phase 3: Meta-Permissions (RBAC Management)
-- Super Admin manages permissions and role grants
-- ========================================

INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  -- permission.grant
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "permission", "action": "grant", "description": "Grant permissions to roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb),

  -- permission.revoke
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "permission", "action": "revoke", "description": "Revoke permissions from roles", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb),

  -- role.grant
  (gen_random_uuid(), 'permission', 1, 'permission.defined',
   '{"applet": "role", "action": "grant", "description": "Assign roles to users", "scope_type": "global", "requires_mfa": true}'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Super Admin RBAC management"}'::jsonb);


-- ========================================
-- Initial Roles
-- ========================================

-- A4C Platform Organization (owner of the application)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'organization', 1, 'organization.registered',
   '{
     "name": "Analytics4Change",
     "slug": "a4c",
     "org_type": "platform_owner",
     "parent_org_id": null,
     "zitadel_org_id": "339658157368404786",
     "settings": {
       "is_active": true,
       "is_internal": true,
       "description": "Platform owner organization"
     }
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating A4C platform organization"}'::jsonb);

-- Super Admin Role (global scope, NULL org_id for platform-wide access)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'role', 1, 'role.created',
   '{
     "name": "super_admin",
     "description": "Platform administrator who manages tenant onboarding and A4C internal roles"
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating super_admin role for A4C platform staff"}'::jsonb);

-- Provider Admin Role Template (bootstrap only, actual roles created per organization)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('22222222-2222-2222-2222-222222222222', 'role', 1, 'role.created',
   '{
     "name": "provider_admin",
     "description": "Organization administrator who manages their own provider organization (permissions granted during org provisioning)",
     "zitadel_org_id": null,
     "org_hierarchy_scope": null
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating provider_admin role template"}'::jsonb);

-- Partner Admin Role Template (bootstrap only, actual roles created per organization)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('33333333-3333-3333-3333-333333333333', 'role', 1, 'role.created',
   '{
     "name": "partner_admin",
     "description": "Provider partner administrator who manages cross-tenant access (permissions granted during org provisioning)",
     "zitadel_org_id": null,
     "org_hierarchy_scope": null
   }'::jsonb,
   '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Bootstrap: Creating partner_admin role template"}'::jsonb);


-- ========================================
-- Grant All Permissions to Super Admin
-- ========================================

-- Grant all 16 permissions to super_admin role
-- These will be processed by the event triggers into role_permissions_projection table

DO $$
DECLARE
  perm_record RECORD;
  version_counter INT := 2;  -- Start at version 2 (version 1 was role.created)
BEGIN
  -- Wait for permissions to be processed into projection (in real deployment)
  -- For seed script, we query permissions_projection after initial INSERT processing

  FOR perm_record IN
    SELECT id, applet, action
    FROM permissions_projection
    WHERE applet IN ('organization', 'a4c_role', 'permission', 'role')
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
-- File: 99-seeds/004-organization-permissions-setup.sql
-- ----------------------------------------------------------------------------

-- Organization Permissions Setup
-- Initializes organization-related permissions via event sourcing
-- This script emits permission.defined events for organization lifecycle management

-- Function to emit permission.defined events during platform initialization
CREATE OR REPLACE FUNCTION initialize_organization_permissions()
RETURNS VOID AS $$
DECLARE
  v_permission_id UUID;
  v_current_time TIMESTAMPTZ := NOW();
BEGIN
  
  -- Define organization permissions via events (not direct inserts)
  
  -- 1. organization.create_root - Platform Owner only
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  -- 2. organization.create_sub - Provider Admin within their org
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  -- 3. organization.deactivate - Organization deactivation
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  -- 4. organization.delete - Organization deletion (dangerous operation)
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  -- 5. organization.business_profile_create - Business profile creation
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  -- 6. organization.business_profile_update - Business profile updates
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  -- 7. organization.view - View organization information
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  -- 8. organization.update - Update organization information
  v_permission_id := gen_random_uuid();
  INSERT INTO domain_events (
    stream_id, stream_type, stream_version, event_type, event_data, event_metadata
  ) VALUES (
    v_permission_id,
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

  RAISE NOTICE 'Organization permissions initialized via permission.defined events';
END;
$$ LANGUAGE plpgsql;

-- Execute the initialization function
-- This can be run during platform setup/migration
SELECT initialize_organization_permissions();

-- Drop the initialization function after use (optional)
DROP FUNCTION IF EXISTS initialize_organization_permissions();

-- ============================================================================
-- END OF DEPLOYMENT SCRIPT
-- ============================================================================

COMMIT;

-- Verify deployment
SELECT 'Deployment completed successfully!' AS status;
