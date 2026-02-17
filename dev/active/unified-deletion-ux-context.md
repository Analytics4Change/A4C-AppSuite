# Context: Unified Deactivation/Deletion UX

## Decision Record

**Date**: 2026-02-17
**Feature**: Unified deactivation/deletion UX + schedule template refactor
**Goal**: Standardize deactivation/deletion workflows across all four management applets and refactor schedules to a template model.

### Key Decisions
1. **Remove checkbox toggle** from Org Units — Danger Zone buttons are sufficient (matches Roles/Users)
2. **Remove reason parameter** from schedule operations — only Schedules had this; other applets don't require it
3. **Template model for schedules** — refactor from clone-on-assignment to shared templates with junction table
4. **Enumerate affected entities** in deletion-blocked dialogs — show user names, child OU names
5. **Structured error parsing** — parse JSONB `errorDetails` from backend instead of generic error strings
6. **Fix FK CASCADE gaps** — 2 of 8 user FK references missing ON DELETE CASCADE

## Technical Context

### Architecture
- Frontend: React 19 + MobX + MVVM pattern
- Backend: Supabase PostgreSQL with CQRS event sourcing
- Events: Single trigger (`process_domain_event_trigger`) → router → handler
- API: `api.` schema RPC functions only (never direct table queries)

### Unified Dialog Pattern (Target Standard)
| Scenario | Dialog variant | Behavior |
|----------|---------------|----------|
| Delete active entity | warning | "Must be deactivated first. Deactivate now?" |
| Delete with dependencies | warning | Lists affected entity names via `details` prop |
| Delete deactivated entity | danger | "This action is permanent and cannot be undone." |
| Deactivate entity | warning | States consequences (N users affected, etc.) |
| Reactivate entity | success | Confirms reactivation |

### DialogState Discriminated Union Pattern
All applets use: `{ type: 'none' } | { type: 'deactivate' } | { type: 'reactivate' } | { type: 'delete' } | { type: 'activeWarning' } | { type: 'hasUsers'; users: string[] } | ...`

## File Structure

### Phase 1 Files Modified
- `frontend/src/components/ui/ConfirmDialog.tsx` — Add `details` prop
- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx` — Banner, read-only, remove checkbox, error parsing
- `frontend/src/pages/users/UsersManagePage.tsx` — Dialog state rename, messaging
- `frontend/src/pages/roles/RolesManagePage.tsx` — User enumeration dialog
- `frontend/src/services/organization/SupabaseOrganizationUnitService.ts` — Parse errorDetails

### Phase 1 Files Created
- `frontend/src/components/ui/DangerZone.tsx` — NEW: Shared Danger Zone with render slots

### Phase 2 Files (New + Modified)
- `infrastructure/supabase/contracts/asyncapi/domains/schedule.yaml` — NEW: 7 event schemas
- `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` — Updated: schedule channels + messages
- `infrastructure/supabase/supabase/migrations/20260217211231_schedule_template_refactor.sql` — NEW: schema + data migration + RPCs + handlers + router
- `infrastructure/supabase/handlers/schedule/*.sql` — NEW: 8 handler reference files (router + 7 handlers)
- `frontend/src/types/schedule.types.ts` — Rewrite: ScheduleTemplate, ScheduleAssignment, ScheduleTemplateDetail, ScheduleDeleteError
- `frontend/src/types/generated/generated-events.ts` — Regenerated from AsyncAPI (7 new schedule event types)
- `frontend/src/services/schedule/IScheduleService.ts` — Rewrite: 9-method interface + ScheduleDeleteResult
- `frontend/src/services/schedule/SupabaseScheduleService.ts` — Rewrite: calls new api.* RPCs
- `frontend/src/services/schedule/MockScheduleService.ts` — Rewrite: in-memory mock with structured errors
- `frontend/src/viewModels/schedule/ScheduleListViewModel.ts` — Rewrite: operates on ScheduleTemplate[]
- `frontend/src/viewModels/schedule/ScheduleFormViewModel.ts` — Rewrite: no effectiveFrom/Until (belong to assignments)
- `frontend/src/components/schedules/ScheduleCard.tsx` — Rewrite: template model with user count
- `frontend/src/components/schedules/ScheduleList.tsx` — Rewrite: template list
- `frontend/src/components/schedules/ScheduleFormFields.tsx` — Rewrite: removed effective dates, renamed scheduleId→templateId
- `frontend/src/pages/schedules/ScheduleListPage.tsx` — Rewrite: template cards with assigned_user_count
- `frontend/src/pages/schedules/SchedulesManagePage.tsx` — Rewrite: DangerZone, structured delete errors (HAS_USERS/STILL_ACTIVE)

## Related Components
- `RolesManagePage.tsx` — Reference standard for inactive banner pattern
- `infrastructure/supabase/handlers/` — Handler reference files for all domains
- `documentation/infrastructure/patterns/event-handler-pattern.md` — Event naming + handler rules
- `documentation/infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md` — AsyncAPI pipeline

## Important Constraints
- Event handlers MUST be idempotent (ON CONFLICT), use p_event.created_at, never emit events
- Router ELSE must RAISE EXCEPTION with ERRCODE P9001
- AsyncAPI schemas MUST have `title` matching name (prevents AnonymousSchema)
- RPC functions MUST NOT write projections directly
- `api.emit_domain_event()` auto-enriches with correlation_id, trace_id, span_id

## Why This Approach?
- **Template model chosen over clone-on-assignment** because: prevents schedule drift, enables single-point management, simplifies deletion UX (one template instead of N user rows), aligns with how frontend already conceptualizes schedules
- **Phase 1 before Phase 2** because: Phase 1 establishes the unified UX patterns that Phase 2 follows; Phase 1 is lower risk (mostly frontend changes)

## Completion Status

**Both phases complete as of 2026-02-17.**

### Verification Results
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS (5.28s)
- Migration `20260217211231` applied to remote Supabase project
- FK CASCADE migration `20260217194421` applied to remote Supabase project
- 8 handler reference files extracted to `infrastructure/supabase/handlers/schedule/`

### Key Architecture Outcomes
- All 4 applets (Org Units, Roles, Users, Schedules) share identical deactivation/deletion UX via `DangerZone` component
- `ConfirmDialog.details` prop enables entity enumeration in all blocking dialogs
- Schedule templates are first-class entities with shared-resource semantics
- `effectiveFrom`/`effectiveUntil` belong to assignments (junction table), not templates
- Structured error codes (`HAS_USERS`, `STILL_ACTIVE`, `HAS_CHILDREN`, `HAS_ROLES`) replace generic error strings
