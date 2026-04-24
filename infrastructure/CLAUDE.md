---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Infrastructure component overview — navigation hub for Supabase (DB, Edge Functions, RLS) and Kubernetes (Temporal cluster, workers). Cross-cutting rules: CQRS query pattern, event metadata audit context, business-scoped correlation IDs.

**When to read**:
- Starting infrastructure work — to find the right subdirectory CLAUDE.md
- Reviewing the cross-cutting CQRS / event-metadata / correlation-ID rules
- Looking up environment variables or component architecture
- Finding the right operations doc (deployment runbook, disaster recovery, key rotation)

**Prerequisites**: Access to Supabase project, kubectl configured for k3s cluster

**Key topics**: `supabase`, `kubernetes`, `cqrs`, `event-metadata`, `correlation-id`, `migrations`

**Estimated read time**: 6 minutes
<!-- TL;DR-END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with infrastructure code.

## Project Overview

This is the infrastructure repository for the A4C platform, managing:

- **Supabase**: Authentication, database, Edge Functions, RLS policies, SQL migrations
- **Kubernetes**: Temporal.io cluster for workflow orchestration, application workloads
- **SQL-First Approach**: Event-driven schema with CQRS projections

**Migration note**: Platform migrated from Zitadel to Supabase Auth (October 2025). Zitadel configurations are deprecated and archived in `.archived_plans/zitadel/`.

## Subdirectory CLAUDE.md Files

For domain-specific rules, see the CLAUDE.md file in the relevant subdirectory:

| Path | Covers |
|------|--------|
| [`supabase/CLAUDE.md`](supabase/CLAUDE.md) | Supabase CLI migrations, plpgsql_check, event handler architecture (single trigger → router → handler), AsyncAPI type generation, OAuth testing |
| [`k8s/CLAUDE.md`](k8s/CLAUDE.md) | kubectl commands, secrets management, RBAC, common pod/ConfigMap troubleshooting |

## Operations Documentation

For step-by-step procedures (NOT loaded by default into Claude's context — read on demand):

| Procedure | Document |
|-----------|----------|
| Manual deploy of frontend / workers / migrations | [Deployment Runbook](../documentation/infrastructure/operations/deployment/deployment-runbook.md) |
| Cluster / database / app rollback | [Deployment Runbook → Rollback sections](../documentation/infrastructure/operations/deployment/deployment-runbook.md) |
| Cluster failure, DB corruption recovery | [Disaster Recovery](../documentation/infrastructure/operations/disaster-recovery.md) |
| Resend API key rotation | [Resend Key Rotation](../documentation/infrastructure/operations/resend-key-rotation.md) |
| GitHub Actions cluster access | [KUBECONFIG Update Guide](../documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md) |
| Email provider setup, monitoring, troubleshooting | [Resend Email Provider Guide](../documentation/workflows/guides/resend-email-provider.md) |

## Architecture

### Directory Structure

```
infrastructure/
├── supabase/              # Supabase database schema and migrations — see CLAUDE.md
│   ├── supabase/         # Supabase CLI project directory
│   ├── handlers/         # Canonical SQL reference files for handlers/routers/triggers
│   ├── contracts/        # AsyncAPI event schemas
│   └── scripts/          # Deployment scripts (OAuth setup, etc.)
└── k8s/                   # Kubernetes deployments — see CLAUDE.md
    ├── rbac/             # RBAC for GitHub Actions
    └── temporal/         # Temporal.io cluster and workers
```

### Component Map

**Supabase** (Primary Backend):
- **Authentication**: Social login (Google, GitHub) + Enterprise SSO (SAML 2.0)
- **Database**: PostgreSQL with event-driven schema (CQRS projections)
- **RLS**: Multi-tenant isolation via JWT custom claims (`org_id`, `effective_permissions`)
- **Edge Functions**: Business logic and API endpoints (Deno runtime)
- **Custom JWT Claims**: Via database hook (`auth.custom_access_token_hook`)

**Temporal.io** (Workflow Orchestration):
- **Cluster**: Deployed to Kubernetes (`temporal` namespace)
- **Frontend**: `temporal-frontend.temporal.svc.cluster.local:7233`
- **Web UI**: `temporal-web:8080` (port-forward to access)
- **Namespace**: `default`
- **Task Queue**: `bootstrap` (organization workflows)
- **Workers**: Deployed via `k8s/temporal/worker-deployment.yaml`

**Kubernetes** (k3s cluster):
- **Temporal Server**: Helm deployment with PostgreSQL backend
- **Temporal Workers**: Node.js application containers
- **Frontend**: nginx-based React app (`default` namespace)
- **Ingress**: Nginx ingress controller via Cloudflare Tunnel
- **API endpoint**: `https://k8s.firstovertheline.com`

## Environment Variables

### Supabase Database

```bash
# For SQL migrations and custom claims setup
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_ANON_KEY="your-anon-key"
export SUPABASE_ACCESS_TOKEN="..."         # Management API token
export SUPABASE_PROJECT_REF="..."           # Project reference ID
```

### Temporal Workers (Kubernetes Secrets)

Stored in `workflow-worker-secrets` (namespace: `temporal`). For the full key list and rotation procedure, see [`k8s/CLAUDE.md`](k8s/CLAUDE.md).

```bash
# View secrets
kubectl get secret workflow-worker-secrets -n temporal -o yaml
```

## Key Considerations

1. **Supabase CLI Migrations**: Schema changes via `supabase db push --linked` (no manual SQL execution) — see [`supabase/CLAUDE.md`](supabase/CLAUDE.md)
2. **Day 0 Baseline**: Production schema captured as `20260212010625_baseline_v4.sql` — all future changes as incremental migrations
3. **SQL Idempotency**: All migrations must be idempotent (`IF NOT EXISTS`, `OR REPLACE`, `DROP IF EXISTS`)
4. **Zero Downtime**: All schema changes must maintain service availability
5. **RLS First**: All tables must have Row-Level Security policies
6. **Event-Driven**: All state changes emit domain events for CQRS projections
7. **Event Metadata for Audit**: The `domain_events` table is the SOLE audit trail — no separate audit table
8. **Email Provider**: Resend (primary), SMTP (fallback) — workers require `RESEND_API_KEY` in Kubernetes secrets
9. **CQRS Query Pattern**: Frontend MUST query projections via `api.` schema RPC functions — NEVER direct table queries with PostgREST embedding (full rationale below)

## Cross-Cutting Rules

### CQRS Query Rule

> **⚠️ CRITICAL: All frontend queries MUST use `api.` schema RPC functions.**

Projection tables are denormalized read models — never query directly with PostgREST embedding across tables. Detailed rationale + examples in [`supabase/CLAUDE.md`](supabase/CLAUDE.md). **Edge Functions are exempt from this rule** — they are the orchestration tier and may use service-role reads of any table when needed (see next section + ADR Decision 4).

| ✅ Correct | ❌ Wrong |
|-----------|----------|
| `api.list_users(p_org_id)` | `.from('users').select(..., user_roles_projection!inner(...))` |
| `api.get_roles(p_org_id)` | `.from('roles_projection').select(..., permissions!inner(...))` |

### Edge Function vs SQL RPC Selection

> **⚠️ Before creating a new Edge Function, consult [adr-edge-function-vs-sql-rpc.md](../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md).** SQL RPC is the default; Edge Function requires meeting one of the load-bearing criteria (LB1–LB6): auth-user minting, external API calls, workflow-layer forwarding, unauthenticated bespoke token validation, cross-tier read orchestration, or pre-user-existence event emission.

> **Opportunistic migration**: When touching an Edge Function operation classified `candidate-for-extraction` in the ADR's inventory, prefer extracting that operation to an SQL RPC in the same PR.

CI check `.github/workflows/supabase-edge-functions-lint.yml` enforces that NEW Edge Function files cite the ADR in a top-of-file comment. Existing-file modifications are unaffected.

### Event Metadata Requirements

All domain events emitted via `api.emit_domain_event()` must include audit context. Required fields:

| Field | When Required | Description |
|-------|---------------|-------------|
| `user_id` | Always | UUID of user who triggered the action |
| `reason` | When action has business context | Human-readable justification |
| `ip_address`, `user_agent` | Edge Functions only | From request headers |
| `request_id` | When available | Correlation with API logs |

Audit query example:
```sql
SELECT event_type, event_metadata->>'user_id' as actor,
       event_metadata->>'reason' as reason, created_at
FROM domain_events WHERE stream_id = '<resource_id>'
ORDER BY created_at DESC;
```

### Correlation ID Pattern

`correlation_id` ties together the ENTIRE business transaction lifecycle:
- **Creating entity**: Generate and STORE `correlation_id` with the entity
- **Updating entity**: LOOKUP and REUSE the stored `correlation_id`
- **Never generate** new `correlation_id` for subsequent lifecycle events

Full pattern + Edge Function examples in [`supabase/CLAUDE.md`](supabase/CLAUDE.md). Reference: [event-metadata-schema.md](../documentation/workflows/reference/event-metadata-schema.md#correlation-strategy-business-scoped).

## References

### Architecture & Design
- [Multi-Tenancy Architecture](../documentation/architecture/data/multi-tenancy-architecture.md) — Organization isolation with RLS
- [Event Sourcing Overview](../documentation/architecture/data/event-sourcing-overview.md) — CQRS + domain events architecture
- [RBAC Architecture](../documentation/architecture/authorization/rbac-architecture.md) — Role-based access control
- [Temporal Workflows Overview](../documentation/architecture/workflows/temporal-overview.md) — Workflow orchestration

### Supabase Implementation Guides
- [Day 0 Migration Guide](../documentation/infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) — Baseline consolidation
- [SQL Idempotency Audit](../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) — Migration patterns
- [JWT Custom Claims Setup](../documentation/infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) — Database hooks
- [OAuth Testing Guide](../documentation/infrastructure/guides/supabase/OAUTH-TESTING.md)
- [Supabase Auth Setup](../documentation/infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md)
- [Event-Driven Architecture](../documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md) — Backend event sourcing spec

### Patterns
- [Event Handler Pattern](../documentation/infrastructure/patterns/event-handler-pattern.md) — Split routers/handlers, projection guard
- [Event Processing Patterns](../documentation/infrastructure/patterns/event-processing-patterns.md) — Sync trigger vs async pg_notify

### Database Reference
- [Database Tables](../documentation/infrastructure/reference/database/tables/) — Complete schema documentation

### CI/CD Workflows
- Frontend Deployment: `.github/workflows/frontend-deploy.yml`
- Temporal Workers: `.github/workflows/workflows-docker.yaml`
- Database Migrations: `.github/workflows/supabase-migrations.yml`

## Documentation Resources

- **[Subdirectory CLAUDE.md files](#subdirectory-claudemd-files)** — Domain-specific rules (supabase, k8s)
- **[Operations Documentation](#operations-documentation)** — Deployment runbook, disaster recovery, key rotation
- **[Agent Navigation Index](../documentation/AGENT-INDEX.md)** — Keyword-based doc navigation for AI agents
- **[Agent Guidelines](../documentation/AGENT-GUIDELINES.md)** — Documentation creation and update rules
- **[Infrastructure Documentation](../documentation/infrastructure/)** — All infrastructure-specific documentation
