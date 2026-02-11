# Context: Handler Reference Files

## Decision Record

**Date**: 2026-02-11
**Feature**: Extract SQL handler reference files from baseline migration
**Goal**: Give AI agents canonical, copy-paste-ready `.sql` files for every event handler and router, eliminating rewrite-from-memory errors and column name drift.

### Key Decisions

1. **Reference files over code generation**: The original YAML code generation plan (2026-01-20) was over-engineered — it required a live database for validation, but during feature development the schema is changing in the same migration. Simple `.sql` reference files solve the actual problem: agents rewriting handlers from memory instead of copying existing code.

2. **Extract from live DB, not baseline file**: The 14,648-line baseline migration (`20260121000918_baseline_v3.sql`) has encoding quirks that make local grep unreliable. Using `pg_get_functiondef()` against the live Supabase database gives the authoritative, post-all-migrations source.

3. **One function per file**: Each `.sql` file contains exactly one `CREATE OR REPLACE FUNCTION` statement. No headers, no wrappers — just the canonical SQL ready to copy into a migration.

4. **Organized by domain**: Handler files are grouped by domain (user/, organization/, rbac/, etc.) matching the `stream_type` routing in `process_domain_event()`.

5. **Dead code dropped, not archived**: Rather than isolating `process_rbac_events` and `process_program_event` in a `_deprecated/` directory, we drop them via migration. Similarly, the 4 dead CASE branches in `process_domain_event()` for non-existent routers (`client`, `medication`, `medication_history`, `dosage`) are removed so those stream types hit the explicit `ELSE RAISE EXCEPTION` path. When a new domain is supported, the router function and dispatcher branch are added together in the same migration.

## Technical Context

### Architecture

The event processing chain flows:

```
domain_events INSERT
  → process_domain_event_trigger (BEFORE INSERT/UPDATE)
    → process_domain_event() [main dispatcher]
      → routes by stream_type to process_*_event() [routers]
        → routes by event_type to handle_*() [handlers]
          → updates projection tables
```

Additionally, 4 AFTER INSERT triggers handle bootstrap workflows and queue projections.

### Live Database Inventory (2026-02-11)

**Triggers on `domain_events`** (5):
| Trigger | Timing | Function |
|---------|--------|----------|
| `process_domain_event_trigger` | BEFORE INSERT/UPDATE | `process_domain_event()` |
| `bootstrap_workflow_trigger` | AFTER INSERT | `handle_bootstrap_workflow()` |
| `enqueue_workflow_from_bootstrap_event_trigger` | AFTER INSERT | `enqueue_workflow_from_bootstrap_event()` |
| `trigger_notify_bootstrap_initiated` | BEFORE INSERT | `notify_workflow_worker_bootstrap()` |
| `update_workflow_queue_projection_trigger` | AFTER INSERT | `update_workflow_queue_projection_from_event()` |

**Routers** (15 functions, 14 active dispatched + 1 legacy):

Active (dispatched by `process_domain_event()`):
- `process_user_event` (stream_type: user)
- `process_organization_event` (stream_type: organization)
- `process_organization_unit_event` (stream_type: organization_unit)
- `process_rbac_event` (stream_type: role, permission)
- `process_client_event` (stream_type: client) — **referenced by dispatcher but NOT in DB yet**
- `process_medication_event` (stream_type: medication) — **referenced by dispatcher but NOT in DB yet**
- `process_medication_history_event` (stream_type: medication_history) — **referenced by dispatcher but NOT in DB yet**
- `process_dosage_event` (stream_type: dosage) — **referenced by dispatcher but NOT in DB yet**
- `process_contact_event` (stream_type: contact)
- `process_address_event` (stream_type: address)
- `process_phone_event` (stream_type: phone)
- `process_email_event` (stream_type: email)
- `process_invitation_event` (stream_type: invitation)
- `process_access_grant_event` (stream_type: access_grant)
- `process_impersonation_event` (stream_type: impersonation)
- `process_junction_event` (event_type: `*.linked` / `*.unlinked`)

Legacy/dead (to be dropped in Phase 4):
- `process_rbac_events` (plural) — superseded by `process_rbac_event`
- `process_program_event` — exists in DB but not dispatched (dead code from cleanup)

**Handlers** (51 functions):
- user domain: 16 handlers
- organization domain: 10 handlers
- organization_unit domain: 5 handlers
- rbac domain: 9 handlers
- bootstrap domain: 3 handlers
- invitation domain: 1 handler
- Other domains (client, medication, etc.): handlers may not exist yet — routers are stubs

### Dependencies

- Supabase MCP tool for `execute_sql` (extracting function definitions)
- `infrastructure/CLAUDE.md` — event handler architecture section
- `.claude/skills/infrastructure-guidelines/SKILL.md` — rule additions
- `documentation/infrastructure/patterns/event-handler-pattern.md` — reference file section
- `documentation/AGENT-INDEX.md` — keyword entry

## File Structure

### New Files Created
- `infrastructure/supabase/handlers/README.md` — Purpose, sync rules, usage
- `infrastructure/supabase/handlers/trigger/*.sql` — 5 trigger function files
- `infrastructure/supabase/handlers/routers/*.sql` — 12 active router files
- `infrastructure/supabase/handlers/user/*.sql` — 16 handler files
- `infrastructure/supabase/handlers/organization/*.sql` — 10 handler files
- `infrastructure/supabase/handlers/organization_unit/*.sql` — 5 handler files
- `infrastructure/supabase/handlers/rbac/*.sql` — 9 handler files
- `infrastructure/supabase/handlers/bootstrap/*.sql` — 3 handler files
- `infrastructure/supabase/handlers/invitation/*.sql` — 1 handler file
- New Supabase migration — removes 4 dead CASE branches + drops 2 legacy functions

### Existing Files Modified
- `infrastructure/CLAUDE.md` — Add handler reference file instructions, update counts
- `.claude/skills/infrastructure-guidelines/SKILL.md` — Add rule 7b
- `documentation/infrastructure/patterns/event-handler-pattern.md` — Add reference file section
- `documentation/AGENT-INDEX.md` — Add `handler-reference` keyword

## Important Constraints

1. **4 dead dispatcher branches**: `client`, `medication`, `medication_history`, `dosage` CASE branches in `process_domain_event()` reference non-existent router functions. Phase 4 migration removes these branches so those stream types hit the explicit `ELSE RAISE EXCEPTION` path. No reference files are created for non-existent functions.

2. **Baseline file encoding**: The baseline migration has UTF-8 encoding that causes grep tools to fail silently. Always use `pg_get_functiondef()` from the live DB as the authoritative source.

3. **Post-baseline mutations**: Several migrations after the baseline modified handlers (e.g., `20260206234839_fix_p0_cqrs_critical_bugs.sql`, `20260207000203_p1_remove_dual_writes_fix_resend.sql`). The DB reflects the final state after all migrations.

4. **handler-reference-files.md is the original plan**: The existing `dev/active/handler-reference-files.md` is the decision record. It should be archived (not deleted) after implementation, along with any old `handler-code-generation-*` files.

## Why This Approach?

**Alternatives considered:**

| Approach | Why rejected |
|----------|-------------|
| YAML code generation with TypeScript validator | Chicken-and-egg: needs live DB during migration authoring |
| Inline comments in baseline migration | 14K-line file is too large to navigate; agents skip to "what they remember" |
| Documentation-only (describe handlers in .md) | Agents still rewrite SQL from understanding instead of copying |
| Automated CI sync check | Good future enhancement, but reference files must exist first |

**Why reference files work:**
- Zero tooling dependencies — just files on disk
- Copy-paste workflow matches how agents actually work
- One-time extraction cost, low ongoing maintenance
- Agents can read a 30-line file instead of searching a 14K-line migration
