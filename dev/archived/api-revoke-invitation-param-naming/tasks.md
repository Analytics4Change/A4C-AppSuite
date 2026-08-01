# Tasks — api-revoke-invitation-param-naming

## Investigation

- [ ] Confirm Option A is correct by reading the existing call site:
  ```bash
  grep -nA 5 "revoke_invitation" frontend/src/services/invitation/SupabaseInvitationService.ts
  ```
  - If the call uses positional args → trivially compatible
  - If the call uses named args (`{ p_invitation_id: ... }`) → also update to the new name in the same PR
- [ ] Grep for any other consumer:
  ```bash
  grep -rn "revoke_invitation" frontend/src workflows/src infrastructure/supabase/supabase/functions
  ```

## Migration

- [ ] `supabase migration new rename_revoke_invitation_param`
- [ ] DROP FUNCTION api.revoke_invitation(uuid, text) (old signature)
- [ ] CREATE OR REPLACE FUNCTION api.revoke_invitation(p_invitation_record_id uuid, p_reason text DEFAULT 'manual_revocation') with the body referencing the renamed parameter
- [ ] Re-issue `COMMENT ON FUNCTION ... '@a4c-rpc-shape: envelope'` per DROP+CREATE rule
- [ ] `supabase db push --linked` clean
- [ ] `supabase db lint --level warning` clean

## Regen

- [ ] `supabase gen types typescript --linked > frontend/src/types/database.types.ts`
- [ ] `supabase gen types typescript --linked > workflows/src/types/database.types.ts`
- [ ] `cd frontend && npm run gen:rpc-registry`
- [ ] Frontend typecheck + lint clean
- [ ] Workflows typecheck clean

## Frontend

- [ ] If named-arg call: update `SupabaseInvitationService.revokeInvitation` to use `p_invitation_record_id`

## Tests

- [ ] Re-run any existing tests touching `revoke_invitation`
- [ ] One-shot Management API SQL smoke verifying the renamed function still revokes correctly

## PR shape

- [ ] Branch: `chore/rename-revoke-invitation-param`
- [ ] Single small commit
- [ ] No UAT — pure rename / clarification
