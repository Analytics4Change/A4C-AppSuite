# Tasks — handle-user-deleted-cascade-cleanup-projections

## Pre-code architect review

- [ ] Confirm cascade design with architect (see plan.md § "Architect-review pre-code questions")
- [ ] Decide per table whether to direct-DELETE or emit cascade events (current proposal: DELETE for membership/identity, events for access grants)
- [ ] Confirm `contacts_projection.user_id = NULL` semantic is preferred over row deletion

## Migration

- [ ] `supabase migration new handle_user_deleted_cascade_cleanup_projections`
- [ ] Rewrite `handle_user_deleted` to DELETE FROM the membership/identity projections per the table list in plan.md § "Per-table treatment"
- [ ] Add the access_grant.revoked emission loop for active grants
- [ ] Add the contacts_projection user_id NULL update
- [ ] Inline backfill DO block: clean up the 10 (or current count) stale rows for already-soft-deleted users on production at deploy time
- [ ] `supabase db lint --level warning` clean
- [ ] `supabase db push --linked` clean on dev

## Handler reference file

- [ ] Update `infrastructure/supabase/handlers/user/handle_user_deleted.sql` to match the new migration body

## Verification (post-deploy)

- [ ] Stale-row counts query (same shape as the 2026-05-19 inventory) should return all zeros
- [ ] Re-run a fresh user-lifecycle test: create → assign role → delete → verify all dependent projections clean
- [ ] PR #64 UAT T4 becomes runnable as originally designed (subject lars.tice+test or test1 → status='not_found' → gate skipped)

## Regression checks

- [ ] `api.list_users`, `api.get_user_notification_preferences`, `api.get_user_addresses`, etc., all still behave correctly (their `WHERE u.deleted_at IS NULL` filters are now redundant but should still produce same results)
- [ ] No `processing_error` flares on `domain_events` for `user.deleted` events post-deploy

## Frontend impact

- [ ] None expected (read-side filters still in place)

## Follow-up card (separate, post-soak)

- [ ] Remove the now-redundant `WHERE u.deleted_at IS NULL` filters from consuming RPCs after the cascade has soaked in production for a week. Keep an eye out for runtime regressions during the soak.

## PR shape

- [ ] Branch: `fix/handle-user-deleted-cascade-cleanup`
- [ ] One migration + one handler reference update + backfill in same migration
- [ ] Architect-review pre-code per the open questions

## Definition of done

- [ ] Soft-deleting a user via `api.delete_user` results in zero dependent membership rows for that user across all 9 listed projections
- [ ] Existing soft-deleted users on dev backfilled (10 stale rows cleared)
- [ ] Audit-reference columns (`created_by`, `updated_by`, `assigned_by`, etc.) untouched
- [ ] PR #64 UAT T4 runs cleanly end-to-end (`emailStatus: "not_found"` for a soft-deleted user with no role rows)
