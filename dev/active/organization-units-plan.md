# Implementation Plan: Organizational Unit Management

## Executive Summary

Enable provider admins to manage organizational units (departments, locations, campuses, etc.) within their organization's internal hierarchy. This feature uses a new route namespace (`/organization-units/*`) distinct from the platform admin routes (`/organizations/*`) which create root-level Provider/Partner organizations.

The frontend implementation focuses on a tree-based UI with full CRUD capabilities, following existing patterns (MobX ViewModels, service factory pattern, mock-first development). The backend leverages existing database infrastructure (organizations_projection with ltree) with scoping via JWT claims.

## Phase 1: Foundation (Types & Services)

### 1.1 Type Definitions
- Create `organization-unit.types.ts` with interfaces
- Define `OrganizationUnit`, `OrganizationUnitNode`, request/response types
- Follow existing organization types patterns

### 1.2 Service Interface & Mock Implementation
- Create `IOrganizationUnitService` interface
- Implement `MockOrganizationUnitService` with localStorage
- Create `OrganizationUnitServiceFactory` for DI
- Mock data: 3-level hierarchy for testing

**Expected Outcome**: Types defined, mock service functional, factory pattern working
**Estimate**: 1 session

## Phase 2: State Management (ViewModels)

### 2.1 OrganizationUnitsViewModel
- MobX observables for tree state
- Selection, expand/collapse, CRUD actions
- Loading and error states
- Follow `OrganizationFormViewModel` patterns

### 2.2 OrganizationUnitFormViewModel
- Form state management for create/edit
- Validation rules (name, display name required)
- Submit handling via service

**Expected Outcome**: ViewModels ready for UI integration
**Estimate**: 1 session

## Phase 3: Tree Component

### 3.1 OrganizationTree Component
- Hierarchical tree rendering
- WCAG 2.1 Level AA accessibility (role="tree", aria attributes)
- Arrow key navigation
- Expand/collapse functionality

### 3.2 OrganizationTreeNode Component
- Individual node rendering
- Visual indicators (active/inactive, depth, children count)
- Selection state
- Focus management

**Expected Outcome**: Accessible, keyboard-navigable tree component
**Estimate**: 1-2 sessions

## Phase 4: Page Components

### 4.1 OrganizationUnitsListPage
- Read-only tree visualization
- "Manage Units" navigation button
- Page header and layout

### 4.2 OrganizationUnitsManagePage
- Split view: tree + action panel
- CRUD buttons based on selection
- Confirmation dialogs for destructive actions

### 4.3 OrganizationUnitCreatePage
- Simplified form (4 fields)
- Parent unit dropdown
- Validation and submission

### 4.4 OrganizationUnitEditPage
- Load existing unit
- Edit form with validation
- Active/inactive toggle

**Expected Outcome**: All 4 pages functional with mock data
**Estimate**: 2 sessions

## Phase 5: Route Integration

### 5.1 Route Registration
- Add routes to App.tsx with RequirePermission guard
- Permission: `organization.create_sub`
- Nested route structure with Outlet

### 5.2 Sidebar Navigation
- Add nav item to MainLayout
- Role filter: `provider_admin`
- Permission filter: `organization.create_sub`

**Expected Outcome**: Feature accessible from UI for provider_admin role
**Estimate**: 0.5 session

## Phase 6: Testing & Documentation

### 6.1 Testing
- Keyboard navigation testing
- Mock mode CRUD operations
- Permission guard enforcement
- Tab order through forms

### 6.2 Documentation
- Component docs for OrganizationTree, OrganizationTreeNode
- ViewModel docs
- Type documentation
- Run `npm run docs:check`

**Expected Outcome**: Feature documented, tests passing
**Estimate**: 1 session

---

## Success Metrics

### Immediate
- [ ] Mock service returns hierarchical data
- [ ] Tree renders with expand/collapse
- [ ] Routes protected by permission guard

### Medium-Term
- [ ] Full CRUD operations work in mock mode
- [ ] Keyboard navigation passes accessibility audit
- [ ] All 4 pages functional

### Long-Term
- [ ] Documentation validation passes
- [ ] Backend RPC functions implemented
- [ ] Production data flows correctly

---

## Implementation Schedule

| Phase | Description | Sessions |
|-------|-------------|----------|
| 1 | Foundation (Types & Services) | 1 |
| 2 | State Management (ViewModels) | 1 |
| 3 | Tree Component | 1-2 |
| 4 | Page Components | 2 |
| 5 | Route Integration | 0.5 |
| 6 | Testing & Documentation | 1 |
| **Total** | | **6.5-7.5** |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Tree accessibility complexity | Follow WAI-ARIA tree pattern spec exactly |
| MobX reactivity issues with nested data | Use immutable updates, wrap components with observer |
| Permission guard not blocking routes | Test with mock user without permission |
| Backend RPC functions not ready | Mock service fully functional, can ship frontend-only |

---

## Next Steps After Completion

1. Backend RPC functions (infrastructure phase)
2. Production service implementation (`SupabaseOrganizationUnitService`)
3. Unit move operations (change parent)
4. Bulk operations (import/export)
5. User documentation for end-users
