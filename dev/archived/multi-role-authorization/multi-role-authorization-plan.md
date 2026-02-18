# Implementation Plan: Multi-Role Authorization Architecture

## Executive Summary

A4C-AppSuite requires multi-role authorization to support the medication management and behavioral analytics domain. Line staff work shifts at specific Organization Units (OUs), are assigned to specific clients, and have role-based permissions determining what data they can collect (medication administration, incident reports, sleep tracking, etc.).

The current single-role JWT architecture cannot support this. Two approaches are under consideration:
1. **Option A**: RBAC Enhancement with Assignment Tables - Expand JWT to include role-scope pairs, add assignment tables for user-client and user-shift relationships
2. **Option B**: Full ReBAC (Relationship-Based Access Control) - Implement SpiceDB or Auth0 FGA for comprehensive relationship-based authorization

## Phase 1: Architecture Decision

### 1.1 Complete Research Analysis
- Evaluate Option A (RBAC + Assignments) vs Option B (ReBAC) against domain requirements
- Model specific access control scenarios for the behavioral analytics domain
- Determine JWT size implications for 4-10 roles per user
- Assess infrastructure cost/complexity of ReBAC solutions

### 1.2 Decision Documentation
- Document final architecture decision with rationale
- Create Architecture Decision Record (ADR)
- Update AGENT-INDEX.md with new authorization documentation

## Phase 2: JWT Restructure (If Option A Selected)

### 2.1 JWT Hook Modification
- Modify `custom_access_token_hook` to build `role_scopes` array
- Include all active roles with their scope_paths
- Maintain backward compatibility with `claims_version` bump

### 2.2 RLS Helper Functions
- Create `get_scope_for_permission(p_permission text) RETURNS ltree`
- Create `has_permission_at_path(p_permission text, p_target ltree) RETURNS boolean`
- Update existing helpers to support new JWT structure

### 2.3 RLS Policy Migration
- Audit all RLS policies using `get_current_scope_path()`
- Migrate to permission-scoped checks
- Test with multi-role user scenarios

## Phase 3: Assignment Tables

### 3.1 User-Client Assignment
- Create `user_client_assignments` table with event sourcing
- Implement RLS policies combining permission + assignment checks
- Create API functions for assignment management

### 3.2 User-Shift Assignment
- Create `user_shift_assignments` table for shift-based OU access
- Implement query-time scope resolution (not JWT-based)
- Support time-bounded assignments

## Phase 4: Frontend Integration

### 4.1 JWT Parsing Updates
- Update auth types for new JWT structure
- Modify permission checking hooks
- Remove single-role assumptions

### 4.2 Assignment UI
- Role assignment UI (bulk assignment feature - original request)
- Client assignment UI
- Shift scheduling UI

## Phase 5: ReBAC Implementation (If Option B Selected)

### 5.1 Infrastructure Setup
- Evaluate SpiceDB vs Auth0 FGA
- Deploy chosen solution
- Create relationship schema

### 5.2 Integration
- Create authorization service abstraction
- Migrate permission checks to ReBAC
- Implement RLS bypass with Edge Function authorization

## Success Metrics

### Immediate
- [ ] Architecture decision documented with clear rationale
- [ ] Proof of concept demonstrates multi-role user accessing resources at different scopes

### Medium-Term
- [ ] JWT structure supports 4-10 roles without size issues
- [ ] RLS policies correctly enforce permission + scope + assignment checks
- [ ] Bulk role assignment feature functional

### Long-Term
- [ ] Staff can be assigned to shifts and clients dynamically
- [ ] Data collection permissions enforced per client assignment
- [ ] Audit trail for all authorization decisions

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| JWT size exceeds limits | Permission deduplication, effective permissions cache |
| RLS performance with assignment joins | Index optimization, query analysis |
| Migration breaks existing users | Backward-compatible claims, phased rollout |
| ReBAC infrastructure complexity | Start with Auth0 FGA (managed) if selected |

## Phase 8: JWT v4 Edge Function + RLS Remediation (2026-02-18)

> **Reopened**: Phase 5B "Strip Deprecated Claims" was marked complete on 2026-01-26 but missed
> 3 Edge Functions and 2 RLS policies that still reference removed v3 JWT fields.

### 8.1 Shared JWT v4 Types for Edge Functions
- Add `EffectivePermission`, `JWTPayload`, `hasPermission()` to `_shared/types.ts`
- TypeScript equivalent of SQL `has_permission(p_permission text)` (baseline:9927)

### 8.2 Fix 3 Edge Functions
- `invite-user/index.ts`: `jwtPayload.permissions` → `jwtPayload.effective_permissions`
- `manage-user/index.ts`: same fix, 4 permission checks
- `organization-bootstrap/index.ts`: same fix, 1 permission check
- Delete local `JWTPayload` interfaces, import shared types

### 8.3 Fix 2 RLS Policies (migration)
- `permission_implications_modify`: `user_role = 'super_admin'` → `has_platform_privilege()`
- `user_notification_prefs_select_own`: `app_metadata.org_id` → `get_current_org_id()`

### 8.4 Deploy + Verify
- Deploy 3 Edge Functions via MCP `deploy_edge_function`
- Apply migration via MCP `apply_migration`
- Run MCP security advisors

### Why NOT `has_org_admin_permission()`
Edge Functions check granular permissions (`user.create`, `user.delete`, `organization.create_root`)
that are NOT in the `has_org_admin_permission()` fixed set. Only 1 of 5 overlaps.
The correct SQL equivalent is `has_permission(p_permission)`, but Edge Functions shouldn't
call it via RPC — they already have the decoded JWT in-memory after `getUser()` validation.

## Next Steps After Completion

1. Archive dev-docs to `dev/archived/multi-role-authorization/`
2. Document Edge Function permission pattern in `documentation/` to prevent future drift
3. Implement Clients domain (depends on authorization architecture)
4. Implement shift scheduling system
5. Build data collection modules (medication, incidents, sleep, activities)
6. Implement analytics and correlation reporting
