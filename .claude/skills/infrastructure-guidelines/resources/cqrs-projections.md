# CQRS Projections: Event-Driven Read Models

## Overview

CQRS (Command Query Responsibility Segregation) projections are read-optimized views derived from domain events. In A4C-AppSuite, PostgreSQL triggers automatically update projection tables whenever new events are written to the `domain_events` table.

**Key Principle**: Projections are **derived state** - they can always be rebuilt from the event stream.

## Projection Table Design

### Design Patterns

**1. Denormalized for Query Performance**

Projections optimize for reads, not writes. Duplicate data to avoid expensive joins:

```sql
-- BAD: Normalized design requires joins
CREATE TABLE organizations_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE organization_members (
  org_id UUID REFERENCES organizations_projection(id),
  user_id UUID NOT NULL,
  -- many-to-many join table
);

-- GOOD: Denormalized for fast queries
CREATE TABLE organizations_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  member_count INTEGER DEFAULT 0,
  admin_count INTEGER DEFAULT 0,
  member_emails TEXT[], -- Array for fast lookups
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

**2. Include Computed Aggregates**

Pre-calculate expensive computations:

```sql
CREATE TABLE medication_usage_projection (
  medication_id UUID PRIMARY KEY,
  medication_name TEXT NOT NULL,
  total_prescriptions INTEGER DEFAULT 0,
  active_prescriptions INTEGER DEFAULT 0,
  total_patients INTEGER DEFAULT 0,
  last_prescribed_at TIMESTAMPTZ,
  avg_dosage_mg NUMERIC(10, 2),
  -- Computed in trigger, not at query time
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

**3. Store Relevant Metadata**

Include fields that support common queries:

```sql
CREATE TABLE user_invitations_projection (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  org_id UUID NOT NULL,
  inviter_user_id UUID NOT NULL,
  inviter_email TEXT NOT NULL, -- Denormalized for display
  role TEXT NOT NULL,
  status TEXT NOT NULL, -- 'pending', 'accepted', 'expired'
  invited_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  -- Indexes for common queries
  INDEX idx_invitations_email (email),
  INDEX idx_invitations_org_status (org_id, status),
  INDEX idx_invitations_expires (expires_at) WHERE status = 'pending'
);
```

**4. Multi-Tenant Isolation with RLS**

All projections must support RLS using `org_id`:

```sql
-- Enable RLS
ALTER TABLE organizations_projection ENABLE ROW LEVEL SECURITY;

-- Users can only see their own organization
CREATE POLICY org_isolation_policy ON organizations_projection
  FOR SELECT
  USING (
    id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
  );

-- Super admins can see all
CREATE POLICY super_admin_policy ON organizations_projection
  FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::json->>'user_role') = 'super_admin'
  );
```

## Trigger Implementation

### Basic Trigger Pattern

Triggers listen to `domain_events` table and update projections:

```sql
-- Trigger function
CREATE OR REPLACE FUNCTION update_organization_projection()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle different event types
  CASE NEW.event_type
    WHEN 'OrganizationCreated' THEN
      INSERT INTO organizations_projection (
        id,
        name,
        created_at,
        updated_at
      ) VALUES (
        NEW.aggregate_id,
        NEW.event_data->>'name',
        NEW.created_at,
        NEW.created_at
      )
      ON CONFLICT (id) DO NOTHING; -- Idempotent

    WHEN 'OrganizationUpdated' THEN
      UPDATE organizations_projection
      SET
        name = COALESCE(NEW.event_data->>'name', name),
        updated_at = NEW.created_at
      WHERE id = NEW.aggregate_id;

    WHEN 'OrganizationDeleted' THEN
      DELETE FROM organizations_projection
      WHERE id = NEW.aggregate_id;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
CREATE TRIGGER organization_projection_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.aggregate_type = 'Organization')
  EXECUTE FUNCTION update_organization_projection();
```

### Split Handler Pattern (Recommended)

Since January 2026, A4C uses **split handlers** instead of monolithic processors for better maintainability and independent validation:

```sql
-- Router (thin CASE dispatcher, ~50 lines)
CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'user.created' THEN PERFORM handle_user_created(p_event);
    WHEN 'user.phone.added' THEN PERFORM handle_user_phone_added(p_event);
    WHEN 'user.phone.updated' THEN PERFORM handle_user_phone_updated(p_event);
    -- ... one line per event type
    ELSE RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Handler (focused logic, 20-50 lines)
CREATE OR REPLACE FUNCTION handle_user_phone_added(p_event record)
RETURNS void AS $$
DECLARE
  v_phone_id UUID := (p_event.event_data->>'phone_id')::UUID;
BEGIN
  INSERT INTO user_phones (id, user_id, label, type, number, ...)
  VALUES (v_phone_id, ...)
  ON CONFLICT (id) DO NOTHING;  -- Idempotent
END;
$$ LANGUAGE plpgsql;
```

**Benefits of split handlers**:
- Adding new event = add handler + 1 CASE line (not replace 500+ line function)
- plpgsql_check validates each handler independently
- Bugs isolated to one event type
- Easier code review (diff shows only changed handler)

**See**: [event-handler-pattern.md](../../../../documentation/infrastructure/patterns/event-handler-pattern.md) for complete implementation guide.

### Idempotency with ON CONFLICT

**Critical**: Triggers must be idempotent to support event replay:

```sql
-- Idempotent insert
INSERT INTO users_projection (id, email, org_id, created_at, updated_at)
VALUES (
  NEW.aggregate_id,
  NEW.event_data->>'email',
  (NEW.event_data->>'org_id')::uuid,
  NEW.created_at,
  NEW.created_at
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  updated_at = EXCLUDED.updated_at
WHERE users_projection.updated_at < EXCLUDED.updated_at; -- Only update if newer
```

### Handling Aggregate Updates

Increment/decrement counters safely:

```sql
-- Increment member count when user joins
WHEN 'UserJoinedOrganization' THEN
  UPDATE organizations_projection
  SET
    member_count = member_count + 1,
    member_emails = array_append(member_emails, NEW.event_data->>'email'),
    updated_at = NEW.created_at
  WHERE id = (NEW.event_data->>'org_id')::uuid;

-- Decrement when user leaves
WHEN 'UserLeftOrganization' THEN
  UPDATE organizations_projection
  SET
    member_count = GREATEST(member_count - 1, 0), -- Never go negative
    member_emails = array_remove(member_emails, NEW.event_data->>'email'),
    updated_at = NEW.created_at
  WHERE id = (NEW.event_data->>'org_id')::uuid;
```

### Multi-Table Updates

Single event can update multiple projections:

```sql
CREATE OR REPLACE FUNCTION update_invitation_projections()
RETURNS TRIGGER AS $$
BEGIN
  CASE NEW.event_type
    WHEN 'InvitationAccepted' THEN
      -- Update invitation projection
      UPDATE user_invitations_projection
      SET
        status = 'accepted',
        accepted_at = NEW.created_at,
        updated_at = NEW.created_at
      WHERE id = NEW.aggregate_id;

      -- Update organization projection (new member)
      UPDATE organizations_projection
      SET
        member_count = member_count + 1,
        updated_at = NEW.created_at
      WHERE id = (NEW.event_data->>'org_id')::uuid;

      -- Update user projection (role assignment)
      INSERT INTO users_projection (
        id,
        email,
        org_id,
        role,
        created_at,
        updated_at
      ) VALUES (
        (NEW.event_data->>'user_id')::uuid,
        NEW.event_data->>'email',
        (NEW.event_data->>'org_id')::uuid,
        NEW.event_data->>'role',
        NEW.created_at,
        NEW.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        role = EXCLUDED.role,
        updated_at = EXCLUDED.updated_at;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Event Ordering and Idempotency

### Challenge: Out-of-Order Events

Events may arrive out of order during replay or concurrent workflows:

```sql
-- Use timestamps to ensure correct ordering
UPDATE organizations_projection
SET
  name = NEW.event_data->>'name',
  updated_at = NEW.created_at
WHERE
  id = NEW.aggregate_id
  AND updated_at < NEW.created_at; -- Only if event is newer
```

### Handling Duplicate Events

Use `ON CONFLICT` to ignore duplicates:

```sql
-- If event_id is unique, detect duplicates
CREATE TABLE processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION check_duplicate_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Try to insert event_id
  INSERT INTO processed_events (event_id)
  VALUES (NEW.id)
  ON CONFLICT (event_id) DO NOTHING;

  -- If already processed, skip projection update
  IF NOT FOUND THEN
    RETURN NULL; -- Skip trigger
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Event Versioning

Support schema changes by checking event version:

```sql
-- Handle multiple event versions in trigger
event_version := COALESCE((NEW.event_data->>'version')::integer, 1);
IF event_version = 1 THEN
  -- Old schema: {email, org_id}
ELSIF event_version = 2 THEN
  -- New schema: {email, org_id, phone, preferences}
END IF;
```

## Projection Rebuilding

Rebuild to fix trigger bugs, add fields, or recover from corruption. Strategy: create new table, replay events, swap tables.

```sql
-- 1. Create new version
CREATE TABLE organizations_projection_v2 (id UUID PRIMARY KEY, ...);
ALTER TABLE organizations_projection_v2 DISABLE TRIGGER ALL;

-- 2. Replay all events in order
DO $$
DECLARE event RECORD;
BEGIN
  FOR event IN SELECT * FROM domain_events WHERE aggregate_type = 'Organization' ORDER BY created_at
  LOOP
    -- Apply event logic to _v2 table
  END LOOP;
END $$;

ALTER TABLE organizations_projection_v2 ENABLE TRIGGER ALL;

-- 3. Swap tables
BEGIN;
  ALTER TABLE organizations_projection RENAME TO organizations_projection_old;
  ALTER TABLE organizations_projection_v2 RENAME TO organizations_projection;
COMMIT;
```

## Query Optimization

### Index Strategy

Create indexes for common query patterns:

```sql
-- Composite indexes for multi-column queries
CREATE INDEX idx_users_org_role ON users_projection (org_id, role);
CREATE INDEX idx_invitations_org_status ON user_invitations_projection (org_id, status);

-- Partial indexes for filtered queries
CREATE INDEX idx_pending_invitations ON user_invitations_projection (expires_at)
  WHERE status = 'pending';

-- GIN indexes for array/JSONB queries
CREATE INDEX idx_org_member_emails ON organizations_projection USING GIN (member_emails);
```

### Materialized Views for Complex Queries

For expensive aggregations, use materialized views:

```sql
CREATE MATERIALIZED VIEW medication_statistics AS
SELECT
  m.medication_name,
  COUNT(DISTINCT p.patient_id) AS unique_patients,
  AVG(p.dosage_mg) AS avg_dosage,
  SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active_count
FROM medications_projection m
JOIN prescriptions_projection p ON p.medication_id = m.id
GROUP BY m.medication_name;

-- Refresh periodically (manual or scheduled)
REFRESH MATERIALIZED VIEW CONCURRENTLY medication_statistics;
```

## Testing Projections

```sql
-- Verify trigger logic: insert test event, check projection, clean up
INSERT INTO domain_events (id, event_type, aggregate_type, aggregate_id, event_data, metadata)
VALUES (gen_random_uuid(), 'OrganizationCreated', 'Organization', 'test-org-id'::uuid, '{"name": "Test Org"}'::jsonb, '{}'::jsonb);
SELECT * FROM organizations_projection WHERE id = 'test-org-id'::uuid;
DELETE FROM domain_events WHERE aggregate_id = 'test-org-id'::uuid;

-- Validate idempotency: insert same event twice, verify count isn't doubled
INSERT INTO domain_events (...) VALUES (...); -- Insert twice
SELECT member_count FROM organizations_projection WHERE id = 'test-org-id'::uuid; -- Should be 1, not 2
```

## Troubleshooting

```sql
-- Check projection sync: compare event counts with projection count
SELECT COUNT(*) FILTER (WHERE event_type = 'OrganizationCreated') AS created,
       COUNT(*) FILTER (WHERE event_type = 'OrganizationDeleted') AS deleted,
       (SELECT COUNT(*) FROM organizations_projection) AS projection_count
FROM domain_events WHERE aggregate_type = 'Organization';

-- Find missing projections: IDs in events but not in projection
SELECT DISTINCT aggregate_id FROM domain_events
WHERE aggregate_type = 'Organization' AND event_type = 'OrganizationCreated'
EXCEPT SELECT id FROM organizations_projection;

-- Debug triggers: add RAISE NOTICE logging
RAISE NOTICE 'Processing event: % for aggregate: %', NEW.event_type, NEW.aggregate_id;
```

## Cross-References

- **Event Emission**: See `temporal-workflow-guidelines/resources/event-emission.md` for how Temporal activities emit events
- **AsyncAPI Contracts**: See `resources/asyncapi-contracts.md` for event schema definitions
- **Migrations**: See `resources/supabase-migrations.md` for creating projection tables
- **Testing**: See `infrastructure/supabase/local-tests/` for idempotency testing scripts
