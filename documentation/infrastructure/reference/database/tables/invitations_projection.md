---
status: current
last_updated: 2026-02-19
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: CQRS projection for user invitation tokens used in organization onboarding. Stores cryptographically secure tokens with expiration, multi-role assignment (via `roles` JSONB array), and status lifecycle (pending → accepted/expired). Events route to USER aggregate via `process_user_event()`. Edge Functions validate and accept invitations.

**When to read**:
- Implementing invitation workflows (Temporal activities)
- Building Edge Functions for invitation validation/acceptance
- Troubleshooting invitation token issues
- Understanding invitation status lifecycle

**Prerequisites**: [Edge Functions Deployment](../../../guides/supabase/edge-functions-deployment.md)

**Key topics**: `invitations`, `tokens`, `onboarding`, `edge-functions`, `status-lifecycle`, `multi-role-invitation`, `user-aggregate`

**Estimated read time**: 25 minutes
<!-- TL;DR-END -->

# invitations_projection

## Overview

The `invitations_projection` table is a **CQRS read model** that stores user invitation tokens and acceptance status for the organization onboarding workflow. When organizations invite new staff members, a Temporal workflow generates secure invitation links that are stored in this projection. Supabase Edge Functions validate invitation tokens and handle the acceptance flow. This table serves as the bridge between Temporal workflow orchestration and frontend user signup.

**Primary Use Case**: Organization staff onboarding, user invitation workflow tracking

**Data Sensitivity**: RESTRICTED (contains PII - email, names) + SECRET (invitation tokens)
**CQRS Role**: Read model projection (event-sourced)
**Multi-Tenancy**: Organization-scoped (belongs to specific organization)

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Primary key (internal record ID) |
| invitation_id | uuid | NO | - | UUID from domain event (aggregate ID) |
| organization_id | uuid | NO | - | Foreign key to organizations_projection |
| email | text | NO | - | Invitee email address |
| first_name | text | YES | NULL | Invitee first name (optional) |
| last_name | text | YES | NULL | Invitee last name (optional) |
| role | text | YES | NULL | Legacy: Single role name (deprecated, use `roles`) |
| roles | jsonb | YES | NULL | Multi-role assignment array (preferred) |
| token | text | NO | - | Cryptographically secure invitation token (URL-safe) |
| expires_at | timestamptz | NO | - | Invitation expiration (typically 7 days) |
| status | text | NO | 'pending' | Invitation lifecycle status |
| accepted_at | timestamptz | YES | NULL | When invitation was accepted |
| created_at | timestamptz | YES | now() | Record creation timestamp |
| updated_at | timestamptz | YES | now() | Record last update timestamp |
| tags | text[] | YES | '{}' | Development entity tracking tags |
| access_start_date | date | YES | NULL | First date user can access org (NULL = immediate) |
| access_expiration_date | date | YES | NULL | Date user's access expires (NULL = no expiration) |
| notification_preferences | jsonb | YES | NULL | Initial notification preferences for user |

### Column Details

#### id
- **Type**: `uuid`
- **Purpose**: Internal primary key (auto-generated)
- **Generation**: Automatically via `gen_random_uuid()`
- **Constraints**: PRIMARY KEY
- **Usage**: Internal database references (not exposed in API)

#### invitation_id
- **Type**: `uuid`
- **Purpose**: UUID from domain event (aggregate ID for event correlation)
- **Constraints**: UNIQUE, NOT NULL
- **Usage**: Links invitation to domain event stream
- **Event Correlation**: All events for this invitation use this aggregate_id

#### organization_id
- **Type**: `uuid`
- **Purpose**: Organization inviting the user
- **Constraints**: NOT NULL, FOREIGN KEY to `organizations_projection(id)`
- **Index**: `idx_invitations_projection_org_email` (composite with email)
- **Multi-Tenancy**: Isolates invitations by organization
- **Cascade**: ON DELETE CASCADE (if org deleted, invitations removed)

#### email
- **Type**: `text`
- **Purpose**: Invitee email address (used for Supabase Auth signup)
- **Constraints**: NOT NULL
- **Index**: `idx_invitations_projection_org_email` (composite with organization_id)
- **Validation**: Application-level email format validation
- **PII**: Contains personally identifiable information
- **Usage**: Edge Functions validate email matches invitation before signup

#### first_name / last_name
- **Type**: `text`
- **Purpose**: Pre-populate user profile after signup (optional)
- **Nullable**: YES
- **PII**: Contains personally identifiable information
- **Usage**: Personalize invitation email, reduce signup friction

#### role (DEPRECATED)
- **Type**: `text`
- **Purpose**: Legacy single role name (use `roles` array instead)
- **Constraints**: NULLABLE (was NOT NULL before 2026-01-05)
- **Values**: Role names from `roles_projection` (e.g., 'clinician', 'facility_admin')
- **Migration Note**: New invitations use `roles` JSONB array. Event processors support both formats for backward compatibility.
- **Deprecation**: This column is maintained for backward compatibility with bootstrap workflows. New Edge Function invitations use `roles` array.

#### roles
- **Type**: `jsonb`
- **Purpose**: Multi-role assignment array for user after invitation acceptance
- **Nullable**: YES (one of `role` or `roles` should be populated)
- **Format**: Array of objects with `role_id` and `role_name`:
  ```json
  [
    { "role_id": "uuid-or-null", "role_name": "provider_admin" },
    { "role_id": "uuid", "role_name": "Program Manager - Aspen" }
  ]
  ```
- **Usage**:
  - `role_id`: UUID of role from `roles_projection` (NULL for system roles resolved at acceptance)
  - `role_name`: Denormalized role name for display purposes
- **Event Processing**: When invitation is accepted, each role in the array generates a separate `user.role.assigned` event
- **Validation**: Application validates roles exist and user has permission to assign them

#### token
- **Type**: `text`
- **Purpose**: Cryptographically secure, URL-safe invitation token
- **Constraints**: UNIQUE, NOT NULL
- **Security**: 256-bit random token, base64-url encoded
- **Index**: `idx_invitations_projection_token` (BTREE) for fast Edge Function lookups
- **Generation**: Temporal workflow activity generates secure token
- **URL Format**: `https://app.example.com/accept-invitation?token=<token>`
- **Sensitivity**: SECRET - possession of token authorizes signup (must remain confidential)

#### expires_at
- **Type**: `timestamptz`
- **Purpose**: Invitation expiration timestamp
- **Constraints**: NOT NULL
- **Default Duration**: 7 days from creation
- **Usage**: Edge Functions check `expires_at > NOW()` before allowing acceptance
- **Cleanup**: Expired invitations marked as `'expired'` by scheduled job

#### status
- **Type**: `text`
- **Purpose**: Invitation lifecycle status
- **Constraints**: CHECK constraint enforces enum values
- **Valid Values**:
  - `'pending'` - Invitation sent, awaiting acceptance
  - `'accepted'` - User accepted invitation and signed up
  - `'expired'` - Invitation passed expires_at timestamp
  - `'deleted'` - Soft deleted by cleanup script (dev/test data)
- **Default**: `'pending'`
- **Index**: `idx_invitations_projection_status` (BTREE)
- **State Machine**:
  ```
  pending → accepted (user accepts invitation)
  pending → expired (expires_at passed)
  pending/expired → deleted (cleanup script for dev data)
  ```

#### accepted_at
- **Type**: `timestamptz`
- **Purpose**: Timestamp when user accepted invitation
- **Nullable**: YES (NULL until acceptance)
- **Usage**: Audit trail, conversion rate analysis
- **Update**: Set by Edge Function upon successful signup

#### created_at / updated_at
- **Type**: `timestamptz`
- **Purpose**: Record lifecycle timestamps
- **Default**: `now()`
- **Usage**: Audit trail, invitation age tracking

#### tags
- **Type**: `text[]` (array)
- **Purpose**: Development entity tracking for test data cleanup
- **Default**: `'{}'` (empty array)
- **Index**: `idx_invitations_projection_tags` (GIN) for array containment searches
- **Values**: `['development', 'test', 'mode:development']`
- **Usage**: Cleanup script identifies and deletes test invitations
- **Production**: Empty array for real invitations

## Relationships

### Parent Relationships (Foreign Keys)

- **organizations_projection** → `organization_id`
  - Each invitation belongs to exactly one organization
  - FOREIGN KEY constraint enforced
  - ON DELETE CASCADE - Organization deletion removes invitations
  - Multi-tenant isolation via organization_id

### Child Relationships (Referenced By)

**None** - This is a workflow tracking table

## Indexes

| Index Name | Type | Columns | Purpose | Notes |
|------------|------|---------|---------|-------|
| PRIMARY KEY | BTREE | id | Unique identification | Automatic |
| UNIQUE | BTREE | invitation_id | Event correlation | Aggregate ID uniqueness |
| UNIQUE | BTREE | token | Token lookup | Edge Function critical path |
| idx_invitations_projection_token | BTREE | token | Fast token validation | Duplicate of UNIQUE (explicit for clarity) |
| idx_invitations_projection_org_email | BTREE | (organization_id, email) | Find invitations for org/email | Prevent duplicate invitations |
| idx_invitations_projection_status | BTREE | status | Filter by status | Find pending/expired invitations |
| idx_invitations_projection_tags | GIN | tags | Development cleanup | Array containment queries |

### Index Usage Patterns

**Token Validation (Critical Path - Edge Function)**:
```sql
SELECT
  invitation_id,
  organization_id,
  email,
  first_name,
  last_name,
  role,
  expires_at,
  status
FROM invitations_projection
WHERE token = '<url-token>';
-- Uses: UNIQUE index on token (or idx_invitations_projection_token)
-- Expected: < 1ms (critical for user experience)
```

**Find Pending Invitations for Organization**:
```sql
SELECT
  email,
  role,
  created_at,
  expires_at
FROM invitations_projection
WHERE organization_id = '<org-uuid>'
  AND status = 'pending'
ORDER BY created_at DESC;
-- Uses: idx_invitations_projection_org_email + idx_invitations_projection_status
```

**Check for Duplicate Invitation**:
```sql
SELECT EXISTS (
  SELECT 1
  FROM invitations_projection
  WHERE organization_id = '<org-uuid>'
    AND email = 'user@example.com'
    AND status = 'pending'
) AS invitation_exists;
-- Uses: idx_invitations_projection_org_email
```

**Development Cleanup**:
```sql
DELETE FROM invitations_projection
WHERE tags && ARRAY['development', 'test'];
-- Uses: idx_invitations_projection_tags (GIN array index)
```

## Row-Level Security (RLS)

**Status**: ⚠️ ENABLED but **COMMENTED-OUT POLICY** - PARTIAL IMPLEMENTATION

### Current State
```sql
ALTER TABLE invitations_projection ENABLE ROW LEVEL SECURITY;

-- Policy EXISTS but is COMMENTED OUT:
-- CREATE POLICY "Users can view their organization's invitations"
-- ON invitations_projection FOR SELECT
-- USING (organization_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::UUID);
```

**Result**: Edge Functions use **service role** (bypasses RLS), but application queries would be blocked.

### Recommended Policies (TO IMPLEMENT)

**Policy 1: Super Admin Full Access**
```sql
CREATE POLICY invitations_super_admin_all
  ON invitations_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));
```

**Policy 2: Organization Admin Invitation Management**
```sql
CREATE POLICY invitations_org_admin_all
  ON invitations_projection FOR ALL
  USING (
    has_org_admin_permission()
    AND organization_id = get_current_org_id()
  );
```
- Uses `has_org_admin_permission()` JWT-claims-based function (no DB query)

**Policy 3: Edge Functions (Service Role Bypass)**
```sql
-- Edge Functions already bypass RLS via service role
-- No additional policy needed
```

### Security Note
Edge Functions (`validate-invitation`, `accept-invitation`) use **service role key** which bypasses RLS. This is intentional - invitations must be accessible before user has authenticated.

## Constraints

### Check Constraint: status Enum
```sql
CONSTRAINT chk_invitation_status CHECK (status IN ('pending', 'accepted', 'expired', 'deleted'))
```
- **Purpose**: Enforces valid status values
- **State Machine**: Application logic manages state transitions

### Foreign Key Constraint
```sql
FOREIGN KEY (organization_id) REFERENCES organizations_projection(id)
```
- **Purpose**: Ensures invitation belongs to valid organization
- **Cascade**: ON DELETE CASCADE (organization deletion removes invitations)

### Unique Constraints
```sql
UNIQUE (invitation_id)
UNIQUE (token)
```
- **Purpose**: Prevents duplicate aggregate IDs and tokens
- **Security**: Token uniqueness critical for invitation security

## CQRS Event Sourcing

### Source Events

**Event Type**: `user.invited`

**Aggregate**: USER (stream_type: `user`)

**Stream ID**: `invitation_id` (user_id doesn't exist until acceptance)

**Emitted By**:
- `GenerateInvitationsActivity` (Temporal workflow - organization bootstrap)
- `invite-user` Edge Function (manual user invitation)

**Event Payload (Multi-Role Format - Current)**:
```typescript
{
  event_type: 'user.invited',
  stream_id: '<invitation-uuid>',       // invitation_id as aggregate
  stream_type: 'user',                  // Routes to process_user_event()
  event_data: {
    invitation_id: '<uuid>',
    org_id: '<org-uuid>',
    email: 'newuser@provider.org',
    first_name: 'Jane',
    last_name: 'Doe',
    roles: [                            // Multi-role array (preferred)
      { role_id: null, role_name: 'provider_admin' },
      { role_id: '<uuid>', role_name: 'Program Manager - Aspen' }
    ],
    token: '<256-bit-url-safe-token>',
    expires_at: '2026-01-20T10:30:00Z',
    access_start_date: '2026-01-15',    // Optional: delayed access
    access_expiration_date: '2026-12-31' // Optional: time-limited access
  },
  event_metadata: {
    user_id: '<admin-uuid>',            // Who invited the user
    correlation_id: '<workflow-uuid>',  // Temporal workflow ID
    timestamp: '2026-01-13T10:30:00Z'
  }
}
```

### Event Processor

**Handler**: `process_user_event()` (lines 488-563)

**Location**: `infrastructure/supabase/supabase/migrations/20251231221901_user_extended_event_processors.sql`

**Event Routing**: The main event router (`process_domain_event()`) routes `stream_type: 'user'` events to `process_user_event()`, which handles `user.invited` among other user lifecycle events.

**Processing Logic** (excerpt from `process_user_event()`):
```sql
WHEN 'user.invited' THEN
  INSERT INTO invitations_projection (
    invitation_id,
    organization_id,
    email,
    first_name,
    last_name,
    role,              -- Legacy field (deprecated)
    roles,             -- Multi-role JSONB array
    token,
    expires_at,
    access_start_date,
    access_expiration_date,
    notification_preferences,
    status,
    created_at,
    updated_at
  )
  VALUES (
    (v_event_data->>'invitation_id')::UUID,
    (v_event_data->>'org_id')::UUID,
    v_event_data->>'email',
    v_event_data->>'first_name',
    v_event_data->>'last_name',
    v_event_data->>'role',                    -- Legacy single role
    v_event_data->'roles',                    -- Multi-role array
    v_event_data->>'token',
    (v_event_data->>'expires_at')::TIMESTAMPTZ,
    (v_event_data->>'access_start_date')::DATE,
    (v_event_data->>'access_expiration_date')::DATE,
    v_event_data->'notification_preferences',
    'pending',
    NOW(),
    NOW()
  )
  ON CONFLICT (invitation_id) DO NOTHING;
```

**Idempotency**: `ON CONFLICT (invitation_id) DO NOTHING`

**Related Events** (also handled by `process_user_event()`):
- `invitation.accepted` - Updates status to 'accepted', sets accepted_at
- `invitation.revoked` - Updates status to 'revoked' (workflow compensation)
- `invitation.expired` - Updates status to 'expired' (scheduled cleanup)

## Common Queries

### Validate Invitation Token (Edge Function)

```sql
SELECT
  invitation_id,
  organization_id,
  email,
  first_name,
  last_name,
  role,
  expires_at,
  status
FROM invitations_projection
WHERE token = '<token-from-url>'
  AND status = 'pending'
  AND expires_at > NOW();
```

**Result**:
- **Valid**: Returns invitation details
- **Expired**: No rows (expires_at check fails)
- **Already Accepted**: No rows (status = 'accepted')
- **Invalid Token**: No rows (no match)

### List Pending Invitations for Organization

```sql
SELECT
  email,
  first_name,
  last_name,
  role,
  created_at,
  expires_at,
  EXTRACT(epoch FROM (expires_at - NOW())) / 86400 as days_until_expiry
FROM invitations_projection
WHERE organization_id = '<org-uuid>'
  AND status = 'pending'
ORDER BY created_at DESC;
```

**Use Case**: Organization admin dashboard showing pending invitations

### Find Expired Invitations (Cleanup Job)

```sql
SELECT
  id,
  invitation_id,
  email,
  organization_id
FROM invitations_projection
WHERE status = 'pending'
  AND expires_at < NOW();
```

**Use Case**: Scheduled job marks expired invitations

### Invitation Conversion Rate Analysis

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'accepted') as accepted_count,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'expired') as expired_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'accepted') /
    NULLIF(COUNT(*) FILTER (WHERE status != 'deleted'), 0),
    2
  ) as acceptance_rate_percent
FROM invitations_projection
WHERE organization_id = '<org-uuid>'
  AND created_at > NOW() - INTERVAL '90 days';
```

**Use Case**: Onboarding effectiveness metrics

### Check for Duplicate Invitation

```sql
SELECT EXISTS (
  SELECT 1
  FROM invitations_projection
  WHERE organization_id = '<org-uuid>'
    AND email = 'user@example.com'
    AND status IN ('pending', 'accepted')
) AS already_invited;
```

**Use Case**: Prevent duplicate invitation errors

## Usage Examples

### 1. Generate Invitation (Temporal Workflow)

**Scenario**: Organization admin invites new staff member with multiple roles

```typescript
// Temporal Activity: GenerateInvitationsActivity
// File: workflows/src/activities/organization-bootstrap/generate-invitations.ts
import { emitEvent } from '../../shared/events';
import { AGGREGATE_TYPES } from '../../shared/events/types';

async function generateInvitation(params: {
  orgId: string;
  email: string;
  first_name?: string;
  last_name?: string;
  roles: Array<{ role_id: string | null; role_name: string }>;
  access_start_date?: string;     // Optional: '2026-01-15'
  access_expiration_date?: string; // Optional: '2026-12-31'
}) {
  const invitationId = crypto.randomUUID();
  const token = generateSecureToken();  // 256-bit random, base64-url encoded
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);  // 7 days

  // Emit user.invited domain event (USER aggregate)
  await emitEvent({
    event_type: 'user.invited',
    aggregate_type: AGGREGATE_TYPES.USER,    // Routes to process_user_event()
    aggregate_id: invitationId,              // invitation_id as stream_id
    event_data: {
      invitation_id: invitationId,
      org_id: params.orgId,
      email: params.email,
      first_name: params.first_name,
      last_name: params.last_name,
      roles: params.roles,                   // Multi-role array
      token: token,
      expires_at: expiresAt.toISOString(),
      access_start_date: params.access_start_date,
      access_expiration_date: params.access_expiration_date,
    },
  });

  // invitations_projection updated automatically via process_user_event()

  // Send invitation email with token
  const invitationUrl = `https://app.example.com/accept-invitation?token=${token}`;
  await sendInvitationEmail({
    to: params.email,
    subject: `You're invited to join ${orgName}`,
    invitationUrl: invitationUrl
  });

  return invitationId;
}
```

### 2. Validate Invitation Token (Edge Function)

**Scenario**: User clicks invitation link, Edge Function validates token

```typescript
// Edge Function: validate-invitation
// File: infrastructure/supabase/supabase/functions/validate-invitation/index.ts
import { createClient } from '@supabase/supabase-js';

export async function validateInvitation(token: string) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!  // Service role bypasses RLS
  );

  const { data: invitation, error } = await supabase
    .from('invitations_projection')
    .select('*')
    .eq('token', token)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !invitation) {
    return {
      valid: false,
      error: 'Invalid or expired invitation'
    };
  }

  // Prefer roles array, fallback to legacy role field
  const roles = invitation.roles
    ?? (invitation.role ? [{ role_id: null, role_name: invitation.role }] : []);

  return {
    valid: true,
    invitation: {
      email: invitation.email,
      first_name: invitation.first_name,
      last_name: invitation.last_name,
      roles: roles,                           // Multi-role array
      organization_id: invitation.organization_id,
      access_start_date: invitation.access_start_date,
      access_expiration_date: invitation.access_expiration_date,
    }
  };
}
```

### 3. Accept Invitation (Edge Function)

**Scenario**: User accepts invitation and creates account with multiple roles

```typescript
// Edge Function: accept-invitation
// File: infrastructure/supabase/supabase/functions/accept-invitation/index.ts
async function acceptInvitation(params: {
  token: string;
  password: string;
}) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Validate token
  const { data: invitation } = await supabase
    .from('invitations_projection')
    .select('*')
    .eq('token', params.token)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!invitation) {
    throw new Error('Invalid or expired invitation');
  }

  // 2. Create Supabase Auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: invitation.email,
    password: params.password,
    email_confirm: true,  // Auto-confirm email
    user_metadata: {
      first_name: invitation.first_name,
      last_name: invitation.last_name
    }
  });

  if (authError) {
    throw new Error(`User creation failed: ${authError.message}`);
  }

  // 3. Normalize roles (prefer array, fallback to legacy field)
  const roles = invitation.roles
    ?? (invitation.role ? [{ role_id: null, role_name: invitation.role }] : []);

  // 4. Emit invitation.accepted event
  await supabase.rpc('emit_domain_event', {
    p_stream_id: invitation.invitation_id,
    p_stream_type: 'user',
    p_event_type: 'invitation.accepted',
    p_event_data: {
      invitation_id: invitation.invitation_id,
      org_id: invitation.organization_id,
      user_id: authUser.user.id,
      email: invitation.email,
      roles: roles,
      accepted_at: new Date().toISOString(),
      access_start_date: invitation.access_start_date,
      access_expiration_date: invitation.access_expiration_date,
    },
    p_event_metadata: {
      user_id: authUser.user.id,
      reason: 'Invitation accepted by user'
    }
  });

  // 5. Assign each role to user (emit domain events)
  for (const role of roles) {
    await supabase.rpc('emit_domain_event', {
      p_stream_id: authUser.user.id,
      p_stream_type: 'user',
      p_event_type: 'user.role.assigned',
      p_event_data: {
        user_id: authUser.user.id,
        role_id: role.role_id,
        role_name: role.role_name,
        org_id: invitation.organization_id,
        scope_path: `analytics4change.org_${invitation.organization_id}`,
        access_start_date: invitation.access_start_date,
        access_expiration_date: invitation.access_expiration_date,
      },
      p_event_metadata: {
        user_id: 'system',
        correlation_id: invitation.invitation_id,
        reason: 'Role assigned via invitation acceptance'
      }
    });
  }

  // Note: invitations_projection updated automatically by process_user_event()
  // via invitation.accepted event handler

  return {
    user_id: authUser.user.id,
    email: authUser.user.email
  };
}
```

### 4. Expire Old Invitations (Scheduled Job)

**Scenario**: Daily cron job marks expired invitations

```typescript
// Cron Job: expire-invitations
async function expireInvitations() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: expiredInvitations } = await supabase
    .from('invitations_projection')
    .update({
      status: 'expired',
      updated_at: new Date().toISOString()
    })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id, email, organization_id');

  console.log(`Expired ${expiredInvitations.length} invitations`);

  return expiredInvitations;
}
```

## Audit Trail

### Invitation Lifecycle Events
```sql
SELECT
  de.event_type,
  de.occurred_at,
  de.payload,
  de.metadata->>'user_id' as actor
FROM domain_events de
WHERE de.aggregate_type = 'invitation'
  AND de.aggregate_id = '<invitation-uuid>'
ORDER BY de.occurred_at;
```

**Events**: `UserInvited` (creation), application updates (acceptance, expiration)

### Invitations by Organization
```sql
SELECT
  email,
  role,
  status,
  created_at,
  accepted_at,
  EXTRACT(epoch FROM (accepted_at - created_at)) / 3600 as hours_to_acceptance
FROM invitations_projection
WHERE organization_id = '<org-uuid>'
ORDER BY created_at DESC;
```

## Troubleshooting

### Issue: Token Validation Failing

**Symptoms**: Valid-looking token returns "invalid or expired"

**Diagnosis**:
```sql
-- Check if invitation exists
SELECT *
FROM invitations_projection
WHERE token = '<token>';

-- Check status and expiration
SELECT
  status,
  expires_at,
  expires_at > NOW() as is_not_expired
FROM invitations_projection
WHERE token = '<token>';
```

**Common Causes**:
1. Invitation expired → `expires_at < NOW()`
2. Already accepted → `status = 'accepted'`
3. Token typo → No matching record
4. Development cleanup → `status = 'deleted'`

### Issue: Duplicate Invitation Error

**Symptoms**: Cannot re-invite user who declined/missed invitation

**Diagnosis**:
```sql
-- Check existing invitations for email
SELECT
  email,
  status,
  created_at,
  expires_at
FROM invitations_projection
WHERE organization_id = '<org-uuid>'
  AND email = 'user@example.com'
ORDER BY created_at DESC;
```

**Resolution**:
- If `status = 'pending'` and expired → Mark as 'expired' first
- If `status = 'accepted'` → User already has account, assign additional role instead
- If `status = 'expired'` → Create new invitation (different invitation_id)

### Issue: RLS Blocking Application Queries

**Symptoms**: Organization admins can't see pending invitations

**Diagnosis**:
```sql
-- Check if RLS enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'invitations_projection';

-- Check for policies
SELECT COUNT(*) FROM pg_policies
WHERE tablename = 'invitations_projection';
```

**Resolution**: Implement RLS policies (see Recommended Policies section)

## Performance Considerations

### Token Lookup Performance
```sql
EXPLAIN ANALYZE
SELECT * FROM invitations_projection WHERE token = '<token>';

-- Expected: Index Scan using invitations_projection_token_key (or idx)
-- Cost: < 1ms (critical for Edge Function user experience)
```

### Invitation Creation Rate
- **Volume**: Typically < 100 invitations/day per organization
- **Bottleneck**: Email delivery (not database)
- **Optimization**: Trigger processes events asynchronously

### Cleanup Job Performance
- **Frequency**: Daily cron job
- **Index**: idx_invitations_projection_status for efficient status filtering
- **Volume**: Typically < 50 expirations/day

## Related Tables

- **organizations_projection** - Organization inviting users
- **users** - Created after invitation acceptance
- **user_roles_projection** - Role assigned after acceptance
- **domain_events** - Source event: UserInvited

## Migration History

**Initial Schema**: Created with organization onboarding workflow (2024-Q4)

**Schema Changes**:
- Added `tags` column for dev cleanup (2024-12-10)
- Migration from Zitadel to Supabase Auth (2025-10-27) - Updated Edge Functions, no schema changes
- Multi-role invitation system (2025-12-31):
  - Added `roles` JSONB column for multi-role array
  - Added `access_start_date` and `access_expiration_date` columns
  - Added `notification_preferences` JSONB column
  - Made `role` column NULLABLE (deprecated in favor of `roles`)
  - Migration: `20251231221901_user_extended_event_processors.sql`
- Event routing fix (2026-01-05):
  - Changed `user.invited` `stream_type` from 'organization' to 'user'
  - `user.invited` events now route to `process_user_event()` instead of `process_organization_event()`
  - Migration: `20260105_invitation_event_routing.sql` (Bootstrap workflow and Edge Function updates)
- Invitation resend/revoke fix (2026-02-19):
  - Fixed `invite-user` Edge Function (v15): `invitation.resent` now emits with `stream_type='invitation'` (was `'organization'`)
  - Added `revoke` operation to `invite-user` Edge Function (calls `api.revoke_invitation` RPC)
  - Added forwarding CASE in `process_organization_event()` for old misrouted `invitation.resent` events
  - Migration: `20260219001026_fix_invitation_resent_routing.sql`

## References

- **Event Processor**: `infrastructure/supabase/supabase/migrations/20251231221901_user_extended_event_processors.sql` (lines 488-563)
- **Table Definition**: `infrastructure/supabase/supabase/migrations/20251229000000_baseline_v2.sql` (invitations_projection)
- **AsyncAPI Contract**: `infrastructure/supabase/contracts/asyncapi/domains/invitation.yaml`
- **Edge Functions**:
  - `infrastructure/supabase/supabase/functions/invite-user/index.ts` - Manual user invitation
  - `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - Invitation acceptance
  - `infrastructure/supabase/supabase/functions/validate-invitation/index.ts` - Token validation
- **Temporal Activity**: `workflows/src/activities/organization-bootstrap/generate-invitations.ts`
- **Frontend Service**: `frontend/src/services/users/SupabaseUserCommandService.ts` - Invites users via Edge Function
