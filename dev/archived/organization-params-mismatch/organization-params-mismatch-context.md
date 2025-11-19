# Context: OrganizationBootstrapParams Structural Mismatch

**Date**: 2025-11-18
**Status**: COMPLETE
**Priority**: HIGH - Blocks organization creation workflow
**Related**: organization-form-styling work (completed)

## Problem Description

There was a **structural mismatch** between what the frontend sends and what the Temporal workflow expects for organization bootstrap parameters.

### Issues Fixed

1. **Structural mismatch**: Arrays (contacts, addresses, phones) were at root level, needed to be nested inside `orgData`
2. **Type enum mismatch**: Frontend used `'provider_partner'`, workflow expected `'partner'`
3. **Missing `users` array**: Workflow required users array for invitations
4. **CQRS violation**: `revokeInvitations` activity directly updated projection instead of emitting events

## Implementation Summary

### Files Modified

1. **`frontend/src/types/organization.types.ts`**
   - Restructured `OrganizationBootstrapParams` interface
   - Nested contacts/addresses/phones inside `orgData`
   - Added `users` array at root level
   - Changed type to `'provider' | 'partner'`

2. **`frontend/src/viewModels/organization/OrganizationFormViewModel.ts`**
   - Updated `transformToWorkflowParams()` method
   - Builds arrays inside `orgData`
   - Maps `'provider_partner'` to `'partner'`
   - Builds `users` array from provider admin contact
   - Updated logging to use new structure

3. **`frontend/src/services/workflow/MockWorkflowClient.ts`**
   - Updated `generateMockResult()` to access `params.orgData.contacts`
   - Uses `params.users.length` for invitation count

4. **`workflows/src/activities/organization-bootstrap/revoke-invitations.ts`**
   - Removed direct UPDATE to projection (CQRS violation)
   - Now emits `InvitationRevoked` events for each invitation
   - Trigger handles projection update

5. **`infrastructure/supabase/sql/04-triggers/process_invitation_revoked.sql`** (NEW)
   - Created trigger to process `InvitationRevoked` events
   - Updates `invitations_projection` status to 'deleted'
   - Idempotent (only updates pending invitations)

### Correct Parameter Structure

```typescript
export interface OrganizationBootstrapParams {
  subdomain?: string;

  orgData: {
    name: string;
    type: 'provider' | 'partner';
    parentOrgId?: string;
    contacts: ContactInfo[];
    addresses: AddressInfo[];
    phones: PhoneInfo[];
    partnerType?: 'var' | 'family' | 'court' | 'other';
    referringPartnerId?: string;
  };

  users: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  }>;

  retryConfig?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
  };
}
```

### CQRS Compliance

The `revokeInvitations` activity now follows proper CQRS pattern:

```typescript
// Activity emits event
await emitEvent({
  event_type: 'InvitationRevoked',
  aggregate_type: 'invitation',
  aggregate_id: invitation.invitation_id,
  event_data: {
    org_id: params.orgId,
    invitation_id: invitation.invitation_id,
    email: invitation.email,
    revoked_at: revokedAt,
    reason: 'workflow_failure'
  },
  tags
});

// Trigger updates projection
CREATE TRIGGER process_invitation_revoked_event
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.event_type = 'InvitationRevoked')
EXECUTE FUNCTION process_invitation_revoked_event();
```

## Verification

- [x] Frontend TypeScript builds successfully
- [x] `transformToWorkflowParams()` builds correct structure
- [x] Type mapping works (`'provider_partner'` -> `'partner'`)
- [x] `users` array built from provider admin contact
- [x] CQRS violation fixed (events instead of direct UPDATE)
- [x] Trigger created for `InvitationRevoked` events

## Remaining Work

- [x] Run TypeScript type checks (frontend + workflows) - ✅ 2025-11-18
- [x] Run tests on changed code - ✅ 2025-11-18 (workflows pass, frontend has pre-existing test issues)
- [x] Create AsyncAPI contract for `UserInvited` and `InvitationRevoked` events - ✅ 2025-11-18 (already existed)
- [x] Deploy trigger to Supabase - ✅ 2025-11-18

## Completion Summary - 2025-11-18

All tasks completed successfully:
- TypeScript compiles for both frontend and workflows
- Workflow tests pass (activity + integration tests)
- Frontend tests have pre-existing ViewModel failures (not related to this work)
- AsyncAPI contracts already documented `UserInvited` and `InvitationRevoked` with full schemas
- Trigger `process_invitation_revoked_event` deployed to Supabase production

**Organization creation workflow is now ready for end-to-end testing.**

## Notes

- This fix ensures frontend params match workflow contract exactly
- Saga compensation now properly uses event-driven pattern
- All state changes emit domain events (CQRS compliance)
