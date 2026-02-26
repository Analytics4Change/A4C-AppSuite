# Tasks: Organization Manage Page

## Phase 0: Pre-Existing Bug Fixes ✅ COMPLETE

- [x] Read `handle_organization_deactivated.sql` reference file
- [x] Read `handle_organization_reactivated.sql` reference file
- [x] Verify `organizations_projection` schema has `display_name`, `tax_number`, `phone_number`, `timezone`, `deactivated_at`, `deactivation_reason`, `deleted_at`, `deletion_reason`
- [x] Create migration: fix `handle_organization_deactivated` (remove `deleted_at` assignment, add `deactivation_reason`)
- [x] Create migration: fix `handle_organization_reactivated` (clear `deactivated_at`, `deactivation_reason`)
- [x] Fix `handle_organization_updated` (v3 column names `subdomain`→`slug`, `organization_type`→`type`, add 4 new fields)
- [x] Fix `handle_organization_deleted` (add `deletion_reason` from `deletion_strategy`)
- [x] Data remediation: clear bogus `deleted_at` on deactivated-but-not-deleted orgs (0 rows affected)
- [x] All columns already existed — no schema changes needed
- [x] Update 4 handler reference files after migration
- [x] Apply migration `20260226001008_fix_organization_event_handlers.sql`: `supabase db push --linked`
- [x] Commit: `dcfb4197`

## Phase 1: Database — RPCs + JWT Hook ✅ COMPLETE

- [x] Read JWT hook (`custom_access_token_hook`) from baseline (~line 7008)
- [x] Read `process_organization_event()` router reference file
- [x] Read schedule RPC migration (`20260217231405`) for metadata pattern
- [x] Read contact/address/phone router reference files for event_data structure
- [x] Extend JWT hook: add org `is_active` check → sets `access_blocked: true` with `access_block_reason: 'organization_deactivated'`
- [x] `handle_organization_updated` already fixed in Phase 0 (v3 columns + 4 new fields)
- [x] Create `api.get_organization_details(p_org_id)` — returns org + contacts + addresses + phones
- [x] Create `api.update_organization(p_org_id, p_data, p_reason)` — strips `name` for non-platform-owners
- [x] Create `api.deactivate_organization(p_org_id, p_reason)` — platform owner only
- [x] Create `api.reactivate_organization(p_org_id)` — platform owner only
- [x] Create `api.delete_organization(p_org_id, p_reason)` — requires prior deactivation
- [x] Create 9 contact/address/phone CRUD RPCs (create/update/delete × 3 entity types)
- [x] Add router CASE branches: `organization.deletion.initiated` (NULL) + `organization.deletion.completed` (NULL)
- [x] Verify existing CASE branches for `organization.deactivated` and `organization.reactivated` (already present)
- [x] Update router reference file `process_organization_event.sql`
- [x] Apply migration `20260226002002_organization_manage_page_phase1.sql` (1027 lines)
- [x] Verify all 14 RPC functions exist in live DB
- [x] Test `get_organization_details` with real org ID — returns full data
- [x] Commit: `27c6442a`

### Phase 1B: AsyncAPI + Type Generation ✅ COMPLETE
- [x] Wire 4 missing org events into `asyncapi.yaml` channel (OrganizationReactivated, OrganizationDeleted, OrganizationDeletionInitiated, OrganizationDeletionCompleted)
- [x] Create 2 new event schemas in `organization.yaml` (DeletionInitiatedEvent, DeletionCompletedEvent with data schemas)
- [x] Regenerate types: `cd infrastructure/supabase/contracts && npm run generate:types` — 35 enums, 213 interfaces, 0 AnonymousSchema
- [x] Copy types to frontend — `generated-events.ts` synced
- [x] Validate AsyncAPI spec — 0 errors (104 pre-existing warnings only)
- [x] Frontend typecheck passes
- [ ] Run comprehensive SQL test script for all 14 RPCs (deferred — test during Phase 3 integration)

## Phase 2: Edge Function `access_blocked` Audit ✅ COMPLETE

- [x] Audit `invite-user` — added `access_blocked` guard after JWT decode, bumped v16
- [x] Audit `manage-user` — added `access_blocked` guard after JWT decode, bumped v9
- [x] Audit `organization-bootstrap` — added `access_blocked` guard after JWT decode, bumped v7
- [x] Audit `workflow-status` — added JWT decode + `access_blocked` guard (was missing JWT decode), bumped v26
- [x] Added `access_block_reason` field to `_shared/types.ts` JWTPayload
- [x] Skip `validate-invitation` — unauthenticated (no JWT, token-based)
- [x] Skip `accept-invitation` — unauthenticated (uses admin API, token-based)
- [ ] Deploy updated Edge Functions (deploy after commit)

## Phase 3: Frontend Service Layer ✅ COMPLETE

- [x] Extend `organization.types.ts` with new types (OrganizationDetails, OrganizationDetailRecord, OrganizationContact/Address/Phone, OrganizationOperationResult, OrganizationEntityResult, ContactData/AddressData/PhoneData, updated OrganizationUpdateData with tax_number/phone_number)
- [x] Add lifecycle methods to `IOrganizationCommandService` (deactivate, reactivate, delete — all return OrganizationOperationResult)
- [x] Add `getOrganizationDetails` to `IOrganizationQueryService`
- [x] Refactor `SupabaseOrganizationCommandService` to use dedicated RPCs (fixes C1 — no more emit_domain_event)
- [x] Implement lifecycle methods in `SupabaseOrganizationCommandService` (all 4 ops call dedicated RPCs)
- [x] Add `getOrganizationDetails` to `SupabaseOrganizationQueryService`
- [x] Create `IOrganizationEntityService` (contact/address/phone CRUD — 9 methods)
- [x] Create `SupabaseOrganizationEntityService` (shared `callEntityRpc` helper)
- [x] Create `MockOrganizationEntityService` (in-memory with mock data)
- [x] Create `OrganizationEntityServiceFactory` (uses getDeploymentConfig)
- [x] Update `MockOrganizationCommandService` with lifecycle methods
- [x] Update `MockOrganizationQueryService` with `getOrganizationDetails`
- [x] Fix `OrganizationCommandServiceFactory` to use `getDeploymentConfig` (was using VITE_AUTH_MODE)
- [x] Typecheck passes (zero errors)

## Phase 4: Frontend `access_blocked` Guard ✅ COMPLETE

- [x] Create `AccessBlockedPage.tsx` with reason display + logout (glassmorphism card, ShieldX icon, reason mapping, sign out button)
- [x] Add `access_blocked` check to `ProtectedRoute.tsx` (after password recovery check, before !isAuthenticated)
- [x] Add `/access-blocked` as public route in App.tsx (outside ProtectedRoute to avoid redirect loop)
- [x] Typecheck passes (zero errors)

## Phase 5: Temporal Deletion Workflow ✅ COMPLETE

**5 activities** (2 reused from bootstrap, 3 new):
1. `emitDeletionInitiated` (new) → `organization.deletion.initiated`
2. `revokeInvitations` (reused) → `invitation.revoked` (×N pending)
3. `removeDNS` (reused) → `organization.dns.removed`
4. `deactivateOrgUsers` (new) → user deactivation events (×N)
5. `emitDeletionCompleted` (new) → `organization.deletion.completed`

**Dropped**: `deletePhones`, `deleteAddresses`, `deleteContacts`, `deleteEmails` — org soft-delete blocks access; cross-tenant grants need child data; legal retention

- [x] Add OrganizationDeletionParams/Result + activity param types to shared/types/index.ts
- [x] Sync generated events from contracts to workflows (was outdated)
- [x] Add emitDeletionInitiated + emitDeletionCompleted to typed-events.ts + utils barrel
- [x] Create `emit-deletion-initiated.ts` activity
- [x] Create `deactivate-org-users.ts` activity (Supabase Admin API ban)
- [x] Create `emit-deletion-completed.ts` activity
- [x] Create activity barrel `organization-deletion/index.ts` (3 new + 2 reused)
- [x] Create `workflows/src/workflows/organization-deletion/workflow.ts` (5 activities, best-effort)
- [x] Create workflow barrel + top-level workflows/index.ts
- [x] Update worker: merge activities, workflowsPath → top-level barrel
- [x] Add `DELETE /api/v1/organizations/:id` API endpoint
- [x] Typecheck passes (zero errors)
- [x] Lint passes (zero errors)
- [x] Build succeeds
- [ ] Test: trigger deletion, verify all 5 activities complete (deferred to integration testing)

## Phase 6: Frontend ViewModels ✅ COMPLETE

- [x] Create `OrganizationManageListViewModel.ts` — list state, filtering, lifecycle ops (deactivate/reactivate/delete)
- [x] Create `OrganizationManageFormViewModel.ts` — form state, validation, submission, contact/address/phone CRUD
- [x] Wire contact/address/phone form state — 9 CRUD methods via `performEntityOperation` helper with auto-reload
- [x] Add role-based field editability logic — `isPlatformOwner`, `canEditName`, `canEditFields` computed properties
- [x] Typecheck passes (zero errors)
- [x] Lint passes (zero errors)

## Phase 7: Frontend Page + Navigation ⏸️ PENDING

- [ ] Create `OrganizationsManagePage.tsx` (split-panel)
- [ ] Implement left panel: org list with search/filters
- [ ] Implement right panel: form sections (org fields, contacts, addresses, phones, read-only, DangerZone)
- [ ] Add DangerZone for platform owner (deactivate/reactivate/delete)
- [ ] Add ConfirmDialog instances for all dialog states
- [ ] Register `/organizations/manage` route in App.tsx
- [ ] Update nav sidebar in MainLayout.tsx (provider + platform owner)
- [ ] Remove/redirect stub at `/organizations/:orgId/edit`

## Phase 8: Documentation ⏸️ PENDING

- [ ] Update `organization-management-architecture.md`
- [ ] Update `frontend/architecture/overview.md`
- [ ] Update AGENT-INDEX.md with new keywords
- [ ] Verify table reference docs (contacts, addresses, phones, organizations)
- [ ] Update handler reference files for all modified handlers

## Success Validation Checkpoints

### Immediate Validation
- [x] Phase 0 migration applies cleanly
- [x] Deactivated handler no longer sets `deleted_at`
- [x] Reactivated handler clears `deactivated_at`/`deactivation_reason`
- [x] Updated handler uses correct column names (slug, type, display_name, etc.)
- [x] Phase 1 migration applies cleanly
- [x] All 14 RPCs exist in live DB
- [x] JWT hook has org `is_active` check

### Feature Complete Validation
- [ ] All new RPCs return correct `{success, ...}` envelopes
- [ ] Event metadata includes `user_id`, `organization_id`, `reason` (where applicable)
- [ ] `correlation_id`/`trace_id`/`span_id` auto-populated on all events
- [ ] Manage page renders in mock mode with correct field editability
- [ ] DangerZone shows for platform owner only
- [ ] Blocked users see AccessBlockedPage on next token refresh
- [ ] No direct table queries in new frontend service code
- [ ] AsyncAPI types regenerated with no `AnonymousSchema`
- [ ] All handler reference files updated

### Integration Validation
- [ ] Lifecycle operations work end-to-end in integration mode
- [ ] Temporal deletion workflow completes (DNS removed, users banned)
- [ ] Zero failed events in `domain_events.processing_error`
- [ ] Documentation has correct frontmatter, TL;DR, and AGENT-INDEX entries

## Current Status

**Phase**: Phase 7 — Frontend Page + Navigation
**Status**: ⏸️ PENDING
**Last Updated**: 2026-02-25
**Completed**: Phase 0 (`dcfb4197`), Phase 1 (`27c6442a`), Phase 1B+2 (`549c7c74`), Phase 3 (`a720f9e8`), Phase 4 (`b1a2540a`), Phase 5 (`4167876c`), Phase 6 (uncommitted)
**Next Step**: Commit Phase 6. Then proceed to Phase 7 (Frontend Page + Navigation).
