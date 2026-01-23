# Context: Policy Management UI

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

## ~~Decision Record~~ (OBSOLETE)

**Date**: 2026-01-21 (OBSOLETE as of 2026-01-22)
**Feature**: ~~Policy Management Admin UI~~
**Goal**: ~~Enable administrators to configure Policy-as-Data access control rules through a web interface without requiring code changes.~~

### ~~Relationship to Parent Architecture~~ (OBSOLETE)

~~This implementation depends on decisions made in:~~
- ~~**Architecture Reference**: `dev/active/multi-role-authorization-context.md`~~
- ~~**Architecture Plan**: `dev/active/multi-role-authorization-plan.md`~~

~~The Policy-as-Data approach was selected as part of the "ReBAC in PostgreSQL" architecture. This UI implements the admin interface for that system.~~

### Key Decisions

1. **MVVM Pattern**: Use existing A4C MVVM pattern with MobX ViewModels for state management
2. **Settings Location**: Policy management under `/settings/policies` route
3. **Permission Required**: `access_grant.view` permission to view, `access_grant.create` to modify
4. **Audit-First**: All policy changes logged with reason field
5. **Org-Scoped by Default**: Policies are per-organization, with optional global defaults

### Why Admin UI vs Code-Based Policies

| Approach | When to Use |
|----------|-------------|
| **Admin UI (this feature)** | Runtime customization, per-org differences, non-developer admins |
| **Code-based RLS** | System-wide invariants, security-critical rules that shouldn't change |

## Technical Context

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FRONTEND                                       │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ PolicyListPage → PolicyListViewModel → PolicyService            ││
│  │ PolicyFormPage → PolicyFormViewModel → PolicyService            ││
│  │ PolicyDetailPage → PolicyDetailViewModel → PolicyService        ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │ Supabase RPC
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       DATABASE                                       │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐  │
│  │   access_policies   │  │    access_policy_changes (audit)    │  │
│  │   - resource_type   │  │    - policy_id                      │  │
│  │   - org_id          │  │    - change_type                    │  │
│  │   - conditions...   │  │    - old_values / new_values        │  │
│  └─────────────────────┘  │    - changed_by, reason             │  │
│                           └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend**: React 19 + TypeScript + MobX
- **UI Components**: Tailwind CSS + existing A4C component library
- **State Management**: MobX ViewModels (MVVM pattern)
- **API**: Supabase RPC functions in `api` schema
- **Forms**: React Hook Form or existing form patterns

### Dependencies

- `access_policies` table (from multi-role-authorization infrastructure)
- `access_policy_changes` audit table
- `permissions_projection` table (for permission dropdown)
- Existing A4C routing and layout components

## File Structure

### New Files to Create

**Frontend Components:**
- `frontend/src/pages/settings/policies/PoliciesListPage.tsx`
- `frontend/src/pages/settings/policies/PolicyFormPage.tsx`
- `frontend/src/pages/settings/policies/PolicyDetailPage.tsx`
- `frontend/src/components/policies/PolicyConditionsForm.tsx`
- `frontend/src/components/policies/PolicyChangeHistory.tsx`

**ViewModels:**
- `frontend/src/viewModels/policies/PolicyListViewModel.ts`
- `frontend/src/viewModels/policies/PolicyFormViewModel.ts`
- `frontend/src/viewModels/policies/PolicyDetailViewModel.ts`

**Services:**
- `frontend/src/services/policies/IPolicyService.ts`
- `frontend/src/services/policies/SupabasePolicyService.ts`
- `frontend/src/services/policies/MockPolicyService.ts`

**Types:**
- `frontend/src/types/policy.types.ts`

**Backend (SQL):**
- `infrastructure/supabase/sql/03-functions/api/0XX-policy-management.sql`

### Existing Files to Modify

- `frontend/src/routes.tsx` - Add policy routes
- `frontend/src/pages/settings/SettingsPage.tsx` - Add nav link
- `frontend/src/services/ServiceRegistry.ts` - Register PolicyService

## Policy Configuration Options

Based on the `access_policies` schema from the architecture:

| Field | UI Component | Description |
|-------|--------------|-------------|
| `resource_type` | Dropdown | What resource this policy applies to |
| `required_permission` | Dropdown (filtered) | Permission needed to access |
| `require_client_assignment` | Checkbox | User must be assigned to client |
| `require_active_shift` | Checkbox | User must be on active shift |
| `require_same_ou` | Checkbox | User must be at same OU as resource |
| `require_scope_containment` | Checkbox | User's scope must contain resource |
| `allowed_time_start` | Time picker | Start of allowed access window |
| `allowed_time_end` | Time picker | End of allowed access window |
| `allowed_days_of_week` | Multi-select | Days when access is allowed |

## Key Patterns and Conventions

### MVVM Pattern (A4C Standard)

```typescript
// ViewModel pattern
class PolicyListViewModel {
  @observable policies: AccessPolicy[] = [];
  @observable isLoading = false;
  @observable error: string | null = null;

  constructor(private policyService: IPolicyService) {
    makeObservable(this);
  }

  @action
  async loadPolicies(): Promise<void> {
    this.isLoading = true;
    try {
      this.policies = await this.policyService.listPolicies();
    } catch (e) {
      this.error = e.message;
    } finally {
      this.isLoading = false;
    }
  }
}
```

### Service Interface Pattern

```typescript
interface IPolicyService {
  listPolicies(): Promise<AccessPolicy[]>;
  getPolicy(id: string): Promise<AccessPolicy>;
  createPolicy(policy: CreatePolicyRequest): Promise<AccessPolicy>;
  updatePolicy(id: string, policy: UpdatePolicyRequest): Promise<AccessPolicy>;
  deactivatePolicy(id: string, reason: string): Promise<void>;
  getPolicyHistory(id: string): Promise<PolicyChange[]>;
}
```

## Important Constraints

1. **Permission Gating**: Only users with appropriate permissions can access policy management
2. **Org Isolation**: Users can only see/modify policies for their organization
3. **Audit Required**: Every change must include a reason (enforced in UI)
4. **No Delete**: Policies are deactivated, not deleted (audit trail preservation)
5. **Validation**: Resource type + org_id must be unique (one policy per resource per org)

## Reference Materials

- **Architecture Decisions**: `dev/active/multi-role-authorization-context.md`
- **Policy Schema Design**: See "Policy-as-Data: Detailed Design" section in architecture context
- **A4C MVVM Patterns**: `frontend/CLAUDE.md`
- **Existing Settings Pages**: `frontend/src/pages/settings/` for UI patterns

## UI Mockup (Conceptual)

### Policy List View
```
┌─────────────────────────────────────────────────────────────────────┐
│ Access Policies                                    [+ Create Policy] │
├─────────────────────────────────────────────────────────────────────┤
│ Filter: [All Resources ▼]  Status: [Active ▼]                       │
├──────────────────┬────────────────┬───────────────┬─────────────────┤
│ Resource Type    │ Permission     │ Conditions    │ Status          │
├──────────────────┼────────────────┼───────────────┼─────────────────┤
│ client_medications│ medication.admin│ Client, Shift │ Active         │
│ incident_reports │ incident.create │ Client        │ Active          │
│ sleep_records    │ sleep.record   │ Same OU       │ Active          │
└──────────────────┴────────────────┴───────────────┴─────────────────┘
```

### Policy Form
```
┌─────────────────────────────────────────────────────────────────────┐
│ Create Access Policy                                                 │
├─────────────────────────────────────────────────────────────────────┤
│ Resource Type: [client_medications ▼]                                │
│ Required Permission: [medication.administration ▼]                   │
│                                                                      │
│ Access Conditions:                                                   │
│ [x] Require client assignment                                        │
│ [x] Require active shift                                             │
│ [ ] Require same OU as resource                                      │
│ [x] Require scope containment                                        │
│                                                                      │
│ Time Restrictions (optional):                                        │
│ From: [06:00] To: [22:00]                                           │
│ Days: [x]Mon [x]Tue [x]Wed [x]Thu [x]Fri [ ]Sat [ ]Sun              │
│                                                                      │
│                               [Cancel] [Save Policy]                 │
└─────────────────────────────────────────────────────────────────────┘
```
