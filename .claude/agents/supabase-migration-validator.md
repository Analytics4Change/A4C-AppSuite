# Supabase Migration Validator Agent

---
description: |
  Specialized agent for validating Supabase SQL migrations for idempotency, safety, and A4C-AppSuite architectural compliance.
  Checks CREATE/ALTER patterns, RLS policies, foreign keys, event triggers, and multi-tenant isolation.
agent_type: validation
context: infrastructure
estimated_time: 5-10 minutes per migration
---

## Purpose

This agent performs comprehensive validation of Supabase SQL migration files before deployment. It ensures migrations follow A4C-AppSuite's SQL-first patterns, maintain idempotency, and correctly implement multi-tenant isolation with Row-Level Security (RLS).

## When to Invoke

**Automatically**:
- Before deploying migrations to development/staging/production
- As part of CI/CD pipeline validation
- Before committing migration files to git

**Manually**:
- After creating a new migration file
- When reviewing migration PRs
- When troubleshooting RLS policy issues
- When refactoring existing migrations

## Validation Criteria

### 1. Idempotency Checks (CRITICAL)

All DDL statements must be idempotent (safe to run multiple times).

#### CREATE Statements

**Required Pattern**: Use `IF NOT EXISTS` for all CREATE operations

✅ **CORRECT**:
```sql
CREATE TABLE IF NOT EXISTS medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medications_org_id ON medications(org_id);

CREATE POLICY IF NOT EXISTS "Users can view their org's medications"
  ON medications FOR SELECT
  USING ((SELECT current_setting('request.jwt.claims', true)::json->>'org_id')::uuid = org_id);
```

❌ **INCORRECT** (will fail on re-run):
```sql
CREATE TABLE medications (...);  -- Missing IF NOT EXISTS
CREATE INDEX idx_medications_org_id ON medications(org_id);  -- Missing IF NOT EXISTS
CREATE POLICY "Policy name" ON medications ...;  -- Missing IF NOT EXISTS
```

#### ALTER Statements

**Required Pattern**: Check existence before ALTER, or use DROP IF EXISTS + CREATE

✅ **CORRECT** (Option 1 - Check first):
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'medications' AND column_name = 'dosage_instructions'
  ) THEN
    ALTER TABLE medications ADD COLUMN dosage_instructions text;
  END IF;
END $$;
```

✅ **CORRECT** (Option 2 - Drop and recreate for constraints/triggers):
```sql
-- For constraints, triggers, functions that support OR REPLACE
DROP TRIGGER IF EXISTS update_medications_updated_at ON medications;
CREATE TRIGGER update_medications_updated_at
  BEFORE UPDATE ON medications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE medications DROP CONSTRAINT IF EXISTS medications_name_check;
ALTER TABLE medications ADD CONSTRAINT medications_name_check
  CHECK (length(name) >= 1 AND length(name) <= 255);
```

❌ **INCORRECT**:
```sql
ALTER TABLE medications ADD COLUMN dosage_instructions text;  -- No existence check
ALTER TABLE medications ADD CONSTRAINT ...;  -- Will fail if constraint exists
```

#### Functions and Triggers

**Required Pattern**: Use `CREATE OR REPLACE` for functions, `DROP IF EXISTS` for triggers

✅ **CORRECT**:
```sql
-- Functions support OR REPLACE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers require DROP first
DROP TRIGGER IF EXISTS update_medications_updated_at ON medications;
CREATE TRIGGER update_medications_updated_at
  BEFORE UPDATE ON medications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

#### GRANT Statements

**Required Pattern**: GRANTs are idempotent, but verify role exists

✅ **CORRECT**:
```sql
-- GRANTs are naturally idempotent (safe to run multiple times)
GRANT SELECT, INSERT, UPDATE, DELETE ON medications TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
```

### 2. Row-Level Security (RLS) Validation (CRITICAL)

All tables with `org_id` MUST have RLS enabled and correct policies.

#### RLS Policy Structure

**Required Components**:
1. Enable RLS on table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
2. Use JWT claims: `current_setting('request.jwt.claims', true)::json->>'org_id'`
3. Cast properly: `::uuid` or `::text` depending on column type
4. Policy for each operation: SELECT, INSERT, UPDATE, DELETE

✅ **CORRECT**:
```sql
-- 1. Enable RLS
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;

-- 2. SELECT policy (using JWT org_id)
CREATE POLICY IF NOT EXISTS "Users can view their org's medications"
  ON medications FOR SELECT
  USING (
    (SELECT current_setting('request.jwt.claims', true)::json->>'org_id')::uuid = org_id
  );

-- 3. INSERT policy (enforces org_id match)
CREATE POLICY IF NOT EXISTS "Users can insert medications for their org"
  ON medications FOR INSERT
  WITH CHECK (
    (SELECT current_setting('request.jwt.claims', true)::json->>'org_id')::uuid = org_id
  );

-- 4. UPDATE policy
CREATE POLICY IF NOT EXISTS "Users can update their org's medications"
  ON medications FOR UPDATE
  USING (
    (SELECT current_setting('request.jwt.claims', true)::json->>'org_id')::uuid = org_id
  )
  WITH CHECK (
    (SELECT current_setting('request.jwt.claims', true)::json->>'org_id')::uuid = org_id
  );

-- 5. DELETE policy
CREATE POLICY IF NOT EXISTS "Users can delete their org's medications"
  ON medications FOR DELETE
  USING (
    (SELECT current_setting('request.jwt.claims', true)::json->>'org_id')::uuid = org_id
  );
```

❌ **INCORRECT**:
```sql
-- Missing RLS enable
CREATE POLICY ... -- RLS not enabled, policy won't enforce!

-- Wrong JWT claim path
USING (auth.uid() = user_id);  -- Wrong: doesn't check org_id

-- Missing operation policies
-- Only SELECT policy created, but INSERT/UPDATE/DELETE not restricted!

-- Hardcoded org_id
USING (org_id = '123e4567-e89b-12d3-a456-426614174000');  -- Wrong: not tenant-isolated
```

#### RLS for Service Role

Service role operations (Temporal workers) bypass RLS. Ensure activities explicitly filter by org_id.

```sql
-- In Temporal activities (not in migration):
// Activities must manually filter by org_id since service role bypasses RLS
const { data, error } = await supabase
  .from('medications')
  .select('*')
  .eq('org_id', organizationId);  // Explicit filter required!
```

### 3. Foreign Key Relationships (IMPORTANT)

Foreign keys must specify CASCADE/SET NULL behavior for multi-tenant cleanup.

#### CASCADE vs SET NULL

**Use ON DELETE CASCADE**: When child records are meaningless without parent
**Use ON DELETE SET NULL**: When child records should persist but lose reference

✅ **CORRECT**:
```sql
-- Cascade: Medication deleted when organization deleted
CREATE TABLE IF NOT EXISTS medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL
);

-- Cascade: Prescription deleted when medication deleted
CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE
);

-- Set NULL: Audit log persists even if user deleted
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL
);
```

❌ **INCORRECT**:
```sql
-- No ON DELETE behavior specified (defaults to RESTRICT, causes orphans)
CREATE TABLE medications (
  org_id uuid NOT NULL REFERENCES organizations(id)  -- Missing ON DELETE CASCADE
);

-- Wrong choice: Should cascade, not set null
CREATE TABLE prescriptions (
  medication_id uuid REFERENCES medications(id) ON DELETE SET NULL  -- Should CASCADE
);
```

### 4. Event Trigger Implementation (CQRS)

For tables that emit domain events, ensure triggers update `domain_events` table.

✅ **CORRECT**:
```sql
-- Event trigger on INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION emit_medication_events()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO domain_events (
      event_type,
      aggregate_type,
      aggregate_id,
      event_data,
      metadata
    ) VALUES (
      'MedicationCreated',
      'Medication',
      NEW.id,
      jsonb_build_object(
        'org_id', NEW.org_id,
        'name', NEW.name,
        'created_at', NEW.created_at
      ),
      jsonb_build_object(
        'table_name', TG_TABLE_NAME,
        'operation', TG_OP
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO domain_events (
      event_type,
      aggregate_type,
      aggregate_id,
      event_data,
      metadata
    ) VALUES (
      'MedicationUpdated',
      'Medication',
      NEW.id,
      jsonb_build_object(
        'org_id', NEW.org_id,
        'name', NEW.name,
        'changes', jsonb_build_object(
          'old', to_jsonb(OLD),
          'new', to_jsonb(NEW)
        )
      ),
      jsonb_build_object(
        'table_name', TG_TABLE_NAME,
        'operation', TG_OP
      )
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO domain_events (
      event_type,
      aggregate_type,
      aggregate_id,
      event_data,
      metadata
    ) VALUES (
      'MedicationDeleted',
      'Medication',
      OLD.id,
      jsonb_build_object('org_id', OLD.org_id),
      jsonb_build_object(
        'table_name', TG_TABLE_NAME,
        'operation', TG_OP
      )
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS medication_events_trigger ON medications;
CREATE TRIGGER medication_events_trigger
  AFTER INSERT OR UPDATE OR DELETE ON medications
  FOR EACH ROW EXECUTE FUNCTION emit_medication_events();
```

**Validation Checks**:
- Event type uses PastTense naming (MedicationCreated, not CreateMedication)
- All operations covered (INSERT/UPDATE/DELETE)
- Event data includes org_id for filtering
- Trigger is idempotent (DROP IF EXISTS before CREATE)

### 5. Migration File Naming and Structure

#### File Naming Convention

**Pattern**: `YYYYMMDDHHMMSS-descriptive-name.sql`

✅ **CORRECT**:
```
20241110123456-create-medications-table.sql
20241110154532-add-rls-policies-medications.sql
20241111091022-add-prescription-foreign-keys.sql
```

❌ **INCORRECT**:
```
migration.sql  -- No timestamp
medications.sql  -- No timestamp
001-medications.sql  -- Wrong timestamp format
```

#### Migration Structure

**Required Order**:
1. Schema changes (CREATE TABLE, ALTER TABLE)
2. Indexes
3. Functions and triggers
4. RLS policies
5. GRANT statements

```sql
-- 1. Schema
CREATE TABLE IF NOT EXISTS medications (...);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_medications_org_id ON medications(org_id);

-- 3. Functions/Triggers
CREATE OR REPLACE FUNCTION emit_medication_events() ...;
DROP TRIGGER IF EXISTS medication_events_trigger ON medications;
CREATE TRIGGER medication_events_trigger ...;

-- 4. RLS
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "policy_name" ...;

-- 5. Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON medications TO authenticated;
```

### 6. Common Anti-Patterns to Flag

❌ **Hardcoded UUIDs or timestamps**:
```sql
INSERT INTO organizations (id, name) VALUES
  ('123e4567-e89b-12d3-a456-426614174000', 'Test Org');  -- Don't hardcode IDs in migrations
```

❌ **Manual console changes**:
```sql
-- Migration should be complete, not require manual steps
-- Don't add comments like: "Then manually run X in Supabase Studio"
```

❌ **Non-idempotent data modifications**:
```sql
UPDATE medications SET dosage = dosage * 2;  -- Will double every time migration runs!

-- Use idempotent patterns:
UPDATE medications SET dosage = 200 WHERE dosage = 100;  -- OK: specific condition
```

❌ **Missing rollback instructions**:
```sql
-- Complex migrations should include rollback steps in comments
-- ROLLBACK: DROP TABLE IF EXISTS medications;
```

## Validation Process

When validating a migration file:

1. **Run idempotency checks**:
   - All CREATE statements have IF NOT EXISTS
   - All ALTER statements check existence or use DROP IF EXISTS
   - Functions use CREATE OR REPLACE
   - Triggers use DROP IF EXISTS before CREATE

2. **Verify RLS implementation**:
   - Tables with org_id have RLS enabled
   - All CRUD operations have policies
   - Policies use JWT claims correctly with proper casting
   - No hardcoded org_id values

3. **Check foreign key cascade behavior**:
   - All foreign keys specify ON DELETE CASCADE or ON DELETE SET NULL
   - Choice is appropriate (CASCADE for dependent data, SET NULL for audit trails)

4. **Validate event triggers** (if applicable):
   - Event types use PastTense naming
   - All operations covered (INSERT/UPDATE/DELETE)
   - Event data includes org_id
   - Triggers are idempotent

5. **Review file structure**:
   - Filename follows timestamp convention
   - Statements in correct order (schema → indexes → triggers → RLS → grants)
   - No hardcoded values
   - No manual step requirements

6. **Test locally**:
   - Run `./local-tests/start-local.sh`
   - Run `./local-tests/run-migrations.sh`
   - Run `./local-tests/verify-idempotency.sh` (should pass twice)
   - Run `./local-tests/stop-local.sh`

## Output Format

**Success**:
```
✅ Migration validation PASSED: infrastructure/supabase/sql/02-tables/medications/table.sql

Checks completed:
- Idempotency: ✅ All statements are idempotent
- RLS Policies: ✅ All policies correctly use JWT claims
- Foreign Keys: ✅ All foreign keys specify ON DELETE behavior
- Event Triggers: ✅ Event naming and structure correct
- File Structure: ✅ Follows naming convention and order
```

**Failure**:
```
❌ Migration validation FAILED: infrastructure/supabase/sql/02-tables/medications/table.sql

Issues found:

[CRITICAL] Idempotency violation (Line 15):
  CREATE TABLE medications (...);
  ❌ Missing IF NOT EXISTS clause
  ✅ Should be: CREATE TABLE IF NOT EXISTS medications (...);

[CRITICAL] RLS policy missing JWT claims (Line 45):
  CREATE POLICY "View medications" ON medications FOR SELECT USING (org_id = org_id);
  ❌ Always returns true, doesn't check user's org_id
  ✅ Should use: (SELECT current_setting('request.jwt.claims', true)::json->>'org_id')::uuid = org_id

[IMPORTANT] Missing ON DELETE behavior (Line 12):
  org_id uuid NOT NULL REFERENCES organizations(id)
  ❌ No cascade behavior specified
  ✅ Should be: ... REFERENCES organizations(id) ON DELETE CASCADE

[WARNING] Event trigger uses wrong naming (Line 78):
  event_type: 'CreateMedication'
  ❌ Should use PastTense
  ✅ Should be: 'MedicationCreated'
```

## References

- **A4C-AppSuite Migration Patterns**: `infrastructure/supabase/sql/` (existing examples)
- **Infrastructure Skill**: `.claude/skills/infrastructure-guidelines/resources/supabase-migrations.md`
- **Infrastructure CLAUDE.md**: `infrastructure/CLAUDE.md` (RLS and idempotency patterns)
- **Local Testing Scripts**: `infrastructure/supabase/local-tests/` (verify-idempotency.sh)

## Usage Example

```bash
# Manually invoke agent on a specific migration
echo "Validate this migration: infrastructure/supabase/sql/02-tables/medications/table.sql"

# Or integrate into pre-commit hook
.claude/hooks/validate-migration.sh infrastructure/supabase/sql/02-tables/medications/table.sql
```

---

**Agent Version**: 1.0.0
**Last Updated**: 2025-11-10
**Maintainer**: A4C-AppSuite Infrastructure Team
