# PR #80 — Architect Review (Cross-tenant grant Phase 3: `api.list_users` Model M guard)

**Status**: Review complete
**Reviewer**: software-architect-dbc (Opus 4.8 1M)
**Date**: 2026-06-22
**Branch**: `feat/cross-tenant-grant-phase-3-list-users-membership-guard` (head `7f014afd`, base `main`)
**Scope reviewed**: migration `20260622183824_phase_3_list_users_membership_guard.sql`, parent card handoff (`tasks.md`), new sub-card (`seed-list-invitations-cross-tenant-visibility-decision.md`), reachability matrix doc, `infrastructure/supabase/CLAUDE.md` variant note.

---

## Verdict: **APPROVE**

This is a clean, minimal, well-reasoned change. The guard swap is correct, the query body is byte-identical to the deployed predecessor (pitfall #6 satisfied by construction), the COMMENT re-issue is structurally consistent with both codegen parsers, the matrix doc hand-edits byte-match what the generators will reproduce, and the `list_invitations` split-out is the right call. No blocking or should-fix findings. Two nits (optional, non-blocking) and a set of pre-merge verification reminders are listed below.

The "address inline, not via cards" default does not force any in-PR code change here — the only deferred item (`list_invitations`) is correctly carded because it is genuinely out of scope (needs a permission seed + a HIPAA policy decision), not a punt on a fixable defect.

---

## Evidence gathered

1. **Deployed predecessor identified correctly.** The baseline_v4 body of `api.list_users` (L4584) is NOT the deployed body — PR #66 (`20260519233323_fix_list_users_include_roleless.sql`) replaced it with the `accessible_organizations @>` + `COUNT(*) OVER ()` single-pass form. No migration between PR #66 and this PR re-defines `api.list_users` (verified: only `20260519233323` and `20260622183824` `CREATE OR REPLACE` the exact 7-arg signature; the `20260521195657` and Phase 1 migrations touch only the *sister* RPCs and the tag backfill). So PR #66 is the true pre-image for the pitfall-#6 diff.
2. **Query body is byte-identical to the deployed predecessor.** `diff` of the new body L76–131 against PR #66 L145–200 = identical. The *only* substantive change is the guard block (new L62–71 vs PR #66 L135–140). Pitfall #6 ("preserve every load-bearing line not deliberately changed") is satisfied — nothing silently changed.
3. **Signature/return shape unchanged** → `CREATE OR REPLACE` preserves the OID, owner, and ACL. The migration correctly omits `ALTER FUNCTION ... OWNER TO` and `GRANT EXECUTE` — matching the established PR #66 convention (CREATE OR REPLACE keeps both). No M3 DROP+CREATE re-tag concern (pitfall: that rule only fires on signature change).
4. **COMMENT re-issue is parser-consistent.** Both `gen-rpc-registry.cjs` (`d.description ~ '@a4c-rpc-shape:\s*read'`) and `gen-rpc-reachability-matrix.cjs` (`@a4c-${tag}:\s*([^\n]+?)(?=\n|$)`) use single-line tag regexes, so the new COMMENT's tag block parses regardless of intervening blank lines. `@a4c-rpc-shape: read` preserved; `@a4c-bucket: A` preserved; `@a4c-consultant-callable` flips `pending-phase3-refactor`→`yes`; `@a4c-phase-target` flips `3`→`none`. Correct.
5. **Matrix doc hand-edits byte-match the generators.** The `@a4c-consultant-callable-reason` value in the migration COMMENT is byte-identical to the Reason column in BOTH the `PER-RPC-TABLE` row (matrix L218) and the `PHASE-3-TARGETS` row (matrix L288). Since the reachability matrix `.md` is codegen-GENERATED between markers and CI (`rpc-reachability-matrix-sync.yml`) regenerates from the live DB COMMENT and fails on drift, this byte-match is what keeps CI green. Verified equal.

---

## Security / correctness of the new guard

```sql
IF NOT (
  public.has_platform_privilege()
  OR EXISTS (
    SELECT 1 FROM public.users caller
    WHERE caller.id = public.get_current_user_id()
      AND caller.accessible_organizations @> ARRAY[p_org_id]::uuid[]
  )
) THEN
  RETURN;
END IF;
```

- **42702 ambiguity fixed.** The function `RETURNS TABLE(id uuid, ...)`, so an unqualified `id` in the EXISTS would collide with the OUT column. The `caller` alias + `caller.id` qualifies it. No other unqualified-column hazard in the guard — `accessible_organizations` and `p_org_id` are unambiguous (`p_org_id` is a parameter; `accessible_organizations` is qualified via `caller.`). PASS.
- **No existence leak (Bucket A invariant).** Denied callers hit `RETURN` (empty), indistinguishable from "org with no members." No `RAISE`. PASS.
- **No false-admit path.** A non-member fails both disjuncts: not a platform admin, and `accessible_organizations` does not contain `p_org_id` → `EXISTS` is false → `RETURN`. The oracle is trigger-maintained (UNION of direct membership + active in-window grants), so a stale/expired grant is already removed from `accessible_organizations` by `sync_accessible_organizations_from_grants`. The guard cannot admit on an expired grant unless the trigger invariant is itself broken (out of scope; pre-existing Phase 1 surface). PASS.
- **NULL-safety for anon.** `get_current_user_id()` returns NULL when no JWT/override is present. `caller.id = NULL` matches zero rows → `EXISTS` false → `RETURN`. Anonymous callers get empty. PASS.

### Guard vs query-body consistency invariant (the central claim)

The PR claims "may you ask" and "what you see" can never disagree because both reference `accessible_organizations @> ARRAY[p_org_id]`. **Validated against the SQL:**

- Guard predicate: `caller.accessible_organizations @> ARRAY[p_org_id]` where `caller.id = get_current_user_id()`.
- Query predicate (L101): `u.accessible_organizations @> ARRAY[p_org_id]` over all rows.

These reference the **same column, same operator, same RHS**, differing only in subject (the caller vs. the listed users). The invariant is therefore: *the caller is admitted iff the caller is a member of `p_org_id`; the rows returned are exactly the members of `p_org_id`.* A subtle but correct consequence — if the caller is admitted, the caller themselves appears in their own result set (they are a member of `p_org_id`). That is the desired "what you can ask about == the population you see" property. Invariant holds. PASS.

### Design-by-Contract notes for the guard

```
api.list_users(p_org_id, ...)

Precondition (admit):  has_platform_privilege()
                       OR EXISTS member row: caller.accessible_organizations @> [p_org_id]
Precondition (deny):   ¬(above)  ⇒  RETURN ∅  (no RAISE; no existence signal)

Postcondition (admitted): result = { u ∈ users : u.accessible_organizations @> [p_org_id]
                                                  ∧ status-filter ∧ search-filter }
                          total_count = COUNT(*) OVER () of the filtered set
                          (empty set ⇒ zero rows emitted ⇒ total_count implicitly 0)

Invariant: GUARD_SUBJECT_PREDICATE ≡ QUERY_ROW_PREDICATE  (same oracle, same operator)
           ⇒ "authorized to ask about org X"  ⇔  "X is in caller's accessible_organizations"
           ⇒ admitted caller is always a member of the population they enumerate.

Invariant (oracle): accessible_organizations is trigger-maintained UNION
           (user_organizations_projection ∪ active in-window cross_tenant grants).
           Never written directly; expiry/revoke removes the org from the array.
```

---

## Backward compatibility (superset claim)

- **Platform admins**: `has_platform_privilege()` short-circuits — unchanged. PASS.
- **Org-internal admins**: previously admitted by `p_org_id = get_current_org_id()`. Their session org is, by direct `user_organizations_projection` membership, in their own `accessible_organizations`. The new EXISTS admits them. The only theoretical regression is a user whose JWT `org_id` (session pointer) names an org that is somehow NOT in their `accessible_organizations` — but per the CLAUDE.md oracle rule, `current_organization_id`/`org_id` is the *active-session pointer* and a member's session org is always a subset of their accessible set by construction. So the new guard is a true superset of the old one for legitimate callers, and *net-removes* one unsound admit path: the old form would admit a caller whose session `org_id == p_org_id` even if they had been removed from membership but still carried a stale JWT; the new form re-checks live membership. This is a correctness improvement, not a regression. PASS (superset + tightening).
- **Grant-bearers**: net-new admits (the Phase 3 goal). PASS.

---

## Performance

- The extra `EXISTS` is a single-row PK lookup (`caller.id = get_current_user_id()`) followed by an in-row array containment test — O(1) on the PK index; the `@>` on the already-fetched row does not need the GIN index. Negligible per-call cost. PASS.
- The query-body predicate `u.accessible_organizations @> ARRAY[p_org_id]::uuid[]` is sargable against `idx_users_accessible_orgs_gin` (GIN `array_ops` indexes `@>`). Unchanged from PR #66. On small dev tables the planner still prefers Seq Scan (correct). PASS.
- One micro-note (NOT a finding): the guard's EXISTS reads the caller's row, and the body re-reads the same row among the result set — two logical touches of `public.users` per call. This is inherent to the membership-oracle pattern and not worth optimizing; mentioned only for completeness.

---

## `list_invitations` split-out assessment

Deferring `list_invitations` out of Phase 3 is **correct**:

- The original 2026-05-26 handoff was demonstrably wrong: `invitation.read` does not exist (no `invitation.*` permission family is seeded), and a `has_effective_permission('user.view', path)` gate on `list_users` would be inert (no template confers `user.view`) and would violate the users-as-identities scoped-vs-unscoped rule. The PR's re-adjudication of the handoff is sound and well-documented in `tasks.md` (with the superseded version retained for provenance — good practice).
- Unlike `list_users`, `list_invitations` is not a clean guard swap: it pulls in (a) a permission seed via `permission.defined` and (b) a HIPAA exposure-policy decision (does a clinical-grant consultant see pending invitee PII?). These are genuinely separate work, not a punt on a fixable defect — so a card is the right vehicle, not an in-PR fix.
- The sub-card is well-formed: states the problem, the current deployed state, three explicitly gating decisions (exposure policy FIRST; permission seed only IF yes; RAISE→RETURN info-leak fix bundled with the rework so admin-tooling error UX isn't silently changed), an implementation sketch, relationships, and out-of-scope. It correctly flags the existing `RAISE EXCEPTION` info-leak (D3) but correctly declines to fix it now (changing it while still org-admin-only would silently alter admin-tooling error UX). Good judgment.

PASS.

---

## Mandatory Architecture Review Checklist

- **[PASS] CQRS Standards** — `list_users` is a Bucket-A read RPC; query-only; no projection writes; reads the membership oracle. `@a4c-rpc-shape: read` preserved. No command/query boundary violation.
- **[PASS] Naming Conventions** — `caller` alias, `Model M` comment marker, migration filename via the timestamped convention (`20260622183824_...`). Consistent with the `list_users*` family skeleton doc.
- **[PASS] Design Patterns** — Membership-oracle tenancy guard (the deliberate Bucket-A variant), not the three-step perm-gated skeleton. The PR's rejection of `has_effective_permission('user.view', path)` is *correct* per the users-as-identities scoped-vs-unscoped rule AND because no template confers `user.view` (the gate would be inert). Not over-engineered; not under-engineered.
- **[N/A] data-testid Attributes** — backend SQL migration; no UI surface in this PR.
- **[PASS] AsyncAPI Event Registration** — no new/modified events (read-only RPC emits nothing). Correctly unchanged.
- **[PASS] Type Generation — No Anonymous Types** — return shape unchanged → no TS regen required; the `database.types.ts` pair stays in sync by virtue of an unchanged signature. M3 shape comment (`read`) preserved. Correct per the "regen only on surface change" rule.
- **[PASS] Observability/Tracing** — read RPC; no new write/audit path; no silent code path introduced. Denied path is an explicit `RETURN` (Bucket A semantics), intentionally non-signalling — appropriate for an enumeration guard (signalling here would be the existence leak we are avoiding).
- **[PASS w/ NOTE] Error Surfacing to UI** — `list_users` returns empty on deny by design (Bucket A no-leak). This is the intended contract, not a swallowed error. NOTE for the frontend: an admin who *expects* members but is mis-scoped sees an empty list rather than an authz error — this is the deliberate trade-off documented in PR #66 and unchanged here. No action required.

---

## Items to address

All items below are **optional nits / pre-merge verification reminders** — none are blocking and none change the APPROVE verdict.

1. **(Nit, optional)** In the new COMMENT, consider dropping the trailing reference to `trg_sync_accessible_orgs` lineage that PR #66's COMMENT carried — the new COMMENT already re-states the oracle as "the UNION of direct `user_organizations_projection` membership AND active in-window `cross_tenant_access_grants_projection` grants," which is the more accurate post-Phase-1 description. No change strictly required; the new text is already correct. (File: `20260622183824_...sql:143`.)

2. **(Verification, pre-merge)** Run the reachability-matrix codegen locally against a freshly-migrated local container and confirm zero diff, to pre-empt the CI `rpc-reachability-matrix-sync.yml` gate:
   ```bash
   cd frontend && npm run gen:rpc-reachability-matrix && \
     git diff --exit-code documentation/architecture/authorization/cross-tenant-access-grant-rpc-reachability-matrix.md
   ```
   (Static analysis already confirms the reason strings byte-match in all three locations; this is belt-and-suspenders.)

3. **(Verification, pre-merge)** Run the M3 registry codegen and confirm `list_users` stays classified `read` with zero diff:
   ```bash
   cd frontend && npm run gen:rpc-registry && \
     git diff --exit-code src/services/api/rpc-registry.generated.ts
   ```

4. **(Verification, pre-merge — recommended)** Execute the transactional simulate-JWT smoke described in the sub-card / Phase 3 close-out (in-txn grant insert → trigger fires → `set_config('app.current_user', <consultant>)` + simulate claims → `SELECT * FROM api.list_users(<provider_org>, ...)` returns the provider's members → `ROLLBACK`). Confirms the guard admits a grant-bearer end-to-end and that a non-grant consultant gets empty. Paste the artifact into the Phase 3 close-out.

5. **(Nit, optional)** Sub-card decision #3 (RAISE→RETURN for `list_invitations`) is correctly deferred; when that card is picked up, ensure the info-leak fix and the membership conjunct land in the *same* migration so the org-admin error UX change and the new visibility are reviewed together. (Already noted in the card; flagging so it isn't lost.) No action this PR.

---

## Decision Record (condensed)

- **Context**: Phase 3 of the cross-tenant grant rollout. Consultants holding an active grant keep their JWT `org_id` at their home org, so the PR #66 session-org guard (`p_org_id = get_current_org_id()`) rejected them despite legitimate membership in `accessible_organizations`.
- **Decision**: Replace the session-org equality with an EXISTS against the caller's `accessible_organizations @> [p_org_id]` (Model M), making the guard reference the same oracle as the query body. Defer `list_invitations` to a decision-gated sub-card.
- **Alternatives rejected**: (a) Three-step `has_effective_permission('user.view', path)` skeleton — inert (no template confers `user.view`) and violates the users-as-identities scoped-vs-unscoped rule; (b) `has_cross_tenant_access(...)` gate — deployed stub returning FALSE; (c) bundling `list_invitations` — needs a permission seed + HIPAA policy decision, out of scope.
- **Consequences**: Grant-bearers gain `list_users` visibility; org-internal/admin/platform callers unaffected (true superset, with a minor soundness *improvement* — stale-JWT session-org admits are eliminated). Reachability matrix flips `list_users` to consultant-callable=yes, phase-target=none. No TS/AsyncAPI changes.
- **Pitfalls honored**: #6 (body fetched verbatim, only guard changed — query body byte-identical to PR #66); M3 OID/comment preservation (no signature change); Bucket-A RETURN-empty no-leak.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
