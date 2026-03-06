# Implementation Plan: Organization UX Refactor + Cross-Cutting Standardization

## Executive Summary

Standardize the organization feature to follow the same two-route pattern as Roles/Users/Schedules (`/xxx` list page with cards + `/xxx/manage` split-panel edit page). Currently, Organizations uses a single-route pattern with panel modes which is inconsistent.

**Full plan details**: `/home/lars/.claude/plans/humble-waddling-flamingo.md`

## Goals

- Split Organizations back into two-route pattern (`/organizations` list + `/organizations/manage` edit)
- Provider admins redirect from list to manage (can only edit their own org)
- Add organization cards showing provider admin name/email/phone (DB RPC extension needed)
- Create org form uses same card-based layout as edit form (not glassmorphism sections)
- Standardize Create button placement (page header top-right) across ALL 4 features
- Make search bar + filter tabs sticky on ALL 4 list pages for mobile usability

## Phases

### Phase 1: Sticky Search Bar on All List Pages ✅ DONE
- CSS/layout only, low risk
- Files: `RolesPage.tsx`, `UserListPage.tsx`, `ScheduleListPage.tsx`
- Pattern: `sticky top-0 z-10 bg-white/95 backdrop-blur-sm` wrapper

### Phase 2: Move Create Button to Page Header on Manage Pages ✅ DONE
- Files: `RolesManagePage.tsx`, `UsersManagePage.tsx`, `SchedulesManagePage.tsx`
- Move from full-width button in right panel to page header top-right next to Back button
- Preserve dirty check + pending action logic
- **Note**: Goal 5 (Create button standardization across ALL 4 features) is completed by Phase 2 (Roles, Users, Schedules) + Phase 3E (Organizations) combined

### Phase 3: Organization Route Split + Provider Admin Redirect ✅ DONE
- 3A: Extend `api.get_organizations` RPC with provider admin LEFT JOIN LATERAL
- 3B: Create `OrganizationCard` component (glassmorphism, shows admin name/email)
- 3C: Create `OrganizationListPage` (card grid, sticky search, provider admin redirect)
- 3D: Update routes in `App.tsx` (list + manage)
- 3E: Refactor `OrganizationsManagePage` (remove left panel, add Back/Create buttons, accept `?orgId=`)
- 3F: Documentation updates (RPC docs, architecture docs, AGENT-INDEX keywords)
- 3G: Types + services extended with provider admin fields

### Phase 4: Create Form Redesign ✅ DONE
- Refactored `OrganizationCreateForm.tsx` from glassmorphism sections to card-based layout (834 → 573 lines)
- Keep auto-save draft, conditional sections, validation
- Renders in manage page right panel (`?mode=create`)

### Phase 5: UAT Test Updates ✅ DONE
- Updated 112 existing tests for route changes → 122 tests total (10 new)
- New tests: card details (5), admin search (3), filter tabs (3)
- Updated selectors for card-based create form, URL-based org selection
- Fixed `[data-testid^="org-card-"]` selector collision with `[data-slot="card"]` qualifier

## Execution Order

Phase 1 + Phase 2 (parallel) → Phase 3 → Phase 4 → Phase 5

## Risk Assessment

| Phase | Risk | Notes |
|-------|------|-------|
| 1 | Low | CSS only |
| 2 | Low-Medium | Layout change, preserve handler wiring |
| 3 | Medium-High | Routing, DB, new components, auth redirects |
| 4 | Medium-High | Layout refactor only — business logic unchanged, no backward compat needed |
| 5 | Medium | 112 → 122 test cases, all passing |
