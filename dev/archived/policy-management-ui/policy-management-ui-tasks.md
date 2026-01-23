# Tasks: Policy Management UI

> ## ⚠️ OBSOLETE (2026-01-22)
>
> **This document is OBSOLETE and should be archived.**
>
> **Reason**: After domain clarification, the Policy-as-Data approach (`access_policies` table)
> has been REMOVED from the architecture. RLS is fixed at permission + scope containment only.
> Assignment tables are for Temporal workflow routing, not RLS access control.
>
> **Action**: Move to `dev/archived/policy-management-ui/`
>
> See `multi-role-authorization-context.md` for the revised architecture.

---

## ~~Prerequisites (from multi-role-authorization)~~ ⏸️ BLOCKED → OBSOLETE

> ~~These tasks must be completed first. See `multi-role-authorization-tasks.md`~~

- ~~[ ] `access_policies` table created and deployed~~
- ~~[ ] `access_policy_changes` audit table created~~
- ~~[ ] `evaluate_access_policy()` function deployed~~
- ~~[ ] RLS policies on access_policies table~~

## Phase 1: Backend API Foundation ⏸️ PENDING

- [ ] Create `api.list_access_policies(p_org_id uuid)` function
- [ ] Create `api.get_access_policy(p_policy_id uuid)` function
- [ ] Create `api.create_access_policy(...)` function with audit
- [ ] Create `api.update_access_policy(...)` function with audit
- [ ] Create `api.deactivate_access_policy(p_policy_id, p_reason)` function
- [ ] Create `api.get_policy_change_history(p_policy_id)` function
- [ ] Create `api.list_resource_types()` function (returns available types)
- [ ] Add RLS policies for API functions
- [ ] Test API functions with various permission scenarios

## Phase 2: Types and Service Layer ⏸️ PENDING

- [ ] Create `frontend/src/types/policy.types.ts`
  - [ ] `AccessPolicy` interface
  - [ ] `CreatePolicyRequest` interface
  - [ ] `UpdatePolicyRequest` interface
  - [ ] `PolicyChange` interface (audit record)
- [ ] Create `frontend/src/services/policies/IPolicyService.ts`
- [ ] Create `frontend/src/services/policies/SupabasePolicyService.ts`
- [ ] Create `frontend/src/services/policies/MockPolicyService.ts`
- [ ] Register service in `ServiceRegistry.ts`
- [ ] Add service factory pattern

## Phase 3: ViewModels ⏸️ PENDING

- [ ] Create `PolicyListViewModel.ts`
  - [ ] Observable policies collection
  - [ ] Loading/error states
  - [ ] Filter state (resource type, status)
  - [ ] `loadPolicies()` action
  - [ ] `deletePolicy()` action
- [ ] Create `PolicyFormViewModel.ts`
  - [ ] Form state for all policy fields
  - [ ] Validation logic
  - [ ] `submit()` action
  - [ ] Resource type → permission cascading
- [ ] Create `PolicyDetailViewModel.ts`
  - [ ] Single policy observable
  - [ ] Change history observable
  - [ ] `loadPolicy()` action
  - [ ] `loadHistory()` action

## Phase 4: UI Components ⏸️ PENDING

### Policy List Page
- [ ] Create `PoliciesListPage.tsx`
- [ ] Implement data table with columns
- [ ] Add filter dropdowns
- [ ] Add "Create Policy" button
- [ ] Add row actions (View, Edit, Deactivate)

### Policy Form Page
- [ ] Create `PolicyFormPage.tsx` (handles create and edit)
- [ ] Create `PolicyConditionsForm.tsx` component
  - [ ] Checkbox group for condition flags
  - [ ] Time picker for time restrictions
  - [ ] Day-of-week multi-select
- [ ] Implement resource type dropdown
- [ ] Implement permission dropdown (filtered by resource type)
- [ ] Add form validation
- [ ] Add submit/cancel actions

### Policy Detail Page
- [ ] Create `PolicyDetailPage.tsx`
- [ ] Display policy configuration (read-only)
- [ ] Create `PolicyChangeHistory.tsx` component
- [ ] Add "Edit" and "Deactivate" buttons
- [ ] Add confirmation dialog for deactivation

## Phase 5: Route Integration ⏸️ PENDING

- [ ] Add routes to `routes.tsx`:
  - [ ] `/settings/policies` - List
  - [ ] `/settings/policies/new` - Create
  - [ ] `/settings/policies/:id` - Detail
  - [ ] `/settings/policies/:id/edit` - Edit
- [ ] Add navigation link in SettingsPage
- [ ] Add permission gate (check `access_grant.view`)
- [ ] Add breadcrumb navigation

## Phase 6: Testing ⏸️ PENDING

### Unit Tests
- [ ] PolicyListViewModel tests
- [ ] PolicyFormViewModel tests
- [ ] PolicyDetailViewModel tests
- [ ] Form validation tests

### Integration Tests
- [ ] API function tests
- [ ] Service layer tests with real Supabase

### E2E Tests
- [ ] Create policy flow
- [ ] Edit policy flow
- [ ] Deactivate policy flow
- [ ] Permission denied scenarios

## Phase 7: Documentation ⏸️ PENDING

- [ ] Add policy management to admin user guide
- [ ] Document each policy condition with examples
- [ ] Create policy templates documentation
- [ ] Add troubleshooting guide

## Success Validation Checkpoints

### API Complete
- [ ] All 6 API functions created and tested
- [ ] Audit trail records changes correctly
- [ ] RLS prevents cross-org access

### UI Complete
- [ ] List page shows all policies
- [ ] Create form works with all condition options
- [ ] Edit form pre-populates correctly
- [ ] Deactivate prompts for reason
- [ ] Change history displays correctly

### Integration Complete
- [ ] Policy changes affect `evaluate_access_policy()` immediately
- [ ] Permission gating prevents unauthorized access
- [ ] Works in mock mode for development

## Current Status

**Phase**: Prerequisites
**Status**: ⏸️ BLOCKED - Waiting for infrastructure from multi-role-authorization
**Last Updated**: 2026-01-21
**Next Step**: Complete `access_policies` table creation in multi-role-authorization Phase 3

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `access_policies` table | multi-role-authorization Phase 3 | Pending |
| `access_policy_changes` table | multi-role-authorization Phase 3 | Pending |
| `evaluate_access_policy()` | multi-role-authorization Phase 3 | Pending |
| `permission_implications` table | multi-role-authorization Phase 2 | Pending |

## Notes

- This UI is for **organization administrators** to customize access rules
- Super admins may also configure **global default** policies (org_id = NULL)
- Policy changes take effect immediately - no deployment needed
- All changes require a "reason" field for audit compliance
