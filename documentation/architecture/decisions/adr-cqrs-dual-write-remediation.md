---
status: current
last_updated: 2026-02-07
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: ADR documenting the discovery and remediation of CQRS violations across 8 `api.*` functions. Found 2 dual-write functions, 3 direct-write-only functions, 2 event type naming mismatches preventing handlers from firing, and 1 function referencing non-existent columns. All P0/P1 issues resolved across 4 migrations. Established event type naming convention (dots for hierarchy, underscores for compound names).

**When to read**:
- Understanding why certain migrations exist (20260206–20260207 series)
- Before modifying `api.*` functions that write to projections
- When adding new event types (naming convention)
- Reviewing CQRS compliance history

**Prerequisites**: [event-sourcing-overview](../data/event-sourcing-overview.md), [event-handler-pattern](../../infrastructure/patterns/event-handler-pattern.md)

**Key topics**: `adr`, `cqrs-compliance`, `dual-write`, `event-type-naming`, `naming-convention`, `remediation`, `architecture-decision`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# ADR: CQRS Dual-Write Remediation

**Date**: 2026-02-06 (audit), remediated through 2026-02-07
**Status**: Implemented (P0/P1 complete, P2 cleanup in progress)
**Deciders**: Lars (architect), Claude (audit and implementation)

## Context

### The Problem

The A4C platform's CQRS architecture requires all state changes to flow through domain events:

```
API function -> INSERT INTO domain_events -> BEFORE INSERT trigger -> router -> handler -> projection updated
```

An audit of all 21 `api.*` functions that write data found 8 functions violating this pattern, plus critical bugs where event routing silently failed.

### What Was Found

| Category | Count | Impact |
|----------|-------|--------|
| Dual-write (event + direct projection write) | 2 | Redundant writes; handler never fires due to routing bug |
| Direct-write-only (no event emitted) | 3 | No audit trail; events cannot be replayed |
| Event type naming mismatch | 2 | Handlers exist but never fire; events silently marked as processed |
| Non-existent column references | 1 | Runtime error when function is called |

### Root Causes

1. **Naming convention inconsistency**: API functions emitted event types with underscores (`organization.direct_care_settings_updated`) but routers expected dots (`organization.direct_care_settings.updated`). The router's ELSE clause used `RAISE WARNING` (invisible), so events were silently marked as processed.

2. **Missing CQRS enforcement**: No tooling or linting existed to verify that API functions emit events rather than writing projections directly.

3. **Split responsibility**: The `update_organization_status` function was designed to be called by Temporal workflows that emit their own events separately, creating a temporal ordering violation (projection updated before event exists).

## Decision

### Fix approach: Remove all direct writes, rely on event handlers

All projection updates must go through event handlers. This is justified by:

1. **Synchronous trigger**: The BEFORE INSERT trigger guarantees the handler runs within the same transaction. The projection IS updated by the time the INSERT returns.
2. **Event replay**: Direct writes cannot be replayed from the event store.
3. **Audit trail**: HIPAA requires all state changes in the audit log.
4. **Single responsibility**: The handler is the sole owner of projection updates.

### Fix the routers, not the emitters

For naming mismatches, we updated the router CASE clauses to match the emitted event types (underscore format) rather than changing what API functions emit. Rationale:
- Events already exist in production with underscore format
- Changing emitted types would require fixing all callers
- Changing the router is a single-point fix

### Establish naming convention

Formalized the convention that was already dominant in production:
- Dots separate hierarchy levels: `stream_type.entity.action`
- Underscores for compound words within a level: `direct_care_settings_updated`
- Documented in [Event Handler Pattern — Naming Convention](../../infrastructure/patterns/event-handler-pattern.md#event-type-naming-convention)

## Consequences

### Migrations Applied

| Migration | Priority | What It Does |
|-----------|----------|-------------|
| `20260206234839_fix_p0_cqrs_critical_bugs` | P0 | Fix event type routing mismatches (2 functions), fix `revoke_invitation` broken columns + add event emission, fix handler `aggregate_id` → `stream_id` |
| `20260207000203_p1_remove_dual_writes_fix_resend` | P1 | Remove direct writes from 2 dual-write functions, add event emission to `resend_invitation`, add `invitation.resent` to invitation router, fix router ELSE clauses to RAISE EXCEPTION |
| `20260207004639_p1_fix_bootstrap_handlers_org_status` | P1 | Fix bootstrap event type routing (`bootstrap.*` → `organization.bootstrap.*`), replace `activateOrganization` with `emitBootstrapCompleted` in workflows |
| `20260207013604_p2_postgrest_pre_request_tracing` | P2 | PostgREST pre-request hook for automatic correlation/trace ID injection |
| `20260207020902_p2_drop_deprecated_accept_invitation` | P2 | Drop deprecated `api.accept_invitation` (unused since 2025-12-22) |

### Guard Rails Added

To prevent recurrence:
- **infrastructure/CLAUDE.md**: Warning about event type naming convention, "API functions must NEVER write projections directly"
- **event-handler-pattern.md**: Naming convention section, resolved issues callout
- **SKILL.md**: Infrastructure guidelines skill includes rule #9 (no direct projection writes)
- **Router ELSE clauses**: All updated from `RAISE WARNING` to `RAISE EXCEPTION` so unhandled event types are visible in `processing_error`

### Remaining P2 Cleanup

- Drop `api.update_organization_status` and `api.get_organization_status`
- Delete `activate-organization.ts` Temporal activity
- Remove `deactivateOrganization` safety net from Saga compensation
- Remove associated TypeScript type definitions

### Risks Accepted

- **Historical event replay**: Events processed before remediation were handled by direct writes, not handlers. Replaying those events now would use handlers instead. The handler logic matches the direct write logic, so projection state should be equivalent, but `updated_at` timestamps will differ (`p_event.created_at` vs `now()`).
- **Revocation gap**: `revoke_invitation` was broken (runtime error) before remediation. Any invitations that should have been revoked between deployment and the fix were not. Production logs were checked — no failed revocation attempts found.

## Related Documents

- [CQRS Dual-Write Audit](../../../dev/active/cqrs-dual-write-audit.md) — Full audit details, code samples, verification queries
- [Event Handler Pattern](../../infrastructure/patterns/event-handler-pattern.md) — Handler architecture and naming convention
- [Event Sourcing Overview](../data/event-sourcing-overview.md) — CQRS architecture
- [Event Processing Patterns](../../infrastructure/patterns/event-processing-patterns.md) — Sync vs async pattern selection
