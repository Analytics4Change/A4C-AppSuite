# Retire `api.resend_invitation`

**Status**: seed
**Created**: 2026-07-31 (PR #110 architect review, finding F2)
**Priority**: LOW — the safety hole is CLOSED; this is surface reduction only
**Origin**: `dev/archived/pr-e-email-uniqueness-constraints.md`

## What already happened

PR #110 (`20260731005639`) **hardened** this RPC rather than dropping it:

- added the supersede precondition (`(org, normalized email)` scoped, matching
  `uq_invitations_pending_org_email` exactly),
- replaced `PERFORM api.emit_domain_event(...)` with a captured `v_event_id` plus
  a `processing_error` read-back (Pattern A v2),
- so it can no longer report `true` after a write that silently did not happen.

**The hole is closed.** Nothing here is a safety follow-up.

## Why retirement is still the better end state

Its signature has the caller supply `p_new_token` and `p_new_expires_at`. That
belongs to the pre-Edge-Function design where the caller minted the token;
`invite-user` owns token generation and expiry now. Reviving this RPC would mean
reintroducing a second, divergent resend policy.

Also: it returns `boolean`, so all three refusal reasons (not resendable,
superseded, handler failed) collapse to `false`. A caller cannot tell them apart
or surface anything useful. Hardening made it honest, not good.

Confirmed unused at review time — no caller in `frontend/`, `workflows/`, or any
Edge Function. It reaches the wire only via `service_role`.

## Why it was NOT dropped in PR #110

A `DROP FUNCTION` changes the Postgres surface, which per the type-regen rule
requires regenerating **both** `database.types.ts` copies (frontend + workflows)
plus `rpc-registry.generated.ts` and the reachability-matrix doc. That is a wider
blast radius than a constraints PR should carry, and `supabase gen types --linked`
was not runnable at the time (vault locked). Scope decision, not a safety one.

## Steps when picked up

1. `DROP FUNCTION IF EXISTS api.resend_invitation(uuid, text, timestamptz);`
2. Regenerate both `database.types.ts` copies in the same commit (they must stay
   byte-identical).
3. `cd frontend && npm run gen:rpc-registry` — CI gate `rpc-registry-sync` fails
   otherwise.
4. Regenerate / strike the reachability-matrix row (currently Bucket E).
5. Re-run `npm run typecheck` in both `frontend/` and `workflows/`.

## Related

- Pitfall: a constraint violation inside an event handler fails silent.
- `dev/archived/pr-e-email-uniqueness-constraints.md` — parent (SHIPPED #110).
- `retag-email-lookup-rpcs-bucket-a` — separate, still open; do not conflate.
