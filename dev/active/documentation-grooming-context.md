# Context: Documentation Grooming & Reorganization

## Decision Record

**Date**: 2025-01-12
**Feature**: Documentation Grooming & Reorganization
**Goal**: Consolidate 166 scattered markdown files into an organized `documentation/` directory structure that mirrors the monorepo, validate technical references against code, categorize planning documentation, and annotate aspirational content for clarity.

### Key Decisions

1. **Uniformity Principle - NO EXCEPTIONS**: Create a top-level `documentation/` directory with standardized structure across ALL components (frontend/, workflows/, infrastructure/). ALL component documentation moves to documentation/ - no exceptions for co-locality. If we kept frontend/docs/ for co-locality, we'd have to keep all component docs local, defeating the purpose.

2. **Standardized Component Structure**: All components use identical directory structure:
   - getting-started/ - Onboarding, first steps
   - architecture/ - Design decisions
   - guides/ - How-to guides (with component-specific subdirectories)
   - reference/ - Quick lookup (with component-specific subdirectories)
   - patterns/ - Design patterns
   - testing/ - Testing strategies
   - operations/ - Deployment, configuration (where applicable)

3. **Planning Documentation Categorization**: `.plans/` and `.archived_plans/` contain three types of content:
   - **Aspirational** (not yet implemented) → Move to documentation/architecture/ with `status: aspirational`
   - **Current** (already implemented) → Move to appropriate location with `status: current`
   - **Deprecated/False** (no longer accurate) → DO NOT MOVE (leave for historical reference)

4. **Remove Deprecated temporal/ Directory**: During discovery, found that `temporal/` directory was deprecated/orphaned. CI/CD uses `workflows/` directory. Removed `temporal/` via `git rm` and documented in `dev/parked/remove-temporal-project/`.

5. **Dual Annotation System**: Use both YAML frontmatter (machine-readable status) AND inline markers (human-visible warnings) to mark aspirational content. This provides redundancy and serves different audiences (automated tools vs. readers).

6. **Update CI/CD Workflows**: Frontend validation workflow and scripts must be updated to reference new documentation paths. This is an acceptable trade-off for consistency.

7. **Planning Documentation Special Handling** (Added 2025-01-12):
   - **Split large consolidated docs**: When a single planning doc mixes current architecture (CQRS) with deprecated content (Zitadel), split into separate files. Extract current content to new location, rename original with deprecation suffix.
   - **Convert HTML planning docs**: Use pandoc to convert HTML documentation to Markdown. Update all deprecated technology references (Zitadel → Supabase Auth) during conversion.
   - **Verify implementation status with user**: Don't rely solely on status markers in planning docs. Ask user to confirm actual deployment status, especially for infrastructure features.

8. **Implementation Status Reality Check** (Added 2025-01-12):
   - **Cloudflare remote access**: Planning doc unclear, but user confirmed SSH via cloudflared proxy is operational → CURRENT
   - **Provider partners**: Planning doc showed "✅ Integrated" but user corrected → ASPIRATIONAL (database schema exists, needs frontend/data work)
   - **Temporal workflows**: Planning doc said "Design Complete - Not Implemented" but 303-line implementation exists in workflows/ → CURRENT at 80%
   - **Event resilience**: HTTP-level resilience exists (CircuitBreaker, ResilientHttpClient) but domain event offline queue does not → ASPIRATIONAL

## Technical Context

### Architecture

This project operates at the monorepo organizational level. It touches all three major components:
- **Frontend**: React/TypeScript application with 55 documentation files
- **Infrastructure**: Terraform, Kubernetes, Supabase with 28 documentation files
- **Workflows**: Temporal.io orchestration with 2 documentation files
- **Planning**: 13 directories in .plans/, 2 in .archived_plans/ (mixed content)

The new `documentation/` directory sits at repository root alongside existing component directories, creating a parallel structure for consolidated docs.

### Tech Stack

**Tools Used:**
- Git (for tracking moves with `git mv` to preserve history)
- Bash/Shell scripts (for automation and validation)
- grep/ripgrep (for finding technical references in code)
- Markdown (all documentation format)
- YAML frontmatter (for document metadata)

**No Build Dependencies**: This is purely a documentation organization project with no code changes.

### Dependencies

**What This Depends On:**
- Git repository structure (must preserve commit history during moves)
- Existing file paths referenced in CI/CD workflows
- Internal links between markdown documents
- Component-level CLAUDE.md files (may reference documentation paths)
- Frontend validation scripts (need path updates)

**What Depends On This:**
- Future documentation updates (will follow new structure)
- Developer onboarding (will use documentation/ as entry point)
- CI/CD documentation validation (requires workflow updates)
- Frontend validation scripts (4 scripts need updating)

## File Structure

### Existing Files Modified

**Already Modified:**
- `temporal/` - **REMOVED** (deprecated directory, see dev/parked/remove-temporal-project/)

**Will Be Modified:**
- `.github/workflows/frontend-documentation-validation.yml` - Update paths to documentation/frontend/
- `frontend/scripts/documentation/*.js` - Update paths (4 scripts)
- `CLAUDE.md` (root) - Add reference to documentation/ directory
- `frontend/CLAUDE.md` - Update doc references
- `infrastructure/CLAUDE.md` - Update doc references
- `workflows/CLAUDE.md` - Update doc references

### New Files/Directories Created

**Documentation Structure (Phase 1.1 - ✅ Created 2025-01-12):**
- `documentation/README.md` - ✅ Master index with comprehensive table of contents (343 lines)
- `documentation/templates/README.md` - ✅ Shared documentation templates directory
- `documentation/frontend/README.md` - ✅ Frontend documentation index
  - `documentation/frontend/getting-started/` - ✅ Created
  - `documentation/frontend/architecture/` - ✅ Created
  - `documentation/frontend/guides/` - ✅ Created
  - `documentation/frontend/reference/api/` - ✅ Created
  - `documentation/frontend/reference/components/` - ✅ Created
  - `documentation/frontend/patterns/` - ✅ Created
  - `documentation/frontend/testing/` - ✅ Created
  - `documentation/frontend/performance/` - ✅ Created
- `documentation/workflows/README.md` - ✅ Workflow documentation index

**Phase 3.5 New Files (✅ Created 2025-01-12):**
- `documentation/architecture/data/event-sourcing-overview.md` - ✅ Extracted CQRS/Event Sourcing content from agent-observations.md
- `documentation/architecture/data/multi-tenancy-architecture.md` - ✅ Converted from multi-tenancy-organization.html (930 lines)
- `.plans/README.md` - ✅ Migration explanation document
- `dev/active/planning-docs-audit-summary.md` - ✅ Comprehensive audit of all planning documentation (24KB)
- `.plans/consolidated/agent-observations-zitadel-deprecated.md` - ✅ Renamed from agent-observations.md with deprecation warning
- `/tmp/add-frontmatter.sh` - ✅ Utility script for adding YAML frontmatter to migrated files

**Phase 4.1-4.2 Validation Reports (✅ Created 2025-01-12):**
- `dev/active/phase-4-1-api-validation-report.md` - ✅ API contracts & schemas validation (comprehensive 29KB report)
- `dev/active/phase-4-2-database-validation-report.md` - ✅ Database schema validation (comprehensive 28KB report)

**Gap Remediation Documentation (✅ Started 2025-01-12):**
- `documentation/infrastructure/reference/database/table-template.md` - ✅ Comprehensive table doc template (415 lines)
- `documentation/infrastructure/reference/database/tables/organizations_projection.md` - ✅ Hierarchical organization structure (760 lines)
- `documentation/infrastructure/reference/database/tables/users.md` - ✅ User authentication & multi-tenant access (742 lines)
  - `documentation/workflows/getting-started/` - ✅ Created
  - `documentation/workflows/architecture/` - ✅ Created
  - `documentation/workflows/guides/` - ✅ Created
  - `documentation/workflows/reference/` - ✅ Created
  - `documentation/workflows/testing/` - ✅ Created
  - `documentation/workflows/operations/` - ✅ Created
- `documentation/infrastructure/README.md` - ✅ Infrastructure documentation index
  - `documentation/infrastructure/getting-started/` - ✅ Created
  - `documentation/infrastructure/architecture/` - ✅ Created
  - `documentation/infrastructure/guides/database/` - ✅ Created
  - `documentation/infrastructure/guides/kubernetes/` - ✅ Created
  - `documentation/infrastructure/guides/supabase/` - ✅ Created
  - `documentation/infrastructure/reference/database/` - ✅ Created
  - `documentation/infrastructure/reference/kubernetes/` - ✅ Created
  - `documentation/infrastructure/testing/` - ✅ Created
  - `documentation/infrastructure/operations/deployment/` - ✅ Created
  - `documentation/infrastructure/operations/configuration/` - ✅ Created
  - `documentation/infrastructure/operations/troubleshooting/` - ✅ Created
- `documentation/architecture/README.md` - ✅ Cross-cutting architecture index
  - `documentation/architecture/authentication/` - ✅ Created
  - `documentation/architecture/authorization/` - ✅ Created
  - `documentation/architecture/data/` - ✅ Created
  - `documentation/architecture/workflows/` - ✅ Created
- `documentation/archived/README.md` - ✅ Archived content index

**Total Created**: 40 directories, 7 README.md files

**Validation Scripts (Phase 1.3 - ✅ Complete 2025-01-12):**
- `scripts/documentation/find-markdown-files.js` - ✅ Created (3,328 bytes)
  - Recursively finds all markdown files in repository
  - Excludes: node_modules, .git, dev, build artifacts
  - Output modes: human-readable (grouped by directory), JSON, count-only
  - Zero external dependencies (Node.js built-in modules only)
- `scripts/documentation/categorize-files.js` - ✅ Created (6,504 bytes)
  - Categorizes files as "stay" (44) or "move" (118)
  - Provides suggested destination paths
  - Flags .plans/ content for manual review
  - Implements all stay/move rules from project requirements
- `scripts/documentation/validate-links.js` - ✅ Created (6,501 bytes)
  - Validates internal markdown links
  - Checks if linked files exist
  - Resolves relative paths correctly
  - Reports broken links with line numbers
- `scripts/documentation/README.md` - ✅ Created (10,256 bytes)
  - Comprehensive usage documentation
  - Integration with CI/CD guidance
  - Development and troubleshooting sections
  - Workflow examples

**Implementation Tracking Documents (Phase 2 - ✅ Complete 2025-01-12):**
- `dev/parked/subdomain-provisioning/` - ✅ Created
  - `implementation-tracking.md` - Moved from SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md
  - `README.md` - Project context (status: Phase 0-2 complete, paused)
- `dev/parked/organization-module/` - ✅ Created
  - `implementation-tracking.md` - Moved from ORGANIZATION_MODULE_IMPLEMENTATION.md
  - `README.md` - Project context (status: ✅ Complete 2025-10-30)
- `dev/parked/frontend-integration-testing/` - ✅ Created
  - `testing-guide.md` - Moved from FRONTEND_INTEGRATION_TESTING.md
  - `README.md` - Testing guide context

**Migration Artifacts (Future Phases - ⏸️ Pending):**
- `documentation/MIGRATION_REPORT.md` - Summary of all moves and findings
- `.plans/README.md` - Explains migration to documentation/architecture/
- `dev/parked/remove-temporal-project/remove-temporal-project.md` - ✅ Created (Phase 0)

**Dev-Docs:**
- `dev/active/documentation-grooming-plan.md` - ✅ Created (Phase 0)
- `dev/active/documentation-grooming-context.md` - ✅ Created (Phase 0), Updated 2025-01-12
- `dev/active/documentation-grooming-tasks.md` - ✅ Created (Phase 0), Updated 2025-01-12

## Related Components

### Frontend (`frontend/`)
- Contains 55 well-organized docs in `frontend/docs/`
- Has component-specific documentation already categorized
- Will reorganize to standardized structure in `documentation/frontend/`
- Validation workflow and scripts need path updates

### Infrastructure (`infrastructure/`)
- Contains scattered docs across supabase/, k8s/, and root
- Has critical operational docs (deployment, OAuth, JWT setup)
- Will organize into `documentation/infrastructure/` following standard structure

### Workflows (`workflows/`)
- Minimal documentation currently (2 files)
- Will establish full standard structure in `documentation/workflows/`
- **Note**: This is the ONLY Temporal.io directory (temporal/ was deprecated and removed)

### Planning Directories (`.plans/`, `.archived_plans/`)
- Contains 15 directories with mixed content (aspirational, current, deprecated)
- Requires careful audit before migration
- Current content → `documentation/architecture/`
- Aspirational content → `documentation/architecture/` with status tags
- Deprecated content → DO NOT MOVE

## Key Patterns and Conventions

### Naming Convention
- **All filenames**: lowercase-kebab-case (e.g., `jwt-custom-claims.md`)
- **No abbreviations**: Use full descriptive names
- **Category prefixes where helpful**: `rbac-implementation.md` not `implementation.md`

### Directory Organization
```
documentation/
├── README.md (master index)
├── templates/ (shared)
├── frontend/
│   ├── getting-started/
│   ├── architecture/
│   ├── guides/
│   ├── reference/
│   │   ├── api/
│   │   └── components/
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
│   ├── testing/
│   └── operations/
├── architecture/ (cross-cutting)
│   ├── authentication/
│   ├── authorization/
│   ├── data/
│   └── workflows/
└── archived/
```

### Status Annotation Pattern

**YAML Frontmatter** (at top of every moved document):
```yaml
---
status: current|aspirational|archived
last_updated: 2025-01-12
applies_to_version: v1.2.0
---
```

**Inline Markers** (for aspirational sections):
```markdown
> [!NOTE] This feature is not yet implemented

Or:

⚠️ ASPIRATIONAL: This describes planned functionality...
```

### Link Cross-Reference Pattern
```markdown
## See Also
- [Related Topic](../path/to/related.md)
- [Another Topic](./sibling-doc.md)
```

## Reference Materials

### Exploration Report
The Plan agent generated a comprehensive audit report identifying:
- 166 total markdown files in repository (BEFORE temporal/ removal)
- 47 files that stay in place (CLAUDE.md, README.md, .claude/*)
- 119 files to move to documentation/
- 15 planning directories requiring audit and categorization
- Content analysis by type (API contracts, database schemas, config, architecture)

### User Requirements
From clarifying questions:
- Move all markdown EXCEPT: CLAUDE.md, README.md, .claude/*, dev/*
- Validate: API contracts, database schemas, configuration, architecture
- Annotate: YAML frontmatter + inline markers
- Implementation tracking: Move to dev/parked/<intent>/
- API contracts: Keep in place (infrastructure/supabase/contracts/)
- **Uniformity is paramount** - no exceptions for co-locality

### Discovery Findings
- temporal/ directory was deprecated (removed during planning)
- .plans/ contains mixed content requiring categorization
- Frontend has validation workflow that needs updating
- CI/CD workflows reference documentation paths (need updates)

## Important Learnings & Gotchas

### Phase 1 Learnings
1. **File Count Updates**: After Phase 2 completion, markdown file count decreased from 162 → 160 (moved 3 tracking docs to dev/parked/, but they were excluded from original count). Actual count before Phase 2: 162. After Phase 2: 159 (3 moved from root). Current validation scripts show 160. - Discovered 2025-01-12

2. **Script Testing Results**: All validation scripts work correctly with current repository structure:
   - find-markdown-files.js: Reports 160 files
   - categorize-files.js: Shows 44 stay, 116 move (updated after Phase 2)
   - validate-links.js: Shows 9 broken links (all pre-existing in .claude/skills and documentation/ placeholders, not caused by migration)

3. **Git History Preservation**: Using `git mv` successfully preserves file history. Git status correctly shows files as "R" (renamed) rather than deleted+added. - Confirmed 2025-01-12

### Phase 2 Learnings
1. **Context READMEs Are Valuable**: Creating README.md in each dev/parked/ subdirectory provides essential context:
   - Why the project was parked
   - Current status and completion state
   - How to resume work
   - Related documentation references
   - This pattern should be followed for ALL parked projects

2. **Implementation Tracking Documents**: Three types identified:
   - **In-Progress** (subdomain-provisioning): Paused at stable checkpoint
   - **Complete** (organization-module): Finished and in production
   - **One-Time Guides** (frontend-integration-testing): Specific to completed implementation
   - Each type needs different README context

### Phase 3 Learnings (Added 2025-01-12)
1. **Frontend Migration Scale**: Frontend docs were the largest migration (58 files). Well-organized source structure (frontend/docs/ with subdirectories) made batch moves efficient via `for file in` loops.

2. **Broken Links Are Expected**: Link count jumped from 16 → 54 broken links after Phase 3 migration. This is NORMAL and deferred to Phase 6.1 (Update Internal Links). Don't try to fix during migration - focus on moving files first.

3. **README Replacement Strategy**: Placeholder READMEs (24 lines) should be replaced with comprehensive versions when source has better content (frontend/docs/README.md had 496 lines). Use `git mv -f` to overwrite placeholders.

4. **Empty Directory Cleanup**: After moving all .md files from subdirectories, use `find frontend/docs/ -type d -empty -delete` to remove empty directories automatically. Keeps structure clean.

5. **Git Commit Strategy**: Breaking Phase 3 into 3 commits (3.1-3.2, 3.3, 3.4) kept history clean and made rollback easier if needed. Each commit had clear scope: infrastructure, frontend, workflows.

6. **CLAUDE.md Path Updates**: Relative paths in component CLAUDE.md files need updating after migration. Infrastructure had 6 references, frontend had 2. Check with `grep -n "docs/" */CLAUDE.md` to find all.

7. **Contracts Directory Stays In Place**: API contracts in `infrastructure/supabase/contracts/` stay near source code per project requirements. Links to contracts need relative path adjustments (e.g., `../../../../../infrastructure/supabase/contracts/`).

8. **Documentation Artifacts Remain**: Non-markdown files in docs/ directories (dashboard.html, metrics.json, *.json reports) stay in place - they're dev artifacts, not documentation to migrate.

## Important Constraints

### Phase 3.5 Learnings (Added 2025-01-12)

**Planning Doc Status Markers Are Often Outdated**:
- Planning documents frequently have status markers that don't reflect actual implementation
- Always verify with user or check actual code before categorizing as CURRENT vs ASPIRATIONAL
- Example: temporal-workflow-design.md said "Design Complete - Not Implemented" but 303-line implementation existed

**Pandoc Availability Cannot Be Assumed**:
- User had to install pandoc during session for HTML conversion
- Have fallback plan for HTML → Markdown conversion if pandoc unavailable
- Discovered during multi-tenancy-organization.html conversion

**Zitadel → Supabase Auth Migration is Complete**:
- All references to Zitadel in documentation need updating to Supabase Auth
- Migration completed October 2025
- Preserved deprecated Zitadel docs in .archived_plans/ for historical reference
- sed find/replace patterns: `s/Zitadel Cloud/Supabase Auth/g`, `s/Zitadel organizations/Database organization records/g`, etc.

**Infrastructure Feature Status Requires User Verification**:
- Infrastructure features (cloudflare, networking) may be operational without explicit documentation updates
- User knows actual deployment state better than planning docs
- Ask user to confirm operational status before categorizing

**CQRS/Event-Sourcing Content is Transversal**:
- Event-sourcing architecture spans all planning docs (not specific to one feature)
- Should be extracted to standalone doc when found mixed with deprecated content
- Lives in `documentation/architecture/data/` as foundational cross-cutting concern

### Gap Remediation Learnings (Added 2025-01-12, Updated 2025-01-13)

**Comprehensive Table Documentation Pattern Works**:
- Template-driven approach (415 lines) ensures consistency
- Each table doc takes ~30-45 minutes for comprehensive coverage
- 700-1,000 lines per table provides complete developer reference (range: 742-1,057 lines)
- Pattern: Schema → Relationships → Indexes → RLS → Usage Examples → Troubleshooting
- Two detailed examples (infrastructure + auth tables) sufficient for team to parallelize
- Critical sections: RLS policies with testing examples, JSONB schema documentation, common query patterns

**Database Documentation Excellence Gap**:
- Frontend has 50+ component docs with automated validation
- Database had ZERO schema docs for 12 production tables
- Same codebase, vastly different documentation cultures
- Applying frontend's template pattern to database closes the gap
- Comprehensive docs prevent "read SQL files directly" barrier for new developers

**ltree and Array Columns Need Extra Care**:
- PostgreSQL-specific types (ltree, uuid[]) require detailed explanation
- Hierarchical queries need examples: ancestors, descendants, children
- GIN indexes for arrays need query pattern documentation
- JSONB schemas should include TypeScript-style interface definitions

**Clinical Tables Documentation is Critical** (Added 2025-01-13):
- **All clinical tables have CRITICAL RLS GAP**: RLS enabled but NO policies defined
  - clients, medications, medication_history, dosage_info all blocked by default
  - Each doc includes recommended policies ready for implementation
  - This is a production blocker - tables cannot be used without RLS policies
- **PHI/RESTRICTED data sensitivity**: Clinical tables contain Protected Health Information
  - Clients, medication_history, dosage_info all HIPAA-regulated
  - Documentation includes compliance sections (HIPAA, GDPR, DEA for controlled substances)
- **Complex JSONB schemas require TypeScript-style documentation**:
  - vitals_before/vitals_after in dosage_info (BP, HR, temp, O2 sat)
  - address/emergency_contact in clients (structured location/contact data)
  - active_ingredients in medications (multi-ingredient drug composition)
- **Clinical workflow states well-documented**:
  - Medication status: active → completed/discontinued/on_hold
  - Dose status: scheduled → administered/refused/skipped/missed/late/early
  - Client status: active ↔ inactive → archived
- **Regulatory tracking is embedded**:
  - Controlled substance schedule tracking (DEA Schedule II-V)
  - Prescriber NPI and license number tracking
  - Refill authorization and usage tracking
  - High-alert medication and black box warning flags

### Phase 4.1-4.2 Learnings (Added 2025-01-12)

**Frontend API Documentation is Generally Accurate**:
- Core interfaces (IClientApi, IMedicationApi) match implementation exactly
- Type-level validation shows strong documentation discipline
- Problem areas: UI components and specialized services

**UI Component Documentation Has Significant Drift**:
- SearchableDropdownProps: 73% undocumented (22/30 properties missing)
- Documentation describes basic 8-property interface, implementation has 30 properties
- Root cause: Component evolved rapidly, docs didn't keep pace
- Pattern: Documentation written early, not updated during feature expansion

**Specialized vs Generic Implementation Mismatch**:
- HybridCacheService documented as generic `key/value` cache
- Actual implementation specialized for medication search (`query: string, medications: Medication[]`)
- Root cause: Initial architecture envisioned reusable cache, implementation optimized for specific use case
- Documentation describes aspirational generic design, not current specialized reality

**Critical Database Schema Documentation Gap**:
- **ZERO dedicated database schema documentation** despite 12 production tables
- High-level architecture docs exist (CQRS, multi-tenancy concepts)
- No table schemas, no RLS policy docs, no function reference
- Developers must read SQL files directly - major onboarding barrier
- Impact: High - blocks database development and maintenance

**AsyncAPI Contracts Exist But Aren't Validated**:
- Event contracts defined in `infrastructure/supabase/contracts/asyncapi/`
- Documents domain events (ClientRegistered, MedicationPrescribed, etc.)
- Deferred validation to Phase 4.4 (requires code analysis to verify emission)

**Database Implementation is Technically Sound**:
- Proper use of PostgreSQL features (RLS, triggers, functions)
- Idempotent migrations with `IF NOT EXISTS`
- Event-driven CQRS architecture implemented correctly
- Problem is purely documentation, not implementation

**Documentation Excellence Gap Between Frontend and Database**:
- Frontend: 50+ component docs, automated validation, template-driven
- Database: 0 schema docs, no validation tooling, no templates
- Same codebase, vastly different documentation cultures

## Important Constraints

### Must Not Break
- GitHub README.md display at directory roots
- Claude Code infrastructure in .claude/
- Git commit history (use `git mv` not `mv`)
- API contracts in infrastructure/supabase/contracts/ (stay near code)
- Active development work in dev/active/

### Must Preserve
- All existing content (no deletion, only moves)
- Directory structures that work well (but reorganize to standard)
- Technical accuracy (validate before marking as current)
- Context for future developers
- Historical reference (deprecated content stays in .plans/)

### Performance Constraints
- ~119 files to move and reorganize
- 15 planning directories to audit
- Technical validation is time-intensive (estimated 8.5 hours)
- Link fixing requires careful attention to relative paths
- CI/CD workflow and script updates (2 hours)

## Why This Approach?

### Why Uniformity Over Co-Locality?

**User's insight**: "If moving frontend documentation violates co-locality principles, couldn't the same thing be said for other projects (workflow and infrastructure)?"

**Answer**: Absolutely correct. Inconsistent application of co-locality would mean:
- frontend/docs/ stays (for validation)
- workflows/IMPLEMENTATION.md stays (for workflow context)
- infrastructure/supabase/docs/ stays (near infrastructure)

This defeats the entire purpose of documentation consolidation.

**Chosen approach**: Uniform migration
- ✅ All documentation moves to documentation/
- ✅ CI/CD workflows updated to match
- ✅ Validation scripts updated to match
- ✅ Consistency across all components
- ✅ Single discoverable location

### Why Categorize Planning Documentation?

**Problem**: `.plans/` contains:
- Future plans (aspirational)
- Current implementation (accurate)
- Old systems (deprecated/false - like Zitadel)

**Blindly moving all planning docs would**:
- Mix aspirational and current information
- Include false information (Zitadel docs when using Supabase Auth)
- Make it impossible to trust documentation

**Solution**: Audit first, then:
- Move current/aspirational with proper status tags
- Leave deprecated content in .plans/ for historical reference
- Ensure documentation/ contains only trustworthy information

### Why Dual Annotation System?

**YAML frontmatter alone**: Not visible to casual readers
**Inline markers alone**: Not machine-readable

**Both together**:
- Serves humans (inline markers)
- Serves machines (frontmatter for tooling)
- Provides redundancy

### Why Update CI/CD Workflows?

**Alternative**: Keep frontend/docs/ to avoid updating workflows

**Rejected because**:
- Violates uniformity principle
- Creates confusion about "where do docs go?"
- Sets precedent for component-specific exceptions

**Chosen**: Update workflows
- One-time cost
- Maintains consistency
- Future developers have clear pattern

## Current Status

**Phase**: Addressing Phase 4 Gaps - Database Schema Documentation (Gap Remediation)
**Status**: ✅ 100% COMPLETE (12 of 12 core tables documented - 9,660 lines)
**Last Updated**: 2025-01-13

**Completed Phases (Documentation Grooming)**:
- ✅ Phase 0 - Discovery & Planning
- ✅ Phase 1 - Structure Creation (directory structure, master index, validation scripts)
- ✅ Phase 2 - Implementation Tracking Document Migration
- ✅ Phase 3.1 - Move Root-Level Documentation (2 files)
- ✅ Phase 3.2 - Move Infrastructure Documentation (22 files)
- ✅ Phase 3.3 - Move Frontend Documentation (58 files)
- ✅ Phase 3.4 - Move Workflow Documentation (1 file)
- ✅ Phase 3.5 - Audit and Categorize Planning Documentation (30 files + 2 special handling)
- ✅ Phase 4.1 - Validate API Contracts & Schemas
- ✅ Phase 4.2 - Validate Database Schemas

**Gap Remediation Progress (NEW - Started 2025-01-12, Updated 2025-01-13)**:

After Phase 4 validation identified critical documentation gaps, created a new plan to address them. Started with highest priority: database schema documentation. **User selected Option C: Document all remaining tables in this session.**

- **Phase 1.1 COMPLETE** - Table Documentation Template Created
  - Created comprehensive template at `documentation/infrastructure/reference/database/table-template.md`
  - 415 lines covering: Schema, Relationships, Indexes, RLS Policies, Constraints, Triggers, Usage Examples, Audit Trail, JSONB schemas, Troubleshooting
  - Modeled after successful frontend `component-template.md` pattern

- **Phase 1.2 COMPLETE** - Core Tables Documentation (12/12 = 100% COMPLETE)

  **✅ Infrastructure & Auth Tables (2 tables - 1,502 lines):**
  - ✅ **organizations_projection.md** (760 lines)
    - Full schema with all 15 columns documented
    - ltree hierarchical path system explained with examples
    - 8 indexes (GIST, BTREE, partial indexes) with purposes
    - 2 RLS policies (super_admin, org_admin) with testing examples
    - Hierarchical queries: find ancestors, descendants, direct children
    - Soft delete and deactivation patterns
    - Check constraints for hierarchy integrity

  - ✅ **users.md** (742 lines)
    - Shadow table for Supabase Auth integration
    - 10 columns including arrays (accessible_organizations)
    - 4 indexes including GIN index for array containment
    - 3 RLS policies (super_admin, org_admin, self-access) - three-tier model
    - Multi-organization access management examples
    - GDPR compliance examples (right to access, erasure, portability)
    - JSONB metadata schema with preferences, onboarding tracking

  **✅ Clinical Operations Tables (4 tables - 3,871 lines) - Added 2025-01-13:**
  - ✅ **clients.md** (953 lines)
    - Patient/client records with full medical information (PHI/RESTRICTED)
    - 20 columns including JSONB (address, emergency_contact) and arrays (allergies, medical_conditions)
    - 4 indexes for name search, DOB, status, organization
    - ⚠️ **CRITICAL GAP**: RLS enabled but NO policies defined
    - HIPAA/GDPR compliance considerations documented
    - JSONB schemas for address and emergency contact
    - Comprehensive usage examples and common queries

  - ✅ **medications.md** (1,057 lines)
    - Medication catalog with RxNorm integration (INTERNAL/reference data)
    - 26 columns including regulatory flags (is_controlled, is_psychotropic, is_high_alert)
    - RxNorm CUI and NDC code integration for national standards
    - 7 indexes including name, generic_name, rxnorm_cui, is_controlled
    - ⚠️ **CRITICAL GAP**: RLS enabled but NO policies defined
    - JSONB active_ingredients schema for multi-ingredient drugs
    - Controlled substance schedule tracking (DEA Schedule II-V)
    - Black box warnings and high-alert medication flags

  - ✅ **medication_history.md** (1,006 lines)
    - Prescription tracking with comprehensive clinical data (PHI/RESTRICTED)
    - 32 columns covering prescription, dosage, refills, compliance, side effects
    - 6 indexes for client lookups, medication usage, status, PRN filtering
    - ⚠️ **CRITICAL GAP**: RLS enabled but NO policies defined
    - Prescriber information (NPI, license tracking)
    - Refill tracking and inventory management
    - Compliance percentage and missed dose tracking
    - Side effect reporting and effectiveness ratings

  - ✅ **dosage_info.md** (855 lines)
    - Medication administration records (MAR) tracking (PHI/RESTRICTED)
    - 23 columns for scheduled vs actual administration, vitals, adverse reactions
    - 6 indexes for MAR queries, scheduling, staff tracking
    - ⚠️ **CRITICAL GAP**: RLS enabled but NO policies defined
    - Dose status workflow (scheduled → administered/refused/skipped/missed)
    - JSONB vitals_before/vitals_after schemas for monitoring
    - Adverse reaction reporting with safety alerts
    - Double-check verification workflow (administered_by + verified_by)

  **✅ RBAC Projection Tables (4 tables - 2,804 lines) - COMPLETE:**
  - ✅ **permissions_projection.md** (728 lines) - Added 2025-01-13
    - CQRS projection for atomic authorization units
    - 4 indexes including partial index for MFA-required permissions
    - 2 RLS policies (super_admin all access, authenticated read-only)
    - Generated `name` column (applet.action format) for JWT claims
    - Scope types: global, org, facility, program, client
    - Complete event sourcing with permission.defined events

  - ✅ **roles_projection.md** (814 lines) - Added 2025-01-13
    - Dual-pattern design: global templates vs org-scoped roles
    - Check constraint enforces global (super_admin) vs org-scoped pattern
    - ltree org_hierarchy_scope for hierarchical permission inheritance
    - 5 indexes including GIST for ltree operations
    - 3 RLS policies (super_admin, org_admin, global template visibility)
    - Role lifecycle: created, updated, soft deleted

  - ✅ **role_permissions_projection.md** (731 lines) - Added 2025-01-13
    - Many-to-many junction table (roles ↔ permissions)
    - Composite PRIMARY KEY (role_id, permission_id) prevents duplicates
    - 2 indexes for bidirectional lookups
    - 3 RLS policies (super_admin, org_admin, global roles)
    - Idempotent event processing (ON CONFLICT DO NOTHING)
    - Events: role.permission.granted, role.permission.revoked

  - ✅ **user_roles_projection.md** (831 lines) - Added 2025-01-13
    - User role assignments with org-level scoping
    - Hybrid: global super_admin (org_id = NULL) + org-scoped assignments
    - PostgreSQL 15+ UNIQUE NULLS NOT DISTINCT constraint
    - Check constraint: (org_id IS NULL AND scope_path IS NULL) OR both NOT NULL
    - 6 indexes including composite idx_user_roles_auth_lookup for JWT generation
    - 3 RLS policies (super_admin, org_admin, self-access)
    - ltree scope_path for hierarchical permission checks

  **✅ System Tables (2 tables - 1,538 lines) - COMPLETE:**
  - ✅ **invitations_projection.md** (817 lines) - Added 2025-01-13
    - User invitation workflow tracking (Temporal → Edge Functions)
    - 256-bit cryptographically secure tokens (URL-safe base64)
    - Status state machine: pending → accepted/expired/deleted
    - 7 indexes including GIN for tags array (dev cleanup)
    - ⚠️ RLS enabled with COMMENTED-OUT policy (Edge Functions use service role)
    - Foreign key to organizations_projection with CASCADE delete
    - Event: UserInvited (from GenerateInvitationsActivity)
    - Includes development tags for test data cleanup

  - ✅ **cross_tenant_access_grants_projection.md** (721 lines) - Added 2025-01-13
    - Cross-organization data access (provider_partner → provider)
    - Legal authorization types: var_contract, court_order, parental_consent, etc.
    - Scope hierarchy: full_org, facility, program, client_specific
    - Status state machine: active → revoked/expired/suspended → reactivated
    - 11 indexes including composite for active grant lookups
    - ⚠️ **CRITICAL**: RLS enabled but NO policies defined (table blocked)
    - JSONB permissions and terms fields for granular access control
    - Complete audit trail: granted_by, revoked_by, suspended_by, reactivated_by
    - Events: access_grant.created, revoked, expired, suspended, reactivated

**Validation Reports Created**:
- dev/active/phase-4-1-api-validation-report.md (29KB)
- dev/active/phase-4-2-database-validation-report.md (28KB)

**Migration Statistics**:
- **Total markdown files**: 159
- **Files migrated**: 115 (99% complete)
- **Files staying in place**: 31 (CLAUDE.md, README.md, .claude/*, dev/*, contracts/)
- **Deprecated files preserved**: 6 (historical reference in .archived_plans/)
- **Validation reports created**: 2 (Phase 4.1 and 4.2)
- **Table docs created**: 13 (template + 12 tables = 10,075 lines total)

**Key Findings from Phase 4.1-4.2**:
- **Critical Gap**: Database schemas completely undocumented (HIGH impact) - ✅ **RESOLVED** (100% complete)
- **High Priority**: SearchableDropdownProps missing 22/30 properties in docs - PENDING
- **Medium Priority**: HybridCacheService docs describe generic design, implementation is specialized - PENDING
- **Strengths**: Core API interfaces (IClientApi, IMedicationApi) perfectly documented

**Gap Remediation Decision**:
- **Selected**: Option C - Document all remaining tables in this session
- **Outcome**: ✅ SUCCESS - All 12 core tables documented (9,660 lines)
- **Critical RLS Gaps Identified**:
  - cross_tenant_access_grants_projection: RLS enabled, NO policies (blocks all access)
  - invitations_projection: RLS enabled, commented-out policy (Edge Functions bypass via service role)
- **Session Duration**: ~4 hours (faster than estimated 6-8 hours due to template efficiency)

**Original Phase 4+ Still Pending**:
1. **Phase 4.3** - Validate Configuration References (env vars, configs, secrets)
2. **Phase 4.4** - Validate Architecture Descriptions (structure, topology, workflows)
3. **Phase 4 Final Report** - Consolidate all validation findings
4. **Phase 5** - Annotation & Status Marking (deferred pending validation completion)
5. **Phase 6** - Cross-Referencing & Master Index
6. **Phase 7** - Validation, Cleanup, and CI/CD Updates
