# Implementation Plan: Documentation Alignment

## Executive Summary

Compare `/documentation/` against actual codebase implementation and fix all deviations. The plan is divided into three phases by priority. Phase 1 and Phase 2 are complete.

## Phase 1: High Priority - Critical Accuracy ✅ COMPLETE

### 1.1 Database Table Documentation
- Created 10 missing table docs (junction tables, projections, system tables)
- Updated table count from "12 core tables" to "29 tables" across all docs
- All tables now documented with YAML frontmatter, TL;DR sections

### 1.2 Activity Count Correction
- Verified actual count: 13 activities (7 forward + 6 compensation)
- Updated 6 workflow documentation files

### 1.3 Audit Trail Clarification
- Removed references to non-existent `audit_log` table
- Documented that `domain_events` is sole audit mechanism
- Updated table-template.md

## Phase 2: Low Priority - Status Markers ✅ COMPLETE

### 2.1 Impersonation Documentation
- Changed status from `aspirational` to `current`
- Added detailed warnings about incomplete e2e flow
- Updated 5 impersonation docs

### 2.2 Provider Partner Documentation
- Updated status markers with implementation details
- Clarified what works (creation) vs not implemented (management UI)
- Updated 2 provider partner docs

### 2.3 AGENT-INDEX.md Updates
- Added 12 new keyword entries for new table docs
- Verified keyword navigation works

## Phase 3: Medium Priority - Documentation Completeness ⏸️ PENDING

### 3.1 Permission Documentation
- Document 16 canonical permissions from grantProviderAdminPermissions
- Update permission count references

### 3.2 API Function Documentation
- Document 70+ functions in api schema
- At minimum: emit_domain_event, CRUD for each entity

### 3.3 Event Processor Documentation
- Document 11 processor functions
- Include routing logic in process_domain_event

### 3.4 Frontend Documentation
- ServiceFactory pattern
- ViewModel disposal patterns
- MobX observable patterns

### 3.5 Verification
- Audit cross-references and file paths
- Verify version numbers match package.json

## Success Metrics

### Immediate ✅
- [x] Table counts accurate (29 tables)
- [x] Activity counts accurate (13 activities)
- [x] No audit_log references
- [x] Accurate status markers

### Medium-Term
- [ ] All API functions documented
- [ ] All event processors documented
- [ ] All links verified

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Missing tables | Created template-based docs for all 10 |
| Incorrect status | Used `current` with inline warnings |
| Broken links | Will audit in Phase 3 |

## Next Steps After Completion

1. Commit changes with detailed message
2. Continue with Phase 3 medium-priority tasks
3. Run `/docs:check` to verify any automated checks
