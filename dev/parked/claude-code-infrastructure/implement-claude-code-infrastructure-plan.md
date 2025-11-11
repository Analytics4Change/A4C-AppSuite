# Implementation Plan: Claude Code Infrastructure Showcase for A4C-AppSuite

## Executive Summary

Implementing the production-tested claude-code-infrastructure-showcase methodology to solve persistent context loss and code pattern inconsistency issues in the A4C-AppSuite monorepo. This implementation addresses the core limitation of Claude Code: skills don't activate automatically and context doesn't survive `/clear` commands.

**Source**: https://github.com/diet103/claude-code-infrastructure-showcase (MIT License)
**Battle-Tested**: 6 months production use, 50k+ lines TypeScript, 6 microservices
**Time Investment**: 33 hours over 2 weeks
**Approach**: Full infrastructure from day 1, starting with Phase 3 to bootstrap the memory system

---

## Phase 1: Core Infrastructure Setup (Day 1 - 2 hours)

### 1.1 Install Essential Hooks
Copy two production-tested hooks that enable auto-activation:

**skill-activation-prompt.js** (UserPromptSubmit hook)
- Analyzes every user prompt
- Checks file context and keywords
- Automatically suggests relevant skills from skill-rules.json
- No manual skill invocation required

**post-tool-use-tracker.sh** (PostToolUse hook)
- Tracks skill usage patterns
- Identifies common workflows
- Provides analytics for CLAUDE.md improvements

**Setup**: Copy from showcase → `.claude/hooks/`, update `.claude/settings.json`

### 1.2 Create skill-rules.json
Configuration file that maps file paths and keywords to skills:

```json
{
  "frontend/**/*.{ts,tsx}": {
    "skills": ["frontend-dev-guidelines"],
    "keywords": ["component", "react", "ui", "accessibility", "mobx"]
  },
  "temporal/src/**/*.ts": {
    "skills": ["temporal-workflow-guidelines"],
    "keywords": ["workflow", "activity", "temporal", "event", "saga"]
  },
  "infrastructure/**/*.tf": {
    "skills": ["infrastructure-guidelines"],
    "keywords": ["terraform", "kubernetes", "supabase", "migration"]
  }
}
```

**Outcome**: Skills activate automatically when editing relevant files

### 1.3 Hierarchical CLAUDE.md Structure
Split monolithic CLAUDE.md into component-specific files to prevent context overload:

```
CLAUDE.md                    # Root (<9k words) - monorepo overview only
├── frontend/CLAUDE.md       # React/Vite/Radix UI/Tailwind patterns
├── temporal/CLAUDE.md       # Workflow/activity/event patterns
└── infrastructure/CLAUDE.md # Terraform/K8s/Supabase patterns
```

**Best Practice**: Each file <10k words, auto-loads based on working directory

---

## Phase 2: Custom Skills Development (Days 2-5 - 20 hours)

Skills follow the **500-line modular pattern**: main SKILL.md file + resource subdirectories for progressive disclosure.

### 2.1 Frontend Skill (6 hours)
**Path**: `.claude/skills/frontend-dev-guidelines/`

**SKILL.md** (<500 lines): High-level navigation and overview
**Resources**:
- `radix-tailwind-components.md` - Custom component patterns (not MUI!)
- `mobx-patterns.md` - State management conventions
- `auth-integration.md` - Supabase Auth provider interface usage
- `testing-strategies.md` - Vitest unit tests + Playwright E2E

**Covers**: React 19, Vite, MobX, Radix UI, Tailwind CSS, WCAG 2.1 Level AA accessibility

### 2.2 Temporal Workflow Skill (8 hours)
**Path**: `.claude/skills/temporal-workflow-guidelines/`

**SKILL.md** (<500 lines): Workflow-First architecture overview
**Resources**:
- `workflow-patterns.md` - Deterministic workflow design
- `activity-best-practices.md` - Side effects and event emission
- `event-emission.md` - Domain events and CQRS integration
- `testing-workflows.md` - Local testing against dev Temporal cluster

**Covers**: Temporal.io, Workflow-First + Saga compensation, event-driven architecture

### 2.3 Infrastructure Skill (6 hours)
**Path**: `.claude/skills/infrastructure-guidelines/`

**SKILL.md** (<500 lines): IaC and deployment overview
**Resources**:
- `terraform-patterns.md` - Workspace management (dev/staging/prod)
- `supabase-migrations.md` - Idempotent SQL, RLS policies, event triggers
- `k8s-deployments.md` - Temporal worker deployments
- `cqrs-projections.md` - Event-driven read models

**Covers**: Terraform, Supabase (PostgreSQL + Auth), Kubernetes (k3s), CQRS

---

## Phase 3: Dev-Docs Pattern (Day 6 - 3 hours) ⭐ CURRENT PHASE

### 3.1 Create Dev-Docs Structure ✅ IN PROGRESS
Implement the three-file pattern for persistent memory:

- `[feature]-plan.md` - Strategic plan (this file!)
- `[feature]-context.md` - Key decisions and architectural context
- `[feature]-tasks.md` - Checklist format for progress tracking

**Outcome**: Context survives `/clear` commands throughout multi-week implementation

### 3.2 Slash Commands (Next Step)
Create automation for dev-docs generation:

**`/dev-docs` command**: Generates plan + context + tasks for new feature
**`/dev-docs-update` command**: Updates context and tasks before `/clear`

**Location**: `.claude/commands/dev-docs.md`, `.claude/commands/dev-docs-update.md`

---

## Phase 4: Custom Agents (Days 7-8 - 8 hours)

Specialized agents for complex validation tasks:

### 4.1 Supabase Migration Validator (3 hours)
**Path**: `.claude/agents/supabase-migration-validator.md`
**Validates**:
- Idempotent CREATE/ALTER statements (IF NOT EXISTS)
- RLS policies using JWT claims correctly
- Foreign key relationships
- Event trigger implementations

### 4.2 Temporal Workflow Reviewer (3 hours)
**Path**: `.claude/agents/temporal-workflow-reviewer.md`
**Validates**:
- No side effects in workflow code (determinism)
- Activities for all external calls
- Proper error handling with Saga compensation
- Event emission in activities, not workflows

### 4.3 Frontend Accessibility Checker (2 hours)
**Path**: `.claude/agents/frontend-accessibility-checker.md`
**Validates**:
- Keyboard navigation support
- ARIA attributes and roles
- Focus management
- Screen reader compatibility

---

## Phase 5: Optional Enhancements (Week 2+)

### Custom Hooks
- **tsc-check.sh**: TypeScript validation before commits (customize for monorepo)
- **Migration idempotency check**: Validate Supabase migrations before deployment

### GitHub Actions Integration
- Claude Code GHA for automated PR creation from Jira tickets
- PR review agent checking CLAUDE.md compliance

### Analytics & Iteration
- Monitor post-tool-use-tracker data
- Identify common errors and update CLAUDE.md
- Refine skills based on usage patterns

---

## Success Metrics

### Immediate (Week 1)
- ✅ Skills auto-activate based on file context
- ✅ Context resets preserve knowledge via dev-docs
- ✅ Component-specific CLAUDE.md loads automatically

### Medium-Term (Month 1)
- ✅ 80%+ reduction in "Claude doesn't know our patterns" issues
- ✅ Consistent code generation across all 3 components
- ✅ Zero manual skill invocation required

### Long-Term (Month 3)
- ✅ CLAUDE.md becomes living documentation (updated via `#` hotkey)
- ✅ Self-improving system through hook analytics
- ✅ Complete methodology adoption validated

---

## Implementation Schedule

**Day 1**: Phase 1 - Core infrastructure (2 hours)
**Days 2-3**: Phase 2.1 - Frontend skill (6 hours)
**Days 4-5**: Phase 2.2 & 2.3 - Temporal + Infrastructure skills (14 hours)
**Day 6**: Phase 3 - Dev-docs + slash commands (3 hours)
**Days 7-8**: Phase 4 - Custom agents (8 hours)
**Week 2+**: Phase 5 - Optional enhancements (as needed)

**Total Time**: 33 hours over ~2 weeks

---

## Risk Mitigation

### Risk: Initial Time Investment (33 hours)
**Mitigation**: Progressive value delivery - hooks work immediately, skills add value incrementally

### Risk: Maintenance Burden
**Mitigation**: CLAUDE.md updates happen organically during development using `#` hotkey

### Risk: Over-Engineering
**Mitigation**: Started with essential hooks only, adding complexity as proven valuable

---

## Why Starting with Phase 3?

**Bootstrapping Strategy**: By implementing dev-docs first, we create the persistence layer that allows us to:
1. Document the complete implementation plan (this file)
2. Survive `/clear` commands while implementing Phases 1, 2, 4, 5
3. Validate the dev-docs pattern works before investing in other infrastructure
4. Have a working example to reference when creating future dev-docs

After Phase 3 completes, we'll have the memory system in place to implement the remaining phases with full context preservation.

---

## Next Steps After Phase 3 Completion

1. Execute Phase 1: Install hooks and create skill-rules.json
2. Execute Phase 2: Build custom skills (20 hours)
3. Execute Phase 4: Create specialized agents (8 hours)
4. Execute Phase 5: Add optional enhancements as needed
5. Validate all success metrics
6. Iterate based on real-world usage
