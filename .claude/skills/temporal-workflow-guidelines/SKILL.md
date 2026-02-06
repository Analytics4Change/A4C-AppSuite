---
name: Temporal Workflow Guidelines
description: Guard rails for Temporal.io workflow determinism, saga compensation, and event-driven activity patterns in A4C-AppSuite.
version: 2.0.0
category: temporal
tags: [temporal, workflows, activities, determinism, saga, tracing]
---

# Temporal Workflow Guard Rails

Critical rules that prevent bugs in Temporal workflows and activities. For full guidance, templates, and reference, see `workflows/CLAUDE.md` and search `documentation/AGENT-INDEX.md` with keywords: `temporal`, `saga`, `workflow`, `activity`, `determinism`, `compensation`, `correlation-id`, `tracing`.

---

## 1. Determinism: No Side Effects in Workflows

Workflows replay from event history. Non-deterministic code breaks replay.

```typescript
// ❌ NEVER in workflows — breaks replay
await fetch('https://api.example.com')           // API call
await supabase.from('orgs').insert(...)           // DB write
const ts = Date.now()                             // Non-deterministic
const id = Math.random().toString()               // Non-deterministic

// ✅ ALWAYS use Temporal APIs + activities
import { uuid4, sleep } from '@temporalio/workflow'
const id = uuid4()                                // Deterministic
await sleep('5 minutes')                          // Deterministic
const result = await myActivity(params)           // Side effects here
```

## 2. Every Activity Must Emit a Domain Event

Activities that change state MUST emit to `domain_events`. This is the sole audit trail (HIPAA compliance) and drives CQRS projections.

## 3. Saga Compensation for Multi-Step Workflows

Track completion of each step. On failure, compensate in **reverse order**. Every workflow with 2+ activities needs a try/catch with compensation.

## 4. Versioning with `patched()`

Use `patched('change-name')` to safely modify in-flight workflows. Never change workflow logic without versioning.

## 5. Tracing: Pass `params.tracing` — Never Generate New

Workflows receive `tracing` from the API handler. **ALWAYS forward it to every activity call.** Never generate a new `correlation_id` inside a workflow — this breaks end-to-end correlation.

```typescript
// ✅ Forward tracing from workflow params to each activity
await createOrgActivity({ orgId, tracing: params.tracing })
await configureDNSActivity({ subdomain, tracing: params.tracing })
await sendInvitationsActivity({ emails, tracing: params.tracing })
```

## 6. Activity Event Metadata Must Include Workflow Context

Activities MUST include `workflow_id` and `run_id` in event metadata so events trace back to their workflow execution.

```typescript
const workflowInfo = Context.current().info
await supabase.from('domain_events').insert({
  event_type: 'OrganizationCreated',
  aggregate_type: 'organization',
  aggregate_id: orgId,
  correlation_id: params.tracing?.correlationId,
  event_data: { ... },
  event_metadata: {
    workflow_id: workflowInfo.workflowId,
    workflow_run_id: workflowInfo.runId,
    workflow_type: workflowInfo.workflowType,
    activity_id: workflowInfo.activityId
  }
})
```

---

## File Locations

| What | Where |
|------|-------|
| Workflows | `workflows/src/workflows/{category}/workflow.ts` |
| Activities | `workflows/src/activities/{category}/` |
| Shared utils | `workflows/src/shared/utils/` (emit-event, http-tracing) |
| Worker | `workflows/src/worker/` |
| Tests | `workflows/src/workflows/{category}/__tests__/` |

## Deep Reference

- `workflows/CLAUDE.md` — Full development guidance, commands, environment setup
- `documentation/AGENT-INDEX.md` — Search by keyword for architecture docs
- `documentation/architecture/workflows/temporal-overview.md` — Architecture overview
- `documentation/workflows/reference/activities-reference.md` — Activity patterns
- `documentation/infrastructure/guides/event-observability.md` — Tracing, failed events, correlation
