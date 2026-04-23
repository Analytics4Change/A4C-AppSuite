---
name: Temporal Workflow Guidelines
description: Guard rails for Temporal.io workflow determinism, saga compensation, and event-driven activity patterns in A4C-AppSuite.
version: 2.0.0
category: temporal
tags: [temporal, workflow, activity, determinism, saga, tracing]
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

## 2. Emit Domain Events via Typed Helpers (Not Raw Inserts)

Activities that change state MUST emit to `domain_events` — sole audit trail (HIPAA) and the driver of CQRS projections. **Use the typed emitters from `@shared/utils/typed-events`** (generated from AsyncAPI contracts, auto-inject workflow_id / run_id / timestamps / tracing metadata). Fall back to raw `emitEvent()` only for event types not yet generated from AsyncAPI. **Never** `supabase.from('domain_events').insert(...)` directly — that bypasses all metadata injection.

Event type strings use **dot-notation** (`organization.created`, `user.invited`) — never PascalCase. A router with a CASE for `'organization.created'` will never match `'OrganizationCreated'`, and the event will fail dispatch silently.

```typescript
// ✅ CORRECT — typed helper (preferred)
import { emitContactCreated } from '@shared/utils/typed-events';

await emitContactCreated(contactId, {
  organization_id: orgId,
  label: contact.label,
  type: contact.type,
  first_name: contact.first_name,
  last_name: contact.last_name,
  email: contact.email ?? '',
}, params.tracing);

// ✅ ACCEPTABLE — raw emitEvent for event types not yet in typed-events.ts
import { emitEvent } from '@shared/utils/emit-event';

await emitEvent({
  event_type: 'organization.created',   // dot-notation
  aggregate_type: 'organization',        // maps to stream_type
  aggregate_id: orgId,                   // maps to stream_id
  event_data: { org_id: orgId, name, subdomain },
  user_id: initiatedByUserId,
  reason: 'Organization bootstrap workflow',
});

// ❌ WRONG — raw DB insert bypasses metadata injection (no workflow_id, no tracing)
await supabase.from('domain_events').insert({
  event_type: 'OrganizationCreated',     // PascalCase — won't match router CASE
  aggregate_type: 'organization',
  aggregate_id: orgId,
  event_data: {...},
});
```

**Three-layer routing audit when introducing a new event type** — cross-reference: see `infrastructure-guidelines` Rule 12. Verify emitter sets correct `stream_type`, dispatcher routes to the right router, and the router has a `WHEN 'event.type'` CASE branch. Otherwise the event falls through to `ELSE RAISE EXCEPTION` and surfaces in `processing_error`.

## 3. Saga Compensation for Multi-Step Workflows

Track completion of each step in a `state` object. On failure, compensate **in reverse order** of steps that actually completed. Every workflow with 2+ state-changing activities needs a try/catch with compensation. Compensation activities must be idempotent and must tolerate partial state.

```typescript
const state = { orgId: undefined, dnsConfigured: false, invitationsSent: false };

try {
  state.orgId = await createOrganization({ ...params, tracing: params.tracing });
  await configureDNS({ orgId: state.orgId, tracing: params.tracing });
  state.dnsConfigured = true;
  await sendInvitations({ orgId: state.orgId, tracing: params.tracing });
  state.invitationsSent = true;
} catch (error) {
  // Compensate in REVERSE order; each step in its own try/catch so one failure
  // doesn't prevent the rest. Tolerate partial state (state.X may be false).
  if (state.invitationsSent) {
    try { await revokeInvitations({ orgId: state.orgId! }); }
    catch (e) { log.error('Compensation failed: revoke invitations', { error: e }); }
  }
  if (state.dnsConfigured) {
    try { await removeDNS({ orgId: state.orgId!, subdomain: params.subdomain }); }
    catch (e) { log.error('Compensation failed: remove DNS', { error: e }); }
  }
  if (state.orgId) {
    try { await deactivateOrganization({ orgId: state.orgId }); }
    catch (e) { log.error('Compensation failed: deactivate org', { error: e }); }
  }
  throw error;
}
```

See [error-handling-and-compensation.md](../../../documentation/workflows/guides/error-handling-and-compensation.md) for the full saga pattern, retry policies, and failure event emission.

## 4. Versioning with `patched()` (Not Yet Used in A4C)

When modifying in-flight workflows, use `patched('change-name')` / `deprecatePatch()` to preserve determinism for executions started before the change. **Not currently used in A4C** (only 2 workflows; no long-running production executions needing behavioral changes yet). Before shipping the first `patched` section, coordinate with operators so in-flight executions finish cleanly. Skipping this will cause `NonDeterminismError` on replay.

See [@temporalio/workflow `patched` docs](https://typescript.temporal.io/api/namespaces/workflow) for signatures.

## 5. Tracing: Pass `params.tracing` — Never Generate New

Workflows receive `tracing` from the API handler. **ALWAYS forward it to every activity call.** Never generate a new `correlation_id` inside a workflow — this breaks end-to-end correlation.

```typescript
// ✅ Forward tracing from workflow params to each activity
await createOrgActivity({ orgId, tracing: params.tracing })
await configureDNSActivity({ subdomain, tracing: params.tracing })
await sendInvitationsActivity({ emails, tracing: params.tracing })
```

## 6. Three-Layer Idempotency

Activities are retried on failure; events are processed by projection handlers that may replay. **Idempotency must hold at all three layers** or you get duplicate orgs, duplicate emails, divergent projections.

1. **Workflow-level** — start workflows with **deterministic workflow IDs** (e.g., `org-bootstrap-${orgId}`). Temporal's `WorkflowIdReusePolicy` prevents duplicate executions for the same ID.
2. **Activity-level** — activities that call external APIs must include an **idempotency key** (e.g., pass `orgId` to DNS provisioning, Resend email, etc.) and tolerate seeing "already exists" as success. The `emit_domain_event` utility deduplicates on `event_id`.
3. **Handler-level** — projection handlers use `ON CONFLICT ... DO UPDATE` (see `infrastructure-guidelines` Rule 6) so replaying an event doesn't corrupt the projection.

A workflow whose activities aren't idempotent WILL cause data corruption under retry — Temporal retries by default, and you can't opt out cleanly.

## 7. Explicit Activity Timeouts

Temporal does NOT set a default `startToCloseTimeout`. An activity without one can hang forever, stalling the workflow. **Always** declare timeouts in `proxyActivities`:

```typescript
const { createOrganization, configureDNS, sendInvitations } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',   // maximum time for one execution
  retry: {
    initialInterval: '1 second',
    maximumAttempts: 3,
  },
});
```

Rule of thumb: `startToCloseTimeout` ≥ 2× worst-case activity runtime. Long-running activities (DNS propagation, bulk email) should also declare `heartbeatTimeout` and call `heartbeat()` so Temporal can detect stalled executions without waiting for the full timeout.

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
- `documentation/workflows/reference/event-metadata-schema.md` — Event metadata JSONB schema, W3C Trace Context fields
- `documentation/workflows/guides/error-handling-and-compensation.md` — Saga pattern, retry policies (primary doc for Rule 3)
- `documentation/workflows/guides/triggering-workflows.md` — How events trigger workflows (pg_notify, polling)
- `documentation/workflows/guides/integration-testing.md` — MockActivityEnvironment and workflow replay testing
- `documentation/infrastructure/guides/event-observability.md` — Tracing, failed events, correlation
- `.claude/skills/infrastructure-guidelines/SKILL.md` — Companion skill; see Rule 12 for three-layer event-routing audit referenced in Rule 2
