---
status: current
last_updated: 2025-01-13
---

# A4C-AppSuite Deployment Checklist

**Last Updated**: 2025-11-04
**Version**: 1.0.0

This checklist provides step-by-step instructions for deploying the A4C-AppSuite across all components.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Frontend Deployment](#frontend-deployment)
3. [Temporal Workflows Deployment](#temporal-workflows-deployment)
4. [Supabase Database Migrations](#supabase-database-migrations)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Rollback Procedures](#rollback-procedures)
7. [Troubleshooting](#troubleshooting)

## Related Documentation

- **[Docker Image Tagging Strategy](../../guides/docker-image-tagging-strategy.md)** - Explains commit SHA-based tagging for all deployments

---

## Pre-Deployment Checklist

### Prerequisites

Before deploying, ensure all prerequisites are met:

#### GitHub Configuration

- [ ] **GitHub Secrets are configured** (Repository Settings → Secrets and variables → Actions)
  - [ ] `VITE_SUPABASE_URL` - Frontend Supabase project URL
  - [ ] `VITE_SUPABASE_ANON_KEY` - Frontend public API key
  - [ ] `SUPABASE_URL` - Workflow Supabase project URL
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` - Workflow privileged API key
  - [ ] `KUBECONFIG` - Kubernetes cluster config (base64-encoded)
  - [ ] `K8S_IMAGE_PULL_TOKEN` - GitHub Container Registry token
  - [ ] `APP_ID`, `APP_PRIVATE_KEY`, `INSTALLATION_ID` - GitHub App credentials

#### Kubernetes Cluster

- [ ] **k3s cluster is accessible**
  - Test: `kubectl cluster-info`
  - Test: `curl -k https://k8s.firstovertheline.com/version`

- [ ] **Cloudflare Tunnel is running**
  - SSH to k3s host: `sudo systemctl status cloudflared`
  - Endpoint: `https://k8s.firstovertheline.com`

- [ ] **RBAC is configured**
  - Service account: `github-actions` exists in `default` and `temporal` namespaces
  - Test: `kubectl auth can-i create secrets --as=system:serviceaccount:default:github-actions -n default`

- [ ] **Namespaces exist**
  - [ ] `default` namespace (for frontend)
  - [ ] `temporal` namespace (for Temporal cluster and workers)

#### Temporal Workflows

- [ ] **Kubernetes secret exists**: `workflow-worker-secrets` in `temporal` namespace
  ```bash
  kubectl get secret workflow-worker-secrets -n temporal
  ```

  If not exists, create it:
  ```bash
  kubectl create secret generic workflow-worker-secrets \
    -n temporal \
    --from-literal=SUPABASE_SERVICE_ROLE_KEY='your-service-role-key' \
    --from-literal=CLOUDFLARE_API_TOKEN='your-cloudflare-token' \
    --from-literal=RESEND_API_KEY='your-resend-key'
  ```

- [ ] **ConfigMap exists**: `workflow-worker-config` in `temporal` namespace
  ```bash
  kubectl get configmap workflow-worker-config -n temporal
  ```

- [ ] **Temporal cluster is healthy**
  ```bash
  kubectl get pods -n temporal
  # All pods should be Running
  ```

#### Supabase

- [ ] **Supabase project is accessible**
  - URL: Check project dashboard
  - Test connectivity: `curl https://your-project.supabase.co`

- [ ] **Database connection works**
  ```bash
  export SUPABASE_URL="https://your-project.supabase.co"
  export SUPABASE_SERVICE_ROLE_KEY="your-key"
  export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"
  PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
  DB_HOST="db.${PROJECT_REF}.supabase.co"

  psql -h "$DB_HOST" -U postgres -d postgres -c "SELECT version();"
  ```

- [ ] **SQL migrations are idempotent**
  - See `infrastructure/supabase/SQL_IDEMPOTENCY_AUDIT.md`
  - Triggers have `DROP TRIGGER IF EXISTS`
  - Seed data has `ON CONFLICT DO NOTHING`

#### Local Testing

- [ ] **Code is tested locally**
  - Frontend: `cd frontend && npm run build && npm run preview`
  - Workflows: `cd workflows && npm run build && npm test`

- [ ] **Configuration is validated**
  - Frontend: Check `.env.production` template
  - Workflows: Check `.env.example` template
  - Cross-reference: `docs/ENVIRONMENT_VARIABLES.md`

---

## Frontend Deployment

### Automatic Deployment (via GitHub Actions)

**Trigger**: Push to `main` branch with changes in `frontend/**` or `.github/workflows/frontend-deploy.yml`

#### Pre-Flight Checks

1. **Verify GitHub Secrets are set**
   ```bash
   # Check in GitHub UI:
   # Settings → Secrets and variables → Actions
   # Should see: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
   ```

2. **Review workflow file**
   ```bash
   cat .github/workflows/frontend-deploy.yml
   # Verify "Create production environment file" step exists
   ```

3. **Commit and push changes**
   ```bash
   git add .
   git commit -m "fix: inject Supabase credentials into production build"
   git push origin main
   ```

#### Monitor Deployment

1. **Watch GitHub Actions**
   - Go to: `https://github.com/Analytics4Change/A4C-AppSuite/actions`
   - Click on the running workflow: "Deploy Frontend"

2. **Check build step output**
   - Look for: "Creating .env.production with Supabase credentials..."
   - Look for: "✓ All required secrets are present"

3. **Check deployment step output**
   - Look for: "✅ Deployment successful - application is responding"
   - Check final URL: `https://a4c.firstovertheline.com`

#### Verify Deployment

- [ ] **Pods are running**
  ```bash
  kubectl get pods -l app=a4c-frontend
  # Should show 2/2 Running
  ```

- [ ] **Application loads in browser**
  - Open: `https://a4c.firstovertheline.com`
  - Should see: Login page (no blank page)
  - Should NOT see: "Supabase configuration missing" error

- [ ] **Browser console has no errors**
  - Open browser DevTools (F12)
  - Check Console tab
  - Should NOT see: "Supabase configuration missing"

- [ ] **Authentication works**
  - Try logging in
  - Check JWT token is issued
  - Verify user can access application

### Manual Deployment

If automatic deployment fails or you need to deploy manually:

1. **Build Docker image locally**
   ```bash
   cd frontend

   # Create .env.production with real credentials
   cat > .env.production << EOF
   VITE_APP_MODE=production
   VITE_SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_USE_RXNORM_API=false
   EOF

   # Build application
   npm ci
   npm run build

   # Build Docker image
   docker build -t ghcr.io/analytics4change/a4c-appsuite-frontend:manual .

   # Push to registry
   docker push ghcr.io/analytics4change/a4c-appsuite-frontend:manual
   ```

2. **Deploy to Kubernetes**
   ```bash
   # Update image in deployment
   kubectl set image deployment/a4c-frontend \
     a4c-frontend=ghcr.io/analytics4change/a4c-appsuite-frontend:manual \
     -n default

   # Wait for rollout
   kubectl rollout status deployment/a4c-frontend
   ```

3. **Verify deployment** (same as automatic deployment above)

---

## Temporal Workflows Deployment

### Automatic Deployment (via GitHub Actions)

**Trigger**: Push to `main` branch with changes in `workflows/**` or `.github/workflows/workflows-docker.yaml`

#### Pre-Flight Checks

1. **Verify Kubernetes secret exists**
   ```bash
   kubectl get secret workflow-worker-secrets -n temporal

   # If not exists, create it (see Prerequisites above)
   ```

2. **Verify ConfigMap is correct**
   ```bash
   kubectl get configmap workflow-worker-config -n temporal -o yaml

   # Check values:
   # WORKFLOW_MODE: "production"
   # TEMPORAL_ADDRESS: "temporal-frontend.temporal.svc.cluster.local:7233"
   # SUPABASE_URL: correct URL
   # TAG_DEV_ENTITIES: "false"
   # AUTO_CLEANUP: "false"
   ```

3. **Commit and push changes**
   ```bash
   git add workflows/
   git commit -m "feat: update workflow logic"
   git push origin main
   ```

#### Monitor Deployment

1. **Watch GitHub Actions**
   - Go to: `https://github.com/Analytics4Change/A4C-AppSuite/actions`
   - Click on: "Deploy Workflows"

2. **Check worker pods**
   ```bash
   # Watch pod rollout
   kubectl get pods -n temporal -l app=workflow-worker -w

   # Should see old pods terminating, new pods starting
   ```

#### Verify Deployment

- [ ] **Pods are running**
  ```bash
  kubectl get pods -n temporal -l app=workflow-worker
  # Should show 3/3 Running (or configured replica count)
  ```

- [ ] **Workers are healthy**
  ```bash
  # Check health endpoint
  kubectl exec -n temporal <pod-name> -- curl localhost:9090/health
  # Should return: {"status":"healthy"}
  ```

- [ ] **Workers connected to Temporal**
  ```bash
  # Check logs
  kubectl logs -n temporal -l app=workflow-worker --tail=50

  # Look for:
  # "Worker connected to Temporal cluster"
  # "Task queue: bootstrap"
  ```

- [ ] **Temporal Web UI shows workers**
  ```bash
  # Port-forward Temporal Web
  kubectl port-forward -n temporal svc/temporal-web 8080:8080

  # Open: http://localhost:8080
  # Check "Workers" tab shows active workers
  ```

### Manual Deployment

If automatic deployment fails:

1. **Build Docker image locally**
   ```bash
   cd workflows

   npm ci
   npm run build

   docker build -t ghcr.io/analytics4change/a4c-workflows:manual .
   docker push ghcr.io/analytics4change/a4c-workflows:manual
   ```

2. **Deploy to Kubernetes**
   ```bash
   kubectl set image deployment/workflow-worker \
     worker=ghcr.io/analytics4change/a4c-workflows:manual \
     -n temporal

   kubectl rollout status deployment/workflow-worker -n temporal
   ```

3. **Verify deployment** (same as automatic deployment above)

---

## Supabase Database Migrations

### Automatic Deployment (via GitHub Actions)

**Trigger**: Push to `main` branch with changes in `infrastructure/supabase/sql/**` or `.github/workflows/supabase-migrations.yml`

#### Pre-Flight Checks

1. **Verify migrations are idempotent**
   ```bash
   # Run audit script
   cd infrastructure/supabase
   ./audit-idempotency.sh

   # Should show: "✅ All SQL files pass idempotency checks"
   ```

2. **Test migrations locally**
   ```bash
   export SUPABASE_URL="https://your-dev-project.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="your-dev-key"
   export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"
   PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
   DB_HOST="db.${PROJECT_REF}.supabase.co"

   # Test specific migration
   psql -h "$DB_HOST" -U postgres -d postgres \
     -f sql/04-triggers/process_user_invited.sql

   # Run twice to verify idempotency
   psql -h "$DB_HOST" -U postgres -d postgres \
     -f sql/04-triggers/process_user_invited.sql

   # Should succeed both times with no errors
   ```

3. **Commit and push**
   ```bash
   git add infrastructure/supabase/sql/
   git commit -m "feat: add user invitation trigger"
   git push origin main
   ```

#### Monitor Deployment

1. **Watch GitHub Actions**
   - Go to: `https://github.com/Analytics4Change/A4C-AppSuite/actions`
   - Click on: "Supabase Migrations"

2. **Check migration output**
   - Look for: "Applying migrations..."
   - Look for: "✅ Migration applied: <filename>"

#### Verify Deployment

- [ ] **Migrations applied successfully**
  ```bash
  # Check _migrations_applied table
  psql -h "$DB_HOST" -U postgres -d postgres <<'SQL'
  SELECT migration_name, applied_at, execution_time_ms
  FROM _migrations_applied
  ORDER BY applied_at DESC
  LIMIT 10;
  SQL
  ```

- [ ] **Database schema is correct**
  ```bash
  # Verify specific table/function/trigger exists
  psql -h "$DB_HOST" -U postgres -d postgres -c "\dt"  # List tables
  psql -h "$DB_HOST" -U postgres -d postgres -c "\df"  # List functions
  ```

- [ ] **RLS policies work**
  ```bash
  # Test RLS by querying as authenticated user
  # (use Supabase Dashboard SQL editor or PostgREST)
  ```

### Manual Migration

If automatic migration fails or for emergency hotfixes:

1. **Connect to database**
   ```bash
   export SUPABASE_URL="https://your-project.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="your-key"
   export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"
   PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
   DB_HOST="db.${PROJECT_REF}.supabase.co"

   psql -h "$DB_HOST" -U postgres -d postgres
   ```

2. **Apply migration manually**
   ```sql
   -- Example: Create trigger
   DROP TRIGGER IF EXISTS process_user_invited ON domain_events;

   CREATE TRIGGER process_user_invited
   AFTER INSERT ON domain_events
   FOR EACH ROW
   WHEN (NEW.event_type = 'UserInvited')
   EXECUTE FUNCTION process_user_invited();
   ```

3. **Record migration**
   ```sql
   INSERT INTO _migrations_applied (migration_name, applied_at, execution_time_ms)
   VALUES ('04-triggers/process_user_invited.sql', NOW(), 0)
   ON CONFLICT (migration_name) DO NOTHING;
   ```

---

## Post-Deployment Verification

### End-to-End Verification

After all components are deployed, verify the complete system:

#### 1. Frontend Verification

- [ ] **Application loads**
  - Open: `https://a4c.firstovertheline.com`
  - Should see: Login page

- [ ] **Authentication works**
  - Click: "Sign in with Google" (or GitHub)
  - Complete OAuth flow
  - Should redirect to: Client list or dashboard

- [ ] **JWT tokens are correct**
  - Open browser DevTools → Application → Local Storage
  - Check: `supabase.auth.token`
  - Decode JWT at jwt.io
  - Verify claims: `org_id`, `user_role`, `permissions`, `scope_path`

#### 2. Workflows Verification

- [ ] **Workers are connected**
  ```bash
  kubectl logs -n temporal -l app=workflow-worker --tail=100 | grep "Worker connected"
  ```

- [ ] **Can trigger workflow**
  - Use frontend to create organization (if implemented)
  - Or use Temporal CLI:
    ```bash
    temporal workflow start \
      --type OrganizationBootstrapWorkflow \
      --task-queue bootstrap \
      --input '{"organizationName":"Test Org"}'
    ```

- [ ] **Workflow executes successfully**
  ```bash
  # Port-forward Temporal Web
  kubectl port-forward -n temporal svc/temporal-web 8080:8080

  # Open: http://localhost:8080
  # Check workflow history shows successful completion
  ```

#### 3. Database Verification

- [ ] **Domain events are recorded**
  ```sql
  SELECT event_type, aggregate_type, created_at
  FROM domain_events
  ORDER BY created_at DESC
  LIMIT 10;
  ```

- [ ] **Projections are updated**
  ```sql
  SELECT * FROM organizations_projection
  ORDER BY created_at DESC
  LIMIT 5;
  ```

- [ ] **RLS policies enforce security**
  - Try accessing data from different org (should fail)
  - Verify user can only see their org's data

#### 4. Cross-Component Integration

- [ ] **Frontend → Workflows**
  - Trigger workflow from frontend
  - Verify workflow executes
  - Verify frontend updates with workflow result

- [ ] **Workflows → Database**
  - Verify domain events emitted
  - Verify projections updated
  - Check event sourcing integrity

- [ ] **Database → Frontend**
  - Verify frontend queries return correct data
  - Check RLS policies enforce isolation
  - Test multi-tenant data access

### Performance Checks

- [ ] **Frontend performance**
  - Lighthouse score > 90
  - First Contentful Paint < 2s
  - Time to Interactive < 3s

- [ ] **Worker performance**
  ```bash
  kubectl top pods -n temporal -l app=workflow-worker
  # CPU < 500m, Memory < 512Mi (normal operation)
  ```

- [ ] **Database performance**
  - Check Supabase Dashboard → Database → Performance
  - Query response time < 100ms (simple queries)

### Monitoring Setup

- [ ] **Set up monitoring dashboards**
  - Frontend: Google Analytics, Sentry (if configured)
  - Workflows: Temporal Web UI
  - Database: Supabase Dashboard

- [ ] **Configure alerts**
  - High error rate
  - Deployment failures
  - Resource exhaustion

---

## Rollback Procedures

### Frontend Rollback

#### Via kubectl

```bash
# View rollout history
kubectl rollout history deployment/a4c-frontend

# Rollback to previous version
kubectl rollout undo deployment/a4c-frontend

# Rollback to specific revision
kubectl rollout undo deployment/a4c-frontend --to-revision=<revision>

# Wait for rollback
kubectl rollout status deployment/a4c-frontend

# Verify application
curl https://a4c.firstovertheline.com/
```

#### Via GitHub Actions

1. Revert the problematic commit:
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. GitHub Actions will automatically deploy the reverted version

### Workflows Rollback

#### Via kubectl

```bash
# View rollout history
kubectl rollout history deployment/workflow-worker -n temporal

# Rollback to previous version
kubectl rollout undo deployment/workflow-worker -n temporal

# Wait for rollback
kubectl rollout status deployment/workflow-worker -n temporal

# Verify workers
kubectl logs -n temporal -l app=workflow-worker --tail=50
```

#### Via GitHub Actions

Same as frontend: revert commit and push

### Database Rollback

**⚠️ Warning**: Database rollback is **complex** and should be done carefully.

#### Forward-Only Migrations (Recommended)

1. Create a new migration that reverses the problematic change
2. Test thoroughly in development
3. Deploy the reverse migration

#### Emergency Rollback (Last Resort)

1. **Restore from backup**
   ```bash
   # Get backup from Supabase Dashboard
   # → Settings → Backups → Restore
   ```

2. **Re-apply migrations up to the working point**
   ```bash
   # Manually apply migrations in order
   for file in 00-extensions/**/*.sql 01-events/**/*.sql 02-tables/**/*.sql; do
     psql -h "$DB_HOST" -U postgres -d postgres -f "$file"
   done
   ```

3. **Verify data integrity**
   ```sql
   SELECT COUNT(*) FROM organizations;
   SELECT COUNT(*) FROM domain_events;
   ```

---

## Troubleshooting

### Common Issues

#### Issue: GitHub Actions workflow fails at "Create production environment file"

**Symptoms**:
- Build fails with: "❌ VITE_SUPABASE_URL secret is not set"

**Solution**:
1. Go to: `https://github.com/Analytics4Change/A4C-AppSuite/settings/secrets/actions`
2. Check secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` exist
3. Re-run failed workflow

---

#### Issue: Frontend shows blank page

**Symptoms**:
- Browser shows white page
- Console error: "Supabase configuration missing"

**Solution**:
1. Check build logs for environment variable injection
2. Verify GitHub Secrets are set correctly
3. SSH to a frontend pod and check environment:
   ```bash
   kubectl exec -it <pod-name> -- sh
   cat /usr/share/nginx/html/assets/*.js | grep -o "tmrjlswbsxmbglmaclxu"
   # Should find the Supabase project ID
   ```
4. If not found, rebuild with correct secrets

---

#### Issue: Temporal workers not starting

**Symptoms**:
- Pods in CrashLoopBackOff
- Logs show: "Missing required environment variable"

**Solution**:
1. Check secret exists:
   ```bash
   kubectl get secret workflow-worker-secrets -n temporal
   ```
2. Verify secret has correct keys:
   ```bash
   kubectl get secret workflow-worker-secrets -n temporal -o yaml
   # Should have: SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_API_TOKEN, RESEND_API_KEY
   ```
3. Recreate secret if needed (see Prerequisites)

---

#### Issue: Database migration fails

**Symptoms**:
- GitHub Actions migration step fails
- Error: "relation already exists"

**Solution**:
1. Check idempotency:
   ```bash
   cd infrastructure/supabase
   ./audit-idempotency.sh
   ```
2. Add `IF NOT EXISTS` or `OR REPLACE` to migration
3. Re-run migration workflow

---

#### Issue: Workers can't connect to Temporal

**Symptoms**:
- Worker logs: "Connection refused"
- Workflows don't execute

**Solution**:
1. Check Temporal cluster is running:
   ```bash
   kubectl get pods -n temporal
   # All Temporal pods should be Running
   ```
2. Check worker ConfigMap has correct address:
   ```bash
   kubectl get configmap workflow-worker-config -n temporal -o yaml
   # TEMPORAL_ADDRESS should be: temporal-frontend.temporal.svc.cluster.local:7233
   ```
3. Test connectivity:
   ```bash
   kubectl exec -n temporal <worker-pod> -- \
     nc -zv temporal-frontend.temporal.svc.cluster.local 7233
   ```

---

#### Issue: Authentication fails

**Symptoms**:
- Login button doesn't work
- OAuth redirect fails
- JWT token invalid

**Solution**:
1. Check Supabase Auth configuration:
   - Go to: Supabase Dashboard → Authentication → Providers
   - Verify OAuth providers are enabled (Google, GitHub)
   - Check redirect URLs are correct

2. Check frontend is using production mode:
   ```bash
   # In browser console:
   console.log(import.meta.env.VITE_APP_MODE)
   # Should be: "production"
   ```

3. Verify JWT custom claims:
   - Go to: Supabase Dashboard → Database → Functions
   - Check `custom_access_token_hook` function exists
   - Test JWT at jwt.io (should have `org_id`, `user_role`, etc.)

---

### Emergency Contacts

- **Infrastructure Issues**: Check `infrastructure/CLAUDE.md`
- **Frontend Issues**: Check `frontend/CLAUDE.md`
- **Workflows Issues**: Check `workflows/README.md`
- **Supabase Issues**: Supabase Dashboard → Support

---

## Appendix: Quick Command Reference

### Frontend

```bash
# Check deployment status
kubectl get deployment a4c-frontend
kubectl get pods -l app=a4c-frontend

# View logs
kubectl logs -l app=a4c-frontend --tail=100 -f

# Rollback
kubectl rollout undo deployment/a4c-frontend

# Test application
curl https://a4c.firstovertheline.com/
```

### Workflows

```bash
# Check deployment status
kubectl get deployment workflow-worker -n temporal
kubectl get pods -n temporal -l app=workflow-worker

# View logs
kubectl logs -n temporal -l app=workflow-worker --tail=100 -f

# Rollback
kubectl rollout undo deployment/workflow-worker -n temporal

# Port-forward Temporal Web
kubectl port-forward -n temporal svc/temporal-web 8080:8080
```

### Database

```bash
# Connect to database
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-key"
export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
DB_HOST="db.${PROJECT_REF}.supabase.co"

psql -h "$DB_HOST" -U postgres -d postgres

# Check migrations
SELECT * FROM _migrations_applied ORDER BY applied_at DESC LIMIT 10;

# Check domain events
SELECT event_type, COUNT(*) FROM domain_events GROUP BY event_type;

# Check projections
SELECT * FROM organizations_projection LIMIT 10;
```

---

**For complete environment variable reference**: See `docs/ENVIRONMENT_VARIABLES.md`
