# Implementation Plan: Organization Routes Production Integration

## Plan Status: READY TO IMPLEMENT

**Last Updated**: 2025-12-15
**Phase 1**: Database Extensions
**Phase 2**: Service Layer
**Phase 3**: ViewModels
**Phase 4**: Component Updates

---

## Executive Summary

This feature connects the organization routes (`/organizations` and `/organizations/:id/dashboard`) to real database data after the bootstrap workflow completes. Currently, the dashboard shows mock "Acme Treatment Center" data, and the list page shows an empty array. The implementation follows the ViewModel + MobX pattern with event-driven updates through domain events.

## Requirements (Confirmed via Interactive Session)

| Requirement | Decision |
|-------------|----------|
| Routes | Both together (`/organizations` + `/organizations/:id/dashboard`) |
| Architecture | ViewModel + MobX pattern |
| List Features | Full Featured (search, filter, pagination, sort) |
| Access Control | Role-Based (super_admin sees all, others via RLS) |
| Dashboard Sections | Core Info Only (name, type, domain, status) |
| Dashboard Data | Organizations projection table only |
| Dashboard Actions | Basic Edit (name, display_name, timezone) |
| Edit Pattern | Event-Driven (emit domain events -> triggers update projections) |

---

## Phase 1: Database Extensions

### 1.1 Add Paginated Query RPC
- Create `api.get_organizations_paginated()` function
- Parameters: type, is_active, search_term, page, page_size, sort_by, sort_order
- Returns: org data + total_count for pagination
- Expected outcome: RPC endpoint for paginated queries with filters

### 1.2 Sync CONSOLIDATED_SCHEMA.sql
- Add new function to deployment artifact
- Expected outcome: Function deployed to production Supabase

---

## Phase 2: Service Layer (Foundation)

### 2.1 Create Command Service Interface
- Define `IOrganizationCommandService` interface
- Method: `updateOrganization(orgId, data, reason)`
- Expected outcome: Type-safe interface for organization updates

### 2.2 Implement Supabase Command Service
- Create `SupabaseOrganizationCommandService`
- Uses `eventEmitter.emit()` with `organization.updated` event type
- Backend processor already handles this event
- Expected outcome: Event-driven updates working

### 2.3 Extend Query Service for Pagination
- Add `PaginatedResult<T>` interface
- Add `OrganizationQueryOptions` interface
- Implement in `SupabaseOrganizationQueryService`
- Expected outcome: Paginated queries working

---

## Phase 3: ViewModels

### 3.1 OrganizationListViewModel
- State: organizations, pagination, filters, sorting, loading
- Actions: load, paginate, filter, sort, clear
- Expected outcome: Complete state management for list page

### 3.2 OrganizationDashboardViewModel
- State: organization, editMode, editData, loading, errors
- Actions: load, enterEditMode, cancelEdit, updateField, saveChanges
- Expected outcome: Complete state management for dashboard

---

## Phase 4: Component Updates

### 4.1 Update OrganizationDashboard
- Replace mock data with ViewModel
- Add CoreInfoSection, TimezoneCard, EditModal
- Handle loading/error states
- Expected outcome: Dashboard shows real org data with edit capability

### 4.2 Update OrganizationListPage
- Replace empty array with ViewModel
- Add SearchAndFilters, SortControls, Pagination
- Show OrganizationGrid with cards
- Expected outcome: List shows all organizations with full features

---

## Success Metrics

### Immediate
- [ ] `/organizations` shows real organizations from database
- [ ] `/organizations/:id/dashboard` shows real org data

### Medium-Term
- [ ] Search filters organizations by name
- [ ] Type/status filters work correctly
- [ ] Pagination navigates through results
- [ ] Sort by name/type/date works
- [ ] Edit mode allows updating name, display_name, timezone

### Long-Term
- [ ] Edits emit domain events (event-driven pattern)
- [ ] RLS enforces role-based access
- [ ] Loading/error states display correctly

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| RLS blocking queries | Test with different user roles, verify JWT claims |
| Event processor not updating | Verify trigger exists, check domain_events table |
| Pagination performance | Add database index on sort columns |
| Edit race conditions | Optimistic locking with version field (future) |

## Next Steps After Completion

1. Add organization settings management (features, limits)
2. Organization member management UI
3. Organization hierarchy visualization
4. Audit log display for organization events
