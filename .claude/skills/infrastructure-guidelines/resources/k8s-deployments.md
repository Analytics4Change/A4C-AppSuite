# Kubernetes Deployments

Kubernetes deployment patterns for A4C-AppSuite Temporal workers. Covers deployment configuration, ConfigMaps, Secrets, resource limits, health checks, rolling updates, and troubleshooting.

## Deployment Structure

### Temporal Worker Deployment

```yaml
# File: infrastructure/k8s/temporal/worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workflow-worker
  namespace: temporal
  labels:
    app: workflow-worker
    component: temporal-worker
    version: v1
spec:
  replicas: 1
  selector:
    matchLabels:
      app: workflow-worker
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: workflow-worker
        component: temporal-worker
    spec:
      containers:
      - name: worker
        image: ghcr.io/analytics4change/a4c-workflows:latest
        imagePullPolicy: Always

        ports:
        - name: health
          containerPort: 9090
          protocol: TCP

        envFrom:
        - configMapRef:
            name: workflow-worker-config
        - secretRef:
            name: workflow-worker-secrets

        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"

        livenessProbe:
          httpGet:
            path: /health
            port: health
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3

        readinessProbe:
          httpGet:
            path: /ready
            port: health
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2

        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]

      terminationGracePeriodSeconds: 30
      imagePullSecrets:
      - name: ghcr-secret
      restartPolicy: Always
```

## ConfigMap Pattern

### Worker Configuration

```yaml
# File: infrastructure/k8s/temporal/configmap-dev.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: workflow-worker-config
  namespace: temporal
data:
  # Temporal connection
  TEMPORAL_ADDRESS: "temporal-frontend.temporal.svc.cluster.local:7233"
  TEMPORAL_NAMESPACE: "default"
  TEMPORAL_TASK_QUEUE: "bootstrap"

  # Logging
  LOG_LEVEL: "info"
  NODE_ENV: "development"

  # Application settings
  MAX_CONCURRENT_ACTIVITIES: "10"
  ACTIVITY_TIMEOUT_SECONDS: "300"
```

**Pattern**: Non-sensitive configuration in ConfigMaps, secrets in Secrets

### Applying ConfigMap

```bash
# Create or update ConfigMap
kubectl apply -f infrastructure/k8s/temporal/configmap-dev.yaml

# View ConfigMap
kubectl get configmap workflow-worker-config -n temporal -o yaml

# Delete ConfigMap (pods will fail without it)
kubectl delete configmap workflow-worker-config -n temporal
```

## Secrets Pattern

### Creating Secrets

```yaml
# File: infrastructure/k8s/temporal/secrets-template.yaml (template only, not committed)
apiVersion: v1
kind: Secret
metadata:
  name: workflow-worker-secrets
  namespace: temporal
type: Opaque
stringData:
  # Supabase
  SUPABASE_URL: "https://yourproject.supabase.co"
  SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key"

  # Cloudflare
  CLOUDFLARE_API_TOKEN: "your-cloudflare-token"

  # Email (SMTP)
  SMTP_HOST: "smtp.example.com"
  SMTP_PORT: "587"
  SMTP_USER: "your-smtp-user"
  SMTP_PASS: "your-smtp-password"
```

### Managing Secrets Securely

```bash
# Create secret from file (not in git)
kubectl create secret generic workflow-worker-secrets \
  --from-literal=SUPABASE_URL="https://..." \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY="..." \
  --from-literal=CLOUDFLARE_API_TOKEN="..." \
  -n temporal

# View secret (values are base64 encoded)
kubectl get secret workflow-worker-secrets -n temporal -o yaml

# Decode secret value
kubectl get secret workflow-worker-secrets -n temporal -o jsonpath='{.data.SUPABASE_URL}' | base64 --decode

# Update secret
kubectl create secret generic workflow-worker-secrets \
  --from-literal=SUPABASE_URL="https://..." \
  --dry-run=client -o yaml | kubectl apply -f -

# Delete secret
kubectl delete secret workflow-worker-secrets -n temporal
```

**Secret Best Practices**: Never commit to git, use separate secrets per environment, rotate regularly

## Resource Limits

### Setting Resource Requests and Limits

```yaml
resources:
  requests:
    memory: "512Mi"   # Guaranteed memory
    cpu: "500m"       # Guaranteed CPU (0.5 cores)
  limits:
    memory: "1Gi"     # Max memory (OOMKilled if exceeded)
    cpu: "1000m"      # Max CPU (1 core)
```

**Pattern**:
- **Requests**: Kubernetes uses this for scheduling (node must have this available)
- **Limits**: Hard cap - pod is throttled (CPU) or killed (memory) if exceeded

### Calculating Resource Needs

```bash
# Check current usage
kubectl top pod -n temporal -l app=workflow-worker

# If consistently near limits, increase; if well below, decrease
```

**Recommendations**: Dev: 256Mi/250m requests, 512Mi/500m limits. Prod: 1Gi/1CPU requests, 2Gi/2CPU limits.

## Health Checks

### Liveness Probe

Restarts container if probe fails repeatedly.

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: health
  initialDelaySeconds: 30    # Wait 30s after container starts
  periodSeconds: 10          # Check every 10s
  timeoutSeconds: 5          # 5s to respond
  failureThreshold: 3        # Restart after 3 failures
```

**Pattern**: Conservative settings to avoid restart loops during high load.

### Readiness Probe

Removes pod from service if not ready (doesn't receive traffic).

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: health
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

**Pattern**: Faster checks than liveness, since removing from traffic is less disruptive than restarting.

### Health Endpoint Implementation

Worker must expose health endpoints (Node.js/Express example):

```typescript
// In worker container
import express from 'express';

const app = express();
const PORT = 9090;

let isReady = false;

app.get('/health', (req, res) => {
  // Liveness: Is the process alive?
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', (req, res) => {
  // Readiness: Can it handle work?
  if (isReady) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready' });
  }
});

app.listen(PORT, () => {
  console.log(`Health server listening on :${PORT}`);
});

// Set ready after Temporal worker connects
temporalWorker.run().then(() => {
  isReady = true;
});
```

## Rolling Updates

### Update Strategy

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1           # Max 1 extra pod during update
    maxUnavailable: 0     # Min 0 pods unavailable (always 1+ running)
```

**Pattern**: Zero-downtime deployments - old pods stay running until new pods are ready.

### Performing Rolling Update

```bash
# Update image to new version
kubectl set image deployment/workflow-worker \
  worker=ghcr.io/analytics4change/a4c-workflows:v2.0.0 \
  -n temporal

# Watch rollout progress
kubectl rollout status deployment/workflow-worker -n temporal

# Check rollout history
kubectl rollout history deployment/workflow-worker -n temporal

# Rollback to previous version
kubectl rollout undo deployment/workflow-worker -n temporal

# Rollback to specific revision
kubectl rollout undo deployment/workflow-worker -n temporal --to-revision=2
```

### Graceful Shutdown

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 15"]

terminationGracePeriodSeconds: 30
```

**Pattern**:
1. Pod receives SIGTERM
2. preStop hook runs (sleep 15s to allow in-flight work to complete)
3. Container receives SIGTERM after preStop completes
4. After 30s total, SIGKILL if still running

Worker code should handle SIGTERM gracefully:

```typescript
// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await temporalWorker.shutdown();
  process.exit(0);
});
```

## Namespace Organization

### Temporal Namespace

```yaml
# Workers run in temporal namespace
metadata:
  namespace: temporal
```

### Creating Namespace

```bash
# Create namespace
kubectl create namespace temporal

# Label namespace
kubectl label namespace temporal app=temporal

# View namespace
kubectl describe namespace temporal
```

### RBAC for Namespace

```bash
# Service account for workers
kubectl create serviceaccount workflow-worker -n temporal

# Role with permissions
kubectl create role worker-role \
  --verb=get,list,watch \
  --resource=configmaps,secrets \
  -n temporal

# Bind role to service account
kubectl create rolebinding worker-rolebinding \
  --role=worker-role \
  --serviceaccount=temporal:workflow-worker \
  -n temporal
```

## Image Pull Secrets

### GitHub Container Registry Secret

```bash
# Create docker-registry secret for GHCR
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-pat> \
  --docker-email=<email> \
  -n temporal

# Use in deployment
spec:
  imagePullSecrets:
  - name: ghcr-secret
```

## Deployment Commands

### Basic Operations

```bash
# Apply deployment
kubectl apply -f infrastructure/k8s/temporal/worker-deployment.yaml

# View deployment
kubectl get deployment workflow-worker -n temporal

# View pods
kubectl get pods -n temporal -l app=workflow-worker

# View pod details
kubectl describe pod <pod-name> -n temporal

# View logs
kubectl logs -n temporal -l app=workflow-worker --tail=100 -f

# Scale deployment
kubectl scale deployment/workflow-worker --replicas=2 -n temporal

# Delete deployment
kubectl delete deployment workflow-worker -n temporal
```

### Troubleshooting

```bash
# Pod won't start - check events
kubectl describe pod <pod-name> -n temporal

# Check pod logs
kubectl logs <pod-name> -n temporal

# Check previous container logs (if crashlooping)
kubectl logs <pod-name> -n temporal --previous

# Exec into running container
kubectl exec -it <pod-name> -n temporal -- /bin/sh

# Check resource usage
kubectl top pod <pod-name> -n temporal

# Check if ConfigMap exists
kubectl get configmap workflow-worker-config -n temporal

# Check if Secret exists
kubectl get secret workflow-worker-secrets -n temporal
```

### Common Issues

**Issue**: `ImagePullBackOff`
```bash
# Solution: Check image pull secret
kubectl get secret ghcr-secret -n temporal
kubectl describe pod <pod-name> -n temporal  # Check events
```

**Issue**: `CrashLoopBackOff`
```bash
# Solution: Check logs for errors
kubectl logs <pod-name> -n temporal --previous
# Common causes: Missing env vars, can't connect to Temporal
```

**Issue**: `OOMKilled`
```bash
# Solution: Increase memory limits
# Edit deployment: spec.containers[0].resources.limits.memory
kubectl edit deployment workflow-worker -n temporal
```

**Issue**: Pod not receiving traffic (readiness probe failing)
```bash
# Solution: Check /ready endpoint
kubectl exec -it <pod-name> -n temporal -- curl localhost:9090/ready
# Fix readiness check in worker code
```

## Related Documentation

- [SKILL.md](../SKILL.md) - Infrastructure guidelines overview
- [infrastructure/CLAUDE.md](../../../infrastructure/CLAUDE.md) - Infrastructure component guidance
- [infrastructure/k8s/temporal/README.md](../../../infrastructure/k8s/temporal/README.md) - Temporal K8s setup
