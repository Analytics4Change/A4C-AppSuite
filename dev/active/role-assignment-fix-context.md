# Context: Role Assignment Bug Fix (Expanded Scope)

## Decision Record

**Date**: 2025-12-21
**Feature**: Role Assignment Bug Fix + Event Architecture Uniformity
**Goal**: Fix role assignment AND establish uniform event processing patterns across the entire system

### Scope Expansion Notice

This plan has expanded from a single bug fix to a system-wide architecture uniformity effort. The role assignment bug exposed fundamental inconsistencies that must be addressed holistically.

**Original Scope**: Fix invitation acceptance role assignment
**Expanded Scope**: Establish uniform event architecture across all domains

---

## FINALIZED DECISIONS (Phase 0 Complete)

### Decision 1: Event Processing Pattern

**Choice**: **Router-based**

**Rationale**:
- Single entry point for debugging
- Consistent pattern across all stream types
- Main router already handles 13 stream types
- Only `invitation` stream type is missing from router

**Implementation**:
- Add `WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);` to main router
- Create `process_invitation_event()` function
- Remove direct AFTER INSERT triggers for invitation events

### Decision 2: Event Type Naming Convention

**Choice**: **dot-notation** (e.g., `invitation.accepted`)

**Rationale**:
- 12/13 domains already use dot-notation
- ALL code (triggers, activities, Edge Functions) uses dot-notation
- Only `invitation.yaml` contracts use PascalCase (and are wrong)

**Format**: `{aggregate}.{action}` or `{aggregate}.{sub-aggregate}.{action}`

**Examples**:
- `invitation.accepted` (not `InvitationAccepted`)
- `organization.created` (not `OrganizationCreated`)
- `organization.subdomain.verified` (nested sub-aggregate)

### Decision 3: Schema Keyword Convention

**Choice**: **const** for single-value event_type constraints

**Rationale**:
- `const` is semantically correct for "must be exactly this value"
- `enum` with single value is redundant
- Aligns with JSON Schema best practices

**Example**:
```yaml
# CORRECT
event_type:
  type: string
  const: invitation.accepted

# INCORRECT
event_type:
  type: string
  enum: [InvitationAccepted]
```

### Decision 4: TypeScript Type Strategy

**Choice**: **Hand-craft union type** (Option A)

**Rationale**:
- @asyncapi/modelina generates full data models, not event_type unions
- Only ~28 unique event types - simple to maintain
- No build tooling dependency
- Nested $ref types in AsyncAPI don't materialize cleanly

**Implementation**:
```typescript
// workflows/src/types/events/domain-event-types.ts
export type DomainEventType =
  | 'invitation.accepted'
  | 'invitation.revoked'
  | 'user.created'
  | 'organization.created'
  // ... ~28 total
```

### Decision 5: Scope

**Choice**: **Full cleanup**

**Rationale**:
- Bug exposed systemic inconsistencies
- Fixing one bug without addressing patterns will cause future issues
- Project is in development - clean slate is acceptable
- No backward compatibility required

---

## Architecture: Router-Based Event Processing

### Final Architecture (After Implementation)

```
domain_events INSERT
  |
  +---> [BEFORE INSERT] process_domain_event_trigger
              |
              +---> Routes by stream_type to handler function
                    |
                    +---> 'client' → process_client_event()
                    +---> 'user' → process_user_event()
                    +---> 'organization' → process_organization_event()
                    +---> 'invitation' → process_invitation_event()  [NEW]
                    +---> 'role' → process_rbac_event()
                    +---> ... (all other stream types)
```

### Removed Pattern (Direct Triggers)

The following AFTER INSERT triggers will be removed:
- `process_invitation_accepted_event` (event_type = 'invitation.accepted')
- `process_invitation_revoked` (event_type = 'invitation.revoked')
- `process_user_invited` (event_type = 'user.invited')

---

## Technical Context

### PRIMARY Bug: Column Name Mismatch

**Table definition** (`user_roles_projection.sql:8`):
```sql
organization_id UUID,  -- Correct column name
```

**Trigger code** (`process_invitation_accepted.sql:112-125`):
```sql
INSERT INTO user_roles_projection (
  user_id,
  role_id,
  org_id,        -- WRONG! Column is organization_id
  scope_path,
  assigned_at
)
```

**Impact**: INSERT fails silently, no role assigned, JWT hook defaults to 'viewer'.

### SECONDARY Bug: Edge Function Error Handling

**Current behavior** (`accept-invitation/index.ts:297-301`):
```typescript
if (acceptedEventError) {
  console.error('Failed to emit invitation.accepted event:', acceptedEventError);
}
// CONTINUES TO RETURN 200 SUCCESS!
```

**Required**: Return 500 error on event emission failure.

### TERTIARY Issue: JWT Hook Fallback

**Current behavior**: When no role found, defaults to 'viewer'.
**Required**: Throw exception - role assignment must never silently fail.

---

## Event Flow (After Fix)

```
1. Workflow creates invitation with role='provider_admin'
2. User accepts invitation via Edge Function
   a. user.created event emitted → SUCCESS or 500 ERROR
   b. invitation.accepted event emitted → SUCCESS or 500 ERROR
3. Main router receives event (stream_type='invitation')
4. Router calls process_invitation_event()
5. Function inserts into user_roles_projection (organization_id column)
6. JWT hook retrieves role from user_roles_projection
7. User sees provider_admin role in JWT claims
```

---

## Files Requiring Changes

### Critical (Phase 1)

| File | Issue |
|------|-------|
| `sql/04-triggers/process_invitation_accepted.sql` | `org_id` → `organization_id` |
| `sql/03-functions/event-processing/004-process-rbac-events.sql` | `org_id` → `organization_id` |
| `sql/99-seeds/004-platform-admin-users.sql` | `org_id` → `organization_id` |
| `supabase/functions/accept-invitation/index.ts` | Add error returns |
| `sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql` | Throw exception |

### Router Migration (Phase 2)

| File | Action |
|------|--------|
| `sql/03-functions/event-processing/013-process-invitation-events.sql` | CREATE NEW |
| `sql/03-functions/event-processing/001-main-event-router.sql` | Add invitation case |
| `sql/04-triggers/process_invitation_accepted.sql` | DEPRECATE |
| `sql/04-triggers/process_invitation_revoked.sql` | DEPRECATE |
| `sql/04-triggers/process_user_invited.sql` | DEPRECATE |

### AsyncAPI Contracts (Phase 3)

| File | Change |
|------|--------|
| `invitation.yaml` | PascalCase → dot-notation, enum → const |
| `program.yaml` | enum → const |
| `address.yaml` | enum → const |
| `phone.yaml` | enum → const |
| `contact.yaml` | enum → const |
| `junction.yaml` | enum → const |
| `organization.yaml` | enum → const |
| `access_grant.yaml` | enum → const |

### TypeScript (Phase 4)

| File | Action |
|------|--------|
| `workflows/src/types/events/domain-event-types.ts` | CREATE NEW |
| `workflows/src/shared/utils/emit-event.ts` | Use typed union |
| 13 activity files | Update event_type usage |

### Documentation (Phase 5)

| File | Action |
|------|--------|
| `.claude/skills/infrastructure-guidelines/SKILL.md` | Update to dot-notation |
| `.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md` | Major rewrite |
| Architecture docs | Review and update |

### Deployment (Phase 6)

| File | Action |
|------|--------|
| `CONSOLIDATED_SCHEMA.sql` | Sync all SQL changes |

---

## Key Constraints

1. **No backward compatibility**: Clean slate after `org-cleanup`
2. **System-wide uniformity**: All changes apply to entire event system
3. **Documentation cascade**: All docs must reflect final patterns
4. **TypeScript types required**: No more untyped `string` for event_type
5. **CONSOLIDATED_SCHEMA.sql sync**: Production deployment file must reflect all changes

---

## Evidence from Audit (2025-12-21)

### AsyncAPI Contract Analysis

| Convention | Domain Count |
|------------|--------------|
| dot-notation | 12 domains |
| PascalCase | 1 domain (invitation.yaml only) |

| Keyword | Domain Count |
|---------|--------------|
| const | 5 domains (user, rbac, client, impersonation, medication) |
| enum (single value) | 8 domains (need to change to const) |

### Event Type Values in Code

All emitters use dot-notation:
- Edge Function: `user.created`, `invitation.accepted`
- Activities: `organization.created`, `user.invited`, `invitation.revoked`, etc.

All triggers listen for dot-notation:
- `WHEN (NEW.event_type = 'invitation.accepted')`
- `WHEN (NEW.event_type = 'invitation.revoked')`
- `WHEN (NEW.event_type = 'user.invited')`

### Missing Router Case

Main router (`001-main-event-router.sql`) handles:
- client, medication, medication_history, dosage, user, organization
- contact, address, phone, permission, role, access_grant, impersonation

**Missing**: `invitation` stream type (bypasses router, uses direct triggers)

---

## Reference Materials

- Plan file: `dev/active/role-assignment-fix-plan.md`
- Tasks file: `dev/active/role-assignment-fix-tasks.md`
- AsyncAPI contracts: `infrastructure/supabase/contracts/asyncapi/domains/`
- Infrastructure CLAUDE.md: `infrastructure/CLAUDE.md`
- Infrastructure Guidelines Skill: `.claude/skills/infrastructure-guidelines/`

---

## Session History

### 2025-12-21: Phase 0 Audit & Decisions

**Completed**:
1. Audited all 13 event processors in `03-functions/event-processing/`
2. Audited all direct triggers in `04-triggers/`
3. Scanned all 13 AsyncAPI domain contracts
4. Scanned all event emitters (activities, Edge Functions)
5. Identified ~28 unique event_type values
6. Made 5 architectural decisions (documented above)
7. Created detailed task breakdown in tasks.md

**Key Findings**:
- Column name mismatch is PRIMARY bug cause
- Edge Function silently continues on errors
- Two competing event processing patterns exist
- invitation.yaml is only non-conforming contract
- All code uses dot-notation despite contracts saying PascalCase

**Next Step**: Begin Phase 1 implementation (per user direction)
