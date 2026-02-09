# A4C Workflows

Temporal.io workflows for A4C organization management, DNS provisioning, and user invitations.

## Overview

This package implements durable, fault-tolerant workflows using Temporal.io for:
- Organization onboarding and provisioning
- DNS record management (Cloudflare)
- User invitation and notification
- Event-driven projections (CQRS)

## Architecture

### Design Patterns
- **Workflow-First**: Temporal workflows orchestrate all business logic
- **CQRS/Event Sourcing**: Domain events drive read model projections
- **Three-Layer Idempotency**: Workflow ID, activity check-then-act, event deduplication
- **Saga Pattern**: Compensation activities for rollback on failure
- **Provider Pattern**: Pluggable DNS and email providers

### Directory Structure
```
workflows/
├── src/
│   ├── workflows/               # Temporal workflow definitions
│   │   └── organization-bootstrap/
│   │       └── workflow.ts      # Main organization workflow
│   ├── activities/              # Side effects (API calls, events)
│   │   └── organization-bootstrap/
│   │       ├── create-organization.ts
│   │       ├── configure-dns.ts
│   │       ├── verify-dns.ts
│   │       ├── generate-invitations.ts
│   │       ├── send-invitation-emails.ts
│   │       ├── emit-bootstrap-completed.ts
│   │       ├── emit-bootstrap-failed.ts
│   │       ├── remove-dns.ts        # Compensation
│   │       └── deactivate-organization.ts  # Compensation (safety net)
│   ├── shared/                  # Shared utilities and types
│   │   ├── config/              # Configuration validation
│   │   ├── providers/           # DNS and email providers
│   │   │   ├── dns/
│   │   │   │   ├── cloudflare-provider.ts
│   │   │   │   ├── mock-provider.ts
│   │   │   │   ├── logging-provider.ts
│   │   │   │   └── factory.ts
│   │   │   └── email/
│   │   │       ├── resend-provider.ts
│   │   │       ├── smtp-provider.ts
│   │   │       ├── mock-provider.ts
│   │   │       ├── logging-provider.ts
│   │   │       └── factory.ts
│   │   ├── types/               # TypeScript interfaces
│   │   └── utils/               # Supabase client, event emitter
│   ├── worker/                  # Worker entry point
│   │   └── index.ts
│   └── scripts/                 # Utility scripts
│       ├── cleanup-dev.ts       # Delete dev entities
│       └── query-dev.ts         # Query dev entities
├── .env.example                 # Configuration documentation
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration

### Primary Configuration Variable

Set `WORKFLOW_MODE` to control default behavior for all providers:

| Mode | DNS Provider | Email Provider | Use Case |
|------|--------------|----------------|----------|
| `mock` | MockDNS | MockEmail | Unit tests, CI/CD |
| `development` | LoggingDNS | LoggingEmail | Local dev (console logs) |
| `production` | Cloudflare | Resend | Integration testing, production |

### Configuration Examples

**1. Local Development (default)**
```bash
WORKFLOW_MODE=development
# → Console logs only, no real resources created
```

**2. Test DNS Only**
```bash
WORKFLOW_MODE=development
DNS_PROVIDER=cloudflare
CLOUDFLARE_API_TOKEN=your-token
# → Creates real DNS, logs emails to console
```

**3. Full Integration Test**
```bash
WORKFLOW_MODE=production
CLOUDFLARE_API_TOKEN=your-token
RESEND_API_KEY=your-key
# → Creates real DNS and sends real emails
```

**4. Unit Tests / CI**
```bash
WORKFLOW_MODE=mock
# → In-memory mocks, no output, fast execution
```

See `.env.example` for comprehensive configuration documentation.

## Getting Started

### Prerequisites
- Node.js 20+
- Temporal server running (local or cluster)
- Supabase project with configured database

### Installation
```bash
npm install
```

### Development
```bash
# Start worker in development mode (with auto-reload)
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Run tests with coverage
npm test:coverage

# Lint code
npm run lint
```

### Running the Worker

**Local Development (with port-forward):**
```bash
# Terminal 1: Port-forward Temporal
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Terminal 2: Run worker
TEMPORAL_ADDRESS=localhost:7233 npm run dev
```

**Production (Kubernetes):**
```bash
# Worker runs as deployment in k8s cluster
# See k8s/temporal/worker-deployment.yaml
```

## Development Entity Tracking

### Tags System
All entities created by workflows can be tagged for easy identification and cleanup:

```typescript
// Environment configuration
TAG_DEV_ENTITIES=true  // Enable tagging
WORKFLOW_MODE=development  // Sets tag: 'mode:development'

// Resulting tags
['development', 'mode:development', 'created:2025-11-02']
```

### Cleanup Scripts

**Query development entities:**
```bash
npm run query:dev
```

**Delete development entities:**
```bash
npm run cleanup:dev
```

**Manual cleanup:**
```sql
-- Find all dev entities
SELECT * FROM organizations_projection WHERE 'development' = ANY(tags);
SELECT * FROM invitations_projection WHERE 'development' = ANY(tags);

-- Delete dev entities (soft delete)
UPDATE organizations_projection
SET deleted_at = NOW(), status = 'deleted'
WHERE 'development' = ANY(tags);
```

## Testing

### Unit Tests
```bash
npm test
```

Tests use mock providers for fast, isolated testing:
- `WORKFLOW_MODE=mock`
- No network calls
- In-memory storage
- Deterministic behavior

### Integration Tests
```bash
# Set production mode with real credentials
export WORKFLOW_MODE=production
export CLOUDFLARE_API_TOKEN=your-token
export RESEND_API_KEY=your-key

npm test -- --testPathPattern=integration
```

### Workflow Replay Tests
Temporal workflows are deterministic and can be replayed:
```typescript
// See src/__tests__/workflows/organization-bootstrap.test.ts
```

## Provider Implementations

### DNS Providers
- **CloudflareDNSProvider**: Production DNS (requires `CLOUDFLARE_API_TOKEN`)
- **MockDNSProvider**: In-memory testing (instant, no output)
- **LoggingDNSProvider**: Console logging (shows DNS operations)

### Email Providers
- **ResendEmailProvider**: Production email (requires `RESEND_API_KEY`)
- **SMTPEmailProvider**: Traditional SMTP (requires `SMTP_*` vars)
- **MockEmailProvider**: In-memory testing
- **LoggingEmailProvider**: Console logging (shows email content)

## Deployment

### Quick Start

**1. Build Docker Image (Automatic via GitHub Actions)**
```bash
# GitHub Actions automatically builds and pushes on:
# - Push to main branch
# - Push tags (v*)
# - Changes to workflows/ directory

# Image is pushed to: ghcr.io/analytics4change/a4c-workflows:latest
```

**2. Configure Kubernetes Secrets**
```bash
# Copy secret template
cd infrastructure/k8s/temporal
cp worker-secret.yaml.example worker-secret.yaml

# Edit with real credentials
vim worker-secret.yaml

# Apply secret
kubectl apply -f worker-secret.yaml
```

**3. Deploy Worker**
```bash
# Apply ConfigMap and Deployment
kubectl apply -f infrastructure/k8s/temporal/worker-configmap.yaml
kubectl apply -f infrastructure/k8s/temporal/worker-deployment.yaml

# Verify deployment
kubectl get pods -n temporal -l app=workflow-worker
kubectl logs -n temporal -l app=workflow-worker --tail=100
```

### Manual Docker Build

If you need to build locally:
```bash
# Build image
cd workflows
docker build -t ghcr.io/analytics4change/a4c-workflows:latest .

# Test locally
docker run --rm \
  -e TEMPORAL_ADDRESS=host.docker.internal:7233 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-key \
  ghcr.io/analytics4change/a4c-workflows:latest

# Push to registry
docker push ghcr.io/analytics4change/a4c-workflows:latest
```

### Environment Configuration

**ConfigMap** (`worker-configmap.yaml`):
```yaml
# Non-sensitive configuration
WORKFLOW_MODE: production
TEMPORAL_ADDRESS: temporal-frontend.temporal.svc.cluster.local:7233
TEMPORAL_NAMESPACE: default
TEMPORAL_TASK_QUEUE: bootstrap
SUPABASE_URL: https://your-project.supabase.co
TAG_DEV_ENTITIES: "false"
NODE_ENV: production
HEALTH_CHECK_PORT: "9090"
```

**Secret** (`worker-secret.yaml`):
```yaml
# Sensitive credentials (base64 encoded)
SUPABASE_SERVICE_ROLE_KEY: <base64>
CLOUDFLARE_API_TOKEN: <base64>
RESEND_API_KEY: <base64>
```

### Health Checks

**Check worker health:**
```bash
# Port-forward to worker pod
kubectl port-forward -n temporal deploy/workflow-worker 9090:9090

# Check liveness
curl http://localhost:9090/health

# Check readiness
curl http://localhost:9090/ready
```

**Example responses:**
```json
// /health (liveness)
{
  "status": "ok",
  "timestamp": "2025-11-02T15:30:00.000Z"
}

// /ready (readiness)
{
  "status": "ready",
  "worker": "running",
  "temporal": "connected",
  "timestamp": "2025-11-02T15:30:00.000Z"
}
```

### Deployment Verification

**1. Check pod status:**
```bash
kubectl get pods -n temporal -l app=workflow-worker
# Should show 3/3 pods running

kubectl describe pod -n temporal -l app=workflow-worker
# Check events for any issues
```

**2. Check worker logs:**
```bash
# View recent logs
kubectl logs -n temporal -l app=workflow-worker --tail=100

# Follow logs
kubectl logs -n temporal -l app=workflow-worker -f

# Look for:
# ✅ Worker is running and ready to process workflows
# ✅ Connected to Temporal
# ✅ Health check server listening
```

**3. Test workflow execution:**
```bash
# Port-forward Temporal
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Run example workflow
cd workflows
npm run trigger-workflow
```

### Scaling

**Manual scaling:**
```bash
kubectl scale deployment workflow-worker -n temporal --replicas=5
```

**Auto-scaling (CPU-based):**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: workflow-worker-hpa
  namespace: temporal
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: workflow-worker
  minReplicas: 1  # Development: 1 replica (2-vCPU constraint); Production: 3+ replicas
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Rolling Updates

**Update to new image version:**
```bash
# GitHub Actions builds automatically on push

# Or manually update image
kubectl set image deployment/workflow-worker \
  worker=ghcr.io/analytics4change/a4c-workflows:v1.2.0 \
  -n temporal

# Monitor rollout
kubectl rollout status deployment/workflow-worker -n temporal

# Rollback if needed
kubectl rollout undo deployment/workflow-worker -n temporal
```

### Production Checklist

- ✅ Secrets configured with real credentials
- ✅ `WORKFLOW_MODE=production` in ConfigMap
- ✅ `TAG_DEV_ENTITIES=false` in ConfigMap
- ✅ Resource limits set appropriately
- ✅ Health checks responding
- ✅ 3+ replicas for high availability (production cluster); 1 replica for development (2-vCPU k3s constraint)
- ✅ Temporal server accessible
- ✅ Supabase connection verified
- ✅ DNS provider credentials valid (Cloudflare)
- ✅ Email provider credentials valid (Resend)
- ✅ Monitoring/logging configured

## Troubleshooting

### Configuration Validation
Worker validates configuration on startup and shows clear error messages:
```bash
npm run worker
# ========================================
# Configuration Validation
# ========================================
# ❌ Configuration has errors:
#    • Missing required environment variable: SUPABASE_URL
#    • DNS_PROVIDER=cloudflare requires CLOUDFLARE_API_TOKEN
```

### Common Issues

**1. Missing Temporal Server**
```
Error: temporal.api.errordetails.v1.ResourceExhausted: client rate limit exceeded
```
Solution: Ensure Temporal server is running and accessible

**2. Invalid DNS Credentials**
```
Error: Cloudflare API error: 403 Forbidden
```
Solution: Verify `CLOUDFLARE_API_TOKEN` has Zone:Read and DNS:Edit permissions

**3. Database Connection**
```
Error: Failed to emit event: connect ECONNREFUSED
```
Solution: Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

## Resources

- [Temporal.io Documentation](https://docs.temporal.io)
- [Cloudflare DNS API](https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records)
- [Resend Email API](https://resend.com/docs/api-reference/emails/send-email)
- [A4C Infrastructure Documentation](../infrastructure/README.md)

## Support

For issues or questions:
1. Check configuration with `npm run worker` (validates on startup)
2. Review logs for detailed error messages
3. Test configuration with mock mode first
4. Consult `.env.example` for valid combinations
