# invite-user revoke → SQL RPC — Plan

## Executive Summary

Extract `revoke` operation from `invite-user` Edge Function. Investigation phase first: determine whether this reduces to a frontend-only change (pointing at the existing `api.revoke_invitation` RPC) or requires new RPC work.

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Inspect `invite-user` v15 `revoke` case body; determine if it's a pure RPC forward or has additional logic |
| 1 | (If pure forward) Frontend service cutover only — no migration needed |
| 1' | (If wrapping logic) Migration creating `api.<wrapper>` RPC that captures the pre/post logic |
| 2 | Remove `revoke` case from Edge Function |
| 3 | Verification + PR |

## Open Questions

- **O1** — Does the Edge Function's `revoke` case add auth-token-shaped logic beyond what `api.revoke_invitation` already does?
- **O2** — Are there non-frontend callers of the Edge Function's revoke case? (workflows/, admin scripts)

## Risks

- **R1** — Low. Simple extraction if Phase 0 confirms pure-forward.
