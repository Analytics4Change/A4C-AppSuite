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

## Phase 6: Add RLS for medication_templates ⏭️ SKIPPED

**Reason**: `medication_templates` table does not exist in Supabase database.
**Resolution**: Documented as aspirational feature in `documentation/frontend/architecture/aspirational-features.md`

- [~] Create `infrastructure/supabase/sql/06-rls/medication-templates-policies.sql` - SKIPPED (no table)
- [~] Add SELECT/INSERT/UPDATE/DELETE policies - SKIPPED (no table)
- [~] Verify RLS is enabled on table - SKIPPED (no table)

## Phase 7: Create RPC Functions (SECURITY INVOKER) ⏭️ SKIPPED

**Reason**: Blocked by Phase 6 - `medication_templates` table does not exist.

- [~] Create `infrastructure/supabase/sql/03-functions/api/medication-template-rpc.sql` - SKIPPED
- [~] Implement template RPC functions - SKIPPED
- [~] Create `infrastructure/supabase/sql/03-functions/api/event-history-rpc.sql` - SKIPPED

## Phase 8: Add RLS for domain_events INSERT (per architect) ✅ COMPLETE

- [x] Create `infrastructure/supabase/sql/06-rls/005-domain-events-insert-policy.sql`
- [x] Create `domain_events_authenticated_insert` policy
- [x] Policy validates: user authenticated (`auth.uid() IS NOT NULL`)
- [x] Policy validates: org_id matches JWT claim OR is super_admin
- [x] Policy validates: reason >= 10 chars
- [x] Create `domain_events_org_select` policy for read access
- [x] Deploy policies to Supabase via MCP

## Phase 9: Migrate Frontend to RPC ⏭️ SKIPPED

**Reason**: Blocked by Phase 7 - no RPC functions to migrate to.

- [~] Update `frontend/src/services/medications/template.service.ts` - SKIPPED
- [~] Update `frontend/src/hooks/useEventHistory.ts` - SKIPPED
- [x] KEEP `frontend/src/lib/events/event-emitter.ts` AS-IS - Works with new RLS policy

## Phase 10: Security Mode Remediation (per architect review) ✅ COMPLETE

**Updated 2024-12-20**: Changed 12 api.* query functions to SECURITY INVOKER

### Critical (Multi-tenant data leakage risk) ✅
- [x] Change `api.get_organizations` to SECURITY INVOKER
- [x] Change `api.get_organization_by_id` to SECURITY INVOKER
- [x] Verify RLS policies exist on `organizations_projection`

### High Priority - API Functions ✅
- [x] Change `api.get_child_organizations` to SECURITY INVOKER
- [x] Change `api.get_pending_invitations_by_org` to SECURITY INVOKER
- [x] Change `api.get_invitation_by_org_and_email` to SECURITY INVOKER
- [x] Change `api.get_contacts_by_org` to SECURITY INVOKER
- [x] Change `api.get_addresses_by_org` to SECURITY INVOKER
- [x] Change `api.get_phones_by_org` to SECURITY INVOKER

### Medium Priority - OU Query Functions ✅
- [x] Change `api.get_organization_status` to SECURITY INVOKER
- [x] Change `api.get_organization_units` to SECURITY INVOKER
- [x] Change `api.get_organization_unit_by_id` to SECURITY INVOKER
- [x] Change `api.get_organization_unit_descendants` to SECURITY INVOKER

### Authorization Functions - KEPT AS DEFINER (Used in RLS policies)
- [ ] `user_has_permission` - DEFINER (required for RLS policy evaluation)
- [ ] `user_permissions` - DEFINER (required for RLS policy evaluation)
- [ ] `user_organizations` - DEFINER (required for RLS policy evaluation)
- [ ] `is_super_admin` - DEFINER (called by RLS policies)
- [ ] `is_provider_admin` - DEFINER (called by RLS policies)
- [ ] `switch_organization` - DEFINER (modifies user context)

### Impersonation Functions - KEPT AS DEFINER (Cross-org access needed)
- [ ] `get_user_active_impersonation_sessions` - DEFINER (super_admin only)
- [ ] `get_org_impersonation_audit` - DEFINER (audit access)
- [ ] `get_impersonation_session_details` - DEFINER (audit access)

### Source Files Updated
- [x] `infrastructure/supabase/sql/03-functions/api/004-organization-queries.sql`
- [x] `infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql`
- [x] `infrastructure/supabase/sql/03-functions/workflows/003-projection-queries.sql`

## Phase 11: Final Verification ✅ COMPLETE

- [~] Run frontend tests to verify RPC migration - SKIPPED (no RPC migration done)
- [~] Test medication templates functionality - SKIPPED (no table exists)
- [~] Test event history display - SKIPPED (no RPC created)
- [x] Verify domain_events RLS policies deployed (3 policies confirmed)
- [x] Verify security mode changes applied (12 functions → INVOKER)
- [x] Confirm FK constraint count (15 total)
- [ ] Run `/org-cleanup-dryrun` to confirm complete table discovery - Optional future test

## Success Validation Checkpoints

### FK Constraints Complete ✅
- [x] Column renamed: `user_roles_projection.org_id` → `organization_id`
- [x] 6 tables have new FK constraints
- [x] FK count = 15 (was 8, added 6, plus 1 self-ref)
- [x] All functions redeployed with `organization_id` references
- [x] Migration is idempotent

### RLS Policies Complete ✅ (Partial)
- [~] `medication_templates` has SELECT/INSERT/UPDATE/DELETE policies - SKIPPED (no table)
- [x] `domain_events` has authenticated INSERT policy
- [x] `domain_events` has org-scoped SELECT policy

### RPC Migration Complete ⏭️ SKIPPED
- [~] All 6 RPC functions deployed - SKIPPED (no table for templates)
- [~] `template.service.ts` uses only RPC - SKIPPED
- [~] `useEventHistory.ts` uses only RPC - SKIPPED
- [x] `event-emitter.ts` works with new RLS policy

### Security Mode Remediation Complete ✅
- [x] 2 CRITICAL functions changed to SECURITY INVOKER
- [x] 6 HIGH priority functions changed to SECURITY INVOKER
- [x] 4 MEDIUM priority functions changed to SECURITY INVOKER
- [x] Total: 12 api.* functions changed to INVOKER
- [x] Authorization functions intentionally kept as DEFINER (RLS usage)

### Schema Sync Complete ✅
- [x] All FK constraints in `CONSOLIDATED_SCHEMA.sql`
- [x] domain_events RLS policies in `CONSOLIDATED_SCHEMA.sql` - Added 2024-12-20
- [~] RPC functions in `CONSOLIDATED_SCHEMA.sql` - SKIPPED (no RPC created)
- [x] Security mode changes in `CONSOLIDATED_SCHEMA.sql` - 12 functions → INVOKER

## Current Status

**Phase**: ALL IMPLEMENTABLE PHASES COMPLETE
**Status**: ✅ Phases 1-5, 8, 10, 11 COMPLETE | ⏭️ Phases 6, 7, 9 SKIPPED
**Skipped Reason**: `medication_templates` table does not exist - documented as aspirational
**Last Updated**: 2024-12-20
**Completed By**: Claude Code

### Verification Results (2024-12-20)
- domain_events RLS policies: **3** (super_admin_all + authenticated_insert + org_select)
- organizations_projection FK constraints: **15** (was 8, added 6, plus 1 self-ref)
- api.* SECURITY INVOKER functions: **12** (was 0)

### Schema Sync Tasks ✅ COMPLETE
- [x] Sync domain_events RLS policies to CONSOLIDATED_SCHEMA.sql
- [x] Sync security mode changes to CONSOLIDATED_SCHEMA.sql (12 functions)

### Next Steps (If Resuming)
1. Commit all changes (7 modified files, 2 new files)
2. Archive these dev-docs to `dev/archived/organization-fk-constraints/`

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
