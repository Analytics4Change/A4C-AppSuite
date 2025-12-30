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
| `audit-trail` | [impersonation-architecture.md](architecture/authentication/impersonation-architecture.md) | impersonation-event-schema.md |
| `authentication` | [frontend-auth-architecture.md](architecture/authentication/frontend-auth-architecture.md) | supabase-auth-overview.md, custom-claims-setup.md |
| `bootstrap` | [organization-onboarding-workflow.md](architecture/workflows/organization-onboarding-workflow.md) | tenants-as-organizations.md |
| `compensation` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | error-handling-and-compensation.md |
| `contacts` | [contact-management-vision.md](architecture/features/contact-management-vision.md) | provider-partners-architecture.md |
| `cqrs` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | EVENT-DRIVEN-GUIDE.md, MIGRATION-FROM-CRUD.md |
| `cross-tenant` | [provider-partners-architecture.md](architecture/data/provider-partners-architecture.md) | var-partnerships.md |
| `custom-claims` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | frontend-auth-architecture.md, custom-claims-setup.md |
| `database-hook` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | custom-claims-setup.md |
| `deployment` | [DEPLOYMENT_INSTRUCTIONS.md](infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) | infrastructure/CLAUDE.md |
| `determinism` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | temporal-overview.md |
| `development` | [DEVELOPMENT.md](frontend/guides/DEVELOPMENT.md) | frontend/CLAUDE.md |
| `dns-provisioning` | [organization-onboarding-workflow.md](architecture/workflows/organization-onboarding-workflow.md) | event-driven-workflow-triggering.md |
| `edge-function` | [EDGE_FUNCTION_TESTS.md](infrastructure/guides/supabase/EDGE_FUNCTION_TESTS.md) | DEPLOYMENT_INSTRUCTIONS.md |
| `email` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | resend-email-provider.md |
| `enterprise-sso` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | supabase-auth-overview.md |
| `events` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | EVENT-DRIVEN-GUIDE.md |
| `hipaa` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | impersonation-security-controls.md |
| `idempotency` | [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | workflows/CLAUDE.md |
| `impersonation` | [impersonation-architecture.md](architecture/authentication/impersonation-architecture.md) | impersonation-security-controls.md |
| `invitation` | [invitations_projection.md](infrastructure/reference/database/tables/invitations_projection.md) | organizations_projection.md |
| `jwt` | [custom-claims-setup.md](architecture/authentication/custom-claims-setup.md) | frontend-auth-architecture.md, supabase-auth-overview.md |
| `jwt-claims` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | frontend-auth-architecture.md, infrastructure/CLAUDE.md |
| `kubernetes` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | KUBECONFIG_UPDATE_GUIDE.md |
| `logging` | [logging-standards.md](architecture/logging-standards.md) | frontend/CLAUDE.md, workflows/CLAUDE.md |
| `ltree` | [scoping-architecture.md](architecture/authorization/scoping-architecture.md) | provider-admin-permissions-architecture.md |
| `medication` | [medications.md](infrastructure/reference/database/tables/medications.md) | medication-search-implementation.md, rxnorm-medication-autocomplete.md |
| `mfa` | [impersonation-security-controls.md](architecture/authentication/impersonation-security-controls.md) | enterprise-sso-guide.md |
| `migration` | [SQL_IDEMPOTENCY_AUDIT.md](infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) | DEPLOYMENT_INSTRUCTIONS.md, table-template.md |
| `mobx` | [viewmodels.md](frontend/architecture/viewmodels.md) | frontend/CLAUDE.md, mobx-optimization.md |
| `multi-tenancy` | [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | tenants-as-organizations.md |
| `oauth` | [OAUTH-TESTING.md](infrastructure/guides/supabase/OAUTH-TESTING.md) | supabase-auth-overview.md, SUPABASE-AUTH-SETUP.md |
| `okta` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | supabase-auth-overview.md |
| `organization` | [organizations_projection.md](infrastructure/reference/database/tables/organizations_projection.md) | organization-management-architecture.md |
| `organization-management` | [organization-management-architecture.md](architecture/data/organization-management-architecture.md) | tenants-as-organizations.md |
| `permissions` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | permissions-reference.md, scoping-architecture.md |
| `pg-notify` | [event-driven-workflow-triggering.md](architecture/workflows/event-driven-workflow-triggering.md) | temporal-overview.md |
| `projection` | [event-sourcing-overview.md](architecture/data/event-sourcing-overview.md) | organizations_projection.md, table-template.md |
| `provider-admin` | [provider-admin-permissions-architecture.md](architecture/authorization/provider-admin-permissions-architecture.md) | permissions-reference.md |
| `provider-partners` | [provider-partners-architecture.md](architecture/data/provider-partners-architecture.md) | var-partnerships.md |
| `rbac` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | rbac-implementation-guide.md, scoping-architecture.md |
| `resend` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | resend-email-provider.md |
| `rls` | [multi-tenancy-architecture.md](architecture/data/multi-tenancy-architecture.md) | table-template.md, SQL_IDEMPOTENCY_AUDIT.md |
| `roles` | [rbac-architecture.md](architecture/authorization/rbac-architecture.md) | user_roles_projection.md, role_permissions_projection.md |
| `saga` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | error-handling-and-compensation.md |
| `saml` | [enterprise-sso-guide.md](architecture/authentication/enterprise-sso-guide.md) | supabase-auth-overview.md |
| `scope_path` | [JWT-CLAIMS-SETUP.md](infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) | scoping-architecture.md |
| `scoping` | [scoping-architecture.md](architecture/authorization/scoping-architecture.md) | rbac-architecture.md |
| `social-login` | [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) | OAUTH-TESTING.md |
| `supabase` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | DEPLOYMENT_INSTRUCTIONS.md, SUPABASE-AUTH-SETUP.md |
| `supabase-auth` | [supabase-auth-overview.md](architecture/authentication/supabase-auth-overview.md) | frontend-auth-architecture.md |
| `temporal` | [temporal-overview.md](architecture/workflows/temporal-overview.md) | workflows/CLAUDE.md, error-handling-and-compensation.md |
| `testing` | [TESTING.md](frontend/testing/TESTING.md) | viewmodel-testing.md |
| `troubleshooting` | [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md) | OAUTH-TESTING.md |
| `var` | [var-partnerships.md](architecture/data/var-partnerships.md) | provider-partners-architecture.md |
| `viewmodel` | [viewmodels.md](frontend/architecture/viewmodels.md) | viewmodel-testing.md, mobx-patterns.md |
| `vite` | [DEVELOPMENT.md](frontend/guides/DEVELOPMENT.md) | frontend/CLAUDE.md |
| `wcag` | [frontend/CLAUDE.md](../frontend/CLAUDE.md) | TESTING.md |
| `workflow` | [workflows/CLAUDE.md](../workflows/CLAUDE.md) | temporal-overview.md, implementation.md |
| `workflow-trigger` | [event-driven-workflow-triggering.md](architecture/workflows/event-driven-workflow-triggering.md) | organization-onboarding-workflow.md |

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
