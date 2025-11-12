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

**Phase**: Phase 2 - Implementation Tracking Document Migration
**Status**: ✅ COMPLETE
**Last Updated**: 2025-01-12

**Phase 0 - Discovery & Planning** ✅ COMPLETE:
- ✅ Comprehensive repository scan (166 markdown files identified)
- ✅ Categorization of stay vs. move files
- ✅ User requirement clarification (5+ rounds of questions)
- ✅ Directory structure design (standardized across components)
- ✅ Implementation plan created and refined
- ✅ Discovered and removed deprecated temporal/ directory
- ✅ Created dev/parked/remove-temporal-project/ documentation
- ✅ Addressed .plans/ categorization challenge
- ✅ Identified CI/CD workflow updates needed
- ✅ Resolved uniformity vs co-locality question (uniformity wins)
- ✅ Created documentation-grooming-tasks.md
- ✅ Created documentation-grooming-plan.md
- ✅ Created documentation-grooming-context.md

**Phase 1.1 - Create Directory Structure** ✅ COMPLETE (2025-01-12):
- ✅ Created `documentation/` root directory
- ✅ Created 40 total directories in standardized structure
- ✅ Created 7 README.md files with comprehensive documentation
- ✅ All component directories follow uniform structure:
  - frontend/ - 7 subdirectories (getting-started, architecture, guides, patterns, testing, performance, reference/)
  - workflows/ - 6 subdirectories (getting-started, architecture, guides, reference, testing, operations/)
  - infrastructure/ - 12 subdirectories (includes guides/{database,kubernetes,supabase}, operations/{deployment,configuration,troubleshooting})
  - architecture/ - 4 cross-cutting domains (authentication, authorization, data, workflows)
  - templates/ - Shared documentation templates
  - archived/ - Historical and deprecated content

**Phase 1.2 - Create Master Index Template** ✅ COMPLETE (2025-01-12):
- ✅ Enhanced documentation/README.md from 72 to 343 lines
- ✅ Added "Quick Start - Common Tasks" section (3 categories: New Developers, Frequently Needed, Architecture & Design)
- ✅ Created comprehensive Table of Contents with all sections and subsections
- ✅ Added "Documentation by Audience" with 3 personas:
  - 👨‍💻 Developers (4 categories: Getting Started, Daily Development, Architecture & Patterns, API & Reference)
  - 🔧 Operators (3 categories: Deployment, Monitoring & Troubleshooting, Configuration Management)
  - 🏗️ Architects (3 categories: System Architecture, Component Architecture, Patterns & Practices)
- ✅ Created "Documentation Organization" section with standard directory structure table
- ✅ Added comprehensive "Documentation Status" section with:
  - Status types table (current, aspirational, archived)
  - Dual annotation system (YAML frontmatter + inline markers)
  - Concrete examples of both current and aspirational documentation
- ✅ Added "Navigation Tips" section with finding strategies and search strategies
- ✅ Added "Contributing to Documentation" guidelines (placement, structure, cross-references, quality)
- ✅ Added "Migration Information" section with phase status and old location mappings

**Phase 1.3 - Create Validation Scripts** ✅ COMPLETE (2025-01-12):
- ✅ Created `scripts/documentation/` directory at repository root
- ✅ Created three automation scripts (all zero dependencies, Node.js built-in modules only):
  - **find-markdown-files.js** - Recursively finds all markdown files
    - Excludes: node_modules, .git, dev, build artifacts (.next, dist, build, coverage, .temporal)
    - Found: 162 markdown files in current repository
    - Output modes: human-readable (grouped by directory), JSON, count-only
  - **categorize-files.js** - Categorizes files as "stay" or "move"
    - Stay rules: CLAUDE.md, README.md, .claude/, dev/, infrastructure/supabase/contracts/
    - Current breakdown: 44 files stay, 118 files move
    - Provides suggested destination paths for files to move
    - Flags .plans/ and .archived_plans/ for manual review (Phase 3.5)
  - **validate-links.js** - Validates internal markdown links
    - Finds all markdown links: [text](path)
    - Checks if linked files exist
    - Resolves relative paths correctly
    - Current status: 503 total links, 256 internal links, 9 broken links (pre-existing)
- ✅ All scripts executable and tested on full repository
- ✅ Created comprehensive README.md (scripts/documentation/README.md)
  - Script usage examples
  - Output format documentation
  - Integration with CI/CD guidance
  - Development and troubleshooting sections
  - Workflow examples

**Phase 2.1 - Identify WIP Tracking Documents** ✅ COMPLETE (2025-01-12):
- ✅ Identified 3 WIP tracking documents in repository root:
  - **SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md** - Status: Phase 0-2 Complete
    - Temporal-first subdomain provisioning implementation
    - Non-blocking bootstrap with background DNS verification
    - Paused after completing infrastructure phases
  - **ORGANIZATION_MODULE_IMPLEMENTATION.md** - Status: ✅ Complete (2025-10-30)
    - Full-stack organization management with CQRS/Event Sourcing
    - Complete implementation including frontend, backend, workflows, and testing
    - Production-ready, all phases complete
  - **FRONTEND_INTEGRATION_TESTING.md** - Status: Configuration Complete (2025-10-30)
    - Integration testing guide for Organization Module
    - Step-by-step testing procedures for Edge Functions and database
    - Testing guide specific to Organization Module implementation
- ✅ No other WIP tracking documents found in repository root

**Phase 2.2 - Move to dev/parked/** ✅ COMPLETE (2025-01-12):
- ✅ Created three subdirectories under dev/parked/:
  - `dev/parked/subdomain-provisioning/` - For subdomain provisioning project
  - `dev/parked/organization-module/` - For organization module project
  - `dev/parked/frontend-integration-testing/` - For integration testing guide
- ✅ Moved all tracking documents using `git mv` (preserves history):
  - SUBDOMAIN_PROVISIONING_IMPLEMENTATION.md → dev/parked/subdomain-provisioning/implementation-tracking.md
  - ORGANIZATION_MODULE_IMPLEMENTATION.md → dev/parked/organization-module/implementation-tracking.md
  - FRONTEND_INTEGRATION_TESTING.md → dev/parked/frontend-integration-testing/testing-guide.md
- ✅ Created comprehensive README.md in each subdirectory:
  - Project overview and architecture summary
  - Current status and completion state
  - Explanation of why project was parked
  - Related documentation references
  - Instructions for resuming work (where applicable)
  - Reference value for future developers

**Next Steps**:
1. Phase 3 - Documentation Migration (118 files to move and reorganize)
   - 3.1 - Move Root-Level Documentation
   - 3.2 - Move Infrastructure Documentation
   - 3.3 - Move Frontend Documentation
   - 3.4 - Move Workflow Documentation
   - 3.5 - Audit and Categorize Planning Documentation
