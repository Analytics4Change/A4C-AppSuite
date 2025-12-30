---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Core clinical table for medication prescriptions connecting clients to medications. Tracks prescription details, dosage instructions, prescriber info, refills, compliance, effectiveness, and side effects. Parent of dosage_info (individual doses). RLS enabled but policies NOT YET IMPLEMENTED.

**When to read**:
- Building prescription management features
- Implementing refill tracking or compliance monitoring
- Querying client's active medications
- Understanding medication workflow (prescribe → administer → track)

**Prerequisites**: [clients](./clients.md), [medications](./medications.md), [dosage_info](./dosage_info.md)

**Key topics**: `medication-history`, `prescriptions`, `refills`, `compliance`, `prn`, `controlled-substances`, `rls-gap`

**Estimated read time**: 30 minutes
<!-- TL;DR-END -->

# medication_history

## Overview

The `medication_history` table tracks all medication prescriptions and administration history for clients. This is a core clinical table that connects clients to medications, storing prescription details, dosage instructions, refill tracking, compliance monitoring, and effectiveness reporting. Each record represents a single medication prescription or administration episode within a multi-tenant environment.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key - unique identifier for prescription |
| organization_id | uuid | NO | - | Foreign key to organizations (multi-tenant isolation) |
| client_id | uuid | NO | - | Foreign key to clients table |
| medication_id | uuid | NO | - | Foreign key to medications table |
| prescription_date | date | NO | - | Date prescription was written |
| start_date | date | NO | - | Date to begin taking medication |
| end_date | date | YES | - | Planned end date (if not ongoing) |
| discontinue_date | date | YES | - | Actual discontinuation date |
| discontinue_reason | text | YES | - | Reason for discontinuation |
| prescriber_name | text | YES | - | Name of prescribing provider |
| prescriber_npi | text | YES | - | National Provider Identifier |
| prescriber_license | text | YES | - | Provider license number |
| dosage_amount | decimal | YES | - | Dose amount (e.g., 500) |
| dosage_unit | text | YES | - | Dose unit (e.g., "mg", "mL") |
| dosage_form | text | YES | - | Broad dosage form category |
| frequency | text | YES | - | Dosing frequency (e.g., "BID", "TID") |
| timings | text[] | YES | - | Specific timing conditions |
| food_conditions | text[] | YES | - | Food-related instructions |
| special_restrictions | text[] | YES | - | Special restrictions or precautions |
| route | text | YES | - | Route of administration |
| instructions | text | YES | - | Free-text dosing instructions |
| is_prn | boolean | YES | false | True if "as needed" medication |
| prn_reason | text | YES | - | Reason for PRN use |
| status | text | YES | 'active' | Prescription status |
| refills_authorized | integer | YES | - | Number of refills authorized |
| refills_used | integer | YES | 0 | Number of refills used |
| last_filled_date | date | YES | - | Date prescription last filled |
| pharmacy_name | text | YES | - | Dispensing pharmacy name |
| pharmacy_phone | text | YES | - | Pharmacy phone number |
| rx_number | text | YES | - | Prescription number from pharmacy |
| inventory_quantity | decimal | YES | - | Current inventory quantity |
| inventory_unit | text | YES | - | Inventory unit (pills, mL, etc.) |
| notes | text | YES | - | Clinical notes about prescription |
| side_effects_reported | text[] | YES | - | Reported side effects |
| effectiveness_rating | integer | YES | - | Effectiveness rating (1-5 scale) |
| compliance_percentage | decimal | YES | - | Adherence percentage (0-100) |
| missed_doses_count | integer | YES | 0 | Count of missed doses |
| metadata | jsonb | YES | '{}' | Additional structured metadata |
| created_by | uuid | YES | - | User ID who created the record |
| updated_by | uuid | YES | - | User ID who last updated the record |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record last update timestamp |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each prescription record
- **Generation**: Automatically generated via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY
- **Usage**: Referenced by dosage_info for administered doses

#### organization_id
- **Type**: `uuid`
- **Purpose**: Multi-tenant isolation key
- **Foreign Key**: References `organizations_projection(id)` (not explicitly enforced)
- **Constraints**: NOT NULL
- **RLS**: Critical for tenant isolation
- **Note**: **RLS policies not yet implemented** (see Security Considerations section)

#### client_id
- **Type**: `uuid`
- **Purpose**: Links prescription to specific client/patient
- **Foreign Key**: References `clients(id)` (not explicitly enforced)
- **Constraints**: NOT NULL
- **Index**: Indexed for client medication history lookups
- **Usage**: View all medications for a client, medication reconciliation

#### medication_id
- **Type**: `uuid`
- **Purpose**: Links to medication catalog entry
- **Foreign Key**: References `medications(id)` (not explicitly enforced)
- **Constraints**: NOT NULL
- **Index**: Indexed for medication usage tracking
- **Usage**: Find all clients prescribed a specific medication

#### prescription_date
- **Type**: `date`
- **Purpose**: Date the prescription was written by provider
- **Constraints**: NOT NULL
- **Index**: Indexed for chronological queries
- **Usage**: Prescription history reports, audit trail

#### start_date / end_date
- **Type**: `date`
- **Purpose**: Planned medication administration period
- **Constraints**: start_date NOT NULL, end_date nullable
- **Usage**:
  - start_date: When client should begin taking medication
  - end_date: Planned stop date (NULL for ongoing medications)

#### discontinue_date / discontinue_reason
- **Type**: `date` / `text`
- **Purpose**: Track actual discontinuation
- **Usage**:
  - discontinue_date: Actual date medication stopped
  - discontinue_reason: Clinical reason (e.g., "Side effects", "Completed course", "No longer needed")
- **Note**: Different from end_date (discontinue is actual, end is planned)

#### prescriber_name / prescriber_npi / prescriber_license
- **Type**: `text`
- **Purpose**: Track prescribing provider
- **Usage**:
  - prescriber_name: Provider name for display
  - prescriber_npi: National Provider Identifier for billing/verification
  - prescriber_license: State medical license number
- **Compliance**: Required for regulatory reporting, controlled substances

#### dosage_amount / dosage_unit / dosage_form
- **Type**: `decimal` / `text` / `text`
- **Purpose**: Structured dosage information
- **Usage**:
  - dosage_amount: Numeric dose (e.g., 500)
  - dosage_unit: Unit of measurement (e.g., "mg", "mL", "units")
  - dosage_form: Form category (e.g., "tablet", "capsule", "liquid")
- **Example**: 500 mg tablet

#### frequency
- **Type**: `text`
- **Purpose**: Dosing frequency
- **Format**: Medical abbreviations or plain text
- **Examples**:
  - "BID" (twice daily)
  - "TID" (three times daily)
  - "QID" (four times daily)
  - "Daily"
  - "Every 6 hours"
  - "Three times per week"

#### timings
- **Type**: `text[]`
- **Purpose**: Specific timing conditions for administration
- **Example**: `['morning', 'evening', 'bedtime']`
- **Usage**: Dosage scheduling, administration reminders

#### food_conditions
- **Type**: `text[]`
- **Purpose**: Food-related administration instructions
- **Example**: `['with_food', 'on_empty_stomach', 'avoid_dairy']`
- **Usage**: Patient education, administration verification

#### special_restrictions
- **Type**: `text[]`
- **Purpose**: Special precautions or restrictions
- **Example**: `['avoid_alcohol', 'avoid_driving', 'limit_sun_exposure']`
- **Usage**: Safety warnings, patient education

#### route
- **Type**: `text`
- **Purpose**: Route of administration
- **Examples**: "oral", "injection", "topical", "sublingual", "rectal", "transdermal"
- **Usage**: Administration verification, dosage_info validation

#### instructions
- **Type**: `text`
- **Purpose**: Free-text dosing instructions
- **Usage**: Complete dosing instructions for patient/caregiver
- **Example**: "Take 2 tablets by mouth twice daily with food for 10 days"

#### is_prn / prn_reason
- **Type**: `boolean` / `text`
- **Purpose**: Track "as needed" (PRN) medications
- **Index**: is_prn indexed for filtering
- **Usage**:
  - is_prn: True if medication taken only when needed
  - prn_reason: Condition for use (e.g., "for pain", "for anxiety", "for nausea")

#### status
- **Type**: `text`
- **Purpose**: Current prescription status
- **Constraints**: CHECK (status IN ('active', 'completed', 'discontinued', 'on_hold'))
- **Default**: 'active'
- **Index**: Indexed for status filtering
- **Values**:
  - **active**: Currently being taken
  - **completed**: Finished as prescribed
  - **discontinued**: Stopped before completion
  - **on_hold**: Temporarily paused

#### refills_authorized / refills_used / last_filled_date
- **Type**: `integer` / `integer` / `date`
- **Purpose**: Refill tracking
- **Usage**:
  - refills_authorized: Total refills allowed
  - refills_used: Refills dispensed so far
  - last_filled_date: Date of most recent fill
- **Business Logic**: Alert when refills_used >= refills_authorized

#### pharmacy_name / pharmacy_phone / rx_number
- **Type**: `text`
- **Purpose**: Dispensing pharmacy information
- **Usage**: Refill coordination, prescription verification

#### inventory_quantity / inventory_unit
- **Type**: `decimal` / `text`
- **Purpose**: Track remaining medication quantity
- **Usage**: Refill alerts, inventory management
- **Example**:
  - inventory_quantity: 30
  - inventory_unit: "tablets"

#### notes
- **Type**: `text`
- **Purpose**: Clinical notes about prescription
- **Usage**: Clinical context, special considerations

#### side_effects_reported
- **Type**: `text[]`
- **Purpose**: Array of reported side effects
- **Usage**: Safety monitoring, medication review
- **Example**: `['drowsiness', 'dry_mouth', 'nausea']`

#### effectiveness_rating
- **Type**: `integer`
- **Purpose**: Subjective effectiveness rating
- **Constraints**: CHECK (effectiveness_rating BETWEEN 1 AND 5)
- **Usage**: Medication review, treatment optimization
- **Scale**: 1 (not effective) to 5 (very effective)

#### compliance_percentage / missed_doses_count
- **Type**: `decimal` / `integer`
- **Purpose**: Medication adherence tracking
- **Usage**:
  - compliance_percentage: 0-100 (percentage of doses taken as prescribed)
  - missed_doses_count: Total missed doses
- **Calculation**: Based on dosage_info records

#### metadata
- **Type**: `jsonb`
- **Purpose**: Extensible storage for additional data
- **Default**: `{}`
- **Usage**: Custom fields, integration data, extended attributes

#### created_by / updated_by
- **Type**: `uuid`
- **Purpose**: Audit trail
- **Foreign Key**: References `users(id)`
- **Usage**: Compliance, auditing, change tracking

#### created_at / updated_at
- **Type**: `timestamptz`
- **Purpose**: Timestamp audit trail
- **Default**: `now()`
- **Usage**: Change tracking, compliance, data synchronization

## Relationships

### Parent Relationships (Foreign Keys)

⚠️ **Implementation Note**: Foreign key constraints are not explicitly defined in the table SQL but should be considered required by application logic.

- **organizations_projection** → `organization_id`
  - Each prescription belongs to exactly one organization
  - Multi-tenant isolation
  - **Expected behavior**: ON DELETE RESTRICT

- **clients** → `client_id`
  - Each prescription is for exactly one client
  - Required for prescription validity
  - **Expected behavior**: ON DELETE RESTRICT (preserve history)

- **medications** → `medication_id`
  - Each prescription references exactly one medication catalog entry
  - Required for prescription validity
  - **Expected behavior**: ON DELETE RESTRICT (preserve history)

### Child Relationships (Referenced By)

- **dosage_info** ← `medication_history_id`
  - One-to-many relationship
  - Tracks individual dose administrations for this prescription
  - Cascade behavior: Should cascade delete if prescription deleted

### Many-to-Many Relationships

None currently defined.

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by prescription ID
- **Performance**: O(log n) lookups
- **Usage**: Direct prescription retrieval

### Secondary Indexes

#### idx_medication_history_organization
```sql
CREATE INDEX IF NOT EXISTS idx_medication_history_organization
  ON medication_history(organization_id);
```
- **Purpose**: Multi-tenant queries
- **Used By**: RLS enforcement, organization reports
- **Typical Query**: `SELECT * FROM medication_history WHERE organization_id = ?`

#### idx_medication_history_client
```sql
CREATE INDEX IF NOT EXISTS idx_medication_history_client
  ON medication_history(client_id);
```
- **Purpose**: Client medication history
- **Used By**: Medication reconciliation, client profile
- **Critical**: High-frequency query pattern
- **Typical Query**: `SELECT * FROM medication_history WHERE client_id = ?`

#### idx_medication_history_medication
```sql
CREATE INDEX IF NOT EXISTS idx_medication_history_medication
  ON medication_history(medication_id);
```
- **Purpose**: Medication usage tracking
- **Used By**: Formulary analysis, safety alerts
- **Typical Query**: `SELECT * FROM medication_history WHERE medication_id = ?`

#### idx_medication_history_prescription_date
```sql
CREATE INDEX IF NOT EXISTS idx_medication_history_prescription_date
  ON medication_history(prescription_date);
```
- **Purpose**: Chronological queries
- **Used By**: Prescription history reports, temporal analysis
- **Typical Query**: `SELECT * FROM medication_history WHERE prescription_date BETWEEN ? AND ?`

#### idx_medication_history_status
```sql
CREATE INDEX IF NOT EXISTS idx_medication_history_status
  ON medication_history(status);
```
- **Purpose**: Filter by prescription status
- **Used By**: Active medication list, discontinued medication reports
- **Typical Query**: `SELECT * FROM medication_history WHERE status = 'active'`

#### idx_medication_history_is_prn
```sql
CREATE INDEX IF NOT EXISTS idx_medication_history_is_prn
  ON medication_history(is_prn);
```
- **Purpose**: Filter PRN (as needed) medications
- **Used By**: PRN medication reports, administration tracking
- **Typical Query**: `SELECT * FROM medication_history WHERE is_prn = true`

## RLS Policies

⚠️ **CRITICAL IMPLEMENTATION GAP**: Row-Level Security is **ENABLED** on this table but **NO POLICIES ARE DEFINED**.

### Current State

```sql
ALTER TABLE medication_history ENABLE ROW LEVEL SECURITY;
```

**Impact**: With RLS enabled but no policies, the table will **DENY ALL ACCESS** by default.

### Required Policies (Not Yet Implemented)

#### Recommended SELECT Policy

```sql
CREATE POLICY "medication_history_select_policy"
  ON medication_history FOR SELECT
  USING (
    is_super_admin(get_current_user_id()) OR
    organization_id = (auth.jwt()->>'org_id')::uuid
  );
```

**Purpose**: Control which prescription records users can view

#### Recommended INSERT Policy

```sql
CREATE POLICY "medication_history_insert_policy"
  ON medication_history FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
    )
  );
```

**Purpose**: Control who can create prescriptions

#### Recommended UPDATE Policy

```sql
CREATE POLICY "medication_history_update_policy"
  ON medication_history FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );
```

#### Recommended DELETE Policy

```sql
CREATE POLICY "medication_history_delete_policy"
  ON medication_history FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.delete', organization_id)
    )
  );
```

**Note**: Deletes should be rare - prefer status='discontinued'

## Triggers

No triggers currently defined for this table.

**Recommended**: Consider adding triggers for:
- Automatic `updated_at` timestamp updates
- Domain event emission (MedicationPrescribed, MedicationDiscontinued, RefillNeeded)
- Compliance percentage calculation based on dosage_info
- Refill alerts when refills_used >= refills_authorized
- Inventory quantity updates based on dosage_info

## Constraints

### Check Constraints

#### status_check
```sql
CHECK (status IN ('active', 'completed', 'discontinued', 'on_hold'))
```
- **Purpose**: Ensure valid status values
- **Business Rule**: Status transitions should follow workflow

#### effectiveness_rating_check
```sql
CHECK (effectiveness_rating BETWEEN 1 AND 5)
```
- **Purpose**: Ensure valid rating values (1-5 scale)

### Unique Constraints

None currently defined.

**Recommendation**: Consider adding to prevent duplicate active prescriptions:
```sql
UNIQUE (client_id, medication_id, start_date)
WHERE status = 'active';
```
- Prevents duplicate active prescriptions for same medication

### Foreign Key Constraints

⚠️ **Not explicitly defined in SQL** - should be added:

```sql
ALTER TABLE medication_history
  ADD CONSTRAINT fk_medication_history_organization
  FOREIGN KEY (organization_id)
  REFERENCES organizations_projection(id)
  ON DELETE RESTRICT;

ALTER TABLE medication_history
  ADD CONSTRAINT fk_medication_history_client
  FOREIGN KEY (client_id)
  REFERENCES clients(id)
  ON DELETE RESTRICT;

ALTER TABLE medication_history
  ADD CONSTRAINT fk_medication_history_medication
  FOREIGN KEY (medication_id)
  REFERENCES medications(id)
  ON DELETE RESTRICT;
```

## Usage Examples

### Create New Prescription

```sql
INSERT INTO medication_history (
  organization_id,
  client_id,
  medication_id,
  prescription_date,
  start_date,
  end_date,
  prescriber_name,
  prescriber_npi,
  dosage_amount,
  dosage_unit,
  dosage_form,
  frequency,
  timings,
  food_conditions,
  route,
  instructions,
  is_prn,
  status,
  refills_authorized,
  created_by
) VALUES (
  '123e4567-e89b-12d3-a456-426614174000'::uuid,
  'client-uuid',
  'medication-uuid',
  '2024-01-15'::date,
  '2024-01-16'::date,
  '2024-02-15'::date,
  'Dr. Jane Smith',
  '1234567890',
  500,
  'mg',
  'tablet',
  'BID',
  ARRAY['morning', 'evening'],
  ARRAY['with_food'],
  'oral',
  'Take 1 tablet (500mg) by mouth twice daily with food for 30 days',
  false,
  'active',
  2,
  auth.uid()
) RETURNING *;
```

### Get Client's Active Medications

```sql
SELECT
  mh.id,
  m.name as medication_name,
  m.generic_name,
  mh.dosage_amount || ' ' || mh.dosage_unit as dosage,
  mh.frequency,
  mh.route,
  mh.start_date,
  mh.end_date,
  mh.prescriber_name,
  mh.refills_authorized - mh.refills_used as refills_remaining,
  m.is_controlled,
  m.is_high_alert
FROM medication_history mh
JOIN medications m ON mh.medication_id = m.id
WHERE mh.client_id = 'client-uuid'
  AND mh.organization_id = (auth.jwt()->>'org_id')::uuid
  AND mh.status = 'active'
ORDER BY m.name;
```

### Discontinue Prescription

```sql
UPDATE medication_history
SET
  status = 'discontinued',
  discontinue_date = CURRENT_DATE,
  discontinue_reason = 'Side effects - nausea and dizziness',
  updated_at = now(),
  updated_by = auth.uid()
WHERE id = 'prescription-uuid'
  AND status = 'active';
```

### Track Refill

```sql
UPDATE medication_history
SET
  refills_used = refills_used + 1,
  last_filled_date = CURRENT_DATE,
  inventory_quantity = inventory_quantity + 30, -- Assuming 30-day supply
  updated_at = now(),
  updated_by = auth.uid()
WHERE id = 'prescription-uuid';
```

### Report Side Effect

```sql
UPDATE medication_history
SET
  side_effects_reported = array_append(
    COALESCE(side_effects_reported, ARRAY[]::text[]),
    'headache'
  ),
  updated_at = now(),
  updated_by = auth.uid()
WHERE id = 'prescription-uuid';
```

### Common Queries

#### Prescriptions Needing Refills

```sql
SELECT
  c.first_name || ' ' || c.last_name as client_name,
  m.name as medication_name,
  mh.last_filled_date,
  mh.refills_authorized,
  mh.refills_used,
  mh.pharmacy_name,
  mh.pharmacy_phone
FROM medication_history mh
JOIN clients c ON mh.client_id = c.id
JOIN medications m ON mh.medication_id = m.id
WHERE mh.organization_id = (auth.jwt()->>'org_id')::uuid
  AND mh.status = 'active'
  AND mh.refills_used >= mh.refills_authorized
  AND mh.last_filled_date < CURRENT_DATE - INTERVAL '25 days'
ORDER BY mh.last_filled_date;
```

#### PRN Medications by Client

```sql
SELECT
  m.name,
  mh.prn_reason,
  mh.dosage_amount || ' ' || mh.dosage_unit as dosage,
  mh.instructions,
  mh.start_date
FROM medication_history mh
JOIN medications m ON mh.medication_id = m.id
WHERE mh.client_id = 'client-uuid'
  AND mh.organization_id = (auth.jwt()->>'org_id')::uuid
  AND mh.is_prn = true
  AND mh.status = 'active'
ORDER BY m.name;
```

#### Medication Effectiveness Report

```sql
SELECT
  m.name as medication_name,
  m.generic_name,
  AVG(mh.effectiveness_rating) as avg_effectiveness,
  COUNT(*) as prescription_count,
  COUNT(*) FILTER (WHERE mh.status = 'discontinued') as discontinued_count,
  COUNT(*) FILTER (WHERE array_length(mh.side_effects_reported, 1) > 0) as side_effects_reported_count
FROM medication_history mh
JOIN medications m ON mh.medication_id = m.id
WHERE mh.organization_id = (auth.jwt()->>'org_id')::uuid
  AND mh.effectiveness_rating IS NOT NULL
GROUP BY m.id, m.name, m.generic_name
ORDER BY avg_effectiveness DESC;
```

#### Controlled Substance Prescriptions

```sql
SELECT
  c.first_name || ' ' || c.last_name as client_name,
  m.name as medication_name,
  m.controlled_substance_schedule,
  mh.prescription_date,
  mh.prescriber_name,
  mh.prescriber_npi,
  mh.refills_authorized,
  mh.refills_used,
  mh.status
FROM medication_history mh
JOIN medications m ON mh.medication_id = m.id
JOIN clients c ON mh.client_id = c.id
WHERE mh.organization_id = (auth.jwt()->>'org_id')::uuid
  AND m.is_controlled = true
  AND mh.prescription_date >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY mh.prescription_date DESC;
```

## Audit Trail

### Event Emission

⚠️ **Not yet implemented** - This table should participate in the CQRS event-driven architecture:

**Recommended Events**:
- `clinical.medication_prescribed` - When new prescription created
- `clinical.medication_updated` - When prescription modified
- `clinical.medication_discontinued` - When status changes to discontinued
- `clinical.refill_dispensed` - When refill_used incremented
- `clinical.side_effect_reported` - When side effect added
- `safety.controlled_substance_prescribed` - When controlled medication prescribed

**Event Data**: See AsyncAPI schema in `infrastructure/supabase/contracts/asyncapi/domains/clinical.yaml`

### Audit Log Integration

Not currently implemented. Recommended for regulatory compliance (especially controlled substances).

## JSONB Columns

### metadata

**Purpose**: Extensible storage for additional structured data

**Schema**: No fixed schema - application-specific

**Usage Examples**:
- External prescription IDs (e.g., e-prescribing system IDs)
- Custom prescription attributes
- Integration data
- Feature flags

**Example Value**:
```json
{
  "external_rx_id": "ERXQ12345",
  "compound_medication": false,
  "prior_auth_required": true,
  "prior_auth_number": "PA-987654",
  "formulary_tier": 1
}
```

## Migration History

### Initial Creation
- **Migration**: `infrastructure/supabase/sql/02-tables/medication_history/table.sql`
- **Purpose**: Initial table creation with comprehensive prescription tracking
- **Features**:
  - Multi-tenant isolation
  - Client and medication foreign keys
  - Comprehensive dosage and administration fields
  - Refill tracking
  - Compliance monitoring
  - Side effect reporting

### Schema Changes

None yet applied.

## Performance Considerations

### Query Performance

**Expected Row Count**:
- Per client: 10-100 prescriptions (lifetime)
- Per organization: 1,000-100,000 prescriptions
- Platform total: 1,000,000+ prescriptions

**Growth Rate**: Steady - new prescriptions added daily

**Hot Paths**:
1. Client's active medications (SELECT by client_id, status='active')
2. Refill tracking (SELECT by refills_used, last_filled_date)
3. Prescription history (SELECT by client_id ordered by prescription_date)
4. Controlled substance reports (JOIN with medications, is_controlled=true)

**Optimization Strategies**:
- Existing indexes cover primary query patterns
- Consider composite index: `(client_id, status)` for active med lists
- Consider partial index: `WHERE status = 'active'` if 80%+ queries filter active
- Monitor array column queries (side_effects_reported) - may need GIN index

### Index Strategy

**Current Indexes**: 7 indexes provide good coverage
**Trade-offs**: Moderate write overhead, excellent read performance
**Recommendations**: Monitor and add composite indexes based on query patterns

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: **RESTRICTED** (Protected Health Information - PHI)
- **PII/PHI**: YES - Prescription history is highly sensitive medical data
- **Compliance**: **HIPAA**, **DEA** (for controlled substances), **GDPR**

**Critical PHI Fields**: ALL prescription data

### Access Control

⚠️ **CRITICAL**: RLS policies **MUST BE IMPLEMENTED** before production use.

**Required Access Tiers**:
1. **Super Admin**: Full access
2. **Prescriber**: Create/update prescriptions for own organization
3. **Clinician**: Read prescriptions for assigned clients
4. **Viewer**: Read-only for own organization

### Controlled Substances

**Special Requirements**:
- Enhanced audit trail for DEA compliance
- Prescription Monitoring Program (PMP) integration
- Prescriber verification
- Refill limits enforcement

## Troubleshooting

### Common Issues

#### RLS Policy Errors
**Symptom**: `permission denied for table medication_history`
**Solution**: See RLS Policies section for implementation

#### Missing Prescriptions in Active List
**Symptom**: Prescription not showing in active medication list
**Diagnosis**: Check status field
```sql
SELECT id, client_id, status, start_date, end_date, discontinue_date
FROM medication_history
WHERE id = 'prescription-uuid';
```

#### Refill Tracking Issues
**Symptom**: Incorrect refill counts
**Solution**: Verify refills_authorized and refills_used values
```sql
SELECT
  refills_authorized,
  refills_used,
  refills_authorized - refills_used as remaining
FROM medication_history
WHERE id = 'prescription-uuid';
```

### Performance Issues

#### Slow Client Medication Lists
**Solution**: Ensure idx_medication_history_client index exists and is being used

#### Slow Controlled Substance Reports
**Solution**: Add composite index on (organization_id, status) and ensure join to medications uses idx_medications_is_controlled

## Related Documentation

- [clients](./clients.md) - Parent client table
- [medications](./medications.md) - Parent medication catalog
- [dosage_info](./dosage_info.md) - Child dosage administration table (to be documented)
- [organizations_projection](./organizations_projection.md) - Multi-tenant isolation
- [users](./users.md) - Prescriber and audit references
- [Event Sourcing](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern

## See Also

- **SQL Files**:
  - Table: `infrastructure/supabase/sql/02-tables/medication_history/table.sql`
  - Indexes: `infrastructure/supabase/sql/02-tables/medication_history/indexes/`
  - RLS: `infrastructure/supabase/sql/06-rls/enable_rls_all_tables.sql`
- **AsyncAPI Contracts**: `infrastructure/supabase/contracts/asyncapi/domains/clinical.yaml` (to be created)
- **Database Functions**: Authorization functions in `infrastructure/supabase/sql/03-functions/`

---

**Last Updated**: 2025-01-12
**Applies To**: Database schema v1.0
**Status**: current
**Critical Gap**: RLS policies must be implemented before production use
