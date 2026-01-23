# Implementation Plan: Policy Management UI

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

## ~~Executive Summary~~ (OBSOLETE)

~~This feature implements the administrative user interface for configuring Policy-as-Data access control rules. Administrators will be able to define and modify access policies for different resource types without code changes, enabling flexible per-organization customization of access rules.~~

~~This is a **dependent implementation** that requires the core infrastructure from the Multi-Role Authorization architecture (see `multi-role-authorization-context.md` for architectural decisions).~~

## ~~Prerequisites~~ (OBSOLETE)

~~Before implementing this UI, the following infrastructure must be in place:~~

~~- [ ] `access_policies` table created (from multi-role-authorization)~~
~~- [ ] `access_policy_changes` audit table created~~
~~- [ ] `evaluate_access_policy()` function deployed~~
~~- [ ] API functions for policy CRUD operations~~

## Phase 1: Backend API Foundation

### 1.1 Policy CRUD API Functions
- Create `api.list_access_policies(org_id)` - List policies for an organization
- Create `api.get_access_policy(policy_id)` - Get single policy details
- Create `api.create_access_policy(...)` - Create new policy
- Create `api.update_access_policy(...)` - Modify existing policy
- Create `api.deactivate_access_policy(policy_id)` - Soft delete

### 1.2 Policy Change Audit
- Ensure all changes emit domain events
- Create `api.get_policy_change_history(policy_id)` - Audit trail

### 1.3 Resource Type Discovery
- Create `api.list_resource_types()` - Available resource types for policies
- Create `api.list_permissions_for_resource(resource_type)` - Valid permissions

## Phase 2: Core UI Components

### 2.1 Policy List View
- Data table showing all policies for organization
- Columns: Resource Type, Required Permission, Conditions, Status, Last Modified
- Filter by resource type, status
- Sort by various columns

### 2.2 Policy Form Component
- Form for creating/editing policies
- Resource type selector (dropdown)
- Permission selector (filtered by resource type)
- Condition toggles:
  - Require client assignment (checkbox)
  - Require active shift (checkbox)
  - Require same OU (checkbox)
  - Require scope containment (checkbox)
- Time restriction fields (optional)
- Day of week multi-select (optional)

### 2.3 Policy Detail View
- Read-only view of policy configuration
- Change history timeline
- "Edit" and "Deactivate" actions

## Phase 3: MVVM Implementation

### 3.1 PolicyListViewModel
- Observable collection of policies
- Loading/error states
- Filter and sort state
- CRUD actions

### 3.2 PolicyFormViewModel
- Form state management
- Validation logic
- Submit handling
- Resource type → permission cascading

### 3.3 PolicyDetailViewModel
- Single policy state
- Change history loading
- Action handlers

## Phase 4: Route Integration

### 4.1 Policy Management Routes
- `/settings/policies` - Policy list
- `/settings/policies/new` - Create policy
- `/settings/policies/:id` - View policy
- `/settings/policies/:id/edit` - Edit policy

### 4.2 Navigation Integration
- Add to settings navigation menu
- Permission gate (requires `access_grant.view` or similar)

## Phase 5: Testing & Validation

### 5.1 Unit Tests
- ViewModel logic tests
- Form validation tests

### 5.2 Integration Tests
- API function tests
- Policy evaluation with UI-configured policies

### 5.3 E2E Tests
- Create policy flow
- Edit policy flow
- Policy affects access (full flow)

## Success Metrics

### Immediate
- [ ] Administrator can view list of access policies
- [ ] Administrator can create a new access policy
- [ ] Policy changes are audited

### Medium-Term
- [ ] Administrator can configure all 6 policy conditions
- [ ] Time-based restrictions work correctly
- [ ] Policy changes take effect immediately

### Long-Term
- [ ] Per-organization policy customization proven in use
- [ ] Audit trail used for compliance reporting
- [ ] No code deployments needed for access policy changes

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Policy misconfiguration locks out users | "Preview" mode before activation, emergency bypass for super_admin |
| Performance impact of policy evaluation | Index optimization, policy caching |
| Audit trail grows unbounded | Retention policy, archive old changes |

## Next Steps After Completion

1. Documentation for administrators on policy configuration
2. Policy templates for common use cases
3. Policy import/export for multi-org deployment
4. Policy effectiveness reporting (analytics)
