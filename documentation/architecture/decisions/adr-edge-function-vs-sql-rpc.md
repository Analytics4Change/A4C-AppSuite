---
status: current
last_updated: 2026-04-24
adr_version: v1
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: SQL RPC is the default for write operations in A4C-AppSuite; Edge Functions are reserved for operations meeting ≥1 of six load-bearing criteria (LB1–LB6). Every new Edge Function file must cite this ADR; existing ops classified `candidate-for-extraction` in the inventory are migration targets tracked under `dev/active/<function>-to-sql-rpc/`.

**When to read**:
- Creating a new Edge Function or new `api.*` write RPC
- Reviewing a PR that adds a new operation to an existing Edge Function
- Classifying an ambiguous case where the choice isn't obvious
- Planning extraction of an Edge Function operation to a SQL RPC

**Prerequisites** (recommended): [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md), [event-handler-pattern.md](../../infrastructure/patterns/event-handler-pattern.md)

**Key topics**: `adr`, `edge-function`, `sql-rpc`, `orchestration-tier`, `cqrs`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# ADR: Edge Function vs SQL RPC Selection

**Date**: 2026-04-24
**Status**: Current (initial publication)
**ADR version**: v1
**Deciders**: Lars (architect), software-architect-dbc (pre-review agents `a060ef3faaa5b630c` + `afc812e89a6fbed46`), Claude (drafting)

## Context

A4C-AppSuite has two orthogonal ways to implement write operations invoked by the frontend:

1. **SQL RPCs** — PL/pgSQL functions in the `api.` schema, called via `supabase.schema('api').rpc(...)`. Single round-trip. RLS + JWT claim helpers (`get_current_org_id()`, `has_platform_privilege()`) enforce auth. After the 2026-04-23 retrofit (see [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md)), every write RPC follows Pattern A v2 (in-transaction projection read-back + captured-event-id processing_error check).

2. **Edge Functions** — Deno TypeScript modules under `infrastructure/supabase/supabase/functions/`, called via `supabase.functions.invoke(...)`. Run in Deno Deploy. Can hold Supabase Auth admin secrets, call external APIs, forward to the Backend API / Temporal workflow layer, and serve unauthenticated endpoints with bespoke token validation.

Until now, no written criteria distinguished them. As a consequence:

- Operations that are really "DB write + auth check + permission check + projection read-back" sometimes landed as Edge Functions, because the broader Edge Function already existed and adding a `case` branch was easier than extracting to SQL RPC. The concrete example: `manage-user update_notification_preferences`, which surfaced during PR #32 review. Software-architect-dbc (agent `a060ef3faaa5b630c`) concluded a SQL RPC wrapper would be "strictly superior architecturally" — single-transaction PL/pgSQL read-back, no two-client-call round-trip. The extraction was deferred to this ADR pass.
- Pattern A v2 read-back semantics had to be re-implemented in TypeScript in `manage-user` v11 (two separate `supabase.from()` calls — one to `domain_events`, one to `user_notification_preferences_projection`) where a SQL RPC would have had atomic in-transaction read-back.
- New contributors could not tell which tool to reach for; PR reviewers could not consistently redirect.

This ADR establishes selection criteria, classifies every currently-deployed Edge Function operation against those criteria, and lands a four-layer enforcement mechanism to keep the decision consistent over time.

A pre-review was conducted with `software-architect-dbc` agent `afc812e89a6fbed46` (2026-04-24). Verdict: LGTM-with-remediation; all 3 MUST-FIX items + 6 SHOULD-ADD items integrated before Phase 1 drafting. Key architect-driven decisions:
- Removed "service-role reads of non-`api.` tables" as a positive indicator (false-positive — `SECURITY DEFINER` SQL RPCs can read any table)
- Scoped Pattern A v2 reference-implementation citation to `update_notification_preferences` only (other `manage-user` ops still have the pre-v11 silent-failure gap; retrofit tracked separately)
- Added CI citation check as a fourth enforcement layer (zero retrofit for existing files)

## Decisions

### Decision 1 — SQL RPC is the default for write operations

**Decision**: Any new write operation invoked by the frontend MUST be a SQL RPC in the `api.` schema unless it meets at least one load-bearing criterion from Decision 2. Existing Edge Function operations classified `candidate-for-extraction` in the inventory (see below) are migration targets.

**Rationale**: SQL RPCs are cheaper architecturally — single round-trip, in-transaction Pattern A v2 semantics, RLS enforcement without TypeScript mirroring, one deploy surface (migrations) instead of two (migrations + `supabase functions deploy`). Every Edge Function adds an orchestration boundary; every orchestration boundary must justify itself.

### Decision 2 — Load-bearing criteria (LB1–LB6)

An operation is `load-bearing` (→ Edge Function is appropriate) if it meets **one or more** of:

- **LB1 — Mints auth tokens or creates `auth.users` rows.** Requires the Supabase Auth admin client (`supabase.auth.admin.createUser()`, `updateUserById()`, `deleteUser()`) with the service-role secret. Cannot be done from PostgreSQL.
- **LB2 — Calls external APIs.** Any non-PostgreSQL, non-Supabase-internal service: Cloudflare (DNS), Resend (email), Backend API (workflow trigger), Temporal, OAuth providers, etc. PL/pgSQL can invoke HTTP via `pg_net`, but this is discouraged for credential handling, retry semantics, and observability reasons.
- **LB3 — Forwards to workflow orchestration layer.** Requests that dispatch to the Backend API → Temporal must pass JWT + auth headers through a trusted edge. The Edge Function is the canonical boundary.
- **LB4 — Unauthenticated entry point with bespoke token validation.** Invitation-token acceptance, password-reset links, public webhooks — cases where no JWT is available and a custom token (invitation UUID, magic link hash) must be validated. SQL RPCs can be granted to `anon`, but rate-limiting + correlation-id business-scope lookup + token-hash verification is easier to read in TypeScript.
- **LB5 — Read orchestration of cross-tier state.** Querying Temporal workflow status, external job queues, or other non-PostgreSQL state that can't be answered by a single `api.*` schema SELECT. Example: `workflow-status` reads `bootstrap_workflows` (a projection) but composes the response against Temporal's workflow lifecycle.
- **LB6 — Emits to a stream whose caller's JWT cannot be RLS-authorized.** The narrow but real case where events must be emitted before the authoritative user/org exists in `auth.users` / `organizations_projection`. `accept-invitation` is the canonical example: it emits `user.created` + `user.role.assigned` + `user.phone.added` for a user that did not exist when the invitation was created.

An operation meeting **zero** of LB1–LB6 is `candidate-for-extraction`: SQL RPC is the correct fit.

### Decision 3 — Explicit non-criterion: service-role reads of non-`api.` tables are NOT load-bearing

**Decision**: "This Edge Function reads `organizations_projection` / `user_notification_preferences_projection` / etc. via the service-role client" is **not** a reason to keep it as an Edge Function.

**Rationale**: A `SECURITY DEFINER` SQL RPC with `SET search_path = public, api, pg_temp` can SELECT from any table. The `api.` schema boundary is a **CQRS rule on the frontend query path** (per [infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md) Rule 4), NOT a capability boundary on PL/pgSQL. If the only reason to keep an op in an Edge Function is "it reads a table outside `api.`", extract it — the equivalent SQL RPC is straightforward.

This resolves the MF1 ambiguity flagged during architect pre-review: `invite-user`'s direct read of `organizations_projection` is cited as precedent for service-role reads in the codebase (which IS legitimate inside an Edge Function) but does not itself make the function load-bearing. `invite-user` is load-bearing because it mints auth users (LB1) and calls Resend (LB2), not because it reads orgs.

### Decision 4 — Edge Functions are the orchestration tier; CQRS Rule 4 does not apply to them

**Decision**: The "frontend queries go via `api.` schema RPC only" rule ([infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md) Rule 4) is a **browser-facing** contract. Edge Functions run server-side with the service-role secret, outside the RLS enforcement boundary. They may read any table via the service-role client when needed.

**Rationale**: Edge Functions ARE the trust boundary between the browser and the DB-internal projection surface. Once a request is inside an Edge Function, the JWT verification + permission check have already happened. The CQRS rule is protecting the OUT-bound surface (browser can't compose queries that bypass RLS by joining two projections); it is not protecting the INBOUND surface (Edge Function reading for response shaping).

Precedent:
- `invite-user` reads `organizations_projection` directly (via service-role) to embed org context in the invitation email
- `manage-user` v11 reads `user_notification_preferences_projection` directly for its Pattern A v2 read-back

Both are legitimate.

### Decision 5 — Pattern A v2 compatibility for load-bearing Edge Function writes

**Decision**: Any Edge Function operation that (a) remains classified `load-bearing` AND (b) performs a DB write MUST implement the two-step Pattern A v2 check via the service-role client:

1. Capture `eventId` from `api.emit_domain_event(...)` return value
2. After emit: SELECT `processing_error FROM domain_events WHERE id = eventId` — return error envelope if populated
3. SELECT the projection row to confirm the write applied; return error envelope on NOT FOUND (tagged `handlerInvariantViolated: true` in logs since handlers should UPSERT)
4. Transform DB columns to the AsyncAPI snake_case shape and include in response: `{success: true, <entity>}`
5. Response shape conforms to `adr-rpc-readback-pattern.md` Decision 4: `{success, error?, <entity>?}`

**Reference implementation**: `infrastructure/supabase/supabase/functions/manage-user/index.ts` v11, `update_notification_preferences` operation ONLY. Other `manage-user` operations (`deactivate`, `reactivate`, `delete`, `modify_roles`) retain the pre-v11 emit-and-return-success shape and are flagged "Pattern A v2 retrofit TBD" in the inventory. **Do not cite them as references** — the retrofit is a separate follow-up.

**Race safety**: `domain_events.id = eventId` is an indexed PK lookup. The `BEFORE INSERT` trigger `process_domain_event()` runs inside the INSERT transaction, which commits before `api.emit_domain_event(...)` returns. The subsequent Edge Function round-trip always sees the final state of `processing_error` (populated if handler raised, NULL if handler succeeded).

**SQL RPC form is simpler**: the same two-step check is a single PL/pgSQL function body with in-transaction SELECTs — see `adr-rpc-readback-pattern.md` Decisions 1+2 for the canonical form. This is the architectural asymmetry that motivates Decision 1 (SQL RPC is the default).

### Decision 6 — Four-layer enforcement mechanism

To keep the selection criteria consistent over time, four enforcement layers ship together:

**Layer 1 — This ADR as authoritative criteria.** Every guard rail and every migration card forward-links here. Versioned (`adr_version: v1` in frontmatter); future revisions append to Rollout history.

**Layer 2 — SKILL.md + CLAUDE.md guard rails on new work.** Two rules mirrored across `infrastructure/CLAUDE.md` and `.claude/skills/infrastructure-guidelines/SKILL.md`:
- *"Before creating a new Edge Function, consult this ADR. SQL RPC is the default; Edge Function requires meeting one of the load-bearing criteria (LB1–LB6)."*
- *"When touching an Edge Function operation classified `candidate-for-extraction` in the inventory, prefer extracting that operation to an SQL RPC in the same PR."*

**Layer 3 — Inventory table as migration backlog.** Every `candidate-for-extraction` op in the inventory seeds a `dev/active/<function>-to-sql-rpc/` folder. The inventory is a point-in-time snapshot (date-stamped with a regeneration recipe); the criteria above are the durable part.

**Layer 4 — CI citation check (NEW-file only).** `.github/workflows/supabase-edge-functions-lint.yml` enforces that new files under `supabase/functions/*/index.ts` cite this ADR in a top-of-file comment:

```typescript
/**
 * ADR: documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md
 * Load-bearing criterion: <which LB this function meets, e.g. "LB1 + LB2">
 */
```

The grep uses `git diff --diff-filter=A` so existing file modifications are never blocked. Zero retrofit burden.

## Hybrid case walkthrough — `organization-delete`

Some Edge Functions combine permission checks, `api.*` RPC calls, and workflow-layer forwards. `organization-delete` is the canonical example:

1. Validates JWT + permission (`organization.delete`) — could be SQL RPC
2. Calls `api.soft_delete_organization(org_id, reason)` via the service-role client — could be SQL RPC
3. Forwards to Backend API → Temporal workflow trigger for downstream cleanup (DNS, email, cross-tier resources) — **LB3: forwarding to workflow orchestration layer**

Classification: `load-bearing` via LB3. The orchestration-tier forward is the load-bearing capability; steps 1–2 are not independently load-bearing but travel with step 3 naturally (the forward needs the auth'd context + the event emission for downstream consumers).

**Pitfall** the classifier must avoid: "step 1 is SQL-RPC-eligible, step 2 is SQL-RPC-eligible, therefore this is mostly SQL-RPC-eligible and we should split it." That reasoning ignores that the operation's **purpose** is step 3; splitting creates a choreography where the frontend must separately call RPC then Edge Function, multiplying failure modes. Keep the function intact.

## Out-of-scope boundary — Temporal activities

Temporal activities under `workflows/src/activities/` share Edge Functions' service-role access but have **different failure semantics**: saga compensation + retry queues + workflow history, not HTTP request/response. This ADR does **not** govern them. Activity-layer selection is governed by `workflows/src/activities/CLAUDE.md` and the three-layer idempotency pattern documented there.

If a future activity could plausibly be an Edge Function or SQL RPC, escalate the case separately. Don't apply LB1–LB6 to activities — the criteria are calibrated for HTTP-request boundaries.

## Inventory (as of 2026-04-24)

**Point-in-time snapshot** (per SKILL.md anti-staleness Rule 8). Regenerate via:

```bash
# List all Edge Functions
find infrastructure/supabase/supabase/functions -name 'index.ts' -not -path '*/_shared/*'

# Per-operation inspection: search top-level switch on 'operation' param;
# read the body of each case and answer LB1-LB6.
```

Total: 16 operations across 7 functions, 3,390 LOC. **12 load-bearing** + **4 candidate-for-extraction** (one of which — `update_notification_preferences` — is also the sole Pattern A v2 reference implementation per Decision 5).

| # | Function | Operation | LB1 | LB2 | LB3 | LB4 | LB5 | LB6 | Classification | Notes |
|---|----------|-----------|-----|-----|-----|-----|-----|-----|----------------|-------|
| 1 | `accept-invitation` | email/password + oauth user creation | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | **load-bearing** | Mints auth user; invitation-token auth; pre-user events |
| 2 | `accept-invitation` | emit `user.role.assigned` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | **load-bearing** | |
| 3 | `accept-invitation` | emit `user.phone.added` + `user.notification_preferences.updated` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | **load-bearing** | |
| 4 | `accept-invitation` | query organization for redirect | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | **load-bearing** | LB4 — unauthenticated via invitation token |
| 5 | `invite-user` | `create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | Ensures auth.users + Resend API email |
| 6 | `invite-user` | `resend` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | Resend API |
| 7 | `invite-user` | `revoke` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | Pure RPC + event emission on existing invitation |
| 8 | `manage-user` | `deactivate` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | LB1 — `auth.admin.updateUserById` ban. **Pattern A v2 retrofit TBD** |
| 9 | `manage-user` | `reactivate` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **load-bearing** | LB1 — ban reversal. **Pattern A v2 retrofit TBD** |
| 10 | `manage-user` | `delete` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | Pure RPC + event. **Pattern A v2 retrofit inherited on extraction** |
| 11 | `manage-user` | `modify_roles` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | Pure RPC + 1+N+M events. **Pattern A v2 retrofit TBD** |
| 12 | `manage-user` | `update_notification_preferences` (v11) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **candidate-for-extraction** | **Pattern A v2 reference implementation**; architect-validated first extraction target |
| 13 | `organization-bootstrap` | initiate workflow | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | **load-bearing** | Backend API + workflow status response |
| 14 | `organization-delete` | trigger deletion | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | **load-bearing** | **Hybrid** — see walkthrough above |
| 15 | `validate-invitation` | lookup + validate | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | **load-bearing** | LB4 — unauthenticated bespoke token validation |
| 16 | `workflow-status` | query status | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | **load-bearing** | LB5 — cross-tier state orchestration |

### Function-level composition

| Function | Composition |
|----------|-------------|
| `accept-invitation` | All 4 ops load-bearing |
| `invite-user` | **partial-candidate** (2 load-bearing + 1 candidate `revoke`) |
| `manage-user` | **partial-candidate** (2 load-bearing + 3 candidates) |
| `organization-bootstrap` | Load-bearing whole-function |
| `organization-delete` | Load-bearing whole-function (hybrid) |
| `validate-invitation` | Load-bearing whole-function |
| `workflow-status` | Load-bearing whole-function |

### Candidate extraction backlog

Each row below is a seeded follow-up card under `dev/active/<folder>/`:

| Priority | Card | Source op | Notes |
|----------|------|-----------|-------|
| **High** | `dev/active/manage-user-to-sql-rpc/` | `update_notification_preferences` | Architect-validated first target. Supersedes Blocker-3-followup-7. Scope = this one op only. |
| Medium | `dev/active/invite-user-revoke-to-sql-rpc/` | `invite-user revoke` | Pure RPC wrapper; no rollout complexity |
| Medium | `dev/active/manage-user-delete-to-sql-rpc/` | `manage-user delete` | Couples with Pattern A v2 retrofit opportunity |
| Low | `dev/active/manage-user-modify-roles-to-sql-rpc/` | `manage-user modify_roles` | 1+N+M event emission; revisit after High-priority card ships |

### Inventory cadence

Walk the inventory every 6 months or when adding a new Edge Function. Append Rollout history entries when a `candidate` extraction ships (moves a row out of `candidate` → "extracted; see migration X").

## Rollout history

- **2026-04-24** — Initial publication (`adr_version: v1`). Establishes criteria LB1–LB6, inventory of 16 operations across 7 functions, four-layer enforcement mechanism (this ADR + `infrastructure/CLAUDE.md` guard rails + `.claude/skills/infrastructure-guidelines/SKILL.md` mirror + CI citation check). Seeds 4 extraction follow-up cards. No operations extracted in this PR.

## Alternatives considered

### Status quo (no written criteria)

Rejected. Evidence: `manage-user update_notification_preferences` is the worked example — it landed as an Edge Function `case` branch because that was the path of least resistance at the time, not because it met any load-bearing criterion. Software-architect-dbc (agent `a060ef3faaa5b630c`) reviewing PR #32 concluded a SQL RPC wrapper would be "strictly superior architecturally" but correctly deferred the extraction to this ADR pass. Continuing without criteria would repeat this pattern with every new feature.

### All Edge Functions, no SQL RPCs

Rejected. Violates Pattern A v2 atomicity — the in-transaction read-back is only possible inside a single PL/pgSQL function body. Two-step TypeScript implementations (e.g., `manage-user` v11) work but are strictly more complex: two `supabase.from()` round-trips, manual snake↔camel conversion, version-gated response envelope. Reference: [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md) Decisions 1–4.

### All SQL RPCs, no Edge Functions

Rejected. Capability gaps are bright lines:
- **LB1** (auth user creation, token minting) — requires the Supabase Auth admin client, not available to PL/pgSQL
- **LB2** (external APIs) — `pg_net` exists but is discouraged for credential handling, retry semantics, and observability
- **LB3** (workflow-layer forwarding) — needs trusted JWT-forwarding edge
- **LB4** (unauthenticated token auth) — requires rate limiting + correlation-id lookup; impractical in `anon`-callable SQL
- **LB5** (cross-tier read orchestration) — requires Temporal client / external queue client

### Per-function (not per-operation) classification

Rejected during architect pre-review (agent `afc812e89a6fbed46`, Q3). `manage-user` is the counterexample: 2 load-bearing ops (deactivate/reactivate use `auth.admin`) + 3 candidate ops. Forcing it into a single bucket either freezes the 3 extractable ops as load-bearing (overclaim) or classifies the whole function as candidate (ignoring `auth.admin`). Per-operation granularity with a function-level `partial-candidate` summary tag is the correct cut.

### Helper function to eliminate the Pattern A v2 two-step boilerplate in Edge Functions

Not a rejection — a noted follow-up. The TypeScript two-step check in `manage-user` v11 is ~30 lines of boilerplate that would be ~5 lines in SQL RPC. If multiple Edge Functions end up staying load-bearing AND doing DB writes, a shared `_shared/pattern-a-v2-check.ts` helper would reduce duplication. Orthogonal to this ADR; revisit when the duplicate sites exist.

## Consequences

### Predictability and review speed

- New-feature authors have a decision flow: "Does my op meet LB1–LB6? If no → SQL RPC."
- PR reviewers have a consistent redirect: "This is `candidate-for-extraction` per the inventory; please extract or justify why."
- SKILL.md activation surfaces the rule whenever agents begin infrastructure work (Layer 2).
- CI check enforces ADR citation on new Edge Function files (Layer 4).

### Migration burden

- 4 `candidate` ops are backlog. `manage-user update_notification_preferences` is architect-validated and ready to extract; the others are lower-priority. Each extraction is its own PR (no Big Bang). The criteria don't force retroactive migration of load-bearing functions.

### Frontend call-site churn during extractions

- Extracting an op changes the frontend service from `supabase.functions.invoke(...)` to `supabase.schema('api').rpc(...)`. The service-layer abstraction (e.g., `IUserCommandService`) typically hides this; each extraction updates one service file.
- Response envelope stays the same (`{success, error?, <entity>?}`) per Decision 5 — ViewModels don't need changes as long as they consume the envelope through the service interface.

### Deploy-surface consolidation

- Extracting an op turns two deploy surfaces (`supabase db push --linked` for migrations + `supabase functions deploy` for the function) into one (migration only). Subtle but real improvement — reduces the "did I forget to deploy the function?" class of incidents.

### AsyncAPI invariance

- Extraction does **not** change AsyncAPI event definitions. `stream_type` / `event_type` stay the same. The event emitter moves from the Edge Function's `supabase.rpc('emit_domain_event', ...)` to the SQL RPC's `api.emit_domain_event(...)` call — same arguments, same wire format. No contract changes, no consumer re-registration.

### Pattern A v2 retrofit surfaces during extraction

- Extracting `manage-user delete` or `modify_roles` provides an opportunity to fold in Pattern A v2 (they're currently emit-and-return-success). The SQL RPC form includes the read-back by construction. Extraction = retrofit, coupled.

### Observability shifts

- Edge Function logs → Deno Deploy. SQL RPC logs → PostgreSQL (`RAISE NOTICE`) + `processing_error` on `domain_events`. Admin dashboard at `/admin/events` surfaces the latter; extracting an op shifts its observability surface there.

## Related Documentation

- [adr-rpc-readback-pattern.md](./adr-rpc-readback-pattern.md) — SQL-RPC-side Pattern A v2 contract that extractions must conform to; this ADR's Decision 5 is the Edge Function mirror
- [event-handler-pattern.md](../../infrastructure/patterns/event-handler-pattern.md) — Event dispatcher + handler architecture; router CASE branches + projection read-back guard
- [event-sourcing-overview.md](../data/event-sourcing-overview.md) — CQRS architecture; read-side / write-side split
- [rpc-readback-vm-patch.md](../../frontend/patterns/rpc-readback-vm-patch.md) — Frontend VM in-place-patch pattern that consumes Pattern A v2 envelopes from both SQL RPCs and load-bearing Edge Functions
- [infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md) — Rule 4 (CQRS), Rule 9 (API functions must not write projections), Rule 13 (projection read-back guard); guard rails referencing this ADR land alongside it
- [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) — Supabase-specific migration patterns
- [adr-client-ou-placement.md](./adr-client-ou-placement.md) — Example ADR with enforcement + rollout history sections used as structural template
