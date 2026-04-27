# Sub-tenant Admin Design — Tasks

## Current Status

**Phase**: SEEDED (2026-04-27)
**Status**: 🌱 DEFERRED — awaiting business-need trigger
**Priority**: None (no work should start without product/eng prioritization)

## Tasks

- [x] Card seeded with context, design-space plan, references — 2026-04-27
- [ ] **Business-need trigger** — surface sub-tenant admin requirement from a customer / partner / compliance driver
- [ ] **Design exploration** — answer Open Questions in `plan.md` (multi-OU membership semantics, identity-vs-shift-OU distinction, role-aggregation rule, placement-eligibility filter relationship)
- [ ] **Architectural review** — `software-architect-dbc` once design is settled; pre-empt the same misreading that triggered the 2026-04-27 course correction
- [ ] **Data-model migration** — projections, columns, events for chosen option
- [ ] **Helper redesign** — replace the dropped `public.get_user_target_path` with a helper aligned to the new data model (signature, semantics, error envelope)
- [ ] **RPC retrofit** — `api.delete_user`, `api.update_user_notification_preferences`, future `manage-user-reactivate`, etc., switch from unscoped to scoped checks against the new helper
- [ ] **Frontend** — UI affordances for sub-tenant admin role assignment, scoped views

## Cross-references

- Origin: `dev/active/manage-user-delete-to-sql-rpc/plan.md` § Phase 1.5 Course Correction
- Architectural decision: `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md` Rollout 2026-04-27 § course correction
- Permission rule: `infrastructure/supabase/CLAUDE.md` § Critical Rules
