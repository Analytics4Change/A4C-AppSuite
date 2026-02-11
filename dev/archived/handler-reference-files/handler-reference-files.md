# Handler Reference Files + Agent Context Improvement

## Decision Record

**Date**: 2026-02-06
**Replaces**: `handler-code-generation-*` (YAML code generation plan, deferred 2026-01-20)
**Status**: Ready for implementation

## Problem

All event handlers and routers are buried in the 14,648-line baseline migration (`20260121000918_baseline_v3.sql`). When an AI agent needs to modify or create handlers — during Day 0 baseline resets or feature development — it rewrites SQL from its understanding instead of copying existing code. This introduces column name drift and other errors.

The original YAML code generation plan was over-engineered and doesn't fit the development workflow: the generator needs a live database to validate schema, but during feature development the schema is changing in the same migration.

## Why the Original Plan Doesn't Work

The YAML code generation plan (2026-01-20) proposed:
- YAML config files mapping events → projections
- A TypeScript generator that reads YAML + validates against live DB schema
- Shadow mode rollout with CI diff validation

**Problems with this approach**:
1. **Chicken-and-egg during development**: Generator needs tables to exist for validation, but tables are created in the same migration as handlers
2. **Heavy indirection**: YAML config + generator + validation for handlers that are written once and rarely change
3. **Most handlers are authored once**: The drift problem is about initial authoring mistakes, not ongoing drift
4. **plpgsql_check already catches column errors at CI time**

## Proposed Solution

Extract each handler and router into individual `.sql` reference files, and add agent instructions to always read these files before writing handler code.

### Architecture (Deployed, Verified 2026-02-06)

**Triggers on `domain_events`** (5 total, all enabled):

| Trigger | Timing | Function | Purpose |
|---------|--------|----------|---------|
| `process_domain_event_trigger` | BEFORE INSERT/UPDATE | `process_domain_event()` | Main event router → handlers |
| `bootstrap_workflow_trigger` | AFTER INSERT | `handle_bootstrap_workflow()` | Bootstrap failure cleanup |
| `enqueue_workflow_from_bootstrap_event_trigger` | AFTER INSERT | `enqueue_workflow_from_bootstrap_event()` | Workflow queue |
| `trigger_notify_bootstrap_initiated` | BEFORE INSERT | `notify_workflow_worker_bootstrap()` | pg_notify to Temporal |
| `update_workflow_queue_projection_trigger` | AFTER INSERT | `update_workflow_queue_projection_from_event()` | Workflow queue projection |

**Routers** (16, not 4 as previously documented):

| Router | Stream Type(s) |
|--------|---------------|
| `process_user_event` | user |
| `process_organization_event` | organization |
| `process_organization_unit_event` | organization_unit |
| `process_rbac_event` | role, permission |
| `process_client_event` | client |
| `process_medication_event` | medication |
| `process_medication_history_event` | medication_history |
| `process_dosage_event` | dosage |
| `process_contact_event` | contact |
| `process_address_event` | address |
| `process_phone_event` | phone |
| `process_email_event` | email |
| `process_invitation_event` | invitation |
| `process_access_grant_event` | access_grant |
| `process_impersonation_event` | impersonation |
| `process_junction_event` | (any `*.linked` / `*.unlinked`) |

**Handlers**: 41+ individual `handle_*()` functions

### Proposed Directory Structure

```
infrastructure/supabase/handlers/
├── README.md                           # Purpose, sync rules, usage
├── trigger/
│   └── process_domain_event.sql        # Main trigger function
├── routers/
│   ├── process_user_event.sql
│   ├── process_organization_event.sql
│   ├── process_organization_unit_event.sql
│   ├── process_rbac_event.sql
│   ├── process_client_event.sql
│   ├── process_medication_event.sql
│   ├── process_medication_history_event.sql
│   ├── process_dosage_event.sql
│   ├── process_contact_event.sql
│   ├── process_address_event.sql
│   ├── process_phone_event.sql
│   ├── process_email_event.sql
│   ├── process_invitation_event.sql
│   ├── process_access_grant_event.sql
│   ├── process_impersonation_event.sql
│   └── process_junction_event.sql
├── user/                               # Handlers for stream_type = 'user'
├── organization/                       # Handlers for stream_type = 'organization'
├── organization_unit/                  # Handlers for stream_type = 'organization_unit'
├── rbac/                               # Handlers for stream_type = 'role'/'permission'
└── ... (one dir per domain with handlers)
```

Each file: one `CREATE OR REPLACE FUNCTION` statement, complete, copy-pasteable.

### Agent Instructions to Add

**infrastructure/CLAUDE.md** — add subsection under Event Handler Architecture:
- "Before modifying a handler, read from `handlers/<domain>/<handler>.sql`"
- "Copy the existing implementation and modify the copy"
- "After creating a migration that changes a handler, update the reference file"

**.claude/skills/infrastructure-guidelines/SKILL.md** — add rule 7b:
- "Handler Reference Files — Always Read Before Writing"

**documentation/infrastructure/patterns/event-handler-pattern.md** — add section pointing to reference files

**documentation/AGENT-INDEX.md** — add `handler-reference` keyword

### Other Changes

- Archive `dev/active/handler-code-generation-*` to `dev/archived/`
- Update event-handler-pattern.md to reflect 16 routers (not 4)
- Update infrastructure/CLAUDE.md to reflect 5 triggers (not 1)

## Implementation Steps

1. Extract all handler and router functions from baseline + post-baseline migrations (use latest version)
2. Create directory structure and individual `.sql` files
3. Update agent instructions (CLAUDE.md, SKILL.md, event-handler-pattern.md, AGENT-INDEX.md)
4. Archive old code generation dev files
5. Verify: every handler in DB has a corresponding reference file

## Documentation Drift Found

During investigation (2026-02-06), the following documentation inaccuracies were identified:
- `event-handler-pattern.md` says "4 routers" — actually 16
- `infrastructure/CLAUDE.md` says "4 routers, 37 handlers" — actually 16 routers, 41+ handlers
- Documentation says "single trigger" — actually 5 triggers on `domain_events`
- These should be corrected as part of implementation
