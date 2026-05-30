---
status: current
last_updated: 2026-05-29
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Per-RPC classification of all `api.*` SQL functions (currently **170** per dev pg_proc) into PR #67's 5-bucket taxonomy (A explicit-org-param, B JWT-bound, C scope-path-bound, D entity-lookup+RLS, E global) plus per-RPC consultant-callability decisions under the Path B JWT architecture from `adr-cross-tenant-access-grant-jwt-shape.md`. Strict Bucket A definition (early-return tenancy guard only) is used; functions taking `p_org_id` with RLS-only enforcement are Bucket D. Exact count is dynamic — codegen (Phase 1 step 12) sources from `pg_proc` directly and CI (step 13) gates parity.

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
> **Hand-classified artifact (Phase 0.3, reconciled Stage R of Phase 1 card 2026-05-29).** This matrix was hand-classified on 2026-05-26 during Phase 0.3 of the cross-tenant-access-grant-rollout card and reconciled against the live `pg_proc` inventory on 2026-05-29 (see `dev/active/cross-tenant-grant-phase-1-jwt-shape/matrix-reconciliation-inventory.md` for the diff arithmetic + R-2 classification work-product). Stage R surfaced 72 missing-from-matrix RPCs (user-facing CRUD families the 2026-05-26 hand-curation missed: client lifecycle, field categories/definitions, schedule templates, org-CRUD, admin surfaces) and 7 stale-in-matrix entries (`*_user_schedule` family dropped by `20260217211231_schedule_template_refactor.sql`). Once Phase 1 ships the comment-driven codegen (`frontend/scripts/gen-rpc-reachability-matrix.cjs`) plus CI workflow (`.github/workflows/rpc-reachability-matrix-sync.yml`) plus the full-inventory backfill of `@a4c-bucket` + `@a4c-consultant-callable` tags on `COMMENT ON FUNCTION`, this doc becomes a **generated artifact**. From that point: **DO NOT hand-edit** — the comment tags in migrations are the source of truth, and the codegen will overwrite changes here.

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

| Bucket | Reads | Writes | Total | Notes |
|---|---:|---:|---:|---|
| A (strict) | 1 | 0 | **1** | Phase 3 refactor target (`api.list_users`) |
| A-variant | 1 | 0 | **1** | `list_invitations` — same `p_org_id = get_current_org_id()` equality check but RAISEs instead of RETURNs and requires `has_org_admin`. Treated as Phase 3 refactor target alongside strict A. |
| B | 11 | 45 | **56** | Case-by-case consultant variants. Largest Stage R reconciliation gain — bulk of client lifecycle + field categories/definitions + JWT-bound org-CRUD. |
| C (strict) | 4 | 17 | **21** | Stage R reconciliation added 17 net — org address/contact/phone CRUD (entity-derived) + schedule template family (COALESCE hybrid scope-source) + `update_organization` / `update_organization_phone`. No work needed for consultant-callability. |
| C-legacy | 3 | 7 | **10** | Phase 1 must-pair normalization: 2 mutation siblings (`bulk_assign_role`, `sync_role_assignments`) + 5 OU mutators + 3 OU readers. R-3 re-audit 2026-05-29 confirmed zero new C-legacy from missing-72. |
| D | 34 | 4 | **38** | Phase 4 RLS audit target. Stage R reconciliation: +4 from missing-72 (`check_field_definitions_exist`, `deactivate_all_field_definitions`, `get_organization_details`, `list_schedule_templates`); -2 stale (`get_schedule_by_id`, `list_user_schedules` — replaced by schedule_template + assignment model). |
| D-variant | 1 | 4 | **5** | Stage R reconciliation added 4 — entity-id + has_platform_privilege() pattern: `deactivate_organization`, `delete_organization`, `reactivate_organization`, `retry_deletion_workflow`. |
| E | 22 | 15 | **37** | Stage R reconciliation: +6 from missing-72 (`get_failed_events_with_detail` `[admin-only]`, `get_orphaned_deletions` `[admin-only]`, `list_field_definition_templates` reference data, `list_system_field_categories` reference data, `deactivate_user` [unscoped `has_permission` + manual tenancy guard; matches `delete_user` precedent], `safety_net_deactivate_organization` `[service-role-only]`). |
| E-variant | 1 | 0 | **1** | `list_user_organizations` — sui generis (mixed self-context + org-admin predicate) |
| **Total** | **78** | **92** | **170** | Matches live pg_proc distinct count exactly. |

> [!NOTE]
> The "variant" rows (A-variant, D-variant, E-variant) recognize RPCs that don't fit cleanly into the strict bucket definitions but are close enough that creating a separate bucket per variant would be over-engineering. The Phase 1 codegen treats variants as their root bucket for the `@a4c-bucket:` tag (e.g., `list_invitations` is `@a4c-bucket: A`) and uses `@a4c-consultant-callable-reason:` to capture the variant nuance.

**Reconciliation arithmetic** (2026-05-29 Stage R):
- Pre-reconciliation: hand-curated matrix had 104 stated / 105 actual rows.
- Set diff vs live pg_proc: 98 MATCHES, 72 MISSING-FROM-MATRIX (added via Stage R-2 body inspection), 7 STALE-IN-MATRIX (`*_user_schedule` family removed via Stage R-4 — replaced by schedule_template + assignment model in migration `20260217211231_schedule_template_refactor.sql`).
- Net: 98 + 72 = 170 (matches live pg_proc); per-bucket sum = 170 (no residual). The 2026-05-26 hand-curation's 104-vs-105 internal discrepancy resolves via the post-reconciliation rebuild from the per-RPC table.

Live count regenerated via Management API SQL: `SELECT COUNT(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api' AND p.prokind = 'f';` = **170**.

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

## The matrix (`api.*` inventory, alphabetical — 170 RPCs)

| `api.<name>` | bucket | r/w | guard / source-of-tenancy | summary |
|---|---|---|---|---|
| `add_client_address` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:627`) | Add address to client |
| `add_client_email` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:602`) | Add email to client |
| `add_client_funding_source` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:681`) | Add funding source to client |
| `add_client_insurance` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:653`) | Add insurance policy to client |
| `add_client_phone` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:576`) | Add phone to client |
| `add_user_phone` | D | W | `IF NOT (has_platform_privilege() OR has_org_admin_permission() OR user=self)` (permission gate; `p_org_id` optional) | Adds phone to user |
| `admit_client` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:411`) | Admit a client to active care |
| `assign_client_contact` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:734`) | Assign contact to client |
| `assign_client_to_user` | B | W | `v_org_id := get_current_org_id()` | Assigns client to user in active org |
| `assign_user_to_schedule` | C | W | `has_effective_permission(<perm>, COALESCE(<entity-OU-path>, <JWT-org-path>))` (hybrid; `20260217231405_add_event_metadata_to_schedule_rpcs.sql:387`) | Assign user to a schedule template |
| `batch_update_field_definitions` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408012329_fix_batch_update_jsonb_scalar.sql:12`) | Bulk update field definitions |
| `bulk_assign_role` | **C-legacy** | W | `get_permission_scope() + v_user_scope @> p_scope_path` (`20260430002824_*.sql:260`) | Assigns role to multiple users at scope |
| `change_client_placement` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423065747_api_rpc_readback_v2_event_id_check.sql:1076`) | Change client placement (transfer/create) |
| `check_field_definitions_exist` | D | R | RLS on underlying projection (`20260330191322_fix_seed_field_definitions_idempotency_check.sql:9`) | Check whether org has field definitions |
| `check_invitation_acceptance_eligibility` | E | R | (none; pre-auth check) | Validates invitation token + cross-provider gate (PR #63) [pre-auth] |
| `check_organization_by_name` | E | R | (none; pre-auth) | Checks if org name exists at signup [pre-auth] |
| `check_organization_by_slug` | E | R | (none; pre-auth) | Checks if org slug exists at signup [pre-auth] |
| `check_pending_invitation` | D | R | RLS on `invitations_projection` | Checks for pending invitation in org |
| `check_user_exists` | E | R | (none; pre-auth) | Checks if user email registered on platform [pre-auth] |
| `check_user_invitation_existence` | E | R | (none; pre-auth) | Looks up user/invitation by email for accept-invitation EF [pre-auth] |
| `check_user_org_membership` | D | R | RLS on `user_roles_projection` | Checks user membership in org |
| `create_field_category` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408023403_client_field_config_enhancements.sql:239`) | Create field category in org |
| `create_field_definition` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260415003931_fix_create_field_readback_guard.sql:10`) | Create field definition under category |
| `create_organization_address` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260226002002_organization_manage_page_phase1.sql:732`) | Create address for an org |
| `create_organization_contact` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260226002002_organization_manage_page_phase1.sql:610`) | Create contact for an org |
| `create_organization_phone` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260226002002_organization_manage_page_phase1.sql:854`) | Create phone for an org |
| `create_organization_unit` | **C-legacy** | W | `v_scope_path := get_permission_scope('organization.create_ou')` (`baseline_v4:640`, also `20260221173821:47`) | Creates OU under parent |
| `create_role` | B | W | `v_org_id := get_current_org_id()` | Creates role in active org |
| `create_schedule_template` | C | W | `has_effective_permission(<perm>, COALESCE(<entity-OU-path>, <JWT-org-path>))` (hybrid; `20260217231405_add_event_metadata_to_schedule_rpcs.sql:12`) | Create schedule template (OU-targeted or org-scoped) |
| `deactivate_all_field_definitions` | D | R | RLS on underlying projection (`20260330170946_fix_seed_field_definitions_schema_access.sql:94`) | Deactivate all field definitions for org |
| `deactivate_field_category` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260415022432_field_deactivation_confirmation.sql:80`) | Deactivate field category |
| `deactivate_field_definition` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260327212247_client_field_api_functions.sql:195`) | Deactivate field definition |
| `deactivate_organization` | D-variant | W | `has_platform_privilege()` gate + RLS (`20260226002002_organization_manage_page_phase1.sql:390`) | Deactivate organization (admin) |
| `deactivate_organization_unit` | **C-legacy** | W | `v_scope_path := get_permission_scope(...)` (`20260221173821_*.sql:293`) | Deactivates OU |
| `deactivate_role` | B | W | `v_org_id := get_current_org_id()` | Deactivates role |
| `deactivate_schedule_template` | C | W | `has_effective_permission(<perm>, COALESCE(<entity-OU-path>, <JWT-org-path>))` (hybrid; `20260217231405_add_event_metadata_to_schedule_rpcs.sql:181`) | Deactivate schedule template |
| `deactivate_user` | E | W | `has_permission(user.update)` + manual tenancy guard (`20260512194836_deactivate_user_rpc_and_check_user_invitation_existence.sql:52`) | Deactivate user account (admin) |
| `delete_field_category` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260420160421_field_category_reactivate_delete.sql:281`) | Delete field category |
| `delete_field_definition` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260420160421_field_category_reactivate_delete.sql:101`) | Delete field definition |
| `delete_organization` | D-variant | W | `has_platform_privilege()` gate + RLS (`20260226002002_organization_manage_page_phase1.sql:534`) | Hard-delete organization (admin) |
| `delete_organization_address` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260226002002_organization_manage_page_phase1.sql:813`) | Delete org address |
| `delete_organization_contact` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260226002002_organization_manage_page_phase1.sql:691`) | Delete org contact |
| `delete_organization_phone` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260226002002_organization_manage_page_phase1.sql:934`) | Delete org phone |
| `delete_organization_unit` | **C-legacy** | W | `v_scope_path := get_permission_scope('organization.delete_ou')` (`20260223163610_*.sql:37`) | Deletes OU |
| `delete_role` | B | W | `v_org_id := get_current_org_id()` | Deletes role |
| `delete_schedule_template` | C | W | `has_effective_permission(<perm>, COALESCE(<entity-OU-path>, <JWT-org-path>))` (hybrid; `20260217231405_add_event_metadata_to_schedule_rpcs.sql:305`) | Delete schedule template |
| `delete_user` | E | W | `has_platform_privilege()` or user=self (extracted RPC PR #40) | Soft-deletes user (auth + projection) |
| `discharge_client` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260408000351_fix_client_api_architecture_review.sql:457`) | Discharge a client from active care |
| `dismiss_failed_event` | E | W | `has_platform_privilege()` | Marks event failure as manually dismissed [admin-only] |
| `emit_domain_event` | E | W | (none; emitter primitive) | Core event emitter — used by every write RPC [emitter-primitive] |
| `emit_workflow_started_event` | E | W | (none; bootstrap signaling) | Emits workflow lifecycle event [emitter-primitive] |
| `end_client_placement` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:812`) | End client placement record |
| `find_contacts_by_phone` | D | R | RLS on `contacts_projection` | Phone-number search across contacts |
| `get_addresses_by_org` | D | R | RLS on `addresses_projection` (`baseline_v4:1936`) | Fetches org addresses |
| `get_assignable_roles` | D | R | RLS on `roles_projection` | Lists roles user can assign in org |
| `get_bootstrap_status` | D | R | RLS on `bootstrap_projections` | Fetches org bootstrap state |
| `get_category_field_count` | B | R | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260420160421_field_category_reactivate_delete.sql:555`) | Count fields in category |
| `get_child_organizations` | E | R | RLS via `has_platform_privilege()` check | Lists child orgs of parent [admin-only] |
| `get_client` | B | R | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423013804_client_get_client_ou_state_fields.sql:25`) | Fetch client by id |
| `get_contacts_by_org` | D | R | RLS on `contacts_projection` | Fetches org contacts |
| `get_current_org_unit` | B | R | `WHERE u.id = auth.uid()` | Returns user's current OU |
| `get_emails_by_org` | D | R | RLS on email columns | Lists org email contacts |
| `get_event_processing_stats` | E | R | `has_platform_privilege()` | Domain event stats (admin) [admin-only] |
| `get_events_by_correlation` | E | R | `has_platform_privilege()` | Lists events by correlation ID [admin-only] |
| `get_events_by_session` | E | R | `has_platform_privilege()` | Lists events by session [admin-only] |
| `get_failed_events` | E | R | `has_platform_privilege()` (admin dashboard) | Lists processing failures with `processing_error_detail` if permitted [admin-only] |
| `get_failed_events_with_detail` | E | R | (none) (`20260506012315_fix_get_failed_events_with_detail_security_definer.sql:73`) | List failed events with detail (admin) [admin-only] |
| `get_field_usage_count` | B | R | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260415022432_field_deactivation_confirmation.sql:5`) | Count usage of a field |
| `get_invitation_by_id` | D | R | RLS on `invitations_projection` | Fetches invitation details |
| `get_invitation_by_org_and_email` | D | R | RLS on `invitations_projection` | Looks up invitation by org + email |
| `get_invitation_by_token` | D | R | RLS on `invitations_projection` (token-keyed read) | Looks up invitation by acceptance token |
| `get_invitation_for_resend` | D | R | RLS on `invitations_projection` | Fetches invitation for resend UI |
| `get_organization_by_id` | D | R | RLS on `organizations_projection` | Fetches org by ID |
| `get_organization_details` | D | R | RLS on underlying projection (`20260226002002_organization_manage_page_phase1.sql:214`) | Fetch org details with extended metadata |
| `get_organization_direct_care_settings` | D | R | RLS on `organizations_projection` | Fetches DC-specific settings |
| `get_organization_name` | D | R | RLS on `organizations_projection` | Returns org name scalar |
| `get_organizations` | E | R | `has_platform_privilege()` (admin) | Lists all orgs (admin) [admin-only] |
| `get_organizations_paginated` | E | R | `has_platform_privilege()` (admin) | Paginated org list (admin dashboard) [admin-only] |
| `get_organization_unit_by_id` | **C-legacy** | R | `v_scope_path := get_permission_scope('organization.view_ou')` (`baseline_v4:2851`) | Fetches OU details |
| `get_organization_unit_descendants` | **C-legacy** | R | `v_scope_path := get_permission_scope('organization.view_ou')` (`baseline_v4:2930`) | Lists OU descendants |
| `get_organization_units` | **C-legacy** | R | `v_scope_path := get_permission_scope('organization.view_ou')` (`baseline_v4:3003`) | Lists OUs (scope-bound) |
| `get_orphaned_deletions` | E | R | `has_platform_privilege()` (`20260310004215_orphaned_deletion_monitoring.sql:15`) | List orphaned deletion events (admin) [admin-only] |
| `get_pending_invitations_by_org` | D | R | RLS on `invitations_projection` | Lists pending invitations for org |
| `get_permission_ids_by_names` | E | R | (none; reference lookup) | Looks up permission IDs by names |
| `get_permissions` | E | R | (none; reference data) | Lists all platform permissions |
| `get_person_phones` | D | R | RLS on `phones_projection` | Fetches contact phone numbers |
| `get_phones_by_org` | D | R | RLS on `phones_projection` | Lists org phones |
| `get_role_by_id` | D | R | RLS on `roles_projection` | Fetches role by ID |
| `get_role_by_name` | D | R | RLS on `roles_projection` | Looks up role by name in org |
| `get_role_by_name_and_org` | D | R | RLS on `roles_projection` | Looks up role by name+org |
| `get_role_permission_names` | D | R | RLS on `role_permissions_projection` | Lists permission names granted by role |
| `get_role_permission_templates` | E | R | (none; reference data) | Lists role-permission templates |
| `get_roles` | B | R | `v_org_id := get_current_org_id()` | Lists roles in active org |
| `get_schedule_template` | B | R | `v_org_id := get_current_org_id()` (tenancy-only; `20260424182345_add_missing_user_lifecycle_handlers_and_orphan_filters.sql:339`) | Fetch schedule template with assigned users |
| `get_trace_timeline` | E | R | `has_platform_privilege()` | Distributed trace reconstruction [admin-only] |
| `get_user_addresses` | D | R | RLS on `user_addresses` | Fetches user addresses |
| `get_user_addresses_for_org` | **D-variant** | R | `v_has_platform_privilege := public.has_platform_privilege()` + explicit RAISE on insufficient perms (`baseline_v4:3751`); also RLS on underlying tables | User addresses scoped to org (D with permission gate) |
| `get_user_by_id` | D | R | RLS on `users` | Fetches user profile (org context optional) |
| `get_user_notification_preferences` | B | R | `v_org_id := get_current_org_id()` | Fetches user notification prefs |
| `get_user_org_access` | B | R | `v_org_id := get_current_org_id()` | Lists user access details in active org |
| `get_user_org_details` | D | R | RLS on `users` + `user_organizations_projection` | Per-org user details |
| `get_user_permissions` | E | R | `auth.uid()` (self-context) | Lists effective permissions for caller |
| `get_user_phones` | D | R | RLS on `phones_projection` | Fetches user phones |
| `get_user_phones_for_org` | D | R | RLS on `phones_projection` + `user_org_phone_overrides` | User phones for specific org |
| `get_user_sms_phones` | D | R | RLS on `phones_projection` (SMS filter) | Fetches SMS-capable phones |
| `list_clients` | B | R | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:318`) | List clients in org |
| `list_field_categories` | B | R | `v_org_id := get_current_org_id()` (tenancy-only; `20260420160421_field_category_reactivate_delete.sql:506`) | List field categories in active org |
| `list_field_definitions` | B | R | `v_org_id := get_current_org_id()` (tenancy-only; `20260327212247_client_field_api_functions.sql:252`) | List field definitions in active org |
| `list_field_definition_templates` | E | R | (none; reference data) (`20260330170946_fix_seed_field_definitions_schema_access.sql:18`) | List platform field definition templates (reference data) |
| `list_invitations` | **A-variant** | R | `IF NOT (has_platform_privilege() OR (has_org_admin AND p_org_id = get_current_org_id())) THEN RAISE EXCEPTION` (RAISE not RETURN; `baseline_v4:4235-4252`) — same equality check as A | Lists invitations for org |
| `list_roles_for_user` | D | R | RLS on `user_roles_projection` | Lists roles assigned to user |
| `list_schedule_templates` | D | R | RLS on underlying projection (`20260218001058_denormalize_schedule_assigned_user_count.sql:164`) | List schedule templates with assigned-user counts |
| `list_system_field_categories` | E | R | (none; reference data) (`20260330170946_fix_seed_field_definitions_schema_access.sql:65`) | List system-defined field categories (reference data) |
| `list_user_client_assignments` | D | R | RLS on `user_client_assignments_projection` | Lists client assignments per user |
| `list_user_org_access` | **E** | R | `has_platform_privilege() OR p_user_id = get_current_user_id()` (self-context) | Lists org access history for user |
| `list_user_organizations` | **E-variant** | R | Mixed: calls `get_current_org_id()` AND `get_current_user_id()`; predicate is `(has_org_admin AND uop.org_id = v_current_org_id) OR uop.user_id = v_current_user_id` | Lists orgs the caller belongs to (sui generis) |
| **`list_users`** | **A** | R | `IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id()) THEN RETURN;` (`20260519233323:132-140`) | Lists users in org with role assignments (PR #66) |
| `list_users_for_bulk_assignment` | C | R | `has_effective_permission('user.role_assign', p_scope_path)` (`20260521195657:79`) | Lists users eligible for bulk role assignment |
| `list_users_for_role_management` | C | R | `has_effective_permission('user.role_assign', p_scope_path)` (`20260521195657:183`) | Lists users for role CRUD at scope |
| `list_users_for_schedule_management` | C | R | `has_effective_permission(<perm>, <derived scope>)` (`20260521195657:282`) | Lists users to manage schedule at scope |
| `modify_user_roles` | **B** | W | `v_org_id := NULLIF(v_claims ->> 'org_id', '')::uuid` (JWT-bound; `20260430172139:54,71-91`) | Modifies user role set transactionally |
| `reactivate_field_category` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260420160421_field_category_reactivate_delete.sql:203`) | Reactivate field category |
| `reactivate_field_definition` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260420160421_field_category_reactivate_delete.sql:26`) | Reactivate field definition |
| `reactivate_organization` | D-variant | W | `has_platform_privilege()` gate + RLS (`20260226002002_organization_manage_page_phase1.sql:466`) | Reactivate organization (admin) |
| `reactivate_organization_unit` | **C-legacy** | W | `v_scope_path := get_permission_scope(...)` (`20260221173821_*.sql:440`) | Reactivates OU |
| `reactivate_role` | B | W | `v_org_id := get_current_org_id()` | Reactivates role |
| `reactivate_schedule_template` | C | W | `has_effective_permission(<perm>, COALESCE(<entity-OU-path>, <JWT-org-path>))` (hybrid; `20260217231405_add_event_metadata_to_schedule_rpcs.sql:245`) | Reactivate schedule template |
| `register_client` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:49`) | Register a new client |
| `remove_client_address` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:684`) | Remove address from client |
| `remove_client_email` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:604`) | Remove email from client |
| `remove_client_funding_source` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:891`) | Remove funding source from client |
| `remove_client_insurance` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:766`) | Remove insurance from client |
| `remove_client_phone` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:530`) | Remove phone from client |
| `remove_user_phone` | E | W | (entity-bound by phone_id; user-or-admin check) | Removes user phone |
| `resend_invitation` | E | W | `has_platform_privilege() OR has_org_admin_permission()` | Resends invitation email |
| `retry_deletion_workflow` | D-variant | W | `has_platform_privilege()` gate + RLS (`20260310004215_orphaned_deletion_monitoring.sql:76`) | Retry a failed deletion workflow (admin) [admin-only] |
| `retry_failed_event` | E | W | `has_platform_privilege()` | Retries a failed event [admin-only] |
| `revoke_invitation` | D | W | RLS on `invitations_projection` | Revokes pending invitation |
| `safety_net_deactivate_organization` | E | W | no inline guard; `GRANT ... TO service_role` only (`20260330170946_fix_seed_field_definitions_schema_access.sql:128`) | Direct org deactivation (Temporal compensation lever) [service-role-only] |
| `soft_delete_organization_addresses` | E | W | `has_platform_privilege()` | Soft-deletes all org addresses |
| `soft_delete_organization_contacts` | E | W | `has_platform_privilege()` | Soft-deletes all org contacts |
| `soft_delete_organization_phones` | E | W | `has_platform_privilege()` | Soft-deletes all org phones |
| `switch_org_unit` | B | W | `auth.uid()` (self-context) | Sets caller's current OU |
| `sync_role_assignments` | **C-legacy** | W | `get_permission_scope() + v_user_scope @> p_scope_path` (`20260430002824_*.sql:417`) | Syncs role membership at scope |
| `sync_schedule_assignments` | E | W | (template-id bound; org derived from template) | Syncs schedule users from template |
| `unassign_client_contact` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260406222857_client_api_functions.sql:937`) | Unassign contact from client |
| `unassign_client_from_user` | B | W | `v_org_id := get_current_org_id()` | Unassigns client from user |
| `unassign_user_from_schedule` | C | W | `has_effective_permission(<perm>, COALESCE(<entity-OU-path>, <JWT-org-path>))` (hybrid; `20260217231405_add_event_metadata_to_schedule_rpcs.sql:460`) | Unassign user from a schedule template |
| `undismiss_failed_event` | E | W | `has_platform_privilege()` | Reverses event dismissal [admin-only] |
| `update_client` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423074238_api_rpc_readback_v2_m1_m2_fix.sql:420`) | Update client information |
| `update_client_address` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423074238_api_rpc_readback_v2_m1_m2_fix.sql:47`) | Update client address |
| `update_client_email` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423074238_api_rpc_readback_v2_m1_m2_fix.sql:128`) | Update client email |
| `update_client_funding_source` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423074238_api_rpc_readback_v2_m1_m2_fix.sql:196`) | Update client funding source |
| `update_client_insurance` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423074238_api_rpc_readback_v2_m1_m2_fix.sql:273`) | Update client insurance policy |
| `update_client_phone` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423074238_api_rpc_readback_v2_m1_m2_fix.sql:352`) | Update client phone |
| `update_field_category` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423154534_client_field_rpc_return_entities.sql:155`) | Update field category |
| `update_field_definition` | B | W | `v_org_id := get_current_org_id()` + `has_effective_permission(<perm>, v_org_path)` (`20260423154534_client_field_rpc_return_entities.sql:30`) | Update field definition |
| `update_organization` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260423065747_api_rpc_readback_v2_event_id_check.sql:1353`) | Update organization fields |
| `update_organization_address` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260423065747_api_rpc_readback_v2_event_id_check.sql:1439`) | Update org address |
| `update_organization_contact` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260423065747_api_rpc_readback_v2_event_id_check.sql:1489`) | Update org contact |
| `update_organization_direct_care_settings` | E | W | `has_org_admin_permission()` | Updates DC org settings |
| `update_organization_phone` | C | W | `has_effective_permission(<perm>, <entity-derived-path>)` (`20260423065747_api_rpc_readback_v2_event_id_check.sql:1539`) | Update org phone |
| `update_organization_unit` | **C-legacy** | W | `v_scope_path := get_permission_scope('organization.update_ou')` (latest body `20260423065747_*.sql:1213`) | Updates OU details |
| `update_role` | B | W | `v_org_id := get_current_org_id()` | Updates role definition |
| `update_schedule_template` | C | W | `has_effective_permission(<perm>, COALESCE(<entity-OU-path>, <JWT-org-path>))` (hybrid; `20260423065747_api_rpc_readback_v2_event_id_check.sql:896`) | Update schedule template |
| `update_user` | **D** | W | Takes `p_org_id uuid` explicitly; no `get_current_org_id()` derivation; RLS-enforced | Updates user profile (explicit-org-param without strict-A guard) |
| `update_user_access_dates` | B | W | `v_org_id := get_current_org_id()` | Updates user access date range |
| `update_user_notification_preferences` | **D** | W | Takes `p_org_id uuid` explicitly; no `get_current_org_id()` derivation | Updates user notification prefs (explicit-org-param without strict-A guard) |
| `update_user_phone` | B | W | `v_org_id := get_current_org_id()` | Updates user phone |
| `validate_role_assignment` | C | R | `has_effective_permission(<perm>, p_scope_path)` (validation pre-check) | Validates role assignment before mutation |

## Phase 3 refactor target list (Bucket A + A-variant)

**2 RPCs** to refactor in Phase 3 to the PR #67 three-step skeleton (replace early-return / early-raise guard with `has_effective_permission` + `accessible_organizations @>` membership predicate):

| `api.<name>` | Bucket | Current canonical body | Phase 3 work |
|---|---|---|---|
| `list_users` | A (strict) | `20260519233323_fix_list_users_include_roleless.sql:132-140` | Replace early-return guard with three-step skeleton; consultants gain provider-scoped permissions in JWT under Path B, so the existing predicate path serves them naturally |
| `list_invitations` | A-variant | `baseline_v4:4235-4252` | Replace `IF NOT (has_platform_privilege() OR (has_org_admin AND p_org_id = get_current_org_id())) THEN RAISE EXCEPTION` with the three-step skeleton + permission check on `invitation.read` (or equivalent) at `p_org_id`'s path |

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

## Phase 4 RLS audit target list (Bucket D + D-variant — 43 RPCs)

**43 RPCs** rely on RLS policies for tenancy (**38 strict-D + 5 D-variant**). Phase 4 audits the underlying tables' RLS policies and extends them to consult `cross_tenant_access_grants_projection` (via the `has_cross_tenant_access(...)` helper that the Phase 1 migration makes real). Note: the 3 OU readers (`get_organization_unit_by_id/descendants`, `get_organization_units`) moved OUT of D to C-legacy per Phase 1 normalization scope. **Stage R reconciliation 2026-05-29** added 4 D + 4 D-variant from missing-72 (`check_field_definitions_exist`, `deactivate_all_field_definitions`, `get_organization_details`, `list_schedule_templates` → D; `deactivate_organization`, `delete_organization`, `reactivate_organization`, `retry_deletion_workflow` → D-variant) and removed 2 stale D entries (`get_schedule_by_id`, `list_user_schedules` — replaced by the schedule_template + assignment model in migration `20260217211231_schedule_template_refactor.sql`).

The per-table audit cluster (each row in the per-RPC table above lists the underlying table in its guard column):

- `addresses_projection` → 1 RPC (`get_addresses_by_org`)
- `contacts_projection` → 2 RPCs (`find_contacts_by_phone`, `get_contacts_by_org`)
- `emails` → 1 RPC (`get_emails_by_org`)
- `invitations_projection` → 6 RPCs (`check_pending_invitation`, `get_invitation_by_id/org_and_email/token/resend`, `revoke_invitation`, `get_pending_invitations_by_org`) — note: `list_invitations` moved OUT to A-variant
- `organizations_projection` → 4 D RPCs (`get_organization_by_id`, `get_organization_direct_care_settings`, `get_organization_name`, `get_organization_details` [Stage R]); 3 D-variant lifecycle RPCs (`deactivate_organization`, `delete_organization`, `reactivate_organization` [Stage R]). Note: `safety_net_deactivate_organization` is **E** not D — service-role-only Temporal compensation lever.
- `phones_projection` → 5 RPCs (`get_person_phones`, `get_phones_by_org`, `get_user_phones`, `get_user_phones_for_org`, `get_user_sms_phones`)
- `roles_projection` / `role_permissions_projection` → 5 RPCs (`get_role_by_id`, `get_role_by_name`, `get_role_by_name_and_org`, `get_role_permission_names`, `get_assignable_roles`)
- `users` / `user_roles_projection` / `user_organizations_projection` → 4 RPCs (`check_user_org_membership`, `get_user_by_id`, `get_user_org_details`, `list_roles_for_user`)
- `user_addresses` → 2 RPCs (`get_user_addresses`, `get_user_addresses_for_org` [D-variant])
- `user_client_assignments_projection` → 1 RPC (`list_user_client_assignments`)
- `bootstrap_projections` → 1 RPC (`get_bootstrap_status`)
- `field_definitions_projection` / `field_categories_projection` → 2 D RPCs (`check_field_definitions_exist`, `deactivate_all_field_definitions`) [Stage R additions]
- `schedule_templates_projection` → 1 D RPC (`list_schedule_templates`) [Stage R addition]
- Orphan deletion workflow → 1 D-variant RPC (`retry_deletion_workflow` admin lever) [Stage R addition]
- Entity writes (RLS-enforced + explicit-org-param without strict-A guard): 4 RPCs (`add_user_phone`, `revoke_invitation`, `update_user`, `update_user_notification_preferences`)

Phase 4 deliverable: per-table RLS policy review with grant-aware EXISTS clauses (`OR EXISTS (SELECT 1 FROM cross_tenant_access_grants_projection ctag WHERE ctag.consultant_user_id = auth.uid() AND ctag.provider_org_id = <table>.organization_id AND ctag.status='active' AND (ctag.expires_at IS NULL OR ctag.expires_at > now()))` — or, after Phase 1 makes the predicate real, a single `OR public.has_cross_tenant_access(...)` call).

### Phase 4 sub-audit note: `check_user_org_membership`

`check_user_org_membership` (`baseline_v4:593-606`) is SECURITY DEFINER with `search_path` set — DEFINER bypasses caller-RLS so the "RLS-enforcement" framing is misleading for this RPC. In practice it's an unauthenticated org-membership probe (any caller can check any user/org pair). Forward-compatible by accident with cross-tenant grants (no restriction = no rejection), but worth an explicit Phase 4 review to decide whether the function should narrow its surface or document the open-by-design behavior.

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
- **Schedule template family — COALESCE hybrid scope-source**: 7 of the 8 schedule mgmt RPCs (`create/deactivate/delete/reactivate/update_schedule_template`, `assign_user_to_schedule`, `unassign_user_from_schedule`) use `has_effective_permission(<perm>, COALESCE((SELECT path FROM organization_units_projection WHERE id = <entity-OU-id>), (SELECT path FROM organizations_projection WHERE id = v_org_id)))`. When an OU-id is supplied (directly or via a fetched template), scope is entity-derived → primary path is **Bucket C**. When the OU-id is NULL (template was created with no OU target), scope falls back to JWT-org-derived (B-like). Net classification: **C** (canonical case dominates; JWT-fallback is the degenerate edge). Consultant-callability implication: a partner consultant with a grant carrying an OU-targeted `user.schedule_manage` permission can target templates in the provider org's OU; templates without an OU fall back to home-org-only enforcement.
- **`api.get_schedule_template`** (the 8th schedule mgmt RPC) does NOT use COALESCE hybrid; it's a tenancy-only read (`WHERE id = p_template_id AND organization_id = v_org_id`) with no `has_effective_permission` call. **Bucket B** (tenancy-only).
- **`api.safety_net_deactivate_organization`** ([service-role-only]) has NO inline tenancy gate — it relies entirely on `GRANT EXECUTE ... TO service_role` (NOT to `authenticated`). Functions as a Temporal compensation lever for `emitBootstrapFailed → handler` failure path. **Bucket E** despite taking `p_org_id uuid` — not D, because RLS isn't the enforcement mechanism (caller is service_role which bypasses RLS); the only enforcement is the `GRANT` itself. Documented as "intentional CQRS exception for last-resort rollback" in the function header comment. Not consultant-callable under any model (consultants authenticate as `authenticated`, not as service_role).
- **`api.deactivate_user`** uses unscoped `has_permission('user.update')` + manual tenancy guard (`IF v_target_org_id IS DISTINCT FROM v_org_id`). Same structural pattern as existing matrix entry `api.delete_user` (per `adr-edge-function-vs-sql-rpc.md` Rollout 2026-04-27 course correction: users-as-identity surface uses unscoped `has_permission` with manual tenancy guard, NOT `has_effective_permission`). **Bucket E** — matches `delete_user` precedent.
- **Client lifecycle RPCs and field-definition family — all Bucket B**: 16 client-lifecycle RPCs (`add_client_*`, `admit_client`, `change_client_placement`, `discharge_client`, `register_client`, `update_client`, `update_client_*`, `remove_client_*`, `unassign_client_contact`) and ~14 field-categories/definitions RPCs (`create_field_*`, `deactivate_field_*`, `delete_field_*`, `update_field_*`, `list_field_categories`, `list_field_definitions`, `reactivate_field_*`, etc.) share the canonical B pattern: `v_org_id := get_current_org_id()` → `SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id` → `has_effective_permission(<perm>, v_org_path)`. Consultants on Path B cannot target these in a grant org because `get_current_org_id()` returns home-org. **Consultant-callable parameterization deferred to Phase 2+ per ADR**.
- **Reference-data list RPCs**: `api.list_field_definition_templates` and `api.list_system_field_categories` have NO tenancy gate at all (return platform-level reference data). **Bucket E** by definition — grant-irrelevant.
- **Admin-dashboard family**: `api.get_failed_events_with_detail` `[admin-only]` uses `has_permission('platform.view_event_details')`; `api.get_orphaned_deletions` `[admin-only]` and `api.retry_deletion_workflow` `[admin-only]` use `has_platform_privilege()`. These join the existing admin-only matrix entries (`get_failed_events`, `get_event_processing_stats`, `dismiss_failed_event`, `retry_failed_event`, `undismiss_failed_event`, `get_events_by_*`, `get_trace_timeline`). All E or D-variant.
- **`@a4c-rpc-shape` is a wire-shape contract, NOT a r/w marker** (clarified during R-6 N1 resolution 2026-05-30): the M3 backfill rule (`20260430172625_*.sql:77-83`) deterministically tags RPCs as `envelope` iff the body constructs a `{success, true|false, ...}` discriminator, else `read`. This means several state-mutating RPCs in the per-RPC table above carry `@a4c-rpc-shape: read` despite their `r/w = W` semantics — specifically `bulk_assign_role`, `sync_role_assignments`, `sync_schedule_assignments`, `deactivate_all_field_definitions`, and `safety_net_deactivate_organization`. Their return shapes lack the `{success}` discriminator (e.g., `{successful, failed, totalRequested, ...}` or `{found, deactivated, deactivated_at}`), so the frontend services callers (`SupabaseRoleService`, `SupabaseScheduleService`) correctly consume them via `apiRpc<T>` (read helper, returns raw payload). The wire-shape tag classifies which TS helper narrows on the function name; the matrix's `r/w` column is the semantic operation marker. The two axes are intentionally orthogonal.

## Related Documentation

- [adr-cross-tenant-access-grant-jwt-shape.md](../decisions/adr-cross-tenant-access-grant-jwt-shape.md) — Phase 0.1+0.2 ADR; this matrix's parent document. The Phase 0.3 ADR addendum captures the per-bucket consultant-callability decisions verbatim.
- [provider-partners-architecture.md](../data/provider-partners-architecture.md) — Authorization-type taxonomy + RLS-with-grants sketch (the Phase 4 implementation target for Bucket D).
- [adr-multi-role-effective-permissions.md](./adr-multi-role-effective-permissions.md) — `compute_effective_permissions` semantics that Path B extends.
- [adr-rpc-readback-pattern.md](../decisions/adr-rpc-readback-pattern.md) — Pattern A v2 envelope contract; M3 RPC Shape Registry pattern that this matrix's codegen mirrors.
- [infrastructure/supabase/CLAUDE.md](../../../infrastructure/supabase/CLAUDE.md) — § `list_users*` family pattern (the canonical three-step skeleton); § Choosing between `has_permission()` and `has_effective_permission()`; § RPC Shape Registry (M3 codegen reference).
- [cross-tenant-access-grant-rollout/plan.md](../../../dev/active/cross-tenant-access-grant-rollout/plan.md) — Multi-phase card this matrix is Phase 0.3 of.
