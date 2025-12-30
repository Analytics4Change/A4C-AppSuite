---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection storing rich business profile data for top-level organizations (providers and provider_partners). Contains JSONB columns for addresses and type-specific profile data. Not used for organization units.

**When to read**:
- Building organization profile management UI
- Understanding provider vs partner profile differences
- Querying business metadata for organizations
- Working with organization onboarding data

**Prerequisites**: [organizations_projection](./organizations_projection.md)

**Key topics**: `business-profile`, `provider`, `provider-partner`, `jsonb`, `organization-metadata`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# organization_business_profiles_projection

## Overview

CQRS projection table storing rich business profile data for top-level organizations only (providers and provider_partners). This table extends `organizations_projection` with detailed business metadata including structured addresses and type-specific profile information. Organization units do NOT have business profiles.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| organization_id | uuid | NO | - | Primary key, foreign key to organizations_projection |
| organization_type | text | NO | - | 'provider' or 'provider_partner' |
| mailing_address | jsonb | YES | - | Mailing address JSONB |
| physical_address | jsonb | YES | - | Physical location JSONB |
| provider_profile | jsonb | YES | - | Provider-specific metadata |
| partner_profile | jsonb | YES | - | Partner-specific metadata |
| created_at | timestamptz | NO | - | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record update timestamp |

### Column Details

#### organization_type

- **Type**: `text` with CHECK constraint
- **Purpose**: Determines which profile column is populated
- **Values**:
  - `provider` - Healthcare organizations (uses `provider_profile`)
  - `provider_partner` - VARs, families, courts (uses `partner_profile`)
- **Constraint**: `CHECK (organization_type IN ('provider', 'provider_partner'))`

#### mailing_address / physical_address

- **Type**: `jsonb`
- **Purpose**: Structured address data
- **Schema**:
```typescript
interface AddressSchema {
  street: string;
  street2?: string;
  city: string;
  state: string;
  zip_code: string;
  country?: string;
}
```
- **Example**:
```json
{
  "street": "123 Healthcare Blvd",
  "city": "Boston",
  "state": "MA",
  "zip_code": "02101",
  "country": "USA"
}
```

#### provider_profile

- **Type**: `jsonb`
- **Purpose**: Healthcare provider-specific metadata
- **Schema**:
```typescript
interface ProviderProfile {
  npi?: string;           // National Provider Identifier
  tax_id?: string;        // Tax ID / EIN
  license_number?: string;
  license_state?: string;
  specialty?: string;
  bed_count?: number;
  accreditations?: string[];
}
```
- **Usage**: Only populated when `organization_type = 'provider'`

#### partner_profile

- **Type**: `jsonb`
- **Purpose**: Partner organization-specific metadata
- **Schema**:
```typescript
interface PartnerProfile {
  partner_type: 'var' | 'family' | 'court' | 'other';
  business_type?: string;
  contract_start_date?: string;
  contract_end_date?: string;
  service_regions?: string[];
  referral_code?: string;
}
```
- **Usage**: Only populated when `organization_type = 'provider_partner'`

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - One-to-one relationship
  - Primary key is also foreign key
  - Only top-level organizations have profiles

## Constraints

### Primary Key

```sql
PRIMARY KEY (organization_id)
```

### Check Constraint

```sql
CHECK (organization_type IN ('provider', 'provider_partner'))
```

Ensures only valid organization types have business profiles.

## Event Processing

This table is updated by `process_organization_event()` in response to:

- **`organization.business_profile.created`**: Inserts profile row
- **`organization.business_profile.updated`**: Updates profile data
- **`organization.business_profile.address.updated`**: Updates address columns

## Usage Examples

### Query Provider Profile

```sql
SELECT
  o.name,
  o.display_name,
  bp.provider_profile->>'npi' AS npi,
  bp.provider_profile->>'specialty' AS specialty,
  bp.physical_address
FROM organizations_projection o
JOIN organization_business_profiles_projection bp
  ON o.id = bp.organization_id
WHERE bp.organization_type = 'provider'
  AND o.id = 'org-uuid-here';
```

### Query VAR Partner Profile

```sql
SELECT
  o.name,
  bp.partner_profile->>'partner_type' AS partner_type,
  bp.partner_profile->'service_regions' AS regions
FROM organizations_projection o
JOIN organization_business_profiles_projection bp
  ON o.id = bp.organization_id
WHERE bp.organization_type = 'provider_partner'
  AND bp.partner_profile->>'partner_type' = 'var';
```

### Update Physical Address

```sql
UPDATE organization_business_profiles_projection
SET
  physical_address = '{"street": "456 New Location", "city": "Cambridge", "state": "MA", "zip_code": "02139"}'::jsonb,
  updated_at = now()
WHERE organization_id = 'org-uuid-here';
```

## Querying with Address Data

### Organizations by State

```sql
SELECT o.name, bp.physical_address->>'city' AS city
FROM organizations_projection o
JOIN organization_business_profiles_projection bp
  ON o.id = bp.organization_id
WHERE bp.physical_address->>'state' = 'MA';
```

## Related Documentation

- [organizations_projection](./organizations_projection.md) - Main organization table
- [Provider Partners Architecture](../../../architecture/data/provider-partners-architecture.md) - Partner types
- [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md) - CQRS pattern
