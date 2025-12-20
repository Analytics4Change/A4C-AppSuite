# Tasks: Organization FK Constraints + RPC Migration + Security Remediation

> **IMPORTANT**: All migration changes MUST be synced to `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`

## Phase 1: Pre-Migration Validation ✅ COMPLETE

- [x] Check for orphaned records in roles_projection
  - Found 7 orphaned records with non-existent organization_id
- [x] Check for orphaned records in user_roles_projection - None found
- [x] Check for orphaned records in clients - None found
- [x] Check for orphaned records in medications - None found
- [x] Check for orphaned records in medication_history - None found
- [x] Check for orphaned records in dosage_info - None found
- [x] Clean up orphans found:
  - Deleted 112 orphaned `role_permissions_projection` records (child table first)
  - Deleted 7 orphaned `roles_projection` records
- [x] Search SQL files for `org_id` references needing update

## Phase 2: Create FK Migration ✅ COMPLETE

- [x] Applied migration via MCP `apply_migration` (not as file, directly to Supabase)
- [x] Part A: Column rename (org_id → organization_id) - Applied
- [x] Part B: 6 FK constraints with idempotent patterns - Applied
  - `fk_roles_projection_organization`
  - `fk_user_roles_projection_organization`
  - `fk_clients_organization`
  - `fk_medications_organization`
  - `fk_medication_history_organization`
  - `fk_dosage_info_organization`

## Phase 3: Update SQL Files ✅ COMPLETE

- [x] Update `infrastructure/supabase/sql/02-tables/rbac/004-user_roles_projection.sql`
- [x] Update `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql`
- [x] Update `infrastructure/supabase/sql/04-triggers/bootstrap-event-listener.sql`
- [x] Update `infrastructure/supabase/sql/03-functions/authorization/001-user_has_permission.sql`
- [x] Update `infrastructure/supabase/sql/03-functions/authorization/002-authentication-helpers.sql`
- [x] Update `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql`
- [x] Update `infrastructure/supabase/sql/06-rls/impersonation-policies.sql`

## Phase 4: Update Consolidated Schema ✅ COMPLETE

- [x] Update column name in user_roles_projection definition
- [x] Update all `ur.org_id` references to `ur.organization_id` (using replace_all)
- [x] Add FK constraint blocks for all 6 tables

## Phase 5: Deploy FK Migration & Verify ✅ COMPLETE

- [x] Apply migration to Supabase via MCP - Done
- [x] Redeploy all authorization functions with `organization_id` references:
  - `is_org_admin`
  - `user_has_permission`
  - `user_permissions`
  - `is_super_admin`
  - `is_provider_admin`
  - `user_organizations`
  - `custom_access_token_hook`
  - `switch_organization`
  - `get_user_claims_preview`
- [x] Redeploy RLS policies for impersonation_sessions_projection
- [x] Verification results:
  - FK count: **15** (was 8, added 6, plus 1 self-ref)
  - Column: `organization_id` confirmed (not `org_id`)
  - All 6 new FK constraints visible in schema

## Phase 6: Add RLS for medication_templates (per architect) ⏸️ PENDING

- [ ] Create `infrastructure/supabase/sql/06-rls/medication-templates-policies.sql`
- [ ] Add SELECT policy using JWT org_id claim
- [ ] Add INSERT policy using JWT org_id claim
- [ ] Add UPDATE policy using JWT org_id claim
- [ ] Add DELETE policy using JWT org_id claim
- [ ] Verify RLS is enabled on table
- [ ] Test RLS policies locally

## Phase 7: Create RPC Functions (SECURITY INVOKER) ⏸️ PENDING

- [ ] Create `infrastructure/supabase/sql/03-functions/api/medication-template-rpc.sql`
- [ ] Implement `api.get_medication_templates()` - SECURITY INVOKER
- [ ] Implement `api.get_medication_template_by_id()` - SECURITY INVOKER
- [ ] Implement `api.upsert_medication_template()` - SECURITY INVOKER
- [ ] Implement `api.delete_medication_template()` - SECURITY INVOKER
- [ ] Implement `api.increment_template_usage()` - SECURITY INVOKER
- [ ] Create `infrastructure/supabase/sql/03-functions/api/event-history-rpc.sql`
- [ ] Implement `api.get_event_history()` - SECURITY INVOKER
- [ ] Test RPC functions locally
- [ ] Deploy RPC functions to Supabase

## Phase 8: Add RLS for domain_events INSERT (per architect) ⏸️ PENDING

- [ ] Create `infrastructure/supabase/sql/06-rls/domain-events-insert-policy.sql`
- [ ] Create `domain_events_authenticated_insert` policy
- [ ] Policy validates: user authenticated
- [ ] Policy validates: org_id matches JWT claim
- [ ] Policy validates: reason >= 10 chars
- [ ] Test policy with existing EventEmitter
- [ ] Deploy policy to Supabase

## Phase 9: Migrate Frontend to RPC ⏸️ PENDING

- [ ] Update `frontend/src/services/medications/template.service.ts`
  - [ ] Replace `supabase.from('medication_templates')` with RPC calls
  - [ ] Update `getTemplates()` to use `api.get_medication_templates`
  - [ ] Update `getTemplate()` to use `api.get_medication_template_by_id`
  - [ ] Update `saveTemplate()` to use `api.upsert_medication_template`
  - [ ] Update `deleteTemplate()` to use `api.delete_medication_template`
  - [ ] Update usage tracking to use `api.increment_template_usage`
- [ ] Update `frontend/src/hooks/useEventHistory.ts`
  - [ ] Replace `supabase.from('event_history_by_entity')` with RPC
  - [ ] Use `api.get_event_history`
- [ ] KEEP `frontend/src/lib/events/event-emitter.ts` AS-IS
  - [ ] Verify existing code works with new RLS policy

## Phase 10: Security Mode Remediation (per architect review) ⏸️ PENDING

### Critical (Multi-tenant data leakage risk)
- [ ] Change `api.get_organizations` to SECURITY INVOKER
- [ ] Change `api.get_organization_by_id` to SECURITY INVOKER
- [ ] Verify RLS policies exist on `organizations_projection`

### High Priority (10 functions)
- [ ] Change `user_has_permission` to SECURITY INVOKER
- [ ] Change `user_permissions` to SECURITY INVOKER
- [ ] Change `user_organizations` to SECURITY INVOKER
- [ ] Change `get_user_active_impersonation_sessions` to SECURITY INVOKER
- [ ] Change `get_org_impersonation_audit` to SECURITY INVOKER
- [ ] Change `get_impersonation_session_details` to SECURITY INVOKER
- [ ] Change `api.get_child_organizations` to SECURITY INVOKER
- [ ] Change `api.get_pending_invitations_by_org` to SECURITY INVOKER
- [ ] Change `api.get_invitation_by_org_and_email` to SECURITY INVOKER
- [ ] Change `api.get_contacts_by_org` to SECURITY INVOKER
- [ ] Change `api.get_addresses_by_org` to SECURITY INVOKER
- [ ] Change `api.get_phones_by_org` to SECURITY INVOKER

### Medium Priority (7 functions)
- [ ] Change `is_super_admin` to SECURITY INVOKER
- [ ] Change `is_provider_admin` to SECURITY INVOKER
- [ ] Change `switch_organization` to SECURITY INVOKER
- [ ] Change `api.get_organization_status` to SECURITY INVOKER
- [ ] Change `api.get_organization_units` to SECURITY INVOKER
- [ ] Change `api.get_organization_unit_by_id` to SECURITY INVOKER
- [ ] Change `api.get_organization_unit_descendants` to SECURITY INVOKER

### Sync to Consolidated Schema
- [ ] Update all changed functions in `CONSOLIDATED_SCHEMA.sql`

## Phase 11: Final Verification ⏸️ PENDING

- [ ] Run frontend tests to verify RPC migration works
- [ ] Test medication templates functionality end-to-end
- [ ] Test event history display
- [ ] Verify event emission works with new RLS policy
- [ ] Verify security mode changes don't break existing functionality
- [ ] Run `/org-cleanup-dryrun` to confirm complete table discovery

## Success Validation Checkpoints

### FK Constraints Complete ✅
- [x] Column renamed: `user_roles_projection.org_id` → `organization_id`
- [x] 6 tables have new FK constraints
- [x] FK count = 15 (was 8, added 6, plus 1 self-ref)
- [x] All functions redeployed with `organization_id` references
- [x] Migration is idempotent

### RLS Policies Complete
- [ ] `medication_templates` has SELECT/INSERT/UPDATE/DELETE policies
- [ ] `domain_events` has authenticated INSERT policy

### RPC Migration Complete
- [ ] All 6 RPC functions deployed with SECURITY INVOKER
- [ ] `template.service.ts` uses only RPC (no `.from()`)
- [ ] `useEventHistory.ts` uses only RPC (no `.from()`)
- [ ] `event-emitter.ts` works with new RLS policy

### Security Mode Remediation Complete
- [ ] 2 CRITICAL functions changed to SECURITY INVOKER
- [ ] 10 HIGH priority functions changed to SECURITY INVOKER
- [ ] 7 MEDIUM priority functions changed to SECURITY INVOKER
- [ ] Existing functionality not broken by security mode changes

### Schema Sync Complete
- [x] All FK constraints in `CONSOLIDATED_SCHEMA.sql`
- [ ] All RLS policies in `CONSOLIDATED_SCHEMA.sql`
- [ ] All RPC functions in `CONSOLIDATED_SCHEMA.sql`
- [ ] All security mode changes in `CONSOLIDATED_SCHEMA.sql`

## Current Status

**Phase**: Phase 5 Complete - Ready for Phase 6
**Status**: ✅ Phases 1-5 COMPLETE
**Last Updated**: 2024-12-20
**Next Step**: Start Phase 6 - Add RLS policies for medication_templates table

## Reference: Architect Reviews

**RPC Design Review:**
`/home/lars/.claude/plans/lucky-watching-fern-agent-a7b6357.md`

Key recommendations:
1. Use SECURITY INVOKER (not DEFINER) for all RPC
2. DO NOT create event emission RPC - use RLS instead
3. Add RLS policies for medication_templates before RPC
4. Use `api.` schema for all functions

**Security Mode Review:**
`/home/lars/.claude/plans/lucky-watching-fern-agent-a80f068.md`

Key findings:
1. 2 CRITICAL functions with multi-tenant data leakage risk
2. 10 HIGH priority functions with RLS bypass
3. 7 MEDIUM priority functions need SECURITY INVOKER
4. Functions that should KEEP SECURITY DEFINER documented

**Schema Sync Requirement:**
All migration changes must be reflected in `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`
