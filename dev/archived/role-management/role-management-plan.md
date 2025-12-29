# Role Management Feature - Plan

## Overview

Implement a Role Management UI for CRUD operations on roles and their permissions, following the Organization Units pattern.

**Created**: 2024-12-24
**Plan File**: `/home/lars/.claude/plans/synchronous-roaming-stroustrup.md`

## Design Decisions

| Decision | Choice |
|----------|--------|
| Layout | Split-view (list 1/3, form 2/3) - permissions need more space |
| Permission UI | Grouped checkboxes by applet with "Select All" per group |
| Delegation rule | Subset-only (users can only grant permissions they possess) |
| Scope | Role Management only (not role assignment to users) |
| OU Scope selector | Text input for ltree path (optional field) |
| Multi-domain roles | Allowed (roles can span multiple applets) |

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | AsyncAPI contract updates (4 events) | ✅ Complete |
| 2 | Database migration (API functions, event processor) | ✅ Complete |
| 3 | Frontend types (role.types.ts) | ✅ Complete |
| 4 | Service layer (interface, Supabase, mock, factory) | ✅ Complete |
| 5 | ViewModels (RolesViewModel, RoleFormViewModel) | ✅ Complete |
| 6 | UI components (PermissionSelector, RoleList, RoleFormFields) | ✅ Complete |
| 7 | Page & routing (RolesManagePage, /roles/manage) | ✅ Complete |
| 8 | Testing (unit, E2E, accessibility) | ⏸️ Pending |

## Success Criteria

- [x] Roles can be created with name, description, optional scope
- [x] Permissions can be selected by applet with "Select All"
- [x] Subset-only delegation enforced (disabled checkboxes for missing permissions)
- [x] Roles can be edited, deactivated, reactivated, deleted
- [x] Split-view layout matches Organization Units pattern
- [x] WCAG 2.1 Level AA accessibility
- [x] TypeScript compiles without errors
- [x] Production build succeeds
- [x] All GitHub Actions workflows pass
- [ ] Unit tests pass
- [ ] E2E tests pass

## Files Created (17 total)

### Infrastructure
- `infrastructure/supabase/contracts/asyncapi/domains/rbac.yaml` (modified)
- `infrastructure/supabase/supabase/migrations/20251224220822_role_management_api.sql`

### Frontend
- `frontend/src/types/role.types.ts`
- `frontend/src/services/roles/IRoleService.ts`
- `frontend/src/services/roles/SupabaseRoleService.ts`
- `frontend/src/services/roles/MockRoleService.ts`
- `frontend/src/services/roles/RoleServiceFactory.ts`
- `frontend/src/services/roles/index.ts`
- `frontend/src/viewModels/roles/RolesViewModel.ts`
- `frontend/src/viewModels/roles/RoleFormViewModel.ts`
- `frontend/src/components/roles/PermissionSelector.tsx`
- `frontend/src/components/roles/RoleList.tsx`
- `frontend/src/components/roles/RoleFormFields.tsx`
- `frontend/src/components/roles/index.ts`
- `frontend/src/pages/roles/RolesManagePage.tsx`
- `frontend/src/pages/roles/index.ts`
- `frontend/src/App.tsx` (modified - added route)
