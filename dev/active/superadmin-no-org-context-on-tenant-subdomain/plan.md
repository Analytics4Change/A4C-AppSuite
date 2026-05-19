# super_admin gets HTTP 403 "No organization context in token" when invoking org-scoped EFs from a tenant subdomain

**Status**: seed (not yet planned)
**Priority**: Medium — annoyance, not a regression; existed pre-nginx-fix but was masked by the earlier nginx 400 (you couldn't even reach the subdomain to discover this). Now exposed by `dev/archived/fix-nginx-large-client-header-buffers/` shipping (PR #65, 2026-05-19).
**Origin**: 2026-05-19 bonus UAT of PR #64 T1 ran as super_admin (`lars.tice@gmail.com`) on `testorg-20260329.firstovertheline.com/users/manage`. Invite User dialog → HTTP 403 `{"error":"No organization context in token"}`. Same problem was alluded to in PR #64's UAT notes as the "super_admin role-validation quirk" that forced the original T1 actor to switch to `johnltice@yahoo.com`.

## Reproducibility evidence (2026-05-19 — post-nginx-fix)

- **UI inviter**: `lars.tice@gmail.com` (super_admin, `users.current_organization_id = NULL`)
- **Subdomain**: `https://testorg-20260329.firstovertheline.com`
- **Action**: Users → Invite User → dakaratekid@gmail.com, role "Aspen Program Manager", Send
- **Response**: HTTP 403, body `{"error":"No organization context in token"}`
- **UI banner**: "Failed to send invitation / No organization context in token"
- **Correlation ID**: `8dc9de62-5c26-4b68-9e4c-e2fe4dbb7ca1`
- **domain_events**: zero rows for that correlation_id — rejected at EF preflight, no side effects.

## Hypothesis

The Edge Function (likely `invite-user`, possibly other org-scoped EFs) reads `org_id` from the JWT claims to determine the target organization for the write. Super_admin has `effective_permissions` with `s=""` (root scope, global), but the `org_id` claim itself is populated from `users.current_organization_id`, which is NULL for super_admin by default. So:

- JWT `org_id` claim → absent
- EF preflight check → "No organization context in token" → 403

This is the **right defensive posture** for a non-super_admin user with no org context, but it doesn't account for super_admin who:
- Has the permission set to act in any org
- Is invoking the EF from a specific tenant subdomain (the subdomain itself implies org intent)

## Possible resolutions (design space — pick one in plan phase)

| Approach | Trade-off |
|---|---|
| (A) EF reads target org from the request body (`organizationId` already in invite payload? need to check) and falls back to subdomain-derived lookup if JWT `org_id` absent **AND** caller has super_admin claim | Most architecturally clean; only loosens the check for super_admin. Requires careful audit of every org-scoped EF, not just `invite-user`. |
| (B) Frontend auto-sets `users.current_organization_id` to the subdomain's org when super_admin lands on a tenant subdomain, force a JWT refresh, then proceed | Mutates DB on every super_admin tenant visit; refresh-roundtrip latency; multiple tabs on different subdomains race. |
| (C) `api.switch_org_unit` (or equivalent) becomes a deliberate super_admin precondition: super_admin must explicitly "enter" an org before performing writes | Highest discoverability, explicit consent; worst UX. |
| (D) Frontend gates the Invite User button for super_admin with NULL `current_organization_id`, showing "Switch active organization to testorg-20260329" CTA | Defense-in-depth + UX clarity; doesn't fix the underlying EF — a curl call would still 403, which is arguably correct. |

Note: PR #64 UAT used a manual workaround — `set_config` swap of `users.current_organization_id` to testorg's UUID via Management API + session refresh. That's not viable as a permanent answer.

## Out of scope (this card)

- Cross-tab session coherence for super_admin viewing two subdomains simultaneously
- The broader "super_admin should impersonate via the impersonation flow" architecture (`documentation/architecture/authentication/impersonation-architecture.md`)

## Verification

Whatever option ships:
- super_admin on `testorg-XXX` subdomain → Invite User → expect 201 success (or 422 cross-provider gate, depending on invitee) — NOT 403
- super_admin on `a4c.firstovertheline.com` (platform) → invocation of org-scoped writes still fails appropriately (no org chosen)
- Non-super_admin with NULL `current_organization_id` still gets 403 (no regression)

## Related

- **Origin context**: `dev/archived/fix-nginx-large-client-header-buffers/` (PR #65) — the nginx fix unblocked discovery of this quirk
- **Source EF**: `infrastructure/supabase/supabase/functions/invite-user/index.ts` — grep for the "No organization context in token" string and audit sibling EFs
- **JWT claims hook**: `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql:7124-7138` (super_admin claim materialization)
- **Impersonation architecture** (potential reference): `documentation/architecture/authentication/impersonation-architecture.md`
