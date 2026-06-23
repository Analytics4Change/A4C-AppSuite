---
status: current
last_updated: 2026-06-23
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Per-RPC classification of all `api.*` SQL functions (currently **179** per dev pg_proc — was 170 pre-Phase-2; see the generated per-bucket table below for the authoritative live count) into PR #67's 5-bucket taxonomy (A explicit-org-param, B JWT-bound, C scope-path-bound, D entity-lookup+RLS, E global) plus per-RPC consultant-callability decisions under the Path B JWT architecture from `adr-cross-tenant-access-grant-jwt-shape.md`. Strict Bucket A definition (early-return tenancy guard only) is used; functions taking `p_org_id` with RLS-only enforcement are Bucket D. Exact count is dynamic — codegen (Phase 1 step 12) sources from `pg_proc` directly and CI (step 13) gates parity.

**When to read**:
- Adding a new `api.*` RPC — find the right bucket pattern to match + know whether consultant-callability needs explicit reasoning
- Designing a Phase 3 refactor of Bucket A RPCs (`api.list_users` and any future siblings)
- Designing the Phase 4 Bucket D RLS audit + cross-tenant-grant extension
- Auditing whether a specific RPC will serve partner consultants under cross-tenant grants without modification
- Writing the comment-driven codegen (`gen-rpc-reachability-matrix.cjs`) — Phase 1 deliverable

**Prerequisites**: [adr-cross-tenant-access-grant-jwt-shape.md](../decisions/adr-cross-tenant-access-grant-jwt-shape.md), [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) § `list_users*` family pattern

**Key topics**: `rpc-reachability-matrix`, `consultant-callability`, `bucket-classification`, `cross-tenant-grant`, `provider-partner`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# Cross-Tenant Access Grant — RPC Reachability Matrix

> [!IMPORTANT]
> **Codegen-generated artifact (the marker-delimited `GENERATED:*` sections) as of Phase 1 (PR #70, 2026-06-03); originally hand-classified in Phase 0.3, reconciled Stage R 2026-05-29 + R-6 architect re-review fold-in 2026-05-30.** This matrix was hand-classified on 2026-05-26 during Phase 0.3 of the cross-tenant-access-grant-rollout card, reconciled against the live `pg_proc` inventory on 2026-05-29 (see `dev/active/cross-tenant-grant-phase-1-jwt-shape/matrix-reconciliation-inventory.md` for the diff arithmetic + R-2 classification work-product), then re-reviewed by `software-architect-dbc` on 2026-05-30 (verdict APPROVE WITH IN-PR FIXES; 4 must-fix + 2 nits folded in this doc on the same day). Stage R surfaced 72 missing-from-matrix RPCs (user-facing CRUD families the 2026-05-26 hand-curation missed: client lifecycle, field categories/definitions, schedule templates, org-CRUD, admin surfaces) and 7 stale-in-matrix entries (`*_user_schedule` family dropped by `20260217211231_schedule_template_refactor.sql`). Stage R-6 reclassified 2 entries D→E `[service-role-only]` (F1: `check_field_definitions_exist`, `deactivate_all_field_definitions`) and 4 entries D-variant→E `[admin-only]` (F2: `deactivate_organization`, `delete_organization`, `reactivate_organization`, `retry_deletion_workflow`); rewrote 2 guard columns for `SECURITY DEFINER` definer-bypasses-RLS reads (F3); and corrected the schedule-template-family consultant-callability framing (F4). Phase 1 (PR #70) shipped that comment-driven codegen (`frontend/scripts/gen-rpc-reachability-matrix.cjs`) plus CI workflow (`.github/workflows/rpc-reachability-matrix-sync.yml`) plus the full-inventory backfill of `@a4c-bucket` + `@a4c-consultant-callable` tags on `COMMENT ON FUNCTION`. As a result, the marker-delimited `GENERATED:*` sections are now codegen-owned: **DO NOT hand-edit those sections** — the comment tags in migrations are the source of truth and the codegen (CI-gated) overwrites them. Prose OUTSIDE the markers (bucket definitions, this banner, reconciliation notes) remains hand-maintained.

## Five-bucket definitions (strict)

| Bucket | Defining behavior | Path B reachability |
|---|---|---|
| **A** | Early-return tenancy guard: `IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id()) THEN RETURN; END IF;` with `p_org_id uuid` parameter. Canonical exemplar: `api.list_users` (PR #66). Functions that take `p_org_id` but DO NOT implement this guard are NOT Bucket A — they go to Bucket D (RLS-enforced). | **NO** — consultants' JWT `org_id` stays at home org; guard rejects them. **Phase 3 refactor target.** |
| **B** | Derives target org from JWT via `v_org_id := public.get_current_org_id();` (or equivalent JWT-claim read); no `p_org_id` parameter. Operates implicitly against the JWT-active org. | **NO** — `get_current_org_id()` returns home org. Consultant-callable variants require a parameterized RPC or grant-aware extension; **case-by-case in subsequent cards**. |
| **C** | Scope-path signature: takes `p_scope_path ltree` (or equivalent scope-bearing parameter); gates via `public.has_effective_permission('<perm>', p_scope_path)`; derives org from `subpath(p_scope_path, 0, 1)`. | **YES** — under Path B, grant-derived permissions appear in `effective_permissions` at the grant's scope; the scope-bound check evaluates against them natively. **No work needed.** Exemplars: PR #67's three sister RPCs (`list_users_for_role_management/bulk_assignment/schedule_management`). |
| **C-legacy** | Variant of C using the legacy two-step pattern: `v_user_scope := public.get_permission_scope(perm);` followed by manual `v_user_scope @> p_scope_path` check. Breaks under multi-entry-per-permission JWTs (`get_permission_scope` does `LIMIT 1` and picks arbitrarily). | **NO (under Path B without fix)**. **Phase 1 must-pair migration normalizes these in the same transaction as the DISTINCT ON tightening.** Only two such RPCs remain today (the four-site audit in `infrastructure/supabase/CLAUDE.md` enumerates them). |
| **D** | Entity-lookup signature: takes `p_<entity>_id uuid` (e.g., `p_client_id`, `p_user_id`, `p_invitation_id`); NO inline tenancy guard; relies entirely on RLS policies on underlying tables. **Includes RPCs taking `p_org_id` without the strict Bucket A guard.** | **CONDITIONAL** — depends on whether the underlying table's RLS extends visibility via `cross_tenant_access_grants_projection`. **Phase 4 RLS audit determines per-table.** |
| **E** | No org/scope context AND no entity-lookup ID parameter. Or takes only non-tenant-bound params (search strings, page numbers, role names, permission names). Operates on user-as-identity surface or platform-level reference data. | **YES (mostly)** — typically grant-irrelevant. Case-by-case for any RPC with implicit org context. |

## Per-bucket counts (reconciled 2026-05-29 against live dev pg_proc)

> [!NOTE]
> Counts in this table are **derived from the per-RPC table below** (single source of truth). The `r/w` column reflects **operation semantics** (does the RPC mutate state?), NOT the M3 `@a4c-rpc-shape` envelope-vs-read tag — a read RPC may have `@a4c-rpc-shape: envelope` if it returns a wrapped result; that's orthogonal to this column. F1/F3 fold-in (architect re-review 2026-05-29) corrected this.

<!-- GENERATED:PER-BUCKET-COUNTS:START -->
| Bucket | Count |
|---|---:|
| A | 1 |
| A-variant | 1 |
| B | 63 |
| C | 31 |
| D | 36 |
| D-variant | 1 |
| E | 45 |
| E-variant | 1 |
| **Total** | **179** |
<!-- GENERATED:PER-BUCKET-COUNTS:END -->

> [!NOTE]
> The "variant" rows (A-variant, D-variant, E-variant) recognize RPCs that don't fit cleanly into the strict bucket definitions but are close enough that creating a separate bucket per variant would be over-engineering. The Phase 1 codegen treats variants as their root bucket for the `@a4c-bucket:` tag — e.g., `list_invitations` is `@a4c-bucket: A` (uses `RAISE EXCEPTION` instead of `RETURN` but the equality-check shape is identical), `get_user_addresses_for_org` is `@a4c-bucket: D` (load-bearing RLS as in strict-D, but adds a `has_platform_privilege()` admin-override branch), `list_user_organizations` is `@a4c-bucket: E` (no `p_<entity>_id` parameter as in strict-E, but mixes self-context with an org-admin predicate). Each variant uses `@a4c-consultant-callable-reason:` to capture the nuance.

**Reconciliation arithmetic** (2026-05-29 Stage R):
- Pre-reconciliation: hand-curated matrix had 104 stated / 105 actual rows.
- Set diff vs live pg_proc: 98 MATCHES, 72 MISSING-FROM-MATRIX (added via Stage R-2 body inspection), 7 STALE-IN-MATRIX (`*_user_schedule` family removed via Stage R-4 — replaced by schedule_template + assignment model in migration `20260217211231_schedule_template_refactor.sql`).
- Net: 98 + 72 = 170 (matches live pg_proc); per-bucket sum = 170 (no residual). The 2026-05-26 hand-curation's 104-vs-105 internal discrepancy resolves via the post-reconciliation rebuild from the per-RPC table. **(This 170 is the 2026-05-29 reconciliation snapshot. Phase 2 / PR #71 subsequently added +9 RPCs — B +7 emit, E +2 — so the current total is 179, per the generated per-bucket table above.)**

Live count regenerated via Management API SQL: `SELECT COUNT(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api' AND p.prokind = 'f';` = **179** (current, post-Phase-2; was 170 at the 2026-05-29 reconciliation).

## Per-bucket consultant-callability decisions (locked in ADR)

| Bucket | Decision | Rationale |
|---|---|---|
| A | **NOT consultant-callable; Phase 3 refactor target** | Forward-incompatible by definition. Early-return guard rejects non-home-org callers. |
| B | **NOT consultant-callable; case-by-case parameterization in subsequent cards** | `get_current_org_id()` returns home org; no parameter to target grant org. Per-RPC variant design out of Phase 0.3 scope. |
| C | **Consultant-callable natively under Path B; no work needed** | Scope-bound permission check evaluates grant-derived permissions automatically. Verified by PR #67's sister-RPC pattern. |
| C-legacy | **NOT consultant-callable without Phase 1 fix; normalize in same migration as DISTINCT ON tightening** | LIMIT-1 semantics break under multi-entry-per-permission JWTs (operational tripwire from PR #67 close-out). |
| D | **Consultant-callable IFF Phase 4 RLS extension lands per-table** | RLS is the enforcement mechanism; per-table audit decides per-RPC. |
| E | **Consultant-callable by default; case-by-case for any with implicit org context** | Grant-irrelevant; permission-gated RPCs benefit from JWT extension automatically. |

## Sub-classification annotations (free-text vocabulary in the `summary` column)

In addition to the formal `@a4c-bucket` / `@a4c-consultant-callable` / `@a4c-phase-target` codegen tags, the matrix's per-RPC `summary` column carries a small free-text vocabulary that flags structurally narrower variants within a bucket. These annotations are documentation-only — the Phase 1 step 12 codegen does **not** parse them; they're handled via `@a4c-consultant-callable-reason:` free-text inside `COMMENT ON FUNCTION`.

| Annotation | Meaning | Applicable buckets | Examples |
|---|---|---|---|
| `[admin-only]` | RPC is gated by `has_platform_privilege()` or platform-level `has_permission()` check; intended for admin-dashboard or platform-operator use, not consultant-callable in practice. | E primarily; D-variant when the gate is the only enforcement | `get_failed_events`, `get_event_processing_stats`, `dismiss_failed_event`, `retry_failed_event`, `undismiss_failed_event`, `get_events_by_correlation`, `get_events_by_session`, `get_trace_timeline`, `get_failed_events_with_detail`, `get_orphaned_deletions`, `retry_deletion_workflow` |
| `[service-role-only]` | RPC has NO inline tenancy gate but `GRANT EXECUTE ... TO service_role` only (not `authenticated`); used by Temporal workers / Edge Functions as a server-side lever, never by end users. | E | `safety_net_deactivate_organization` (Temporal compensation lever for `emitBootstrapFailed → handler` failure path) |
| `[emitter-primitive]` | RPC is a low-level event emitter called transitively by other `api.*` write RPCs, not a direct entry point from frontend/EF. | E | `emit_domain_event`, `emit_workflow_started_event` |
| `[pre-auth]` | RPC is intentionally unauthenticated; called during signup / invitation-acceptance / pre-login flows where no JWT context exists. | E | `check_invitation_acceptance_eligibility`, `check_organization_by_name`, `check_organization_by_slug`, `check_user_exists`, `check_user_invitation_existence` |

**Codegen contract**: when Phase 1 step 11 writes `COMMENT ON FUNCTION` for an RPC carrying any of these annotations, the annotation is embedded inside `@a4c-consultant-callable-reason:` (not promoted to a fifth tag). Example: `@a4c-consultant-callable-reason: [admin-only] gated by has_platform_privilege(); admin-dashboard use only`. The codegen at step 12 re-emits the annotation into the regenerated matrix's `summary` column from the reason text.

## The matrix (`api.*` inventory, alphabetical — 179 RPCs)

<!-- GENERATED:PER-RPC-TABLE:START -->
| `api.<name>` | bucket | consultant-callable | phase-target | reason |
|---|---|---|---|---|
| `add_client_address` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `add_client_email` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `add_client_funding_source` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `add_client_insurance` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `add_client_phone` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `add_user_phone` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `admit_client` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `assign_client_contact` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `assign_client_to_user` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `assign_user_to_schedule` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `batch_update_field_definitions` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `bulk_assign_role` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `change_client_placement` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `check_field_definitions_exist` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `check_invitation_acceptance_eligibility` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `check_organization_by_name` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `check_organization_by_slug` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `check_pending_invitation` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `check_user_exists` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `check_user_invitation_existence` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `check_user_org_membership` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `create_access_grant` | B | no | none | Provider-admin authority (HIPAA gate at provider org path via has_effective_permission('grant.create', v_provider_path)); consultant variant N/A by design — grants are issued FOR consultants by provider admins, not BY consultants. |
| `create_field_category` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `create_field_definition` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `create_organization_address` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `create_organization_contact` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `create_organization_phone` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `create_organization_unit` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `create_role` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `create_schedule_template` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `create_var_partnership` | B | no | none | Provider-admin authority + partnership.manage permission (org-scoped at provider path); consultant variant N/A — partnerships are business relationships established BY the provider org. |
| `deactivate_all_field_definitions` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `deactivate_field_category` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `deactivate_field_definition` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `deactivate_organization` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `deactivate_organization_unit` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `deactivate_role` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `deactivate_schedule_template` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `deactivate_user` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `delete_field_category` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `delete_field_definition` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `delete_organization` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `delete_organization_address` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `delete_organization_contact` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `delete_organization_phone` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `delete_organization_unit` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `delete_role` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `delete_schedule_template` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `delete_user` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `discharge_client` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `dismiss_failed_event` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `emit_domain_event` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `emit_workflow_started_event` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `end_client_placement` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `find_contacts_by_phone` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_addresses_by_org` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_assignable_roles` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_bootstrap_status` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_category_field_count` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_child_organizations` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_client` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_contacts_by_org` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_current_org_unit` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_emails_by_org` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_event_processing_stats` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_events_by_correlation` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_events_by_session` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_failed_events` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_failed_events_with_detail` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_field_usage_count` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_grant_role_templates` | E | yes | none | Template metadata — non-sensitive list of available grant-role templates; consultants can read to discover what authorization types and templates exist (e.g., for UI rendering of "what templates does this VAR contract support"). |
| `get_invitation_by_id` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_invitation_by_org_and_email` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_invitation_by_token` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_invitation_for_resend` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_by_id` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_details` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_direct_care_settings` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_name` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_unit_by_id` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `get_organization_unit_descendants` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `get_organization_units` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `get_organizations` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_organizations_paginated` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_orphaned_deletions` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_pending_invitations_by_org` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_permission_ids_by_names` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_permissions` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_person_phones` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_phones_by_org` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_by_id` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_by_name` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_by_name_and_org` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_permission_names` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_permission_templates` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_roles` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_schedule_template` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_trace_timeline` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_user_addresses` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_addresses_for_org` | D-variant | pending-phase4-rls | 4 | D-variant: has_platform_privilege() admin-override branch combined with load-bearing RLS; Phase 4 per-table audit applies. Per-RPC sub-classification (e.g., [admin-only] vs strict-D) deferred to Step 12 codegen follow-up. |
| `get_user_by_id` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_notification_preferences` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_user_org_access` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `get_user_org_details` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_permissions` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `get_user_phones` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_phones_for_org` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_sms_phones` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `list_clients` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `list_field_categories` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `list_field_definition_templates` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `list_field_definitions` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `list_invitations` | A-variant | pending-phase3-refactor | 3 | A-variant: same equality-check shape as strict-A but RAISEs instead of RETURNs; Phase 3 refactor target. |
| `list_roles_for_user` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `list_schedule_templates` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `list_system_field_categories` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `list_user_client_assignments` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `list_user_org_access` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `list_user_organizations` | E-variant | yes | none | E-variant: sui generis (mixed self-context + org-admin predicate). |
| `list_users` | A | yes | none | Grant-derived membership via accessible_organizations (Model M, Phase 3): a consultant holding an active in-window grant to p_org_id has it in accessible_organizations and is admitted by the membership-oracle tenancy guard. RETURN-empty for non-members (no existence leak). |
| `list_users_for_bulk_assignment` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `list_users_for_role_management` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `list_users_for_schedule_management` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `modify_user_roles` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `reactivate_field_category` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `reactivate_field_definition` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `reactivate_organization` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `reactivate_organization_unit` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `reactivate_role` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `reactivate_schedule_template` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `reactivate_var_partnership` | B | no | none | Provider-admin authority + partnership.manage permission; consultant variant N/A. |
| `register_client` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `remove_client_address` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `remove_client_email` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `remove_client_funding_source` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `remove_client_insurance` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `remove_client_phone` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `remove_user_phone` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `resend_invitation` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `retry_deletion_workflow` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `retry_failed_event` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `revoke_access_grant` | B | no | none | Provider-admin authority (HIPAA gate at provider org path via has_effective_permission('grant.revoke', v_provider_path)); consultant variant N/A by design — revocations are issued by the data-owner provider, not by the consultant. |
| `revoke_invitation` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `revoke_permission_across_grants` | E | no | none | Platform-tier authority (has_platform_privilege() required); cross-grant policy override is a platform-level operation; not callable by providers OR consultants. |
| `safety_net_deactivate_organization` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `soft_delete_organization_addresses` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `soft_delete_organization_contacts` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `soft_delete_organization_phones` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `suspend_var_partnership` | B | no | none | Provider-admin authority + partnership.manage permission; consultant variant N/A. |
| `switch_org_unit` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `sync_role_assignments` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `sync_schedule_assignments` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `terminate_var_partnership` | B | no | none | Provider-admin authority + partnership.manage permission; cascade-revocation is a high-risk action initiated by the provider org, not the consultant. |
| `unassign_client_contact` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `unassign_client_from_user` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `unassign_user_from_schedule` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `undismiss_failed_event` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `update_client` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_client_address` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_client_email` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_client_funding_source` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_client_insurance` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_client_phone` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_field_category` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_field_definition` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_organization` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `update_organization_address` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `update_organization_contact` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `update_organization_direct_care_settings` | E | yes | none | No tenancy context; grant-irrelevant by default. Per-RPC sub-classification ([admin-only] / [service-role-only] / [pre-auth] / [emitter-primitive]) deferred to follow-up. |
| `update_organization_phone` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `update_organization_unit` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `update_role` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_schedule_template` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
| `update_user` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `update_user_access_dates` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_user_notification_preferences` | D | pending-phase4-rls | 4 | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `update_user_phone` | B | no | none | JWT-bound (derives org via get_current_org_id); consultant variant deferred to case-by-case Phase 2+ work. |
| `update_var_partnership` | B | no | none | Provider-admin authority + partnership.manage permission; consultant variant N/A. |
| `validate_role_assignment` | C | yes | none | Scope-path-bound has_effective_permission; forward-compatible with multi-scope grants under Phase 1 tightened DISTINCT ON. |
<!-- GENERATED:PER-RPC-TABLE:END -->

## Phase 3 refactor target list (Bucket A + A-variant)

Bucket A + A-variant RPCs (the table below is **bucket-derived**, so it lists these regardless of completion status). **Status as of Phase 3 (PR for `20260622183824`):** `list_users` is **DONE** — refactored to the Model M membership-oracle tenancy guard (consultant-callable=yes), NOT the originally-handoff'd three-step perm-gated skeleton (that skeleton violated the users-as-identities scoped-vs-unscoped rule and was inert — no template confers `user.view`). `list_invitations` is **deferred** to its own sub-card (`seed-list-invitations-cross-tenant-visibility-decision`) pending an `invitation.read` permission seed + a HIPAA exposure-policy decision (does a clinical-grant consultant see an org's invitations?).

<!-- GENERATED:PHASE-3-TARGETS:START -->
| `api.<name>` | Bucket | Reason |
|---|---|---|
| `list_invitations` | A-variant | A-variant: same equality-check shape as strict-A but RAISEs instead of RETURNs; Phase 3 refactor target. |
| `list_users` | A | Grant-derived membership via accessible_organizations (Model M, Phase 3): a consultant holding an active in-window grant to p_org_id has it in accessible_organizations and is admitted by the membership-oracle tenancy guard. RETURN-empty for non-members (no existence leak). |
<!-- GENERATED:PHASE-3-TARGETS:END -->

If future RPCs adopt the early-return/early-raise guard pattern (anti-recommended; the three-step skeleton should be the default), they would land in Bucket A or A-variant and need the same refactor.

## Phase 1 must-pair normalization (Bucket C-legacy — 10 RPCs)

**10 RPCs** that ship in the same transactional migration as the DISTINCT ON tightening + `compute_effective_permissions` extension (per ADR Phase 1 manifest steps 7, 8 — Step 7 covers the body normalization; Step 8 covers the M3 RPC Shape Registry re-tag + post-migration assertion; now significantly expanded from the original 2-RPC scope per architect-review findings).

### Role-management mutations (2 — PR #67 known)

| `api.<name>` | Current canonical body | Normalization |
|---|---|---|
| `bulk_assign_role` | `20260430002824_strip_processing_error_detail_with_admin_rpc.sql:260` (RAISE EXCEPTION line) | Replace `v_user_scope := get_permission_scope(perm); IF NOT (v_user_scope @> p_scope_path)` with single `IF NOT has_effective_permission(perm, p_scope_path) THEN RAISE EXCEPTION ... END IF;` |
| `sync_role_assignments` | `20260430002824_*.sql:417` (RAISE EXCEPTION line) | Same as above |

### OU mutators (5)

| `api.<name>` | Current canonical body | Normalization |
|---|---|---|
| `create_organization_unit` | `baseline_v4:640` + `20260221173821_*.sql:47` | Replace `v_scope_path := get_permission_scope('organization.create_ou')` + manual `@>` with `has_effective_permission('organization.create_ou', <derived parent scope>)` |
| `update_organization_unit` | latest body `20260423065747_*.sql:1213` | Same — `organization.update_ou` perm |
| `delete_organization_unit` | `20260223163610_*.sql:37` | Same — `organization.delete_ou` perm |
| `deactivate_organization_unit` | `20260221173821_*.sql:293` | Same — confirm perm name in body |
| `reactivate_organization_unit` | `20260221173821_*.sql:440` | Same — confirm perm name in body |

### OU readers (3)

| `api.<name>` | Current canonical body | Normalization |
|---|---|---|
| `get_organization_unit_by_id` | `baseline_v4:2851` | Replace `v_scope_path := get_permission_scope('organization.view_ou')` with `has_effective_permission('organization.view_ou', <OU path>)` |
| `get_organization_unit_descendants` | `baseline_v4:2930` | Same |
| `get_organization_units` | `baseline_v4:3003` | Same |

### Post-normalization comment re-tagging

For every `CREATE OR REPLACE FUNCTION` in the Phase 1 migration (all 10 above), re-issue `COMMENT ON FUNCTION ... '@a4c-rpc-shape: envelope|read'` (per M3 DROP+CREATE rule from `infrastructure/supabase/CLAUDE.md` § RPC Shape Registry). Phase 1 migration step 8 in ADR Consequences enforces this — verify expansion captures all 10 RPCs, not just the 2 role-management siblings.

### Audit query (pre-merge guard)

Run before merging any future migration that touches `compute_effective_permissions`:

```bash
grep -rn "get_permission_scope\|Requested scope is outside your permission scope" \
  infrastructure/supabase/supabase/migrations/
```

Every remaining hit must be migrated to `has_effective_permission(perm, path)` in the SAME or strictly-prior migration. See `~/.claude/projects/-home-lars-dev-A4C-AppSuite/memory/pr-67-close-out.md` § Operational tripwire.

## Phase 4 RLS audit target list (Bucket D + D-variant — 37 RPCs)

**37 RPCs** rely on RLS policies for tenancy (**36 strict-D + 1 D-variant**). Phase 4 audits the underlying tables' RLS policies and extends them to consult `cross_tenant_access_grants_projection` (via the `has_cross_tenant_access(...)` helper that the Phase 1 migration makes real). Note: the 3 OU readers (`get_organization_unit_by_id/descendants`, `get_organization_units`) moved OUT of D to C-legacy per Phase 1 normalization scope. **Stage R reconciliation 2026-05-29** added 2 net D entries from missing-72 (`get_organization_details`, `list_schedule_templates`) and removed 2 stale D entries (`get_schedule_by_id`, `list_user_schedules` — replaced by the schedule_template + assignment model in migration `20260217211231_schedule_template_refactor.sql`). **Stage R-6 fold-in 2026-05-30** subsequently removed 6 entries: F1 moved 2 entries (`check_field_definitions_exist`, `deactivate_all_field_definitions`) D→E `[service-role-only]` (no `authenticated` grant; RLS is not the enforcement); F2 moved 4 entries (`deactivate_organization`, `delete_organization`, `reactivate_organization`, `retry_deletion_workflow`) D-variant→E `[admin-only]` (their `has_platform_privilege()` gate is the only enforcement; RLS not load-bearing).

The per-table audit cluster (each row in the per-RPC table above lists the underlying table in its guard column):

<!-- GENERATED:PHASE-4-TARGETS:START -->
| `api.<name>` | Bucket | Reason |
|---|---|---|
| `add_user_phone` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `check_pending_invitation` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `check_user_org_membership` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `find_contacts_by_phone` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_addresses_by_org` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_assignable_roles` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_bootstrap_status` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_contacts_by_org` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_emails_by_org` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_invitation_by_id` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_invitation_by_org_and_email` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_invitation_by_token` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_invitation_for_resend` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_by_id` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_details` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_direct_care_settings` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_organization_name` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_pending_invitations_by_org` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_person_phones` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_phones_by_org` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_by_id` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_by_name` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_by_name_and_org` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_role_permission_names` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_addresses` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_addresses_for_org` | D-variant | D-variant: has_platform_privilege() admin-override branch combined with load-bearing RLS; Phase 4 per-table audit applies. Per-RPC sub-classification (e.g., [admin-only] vs strict-D) deferred to Step 12 codegen follow-up. |
| `get_user_by_id` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_org_details` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_phones` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_phones_for_org` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `get_user_sms_phones` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `list_roles_for_user` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `list_schedule_templates` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `list_user_client_assignments` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `revoke_invitation` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `update_user` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
| `update_user_notification_preferences` | D | Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4. |
<!-- GENERATED:PHASE-4-TARGETS:END -->

Phase 4 deliverable: per-table RLS policy review with grant-aware EXISTS clauses (`OR EXISTS (SELECT 1 FROM cross_tenant_access_grants_projection ctag WHERE ctag.consultant_user_id = auth.uid() AND ctag.provider_org_id = <table>.organization_id AND ctag.status='active' AND (ctag.expires_at IS NULL OR ctag.expires_at > now()))` — or, after Phase 1 makes the predicate real, a single `OR public.has_cross_tenant_access(...)` call).

### Phase 4 sub-audit note: definer-bypasses-RLS cluster

Several Bucket-D RPCs are `SECURITY DEFINER` with `search_path` set — DEFINER bypasses caller-RLS, so the "RLS-enforcement" framing in the guard column is **informational only** for these entries. Each needs an explicit Phase 4 review to decide whether to add an inline permission check, narrow the surface, or document the open-by-design behavior.

- **`check_user_org_membership`** (`baseline_v4:593-606`) — unauthenticated org-membership probe; any caller can check any user/org pair. Forward-compatible by accident with cross-tenant grants (no restriction = no rejection).
- **`get_organization_details`** (`20260226002002_*.sql:214`) [Stage R-6 F3 fold-in 2026-05-30] — no permission check, no tenancy guard; `p_org_id` taken at face value. Any `authenticated` caller can fetch any org's extended metadata. **Pre-existing gap; orthogonal to cross-tenant grant migration.** Phase 4 decision: add `has_effective_permission('organization.view', <p_org_id>'s path)` gate, OR document as open-by-design (e.g., if details are public-by-design), OR replace with a `has_org_admin_permission()` gate.
- **`list_schedule_templates`** (`20260218001058_*.sql:164`) [Stage R-6 F3 fold-in 2026-05-30] — `COALESCE(p_org_id, get_current_org_id())` is taken at face value with no permission check. Any `authenticated` caller can list schedule templates of any org by passing `p_org_id`. **Pre-existing gap; orthogonal to cross-tenant grant migration.** Phase 4 decision: add `has_effective_permission(<perm>, <p_org_id>'s path)` gate matching the schedule-template-mutation family's enforcement.

**Possible follow-up card seeding**: this cluster is the visible tip of a broader audit population — every `api.*` `SECURITY DEFINER` RPC that takes `p_org_id`/`p_<entity>_id` without an explicit permission check or tenancy guard is structurally similar. Out of Phase 1 scope; consider seeding `dev/active/security-audit-definer-bypass-rls/` with an inventory pass once Phase 1 ships.

Per-table audit work is large; Phase 4 may sub-divide into per-table sub-cards.

## Comment vocabulary specification (Phase 1 codegen contract)

Every `api.*` RPC's `COMMENT ON FUNCTION` declares three tags (extending the existing M3 `@a4c-rpc-shape` vocabulary):

```sql
COMMENT ON FUNCTION api.list_users(uuid, ...) IS $cmt$Lists users in an org with role assignments.

@a4c-rpc-shape: read
@a4c-bucket: A
@a4c-consultant-callable: no
@a4c-consultant-callable-reason: early-return tenancy guard; PR #66 pattern; forward-incompatible with grant-bearers per ADR — Phase 3 refactor target
$cmt$;
```

**Grammar**:

| Tag | Values | Required | Notes |
|---|---|---|---|
| `@a4c-rpc-shape:` | `envelope` \| `read` | already-required (M3) | Pre-existing per `adr-rpc-readback-pattern.md` § "Type-level enforcement (M3)" |
| `@a4c-bucket:` | `A` \| `B` \| `C` \| `C-legacy` \| `D` \| `E` | yes (new) | Exactly one. Variants (A-variant, D-variant, E-variant) take their ROOT bucket and use `@a4c-consultant-callable-reason:` to capture the variant nuance. `C-legacy` is the only hyphenated value (intentional — Phase 1 normalization deprecates it). |
| `@a4c-consultant-callable:` | `yes` \| `no` \| `pending-phase3-refactor` \| `pending-phase4-rls` | yes (new) | Exactly one. `pending-phase3-refactor` maps to Bucket A + A-variant (Phase 3 work). `pending-phase4-rls` maps to Bucket D + D-variant (Phase 4 work). `no` is for Bucket B (consultant-callable variants out of scope) + C-legacy (after Phase 1 normalization, these become C, so callable=yes; pre-Phase-1 they're effectively `no`). |
| `@a4c-consultant-callable-reason:` | free text | required for `no` / `pending-*`; optional for `yes` | One line; explains the call decision. Required-when enforced by codegen + CI. |
| `@a4c-phase-target:` | `1` \| `3` \| `4` \| `none` | yes (new) | Exactly one. Single grep finds all RPCs needing work in a given phase. Codegen can derive most from bucket (A→3, C-legacy→1, D→4) but explicit tag is the source of truth. |

**Codegen contract** (Phase 1 deliverable — `frontend/scripts/gen-rpc-reachability-matrix.cjs`):

1. Connects to local Supabase container at `127.0.0.1:54322` (same pattern as `gen-rpc-registry.cjs`).
2. Queries `SELECT pg_proc.proname, obj_description(pg_proc.oid) FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid WHERE pg_namespace.nspname = 'api';`.
3. Parses each `obj_description` for the four tags. Missing `@a4c-bucket` or `@a4c-consultant-callable` → script exits non-zero (CI red).
4. Emits the per-RPC markdown table above (replacing this hand-classified version) plus the per-bucket count table, plus the Phase 3 / Phase 1 / Phase 4 target subset tables.
5. Frontmatter `last_updated` updated to today's date.

**CI workflow** (Phase 1 deliverable — `.github/workflows/rpc-reachability-matrix-sync.yml`):

- Mirrors `.github/workflows/rpc-registry-sync.yml`: spins up local Supabase container, applies all migrations, runs the codegen, diffs against the committed matrix doc. Fails on diff or missing tag.
- Triggers: pushes/PRs touching `infrastructure/supabase/supabase/migrations/`, `frontend/scripts/gen-rpc-reachability-matrix.cjs`, or this matrix doc.

## Edge cases and notes

- **`api.add_user_phone`** uses a permission-gate-not-tenancy-guard pattern: `IF NOT (has_platform_privilege() OR has_org_admin_permission() OR caller_is_target_user)`. This is NOT the strict-Bucket-A guard (no `p_org_id = get_current_org_id()` equality check). Classified D because the actual tenancy enforcement happens via RLS on `phones_projection` + `user_phones` + the per-row org check inside the function body.
- **`api.get_user_permissions`** is E (caller-self surface); under Path B it returns grant-derived permissions in the caller's claim set automatically — no work needed.
- **`api.modify_user_roles`** (PR #44 extraction; multi-event partial-failure contract) takes `p_user_id` but is E rather than D because the function operates on user-as-identity surface (matches `api.delete_user` precedent in `adr-rpc-readback-pattern.md` partial-failure section).
- **`api.list_user_schedules`** is D not B; takes `p_org_id` optionally but enforces via RLS on `user_schedules_projection`.
- **OU-mutator RPCs** (`create_organization_unit`, `update_organization_unit`, `deactivate_organization_unit`, `reactivate_organization_unit`, `delete_organization_unit`) are Bucket C even though they don't take an explicit `p_scope_path` parameter — they derive the scope from the OU itself (via `p_unit_id` lookup) and check `has_effective_permission(<perm>, <ou.path>)`. This is structurally Bucket C semantics ("scope-bound permission check") even though the wire parameter is an entity id. The codegen tag would be `@a4c-bucket: C`.
- **`api.revoke_invitation`**: marked D because it operates entity-bound (`p_invitation_id`) with RLS enforcement. PR #64 surfaced naming-clarity issue (parameter named `p_invitation_id` actually filters on projection PK `id`) — separate seed at `dev/active/api-revoke-invitation-param-naming/`.

### Structural classification notes (2026-05-29 reconciliation pass)

> Surfaced during the matrix-doc reconciliation work in `dev/active/cross-tenant-grant-phase-1-jwt-shape/` (Stage R, 2026-05-29). Heading kept stage-agnostic so this section remains discoverable after the card is archived.

- **B-vs-C path-source discriminator** (codified during Stage R-2 body inspection): when a body calls `has_effective_permission(<perm>, <scope_var>)`, the bucket is determined by HOW `<scope_var>` was assigned, NOT by whether `get_current_org_id()` appears anywhere in the body. **B**: `<scope_var>` traces to `WHERE id = v_org_id` AND `v_org_id := get_current_org_id()` (JWT-derived). **C**: `<scope_var>` traces to `WHERE id = p_<param>_id` directly OR to `WHERE id = v_<rec>.organization_id` where `v_<rec>` was assigned from a caller-supplied entity-id (entity-derived). Worked example: `api.admit_client` is B despite taking `p_client_id` — its `v_org_path` comes from `WHERE id = v_org_id` (JWT). `api.update_organization` is C despite declaring `v_org_id := get_current_org_id();` (vestigial unused variable) — its `v_org` comes from `WHERE id = p_org_id` (caller-supplied).
- **`api.update_organization` vestigial JWT-org variable**: the body declares `v_org_id uuid := get_current_org_id();` but uses `p_org_id` (caller-supplied) for the perm-check path lookup. The `v_org_id` value is unused. This pattern requires the path-source discriminator above to classify correctly (Bucket C) — naive "if get_current_org_id appears then B" misclassifies. Pattern observed in `20260423065747_api_rpc_readback_v2_event_id_check.sql:1353`.
- **Schedule template family — COALESCE hybrid scope-source**: 7 of the 8 schedule mgmt RPCs (`create/deactivate/delete/reactivate/update_schedule_template`, `assign_user_to_schedule`, `unassign_user_from_schedule`) use `has_effective_permission(<perm>, COALESCE((SELECT path FROM organization_units_projection WHERE id = <entity-OU-id>), (SELECT path FROM organizations_projection WHERE id = v_org_id)))`. When an OU-id is supplied (directly or via a fetched template), scope is entity-derived → primary path is **Bucket C**. When the OU-id is NULL (template was created with no OU target), scope falls back to JWT-org-derived (B-like). Net classification: **C** (canonical case dominates; JWT-fallback is the degenerate edge). **Consultant-callability is NOT automatic under Path B** even though the perm-check succeeds: the family also performs a hard-coded `WHERE id = p_org_unit_id AND organization_id = v_org_id` OU-tenancy validation where `v_org_id := get_current_org_id()` (the consultant's JWT home-org). A partner consultant whose JWT home-org is X but who holds a grant-derived `user.schedule_manage` at provider Y's OU path will pass `has_effective_permission` (Path B carries the grant-derived perm at the right scope) but FAIL the subsequent `organization_id = v_org_id` validation. Consultant variant requires Phase 2+ parameterization — either a `p_target_org_id` override or relaxation of the post-perm OU-org validation to consult `accessible_organizations`. Stage R-6 F4 fold-in 2026-05-30 corrected an earlier overly-optimistic claim here.
- **`api.get_schedule_template`** (the 8th schedule mgmt RPC) does NOT use COALESCE hybrid; it's a tenancy-only read (`WHERE id = p_template_id AND organization_id = v_org_id`) with no `has_effective_permission` call. **Bucket B** (tenancy-only).
- **`api.safety_net_deactivate_organization`** ([service-role-only]) has NO inline tenancy gate — it relies entirely on `GRANT EXECUTE ... TO service_role` (NOT to `authenticated`). Functions as a Temporal compensation lever for `emitBootstrapFailed → handler` failure path. **Bucket E** despite taking `p_org_id uuid` — not D, because RLS isn't the enforcement mechanism (caller is service_role which bypasses RLS); the only enforcement is the `GRANT` itself. Documented as "intentional CQRS exception for last-resort rollback" in the function header comment. Not consultant-callable under any model (consultants authenticate as `authenticated`, not as service_role).
- **`api.deactivate_user`** uses unscoped `has_permission('user.update')` + manual tenancy guard (`IF v_target_org_id IS DISTINCT FROM v_org_id`). Same structural pattern as existing matrix entry `api.delete_user` (per `adr-edge-function-vs-sql-rpc.md` Rollout 2026-04-27 course correction: users-as-identity surface uses unscoped `has_permission` with manual tenancy guard, NOT `has_effective_permission`). **Bucket E** — matches `delete_user` precedent.
- **Client lifecycle RPCs and field-definition family — all Bucket B**: 16 client-lifecycle RPCs (`add_client_*`, `admit_client`, `change_client_placement`, `discharge_client`, `register_client`, `update_client`, `update_client_*`, `remove_client_*`, `unassign_client_contact`) and ~14 field-categories/definitions RPCs (`create_field_*`, `deactivate_field_*`, `delete_field_*`, `update_field_*`, `list_field_categories`, `list_field_definitions`, `reactivate_field_*`, etc.) share the canonical B pattern: `v_org_id := get_current_org_id()` → `SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id` → `has_effective_permission(<perm>, v_org_path)`. Consultants on Path B cannot target these in a grant org because `get_current_org_id()` returns home-org. **Consultant-callable parameterization deferred to Phase 2+ per ADR**.
- **Reference-data list RPCs**: `api.list_field_definition_templates` and `api.list_system_field_categories` have NO tenancy gate at all (return platform-level reference data). **Bucket E** by definition — grant-irrelevant.
- **Admin-dashboard family**: `api.get_failed_events_with_detail`, `api.get_orphaned_deletions`, `api.retry_deletion_workflow` — all `[admin-only]` and all uniformly gated on `has_platform_privilege()` post-2026-06-09 consolidation. (The original PR #43 design used a granular `platform.view_event_details` permission for the detail RPC, but that permission was retired as YAGNI — `platform.*` family now reduces to `{platform.admin}` only.) These join the existing admin-only matrix entries (`get_failed_events`, `get_event_processing_stats`, `dismiss_failed_event`, `retry_failed_event`, `undismiss_failed_event`, `get_events_by_*`, `get_trace_timeline`). All E or D-variant.
- **`@a4c-rpc-shape` is a wire-shape contract, NOT a r/w marker** (clarified during R-6 N1 resolution 2026-05-30): the M3 backfill rule (`20260430172625_*.sql:77-83`) deterministically tags RPCs as `envelope` iff the body constructs a `{success, true|false, ...}` discriminator, else `read`. This means several state-mutating RPCs in the per-RPC table above carry `@a4c-rpc-shape: read` despite their `r/w = W` semantics — specifically `bulk_assign_role`, `sync_role_assignments`, `sync_schedule_assignments`, `deactivate_all_field_definitions`, and `safety_net_deactivate_organization`. Their return shapes lack the `{success}` discriminator (e.g., `{successful, failed, totalRequested, ...}` or `{found, deactivated, deactivated_at}`), so the frontend services callers (`SupabaseRoleService`, `SupabaseScheduleService`) correctly consume them via `apiRpc<T>` (read helper, returns raw payload). The wire-shape tag classifies which TS helper narrows on the function name; the matrix's `r/w` column is the semantic operation marker. The two axes are intentionally orthogonal.

## Related Documentation

- [adr-cross-tenant-access-grant-jwt-shape.md](../decisions/adr-cross-tenant-access-grant-jwt-shape.md) — Phase 0.1+0.2 ADR; this matrix's parent document. The Phase 0.3 ADR addendum captures the per-bucket consultant-callability decisions verbatim.
- [provider-partners-architecture.md](../data/provider-partners-architecture.md) — Authorization-type taxonomy + RLS-with-grants sketch (the Phase 4 implementation target for Bucket D).
- [adr-multi-role-effective-permissions.md](./adr-multi-role-effective-permissions.md) — `compute_effective_permissions` semantics that Path B extends.
- [adr-rpc-readback-pattern.md](../decisions/adr-rpc-readback-pattern.md) — Pattern A v2 envelope contract; M3 RPC Shape Registry pattern that this matrix's codegen mirrors.
- [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) — § `list_users*` family pattern (the canonical three-step skeleton); § Choosing between `has_permission()` and `has_effective_permission()`; § RPC Shape Registry (M3 codegen reference).
- [cross-tenant-access-grant-rollout/plan.md](../../../dev/active/cross-tenant-access-grant-rollout/plan.md) — Multi-phase card this matrix is Phase 0.3 of.
