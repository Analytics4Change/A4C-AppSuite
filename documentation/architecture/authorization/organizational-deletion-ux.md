---
status: aspirational
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: UX specification for zero-regret organization deletion workflows with progressive disclosure, typed confirmations, impact analysis, and role-specific constraints.

**When to read**:
- Designing destructive action UX patterns
- Implementing organization deletion flows
- Understanding progressive disclosure for dangerous operations
- Adding typed confirmation to critical actions

**Prerequisites**: [rbac-architecture.md](rbac-architecture.md) for role-based restrictions

**Key topics**: `deletion-ux`, `progressive-disclosure`, `typed-confirmation`, `safeguards`, `impact-analysis`

**Estimated read time**: 18 minutes
<!-- TL;DR-END -->

# Organizational Deletion UX Specification
> [!WARNING]
> **This feature is not yet implemented.** This document describes planned functionality that has not been built. Implementation timeline and approach are subject to change based on business priorities.


## Document Information

**Version**: 1.0
**Status**: Design Specification
**Last Updated**: 2025-10-21
**Related Docs**:
- Architecture: `.plans/rbac-permissions/architecture.md` (Section B.1)
- Implementation: `.plans/rbac-permissions/implementation-guide.md` (Phase 4.5)

---

## Executive Summary

This document specifies the **zero-regret** user experience design for organizational deletion workflows in the A4C platform. The design implements role-specific constraints, comprehensive impact analysis, and mandatory safeguards to prevent accidental data loss while enabling safe organizational cleanup.

### Design Philosophy

**Prevention Over Permission**: Don't just block destructive actions—guide users to their goals safely.

**Core Principles**:
1. **Progressive Disclosure**: Show impact → Show blockers → Show path forward → Confirm understanding → Execute
2. **Typed Confirmation**: Force cognitive engagement (typing vs clicking)
3. **Alternatives First**: Always suggest reversible options before irreversible ones
4. **Actionable Blockers**: Never just say "you can't"—show exactly why and how to proceed
5. **Risk-Tiered Safeguards**: More safeguards for higher-risk operations

---

## Table of Contents

1. [UX Flow: provider_admin](#ux-flow-provider_admin)
2. [UX Flow: super_admin](#ux-flow-super_admin)
3. [UI Component Specifications](#ui-component-specifications)
4. [Database Support Requirements](#database-support-requirements)
5. [Edge Function Specifications](#edge-function-specifications)
6. [Testing Scenarios](#testing-scenarios)
7. [Accessibility Requirements](#accessibility-requirements)

---

## UX Flow: provider_admin

### Overview

Provider administrators can only delete **empty** organizational units (no roles, no users). The UX must:
- Clearly communicate the emptiness constraint
- Show exactly what's blocking deletion
- Provide actionable cleanup paths
- Offer guided workflows for complex scenarios

### Step 1: User Initiates Deletion

**UI Location**: Organization hierarchy tree view

```
Mental Health Services (OU)
├─ Outpatient Clinic (OU)
│  ├─ Therapist Role (3 users)
│  └─ Intake Coordinator Role (1 user)
└─ Crisis Response (OU)
   └─ Crisis Counselor Role (2 users)

[⋮ Actions] → Delete Organization Unit
```

**User Action**: Clicks "Delete Organization Unit" from context menu

**System Response**: Triggers background impact analysis (< 500ms)

### Step 2: Impact Analysis (Automatic)

**Background Process**:
```javascript
const impact = await analyzeDeleteionImpact(orgPath)
// Returns: {
//   can_delete: false,
//   blockers: { roles: 3, users: 6, child_ous: 2 },
//   cascade_preview: { ous_to_delete: 3, roles_to_delete: 3 }
// }
```

**No UI shown during analysis** (fast enough to feel instant)

### Step 3: Deletion Blocker Dialog

**Modal Dialog** (shown when blockers exist):

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Cannot Delete "Mental Health Services"            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  This organizational unit cannot be deleted because:    │
│                                                         │
│  🔴 3 roles are assigned to this OU or its children     │
│     • Therapist (Outpatient Clinic)                     │
│     • Intake Coordinator (Outpatient Clinic)            │
│     • Crisis Counselor (Crisis Response)                │
│                                                         │
│  👥 6 users are assigned to these roles                 │
│     • Sarah Johnson, Michael Chen, ...                  │
│     [View Full User List]                               │
│                                                         │
│  📊 2 child OUs contain roles or users                  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  What you can do:                                       │
│                                                         │
│  1️⃣ Reassign users to different roles first            │
│     [View Users & Reassign]                             │
│                                                         │
│  2️⃣ Delete or move roles to different OUs              │
│     [Manage Roles]                                      │
│                                                         │
│  3️⃣ Temporarily deactivate instead (reversible)        │
│     [Deactivate This OU]  ℹ️ This is reversible        │
│                                                         │
│  [Cancel]                          [Guide Me Through]   │
└─────────────────────────────────────────────────────────┘
```

**Key UX Decisions**:
- ❌ **No "Delete Anyway" button** (permission denied)
- ✅ **Exact blocker details** with names/counts
- ✅ **Actionable paths forward** (not just "you can't")
- ✅ **Reversible alternative** (deactivate)
- ✅ **Optional guided workflow**

**Component**: `DeletionBlockerDialog`

### Step 4: Guided Cleanup Workflow (Optional)

**If user clicks "Guide Me Through"**:

#### Step 4.1: Reassign Users

```
┌─────────────────────────────────────────────────────────┐
│  Preparing to Delete "Mental Health Services"           │
│  Progress: Step 1 of 3                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Step 1: Reassign 6 Users                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                         │
│  These users need new role assignments:                 │
│                                                         │
│  Sarah Johnson (Therapist)                              │
│  Current: Mental Health → Outpatient Clinic             │
│  ┌─────────────────────────────────────────┐           │
│  │ New Role: [Therapist ▼]                 │           │
│  │ New OU:   [Behavioral Health ▼]         │           │
│  └─────────────────────────────────────────┘           │
│  [Apply to All Therapists]                              │
│                                                         │
│  Michael Chen (Therapist)                               │
│  Current: Mental Health → Outpatient Clinic             │
│  [Use Same Assignment as Sarah ↑]                       │
│                                                         │
│  ... (4 more users)                                     │
│                                                         │
│  [Cancel Deletion]              [Save & Continue (1/3)] │
└─────────────────────────────────────────────────────────┘
```

**Component**: `GuidedCleanupWorkflow` > `UserReassignmentStep`

#### Step 4.2: Manage Roles

```
┌─────────────────────────────────────────────────────────┐
│  Preparing to Delete "Mental Health Services"           │
│  Progress: Step 2 of 3                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Step 2: Handle 3 Roles                                │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                         │
│  Choose what to do with each role:                      │
│                                                         │
│  Therapist (Outpatient Clinic)                          │
│  ◉ Delete role (no users assigned)                      │
│  ○ Move to different OU: [Select OU ▼]                  │
│                                                         │
│  Intake Coordinator (Outpatient Clinic)                 │
│  ◉ Delete role (no users assigned)                      │
│  ○ Move to different OU: [Select OU ▼]                  │
│                                                         │
│  Crisis Counselor (Crisis Response)                     │
│  ◉ Delete role (no users assigned)                      │
│  ○ Move to different OU: [Select OU ▼]                  │
│                                                         │
│  [← Back]                           [Save & Continue (2/3)]│
└─────────────────────────────────────────────────────────┘
```

**Component**: `GuidedCleanupWorkflow` > `RoleManagementStep`

#### Step 4.3: Final Confirmation

```
┌─────────────────────────────────────────────────────────┐
│  Preparing to Delete "Mental Health Services"           │
│  Progress: Step 3 of 3                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Step 3: Confirm Deletion                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                         │
│  ✅ All blockers resolved                               │
│                                                         │
│  Summary of changes:                                    │
│  • 6 users reassigned to other roles                    │
│  • 3 roles deleted                                      │
│  • 3 organizational units will be deleted               │
│                                                         │
│  This organizational structure will be removed:         │
│  📁 Mental Health Services                              │
│     ├─ Outpatient Clinic                                │
│     └─ Crisis Response                                  │
│                                                         │
│  ⚠️  This action cannot be undone.                      │
│                                                         │
│  To confirm, type the OU name:                          │
│  ┌─────────────────────────────────────────┐           │
│  │                                         │           │
│  └─────────────────────────────────────────┘           │
│  Expected: Mental Health Services                       │
│                                                         │
│  [← Back]      [Cancel]      [Delete Organization] (disabled)│
│                               (enabled when name matches)  │
└─────────────────────────────────────────────────────────┘
```

**Component**: `GuidedCleanupWorkflow` > `FinalConfirmationStep`

### Step 5: Empty OU Deletion (Direct Path)

**If OU is already empty**, skip guided workflow and show final confirmation:

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Confirm Deletion                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  You are about to permanently delete:                   │
│                                                         │
│  📁 Empty Program Wing                                  │
│     ├─ Room A (empty)                                   │
│     └─ Room B (empty)                                   │
│                                                         │
│  ✅ No roles will be affected                           │
│  ✅ No users will be affected                           │
│  ⚠️  This organizational structure will be removed      │
│                                                         │
│  This action cannot be undone.                          │
│                                                         │
│  To confirm, type the OU name:                          │
│  ┌─────────────────────────────────────────┐           │
│  │                                         │           │
│  └─────────────────────────────────────────┘           │
│  Expected: Empty Program Wing                           │
│                                                         │
│  [Cancel]                          [Delete Organization]│
│                                     (disabled until     │
│                                      name matches)      │
└─────────────────────────────────────────────────────────┘
```

**Component**: `DeletionConfirmationDialog` (risk_level: 'LOW')

---

## UX Flow: super_admin

### Overview

Super administrators have **unrestricted** deletion capability but face stronger safeguards for large deletions:
- Risk-tiered confirmation flows (LOW/MEDIUM/CRITICAL)
- MFA requirement for CRITICAL deletions
- Detailed impact reports
- Export options before deletion

### Step 1: Impact Analysis with Risk Scoring

**System analyzes subtree** (same as provider_admin but no access restrictions):

```javascript
{
  target_ou: "Acme Healthcare",
  can_delete: true,  // super_admin unrestricted
  risk_level: "CRITICAL",  // Based on content
  cascade_preview: {
    ous_to_delete: 47,
    roles_to_delete: 23,
    users_affected: 156,
    clients_affected: 1249,
    medication_records: 8473,
    last_activity: "2 hours ago"  // Recently active
  }
}
```

### Step 2A: LOW RISK Deletion (Empty OU)

**Same as provider_admin flow** (typed confirmation only)

### Step 2B: MEDIUM RISK Deletion (< 10 OUs, < 50 users)

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Delete "Regional Office East" — Impact Review      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  You have permission to delete this organization, but   │
│  please review the impact:                              │
│                                                         │
│  📊 What will be deleted:                               │
│  • 5 organizational units                               │
│  • 8 roles (clinician, specialist, admin, ...)          │
│  • 24 user role assignments                             │
│                                                         │
│  👥 Affected Users:                                     │
│  • 24 users will lose access to this organization       │
│    [View Full List]                                     │
│                                                         │
│  📁 Associated Data:                                    │
│  • 342 client records                                   │
│  • 1,847 medication records                             │
│  • Last activity: 3 days ago                            │
│                                                         │
│  ⚠️  This data will be marked as deleted (soft delete)  │
│      but preserved for audit/compliance.                │
│                                                         │
│  Consider these alternatives:                           │
│  🔄 Deactivate instead (reversible)                     │
│     [Deactivate Organization]                           │
│                                                         │
│  📤 Export data before deletion                         │
│     [Export to CSV] [Export to PDF]                     │
│                                                         │
│  To proceed with deletion, type: DELETE REGIONAL OFFICE │
│  ┌─────────────────────────────────────────┐           │
│  │                                         │           │
│  └─────────────────────────────────────────┘           │
│                                                         │
│  [Cancel]                            [Delete] (disabled)│
└─────────────────────────────────────────────────────────┘
```

**Component**: `DeletionConfirmationDialog` (risk_level: 'MEDIUM')

### Step 2C: CRITICAL RISK Deletion (> 10 OUs OR > 50 users OR recent activity)

```
┌─────────────────────────────────────────────────────────┐
│  🔴 CRITICAL: Delete "Acme Healthcare" — MFA Required   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ⚠️  THIS IS A LARGE-SCALE DELETION OPERATION           │
│                                                         │
│  Impact Summary:                                        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  🏢 47 organizational units                             │
│  👔 23 roles                                            │
│  👥 156 users affected                                  │
│  🧑‍⚕️ 1,249 client records                              │
│  💊 8,473 medication records                            │
│  📅 Last activity: 2 hours ago (ACTIVELY USED)          │
│                                                         │
│  [📊 View Detailed Impact Report]                       │
│                                                         │
│  ⚠️  Recommended: Deactivate Instead                    │
│  Deactivation is reversible and preserves all data      │
│  while preventing new access.                           │
│                                                         │
│  [Deactivate Instead] ← Recommended                     │
│                                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  To proceed with PERMANENT deletion:                    │
│                                                         │
│  1️⃣ Export data for compliance (recommended)           │
│     [Export Full Dataset] [Export Audit Log]            │
│                                                         │
│  2️⃣ Multi-Factor Authentication Required               │
│     [Trigger MFA Challenge]                             │
│                                                         │
│  3️⃣ Type organization name: Acme Healthcare            │
│     ┌─────────────────────────────────────┐            │
│     │                                     │            │
│     └─────────────────────────────────────┘            │
│                                                         │
│  4️⃣ Type DELETE to confirm (after MFA)                 │
│     ┌─────────────────────────────────────┐            │
│     │                                     │            │
│     └─────────────────────────────────────┘            │
│                                                         │
│  [Cancel]              [Delete Organization] (disabled) │
│                         (enabled after MFA + typing)    │
└─────────────────────────────────────────────────────────┘
```

**Component**: `DeletionConfirmationDialog` (risk_level: 'CRITICAL')

### Step 3: Detailed Impact Report (Expandable)

**When super_admin clicks "View Detailed Impact Report"**:

```
┌─────────────────────────────────────────────────────────┐
│  Deletion Impact Report: Acme Healthcare                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Organizational Structure (47 units):                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Acme Healthcare (Root)                                 │
│  ├─ Regional Office East (5 children)                   │
│  │  ├─ Metro Clinic North (12 users)                    │
│  │  ├─ Metro Clinic South (8 users)                     │
│  │  ├─ Suburban Clinic A (15 users)                     │
│  │  └─ ... (2 more)                                     │
│  ├─ Regional Office West (8 children)                   │
│  │  └─ ... (8 facilities)                               │
│  └─ Central Administration (3 children)                 │
│     └─ ... (3 departments)                              │
│                                                         │
│  Roles Being Deleted (23):                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  • clinician (67 users assigned)                        │
│  • specialist (23 users assigned)                       │
│  • administrator (18 users assigned)                    │
│  • intake_coordinator (12 users assigned)               │
│  • ... (19 more roles)                                  │
│                                                         │
│  Users Losing Access (156):                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  [📥 Download User List CSV]                            │
│                                                         │
│  Data Impact:                                           │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  • 1,249 client records → soft deleted                  │
│  • 8,473 medication records → soft deleted              │
│  • Audit logs preserved (compliance requirement)        │
│                                                         │
│  Activity Timeline:                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  • 2 hours ago: Medication updated (Metro North)        │
│  • 5 hours ago: Client intake (Suburban A)              │
│  • Yesterday: 47 active sessions                        │
│                                                         │
│  ⚠️  This organization is ACTIVELY USED                 │
│                                                         │
│  [Close Report]                                         │
└─────────────────────────────────────────────────────────┘
```

**Component**: `DetailedImpactReport`

---

## UI Component Specifications

### 1. DeletionBlockerDialog

**Purpose**: Inform provider_admin about deletion blockers and provide action paths

**Props**:
```typescript
interface DeletionBlockerDialogProps {
  orgName: string;
  orgPath: string;
  blockers: {
    roles: number;
    users: number;
    childOusWithContent: number;
  };
  roleDetails: Array<{
    name: string;
    ouPath: string;
    userCount: number;
  }>;
  userSummary: Array<{
    name: string;
    role: string;
  }>;
  onCancel: () => void;
  onGuidedWorkflow: () => void;
  onDeactivate: () => void;
  onViewUsers: () => void;
  onManageRoles: () => void;
}
```

**Behavior**:
- ❌ Modal (blocks interaction with rest of UI)
- ✅ Escape key closes dialog
- ✅ Click outside closes dialog
- ✅ All action buttons clearly labeled
- ✅ "Deactivate" button visually distinct (success/green color)

**Accessibility**:
- `role="alertdialog"`
- `aria-labelledby` points to dialog title
- Focus trap within dialog
- Focus initially on "Cancel" button (safe default)

### 2. DeletionConfirmationDialog

**Purpose**: Final confirmation with typed input for cognitive engagement

**Props**:
```typescript
interface DeletionConfirmationDialogProps {
  orgName: string;
  orgPath: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'CRITICAL';
  impact: {
    ous_to_delete: number;
    roles_to_delete: number;
    users_affected: number;
    clients_affected: number;
    last_activity: string;
  };
  requiresMfa: boolean;
  onCancel: () => void;
  onDelete: () => Promise<void>;
  onDeactivate: () => void;
  onExport: (format: 'csv' | 'pdf') => void;
  onViewDetailedReport: () => void;
}
```

**Behavior**:
- ❌ Modal (blocks interaction)
- ✅ "Delete" button disabled until typed confirmation matches
- ✅ Real-time validation of typed input
- ✅ For CRITICAL: MFA challenge required before typed confirmation enabled
- ✅ Visual feedback on MFA completion
- ✅ Loading state while deletion executes

**TypedConfirmationInput Component**:
```typescript
interface TypedConfirmationInputProps {
  expectedText: string;
  label: string;
  onMatch: (matched: boolean) => void;
  disabled?: boolean;
}
```

**Validation**:
- Case-insensitive matching
- Trim whitespace
- Show expected text below input
- Visual indicator (checkmark) when match

**Accessibility**:
- `role="alertdialog"`
- `aria-required="true"` on text inputs
- Clear error messages via `aria-describedby`
- Screen reader announcement when match achieved

### 3. GuidedCleanupWorkflow

**Purpose**: Multi-step wizard for cleaning up blockers before deletion

**Props**:
```typescript
interface GuidedCleanupWorkflowProps {
  orgName: string;
  orgPath: string;
  blockers: {
    users: Array<UserAssignment>;
    roles: Array<RoleDetails>;
  };
  onCancel: () => void;
  onComplete: () => void;
}

interface UserAssignment {
  userId: string;
  userName: string;
  currentRole: string;
  currentOu: string;
}

interface RoleDetails {
  roleId: string;
  roleName: string;
  ouPath: string;
  userCount: number;
}
```

**Steps**:
1. User reassignment (if users exist)
2. Role management (if roles exist)
3. Final confirmation

**Behavior**:
- ✅ Progress indicator at top (Step X of Y)
- ✅ "Back" button on steps 2+
- ✅ "Cancel Deletion" always visible (aborts entire workflow)
- ✅ Form validation before "Continue"
- ✅ Optimistic UI updates (show changes immediately)
- ✅ Background persistence (auto-save progress)

**Accessibility**:
- `role="dialog"`
- `aria-labelledby` points to "Preparing to Delete {name}"
- Step numbers announced to screen readers
- Progress indicator accessible via `aria-valuenow`

### 4. DetailedImpactReport

**Purpose**: Comprehensive breakdown for super_admin of deletion impact

**Props**:
```typescript
interface DetailedImpactReportProps {
  orgPath: string;
  organizationalStructure: OrgTreeNode;
  roles: Array<RoleImpact>;
  users: Array<UserImpact>;
  dataImpact: {
    clients: number;
    medications: number;
  };
  activityTimeline: Array<ActivityEvent>;
  onClose: () => void;
  onDownloadUserList: () => void;
}
```

**Behavior**:
- ✅ Scrollable content (large datasets)
- ✅ Expandable tree view for org structure
- ✅ CSV download for user list
- ✅ Activity timeline with timestamps
- ✅ Visual indicators for "actively used" warning

**Accessibility**:
- `role="dialog"`
- Expandable tree with proper ARIA tree roles
- Downloadable reports have descriptive file names

### 5. DeletionImpactAnalyzer (Background Service)

**Purpose**: Fetch and process deletion impact data

**Interface**:
```typescript
class DeletionImpactAnalyzer {
  async analyze(orgPath: string): Promise<DeletionImpact> {
    // Calls edge function: validate-organization-deletion
    // Returns impact data, blockers, and allowed actions
  }

  async refreshAfterChange(orgPath: string): Promise<DeletionImpact> {
    // Re-analyze after user makes changes (e.g., reassigns users)
    // Update UI to reflect new state
  }
}

interface DeletionImpact {
  can_delete: boolean;
  must_cleanup: boolean;
  requires_mfa: boolean;
  risk_level: 'LOW' | 'MEDIUM' | 'CRITICAL';
  impact: {
    ous_to_delete: number;
    roles_to_delete: number;
    users_affected: number;
    clients_affected: number;
    last_activity: string | null;
  };
  blockers: {
    roles: number;
    users: number;
    message?: string;
  } | null;
  alternatives: Array<'deactivate' | 'export'>;
}
```

---

## Database Support Requirements

### Function: get_deletion_impact(target_path LTREE)

**Purpose**: Analyze deletion impact for a given organizational path

**Returns**: JSONB object with impact metrics

**Implementation**: See `implementation-guide.md` Phase 4.5 Step 1

**Performance**:
- Target: < 500ms for typical hierarchies (< 100 OUs)
- Index requirements:
  - `organizations_projection.path` (btree + gist)
  - `roles_projection.org_hierarchy_scope` (btree + gist)
  - `user_roles_projection.scope_path` (btree + gist)

**Caching**: Consider caching for super_admin browsing (5-minute TTL)

### Function: is_organization_empty(target_path LTREE)

**Purpose**: Simple boolean check for provider_admin permission validation

**Returns**: BOOLEAN

**Implementation**:
```sql
CREATE OR REPLACE FUNCTION is_organization_empty(target_path LTREE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM roles_projection
    WHERE org_hierarchy_scope <@ target_path AND deleted_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM user_roles_projection urp
    JOIN roles_projection r ON urp.role_id = r.id
    WHERE urp.scope_path <@ target_path AND r.deleted_at IS NULL
  );
$$;
```

---

## Edge Function Specifications

### Function: validate-organization-deletion

**Purpose**: Validate deletion request and return impact analysis

**Endpoint**: `POST /functions/v1/validate-organization-deletion`

**Request**:
```typescript
{
  userId: string;      // User requesting deletion
  orgPath: string;     // ltree path of target OU
}
```

**Response**:
```typescript
{
  can_delete: boolean;
  must_cleanup: boolean;
  requires_mfa: boolean;
  impact: {
    ous_to_delete: number;
    roles_to_delete: number;
    users_affected: number;
    clients_affected: number;
    last_activity: string | null;
  };
  blockers: {
    roles: number;
    users: number;
    message: string;
  } | null;
  alternatives: Array<'deactivate' | 'export'>;
  risk_level: 'LOW' | 'MEDIUM' | 'CRITICAL';
}
```

**Implementation**: See `implementation-guide.md` Phase 4.5 Step 2

**Authentication**: Service role key (not anon key)

**Rate Limiting**: 10 requests/minute per user

---

## Testing Scenarios

### Scenario 1: provider_admin - Empty OU (Happy Path)

**Given**: Provider admin attempts to delete an empty OU

**When**: User clicks "Delete Organization Unit"

**Then**:
1. Impact analysis shows `can_delete: true`, `is_empty: true`
2. Simple confirmation dialog shown (LOW risk)
3. User types OU name to confirm
4. Deletion executes successfully
5. Success notification shown
6. Tree view updates to remove OU

**Acceptance Criteria**:
- ✅ No guided workflow (OU already empty)
- ✅ Typed confirmation required
- ✅ Success within 2 seconds of typing match

### Scenario 2: provider_admin - OU with Roles (Blocker)

**Given**: Provider admin attempts to delete OU with 3 roles, 12 users

**When**: User clicks "Delete Organization Unit"

**Then**:
1. Impact analysis shows `can_delete: false`, `blockers: {roles: 3, users: 12}`
2. Blocker dialog shown with exact details
3. User sees actionable paths (reassign, manage roles, deactivate)
4. User clicks "Guide Me Through"
5. Multi-step wizard shown
6. After cleanup, deletion succeeds

**Acceptance Criteria**:
- ✅ Blocker dialog shows all 3 roles with names
- ✅ Blocker dialog shows user count per role
- ✅ Guided workflow accessible
- ✅ Real-time blocker updates as user progresses

### Scenario 3: provider_admin - Attempting to Delete Non-Empty OU Without Cleanup

**Given**: Provider admin attempts to delete OU with blockers

**When**: User clicks "Delete Organization Unit"

**Then**:
1. Blocker dialog shown
2. User clicks "Cancel"
3. No changes made
4. Dialog closes

**Acceptance Criteria**:
- ✅ No delete button available (permission denied)
- ✅ Clear communication about blockers
- ✅ No accidental deletion possible

### Scenario 4: super_admin - CRITICAL Deletion (Large Org)

**Given**: Super admin attempts to delete org with 47 OUs, 156 users

**When**: User clicks "Delete Organization Unit"

**Then**:
1. Impact analysis shows `risk_level: 'CRITICAL'`, `requires_mfa: true`
2. CRITICAL confirmation dialog shown
3. User must:
   a. Optionally view detailed report
   b. Trigger MFA challenge
   c. Complete MFA
   d. Type organization name
   e. Type "DELETE"
4. All fields validated before deletion enabled
5. Deletion executes with audit logging

**Acceptance Criteria**:
- ✅ MFA required
- ✅ Dual typed confirmation (org name + "DELETE")
- ✅ Recommended alternatives shown prominently
- ✅ Export option available
- ✅ Detailed impact report accessible

### Scenario 5: super_admin - MEDIUM Deletion with Deactivate Alternative

**Given**: Super admin attempts to delete org with 5 OUs, 24 users

**When**: User clicks "Delete Organization Unit"

**Then**:
1. Impact analysis shows `risk_level: 'MEDIUM'`
2. MEDIUM confirmation dialog shown
3. User sees "Deactivate Instead" option prominently
4. User clicks "Deactivate Organization"
5. Deactivation succeeds (reversible)
6. Success message with undo option

**Acceptance Criteria**:
- ✅ Deactivate option visible and easy to click
- ✅ Deactivate described as "reversible"
- ✅ No MFA required for deactivation
- ✅ Undo option available for 30 days

---

## Accessibility Requirements

### Keyboard Navigation

**All dialogs**:
- `Tab` / `Shift+Tab`: Navigate between interactive elements
- `Escape`: Close dialog (same as Cancel)
- `Enter`: Activate focused button (except when typing in text inputs)

**Guided workflow**:
- `Tab` navigates through form fields in logical order
- `Arrow keys` navigate radio button groups
- `Space` selects/deselects checkboxes

### Screen Reader Support

**All dialogs**:
- Proper ARIA roles (`alertdialog`, `dialog`)
- `aria-labelledby` points to dialog title
- `aria-describedby` points to main content

**Dynamic updates**:
- Blocker resolution announcements via `aria-live="polite"`
- Error messages via `aria-live="assertive"`
- Progress updates announced automatically

**Button labels**:
- "Delete Organization Unit for Mental Health Services"
- "Cancel deletion of Mental Health Services"
- "View full list of 24 affected users"

### Visual Design

**Color contrast**:
- All text: minimum 4.5:1 contrast ratio
- Warning icons (⚠️): minimum 3:1 contrast ratio
- Error state: not conveyed by color alone (icons + text)

**Focus indicators**:
- Visible focus ring on all interactive elements
- Minimum 2px solid border
- High contrast color (not relying on color alone)

**Text sizing**:
- Minimum 16px for body text
- Minimum 14px for labels
- Support browser zoom up to 200%

---

## Implementation Checklist

### Backend
- [ ] `get_deletion_impact()` SQL function deployed
- [ ] `is_organization_empty()` SQL function deployed
- [ ] Edge function `validate-organization-deletion` deployed
- [ ] Proper indexes on ltree columns
- [ ] Rate limiting configured

### Frontend Components
- [ ] `DeletionBlockerDialog` component
- [ ] `DeletionConfirmationDialog` component (all risk levels)
- [ ] `GuidedCleanupWorkflow` component
- [ ] `DetailedImpactReport` component
- [ ] `TypedConfirmationInput` component
- [ ] `DeletionImpactAnalyzer` service

### Integration
- [ ] MFA integration for CRITICAL deletions
- [ ] Export functionality (CSV, PDF)
- [ ] Real-time blocker updates
- [ ] Audit logging on all deletions
- [ ] Success/error notifications
- [ ] Tree view refresh after deletion

### Testing
- [ ] Unit tests for all components
- [ ] Integration tests for deletion flows
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Keyboard navigation testing
- [ ] Screen reader testing (NVDA, JAWS, VoiceOver)
- [ ] Performance testing (< 500ms impact analysis)
- [ ] Load testing (concurrent deletions)

### Documentation
- [ ] User guide for provider_admin deletion
- [ ] User guide for super_admin deletion
- [ ] Troubleshooting guide
- [ ] Training materials
- [ ] Release notes

---

## Appendix: Risk Level Determination Logic

```typescript
function determineRiskLevel(impact: DeletionImpact): RiskLevel {
  const { ous_to_delete, users_affected, last_activity } = impact;

  // CRITICAL: Large scale OR recent activity
  if (
    ous_to_delete > 20 ||
    users_affected > 50 ||
    (last_activity && isWithinHours(last_activity, 24))
  ) {
    return 'CRITICAL';
  }

  // MEDIUM: Moderate scale
  if (ous_to_delete > 5 || users_affected > 10) {
    return 'MEDIUM';
  }

  // LOW: Small scale, no users
  return 'LOW';
}

function isWithinHours(timestamp: string, hours: number): boolean {
  const activityTime = new Date(timestamp);
  const now = new Date();
  const diffHours = (now.getTime() - activityTime.getTime()) / (1000 * 60 * 60);
  return diffHours <= hours;
}
```

---

**Document Version**: 1.0
**Last Updated**: 2025-10-21
**Status**: Design Specification
**Next Review**: After Phase B Implementation
