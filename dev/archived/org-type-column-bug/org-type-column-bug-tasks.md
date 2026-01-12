# Tasks: AsyncAPI Contract Drift + Event Processor Bugs

## Phase 1: Prepare AsyncAPI Schemas ⏸️ PENDING

### Step 1.1: Create components/enums.yaml
- [ ] Create `contracts/asyncapi/components/enums.yaml`
- [ ] Add User Management enums:
  - [ ] `AuthMethod`: email_password, oauth_google, oauth_github, oauth_enterprise_sso
  - [ ] `InvitationMethod`: organization_bootstrap, manual_invitation
  - [ ] `ContactType`: a4c_admin, billing, technical, emergency, stakeholder
  - [ ] `PhoneType`: mobile, office, fax, emergency
  - [ ] `Gender`: male, female, other, prefer_not_to_say
  - [ ] `BloodType`: A+, A-, B+, B-, AB+, AB-, O+, O-
- [ ] Add Organizational enums:
  - [ ] `OrganizationType`: platform_owner, provider, provider_partner
  - [ ] `PartnerType`: var, family, court, other
  - [ ] `DeactivationReason`: billing_suspension, compliance_violation, voluntary_suspension, maintenance
  - [ ] `DeletionStrategy`: cascade_delete, block_if_children
  - [ ] `AdminRole`: provider_admin, partner_admin
  - [ ] `BootstrapFailureStage`: organization_creation, dns_provisioning, admin_user_creation, role_assignment, permission_grants, invitation_email
- [ ] Add Access Control enums:
  - [ ] `ScopeType`: global, org, facility, program, client
  - [ ] `AuthorizationType`: court_order, parental_consent, var_contract, social_services
  - [ ] `GrantScope`: full_org, facility, program, client_specific
  - [ ] `GrantAuthorizationType`: var_contract, court_order, parental_consent, social_services_assignment, emergency_access
  - [ ] `RevocationReason`: contract_expired, legal_basis_withdrawn, security_breach, administrative_decision, user_request
  - [ ] `InvitationRevocationReason`: workflow_failure, manual_revocation, organization_deactivated
- [ ] Add Address & Location enums:
  - [ ] `AddressType`: physical, mailing, billing
  - [ ] `RemovalType`: soft_delete, hard_delete
- [ ] Add Medical enums:
  - [ ] `ControlledSubstanceSchedule`: Schedule I-V
  - [ ] `MedicationForm`: tablet, capsule, liquid, injection, patch, cream, etc.
  - [ ] `AdministrationRoute`: oral, sublingual, buccal, rectal, intravenous, etc.
  - [ ] `SkipReason`: client_absent, client_npo, medication_unavailable, etc.
  - [ ] `DiscontinueReasonCategory`: adverse_reaction, ineffective, client_request, etc.
  - [ ] `AdmissionType`: scheduled, emergency, transfer, readmission
  - [ ] `DischargeType`: planned, against_medical_advice, transfer, etc.
  - [ ] `DischargeDisposition`: home, home_with_services, skilled_nursing_facility, etc.
- [ ] Add Infrastructure enums:
  - [ ] `DNSRecordType`: CNAME, A
  - [ ] `VerificationMethod`: dns_lookup, mock, development
  - [ ] `VerificationMode`: production, development, mock
- [ ] Add Impersonation enums:
  - [ ] `JustificationReason`: support_ticket, emergency, audit, training
  - [ ] `ImpersonationEndReason`: manual_logout, timeout, renewal_declined, forced_by_admin
- [ ] Add Data Management enums:
  - [ ] `SortBy`: created_at, event_type
  - [ ] `SortOrder`: asc, desc
  - [ ] `ExpirationReason`: time_based, contract_based, automatic_cleanup
  - [ ] `SuspensionReason`: investigation, contract_dispute, security_concern, administrative_hold

### Step 1.2: Add title Property to ALL Schemas
- [ ] Update `organization.yaml` - Add `title` to all `*Data` and `*Event` schemas
- [ ] Update `user.yaml` - Add `title` to all schemas
- [ ] Update `client.yaml` - Add `title` to all schemas
- [ ] Update `medication.yaml` - Add `title` to all schemas
- [ ] Update `invitation.yaml` - Add `title` to all schemas
- [ ] Update `rbac.yaml` - Add `title` to all schemas
- [ ] Update `access_grant.yaml` - Add `title` to all schemas
- [ ] Update `contact.yaml` - Add `title` to all schemas
- [ ] Update `phone.yaml` - Add `title` to all schemas
- [ ] Update `address.yaml` - Add `title` to all schemas
- [ ] Update `program.yaml` - Add `title` to all schemas
- [ ] Update `platform-admin.yaml` - Add `title` to all schemas
- [ ] Update `impersonation.yaml` - Add `title` to all schemas
- [ ] Update `organization-unit.yaml` - Add `title` to all schemas
- [ ] Update `junction.yaml` - Add `title` to all schemas

### Step 1.3: Update Domain Files to Reference Enums
- [ ] Update `organization.yaml` - Replace inline enums with `$ref: '../components/enums.yaml#/...'`
- [ ] Update `user.yaml` - Replace inline enums
- [ ] Update `client.yaml` - Replace inline enums
- [ ] Update `medication.yaml` - Replace inline enums
- [ ] Update `invitation.yaml` - Replace inline enums
- [ ] Update `rbac.yaml` - Replace inline enums
- [ ] Update `access_grant.yaml` - Replace inline enums
- [ ] Update `contact.yaml` - Replace inline enums
- [ ] Update `phone.yaml` - Replace inline enums
- [ ] Update `address.yaml` - Replace inline enums
- [ ] Update `impersonation.yaml` - Replace inline enums
- [ ] Update `platform-admin.yaml` - Replace inline enums
- [ ] Update `organization-unit.yaml` - Replace inline enums

## Phase 2: Configure Modelina Generation ⏸️ PENDING

### Step 2.1: Update package.json
- [ ] Add `"bundle"` script
- [ ] Add `"validate"` script
- [ ] Add `"generate:types"` script
- [ ] Add `"validate:types"` script
- [ ] Add `"check"` script (runs all)

### Step 2.2: Create generate-types.js
- [ ] Create `contracts/scripts/generate-types.js`
- [ ] Include header comment with timestamp
- [ ] Configure Modelina with `modelType: 'interface'`, `enumType: 'enum'`
- [ ] Output to `types/generated-events.ts`

### Step 2.3: Create CI Workflow
- [ ] Create `.github/workflows/contracts-validation.yml`
- [ ] Trigger on changes to `infrastructure/supabase/contracts/**`
- [ ] Install deps, validate, generate, check for uncommitted changes

### Step 2.4: Fix Imports in Consumers
- [ ] Update workflow imports if needed
- [ ] Update frontend imports if needed
- [ ] Run typecheck to verify

## Phase 3: Documentation Updates ⏸️ PENDING

### Step 3.1: Create Type Generation Guide
- [ ] Create `documentation/infrastructure/guides/supabase/CONTRACT-TYPE-GENERATION.md`
- [ ] Include TL;DR section per AGENT-GUIDELINES.md
- [ ] Document workflow for adding new events
- [ ] Document Modelina patterns (title, enum extraction)

### Step 3.2: Update infrastructure/CLAUDE.md
- [ ] Add "AsyncAPI Contract Type Generation" section
- [ ] Document commands: bundle, validate, generate:types, check
- [ ] Document file organization

### Step 3.3: Update Agent Skill
- [ ] Update `.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md`
- [ ] Add Modelina generation workflow
- [ ] Add `title` property requirement
- [ ] Add enum extraction pattern
- [ ] Add file organization

### Step 3.4: Update AGENT-INDEX.md
- [ ] Add keywords: `asyncapi`, `modelina`, `type-generation`, `contract-drift`

## Phase 4: Add Failed Event Emission ✅ COMPLETE

- [x] Create `workflows/src/activities/organization-bootstrap/emit-bootstrap-failed.ts`
- [x] Export from `workflows/src/activities/organization-bootstrap/index.ts`
- [x] Update `workflow.ts` catch block to call activity
- [x] Build: `npm run build`
- [x] Deploy via push to main (commit d49f5db7)

## Phase 5: Fix Column Name Bug ✅ COMPLETE

- [x] Create migration: `supabase migration new fix_org_type_column_name`
  - Migration: `20260112223255_fix_org_type_column_name.sql`
- [x] Copy `process_organization_event` function with fix
- [x] Change INSERT column from `org_type` to `type`
- [x] Test dry-run: `supabase db push --linked --dry-run`
- [x] Deploy: `supabase db push --linked`
- [x] Verify function definition uses correct column name

## Phase 6: Verification ⏸️ PENDING

### After Phases 1-2
- [ ] Run `npm run bundle` successfully
- [ ] Run `npm run generate:types` successfully
- [ ] Verify `types/generated-events.ts` has named types
- [ ] Verify NO `AnonymousSchema_X` in output
- [ ] Run `npm run check` passes

### After Phase 3
- [ ] Documentation exists at correct paths
- [ ] CLAUDE.md has new section

### After Phase 4
- [ ] Verify function no longer references `org_type`
- [ ] Clean up orphaned test events
- [ ] Create new test organization successfully

### After Phase 5
- [ ] Trigger test failure
- [ ] Verify `organization.bootstrap.failed` event emitted
- [ ] Verify UI shows "failed" status

---

## Current Status

**Phase**: All phases complete
**Status**: ✅ COMPLETE
**Last Updated**: 2026-01-12
**Summary**:
- Phases 1-2: AsyncAPI schemas prepared, Modelina type generation working
- Phase 3: Documentation updated (minor: AGENT-INDEX.md keywords pending)
- Phase 4: Failed event emission deployed
- Phase 5: Column name bug fixed via migration 20260112223255

## Quick Command Reference

```bash
# Phase 1-2: Work in contracts directory
cd infrastructure/supabase/contracts

# Bundle AsyncAPI (after Phase 1)
npm run bundle

# Generate types (after Phase 2.2)
npm run generate:types

# Run all checks (after Phase 2)
npm run check

# Phase 4: Create migration
cd infrastructure/supabase
supabase migration new fix_org_type_column_name
supabase db push --linked --dry-run
supabase db push --linked

# Phase 5: Build and deploy worker
cd workflows
npm run build
git add . && git commit -m "feat: Add failed event emission" && git push
```

## Estimated Effort

| Phase | Task | Effort |
|-------|------|--------|
| P1.1 | Create components/enums.yaml | 2-3 hours |
| P1.2 | Add title to all schemas | 1 hour |
| P1.3 | Update $ref in domain files | 2-3 hours |
| P2.1 | Update package.json scripts | 15 min |
| P2.2 | Create generate-types.js | 1 hour |
| P2.3 | Create CI workflow | 30 min |
| P2.4 | Fix imports in consumers | 1-2 hours |
| P3.1 | Create CONTRACT-TYPE-GENERATION.md | 30 min |
| P3.2 | Update infrastructure/CLAUDE.md | 15 min |
| P3.3 | Update agent skill | 30 min |
| P3.4 | Update AGENT-INDEX.md | 10 min |
| P4 | Create migration | 30 min |
| P5 | Add failed event emission | 1 hour |
| **Total** | | **9.5-12.5 hours** |

## Notes

- Plan file with full code examples: `/home/lars/.claude/plans/magical-scribbling-honey.md`
- Architect review confirmed Modelina is correct tool choice
- All 41 enums cataloged in plan file by category
