# Tasks: Organization UX Refactor + Cross-Cutting Standardization

## Phase 1: Sticky Search Bar on All List Pages ✅ DONE

- [x] Read `frontend/src/pages/roles/RolesPage.tsx` — identify filter tabs + search bar markup
- [x] Read `frontend/src/pages/users/UserListPage.tsx` — identify filter tabs + search bar markup
- [x] Read `frontend/src/pages/schedules/ScheduleListPage.tsx` — identify filter tabs + search bar markup
- [x] Read `frontend/src/components/layouts/MainLayout.tsx` — confirm `<main>` has no `overflow` set
- [x] Wrap filter tabs + search bar in sticky container on `RolesPage.tsx`
- [x] Wrap filter tabs + search bar in sticky container on `UserListPage.tsx`
- [x] Wrap filter tabs + search bar in sticky container on `ScheduleListPage.tsx`
- [ ] Verify sticky behavior at narrow viewport width (manual check or UAT)
- [x] Accessibility: sticky wrapper uses `role="search"` landmark
- [x] Accessibility: use `motion-safe:backdrop-blur-sm` for reduced motion preference
- [ ] Accessibility: verify in Windows High Contrast Mode (`forced-colors: active`)
- [x] Typecheck + lint + build

## Phase 2: Move Create Button to Page Header on Manage Pages ✅ DONE

- [x] Read `frontend/src/pages/roles/RolesManagePage.tsx` — find Create button + `handleCreateClick`
- [x] Read `frontend/src/pages/users/UsersManagePage.tsx` — find Create button + `handleCreateClick`
- [x] Read `frontend/src/pages/schedules/SchedulesManagePage.tsx` — find Create button + `handleCreateClick`
- [x] Move Create button to page header on `RolesManagePage.tsx` (next to Back button)
- [x] Move Create button to page header on `UsersManagePage.tsx`
- [x] Move Create button to page header on `SchedulesManagePage.tsx`
- [x] Remove full-width Create button from right panels
- [ ] Verify dirty check / pending action still works (manual check)
- [x] Typecheck + lint + build

## Phase 3: Organization Route Split + Provider Admin Redirect ✅ DONE

### 3A: Database — extend `api.get_organizations` RPC ✅
- [x] Read current `api.get_organizations` / `api.get_organizations_paginated` from live DB or migration
- [x] Read `user_roles_projection`, `roles_projection`, `users` (not `users_projection`), `user_phones` schema
- [x] Create migration: `20260306214844_extend_get_organizations_provider_admin.sql`
  - DROP + CREATE (return type changed, can't use OR REPLACE alone)
  - LEFT JOIN LATERAL for provider_admin name/email/phone (`ORDER BY ur.assigned_at DESC LIMIT 1`)
  - `LEFT JOIN user_phones up ON up.user_id = u.id AND up.is_primary = true AND up.is_active = true`
  - `#variable_conflict use_column` in non-paginated function
  - Rollback SQL documented in comment header
- [x] Applied via `supabase db push --linked` (migration registered)
- [x] Tested: all 3 orgs return provider admin name/email, phone NULL (no primary phones in DB)

### 3B: OrganizationCard component ✅
- [x] Created `frontend/src/components/organizations/OrganizationCard.tsx`
- [x] Glassmorphism card matching RoleCard.tsx pattern
- [x] Displays: org display_name, status badge, org type badge, provider admin section
- [x] Provider admin section: name/email/phone when present, "Not provided" for missing fields, "No admin assigned" when no admin at all
- [x] Click navigates to `/organizations/manage?orgId={id}`

### 3C: OrganizationListPage ✅
- [x] Created `frontend/src/pages/organizations/OrganizationListPage.tsx`
- [x] Page header with title + Create button (→ `/organizations/manage?mode=create`)
- [x] Sticky filter tabs (All/Active/Inactive) with counts
- [x] Sticky search bar (searches name, display_name, subdomain, admin name, admin email)
- [x] Responsive card grid (1/2/3 cols)
- [x] Provider admin redirect with `log.info`
- [x] Reuses `OrganizationManageListViewModel`

### 3D: Route + Nav updates ✅
- [x] `App.tsx`: `/organizations` → `OrganizationListPage`, `/organizations/manage` → `OrganizationsManagePage`
- [x] Nav in `MainLayout.tsx` already pointed to `/organizations` — no change needed

### 3E: Refactor OrganizationsManagePage ✅
- [x] Removed left panel (org list with search/filter) — now on list page
- [x] Removed `OrgListItem` component, `filteredOrgs`, `searchTerm`, `handleSearchChange`, `handleStatusChange`, `handleOrgSelect`
- [x] Removed unused imports (`RefreshCw`, `Search`, `Organization` type)
- [x] Back button → "Back to Organizations" (`/organizations`) for platform owners
- [x] Create button in header (platform owner only, hidden during create mode)
- [x] `?mode=create` URL param triggers create mode on page load
- [x] `?orgId=` + `?mode=create` collision guard (S7): create wins, orgId ignored
- [x] Provider admin auto-load still works (full-width form)
- [x] URL updated to `?mode=create` when Create button clicked

### 3F: Documentation updates ✅ DONE
- [x] Update `documentation/infrastructure/reference/database/tables/organizations_projection.md` — new RPC return columns + API Functions section
- [x] Update `documentation/architecture/data/organization-management-architecture.md` — two-route pattern, provider admin redirect, updated pages 3 & 6
- [x] Update `documentation/AGENT-INDEX.md` — added `organization-list`, `organization-card`, `provider-admin-redirect` keywords
- [x] No frontend reference doc exists for organizations — N/A

### 3G: TypeScript types + services ✅
- [x] Added `provider_admin_name?`, `provider_admin_email?`, `provider_admin_phone?` to `Organization` type
- [x] Extended `OrganizationRow` interface and `mapRowToOrganization` in `SupabaseOrganizationQueryService`
- [x] Extended `MockOrganizationQueryService` with mock admin data (including one org with no admin for empty state)
- [x] Typecheck + lint + build all pass

## Phase 4: Create Form Redesign ✅ DONE

- [x] Read current `OrganizationCreateForm.tsx` (~835 lines)
- [x] Read edit mode card sections in `OrganizationsManagePage.tsx` for layout reference
- [x] Refactor to card-based layout matching edit mode (834 → 573 lines)
- [x] Organization Details card (create-only fields at top + shared fields, `md:grid-cols-2`)
- [x] Headquarters card (address + phone side-by-side, `md:grid-cols-2`)
- [x] Billing Information card (conditional for providers, stacked sections with dividers)
- [x] Provider Admin Information card (stacked sections with dividers, "Use General" checkboxes)
- [x] Form actions (Cancel + Save Draft + Submit at bottom)
- [x] Extracted reusable sub-components: `SelectField`, `TextField`, `UseGeneralHeader`
- [x] Removed glassmorphism styles, collapsible sections, hover handlers
- [x] Keep auto-save draft to localStorage
- [x] Keep conditional sections (billing for provider type only)
- [x] All `data-testid` attributes preserved
- [x] Renders on manage page right panel via `?mode=create`
- [x] Typecheck + lint + build

## Phase 5: UAT Test Updates ✅ DONE

- [x] **Interactive session**: User chose "Start implementing" — test matrix built incrementally
- [x] Added `data-testid` attributes to `OrganizationListPage` and `OrganizationCard`
- [x] Updated test helpers: `navigateToManagePage` → `/organizations/manage`, new `navigateToListPage` → `/organizations`, new `waitForCardsLoaded`, `selectOrg` via URL params
- [x] TS-01: Updated for no left panel, back button goes to `/organizations`
- [x] TS-02: Moved to list page with card selectors (9 tests)
- [x] TS-03–TS-05: `selectOrg` via URL params (`?orgId=`)
- [x] TS-06: Rewritten from org-switching to create-while-editing flow (manage page has no org list now)
- [x] TS-07–TS-15: Updated `beforeEach` to use `selectOrg`
- [x] TS-16: Updated accessibility tests for split pages
- [x] TS-17: Updated for route split (list page status params vs manage page orgId params)
- [x] TS-18–TS-23: Minor selector updates for card-based create form
- [x] TS-24: Rewritten for URL-based create mode entry (`?mode=create`) + S7 collision guard
- [x] NEW TS-25: Organization Card Details (5 tests — admin info, badges, inactive state)
- [x] NEW TS-26: List Page Search by Admin Fields (3 tests — name, email, subdomain)
- [x] NEW TS-27: List Page Filter Tabs with aria-pressed (3 tests)
- [x] Fixed card-counting selector bug: `[data-testid^="org-card-"]` matched inner elements too; added `[data-slot="card"]` to restrict to card containers
- [x] Removed TC-19-05 (collapse toggles no longer exist in card-based layout)
- [x] Full UAT suite: **120 passed, 2 skipped, 0 failed** (was 112 tests, now 122)
- [ ] Run `npm run build && npm run lint && npm run typecheck` (typecheck passed earlier, full build not yet verified after final selector fix)

## Current Status

**Phase**: All 5 phases complete
**Status**: ✅ NEARLY COMPLETE
**Last Updated**: 2026-03-06
**Plan file**: `/home/lars/.claude/plans/humble-waddling-flamingo.md`
**Architect review**: All 4 Major (MA1–MA4), 7 Minor (M1–M7), and 8 Suggestions (S1–S8) resolved — see `org-ux-refactor-context.md` "Architect Review Resolutions" section
**Next Step**: Run `npm run build && npm run lint && npm run typecheck` to verify final build, then commit all changes and archive dev-docs
