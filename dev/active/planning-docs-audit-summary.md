# Planning Documentation Audit Summary

**Generated**: 2025-01-12
**Purpose**: Categorize 33 planning documents for documentation grooming Phase 3.5
**Total Files**: 27 files in `.plans/`, 6 files in `.archived_plans/`

---

## Executive Summary

### Categorization Overview

| Category | Count | Action |
|----------|-------|--------|
| **CURRENT** | 20 files (10 dirs) | Move to `documentation/architecture/` with `status: current` |
| **ASPIRATIONAL** | 10 files (6 dirs) | Move to `documentation/architecture/` with `status: aspirational` |
| **DEPRECATED** | 6 files (3 dirs) | Leave in place for historical reference |
| **SPECIAL** | 2 files | Manual processing (split + convert) |

### Key Findings

1. **Supabase Auth Migration Complete**: All authentication switched from Zitadel to Supabase Auth (completed 2025-10-27)
2. **Temporal Integration Operational**: Workflow orchestration deployed and running (since 2025-10-17)
3. **Organization Management Nearly Complete**: ~90% implemented (frontend, Edge Functions, database complete; Temporal backend pending)
4. **Multiple Aspirational Features**: Impersonation, event resilience, enterprise SSO planned but not implemented
5. **Zitadel Content is Deprecated**: All Zitadel references are historical; platform now uses Supabase Auth

---

## Detailed Categorization

## ✅ CURRENT (Already Implemented) - 18 files

### 1. `.plans/supabase-auth-integration/` - 4 files ✅ CURRENT
**Status**: ✅ Primary authentication provider (Migration completed 2025-10-27)

| File | Lines | Status | Destination |
|------|-------|--------|-------------|
| `overview.md` | Full | ✅ Current | `documentation/architecture/authentication/supabase-auth-overview.md` |
| `frontend-auth-architecture.md` | Full | ✅ Implemented | `documentation/architecture/authentication/frontend-auth-architecture.md` |
| `custom-claims-setup.md` | Full | ✅ Complete | `documentation/architecture/authentication/custom-claims-setup.md` |
| `enterprise-sso-guide.md` | Full | 📅 Aspirational (3-6 months) | `documentation/architecture/authentication/enterprise-sso-guide.md` + status tag |

**Evidence**: Status markers show "✅ Primary authentication provider", "Migration: Zitadel → Supabase Auth (Completed 2025-10-27)", frontend implementation complete.

**Categorization**: 3 CURRENT files + 1 ASPIRATIONAL (enterprise-sso-guide.md)

---

### 2. `.plans/temporal-integration/` - 4 files ✅ CURRENT
**Status**: ✅ Operational (Deployed 2025-10-17)

| File | Status | Destination |
|------|--------|-------------|
| `overview.md` | ✅ Operational | `documentation/architecture/workflows/temporal-overview.md` |
| `organization-onboarding-workflow.md` | ✅ Primary workflow | `documentation/architecture/workflows/organization-onboarding-workflow.md` |
| `activities-reference.md` | ✅ Complete reference | `documentation/workflows/reference/activities-reference.md` |
| `error-handling-and-compensation.md` | ✅ Complete guide | `documentation/workflows/guides/error-handling-and-compensation.md` |

**Evidence**: "Status: ✅ Operational (Deployed 2025-10-17)", used in production for organization bootstrap.

**Categorization**: All 4 files are CURRENT

---

### 3. `.plans/rbac-permissions/` - 3 files ✅ CURRENT (2 files) + ASPIRATIONAL (1 file)
**Status**: ✅ Integrated with Supabase Auth + Temporal.io (Last Updated: 2025-10-27)

| File | Status | Destination |
|------|--------|-------------|
| `architecture.md` | ✅ Integrated | `documentation/architecture/authorization/rbac-architecture.md` |
| `implementation-guide.md` | ✅ Frontend Complete (2025-10-27) | `documentation/architecture/authorization/rbac-implementation-guide.md` |
| `organizational-deletion-ux.md` | Design Specification (2025-10-21) | `documentation/architecture/authorization/organizational-deletion-ux.md` + status: aspirational |

**Evidence**: "Status: ✅ Integrated with Supabase Auth + Temporal.io", frontend implementation complete.

**Categorization**: 2 CURRENT files + 1 ASPIRATIONAL

---

### 4. `.plans/provider-partners/` - 2 files ✅ CURRENT (1 file) + ASPIRATIONAL (1 file)
**Status**: ✅ Integrated with Supabase Auth + Temporal.io (Last Updated: 2025-10-24)

| File | Status | Destination |
|------|--------|-------------|
| `architecture.md` | ✅ Integrated (v2.1) | `documentation/architecture/data/provider-partners-architecture.md` |
| `var-partnerships.md` | Implementation Specification | `documentation/architecture/data/var-partnerships.md` + status: aspirational |

**Evidence**: "Status: ✅ Integrated with Supabase Auth + Temporal.io", authentication and workflows operational.

**Categorization**: 1 CURRENT file + 1 ASPIRATIONAL

---

### 5. `.plans/organization-management/` - 1 file ✅ CURRENT
**Status**: ✅ Implementation Complete (~90%) (Last Updated: 2025-10-31)

| File | Status | Destination |
|------|--------|-------------|
| `architecture.md` | ✅ 90% Complete | `documentation/architecture/data/organization-management-architecture.md` |

**Evidence**: "Status: ✅ Implementation Complete (~90%)", frontend/Edge Functions/database complete, only Temporal backend pending.

**Categorization**: CURRENT (with note about pending Temporal backend)

---

### 6. `.plans/in-progress/` - 3 files ✅ CURRENT (2 files) + ASPIRATIONAL (1 file)

| File | Status | Destination |
|------|--------|-------------|
| `organization-management-module.md` | 🎉 Nearly Complete (~90%) | `documentation/architecture/data/organization-management-implementation.md` |
| `deployment-mode-refactoring.md` | ✅ Complete | `documentation/infrastructure/architecture/deployment-mode-refactoring.md` |
| `temporal-workflow-design.md` | 🎯 Design Complete - Not Implemented | `documentation/architecture/workflows/temporal-workflow-design.md` + status: aspirational |

**Evidence**: First two show completion status, third is "Design Complete - Ready for Implementation" (not implemented).

**Categorization**: 2 CURRENT + 1 ASPIRATIONAL

---

### 7. `.plans/auth-integration/` - 1 file ✅ CURRENT
**Status**: ✅ Updated for Supabase Auth + Temporal.io (Last Updated: 2025-10-27)

| File | Status | Destination |
|------|--------|-------------|
| `tenants-as-organization-thoughts.md` | ✅ Updated for Supabase Auth | `documentation/architecture/data/tenants-as-organizations.md` |

**Evidence**: "Status: ✅ Updated for Supabase Auth + Temporal.io integration", migration from Zitadel complete.

**Categorization**: CURRENT

---

## 📅 ASPIRATIONAL (Not Yet Implemented) - 9 files

### 8. `.plans/impersonation/` - 5 files 📅 ASPIRATIONAL
**Status**: Architectural Specification (Last Updated: 2025-10-09)

| File | Status | Destination |
|------|--------|-------------|
| `architecture.md` | Spec only | `documentation/architecture/authentication/impersonation-architecture.md` + status: aspirational |
| `implementation-guide.md` | Spec only | `documentation/architecture/authentication/impersonation-implementation-guide.md` + status: aspirational |
| `security-controls.md` | Spec only | `documentation/architecture/authentication/impersonation-security-controls.md` + status: aspirational |
| `ui-specification.md` | Spec only | `documentation/architecture/authentication/impersonation-ui-specification.md` + status: aspirational |
| `event-schema.md` | Spec only | `documentation/architecture/authentication/impersonation-event-schema.md` + status: aspirational |

**Evidence**: "Status: Architectural Specification", no implementation indicators, describes problem statement and future solution.

**Categorization**: All 5 files are ASPIRATIONAL

---

### 9. `.plans/event-resilience/` - 1 file 📅 ASPIRATIONAL
**Status**: Plan document (no last updated date)

| File | Status | Destination |
|------|--------|-------------|
| `plan.md` | Plan only | `documentation/frontend/architecture/event-resilience-plan.md` + status: aspirational |

**Evidence**: Lists "What's Missing" with ❌ checkboxes, describes "Proposed Solution", no implementation evidence.

**Categorization**: ASPIRATIONAL

---

### 10. `.plans/cloudflare-remote-access/` - 2 files 📅 ASPIRATIONAL (Uncertain)
**Status**: Started 2025-09-27, feature branch exists

| File | Status | Destination |
|------|--------|-------------|
| `plan.md` | In Progress? | `documentation/infrastructure/guides/cloudflare/remote-access-plan.md` + status: aspirational |
| `todo.md` | Task list | `documentation/infrastructure/guides/cloudflare/remote-access-todo.md` + status: aspirational |

**Evidence**: "Started: 2025-09-27", "Branch: feat/cloudflare-remote-access", unclear if merged or abandoned.

**Categorization**: ASPIRATIONAL (unclear completion status, treat as not implemented until verified)

---

## ❌ DEPRECATED (Leave in Place for Historical Reference) - 6 files

### 11. `.plans/zitadel-integration/` - 0 files ❌ DEPRECATED
**Status**: Empty directory

**Evidence**: `find` returned no markdown files, Zitadel replaced by Supabase Auth in 2025-10-27 migration.

**Action**: Leave empty directory, or consider adding README.md explaining deprecation.

---

### 12. `.archived_plans/zitadel/` - 3 files ❌ DEPRECATED

| File | Reason |
|------|--------|
| `ZITADEL-CURRENT-STATE.md` | Historical snapshot of Zitadel config |
| `ZITADEL-INVENTORY.md` | Zitadel resource inventory |
| `bootstrap-api-flows.md` | Zitadel-specific API integration |

**Evidence**: All files reference Zitadel Management API, organizations, and authentication flows that no longer exist after Supabase Auth migration.

**Action**: DO NOT MOVE. Leave in `.archived_plans/zitadel/` for historical reference.

---

### 13. `.archived_plans/provider-management/` - 3 files ❌ DEPRECATED

| File | Reason |
|------|--------|
| `bootstrap-workflows.md` | References Zitadel integration (line 5, 32) |
| `partner-bootstrap-sequence.md` | Zitadel-based bootstrap sequences |
| `provider-bootstrap-sequence.md` | Zitadel-based bootstrap sequences |

**Evidence**: First file explicitly mentions "proper Zitadel integration, role assignment" and includes Zitadel API calls in workflows. Superseded by Temporal workflows using Supabase Auth.

**Action**: DO NOT MOVE. Leave in `.archived_plans/provider-management/` for historical reference.

---

## ⚙️ SPECIAL CASES - REQUIRES MANUAL PROCESSING

### 14. `.plans/consolidated/` - 1 file ⚙️ SPLIT DOCUMENT

**File**: `agent-observations.md`

**Issue**: Contains valuable CQRS/event-sourcing documentation BUT references deprecated Zitadel architecture (lines 42-48).

**Decision**: SPLIT DOCUMENT

**Actions**:
1. **Extract CQRS Content** (CURRENT)
   - **Sections to extract**:
     - "CQRS/Event Sourcing Foundation"
     - "Core Principles"
     - "How It Works"
     - "Implications for Architecture"
     - Event-driven architecture patterns
   - **Remove**: All Zitadel references (lines 42-48: "Zitadel Cloud", "Zitadel organizations", etc.)
   - **Update to Supabase Auth**:
     - Multi-tenancy foundation → RLS with JWT claims
     - Organization management → Database records + Temporal workflows
     - Authentication → Supabase Auth (social login + SAML SSO)
   - **Add frontmatter**:
     ```yaml
     ---
     status: current
     last_updated: 2025-01-12
     source: .plans/consolidated/agent-observations.md
     ---
     ```
   - **Destination**: `documentation/architecture/data/event-sourcing-overview.md`

2. **Keep Zitadel Content** (DEPRECATED)
   - Leave Zitadel-specific architectural sections in `.plans/consolidated/`
   - Optionally rename original to `agent-observations-zitadel-deprecated.md`
   - Add note at top: "⚠️ DEPRECATED: This architecture used Zitadel. See event-sourcing-overview.md for current Supabase Auth architecture."
   - Keep for historical reference only

**Migration Notes**:
- Manual split required (cannot use `git mv`)
- Both resulting files should be tracked in migration report
- Add cross-reference in event-sourcing-overview.md: "For historical Zitadel-based architecture, see .plans/consolidated/agent-observations-zitadel-deprecated.md"

---

### 15. `.plans/multi-tenancy/` - 1 HTML file ⚙️ CONVERT TO MARKDOWN

**File**: `multi-tenancy-organization.html` (53KB)

**Issue**: HTML file (not markdown), references Zitadel architecture.

**Decision**: CONVERT TO MARKDOWN, UPDATE TO SUPABASE AUTH, MOVE AS CURRENT

**Actions**:

1. **Convert HTML → Markdown**
   - Use pandoc: `pandoc multi-tenancy-organization.html -o multi-tenancy-architecture.md`
   - Or manual conversion if pandoc doesn't preserve structure well
   - Convert diagrams to Mermaid if possible (check for embedded SVGs/images)
   - Preserve table structures and hierarchy

2. **Update Zitadel → Supabase Auth**
   - Find/replace these concepts:
     - "Zitadel organizations" → "Database organization records (`organizations_projection`)"
     - "Zitadel Management API" → "Supabase Auth + Temporal workflows"
     - "Zitadel OAuth2" → "Supabase Auth (social login + SAML SSO)"
     - "Organization-level isolation" → "RLS policies with JWT `org_id` claim"
     - "Zitadel project roles" → "RBAC permissions in database"
   - Update ltree path examples if references changed
   - Verify cross-tenant access patterns reflect RLS approach

3. **Add frontmatter**
   ```yaml
   ---
   status: current
   last_updated: 2025-01-12
   converted_from: multi-tenancy-organization.html
   migration_note: "Converted from HTML and updated from Zitadel to Supabase Auth architecture"
   ---
   ```

4. **Move to destination**
   - **Destination**: `documentation/architecture/data/multi-tenancy-architecture.md`
   - **Verification**: Review converted markdown for accuracy
   - **Testing**: Ensure all internal links work

**Migration Notes**:
- HTML to MD conversion required (use pandoc or manual)
- Comprehensive find/replace for Zitadel → Supabase Auth
- Verify technical accuracy after conversion (architecture patterns may have changed)
- Original HTML file can be removed after successful migration and verification
- Consider keeping HTML as backup temporarily during verification period

---

## Migration Summary by Destination

### `documentation/architecture/authentication/`
- ✅ supabase-auth-overview.md (CURRENT)
- ✅ frontend-auth-architecture.md (CURRENT)
- ✅ custom-claims-setup.md (CURRENT)
- 📅 enterprise-sso-guide.md (ASPIRATIONAL)
- 📅 impersonation-architecture.md (ASPIRATIONAL)
- 📅 impersonation-implementation-guide.md (ASPIRATIONAL)
- 📅 impersonation-security-controls.md (ASPIRATIONAL)
- 📅 impersonation-ui-specification.md (ASPIRATIONAL)
- 📅 impersonation-event-schema.md (ASPIRATIONAL)

### `documentation/architecture/authorization/`
- ✅ rbac-architecture.md (CURRENT)
- ✅ rbac-implementation-guide.md (CURRENT)
- 📅 organizational-deletion-ux.md (ASPIRATIONAL)

### `documentation/architecture/workflows/`
- ✅ temporal-overview.md (CURRENT)
- ✅ organization-onboarding-workflow.md (CURRENT)
- 📅 temporal-workflow-design.md (ASPIRATIONAL)

### `documentation/architecture/data/`
- ✅ provider-partners-architecture.md (CURRENT)
- 📅 var-partnerships.md (ASPIRATIONAL)
- ✅ organization-management-architecture.md (CURRENT)
- ✅ organization-management-implementation.md (CURRENT)
- ✅ tenants-as-organizations.md (CURRENT)
- ✅ event-sourcing-overview.md (CURRENT - from consolidated/agent-observations.md)

### `documentation/workflows/reference/`
- ✅ activities-reference.md (CURRENT)

### `documentation/workflows/guides/`
- ✅ error-handling-and-compensation.md (CURRENT)

### `documentation/frontend/architecture/`
- 📅 event-resilience-plan.md (ASPIRATIONAL)

### `documentation/infrastructure/architecture/`
- ✅ deployment-mode-refactoring.md (CURRENT)

### `documentation/infrastructure/guides/cloudflare/`
- 📅 remote-access-plan.md (ASPIRATIONAL)
- 📅 remote-access-todo.md (ASPIRATIONAL)

---

## Special Handling Required

### Files Requiring Manual Processing

#### 1. **`.plans/consolidated/agent-observations.md`** → SPLIT
- **CQRS content** → `documentation/architecture/data/event-sourcing-overview.md` (CURRENT)
- **Zitadel content** → Stays in `.plans/consolidated/` (DEPRECATED)
- **Actions**: Extract CQRS sections, remove Zitadel refs, update to Supabase Auth
- **Verification**: Ensure technical accuracy after split and updates

#### 2. **`.plans/multi-tenancy/multi-tenancy-organization.html`** → CONVERT
- **HTML → Markdown** conversion using pandoc
- **Zitadel → Supabase Auth** reference updates
- **Destination**: `documentation/architecture/data/multi-tenancy-architecture.md` (CURRENT)
- **Actions**: Convert format, update architecture references, verify accuracy
- **Verification**: Review converted markdown, test internal links

### Files Requiring Implementation Verification

These files have unclear status and need investigation before categorization:

#### 1. **`.plans/cloudflare-remote-access/`** (2 files) ⚠️ NEEDS VERIFICATION
**Current categorization**: ASPIRATIONAL
**User evidence**: Currently connected via SSH through Cloudflare proxy
**Likely status**: CURRENT (deployed and operational)

**Verification steps**:
- Check Cloudflare tunnel configuration (`~/.cloudflared/config.yml`)
- Verify SSH/VNC ingress rules exist
- Check DNS records for `access.firstovertheline.com` and `vnc.firstovertheline.com`
- Verify Cloudflare Access/Zero Trust policies configured
- Check systemd service status for cloudflared

**If verified as CURRENT**:
- Update categorization from ASPIRATIONAL → CURRENT
- Move both files to `documentation/infrastructure/guides/cloudflare/`
- Add completion status (if partial implementation)

---

#### 2. **`.plans/provider-partners/architecture.md`** ⚠️ NEEDS VERIFICATION
**Current categorization**: CURRENT (1 file) + ASPIRATIONAL (1 file)
**User feedback**: "Still aspirational, more work needed for organizations (frontend + data collection)"
**Corrected status**: ASPIRATIONAL (both files)

**Verification steps**:
- Check database schema for partner organization tables
- Verify cross_tenant_access_grants_projection exists
- Check RLS policies for cross-tenant access
- Search for partner-specific Temporal workflow logic
- Check frontend for partner organization UI components
- Assess actual completion percentage

**Expected correction**:
- Move `architecture.md` from CURRENT → ASPIRATIONAL
- Keep `var-partnerships.md` as ASPIRATIONAL
- Update file counts: CURRENT -1, ASPIRATIONAL +1

---

#### 3. **`.plans/event-resilience/plan.md`** ⚠️ NEEDS VERIFICATION
**Current categorization**: ASPIRATIONAL
**Status unclear**: Document lists "What's Missing" but unclear if any features implemented

**Verification steps**:
- Search frontend code for offline queue implementation
- Check for retry mechanism with exponential backoff
- Look for network status detection code
- Search for IndexedDB/localStorage persistence for events
- Look for circuit breaker pattern implementation
- Check for event reconciliation logic after reconnection

**Count implemented vs missing features**:
- If majority implemented → Recategorize as CURRENT with completion %
- If few/none implemented → Keep as ASPIRATIONAL
- Document findings in migration notes

---

#### 4. **`.plans/in-progress/temporal-workflow-design.md`** ⚠️ CORRECTION NEEDED
**Current categorization**: ASPIRATIONAL ("Design Complete - Ready for Implementation")
**User correction**: "At 80% - workflow implemented and deployed, part of organization creation"
**Corrected status**: CURRENT (80% complete)

**Evidence**:
- Implementation exists: `workflows/src/workflows/organization-bootstrap/workflow.ts` (303 lines)
- Workflow deployed but untested
- Part of organization creation flow

**Correction**:
- Move from ASPIRATIONAL → CURRENT
- **Destination**: `documentation/workflows/architecture/organization-bootstrap-workflow-design.md`
- **Add frontmatter**:
  ```yaml
  ---
  status: current
  completion: 80%
  implementation: workflows/src/workflows/organization-bootstrap/
  notes: "Workflow implemented and deployed. Needs testing and full integration."
  ---
  ```

---

### Updated File Counts (After Corrections)

**Before corrections**:
- CURRENT: 18 files
- ASPIRATIONAL: 9 files
- DEPRECATED: 6 files

**After corrections**:
- CURRENT: 18 files (temporal-workflow-design.md moves IN, provider-partners/architecture.md moves OUT → net 0)
- ASPIRATIONAL: 10 files (+1 from provider-partners/architecture.md, -1 from temporal-workflow-design.md → net +1)
- DEPRECATED: 6 files (unchanged)

**Special handling adds**:
- +1 CURRENT from consolidated/agent-observations.md split (CQRS content)
- +1 CURRENT from multi-tenancy HTML conversion
- Potentially +2 CURRENT from cloudflare-remote-access if verified

**Final estimated totals** (pending verification):
- CURRENT: 20-22 files
- ASPIRATIONAL: 9-10 files
- DEPRECATED: 6 files

---

## Files Staying in Place (Deprecated)

### `.archived_plans/zitadel/` (3 files)
- ZITADEL-CURRENT-STATE.md
- ZITADEL-INVENTORY.md
- bootstrap-api-flows.md

### `.archived_plans/provider-management/` (3 files)
- bootstrap-workflows.md
- partner-bootstrap-sequence.md
- provider-bootstrap-sequence.md

### `.plans/zitadel-integration/`
- Empty directory (no markdown files)

### `.plans/multi-tenancy/`
- multi-tenancy-organization.html (HTML file, out of scope)

---

## Recommended Actions

### Phase 3.5 Step 0: Verify Implementation Status ⚠️ PREREQUISITE
**Before executing migration**, complete verification of uncertain directories:

1. **Cloudflare remote access** - Check tunnel config, DNS, Zero Trust
2. **Provider partners** - Assess database schema, workflows, frontend UI
3. **Event resilience** - Count implemented vs missing features
4. **Temporal workflow** - Confirm 80% status and implementation location

**Update categorizations** based on verification findings.

---

### Phase 3.5 Step 1: Audit Complete ✅
This summary document serves as the audit (with verification pending).

---

### Phase 3.5 Step 2: Execute Migration
1. **Move CURRENT files** (18-22 files pending verification) → `documentation/architecture/` with `status: current` frontmatter
2. **Move ASPIRATIONAL files** (9-10 files pending verification) → `documentation/architecture/` with `status: aspirational` frontmatter + inline warning markers
3. **Leave DEPRECATED files** (6 files) in `.archived_plans/` for historical reference
4. **Special handling** (manual processing required):
   - **Split** `consolidated/agent-observations.md`:
     - CQRS content → `documentation/architecture/data/event-sourcing-overview.md` (CURRENT)
     - Zitadel content → stays in `.plans/consolidated/` (DEPRECATED)
   - **Convert** `multi-tenancy/multi-tenancy-organization.html`:
     - HTML → Markdown using pandoc
     - Update Zitadel → Supabase Auth references
     - Move to `documentation/architecture/data/multi-tenancy-architecture.md` (CURRENT)

---

### Phase 3.5 Step 3: Create README
- Create `.plans/README.md` explaining that active planning docs migrated to `documentation/architecture/`
- Note that deprecated Zitadel content remains in `.archived_plans/` for historical reference
- Link to new locations in documentation/
- Document special cases (split, converted files)

---

## Verification Checklist

After migration:
- [ ] 18 CURRENT files moved to `documentation/architecture/`
- [ ] 9 ASPIRATIONAL files moved with status tags
- [ ] 6 DEPRECATED files remain in `.archived_plans/`
- [ ] `.plans/README.md` created
- [ ] All moved files have YAML frontmatter
- [ ] ASPIRATIONAL files have inline warning markers
- [ ] Links updated in moved files
- [ ] Validation scripts confirm broken links are only in new locations (to be fixed in Phase 6.1)

---

## Notes for Phase 6.1 (Link Fixing)

After moving planning docs, update references in:
1. **Root CLAUDE.md**: Update references to authentication, RBAC, Temporal integration
2. **Component CLAUDE.md files**: Update planning doc references
3. **Existing documentation**: Update any links to `.plans/` directories
4. **Within moved files**: Update internal cross-references between planning docs
