---
status: seed
last_updated: 2026-07-28
---

# Platform-owner self-onboarding (DECISION-GATED) — let a4c onboard platform people without a migration

**Priority:** Low–Medium, **decision-gated** (2a-vs-2b and JWT-default-vs-bootstrap are unresolved forks).
**Origin:** split from `superadmin-no-org-context-on-tenant-subdomain` (Intent 2), 2026-07-28. See that card's RESOLUTION header for the Intent-1/Intent-2 split and why options A–C were rejected.

## Problem

Today the **only** way to create a new `super_admin` / a4c-org member is a migration / SQL seed, because the founding super_admin (`org_id: NULL`) is 403'd on every UI invite (`invite-user/index.ts:~748`, `manage-user:~179` — the same guard the honest-gate card fronts). `org_id` is minted from `users.current_organization_id` (**never** the subdomain), so a global super_admin cannot invite anyone, anywhere, through the UI.

## Reproduction / inherited anchors

- Repro packet: origin card (correlation id `8dc9de62-5c26-4b68-9e4c-e2fe4dbb7ca1`, tenant subdomain, 403 body `{"error":"No organization context in token"}`).
- The gate this card must respect: `usePlatformNoOrgContext()` (`frontend/src/hooks/`) + `PlatformNoOrgContextBanner` (`frontend/src/components/users/`) on `UsersManagePage`.
- EF guards inherited: `invite-user/index.ts:~748`, `manage-user/index.ts:~179`.

## The problematic NULL `organization_id` — a system-wide overloaded sentinel (NOT JWT-only), 3 meanings

1. **"Global authority / all orgs" (on a *role*)** — `super_admin` is the ONLY role `roles_projection_scope_check` permits `organization_id IS NULL` (baseline `:13395`). Load-bearing in ~a dozen predicates: role visibility (`NULL AND org_type='platform_owner'`, baseline `:3560`/`:4323`), access-*skip* checks (`:7911` "Global roles skip org access check", `:12027` "Super admin sees all", `:7905`, `:11950`), `switch_organization` access (`= target OR IS NULL` → NULL-org role switches into any org, `:11733`), assignable-roles (`= p_org OR IS NULL`, `:3431`/`:6947`/cross-tenant-phase-1 `:185`), `is_global` computed (`:4308`).
2. **"System / shared template" (on *field categories*)** — `field_categories.organization_id IS NULL` = seeded/locked system category (`is_system`), an unrelated reuse (`:214`/`:545`, client-field migrations).
3. **"No active context" (on `users.current_organization_id` → JWT `org_id`)** — NULL = "no org selected" → downstream reads "no context → 403."

**Core defect:** ① and ③ collide onto one value. A global super_admin is NULL in *both* senses at once — "all-powerful everywhere" (role) and "nowhere, no context" (current org). The JWT hook flattens them to a single `org_id: NULL`; downstream consumers can only perceive meaning ③, never ①. The JWT is merely where the overload becomes a *visible* failure — the overload itself is structural (the schema constraint + ~a dozen predicates above).

## Design fork (pick in plan phase)

- **2a — onboard an a4c-org *member* (normal roles).** Ordinary org-scoped invite *into the a4c platform_owner org* (a **real UUID**). Works once an inviter has a4c org context, via either:
  - (i) the JWT hook defaulting a global super_admin's `org_id` → the platform_owner org (small backend change — but see the inherited constraint below), or
  - (ii) a one-time bootstrap of the first real a4c-org member (using the repaired `public.switch_organization(p_new_org_id)`, per the honest-gate card) who then invites others.
  - **Discovery step:** obtain the a4c org UUID via `organizations_projection WHERE type='platform_owner'` or `api.check_organization_by_slug('<a4c-slug>')` (granted to `authenticated`).
- **2b — mint another *global `super_admin`* (NULL-org system role).** Assigning a NULL-org system role through the org-scoped invite path is a model mismatch (the invite flow assigns roles *into* an org); needs a dedicated path + its own "who may mint a platform-wide admin, audited how" security design — overlaps `impersonation-security-controls.md`.

## Hard constraint inherited from the honest-gate card

Whatever Intent 2 does, it must **NOT reintroduce a silent wrong-org write**. If super_admins gain a default `org_id` (fork 2a-i), org-scoped writes on a *tenant* subdomain must still gate/fail-safe — the honest condition then becomes *"subdomain's org ≠ token's org"*, not merely "has any org." Update `usePlatformNoOrgContext` accordingly if that fork is taken.

**Gate-coverage caveat (row actions).** The honest-gate PR gates only the **Invite** button, because today a no-org super_admin's `list_users` (called with `p_org_id = claims.org_id`, NULL) returns an **empty** list, so the row/edit-panel write affordances (Reactivate, Resend/Revoke, `ManageUserActions`) are unreachable and need no separate gate. Fork 2a-i would give that super_admin a **populated** list — surfacing those actions — so taking 2a-i requires **extending the state gate to every row/edit-panel write on `UsersManagePage`**, not just Invite. (Anchor recorded in the `platformNoOrg` comment block in `frontend/src/pages/users/UsersManagePage.tsx`.)

## Verification (stub — per chosen fork)

- As the target platform person, complete onboarding via the UI (no migration); confirm the new user appears with the intended role.
- Confirm a tenant-subdomain org-scoped write by that person still gates / fails-safe (boundary preserved — no silent wrong-org write).

## Related

- Origin: `superadmin-no-org-context-on-tenant-subdomain/` (Intent-1/Intent-2 split, A–D adjudication).
- Honest-gate PR (this work): `usePlatformNoOrgContext`, `PlatformNoOrgContextBanner`, `contexts/CLAUDE.md` boundary rule, repaired `switch_organization` call.
- Acting-*as* a tenant (Intent 1) → **existing impersonation subsystem** (scaffolded, not-yet-functional): `documentation/architecture/authentication/impersonation-architecture.md` + `impersonation-{security-controls,implementation-guide,event-schema,ui-specification}.md`; `frontend/src/components/auth/ImpersonationBanner.tsx`, `ImpersonationModal.tsx`, `services/auth/impersonation.service.ts`, `hooks/useImpersonationUI.tsx`; `impersonation_sessions_projection` table.
- Primitive: `public.switch_organization(p_new_org_id)` (repaired by the honest-gate card) already permits a global super_admin to switch into any org (`:11733`) but emits no event and requires a JWT refresh.
