# Tasks: Progressive Disclosure Documentation System

## Phase 1: Core Infrastructure ✅ COMPLETE

- [x] Create `documentation/AGENT-INDEX.md` with:
  - [x] Quick decision tree (task → start doc → then read)
  - [x] Keyword → document mapping table
  - [x] Document catalog with summaries and ~token estimates
  - [x] Sync instructions section
- [x] Create `documentation/AGENT-GUIDELINES.md` with:
  - [x] Entry points and search strategy
  - [x] TL;DR section format template
  - [x] Document placement rules
  - [x] Quality checklist
- [x] Update `CLAUDE.md` - Add "AI Agent Quick Start" section
- [x] Update `documentation/README.md` - Add "For AI Agents" section at top
- [x] Update `frontend/CLAUDE.md` - Add "Documentation Resources" link
- [x] Update `workflows/CLAUDE.md` - Add "Documentation Resources" link
- [x] Update `infrastructure/CLAUDE.md` - Add "Documentation Resources" link

## Phase 2: TL;DR High-Priority Documents ✅ IN PROGRESS

- [ ] Add TL;DR to `frontend/CLAUDE.md`
- [ ] Add TL;DR to `workflows/CLAUDE.md`
- [ ] Add TL;DR to `infrastructure/CLAUDE.md`
- [ ] Add TL;DR to `documentation/README.md`
- [x] Add TL;DR to `documentation/architecture/authentication/frontend-auth-architecture.md`
- [ ] Add TL;DR to `documentation/architecture/authentication/supabase-auth-overview.md`
- [x] Add TL;DR to `documentation/architecture/authorization/rbac-architecture.md`
- [x] Add TL;DR to `documentation/architecture/data/event-sourcing-overview.md`
- [x] Add TL;DR to `documentation/architecture/data/multi-tenancy-architecture.md`
- [x] Add TL;DR to `documentation/architecture/workflows/temporal-overview.md`
- [x] Add TL;DR to `documentation/infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md`
- [ ] Add TL;DR to `documentation/infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md`
- [x] Add TL;DR to `documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md`
- [x] Add TL;DR to `documentation/frontend/guides/EVENT-DRIVEN-GUIDE.md`
- [ ] Add TL;DR to `documentation/frontend/guides/DEVELOPMENT.md`
- [ ] Update AGENT-INDEX.md with keywords from high-priority docs

## Phase 3: TL;DR Architecture Documents ⏸️ PENDING

- [ ] Add TL;DR to all `documentation/architecture/authentication/` files
- [ ] Add TL;DR to all `documentation/architecture/authorization/` files
- [ ] Add TL;DR to all `documentation/architecture/data/` files
- [ ] Add TL;DR to all `documentation/architecture/workflows/` files
- [ ] Add TL;DR to all `documentation/architecture/features/` files (if exists)
- [ ] Update AGENT-INDEX.md with architecture doc keywords

## Phase 4: TL;DR Guides & Reference ⏸️ PENDING

- [ ] Add TL;DR to all `documentation/frontend/guides/` files
- [ ] Add TL;DR to all `documentation/frontend/reference/` files
- [ ] Add TL;DR to all `documentation/frontend/architecture/` files
- [ ] Add TL;DR to all `documentation/frontend/patterns/` files
- [ ] Add TL;DR to all `documentation/infrastructure/guides/` files
- [ ] Add TL;DR to all `documentation/infrastructure/reference/database/tables/` files
- [ ] Add TL;DR to all `documentation/workflows/guides/` files
- [ ] Add TL;DR to all `documentation/workflows/reference/` files
- [ ] Final AGENT-INDEX.md sync - verify all docs catalogued
- [ ] Validate all internal links working

## Success Validation Checkpoints

### Immediate Validation (After Phase 1)
- [ ] AGENT-INDEX.md exists and has keyword table
- [ ] AGENT-GUIDELINES.md exists with TL;DR template
- [ ] Root CLAUDE.md has "AI Agent Quick Start" section
- [ ] All 4 CLAUDE.md files link to agent resources

### Feature Complete Validation (After Phase 4)
- [ ] All 115+ docs have TL;DR sections
- [ ] AGENT-INDEX.md has entries for all documents
- [ ] No broken links in AGENT-INDEX.md
- [ ] Sample test: Agent can find auth docs via keyword "jwt"
- [ ] Sample test: Agent can assess rbac-architecture.md relevance in <10 seconds

## Current Status

**Phase**: 2 - TL;DR High-Priority Documents
**Status**: ✅ IN PROGRESS (8/16 complete)
**Last Updated**: 2025-12-30
**Next Step**: Continue adding TL;DR to remaining high-priority docs
