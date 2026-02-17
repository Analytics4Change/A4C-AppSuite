# Tasks: Unified Deactivation/Deletion UX

## Phase 1: UX Unification (Org Units, Roles, Users) - COMPLETE

- [x] Step 0: Extract reusable `DangerZone` component (`frontend/src/components/ui/DangerZone.tsx`)
- [x] Step 1: Extend ConfirmDialog with `details` prop (already done in prior session)
- [x] Step 2: Org Units — banner, read-only, remove checkbox, consume DangerZone
- [x] Step 3: Users — dialog state rename, messaging normalization, consume DangerZone (gains Reactivate)
- [x] Step 4: Roles — convert userCount to dialog with enumeration, consume DangerZone (already done in prior session)
- [x] Step 5: Org Units — parse backend error codes for deletion (already done in prior session)
- [x] Step 6: FK CASCADE migration (2 missing constraints) — applied to remote
- [x] Verify Phase 1: typecheck + lint + build — all pass

## Phase 2: Schedule Template Refactor - COMPLETE

- [x] Step 7: AsyncAPI — define schedule.yaml (7 event schemas) + channels in asyncapi.yaml
- [x] Step 8: Type generation — generate:types + copy to frontend
- [x] Step 9: Schema migration — new tables, data migration, RPC functions, handlers, dispatcher update, drop old (single migration `20260217211231_schedule_template_refactor.sql`)
- [x] Step 10: Handler reference files extracted to `handlers/schedule/` (8 files)
- [x] Step 11: Frontend types (`schedule.types.ts`) — ScheduleTemplate, ScheduleAssignment, ScheduleTemplateDetail, ScheduleDeleteError
- [x] Step 12: Frontend service interface (`IScheduleService.ts`) — 9 methods + ScheduleDeleteResult
- [x] Step 13: Frontend Supabase service (`SupabaseScheduleService.ts`) — calls new api.* RPCs
- [x] Step 14: Frontend mock service (`MockScheduleService.ts`) — in-memory with structured errors
- [x] Step 15: Frontend ViewModels rewrite — ScheduleListViewModel (templates), ScheduleFormViewModel (no effectiveFrom/Until)
- [x] Step 16: Frontend components — ScheduleCard, ScheduleList (template model)
- [x] Step 17: Frontend ScheduleFormFields — removed effectiveFrom/effectiveUntil (belong to assignments)
- [x] Step 18: Frontend ScheduleListPage — template model with template counts
- [x] Step 19: Frontend SchedulesManagePage — DangerZone component, structured delete errors (HAS_USERS dialog with details, STILL_ACTIVE → deactivate first)
- [x] Verify Phase 2: typecheck + lint + build — all pass

## Current Status

**Phase**: 2 — COMPLETE
**Status**: Both phases complete. Full schedule template refactor done. Dev-docs updated.
**Last Updated**: 2026-02-17
**Next Step**: Archive dev-docs to `dev/archived/unified-deletion-ux/`, update MEMORY.md, commit all changes
