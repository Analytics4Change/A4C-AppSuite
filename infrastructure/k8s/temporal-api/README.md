# Temporal API Kubernetes Deployment

This directory contains Kubernetes manifests for deploying the Temporal Backend API service.

## Architecture

The Backend API service enables the frontend to trigger Temporal workflows from outside the Kubernetes cluster:

```
Frontend (Deno Deploy) → Backend API (k8s) → Temporal (k8s internal)
```

This 2-hop architecture solves the problem that Edge Functions cannot directly connect to Temporal's internal cluster DNS.

## Files

- `configmap.yaml` - Environment configuration (Temporal address, ports, CORS)
- `secrets.yaml.example` - Template for secrets (DO NOT commit actual secrets!)
- `deployment.yaml` - API deployment with 2 replicas for HA
- `service.yaml` - ClusterIP service exposing port 3000
- `ingress.yaml` - Traefik ingress for external access via HTTPS
- `README.md` - This file

## Prerequisites

1. **Temporal cluster running** in the `temporal` namespace
2. **GitHub Container Registry access** (GHCR pull secret configured)
3. **Supabase credentials** (URL, service role key, anon key)
4. **Docker image built and pushed** to `ghcr.io/analytics4change/a4c-temporal-api:latest`

## Deployment Steps

### 1. Create Secrets

**Option A: From command line (recommended)**
```bash
kubectl create secret generic temporal-api-secrets \
  --namespace=temporal \
  --from-literal=SUPABASE_URL="https://your-project.supabase.co" \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  --from-literal=SUPABASE_ANON_KEY="your-anon-key"
```

**Option B: From YAML file**
```bash
# Copy the example file
cp secrets.yaml.example secrets.yaml

# Edit secrets.yaml with base64-encoded values
# To encode: echo -n "value" | base64
vim secrets.yaml

# Apply the secrets
kubectl apply -f secrets.yaml

# IMPORTANT: Do not commit secrets.yaml!
```

### 2. Apply ConfigMap
```bash
kubectl apply -f configmap.yaml
```

### 3. Deploy the API
```bash
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
```

### 4. Verify Deployment
```bash
# Check pods are running
kubectl get pods -n temporal -l app=temporal-api

# Check deployment status
kubectl rollout status deployment/temporal-api -n temporal

# Check logs
kubectl logs -n temporal -l app=temporal-api --tail=50

# Check service
kubectl get svc -n temporal temporal-api
```

### 5. Test Health Endpoints
```bash
# Port-forward to test locally
kubectl port-forward -n temporal svc/temporal-api 3000:3000

# Test health check (liveness)
curl http://localhost:3000/health
# Expected: {"status":"ok"}

# Test readiness check (includes Temporal connection)
curl http://localhost:3000/ready
# Expected: {"status":"ready","temporal":"connected"}
```

## Resource Specifications

**Deployment**:
- Replicas: 2 (high availability)
- Image: `ghcr.io/analytics4change/a4c-temporal-api:latest`
- Resources:
  - Requests: 128Mi memory, 50m CPU
  - Limits: 256Mi memory, 200m CPU

**Probes**:
- Liveness: `GET /health` every 30s
- Readiness: `GET /ready` every 10s
- Startup: `GET /health` every 5s (max 60s)

**Service**:
- Type: ClusterIP (internal only)
- Port: 3000
- Selector: `app=temporal-api`

## Updating the Deployment

### Update ConfigMap
```bash
# Edit configmap.yaml
vim configmap.yaml

# Apply changes
kubectl apply -f configmap.yaml

# Restart pods to pick up changes
kubectl rollout restart deployment/temporal-api -n temporal
```

### Update Secrets
```bash
# Delete old secret
kubectl delete secret temporal-api-secrets -n temporal

# Create new secret (use Option A or B from above)
kubectl create secret generic temporal-api-secrets ...

# Restart pods to pick up changes
kubectl rollout restart deployment/temporal-api -n temporal
```

### Update Deployment
```bash
# Edit deployment.yaml (e.g., change image tag)
vim deployment.yaml

# Apply changes
kubectl apply -f deployment.yaml

# Watch rollout
kubectl rollout status deployment/temporal-api -n temporal
```

## Scaling

**Manual scaling**:
```bash
# Scale to 3 replicas
kubectl scale deployment temporal-api -n temporal --replicas=3

# Verify
kubectl get pods -n temporal -l app=temporal-api
```

**Auto-scaling** (future):
Add HorizontalPodAutoscaler based on CPU/memory metrics.

## Troubleshooting

### Pods not starting
```bash
# Check pod status
kubectl describe pod -n temporal -l app=temporal-api

# Check events
kubectl get events -n temporal --sort-by='.lastTimestamp'

# Common issues:
# - Image pull errors: Check GHCR pull secret
# - Secret not found: Ensure temporal-api-secrets exists
# - ConfigMap not found: Apply configmap.yaml first
```

### Readiness probe failing
```bash
# Check logs
kubectl logs -n temporal -l app=temporal-api

# Common issues:
# - Cannot connect to Temporal: Check TEMPORAL_ADDRESS in configmap
# - Missing environment variables: Check secrets are applied
# - Supabase connection error: Verify SUPABASE_URL and keys
```

### High memory/CPU usage
```bash
# Check resource usage
kubectl top pods -n temporal -l app=temporal-api

# Adjust resource limits in deployment.yaml if needed
```

## Monitoring

**Logs**:
```bash
# Follow logs
kubectl logs -n temporal -l app=temporal-api -f

# Logs from specific pod
kubectl logs -n temporal temporal-api-<pod-id>
```

**Metrics** (if Prometheus enabled):
```bash
# Check if service is being scraped
kubectl get servicemonitor -n temporal

# Access metrics (add /metrics endpoint first)
curl http://localhost:3000/metrics
```

## Security

- Runs as non-root user (UID 1001)
- Read-only root filesystem (optional)
- Security context with dropped capabilities
- Secrets stored in Kubernetes Secrets
- Service role key has elevated permissions - keep secure!

## External Access

The API is exposed externally via:
- **URL**: `https://api-a4c.firstovertheline.com`
- **Ingress**: Traefik ingress controller
- **TLS**: Cloudflare handles TLS termination (Universal SSL covers `*.firstovertheline.com`)
- **Cloudflare Tunnel**: Routes traffic from Cloudflare edge to k8s cluster

**Note**: The hostname uses `api-a4c` (first-level subdomain) rather than `api.a4c` (nested subdomain) because Cloudflare Universal SSL only covers first-level wildcards.

### Verify External Access

```bash
# Check ingress status
kubectl get ingress -n temporal temporal-api-ingress

# Test external endpoint (after deployment)
curl https://api-a4c.firstovertheline.com/health
```

## Next Steps

After deployment:
1. ~~Configure Cloudflare Tunnel to expose `api.a4c.firstovertheline.com`~~ ✅ (uses existing wildcard rule)
2. Update frontend to call Backend API instead of Edge Function
3. Test end-to-end organization creation flow
4. Set up GitHub Actions CI/CD for automated deployments

## Related Documentation

- **Implementation Status**: `dev/active/backend-api-implementation-status.md`
- **API Code**: `workflows/src/api/`
- **Dockerfile**: `workflows/Dockerfile.api`
