---
status: seed
last_updated: 2026-07-27
---

# Seed: Pin the correlation-id on `apiRpcEnvelope` reads

**Origin**: carved out of the shipped `apiRpc` read-path rollout ([[surface-transport-correlation-id-into-read-path-logs]], PR #94 + #98). Priority: **LOW-MED**.

## Gap

The read-path correlation-id mechanism (`supabaseService.apiRpc(fn, params, { correlationId })` → `builder.setHeader('X-Correlation-ID', id)`) covers only the **read-shape** helper `apiRpc`. Envelope-shape reads go through `apiRpcEnvelope`, which does **not** forward the header, so these reads still can't join a caller's log line to the server trace:

- `get_organization_details` (`SupabaseOrganizationQueryService.getOrganizationDetails` → `OrganizationManageFormViewModel.loadOrganizationDetails`)
- Schedules: `list_schedule_templates` / `get_schedule_template` (`SupabaseScheduleService`)
- Client-field usage counts: `get_field_usage_count` / `get_category_field_count`

## Why it's its own card (not bolted onto the read PR)

`apiRpcEnvelope` is **also the write-path helper** (every `create_*`/`update_*`/`delete_*` envelope RPC). Adding a `{ correlationId }` option + `setHeader` there touches the write path, so it needs its own spike + review — exactly the reasoning that kept it out of PR #98.

## Proposed

1. Add an optional `opts?: { correlationId?: string }` 3rd param to `apiRpcEnvelope` mirroring `apiRpc` (`supabase.service.ts`): guard `if (opts?.correlationId) builder.setHeader('X-Correlation-ID', opts.correlationId)`. **Note:** `apiRpcEnvelope` currently does `await apiClient.schema('api').rpc(...)` inline — refactor to hold the builder first (as `apiRpc` does) so the header can be set pre-await.
2. Thread `correlationId?` through the envelope-read methods above (interface → impl → mock) and their VMs (fresh-per-read id, logged on failure), per the selection rule in `frontend/src/services/CLAUDE.md` §4.
3. **Writes stay opt-in**: don't force a header on every envelope write; only pass one where a VM already has a meaningful transaction id (many command paths already carry `p_correlation_id` in the RPC body — decide whether the transport header should match).
4. Test parity: `*.correlation.test.ts` asserting the header opt is forwarded; update the §4 doc to drop the "`apiRpcEnvelope` exception" caveat once closed.

## Verification

- `tsc`/`eslint`/`build`/`npm run test`/`docs:check` green.
- Confirm no write-path behavior change when no `correlationId` is supplied (backward-compat: the guard means no header ⇒ `tracingFetch` auto-gen, identical to today).
