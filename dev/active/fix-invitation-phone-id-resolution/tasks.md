# Tasks — Fix invitation-phone placeholder resolution

## Current Status

**Phase**: IMPLEMENTATION COMPLETE — awaiting commit + PR + smoke test
**Status**: 🟢 READY-FOR-PR
**Priority**: Medium

## Tasks

- [x] Phase 0 — Locate emission site (`accept-invitation/index.ts:682-705`); single emission point
- [x] Phase 0 — Read `handle_user_notification_preferences_updated.sql:29-32`; confirm `::UUID` cast at COALESCE
- [x] Phase 0 — Grep for placeholders: only `invitation-phone-${index}` exists; no equivalent emails/addresses
- [x] Phase 1 — Approach A confirmed (substitute-before-emit; B is moot since phones already emit before prefs)
- [x] Phase 2 — Implemented `resolveInvitationPhonePlaceholder` helper + applied at emission site; DEPLOY_VERSION → v18-phone-id-resolution
- [x] Phase 3 — Pre-deploy regression query: 2 affected historical events on dev (test1 + test users from PR #40 smoke testing); backfill posture: document
- [ ] Phase 4 — Manual deploy + functional verify with fresh invitation
- [ ] Phase 5 — Commit + push + open PR
- [ ] Post-merge — Archive card to `dev/archived/`

## Cross-references

- Discovered during: `manage-user-delete-rpc-and-scope-retrofit` smoke testing
- Failing event preserved at: `domain_events.id = edc2c08e-d8ef-486c-911f-75fcb1e2a2d4`
- Test user with stale prefs: `86885a4f-5fa3-442d-a780-12aed575a6a2` (`lars.tice+test1@gmail.com` in `testorg-20260329`)
- Frontend placeholder source: `frontend/src/pages/users/UsersManagePage.tsx:832`
