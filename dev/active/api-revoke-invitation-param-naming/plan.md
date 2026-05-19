# `api.revoke_invitation` parameter `p_invitation_id` actually filters on projection PK

**Status**: seed (not yet planned)
**Priority**: Low — the function works correctly for the existing caller (frontend `SupabaseInvitationService` per PR #44 extraction). Cleanup-only / naming/semantic clarity.
**Origin**: PR #64 UAT T2 cleanup (2026-05-18) — needed to revoke a pending invitation via Management API SQL; passed the EF's returned `invitationId` (event-correlation UUID = `invitation_id` column value) and got `{success:false, error:"Invitation not found or not revocable"}`. The function actually filters on the projection PK `id`, not on `invitation_id`. The two UUIDs are different per `handle_user_invited` letting `id` default to `gen_random_uuid()` while only storing the EF's invitation UUID in `invitation_id`.

## What's wrong

In `infrastructure/supabase/supabase/migrations/20260424221149_extract_revoke_invitation_rpc.sql` (and any subsequent retags):

```sql
CREATE OR REPLACE FUNCTION api.revoke_invitation(
    p_invitation_id uuid,             -- parameter NAMED as if it's the invitation_id column
    p_reason text DEFAULT 'manual_revocation'
) RETURNS jsonb ...
BEGIN
    ...
    SELECT organization_id, correlation_id
    INTO v_invitation_org_id, v_correlation_id
    FROM public.invitations_projection
    WHERE id = p_invitation_id           -- ⚠ actually filters on the projection PK column `id`
       AND status = 'pending';
    ...
END;
```

The parameter name implies it accepts the `invitation_id` column value (the event-correlation UUID emitted by `invite-user` and surfaced in `domain_events.stream_id`), but the body filters on `id` (the projection's PK, which is `gen_random_uuid()`-defaulted and not directly exposed in any EF response).

## Why the EXISTING caller works anyway

Per PR #44, the frontend `SupabaseInvitationService.revokeInvitation` is wired to pass an invitation reference from `api.list_invitations`, which returns the projection's `id` column AS `id`. So the frontend happens to pass the PK column value, which matches what the function filters on. The naming is misleading but the wiring is consistent.

The mismatch only bites consumers who:
- Read `invitationId` from the `invite-user` EF response (which surfaces the event-correlation UUID, not the projection PK), AND
- Try to pass that UUID into `api.revoke_invitation`

That class of consumer doesn't exist in the current codebase, but it's an obvious foot-gun for any future caller.

## Three viable fixes

### Option A (recommended): rename parameter to match what it filters

```sql
CREATE OR REPLACE FUNCTION api.revoke_invitation(
    p_invitation_record_id uuid,   -- explicit: this is the projection record's PK
    p_reason text DEFAULT 'manual_revocation'
) RETURNS jsonb ...
WHERE id = p_invitation_record_id
```

Pros: zero behavior change; pure clarification. Existing caller passes the same UUID; just the parameter name updates.
Cons: requires a DROP+CREATE (signature change), which means re-issuing `COMMENT ON FUNCTION ... '@a4c-rpc-shape: envelope'` defensively per the rule in `infrastructure/supabase/CLAUDE.md`. Generated TS types regen needed. RPC registry codegen needed.

### Option B: change WHERE to filter on `invitation_id` column

```sql
WHERE invitation_id = p_invitation_id
```

Pros: parameter name becomes accurate without renaming.
Cons: would change which UUID the function accepts. The existing caller passes the PK column value; after this change they'd need to pass `invitation_id` instead. **Breaking change for the existing caller.** Don't do this without auditing all consumers + updating the frontend service.

### Option C: accept either

Add a second parameter or a UNION/OR clause that matches `id OR invitation_id`. Over-engineering for a small clarity issue. Skip.

## Recommendation

**Option A**. Rename to `p_invitation_record_id`. Single-PR change. Side surface changes: drop+create migration, regen TS types, regen RPC registry, update any docblocks referencing the old name (minimal). No existing-caller code changes.

## Tests

- Unit/SQL: function still revokes by projection PK; rename is purely cosmetic at the wire level.
- Regression: `SupabaseInvitationService.revokeInvitation` still works (passes the same UUID; just the destination parameter name differs in DB-types).

## Files involved

- `infrastructure/supabase/supabase/migrations/<TIMESTAMP>_rename_revoke_invitation_param.sql` (new migration)
- `infrastructure/supabase/handlers/api/` — N/A, api.* RPCs don't have handler reference files
- `frontend/src/services/invitation/SupabaseInvitationService.ts` — passes the UUID positionally OR via the param name; verify and update if it uses the named-arg style
- `frontend/src/types/database.types.ts` + `workflows/src/types/database.types.ts` — regen
- `frontend/src/services/api/rpc-registry.generated.ts` — regen (signature changes, OID changes, comment must be re-issued)

## Out of scope

- Auditing whether other `api.*` RPCs have parameter naming inconsistencies. Could fold into a "naming convention sweep" card if any pattern emerges.

## Related

- **PR #64 UAT T2** — surfaced this during invitation cleanup (`uat.md` § T2 sign-off note).
- **`invite-user-route-existing-users-to-role-assign`** card — separately seeded 2026-05-18; tangentially related (touches the same EF response that returns `invitationId`).
