# Tasks: Role Assignment Bug Fix + Event Architecture Uniformity

## Status Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Completed
- `[!]` Blocked (see notes)

---

## Phase 0: Architecture Decisions (COMPLETED)

**Status**: COMPLETED (2025-12-21)

### Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event Processing Pattern | **Router-based** | Single entry point, consistent pattern, easier debugging |
| Event Type Naming | **dot-notation** | 12/13 domains already use it, all code uses it |
| Schema Keyword | **const** | Semantically correct for single-value constraints |
| TypeScript Types | **Hand-craft** | Simple (~28 types), no build tooling needed |
| Scope | **Full cleanup** | Systemic issues require comprehensive fix |

---

## Phase 1: Core Bug Fixes (SQL) - COMPLETED

**Status**: COMPLETED (2025-12-21)
**Priority**: CRITICAL - These are the root causes of the bug

### 1.1 Fix Column Name Mismatch in Triggers - COMPLETED

| File | Line(s) | Change | Status |
|------|---------|--------|--------|
| `sql/04-triggers/process_invitation_accepted.sql` | 115, 121, 125 | `org_id` → `organization_id` | COMPLETED |
| `sql/03-functions/event-processing/004-process-rbac-events.sql` | 101, 122 | `org_id` → `organization_id` | COMPLETED |
| `sql/99-seeds/004-platform-admin-users.sql` | 91, 98, 101 | `org_id` → `organization_id` | COMPLETED |

**Tasks**:
- [x] Fix `process_invitation_accepted.sql` INSERT column name
- [x] Fix `004-process-rbac-events.sql` INSERT/DELETE column names
- [x] Fix `004-platform-admin-users.sql` INSERT column names
- [x] Update ON CONFLICT clauses to use constraint names

### 1.2 Fix Edge Function Error Handling - COMPLETED

| File | Line(s) | Change | Status |
|------|---------|--------|--------|
| `supabase/functions/accept-invitation/index.ts` | 267-279 | Return 500 on `eventError` | COMPLETED |
| `supabase/functions/accept-invitation/index.ts` | 304-317 | Return 500 on `acceptedEventError` | COMPLETED |

**Tasks**:
- [x] Add early return on `user.created` event emission failure
- [x] Add early return on `invitation.accepted` event emission failure
- [x] Include structured JSON error response with userId for debugging

### 1.3 Fix JWT Hook Exception Handling - COMPLETED

| File | Change | Status |
|------|--------|--------|
| `sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql` | Throw exception instead of defaulting to 'viewer' | COMPLETED |

**Tasks**:
- [x] Add `RAISE EXCEPTION 'JWT_HOOK_NO_ROLE: ...'` when no role found
- [x] Update exception handler to re-raise intentional exceptions (P0001)
- [x] Keep WHEN OTHERS for unexpected errors only

---

## Phase 2: Router-Based Event Processing Migration - COMPLETED

**Status**: COMPLETED (2025-12-21)
**Goal**: Consolidate all event processing into router pattern, remove direct triggers

### 2.1 Create Invitation Event Processor Function - COMPLETED

| File | Action | Status |
|------|--------|--------|
| `sql/03-functions/event-processing/013-process-invitation-events.sql` | CREATE NEW | COMPLETED |

**Tasks**:
- [x] Create `process_invitation_event(p_event RECORD)` function
- [x] Handle `invitation.accepted` - mark accepted, create role assignment
- [x] Handle `invitation.revoked` - mark as deleted
- [x] Handle `invitation.expired` - mark as expired
- [x] Use SECURITY INVOKER (inherits postgres privileges from trigger chain)

### 2.2 Update Main Event Router - COMPLETED

| File | Line(s) | Change | Status |
|------|---------|--------|--------|
| `sql/03-functions/event-processing/001-main-event-router.sql` | 52-54 | Add `invitation` stream_type case | COMPLETED |

**Tasks**:
- [x] Add `WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);`

### 2.3 Update Organization Event Processor - COMPLETED

| File | Line(s) | Change | Status |
|------|---------|--------|--------|
| `sql/03-functions/event-processing/002-process-organization-events.sql` | 357-397 | Add `user.invited` handler | COMPLETED |

**Tasks**:
- [x] Add `WHEN 'user.invited' THEN` case for invitation creation

### 2.4 Remove Direct Trigger Files - COMPLETED

| File | Action | Status |
|------|--------|--------|
| `sql/04-triggers/process_invitation_accepted.sql` | DROP TRIGGER + FUNCTION | COMPLETED |
| `sql/04-triggers/process_invitation_revoked.sql` | DROP TRIGGER + FUNCTION | COMPLETED |
| `sql/04-triggers/process_user_invited.sql` | DROP TRIGGER + FUNCTION | COMPLETED |

**Tasks**:
- [x] `DROP TRIGGER IF EXISTS` for all three triggers
- [x] `DROP FUNCTION IF EXISTS` for all three functions
- [x] Files contain only deprecation comments and DROP statements

---

## Phase 3: AsyncAPI Contract Reconciliation - COMPLETED

**Status**: COMPLETED (2025-12-21)
**Goal**: Fix invitation.yaml to use dot-notation + const

### 3.1 Fix invitation.yaml (Primary Non-Conforming Contract) - COMPLETED

| File | Line(s) | Change | Status |
|------|---------|--------|--------|
| `contracts/asyncapi/domains/invitation.yaml` | 4 | `name: invitation.user_invited` → `name: user.invited` | COMPLETED |
| `contracts/asyncapi/domains/invitation.yaml` | 51-55 | `enum: [organization]` → `const: organization`, `enum: [UserInvited]` → `const: user.invited` | COMPLETED |
| `contracts/asyncapi/domains/invitation.yaml` | 132-136 | `enum: [invitation]` → `const: invitation`, `enum: [InvitationRevoked]` → `const: invitation.revoked` | COMPLETED |
| `contracts/asyncapi/domains/invitation.yaml` | 189-194 | `enum: [invitation]` → `const: invitation`, `enum: [InvitationAccepted]` → `const: invitation.accepted` | COMPLETED |
| `contracts/asyncapi/domains/invitation.yaml` | 242-247 | `enum: [invitation]` → `const: invitation`, `enum: [InvitationExpired]` → `const: invitation.expired` | COMPLETED |

**Tasks**:
- [x] Update all four event_type definitions to dot-notation
- [x] Change `enum` to `const` for all single-value constraints
- [x] Update message `name` field from `invitation.user_invited` to `user.invited`

### 3.2 Audit Remaining 12 Domain Contracts (enum → const) - DEFERRED

**Note**: Other contracts already use dot-notation. enum → const migration deferred to future cleanup.

---

## Phase 4: TypeScript Type Safety - COMPLETED

**Status**: COMPLETED (2025-12-21)
**Goal**: Create typed event_type constants, update documentation

### 4.1 Create Event Type Constants - COMPLETED

| File | Action | Status |
|------|--------|--------|
| `workflows/src/shared/constants.ts` | Add EVENT_TYPES object | COMPLETED |

**Tasks**:
- [x] Add `EVENT_TYPES` const object with all dot-notation event types
- [x] Add `EventType` type union
- [x] Add `USER` to `AGGREGATE_TYPES`

### 4.2 Update emit-event.ts Documentation - COMPLETED

| File | Line | Change | Status |
|------|------|--------|--------|
| `workflows/src/shared/utils/emit-event.ts` | 44-48 | Update JSDoc comments to use dot-notation examples | COMPLETED |

**Tasks**:
- [x] Update `event_type` JSDoc from PascalCase to dot-notation examples
- [x] Update `aggregate_type` JSDoc to match stream_type naming

---

## Phase 5: Documentation Updates - IN PROGRESS

**Status**: IN PROGRESS (2025-12-21)
**Goal**: Update dev-docs with completed changes

### 5.1 Update Dev-Docs - IN PROGRESS

| File | Changes Needed | Status |
|------|---------------|--------|
| `dev/active/role-assignment-fix-tasks.md` | Mark phases complete | IN PROGRESS |
| `dev/active/role-assignment-fix-context.md` | Add implementation notes | PENDING |

**Tasks**:
- [x] Update task file with completion status
- [ ] Update context file with security model notes
- [ ] Add file change summary

### 5.2 Infrastructure Documentation - DEFERRED

**Note**: Full documentation update deferred to avoid scope creep. Focus on deployment.

---

## Phase 6: CONSOLIDATED_SCHEMA.sql Sync - PENDING

**Status**: PENDING
**Goal**: Ensure production deployment file reflects all changes

| Step | Description | Status |
|------|-------------|--------|
| 1 | After all SQL changes in phases 1-2, regenerate CONSOLIDATED_SCHEMA.sql | PENDING |
| 2 | Verify all column name fixes are included | PENDING |
| 3 | Verify router function updates are included | PENDING |
| 4 | Verify trigger DROP statements are included | PENDING |
| 5 | Verify new `process_invitation_event` function is included | PENDING |

**Tasks**:
- [ ] Run consolidation script or manually sync changes
- [ ] Verify idempotency patterns maintained
- [ ] Test CONSOLIDATED_SCHEMA.sql against local Supabase

---

## Phase 7: Deployment & Verification - PENDING

**Status**: PENDING (waiting for Phase 6)

### 7.1 Cleanup

**Tasks**:
- [ ] Run `/org-cleanup` for clean slate
- [ ] Verify no test organizations remain

### 7.2 Deploy Changes

**Tasks**:
- [ ] Deploy SQL changes via CONSOLIDATED_SCHEMA.sql or psql
- [ ] Deploy Edge Function: `supabase functions deploy accept-invitation`
- [ ] Verify migrations applied successfully

### 7.3 UAT

**Test Scenario**:
- [ ] Create new organization via bootstrap workflow
- [ ] Verify `organization.created` event in domain_events
- [ ] Accept invitation as invited user
- [ ] Verify `invitation.accepted` event in domain_events
- [ ] Verify `user_roles_projection` has `provider_admin` entry
- [ ] Verify JWT claims show `user_role: 'provider_admin'`
- [ ] Verify user lands on correct route (`/organization-units`)

---

## File Change Summary (Completed)

### SQL Files Modified

| File | Changes |
|------|---------|
| `03-functions/event-processing/001-main-event-router.sql` | Added `invitation` stream_type routing |
| `03-functions/event-processing/002-process-organization-events.sql` | Added `user.invited` handler |
| `03-functions/event-processing/004-process-rbac-events.sql` | Fixed `organization_id` column name, proper NULL handling |
| `03-functions/event-processing/013-process-invitation-events.sql` | **NEW** - Router-based invitation processor |
| `03-functions/authorization/003-supabase-auth-jwt-hook.sql` | Added fail-fast exception for missing roles |
| `04-triggers/process_invitation_accepted.sql` | Converted to DROP IF EXISTS only |
| `04-triggers/process_invitation_revoked.sql` | Converted to DROP IF EXISTS only |
| `04-triggers/process_user_invited.sql` | Converted to DROP IF EXISTS only |
| `99-seeds/004-platform-admin-users.sql` | Fixed `organization_id` column name |

### Edge Function Modified

| File | Changes |
|------|---------|
| `supabase/functions/accept-invitation/index.ts` | Added error returns on event emission failures |

### AsyncAPI Contract Modified

| File | Changes |
|------|---------|
| `contracts/asyncapi/domains/invitation.yaml` | PascalCase → dot-notation, enum → const |

### TypeScript Files Modified

| File | Changes |
|------|---------|
| `workflows/src/shared/constants.ts` | Added EVENT_TYPES const object, EventType type |
| `workflows/src/shared/utils/emit-event.ts` | Updated JSDoc to dot-notation examples |

---

## Last Updated

**Date**: 2025-12-21
**Completed**: Phases 0, 1, 2, 3, 4
**In Progress**: Phase 5 (Documentation)
**Next Step**: Phase 6 - CONSOLIDATED_SCHEMA.sql sync, then Phase 7 deployment
