# Tasks: Type-Safe Event Emission Refactor

## Phase 1: Add AsyncAPI Event Types ✅ COMPLETE

### 1.1 Organization Domain ✅
- [x] Add `organization.created` event (OrganizationCreatedData schema)
- [x] Add `organization.activated` event (OrganizationActivatedData schema)
- [x] Add `organization.deactivated` event (OrganizationDeactivatedData schema)
- [x] Add `organization.subdomain.dns_created` event (DNSCreatedData schema)
- [x] Add `organization.subdomain.verified` event (DNSVerifiedData schema)
- [x] Add `organization.dns.removed` event (DNSRemovedData schema)

### 1.2 Invitation Domain ✅
- [x] Add `invitation.email.sent` event (InvitationEmailSentData schema)
- [x] Add `invitation.resent` event (InvitationResentData schema)

### 1.3 Contact Domain ✅
- [x] Add `contact.created` event (ContactCreatedData schema)
- [x] Add `contact.updated` event (ContactUpdatedData schema)
- [x] Add `contact.deleted` event (ContactDeletedData schema)

### 1.4 Address Domain ✅
- [x] Add `address.created` event (AddressCreatedData schema)
- [x] Add `address.updated` event (AddressUpdatedData schema)
- [x] Add `address.deleted` event (AddressDeletedData schema)

### 1.5 Phone Domain ✅
- [x] Add `phone.created` event (PhoneCreatedData schema)
- [x] Add `phone.updated` event (PhoneUpdatedData schema)
- [x] Add `phone.deleted` event (PhoneDeletedData schema)

### 1.6 Email Domain ✅ (NEW)
- [x] Add `email.created` event (EmailCreatedData schema)
- [x] Add `email.updated` event (EmailUpdatedData schema)
- [x] Add `email.deleted` event (EmailDeletedData schema)
- [x] Add `EmailType` enum to enums.yaml

### 1.7 RBAC Domain ✅
- [x] Add `role.created` event (RoleCreatedData schema)
- [x] Add `role.permission.granted` event (RolePermissionGrantedData schema)

### 1.8 Junction Domain ✅
- [x] Create `asyncapi/domains/junction.yaml`
- [x] Add organization junction events (contact, address, phone, email)
- [x] Add contact junction events (phone, address, email)
- [x] Register junction.yaml in main asyncapi.yaml

### 1.9 Bootstrap Input Types ✅
- [x] Add `BootstrapContactInput` with temp_id field
- [x] Add `BootstrapPhoneInput` with temp_id and contact_ref fields
- [x] Add `BootstrapEmailInput` with temp_id and contact_ref fields
- [x] Add `BootstrapAddressInput` with temp_id and contact_ref fields
- [x] Update `OrganizationBootstrapInitiationData` with Bootstrap*Input arrays

## Phase 2: Regenerate and Distribute Types ✅ COMPLETE

- [x] Run `npm run generate:types` in contracts
- [x] Verify no AnonymousSchema in generated output (27 enums, 133 interfaces)
- [x] Add postgenerate script to contracts/package.json
- [x] Copy types to `workflows/src/shared/types/generated/events.ts`
- [x] Copy types to `frontend/src/types/generated/generated-events.ts`
- [x] Update workflows to re-export from `@shared/utils`

## Phase 3: Convert Activities ✅ COMPLETE

### 3.1 Core Activities ✅ COMPLETE
- [x] **Convert `create-organization.ts` to use temp_id → UUID correlation**
  - [x] Build contactIdMap (temp_id → real UUID)
  - [x] Create contacts first, emit contact.created events
  - [x] Create phones with contact_ref resolution
  - [x] Create emails with contact_ref resolution (NEW)
  - [x] Create addresses with contact_ref resolution
  - [x] Emit all junction link events (org↔entity and contact↔entity)
  - [x] Support both legacy and bootstrap modes
- [x] Convert `activate-organization.ts` - Uses `emitOrganizationActivated`
- [x] Convert `deactivate-organization.ts` - Uses existing pattern (schema mismatch with contract)
- [x] Convert `generate-invitations.ts` - Uses existing typed emitter
- [x] Convert `send-invitation-emails.ts` - Uses `emitInvitationEmailSent`

### 3.2 DNS Activities ✅ COMPLETE
- [x] Convert `configure-dns.ts` - Uses `emitSubdomainDnsCreated`
- [x] Convert `verify-dns.ts` - Uses `emitSubdomainVerified`
- [x] Convert `remove-dns.ts` - Uses `emitOrganizationDnsRemoved`

### 3.3 Permission Activities ✅ COMPLETE
- [x] Convert `grant-provider-admin-permissions.ts` - Uses `emitRoleCreated`, `emitRolePermissionGranted`
  - Added 4 fields to RoleCreatedEvent: `display_name`, `organization_id`, `scope`, `is_system_role`
  - Added `RoleScope` enum to enums.yaml
  - Added 12 RBAC events to asyncapi.yaml channels
  - Regenerated types (169 interfaces)

### 3.4 Cleanup/Compensation Activities ✅ COMPLETE
- [x] Convert `revoke-invitations.ts` - Uses existing typed emitter
- [x] Convert `delete-contacts.ts` - Uses `emitContactDeleted`
- [x] Convert `delete-addresses.ts` - Uses `emitAddressDeleted`
- [x] Convert `delete-phones.ts` - Uses `emitPhoneDeleted`
- [x] **Create `delete-emails.ts`** - NEW activity using `emitEmailDeleted`

## Phase 4: Add emitBootstrapFailed Activity ✅ COMPLETE

- [x] Create `workflows/src/activities/organization-bootstrap/emit-bootstrap-failed.ts`
- [x] Import BootstrapFailureStage and OrganizationBootstrapFailureData from @shared/types
- [x] Export emitBootstrapFailed from activities index.ts
- [x] Update workflow.ts catch block with failure stage detection
- [x] Call emitBootstrapFailed before compensation runs

## Phase 5: Build and Validate ✅ COMPLETE (Re-run after Phase 3)

- [x] Run `npm run build` in workflows directory
- [x] Fix any TypeScript compilation errors
- [ ] Port-forward to Temporal cluster (re-test after Phase 3 complete)
- [ ] Trigger organization bootstrap workflow
- [ ] Verify events appear in domain_events table with correct structure
- [ ] Trigger bootstrap failure scenario
- [ ] Verify organization.bootstrap.failed event emitted

## Database Infrastructure ✅ COMPLETE

- [x] Create `20260111111938_email_entity.sql` migration
  - [x] email_type enum
  - [x] emails_projection table
  - [x] organization_emails junction table
  - [x] contact_emails junction table
  - [x] process_email_event() function
  - [x] Updated process_junction_event() for email links
  - [x] Updated process_domain_event() router for 'email' stream_type
  - [x] RLS policies for emails
  - [x] api.get_emails_by_org() RPC function

---

## Success Validation Checkpoints

### Immediate Validation ✅
- [x] All event types have `title` property in AsyncAPI
- [x] Generated types include all new event data interfaces
- [x] No AnonymousSchema_XXX in generated output
- [x] Types successfully imported in workflows

### Feature Complete Validation ✅
- [x] All 15 activities (14 + emit-bootstrap-failed) compile with typed event data
- [x] emitBootstrapFailed activity created
- [x] Workflow catch block calls failure activity
- [x] Build succeeds with no TypeScript errors

### Integration Validation ⏳
- [ ] Bootstrap workflow runs end-to-end with temp_id correlation
- [ ] All events stored with correct event_data structure
- [ ] Email entity events processed correctly
- [ ] Failure scenario emits bootstrap.failed event
- [x] Frontend can import and use generated types

---

## Current Status

**Phase**: 5 - Integration Validation
**Status**: Implementation ✅ COMPLETE, Testing ⏳ PENDING
**Last Updated**: 2026-01-11
**Next Step**: Run integration tests to validate deployed changes

## Remaining Work Summary

### All Implementation Complete ✅
1. ✅ **`create-organization.ts`** - temp_id → UUID correlation with email support
2. ✅ **`delete-emails.ts`** - New compensation activity
3. ✅ **`deactivate-organization.ts`** - Kept existing pattern (schema mismatch)
4. ✅ **`grant-provider-admin-permissions.ts`** - Uses `emitRoleCreated`, `emitRolePermissionGranted`
5. ✅ **Cleanup activities** - Typed emitters for delete-contacts/addresses/phones
6. ✅ **`emitBootstrapFailed`** - Failure tracking activity (Phase 4)
7. ✅ **Workflow catch block** - Emits failure event before compensation

### Remaining: Integration Testing
- [ ] Bootstrap workflow end-to-end test
- [ ] Failure scenario test
- [ ] Event data structure validation

## Notes

- Existing types: `user.invited`, `invitation.revoked` - already have generated types
- Bootstrap failure event schema already exists in organization.yaml
- No backward compatibility needed - can change event structures freely
- RemoveDNSParams doesn't have 'tracing' - compensation activities don't receive tracing params
- Email junction events already existed in junction.yaml when creating the migration
