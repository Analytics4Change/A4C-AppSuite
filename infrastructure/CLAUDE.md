# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the infrastructure repository for Analytics4Change (A4C) platform, managing:
- **Supabase**: Authentication, database, Edge Functions, RLS policies, SQL migrations
- **Kubernetes**: Temporal.io cluster for workflow orchestration
- **SQL-First Approach**: Event-driven schema with CQRS projections

**Migration Note**: Platform migrated from Zitadel to Supabase Auth (October 2025). Zitadel configurations are deprecated and archived in `.archived_plans/zitadel/`.

## Commands

### Supabase SQL Migrations
```bash
# Run migrations locally (idempotent)
cd infrastructure/supabase
./local-tests/start-local.sh
./local-tests/run-migrations.sh
./local-tests/verify-idempotency.sh  # Test by running twice
./local-tests/stop-local.sh

# Deploy to production via psql
export PROJECT_REF="your-project-ref"
psql -h "db.${PROJECT_REF}.supabase.co" -U postgres -d postgres \
  -f sql/02-tables/organizations/table.sql
```

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

## Architecture

### Directory Structure
```
infrastructure/
├── supabase/            # Supabase database schema and migrations
│   ├── sql/            # SQL migrations (event-driven schema)
│   │   ├── 01-extensions/       # PostgreSQL extensions (ltree, uuid)
│   │   ├── 02-tables/          # Table definitions (CQRS projections)
│   │   ├── 03-functions/       # Database functions (JWT claims, etc.)
│   │   ├── 04-triggers/        # Event processors
│   │   ├── 05-policies/        # RLS policies
│   │   └── 99-seeds/           # Seed data
│   ├── contracts/      # AsyncAPI event schemas
│   │   └── asyncapi.yaml       # Event contract definitions
│   ├── local-tests/    # Local testing scripts
│   │   ├── start-local.sh      # Start local Supabase
│   │   ├── run-migrations.sh   # Run all migrations
│   │   ├── verify-idempotency.sh  # Test idempotency
│   │   └── stop-local.sh       # Stop local Supabase
│   ├── DEPLOY_TO_SUPABASE_STUDIO.sql  # Deployment script
│   └── SUPABASE-AUTH-SETUP.md          # Auth configuration guide
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
kubectl get secret temporal-worker-secrets -n temporal -o yaml

# Required secrets:
# - TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
# - SUPABASE_URL=https://your-project.supabase.co
# - SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# - CLOUDFLARE_API_TOKEN=your-cloudflare-token
# - SMTP_HOST, SMTP_USER, SMTP_PASS (email delivery)
```

## Key Considerations

1. **SQL Idempotency**: All migrations must be idempotent (IF NOT EXISTS, OR REPLACE, DROP IF EXISTS)
2. **Zero Downtime**: All schema changes must maintain service availability
3. **RLS First**: All tables must have Row-Level Security policies
4. **Event-Driven**: All state changes emit domain events for CQRS projections
5. **Local Testing**: Test migrations locally before deploying to production

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
   - See `infrastructure/KUBECONFIG_UPDATE_GUIDE.md` for step-by-step instructions
   - Test connectivity: `./infrastructure/test-k8s-connectivity.sh`

3. **Cloudflare Tunnel Running**
   - SSH to k3s host: `sudo systemctl status cloudflared`
   - Verify endpoint: `curl -k https://k8s.firstovertheline.com/version`

4. **SQL Migrations Idempotent**
   - See `infrastructure/supabase/SQL_IDEMPOTENCY_AUDIT.md`
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

**Trigger:** Push to `main` branch with changes in `infrastructure/supabase/sql/**`

**Process:**
1. Validate SQL syntax
2. Check for idempotency patterns
3. Connect to Supabase PostgreSQL
4. Create migration tracking table
5. Execute migrations in order (00-extensions → 06-rls)
6. Skip already-applied migrations (checksum validation)
7. Record execution in `_migrations_applied` table

**Manual Migration:**
```bash
# Connect to Supabase
export SUPABASE_URL="https://yourproject.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-key"
export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"

# Get database host
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
DB_HOST="db.${PROJECT_REF}.supabase.co"

# Run specific migration
psql -h "$DB_HOST" -U postgres -d postgres \
  -f infrastructure/supabase/sql/03-functions/authorization/001-user_has_permission.sql

# Run all migrations in order
for dir in 00-extensions 01-events 02-tables 03-functions 04-triggers 05-views 06-rls; do
  for file in infrastructure/supabase/sql/$dir/**/*.sql; do
    echo "Running: $file"
    psql -h "$DB_HOST" -U postgres -d postgres -f "$file"
  done
done
```

**Migration History:**
```bash
# View applied migrations
psql -h "$DB_HOST" -U postgres -d postgres <<'SQL'
SELECT migration_name, applied_at, execution_time_ms
FROM _migrations_applied
ORDER BY applied_at DESC
LIMIT 20;
SQL
```

**Rollback Strategy:**
- Migrations are **forward-only** (no automated rollback)
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
4. See `infrastructure/KUBECONFIG_UPDATE_GUIDE.md`

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
1. Test migration locally with `psql`
2. Check migration file for typos
3. Validate against PostgreSQL version in Supabase

**Issue:** Migration not idempotent

**Solution:**
1. Review `infrastructure/supabase/SQL_IDEMPOTENCY_AUDIT.md`
2. Add `IF NOT EXISTS`, `OR REPLACE`, `DROP ... IF EXISTS`
3. Test by running migration twice locally

**Issue:** Cannot connect to database

**Solution:**
1. Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets
2. Check Supabase project status in dashboard
3. Verify network connectivity to Supabase
4. Check IP allowlist in Supabase settings (if configured)

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

- KUBECONFIG Setup: `infrastructure/KUBECONFIG_UPDATE_GUIDE.md`
- SQL Idempotency Audit: `infrastructure/supabase/SQL_IDEMPOTENCY_AUDIT.md`
- Connectivity Testing: `infrastructure/test-k8s-connectivity.sh`
- Frontend Workflow: `.github/workflows/frontend-deploy.yml`
- Worker Workflow: `.github/workflows/workflows-docker.yaml`
- Migration Workflow: `.github/workflows/supabase-migrations.yml`