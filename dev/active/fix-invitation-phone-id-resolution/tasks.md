# Tasks — Fix invitation-phone placeholder resolution

## Current Status

**Phase**: 0 — locating emission site
**Status**: 🟢 ACTIVE
**Priority**: Medium

## Tasks

- [ ] Phase 0 — Locate emission site for `user.notification_preferences.updated` during invitation acceptance (likely `accept-invitation/index.ts`)
- [ ] Phase 0 — Read `handle_user_notification_preferences_updated` handler source; confirm the failing `::uuid` cast site
- [ ] Phase 0 — Grep for any other `invitation-<thing>-N` placeholder patterns that might leak similarly
- [ ] Phase 1 — Decide: substitute-before-emit vs emit-after-phones
- [ ] Phase 2 — Implement chosen approach; add unit test for multi-phone case
- [ ] Phase 3 — Identify affected historical users (`domain_events.processing_error LIKE '%invitation-phone-%'`); decide on backfill vs document
- [ ] Phase 4 — Verify with fresh invitation acceptance test
- [ ] Phase 5 — Open PR + verify CI green

## Cross-references

- Discovered during: `manage-user-delete-rpc-and-scope-retrofit` smoke testing
- Failing event preserved at: `domain_events.id = edc2c08e-d8ef-486c-911f-75fcb1e2a2d4`
- Test user with stale prefs: `86885a4f-5fa3-442d-a780-12aed575a6a2` (`lars.tice+test1@gmail.com` in `testorg-20260329`)
- Frontend placeholder source: `frontend/src/pages/users/UsersManagePage.tsx:832`
