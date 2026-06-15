# `handle_user_deleted` should cascade-cleanup all FK-dependent membership projections

**Status**: seed (not yet planned)
**Priority**: Medium-High — data integrity defect with concrete observable consequences (broken `check_user_org_membership` semantics for soft-deleted users; UAT can't reach Finding #3's gate-skip path because role rows linger). Multiple consuming RPCs currently work around the symptom with `WHERE u.deleted_at IS NULL` joins; the architectural fix is to make the projection state reflect the lifecycle event consistently.
**Origin**: PR #64 UAT T4 prep (2026-05-19) — couldn't find a clean "soft-deleted user with no role rows" subject because `handle_user_deleted` doesn't nuke `user_roles_projection` rows. Inventory across all projections holding `user_id` references showed **10 stale rows** across 4 tables for the 2 soft-deleted users on dev.

## Problem statement

`handle_user_deleted` sets `users.deleted_at` to mark the user soft-deleted, but does NOT cascade-clean dependent projection rows that anchor on `user_id`. Several membership/preference projections retain rows for users who are tombstoned. This:

1. Breaks the invariant that "soft-deleted user has no active state" — read-side RPCs that join through these projections must add ad-hoc `WHERE u.deleted_at IS NULL` filters to compensate. Some do (`api.list_users`, `api.get_user_notification_preferences`, etc., per the 2026-04-24 orphan-filter migration); others don't (e.g., `api.check_user_org_membership` returns soft-deleted users with their role rows intact).
2. Produces inconsistent EF behavior: PR #64's Finding #3 closeout filters soft-deleted users from `api.check_user_exists`, intending to surface them as `not_found` to `checkEmailStatus`. But for users with role rows in the target org, `check_user_org_membership` short-circuits the lookup first and returns `deactivated` status — making the Finding #3 fix unreachable end-to-end for any subject with stale role rows.
3. Leaves audit-trail noise: a deleted user's projections still appear in joins, leading to surprising query results during ad-hoc investigation.

## Inventory of FK-dependent tables (2026-05-19 dev snapshot)

| Schema | Table | Column | Stale-rows-for-soft-deleted | Category | Action on user.deleted |
|---|---|---|---|---|---|
| public | user_roles_projection | user_id | **3** | Membership | **DELETE** (cascade) |
| public | user_organizations_projection | user_id | **2** | Membership | **DELETE** (cascade) |
| public | user_notification_preferences_projection | user_id | **2** | Membership | **DELETE** (cascade) |
| public | user_addresses | user_id | 0 | User-owned identity | **DELETE** (cascade) |
| public | user_phones | user_id | **3** | User-owned identity | **DELETE** (cascade) |
| public | user_client_assignments_projection | user_id | 0 | Membership | **DELETE** (cascade) |
| public | user_client_assignments_projection | assigned_by | (not measured) | Audit reference | **KEEP** (historical fact) |
| public | schedule_user_assignments_projection | user_id | 0 | Membership | **DELETE** (cascade) |
| public | contacts_projection | user_id | 0 | Membership-adjacent | **NULL** (preserve contact, drop user linkage) |
| public | cross_tenant_access_grants_projection | consultant_user_id | (not measured) | Grant subject | **REVOKE** (emit `access_grant.revoked` event) |
| public | cross_tenant_access_grants_projection | granted_by | — | Audit reference | **KEEP** |
| public | cross_tenant_access_grants_projection | revoked_by/suspended_by/reactivated_by | — | Audit reference | **KEEP** |
| public | clients_projection | created_by/updated_by | — | Audit reference | **KEEP** |
| public | event_types | created_by | — | Audit reference | **KEEP** |
| public | role_permission_templates | created_by | — | Audit reference | **KEEP** |
| public | schedule_templates_projection | created_by | — | Audit reference | **KEEP** |
| public | unprocessed_events | created_by | — | Audit reference | **KEEP** |
| auth | flow_state, identities, mfa_factors, oauth_*, one_time_tokens, refresh_tokens, sessions, webauthn_* | user_id | — | Auth-tier | Out of scope — Supabase Auth manages these; ban via `banned_until` already handles auth invalidation. If hard auth-delete is needed, separate concern via `auth.admin.deleteUser()`. |

**Total stale membership rows on dev today**: 10 (3 + 2 + 2 + 3).

## Design principles

1. **HARD-CLEAN membership projections** on `user.deleted`. The domain_events table preserves the audit trail; projections are derived state. Hard-clean keeps reads simple and consistent.
2. **PRESERVE audit-reference columns** (`created_by`, `updated_by`, `assigned_by`, `granted_by`, `revoked_by`, etc.). These are historical facts about *who did something*; nulling them rewrites history. PII concerns can be addressed separately (e.g., anonymization sweep policy) without touching this card.
3. **EMIT events for substantive transitions** (e.g., access_grant.revoked when a consultant_user is deleted) rather than direct projection DELETEs. Direct DELETEs are OK for low-stakes membership rows (notification prefs, phones, addresses) where re-derivability from events isn't a concern. The line is fuzzy; lean toward events when the action has semantic meaning beyond cleanup.
4. **`auth.*` tables are Supabase's responsibility.** `api.delete_user` already bans the auth user via `auth.admin.updateUserById({ban_duration: 'long'})` (per PR #40). For full identity removal, a separate card would address `auth.admin.deleteUser()` invocation. This card stays at the public-schema membership-projection layer.

## Per-table treatment

### Hard DELETE in `handle_user_deleted`

```sql
-- Inside handle_user_deleted, after setting users.deleted_at:
DELETE FROM public.user_roles_projection WHERE user_id = v_user_id;
DELETE FROM public.user_organizations_projection WHERE user_id = v_user_id;
DELETE FROM public.user_notification_preferences_projection WHERE user_id = v_user_id;
DELETE FROM public.user_addresses WHERE user_id = v_user_id;
DELETE FROM public.user_phones WHERE user_id = v_user_id;
DELETE FROM public.user_client_assignments_projection WHERE user_id = v_user_id;
DELETE FROM public.schedule_user_assignments_projection WHERE user_id = v_user_id;
```

These are all "membership state" — fact that "user X is in org Y with role Z" or "user X has phone P". When user X is soft-deleted, those facts no longer hold. Reversibility on undelete is via re-onboarding (re-issuing invitations / re-assigning roles).

> **Note (2026-06-15):** `user_org_phone_overrides` and `user_org_address_overrides` were removed from the inventory + cascade SQL above — those per-user org-override tables were dropped entirely (PR removing per-user org contact overrides; migration `20260615175954`). All user phones/addresses are now global (`user_phones`/`user_addresses`, already covered above). Do not re-add DELETEs for the dropped tables.

### Special case: `contacts_projection`

`contacts_projection.user_id` links a contact record to a user identity. The contact record itself may be referenced by other domain entities (clients, organizations). Don't delete the contact row; just NULL the user_id link:

```sql
UPDATE public.contacts_projection SET user_id = NULL WHERE user_id = v_user_id;
```

This preserves the contact-as-entity while dropping the user-linkage.

### Special case: `cross_tenant_access_grants_projection`

If the soft-deleted user is the `consultant_user_id` of an active grant, the grant should be revoked. Per the architecture doc, grant lifecycle has dedicated events (`access_grant.revoked`). Emit one per affected grant:

```sql
FOR v_grant IN SELECT id FROM public.cross_tenant_access_grants_projection
               WHERE consultant_user_id = v_user_id AND status = 'active' LOOP
  PERFORM api.emit_domain_event(
    p_stream_id := v_grant.id,
    p_stream_type := 'access_grant',
    p_event_type := 'access_grant.revoked',
    p_event_data := jsonb_build_object(
      'grant_id', v_grant.id,
      'revoked_by', NULL,
      'revocation_reason', 'consultant_user_deleted',
      'revocation_details', 'Consultant user was soft-deleted; grant auto-revoked.'
    ),
    p_event_metadata := jsonb_build_object('automated', true, 'source', 'handle_user_deleted_cascade')
  );
END LOOP;
```

(Audit-reference columns `granted_by`, `revoked_by`, `suspended_by`, `reactivated_by` stay — historical facts.)

### Preserve unchanged (audit-references)

`clients_projection.created_by/updated_by`, `event_types.created_by`, `role_permission_templates.created_by`, `schedule_templates_projection.created_by`, `unprocessed_events.created_by`, and the various `*_by` columns in `cross_tenant_access_grants_projection`. These record *who* did something at a point in time. Nulling them rewrites history.

## Read-side simplification (opportunistic)

Once cascade-cleanup ships and old stale rows are backfilled, the various `WHERE u.deleted_at IS NULL` filters in consuming RPCs become redundant (rows for deleted users won't exist). Options:
- **Keep the filters** for defense-in-depth (cheap, prevents drift if a future bug re-introduces stale rows)
- **Remove them** for code clarity (single source of truth via the cleanup)

Recommendation: **KEEP** the filters during the first PR; remove in a follow-up after the cascade ships to all environments and has soaked for a week. Lowers risk of a runtime regression.

## Backfill

The 10 stale rows on dev (and whatever count on prod) need a one-shot cleanup. Bundle with the migration:

```sql
-- Inline DO block in the migration after the new handle_user_deleted ships:
DO $$
DECLARE v_user record;
BEGIN
  FOR v_user IN SELECT id FROM public.users WHERE deleted_at IS NOT NULL LOOP
    -- Re-emit user.deleted for each tombstoned user to drive the new handler logic.
    -- Or directly DELETE the dependent rows here.
    DELETE FROM public.user_roles_projection WHERE user_id = v_user.id;
    -- ... (same DELETE chain for each affected table)
  END LOOP;
END $$;
```

The choice: re-emit `user.deleted` events to drive the handler (audit-trail-correct, but events stream gets duplicate `user.deleted` entries per affected user), OR direct DELETEs in the migration's backfill section (less audit noise, less re-runnable). Lean toward direct DELETEs in the backfill — the historical `user.deleted` event already exists; the cleanup is making the projection state match.

## Test surface

- Unit/SQL: a new test that emits `user.deleted` for a fresh user → asserts dependent projection rows are gone, audit-reference columns unchanged
- Integration: existing UAT scenarios that depend on the cleanup state (PR #64 T4 would now work as designed: soft-deleted user → check_user_org_membership returns 0 → check_pending_invitation returns 0 → check_user_exists returns 0 (Finding #3) → status='not_found' → gate skipped)
- Regression: existing `WHERE u.deleted_at IS NULL` filters in consuming RPCs still work correctly (they should now never have stale rows to filter, but keep checking)

## Files involved

- `infrastructure/supabase/supabase/migrations/<TIMESTAMP>_handle_user_deleted_cascade_cleanup.sql`
- `infrastructure/supabase/handlers/user/handle_user_deleted.sql` — reference file
- Possibly `infrastructure/supabase/handlers/access_grant/` for the access_grant.revoked emission path
- (No changes expected in EFs or frontend — read-side filters can stay during first ship)

## Architect-review pre-code questions

1. Is `consultant_user_id` deletion always the right semantic for an access grant? Or should grants TRANSFER to a different user instead (with admin action)?
2. Should the cascade extend to `auth.admin.deleteUser()` (hard auth-deletion) when soft-delete fires? Probably not — keeping the auth tombstone preserves identity for audit lookups. But worth confirming.
3. For `contacts_projection`, NULL the user_id link or also clear PII fields like email/phone? Probably just NULL the link; PII clearing is a separate compliance concern.

## Related work / dependencies

- **PR #64** (`reject-cross-provider-invitations`, merged 2026-05-13) — Finding #3 closeout depended on `check_user_exists` filtering `deleted_at IS NULL`; this card makes that filter more meaningful by ensuring downstream projections don't have stale rows for the same users.
- **`users-list-omits-roleless-members`** (NEW 2026-05-18) — related read-side defect; this card removes one cause (stale role rows post user-delete).
- **`invite-user-route-existing-users-to-role-assign`** (NEW 2026-05-18) — when this card ships, the `deactivated` branch in checkEmailStatus also gets cleaner (no stale role rows muddying the deactivated-vs-deleted distinction).
- **`api-revoke-invitation-param-naming`** (NEW 2026-05-18) — orthogonal but in the same cleanup-debt cohort.

## Out of scope

- PII anonymization in audit-reference rows (separate compliance card if needed)
- Hard auth-deletion via `auth.admin.deleteUser()` (separate card)
- Removing the consuming-side `WHERE u.deleted_at IS NULL` filters (deferred to follow-up after cascade ships and soaks)
- Changing soft-delete semantics (still tombstone-style; cascade only affects dependent projections)
