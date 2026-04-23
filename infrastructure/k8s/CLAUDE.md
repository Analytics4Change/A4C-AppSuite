---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Rules for `infrastructure/k8s/` — kubectl commands for Temporal cluster + workers, ingress troubleshooting, RBAC for GitHub Actions, secret management. Manual deployment + rollback procedures live in the deployment runbook.

**When to read**:
- Working with Kubernetes manifests in this directory
- Troubleshooting a worker pod, ConfigMap, or Secret
- Adjusting RBAC for the `github-actions` service account
- Updating Helm values for the Temporal cluster

**Prerequisites**: kubectl configured for k3s cluster, basic Kubernetes concepts

**Key topics**: `kubernetes`, `k3s`, `temporal`, `workers`, `secrets`, `configmap`, `rbac`, `helm`

**Estimated read time**: 6 minutes
<!-- TL;DR-END -->

# Kubernetes Guidelines

This file governs `infrastructure/k8s/`. For full deployment + rollback procedures, see [Deployment Runbook](../../documentation/infrastructure/operations/deployment/deployment-runbook.md).

## Directory Structure

```
infrastructure/k8s/
├── rbac/                 # RBAC for GitHub Actions service account
│   └── README.md         # Permission scoping (default + temporal namespaces)
└── temporal/             # Temporal.io cluster and workers
    ├── values.yaml             # Helm configuration
    ├── configmap-dev.yaml      # Dev environment config
    ├── worker-deployment.yaml  # Temporal worker deployment
    ├── worker-configmap.yaml   # Worker environment config
    └── worker-secret.yaml.example  # Secret template (real file NOT committed)
```

## Common kubectl Commands

```bash
# Deploy Temporal workers
kubectl apply -f infrastructure/k8s/temporal/worker-deployment.yaml
kubectl rollout status deployment/workflow-worker -n temporal

# Port-forward to Temporal Web UI
kubectl port-forward -n temporal svc/temporal-web 8080:8080
# Open http://localhost:8080

# Check worker logs
kubectl logs -n temporal -l app=workflow-worker --tail=100 -f

# Check worker pods
kubectl get pods -n temporal -l app=workflow-worker

# Restart workers (rolling update)
kubectl rollout restart deployment/workflow-worker -n temporal
```

## Cluster Architecture

**k3s** (single-node Kubernetes distribution):
- Hosted on dedicated server with Cloudflare Tunnel
- API endpoint: `https://k8s.firstovertheline.com`
- Service account `github-actions` for CI/CD with namespace-scoped RBAC

**Temporal**:
- Cluster: `temporal` namespace, Helm-deployed with PostgreSQL backend
- Frontend: `temporal-frontend.temporal.svc.cluster.local:7233`
- Web UI: `temporal-web:8080` (port-forward to access)
- Namespace: `default` (workflows)
- Task queue: `bootstrap` (organization workflows)

**Frontend**:
- Deployed to `default` namespace
- Image: `ghcr.io/analytics4change/a4c-frontend:latest`
- Ingress: `https://a4c.firstovertheline.com/`

## Secrets Management

### Worker Secrets

Secrets file is **never committed** — use the `.example` template:

```bash
cp infrastructure/k8s/temporal/worker-secret.yaml.example \
   infrastructure/k8s/temporal/worker-secret.yaml

# Edit to set base64-encoded values, then apply:
kubectl apply -f infrastructure/k8s/temporal/worker-secret.yaml
```

### Required Secrets in `workflow-worker-secrets`

| Key | Source | Purpose |
|-----|--------|---------|
| `TEMPORAL_ADDRESS` | ConfigMap | `temporal-frontend.temporal.svc.cluster.local:7233` |
| `SUPABASE_URL` | ConfigMap | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Bypasses RLS for activities |
| `CLOUDFLARE_API_TOKEN` | Secret | DNS provisioning |
| `RESEND_API_KEY` | Secret | Primary email provider |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Secret (optional) | SMTP fallback |

### View Secrets

```bash
kubectl get secret workflow-worker-secrets -n temporal -o yaml
```

### Rotate a Secret (zero-downtime)

```bash
NEW_VALUE=$(echo -n "new-value" | base64)
kubectl patch secret workflow-worker-secrets -n temporal \
  -p "{\"data\":{\"<KEY>\":\"$NEW_VALUE\"}}"
kubectl rollout restart deployment/workflow-worker -n temporal
kubectl rollout status deployment/workflow-worker -n temporal --timeout=300s
```

For Resend specifically, see [Resend Key Rotation](../../documentation/infrastructure/operations/resend-key-rotation.md).

## RBAC for GitHub Actions

The `github-actions` service account is **namespace-scoped** (NOT cluster-admin):

- Access: `default` and `temporal` namespaces only
- Resources: see `infrastructure/k8s/rbac/README.md`
- Verify with:
  ```bash
  kubectl auth can-i create secrets --as=system:serviceaccount:default:github-actions -n default
  ```

## Common Issues

### Workers not connecting to Temporal cluster

```bash
# Check worker logs
kubectl logs -n temporal -l app=workflow-worker

# Verify ConfigMap
kubectl get configmap workflow-worker-config -n temporal -o yaml

# Check Temporal frontend service
kubectl get svc -n temporal temporal-frontend

# Test connectivity
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233
```

### Health checks failing

```bash
# Verify port 9090 exposed in Dockerfile
kubectl exec -n temporal <pod> -- curl localhost:9090/health
kubectl exec -n temporal <pod> -- curl localhost:9090/ready

# Check worker startup logs for errors
kubectl logs -n temporal <pod> --previous
```

### `kubectl cluster connection failed` from CI/CD

1. Check `KUBECONFIG` GitHub secret points to `https://k8s.firstovertheline.com`
2. Verify Cloudflare Tunnel: `ssh <k3s-host> 'sudo systemctl status cloudflared'`
3. Test connectivity locally: `./infrastructure/test-k8s-connectivity.sh`
4. See [KUBECONFIG Update Guide](../../documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md)

## Related Documentation

- [Infrastructure CLAUDE.md](../CLAUDE.md) — Component overview, navigation (parent)
- [Supabase CLAUDE.md](../supabase/CLAUDE.md) — Migrations, event handlers, AsyncAPI
- [Deployment Runbook](../../documentation/infrastructure/operations/deployment/deployment-runbook.md) — Manual deploy + rollback for all components
- [Disaster Recovery](../../documentation/infrastructure/operations/disaster-recovery.md) — Cluster failure recovery
- [KUBECONFIG Update Guide](../../documentation/infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md) — GitHub Actions cluster access
- [Resend Key Rotation](../../documentation/infrastructure/operations/resend-key-rotation.md) — Email provider key rotation
