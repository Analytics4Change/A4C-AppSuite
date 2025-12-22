# Implementation Plan: Role Assignment Bug Fix + Event Architecture Uniformity

## Executive Summary

When users accept an invitation for a newly bootstrapped organization, they incorrectly see the `viewer` role instead of `provider_admin`. The root causes are:

1. **PRIMARY**: Column name mismatch (`org_id` vs `organization_id`) causes silent INSERT failures
2. **SECONDARY**: Edge Function continues on event emission errors (returns 200 instead of 500)
3. **TERTIARY**: JWT hook defaults to 'viewer' instead of throwing exception

**Scope Expansion**: Investigation revealed systemic inconsistencies in the event architecture. This plan now addresses:
- Role assignment bug (immediate fix)
- Event processing pattern uniformity (router vs trigger)
- AsyncAPI contract consistency (event_type naming, const vs enum)
- TypeScript type safety (eliminate untyped event_type strings)
- Documentation reconciliation (skills, slash commands, architecture docs)

---

## Phase 0: Event Architecture Audit & Documentation - COMPLETED

**Status**: ✅ COMPLETED (2025-12-21)

### Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event Processing | **Router-based** | Single entry point, consistent pattern, easier debugging |
| Event Naming | **dot-notation** | 12/13 domains already use it, all code uses it |
| Schema Keyword | **const** | Semantically correct for single-value constraints |
| TypeScript Types | **Hand-craft** | Simple (~28 types), no build tooling needed |
| Scope | **Full cleanup** | Systemic issues require comprehensive fix |

### Key Findings

1. **Column name mismatch** is the PRIMARY bug cause (`org_id` vs `organization_id`)
2. **Edge Function silently continues** on event emission errors
3. **Two competing patterns** exist (router-based and trigger-based)
4. **invitation.yaml** is the only contract using PascalCase (all others use dot-notation)
5. **Main router missing** `invitation` stream type case

---

## Phase 1: Core Bug Fixes - PENDING

**Status**: ⏸️ PENDING
**Priority**: CRITICAL - These are the root causes of the bug

### 1.1 Fix Column Name Mismatch (PRIMARY BUG)

**Files to Update**:
| File | Line(s) | Change |
|------|---------|--------|
| `sql/04-triggers/process_invitation_accepted.sql` | 115, 121, 125 | `org_id` → `organization_id` |
| `sql/03-functions/event-processing/004-process-rbac-events.sql` | 101, 122 | `org_id` → `organization_id` |
| `sql/99-seeds/004-platform-admin-users.sql` | 91, 98, 101 | `org_id` → `organization_id` |

### 1.2 Edge Function Error Handling

**File**: `infrastructure/supabase/supabase/functions/accept-invitation/index.ts`

**Current** (lines 267-273, 297-301):
```typescript
if (eventError) {
  console.error('Failed to emit user.created event:', eventError);
}
// Continues to success response!
```

**Required**: Add early return with 500 error on both `eventError` and `acceptedEventError`.

### 1.3 JWT Hook Exception

**File**: `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`

**Required Changes**:
- Remove `COALESCE(..., 'viewer')` fallback (if exists)
- Add `RAISE EXCEPTION` when no role found
- Include user_id in exception message for debugging

---

## Phase 2: Router-Based Event Processing Migration - PENDING

**Status**: ⏸️ PENDING
**Decision**: Router-based (confirmed in Phase 0)

### 2.1 Create Invitation Event Processor

Create `sql/03-functions/event-processing/013-process-invitation-events.sql`:
- Handle `invitation.accepted`, `invitation.revoked`, `user.invited`, `invitation.expired`
- Migrate logic from direct trigger functions

### 2.2 Update Main Event Router

Add to `sql/03-functions/event-processing/001-main-event-router.sql`:
```sql
WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);
```

### 2.3 Remove Direct Triggers

Deprecate/remove:
- `sql/04-triggers/process_invitation_accepted.sql`
- `sql/04-triggers/process_invitation_revoked.sql`
- `sql/04-triggers/process_user_invited.sql`

---

## Phase 3: AsyncAPI Contract Reconciliation - PENDING

**Status**: ⏸️ PENDING
**Decision**: dot-notation + const (confirmed in Phase 0)

### 3.1 Fix invitation.yaml (Primary Non-Conforming)

| Current | Change To |
|---------|-----------|
| `enum: [UserInvited]` | `const: user.invited` |
| `enum: [InvitationRevoked]` | `const: invitation.revoked` |
| `enum: [InvitationAccepted]` | `const: invitation.accepted` |
| `enum: [InvitationExpired]` | `const: invitation.expired` |

### 3.2 Update Other Contracts (enum → const)

7 contracts need `enum` → `const` conversion:
- program.yaml, address.yaml, phone.yaml, contact.yaml
- junction.yaml, organization.yaml, access_grant.yaml

5 contracts already use `const` (no changes needed):
- user.yaml, rbac.yaml, client.yaml, impersonation.yaml, medication.yaml

---

## Phase 4: TypeScript Type Safety - PENDING

**Status**: ⏸️ PENDING
**Decision**: Hand-craft union type (confirmed in Phase 0)

### 4.1 Create Type Definitions

Create `workflows/src/types/events/domain-event-types.ts`:
```typescript
export type DomainEventType =
  | 'invitation.accepted'
  | 'invitation.revoked'
  | 'user.invited'
  | 'user.created'
  | 'organization.created'
  // ... ~28 total event types
```

### 4.2 Update emit-event.ts

Change `event_type: string` to `event_type: DomainEventType`

### 4.3 Update All Activities

13 activity files need event_type updates for type safety.

---

## Phase 5: Documentation Reconciliation - PENDING

**Status**: ⏸️ PENDING

### 5.1 Infrastructure Guidelines Skill

Update to reflect:
- dot-notation event naming convention
- Router-based event processing pattern
- const (not enum) for single-value constraints

**Files**:
- `.claude/skills/infrastructure-guidelines/SKILL.md`
- `.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md`
- `.claude/skills/infrastructure-guidelines/resources/cqrs-projections.md`

### 5.2 Architecture Documentation

Review and update:
- `documentation/architecture/data/event-sourcing-overview.md`
- `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md`

---

## Phase 6: CONSOLIDATED_SCHEMA.sql Sync - PENDING

**Status**: ⏸️ PENDING

After all SQL changes, sync `CONSOLIDATED_SCHEMA.sql`:
1. Include all column name fixes
2. Include router function updates
3. Include trigger DROP statements
4. Include new `process_invitation_event` function

---

## Phase 7: Deployment & Verification - PENDING

**Status**: ⏸️ PENDING (blocked on Phases 1-6)

### 7.1 Cleanup
- Run `/org-cleanup` for clean slate

### 7.2 Deploy
- Deploy SQL changes via CONSOLIDATED_SCHEMA.sql
- Deploy Edge Function: `supabase functions deploy accept-invitation`

### 7.3 UAT
1. Create new organization via bootstrap workflow
2. Accept invitation as invited user
3. Verify `invitation.accepted` event in domain_events
4. Verify `user_roles_projection` has `provider_admin` entry
5. Verify JWT claims show `user_role: 'provider_admin'`
6. Verify user lands on correct route

---

## Success Metrics

### Immediate (Bug Fix)
- [ ] Edge Function returns 500 on event emission failure
- [ ] JWT hook throws exception for users without roles
- [ ] Column name mismatch fixed in all INSERT statements

### System-Wide (Uniformity)
- [ ] All 13 domain contracts use dot-notation
- [ ] All event_type values use `const` (not `enum`)
- [ ] TypeScript event_type is typed (not `string`)
- [ ] Event processing uses router pattern consistently

### Documentation
- [ ] Agent skills reflect final architecture decisions
- [ ] AsyncAPI contracts are the definitive source of truth
- [ ] CLAUDE.md files reference correct patterns

---

## Execution Order

**Recommended sequence**:

1. **Phase 1.1-1.3**: Fix critical bugs (immediate relief)
2. **Phase 6**: Sync CONSOLIDATED_SCHEMA.sql (deploy fixes)
3. **Phase 7**: Deploy and UAT critical fixes
4. **Phase 2**: Migrate to router-based pattern
5. **Phase 3**: Update AsyncAPI contracts
6. **Phase 4**: Add TypeScript types
7. **Phase 5**: Update documentation
8. **Phase 6**: Final CONSOLIDATED_SCHEMA.sql sync

---

## Current Status

**Phase**: Phase 0 COMPLETED, Phase 1 NEXT
**Last Updated**: 2025-12-21
**Next Step**: Begin Phase 1.1 - Fix column name mismatch in SQL files
