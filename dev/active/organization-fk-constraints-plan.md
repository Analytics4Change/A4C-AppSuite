# Implementation Plan: Organization FK Constraints + RPC Migration + Security Remediation

> **IMPORTANT**: All migration file changes MUST be synced to `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`

## Executive Summary

This migration addresses three issues discovered during org-cleanup and architect review:
1. **Missing FK constraints**: 6 tables have `organization_id` but no FK to `organizations_projection`, breaking recursive FK discovery
2. **Direct SQL anti-pattern**: Frontend files use `.from()` queries instead of RPC, creating maintenance burden
3. **Security mode issues**: 19 existing RPC functions use SECURITY DEFINER when they should use SECURITY INVOKER to respect RLS

Per software architect review, we also add required RLS policies and keep event emission as direct INSERT (not RPC).

## Phase 1: FK Constraints Migration (5 phases)

### 1.1 Pre-Migration Validation
- Check for orphaned records in 6 tables
- Search SQL files for `org_id` references needing update

### 1.2 Create Migration
- Rename `user_roles_projection.org_id` → `organization_id`
- Add 6 FK constraints with ON DELETE RESTRICT
- Test idempotency locally

### 1.3 Update SQL Files
- Update RLS policies referencing `org_id`
- Update bootstrap listener authorization queries

### 1.4 Update Consolidated Schema
- Add FK constraint definitions
- Update column name in user_roles_projection

### 1.5 Deploy & Verify
- Apply migration to Supabase
- Verify FK count = 14 (was 8)
- Run `/org-cleanup-dryrun` to confirm complete discovery

## Phase 2: RLS Policies (per architect review)

### 2.1 Medication Templates RLS
- Create SELECT, INSERT, UPDATE, DELETE policies
- Policies use JWT `org_id` claim for validation

### 2.2 Domain Events INSERT RLS
- Create INSERT policy for authenticated users
- Validates: user authenticated, org_id matches, reason >= 10 chars
- Enables existing EventEmitter to work with RLS protection

## Phase 3: RPC Migration (SECURITY INVOKER)

### 3.1 Create RPC Functions
Per architect review, all use SECURITY INVOKER (not DEFINER) to respect RLS:
- `api.get_medication_templates()`
- `api.get_medication_template_by_id()`
- `api.upsert_medication_template()`
- `api.delete_medication_template()`
- `api.increment_template_usage()`
- `api.get_event_history()`

### 3.2 Migrate Frontend
- Update `template.service.ts` to use RPC
- Update `useEventHistory.ts` to use RPC
- **KEEP** `event-emitter.ts` as direct INSERT (protected by new RLS)

## Phase 4: Security Mode Remediation (per architect review)

### 4.1 Critical Functions (Multi-tenant data leakage risk)
- `api.get_organizations` → SECURITY INVOKER
- `api.get_organization_by_id` → SECURITY INVOKER

### 4.2 High Priority (10 functions)
- Authorization: `user_has_permission`, `user_permissions`, `user_organizations`
- Impersonation: `get_user_active_impersonation_sessions`, `get_org_impersonation_audit`, `get_impersonation_session_details`
- API projections: `api.get_child_organizations`, `api.get_pending_invitations_by_org`, `api.get_invitation_by_org_and_email`, `api.get_contacts_by_org`, `api.get_addresses_by_org`, `api.get_phones_by_org`

### 4.3 Medium Priority (7 functions)
- Admin checks: `is_super_admin`, `is_provider_admin`
- Org operations: `switch_organization`, `api.get_organization_status`
- OU queries: `api.get_organization_units`, `api.get_organization_unit_by_id`, `api.get_organization_unit_descendants`

### 4.4 Sync All Changes
- Update all changed functions in `CONSOLIDATED_SCHEMA.sql`

## Success Metrics

### Immediate
- [ ] FK count = 14 (was 8)
- [ ] Column renamed successfully
- [ ] All RLS policies in place

### Feature Complete
- [ ] `role_permissions_projection` discoverable at depth 2
- [ ] `/org-cleanup-dryrun` shows complete plan
- [ ] Frontend uses RPC for templates and history
- [ ] Event emission works with RLS

### Security Remediation
- [ ] 2 CRITICAL functions changed to SECURITY INVOKER
- [ ] 10 HIGH priority functions changed to SECURITY INVOKER
- [ ] 7 MEDIUM priority functions changed to SECURITY INVOKER
- [ ] All changes synced to `CONSOLIDATED_SCHEMA.sql`

## Risk Mitigation

1. **Orphaned records**: Check before adding FK
2. **SECURITY mode**: Use INVOKER to respect RLS
3. **Event emission**: Keep existing pattern, add RLS (per architect)
4. **Schema sync**: All migration changes reflected in CONSOLIDATED_SCHEMA.sql

## Next Steps After Completion

1. Run `/org-cleanup-dryrun` to verify complete discovery
2. Monitor RLS policy performance
3. Test security mode changes don't break existing functionality
4. Consider frontend tests for RPC migration
