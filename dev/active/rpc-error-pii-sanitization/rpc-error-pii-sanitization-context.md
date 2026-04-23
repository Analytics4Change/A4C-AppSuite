# RPC processing_error PII Sanitization (Hybrid) — Context

**Feature**: Sanitize `processing_error` payloads returned to RPC callers (Hybrid Option 6 — server-side strip + display-layer mask)
**Status**: ⏸️ PARKED (no active implementation)
**Parked**: 2026-04-23 — surfaced during PR #30 (api-rpc-readback-pattern) self-review as finding m5
**Architect-reviewed**: 2026-04-23 (software-architect-dbc agent `ad2e78383cd378c9f`) — enumerated 6 options; recommended Option 6 (Hybrid) as best cost/benefit

## Problem Statement

Pattern A v2 RPCs (shipped in PR #30 across 19 RPCs) return raw `processing_error` text to any authenticated caller:

```sql
RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || v_processing_error);
```

The dispatcher trigger (`infrastructure/supabase/handlers/trigger/process_domain_event.sql` L50–54) captures raw PostgreSQL diagnostics into `processing_error` without sanitization:

```sql
GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
```

`PG_EXCEPTION_DETAIL` commonly contains row data — e.g., unique-constraint violation details include `Key (email)=(other-user@example.com) already exists`, potentially leaking PII or cross-tenant data to the caller even though RLS prevents direct reads of the affected row.

**Sharpest edge**: multi-tenant unique-constraint violations can surface cross-tenant values (HIPAA-relevant for this medication-management app).

## Why Deferred from PR #30

1. **PR #30 was already large**: 3 migrations, 20 RPC definitions, ADR, service-layer adaptation.
2. **Sanitization is orthogonal to Pattern A v2 semantics**: Pattern A v2 decides WHERE errors surface; sanitization decides WHAT level of detail surfaces. Different concerns.
3. **Recommended hybrid requires both a trigger-level migration AND frontend work** — cleaner as its own PR with dedicated tests.
4. **User's display-masking hint captured** (m5 prompt): "the display component should be masked perhaps?" — the architect confirmed masking is a correct COMPONENT but insufficient alone.

## Architect-Enumerated Options (for traceability)

Full report saved at `/tmp/toolu_01H1MrxcYMxxv6F7U9cyWHjS.json`. Ranking summary:

| # | Option | Security | Ergonomics | Complexity | Rollout | Rank |
|---|--------|----------|------------|------------|---------|------|
| 6 | **Hybrid** — strip `PG_EXCEPTION_DETAIL` at trigger + display-mask | Strong | Good | Low | Low | **1st (recommended)** |
| 1 | Strip `PG_EXCEPTION_DETAIL` at trigger | Best | Fair | Low | Low | 2nd |
| 3 | Role-based disclosure (admin gets full detail, others get generic) | Good | Best | Medium | Medium | 3rd |
| 5 | Two-tier event_id response + permissioned `api.get_event_detail()` | Best | Clean | High | High | 4th (right long-term) |
| 2 | RPC-level wrap (every RPC returns generic message) | Good | Poor | High | Medium | 5th |
| 4 | Frontend masking only (user's hint) | Weak | Good | Medium | Trivial | 6th (insufficient alone) |

## Proposed Implementation (Option 6 — Hybrid)

### Server-side: strip `PG_EXCEPTION_DETAIL` at trigger

Edit `infrastructure/supabase/handlers/trigger/process_domain_event.sql` L54:

```sql
-- BEFORE (leaky)
NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');

-- AFTER (sanitized)
NEW.processing_error = v_error_msg;
```

**Optional second column for admin visibility** (defer decision):
Add `processing_error_detail text` to `domain_events` gated by an RLS policy that allows SELECT only for users with `platform.event.view_detail` permission. Wired to the admin `/admin/events` dashboard.

### Frontend: display-layer masking utility

Add `frontend/src/utils/maskPii.ts`:

```typescript
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

export function maskPii(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(UUID_RE, '<uuid>')
    .replace(EMAIL_RE, '<email>');
}
```

Consumer sites (ViewModels that surface the `error` string to UI):
- `ClientIntakeFormViewModel` error toast
- `RoleAssignmentViewModel` error banner
- `ScheduleTemplateViewModel` save-error display
- Any ViewModel that calls `Client*Service.update*` and renders `result.error`

## Acceptance Criteria

- [ ] Migration: `supabase migration new strip_processing_error_detail` rewrites `public.process_domain_event()` trigger to set `NEW.processing_error = v_error_msg;` (drops `PG_EXCEPTION_DETAIL` concatenation). Handler reference file `infrastructure/supabase/handlers/trigger/process_domain_event.sql` updated to match.
- [ ] Spot-check with forced unique-constraint violation → `processing_error` in `domain_events` contains only `MESSAGE_TEXT` (e.g., "duplicate key value violates unique constraint \"foo_unique\"") — NO row-value `Key (column)=(value)` leak.
- [ ] `maskPii()` utility added at `frontend/src/utils/maskPii.ts` with unit tests covering UUID + email patterns.
- [ ] Every ViewModel surfacing RPC `result.error` text to UI routes through `maskPii()` before assignment.
- [ ] Admin `/admin/events` dashboard verified — still reads full `processing_error` via direct `domain_events` query (no regression).
- [ ] Regression test: run a query that generates a unique-constraint violation → RPC response envelope does NOT contain any UUID-like or email-like substring from the violating row.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` pass.
- [ ] ADR `adr-rpc-readback-pattern.md` "Telemetry convention" section updated to reflect masking and detail-stripping; `last_updated` bumped.

## Rollout Considerations

- **Backward-compat**: Reduces diagnostic payload. Any tooling that parsed `processing_error` substrings (grep/regex) may need updating — audit: no known consumer parses beyond prefix `"Event processing failed: "`.
- **Admin dashboard**: Preserve full `processing_error` visibility via direct `domain_events` reads (RLS-gated; admins have `platform.event.read` or equivalent). Verify the RLS policy before merging.
- **Dev ergonomics**: Developers in dev env can still query `domain_events` directly for full detail; only the RPC return-path is sanitized.

## Related Work

- PR #30 `feat/api-rpc-readback-pattern` — introduced the `processing_error` return-path that motivated this finding.
- `infrastructure/supabase/handlers/trigger/process_domain_event.sql` — the file this fix edits.
- `documentation/architecture/decisions/adr-rpc-readback-pattern.md` — "Telemetry convention" section will need an update to reflect masking.

## Reference Materials

- PR #30 self-review finding m5 (lars-tice review 2026-04-23)
- Architect report for PR #30 remediation (agent `ad2e78383cd378c9f`, 2026-04-23) — full 6-option enumeration with tradeoffs
- User's design hint (2026-04-23): "the display component should be masked perhaps?" — captured here as Option 4 component of the hybrid
