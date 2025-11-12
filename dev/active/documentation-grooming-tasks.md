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

## Phase 1: Structure Creation & Planning ✅ COMPLETE

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

### 1.3 Create Validation Scripts ✅ COMPLETE
- [x] Create markdown file finder script (exclude node_modules, .git, dev/)
- [x] Create file categorization script (stay vs move)
- [x] Create link validation script (check internal links)
- [x] Test scripts on current repository
- [x] Document script usage

## Phase 2: Implementation Tracking Document Migration ✅ COMPLETE

### 2.1 Identify WIP Tracking Documents ✅ COMPLETE
- [x] Audit SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md
- [x] Audit ORGANIZATION_MODULE_IMPLEMENTATION.md
- [x] Audit FRONTEND_INTEGRATION_TESTING.md
- [x] Identify any other WIP tracking docs in repository root

### 2.2 Move to dev/parked/ ✅ COMPLETE
- [x] Create dev/parked/subdomain-provisioning/
- [x] Move SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md → implementation-tracking.md
- [x] Create dev/parked/organization-module/
- [x] Move ORGANIZATION_MODULE_IMPLEMENTATION.md → implementation-tracking.md
- [x] Create dev/parked/frontend-integration-testing/
- [x] Move FRONTEND_INTEGRATION_TESTING.md → testing-guide.md
- [x] Create README.md in each subdirectory explaining project context

## Phase 3: Documentation Migration ✅ COMPLETE

### 3.1 Move Root-Level Documentation (2 files) ✅ COMPLETE
- [x] Identify all root-level markdown files to move
- [x] Move docs/DEPLOYMENT_CHECKLIST.md → documentation/infrastructure/operations/deployment/
- [x] Move docs/ENVIRONMENT_VARIABLES.md → documentation/infrastructure/operations/configuration/
- [x] Remove empty docs/ directory
- [x] Verify no broken links introduced

### 3.2 Move Infrastructure Documentation (22 files) ✅ COMPLETE
- [x] Move 6 root infrastructure operational docs to documentation/infrastructure/operations/
- [x] Move infrastructure/k8s/rbac/IMPLEMENTATION_SUMMARY.md → documentation/infrastructure/guides/kubernetes/rbac/
- [x] Move 9 Supabase root docs to documentation/infrastructure/guides/supabase/
- [x] Move infrastructure/supabase/docs/*.md (3 files) → documentation/infrastructure/guides/supabase/docs/
- [x] Move infrastructure/supabase/local-tests/*.md (2 files) → documentation/infrastructure/guides/supabase/local-tests/
- [x] Move infrastructure/supabase/sql/99-seeds/README_SEED_IDEMPOTENCY.md
- [x] Update 6 documentation references in infrastructure/CLAUDE.md
- [x] Fix broken link in FAQ.md to point to contracts directory

### 3.3 Move Frontend Documentation (58 files) ✅ COMPLETE
- [x] Move frontend/docs/api/*.md (4 files) → documentation/frontend/reference/api/
- [x] Move frontend/docs/components/*.md (24 files) → documentation/frontend/reference/components/
- [x] Move frontend/docs/getting-started/*.md (2 files) → documentation/frontend/getting-started/
- [x] Move frontend/docs/architecture/*.md (2 files) → documentation/frontend/architecture/
- [x] Move frontend/docs/testing/*.md (1 file) → documentation/frontend/testing/
- [x] Move frontend/docs/performance/*.md (1 file) → documentation/frontend/performance/
- [x] Move frontend/docs/strategy/*.md (3 files) → documentation/frontend/patterns/
- [x] Move frontend/docs/templates/*.md (2 files) → documentation/templates/ (shared)
- [x] Move 17 root-level guides to appropriate subdirectories
- [x] Replace placeholder documentation/frontend/README.md with comprehensive version (496 lines)
- [x] Move frontend/doc-status-report.md and documentation-reports/doc-status-report.md
- [x] Update 2 template path references in frontend/CLAUDE.md
- [x] Remove empty subdirectories from frontend/docs/

### 3.4 Move Workflow Documentation (1 file) ✅ COMPLETE
- [x] Move workflows/IMPLEMENTATION.md → documentation/workflows/guides/implementation.md
- [x] Verify workflows/CLAUDE.md doesn't exist (no references to update)

### 3.5 Audit and Categorize Planning Documentation ✅ COMPLETE

**Step 1: Audit .plans/ directories ✅ COMPLETE**
- [x] Create comprehensive audit summary (dev/active/planning-docs-audit-summary.md)
- [x] Audit all 15 planning directories
- [x] Verify implementation status with user (cloudflare, provider-partners, temporal, event-resilience)
- [x] Categorize as CURRENT (20 files), ASPIRATIONAL (10 files), or DEPRECATED (6 files)
- [x] Special handling: Identify files requiring split/conversion

**Step 2: Move According to Category ✅ COMPLETE**
- [x] Move 20 CURRENT files to appropriate locations with frontmatter
  - [x] Supabase Auth (3 files) → documentation/architecture/authentication/
  - [x] Temporal integration (4 files) → documentation/architecture/workflows/ and documentation/workflows/
  - [x] RBAC permissions (2 files) → documentation/architecture/authorization/
  - [x] Organization management (2 files) → documentation/architecture/data/
  - [x] In-progress (3 files) → various locations
  - [x] Auth integration (1 file) → documentation/architecture/data/
  - [x] Cloudflare remote access (2 files) → documentation/infrastructure/guides/cloudflare/
- [x] Move 10 ASPIRATIONAL files with status tags and inline warnings
  - [x] Impersonation (5 files) → documentation/architecture/authentication/
  - [x] Enterprise SSO (1 file) → documentation/architecture/authentication/
  - [x] Organizational deletion UX (1 file) → documentation/architecture/authorization/
  - [x] Provider partners (2 files) → documentation/architecture/data/
  - [x] Event resilience (1 file) → documentation/frontend/architecture/
- [x] Leave 6 DEPRECATED files for historical reference (.archived_plans/)

**Step 3: Special Handling ✅ COMPLETE**
- [x] Split consolidated/agent-observations.md:
  - [x] Extract CQRS content → documentation/architecture/data/event-sourcing-overview.md
  - [x] Update Zitadel → Supabase Auth references
  - [x] Rename original → agent-observations-zitadel-deprecated.md
  - [x] Add deprecation warning to deprecated file
- [x] Convert multi-tenancy HTML to Markdown:
  - [x] Install pandoc (user installed during session)
  - [x] Convert HTML → Markdown (930 lines)
  - [x] Update all Zitadel → Supabase Auth references
  - [x] Clean up HTML artifacts
  - [x] Add frontmatter → documentation/architecture/data/multi-tenancy-architecture.md

**Step 4: Add Frontmatter to All Migrated Files ✅ COMPLETE**
- [x] Create frontmatter script (/tmp/add-frontmatter.sh)
- [x] Add YAML frontmatter to 20 CURRENT files (status: current)
- [x] Add YAML frontmatter to 10 ASPIRATIONAL files (status: aspirational)
- [x] Add inline warning markers to all ASPIRATIONAL files

**Step 5: Create Migration Documentation ✅ COMPLETE**
- [x] Create `.plans/README.md` explaining migration (comprehensive with all details)
- [x] Document new locations for all migrated files
- [x] Explain special cases (split + conversion)
- [x] List deprecated content preserved for historical reference
- [x] Note implementation status clarifications

## Phase 4: Technical Reference Validation ⏸️ PENDING

### 4.1 Validate API Contracts & Schemas ✅ COMPLETE
- [x] Identify documented function signatures
- [x] Compare against actual code implementations
- [x] Verify REST endpoint documentation (N/A - no REST endpoints documented)
- [x] Check GraphQL schemas against implementation (N/A - no GraphQL)
- [x] Validate AsyncAPI event schemas (deferred to Phase 4.4)
- [x] Document drift findings in report
- [x] Create summary of API drift (dev/active/phase-4-1-api-validation-report.md)

**Findings**:
- IClientApi: ✅ Perfect match - All 6 methods documented correctly
- IMedicationApi: ✅ Perfect match - All 9 methods documented correctly
- SearchableDropdownProps: ⚠️ SIGNIFICANT DRIFT - 73% undocumented (22/30 properties missing)
- HybridCacheService: ⚠️ MODERATE DRIFT - Generic docs vs specialized implementation
- AsyncAPI contracts: ✅ Exist but validation deferred to Phase 4.4 (requires code analysis)

### 4.2 Validate Database Schemas ✅ COMPLETE
- [x] Compare table documentation to actual SQL
- [x] Verify RLS policy documentation
- [x] Check trigger documentation against implementation
- [x] Validate function definitions
- [x] Compare migration documentation to actual migrations
- [x] Document drift findings
- [x] Create summary of database drift (dev/active/phase-4-2-database-validation-report.md)

**Critical Finding**: ⚠️ ZERO dedicated database schema documentation exists
- **Tables**: 12 implemented, 0 documented (clients, medications, organizations, etc.)
- **RLS Policies**: Multiple implemented, 0 documented
- **Triggers**: 3 implemented, 0 documented
- **Functions**: 13 implemented, 0 documented
- **Impact**: HIGH - Major developer onboarding and maintenance barrier
- **Recommendation**: Create comprehensive database schema reference (est. 40 hours)

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

**Phase**: Phase 4 - Technical Reference Validation
**Status**: ✅ 50% COMPLETE (Phase 4.1-4.2 done, 4.3-4.4 pending)
**Last Updated**: 2025-01-12

**Completed Phases**:
- Phase 1.1 - Create Directory Structure (40 directories, 7 README files) ✅
- Phase 1.2 - Create Master Index Template (343-line README) ✅
- Phase 1.3 - Create Validation Scripts (3 scripts + README) ✅
- Phase 2.1-2.2 - Move WIP Tracking Documents (3 projects to dev/parked/) ✅
- Phase 3.1 - Move Root-Level Documentation (2 files) ✅
- Phase 3.2 - Move Infrastructure Documentation (22 files) ✅
- Phase 3.3 - Move Frontend Documentation (58 files) ✅
- Phase 3.4 - Move Workflow Documentation (1 file) ✅
- Phase 3.5 - Audit and Categorize Planning Documentation (30 files + 2 special handling) ✅
- Phase 4.1 - Validate API Contracts & Schemas ✅
- Phase 4.2 - Validate Database Schemas ✅

**Recent Progress (2025-01-12)**:
- **Phase 4.1 complete**: API contracts validation
  - IClientApi, IMedicationApi: ✅ Perfect matches
  - SearchableDropdownProps: ⚠️ 73% undocumented (critical gap)
  - HybridCacheService: ⚠️ Docs describe generic, code is specialized
  - Created 29KB validation report: dev/active/phase-4-1-api-validation-report.md

- **Phase 4.2 complete**: Database schema validation
  - Found ZERO dedicated schema documentation for 12 tables
  - Database implementation is technically sound (RLS, triggers, functions working)
  - Identified critical documentation gap (40+ hours to fix)
  - Created 28KB validation report: dev/active/phase-4-2-database-validation-report.md

**Validation Reports Created**:
- dev/active/phase-4-1-api-validation-report.md (29KB)
- dev/active/phase-4-2-database-validation-report.md (28KB)

**Key Findings**:
- ✅ **Strengths**: Core API interfaces perfectly documented
- ⚠️ **Critical Gap**: Database schemas completely undocumented (HIGH impact)
- ⚠️ **High Priority**: SearchableDropdownProps 73% undocumented
- ⚠️ **Medium Priority**: HybridCacheService architectural mismatch

**Next Step**: Phase 4.3 - Validate Configuration References (env vars, configs, secrets)

**How to Resume After /clear**:
```bash
# Read dev-docs to restore context
cat dev/active/documentation-grooming-context.md
cat dev/active/documentation-grooming-tasks.md

# Read validation reports
cat dev/active/phase-4-1-api-validation-report.md
cat dev/active/phase-4-2-database-validation-report.md

# Then continue: "Read dev/active/documentation-grooming-*.md and continue with Phase 4.3"
```

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
