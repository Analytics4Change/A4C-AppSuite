# Implementation Plan: Documentation Grooming & Reorganization

## Executive Summary

The A4C-AppSuite monorepo currently contains 166 markdown files scattered across multiple directories with inconsistent organization, duplicate content, and no master index. This project will create a centralized `documentation/` directory that mirrors the monorepo structure, consolidate and organize all documentation (excluding CLAUDE.md, README.md, .claude/, and dev/ directories), validate technical references against current code implementation, and annotate aspirational content. The goal is to make documentation discoverable, maintainable, and trustworthy while preserving critical context across the frontend, infrastructure, temporal, and architecture domains.

## Files That Stay In Place

**The following files and directories will NOT be moved or modified:**
- All `CLAUDE.md` files (5 files) - Developer guidance files stay with their components
- All `README.md` files (13 files) - GitHub convention, must remain at directory roots
- All `.claude/` directory contents (27 files) - Claude Code infrastructure
- Entire `dev/` directory - Active development projects, parked work, and archived projects remain untouched
- `infrastructure/supabase/contracts/` - AsyncAPI contracts stay near source code (will be cross-referenced from documentation/)

## Important Discovery: temporal/ Directory Removal

During planning phase investigation, discovered that the `temporal/` directory at repository root was **deprecated and accidentally committed**. Investigation revealed:
- CI/CD pipeline uses `workflows/` directory (not `temporal/`)
- `temporal/` had only 1 commit vs 8+ commits in `workflows/`
- Both contained backup artifacts from same date (2025-11-03)
- `temporal/` was removed via `git rm -r temporal/`
- Documentation created in `dev/parked/remove-temporal-project/remove-temporal-project.md`

**Impact on Documentation Plan:** The file count and structure below reflect the repository AFTER temporal/ removal. Only `workflows/` documentation will be consolidated.

## Documentation Structure Philosophy

### Uniformity Principle

**All component documentation moves to `documentation/` - NO EXCEPTIONS.** This includes:
- ✅ frontend/docs/ → documentation/frontend/
- ✅ workflows/IMPLEMENTATION.md → documentation/workflows/
- ✅ infrastructure/supabase/docs/ → documentation/infrastructure/

**Rationale:** Applying different rules to different components defeats the purpose of consolidation. If we keep frontend/docs/ for "co-locality," we must keep all component docs local, which contradicts our goals of:
- Controlling documentation proliferation
- Creating a single discoverable location
- Ensuring uniformity across the monorepo

**Trade-off:** CI/CD workflows and validation scripts that reference old paths must be updated. This is acceptable because:
- One-time update cost
- Maintains consistency
- Prevents future confusion about "where do docs go?"

### Planning Documentation Categorization

**Challenge:** `.plans/` and `.archived_plans/` contain mixed content types:
- Some describe **future plans** (aspirational)
- Some describe **current implementation** (already built)
- Some describe **deprecated systems** (no longer accurate, e.g., Zitadel)

**Solution:** Audit and categorize before moving:

1. **Aspirational Content** → `documentation/architecture/` with `status: aspirational` frontmatter
   - Not yet implemented
   - Useful for understanding future direction
   - Clearly marked as "not yet built"

2. **Current State Content** → Appropriate location based on content:
   - Architecture decisions → `documentation/architecture/`
   - Implementation guides → `documentation/{component}/guides/`
   - Provides accurate description of how things work today

3. **Deprecated/False Content** → **DO NOT MOVE**
   - No longer accurate (e.g., Zitadel authentication docs when we use Supabase Auth)
   - Leave in `.plans/` or `.archived_plans/` for historical reference
   - Not migrated to avoid polluting documentation with false information

**Rationale:** Moving all planning docs blindly would mix aspirational, current, and false information, making it impossible to trust the documentation. Careful categorization ensures documentation accuracy.

### Standardized Component Organization

To achieve uniformity, navigability, and ease of understanding, all component directories (`frontend/`, `workflows/`, `infrastructure/`) follow the same standard structure:

**Standard Directories:**
1. **getting-started/** - "How do I start working with this component?"
2. **architecture/** - "Why is this component built this way?"
3. **guides/** - "How do I accomplish specific tasks?"
4. **reference/** - "Quick lookup for APIs, functions, etc."
5. **patterns/** - "What design patterns should I follow?"
6. **testing/** - "How do I test this component?"
7. **operations/** - "How do I deploy/configure/troubleshoot this?" (infrastructure-focused)

**Component-Specific Content:**
- Placed under `guides/` or `reference/` subdirectories
- Examples: `frontend/reference/components/`, `infrastructure/guides/database/`

**Benefits:**
- ✅ Developers know where to look regardless of component
- ✅ Documentation is discoverable by purpose (guide vs reference)
- ✅ Easy to add new components following established pattern
- ✅ Reduces cognitive load when navigating docs

## Phase 1: Structure Creation & Planning

### 1.1 Create Directory Structure

Create `documentation/` directory at repository root with **standardized structure across all components**:

**Standard Component Structure** (applied uniformly to frontend/, workflows/, infrastructure/):
- `getting-started/` - Onboarding, installation, first steps
- `architecture/` - Design decisions, high-level patterns
- `guides/` - How-to guides for common tasks (with component-specific subdirectories)
- `reference/` - Quick lookup documentation (with component-specific subdirectories)
- `patterns/` - Design patterns and best practices
- `testing/` - Testing strategies and guides
- `operations/` - Deployment, configuration, troubleshooting (where applicable)

**Complete Structure:**
```
documentation/
├── README.md (master index)
├── templates/ (shared templates for docs)
├── frontend/
│   ├── getting-started/
│   ├── architecture/
│   ├── guides/
│   ├── reference/
│   │   ├── api/
│   │   ├── components/
│   │   └── ui-patterns.md
│   ├── patterns/
│   ├── testing/
│   └── performance/
├── workflows/
│   ├── getting-started/
│   ├── architecture/
│   ├── guides/
│   ├── reference/
│   ├── testing/
│   └── operations/
├── infrastructure/
│   ├── getting-started/
│   ├── architecture/
│   ├── guides/
│   │   ├── database/
│   │   ├── kubernetes/
│   │   └── supabase/
│   ├── reference/
│   │   ├── database/
│   │   └── kubernetes/
│   ├── testing/
│   └── operations/
│       ├── deployment/
│       ├── configuration/
│       └── troubleshooting/
├── architecture/ (cross-cutting architecture docs)
│   ├── authentication/
│   ├── authorization/
│   ├── data/
│   └── workflows/
└── archived/
    ├── zitadel-migration/
    └── provider-management-v1/
```

- **Expected outcome**: Complete standardized directory structure ready for file migration
- **Time estimate**: 45 minutes (increased due to more detailed structure)

### 1.2 Create Master Index Template
- Create `documentation/README.md` with comprehensive table of contents
- Add sections for quick links, documentation by audience, and organization explanation
- Create placeholder sections for all documentation categories
- **Expected outcome**: Master index ready to be populated with file links
- **Time estimate**: 1 hour

### 1.3 Create Validation Scripts
- Create script to find all markdown files (excluding node_modules, .git, dev/)
- Create script to categorize files (stay vs move)
- Create script to validate internal links after moves
- **Expected outcome**: Automated tools to assist with migration and validation
- **Time estimate**: 2 hours

## Phase 2: Implementation Tracking Document Migration

### 2.1 Identify WIP Tracking Documents
- Audit all implementation status/tracking documents
- Determine intent/purpose of each tracking document
- **Expected outcome**: List of documents to move to dev/parked/
- **Time estimate**: 1 hour

### 2.2 Move to dev/parked/
- Create appropriate subdirectories under dev/parked/
- Move identified tracking documents:
  - SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md → dev/parked/subdomain-provisioning/
  - ORGANIZATION_MODULE_IMPLEMENTATION.md → dev/parked/organization-module/
  - FRONTEND_INTEGRATION_TESTING.md → dev/parked/frontend-testing/
- **Expected outcome**: All WIP tracking docs moved out of main documentation flow
- **Time estimate**: 30 minutes

## Phase 3: Documentation Migration

### 3.1 Move Root-Level Documentation (8 files)
- Move operational docs to documentation/operations/
- Move deployment/environment config docs
- Update any references in other files
- **Expected outcome**: Clean repository root
- **Time estimate**: 1 hour

### 3.2 Move Infrastructure Documentation (28 files)
- Reorganize infrastructure docs to standardized structure:
  - Supabase docs → `documentation/infrastructure/guides/supabase/` and `documentation/infrastructure/guides/database/`
  - Kubernetes docs → `documentation/infrastructure/guides/kubernetes/`
  - Database reference → `documentation/infrastructure/reference/database/`
  - K8s reference → `documentation/infrastructure/reference/kubernetes/`
  - Operational docs → `documentation/infrastructure/operations/deployment/`, `operations/configuration/`, `operations/troubleshooting/`
  - Inventory documents → `documentation/infrastructure/reference/inventories.md`
- **Expected outcome**: Infrastructure docs organized in standard structure by technology
- **Time estimate**: 2.5 hours (increased due to reorganization)

### 3.3 Move Frontend Documentation (55 files)
- Reorganize frontend/docs/ to standardized structure:
  - `frontend/docs/api/` → `documentation/frontend/reference/api/`
  - `frontend/docs/components/` → `documentation/frontend/reference/components/`
  - `frontend/docs/getting-started/` → `documentation/frontend/getting-started/`
  - `frontend/docs/architecture/` → `documentation/frontend/architecture/`
  - `frontend/docs/testing/` → `documentation/frontend/testing/`
  - `frontend/docs/performance/` → `documentation/frontend/performance/`
  - `frontend/docs/strategy/` → `documentation/frontend/patterns/`
  - `frontend/docs/templates/` → `documentation/templates/` (shared)
  - Root-level guides (DEVELOPMENT.md, DEPLOYMENT.md, etc.) → `documentation/frontend/guides/`
- Move supplementary frontend docs from frontend root
- **Expected outcome**: Frontend docs reorganized into standard structure
- **Time estimate**: 2 hours (increased due to reorganization)

### 3.4 Move Workflow Documentation (2 files)
- Move workflow implementation docs to documentation/workflows/ using standard structure:
  - `workflows/IMPLEMENTATION.md` → `documentation/workflows/guides/implementation.md`
  - Create getting-started/, architecture/, reference/ subdirectories
  - Build out standard structure for future expansion
- **Expected outcome**: Workflow docs in standard structure
- **Time estimate**: 30 minutes (increased to establish full structure)

### 3.5 Audit and Categorize Planning Documentation (.plans/ and .archived_plans/)

**Challenge:** Planning documentation contains three types of content:
1. **Aspirational** - Not yet implemented, future plans (tag with `status: aspirational`)
2. **Current State** - Already implemented, reflects reality (tag with `status: current`)
3. **Deprecated/False** - No longer accurate (DO NOT MOVE)

**Step 1: Audit and Categorize (1.5 hours)**

For each directory in `.plans/` (13 directories) and `.archived_plans/` (2 directories):
1. Read the documentation
2. Compare against current code implementation
3. Determine category: aspirational, current, or deprecated
4. Document categorization in audit spreadsheet/notes

**Directories to Audit:**
- `.plans/auth-integration` - ?
- `.plans/cloudflare-remote-access` - ?
- `.plans/consolidated` - ?
- `.plans/event-resilience` - ?
- `.plans/impersonation` - ?
- `.plans/in-progress` - ?
- `.plans/multi-tenancy` - ?
- `.plans/organization-management` - ?
- `.plans/provider-partners` - ?
- `.plans/rbac-permissions` - ?
- `.plans/supabase-auth-integration` - Likely CURRENT (auth implemented)
- `.plans/temporal-integration` - Likely CURRENT (temporal running)
- `.plans/zitadel-integration` - DEPRECATED (no longer use Zitadel)
- `.archived_plans/provider-management` - ?
- `.archived_plans/zitadel` - DEPRECATED (no longer use Zitadel)

**Step 2: Move According to Category (1.5 hours)**

**Migration Rules:**
- **Aspirational** → `documentation/architecture/{domain}/` + frontmatter `status: aspirational`
- **Current State** → Destination based on content type:
  - Architecture decisions → `documentation/architecture/{domain}/`
  - Component guides → `documentation/{component}/guides/`
  - Operational procedures → `documentation/infrastructure/operations/`
- **Deprecated/False** → **DO NOT MOVE** (leave in .plans/ or .archived_plans/)

**Example Migrations:**
- `.plans/supabase-auth-integration/` (CURRENT) → `documentation/architecture/authentication/supabase-auth/`
- `.plans/rbac-permissions/` (CURRENT) → `documentation/architecture/authorization/rbac/`
- `.plans/temporal-integration/` (CURRENT) → `documentation/architecture/workflows/temporal/`
- `.plans/impersonation/` (ASPIRATIONAL) → `documentation/architecture/authorization/impersonation/` + `status: aspirational`
- `.plans/zitadel-integration/` (DEPRECATED) → **DO NOT MOVE**
- `.archived_plans/zitadel/` (DEPRECATED) → **DO NOT MOVE** (or optionally to `documentation/archived/zitadel-migration/` with deprecation notice)

**Step 3: Handle Original Directories**

After migration:
- `.plans/` directory may contain only deprecated content (don't delete - leave for historical reference)
- `.archived_plans/` keeps deprecated content
- Consider adding README.md to `.plans/` explaining that active planning docs have moved to `documentation/architecture/`

- **Expected outcome**: Planning docs audited, categorized, and moved appropriately; deprecated content left in original location with explanatory README
- **Time estimate**: 3 hours (1.5 for audit + 1.5 for migration + 15 min for cleanup)

## Phase 4: Technical Reference Validation

### 4.1 Validate API Contracts & Schemas
- Compare documented function signatures to actual code
- Verify REST endpoint documentation
- Check GraphQL schemas against implementation
- Validate event schemas in AsyncAPI contracts
- **Expected outcome**: List of drift between docs and code
- **Time estimate**: 3 hours

### 4.2 Validate Database Schemas
- Compare table structures in docs vs actual SQL
- Verify RLS policy documentation
- Check trigger and function definitions
- Validate migration patterns
- **Expected outcome**: Database documentation accuracy report
- **Time estimate**: 2 hours

### 4.3 Validate Configuration References
- Check environment variable documentation against actual .env files
- Verify config file references
- Validate feature flag documentation
- **Expected outcome**: Configuration documentation accuracy report
- **Time estimate**: 1.5 hours

### 4.4 Validate Architecture Descriptions
- Compare documented file structure to actual structure
- Verify module organization claims
- Check deployment topology documentation
- Validate component interaction diagrams
- **Expected outcome**: Architecture documentation accuracy report
- **Time estimate**: 2 hours

## Phase 5: Annotation & Status Marking

### 5.1 Add YAML Frontmatter
- Add frontmatter to all moved documents with:
  - `status:` (current/aspirational/archived)
  - `last_updated:` (YYYY-MM-DD)
  - `applies_to_version:` (optional, for code version tracking)
- **Expected outcome**: All docs have machine-readable status metadata
- **Time estimate**: 2 hours

### 5.2 Add Inline Aspirational Markers
- Identify sections describing unimplemented features
- Add inline markers: `> [!NOTE] This feature is not yet implemented`
- Or use emoji markers: `⚠️ ASPIRATIONAL: [description]`
- Ensure markers are visible and clear
- **Expected outcome**: All aspirational content clearly marked
- **Time estimate**: 3 hours

### 5.3 Create Status Legend
- Add status explanation to master index
- Document what each status means
- Explain how to interpret inline markers
- **Expected outcome**: Clear guide for interpreting document status
- **Time estimate**: 30 minutes

## Phase 6: Cross-Referencing & Master Index

### 6.1 Update Internal Links
- Find and fix all broken links after file moves
- Update relative paths to work from new locations
- **Expected outcome**: Zero broken internal links
- **Time estimate**: 2 hours

### 6.2 Add Cross-References
- Add "See also" sections to related documents
- Link architecture docs to implementation guides
- Connect operational procedures to configuration references
- **Expected outcome**: Easy navigation between related docs
- **Time estimate**: 2 hours

### 6.3 Populate Master Index
- Fill in all sections of documentation/README.md
- Add links to all major documents
- Create quick access sections for common tasks
- Organize by audience (developer, operator, architect)
- **Expected outcome**: Comprehensive, navigable documentation index
- **Time estimate**: 2 hours

### 6.4 Update Component CLAUDE.md Files
- Update references in CLAUDE.md files to point to new documentation/ locations
- Add pointers from component directories to relevant docs
- **Expected outcome**: CLAUDE.md files reference correct documentation paths
- **Time estimate**: 1 hour

## Phase 7: Validation & Cleanup

### 7.1 Link Validation
- Run link validation script
- Fix any remaining broken links
- Test sample navigation paths
- **Expected outcome**: All links work correctly
- **Time estimate**: 1 hour

### 7.2 Consolidate Duplicate Content
- Identify documents with overlapping content
- Merge or cross-reference duplicates
- Keep single source of truth for each topic
- **Expected outcome**: No duplicate documentation
- **Time estimate**: 2 hours

### 7.3 Create Summary Report
- Document all files moved (source → destination)
- List all technical drift found
- Summarize aspirational content annotated
- Note any issues or recommendations
- **Expected outcome**: Complete migration report
- **Time estimate**: 1 hour

### 7.4 Update CI/CD References and Validation Scripts

**Frontend Documentation Validation Workflow:**
- Update `.github/workflows/frontend-documentation-validation.yml`:
  - Change trigger paths from `frontend/docs/**` to `documentation/frontend/**` (lines 8, 16)
  - Change link-check folder-path from `frontend/docs` to `documentation/frontend` (line 96)
  - Update coverage calculation from `docs/components` to `documentation/frontend/reference/components` (line 107)
  - Update all other hardcoded `frontend/docs/` references

**Frontend Validation Scripts:**
- Update `frontend/scripts/documentation/validate-docs.js`:
  - Change base documentation path from `docs/` to `../../documentation/frontend/`
  - Update all file path references
- Update `frontend/scripts/documentation/check-doc-alignment.js`:
  - Update documentation lookup paths
  - Update component documentation path references
- Update `frontend/scripts/documentation/extract-alignment-summary.js`:
  - Update report file path references if needed
- Update `frontend/scripts/documentation/count-high-priority-issues.js`:
  - Verify paths still work after migration

**Other Workflows:**
- Check all `.github/workflows/*.yml` files for documentation path references
- Update any other workflows that reference moved documentation paths
- Verify no build processes or scripts break

**Testing:**
- Run frontend-documentation-validation.yml locally or in test branch
- Verify all validation scripts work with new paths
- Check link validation still functions correctly
- Confirm coverage calculations work

- **Expected outcome**: All CI/CD workflows and validation scripts updated and working
- **Time estimate**: 2 hours (increased due to script updates and testing)

## Success Metrics

### Immediate
- [ ] Directory structure created
- [ ] All 119 files moved to new locations
- [ ] Zero broken internal links
- [ ] Master index created and populated

### Medium-Term
- [ ] All technical references validated
- [ ] Aspirational content clearly annotated
- [ ] Duplicate content consolidated
- [ ] Summary report completed

### Long-Term
- [ ] Documentation is primary reference for developers
- [ ] No stale or undiscovered documentation
- [ ] New documentation follows established patterns
- [ ] Documentation stays synchronized with code

## Implementation Schedule

**Updated schedule reflecting standardized structure, reorganization, and CI/CD updates:**

- **Week 1, Days 1-2**: Phases 1-2 (Structure creation and tracking doc migration)
  - Increased time for creating detailed standard structure
- **Week 1, Days 3-5**: Phase 3 (File migration and reorganization - 119 files)
  - Additional time for reorganizing to standard structure (not just moving)
  - ALL component docs moved (no exceptions for co-locality)
- **Week 2, Days 1-3**: Phase 4 (Technical validation - most time-intensive)
- **Week 2, Days 4-5**: Phase 5 (Annotation and status marking)
- **Week 3, Days 1-3**: Phase 6 (Cross-referencing and master index)
  - Additional time for updating cross-references after reorganization
- **Week 3, Days 4-5**: Phase 7 (Validation, cleanup, and CI/CD updates)
  - Update frontend-documentation-validation.yml workflow
  - Update frontend validation scripts (4 scripts)
  - Test all workflows with new paths
  - More thorough validation needed due to reorganization

**Total estimated time**: 4 weeks (assuming 4-6 hours per day)

**Note:** Time increased from original 3 weeks due to:
1. Reorganization (not just moving files)
2. Establishing standardized structure across all components
3. Updating CI/CD workflows and validation scripts (2 hours)
4. Testing workflow changes

## Risk Mitigation

### Risk: Breaking existing references
- **Mitigation**: Use git to track all moves, maintain commit history
- **Mitigation**: Run link validation before and after
- **Mitigation**: Keep git history searchable for old paths

### Risk: Losing important context during moves
- **Mitigation**: Don't delete any files, only move them
- **Mitigation**: Preserve all commit history via git mv
- **Mitigation**: Create detailed migration log

### Risk: Technical validation too time-consuming
- **Mitigation**: Focus on high-value documents first
- **Mitigation**: Use grep/ripgrep to automate reference finding
- **Mitigation**: Document drift rather than fixing it immediately

### Risk: Aspirational vs current unclear
- **Mitigation**: When in doubt, ask code or user for clarification
- **Mitigation**: Use both frontmatter AND inline markers for redundancy
- **Mitigation**: Document validation date in frontmatter

### Risk: CI/CD workflows break after documentation move
- **Mitigation**: Identify all workflows that reference documentation paths before migration
- **Mitigation**: Update workflows in same commit as documentation moves
- **Mitigation**: Test workflows in feature branch before merging to main
- **Mitigation**: Have rollback plan ready (git revert)

## Next Steps After Completion

1. **Establish maintenance process**: Create guidelines for keeping docs updated
2. **Add to PR template**: Remind developers to update docs with code changes
3. **Schedule quarterly reviews**: Regular audits to catch drift
4. **Create doc contribution guide**: Help developers write good documentation
5. **Consider documentation testing**: Add automated checks for common issues
6. **Integrate with onboarding**: Use as primary resource for new developers
