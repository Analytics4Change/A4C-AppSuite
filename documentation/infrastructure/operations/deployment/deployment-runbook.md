---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Deployment runbook for the three CI/CD pipelines (frontend, Temporal workers, Supabase migrations) — manual deployment steps, rollback procedures, prerequisites, monitoring commands, and per-pipeline troubleshooting.

**When to read**:
- Deploying any component manually (CI/CD broken, hotfix needed)
- Rolling back a failed deployment
- Setting up RBAC, KUBECONFIG, or Cloudflare Tunnel for the first time
- Investigating a deployment failure
- Onboarding to operations responsibilities

**Prerequisites**: `kubectl` configured for k3s cluster, Supabase access token, GHCR write access for manual image pushes

**Key topics**: `deployment`, `runbook`, `rollback`, `kubectl`, `supabase-cli`, `ghcr`, `cloudflare-tunnel`, `rbac`

**Estimated read time**: 15 minutes (full), 5 minutes (single component)
<!-- TL;DR-END -->

# Deployment Runbook

This runbook covers manual deployment of the three CI/CD pipelines and their rollback procedures.

## Overview

A4C-AppSuite uses GitHub Actions for CI/CD automation. Deployments are triggered automatically on merge to `main`.

**Deployment workflows**:
1. **Frontend** (`.github/workflows/frontend-deploy.yml`) — React application to k3s cluster
2. **Temporal Workers** (`.github/workflows/temporal-deploy.yml`) — Workflow workers to `temporal` namespace
3. **Supabase Migrations** (`.github/workflows/supabase-migrations.yml`) — Database schema updates
4. **Supabase Edge Functions** (`.github/workflows/edge-functions-deploy.yml`) — Edge Function deployment; manual steps documented in [DEPLOYMENT_INSTRUCTIONS.md](../../guides/supabase/DEPLOYMENT_INSTRUCTIONS.md)

This runbook covers manual operation when CI/CD is unavailable or rollback is needed.

## Prerequisites

Before automated deployments can work:

### 1. RBAC Configured (Updated 2025-11-03)

- Service account: `github-actions` with namespace-scoped permissions
- Access: `default` and `temporal` namespaces only (NOT cluster-admin)
- RBAC resources: `infrastructure/k8s/rbac/`
- Verify: `kubectl auth can-i create secrets --as=system:serviceaccount:default:github-actions -n default`
- See: `infrastructure/k8s/rbac/README.md`

### 2. KUBECONFIG Secret Updated

- GitHub secret `KUBECONFIG` must point to `https://k8s.firstovertheline.com`
- Uses service account token (not cluster-admin client certificate)
- See [KUBECONFIG Update Guide](../KUBECONFIG_UPDATE_GUIDE.md) for step-by-step instructions
- Test connectivity: `./infrastructure/test-k8s-connectivity.sh`

### 3. Cloudflare Tunnel Running

- SSH to k3s host: `sudo systemctl status cloudflared`
- Verify endpoint: `curl -k https://k8s.firstovertheline.com/version`

### 4. SQL Migrations Idempotent

- See [SQL Idempotency Audit](../../guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)
- Fix triggers: Add `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`
- Fix seed data: Add `ON CONFLICT DO NOTHING` to INSERT statements

### 5. GitHub Secrets Configured

```
Required secrets:
- KUBECONFIG (base64-encoded kubeconfig with service account token)
- K8S_IMAGE_PULL_TOKEN (in-cluster imagePullSecret for GHCR; used by frontend-deploy.yml)
- APP_ID, APP_PRIVATE_KEY, INSTALLATION_ID (GitHub App for CI/CD)
- VITE_SUPABASE_ANON_KEY (frontend build-time env; used by frontend-deploy.yml)
- SUPABASE_URL (e.g., https://yourproject.supabase.co)
- SUPABASE_SERVICE_ROLE_KEY (for database migrations)
- SUPABASE_ACCESS_TOKEN (Supabase Management API token; used by supabase-migrations.yml)
- SUPABASE_PROJECT_REF (target project ref; used by supabase-migrations.yml)
- SUPABASE_DB_PASSWORD (used by temporal-deploy.yml for DB connectivity)
```

Registry push auth uses the workflow-scoped `GITHUB_TOKEN` (automatic, not a user-managed secret).

## Frontend Deployment

**Trigger**: Push to `main` with changes in `frontend/**`

**Process**:
1. Build React application with Vite
2. Create Docker image (nginx-based)
3. Push to GHCR: `ghcr.io/analytics4change/a4c-appsuite-frontend:latest`
4. Deploy to k3s cluster (default namespace)
5. Rolling update with zero downtime
6. Health check: `https://a4c.firstovertheline.com/`

### Manual Deployment

```bash
# Build and push Docker image
cd frontend
docker build -t ghcr.io/analytics4change/a4c-appsuite-frontend:latest .
docker push ghcr.io/analytics4change/a4c-appsuite-frontend:latest

# Deploy to k3s
kubectl apply -f frontend/k8s/deployment.yaml
kubectl rollout status deployment/a4c-frontend
```

### Rollback

```bash
# Rollback to previous deployment
kubectl rollout undo deployment/a4c-frontend

# Rollback to specific revision
kubectl rollout history deployment/a4c-frontend
kubectl rollout undo deployment/a4c-frontend --to-revision=<revision>
```

## Temporal Worker Deployment

**Trigger**: Push to `main` with changes in `workflows/**`

**Process**:
1. Build Node.js worker Docker image
2. Push to GHCR: `ghcr.io/analytics4change/a4c-workflows:latest`
3. Deploy to k3s `temporal` namespace
4. Rolling update of worker pods
5. Health check via `/health` and `/ready` endpoints

### Manual Deployment

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

### Verify Workers

```bash
# Check worker pods
kubectl get pods -n temporal -l app=workflow-worker

# Check worker logs
kubectl logs -n temporal -l app=workflow-worker --tail=100

# Port-forward to Temporal Web UI
kubectl port-forward -n temporal svc/temporal-web 8080:8080
# Open: http://localhost:8080
```

> **Note**: `svc/temporal-web` (8080) and `svc/temporal-frontend` (7233) are created by the Temporal Helm chart, not by the committed YAML under `infrastructure/k8s/temporal/`. Grep the repo for these names and you will not find them.

### Rollback

```bash
kubectl rollout undo deployment/workflow-worker -n temporal
```

## Supabase Database Migrations

**Trigger**: Push to `main` with changes in `infrastructure/supabase/supabase/migrations/**`

**Process**:
1. Link Supabase CLI to project
2. Show current migration status
3. Dry-run to preview pending migrations
4. Apply migrations via `supabase db push --linked`
5. Verify migration status after apply

### Manual Migration

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

### Migration History

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

### Rollback Strategy

- Migrations are **forward-only** (no automated rollback)
- Use `supabase migration repair --status reverted <version>` to mark as reverted
- Create reverse migration files manually if needed
- Test rollback migrations on staging first
- Never rollback in production without stakeholder approval

## Troubleshooting

### Frontend Deployment Failed

**Issue**: `kubectl cluster connection failed`

**Solution**:
1. Check KUBECONFIG secret points to `k8s.firstovertheline.com`
2. Verify Cloudflare Tunnel: `ssh <k3s-host> 'sudo systemctl status cloudflared'`
3. Test connectivity: `./infrastructure/test-k8s-connectivity.sh`
4. See [KUBECONFIG Update Guide](../KUBECONFIG_UPDATE_GUIDE.md)

**Issue**: Docker image push failed

**Solution**:
1. Confirm the workflow has `permissions: packages: write` (push uses `GITHUB_TOKEN`, not a user-managed secret)
2. Check GitHub Container Registry status

**Issue**: k3s cannot pull the image (ImagePullBackOff)

**Solution**:
1. Check `K8S_IMAGE_PULL_TOKEN` secret is valid (used by `frontend-deploy.yml` to create the in-cluster `imagePullSecret`)
2. Inspect the pod events: `kubectl describe pod -l app=a4c-frontend`
3. Verify the `imagePullSecret` exists in the namespace

**Issue**: Deployment health check failed

**Solution**:
1. Check pod logs: `kubectl logs -l app=a4c-frontend --tail=100`
2. Check ingress: `kubectl get ingress a4c-frontend-ingress`
3. Verify DNS: `nslookup a4c.firstovertheline.com`
4. Check nginx config in Docker image

### Temporal Worker Deployment Failed

**Issue**: Workers not connecting to Temporal cluster

**Solution**:
1. Check worker logs: `kubectl logs -n temporal -l app=workflow-worker`
2. Verify ConfigMap: `kubectl get configmap workflow-worker-config -n temporal -o yaml`
3. Check Temporal frontend: `kubectl get svc -n temporal temporal-frontend`
4. Port-forward and test: `kubectl port-forward -n temporal svc/temporal-frontend 7233:7233`

**Issue**: Health checks failing

**Solution**:
1. Check port 9090 is exposed in Dockerfile
2. Verify health endpoints: `kubectl exec -n temporal <pod> -- curl localhost:9090/health`
3. Check worker startup logs for errors

### Supabase Migration Failed

**Issue**: Migration SQL syntax error

**Solution**:
1. Review the migration SQL in `supabase/migrations/`
2. Check migration file for typos
3. Test locally with Supabase CLI: `supabase db push --linked --dry-run`

**Issue**: Migration not idempotent

**Solution**:
1. Review [SQL Idempotency Audit](../../guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)
2. Add `IF NOT EXISTS`, `OR REPLACE`, `DROP ... IF EXISTS`
3. Test idempotency: run `supabase db push --linked` twice

**Issue**: Cannot connect to Supabase

**Solution**:
1. Verify `SUPABASE_ACCESS_TOKEN` secret is valid (Management API token)
2. Verify `SUPABASE_PROJECT_REF` matches the target project
3. Check Supabase project status in dashboard
4. Run `supabase link` to verify connectivity

**Issue**: Migration history conflict

**Solution**:
1. Check status: `supabase migration list --linked`
2. Mark superseded migrations as reverted: `supabase migration repair --status reverted <version>`
3. See [Day 0 Migration Guide](../../guides/supabase/DAY0-MIGRATION-GUIDE.md)

## Monitoring

### Application Health

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

### Logs

```bash
# Frontend logs (last 100 lines)
kubectl logs -l app=a4c-frontend --tail=100 -f

# Temporal worker logs
kubectl logs -n temporal -l app=workflow-worker --tail=100 -f

# All events in namespace
kubectl get events --sort-by='.lastTimestamp' -n temporal
```

### Deployment Status

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

## Related Documentation

- [Disaster Recovery](../disaster-recovery.md) — Backup strategy and recovery procedures
- [KUBECONFIG Update Guide](../KUBECONFIG_UPDATE_GUIDE.md) — GitHub Actions k8s access configuration
- [Day 0 Migration Guide](../../guides/supabase/DAY0-MIGRATION-GUIDE.md) — Baseline consolidation and migration tracking
- [SQL Idempotency Audit](../../guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) — Migration patterns
- [Deployment Instructions](../../guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) — Step-by-step Supabase deployment
- [Resend Key Rotation](../resend-key-rotation.md) — Email provider key rotation
- [Infrastructure CLAUDE.md](../../../../infrastructure/CLAUDE.md) — Component-level guide
