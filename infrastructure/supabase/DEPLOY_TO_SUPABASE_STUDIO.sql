-- ============================================================================
-- SUPABASE AUTH DEPLOYMENT SCRIPT (Supabase Auth Only - No Zitadel)
-- ============================================================================
-- Purpose: Deploy complete RBAC infrastructure for A4C platform
--
-- This script establishes:
-- 1. Event-driven architecture with CQRS projections
-- 2. Supabase Auth with JWT custom claims
-- 3. Row-Level Security for multi-tenant isolation
-- 4. Super Admin role with full permissions
-- 5. Organization hierarchy with subdomain support
--
-- Execute this script in Supabase Studio SQL Editor
-- WARNING: This will DROP and recreate the public schema
--
-- Version: 2.0 (Supabase Auth Only)
-- Last Updated: 2025-10-27
-- Migration Status: Zitadel removed, Supabase Auth complete
-- ============================================================================

BEGIN;

-- ============================================================================
-- SCHEMA WIPE (Clean Start)
-- ============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "ltree" SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA public;

COMMENT ON EXTENSION "uuid-ossp" IS 'Used for generating UUIDs for IDs';
COMMENT ON EXTENSION "ltree" IS 'Used for hierarchical organization paths';
COMMENT ON EXTENSION "pgcrypto" IS 'Used for cryptographic functions';

-- ============================================================================
-- CUSTOM TYPES
-- ============================================================================

-- Subdomain provisioning status enum
CREATE TYPE subdomain_status AS ENUM (
  'pending',      -- Subdomain record not yet created
  'dns_created',  -- DNS record created in Cloudflare
  'verifying',    -- DNS propagation in progress
  'verified',     -- DNS verified and subdomain accessible
  'failed'        -- DNS creation or verification failed
);

COMMENT ON TYPE subdomain_status IS 'Subdomain provisioning status - tracks DNS creation and verification lifecycle';

-- ============================================================================
-- EVENT SOURCING TABLES
-- ============================================================================

-- Domain Events - Single source of truth
CREATE TABLE domain_events (
  -- Event identification
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number BIGSERIAL UNIQUE NOT NULL,

  -- Stream identification
  stream_id UUID NOT NULL,
  stream_type TEXT NOT NULL,
  stream_version INTEGER NOT NULL,

  -- Event details
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  event_metadata JSONB NOT NULL DEFAULT '{}',

  -- Processing status
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Constraints
  CONSTRAINT unique_stream_version UNIQUE(stream_id, stream_type, stream_version),
  CONSTRAINT valid_event_type CHECK (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  CONSTRAINT event_data_not_empty CHECK (jsonb_typeof(event_data) = 'object')
);

CREATE INDEX idx_domain_events_stream ON domain_events(stream_id, stream_type);
CREATE INDEX idx_domain_events_type ON domain_events(event_type);
CREATE INDEX idx_domain_events_created ON domain_events(created_at DESC);
CREATE INDEX idx_domain_events_unprocessed ON domain_events(processed_at) WHERE processed_at IS NULL;

COMMENT ON TABLE domain_events IS 'Event store - single source of truth for all system changes';
COMMENT ON COLUMN domain_events.stream_id IS 'The aggregate/entity ID this event belongs to';
COMMENT ON COLUMN domain_events.stream_type IS 'The type of entity (client, medication, etc.)';
COMMENT ON COLUMN domain_events.stream_version IS 'Version number for this specific entity stream';
COMMENT ON COLUMN domain_events.event_type IS 'Event type in format: domain.action (e.g., client.admitted)';
COMMENT ON COLUMN domain_events.event_data IS 'The actual event payload with all data needed to project';
COMMENT ON COLUMN domain_events.event_metadata IS 'Context including user, reason, approvals - the WHY';


-- Event Types Catalog
CREATE TABLE event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT UNIQUE NOT NULL,
  stream_type TEXT NOT NULL,
  event_schema JSONB NOT NULL,
  metadata_schema JSONB,
  description TEXT NOT NULL,
  example_data JSONB,
  example_metadata JSONB,
  is_active BOOLEAN DEFAULT true,
  requires_approval BOOLEAN DEFAULT false,
  allowed_roles TEXT[],
  projection_function TEXT,
  projection_tables TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

COMMENT ON TABLE event_types IS 'Catalog of all valid event types with schemas and processing rules';


-- ============================================================================
-- USERS TABLE (Supabase Auth)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,  -- Supabase Auth user UUID (from auth.users)
  email TEXT NOT NULL,
  name TEXT,
  current_organization_id UUID,
  accessible_organizations UUID[],
  roles TEXT[],
  metadata JSONB DEFAULT '{}',
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_current_organization ON users(current_organization_id) WHERE current_organization_id IS NOT NULL;
CREATE INDEX idx_users_roles ON users USING GIN(roles);

COMMENT ON TABLE users IS 'Shadow table for Supabase Auth users';
COMMENT ON COLUMN users.id IS 'Supabase Auth user UUID (matches auth.users.id)';


-- ============================================================================
-- PROJECTION TABLES
-- ============================================================================

-- Organizations Projection
CREATE TABLE IF NOT EXISTS organizations_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  path LTREE UNIQUE NOT NULL,
  parent_path LTREE,
  depth INTEGER GENERATED ALWAYS AS (nlevel(path)) STORED,
  tax_number TEXT,
  phone_number TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,
  deleted_at TIMESTAMPTZ,
  deletion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  subdomain_status subdomain_status DEFAULT 'pending',
  cloudflare_record_id TEXT,
  dns_verified_at TIMESTAMPTZ,
  subdomain_metadata JSONB DEFAULT '{}',
  CHECK (type IN ('platform_owner', 'provider', 'provider_partner'))
);

CREATE INDEX idx_organizations_type ON organizations_projection(type);
CREATE INDEX idx_organizations_path ON organizations_projection USING GIST(path);
CREATE INDEX idx_organizations_slug ON organizations_projection(slug);

COMMENT ON TABLE organizations_projection IS 'CQRS projection of organization.* events';


-- Organization Business Profiles
CREATE TABLE IF NOT EXISTS organization_business_profiles_projection (
  organization_id UUID PRIMARY KEY REFERENCES organizations_projection(id),
  organization_type TEXT NOT NULL CHECK (organization_type IN ('provider', 'provider_partner')),
  mailing_address JSONB,
  physical_address JSONB,
  provider_profile JSONB,
  partner_profile JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE organization_business_profiles_projection IS 'Business profiles for organizations';


-- Permissions Projection
CREATE TABLE IF NOT EXISTS permissions_projection (
  id UUID PRIMARY KEY,
  applet TEXT NOT NULL,
  action TEXT NOT NULL,
  name TEXT GENERATED ALWAYS AS (applet || '.' || action) STORED,
  description TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'facility', 'program', 'client')),
  requires_mfa BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(applet, action)
);

COMMENT ON TABLE permissions_projection IS 'Atomic authorization units';


-- Roles Projection
CREATE TABLE IF NOT EXISTS roles_projection (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  organization_id UUID,
  org_hierarchy_scope LTREE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  CHECK (
    (name = 'super_admin' AND organization_id IS NULL AND org_hierarchy_scope IS NULL)
    OR
    (name != 'super_admin' AND organization_id IS NOT NULL AND org_hierarchy_scope IS NOT NULL)
  )
);

COMMENT ON TABLE roles_projection IS 'Role definitions';


-- Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions_projection (
  role_id UUID NOT NULL REFERENCES roles_projection(id),
  permission_id UUID NOT NULL REFERENCES permissions_projection(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);


-- User Roles
CREATE TABLE IF NOT EXISTS user_roles_projection (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  org_id UUID,
  scope_path LTREE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (user_id, role_id, org_id),
  CHECK (
    (org_id IS NULL AND scope_path IS NULL)
    OR
    (org_id IS NOT NULL AND scope_path IS NOT NULL)
  )
);

CREATE INDEX idx_user_roles_user ON user_roles_projection(user_id);
CREATE INDEX idx_user_roles_role ON user_roles_projection(role_id);
CREATE INDEX idx_user_roles_org ON user_roles_projection(org_id) WHERE org_id IS NOT NULL;


-- Cross-Tenant Access Grants
CREATE TABLE IF NOT EXISTS cross_tenant_access_grants_projection (
  id UUID PRIMARY KEY,
  consultant_org_id UUID NOT NULL,
  consultant_user_id UUID,
  provider_org_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('full_org', 'facility', 'program', 'client_specific')),
  scope_id UUID,
  authorization_type TEXT NOT NULL,
  legal_reference TEXT,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  permissions JSONB DEFAULT '[]',
  terms JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- Impersonation Sessions
CREATE TABLE IF NOT EXISTS impersonation_sessions_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  super_admin_user_id UUID NOT NULL,
  super_admin_email TEXT NOT NULL,
  target_user_id UUID NOT NULL,
  target_email TEXT NOT NULL,
  target_org_id UUID NOT NULL,
  justification_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  renewal_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,
  user_id UUID,
  user_email TEXT,
  resource_type TEXT,
  resource_id UUID,
  operation TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_organization ON audit_log(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_audit_log_user ON audit_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);


-- API Audit Log
CREATE TABLE IF NOT EXISTS api_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  request_id TEXT UNIQUE NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  response_status_code INTEGER,
  response_time_ms INTEGER,
  auth_user_id UUID,
  client_ip INET,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- Clients
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  email TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_organization ON clients(organization_id);


-- Medications
CREATE TABLE IF NOT EXISTS medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  generic_name TEXT,
  rxnorm_cui TEXT,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_medications_organization ON medications(organization_id);


-- Medication History
CREATE TABLE IF NOT EXISTS medication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  client_id UUID NOT NULL,
  medication_id UUID NOT NULL,
  prescription_date DATE NOT NULL,
  start_date DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_medication_history_organization ON medication_history(organization_id);
CREATE INDEX idx_medication_history_client ON medication_history(client_id);


-- Dosage Info
CREATE TABLE IF NOT EXISTS dosage_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  medication_history_id UUID NOT NULL,
  client_id UUID NOT NULL,
  scheduled_datetime TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'administered', 'skipped', 'refused')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dosage_info_organization ON dosage_info(organization_id);


-- ============================================================================
-- AUTHENTICATION FUNCTIONS
-- ============================================================================

-- Get current user ID (Supabase Auth UUID)
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT auth.uid();
$$;


-- Extract org_id from JWT
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT (auth.jwt()->>'org_id')::uuid;
$$;


-- Extract user_role from JWT
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT auth.jwt()->>'user_role';
$$;


-- Extract permissions from JWT
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
$$;


-- Check if user has permission
CREATE OR REPLACE FUNCTION has_permission(p_permission text)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT p_permission = ANY(get_current_permissions());
$$;


-- Check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles_projection ur
    JOIN roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND r.name = 'super_admin'
      AND ur.org_id IS NULL
  );
$$;


-- Check if user is org admin
CREATE OR REPLACE FUNCTION is_org_admin(p_user_id UUID, p_org_id UUID)
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
  );
$$;


-- ============================================================================
-- JWT CUSTOM CLAIMS HOOK (Must be enabled via Supabase Dashboard)
-- ============================================================================
-- NOTE: The custom_access_token_hook function CANNOT be created via SQL
-- due to auth schema permissions. You must create it via Dashboard:
--
-- 1. Go to: Authentication > Hooks > Custom Access Token Hook
-- 2. Click "Create a new hook" or "Enable"
-- 3. Paste the following function code in the editor:
-- ============================================================================
/*

CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_org_id uuid;
  v_user_role text;
  v_permissions text[];
  v_scope_path text;
BEGIN
  v_user_id := (event->>'user_id')::uuid;

  SELECT
    u.current_organization_id,
    COALESCE(
      (SELECT r.name
       FROM user_roles_projection ur
       JOIN roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
       ORDER BY CASE WHEN r.name = 'super_admin' THEN 1 ELSE 2 END
       LIMIT 1
      ),
      'viewer'
    ),
    NULL
  INTO v_org_id, v_user_role, v_scope_path
  FROM users u
  WHERE u.id = v_user_id;

  IF v_user_role = 'super_admin' THEN
    SELECT array_agg(p.name)
    INTO v_permissions
    FROM permissions_projection p;
  ELSE
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.org_id = v_org_id OR ur.org_id IS NULL);
  END IF;

  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  v_claims := jsonb_build_object(
    'org_id', v_org_id,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'claims_version', 1
  );

  RETURN jsonb_set(
    event,
    '{claims}',
    (COALESCE(event->'claims', '{}'::jsonb) || v_claims)
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'JWT hook error: % %', SQLERRM, SQLSTATE;
    RETURN jsonb_set(
      event,
      '{claims}',
      jsonb_build_object(
        'org_id', NULL,
        'user_role', 'viewer',
        'permissions', '[]'::jsonb,
        'scope_path', NULL,
        'claims_error', SQLERRM
      )
    );
END;
$$;

*/
-- ============================================================================


-- Organization switching
CREATE OR REPLACE FUNCTION public.switch_organization(p_new_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE users
  SET current_organization_id = p_new_org_id,
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'org_id', p_new_org_id,
    'message', 'Organization switched. Refresh JWT to get new claims.'
  );
END;
$$;


-- Claims preview (testing) - Will return null until hook is enabled
CREATE OR REPLACE FUNCTION public.get_user_claims_preview(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_user_role text;
  v_permissions text[];
  v_scope_path text;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Manually replicate hook logic for testing
  SELECT
    u.current_organization_id,
    COALESCE(
      (SELECT r.name
       FROM user_roles_projection ur
       JOIN roles_projection r ON r.id = ur.role_id
       WHERE ur.user_id = u.id
       ORDER BY CASE WHEN r.name = 'super_admin' THEN 1 ELSE 2 END
       LIMIT 1
      ),
      'viewer'
    ),
    NULL
  INTO v_org_id, v_user_role, v_scope_path
  FROM users u
  WHERE u.id = v_user_id;

  IF v_user_role = 'super_admin' THEN
    SELECT array_agg(p.name)
    INTO v_permissions
    FROM permissions_projection p;
  ELSE
    SELECT array_agg(DISTINCT p.name)
    INTO v_permissions
    FROM user_roles_projection ur
    JOIN role_permissions_projection rp ON rp.role_id = ur.role_id
    JOIN permissions_projection p ON p.id = rp.permission_id
    WHERE ur.user_id = v_user_id
      AND (ur.org_id = v_org_id OR ur.org_id IS NULL);
  END IF;

  v_permissions := COALESCE(v_permissions, ARRAY[]::text[]);

  RETURN jsonb_build_object(
    'org_id', v_org_id,
    'user_role', v_user_role,
    'permissions', to_jsonb(v_permissions),
    'scope_path', v_scope_path,
    'claims_version', 1
  );
END;
$$;


GRANT EXECUTE ON FUNCTION public.switch_organization TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_claims_preview TO authenticated;


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE organizations_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE dosage_info ENABLE ROW LEVEL SECURITY;


-- Organizations RLS
CREATE POLICY organizations_select ON organizations_projection
FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR id = get_current_org_id()
);


-- Users RLS
CREATE POLICY users_select ON users
FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR id = auth.uid()
  OR current_organization_id = get_current_org_id()
);


-- Clients RLS
CREATE POLICY clients_select ON clients
FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR organization_id = get_current_org_id()
);

CREATE POLICY clients_insert ON clients
FOR INSERT
WITH CHECK (
  has_permission('client.create')
  AND organization_id = get_current_org_id()
);


-- RBAC Tables - Super Admin Only
CREATE POLICY permissions_superadmin ON permissions_projection
FOR ALL
USING (is_super_admin(auth.uid()));

CREATE POLICY roles_superadmin ON roles_projection
FOR ALL
USING (is_super_admin(auth.uid()));

CREATE POLICY role_permissions_superadmin ON role_permissions_projection
FOR ALL
USING (is_super_admin(auth.uid()));

CREATE POLICY user_roles_superadmin ON user_roles_projection
FOR ALL
USING (is_super_admin(auth.uid()));


-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Permissions
INSERT INTO permissions_projection (id, applet, action, description, scope_type) VALUES
  (gen_random_uuid(), 'organization', 'view', 'View organization details', 'org'),
  (gen_random_uuid(), 'organization', 'create', 'Create organizations', 'global'),
  (gen_random_uuid(), 'organization', 'update', 'Update organizations', 'org'),
  (gen_random_uuid(), 'organization', 'delete', 'Delete organizations', 'global'),
  (gen_random_uuid(), 'user', 'view', 'View users', 'org'),
  (gen_random_uuid(), 'user', 'create', 'Create users', 'org'),
  (gen_random_uuid(), 'user', 'update', 'Update users', 'org'),
  (gen_random_uuid(), 'user', 'delete', 'Delete users', 'org'),
  (gen_random_uuid(), 'role', 'view', 'View roles', 'org'),
  (gen_random_uuid(), 'role', 'create', 'Create roles', 'global'),
  (gen_random_uuid(), 'role', 'assign', 'Assign roles', 'org'),
  (gen_random_uuid(), 'client', 'view', 'View clients', 'org'),
  (gen_random_uuid(), 'client', 'create', 'Create clients', 'org'),
  (gen_random_uuid(), 'client', 'update', 'Update clients', 'org'),
  (gen_random_uuid(), 'client', 'delete', 'Delete clients', 'org'),
  (gen_random_uuid(), 'medication', 'view', 'View medications', 'org'),
  (gen_random_uuid(), 'medication', 'create', 'Add medications', 'org'),
  (gen_random_uuid(), 'medication', 'prescribe', 'Prescribe medications', 'org'),
  (gen_random_uuid(), 'medication', 'administer', 'Administer medications', 'org');


-- Super Admin Role
INSERT INTO roles_projection (id, name, description, organization_id, org_hierarchy_scope)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'super_admin',
  'Platform super administrator',
  NULL,
  NULL
);


-- Grant ALL permissions to super_admin
INSERT INTO role_permissions_projection (role_id, permission_id)
SELECT
  '11111111-1111-1111-1111-111111111111',
  id
FROM permissions_projection;


COMMIT;

-- ============================================================================
-- POST-DEPLOYMENT INSTRUCTIONS
-- ============================================================================
--
-- 1. Enable JWT custom claims hook in Supabase Dashboard:
--    Authentication > Hooks > Custom Access Token Hook
--    - Enable: Yes
--    - Schema: auth
--    - Function: custom_access_token_hook
--
-- 2. Bootstrap your first super_admin user:
--    - Authenticate via Supabase Auth (get your UUID)
--    - INSERT INTO users (id, email, name) VALUES (auth.uid(), 'your-email', 'Your Name');
--    - INSERT INTO user_roles_projection (user_id, role_id, org_id, scope_path)
--      VALUES (auth.uid(), '11111111-1111-1111-1111-111111111111', NULL, NULL);
--
-- 3. Test JWT claims:
--    SELECT public.get_user_claims_preview(auth.uid());
--
-- Version: 2.0 - Supabase Auth Only (Zitadel Removed)
-- ============================================================================
