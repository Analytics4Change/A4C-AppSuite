# Tasks — superadmin-no-org-context-on-tenant-subdomain

## Investigation (do before planning)

- [ ] Grep the EF source for "No organization context in token" — confirm `invite-user/index.ts` is the source; find sibling EFs with the same check.
  ```bash
  grep -rn "No organization context in token" infrastructure/supabase/supabase/functions/
  ```
- [ ] Read the JWT custom-claims hook (`baseline_v4.sql:7124-7138`) — confirm how `org_id` claim is populated and why it's NULL for super_admin.
- [ ] Inventory all org-scoped EFs that read `org_id` from JWT vs. from request body. Decide whether this is a one-EF fix or a class-of-EFs fix.

## Planning (after investigation)

- [ ] Pick a resolution from options A–D in `plan.md` (or invent E). Document the trade-off chosen.
- [ ] Confirm whether super_admin impersonation flow is the architecturally correct answer (would supersede this card entirely).

## Out of scope acknowledgement

- This card does NOT block ongoing tenant-tier development. Provider_admin and lower roles work normally; super_admin can still administer via `a4c.firstovertheline.com` or by manually setting `current_organization_id` via Management API.
