---
status: current
last_updated: 2025-01-13
---

# clients

## Overview

The `clients` table stores patient/client records with full medical and administrative information. This is a core business entity table for clinical operations, managing client demographics, contact information, medical history, and status tracking within a multi-tenant environment.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key - unique identifier for each client |
| organization_id | uuid | NO | - | Foreign key to organizations (multi-tenant isolation) |
| first_name | text | NO | - | Client's legal first name |
| last_name | text | NO | - | Client's legal last name |
| date_of_birth | date | NO | - | Client's date of birth |
| gender | text | YES | - | Gender (male, female, other, prefer_not_to_say) |
| email | text | YES | - | Client's email address for contact |
| phone | text | YES | - | Client's primary phone number |
| address | jsonb | YES | '{}' | Physical address (see JSONB schema below) |
| emergency_contact | jsonb | YES | '{}' | Emergency contact information (see JSONB schema below) |
| allergies | text[] | YES | - | Array of known allergies (free text) |
| medical_conditions | text[] | YES | - | Array of known medical conditions (free text) |
| blood_type | text | YES | - | Blood type (e.g., "A+", "O-", "AB+") |
| status | text | YES | 'active' | Client status (active, inactive, archived) |
| admission_date | date | YES | - | Date client was admitted to care |
| discharge_date | date | YES | - | Date client was discharged from care |
| notes | text | YES | - | Free-form clinical or administrative notes |
| metadata | jsonb | YES | '{}' | Additional structured metadata |
| created_by | uuid | YES | - | User ID who created the record |
| updated_by | uuid | YES | - | User ID who last updated the record |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record last update timestamp |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each client record
- **Generation**: Automatically generated via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY
- **Usage**: Referenced by medication_history, dosage_info, and other clinical tables

#### organization_id
- **Type**: `uuid`
- **Purpose**: Multi-tenant isolation key - identifies which organization this client belongs to
- **Foreign Key**: References `organizations_projection(id)`
- **Constraints**: NOT NULL
- **RLS**: Critical for tenant isolation - all queries filtered by organization
- **Note**: **RLS policies not yet implemented** (see Security Considerations section)

#### first_name / last_name
- **Type**: `text`
- **Purpose**: Client's legal name for identification and records
- **Constraints**: NOT NULL
- **Index**: Composite index on (last_name, first_name) for fast name searches
- **Usage**: Display in UI, reports, and clinical documentation

#### date_of_birth
- **Type**: `date`
- **Purpose**: Client's date of birth for age calculations and verification
- **Constraints**: NOT NULL
- **Index**: Indexed for age-based queries and reporting
- **Usage**: Age calculation, medication dosing, eligibility verification

#### gender
- **Type**: `text`
- **Purpose**: Client's gender for medical and administrative purposes
- **Constraints**: CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'))
- **Nullable**: YES
- **Usage**: Clinical context, demographic reporting

#### email / phone
- **Type**: `text`
- **Purpose**: Contact information for client communication
- **Nullable**: YES (not all clients may have email/phone)
- **Usage**: Appointment reminders, notifications, emergency contact

#### address
- **Type**: `jsonb`
- **Purpose**: Structured storage of client's physical address
- **Default**: `{}`
- **See**: JSONB Columns section for detailed schema

#### emergency_contact
- **Type**: `jsonb`
- **Purpose**: Structured storage of emergency contact information
- **Default**: `{}`
- **See**: JSONB Columns section for detailed schema

#### allergies
- **Type**: `text[]`
- **Purpose**: Array of known allergies (medications, food, environmental)
- **Critical**: **MUST** be checked before medication administration
- **Usage**: Medication safety checks, dosage info validation
- **Example**: `{'Penicillin', 'Peanuts', 'Latex'}`

#### medical_conditions
- **Type**: `text[]`
- **Purpose**: Array of known medical conditions and diagnoses
- **Usage**: Clinical context for medication prescribing, care planning
- **Example**: `{'Diabetes Type 2', 'Hypertension', 'Asthma'}`

#### blood_type
- **Type**: `text`
- **Purpose**: Client's blood type for emergency medical situations
- **Nullable**: YES
- **Format**: Standard blood type notation (e.g., "A+", "O-", "AB+")

#### status
- **Type**: `text`
- **Purpose**: Current status of client in the care system
- **Constraints**: CHECK (status IN ('active', 'inactive', 'archived'))
- **Default**: 'active'
- **Index**: Indexed for filtering active clients
- **Usage**:
  - **active**: Currently receiving care
  - **inactive**: Temporarily not receiving care (e.g., on leave)
  - **archived**: No longer receiving care (discharged, transferred)

#### admission_date / discharge_date
- **Type**: `date`
- **Purpose**: Track care episode dates
- **Nullable**: YES
- **Usage**: Length of stay calculations, billing, reporting

#### notes
- **Type**: `text`
- **Purpose**: Free-form notes for clinical or administrative information
- **Nullable**: YES
- **Usage**: Additional context not captured in structured fields

#### metadata
- **Type**: `jsonb`
- **Purpose**: Extensible storage for additional structured data
- **Default**: `{}`
- **Usage**: Custom fields, integration data, feature flags

#### created_by / updated_by
- **Type**: `uuid`
- **Purpose**: Audit trail - track which users created/modified records
- **Foreign Key**: References `users(id)`
- **Usage**: Compliance, auditing, change tracking

#### created_at / updated_at
- **Type**: `timestamptz`
- **Purpose**: Timestamp audit trail
- **Default**: `now()`
- **Usage**: Change tracking, compliance, data synchronization

## Relationships

### Parent Relationships (Foreign Keys)

⚠️ **Implementation Note**: Foreign key constraint to organizations_projection is not explicitly defined in the table SQL but should be considered required by application logic.

- **organizations_projection** → `organization_id`
  - Each client belongs to exactly one organization
  - Multi-tenant isolation - clients cannot be viewed across organizations
  - **Expected behavior**: ON DELETE RESTRICT (cannot delete org with active clients)

### Child Relationships (Referenced By)

- **medication_history** ← `client_id`
  - One-to-many relationship
  - Tracks all medications prescribed to this client
  - Cascade behavior: Should restrict deletion if active prescriptions exist

- **dosage_info** ← `client_id`
  - One-to-many relationship
  - Tracks all dosage administration records for this client
  - Cascade behavior: Should restrict deletion if dosage records exist

### Many-to-Many Relationships

None currently defined.

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by client ID
- **Performance**: O(log n) lookups
- **Usage**: Direct client retrieval, foreign key joins

### Secondary Indexes

#### idx_clients_organization
```sql
CREATE INDEX IF NOT EXISTS idx_clients_organization ON clients(organization_id);
```
- **Purpose**: Filtered queries by organization
- **Used By**: Multi-tenant queries, RLS enforcement
- **Performance**: Critical for tenant isolation performance
- **Typical Query**: `SELECT * FROM clients WHERE organization_id = ?`

#### idx_clients_name
```sql
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(last_name, first_name);
```
- **Purpose**: Fast name-based searches
- **Used By**: Client search/lookup UI, alphabetical listings
- **Performance**: Supports pattern matching with LIKE 'Smith%'
- **Typical Query**: `SELECT * FROM clients WHERE last_name = 'Smith' ORDER BY first_name`

#### idx_clients_dob
```sql
CREATE INDEX IF NOT EXISTS idx_clients_dob ON clients(date_of_birth);
```
- **Purpose**: Age-based queries, birthday reports
- **Used By**: Age calculation queries, demographic reports
- **Typical Query**: `SELECT * FROM clients WHERE date_of_birth BETWEEN ? AND ?`

#### idx_clients_status
```sql
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
```
- **Purpose**: Filter clients by status (active/inactive/archived)
- **Used By**: Active client lists, dashboard counts
- **Performance**: Supports efficient filtering for UI displays
- **Typical Query**: `SELECT * FROM clients WHERE status = 'active'`

## RLS Policies

⚠️ **CRITICAL IMPLEMENTATION GAP**: Row-Level Security is **ENABLED** on this table but **NO POLICIES ARE DEFINED**.

### Current State

```sql
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
```

**Impact**: With RLS enabled but no policies, the table will **DENY ALL ACCESS** by default, even to authenticated users.

### Required Policies (Not Yet Implemented)

The following policies **MUST** be implemented for the table to function:

#### Recommended SELECT Policy

```sql
CREATE POLICY "clients_select_policy"
  ON clients FOR SELECT
  USING (
    is_super_admin(get_current_user_id()) OR
    organization_id = (auth.jwt()->>'org_id')::uuid
  );
```

**Purpose**: Control which rows users can view

**Logic**:
- Super admins can view all client records across all organizations
- Regular users (clinicians, org admins) can only view clients in their own organization
- Organization ID extracted from JWT custom claims

#### Recommended INSERT Policy

```sql
CREATE POLICY "clients_insert_policy"
  ON clients FOR INSERT
  WITH CHECK (
    is_org_admin(get_current_user_id(), organization_id) OR
    is_super_admin(get_current_user_id()) OR
    user_has_permission(get_current_user_id(), 'clients.create', organization_id)
  );
```

**Purpose**: Control who can create new client records

**Logic**: Allow insertions if user is super admin, org admin, or has explicit permission

#### Recommended UPDATE Policy

```sql
CREATE POLICY "clients_update_policy"
  ON clients FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'clients.update', organization_id)
    )
  );
```

**Purpose**: Control who can update client records

#### Recommended DELETE Policy

```sql
CREATE POLICY "clients_delete_policy"
  ON clients FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'clients.delete', organization_id)
    )
  );
```

**Purpose**: Control who can delete client records (should be rare - prefer status='archived')

### Testing RLS Policies (Once Implemented)

```sql
-- Test as super admin (should see all records)
SET request.jwt.claims = '{"sub": "super-admin-id", "user_role": "super_admin"}';
SELECT COUNT(*) FROM clients; -- Should return all clients

-- Test as org user (should only see own org)
SET request.jwt.claims = '{"sub": "user-id", "org_id": "org-uuid", "user_role": "clinician"}';
SELECT COUNT(*) FROM clients; -- Should return only clients in user's org

-- Test insert with wrong org_id (should fail)
INSERT INTO clients (organization_id, first_name, last_name, date_of_birth)
VALUES ('different-org-uuid', 'Test', 'Client', '2000-01-01'); -- Should be rejected by RLS
```

## Triggers

No triggers currently defined for this table.

**Recommended**: Consider adding triggers for:
- Automatic `updated_at` timestamp updates
- Domain event emission for CQRS pattern (ClientCreated, ClientUpdated, ClientArchived)
- Audit log entries

## Constraints

### Check Constraints

#### gender_check
```sql
CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'))
```
- **Purpose**: Ensure valid gender values
- **Values**: Limited to four predefined options
- **Nullable**: Column is nullable, so NULL is also allowed

#### status_check
```sql
CHECK (status IN ('active', 'inactive', 'archived'))
```
- **Purpose**: Ensure valid status transitions
- **Values**: Limited to three lifecycle states
- **Business Rule**: Status changes should follow workflow: active ↔ inactive → archived

### Unique Constraints

None currently defined.

**Recommendation**: Consider adding:
```sql
UNIQUE (organization_id, email) WHERE email IS NOT NULL;
```
- Prevents duplicate email addresses within an organization
- Allows NULL emails (not all clients may have email)

### Foreign Key Constraints

⚠️ **Not explicitly defined in SQL** - should be added:

```sql
ALTER TABLE clients
  ADD CONSTRAINT fk_clients_organization
  FOREIGN KEY (organization_id)
  REFERENCES organizations_projection(id)
  ON DELETE RESTRICT;
```

## Usage Examples

### Create a Client Record

```sql
INSERT INTO clients (
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
  admission_date,
  created_by
) VALUES (
  '123e4567-e89b-12d3-a456-426614174000'::uuid, -- organization_id
  'John',
  'Doe',
  '1985-06-15'::date,
  'male',
  'john.doe@example.com',
  '555-0123',
  '{"street": "123 Main St", "city": "Springfield", "state": "IL", "zip_code": "62701", "country": "USA"}'::jsonb,
  '{"name": "Jane Doe", "relationship": "spouse", "phone": "555-0124"}'::jsonb,
  ARRAY['Penicillin', 'Peanuts'], -- allergies
  ARRAY['Diabetes Type 2', 'Hypertension'], -- medical_conditions
  'A+',
  'active',
  '2024-01-15'::date,
  auth.uid() -- created_by
) RETURNING *;
```

**Returns**: The newly created client record with generated ID and timestamps

### Query Clients for Current Organization

```sql
-- Get all active clients for current organization
SELECT
  id,
  first_name,
  last_name,
  date_of_birth,
  email,
  phone,
  status,
  admission_date
FROM clients
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND status = 'active'
ORDER BY last_name, first_name;
```

**RLS Note**: Once RLS policies are implemented, the `WHERE organization_id = ...` clause becomes redundant but improves query performance.

### Search Clients by Name

```sql
-- Search for clients by last name (pattern matching)
SELECT
  id,
  first_name || ' ' || last_name AS full_name,
  date_of_birth,
  email,
  status
FROM clients
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND last_name ILIKE 'Smith%'
ORDER BY last_name, first_name
LIMIT 50;
```

**Performance**: Uses idx_clients_name index for efficient searching

### Update a Client Record

```sql
UPDATE clients
SET
  phone = '555-9999',
  address = '{"street": "456 Oak Ave", "city": "Springfield", "state": "IL", "zip_code": "62702", "country": "USA"}'::jsonb,
  updated_at = now(),
  updated_by = auth.uid()
WHERE id = '123e4567-e89b-12d3-a456-426614174001'::uuid;
```

**Best Practice**: Always update `updated_at` and `updated_by` for audit trail

### Archive a Client (Soft Delete)

```sql
-- Preferred over hard delete for compliance and audit trail
UPDATE clients
SET
  status = 'archived',
  discharge_date = CURRENT_DATE,
  updated_at = now(),
  updated_by = auth.uid()
WHERE id = '123e4567-e89b-12d3-a456-426614174001'::uuid
  AND status != 'archived';
```

**Note**: Hard deletes should be rare and require special permissions

### Common Queries

#### Get Client Age

```sql
SELECT
  id,
  first_name || ' ' || last_name AS full_name,
  date_of_birth,
  EXTRACT(YEAR FROM AGE(date_of_birth)) AS age_years
FROM clients
WHERE id = '123e4567-e89b-12d3-a456-426614174001'::uuid;
```

#### Find Clients with Specific Allergy

```sql
SELECT
  id,
  first_name || ' ' || last_name AS full_name,
  allergies
FROM clients
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND 'Penicillin' = ANY(allergies)
ORDER BY last_name, first_name;
```

**Performance**: May require GIN index on allergies array for better performance at scale

#### Clients with Medication History

```sql
SELECT
  c.id,
  c.first_name || ' ' || c.last_name AS client_name,
  COUNT(mh.id) AS medication_count,
  COUNT(DISTINCT mh.medication_id) AS unique_medications
FROM clients c
LEFT JOIN medication_history mh ON c.id = mh.client_id
WHERE c.organization_id = (auth.jwt()->>'org_id')::uuid
  AND c.status = 'active'
GROUP BY c.id, c.first_name, c.last_name
HAVING COUNT(mh.id) > 0
ORDER BY medication_count DESC;
```

#### Dashboard Statistics

```sql
SELECT
  status,
  COUNT(*) as client_count,
  COUNT(*) FILTER (WHERE admission_date >= CURRENT_DATE - INTERVAL '30 days') as recent_admissions
FROM clients
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
GROUP BY status;
```

## Audit Trail

### Event Emission

⚠️ **Not yet implemented** - This table should participate in the CQRS event-driven architecture:

**Recommended Events**:
- `clinical.client_registered` - When new client created
- `clinical.client_updated` - When client record modified
- `clinical.client_status_changed` - When status transitions (active → inactive → archived)
- `clinical.client_admitted` - When admission_date set
- `clinical.client_discharged` - When discharge_date set

**Event Data**: See AsyncAPI schema in `infrastructure/supabase/contracts/asyncapi/domains/clinical.yaml` (once created)

**Event Trigger**: Would require creating trigger functions (see Triggers section)

### Audit Log Integration

Not currently implemented. Recommended:
- All changes logged to `audit_log` table via trigger
- Track: user_id, timestamp, operation, old_values, new_values
- Immutable audit trail for HIPAA compliance

## JSONB Columns

### address

**Purpose**: Structured storage of client's physical address

**Schema**:
```typescript
interface AddressSchema {
  street?: string;       // Street address (e.g., "123 Main St, Apt 4B")
  city?: string;         // City name
  state?: string;        // State/province code
  zip_code?: string;     // Postal code
  country?: string;      // Country code or name
}
```

**Example Value**:
```json
{
  "street": "123 Main St, Apt 4B",
  "city": "Springfield",
  "state": "IL",
  "zip_code": "62701",
  "country": "USA"
}
```

**Validation**: None currently enforced - consider application-level validation

**Querying**:
```sql
-- Find clients in specific city
SELECT * FROM clients
WHERE address->>'city' = 'Springfield'
  AND organization_id = (auth.jwt()->>'org_id')::uuid;

-- Find clients by state
SELECT
  (address->>'state') as state,
  COUNT(*) as client_count
FROM clients
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
GROUP BY (address->>'state');
```

**Indexing**: Consider GIN index for frequent JSONB queries:
```sql
CREATE INDEX IF NOT EXISTS idx_clients_address_gin ON clients USING GIN (address);
```

### emergency_contact

**Purpose**: Structured storage of emergency contact information

**Schema**:
```typescript
interface EmergencyContactSchema {
  name?: string;           // Contact's full name
  relationship?: string;   // Relationship to client (e.g., "spouse", "parent", "friend")
  phone?: string;          // Primary phone number
  alternate_phone?: string; // Alternate/mobile phone number
}
```

**Example Value**:
```json
{
  "name": "Jane Doe",
  "relationship": "spouse",
  "phone": "555-0124",
  "alternate_phone": "555-0125"
}
```

**Validation**: None currently enforced

**Querying**:
```sql
-- Get clients with emergency contact relationship
SELECT
  id,
  first_name || ' ' || last_name AS client_name,
  emergency_contact->>'name' AS emergency_contact_name,
  emergency_contact->>'relationship' AS relationship,
  emergency_contact->>'phone' AS emergency_phone
FROM clients
WHERE emergency_contact->>'relationship' = 'spouse'
  AND organization_id = (auth.jwt()->>'org_id')::uuid;
```

### metadata

**Purpose**: Extensible storage for additional structured data

**Schema**: No fixed schema - application-specific

**Usage Examples**:
- Custom fields defined by organization
- Integration identifiers (external EHR IDs)
- Feature flags or preferences
- Temporary data during migrations

**Example Value**:
```json
{
  "external_ehr_id": "EHR-12345",
  "preferred_language": "English",
  "communication_preferences": {
    "email_reminders": true,
    "sms_reminders": false
  }
}
```

## Migration History

### Initial Creation
- **Migration**: `infrastructure/supabase/sql/02-tables/clients/table.sql`
- **Purpose**: Initial table creation with full schema
- **Features**:
  - Multi-tenant isolation via organization_id
  - JSONB columns for flexible address and emergency contact
  - Array columns for allergies and medical conditions
  - Audit fields (created_by, updated_by, timestamps)
  - Status workflow (active, inactive, archived)

### Schema Changes

None yet applied.

## Performance Considerations

### Query Performance

**Expected Row Count**:
- Small organizations: 10-100 clients
- Medium organizations: 100-1,000 clients
- Large organizations: 1,000-10,000 clients
- Platform total: 10,000-100,000+ clients

**Growth Rate**: Steady growth based on admissions, seasonal variations possible

**Hot Paths** (most common query patterns):
1. List active clients for organization (SELECT with status = 'active')
2. Search clients by name (SELECT with name pattern matching)
3. Get single client by ID (SELECT by primary key)
4. Client demographics for reporting (aggregations by age, status)

**Optimization Strategies**:
- Existing indexes cover primary query patterns well
- Consider partial index for active clients: `CREATE INDEX idx_clients_active ON clients(organization_id) WHERE status = 'active';`
- Monitor array column queries (allergies, medical_conditions) - may need GIN indexes
- Keep status distribution balanced (archive old inactive clients)

### Index Strategy

**Current Indexes**:
- Primary key (id) - Required, O(log n) lookups
- organization_id - Critical for multi-tenancy, heavily used
- (last_name, first_name) - Supports name searches and alphabetical sorting
- date_of_birth - Supports age-based queries
- status - Supports filtering active/inactive/archived

**Trade-offs**:
- Write performance: 5 indexes means inserts/updates maintain 5 B-trees
- Read performance: Excellent coverage for common queries
- Storage: Indexes add ~20-30% storage overhead

**Recommendations**:
- Current index strategy is well-balanced for expected usage
- Monitor query patterns in production to identify missing indexes
- Consider partial index on status='active' if 80%+ of queries filter active
- Consider GIN index on allergies/medical_conditions if array searches are common

**Maintenance**:
- VACUUM ANALYZE clients weekly (or let autovacuum handle it)
- REINDEX if corruption suspected (rare with PostgreSQL)
- Monitor index bloat with pg_stat_user_indexes

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: **RESTRICTED** (Protected Health Information - PHI)
- **PII/PHI**: YES - Contains names, DOB, contact info, medical history
- **Compliance**: **HIPAA**, **GDPR** (if serving EU residents)

**Critical PHI Fields**:
- All personally identifiable information (name, DOB, email, phone, address)
- Medical information (allergies, medical_conditions, blood_type)
- Clinical notes

### Access Control

⚠️ **CRITICAL**: RLS policies **MUST BE IMPLEMENTED** before this table can be used in production.

**Required Access Controls**:
- ✅ RLS enabled on table
- ❌ **SELECT policy NOT IMPLEMENTED**
- ❌ **INSERT policy NOT IMPLEMENTED**
- ❌ **UPDATE policy NOT IMPLEMENTED**
- ❌ **DELETE policy NOT IMPLEMENTED**

**Recommended Access Tiers**:
1. **Super Admin**: Full access to all organizations' clients
2. **Organization Admin**: Full access to own organization's clients
3. **Clinician**: Read/update access to own organization's clients (based on permissions)
4. **Viewer**: Read-only access to own organization's clients

**See**: RLS Policies section for detailed policy recommendations

### Encryption

- **At-rest encryption**: Handled by PostgreSQL/Supabase (AES-256)
- **In-transit encryption**: TLS/SSL connections enforced
- **Column-level encryption**: Not currently implemented (consider for extremely sensitive notes)

### HIPAA Compliance Considerations

**Minimum Necessary Rule**:
- Queries should only SELECT needed columns, not `SELECT *`
- Consider views that expose only non-PHI fields for general users

**Audit Trail Requirements**:
- ✅ created_by / updated_by fields present
- ✅ created_at / updated_at timestamps present
- ❌ Audit log trigger NOT YET IMPLEMENTED
- Recommendation: Implement audit_log trigger for all modifications

**Data Retention**:
- Define retention policy (e.g., 7 years post-discharge for HIPAA)
- Implement automated archival/deletion based on discharge_date
- Ensure backup retention matches compliance requirements

## Troubleshooting

### Common Issues

#### RLS Policy Errors

**Symptom**: `permission denied for table clients` or `new row violates row-level security policy`

**Cause**: RLS is enabled but policies are not yet implemented

**Solution**:
1. **Temporary workaround** (development only): Disable RLS temporarily
   ```sql
   ALTER TABLE clients DISABLE ROW LEVEL SECURITY; -- DEVELOPMENT ONLY!
   ```

2. **Proper solution**: Implement RLS policies (see RLS Policies section)
   ```sql
   -- See recommended policies in RLS Policies section above
   ```

3. **Verify organization_id** matches JWT claim:
   ```sql
   SELECT auth.jwt()->>'org_id' AS current_org_id;
   ```

#### Foreign Key Violations

**Symptom**: `insert or update on table "clients" violates foreign key constraint`

**Cause**: Referenced organization_id doesn't exist in organizations_projection

**Solution**:
```sql
-- Verify organization exists
SELECT id, name FROM organizations_projection WHERE id = 'your-org-uuid';

-- If missing, create organization first or use existing org_id
```

#### Array Column Queries Slow

**Symptom**: Queries filtering by allergies or medical_conditions are slow (> 100ms)

**Diagnosis**:
```sql
EXPLAIN ANALYZE
SELECT * FROM clients
WHERE 'Penicillin' = ANY(allergies)
  AND organization_id = 'org-uuid';
```

**Solution**: Add GIN index for array containment queries
```sql
CREATE INDEX IF NOT EXISTS idx_clients_allergies_gin ON clients USING GIN (allergies);
CREATE INDEX IF NOT EXISTS idx_clients_conditions_gin ON clients USING GIN (medical_conditions);
```

#### JSONB Query Performance

**Symptom**: Queries on address or emergency_contact JSONB fields are slow

**Solution**: Add GIN index for JSONB
```sql
CREATE INDEX IF NOT EXISTS idx_clients_address_gin ON clients USING GIN (address);
CREATE INDEX IF NOT EXISTS idx_clients_emergency_gin ON clients USING GIN (emergency_contact);
```

### Performance Issues

#### Slow Name Searches

**Symptom**: Client name searches taking > 50ms

**Diagnosis**:
```sql
EXPLAIN ANALYZE
SELECT * FROM clients
WHERE organization_id = 'org-uuid'
  AND last_name ILIKE 'Smith%'
ORDER BY last_name, first_name
LIMIT 50;
```

**Expected**: Should use idx_clients_name index

**Solution**: If not using index, analyze table statistics
```sql
ANALYZE clients;
```

#### Table Bloat

**Symptom**: Table size growing disproportionately to row count

**Diagnosis**:
```sql
SELECT
  pg_size_pretty(pg_total_relation_size('clients')) AS total_size,
  pg_size_pretty(pg_relation_size('clients')) AS table_size,
  pg_size_pretty(pg_indexes_size('clients')) AS indexes_size,
  (SELECT COUNT(*) FROM clients) AS row_count;
```

**Solution**: Vacuum full (requires lock) or use pg_repack
```sql
VACUUM FULL clients; -- Requires exclusive lock
-- OR use pg_repack for online operation (if available)
```

## Related Documentation

- [organizations_projection](./organizations_projection.md) - Parent organization table
- [users](./users.md) - User authentication and multi-tenant access
- [medication_history](./medication_history.md) - Child table for prescriptions (to be documented)
- [dosage_info](./dosage_info.md) - Child table for dosage administration (to be documented)
- [Schema Overview](../schema-overview.md) - Complete database schema and ER diagrams (to be created)
- [RLS Policies](../../guides/database/rls-policies.md) - Comprehensive RLS policy guide (to be created)
- [Migration Guide](../../guides/database/migration-guide.md) - How to create migrations (to be created)
- [Event Sourcing](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern explanation

## See Also

- **Related Tables**:
  - [organizations_projection](./organizations_projection.md) - Multi-tenant isolation
  - [users](./users.md) - Created by / updated by references
  - medication_history - Client medication prescriptions (to be documented)
  - dosage_info - Medication dosage administration (to be documented)
- **AsyncAPI Contracts**: `infrastructure/supabase/contracts/asyncapi/domains/clinical.yaml` (to be created)
- **Database Functions**: `is_super_admin()`, `is_org_admin()`, `user_has_permission()` (see `infrastructure/supabase/sql/03-functions/`)
- **SQL Files**:
  - Table: `infrastructure/supabase/sql/02-tables/clients/table.sql`
  - Indexes: `infrastructure/supabase/sql/02-tables/clients/indexes/`
  - RLS: `infrastructure/supabase/sql/06-rls/enable_rls_all_tables.sql`

---

**Last Updated**: 2025-01-12
**Applies To**: Database schema v1.0
**Status**: current
**Critical Gap**: RLS policies must be implemented before production use
