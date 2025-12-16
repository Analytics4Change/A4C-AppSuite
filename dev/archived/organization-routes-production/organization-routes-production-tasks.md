# Tasks: Organization Routes Production Integration

## Phase 1: Database Extensions ✅ COMPLETE

- [x] Create `api.get_organizations_paginated()` RPC function
  - Added directly to CONSOLIDATED_SCHEMA.sql (not separate file per project convention)
  - Parameters: p_type, p_is_active, p_search_term, p_page, p_page_size, p_sort_by, p_sort_order
  - Returns: org columns + total_count via window function
- [x] Add function to CONSOLIDATED_SCHEMA.sql
- [x] Deploy via GitHub Actions "Deploy Database Schema" workflow
- [x] Verify function works via MCP `execute_sql`

## Phase 2: Service Layer ✅ COMPLETE

### 2.1 Command Service
- [x] Create `IOrganizationCommandService.ts` interface
- [x] Create `SupabaseOrganizationCommandService.ts` implementation
- [x] Create `MockOrganizationCommandService.ts` for dev mode
- [x] Create `OrganizationCommandServiceFactory.ts`

### 2.2 Query Service Extensions
- [x] Add `PaginatedResult<T>` interface to `organization.types.ts`
- [x] Add `OrganizationQueryOptions` interface
- [x] Implement `getOrganizationsPaginated()` in `SupabaseOrganizationQueryService.ts`
- [x] Add pagination mock to `MockOrganizationQueryService.ts`

## Phase 3: ViewModels ✅ COMPLETE

### 3.1 OrganizationListViewModel
- [x] Create `OrganizationListViewModel.ts`
- [x] Add observable state: organizations, pagination, filters, sorting, loading, error
- [x] Implement actions: loadOrganizations, loadNextPage, loadPreviousPage
- [x] Implement filters: setSearchTerm (debounced), setTypeFilter, setStatusFilter
- [x] Implement sorting: setSortBy, toggleSortOrder
- [x] Add clearFilters action

### 3.2 OrganizationDashboardViewModel
- [x] Create `OrganizationDashboardViewModel.ts`
- [x] Add observable state: organization, isEditMode, editData, isLoading, isSaving, errors
- [x] Implement loadOrganization action
- [x] Implement edit actions: enterEditMode, cancelEdit, updateField
- [x] Implement saveChanges action (emits domain event)

## Phase 4: Component Updates ✅ COMPLETE

### 4.1 OrganizationDashboard
- [x] Import OrganizationDashboardViewModel
- [x] Replace mock data with ViewModel state
- [x] Add loading spinner during fetch
- [x] Add error state display
- [x] Create CoreInfoSection (name, display_name, type) - inline in component
- [x] Create DomainCard (subdomain/slug) - inline in component
- [x] Create StatusCard (is_active, timestamps) - inline in component
- [x] Create TimezoneCard - inline in component
- [x] Implement inline edit mode (not modal) - cleaner UX
- [x] Wire up edit button to enterEditMode
- [x] Wire up save/cancel buttons

### 4.2 OrganizationListPage
- [x] Import OrganizationListViewModel
- [x] Replace empty array with ViewModel state
- [x] Create SearchBar (debounced input) - inline in component
- [x] Create TypeFilter dropdown (provider, partner, platform_owner, all)
- [x] Create StatusFilter dropdown (active, inactive, all)
- [x] Create SortControls (sort by field, order toggle)
- [x] Update OrganizationGrid to use ViewModel data
- [x] Create Pagination component (page controls, total count)
- [x] Add loading state during fetch
- [x] Add empty state when no results
- [x] Add error state display

## Phase 5: Testing ⏸️ DEFERRED

- [ ] Unit tests for OrganizationListViewModel
- [ ] Unit tests for OrganizationDashboardViewModel
- [ ] Integration test: Load organizations list
- [ ] Integration test: Filter and sort organizations
- [ ] Integration test: Load organization dashboard
- [ ] Integration test: Edit organization and verify event
- [ ] E2E test: Full flow from list to dashboard to edit

**Note**: Formal testing deferred. Feature deployed to production and manually verified.

## Success Validation Checkpoints

### Immediate Validation ✅
- [x] `/organizations` route shows organizations from database (not empty)
- [x] `/organizations/:id/dashboard` shows correct org data (not "Acme Treatment Center")
- [x] Loading states display during data fetch

### Feature Complete Validation ✅
- [x] Search filters organizations by name
- [x] Type filter (provider/partner/platform_owner) works
- [x] Status filter (active/inactive) works
- [x] Pagination navigates through results correctly
- [x] Sort by name/type/date works in both directions
- [x] Edit mode inline with form fields
- [x] Save emits domain event via `api.emit_domain_event` RPC
- [x] Projection updates after save via event processor trigger

### Access Control Validation
- [ ] super_admin sees all organizations (RLS configured, not explicitly tested)
- [ ] provider_admin only sees their organization (RLS configured, not explicitly tested)
- [ ] RLS policies enforced correctly

## Current Status

**Phase**: ✅ COMPLETE (Phases 1-4)
**Status**: ✅ DEPLOYED TO PRODUCTION
**Last Updated**: 2025-12-15
**Commit**: c94df447 - feat(organizations): Connect organization routes to production data

## Implementation Notes

1. **Database Function Location**: Added `api.get_organizations_paginated()` directly to CONSOLIDATED_SCHEMA.sql per project convention (not separate file)

2. **Edit Mode UX**: Used inline edit mode instead of modal - cleaner UX, edit button toggles form fields inline

3. **Pagination Type Interface**: Added to `organization.types.ts` rather than query service interface file

4. **Factory Pattern**: Used `createOrganizationQueryService()` function (not class) matching existing pattern

5. **Event Emission**: Uses `api.emit_domain_event` RPC with `globalThis.crypto.randomUUID()` for event ID

6. **Lint Fixes**: Fixed unused import, useCallback for loadDrafts, globalThis.crypto for ESLint

## Deployment Verification

All GitHub Actions workflows completed successfully:
- Deploy Database Schema: ✅ success (1m 47s)
- Deploy Frontend: ✅ success (1m 48s)
- Validate Frontend Documentation: ✅ success (1m 3s)
