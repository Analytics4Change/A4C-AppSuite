# API RPC Read-back Pattern — Tasks

## Current Status

**Phase**: PARKED — to be activated immediately after `client-ou-edit` PR 1 merges
**Status**: ⏸️ PARKED
**Last Updated**: 2026-04-22
**Next Step (on activation)**: Move this directory from `dev/parked/` to `dev/active/`, then run Phase 0 RPC inventory query against the live DB.

---

## Activation Trigger

Activate this feature when:
- `client-ou-edit` PR 1 has merged (so the `api.update_client` proof-of-pattern exists as reference)
- Team capacity available for ~medium-effort refactor (1–2 days of focused work)

## Phase 0: RPC Inventory ⏸️ PARKED

- [ ] Run `pg_proc` query to list all `api.update_*` and `api.change_*` RPCs
- [ ] For each, inspect function body via `pg_get_functiondef(oid)` — does it already read back?
- [ ] Classify into: already-done / standard-pattern-apply / complex-case-by-case
- [ ] Produce tracking table in `api-rpc-readback-pattern-plan.md` Phase 0 section
- [ ] Confirm exclusions: `api.update_client`, `api.change_client_placement` (owned by client-ou-edit)

## Phase 1: Migration ⏸️ PARKED

- [ ] Create migration: `supabase migration new api_rpc_readback_pattern`
- [ ] Migration header: document pattern, list all RPCs touched, reference ADR
- [ ] For each standard-pattern RPC (from Phase 0 inventory):
  - [ ] `CREATE OR REPLACE FUNCTION` with read-back + processing_error check
  - [ ] Error codes P9003 (NOT FOUND) + P9004 (handler failure)
  - [ ] Preserve existing param signatures
  - [ ] Add `row_to_json(v_row)` (or explicit `jsonb_build_object` if join needed) to response
- [ ] For each complex RPC (from Phase 0 inventory):
  - [ ] Case-by-case implementation
  - [ ] Document edge cases in migration header comment
- [ ] Apply migration: `supabase db push --linked`
- [ ] Refresh handler reference files for any affected handlers
- [ ] Manual spot-check: call each RPC, verify response shape

## Phase 2: Frontend Service Updates ⏸️ PARKED

- [ ] For each in-scope service (organization, roles, users, schedules, etc.):
  - [ ] Update response type in service interface
  - [ ] Add backward-compat fallback: `response.row || response.entity || ...`
  - [ ] Update unit tests
  - [ ] Update mock service responses

## Phase 3: Documentation ⏸️ PARKED

- [ ] NEW ADR: `documentation/architecture/decisions/adr-rpc-readback-pattern.md`
  - [ ] YAML frontmatter (status, last_updated)
  - [ ] TL;DR
  - [ ] Decision: read-back is mandatory for all api.update_*
  - [ ] Contract specification (response shape, error codes)
  - [ ] Migration/rollout history
- [ ] Update `documentation/infrastructure/patterns/event-handler-pattern.md` with RPC-side contract section
- [ ] Update `documentation/AGENT-INDEX.md` — new keyword `rpc-readback`
- [ ] Run `npm run docs:check` to verify compliance

## Phase 4: ViewModel Simplification ⏸️ PARKED (OPTIONAL — may be separate PR)

For ViewModels that workaround the old pattern by calling `getX()` after every update:
- [ ] Audit frontend ViewModels for post-update `getX()` calls that exist only as workaround
- [ ] Remove redundant fetches where safe
- [ ] Consume `row` from update response directly
- [ ] Update tests
- [ ] Exclude ViewModels that call `getX()` for OTHER reasons (e.g., refreshing joined data)

## Verification ⏸️ PARKED

### PR 1 pre-merge
- [ ] `npm run build` / `npm run lint` — pass
- [ ] `supabase db push --linked --dry-run` — no drift
- [ ] Manual RPC test: update with valid data → response contains row
- [ ] Manual RPC test: force handler failure (e.g., RLS denial) → RPC raises exception
- [ ] Failed events query: `SELECT COUNT(*) FROM domain_events WHERE processing_error IS NOT NULL AND created_at > now() - interval '1 day'` — spot new failures surface correctly
- [ ] `client-ou-edit`'s `api.update_client` read-back consistent with new pattern

### PR 2 (if shipped) pre-merge
- [ ] VM tests still pass after workaround removal
- [ ] No regression in save UX
