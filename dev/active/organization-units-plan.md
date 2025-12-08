# Implementation Plan: Organizational Unit Management

## Executive Summary

Enable provider admins to manage organizational units (departments, locations, campuses, etc.) within their organization's internal hierarchy. This feature uses a new route namespace (`/organization-units/*`) distinct from the platform admin routes (`/organizations/*`) which create root-level Provider/Partner organizations.

The frontend implementation focuses on a tree-based UI with full CRUD capabilities, following existing patterns (MobX ViewModels, service factory pattern, mock-first development). The backend leverages existing database infrastructure (organizations_projection with ltree) with scoping via JWT claims.

**Key Decision**: OU CRUD uses **Supabase RPC functions directly** (not Temporal workflows). OU operations are synchronous database transactions with no external API calls, long-running waits, or saga compensation needs. Temporal is reserved for complex orchestration like organization bootstrap (DNS, email, multi-step coordination).

## Phase 1: Foundation (Types & Services) ✅ COMPLETE

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

## Phase 1.5: Root Organization Visibility ⏳ IN PROGRESS

**Rationale**: Newly revealed requirements - root org must be visible and protected.

### 1.5.1 Type Enhancement
- Add `isRootOrganization?: boolean` derived field to `OrganizationUnit` interface
- Document: computed from `parentPath === null && path depth === 2`
- No contract changes (AsyncAPI already supports via `parent_path IS NULL`)

### 1.5.2 Mock Service Updates
- Include root organization in `getUnits()` response
- Root org has `isRootOrganization: true`, `parentId: null`, `parentPath: null`
- Add deletion protection: `deactivateUnit()` rejects root org with `IS_ROOT_ORGANIZATION` error

### 1.5.3 Tree Builder Updates
- Update `buildOrganizationUnitTree()` to place root org as actual tree root
- Root org is the single top-level node; current "root nodes" become its children

**Expected Outcome**: Root org visible in tree, protected from deletion
**Estimate**: 0.5 session

## Phase 2: State Management (ViewModels) ✅ COMPLETE

### 2.1 OrganizationUnitsViewModel
- MobX observables for tree state
- Selection, expand/collapse, CRUD actions
- Loading and error states
- Keyboard navigation helpers for WAI-ARIA tree

### 2.2 OrganizationUnitFormViewModel
- Form state management for create/edit modes
- Field-level validation with error messages
- Submit handling via service
- Dirty tracking and form reset

**Expected Outcome**: ViewModels ready for UI integration
**Actual Outcome**: ✅ Both ViewModels created and TypeScript-verified

## Phase 3: Tree Component ✅ COMPLETE

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
**Actual Outcome**: ✅ Both components created and TypeScript/lint verified

## Phase 4: Page Components ✅ COMPLETE

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
**Actual Outcome**: ✅ All 4 pages created with TypeScript/lint verified

## Phase 5: Route Integration ✅ COMPLETE

### 5.1 Route Registration
- Add routes to App.tsx with RequirePermission guard
- Permission: `organization.create_ou`
- Nested route structure with Outlet

### 5.2 Sidebar Navigation
- Add nav item to MainLayout
- Role filter: `super_admin`, `provider_admin`
- Permission filter: `organization.create_ou`

**Expected Outcome**: Feature accessible from UI for provider_admin role
**Actual Outcome**: ✅ All routes registered, sidebar nav item added with FolderTree icon

## Phase 5.5a: AsyncAPI Contract Update ✅ COMPLETE

- Expanded `OrganizationUpdatedEvent` schema (was placeholder)
- Added `OrganizationUpdateData` with `organization_id`, `name`, `display_name`, `timezone`, `is_active`, `updated_fields`, `previous_values`
- Validated contract with `npx asyncapi validate` - passed
- Regenerated `asyncapi-bundled.yaml`

**Expected Outcome**: Event contracts ready for RPC function implementation
**Actual Outcome**: ✅ Contract expanded and validated

## Phase 5.5: RLS Policies for OU Management ✅ COMPLETE

### 5.5.1 Database RLS Policies
- ✅ Created SELECT policy: `get_current_scope_path() @> path`
- ✅ Created INSERT policy: `get_current_scope_path() @> path AND nlevel(path) > 2`
- ✅ Created UPDATE policy: same scope containment in USING and WITH CHECK
- ✅ Created DELETE policy: soft delete with scope containment check

### 5.5.2 Validation Constraints
- Child/role validation done in RPC function (not RLS)
- Root org protection via `nlevel(path) > 2` constraint

### 5.5.3 File Created
- `infrastructure/supabase/sql/06-rls/004-ou-management-policies.sql`

**Expected Outcome**: Multi-tenant isolation enforced at database level
**Actual Outcome**: ✅ Four policies created with idempotent pattern

## Phase 5.6: Supabase RPC Functions (Backend) ✅ COMPLETE

### 5.6.1 RPC Functions Created
- File: `infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql`
- 6 functions in `api` schema:
  - `get_organization_units(p_status, p_search_term)` - List units within scope
  - `get_organization_unit_by_id(p_unit_id)` - Get single unit
  - `get_organization_unit_descendants(p_unit_id)` - Get descendants
  - `create_organization_unit(...)` - Create with event emission
  - `update_organization_unit(...)` - Update with event emission
  - `deactivate_organization_unit(p_unit_id)` - Soft delete with validation

### 5.6.2 Production Service Implementation
- Created `SupabaseOrganizationUnitService.ts`
- Implements IOrganizationUnitService interface
- Uses `.schema('api').rpc(...)` pattern
- Updated factory to return real service for production config

**Expected Outcome**: Backend CRUD via Supabase RPC, production service ready
**Actual Outcome**: ✅ All functions created, frontend service implemented, TypeScript/lint pass

## Phase 6: Testing & Documentation ✅ COMPLETE

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
**Actual Outcome**: ✅ All tests passed, `npm run docs:check` returns 0 issues

---

## Success Metrics

### Immediate ✅ COMPLETE (Phase 0-5)
- [x] Permission `organization.create_ou` defined and seeded
- [x] Mock service returns hierarchical data (8 units including root, 3 levels)
- [x] Service factory returns correct implementation based on mode
- [x] OrganizationUnitsViewModel manages tree state with keyboard navigation
- [x] OrganizationUnitFormViewModel manages form state with validation
- [x] Tree renders with expand/collapse (Phase 3 ✅)
- [x] All 4 pages functional (Phase 4 ✅)
- [x] Routes protected by permission guard (Phase 5 ✅)

### Medium-Term (Phases 3-5)
- [x] Full CRUD operations work in mock mode
- [x] Keyboard navigation in tree component (WAI-ARIA compliant)
- [x] All 4 pages created and TypeScript-verified

### Long-Term (Phases 5.5-6) ✅ COMPLETE
- [x] Documentation validation passes (`npm run docs:check` - 0 issues)
- [x] Backend RPC functions implemented (Phase 5.6 ✅)
- [ ] Production data flows correctly (requires migration deployment)

---

## Implementation Schedule

| Phase | Description | Sessions |
|-------|-------------|----------|
| 0 | Pre-Implementation (Permission Setup) | 0.5 |
| 1 | Foundation (Types & Services) | 1 |
| 1.5 | Root Organization Visibility | 0.5 |
| 2 | State Management (ViewModels) | 1 |
| 3 | Tree Component | 1-2 |
| 4 | Page Components | 2 |
| 5 | Route Integration | 0.5 |
| 5.5 | RLS Policies for OU Management | 1 |
| 5.5a | AsyncAPI Contract Update (REQUIRED) | 0.5 |
| 5.6 | Supabase RPC Functions (Backend) | 1-1.5 |
| 6 | Testing & Documentation | 1 |
| **Total** | | **10-11.5** |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Tree accessibility complexity | Follow WAI-ARIA tree pattern spec exactly |
| MobX reactivity issues with nested data | Use immutable updates, wrap components with observer |
| Permission guard not blocking routes | Test with mock user without permission |
| Backend RPC functions not ready | Mock service fully functional, can ship frontend-only |

## Pre-Implementation Tasks

### Permission Setup: `organization.create_ou`

Before starting Phase 1, ensure the permission exists and is properly granted:

1. **Create Permission Migration** (CRITICAL):
   - File: `infrastructure/supabase/sql/99-seeds/organization-create-ou-permission.sql`
   - Emit `permission.defined` event for `organization.create_ou`
   - Grant to `provider_admin` role via `role.permission.granted` event
   - Grant to `super_admin` role (inherits all permissions)

2. **Frontend config**: Update `frontend/src/config/permissions.config.ts`
   - Add `organization.create_ou` definition (MEDIUM risk, organization scope)

3. **Documentation Updates**:
   - Update `documentation/architecture/authorization/rbac-architecture.md`
   - Update Role Permission Matrix to include `organization.create_ou`
   - Replace any references to `organization.create_sub`

4. **Rationale**: `create_ou` (Organizational Unit) is clearer than `create_sub` (sub-organization)

### AsyncAPI Contract Update (REQUIRED - Phase 5.5a)

**Contract-First Principle**: Per infrastructure guidelines, event contracts must be defined before implementing producers.

- **Review existing**: `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml`
  - `organization.created` ✅ Already complete (uses `parent_path` for sub-org detection)
  - `organization.deactivated` ✅ Already complete
  - `organization.updated` ⚠️ **Placeholder only** - needs expansion
- **Expand `OrganizationUpdatedEvent` schema** to include:
  - `event_data` with updatable fields (name, display_name, time_zone, is_active)
  - `event_metadata` reference
  - `required` fields specification
- **Validate contract**: `asyncapi validate infrastructure/supabase/contracts/asyncapi/asyncapi.yaml`

---

## Next Steps After Completion

1. Unit move operations (change parent OU)
2. Bulk operations (CSV import/export)
3. User documentation for end-users
4. Integration with setup wizard (parked feature - `dev/parked/provider-admin-post-invitation`)
5. Drag-and-drop reordering in tree view
