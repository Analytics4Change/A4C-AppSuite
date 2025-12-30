# Context: Documentation Alignment

## Decision Record

**Date**: 2025-12-30
**Feature**: Documentation alignment with codebase implementation
**Goal**: Ensure `/documentation/` accurately reflects actual codebase state

### Key Decisions

1. **Table Documentation Strategy**: Create individual `.md` files for undocumented tables following existing pattern in `table-template.md`

2. **Status Markers for Aspirational Features**: Changed impersonation and provider partner docs from `status: aspirational` to `status: current` with detailed inline warnings about incomplete implementations

3. **Audit Trail Architecture**: Clarified that `domain_events` is the SOLE audit mechanism - removed all references to non-existent `audit_log` and `audit_log_projection` tables

4. **Activity Count Correction**: Verified actual activity count is 13 (7 forward + 6 compensation), not 12 as documented

5. **Impersonation Implementation Status**: Infrastructure scaffolded but end-to-end NOT functional:
   - DB schema exists (`impersonation_sessions_projection`)
   - Frontend UI exists but uses hardcoded mock data
   - No backend RPC to start sessions
   - JWT claims NOT swapped during impersonation

6. **Provider Partner Implementation Status**: Foundation implemented, management UI NOT built:
   - Organization creation works for all partner types
   - No UI for cross-tenant access grants

## Technical Context

### Architecture
- CQRS/Event Sourcing with `domain_events` as source of truth
- PostgreSQL with 29 tables (now all documented)
- Temporal.io workflows with 13 activities
- Row-Level Security (RLS) for multi-tenancy

### Database Schema
- 29 tables total (was incorrectly documented as 12)
- 19 existing table docs + 10 new docs created
- Junction tables for many-to-many relationships
- All projections derived from `domain_events`

### Workflow Activities (Correct List)
**Forward (7)**:
1. createOrganization
2. grantProviderAdminPermissions
3. configureDNS
4. verifyDNS
5. generateInvitations
6. sendInvitationEmails
7. activateOrganization

**Compensation (6)**:
1. deactivateOrganization
2. removeDNS
3. revokeInvitations
4. deleteContacts
5. deleteAddresses
6. deletePhones

## File Structure

### New Files Created (2025-12-30)
- `documentation/infrastructure/reference/database/tables/organization_contacts.md`
- `documentation/infrastructure/reference/database/tables/organization_addresses.md`
- `documentation/infrastructure/reference/database/tables/organization_phones.md`
- `documentation/infrastructure/reference/database/tables/contact_addresses.md`
- `documentation/infrastructure/reference/database/tables/contact_phones.md`
- `documentation/infrastructure/reference/database/tables/phone_addresses.md`
- `documentation/infrastructure/reference/database/tables/workflow_queue_projection.md`
- `documentation/infrastructure/reference/database/tables/organization_business_profiles_projection.md`
- `documentation/infrastructure/reference/database/tables/impersonation_sessions_projection.md`
- `documentation/infrastructure/reference/database/tables/_migrations_applied.md`

### Existing Files Modified (2025-12-30)
- `CLAUDE.md` - Updated table count (12 → 29)
- `documentation/README.md` - Updated table count, removed "Not Yet Documented" section
- `documentation/MIGRATION_REPORT.md` - Added update note about expanded table docs
- `documentation/AGENT-INDEX.md` - Added 12 new keyword entries
- `documentation/infrastructure/reference/database/table-template.md` - Fixed audit_log reference
- 5 impersonation docs - Changed status, added implementation warnings
- 2 provider partner docs - Updated status markers
- 6 workflow docs - Corrected activity counts (12 → 13)
- 4 table docs - Removed audit_log references (clients, medications, users, event_types)

## Important Constraints

- **AGENT-GUIDELINES.md Compliance**: All docs must have YAML frontmatter (`status`, `last_updated`), TL;DR sections, and Related Documentation sections
- **Status Markers**: Use `current` for partially implemented features with inline warnings, not `aspirational`
- **domain_events as Audit**: No separate audit table - query `domain_events` with `event_metadata->>'user_id'` for audit trails

## Reference Materials

- Plan file: `/home/lars/.claude/plans/piped-pondering-eagle.md`
- Template: `documentation/infrastructure/reference/database/table-template.md`
- Guidelines: `documentation/AGENT-GUIDELINES.md`

## Why This Approach?

Chose to update status markers to `current` with detailed warnings rather than keeping `aspirational` because:
1. Infrastructure actually exists (DB schema, frontend components)
2. Developers need to know what works vs what's broken
3. More actionable than generic "not implemented" message
