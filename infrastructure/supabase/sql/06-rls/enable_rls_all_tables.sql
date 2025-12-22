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

-- NOTE: audit_log and api_audit_log tables removed (2025-12-22)
-- domain_events table serves as the authoritative audit trail

-- Note: After enabling RLS, tables will deny all access by default
-- Policies must be created to allow appropriate access