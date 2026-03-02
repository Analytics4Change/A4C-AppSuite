# Implementation Plan: Organization Manage Page

## Executive Summary

Platform owners currently have no way to manage organization lifecycle (deactivate, reactivate, delete), and provider admins have no sidebar nav link to edit their own organization. This feature adds a `/organizations/manage` split-panel page (matching the `RolesManagePage` pattern), organization lifecycle RPC functions, contact/address/phone CRUD, JWT hook extension to block users in deactivated orgs, a Temporal workflow for async deletion cleanup, and frontend `access_blocked` guards.

The scope spans all three monorepo components: infrastructure (SQL migration, Edge Functions), workflows (Temporal deletion workflow), and frontend (services, ViewModels, page).

## Phase 0: Pre-Existing Bug Fixes ✅ COMPLETE (commit `dcfb4197`)

Fixed 4 bugs (2 more than originally planned) in single migration `20260226001008`.

### Bugs Fixed
1. **`handle_organization_deactivated`** — removed `deleted_at`, added `deactivation_reason` from `deactivation_type`, used `effective_date` for timestamp
2. **`handle_organization_reactivated`** — added `deactivated_at = NULL`, `deactivation_reason = NULL`
3. **`handle_organization_updated`** (discovered) — fixed v3 column names (`subdomain`→`slug`, `organization_type`→`type`), removed invalid enum cast, added `display_name`, `tax_number`, `phone_number`, `timezone`
4. **`handle_organization_deleted`** (discovered) — added `deletion_reason` from `deletion_strategy`, used `safe_jsonb_extract_timestamp` for `deleted_at`

### 0.2 Frontend Service Deprecation
- `SupabaseOrganizationCommandService` uses deprecated `p_aggregate_type`/`p_aggregate_id` params — will be fully resolved in Phase 3 refactor to dedicated RPCs

## Phase 1: Database — RPCs + JWT Hook ✅ COMPLETE (commit `27c6442a`)

Single migration `20260226002002_organization_manage_page_phase1.sql` (1027 lines).

### 1.1 JWT Hook Extension ✅
- Added `v_org_is_active boolean` variable, extended org type SELECT to also fetch `is_active`
- When org inactive: sets `access_blocked: true`, `access_block_reason: 'organization_deactivated'`, returns early

### 1.2 Organization Lifecycle RPCs ✅
- `api.get_organization_details(p_org_id)` — org + contacts + addresses + phones in single response
- `api.update_organization(p_org_id, p_data, p_reason)` — strips `name` for non-platform-owners
- `api.deactivate_organization(p_org_id, p_reason)` — platform owner only
- `api.reactivate_organization(p_org_id)` — platform owner only
- `api.delete_organization(p_org_id, p_reason)` — requires prior deactivation

### 1.3 Contact/Address/Phone CRUD (9 RPCs) ✅
- 3 each for contacts, addresses, phones (create/update/delete)
- All with permission checks, event emission, read-back guards

### 1.4 Event Infrastructure (partial)
- Router CASE branches added: `organization.deletion.initiated` (NULL), `organization.deletion.completed` (NULL) ✅
- Router reference file updated ✅
- AsyncAPI channel wiring — deferred to Phase 1B
- Type regeneration — deferred to Phase 1B

## Phase 1B: AsyncAPI + Type Generation ✅ COMPLETE

- 2 new event schemas: `OrganizationDeletionInitiatedEvent`, `OrganizationDeletionCompletedEvent`
- 4 events wired into channel: `OrganizationReactivated`, `OrganizationDeleted`, `OrganizationDeletionInitiated`, `OrganizationDeletionCompleted`
- Types regenerated (35 enums, 213 interfaces, 0 AnonymousSchema) and synced to frontend
- AsyncAPI validated (0 errors)

## Phase 2: Edge Function `access_blocked` Audit ✅ COMPLETE

- 4 Edge Functions updated with `access_blocked` guard: `invite-user` (v16), `manage-user` (v9), `organization-bootstrap` (v7), `workflow-status` (v26)
- `workflow-status` needed JWT decode addition (was only using `auth.getUser()`)
- `_shared/types.ts` updated: added `access_block_reason` to `JWTPayload`
- Skipped `validate-invitation` and `accept-invitation` (unauthenticated, token-based)
- Backend API middleware already has guard (verified)

## Phase 3: Frontend Service Layer ✅ COMPLETE

- Extended `organization.types.ts` with 12 new types (OrganizationDetails, entity types, operation results, CRUD data types)
- Updated `OrganizationUpdateData` to include `tax_number` and `phone_number`
- Added lifecycle methods to `IOrganizationCommandService` (deactivate, reactivate, delete)
- Refactored `SupabaseOrganizationCommandService` from `emit_domain_event` to dedicated RPCs (fixes C1)
- Added `getOrganizationDetails` to query service (interface + Supabase + Mock)
- Created `IOrganizationEntityService` with 9 CRUD methods + Supabase/Mock implementations + factory
- Fixed `OrganizationCommandServiceFactory` to use `getDeploymentConfig` (was using `VITE_AUTH_MODE`)
- Typecheck: zero errors

## Phase 4: Frontend `access_blocked` Guard ✅ COMPLETE

- `AccessBlockedPage.tsx` — glassmorphism card with ShieldX icon, reason-to-label mapping, sign out button
- `ProtectedRoute.tsx` — added `session?.claims.access_blocked` check after password recovery, before !isAuthenticated
- `/access-blocked` registered as public route in App.tsx (outside ProtectedRoute to prevent redirect loop)

## Phase 5: Temporal Deletion Workflow ✅ COMPLETE

- `organizationDeletionWorkflow` with 5 activities (2 reused from bootstrap compensation):
  1. `emitDeletionInitiated` (new) → `organization.deletion.initiated`
  2. `revokeInvitations` (reused) → `invitation.revoked` (×N pending)
  3. `removeDNS` (reused) → `organization.dns.removed`
  4. `deactivateOrgUsers` (new) → user deactivation events (×N)
  5. `emitDeletionCompleted` (new) → `organization.deletion.completed`
- Child entity data (phones, addresses, contacts, emails) NOT deleted — org soft-delete blocks access; cross-tenant grant holders retain visibility; legal/compliance retention
- `DELETE /api/v1/organizations/:id` API endpoint
- Cross-tenant access grants preserved (all types)

## Phase 6: Frontend ViewModels ✅ COMPLETE

- `OrganizationManageListViewModel` — list state, filtering, lifecycle operations (deactivate/reactivate/delete)
- `OrganizationManageFormViewModel` — form state, validation, submission, 9 entity CRUD methods via shared helper
- Role-based field editability: `isPlatformOwner` controls `canEditName`, `canEditFields` gates all edits when org inactive
- Entity operations auto-reload details on success

## Phase 7: Frontend Page + Navigation ✅ COMPLETE (commit `cab2cf9c`)

- `OrganizationsManagePage` (~1500 lines): split-panel with left org list (platform owner) / auto-select (provider)
- Right panel: org fields form, contacts/addresses/phones entity sections with inline add/edit/delete
- DangerZone for platform owner with deactivate/reactivate/delete + ConfirmDialogs
- Entity CRUD via `EntityFormDialog` modal components (contact, address, phone)
- Route: `/organizations/manage` with `RequirePermission("organization.update")`
- Nav item: visible to all org types with `organization.update` permission
- Stub `/organizations/:orgId/edit` redirects to `/organizations/manage`

## Phase 8: Documentation Reconciliation ✅ COMPLETE

- Updated `organization-management-architecture.md` (v3.0): manage page, lifecycle RPCs, entity service, deletion workflow, access_blocked, JWT v4, deployment status
- Updated `AGENT-INDEX.md` with 6 new keywords
- Verified all handler reference files current
- Table reference docs and frontend overview confirmed up-to-date

## Success Metrics

### Immediate
- [x] All handler bug fixes verified (deactivated handler no longer sets `deleted_at`)
- [ ] New RPCs pass SQL test script with correct metadata
- [x] `supabase db push --linked` succeeds (both Phase 0 and Phase 1 migrations applied)

### Medium-Term
- [ ] Manage page renders in mock mode with correct field editability
- [ ] Lifecycle operations work end-to-end in integration mode
- [ ] Blocked users see AccessBlockedPage

### Long-Term
- [ ] Temporal deletion workflow completes (DNS removed, users banned)
- [ ] Documentation updated with AGENT-INDEX cross-references
- [ ] Zero failed events in `domain_events.processing_error`

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Handler bug fix breaks existing orgs | High | Test against both active and deactivated orgs in staging |
| JWT token refresh delay (~1hr) | Medium | Acceptable for V1; document the window |
| Bootstrap activity reuse incompatibility | Medium | Verify each activity queries by org_id, test in isolation |
| Schema column mismatch | High | Phase 0C verification step before writing any RPCs |

## Next Steps After Completion

- Organization deletion status polling UI (S3 from architect review)
- Cross-tenant access grant management UI
- VAR dashboard with aggregated performance metrics
