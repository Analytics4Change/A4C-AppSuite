# Edge Function vs SQL RPC Selection ADR — Context

**Feature**: ADR + guard rails + CI check + migration backlog for choosing between Edge Functions and SQL RPCs in A4C-AppSuite
**Status**: 🟢 ACTIVE — Planning complete, awaiting user LGTM before Phase 1 ADR drafting
**Activated**: 2026-04-24 (after PR #32 merge; satisfies Blocker-3-followup-6)
**Current branch**: `docs/edge-function-vs-sql-rpc-adr`
**Architect pre-review**: `software-architect-dbc` agent `afc812e89a6fbed46` (2026-04-24) — **LGTM-with-remediation**; all 3 MUST-FIX items + 6 SHOULD-ADD items folded into this plan revision.
**Origin**: Raised by `software-architect-dbc` agent `a060ef3faaa5b630c` during PR #32 review. When auditing `manage-user` v11's move to Pattern A v2, the architect concluded a SQL RPC wrapper around `update_notification_preferences` would be "strictly superior architecturally" (single-transaction PL/pgSQL read-back, no two-client-call round-trip), but correctly deferred the refactor to an ADR pass. This dev-doc is that pass.

## Problem Statement

The codebase has two orthogonal ways to implement write operations:

1. **SQL RPCs** — PL/pgSQL functions in the `api.` schema, called by frontend via `supabase.schema('api').rpc(...)`. Single round-trip. RLS + JWT claim helpers enforce auth. Pattern A v2 projection read-back is built into every write RPC after the 2026-04-23 retrofit.

2. **Edge Functions** — Deno TypeScript modules under `infrastructure/supabase/supabase/functions/`, called by frontend via `supabase.functions.invoke(...)`. Run in Deno Deploy. Can hold Supabase Auth admin secrets, call external APIs, forward to the Backend API / Temporal workflow layer, and serve unauthenticated endpoints with bespoke token validation.

We have no written criteria for choosing between them. As a consequence:

- Operations that are really "DB write + auth check + permission check + projection read-back" sometimes land as Edge Functions, because the broader Edge Function already exists and adding a case is easier than extracting to SQL RPC. (`manage-user update_notification_preferences` is the worked example.)
- Pattern A v2 read-back semantics had to be re-implemented in TypeScript in `manage-user` v11 (two separate `supabase.from()` calls to `domain_events` + projection table) where a SQL RPC would have had atomic in-transaction read-back.
- New contributors can't tell which tool to reach for.

## Scope

### In scope
- **ADR** at `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md` establishing:
  - Selection criteria — 5 load-bearing positive indicators + 1 negative indicator + ambiguous-middle rubric
  - Classification of every currently-deployed Edge Function operation against those criteria
  - Explicit **out-of-scope boundary** for Temporal activities (`workflows/`) — they are a third tier governed by workflow-side patterns, NOT covered by this ADR
  - Cross-links to `adr-rpc-readback-pattern.md` and CQRS docs
- **Guard rail update** at `infrastructure/CLAUDE.md` + `.claude/skills/infrastructure-guidelines/SKILL.md` (Layer 2)
- **CI check** — lightweight grep ensuring NEW `supabase/functions/*/index.ts` files cite the ADR in a top-of-file comment (Layer 4, per architect SA2)
- **Follow-up task backlog**: one dev-doc card under `dev/active/` per `candidate-for-extraction` op identified in the inventory (Layer 3)

### Out of scope
- **Actually extracting operations**: this ADR is criteria + classification + mechanism only. Each extraction is its own PR gated by its own dev-doc.
- **Retrofitting existing Edge Functions with Pattern A v2 read-back** (deactivate/reactivate/modify_roles in `manage-user` — per architect MF3 — are separately tracked, NOT cited as reference implementations in this ADR).
- **Temporal activities in `workflows/`**: they share Edge Functions' service-role access but have different failure semantics (saga compensation vs. HTTP response). Declared out-of-scope in ADR body.
- **New Edge Function development guide**: keep the ADR focused on the selection decision. Broader dev-guide content stays in `infrastructure/CLAUDE.md` and existing Edge Function docs.

## Four-Layered Approach (authoritative design, expanded per architect SA2)

This is the load-bearing plan shape. All four layers ship together.

### Layer 1 — ADR as authoritative criteria

The ADR is the source of truth. Every guard rail and every migration card **forward-links** to it. Criteria section enumerates the positive indicators that make Edge Function the correct choice:

1. **Mints auth tokens / creates `auth.users` rows** (Supabase Auth admin API)
2. **Calls external APIs** (Cloudflare, Resend, Backend API, Temporal, any non-Postgres/non-Supabase-internal service)
3. **Forwards to workflow orchestration layer** (Backend API → Temporal workflow trigger)
4. **Unauthenticated entry point with bespoke token validation** (invitation token, password reset, public webhooks — no JWT required; enforcing rate-limiting + correlation-id business-scope lookup is easier in TypeScript than in `anon`-callable SQL)
5. **Read orchestration of cross-tier state** (Temporal workflow status readback, external job queue introspection — not answerable by a single `api.` schema SELECT)

Negative indicator (→ prefer SQL RPC):

- Pure projection mutation + auth check + permission check + Pattern A v2 read-back, with **all I/O confined to PostgreSQL**. This is the `manage-user update_notification_preferences` shape.

**Explicit non-criterion** (architect MF1): "Service-role reads of non-`api.` tables" is NOT load-bearing. A `SECURITY DEFINER` SQL RPC with `SET search_path` can SELECT anything. The CQRS `api.` schema rule is a frontend-query-path boundary, not a PL/pgSQL capability boundary.

### Layer 2 — SKILL.md + CLAUDE.md guard rail on new code

The guard rail catches **new** work opportunistically:

- `infrastructure/CLAUDE.md` gets a new rule: *"Before creating a new Edge Function, consult [adr-edge-function-vs-sql-rpc.md]. SQL RPC is the default; Edge Function requires meeting one of the load-bearing criteria there."*
- `.claude/skills/infrastructure-guidelines/SKILL.md` mirrors the one-line rule so the skill-activation check surfaces it whenever an agent begins infrastructure work.

Opportunistic-migration nudge (separate rule in both files): *"When touching an Edge Function operation classified `candidate-for-extraction` in the ADR's inventory, prefer extracting that operation to an SQL RPC in the same PR."*

### Layer 3 — ADR inventory table = migration backlog

Every current Edge Function operation is classified in the ADR (inventory completed as part of this plan — see `plan.md` Phase 0):

| Classification | Meaning | Next action |
|----------------|---------|-------------|
| `load-bearing` | Meets ≥1 positive indicator | None |
| `candidate-for-extraction` | Meets 0 positive indicators (pure DB + auth + perm + read-back) | Open dev-doc card under `dev/active/<function>-to-sql-rpc/` |
| `partial-candidate` | (Function-level only) — some ops load-bearing, some candidate | One dev-doc card per candidate op |

Each candidate op becomes a dev-doc under `dev/active/<function>-to-sql-rpc/`, with the Blocker-3-followup-7 intent (`manage-user update_notification_preferences`) as the reference template.

### Layer 4 — CI check on new Edge Function file creation (per architect SA2)

**Scope**: NEW-file-only (zero retrofit for the 7 existing functions, avoiding manufactured churn).

A lightweight CI grep enforces that every new file under `supabase/functions/*/index.ts` cites the ADR at the top of the file:

```typescript
/**
 * ADR: documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md
 * Load-bearing criterion: <which positive indicator this function meets>
 */
```

If the comment is missing from a newly-created file, CI fails with a pointer to the ADR's criteria section. Adds a zero-runtime guard on the decision point that SKILL.md rule #2 nudges.

Implementation: single grep-based job in `.github/workflows/supabase-edge-functions-lint.yml` (new file, ~20 lines of bash); triggered on `supabase/functions/**` path changes. Does NOT block touching existing files.

**Why four layers, not three**: Layer 2 (SKILL.md + CLAUDE.md) depends on an agent loading the skill during work — fine for Claude-driven contributions but weak for human PRs that bypass the skill. Layer 4's CI grep is the backstop. Small investment; closes the gap.

## Considerations

- **SQL RPC parity gap**: SQL RPCs can't call external APIs, mint Supabase admin tokens, or serve unauthenticated-but-authorized endpoints without significant ceremony. The criteria must make these bright lines explicit — `load-bearing` classifications always anchor on one of LB1–LB5.
- **Multiple events in one operation**: SQL RPCs can emit multiple events in a single transaction (`api.update_role` emits 1 + N + M events). Not a differentiator.
- **Observability**: Edge Functions log to Deno Deploy; SQL RPCs log via `RAISE NOTICE` / `domain_events.processing_error`. The ADR notes the observability trade-off per classification.
- **Deploy cadence** (per architect BS6): Edge Functions deploy via `supabase functions deploy`; SQL RPCs deploy via migrations. Migration → Edge Function deploy is an ordered dependency at migration time. Extracting an op from Edge Function to SQL RPC **consolidates two deploy surfaces into one** — subtle but real improvement, noted in ADR's Consequences section.
- **Pattern A v2 compliance for load-bearing writes** (per architect BS2): Load-bearing Edge Functions that do DB writes MUST conform to `{success, <entity>}` response shape per `adr-rpc-readback-pattern.md` Decision 4. `manage-user` v11 does this; the ADR codifies it.
- **AsyncAPI contract invariance** (per architect BS3): Migrating an op from Edge Function to SQL RPC does **not** change AsyncAPI event definitions (`stream_type`/`event_type` stay the same). Stated explicitly to prevent "do I need to re-register events?" panic during extraction.
- **Rollout risk**: Migrating from Edge Function to SQL RPC changes the frontend call site (`functions.invoke()` → `rpc()`). Backward-compat is not free. Each `candidate` card owns its own rollout plan.

## Relationship to Other Work

- **Depends on**: `adr-rpc-readback-pattern.md` (Pattern A v2 is the SQL-RPC-side contract; this ADR cites it as the minimum bar any extraction must clear).
- **Unblocks**: Blocker-3-followup-7 (`manage-user` → SQL RPC extraction, specifically `update_notification_preferences` as the first op). Architect `a060ef3faaa5b630c` already validated the extraction as "strictly superior architecturally".
- **Interacts with**: CQRS rule in `infrastructure/CLAUDE.md` Rule 4 (frontend → `api.` RPC only). The ADR clarifies that Rule 4 applies to **browser-facing** clients; Edge Functions (orchestration tier) are exempt and can read any table via service-role. This was implicit in the `invite-user` and `manage-user` v11 patterns but has never been written down.
- **Out-of-scope boundary (BS1)**: Temporal activities under `workflows/` share Edge Functions' service-role access but different failure semantics. ADR declares them out-of-scope and defers governance to workflow-side patterns.
- **Companion updates**: One-line cross-link added to `adr-rpc-readback-pattern.md` Related Documentation section.

## Reference Materials

- PR #32 architect review (`software-architect-dbc` agent `a060ef3faaa5b630c`) — strictly-superior finding + Edge-Function-as-orchestration-tier validation
- PR #32 plan pre-review (`software-architect-dbc` agent `afc812e89a6fbed46`, 2026-04-24) — LGTM-with-remediation + 3 MUST-FIX + 6 SHOULD-ADD folded into this revision
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` (v11) — reference implementation of Pattern A v2 in an Edge Function, **scoped to `update_notification_preferences` only** per architect MF3 (other ops still have the pre-v11 gap)
- `infrastructure/supabase/supabase/functions/invite-user/index.ts` — precedent for service-role direct-table reads (`organizations_projection`)
- `documentation/architecture/decisions/adr-rpc-readback-pattern.md` — SQL-RPC-side contract
- `documentation/architecture/decisions/adr-client-ou-placement.md` — example of an ADR with enforcement/rollout history section
- `infrastructure/CLAUDE.md` Rule 4 (CQRS), Rule 9 (API functions), Rule 13 (projection read-back guard)
- `dev/archived/api-rpc-readback-pattern/` — adjacent work that motivated this ADR

## Important Constraints

- **ADR must ship before followup-7 starts**: the `manage-user update_notification_preferences` extraction plan depends on this ADR's criteria being final.
- **No rewrites in this PR**: Layer 3's inventory classifies, it doesn't execute. Keep the PR tight — drift between criteria and execution is high-risk.
- **Four layers land together**: Layers 1 + 2 + 3 + 4 ship in the same PR so no forward-link target is ever dangling and the CI check is active when the first new Edge Function hits main.
- **Anti-staleness**: follow SKILL.md Rule 8 — no hardcoded inventory counts in the ADR's criteria section. The inventory **table** is a point-in-time snapshot with a date stamp; the criteria are the durable part. A grep recipe is embedded so future readers can re-audit without trusting the snapshot.
- **ADR versioning** (per architect SA3): `**ADR version**: v1` in frontmatter; future revisions append Rollout history entries + migration notes in `MEMORY.md`.
