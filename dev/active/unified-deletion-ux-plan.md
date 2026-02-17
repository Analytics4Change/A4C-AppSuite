# Implementation Plan: Unified Deactivation/Deletion UX + Schedule Template Refactor

## Executive Summary

Unify the deactivation and deletion user experience across four applets (/organization-units, /roles/manage, /users/manage, /schedules/manage). Phase 1 standardizes UX patterns for Org Units, Roles, and Users. Phase 2 refactors schedules from clone-on-assignment to a shared template model with full CQRS event-driven compliance.

## Phase 1: UX Unification (Org Units, Roles, Users)

### 1.1 Extend ConfirmDialog Component
- Add `details?: string[]` prop for entity enumeration lists
- Backward-compatible — existing callers unaffected
- Unblocks Steps 1.3 and 1.4

### 1.2 Organization Units — Banner + Read-Only + Remove Checkbox
- Add inactive warning banner (copy from RolesManagePage.tsx pattern)
- Disable form inputs when unit is inactive
- Remove checkbox toggle; keep Danger Zone buttons

### 1.3 Users — Normalize Dialog State + Messaging
- Rename `'delete-warning'` → `'activeWarning'`
- Standardize warning/delete messages across all applets
- Update inactive banner title to "Inactive User - Editing Disabled"

### 1.4 Roles — Convert userCount Guard to Dialog with Enumeration
- Replace inline error with ConfirmDialog listing assigned user names
- Reuse existing `listUsersForRoleManagement()` RPC

### 1.5 Org Units — Parse Backend Error Codes
- Parse `errorDetails` JSONB from `api.delete_organization_unit()`
- Add `hasChildren` and `hasRoles` dialog states with entity enumeration

### 1.6 FK CASCADE Migration
- Fix 2 missing `ON DELETE CASCADE` constraints on user FK references
- `user_schedule_policies_projection` and `user_client_assignments_projection`

## Phase 2: Schedule Template Refactor

### 2.1 AsyncAPI Contract Definitions
- Define 7 event data schemas in `schedule.yaml`
- Generate TypeScript types via Modelina pipeline

### 2.2 Infrastructure — Schema Migration
- Create `schedule_templates_projection` and `schedule_user_assignments_projection`
- Data migration from `user_schedule_policies_projection`
- Retire old table and old `user.schedule.*` handlers

### 2.3 Infrastructure — RPC Functions + Handlers + Router
- 9 new RPC functions (emit via `api.emit_domain_event()`)
- 7 new handlers (idempotent, ON CONFLICT)
- New `process_schedule_event()` router with RAISE EXCEPTION for unhandled

### 2.4 Frontend — Types, Services, ViewModels, Page
- New `ScheduleTemplate` and `ScheduleAssignment` types
- Rewrite service interface for template model
- Rewrite ViewModels and page component with unified deletion UX

## Success Metrics

### Immediate
- [x] Phase 1 builds clean: `npm run typecheck && npm run lint && npm run build`
- [x] All four applets follow identical deactivation/deletion UX pattern

### Medium-Term
- [x] Phase 2 migration applies cleanly (`20260217211231_schedule_template_refactor.sql`)
- [x] Schedule templates work as shared resources across users

### Long-Term
- [x] No orphaned projection rows from missing CASCADE constraints (FK migration applied)
- [ ] Zero processing_error rows for new schedule event types (requires production verification)

## Risk Mitigation

- Phase 1 is frontend-only (except FK migration) — low risk, easy rollback via git
- Phase 2 data migration is destructive — test with `--dry-run` first
- Old schedule events in `domain_events` table are immutable history — not affected by handler retirement
