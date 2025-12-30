---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Schema registry catalog for all valid event types in the platform. Documents JSON schemas for validating event_data, processing rules, allowed roles, and projection mappings. Defines contract between Temporal workflows (producers) and PostgreSQL triggers (consumers).

**When to read**:
- Registering a new domain event type
- Validating event_data schema before emitting events
- Understanding which events affect which projections
- Building event documentation or API catalogs

**Prerequisites**: [domain_events](./domain_events.md), [Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md)

**Key topics**: `event-types`, `schema-registry`, `json-schema`, `event-validation`, `projection-mapping`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# event_types

## Overview

The `event_types` table is a **catalog of all valid event types** in the A4C-AppSuite platform. It serves as a registry documenting what events can occur in the system, their schema definitions, processing rules, and access controls.

**Key Characteristics**:
- **Schema Registry**: Defines JSON Schema for validating event_data and event_metadata
- **Documentation**: Human-readable descriptions and examples for each event type
- **Access Control**: Specifies which roles can emit each event type
- **Projection Mapping**: Links events to the tables they affect
- **Validation**: Ensures only registered event types can be stored in `domain_events`

**Architecture Role**: This table is the "schema registry" for the event-driven architecture - it defines the contract between event producers (Temporal workflows) and event consumers (projection triggers).

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key - unique event type identifier |
| event_type | text | NO | - | Unique event type name (e.g., 'client.admitted') |
| stream_type | text | NO | - | Entity type this event applies to ('client', 'medication', etc.) |
| event_schema | jsonb | NO | - | JSON Schema for validating event_data |
| metadata_schema | jsonb | YES | - | JSON Schema for validating event_metadata |
| description | text | NO | - | Human-readable description of what this event represents |
| example_data | jsonb | YES | - | Example event_data payload |
| example_metadata | jsonb | YES | - | Example event_metadata payload |
| is_active | boolean | NO | true | Whether this event type is currently active |
| requires_approval | boolean | NO | false | Whether emitting this event requires approval workflow |
| allowed_roles | text[] | YES | - | Array of roles permitted to emit this event |
| projection_function | text | YES | - | Name of PostgreSQL function that processes this event |
| projection_tables | text[] | YES | - | Array of table names this event affects |
| created_at | timestamptz | NO | now() | When this event type was registered |
| created_by | uuid | YES | - | User who registered this event type |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Unique identifier for each event type registration
- **Generation**: Automatically generated via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY

#### event_type
- **Type**: `text`
- **Purpose**: Unique name identifying the event type
- **Format**: `domain.action` (e.g., 'client.admitted') or `domain.subdomain.action`
- **Constraints**: UNIQUE, NOT NULL
- **Examples**:
  - `client.registered`
  - `client.admitted`
  - `medication.prescribed`
  - `medication.administered`
  - `organization.bootstrap.initiated`
- **Pattern**: Must match domain_events.event_type constraint: `^[a-z_]+(\.[a-z_]+)+$`

#### stream_type
- **Type**: `text`
- **Purpose**: Categorizes which entity type this event affects
- **Values**: 'client', 'medication', 'medication_history', 'dosage', 'user', 'organization'
- **Usage**: Route events to correct projection handlers
- **Example**: 'client.admitted' has stream_type='client'

#### event_schema
- **Type**: `jsonb`
- **Purpose**: JSON Schema defining the structure of event_data
- **Format**: Standard JSON Schema (draft-07 compatible)
- **Validation**: Used to validate event_data before inserting into domain_events
- **Example**:
  ```json
  {
    "type": "object",
    "required": ["client_id", "admission_date", "organization_id"],
    "properties": {
      "client_id": {"type": "string", "format": "uuid"},
      "admission_date": {"type": "string", "format": "date-time"},
      "organization_id": {"type": "string", "format": "uuid"},
      "facility_id": {"type": "string", "format": "uuid"},
      "reason": {"type": "string"}
    }
  }
  ```

#### metadata_schema
- **Type**: `jsonb`
- **Purpose**: JSON Schema defining the structure of event_metadata
- **Nullable**: YES (optional - defaults to common metadata fields)
- **Usage**: Validate event context (user_id, correlation_id, etc.)

#### description
- **Type**: `text`
- **Purpose**: Human-readable description of what this event represents
- **Constraints**: NOT NULL
- **Example**: "New client registered in system"
- **Audience**: Developers, documentation, event catalogs

#### example_data
- **Type**: `jsonb`
- **Purpose**: Sample event_data payload showing typical usage
- **Nullable**: YES
- **Usage**: Documentation, testing, code generation
- **Example**:
  ```json
  {
    "client_id": "123e4567-e89b-12d3-a456-426614174000",
    "admission_date": "2025-11-13T10:00:00Z",
    "organization_id": "org-uuid",
    "facility_id": "facility-uuid",
    "reason": "Voluntary admission"
  }
  ```

#### example_metadata
- **Type**: `jsonb`
- **Purpose**: Sample event_metadata payload showing typical context
- **Nullable**: YES
- **Example**:
  ```json
  {
    "user_id": "staff-uuid",
    "reason": "Family requested admission",
    "correlation_id": "admission-workflow-uuid"
  }
  ```

#### is_active
- **Type**: `boolean`
- **Purpose**: Whether this event type is currently active and can be emitted
- **Default**: `true`
- **Usage**: Disable deprecated event types without deleting (maintains history)
- **Pattern**: Set to `false` when deprecating an event type

#### requires_approval
- **Type**: `boolean`
- **Purpose**: Whether emitting this event requires an approval workflow
- **Default**: `false`
- **Usage**: High-impact events (delete client, discharge, high-cost medications)
- **Future**: Integrate with approval workflow system

#### allowed_roles
- **Type**: `text[]` (array)
- **Purpose**: Roles permitted to emit this event
- **Nullable**: YES (NULL = all authenticated users)
- **Examples**:
  - `['provider_admin', 'clinician']` for 'client.admitted'
  - `['pharmacy_staff']` for 'medication.prescribed'
  - `['super_admin']` for 'organization.deleted'
- **Enforcement**: Application-level (not database-level)

#### projection_function
- **Type**: `text`
- **Purpose**: Name of PostgreSQL function that processes this event
- **Nullable**: YES
- **Pattern**: `process_event_<event_type>`
- **Example**: `process_event_client_admitted`
- **Usage**: Direct projection dispatch (alternative to trigger-based routing)

#### projection_tables
- **Type**: `text[]` (array)
- **Purpose**: List of tables this event affects (creates/updates/deletes rows)
- **Nullable**: YES
- **Examples**:
  - `['clients']` for 'client.admitted'
  - `['medication_history', 'dosage_info']` for 'medication.prescribed'
  - `['users', 'audit_log']` for 'user.organization_switched'
- **Usage**: Documentation, dependency analysis, projection monitoring

#### created_at
- **Type**: `timestamptz`
- **Purpose**: When this event type was registered in the system
- **Default**: `now()`
- **Usage**: Track schema evolution over time

#### created_by
- **Type**: `uuid`
- **Purpose**: User who registered this event type
- **Nullable**: YES
- **Future**: Foreign key to `users` table (deferred to avoid circular dependency)

## Relationships

### Parent Relationships (Foreign Keys)

- **users** → `created_by` (deferred - FK not yet added to avoid circular dependency)

### Child Relationships (Referenced By)

- **domain_events** → `event_type` (conceptual reference - not enforced by FK)
  - Each domain_events.event_type must exist in this table
  - event_schema used to validate domain_events.event_data

## Indexes

### Primary Index
```sql
PRIMARY KEY (id)
```
- **Purpose**: Fast lookups by event type ID
- **Performance**: O(log n)

### Unique Index on event_type
```sql
UNIQUE (event_type)
```
- **Purpose**: Enforce unique event type names
- **Performance**: O(log n) lookups by event_type name
- **Usage**: Validate event_type before inserting into domain_events

### idx_event_types_stream
```sql
CREATE INDEX idx_event_types_stream ON event_types(stream_type);
```
- **Purpose**: Filter event types by entity type
- **Used By**: Event routing, documentation generation
- **Example Query**:
  ```sql
  SELECT event_type, description
  FROM event_types
  WHERE stream_type = 'client';
  ```

### idx_event_types_active (Partial Index)
```sql
CREATE INDEX idx_event_types_active ON event_types(is_active)
WHERE is_active = true;
```
- **Purpose**: Quickly find active event types
- **Optimization**: Partial index only indexes active events
- **Usage**: Event validation, API documentation generation

## RLS Policies

### Current State

RLS policies are defined in `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql`:

```sql
-- Super admins can manage event type definitions
DROP POLICY IF EXISTS event_types_super_admin_all ON event_types;
CREATE POLICY event_types_super_admin_all
  ON event_types
  FOR ALL
  USING (is_super_admin(get_current_user_id()));

-- All authenticated users can view event type definitions (reference data)
DROP POLICY IF EXISTS event_types_authenticated_select ON event_types;
CREATE POLICY event_types_authenticated_select
  ON event_types
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);
```

**Access Levels**:
- ✅ Super admins: Full access (SELECT, INSERT, UPDATE, DELETE)
- ✅ Authenticated users: SELECT only (read event catalog)
- ❌ Anonymous users: No access

**Rationale**: Event types are reference data - all users need to see them, but only admins can modify.

## Seed Data

### Initial Event Types

The table is seeded with core event types during migration (`infrastructure/supabase/sql/01-events/002-event-types-table.sql`):

#### Client Events
- `client.registered` - New client registered in system
- `client.admitted` - Client admitted to facility
- `client.information_updated` - Client information modified
- `client.discharged` - Client discharged from facility

#### Medication Events
- `medication.added_to_formulary` - New medication added to formulary
- `medication.prescribed` - Medication prescribed to client
- `medication.administered` - Medication dose administered
- `medication.skipped` - Medication dose skipped
- `medication.discontinued` - Medication discontinued

#### User Events
- `user.synced_from_auth` - User synchronized from Supabase Auth
- `user.organization_switched` - User switched organization context

**Pattern**: Seed data uses `INSERT ... ON CONFLICT DO NOTHING` for idempotency.

## Usage Examples

### Register New Event Type

```sql
INSERT INTO event_types (
  event_type,
  stream_type,
  description,
  event_schema,
  projection_tables,
  allowed_roles
) VALUES (
  'client.medication_allergy_recorded',
  'client',
  'Medication allergy documented for client',
  '{
    "type": "object",
    "required": ["client_id", "allergen", "severity"],
    "properties": {
      "client_id": {"type": "string", "format": "uuid"},
      "allergen": {"type": "string"},
      "severity": {"type": "string", "enum": ["mild", "moderate", "severe", "life-threatening"]},
      "reaction": {"type": "string"},
      "documented_by": {"type": "string", "format": "uuid"}
    }
  }'::jsonb,
  ARRAY['clients'],
  ARRAY['clinician', 'provider_admin']
) RETURNING *;
```

### Lookup Event Schema

```sql
-- Get schema for validating client.admitted events
SELECT
  event_schema,
  example_data
FROM event_types
WHERE event_type = 'client.admitted';
```

**Usage**: Application validates event_data against event_schema before inserting into domain_events.

### List Events by Stream Type

```sql
-- Get all medication-related events
SELECT
  event_type,
  description,
  projection_tables,
  is_active
FROM event_types
WHERE stream_type = 'medication'
ORDER BY event_type;
```

### Find Events Affecting a Table

```sql
-- Find all events that update the clients table
SELECT
  event_type,
  description,
  stream_type
FROM event_types
WHERE 'clients' = ANY(projection_tables)
ORDER BY event_type;
```

**Usage**: Dependency analysis - know which events affect which tables.

### Deprecate Event Type

```sql
-- Deprecate old event type (don't delete - maintains history)
UPDATE event_types
SET is_active = false
WHERE event_type = 'client.old_event_name';
```

### Get Active Event Catalog

```sql
-- Generate API documentation of available events
SELECT
  event_type,
  stream_type,
  description,
  allowed_roles,
  requires_approval
FROM event_types
WHERE is_active = true
ORDER BY stream_type, event_type;
```

## Event Type Naming Conventions

### Format
- **Pattern**: `domain.action` or `domain.subdomain.action`
- **Domain**: Entity type (client, medication, user, organization)
- **Action**: Past tense verb (registered, admitted, prescribed, administered)

### Examples

**Good**:
- ✅ `client.registered` - Clear domain and action
- ✅ `medication.prescribed` - Past tense, specific
- ✅ `organization.bootstrap.completed` - Multi-level hierarchy

**Bad**:
- ❌ `registerClient` - Not event format (looks like function name)
- ❌ `client_registered` - Underscore instead of dot
- ❌ `Client.Registered` - Should be lowercase
- ❌ `client.register` - Present tense (should be past tense)

### Hierarchy Levels

- **Two levels** (most common): `client.admitted`
- **Three levels** (workflows/subdomains): `organization.bootstrap.initiated`
- **Avoid**: More than 3 levels (too complex)

## Schema Validation

### JSON Schema Features

The event_schema field supports standard JSON Schema (draft-07):

```json
{
  "type": "object",
  "required": ["client_id", "dosage", "frequency"],
  "properties": {
    "client_id": {
      "type": "string",
      "format": "uuid",
      "description": "Client receiving the medication"
    },
    "dosage": {
      "type": "number",
      "minimum": 0,
      "description": "Dosage amount"
    },
    "frequency": {
      "type": "string",
      "enum": ["once_daily", "twice_daily", "three_times_daily", "as_needed"],
      "description": "How often medication should be administered"
    },
    "notes": {
      "type": "string",
      "maxLength": 500,
      "description": "Additional prescriber notes"
    }
  },
  "additionalProperties": false
}
```

**Features Used**:
- `required`: Mandatory fields
- `type`: Data type validation
- `format`: UUID, date-time, email validation
- `enum`: Restrict to specific values
- `minimum`/`maximum`: Numeric constraints
- `maxLength`: String length limits
- `additionalProperties`: Prevent extra fields

## Triggers

No triggers currently defined on this table.

**Recommended**: Consider adding triggers for:
- Validate event_schema is valid JSON Schema (use JSON Schema validator)
- Auto-generate projection_function name if not provided
- Audit trail for event type registration/changes

## Migration History

### Initial Creation
- **Migration**: `infrastructure/supabase/sql/01-events/002-event-types-table.sql`
- **Purpose**: Create event types catalog with seed data
- **Features**:
  - Schema registry (event_schema, metadata_schema)
  - Role-based access control (allowed_roles)
  - Projection mapping (projection_tables, projection_function)
  - Documentation (description, examples)
  - Lifecycle management (is_active, requires_approval)

### Schema Changes

None yet applied.

## Performance Considerations

### Query Performance

**Expected Row Count**:
- Small deployment: 50-100 event types
- Medium deployment: 100-500 event types
- Large deployment: 500-1,000 event types

**Growth Rate**: Slow - only grows when new features/domains added

**Hot Paths**:
1. Lookup event_schema by event_type (validation before inserting domain_events)
2. List active event types (API documentation)
3. Find events by stream_type (event routing)

**Optimization**:
- Small table, fully cacheable in memory
- UNIQUE index on event_type provides O(log n) lookups
- Partial index on is_active=true for common queries

### Write Performance

**Characteristics**:
- Very low write volume (only on schema changes)
- Mostly SELECT queries
- Ideal candidate for aggressive caching

## Security Considerations

### Data Sensitivity

- **Sensitivity Level**: **PUBLIC** (reference data)
- **PII/PHI**: NO - contains schema definitions and metadata only
- **Compliance**: None - purely technical catalog

### Access Control

- ✅ RLS enabled
- ✅ SELECT policy for authenticated users (reference data)
- ✅ Full access policy for super_admin only

**Rationale**: Event schemas are technical documentation - all developers need to see them.

## Best Practices

### Event Schema Design

1. **Be explicit**: Use `required` array, avoid optional everything
2. **Validate strictly**: Use `format`, `enum`, `minimum`/`maximum` constraints
3. **Document fields**: Use `description` in schema properties
4. **Prevent extras**: Set `additionalProperties: false` to catch typos
5. **Version schemas**: Create new event_type instead of modifying existing

### Event Type Lifecycle

1. **Register first**: Add to `event_types` before emitting events
2. **Validate in application**: Check event_data against event_schema before INSERT
3. **Deprecate gracefully**: Set `is_active = false`, don't DELETE
4. **Document changes**: Update description when behavior changes

### Schema Evolution

1. **Additive changes**: Can add optional fields to event_schema
2. **Breaking changes**: Create new event_type (e.g., v2 suffix)
3. **Backward compatibility**: Existing events must still be valid
4. **Migration path**: Document how to migrate from old to new event_type

## Related Documentation

- **[domain_events](domain_events.md)** - Event store table using these schemas
- **[Event Sourcing Overview](../../../architecture/data/event-sourcing-overview.md)** - CQRS architecture
- **[Event-Driven Architecture](../../guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)** - Backend specification
- **[AsyncAPI Contracts](../../guides/supabase/contracts/)** - Event contract definitions
