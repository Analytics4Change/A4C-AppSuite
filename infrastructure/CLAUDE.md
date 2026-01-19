---
status: current
last_updated: 2026-01-19
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Infrastructure management guide covering Supabase migrations, Kubernetes deployments, Temporal workers, email providers (Resend), and deployment runbooks with troubleshooting.

**When to read**:
- Running database migrations (`supabase db push`)
- Validating PL/pgSQL functions (`supabase db lint`)
- Deploying Temporal workers to Kubernetes
- Configuring OAuth or JWT custom claims
- Setting up Resend email provider
- Troubleshooting deployment failures

**Prerequisites**: Access to Supabase project, kubectl configured for k3s cluster

**Key topics**: `supabase`, `migrations`, `plpgsql_check`, `validation`, `kubernetes`, `temporal`, `deployment`, `oauth`, `jwt-claims`, `resend`, `email`, `rls`, `troubleshooting`

**Estimated read time**: 20 minutes (full), 5 minutes (relevant sections)
<!-- TL;DR-END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the infrastructure repository for Analytics4Change (A4C) platform, managing:
- **Supabase**: Authentication, database, Edge Functions, RLS policies, SQL migrations
- **Kubernetes**: Temporal.io cluster for workflow orchestration
- **SQL-First Approach**: Event-driven schema with CQRS projections

**Migration Note**: Platform migrated from Zitadel to Supabase Auth (October 2025). Zitadel configurations are deprecated and archived in `.archived_plans/zitadel/`.

## Commands

### Supabase CLI Migrations
```bash
# Deploy migrations to production
cd infrastructure/supabase
export SUPABASE_ACCESS_TOKEN="your-access-token"
supabase link --project-ref "your-project-ref"

# Preview pending migrations (dry-run)
supabase db push --linked --dry-run

# Apply migrations
supabase db push --linked

# Check migration status
supabase migration list --linked

# Create a new migration (for future schema changes)
supabase migration new my_new_feature

# Repair migration history (if needed)
supabase migration repair --status applied <version>
supabase migration repair --status reverted <version>
```

> **⚠️ CRITICAL: Always use `supabase migration new` - NEVER manually create migration files**
>
> The Supabase CLI generates the correct UTC timestamp. Manually creating files with
> hand-typed timestamps causes migration ordering errors that break CI/CD.
>
> ```bash
> # ✅ CORRECT: CLI generates timestamp
> supabase migration new feature_name
>
> # ❌ WRONG: Manual file creation
> touch supabase/migrations/20251223120000_feature.sql
> ```

> **⚠️ MCP Tool Warning: `mcp__supabase__apply_migration` generates its own timestamp**
>
> If you use the MCP `apply_migration` tool, it auto-generates a timestamp that won't
> match a manually-created local file. This causes CI/CD failures with:
> `"Remote migration versions not found in local migrations directory"`
>
> **Correct workflow when using MCP:**
> 1. Apply via MCP first (note the returned timestamp, e.g., `20260118023619`)
> 2. Create local file with **matching** timestamp:
>    `git mv old_name.sql supabase/migrations/20260118023619_feature.sql`
> 3. Commit to git
>
> **Or better - use CLI workflow:**
> 1. `supabase migration new feature_name` (generates timestamp)
> 2. Edit the generated file
> 3. `supabase db push --linked` (applies to remote)
> 4. Commit to git

**Note**: Docker/Podman is required for some Supabase CLI commands. Set `DOCKER_HOST=unix:///run/user/1000/podman/podman.sock` if using Podman.

### PL/pgSQL Validation (plpgsql_check)

The CI/CD pipeline validates all PL/pgSQL functions before deploying migrations. This catches column name mismatches, type errors, and other issues before they reach production.

**CI/CD Validation** (automatic):
- GitHub Actions runs `supabase db lint --level error` before every deployment
- Validation failures block deployment to production
- PRs with migration changes are validated automatically

**Manual Validation** (for local debugging):
```bash
# Start local Supabase
cd infrastructure/supabase
supabase start

# Apply migrations locally
supabase db push --local

# Validate all PL/pgSQL functions
supabase db lint --level error

# Show warnings too
supabase db lint --level warning

# Stop local Supabase when done
supabase stop --no-backup
```

**Raw SQL Validation** (advanced):
```sql
-- Check a specific function
SELECT * FROM plpgsql_check_function('process_user_event(record)'::regprocedure);

-- Check ALL functions in public/api schemas
SELECT p.proname, plpgsql_check_function(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
  AND n.nspname IN ('public', 'api');
```

**What plpgsql_check catches**:
- Column name mismatches (e.g., `org_id` when table has `organization_id`)
- Type errors in assignments
- Unused/uninitialized variables
- Dead code paths
- Missing RETURN statements

**Limitation**: plpgsql_check cannot validate JSONB field access (e.g., `p_event.event_data->>'field'`). It validates SQL column names, not JSONB structure.

### Kubernetes Commands
```bash
# Deploy Temporal workers
kubectl apply -f k8s/temporal/worker-deployment.yaml
kubectl rollout status deployment/workflow-worker -n temporal

# Port-forward to Temporal Web UI
kubectl port-forward -n temporal svc/temporal-web 8080:8080

# Check worker logs
kubectl logs -n temporal -l app=workflow-worker --tail=100 -f
```

### OAuth Testing

Test Google OAuth configuration and JWT custom claims:

```bash
# 1. Verify OAuth configuration via API
cd infrastructure/supabase/scripts
export SUPABASE_ACCESS_TOKEN="your-access-token"
./verify-oauth-config.sh

# 2. Generate OAuth URL for browser testing
./test-oauth-url.sh
# Copy URL and open in browser to test OAuth flow

# 3. Test using Supabase JavaScript SDK (more realistic)
npm install @supabase/supabase-js  # First time only
node test-google-oauth.js

# 4. Verify JWT custom claims (run in Supabase SQL Editor)
# Copy contents of verify-jwt-hook-complete.sql and execute
# Checks: hook exists, permissions granted, claims generation works
```

**Comprehensive OAuth Testing Guide**: See [`documentation/infrastructure/guides/supabase/OAUTH-TESTING.md`](../documentation/infrastructure/guides/supabase/OAUTH-TESTING.md) for:
- Two-phase testing strategy (API verification → OAuth flow → Application integration)
- Complete troubleshooting guide for common OAuth issues
- JWT custom claims diagnostics
- Production deployment verification checklist

**Quick OAuth Troubleshooting**:
- **"redirect_uri_mismatch"**: Check Google Cloud Console redirect URI matches Supabase callback URL exactly
- **User shows "viewer" role**: Run `verify-jwt-hook-complete.sql` to diagnose JWT hook configuration
- **JWT missing custom claims**: Verify hook registered in Dashboard (Authentication → Hooks)

### AsyncAPI Type Generation

**Source of Truth**: Generated TypeScript types from AsyncAPI schemas are the SINGLE source of truth for domain events.

```bash
# Generate TypeScript types from AsyncAPI schemas
cd infrastructure/supabase/contracts
npm run generate:types

# Copy to frontend (required after any AsyncAPI changes)
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

**Key Rules**:
- **NEVER** hand-write event type definitions
- **ALWAYS** regenerate types after modifying AsyncAPI schemas
- Every schema MUST have a `title` property (prevents AnonymousSchema generation)
- Frontend imports from `@/types/events` (not directly from generated)

**Pipeline**: `replace-inline-enums.js` → `asyncapi bundle` → `generate-types.js` → `dedupe-enums.js`

**Full Documentation**: See `.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md` for:
- Modelina configuration options
- Anonymous schema prevention
- Enum handling strategy
- Lessons learned and pitfalls

## Architecture

### Directory Structure
```
infrastructure/
├── supabase/            # Supabase database schema and migrations
│   ├── supabase/       # Supabase CLI project directory
│   │   ├── migrations/ # SQL migrations (Supabase CLI managed)
│   │   │   └── 20240101000000_baseline.sql  # Day 0 baseline migration
│   │   ├── functions/  # Edge Functions (Deno)
│   │   └── config.toml # Supabase CLI configuration
│   ├── sql.archived/   # Archived granular SQL files (reference only)
│   ├── contracts/      # AsyncAPI event schemas
│   │   └── asyncapi.yaml       # Event contract definitions
│   └── scripts/        # Deployment scripts (OAuth setup, etc.)
└── k8s/                 # Kubernetes deployments
    ├── rbac/           # RBAC for GitHub Actions
    └── temporal/       # Temporal.io cluster and workers
        ├── values.yaml          # Helm configuration
        ├── configmap-dev.yaml   # Dev environment config
        └── worker-deployment.yaml  # Temporal worker deployment
```

### Infrastructure Components

**Supabase** (Primary Backend):
- **Authentication**: Social login (Google, GitHub) + Enterprise SSO (SAML 2.0)
- **Database**: PostgreSQL with event-driven schema (CQRS projections)
- **RLS**: Multi-tenant isolation via JWT custom claims (`org_id`, `permissions`)
- **Edge Functions**: Business logic and API endpoints
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
- **Ingress**: Nginx ingress controller
- **Monitoring**: Prometheus + Grafana (planned)

**~~Zitadel Instance~~ (DEPRECATED)**: Migrated to Supabase Auth (October 2025)
- Documentation archived in `.archived_plans/zitadel/`

## Environment Variables

### Supabase Database
```bash
# For SQL migrations and custom claims setup
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_ANON_KEY="your-anon-key"
```

### Temporal Workers (Kubernetes Secrets)
```bash
# View secrets
kubectl get secret workflow-worker-secrets -n temporal -o yaml

# Required secrets (stored in workflow-worker-secrets):
# - TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233 (from ConfigMap)
# - SUPABASE_URL=https://your-project.supabase.co (from ConfigMap)
# - SUPABASE_SERVICE_ROLE_KEY=your-service-role-key (Secret)
# - CLOUDFLARE_API_TOKEN=your-cloudflare-token (Secret)
# - RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx (Secret - primary email provider)
# - SMTP_HOST, SMTP_USER, SMTP_PASS (Secret - optional, SMTP fallback)
```

## Email Provider Configuration (Resend)

### Overview

A4C-AppSuite uses **Resend** (https://resend.com) as the primary email provider for transactional emails (organization invitations, password resets, notifications). SMTP (nodemailer) is available as a fallback.

**For comprehensive Resend documentation**, see:
- **[Resend Email Provider Guide](../documentation/workflows/guides/resend-email-provider.md)** - Complete implementation, monitoring, and troubleshooting
- **[Resend Key Rotation](../documentation/infrastructure/operations/resend-key-rotation.md)** - Security procedures for rotating API keys

**Implementation**:
- Provider: `workflows/src/shared/providers/email/resend-provider.ts`
- Factory: `workflows/src/shared/providers/email/factory.ts`
- Activity: `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`

**Mode Selection** (via `WORKFLOW_MODE` environment variable):
- `production` → **ResendEmailProvider** (requires `RESEND_API_KEY`)
- `development` → LoggingEmailProvider (console only, no API calls)
- `mock` → MockEmailProvider (in-memory, testing)

**Override**: Set `EMAIL_PROVIDER=resend` to force Resend regardless of mode.

### Configuring RESEND_API_KEY

#### 1. Get API Key from Resend

1. Sign up / log in to https://resend.com
2. Navigate to **API Keys** → **Create API Key**
3. Name: "A4C Production" (or environment-specific name)
4. Permissions: **Send emails**
5. Copy the key (starts with `re_`)

**Important**: API key shown once only - save it securely!

#### 2. Update Kubernetes Secret

**File**: `infrastructure/k8s/temporal/worker-secret.yaml` (NOT committed to git)

```bash
# Create secret file from template
cp infrastructure/k8s/temporal/worker-secret.yaml.example \
   infrastructure/k8s/temporal/worker-secret.yaml

# Encode the API key
echo -n "re_your_actual_resend_api_key" | base64
# Example output: cmVfeW91cl9hY3R1YWxfcmVzZW5kX2FwaV9rZXk=

# Edit worker-secret.yaml and replace RESEND_API_KEY value
# Use the base64-encoded value from above
```

**Apply to cluster**:
```bash
kubectl apply -f infrastructure/k8s/temporal/worker-secret.yaml
```

#### 3. Restart Temporal Workers

Workers must be restarted to load the new secret:

```bash
kubectl rollout restart deployment/workflow-worker -n temporal
kubectl rollout status deployment/workflow-worker -n temporal
```

#### 4. Verify Configuration

Check worker logs for successful startup:

```bash
kubectl logs -n temporal -l app=workflow-worker --tail=50 | grep -i "email\|resend"
```

Expected log: `✓ Email provider configured: ResendEmailProvider`

### RESEND_API_KEY Rotation

**When to rotate**:
- API key compromised
- Quarterly security rotation
- Team member with key access leaves

**Rotation process**:

1. **Create new API key in Resend**:
   - Log in to https://resend.com/api-keys
   - Create new API key: "A4C Production (2025-01-14)"
   - Copy the new key (starts with `re_`)

2. **Update Kubernetes secret**:
   ```bash
   # Encode new key
   NEW_KEY=$(echo -n "re_new_api_key_here" | base64)

   # Update secret
   kubectl patch secret workflow-worker-secrets -n temporal \
     -p "{\"data\":{\"RESEND_API_KEY\":\"$NEW_KEY\"}}"
   ```

3. **Restart workers** (zero-downtime rolling update):
   ```bash
   kubectl rollout restart deployment/workflow-worker -n temporal
   kubectl rollout status deployment/workflow-worker -n temporal --timeout=300s
   ```

4. **Verify new key works**:
   ```bash
   # Check worker logs
   kubectl logs -n temporal -l app=workflow-worker --tail=20

   # Trigger test workflow (organization creation)
   # Verify invitation emails sent successfully
   ```

5. **Delete old API key from Resend**:
   - Log in to https://resend.com/api-keys
   - Find old key "A4C Production"
   - Click **Delete**

**Rollback** (if new key doesn't work):
```bash
# Revert to old key
OLD_KEY=$(echo -n "re_old_api_key_here" | base64)
kubectl patch secret workflow-worker-secrets -n temporal \
  -p "{\"data\":{\"RESEND_API_KEY\":\"$OLD_KEY\"}}"
kubectl rollout restart deployment/workflow-worker -n temporal
```

### Alternative: SMTP Fallback

If Resend is unavailable or SMTP preferred:

1. **Remove RESEND_API_KEY** from secret (or leave it)
2. **Add SMTP credentials**:
   ```bash
   kubectl patch secret workflow-worker-secrets -n temporal -p '{
     "data": {
       "SMTP_HOST": "'$(echo -n "smtp.example.com" | base64)'",
       "SMTP_PORT": "'$(echo -n "587" | base64)'",
       "SMTP_USER": "'$(echo -n "your-smtp-user" | base64)'",
       "SMTP_PASS": "'$(echo -n "your-smtp-password" | base64)'"
     }
   }'
   ```

3. **Restart workers**:
   ```bash
   kubectl rollout restart deployment/workflow-worker -n temporal
   ```

Factory will automatically use SMTP if `SMTP_HOST` is set and `RESEND_API_KEY` is not.

### Monitoring Email Delivery

**Resend Dashboard**:
- Log in to https://resend.com
- Navigate to **Logs** → View all sent emails
- Check delivery status, open rates, bounce rates
- Monitor API quota usage

**Temporal Workflow Logs**:
```bash
# View email activity logs
kubectl logs -n temporal -l app=workflow-worker | grep "sendInvitationEmails"
```

**Common Issues**:

1. **`RESEND_API_KEY` not set**:
   - Error: `Email provider requires RESEND_API_KEY environment variable`
   - Fix: Add key to `workflow-worker-secrets` and restart workers

2. **Invalid API key**:
   - Error: `401 Unauthorized` from Resend API
   - Fix: Verify key is correct, check it hasn't been deleted in Resend dashboard

3. **Rate limit exceeded**:
   - Error: `429 Too Many Requests`
   - Fix: Upgrade Resend plan or implement exponential backoff

4. **Domain not verified**:
   - Error: `403 Forbidden - Domain not verified`
   - Fix: Verify sending domain in Resend dashboard

## Key Considerations

1. **Supabase CLI Migrations**: Schema changes via `supabase db push --linked` (no more manual SQL execution)
2. **Day 0 Baseline**: Production schema captured as `20240101000000_baseline.sql` - all future changes as incremental migrations
3. **SQL Idempotency**: All migrations must be idempotent (IF NOT EXISTS, OR REPLACE, DROP IF EXISTS)
4. **Zero Downtime**: All schema changes must maintain service availability
5. **RLS First**: All tables must have Row-Level Security policies
6. **Event-Driven**: All state changes emit domain events for CQRS projections
7. **Event Metadata for Audit**: The `domain_events` table is the SOLE audit trail - no separate audit table
8. **Email Provider**: Resend (primary), SMTP (fallback) - workers require `RESEND_API_KEY` in Kubernetes secrets
9. **CQRS Query Pattern**: Frontend MUST query projections via `api.` schema RPC functions - NEVER direct table queries with PostgREST embedding

### CQRS Query Rule

> **⚠️ CRITICAL: All frontend queries MUST use `api.` schema RPC functions.**

Projection tables are denormalized read models - they should NEVER be queried directly with PostgREST embedding across tables.

| ✅ Correct Pattern | ❌ Wrong Pattern |
|-------------------|------------------|
| `api.list_users(p_org_id)` | `.from('users').select(..., user_roles_projection!inner(...))` |
| `api.get_roles(p_org_id)` | `.from('roles_projection').select(..., permissions!inner(...))` |
| `api.get_organizations()` | `.from('organizations_projection').select(...)` |

**Why this matters:**
- Projections are denormalized at event processing time - joins should NOT happen at query time
- PostgREST embedding re-normalizes data, defeating CQRS benefits
- RPC functions encapsulate query logic in database (testable, versionable, single source of truth)
- Violating this pattern causes 406 errors and breaks multi-tenant isolation

**When creating new query functionality:**
1. Create RPC function in `api` schema (e.g., `api.list_users()`)
2. Grant EXECUTE to `authenticated` role
3. Frontend calls via `.schema('api').rpc('function_name', params)`
4. Never use `.from('table').select()` with `!inner` joins across projections

### Event Metadata Requirements

All domain events emitted via `api.emit_domain_event()` must include audit context in metadata:

| Field | When Required | Description |
|-------|---------------|-------------|
| `user_id` | Always (who initiated) | UUID of user who triggered the action |
| `reason` | When action has business context | Human-readable justification |
| `ip_address` | Edge Functions only | From request headers |
| `user_agent` | Edge Functions only | From request headers |
| `request_id` | When available from API | Correlation with API logs |

This metadata enables audit queries directly against `domain_events` without a separate audit table:

```sql
-- Example: Who changed this resource?
SELECT event_type, event_metadata->>'user_id' as actor,
       event_metadata->>'reason' as reason, created_at
FROM domain_events WHERE stream_id = '<resource_id>'
ORDER BY created_at DESC;
```

### Correlation ID Pattern (Business-Scoped)

`correlation_id` ties together the ENTIRE business transaction lifecycle, not just a single request.

**Edge Function Implementation**:
- **Creating entity**: Generate and STORE `correlation_id` with the entity
- **Updating entity**: LOOKUP and REUSE the stored `correlation_id`
- **Never generate** new `correlation_id` for subsequent lifecycle events

**Example - Invitation Lifecycle**:
```typescript
// validate-invitation: Returns stored correlation_id
const invitation = await supabase.rpc('get_invitation_by_token', { p_token });
// invitation.correlation_id contains the original ID from user.invited

// accept-invitation: Reuses stored correlation_id
if (invitation.correlation_id) {
  tracingContext.correlationId = invitation.correlation_id;
}
// All events (user.created, invitation.accepted) use same correlation_id
```

**Query by correlation_id** returns complete lifecycle:
```sql
SELECT event_type, created_at FROM domain_events
WHERE correlation_id = 'abc-123'::uuid ORDER BY created_at;
-- user.invited → invitation.resent → invitation.accepted (same ID)
```

**See**: `documentation/workflows/reference/event-metadata-schema.md#correlation-strategy-business-scoped`

## Deployment Runbook

### Overview

The A4C-AppSuite uses GitHub Actions for CI/CD automation. Deployments are triggered automatically on merge to `main` branch.

**Deployment Workflows:**
1. **Frontend** (`.github/workflows/frontend-deploy.yml`) - React application to k3s cluster
2. **Temporal Workers** (`.github/workflows/workflows-docker.yaml`) - Workflow workers to temporal namespace
3. **Supabase Migrations** (`.github/workflows/supabase-migrations.yml`) - Database schema updates

### Prerequisites

Before automated deployments can work:

1. **RBAC Configured (Updated 2025-11-03)**
   - Service account: `github-actions` with namespace-scoped permissions
   - Access: `default` and `temporal` namespaces only (NOT cluster-admin)
   - RBAC resources: `infrastructure/k8s/rbac/`
   - Verify: `kubectl auth can-i create secrets --as=system:serviceaccount:default:github-actions -n default`
   - Documentation: `infrastructure/k8s/rbac/README.md`

2. **KUBECONFIG Secret Updated**
   - GitHub secret `KUBECONFIG` must point to `https://k8s.firstovertheline.com`
   - Uses service account token (not cluster-admin client certificate)
   - See `../documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md` for step-by-step instructions
   - Test connectivity: `./infrastructure/test-k8s-connectivity.sh`

3. **Cloudflare Tunnel Running**
   - SSH to k3s host: `sudo systemctl status cloudflared`
   - Verify endpoint: `curl -k https://k8s.firstovertheline.com/version`

4. **SQL Migrations Idempotent**
   - See `../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md`
   - Fix triggers: Add `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`
   - Fix seed data: Add `ON CONFLICT DO NOTHING` to INSERT statements

5. **GitHub Secrets Configured**
   ```
   Required secrets:
   - KUBECONFIG (base64-encoded kubeconfig with service account token)
   - GHCR_PULL_TOKEN (GitHub Container Registry access)
   - APP_ID, APP_PRIVATE_KEY, INSTALLATION_ID (GitHub App for CI/CD)
   - SUPABASE_URL (e.g., https://yourproject.supabase.co)
   - SUPABASE_SERVICE_ROLE_KEY (for database migrations)
   ```

### Deployment Process

#### 1. Frontend Deployment

**Trigger:** Push to `main` branch with changes in `frontend/**`

**Process:**
1. Build React application with Vite
2. Create Docker image (nginx-based)
3. Push to GHCR: `ghcr.io/analytics4change/a4c-frontend:latest`
4. Deploy to k3s cluster (default namespace)
5. Rolling update with zero downtime
6. Health check: `https://a4c.firstovertheline.com/`

**Manual Deployment:**
```bash
# Build and push Docker image
cd frontend
docker build -t ghcr.io/analytics4change/a4c-frontend:latest .
docker push ghcr.io/analytics4change/a4c-frontend:latest

# Deploy to k3s
kubectl apply -f frontend/k8s/deployment.yaml
kubectl rollout status deployment/a4c-frontend
```

**Rollback:**
```bash
# Rollback to previous deployment
kubectl rollout undo deployment/a4c-frontend

# Rollback to specific revision
kubectl rollout history deployment/a4c-frontend
kubectl rollout undo deployment/a4c-frontend --to-revision=<revision>
```

#### 2. Temporal Worker Deployment

**Trigger:** Push to `main` branch with changes in `workflows/**`

**Process:**
1. Build Node.js worker Docker image
2. Push to GHCR: `ghcr.io/analytics4change/a4c-workflows:latest`
3. Deploy to k3s temporal namespace
4. Rolling update of worker pods
5. Health check via `/health` and `/ready` endpoints

**Manual Deployment:**
```bash
# Build and push Docker image
cd workflows
docker build -t ghcr.io/analytics4change/a4c-workflows:latest .
docker push ghcr.io/analytics4change/a4c-workflows:latest

# Deploy to k3s
kubectl set image deployment/workflow-worker \
  worker=ghcr.io/analytics4change/a4c-workflows:latest \
  -n temporal

kubectl rollout status deployment/workflow-worker -n temporal
```

**Verify Workers:**
```bash
# Check worker pods
kubectl get pods -n temporal -l app=workflow-worker

# Check worker logs
kubectl logs -n temporal -l app=workflow-worker --tail=100

# Port-forward to Temporal Web UI
kubectl port-forward -n temporal svc/temporal-web 8080:8080
# Open: http://localhost:8080
```

**Rollback:**
```bash
# Rollback worker deployment
kubectl rollout undo deployment/workflow-worker -n temporal
```

#### 3. Supabase Database Migrations

**Trigger:** Push to `main` branch with changes in `infrastructure/supabase/supabase/migrations/**`

**Process:**
1. Link Supabase CLI to project
2. Show current migration status
3. Dry-run to preview pending migrations
4. Apply migrations via `supabase db push --linked`
5. Verify migration status after apply

**Manual Migration:**
```bash
# Connect to Supabase
cd infrastructure/supabase
export SUPABASE_ACCESS_TOKEN="your-access-token"
supabase link --project-ref "your-project-ref"

# Check migration status
supabase migration list --linked

# Dry-run (preview changes)
supabase db push --linked --dry-run

# Apply migrations
supabase db push --linked

# Create a new migration file
supabase migration new add_new_feature
# Edit the generated file in supabase/migrations/
```

**Migration History:**
```bash
# View migration status via CLI
supabase migration list --linked

# Or query the database directly
psql -h "db.PROJECT_REF.supabase.co" -U postgres -d postgres <<'SQL'
SELECT version, name, statements
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 20;
SQL
```

**Rollback Strategy:**
- Migrations are **forward-only** (no automated rollback)
- Use `supabase migration repair --status reverted <version>` to mark as reverted
- Create reverse migration files manually if needed
- Test rollback migrations on staging first
- Never rollback in production without stakeholder approval

### Troubleshooting

#### Frontend Deployment Failed

**Issue:** `kubectl cluster connection failed`

**Solution:**
1. Check KUBECONFIG secret points to `k8s.firstovertheline.com`
2. Verify Cloudflare Tunnel: `ssh <k3s-host> 'sudo systemctl status cloudflared'`
3. Test connectivity: `./infrastructure/test-k8s-connectivity.sh`
4. See `../documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md`

**Issue:** Docker image push failed

**Solution:**
1. Check GHCR_PULL_TOKEN secret is valid
2. Verify GitHub App has packages:write permission
3. Check GitHub Container Registry status

**Issue:** Deployment health check failed

**Solution:**
1. Check pod logs: `kubectl logs -l app=a4c-frontend --tail=100`
2. Check ingress: `kubectl get ingress a4c-frontend-ingress`
3. Verify DNS: `nslookup a4c.firstovertheline.com`
4. Check nginx config in Docker image

#### Temporal Worker Deployment Failed

**Issue:** Workers not connecting to Temporal cluster

**Solution:**
1. Check worker logs: `kubectl logs -n temporal -l app=workflow-worker`
2. Verify ConfigMap: `kubectl get configmap workflow-worker-config -n temporal -o yaml`
3. Check Temporal frontend: `kubectl get svc -n temporal temporal-frontend`
4. Port-forward and test: `kubectl port-forward -n temporal svc/temporal-frontend 7233:7233`

**Issue:** Health checks failing

**Solution:**
1. Check port 9090 is exposed in Dockerfile
2. Verify health endpoints: `kubectl exec -n temporal <pod> -- curl localhost:9090/health`
3. Check worker startup logs for errors

#### Supabase Migration Failed

**Issue:** Migration SQL syntax error

**Solution:**
1. Review the migration SQL in `supabase/migrations/`
2. Check migration file for typos
3. Test locally with Supabase CLI: `supabase db push --linked --dry-run`

**Issue:** Migration not idempotent

**Solution:**
1. Review `../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md`
2. Add `IF NOT EXISTS`, `OR REPLACE`, `DROP ... IF EXISTS`
3. Test idempotency: run `supabase db push --linked` twice

**Issue:** Cannot connect to Supabase

**Solution:**
1. Verify `SUPABASE_ACCESS_TOKEN` secret is valid (Management API token)
2. Verify `SUPABASE_PROJECT_REF` matches the target project
3. Check Supabase project status in dashboard
4. Run `supabase link` to verify connectivity

**Issue:** Migration history conflict

**Solution:**
1. Check status: `supabase migration list --linked`
2. Mark superseded migrations as reverted: `supabase migration repair --status reverted <version>`
3. See `../documentation/infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md`

### Monitoring

#### Application Health

```bash
# Frontend
curl https://a4c.firstovertheline.com/

# Frontend pods
kubectl get pods -l app=a4c-frontend
kubectl top pods -l app=a4c-frontend

# Temporal workers
kubectl get pods -n temporal -l app=workflow-worker
kubectl top pods -n temporal -l app=workflow-worker

# Temporal Web UI
kubectl port-forward -n temporal svc/temporal-web 8080:8080
# Open: http://localhost:8080
```

#### Logs

```bash
# Frontend logs (last 100 lines)
kubectl logs -l app=a4c-frontend --tail=100 -f

# Temporal worker logs
kubectl logs -n temporal -l app=workflow-worker --tail=100 -f

# All events in namespace
kubectl get events --sort-by='.lastTimestamp' -n temporal
```

#### Deployment Status

```bash
# Check deployment rollout status
kubectl rollout status deployment/a4c-frontend
kubectl rollout status deployment/workflow-worker -n temporal

# Check deployment history
kubectl rollout history deployment/a4c-frontend
kubectl rollout history deployment/workflow-worker -n temporal

# Check replica counts
kubectl get deployment a4c-frontend
kubectl get deployment workflow-worker -n temporal
```

### Security Best Practices

1. **Secrets Management**
   - Never commit secrets to git
   - Rotate GitHub secrets regularly
   - Use GitHub environment protection for production
   - Encrypt sensitive files with git-crypt

2. **Access Control**
   - Limit kubectl access to authorized personnel
   - Use RBAC in Kubernetes
   - Audit GitHub Actions logs regularly
   - Enable branch protection on `main`

3. **Database**
   - Use Supabase RLS for all tables
   - Never expose service role key in frontend
   - Audit database access logs
   - Backup before major migrations

4. **Kubernetes**
   - Use network policies to isolate namespaces
   - Scan Docker images for vulnerabilities
   - Keep cluster up to date
   - Monitor resource usage

### Disaster Recovery

#### Backup Strategy

**Database:**
- Supabase provides automated backups (check retention policy)
- Manual backup before major migrations:
  ```bash
  pg_dump -h $DB_HOST -U postgres -d postgres > backup-$(date +%Y%m%d).sql
  ```

**Kubernetes:**
- Critical deployments tracked in git (`k8s/*.yaml`)
- Secrets stored in encrypted git-crypt
- ConfigMaps in version control

**Temporal:**
- Workflows are durable (persisted in Temporal DB)
- Worker code in git
- Temporal cluster backed by PostgreSQL (Supabase backups)

#### Recovery Procedures

**Complete cluster failure:**
1. Restore k3s cluster from infrastructure backup
2. Redeploy Temporal Helm chart
3. Redeploy workers: `kubectl apply -f infrastructure/k8s/temporal/`
4. Redeploy frontend: `kubectl apply -f frontend/k8s/`
5. Verify health checks
6. Resume Temporal workflows (automatic)

**Database corruption:**
1. Identify last good backup
2. Restore from Supabase backup
3. Re-run migrations if needed
4. Verify data integrity
5. Resume application services

**Application rollback:**
1. Identify last working deployment
2. Rollback: `kubectl rollout undo deployment/<name>`
3. Verify application health
4. Investigate root cause
5. Fix and re-deploy

### References

#### Architecture & Design
- **[Multi-Tenancy Architecture](../documentation/architecture/data/multi-tenancy-architecture.md)** - Organization isolation with RLS policies
- **[Event Sourcing Overview](../documentation/architecture/data/event-sourcing-overview.md)** - CQRS and domain events architecture
- **[RBAC Architecture](../documentation/architecture/authorization/rbac-architecture.md)** - Role-based access control implementation
- **[Temporal Workflows Overview](../documentation/architecture/workflows/temporal-overview.md)** - Workflow orchestration architecture

#### Supabase Implementation Guides
- **[Deployment Instructions](../documentation/infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md)** - Production deployment procedures
- **[SQL Idempotency Audit](../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)** - Migration idempotency patterns and fixes
- **[JWT Custom Claims Setup](../documentation/infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md)** - Database hooks for JWT claims
- **[OAuth Testing Guide](../documentation/infrastructure/guides/supabase/OAUTH-TESTING.md)** - Comprehensive OAuth testing and troubleshooting
- **[Supabase Auth Setup](../documentation/infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md)** - Complete authentication configuration
- **[Event-Driven Architecture](../documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md)** - Backend event sourcing specification

#### Database Table Reference
- **[organizations_projection](../documentation/infrastructure/reference/database/tables/organizations_projection.md)** - Multi-tenant organization hierarchy
- **[user_roles_projection](../documentation/infrastructure/reference/database/tables/user_roles_projection.md)** - Role assignments with scope isolation
- **[permissions_projection](../documentation/infrastructure/reference/database/tables/permissions_projection.md)** - Permission definitions
- **[domain_events](../documentation/infrastructure/reference/database/tables/domain_events.md)** - Event store for CQRS (not yet documented)
- **[Complete Table List](../documentation/infrastructure/reference/database/tables/)** - All 12 core table schemas

#### Operations & Deployment
- **[KUBECONFIG Update Guide](../documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md)** - GitHub Actions k8s access configuration
- **[RBAC Setup](../documentation/infrastructure/operations/k8s-rbac-setup.md)** - Kubernetes service account permissions

#### CI/CD Workflows
- **Frontend Deployment**: `.github/workflows/frontend-deploy.yml`
- **Temporal Workers**: `.github/workflows/workflows-docker.yaml`
- **Database Migrations**: `.github/workflows/supabase-migrations.yml`

#### Testing & Scripts
- **Connectivity Testing**: `infrastructure/test-k8s-connectivity.sh`
- **OAuth Scripts**: `infrastructure/supabase/scripts/` (OAuth configuration and verification)

## Documentation Resources

- **[Agent Navigation Index](../documentation/AGENT-INDEX.md)** - Keyword-based doc navigation for AI agents
- **[Agent Guidelines](../documentation/AGENT-GUIDELINES.md)** - Documentation creation and update rules
- **[Infrastructure Documentation](../documentation/infrastructure/)** - All infrastructure-specific documentation