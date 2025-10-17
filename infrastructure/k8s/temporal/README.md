# Temporal Deployment on k3s

This directory contains Kubernetes manifests for deploying Temporal to the existing k3s cluster at `192.168.122.42`.

## Architecture

- **Temporal Server**: Workflow orchestration engine
- **Temporal UI**: Web interface for monitoring workflows (port 8080)
- **Temporal Worker**: Executes activities (Cloudflare DNS, Zitadel API calls)
- **PostgreSQL**: Persistence layer (can reuse existing Supabase PostgreSQL or deploy dedicated instance)

## Deployment

### Prerequisites

1. k3s cluster running and accessible
2. `kubectl` configured to access the cluster
3. Cloudflare API credentials
4. Zitadel service account credentials
5. Supabase service role key

### Step 1: Create Namespace

```bash
kubectl apply -f namespace.yaml
```

### Step 2: Create Secrets

```bash
# Copy secrets-template.yaml to secrets.yaml
cp secrets-template.yaml secrets.yaml

# Edit secrets.yaml with actual credentials (git-crypted)
# Fill in:
# - CLOUDFLARE_API_TOKEN
# - CLOUDFLARE_ZONE_ID
# - ZITADEL_API_URL
# - ZITADEL_SERVICE_TOKEN
# - SUPABASE_URL
# - SUPABASE_SERVICE_ROLE_KEY

kubectl apply -f secrets.yaml
```

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

Configured via `secrets.yaml` (git-crypted):
- Cloudflare API credentials
- Zitadel service account
- Supabase connection details

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
