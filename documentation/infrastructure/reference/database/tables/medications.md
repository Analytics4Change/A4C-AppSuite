---
status: current
last_updated: 2025-01-13
---

# medications

## Overview

The `medications` table stores a comprehensive medication catalog with drug information, classification, regulatory flags, and RxNorm integration. This is a reference data table used by clinical operations for medication prescribing, tracking, and safety checks within a multi-tenant environment. Each organization maintains its own formulary of approved medications.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key - unique identifier for each medication |
| organization_id | uuid | NO | - | Foreign key to organizations (multi-tenant isolation) |
| name | text | NO | - | Medication display name (brand or generic) |
| generic_name | text | YES | - | Generic (non-proprietary) medication name |
| brand_names | text[] | YES | - | Array of brand/trade names |
| rxnorm_cui | text | YES | - | RxNorm Concept Unique Identifier for standardization |
| ndc_codes | text[] | YES | - | National Drug Code(s) for this medication |
| category_broad | text | YES | - | Broad therapeutic category |
| category_specific | text | YES | - | Specific therapeutic subcategory |
| drug_class | text | YES | - | Pharmacological class |
| is_psychotropic | boolean | YES | false | True if medication affects mental function |
| is_controlled | boolean | YES | false | True if DEA controlled substance |
| controlled_substance_schedule | text | YES | - | DEA schedule (I, II, III, IV, V) |
| is_narcotic | boolean | YES | false | True if opioid/narcotic medication |
| requires_monitoring | boolean | YES | false | True if requires therapeutic drug monitoring |
| is_high_alert | boolean | YES | false | True if ISMP high-alert medication |
| active_ingredients | jsonb | YES | '[]' | Array of active ingredients with strengths |
| available_forms | text[] | YES | - | Available dosage forms (tablet, capsule, etc.) |
| available_strengths | text[] | YES | - | Available strength options |
| manufacturer | text | YES | - | Manufacturer name |
| warnings | text[] | YES | - | Array of medication warnings |
| black_box_warning | text | YES | - | FDA black box warning text (if applicable) |
| metadata | jsonb | YES | '{}' | Additional structured metadata |
| is_active | boolean | YES | true | True if medication is active in catalog |
| is_formulary | boolean | YES | true | True if medication is on organization's formulary |
| created_by | uuid | YES | - | User ID who created the record |
| updated_by | uuid | YES | - | User ID who last updated the record |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record last update timestamp |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each medication in the catalog
- **Generation**: Automatically generated via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY
- **Usage**: Referenced by medication_history for prescriptions

#### organization_id
- **Type**: `uuid`
- **Purpose**: Multi-tenant isolation - identifies which organization this medication belongs to
- **Foreign Key**: References `organizations_projection(id)` (not explicitly enforced)
- **Constraints**: NOT NULL
- **RLS**: Critical for tenant isolation - organizations maintain their own formularies
- **Note**: **RLS policies not yet implemented** (see Security Considerations section)

#### name
- **Type**: `text`
- **Purpose**: Primary display name for the medication
- **Constraints**: NOT NULL
- **Index**: Indexed for fast name searches
- **Usage**: UI displays, medication selection dropdowns, prescriptions
- **Format**: Can be brand name (e.g., "Tylenol") or generic (e.g., "Acetaminophen")

#### generic_name
- **Type**: `text`
- **Purpose**: Generic (non-proprietary) medication name
- **Index**: Indexed for searches by generic name
- **Usage**: Formulary management, generic substitution, reporting
- **Example**: "acetaminophen" for brand "Tylenol"

#### brand_names
- **Type**: `text[]`
- **Purpose**: Array of brand/trade names for this medication
- **Usage**: Search by brand name, display multiple brand equivalents
- **Example**: `['Tylenol', 'Panadol', 'Excedrin']`

#### rxnorm_cui
- **Type**: `text`
- **Purpose**: RxNorm Concept Unique Identifier for medication standardization
- **Index**: Indexed for RxNorm-based lookups
- **Usage**: Integration with national medication databases, interoperability
- **Example**: "1049621" for Acetaminophen 500mg oral tablet
- **Reference**: [RxNorm Browser](https://rxnav.nlm.nih.gov/RxNormAPIs.html)

#### ndc_codes
- **Type**: `text[]`
- **Purpose**: National Drug Code(s) assigned by FDA
- **Usage**: Billing, inventory management, regulatory reporting
- **Format**: 11-digit code (5-4-2 format): `["12345-678-90"]`

#### category_broad / category_specific
- **Type**: `text`
- **Purpose**: Hierarchical therapeutic categorization
- **Example**:
  - category_broad: "Analgesics"
  - category_specific: "Non-opioid Analgesics"

#### drug_class
- **Type**: `text`
- **Purpose**: Pharmacological class of the medication
- **Usage**: Clinical decision support, drug interaction checking
- **Example**: "NSAID", "Beta Blocker", "SSRI", "Benzodiazepine"

#### is_psychotropic
- **Type**: `boolean`
- **Purpose**: Flags medications that affect mental/cognitive function
- **Default**: false
- **Usage**: Regulatory reporting, monitoring requirements, consent tracking
- **Regulatory**: May require additional documentation in certain care settings

#### is_controlled
- **Type**: `boolean`
- **Purpose**: Flags DEA-controlled substances
- **Default**: false
- **Index**: Indexed for filtering controlled substances
- **Usage**: Inventory tracking, regulatory reporting, prescription monitoring
- **Related**: See `controlled_substance_schedule` for DEA schedule

#### controlled_substance_schedule
- **Type**: `text`
- **Purpose**: DEA controlled substance schedule classification
- **Values**: "I", "II", "III", "IV", "V" or NULL
- **Usage**: Regulatory compliance, prescription monitoring programs (PDMP)
- **Note**: Schedule I substances are illegal and should not appear in formulary

#### is_narcotic
- **Type**: `boolean`
- **Purpose**: Flags opioid/narcotic medications
- **Default**: false
- **Usage**: Opioid prescribing monitoring, abuse prevention programs

#### requires_monitoring
- **Type**: `boolean`
- **Purpose**: Flags medications requiring therapeutic drug monitoring (TDM)
- **Default**: false
- **Usage**: Schedule lab tests, monitor therapeutic levels
- **Examples**: Lithium, Warfarin, Digoxin, Phenytoin

#### is_high_alert
- **Type**: `boolean`
- **Purpose**: Flags ISMP high-alert medications with increased risk of harm
- **Default**: false
- **Usage**: Enhanced safety checks, double-check protocols, alerts
- **Examples**: Insulin, Heparin, Chemotherapy agents
- **Reference**: [ISMP High-Alert Medications](https://www.ismp.org/recommendations/high-alert-medications)

#### active_ingredients
- **Type**: `jsonb`
- **Purpose**: Structured array of active pharmaceutical ingredients with strengths
- **Default**: `[]`
- **See**: JSONB Columns section for detailed schema

#### available_forms
- **Type**: `text[]`
- **Purpose**: Available dosage forms for this medication
- **Example**: `['tablet', 'capsule', 'oral solution', 'extended-release tablet']`

#### available_strengths
- **Type**: `text[]`
- **Purpose**: Available strength options for this medication
- **Example**: `['5mg', '10mg', '20mg', '40mg']`

#### manufacturer
- **Type**: `text`
- **Purpose**: Pharmaceutical manufacturer name
- **Usage**: Supply chain, quality tracking, recall management

#### warnings
- **Type**: `text[]`
- **Purpose**: Array of medication warnings and precautions
- **Usage**: Display in prescribing UI, patient education materials
- **Example**: `['May cause drowsiness', 'Avoid alcohol', 'Take with food']`

#### black_box_warning
- **Type**: `text`
- **Purpose**: FDA-mandated black box warning text
- **Usage**: Display prominently in prescribing UI, require acknowledgment
- **Critical**: Highest level of FDA warning - indicates serious safety concerns
- **Example**: "Increased risk of suicidal thinking and behavior in children and adolescents"

#### metadata
- **Type**: `jsonb`
- **Purpose**: Extensible storage for additional structured data
- **Default**: `{}`
- **Usage**: Custom fields, integration data, extended attributes

#### is_active
- **Type**: `boolean`
- **Purpose**: Indicates if medication is active in catalog
- **Default**: true
- **Index**: Indexed for filtering active medications
- **Usage**: Soft delete mechanism - inactive medications not shown in selection UI

#### is_formulary
- **Type**: `boolean`
- **Purpose**: Indicates if medication is on organization's approved formulary
- **Default**: true
- **Usage**: Formulary management, preferred medication lists, cost control

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
  - Each medication record belongs to exactly one organization
  - Organizations maintain their own formularies
  - **Expected behavior**: ON DELETE RESTRICT (cannot delete org with medications)

### Child Relationships (Referenced By)

- **medication_history** ← `medication_id`
  - One-to-many relationship
  - Tracks prescriptions of this medication to clients
  - Cascade behavior: Should restrict deletion if active prescriptions exist

### Many-to-Many Relationships

None currently defined.

**Potential Future Relationships**:
- Medication interactions (self-referential many-to-many)
- Medication-allergy cross-references
- Medication-condition contraindications

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by medication ID
- **Performance**: O(log n) lookups
- **Usage**: Direct medication retrieval, foreign key joins

### Secondary Indexes

#### idx_medications_organization
```sql
CREATE INDEX IF NOT EXISTS idx_medications_organization ON medications(organization_id);
```
- **Purpose**: Filtered queries by organization
- **Used By**: Multi-tenant queries, formulary management, RLS enforcement
- **Performance**: Critical for tenant isolation performance
- **Typical Query**: `SELECT * FROM medications WHERE organization_id = ?`

#### idx_medications_name
```sql
CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);
```
- **Purpose**: Fast medication name searches
- **Used By**: Medication selection UI, autocomplete, search
- **Performance**: Supports pattern matching with ILIKE
- **Typical Query**: `SELECT * FROM medications WHERE name ILIKE 'Acet%'`

#### idx_medications_generic_name
```sql
CREATE INDEX IF NOT EXISTS idx_medications_generic_name ON medications(generic_name);
```
- **Purpose**: Search by generic name
- **Used By**: Generic substitution logic, formulary searches
- **Typical Query**: `SELECT * FROM medications WHERE generic_name = 'acetaminophen'`

#### idx_medications_rxnorm
```sql
CREATE INDEX IF NOT EXISTS idx_medications_rxnorm ON medications(rxnorm_cui);
```
- **Purpose**: RxNorm-based lookups and integration
- **Used By**: National drug database integration, interoperability
- **Typical Query**: `SELECT * FROM medications WHERE rxnorm_cui = '1049621'`

#### idx_medications_is_active
```sql
CREATE INDEX IF NOT EXISTS idx_medications_is_active ON medications(is_active);
```
- **Purpose**: Filter active medications
- **Used By**: Medication selection UI (exclude inactive), reporting
- **Performance**: Supports efficient `WHERE is_active = true` queries

#### idx_medications_is_controlled
```sql
CREATE INDEX IF NOT EXISTS idx_medications_is_controlled ON medications(is_controlled);
```
- **Purpose**: Filter controlled substances
- **Used By**: Regulatory reporting, controlled substance monitoring
- **Typical Query**: `SELECT * FROM medications WHERE is_controlled = true`

## RLS Policies

⚠️ **CRITICAL IMPLEMENTATION GAP**: Row-Level Security is **ENABLED** on this table but **NO POLICIES ARE DEFINED**.

### Current State

```sql
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
```

**Impact**: With RLS enabled but no policies, the table will **DENY ALL ACCESS** by default, even to authenticated users.

### Required Policies (Not Yet Implemented)

The following policies **MUST** be implemented for the table to function:

#### Recommended SELECT Policy

```sql
CREATE POLICY "medications_select_policy"
  ON medications FOR SELECT
  USING (
    is_super_admin(get_current_user_id()) OR
    organization_id = (auth.jwt()->>'org_id')::uuid
  );
```

**Purpose**: Control which medication records users can view

**Logic**:
- Super admins can view all medications across all organizations
- Regular users can only view medications in their organization's formulary
- Organization ID extracted from JWT custom claims

#### Recommended INSERT Policy

```sql
CREATE POLICY "medications_insert_policy"
  ON medications FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      is_org_admin(get_current_user_id(), organization_id)
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );
```

**Purpose**: Control who can add medications to formulary

**Logic**: Allow insertions if user is super admin or org admin with medication management permission

#### Recommended UPDATE Policy

```sql
CREATE POLICY "medications_update_policy"
  ON medications FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );
```

**Purpose**: Control who can update medication records

#### Recommended DELETE Policy

```sql
CREATE POLICY "medications_delete_policy"
  ON medications FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );
```

**Purpose**: Control who can delete medications (should be rare - prefer is_active=false)

## Triggers

No triggers currently defined for this table.

**Recommended**: Consider adding triggers for:
- Automatic `updated_at` timestamp updates
- Domain event emission (MedicationAdded, MedicationUpdated, MedicationDiscontinued)
- Audit log entries
- Validation of controlled substance schedule consistency (is_controlled must be true if schedule is set)

## Constraints

### Check Constraints

None currently defined.

**Recommendations**:

#### Controlled Substance Schedule Consistency
```sql
ALTER TABLE medications
  ADD CONSTRAINT check_controlled_schedule_consistency
  CHECK (
    (is_controlled = false AND controlled_substance_schedule IS NULL)
    OR
    (is_controlled = true)
  );
```
- **Purpose**: If controlled_substance_schedule is set, is_controlled must be true

#### Valid Schedule Values
```sql
ALTER TABLE medications
  ADD CONSTRAINT check_valid_schedule
  CHECK (
    controlled_substance_schedule IS NULL
    OR controlled_substance_schedule IN ('II', 'III', 'IV', 'V')
  );
```
- **Note**: Schedule I excluded (illegal substances)

### Unique Constraints

None currently defined.

**Recommendation**: Consider adding:
```sql
UNIQUE (organization_id, rxnorm_cui) WHERE rxnorm_cui IS NOT NULL;
```
- Prevents duplicate RxNorm entries within an organization
- Allows NULL rxnorm_cui (not all medications may have RxNorm codes)

### Foreign Key Constraints

⚠️ **Not explicitly defined in SQL** - should be added:

```sql
ALTER TABLE medications
  ADD CONSTRAINT fk_medications_organization
  FOREIGN KEY (organization_id)
  REFERENCES organizations_projection(id)
  ON DELETE RESTRICT;
```

## Usage Examples

### Add Medication to Formulary

```sql
INSERT INTO medications (
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
  is_high_alert,
  active_ingredients,
  available_forms,
  available_strengths,
  warnings,
  is_active,
  is_formulary,
  created_by
) VALUES (
  '123e4567-e89b-12d3-a456-426614174000'::uuid,
  'Acetaminophen',
  'acetaminophen',
  ARRAY['Tylenol', 'Panadol'],
  '161', -- RxNorm CUI for acetaminophen
  ARRAY['50580-488-01'],
  'Analgesics',
  'Non-Opioid Analgesics',
  'Analgesic, Antipyretic',
  false,
  false,
  NULL,
  false,
  '[{"name": "Acetaminophen", "strength": "500", "unit": "mg"}]'::jsonb,
  ARRAY['tablet', 'capsule', 'oral solution'],
  ARRAY['325mg', '500mg', '650mg'],
  ARRAY['Do not exceed 4000mg per day', 'May cause liver damage if overdosed'],
  true,
  true,
  auth.uid()
) RETURNING *;
```

### Search Medications by Name

```sql
-- Autocomplete search for medication selection UI
SELECT
  id,
  name,
  generic_name,
  is_controlled,
  is_high_alert,
  available_strengths
FROM medications
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND is_active = true
  AND is_formulary = true
  AND (
    name ILIKE 'acet%'
    OR generic_name ILIKE 'acet%'
    OR EXISTS (
      SELECT 1 FROM unnest(brand_names) AS brand
      WHERE brand ILIKE 'acet%'
    )
  )
ORDER BY name
LIMIT 20;
```

**Performance**: Uses idx_medications_name index

### Find Controlled Substances

```sql
-- Regulatory report: All controlled substances in formulary
SELECT
  name,
  generic_name,
  controlled_substance_schedule,
  is_narcotic,
  rxnorm_cui
FROM medications
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND is_controlled = true
  AND is_active = true
ORDER BY
  controlled_substance_schedule,
  name;
```

**Performance**: Uses idx_medications_is_controlled index

### Find High-Alert Medications

```sql
-- Safety check: List all high-alert medications
SELECT
  name,
  generic_name,
  warnings,
  black_box_warning
FROM medications
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND is_high_alert = true
  AND is_active = true
ORDER BY name;
```

### Lookup by RxNorm CUI

```sql
-- External integration: Lookup medication by RxNorm code
SELECT *
FROM medications
WHERE rxnorm_cui = '1049621' -- Acetaminophen 500mg oral tablet
  AND organization_id = (auth.jwt()->>'org_id')::uuid
  AND is_active = true;
```

**Performance**: Uses idx_medications_rxnorm index

### Formulary Management

```sql
-- Remove medication from formulary (soft delete)
UPDATE medications
SET
  is_formulary = false,
  updated_at = now(),
  updated_by = auth.uid()
WHERE id = '123e4567-e89b-12d3-a456-426614174001'::uuid;

-- Deactivate medication completely
UPDATE medications
SET
  is_active = false,
  updated_at = now(),
  updated_by = auth.uid()
WHERE id = '123e4567-e89b-12d3-a456-426614174001'::uuid;
```

### Common Queries

#### Medications by Category

```sql
SELECT
  category_specific,
  COUNT(*) as medication_count
FROM medications
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND is_active = true
  AND is_formulary = true
GROUP BY category_specific
ORDER BY medication_count DESC;
```

#### Find Medications with Black Box Warnings

```sql
SELECT
  name,
  generic_name,
  black_box_warning,
  is_high_alert
FROM medications
WHERE organization_id = (auth.jwt()->>'org_id')::uuid
  AND black_box_warning IS NOT NULL
  AND is_active = true
ORDER BY name;
```

## Audit Trail

### Event Emission

⚠️ **Not yet implemented** - This table should participate in the CQRS event-driven architecture:

**Recommended Events**:
- `formulary.medication_added` - When new medication added to formulary
- `formulary.medication_updated` - When medication record modified
- `formulary.medication_removed_from_formulary` - When is_formulary set to false
- `formulary.medication_deactivated` - When is_active set to false
- `safety.high_alert_medication_prescribed` - When high-alert medication prescribed (from medication_history)

**Event Data**: See AsyncAPI schema in `infrastructure/supabase/contracts/asyncapi/domains/formulary.yaml` (once created)

### Audit Log Integration

Not currently implemented. Recommended:
- All changes logged to `audit_log` table via trigger
- Track: user_id, timestamp, operation, old_values, new_values
- Immutable audit trail for regulatory compliance

## JSONB Columns

### active_ingredients

**Purpose**: Structured array of active pharmaceutical ingredients with strengths and units

**Schema**:
```typescript
interface ActiveIngredient {
  name: string;        // Ingredient name (e.g., "Acetaminophen")
  strength: string;    // Strength value (e.g., "500")
  unit: string;        // Unit of measurement (e.g., "mg", "mcg", "units")
}

type ActiveIngredientsSchema = ActiveIngredient[];
```

**Example Value**:
```json
[
  {
    "name": "Acetaminophen",
    "strength": "500",
    "unit": "mg"
  }
]
```

**Multi-Ingredient Example** (combination drug):
```json
[
  {
    "name": "Hydrocodone",
    "strength": "5",
    "unit": "mg"
  },
  {
    "name": "Acetaminophen",
    "strength": "325",
    "unit": "mg"
  }
]
```

**Querying**:
```sql
-- Find all medications containing specific ingredient
SELECT
  name,
  active_ingredients
FROM medications
WHERE active_ingredients @> '[{"name": "Acetaminophen"}]'::jsonb
  AND organization_id = (auth.jwt()->>'org_id')::uuid;
```

**Indexing**: Consider GIN index for ingredient searches:
```sql
CREATE INDEX IF NOT EXISTS idx_medications_active_ingredients_gin
  ON medications USING GIN (active_ingredients);
```

### metadata

**Purpose**: Extensible storage for additional structured data

**Schema**: No fixed schema - application-specific

**Usage Examples**:
- External system identifiers
- Custom medication attributes
- Integration data
- Feature flags

**Example Value**:
```json
{
  "external_id": "MED-12345",
  "fdb_med_id": "456789",
  "preferred_alternative": "generic-equivalent-uuid",
  "cost_tier": 1,
  "requires_prior_auth": false
}
```

## Migration History

### Initial Creation
- **Migration**: `infrastructure/supabase/sql/02-tables/medications/table.sql`
- **Purpose**: Initial table creation with comprehensive medication catalog schema
- **Features**:
  - Multi-tenant isolation via organization_id
  - RxNorm and NDC code integration
  - Comprehensive safety flags (controlled, psychotropic, high-alert)
  - JSONB active_ingredients for flexible drug composition
  - Array columns for multi-value attributes
  - Formulary management (is_formulary flag)

### Schema Changes

None yet applied.

## Performance Considerations

### Query Performance

**Expected Row Count**:
- Small organizations: 100-500 medications
- Medium organizations: 500-2,000 medications
- Large organizations: 2,000-10,000 medications
- Platform total: 100,000+ medications (across all organizations)

**Growth Rate**: Slow - formularies change infrequently

**Hot Paths** (most common query patterns):
1. Medication autocomplete search (SELECT with ILIKE on name)
2. List formulary medications (SELECT with is_formulary = true)
3. Lookup by RxNorm CUI (external integration)
4. Controlled substance reports (SELECT with is_controlled = true)

**Optimization Strategies**:
- Existing indexes cover primary query patterns well
- Consider partial index for formulary: `CREATE INDEX idx_medications_formulary ON medications(organization_id, name) WHERE is_active = true AND is_formulary = true;`
- Monitor array column queries (brand_names) - may need GIN index
- Cache frequently-accessed medication details in application layer

### Index Strategy

**Current Indexes**:
- Primary key (id) - Required, O(log n) lookups
- organization_id - Critical for multi-tenancy
- name - Medication search autocomplete
- generic_name - Generic substitution lookups
- rxnorm_cui - External integration
- is_active - Filter active medications
- is_controlled - Regulatory reporting

**Trade-offs**:
- Write performance: 7 indexes means inserts/updates maintain 7 B-trees
- Read performance: Excellent coverage for common queries
- Storage: Indexes add ~30-40% storage overhead

**Recommendations**:
- Consider GIN index on active_ingredients JSONB for ingredient-based searches
- Consider GIN index on brand_names array if brand name searches are common
- Monitor query patterns to identify missing indexes

**Maintenance**:
- VACUUM ANALYZE medications weekly
- Medication catalog changes infrequently - index bloat should be minimal

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: **INTERNAL** (Reference data, not patient-specific)
- **PII/PHI**: NO - Contains drug information, not patient information
- **Compliance**: Formulary accuracy important for patient safety

**Sensitive Fields**:
- None - this is reference data

### Access Control

⚠️ **CRITICAL**: RLS policies **MUST BE IMPLEMENTED** before this table can be used in production.

**Required Access Controls**:
- ✅ RLS enabled on table
- ❌ **SELECT policy NOT IMPLEMENTED**
- ❌ **INSERT policy NOT IMPLEMENTED**
- ❌ **UPDATE policy NOT IMPLEMENTED**
- ❌ **DELETE policy NOT IMPLEMENTED**

**Recommended Access Tiers**:
1. **Super Admin**: Full access to all organizations' medications
2. **Organization Admin**: Full access to own organization's formulary
3. **Formulary Manager**: Create/update medications in own organization
4. **Clinician**: Read-only access to own organization's formulary
5. **Viewer**: Read-only access to own organization's formulary

**See**: RLS Policies section for detailed policy recommendations

### Encryption

- **At-rest encryption**: Handled by PostgreSQL/Supabase (AES-256)
- **In-transit encryption**: TLS/SSL connections enforced
- **Column-level encryption**: Not required (reference data, not sensitive)

### Data Integrity

**Critical for Patient Safety**:
- Medication information must be accurate
- Controlled substance flags must be correct
- Black box warnings must be prominent
- High-alert medication flags must be enforced

**Recommendations**:
- Implement approval workflow for formulary changes
- Require dual verification for high-alert medication additions
- Audit trail for all formulary modifications
- Regular reconciliation with external drug databases (FDB, RxNorm)

## Troubleshooting

### Common Issues

#### RLS Policy Errors

**Symptom**: `permission denied for table medications`

**Cause**: RLS is enabled but policies are not yet implemented

**Solution**: See RLS Policies section for recommended policies

#### Duplicate Medications

**Symptom**: Multiple entries for same medication in formulary

**Cause**: No unique constraint on rxnorm_cui

**Solution**: Add unique constraint and deduplicate
```sql
-- Find duplicates
SELECT rxnorm_cui, COUNT(*)
FROM medications
WHERE organization_id = 'org-uuid'
GROUP BY rxnorm_cui
HAVING COUNT(*) > 1;

-- After manual deduplication, add constraint
ALTER TABLE medications
  ADD CONSTRAINT unique_rxnorm_per_org
  UNIQUE (organization_id, rxnorm_cui)
  WHERE rxnorm_cui IS NOT NULL;
```

#### Slow Autocomplete Searches

**Symptom**: Medication name searches taking > 100ms

**Diagnosis**:
```sql
EXPLAIN ANALYZE
SELECT name, generic_name
FROM medications
WHERE organization_id = 'org-uuid'
  AND is_active = true
  AND name ILIKE 'Acet%'
ORDER BY name
LIMIT 20;
```

**Solution**: Ensure idx_medications_name index exists and is being used

### Performance Issues

#### Array Column Searches Slow

**Symptom**: Searches in brand_names array are slow

**Solution**: Add GIN index
```sql
CREATE INDEX IF NOT EXISTS idx_medications_brand_names_gin
  ON medications USING GIN (brand_names);
```

#### JSONB Ingredient Searches Slow

**Symptom**: Queries on active_ingredients JSONB are slow

**Solution**: Add GIN index
```sql
CREATE INDEX IF NOT EXISTS idx_medications_active_ingredients_gin
  ON medications USING GIN (active_ingredients);
```

## Related Documentation

- [organizations_projection](./organizations_projection.md) - Parent organization table
- [users](./users.md) - User authentication and audit trail
- [clients](./clients.md) - Client allergy cross-reference
- [medication_history](./medication_history.md) - Child table for prescriptions (to be documented)
- [Schema Overview](../schema-overview.md) - Complete database schema and ER diagrams (to be created)
- [RLS Policies](../../guides/database/rls-policies.md) - Comprehensive RLS policy guide (to be created)
- [RxNorm Integration](../../guides/database/rxnorm-integration.md) - RxNorm integration guide (to be created)

## See Also

- **Related Tables**:
  - [organizations_projection](./organizations_projection.md) - Multi-tenant isolation
  - [users](./users.md) - Created by / updated by references
  - medication_history - Medication prescriptions (to be documented)
  - clients - Patient allergy checks
- **AsyncAPI Contracts**: `infrastructure/supabase/contracts/asyncapi/domains/formulary.yaml` (to be created)
- **Database Functions**: `is_super_admin()`, `is_org_admin()`, `user_has_permission()` (see `infrastructure/supabase/sql/03-functions/`)
- **SQL Files**:
  - Table: `infrastructure/supabase/sql/02-tables/medications/table.sql`
  - Indexes: `infrastructure/supabase/sql/02-tables/medications/indexes/`
  - RLS: `infrastructure/supabase/sql/06-rls/enable_rls_all_tables.sql`
- **External References**:
  - [RxNorm API](https://rxnav.nlm.nih.gov/RxNormAPIs.html) - National Library of Medicine
  - [FDA NDC Directory](https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory) - National Drug Codes
  - [ISMP High-Alert Medications](https://www.ismp.org/recommendations/high-alert-medications) - Institute for Safe Medication Practices

---

**Last Updated**: 2025-01-12
**Applies To**: Database schema v1.0
**Status**: current
**Critical Gap**: RLS policies must be implemented before production use
