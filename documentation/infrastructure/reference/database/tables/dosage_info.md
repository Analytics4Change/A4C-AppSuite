---
status: current
last_updated: 2025-01-13
---

# dosage_info

## Overview

The `dosage_info` table tracks actual medication administration events, recording when medications are scheduled, administered, skipped, or refused. This is a critical clinical operations table for medication administration record (MAR) tracking, compliance monitoring, and safety verification. Each record represents a single dose administration event within a multi-tenant environment.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key - unique identifier for dose event |
| organization_id | uuid | NO | - | Foreign key to organizations (multi-tenant isolation) |
| medication_history_id | uuid | NO | - | Foreign key to medication_history |
| client_id | uuid | NO | - | Foreign key to clients (denormalized for performance) |
| scheduled_datetime | timestamptz | NO | - | When dose was scheduled to be given |
| administered_datetime | timestamptz | YES | - | When dose was actually administered |
| administered_by | uuid | YES | - | User ID who administered the dose |
| scheduled_amount | decimal | NO | - | Scheduled dose amount |
| administered_amount | decimal | YES | - | Actual amount administered |
| unit | text | NO | - | Unit of measurement (mg, mL, tablets, etc.) |
| status | text | NO | 'scheduled' | Dose status |
| skip_reason | text | YES | - | Reason if status='skipped' |
| refusal_reason | text | YES | - | Reason if status='refused' |
| administration_notes | text | YES | - | Clinical notes about administration |
| vitals_before | jsonb | YES | '{}' | Vital signs before administration |
| vitals_after | jsonb | YES | '{}' | Vital signs after administration |
| side_effects_observed | text[] | YES | - | Observed side effects |
| adverse_reaction | boolean | YES | false | True if adverse reaction occurred |
| adverse_reaction_details | text | YES | - | Details of adverse reaction |
| verified_by | uuid | YES | - | User ID who verified administration |
| verification_datetime | timestamptz | YES | - | When administration was verified |
| metadata | jsonb | YES | '{}' | Additional structured metadata |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record last update timestamp |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each dose administration event
- **Generation**: Automatically generated via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY

#### organization_id
- **Type**: `uuid`
- **Purpose**: Multi-tenant isolation key
- **Constraints**: NOT NULL
- **Note**: **RLS policies not yet implemented**

#### medication_history_id
- **Type**: `uuid`
- **Purpose**: Links dose to specific prescription
- **Foreign Key**: References `medication_history(id)` (not explicitly enforced)
- **Constraints**: NOT NULL
- **Index**: Indexed for prescription dose history
- **Usage**: View all doses for a prescription, calculate compliance

#### client_id
- **Type**: `uuid`
- **Purpose**: Denormalized client reference for performance
- **Foreign Key**: References `clients(id)` (not explicitly enforced)
- **Constraints**: NOT NULL
- **Index**: Indexed for client MAR queries
- **Usage**: Fast client medication administration record retrieval
- **Note**: Denormalized from medication_history for query performance

#### scheduled_datetime / administered_datetime
- **Type**: `timestamptz`
- **Purpose**: Track scheduled vs actual administration time
- **Constraints**: scheduled_datetime NOT NULL, administered_datetime nullable
- **Index**: scheduled_datetime indexed for chronological queries
- **Usage**:
  - scheduled_datetime: When dose should be given
  - administered_datetime: When dose was actually given (NULL if not yet administered)
- **Timeliness Tracking**: Compare to determine late/early administration

#### administered_by
- **Type**: `uuid`
- **Purpose**: Track which user administered the dose
- **Foreign Key**: References `users(id)`
- **Index**: Indexed for staff administration tracking
- **Usage**: Staff performance, compliance auditing, regulatory reporting

#### scheduled_amount / administered_amount
- **Type**: `decimal`
- **Purpose**: Track scheduled vs actual dose amount
- **Constraints**: scheduled_amount NOT NULL, administered_amount nullable
- **Usage**:
  - scheduled_amount: Prescribed dose amount
  - administered_amount: Actual amount given (may differ for partial doses)

#### unit
- **Type**: `text`
- **Purpose**: Unit of measurement for dosage
- **Constraints**: NOT NULL
- **Examples**: "mg", "mL", "tablets", "capsules", "units", "mcg"
- **Usage**: Display dosage, validate amounts

#### status
- **Type**: `text`
- **Purpose**: Current status of dose administration event
- **Constraints**: CHECK (status IN ('scheduled', 'administered', 'skipped', 'refused', 'missed', 'late', 'early'))
- **Default**: 'scheduled'
- **Index**: Indexed for status filtering
- **Values**:
  - **scheduled**: Dose scheduled but not yet due/administered
  - **administered**: Dose successfully administered
  - **skipped**: Dose intentionally skipped by staff
  - **refused**: Client refused to take dose
  - **missed**: Dose missed (past scheduled time, not given)
  - **late**: Dose administered late (> threshold after scheduled time)
  - **early**: Dose administered early (> threshold before scheduled time)

#### skip_reason / refusal_reason
- **Type**: `text`
- **Purpose**: Document reasons for non-administration
- **Usage**:
  - skip_reason: Clinical reason staff skipped dose (e.g., "client sleeping", "NPO for procedure")
  - refusal_reason: Reason client refused (e.g., "nausea", "feeling better")
- **Required When**: status='skipped' or status='refused'

#### administration_notes
- **Type**: `text`
- **Purpose**: Free-text clinical notes about administration
- **Usage**: Document special circumstances, observations, concerns

#### vitals_before / vitals_after
- **Type**: `jsonb`
- **Purpose**: Track vital signs for medications requiring monitoring
- **Default**: `{}`
- **See**: JSONB Columns section for schema
- **Usage**: Blood pressure monitoring (antihypertensives), heart rate (beta blockers), etc.

#### side_effects_observed
- **Type**: `text[]`
- **Purpose**: Array of observed side effects post-administration
- **Usage**: Safety monitoring, medication review
- **Example**: `['drowsiness', 'nausea', 'dizziness']`

#### adverse_reaction / adverse_reaction_details
- **Type**: `boolean` / `text`
- **Purpose**: Flag and document adverse reactions
- **Default**: false
- **Usage**: Safety alerts, regulatory reporting, medication review
- **Critical**: Triggers safety protocols if true

#### verified_by / verification_datetime
- **Type**: `uuid` / `timestamptz`
- **Purpose**: Double-check verification workflow
- **Usage**: High-alert medications, controlled substances, safety protocols
- **Workflow**: administered_by gives dose, verified_by confirms

#### metadata
- **Type**: `jsonb`
- **Purpose**: Extensible storage for additional data
- **Default**: `{}`

#### created_at / updated_at
- **Type**: `timestamptz`
- **Purpose**: Timestamp audit trail
- **Default**: `now()`

## Relationships

### Parent Relationships (Foreign Keys)

⚠️ **Implementation Note**: Foreign key constraints not explicitly defined but required by application logic.

- **organizations_projection** → `organization_id`
  - Multi-tenant isolation
  - **Expected behavior**: ON DELETE RESTRICT

- **medication_history** → `medication_history_id`
  - Each dose belongs to a prescription
  - **Expected behavior**: ON DELETE CASCADE (doses deleted if prescription deleted)

- **clients** → `client_id`
  - Denormalized for query performance
  - **Expected behavior**: ON DELETE RESTRICT

- **users** → `administered_by`, `verified_by`
  - Track administration and verification staff
  - **Expected behavior**: ON DELETE SET NULL (preserve dose record even if user deleted)

### Child Relationships (Referenced By)

None - this is a leaf table in the clinical operations hierarchy.

### Many-to-Many Relationships

None.

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```

### Secondary Indexes

#### idx_dosage_info_organization
```sql
CREATE INDEX IF NOT EXISTS idx_dosage_info_organization ON dosage_info(organization_id);
```
- **Purpose**: Multi-tenant queries
- **Used By**: RLS enforcement, organization reports

#### idx_dosage_info_medication_history
```sql
CREATE INDEX IF NOT EXISTS idx_dosage_info_medication_history ON dosage_info(medication_history_id);
```
- **Purpose**: Prescription dose history
- **Used By**: Compliance calculation, prescription review
- **Typical Query**: `SELECT * FROM dosage_info WHERE medication_history_id = ?`

#### idx_dosage_info_client
```sql
CREATE INDEX IF NOT EXISTS idx_dosage_info_client ON dosage_info(client_id);
```
- **Purpose**: Client medication administration record (MAR)
- **Used By**: MAR display, client medication review
- **Critical**: High-frequency query pattern
- **Typical Query**: `SELECT * FROM dosage_info WHERE client_id = ? ORDER BY scheduled_datetime DESC`

#### idx_dosage_info_scheduled_datetime
```sql
CREATE INDEX IF NOT EXISTS idx_dosage_info_scheduled_datetime ON dosage_info(scheduled_datetime);
```
- **Purpose**: Chronological queries
- **Used By**: Upcoming dose schedules, historical dose lookups
- **Typical Query**: `SELECT * FROM dosage_info WHERE scheduled_datetime BETWEEN ? AND ?`

#### idx_dosage_info_status
```sql
CREATE INDEX IF NOT EXISTS idx_dosage_info_status ON dosage_info(status);
```
- **Purpose**: Filter by dose status
- **Used By**: Scheduled doses, missed doses, refusals
- **Typical Query**: `SELECT * FROM dosage_info WHERE status = 'scheduled'`

#### idx_dosage_info_administered_by
```sql
CREATE INDEX IF NOT EXISTS idx_dosage_info_administered_by ON dosage_info(administered_by);
```
- **Purpose**: Staff administration tracking
- **Used By**: Staff performance reports, workload analysis
- **Typical Query**: `SELECT * FROM dosage_info WHERE administered_by = ?`

## RLS Policies

⚠️ **CRITICAL IMPLEMENTATION GAP**: Row-Level Security is **ENABLED** on this table but **NO POLICIES ARE DEFINED**.

### Current State

```sql
ALTER TABLE dosage_info ENABLE ROW LEVEL SECURITY;
```

**Impact**: Table will **DENY ALL ACCESS** by default.

### Required Policies (Not Yet Implemented)

#### Recommended SELECT Policy

```sql
CREATE POLICY "dosage_info_select_policy"
  ON dosage_info FOR SELECT
  USING (
    is_super_admin(get_current_user_id()) OR
    organization_id = (auth.jwt()->>'org_id')::uuid
  );
```

#### Recommended INSERT Policy

```sql
CREATE POLICY "dosage_info_insert_policy"
  ON dosage_info FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
    )
  );
```

#### Recommended UPDATE Policy

```sql
CREATE POLICY "dosage_info_update_policy"
  ON dosage_info FOR UPDATE
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
```

**Note**: Allow updates by administrator or staff who administered

## Triggers

No triggers currently defined for this table.

**Recommended**: Consider adding triggers for:
- Automatic `updated_at` timestamp updates
- Domain event emission (DoseAdministered, DoseRefused, AdverseReactionReported)
- Compliance percentage calculation in medication_history
- Inventory quantity updates in medication_history
- Adverse reaction alerts

## Constraints

### Check Constraints

#### status_check
```sql
CHECK (status IN ('scheduled', 'administered', 'skipped', 'refused', 'missed', 'late', 'early'))
```
- **Purpose**: Ensure valid status values

### Unique Constraints

None currently defined.

**Recommendation**: Consider preventing duplicate scheduled doses:
```sql
UNIQUE (medication_history_id, scheduled_datetime);
```

### Foreign Key Constraints

⚠️ **Not explicitly defined in SQL** - should be added:

```sql
ALTER TABLE dosage_info
  ADD CONSTRAINT fk_dosage_info_organization
  FOREIGN KEY (organization_id)
  REFERENCES organizations_projection(id)
  ON DELETE RESTRICT;

ALTER TABLE dosage_info
  ADD CONSTRAINT fk_dosage_info_medication_history
  FOREIGN KEY (medication_history_id)
  REFERENCES medication_history(id)
  ON DELETE CASCADE;

ALTER TABLE dosage_info
  ADD CONSTRAINT fk_dosage_info_client
  FOREIGN KEY (client_id)
  REFERENCES clients(id)
  ON DELETE RESTRICT;

ALTER TABLE dosage_info
  ADD CONSTRAINT fk_dosage_info_administered_by
  FOREIGN KEY (administered_by)
  REFERENCES users(id)
  ON DELETE SET NULL;

ALTER TABLE dosage_info
  ADD CONSTRAINT fk_dosage_info_verified_by
  FOREIGN KEY (verified_by)
  REFERENCES users(id)
  ON DELETE SET NULL;
```

## Usage Examples

### Schedule Dose

```sql
INSERT INTO dosage_info (
  organization_id,
  medication_history_id,
  client_id,
  scheduled_datetime,
  scheduled_amount,
  unit,
  status
) VALUES (
  '123e4567-e89b-12d3-a456-426614174000'::uuid,
  'prescription-uuid',
  'client-uuid',
  '2024-01-15 08:00:00+00'::timestamptz,
  500,
  'mg',
  'scheduled'
) RETURNING *;
```

### Administer Dose

```sql
UPDATE dosage_info
SET
  status = 'administered',
  administered_datetime = now(),
  administered_by = auth.uid(),
  administered_amount = scheduled_amount,
  administration_notes = 'Client tolerated well, no immediate side effects',
  updated_at = now()
WHERE id = 'dose-uuid'
  AND status = 'scheduled';
```

### Record Refusal

```sql
UPDATE dosage_info
SET
  status = 'refused',
  refusal_reason = 'Client experiencing nausea, refuses oral medications',
  administration_notes = 'Notified prescriber, client resting comfortably',
  updated_at = now()
WHERE id = 'dose-uuid'
  AND status = 'scheduled';
```

### Record Adverse Reaction

```sql
UPDATE dosage_info
SET
  adverse_reaction = true,
  adverse_reaction_details = 'Allergic reaction: hives, itching, difficulty breathing. Administered epinephrine, called 911.',
  side_effects_observed = ARRAY['hives', 'itching', 'difficulty breathing'],
  administration_notes = 'EMERGENCY: Severe allergic reaction. EMS called. Client stable.',
  updated_at = now()
WHERE id = 'dose-uuid';
```

### Client MAR (Medication Administration Record)

```sql
SELECT
  d.scheduled_datetime,
  d.administered_datetime,
  m.name as medication_name,
  d.scheduled_amount || ' ' || d.unit as dosage,
  d.status,
  d.administered_by,
  u.email as administered_by_name,
  d.administration_notes,
  d.side_effects_observed
FROM dosage_info d
JOIN medication_history mh ON d.medication_history_id = mh.id
JOIN medications m ON mh.medication_id = m.id
LEFT JOIN users u ON d.administered_by = u.id
WHERE d.client_id = 'client-uuid'
  AND d.organization_id = (auth.jwt()->>'org_id')::uuid
  AND d.scheduled_datetime >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY d.scheduled_datetime DESC;
```

### Upcoming Scheduled Doses

```sql
SELECT
  c.first_name || ' ' || c.last_name as client_name,
  m.name as medication_name,
  d.scheduled_datetime,
  d.scheduled_amount || ' ' || d.unit as dosage,
  mh.route,
  m.is_controlled,
  m.is_high_alert
FROM dosage_info d
JOIN medication_history mh ON d.medication_history_id = mh.id
JOIN medications m ON mh.medication_id = m.id
JOIN clients c ON d.client_id = c.id
WHERE d.organization_id = (auth.jwt()->>'org_id')::uuid
  AND d.status = 'scheduled'
  AND d.scheduled_datetime BETWEEN now() AND now() + INTERVAL '4 hours'
ORDER BY d.scheduled_datetime;
```

### Missed Doses Report

```sql
SELECT
  c.first_name || ' ' || c.last_name as client_name,
  m.name as medication_name,
  d.scheduled_datetime,
  d.scheduled_amount || ' ' || d.unit as dosage,
  now() - d.scheduled_datetime as time_overdue
FROM dosage_info d
JOIN medication_history mh ON d.medication_history_id = mh.id
JOIN medications m ON mh.medication_id = m.id
JOIN clients c ON d.client_id = c.id
WHERE d.organization_id = (auth.jwt()->>'org_id')::uuid
  AND d.status = 'scheduled'
  AND d.scheduled_datetime < now() - INTERVAL '1 hour'
ORDER BY d.scheduled_datetime;
```

### Refusals Report

```sql
SELECT
  c.first_name || ' ' || c.last_name as client_name,
  m.name as medication_name,
  d.scheduled_datetime,
  d.refusal_reason,
  d.administration_notes,
  COUNT(*) OVER (PARTITION BY d.client_id, d.medication_history_id) as refusal_count
FROM dosage_info d
JOIN medication_history mh ON d.medication_history_id = mh.id
JOIN medications m ON mh.medication_id = m.id
JOIN clients c ON d.client_id = c.id
WHERE d.organization_id = (auth.jwt()->>'org_id')::uuid
  AND d.status = 'refused'
  AND d.scheduled_datetime >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY d.scheduled_datetime DESC;
```

### Compliance Calculation

```sql
SELECT
  c.first_name || ' ' || c.last_name as client_name,
  m.name as medication_name,
  COUNT(*) FILTER (WHERE d.status = 'administered') as doses_given,
  COUNT(*) FILTER (WHERE d.status = 'scheduled' AND d.scheduled_datetime < now()) as doses_missed,
  COUNT(*) as total_scheduled,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE d.status = 'administered') /
    NULLIF(COUNT(*) FILTER (WHERE d.scheduled_datetime < now()), 0),
    1
  ) as compliance_percentage
FROM dosage_info d
JOIN medication_history mh ON d.medication_history_id = mh.id
JOIN medications m ON mh.medication_id = m.id
JOIN clients c ON d.client_id = c.id
WHERE d.organization_id = (auth.jwt()->>'org_id')::uuid
  AND d.scheduled_datetime >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY c.id, c.first_name, c.last_name, m.id, m.name
ORDER BY compliance_percentage;
```

## Audit Trail

### Event Emission

⚠️ **Not yet implemented** - This table should participate in the CQRS event-driven architecture:

**Recommended Events**:
- `clinical.dose_administered` - When dose administered
- `clinical.dose_refused` - When dose refused
- `clinical.dose_skipped` - When dose skipped
- `safety.adverse_reaction_reported` - When adverse_reaction=true
- `compliance.dose_missed` - When scheduled dose becomes missed

**Event Data**: See AsyncAPI schema in `infrastructure/supabase/contracts/asyncapi/domains/clinical.yaml`

## JSONB Columns

### vitals_before / vitals_after

**Purpose**: Track vital signs before and after medication administration for medications requiring monitoring

**Schema**:
```typescript
interface VitalsSchema {
  bp_systolic?: number;      // Blood pressure systolic (mmHg)
  bp_diastolic?: number;     // Blood pressure diastolic (mmHg)
  heart_rate?: number;       // Heart rate (bpm)
  temperature?: number;      // Temperature (°F or °C)
  respiratory_rate?: number; // Respirations per minute
  oxygen_saturation?: number; // O2 saturation (%)
  blood_glucose?: number;    // Blood glucose (mg/dL)
  weight?: number;           // Weight (kg or lbs)
  pain_level?: number;       // Pain scale 0-10
  timestamp?: string;        // When vitals taken (ISO 8601)
}
```

**Example Value**:
```json
{
  "bp_systolic": 120,
  "bp_diastolic": 80,
  "heart_rate": 72,
  "temperature": 98.6,
  "oxygen_saturation": 98,
  "timestamp": "2024-01-15T08:00:00Z"
}
```

**Usage Examples**:
- Antihypertensive medications: Monitor BP before/after
- Beta blockers: Monitor heart rate
- Insulin: Monitor blood glucose
- Analgesics: Monitor pain level

**Querying**:
```sql
-- Find doses with high blood pressure readings
SELECT
  d.id,
  d.scheduled_datetime,
  d.vitals_before->>'bp_systolic' as bp_systolic,
  d.vitals_before->>'bp_diastolic' as bp_diastolic
FROM dosage_info d
WHERE d.organization_id = 'org-uuid'
  AND (d.vitals_before->>'bp_systolic')::int > 140
  AND d.administered_datetime IS NOT NULL;
```

### metadata

**Purpose**: Extensible storage for additional structured data

**Example Value**:
```json
{
  "barcode_scanned": true,
  "witness_id": "user-uuid",
  "admin_method": "oral",
  "special_instructions_followed": true
}
```

## Migration History

### Initial Creation
- **Migration**: `infrastructure/supabase/sql/02-tables/dosage_info/table.sql`
- **Purpose**: Initial table creation for medication administration tracking
- **Features**:
  - Comprehensive dose status tracking
  - Vitals monitoring integration
  - Adverse reaction reporting
  - Verification workflow support

### Schema Changes

None yet applied.

## Performance Considerations

### Query Performance

**Expected Row Count**:
- Per prescription: 30-365 doses (depending on duration)
- Per client: 1,000-10,000 doses (lifetime)
- Per organization: 100,000-1,000,000 doses
- Platform total: 10,000,000+ doses

**Growth Rate**: Rapid - multiple doses per client per day

**Hot Paths**:
1. Upcoming scheduled doses (SELECT by status='scheduled', scheduled_datetime)
2. Client MAR (SELECT by client_id, recent dates)
3. Staff administered doses (SELECT by administered_by)
4. Compliance calculation (aggregations by medication_history_id, status)

**Optimization Strategies**:
- Consider composite index: `(client_id, scheduled_datetime)` for MAR queries
- Consider partial index: `WHERE status = 'scheduled' AND scheduled_datetime > now()` for upcoming doses
- Partition table by date if growth exceeds 10M rows
- Archive old doses (> 1 year) to separate table

### Index Strategy

**Current Indexes**: 6 indexes provide good coverage
**Recommendations**:
- Monitor composite index candidates based on query patterns
- Consider time-based partitioning for long-term scalability

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: **RESTRICTED** (Protected Health Information - PHI)
- **PII/PHI**: YES - Complete medication administration history
- **Compliance**: **HIPAA**, **state nursing regulations**

### Access Control

⚠️ **CRITICAL**: RLS policies **MUST BE IMPLEMENTED** before production use.

### Medication Administration Safety

**Double-Check Workflow**:
- High-alert medications should require `verified_by` to be populated
- Controlled substances should require additional verification
- Document verification process in administration_notes

**Adverse Reaction Protocol**:
- Set adverse_reaction=true triggers safety alerts
- Immediate notification to prescriber and supervisor
- Consider automatic hold on future doses

## Troubleshooting

### Common Issues

#### Missing Scheduled Doses
**Symptom**: Doses not appearing in upcoming schedule
**Diagnosis**: Check if doses were created
```sql
SELECT COUNT(*), MIN(scheduled_datetime), MAX(scheduled_datetime)
FROM dosage_info
WHERE medication_history_id = 'prescription-uuid';
```

#### Doses Marked as Missed
**Symptom**: Many doses automatically becoming 'missed'
**Solution**: Check dose scheduling system - may be creating doses too far in advance

#### Performance Issues with MAR
**Symptom**: Slow client MAR queries
**Solution**: Add composite index on (client_id, scheduled_datetime)
```sql
CREATE INDEX idx_dosage_info_client_scheduled
  ON dosage_info(client_id, scheduled_datetime DESC);
```

## Related Documentation

- [medication_history](./medication_history.md) - Parent prescription table
- [clients](./clients.md) - Client reference
- [medications](./medications.md) - Medication catalog
- [users](./users.md) - Administration and verification staff
- [Event Sourcing](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern

## See Also

- **SQL Files**:
  - Table: `infrastructure/supabase/sql/02-tables/dosage_info/table.sql`
  - Indexes: `infrastructure/supabase/sql/02-tables/dosage_info/indexes/`
  - RLS: `infrastructure/supabase/sql/06-rls/enable_rls_all_tables.sql`
- **AsyncAPI Contracts**: `infrastructure/supabase/contracts/asyncapi/domains/clinical.yaml` (to be created)
- **Database Functions**: Authorization functions in `infrastructure/supabase/sql/03-functions/`

---

**Last Updated**: 2025-01-12
**Applies To**: Database schema v1.0
**Status**: current
**Critical Gap**: RLS policies must be implemented before production use
