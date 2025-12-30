---
status: current
last_updated: 2025-12-30
purpose: agent-navigation
---

# Agent Navigation Index

> **For AI Agents**: This index is optimized for rapid navigation. Use keyword matching to find relevant documents. Each entry includes summary, keywords, and approximate token count to help with context window planning.

## Quick Decision Tree

### By Task Type

| Task | Start Here | Then Read |
|------|-----------|-----------|
| Add database table | [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | [table-template.md](infrastructure/reference/database/table-template.md) |
| Add Temporal workflow | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | [temporal-overview.md](architecture/workflows/temporal-overview.md) |
| Add frontend component | [frontend/CLAUDE.md](../frontend/CLAUDE.md) | [DESIGN_PATTERNS_MIGRATION_GUIDE.md](frontend/guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md) |
| Configure authentication | [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) |
| Deploy database changes | [DEPLOYMENT_INSTRUCTIONS.md](infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) |
| Understand CQRS/events | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | [EVENT-DRIVEN-GUIDE.md](frontend/guides/EVENT-DRIVEN-GUIDE.md) |
| Test OAuth flow | [OAUTH-TESTING.md](infrastructure/guides/supabase/OAUTH-TESTING.md) | [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) |
| Add RBAC permissions | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | [scoping-architecture.md](architecture/authorization/scoping-architecture.md) |
| Create documentation | [AGENT-GUIDELINES.md](./AGENT-GUIDELINES.md) | [templates/](./templates/) |

## By Keyword

<!-- Agent: Use Ctrl+F or grep on this section -->

| Keyword | Primary Document | Related |
|---------|-----------------|---------|
| `accessibility` | [frontend/CLAUDE.md](../frontend/CLAUDE.md) | TESTING.md, component docs |
| `activity` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | error-handling-and-compensation.md |
| `authentication` | [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | supabase-auth-overview.md, custom-claims-setup.md |
| `cqrs` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | EVENT-DRIVEN-GUIDE.md, MIGRATION-FROM-CRUD.md |
| `deployment` | [DEPLOYMENT_INSTRUCTIONS.md](infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) | infrastructure/CLAUDE.md |
| `edge-function` | [EDGE_FUNCTION_TESTS.md](infrastructure/guides/supabase/EDGE_FUNCTION_TESTS.md) | DEPLOYMENT_INSTRUCTIONS.md |
| `events` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | EVENT-DRIVEN-GUIDE.md |
| `invitation` | [invitations_projection.md](infrastructure/reference/database/tables/invitations_projection.md) | organizations_projection.md |
| `jwt` | [custom-claims-setup.md](architecture/authentication/custom-claims-setup.md) | frontend-auth-architecture.md, supabase-auth-overview.md |
| `kubernetes` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | KUBECONFIG_UPDATE_GUIDE.md |
| `medication` | [medications.md](infrastructure/reference/database/tables/medications.md) | medication-search-implementation.md, rxnorm-medication-autocomplete.md |
| `migration` | [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | DEPLOYMENT_INSTRUCTIONS.md, table-template.md |
| `mobx` | [viewmodels.md](frontend/architecture/viewmodels.md) | mobx-optimization.md, mobx-patterns.md |
| `multi-tenancy` | [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | organizations_projection.md |
| `oauth` | [OAUTH-TESTING.md](infrastructure/guides/supabase/OAUTH-TESTING.md) | supabase-auth-overview.md, SUPABASE-AUTH-SETUP.md |
| `organization` | [organizations_projection.md](infrastructure/reference/database/tables/organizations_projection.md) | multi-tenancy-architecture.md |
| `permissions` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | scoping-architecture.md, role_permissions_projection.md |
| `projection` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | organizations_projection.md, table-template.md |
| `rbac` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | scoping-architecture.md, user_roles_projection.md |
| `rls` | [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | table-template.md, SQL_IDEMPOTENCY_AUDIT.md |
| `roles` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | user_roles_projection.md, role_permissions_projection.md |
| `supabase` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | DEPLOYMENT_INSTRUCTIONS.md, SUPABASE-AUTH-SETUP.md |
| `temporal` | [temporal-overview.md](architecture/workflows/temporal-overview.md) | workflows/CLAUDE.md, error-handling-and-compensation.md |
| `testing` | [TESTING.md](frontend/testing/TESTING.md) | viewmodel-testing.md |
| `viewmodel` | [viewmodels.md](frontend/architecture/viewmodels.md) | viewmodel-testing.md, mobx-patterns.md |
| `workflow` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | temporal-overview.md, implementation.md |

## Document Catalog

### Entry Points (Read These First)

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [CLAUDE.md](../CLAUDE.md) | Repository overview, quick start commands, key links | `overview`, `quickstart` | 3500 |
| [frontend/CLAUDE.md](../frontend/CLAUDE.md) | React/TypeScript development guide with accessibility | `react`, `mobx`, `accessibility` | 5200 |
| [workflows/CLAUDE.md](../workflows/CLAUDE.md) | Temporal workflow development guide | `temporal`, `activities`, `saga` | 4800 |
| [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | Infrastructure guide with deployment runbook | `supabase`, `kubernetes`, `deployment` | 6100 |
| [README.md](./README.md) | Documentation table of contents | `navigation`, `index` | 2200 |

### Architecture (Cross-Cutting)

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | Three-mode auth system (mock/integration/production) with IAuthProvider | `auth`, `oauth`, `jwt`, `mock-auth` | 4500 |
| [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) | OAuth2 PKCE flow, social login, enterprise SSO | `oauth`, `supabase`, `pkce`, `sso` | 2200 |
| [custom-claims-setup.md](architecture/authentication/custom-claims-setup.md) | JWT custom claims via database hook | `jwt`, `claims`, `database-hook` | 1500 |
| [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | Permission-based RBAC with event sourcing | `rbac`, `permissions`, `roles` | 3100 |
| [scoping-architecture.md](architecture/authorization/scoping-architecture.md) | Hierarchical permission scoping with ltree | `scoping`, `ltree`, `permissions` | 2800 |
| [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | Organization isolation via RLS and JWT claims | `rls`, `multi-tenant`, `org_id` | 2800 |
| [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | CQRS pattern, domain events, projections | `cqrs`, `events`, `projections` | 2500 |
| [temporal-overview.md](architecture/workflows/temporal-overview.md) | Workflow orchestration concepts and patterns | `temporal`, `workflow`, `saga` | 3200 |

### Frontend

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [viewmodels.md](frontend/architecture/viewmodels.md) | MobX state management with ViewModel pattern | `mobx`, `viewmodel`, `state` | 1800 |
| [auth-provider-architecture.md](frontend/architecture/auth-provider-architecture.md) | IAuthProvider interface, dependency injection | `auth`, `di`, `provider` | 1600 |
| [overview.md](frontend/architecture/overview.md) | High-level frontend architecture | `architecture`, `react`, `structure` | 1200 |
| [DEVELOPMENT.md](frontend/guides/DEVELOPMENT.md) | Local development setup, dev server | `development`, `setup`, `vite` | 2100 |
| [DESIGN_PATTERNS_MIGRATION_GUIDE.md](frontend/guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md) | Component patterns and best practices | `patterns`, `components`, `migration` | 3200 |
| [EVENT-DRIVEN-GUIDE.md](frontend/guides/EVENT-DRIVEN-GUIDE.md) | CQRS patterns in React components | `events`, `cqrs`, `react` | 4200 |
| [TESTING.md](frontend/testing/TESTING.md) | Unit and E2E testing strategies | `testing`, `vitest`, `playwright` | 2100 |
| [ui-patterns.md](frontend/patterns/ui-patterns.md) | Modal architecture, dropdown patterns | `modal`, `ui`, `patterns` | 1800 |

### Infrastructure

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | Idempotent SQL migration patterns | `migration`, `sql`, `idempotent` | 2400 |
| [DEPLOYMENT_INSTRUCTIONS.md](infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) | Step-by-step deployment procedures | `deployment`, `supabase`, `edge-functions` | 2100 |
| [OAUTH-TESTING.md](infrastructure/guides/supabase/OAUTH-TESTING.md) | Google OAuth testing guide | `oauth`, `testing`, `google` | 1400 |
| [SUPABASE-AUTH-SETUP.md](infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md) | Auth provider configuration | `supabase`, `auth`, `setup` | 1600 |
| [EDGE_FUNCTION_TESTS.md](infrastructure/guides/supabase/EDGE_FUNCTION_TESTS.md) | Edge function testing guide | `edge-function`, `testing`, `deno` | 1200 |
| [table-template.md](infrastructure/reference/database/table-template.md) | Database table documentation template | `template`, `database`, `schema` | 800 |

### Workflows

| Document | Summary | Keywords | ~Tokens |
|----------|---------|----------|---------|
| [implementation.md](workflows/guides/implementation.md) | How to build Temporal workflows | `workflow`, `implementation`, `guide` | 2200 |
| [error-handling-and-compensation.md](workflows/guides/error-handling-and-compensation.md) | Saga pattern for workflow rollback | `saga`, `compensation`, `error-handling` | 1900 |

### Database Tables Reference

| Table | Purpose | Keywords | ~Tokens |
|-------|---------|----------|---------|
| [organizations_projection.md](infrastructure/reference/database/tables/organizations_projection.md) | Multi-tenant organization hierarchy | `organization`, `tenant`, `rls` | 760 |
| [invitations_projection.md](infrastructure/reference/database/tables/invitations_projection.md) | Organization invitation tracking | `invitation`, `token`, `email` | 817 |
| [user_roles_projection.md](infrastructure/reference/database/tables/user_roles_projection.md) | User role assignments | `roles`, `users`, `rbac` | 700 |
| [role_permissions_projection.md](infrastructure/reference/database/tables/role_permissions_projection.md) | Role-permission mappings | `permissions`, `roles`, `rbac` | 650 |
| [medications.md](infrastructure/reference/database/tables/medications.md) | Medication records | `medication`, `rxcui`, `drugs` | 600 |
| [clients.md](infrastructure/reference/database/tables/clients.md) | Client/patient records | `client`, `patient`, `tenant` | 550 |

## Sync Instructions

This index should be updated when:
1. New documentation files are added
2. Existing documents are renamed or moved
3. TL;DR sections are added/updated (extract keywords)
4. Major content changes affect the summary

**Validation checklist**:
- [ ] All links resolve to existing files
- [ ] Keywords match document content
- [ ] Token estimates are approximately correct (~10 tokens/line)
- [ ] New documents added to appropriate catalog section

## Token Estimation Guide

| Lines of Markdown | Approximate Tokens |
|-------------------|-------------------|
| 50 lines | ~500 tokens |
| 100 lines | ~1000 tokens |
| 200 lines | ~2000 tokens |
| 500 lines | ~5000 tokens |

Estimate: ~10 tokens per line of typical markdown content.

## See Also

- [AGENT-GUIDELINES.md](./AGENT-GUIDELINES.md) - How to create/update documentation
- [README.md](./README.md) - Full documentation table of contents
- [Root CLAUDE.md](../CLAUDE.md) - Repository overview
