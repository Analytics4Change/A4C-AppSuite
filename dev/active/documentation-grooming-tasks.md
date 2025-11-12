# Tasks: Documentation Grooming & Reorganization

## Phase 0: Discovery & Planning ✅ COMPLETE

- [x] Scan repository for all markdown files
- [x] Categorize files (stay vs move)
- [x] Clarify user requirements (multiple rounds)
- [x] Design standardized structure across all components
- [x] Discover and remove deprecated temporal/ directory
- [x] Address .plans/ categorization challenge
- [x] Identify CI/CD workflow updates needed
- [x] Resolve uniformity vs co-locality question
- [x] Create dev-docs (plan, context, tasks)
- [x] Update plan with all refinements

## Phase 1: Structure Creation & Planning 🚧 IN PROGRESS

### 1.1 Create Directory Structure ✅ COMPLETE
- [x] Create `documentation/` root directory
- [x] Create `documentation/README.md` skeleton
- [x] Create `documentation/templates/` (shared templates)
- [x] Create standard component directories:
  - [x] `documentation/frontend/` structure
    - [x] getting-started/
    - [x] architecture/
    - [x] guides/
    - [x] reference/ (with api/, components/ subdirs)
    - [x] patterns/
    - [x] testing/
    - [x] performance/
  - [x] `documentation/workflows/` structure
    - [x] getting-started/
    - [x] architecture/
    - [x] guides/
    - [x] reference/
    - [x] testing/
    - [x] operations/
  - [x] `documentation/infrastructure/` structure
    - [x] getting-started/
    - [x] architecture/
    - [x] guides/ (with database/, kubernetes/, supabase/ subdirs)
    - [x] reference/ (with database/, kubernetes/ subdirs)
    - [x] testing/
    - [x] operations/ (with deployment/, configuration/, troubleshooting/ subdirs)
- [x] Create cross-cutting directories:
  - [x] `documentation/architecture/` (with authentication/, authorization/, data/, workflows/ subdirs)
  - [x] `documentation/archived/`

### 1.2 Create Master Index Template ✅ COMPLETE
- [x] Create comprehensive table of contents structure
- [x] Add quick links section
- [x] Add documentation by audience section (developer, operator, architect)
- [x] Add organization explanation
- [x] Add status legend for annotations (current, aspirational, archived)
- [x] Add navigation tips

### 1.3 Create Validation Scripts
- [ ] Create markdown file finder script (exclude node_modules, .git, dev/)
- [ ] Create file categorization script (stay vs move)
- [ ] Create link validation script (check internal links)
- [ ] Test scripts on current repository
- [ ] Document script usage

## Phase 2: Implementation Tracking Document Migration ⏸️ PENDING

### 2.1 Identify WIP Tracking Documents
- [ ] Audit SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md
- [ ] Audit ORGANIZATION_MODULE_IMPLEMENTATION.md
- [ ] Audit FRONTEND_INTEGRATION_TESTING.md
- [ ] Identify any other WIP tracking docs in repository root

### 2.2 Move to dev/parked/
- [ ] Create dev/parked/subdomain-provisioning/
- [ ] Move SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md
- [ ] Create dev/parked/organization-module/
- [ ] Move ORGANIZATION_MODULE_IMPLEMENTATION.md
- [ ] Create dev/parked/frontend-testing/
- [ ] Move FRONTEND_INTEGRATION_TESTING.md

## Phase 3: Documentation Migration ⏸️ PENDING

### 3.1 Move Root-Level Documentation (8 files)
- [ ] Identify all root-level markdown files to move
- [ ] Move deployment/environment docs to documentation/infrastructure/operations/
- [ ] Update any references in CLAUDE.md files
- [ ] Verify no broken links
- [ ] Test that moved docs render correctly

### 3.2 Move Infrastructure Documentation (28 files)
- [ ] Move Supabase docs to documentation/infrastructure/guides/supabase/
- [ ] Move database docs to documentation/infrastructure/guides/database/
- [ ] Move K8s docs to documentation/infrastructure/guides/kubernetes/
- [ ] Move operational docs to documentation/infrastructure/operations/
- [ ] Move reference docs to documentation/infrastructure/reference/
- [ ] Move inventories to documentation/infrastructure/reference/
- [ ] Verify infrastructure structure matches standard
- [ ] Update internal links

### 3.3 Move Frontend Documentation (55 files)
- [ ] Move frontend/docs/api/ → documentation/frontend/reference/api/
- [ ] Move frontend/docs/components/ → documentation/frontend/reference/components/
- [ ] Move frontend/docs/getting-started/ → documentation/frontend/getting-started/
- [ ] Move frontend/docs/architecture/ → documentation/frontend/architecture/
- [ ] Move frontend/docs/testing/ → documentation/frontend/testing/
- [ ] Move frontend/docs/performance/ → documentation/frontend/performance/
- [ ] Move frontend/docs/strategy/ → documentation/frontend/patterns/
- [ ] Move frontend/docs/templates/ → documentation/templates/ (shared)
- [ ] Move root-level guides (DEVELOPMENT.md, etc.) → documentation/frontend/guides/
- [ ] Move supplementary frontend docs from frontend root
- [ ] Verify frontend structure matches standard
- [ ] Update internal links

### 3.4 Move Workflow Documentation (2 files)
- [ ] Move workflows/IMPLEMENTATION.md → documentation/workflows/guides/implementation.md
- [ ] Create placeholder files in getting-started/, architecture/, reference/
- [ ] Verify workflows structure matches standard

### 3.5 Audit and Categorize Planning Documentation

**Step 1: Audit .plans/ directories (1.5 hours)**
- [ ] Audit `.plans/auth-integration` - Determine: aspirational, current, or deprecated
- [ ] Audit `.plans/cloudflare-remote-access` - Determine status
- [ ] Audit `.plans/consolidated` - Determine status
- [ ] Audit `.plans/event-resilience` - Determine status
- [ ] Audit `.plans/impersonation` - Determine status
- [ ] Audit `.plans/in-progress` - Determine status
- [ ] Audit `.plans/multi-tenancy` - Determine status
- [ ] Audit `.plans/organization-management` - Determine status
- [ ] Audit `.plans/provider-partners` - Determine status
- [ ] Audit `.plans/rbac-permissions` - Determine status (likely CURRENT)
- [ ] Audit `.plans/supabase-auth-integration` - Determine status (likely CURRENT)
- [ ] Audit `.plans/temporal-integration` - Determine status (likely CURRENT)
- [ ] Audit `.plans/zitadel-integration` - Mark as DEPRECATED (Zitadel no longer used)
- [ ] Audit `.archived_plans/provider-management` - Determine status
- [ ] Audit `.archived_plans/zitadel` - Mark as DEPRECATED
- [ ] Document categorization results

**Step 2: Move According to Category (1.5 hours)**
- [ ] Move CURRENT planning docs to appropriate locations
  - [ ] Example: supabase-auth-integration → documentation/architecture/authentication/
  - [ ] Example: rbac-permissions → documentation/architecture/authorization/
  - [ ] Example: temporal-integration → documentation/architecture/workflows/
- [ ] Move ASPIRATIONAL planning docs to documentation/architecture/ with status tags
- [ ] Leave DEPRECATED planning docs in original locations
- [ ] Update internal links in moved planning docs

**Step 3: Handle Original Directories (15 min)**
- [ ] Create `.plans/README.md` explaining migration
- [ ] Add note that active planning docs moved to documentation/architecture/
- [ ] Verify deprecated content remains for historical reference

## Phase 4: Technical Reference Validation ⏸️ PENDING

### 4.1 Validate API Contracts & Schemas
- [ ] Identify documented function signatures
- [ ] Compare against actual code implementations
- [ ] Verify REST endpoint documentation
- [ ] Check GraphQL schemas against implementation
- [ ] Validate AsyncAPI event schemas (in infrastructure/supabase/contracts/)
- [ ] Document drift findings in spreadsheet
- [ ] Create summary of API drift

### 4.2 Validate Database Schemas
- [ ] Compare table documentation to actual SQL
- [ ] Verify RLS policy documentation
- [ ] Check trigger documentation against implementation
- [ ] Validate function definitions
- [ ] Compare migration documentation to actual migrations
- [ ] Document drift findings
- [ ] Create summary of database drift

### 4.3 Validate Configuration References
- [ ] Check environment variable documentation against actual .env files
- [ ] Verify config file references
- [ ] Validate feature flag documentation
- [ ] Check secrets documentation
- [ ] Document drift findings
- [ ] Create summary of configuration drift

### 4.4 Validate Architecture Descriptions
- [ ] Compare documented file structure to actual structure
- [ ] Verify module organization claims
- [ ] Check deployment topology documentation
- [ ] Validate component interaction diagrams
- [ ] Verify workflow descriptions
- [ ] Document drift findings
- [ ] Create comprehensive validation report

## Phase 5: Annotation & Status Marking ⏸️ PENDING

### 5.1 Add YAML Frontmatter
- [ ] Add frontmatter to all moved frontend docs
- [ ] Add frontmatter to all moved workflows docs
- [ ] Add frontmatter to all moved infrastructure docs
- [ ] Add frontmatter to all moved architecture docs
- [ ] Include: status, last_updated, applies_to_version
- [ ] Verify frontmatter syntax is correct

### 5.2 Add Inline Aspirational Markers
- [ ] Identify aspirational sections in frontend docs
- [ ] Add markers: `> [!NOTE] This feature is not yet implemented`
- [ ] Identify aspirational sections in workflows docs
- [ ] Add aspirational markers
- [ ] Identify aspirational sections in infrastructure docs
- [ ] Add aspirational markers
- [ ] Identify aspirational sections in architecture docs
- [ ] Add aspirational markers
- [ ] Use consistent marker format throughout

### 5.3 Create Status Legend
- [ ] Add status explanation to master index
- [ ] Document what "current" means
- [ ] Document what "aspirational" means
- [ ] Document what "archived" means
- [ ] Explain inline marker usage
- [ ] Provide examples of each status type

## Phase 6: Cross-Referencing & Master Index ⏸️ PENDING

### 6.1 Update Internal Links
- [ ] Find all internal markdown links in moved files
- [ ] Update links to reflect new file locations
- [ ] Fix relative path issues
- [ ] Test sample links manually
- [ ] Run link validation script
- [ ] Fix any broken links found

### 6.2 Add Cross-References
- [ ] Add "See also" sections to related architecture docs
- [ ] Link architecture to implementation guides
- [ ] Connect operational procedures to config references
- [ ] Add cross-references between component docs
- [ ] Create concept maps for complex topics
- [ ] Verify all cross-references work

### 6.3 Populate Master Index
- [ ] Fill in frontend section with links
- [ ] Fill in workflows section with links
- [ ] Fill in infrastructure section with links
- [ ] Fill in architecture section with links
- [ ] Add quick access links for common tasks
- [ ] Organize by audience (developer, operator, architect)
- [ ] Add search tips
- [ ] Verify all links in index work

### 6.4 Update Component CLAUDE.md Files
- [ ] Update root CLAUDE.md with documentation/ references
- [ ] Update frontend/CLAUDE.md with new doc locations
- [ ] Update workflows/CLAUDE.md with new doc locations
- [ ] Update infrastructure/CLAUDE.md with new doc locations
- [ ] Verify CLAUDE.md files are helpful for developers

## Phase 7: Validation, Cleanup, and CI/CD Updates ⏸️ PENDING

### 7.1 Link Validation
- [ ] Run link validation script on all documentation/
- [ ] Fix any broken internal links
- [ ] Test navigation paths manually
- [ ] Verify external links still work
- [ ] Create list of any unfixable broken links

### 7.2 Consolidate Duplicate Content
- [ ] Identify documents with overlapping content
- [ ] Review duplicates for merge opportunities
- [ ] Merge or add cross-references to duplicates
- [ ] Ensure single source of truth for each topic
- [ ] Document consolidation decisions

### 7.3 Create Summary Report
- [ ] Document all file moves (source → destination)
- [ ] List technical drift found by category
- [ ] Summarize aspirational content annotated
- [ ] Note any unresolved issues
- [ ] Provide recommendations for maintenance
- [ ] Create documentation/MIGRATION_REPORT.md

### 7.4 Update CI/CD References and Validation Scripts

**Frontend Documentation Validation Workflow:**
- [ ] Update `.github/workflows/frontend-documentation-validation.yml`:
  - [ ] Change trigger paths line 8: `frontend/docs/**` → `documentation/frontend/**`
  - [ ] Change trigger paths line 16: `frontend/docs/**` → `documentation/frontend/**`
  - [ ] Change link-check folder line 96: `frontend/docs` → `documentation/frontend`
  - [ ] Update coverage calculation line 107: `docs/components` → `documentation/frontend/reference/components`
  - [ ] Search for any other `frontend/docs/` references and update

**Frontend Validation Scripts:**
- [ ] Update `frontend/scripts/documentation/validate-docs.js`:
  - [ ] Change base documentation path from `docs/` to `../../documentation/frontend/`
  - [ ] Update all file path references
  - [ ] Test script with new paths
- [ ] Update `frontend/scripts/documentation/check-doc-alignment.js`:
  - [ ] Update documentation lookup paths
  - [ ] Update component documentation path references
  - [ ] Test script with new paths
- [ ] Update `frontend/scripts/documentation/extract-alignment-summary.js`:
  - [ ] Update report file path references if needed
  - [ ] Test script with new paths
- [ ] Update `frontend/scripts/documentation/count-high-priority-issues.js`:
  - [ ] Verify paths still work after migration
  - [ ] Test script with new paths

**Other Workflows:**
- [ ] Search all `.github/workflows/*.yml` for documentation path references
- [ ] Update any other workflows that reference moved documentation
- [ ] Verify no build processes break

**Testing:**
- [ ] Test frontend-documentation-validation.yml in feature branch
- [ ] Verify all 4 validation scripts work with new paths
- [ ] Check link validation still functions correctly
- [ ] Confirm coverage calculations work
- [ ] Run full CI/CD pipeline test

## Success Validation Checkpoints

### Immediate Validation
- [ ] All directory structures created
- [ ] All ~119 files moved to new locations
- [ ] All .plans/ content audited and categorized
- [ ] Zero broken internal links
- [ ] Master index created and populated
- [ ] CI/CD workflows updated and tested

### Feature Complete Validation
- [ ] All technical references validated (drift documented)
- [ ] Aspirational content clearly annotated
- [ ] Duplicate content consolidated
- [ ] Summary report completed
- [ ] Standard structure applied uniformly across all components
- [ ] Frontend validation scripts working with new paths
- [ ] All workflows passing

## Current Status

**Phase**: Phase 1 - Structure Creation & Planning
**Status**: 🚧 IN PROGRESS (1.1 & 1.2 Complete)
**Last Updated**: 2025-01-12
**Completed**:
- Phase 1.1 - Create Directory Structure (40 directories, 7 README files)
- Phase 1.2 - Create Master Index Template (comprehensive 343-line README with TOC, audience sections, status legend, navigation tips)
**Next Step**: Begin Phase 1.3 - Create Validation Scripts

## Execution Notes

### Important Reminders
- Use `git mv` not `mv` to preserve history
- Update links in same commit as moves when possible
- Test workflows in feature branch before merging
- Categorize .plans/ content carefully (audit first!)
- Leave deprecated content in .plans/ for historical reference
- Update CI/CD workflows along with documentation moves

### Estimated Timeline
- **Total**: 4 weeks (assuming 4-6 hours per day)
- **Week 1**: Phases 1-2 + start Phase 3
- **Week 2**: Complete Phase 3 + Phase 4 (validation)
- **Week 3**: Phases 5-6 (annotation + cross-refs)
- **Week 4**: Phase 7 (cleanup + CI/CD updates)
