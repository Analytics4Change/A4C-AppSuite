# Temporal Deployment on k3s

**Status**: ✅ Deployed (2025-10-17, 6+ days uptime)
**Cluster**: k3s at `192.168.122.42`
**Workers**: Node.js application containers executing organization bootstrap workflows

This directory contains Kubernetes manifests for deploying Temporal to the existing k3s cluster.

## Architecture

- **Temporal Server**: Workflow orchestration engine (gRPC on port 7233)
- **Temporal Web UI**: Web interface for monitoring workflows (HTTP on port 8080)
- **Temporal Worker**: Node.js application executing activities
  - Organization creation (emits events to Supabase)
  - DNS provisioning (Cloudflare API)
  - User invitation generation (secure tokens)
  - Email delivery (SMTP/transactional API)
- **PostgreSQL**: Persistence layer for Temporal state (dedicated instance)

## Deployment

### Prerequisites

1. k3s cluster running and accessible
2. `kubectl` configured to access the cluster
3. Cloudflare API credentials (for DNS provisioning)
4. Supabase service role key (for event emission and database operations)
5. SMTP credentials (for user invitation emails)

### Step 1: Create Namespace

```bash
kubectl apply -f namespace.yaml
```

### Step 2: Create Secrets

**IMPORTANT**: Never commit `secrets.yaml` to git! It's already in `.gitignore`.

```bash
# Copy template
cp secrets-template.yaml secrets.yaml

# Edit secrets.yaml with actual credentials
# Fill in:
# - CLOUDFLARE_API_TOKEN (from Cloudflare dashboard)
# - CLOUDFLARE_ZONE_ID (optional, can query by domain)
# - SUPABASE_URL (e.g., https://your-project.supabase.co)
# - SUPABASE_SERVICE_ROLE_KEY (from Supabase dashboard - has elevated permissions)
# - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (for email delivery)

# Apply to cluster
kubectl apply -f secrets.yaml

# Verify secret was created
kubectl get secret -n temporal temporal-worker-secrets
```

**Security Best Practices**:
- ✅ `secrets.yaml` is in `.gitignore` (never committed)
- ✅ Use `secrets-template.yaml` for documentation only
- ✅ Store actual secrets in password manager or sealed secrets
- ✅ Rotate credentials regularly
- ✅ Use RBAC to limit secret access in cluster

### Step 3: Create ConfigMaps

```bash
# Development environment
kubectl apply -f configmap-dev.yaml

# Production environment (when ready)
# kubectl apply -f configmap-prod.yaml
```

### Step 4: Deploy Temporal using Helm (Recommended)

```bash
# Add Temporal Helm repository
helm repo add temporalio https://go.temporal.io/helm-charts
helm repo update

# Install Temporal
helm install temporal temporalio/temporal \
  --namespace temporal \
  --values values.yaml \
  --wait
```

### Step 5: Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n temporal

# Expected output:
# temporal-server-xxx        Running
# temporal-worker-xxx        Running
# temporal-ui-xxx           Running
# temporal-postgresql-xxx   Running (if using dedicated DB)
```

### Step 6: Access Temporal UI

```bash
# Port forward to access UI locally
kubectl port-forward -n temporal svc/temporal-ui 8080:8080

# Open browser to http://localhost:8080
```

### Step 7: Deploy Worker

```bash
# Build worker Docker image
cd ../../temporal
docker build -t a4c-temporal-worker:latest .

# Load image into k3s (if using local registry)
# OR push to your container registry

# Deploy worker
kubectl apply -f worker-deployment.yaml
```

## Configuration

### Environment Variables

Configured via `configmap-dev.yaml`:
- `BASE_DOMAIN`: `firstovertheline.com` (dev) or `analytics4change.com` (prod)
- `APP_URL`: Main application URL
- `TEMPORAL_ADDRESS`: Temporal server address (usually `temporal-frontend.temporal.svc.cluster.local:7233`)

### Secrets

Configured via `secrets.yaml` (git-ignored, never committed):
- **Cloudflare API**: DNS provisioning credentials
- **Supabase**: Service role key for event emission and database operations
- **SMTP**: Email delivery credentials for user invitations

## Monitoring

### Temporal UI

Access at `http://localhost:8080` (after port-forward) to view:
- Running workflows
- Workflow history
- Activity execution status
- Error details

### Logs

```bash
# Server logs
kubectl logs -n temporal -l app=temporal-server

# Worker logs
kubectl logs -n temporal -l app=temporal-worker

# UI logs
kubectl logs -n temporal -l app=temporal-ui
```

## Troubleshooting

### Pods not starting

```bash
kubectl describe pod -n temporal <pod-name>
kubectl logs -n temporal <pod-name>
```

### Worker can't connect to Temporal

Check `TEMPORAL_ADDRESS` in worker deployment points to correct service.

### Database connection issues

Verify PostgreSQL credentials in secrets and connectivity from cluster.

## Cleanup

```bash
# Remove Temporal deployment
helm uninstall temporal -n temporal

# Delete namespace (removes all resources)
kubectl delete namespace temporal
```

## Cost

**Running on existing k3s cluster:** $0

Resources:
- Temporal Server: ~512MB RAM
- Temporal Worker: ~256MB RAM
- Temporal UI: ~256MB RAM
- PostgreSQL (if dedicated): ~512MB RAM

Total: ~1.5GB RAM on existing cluster
