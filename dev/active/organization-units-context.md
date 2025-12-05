# Context: Organizational Unit Management

## Decision Record

**Date**: 2025-12-04
**Feature**: Organizational Unit Management for Provider Admins
**Goal**: Enable provider admins to manage their organization's internal hierarchy (departments, locations, campuses) via a tree-based CRUD interface.

### Key Decisions

1. **Route Namespace Separation**: Use `/organization-units/*` for provider admin OU management, distinct from `/organizations/*` which is for platform admins creating root-level orgs. This prevents confusion and allows different permission guards.

2. **Route Structure**: `/organization-units` for display (read-only tree), `/organization-units/manage` for CRUD operations. User preference over alternatives like `/settings/units` or `/structure`.

3. **Subdomain Inheritance**: Organizational units inherit their parent organization's subdomain - no separate subdomains for units. Simplifies routing and DNS management.

4. **Leverage Existing Database**: Use existing `organizations_projection` table with ltree hierarchy. Sub-orgs have `nlevel(path) > 2` and `parent_path IS NOT NULL`. Same `organization.created` event for both root and sub-orgs.

5. **Type Inheritance**: Sub-organization type is inherited from parent (enforced by event processor). No need to specify type when creating units.

6. **Permission Model**: Use `organization.create_sub` permission (MEDIUM risk, organization scope) for all OU operations. More restrictive than `organization.create` (HIGH risk, global scope).

---

## Technical Context

### Architecture

```
Provider Admin (subdomain: acme-healthcare.a4c.app)
    ↓
Frontend Route (/organization-units/*)
    ↓ RequirePermission(organization.create_sub)
Pages → ViewModel → Service
    ↓
Mock Service (dev) / Supabase RPC (prod)
    ↓
organizations_projection table (ltree hierarchy)
    ↓
RLS policies scope by JWT org_id claim
```

### Tech Stack

- **Framework**: React 19 + TypeScript (strict mode)
- **State Management**: MobX with mobx-react-lite observer HOC
- **Routing**: React Router v6 with nested routes
- **UI Components**: Tailwind CSS, Lucide icons
- **Testing**: Vitest (unit), Playwright (E2E)
- **Accessibility**: WCAG 2.1 Level AA required

### Dependencies

- **Authentication**: Supabase Auth with JWT custom claims (`org_id`, `user_role`, `permissions`)
- **Permission System**: `RequirePermission` component, `hasPermission()` hook
- **Database**: PostgreSQL with ltree extension (organizations_projection table)
- **Existing Patterns**: `OrganizationFormViewModel`, `MockWorkflowClient`, factory pattern

---

## File Structure

### Files to Create

**Types & Interfaces:**
- `frontend/src/types/organization-unit.types.ts` - Core type definitions

**Services:**
- `frontend/src/services/organization/IOrganizationUnitService.ts` - Service interface
- `frontend/src/services/organization/MockOrganizationUnitService.ts` - Mock implementation
- `frontend/src/services/organization/OrganizationUnitServiceFactory.ts` - Factory for DI

**ViewModels:**
- `frontend/src/viewModels/organization/OrganizationUnitsViewModel.ts` - Tree state management
- `frontend/src/viewModels/organization/OrganizationUnitFormViewModel.ts` - Form state

**Components:**
- `frontend/src/components/organization-units/OrganizationTree.tsx` - Tree container
- `frontend/src/components/organization-units/OrganizationTreeNode.tsx` - Tree node

**Pages:**
- `frontend/src/pages/organization-units/OrganizationUnitsListPage.tsx` - Read-only view
- `frontend/src/pages/organization-units/OrganizationUnitsManagePage.tsx` - CRUD interface
- `frontend/src/pages/organization-units/OrganizationUnitCreatePage.tsx` - Create form
- `frontend/src/pages/organization-units/OrganizationUnitEditPage.tsx` - Edit form

### Files to Modify

- `frontend/src/App.tsx` (lines 85-94 area) - Add route definitions
- `frontend/src/components/layouts/MainLayout.tsx` (line 46 area) - Add sidebar nav item

---

## Related Components

**Authentication & Permissions:**
- `frontend/src/components/auth/RequirePermission.tsx` - Route permission guard
- `frontend/src/contexts/AuthContext.tsx` - Auth state and hasPermission()
- `frontend/src/config/permissions.config.ts` - Permission definitions

**Existing Organization Components (patterns to follow):**
- `frontend/src/pages/organizations/OrganizationCreatePage.tsx` - Form page pattern
- `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` - MobX ViewModel pattern
- `frontend/src/services/workflow/MockWorkflowClient.ts` - Mock service pattern

**Layout:**
- `frontend/src/components/layouts/MainLayout.tsx` - Sidebar navigation

---

## Key Patterns and Conventions

### MobX ViewModel Pattern
```typescript
class OrganizationUnitsViewModel {
  units: OrganizationUnitNode[] = [];
  selectedUnitId: string | null = null;

  constructor(
    private service: IOrganizationUnitService = OrganizationUnitServiceFactory.create()
  ) {
    makeAutoObservable(this);
  }

  async loadUnits() {
    runInAction(() => { this.isLoading = true; });
    const data = await this.service.getUnits();
    runInAction(() => { this.units = data; this.isLoading = false; });
  }
}
```

### Service Factory Pattern
```typescript
class OrganizationUnitServiceFactory {
  static create(): IOrganizationUnitService {
    const config = getAppConfig();
    return config.services.organizationUnit === 'mock'
      ? new MockOrganizationUnitService()
      : new SupabaseOrganizationUnitService();
  }
}
```

### Tree Accessibility Pattern (WAI-ARIA)
```tsx
<ul role="tree" aria-label="Organization hierarchy">
  <li role="treeitem" aria-expanded="true" aria-level={1}>
    <span>Root Org</span>
    <ul role="group">
      <li role="treeitem" aria-level={2}>Child</li>
    </ul>
  </li>
</ul>
```

### Form Validation Pattern
```typescript
validate(): boolean {
  this.errors = {};
  if (!this.formData.name.trim()) {
    this.errors.name = 'Name is required';
  }
  return Object.keys(this.errors).length === 0;
}
```

---

## Reference Materials

**Internal Documentation:**
- `documentation/architecture/data/multi-tenancy-architecture.md` - ltree hierarchy design
- `documentation/architecture/data/organization-management-architecture.md` - Organization CQRS patterns
- `frontend/CLAUDE.md` - Frontend development guidelines, accessibility requirements

**External References:**
- [WAI-ARIA Tree Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) - Accessibility pattern spec
- [MobX Documentation](https://mobx.js.org/) - State management patterns

---

## Important Constraints

1. **WCAG 2.1 Level AA Required**: Full keyboard navigation, proper ARIA attributes, focus management
2. **MobX Reactivity**: Always wrap components with `observer`, use immutable updates for arrays
3. **No Direct Array Mutation**: Use `this.units = [...this.units, newItem]` not `this.units.push()`
4. **Permission Guard Required**: All routes must use `RequirePermission` with `organization.create_sub`
5. **Mock-First Development**: Mock service must be fully functional before production service
6. **Documentation Required**: All components must have docs per frontend CLAUDE.md Definition of Done

---

## Why This Approach?

**Why separate routes (`/organization-units` vs `/organizations`)?**
- Different audiences: provider_admin vs super_admin
- Different permissions: `organization.create_sub` vs `organization.create`
- Clearer separation of concerns
- Avoids confusion about what "create organization" means in different contexts

**Why tree-based UI?**
- Hierarchical data naturally suited to tree visualization
- Users familiar with folder tree patterns
- Allows unlimited depth (ltree supports this)
- Better UX for understanding parent-child relationships

**Why mock-first development?**
- Frontend can be developed independently of backend
- Faster iteration on UI/UX
- Easy testing without network dependencies
- Production service can be added later without changing UI code

**Why inherit type from parent?**
- Consistent with existing event processor behavior
- Reduces form complexity (one less field)
- Prevents type mismatches in hierarchy
- Matches architectural decision in multi-tenancy spec
