---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Monorepo root guide for A4C-AppSuite — navigation hub pointing to component CLAUDE.md files (frontend, workflows, infrastructure) and the AI agent documentation index. Covers quick-start commands, cross-component workflow pattern, and git-crypt setup.

**When to read**:
- First time working in this repo
- Making cross-component changes (database → workflow → frontend)
- Finding the right CLAUDE.md or documentation entry point

**Key topics**: `monorepo`, `overview`, `quickstart`, `cross-component`, `navigation`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Repository Overview

A4C (Analytics4Change) AppSuite monorepo:

- **Frontend**: React/TypeScript medication management application (`frontend/`)
- **Workflows**: Temporal.io workflow orchestration for long-running business processes (`workflows/`)
- **Infrastructure**: Supabase database, Kubernetes deployments, and IaC (`infrastructure/`)
- **Documentation**: 200+ files organized for progressive disclosure and LLM-optimized navigation (`documentation/`)

## AI Agent Quick Start

> **For AI Agents**: Start here for efficient documentation navigation.

| Resource | Purpose |
|----------|---------|
| [AGENT-INDEX.md](documentation/AGENT-INDEX.md) | Keyword navigation, task decision tree, token estimates |
| [AGENT-GUIDELINES.md](documentation/AGENT-GUIDELINES.md) | Documentation creation and update rules |
| [documentation/README.md](documentation/README.md) | Complete table of contents |

**Navigation strategy**:
1. Check AGENT-INDEX.md for keyword matches
2. Read TL;DR sections at top of docs to assess relevance
3. Deep-read only documents that match your task

## Component-Specific CLAUDE.md Files

Each major component and subsystem has its own CLAUDE.md. Claude Code loads these automatically when you work in the corresponding directory.

| Path | Covers |
|------|--------|
| [`frontend/CLAUDE.md`](frontend/CLAUDE.md) | React/TypeScript, MobX, accessibility, logging, timings, Definition of Done |
| [`frontend/src/services/CLAUDE.md`](frontend/src/services/CLAUDE.md) | Supabase session retrieval, CQRS query pattern, correlation IDs |
| [`frontend/src/contexts/CLAUDE.md`](frontend/src/contexts/CLAUDE.md) | `IAuthProvider` DI, JWT custom claims, mock vs real auth |
| [`frontend/src/components/ui/CLAUDE.md`](frontend/src/components/ui/CLAUDE.md) | Dropdown selection guide, focus-trapped checkbox group |
| [`workflows/CLAUDE.md`](workflows/CLAUDE.md) | Temporal, saga pattern, provider pattern, deployment |
| [`workflows/src/workflows/CLAUDE.md`](workflows/src/workflows/CLAUDE.md) | Workflow determinism rules, replay testing |
| [`workflows/src/activities/CLAUDE.md`](workflows/src/activities/CLAUDE.md) | Three-layer idempotency, event emission, audit context |
| [`infrastructure/CLAUDE.md`](infrastructure/CLAUDE.md) | Navigation hub for supabase + k8s, cross-cutting rules |
| [`infrastructure/supabase/CLAUDE.md`](infrastructure/supabase/CLAUDE.md) | Migrations, event handlers, AsyncAPI, OAuth |
| [`infrastructure/k8s/CLAUDE.md`](infrastructure/k8s/CLAUDE.md) | kubectl, secrets, RBAC, pod troubleshooting |

## Monorepo Structure

```
A4C-AppSuite/
├── frontend/          # React application
├── workflows/         # Temporal.io workflows and activities
├── infrastructure/    # Supabase + Kubernetes configs
├── documentation/     # Consolidated documentation (200+ files)
│   ├── AGENT-INDEX.md         # AI agent entry point
│   ├── AGENT-GUIDELINES.md    # Documentation creation/update rules
│   ├── architecture/          # Cross-cutting concerns (auth, CQRS, multi-tenancy)
│   ├── frontend/              # Frontend guides and reference
│   ├── workflows/             # Workflow guides and reference
│   └── infrastructure/        # Infrastructure guides, operations, reference
├── shared/            # Shared configuration across components
├── scripts/           # Operational scripts
└── dev/               # Development task tracking (active, archived, parked)
```

## Quick Start Commands

### Frontend Development

```bash
cd frontend
npm install
npm run dev        # Start development server
npm run build      # Production build
npm run test       # Run tests
npm run lint       # Lint code
```

### Workflow Development

```bash
cd workflows
npm install
npm run dev        # Start worker in development mode
npm run build      # Build for production
npm run test       # Run tests
npm run worker     # Run worker (requires TEMPORAL_ADDRESS env var)
```

For local Temporal connection:
```bash
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
TEMPORAL_ADDRESS=localhost:7233 npm run worker
```

### Infrastructure Management

```bash
cd infrastructure/supabase
supabase link --project-ref "your-project-ref"
supabase db push --linked --dry-run  # Preview pending migrations
supabase db push --linked             # Apply migrations
```

## Cross-Component Workflow Pattern

When making changes that span multiple components, follow this order:

1. **Infrastructure first**: Database schema, API contracts, event definitions
   - Create Supabase migration: `supabase migration new feature_name`
   - Deploy via `supabase db push --linked`
2. **Workflow orchestration**: Temporal workflow logic and event emission
   - Create/update workflows (`workflows/src/workflows/`)
   - Create/update activities with event emission (`workflows/src/activities/`)
   - Test workflows locally against dev Temporal cluster
3. **Frontend integration**: UI to consume new features
   - Update React components to trigger workflows
   - Display workflow status and results
4. **End-to-end testing**: Verify complete flow, projections update correctly

## Key Technologies

**Frontend**: React 19, TypeScript, Vite, MobX, Tailwind, Playwright
**Workflows**: Temporal.io, Node.js 20, Cloudflare API (DNS), Resend API (email)
**Infrastructure**: Supabase (Auth, DB, Edge Functions, RLS), Kubernetes (k3s), Supabase CLI

## Development Environment Variables

### Frontend (`frontend/.env.local`)
```env
VITE_RXNORM_API_URL=https://rxnav.nlm.nih.gov/REST
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Workflows (`workflows/.env`)
```bash
export TEMPORAL_ADDRESS=localhost:7233  # or cluster address
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=bootstrap
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
export CLOUDFLARE_API_TOKEN=your-cloudflare-token
export RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# SMTP_HOST, SMTP_USER, SMTP_PASS available as fallback
```

See [Resend Email Provider Guide](documentation/workflows/guides/resend-email-provider.md) for email configuration.

### Infrastructure
```bash
export SUPABASE_ACCESS_TOKEN="..."
export SUPABASE_PROJECT_REF="..."
```

## Git-Crypt

This repository uses git-crypt for encrypting sensitive files:

```bash
git-crypt unlock /path/to/A4C-AppSuite-git-crypt.key
```

## GitHub Actions

CI/CD workflows in `.github/workflows/`:
- `frontend-*.yml` — Frontend CI/CD
- `temporal-deploy.yml` — Temporal workers
- `supabase-migrations.yml` — Database migrations
- `edge-functions-deploy.yml` — Supabase Edge Functions

For manual deployment and rollback procedures, see [Deployment Runbook](documentation/infrastructure/operations/deployment/deployment-runbook.md).

## Documentation Standards

All code must meet documentation requirements:
- All components, ViewModels, types, and Edge Functions must be documented
- TypeScript interfaces must match documentation exactly
- Frontend: run `npm run docs:check` before committing
- See [AGENT-GUIDELINES.md](documentation/AGENT-GUIDELINES.md) for doc creation rules
