# Context: Organization FK Constraints + RPC Migration + Security Remediation

> **IMPORTANT**: All migration file changes MUST be synced to `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`

## Decision Record

**Date**: 2024-12-20
**Feature**: Add FK constraints + migrate direct SQL to RPC + remediate security modes
**Goal**: Fix org-cleanup FK discovery, eliminate direct SQL anti-pattern, and fix RLS bypass risks

### Key Decisions

1. **ON DELETE RESTRICT (not CASCADE)**: Preserves explicit org-cleanup as authoritative deletion path. Aligns with CQRS pattern of explicit state changes.

2. **Column Rename for Consistency**: `user_roles_projection.org_id` → `organization_id`. Aligns with AsyncAPI contracts and all other tables.

3. **SECURITY INVOKER for RPC** (per architect review): All RPC functions use SECURITY INVOKER to respect RLS policies. SECURITY DEFINER only for cross-schema access.

4. **Event Emission: NO RPC** (per architect review): Keep existing `EventEmitter.ts` direct INSERT pattern. Add RLS policy to validate org_id and reason. Creating duplicate RPC would violate CQRS principle.

5. **RLS Policies Required**: Must add RLS for `medication_templates` before using SECURITY INVOKER RPC.

6. **Orphan-Tolerant Audit Tables**: `audit_log`, `api_audit_log` intentionally without FK for audit history preservation.

7. **Cross-Tenant Tables Excluded**: `cross_tenant_access_grants_projection`, `impersonation_sessions_projection` have no FK per user requirement.

8. **Security Mode Remediation** (per architect review): 19 existing functions incorrectly use SECURITY DEFINER, bypassing RLS. Must change to SECURITY INVOKER.

9. **Schema Sync Requirement**: All changes to migrations MUST be reflected in `CONSOLIDATED_SCHEMA.sql` to maintain single source of truth.

## Technical Context

### Architecture

**CQRS Principle** (from architect review):
> "In CQRS, the 'Write' side should be simple and consistent. All events go through the same validation and are stored identically. RPC for queries is fine; RPC for commands adds unnecessary abstraction."

**Before Migration**:
- 8 tables with FK to `organizations_projection`
- 6 tables with `organization_id` but NO FK
- 3 frontend files using direct `.from()` queries
- `role_permissions_projection` missed during cleanup

**After Migration**:
- 14 tables with FK to `organizations_projection`
- All child tables discoverable via recursive FK chain
- Frontend uses RPC for read queries
- Event emission stays as direct INSERT with RLS
- 19 functions changed to SECURITY INVOKER for proper RLS enforcement
- All changes synced to CONSOLIDATED_SCHEMA.sql

### Tech Stack

- **Database**: PostgreSQL via Supabase
- **RLS**: Row-level security using JWT claims
- **CQRS**: Event sourcing with projection tables
- **RPC**: Functions in `api.` schema with SECURITY INVOKER

## File Structure

### Existing Files Modified (Phases 1-5 Complete - 2024-12-20)

**Table Definitions:**
- `infrastructure/supabase/sql/02-tables/rbac/004-user_roles_projection.sql` - Column rename `org_id` → `organization_id`, updated indexes and comments

**Authorization Functions:**
- `infrastructure/supabase/sql/03-functions/authorization/001-user_has_permission.sql` - All `ur.org_id` → `ur.organization_id`
- `infrastructure/supabase/sql/03-functions/authorization/002-authentication-helpers.sql` - `is_org_admin` function updated
- `infrastructure/supabase/sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql` - JWT hook queries updated

**RLS Policies:**
- `infrastructure/supabase/sql/06-rls/001-core-projection-policies.sql` - Updated `user_roles_org_admin_select` policy
- `infrastructure/supabase/sql/06-rls/impersonation-policies.sql` - All 3 policies updated

**Triggers:**
- `infrastructure/supabase/sql/04-triggers/bootstrap-event-listener.sql` - Authorization queries updated

**Consolidated Schema:**
- `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` - Added 6 FK constraint blocks, updated all `ur.org_id` references

### New Files Created (2024-12-20)
- `infrastructure/supabase/sql/06-rls/005-domain-events-insert-policy.sql` - RLS INSERT + SELECT policies for domain_events
- `documentation/frontend/architecture/aspirational-features.md` - Documents medication_templates as aspirational feature

### Files Skipped (Phases 6-9 - No Table/Spec)
- `infrastructure/supabase/sql/06-rls/medication-templates-policies.sql` - **SKIPPED**: Table doesn't exist
- `infrastructure/supabase/sql/03-functions/api/medication-template-rpc.sql` - **SKIPPED**: Table doesn't exist
- `infrastructure/supabase/sql/03-functions/api/event-history-rpc.sql` - **SKIPPED**: Table doesn't exist

### Existing Files Modified (Phase 10 - 2024-12-20)
- `infrastructure/supabase/sql/03-functions/api/004-organization-queries.sql` - 3 functions → INVOKER
- `infrastructure/supabase/sql/03-functions/api/005-organization-unit-crud.sql` - 3 functions → INVOKER
- `infrastructure/supabase/sql/03-functions/workflows/003-projection-queries.sql` - 6 functions → INVOKER

### Files Kept As-Is
- `frontend/src/lib/events/event-emitter.ts` - Direct INSERT with RLS (per architect)

## Related Components

### Tables Getting FK Constraints (6 tables)
| Table | Column | Notes |
|-------|--------|-------|
| roles_projection | organization_id | Has child: role_permissions_projection |
| user_roles_projection | org_id → organization_id | Naming fixed |
| clients | organization_id | Clinical data |
| medications | organization_id | Clinical data |
| medication_history | organization_id | Clinical data |
| dosage_info | organization_id | Clinical data |

### RPC Functions (SECURITY INVOKER)
| Function | Purpose |
|----------|---------|
| `api.get_medication_templates()` | List templates with filters |
| `api.get_medication_template_by_id()` | Get single template |
| `api.upsert_medication_template()` | Create/update template |
| `api.delete_medication_template()` | Soft delete template |
| `api.increment_template_usage()` | Update usage stats |
| `api.get_event_history()` | Query event history |

### Security Mode Remediation - COMPLETED 2024-12-20
**12 api.* Query Functions Changed to SECURITY INVOKER:**
1. `api.get_organizations` - CRITICAL: Multi-tenant data query
2. `api.get_organization_by_id` - CRITICAL: Single org lookup
3. `api.get_child_organizations` - Organization hierarchy
4. `api.get_organization_units` - OU listing
5. `api.get_organization_unit_by_id` - Single OU lookup
6. `api.get_organization_unit_descendants` - OU hierarchy
7. `api.get_pending_invitations_by_org` - Invitation queries
8. `api.get_invitation_by_org_and_email` - Specific invitation lookup
9. `api.get_organization_status` - Org status check
10. `api.get_contacts_by_org` - Contact queries
11. `api.get_addresses_by_org` - Address queries
12. `api.get_phones_by_org` - Phone queries

### Functions Keeping SECURITY DEFINER (legitimate reasons)
**Authorization Functions** (used in RLS policies - must execute with elevated privileges):
- `user_has_permission` - Called by RLS policies
- `user_permissions` - Called by RLS policies
- `user_organizations` - Called by RLS policies
- `is_super_admin` - Called by RLS policies
- `is_provider_admin` - Called by RLS policies
- `switch_organization` - Modifies user context

**Impersonation Functions** (cross-org audit access needed):
- `get_user_active_impersonation_sessions` - super_admin only
- `get_org_impersonation_audit` - Audit access
- `get_impersonation_session_details` - Audit access

**Other DEFINER Functions**:
- `custom_access_token_hook` - JWT hook, no user context
- `api.emit_domain_event` - Append-only event store
- CRUD functions (create/update/deactivate OU) - INSERT into domain_events
- Workflow idempotency checks
- Saga compensation functions
- `get_current_user_id` - Test override support

## Key Patterns and Conventions

### RPC Pattern (from existing code)
```typescript
// Good pattern - use RPC
const { data } = await supabase.rpc('get_medication_templates', {
  p_search_term: searchTerm,
  p_is_active: true
});
```

### SECURITY INVOKER Pattern
```sql
CREATE OR REPLACE FUNCTION api.get_medication_templates(...)
RETURNS SETOF medication_templates
SECURITY INVOKER  -- RLS policies apply
SET search_path = public, pg_temp
LANGUAGE plpgsql STABLE AS $$
```

### JWT to Database Mapping
- JWT claims use `org_id` (Supabase standard)
- Database columns use `organization_id` (our convention)
- Auth layer maps between them

## Reference Materials

- `/home/lars/.claude/plans/lucky-watching-fern.md` - Complete plan with SQL
- `/home/lars/.claude/plans/lucky-watching-fern-agent-a7b6357.md` - Architect review (RPC design)
- `/home/lars/.claude/plans/lucky-watching-fern-agent-a80f068.md` - Architect review (security modes)
- `.claude/commands/org-cleanup.md` - Cleanup command using FK discovery

## Important Constraints

1. **Orphan Check Required**: FK constraints cannot be added if orphaned records exist
2. **Order Matters**: Column rename before FK constraint for user_roles_projection
3. **RLS Before RPC**: medication_templates RLS policies must exist before SECURITY INVOKER works
4. **No Frontend Changes for Column Rename**: Mapping layer handles it
5. **Schema Sync Required**: ALL migration changes must be synced to `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql`

## Session Notes (2024-12-20)

### Orphan Cleanup Discovery (Phase 1)
- Found 7 orphaned `roles_projection` records with non-existent `organization_id`
- Found 112 orphaned `role_permissions_projection` records (children of orphaned roles)
- **Critical**: Must delete children first due to FK constraints
- Deletion order: `role_permissions_projection` → `roles_projection`

### FK Verification Results (Phase 5)
- **FK count**: 15 tables now linked to `organizations_projection`
  - 8 original + 6 new + 1 self-reference (`referring_partner_id`)
- **Column rename verified**: `organization_id` (not `org_id`)
- All 6 new constraints visible in `information_schema.table_constraints`

### Functions Redeployed (Phase 5)
9 functions redeployed with updated `organization_id` references:
1. `is_org_admin`
2. `user_has_permission`
3. `user_permissions`
4. `is_super_admin`
5. `is_provider_admin`
6. `user_organizations`
7. `custom_access_token_hook`
8. `switch_organization`
9. `get_user_claims_preview`

### RLS Policies Redeployed (Phase 5)
3 impersonation session policies redeployed:
1. `impersonation_sessions_super_admin_select`
2. `impersonation_sessions_provider_admin_select`
3. `impersonation_sessions_own_sessions_select`

### medication_templates Discovery (Phase 6 - SKIPPED)
- `medication_templates` table does NOT exist in Supabase database
- Frontend service exists at `frontend/src/services/medications/template.service.ts`
- Types defined at `frontend/src/types/medication-template.types.ts`
- Permission `medication.create_template` is defined
- **Resolution**: Documented as aspirational feature, skipped Phases 6, 7, 9

### domain_events RLS Policies Added (Phase 8)
Two new policies applied via MCP:
1. `domain_events_authenticated_insert` - INSERT policy validating:
   - User authenticated (`auth.uid() IS NOT NULL`)
   - org_id matches JWT claim OR is super_admin
   - reason >= 10 characters
2. `domain_events_org_select` - SELECT policy for org-scoped read access

### Security Mode Remediation Results (Phase 10)
- Changed 12 api.* functions from DEFINER to INVOKER
- Authorization functions kept as DEFINER (used in RLS policies)
- CRUD functions kept as DEFINER (INSERT into domain_events)
- Applied via MCP, then updated source SQL files to match

### Final Verification Results (Phase 11)
- domain_events RLS policies: **3** (super_admin_all + authenticated_insert + org_select)
- organizations_projection FK constraints: **15** (was 8, added 6, plus 1 self-ref)
- api.* SECURITY INVOKER functions: **12** (was 0)

## Why This Approach?

### Why SECURITY INVOKER (not DEFINER)?
- DEFINER bypasses RLS entirely
- INVOKER respects RLS, user's JWT org_id used for filtering
- No privilege escalation risk
- Aligns with existing `api.` schema patterns

### Why Keep Event Emission as Direct INSERT?
Per architect review:
- `api.emit_domain_event` already exists for Temporal workflows
- Creating frontend duplicate violates single event path principle
- RLS policy provides same security without new RPC
- Maintains CQRS purity

### Why Add RLS for medication_templates?
- No RLS policies found in codebase for this table
- Required for SECURITY INVOKER RPC to work correctly
- Prevents cross-tenant data access
