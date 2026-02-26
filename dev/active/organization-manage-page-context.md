# Context: Organization Manage Page

## Decision Record

**Date**: 2026-02-25
**Feature**: Organization Manage Page with lifecycle operations
**Goal**: Enable platform owners to manage organization lifecycle (deactivate/reactivate/delete) and both platform owners and provider admins to edit organization details, contacts, addresses, and phones via a split-panel manage page.

### Key Decisions

1. **Split-panel pattern**: Follows `RolesManagePage` exactly — `grid-cols-1 lg:grid-cols-3`, `PanelMode`, `DialogState` discriminated union, DangerZone + ConfirmDialog. No 'create' mode (orgs created via bootstrap workflow).

2. **Cross-tenant grants preserved on deletion**: ALL grant types (VAR, court, social services, family, emergency) persist independently of org lifecycle. Rationale: VARs need aggregated performance metrics for sales; court orders have legal obligation; data is soft-deleted (still accessible). Grants governed by their own lifecycle (expiration, explicit revocation).

3. **Soft-delete architecture**: Org deletion sets `deleted_at` + `deleted_reason` but all data (clients, medications, events) remains intact. JWT `access_blocked` mechanism blocks user access within ~1hr (token refresh window).

4. **Dedicated RPCs over raw emit_domain_event**: Frontend must call `api.update_organization()` etc., not `api.emit_domain_event()` directly. This aligns with the schedule/role service pattern where backend owns event emission. Fixes C1 bug (deprecated `p_aggregate_type`/`p_aggregate_id` params).

5. **Temporal for deletion only**: The only org lifecycle operation requiring Temporal is deletion (unreliable external calls: DNS removal via Cloudflare, user deactivation via Supabase Admin API). Deactivate/reactivate are synchronous RPCs.

6. **Field editability by role**: Provider admins can edit `display_name`, `tax_number`, `phone_number`, `timezone`, and contacts/addresses/phones. Platform owners additionally edit `name` and have lifecycle controls. See plan file for full matrix.

7. **Pre-existing handler bugs must be fixed first**: `handle_organization_deactivated` incorrectly sets `deleted_at`, `handle_organization_reactivated` doesn't clear `deactivated_at`. These block the delete RPC guard (`deleted_at IS NULL`).

8. **Deletion workflow simplified to 5 activities (was 9)**: Dropped `deletePhones`, `deleteAddresses`, `deleteContacts`, `deleteEmails` entirely. Rationale: org-level soft-delete already blocks access via RLS/JWT; cross-tenant grant holders still need child entity data (contacts, addresses, phones); legal/compliance requires retention; GDPR erasure would be a separate audited process. Remaining activities: `emitDeletionInitiated` → `revokeInvitations` → `removeDNS` → `deactivateOrgUsers` → `emitDeletionCompleted`. - Added 2026-02-25

9. **Two additional handler bugs discovered during Phase 0** (beyond original 2 in plan): Bug 3: `handle_organization_updated` used v3 column names (`subdomain` instead of `slug`, `organization_type` instead of `type` with invalid enum cast) and was missing `display_name`, `tax_number`, `phone_number`, `timezone`. Bug 4: `handle_organization_deleted` didn't populate `deletion_reason`. All 4 bugs fixed in single migration. - Added 2026-02-25

10. **AsyncAPI event_data field naming**: `deactivation_type` (not `deactivation_reason`), `effective_date` (not `deactivated_at`), `deletion_strategy` (not `deletion_reason`). The projection column names differ from event_data field names — handlers translate between them. - Added 2026-02-25

11. **JWT hook org_is_active design**: Added `v_org_is_active boolean` variable, extended existing org type SELECT to also fetch `is_active`, check placed after org type resolution. When org inactive, sets `access_blocked: true` and `access_block_reason: 'organization_deactivated'` in claims, then returns early (no permissions populated). - Added 2026-02-25

12. **Permission model for RPCs**: `has_platform_privilege()` gates lifecycle ops (deactivate/reactivate/delete). `has_effective_permission('organization.update', path)` gates entity CRUD (contacts/addresses/phones). `update_organization` uses both: platform owners edit all fields including `name`; non-platform-owners get `name` stripped from update data. - Added 2026-02-25

13. **C1 fix: updateOrganization return type changed from void to OrganizationOperationResult**: All command service methods now return `{success, error?, organization?}` envelopes instead of throwing on failure. This matches the pattern used by org unit, role, and schedule services. The old `emit_domain_event` call with `p_aggregate_type`/`p_aggregate_id` params is fully removed. - Added 2026-02-25

14. **Entity service is separate from command/query services**: Contact/address/phone CRUD lives in `IOrganizationEntityService` (not in the command service) because these are child entity operations, not organization-level commands. They have their own event types (`contact.created`, `address.updated`, etc.) and route to different routers. Follows separation of concerns. - Added 2026-02-25

15. **SupabaseOrganizationEntityService uses shared `callEntityRpc` helper**: All 9 CRUD operations follow the same pattern (call RPC, check success, return entity result), so a single private method handles the common logic. The RPC name and params are the only varying parts. - Added 2026-02-25

16. **OrganizationCommandServiceFactory fixed to use getDeploymentConfig**: Was the only factory reading `VITE_AUTH_MODE` directly. Now uses `getDeploymentConfig().useMockOrganization` for consistency with query, unit, entity, schedule, and role service factories. - Added 2026-02-25

17. **Deletion workflow: best-effort, no saga compensation**: Unlike bootstrap (which rolls back on failure), deletion uses best-effort cleanup. Individual activity failures are logged in `errors[]` but don't prevent other steps from running. Rationale: the org is already soft-deleted and access-blocked; cleanup is supplementary, not transactional. - Added 2026-02-25

18. **Worker workflowsPath changed to top-level barrel**: `workflowsPath` now points to `workflows/index.ts` which re-exports both bootstrap and deletion workflows. Activities merged via spread: `{ ...bootstrapActivities, ...deletionActivities }`. Both share the same `bootstrap` task queue. - Added 2026-02-25

19. **Generated events synced to workflows**: `workflows/src/shared/types/generated/events.ts` was outdated (1580 lines vs 2163 in contracts). Synced from `infrastructure/supabase/contracts/types/generated-events.ts` to get deletion event types. - Added 2026-02-25

20. **Supabase Admin API `ban_duration: 'none'` for permanent user deactivation**: `deactivateOrgUsers` activity uses `supabase.auth.admin.updateUserById(id, { ban_duration: 'none' })` which permanently bans the user. This is a hard block (immediate, unlike JWT refresh delay). - Added 2026-02-25

## Technical Context

### Architecture
- **CQRS/Event Sourcing**: All writes emit domain events; projection handlers update read models. No direct projection writes.
- **Single event trigger**: `process_domain_event_trigger` on `domain_events` → routers → handlers. New event types need CASE branches.
- **Read-back guards**: Every RPC that emits an event must SELECT from projection afterward to verify handler success.
- **Event metadata**: `user_id` + `organization_id` always required. `reason` on lifecycle ops. Tracing fields (`correlation_id`, `trace_id`, `span_id`) auto-populated by PostgREST pre-request hook.

### Tech Stack
- **DB**: PostgreSQL via Supabase, `api` schema RPC functions, PL/pgSQL handlers
- **Frontend**: React 19 + TypeScript, MobX ViewModels, Tailwind CSS
- **Workflows**: Temporal.io with Saga pattern, Node.js activities
- **Edge Functions**: Deno runtime, shared `_shared/types.ts` and `_shared/emit-event.ts`
- **AsyncAPI**: Event schema contracts, type generation pipeline

### Dependencies
- JWT hook (`custom_access_token_hook`) — extend with org `is_active` check
- Bootstrap compensation activities — reuse 2 of 8 for deletion workflow (`revokeInvitations`, `removeDNS`)
- `DangerZone` + `ConfirmDialog` shared UI components
- `RolesManagePage` — pattern reference for split-panel layout
- Schedule RPC migration (`20260217231405`) — pattern reference for metadata

## Pre-Existing Bugs Found (Architect Review)

### C1: `SupabaseOrganizationCommandService` deprecated API
- **File**: `frontend/src/services/organization/SupabaseOrganizationCommandService.ts`
- Uses `p_aggregate_type`/`p_aggregate_id` (v3 param names), missing `user_id`/`organization_id` in metadata
- **Resolution**: Refactor to dedicated `api.update_organization` RPC in Phase 3D

### C2: Handler bugs in deactivation/reactivation
- **File**: `infrastructure/supabase/handlers/organization/handle_organization_deactivated.sql`
  - Bug: Sets BOTH `deactivated_at` AND `deleted_at` — breaks delete guard
- **File**: `infrastructure/supabase/handlers/organization/handle_organization_reactivated.sql`
  - Bug: Only sets `is_active = true` — doesn't clear `deactivated_at`/`deactivated_reason`
- **Resolution**: Fix in Phase 0 migration before any new RPCs

## File Structure

### Existing Files Modified
- `infrastructure/supabase/handlers/organization/handle_organization_deactivated.sql` — fixed C2 bug (Phase 0, 2026-02-25)
- `infrastructure/supabase/handlers/organization/handle_organization_reactivated.sql` — fixed C2 bug (Phase 0, 2026-02-25)
- `infrastructure/supabase/handlers/organization/handle_organization_updated.sql` — fixed v3 columns + added 4 fields (Phase 0, 2026-02-25)
- `infrastructure/supabase/handlers/organization/handle_organization_deleted.sql` — added `deletion_reason` (Phase 0, 2026-02-25)
- `infrastructure/supabase/handlers/routers/process_organization_event.sql` — added `deletion.initiated`/`completed` no-ops (Phase 1, 2026-02-25)
- `frontend/src/services/organization/SupabaseOrganizationCommandService.ts` — refactor to dedicated RPCs
- `frontend/src/services/organization/IOrganizationCommandService.ts` — add lifecycle methods
- `frontend/src/services/organization/IOrganizationQueryService.ts` — add `getOrganizationDetails`
- `frontend/src/types/organization.types.ts` — extend types
- `frontend/src/components/layouts/MainLayout.tsx` — nav updates
- `frontend/src/App.tsx` — route registration
- `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` — wire 5 missing events
- `workflows/src/api/routes/workflows.ts` — add DELETE endpoint
- `workflows/src/worker/index.ts` — register deletion workflow
- `infrastructure/supabase/supabase/functions/invite-user/index.ts` — add `access_blocked` check
- `infrastructure/supabase/supabase/functions/manage-user/index.ts` — add `access_blocked` check
- `infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts` — add `access_blocked` check
- `infrastructure/supabase/supabase/functions/workflow-status/index.ts` — add `access_blocked` check
- `infrastructure/supabase/supabase/functions/_shared/types.ts` — add `access_block_reason` to JWTPayload
- `infrastructure/supabase/contracts/asyncapi/asyncapi.yaml` — wire 4 missing org events
- `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` — add DeletionInitiated/Completed schemas
- `infrastructure/supabase/contracts/types/generated-events.ts` — regenerated
- `frontend/src/types/generated/generated-events.ts` — synced from contracts

### New Files Created
- `infrastructure/supabase/supabase/migrations/20260226001008_fix_organization_event_handlers.sql` — Phase 0: 4 handler bug fixes + data remediation (commit `dcfb4197`)
- `infrastructure/supabase/supabase/migrations/20260226002002_organization_manage_page_phase1.sql` — Phase 1: JWT hook extension, 14 RPCs, router update (1027 lines, commit `27c6442a`)
- Phase 1B + Phase 2 commit: `a68a1c8e` — AsyncAPI deletion events + access_blocked guard on 4 Edge Functions

### New Files Created (Phase 3)
- `frontend/src/services/organization/IOrganizationEntityService.ts` — contact/address/phone CRUD interface (9 methods)
- `frontend/src/services/organization/SupabaseOrganizationEntityService.ts` — implementation with shared `callEntityRpc` helper
- `frontend/src/services/organization/MockOrganizationEntityService.ts` — in-memory mock with realistic data
- `frontend/src/services/organization/OrganizationEntityServiceFactory.ts` — factory using getDeploymentConfig

### New Files Created (Phase 4)
- `frontend/src/pages/auth/AccessBlockedPage.tsx` — reason display + logout, glassmorphism card

### New Files Created (Phase 5)
- `workflows/src/workflows/organization-deletion/workflow.ts` — 5-activity deletion workflow (no saga, best-effort cleanup)
- `workflows/src/workflows/organization-deletion/index.ts` — workflow barrel export
- `workflows/src/workflows/index.ts` — top-level barrel exporting both bootstrap + deletion workflows
- `workflows/src/activities/organization-deletion/index.ts` — activity barrel (3 new + 2 reused)
- `workflows/src/activities/organization-deletion/emit-deletion-initiated.ts` — emits organization.deletion.initiated event
- `workflows/src/activities/organization-deletion/deactivate-org-users.ts` — bans all org users via Supabase Admin API
- `workflows/src/activities/organization-deletion/emit-deletion-completed.ts` — emits organization.deletion.completed event

### Existing Files Modified (Phase 5)
- `workflows/src/shared/types/index.ts` — added 6 new types (OrganizationDeletionParams/Result, EmitDeletionInitiated/CompletedParams, DeactivateOrgUsersParams/Result)
- `workflows/src/shared/utils/typed-events.ts` — added emitDeletionInitiated + emitDeletionCompleted typed emitters, imported OrganizationDeletionInitiationData/CompletionData
- `workflows/src/shared/utils/index.ts` — re-exported new emitters
- `workflows/src/shared/types/generated/events.ts` — synced from contracts (was outdated, missing deletion event types)
- `workflows/src/worker/index.ts` — merged bootstrap + deletion activities, workflowsPath → top-level barrel
- `workflows/src/api/routes/workflows.ts` — added DELETE /api/v1/organizations/:id endpoint

### New Files Still to Create
- `frontend/src/viewModels/organization/OrganizationManageListViewModel.ts`
- `frontend/src/viewModels/organization/OrganizationManageFormViewModel.ts`
- `frontend/src/pages/organizations/OrganizationsManagePage.tsx`

## Related Components
- `frontend/src/pages/roles/RolesManagePage.tsx` — pattern reference for split-panel
- `frontend/src/components/ui/DangerZone.tsx` — shared component for lifecycle actions
- `frontend/src/components/ui/ConfirmDialog.tsx` — shared component for confirmations
- `workflows/src/workflows/organization-bootstrap/workflow.ts` — pattern reference for Temporal
- `workflows/src/activities/organization-bootstrap/revoke-invitations.ts` — reused for deletion workflow
- `workflows/src/activities/organization-bootstrap/remove-dns.ts` — reused for deletion workflow
- `workflows/src/api/middleware/auth.ts` — already has `access_blocked` guard

## Key Patterns and Conventions
- **RPC metadata pattern**: `jsonb_build_object('user_id', v_user_id, 'organization_id', v_org_id) || CASE WHEN p_reason IS NOT NULL THEN jsonb_build_object('reason', p_reason) ELSE '{}'::jsonb END`
- **Router ELSE**: Must `RAISE EXCEPTION` with `ERRCODE = 'P9001'`, never `RAISE WARNING`
- **ON CONFLICT**: All handlers must be idempotent for event replay
- **Service factory pattern**: `create[Service]Service()` factory selecting Supabase/Mock based on auth mode
- **ViewModel pattern**: MobX `makeAutoObservable`, `runInAction` for async state updates

## Important Constraints
- **JWT refresh window**: ~1hr delay between org deactivation and user access being blocked (pull mechanism, not push)
- **`#variable_conflict use_column`**: Required in RETURNS TABLE functions with RETURN QUERY (learned from schedule fix)
- **MCP `deploy_edge_function`**: Unreliable for large payloads — use `supabase functions deploy` CLI instead
- **AsyncAPI titles**: Every schema must have a `title` property to prevent `AnonymousSchema` generation
- **Handler reference files**: Always read before modifying, update after migration
- **`frontend/src/types/generated/`**: Gitignored — `sync-schemas.cjs` copies from contracts at build time. Manual copy is for local dev only, don't try to `git add` it.

## Reference Materials
- Phase 0 plan file: `/home/lars/.claude/plans/polished-foraging-sparrow.md` (bug fix plan, completed)
- Schedule RPC pattern: `infrastructure/supabase/supabase/migrations/20260217231405_add_event_metadata_to_schedule_rpcs.sql`
- Org management architecture: `documentation/architecture/data/organization-management-architecture.md`
- Cross-tenant grants: `documentation/infrastructure/reference/database/tables/cross_tenant_access_grants_projection.md`
- Event metadata schema: `documentation/workflows/reference/event-metadata-schema.md`
- Event processing patterns: `documentation/infrastructure/patterns/event-processing-patterns.md`

## Why This Approach?
- **Dedicated RPCs** over raw `emit_domain_event`: Moves event emission responsibility to backend (consistent with schedule/role pattern), enables proper permission checks, metadata population, and read-back guards server-side. Frontend only needs to call typed RPC functions.
- **Temporal for deletion only**: Deactivation/reactivation are simple atomic operations. Deletion involves unreliable external calls (DNS, Supabase Admin API) that benefit from Temporal's retry and durability.
- **Cross-tenant grants preserved**: Legal obligations (court orders), business needs (VAR metrics), and the soft-delete architecture all favor keeping grants active. They have their own lifecycle.
