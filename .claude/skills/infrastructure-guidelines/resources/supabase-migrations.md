# Supabase SQL Migrations

Idempotent SQL migration patterns for A4C-AppSuite Supabase database. Covers IF NOT EXISTS patterns, RLS policies with JWT claims, foreign key relationships, event triggers, migration file organization, and local testing workflows.

## Migration File Organization

### Directory Structure

```
infrastructure/supabase/sql/
├── 01-extensions/           # PostgreSQL extensions (uuid-ossp, ltree)
├── 02-tables/              # Table definitions
│   └── <table_name>/
│       ├── table.sql       # CREATE TABLE statement
│       └── indexes.sql     # Indexes (optional separate file)
├── 03-functions/           # Database functions
├── 04-projections/         # CQRS projection tables
├── 05-triggers/            # Event processing triggers
└── 06-rls/                # RLS policies
```

### Naming Conventions

```bash
# Tables
02-tables/organizations/table.sql
02-tables/medications/table.sql
02-tables/medication_history/table.sql

# Projections
04-projections/organization_projection.sql
04-projections/medication_projection.sql

# Triggers
05-triggers/organization_events.sql
05-triggers/medication_events.sql

# RLS Policies
06-rls/organizations_rls.sql
06-rls/medications_rls.sql
```

**Pattern**: Use snake_case for file and table names, group by entity

## Idempotent SQL Patterns

### Table Creation

```sql
-- ✅ GOOD: Idempotent table creation
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ❌ BAD: Non-idempotent (fails on second run)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL
);
```

### Index Creation

```sql
-- ✅ GOOD: Idempotent index creation
CREATE INDEX IF NOT EXISTS idx_organizations_subdomain
  ON organizations(subdomain);

CREATE INDEX IF NOT EXISTS idx_medications_org_id_active
  ON medications(org_id, is_active)
  WHERE is_active = true;

-- ❌ BAD: Non-idempotent
CREATE INDEX idx_organizations_subdomain ON organizations(subdomain);
```

### Column Addition

```sql
-- ✅ GOOD: Safe column addition
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255);

-- Add with default value
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN DEFAULT true;

-- ❌ BAD: Non-idempotent
ALTER TABLE organizations ADD COLUMN billing_email VARCHAR(255);
```

### Column Removal

```sql
-- ✅ GOOD: Safe column removal
ALTER TABLE organizations
  DROP COLUMN IF EXISTS deprecated_field;

-- ⚠️ WARNING: Column drops are destructive!
-- Always verify no code depends on the column before dropping
-- Consider renaming to "_deprecated_field_name" first, then drop later
```

## RLS Policies

### JWT Custom Claims Pattern

Supabase Auth adds custom claims to JWT tokens via database hook. Access claims in RLS policies:

```sql
-- Extract org_id from JWT
(current_setting('request.jwt.claims', true)::json->>'org_id')::uuid

-- Extract user_role from JWT
(current_setting('request.jwt.claims', true)::json->>'user_role')::text

-- Extract permissions array from JWT
(current_setting('request.jwt.claims', true)::json->>'permissions')::jsonb
```

### Basic RLS Policy (Tenant Isolation)

```sql
-- ✅ GOOD: Idempotent RLS policy
-- IMPORTANT: Policies must be dropped first for idempotency

DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
CREATE POLICY organizations_tenant_isolation
  ON organizations
  FOR ALL
  USING (id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid);

-- Enable RLS on table
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ❌ BAD: Non-idempotent (CREATE POLICY fails if exists)
CREATE POLICY organizations_tenant_isolation ON organizations
  FOR ALL USING (...);
```

### RLS Policy with Role-Based Access

```sql
-- Medications: Org members can read, only admins can write
DROP POLICY IF EXISTS medications_read_policy ON medications;
CREATE POLICY medications_read_policy
  ON medications
  FOR SELECT
  USING (
    org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
  );

DROP POLICY IF EXISTS medications_write_policy ON medications;
CREATE POLICY medications_write_policy
  ON medications
  FOR INSERT, UPDATE, DELETE
  USING (
    org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
    AND (current_setting('request.jwt.claims', true)::json->>'user_role')::text IN ('provider_admin', 'super_admin')
  );

ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
```

### RLS Policy with Permission Check

```sql
-- Check specific permission in JWT claims
DROP POLICY IF EXISTS clients_manage_policy ON clients;
CREATE POLICY clients_manage_policy
  ON clients
  FOR ALL
  USING (
    org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
    AND (
      (current_setting('request.jwt.claims', true)::json->>'permissions')::jsonb ? 'clients:manage'
      OR (current_setting('request.jwt.claims', true)::json->>'user_role')::text = 'super_admin'
    )
  );

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
```

### Service Role Bypass

```sql
-- Service role key bypasses RLS entirely
-- No special policy needed - this is handled by Supabase
-- Activities use service role key, frontend uses anon key
```

## Foreign Key Relationships

### Basic Foreign Key

```sql
CREATE TABLE IF NOT EXISTS medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Foreign Key with ON DELETE

```sql
-- Cascade delete: Remove child rows when parent deleted
CREATE TABLE IF NOT EXISTS medication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  administered_at TIMESTAMPTZ NOT NULL,
  administered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- SET NULL: Preserve child rows, null out FK when parent deleted
-- RESTRICT: Prevent parent deletion if children exist (default)
-- NO ACTION: Same as RESTRICT
```

### Composite Foreign Keys

```sql
-- Reference multi-column unique constraint
CREATE TABLE IF NOT EXISTS medication_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  rxcui_1 VARCHAR(20) NOT NULL,
  rxcui_2 VARCHAR(20) NOT NULL,
  severity VARCHAR(50) NOT NULL,

  -- FK to medications(org_id, rxcui)
  FOREIGN KEY (org_id, rxcui_1) REFERENCES medications(org_id, rxcui),
  FOREIGN KEY (org_id, rxcui_2) REFERENCES medications(org_id, rxcui)
);
```

## Database Functions

### Idempotent Function Creation

```sql
-- ✅ GOOD: CREATE OR REPLACE for idempotency
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- No "IF NOT EXISTS" for functions - use CREATE OR REPLACE
```

### Trigger for updated_at Column

```sql
-- Pattern: Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger for idempotency
DROP TRIGGER IF EXISTS organizations_updated_at_trigger ON organizations;
CREATE TRIGGER organizations_updated_at_trigger
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

## Complete Migration Examples

### Simple Table Migration

```sql
-- File: infrastructure/supabase/sql/02-tables/organizations/table.sql

-- Create table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_organizations_subdomain ON organizations(subdomain);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_updated_at_trigger ON organizations;
CREATE TRIGGER organizations_updated_at_trigger
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS policy
DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
CREATE POLICY organizations_tenant_isolation
  ON organizations
  FOR ALL
  USING (id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE ON organizations TO authenticated;

-- Documentation
COMMENT ON TABLE organizations IS 'Multi-tenant organizations. Each user belongs to one organization via JWT org_id claim.';
```

### Table with Foreign Keys

```sql
-- File: infrastructure/supabase/sql/02-tables/medications/table.sql

-- Create table
CREATE TABLE IF NOT EXISTS medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rxcui VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  dosage_form VARCHAR(100),
  strength VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Prevent duplicate medications per organization
  UNIQUE(org_id, rxcui)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_medications_org_id ON medications(org_id);
CREATE INDEX IF NOT EXISTS idx_medications_rxcui ON medications(rxcui);
CREATE INDEX IF NOT EXISTS idx_medications_active ON medications(org_id, is_active) WHERE is_active = true;

-- updated_at trigger
DROP TRIGGER IF EXISTS medications_updated_at_trigger ON medications;
CREATE TRIGGER medications_updated_at_trigger
  BEFORE UPDATE ON medications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS policy (tenant isolation)
DROP POLICY IF EXISTS medications_tenant_isolation ON medications;
CREATE POLICY medications_tenant_isolation
  ON medications
  FOR ALL
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid);

ALTER TABLE medications ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON medications TO authenticated;

-- Documentation
COMMENT ON TABLE medications IS 'Organization medication formulary. Medications are org-scoped via RLS. RXCUI is RxNorm Concept Unique Identifier.';
```

## Local Testing Workflow

### Start Local Supabase

```bash
cd infrastructure/supabase
./local-tests/start-local.sh

# This script:
# 1. Starts Supabase with Podman (supabase start)
# 2. Waits for services to be ready
# 3. Outputs connection details
```

### Run Migrations

```bash
./local-tests/run-migrations.sh

# This script:
# 1. Connects to local Supabase PostgreSQL
# 2. Executes migrations in order (01-extensions → 06-rls)
# 3. Skips already-applied migrations (optional checksum tracking)
# 4. Reports success/failure for each migration
```

### Verify Idempotency

```bash
./local-tests/verify-idempotency.sh

# This script:
# 1. Runs all migrations twice
# 2. Verifies second run produces no errors
# 3. Validates idempotency of all SQL
# 4. Reports any non-idempotent patterns
```

### Check Status

```bash
./local-tests/status-local.sh

# Shows:
# - Running containers
# - Database connection details
# - API URLs
# - Dashboard URL (if available)
```

### Stop Local Supabase

```bash
./local-tests/stop-local.sh

# This script:
# 1. Stops Supabase (supabase stop)
# 2. Removes containers
# 3. Optionally removes volumes (data cleanup)
```

## Migration Deployment

### CI/CD Pipeline

Migrations deploy automatically via GitHub Actions on push to main (see `.github/workflows/supabase-migrations.yml`).

### Manual Deployment

```bash
# Set environment
export SUPABASE_URL="https://yourproject.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
DB_HOST="db.${PROJECT_REF}.supabase.co"
export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"

# Run migrations
for dir in 01-extensions 02-tables 03-functions 04-projections 05-triggers 06-rls; do
  for file in infrastructure/supabase/sql/$dir/**/*.sql; do
    psql -h "$DB_HOST" -U postgres -d postgres -f "$file"
  done
done
```

## Troubleshooting

### Common Issues

```sql
-- Check PostgreSQL version
SELECT version(); -- Supabase uses PostgreSQL 15+

-- Verify RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'medications';

-- Check policies exist
SELECT * FROM pg_policies WHERE tablename = 'medications';

-- Test JWT claims
SELECT current_setting('request.jwt.claims', true);

-- Check trigger exists
SELECT * FROM pg_trigger WHERE tgname = 'organizations_updated_at_trigger';

-- Check foreign key constraints
SELECT tc.constraint_name, ccu.table_name AS foreign_table, rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'medications';
```

## Related Documentation

- [SKILL.md](../SKILL.md) - Infrastructure guidelines overview
- [cqrs-projections.md](cqrs-projections.md) - Event-driven projection patterns
- [infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md) - Infrastructure component guidance
