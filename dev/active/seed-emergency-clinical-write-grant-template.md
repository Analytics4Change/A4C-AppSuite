# Seed `emergency_clinical_write` grant-role template (write/administer emergency authority)

**Status**: seed (not yet planned) — **decision-gated**
**Priority**: Low-Medium (no current use case; forward-need placeholder so the concept isn't lost)
**Origin**: Spun out of `seed-grant-role-templates-emergency-default.md` (shipped) as the explicitly-deferred write-capable sibling. Architect (`software-architect-dbc`) named it as out-of-scope for the read-only default.

## Problem / need

The shipped `emergency_default` template (`{client.view, medication.view}`, both read-only clinical-PHI
leaves) makes the `emergency_access` authorization type reachable in its **least-authority** form: a
covering clinician at another org can be granted time-bounded **read** visibility into a client's record
+ active meds. That deliberately excludes any **write/administer** authority.

A separate, genuinely higher-bar need may arise: an emergency in which the cross-tenant clinician must
**act** — e.g. record an administration, update a client record, or document a discharge/transfer — not
merely view. That requires a distinct template (`emergency_clinical_write`) carrying mutation-capable
permissions, and it is **not** a tweak to `emergency_default`.

## Why this is a separate card (not folded into emergency_default)

From the `emergency_default` architect decision record
(`~/.claude/plans/misty-popping-bengio-agent-a9ecd00d9dc2ce504.md`, Q2):

> "Write/administer perms … would make EVERY non-overridden emergency grant cross-tenant write-capable.
> That is a categorically higher authorization bar (clinical mutation across a tenant boundary) and
> belongs to a separate future template (`emergency_clinical_write`) gated by its own decision + likely
> a stricter authz validator — NOT the default."

Key differences from the read-only default:

1. **Mutation power.** `client.update / client.discharge / client.transfer / medication.administer`-class
   perms are NOT implication leaves — they sit at the top of the implication graph and confer real
   write authority across a tenant boundary. The read-only default was provably non-escalating
   (verified: `client.view`/`medication.view` have 0 outbound implications); a write set is the opposite.
2. **Stricter authz validator.** `emergency_default` reuses `_validate_authorization_emergency_access`
   (returns TRUE unconditionally — emergency forces `authorization_reference IS NULL`). A write-capable
   emergency grant likely needs a stronger gate (e.g. a backing record, a second-party attestation, or a
   narrower caller-permission requirement) — a new/parameterized validator.
3. **Compliance sign-off.** The 72h expiry cap (policy-in-code) and the permission set both need explicit
   compliance ratification at the higher write bar — distinct from the read-only ratification done
   2026-06-15.

## Open decisions (the gating items — do not build until locked)

1. **Permission set**: which write/administer perms, exactly? (`medication.administer` only? + `client.update`?
   Discharge/transfer almost certainly excluded from an *emergency* template.) Must verify each exists in
   `permissions_projection` (the inner-JOIN silent-drop class — migration-time assert, as in `emergency_default` Section A).
2. **Validator**: keep the unconditional emergency validator, or introduce a stricter
   `_validate_authorization_emergency_write` (backing record / attestation)?
3. **Expiry cap**: same 72h, or shorter for write authority?
4. **Override semantics**: `p_permission_overrides` is INTERSECT-narrowing only (never widening) — confirm
   a write template still composes correctly (it does mechanically; the question is policy).
5. **Is there a real use case yet?** If none, this stays a seed. Don't seed a write-capable cross-tenant
   PHI template speculatively.

## Implementation sketch (once decisions locked — mirrors emergency_default)

1. Section A fail-loud: assert each chosen write perm exists in `permissions_projection`.
2. Section B: `INSERT INTO grant_role_templates (template_name='emergency_clinical_write', authorization_type='emergency_access', permission_name=…, default_terms='{"phi_restricted": true}') ON CONFLICT DO NOTHING`.
3. Section C (only if a stricter validator is adopted): new `_validate_authorization_emergency_write`
   (underscore-prefix + REVOKE/GRANT ritual) + a CASE branch dispatch in `api.create_access_grant`
   (body-only; fetch deployed body via pg_get_functiondef first — pitfall #6).
4. Re-probe via the transactional-rollback simulate-JWT pattern (BEGIN; set_config; create_access_grant; ROLLBACK).

## Relationships

- **Sibling of** (shipped): `seed-grant-role-templates-emergency-default.md` — the read-only default this one deliberately excludes write authority from.
- **Under**: parent `cross-tenant-access-grant-rollout/` (Phase 2 follow-up family).
- Frontend emergency-grant UI and Phase 3/4/N rollout are tracked in the parent card — out of scope here.

## Out of scope

- The read-only `emergency_default` template (done).
- Any non-emergency authorization type (court/agency/family — Phase N).
- Frontend UI.
