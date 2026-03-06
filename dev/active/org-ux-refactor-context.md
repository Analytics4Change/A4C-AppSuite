# Context: Organization UX Refactor + Cross-Cutting Standardization

## Decision Record

**Date**: 2026-03-06
**Feature**: Standardize organization pages to match Roles/Users/Schedules two-route pattern
**Goal**: Split Organizations back into list page + manage page, add org cards with provider admin info, standardize Create button placement and sticky search across all 4 admin features.

### Key Decisions

1. **Two-route pattern**: All 4 admin features (Roles, Users, Schedules, Organizations) should follow `/xxx` (list with cards) + `/xxx/manage` (split-panel edit) pattern. Organizations currently uses single-route with panel modes — this is inconsistent. - Decided 2026-03-06

2. **Provider admin redirect**: Non-platform-owners hitting `/organizations` get `<Navigate to="/organizations/manage" replace />`. They can only edit their own org — no list view, no create, no delete. - Decided 2026-03-06

3. **Provider admin info on cards**: Organization cards need to show the provider admin's name and email. Requires extending `api.get_organizations` RPC with a LEFT JOIN LATERAL to `user_roles_projection → roles_projection → users_projection`. - Decided 2026-03-06

4. **Create button standardization**: Currently a full-width button at top of right panel on manage pages. Moving to page header top-right (next to Back button) on ALL 4 manage pages. - Decided 2026-03-06

5. **Sticky search bar**: Filter tabs + search bar wrapped in `sticky top-0 z-10 bg-white/95 backdrop-blur-sm` on ALL 4 list pages. MainLayout `<main>` has no overflow set, so document-level scroll works with sticky. - Decided 2026-03-06

6. **Create form card-based layout**: The `OrganizationCreateForm` currently uses 3 numbered glassmorphism sections with collapse toggles. Refactoring to match edit mode's card-based layout. Create-only fields (org type, partner type, subdomain) go at top of Organization Details card. - Decided 2026-03-06

7. **Phase 1+2 can run in parallel**: Sticky search (list pages) and Create button move (manage pages) are completely independent — different pages, different layout areas, no shared state. - Decided 2026-03-06

## Technical Context

### Prerequisite: organization-manage-page feature is COMPLETE
- Phases 0–11 all done, plus 3 post-completion fixes (bootstrap CORS, error propagation, form layout)
- `OrganizationsManagePage` exists at `/organizations` with panel modes ('empty' | 'edit' | 'create')
- `OrganizationCreateForm` extracted as standalone component
- 112 UAT tests passing
- See `dev/active/organization-manage-page-*.md` for full history

### Architecture
- **CQRS/Event Sourcing**: All writes via `api.*` RPCs, projections updated by event handlers
- **MobX ViewModels**: `OrganizationManageListViewModel` (list/filter/lifecycle) + `OrganizationManageFormViewModel` (form/validation/entity CRUD)
- **Mock mode**: DevAuth with `VITE_FORCE_MOCK=true` in UAT config, `MOCK_PROFILE_PERMISSIONS` for custom roles
- **Glassmorphism cards**: `RoleCard.tsx` is the pattern reference (backdrop-blur, gradient border, hover effects)

### Key Files
- `frontend/src/pages/organizations/OrganizationsManagePage.tsx` — current single-route page (~1500 lines)
- `frontend/src/pages/organizations/OrganizationCreateForm.tsx` — extracted create form (~835 lines)
- `frontend/src/pages/roles/RolesPage.tsx` — list page pattern reference
- `frontend/src/pages/roles/RolesManagePage.tsx` — manage page pattern reference
- `frontend/src/components/roles/RoleCard.tsx` — card component pattern reference
- `frontend/src/viewModels/organization/OrganizationManageListViewModel.ts` — existing list VM (reusable)
- `frontend/e2e/organization-manage-page.spec.ts` — 112 UAT tests

## Architect Review Resolutions

**Review date**: 2026-03-06

1. **M1 (Minor) — Provider admin join non-determinism**: `LIMIT 1` without `ORDER BY` could return arbitrary row if multiple provider admins exist. **Resolution**: Add `ORDER BY ur.assigned_at DESC LIMIT 1` to show most recently assigned provider admin. No uniqueness constraint needed — multiple provider_admin assignments are valid post-bootstrap.

2. **M2 (Minor) — Goal 5 spans two phases**: "Standardize Create button placement across ALL 4 features" is satisfied by Phase 2 (Roles, Users, Schedules) + Phase 3E (Organizations) combined, not by either phase alone. **Resolution**: Noted explicitly.

3. **MA1 (Major) — Query param consistency + dual-entry contract**:
   - **Query params**: All 3 existing manage pages use `useSearchParams()` with `?roleId=`, `?userId=`, `?templateId=`. Plan's `?orgId=` is consistent. No issue.
   - **Dual-entry contract**: Manage page has 3 entry paths: (a) platform owner via card click `?orgId=<uuid>`, (b) provider admin redirect with no param (infer from JWT `org_id`), (c) provider admin with foreign `?orgId=<different-uuid>`.
   - **Resolution for path (c)**: Silently ignore the `orgId` param and fall back to loading their own org. Do NOT show an error. RLS would block the fetch anyway — this is a graceful UX fallback, not a security control (RLS is the real boundary).

4. **MA2 (Major) — Error handling for provider admin join + load failures**:
   - **Card provider admin info**: Extended to show name, email, and primary phone. SQL join adds `LEFT JOIN user_phones up ON up.user_id = u.id AND up.is_primary = true`. Any missing field displays "Not Provided". When no provider admin role exists (entire lateral join returns NULL), card shows "No admin assigned".
   - **RPC failure on list page**: Existing pattern handles this — `SupabaseOrganizationQueryService` throws, `OrganizationManageListViewModel` catches and sets `this.error`, page renders error banner with retry. Correlation ID auto-injected via PostgREST pre-request hook. No new error handling needed.
   - **Provider admin manage page load failure**: Standard error state with retry button. No special redirect handling — provider admin was never on the list page (immediate redirect). Same ViewModel error pattern as above.

5. **MA4 (Major) — No documentation updates planned**: Added Phase 3F with doc update tasks: organizations_projection table doc (new RPC columns), organization-management-architecture (two-route pattern), AGENT-INDEX keywords, frontend reference if applicable.

6. **M3 (Minor) — Phase 4 risk overstated**: Downgraded from High to Medium-High. Layout-only refactor preserving all business logic. `reactFill()` workaround no longer needed with card-based layout. No backward compatibility required — app is in active development with complete data resets.

7. **MA3 (Major) — Test matrix and data-testid attributes**: Deferred to Phase 5 implementation. **Requires interactive session with user** to enumerate critical test scenarios, agree on `data-testid` naming conventions for new components (OrganizationCard, OrganizationListPage, sticky search wrapper), and review edge cases (provider admin redirect, NULL admin fields, dual-entry manage page).

8. **M4 (Minor) — Dirty form check during route transitions**: No `useBlocker` or `beforeunload` exists anywhere in the codebase. Dirty check is within-page only (pendingActionRef + discard dialog). Same pattern across all 4 manage pages — not a regression. No action needed.

9. **M5 (Minor) — `isPlatformOwner` derivation**: Already defined: `authSession?.claims.org_type === 'platform_owner'` (OrganizationsManagePage.tsx:240). New OrganizationListPage uses same pattern. No ambiguity.

10. **M6 (Minor) — Migration read-path-only comment**: Add SQL comment to migration noting this is a read-path-only change (no events emitted, no handler changes).

11. **M7 (Minor) — Client-side logging for redirect**: Add `log.info('Provider admin redirected to manage page')` when redirect fires, for UAT debugging.

12. **S1 (Performance) — LEFT JOIN LATERAL indexes**: Verify `user_roles_projection` has index on `organization_id` (confirmed: `idx_user_roles_org` partial index). `user_phones` needs index check on `(user_id, is_primary)`. Denormalization onto `organizations_projection` noted as future optimization — not needed now.

13. **S2 (Security) — Redirect is UX not security**: Already covered in MA1 resolution. RLS is the authoritative boundary.

14. **S3 (Accessibility) — Sticky headers**: Add to Phase 1 + 3C acceptance criteria: `role="search"` or `<nav>` landmark, `motion-safe:backdrop-blur-sm` for reduced motion, test in Windows High Contrast Mode (`forced-colors: active`).

15. **S4 (State Mgmt) — VM lifecycle**: List VM filter/scroll state resets on navigation to manage page and back. Same behavior as Roles/Users/Schedules. Not a regression — accepted.

16. **S5 (Operations) — Migration rollback**: Include rollback SQL (restore previous function definition) as a comment in the migration file.

17. **S6 (Risk Mgmt) — Feature flag**: Skipped. App is in active development with data resets, no backward compatibility needed. Feature flag adds unnecessary complexity.

18. **S7 (Correctness) — `?orgId=` + `?mode=create` collision**: If both query params present, ignore `orgId` — create mode takes precedence. Add guard to Phase 3E/4 manage page mode resolution.

19. **S8 (Maintainability) — Shared AdminCard base**: Noted as future refactoring opportunity after all 4 features have card components. Not in scope for this refactor.

## Implementation Notes

### Phase 1: Sticky Search (completed 2026-03-06)
- **Pattern**: `sticky top-0 z-10 bg-white/95 motion-safe:backdrop-blur-sm pb-4` wrapper with `role="search"`
- **Spacing fix**: Search bar `mb-6` removed — wrapper `pb-4` handles gap to content below. Filter tabs `mb-4` preserved for inter-element spacing within wrapper.
- **MainLayout `<main>`**: Confirmed no `overflow` set (`flex-1 lg:ml-0 bg-gradient-to-br ... min-h-screen pb-20 lg:pb-0`), so document-level scroll makes `sticky top-0` work correctly.
- **Files modified**: `RolesPage.tsx`, `UserListPage.tsx`, `ScheduleListPage.tsx`
- **Remaining manual checks**: Narrow viewport sticky behavior, Windows High Contrast Mode

### Phase 2: Create Button Move (completed 2026-03-06)
- **Pattern**: Button added to existing Back button row via `flex items-center justify-between` (was `flex items-center gap-4`)
- **Removed**: Full-width `w-full mb-4 ... justify-start` Create button from right panel `lg:col-span-2` div
- **Handler unchanged**: `handleCreateClick` still wired to same callback (dirty check + `pendingActionRef` preserved)
- **Files modified**: `RolesManagePage.tsx`, `UsersManagePage.tsx`, `SchedulesManagePage.tsx`
- **Remaining manual check**: Verify dirty check / pending action still works

### Phase 3: Organization Route Split (completed 2026-03-06)
- **Migration**: `20260306214844_extend_get_organizations_provider_admin.sql`
  - Both `api.get_organizations` and `api.get_organizations_paginated` required DROP before CREATE (return type changed)
  - LEFT JOIN LATERAL joins: `user_roles_projection` → `roles_projection` (provider_admin role) → `users` → `user_phones` (primary)
  - `#variable_conflict use_column` needed in non-paginated function
  - Indexes confirmed: `idx_user_roles_org`, `idx_user_phones_one_primary`
  - Note: Table is `users` not `users_projection` — it's a shadow table, not a CQRS projection
- **OrganizationCard**: `frontend/src/components/organizations/OrganizationCard.tsx`
  - Glassmorphism card with Building2 icon, status + type badges, provider admin section
  - Click navigates to `/organizations/manage?orgId={id}`
- **OrganizationListPage**: `frontend/src/pages/organizations/OrganizationListPage.tsx`
  - Provider admin redirect: `<Navigate to="/organizations/manage" replace />` with log.info
  - Reuses `OrganizationManageListViewModel` (already filters out platform_owner)
  - Search includes provider admin name/email
- **Route split**: `/organizations` → list, `/organizations/manage` → manage
  - Both protected by `RequirePermission permission="organization.update"`
  - Nav already pointed to `/organizations` — no MainLayout change
- **ManagePage refactor**: Removed left panel (list, search, filter), `OrgListItem`, ~120 lines of dead code
  - Back button: "Back to Organizations" → `/organizations`
  - Create button: page header, hidden during create mode, platform owner only
  - `?mode=create` URL param triggers create mode; `?orgId=` + `?mode=create` → create wins (S7)
  - `handleCreateClick` and `handleDiscardChanges` now update URL params
- **Types + services**: `Organization` type + `OrganizationRow` + `mapRowToOrganization` + mock data updated

### Phase 4: Create Form Redesign (completed 2026-03-06)
- **834 → 573 lines**: Removed glassmorphism styles (~100 lines), collapsible section logic, numbered headers
- **Layout**: 4 standard `Card` components with `shadow-lg`, matching edit mode pattern
  1. **Organization Details** — `md:grid-cols-2` grid with all org fields (type, partner type, name, display name, subdomain, timezone, referring partner)
  2. **Headquarters** — `md:grid-cols-2` grid: address left, phone right
  3. **Billing Information** (providers only) — stacked sections separated by `<hr>`: contact, address (Use General), phone (Use General)
  4. **Provider Admin Information** — stacked sections: contact (email confirm), address (Use General), phone (Use General)
- **Extracted sub-components** (file-local, not exported):
  - `SelectField` — reusable Radix Select with label, required marker, `readonly` options type
  - `TextField` — reusable text input with label, error display
  - `UseGeneralHeader` — title + checkbox row for "Use General Information" pattern
- **Preserved**: All `data-testid` attributes, auto-save draft, conditional billing section, form submission/validation, Enter key prevention
- **Removed**: `GLASSMORPHISM_SECTION_STYLE`, `GLASSMORPHISM_CARD_STYLE`, `createCardHoverHandlers`, `ChevronUp`/`ChevronDown` collapse toggles, `generalCollapsed`/`billingCollapsed`/`adminCollapsed` state
- **Error banner**: Simplified from custom SVG to `AlertTriangle` + `X` icons (matches edit mode error pattern)
- **`@container` removed**: No longer needed — `md:grid-cols-2` uses standard responsive breakpoints

## Important Constraints

- **~~reactFill() for 0-width inputs~~**: No longer applicable after Phase 4. The glassmorphism 3-col grid that caused 0px-wide inputs is being replaced by card-based `md:grid-cols-2` layout.
- **Radix Select evaluate-click**: Glassmorphism cards overlap, use `evaluate(el => el.click())` for Radix triggers (decision 35). May also be resolved by Phase 4 layout change — verify during Phase 5.
- **SPA navigation in profile-switch tests**: Must use `page.locator('a[href="..."]').click()` not `page.goto()` after `switchToProfile()` (decision 27).
- **`#variable_conflict use_column`**: Required in RETURNS TABLE functions with RETURN QUERY.
- **VITE_BACKEND_API_URL removed**: All API calls now route through Edge Functions (bootstrap CORS fix, commit `bd9f998d`).

## Files Changed (Phases 1–4, session 2026-03-06)

### New Files
- `frontend/src/components/organizations/OrganizationCard.tsx` — glassmorphism card for org list
- `frontend/src/pages/organizations/OrganizationListPage.tsx` — new list page with cards, search, filter, redirect
- `infrastructure/supabase/supabase/migrations/20260306214844_extend_get_organizations_provider_admin.sql` — RPC extension

### Modified Files (Phase 5)
- `frontend/e2e/organization-manage-page.spec.ts` — rewritten for route split, 112 → 122 tests

### Modified Files (Phases 1–4)
- `frontend/src/App.tsx` — route split: `/organizations` → list, `/organizations/manage` → manage
- `frontend/src/pages/organizations/OrganizationCreateForm.tsx` — glassmorphism → card-based layout (834 → 573 lines)
- `frontend/src/pages/organizations/OrganizationsManagePage.tsx` — removed left panel, added Back/Create buttons, URL params
- `frontend/src/pages/roles/RolesPage.tsx` — sticky search bar
- `frontend/src/pages/users/UserListPage.tsx` — sticky search bar
- `frontend/src/pages/schedules/ScheduleListPage.tsx` — sticky search bar
- `frontend/src/pages/roles/RolesManagePage.tsx` — Create button moved to header
- `frontend/src/pages/users/UsersManagePage.tsx` — Create button moved to header
- `frontend/src/pages/schedules/SchedulesManagePage.tsx` — Create button moved to header
- `frontend/src/types/organization.types.ts` — added `provider_admin_name/email/phone` optional fields
- `frontend/src/services/organization/SupabaseOrganizationQueryService.ts` — extended row mapping
- `frontend/src/services/organization/MockOrganizationQueryService.ts` — mock admin data
- `documentation/AGENT-INDEX.md` — 3 new keywords
- `documentation/architecture/data/organization-management-architecture.md` — two-route pattern, updated pages 3 & 6
- `documentation/infrastructure/reference/database/tables/organizations_projection.md` — API Functions section

### Phase 5: UAT Test Updates (completed 2026-03-06)
- **Test count**: 112 → 122 tests (10 new: 5 card details, 3 admin search, 3 filter tabs)
- **Test file**: `frontend/e2e/organization-manage-page.spec.ts` (1596 lines, was 1651)
- **data-testid conventions**:
  - OrganizationListPage: `org-list-page`, `org-list-heading`, `org-list-create-btn`, `org-list-filter-all/active/inactive`, `org-list-search-input`, `org-list-loading`, `org-list-empty`, `organization-list` (grid container)
  - OrganizationCard: `org-card-{id}` (unique per card, on outer Card div), `org-card-name`, `org-card-status-badge`, `org-card-type-badge`, `org-card-admin-name`, `org-card-admin-email`, `org-card-admin-phone`, `org-card-no-admin`
- **Key helper changes**:
  - `navigateToManagePage(page, params?)` → `/organizations/manage`
  - `navigateToListPage(page, params?)` → `/organizations`
  - `selectOrg(page, orgId)` → navigates via URL `?orgId=X` (was clicking list items)
  - `waitForCardsLoaded(page)` → waits for `[data-slot="card"]` elements in grid
- **Card-counting selector gotcha**: `[data-testid^="org-card-"]` matches BOTH card containers AND inner elements (`org-card-name`, `org-card-status-badge`, etc.). Must use `[data-testid^="org-card-"][data-slot="card"]` to restrict to Card component's outer div. Evidence: searching "healthit" (1 card) returned 5 elements = card + name + status + type + no-admin.
- **TS-06 restructure**: Unsaved changes guard tests changed from org-switching (no list on manage page) to create-while-editing flow
- **TS-24 restructure**: From clicking org list items during create mode to URL-based create mode entry (`?mode=create`) and S7 collision guard tests
- **Removed TC-19-05**: Collapse toggle test — card-based layout has no collapsible sections
- **2 skipped tests**: TC-09-07 and TC-09-08 (provider admin profile tests, skipped since before this refactor)

## Reference Materials

- Full plan: `/home/lars/.claude/plans/humble-waddling-flamingo.md`
- Organization manage page dev-docs: `dev/active/organization-manage-page-*.md`
- Organization management architecture: `documentation/architecture/data/organization-management-architecture.md`
