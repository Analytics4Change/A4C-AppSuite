# Temporal Workflows - A4C Platform

This directory contains Temporal workflows, activities, and workers for the A4C (Analytics4Change) platform.

## Overview

Temporal orchestrates durable, long-running workflows for organization onboarding, including:
- Organization record creation (via event emission)
- DNS subdomain propagation (Cloudflare API)
- User invitation generation and delivery
- Comprehensive error handling and compensation

## Project Structure

```
temporal/
├── src/
│   ├── workflows/        # Workflow definitions (durable orchestration)
│   ├── activities/       # Activity implementations (side effects, API calls)
│   ├── workers/          # Worker startup and configuration
│   ├── shared/           # Shared types and utilities
│   └── tests/            # Workflow replay tests
├── package.json
├── tsconfig.json
├── Dockerfile            # Worker container image
└── CLAUDE.md             # Development guidance
```

## Connection Information

The workers connect to the operational Temporal cluster:

```
Temporal Frontend: temporal-frontend.temporal.svc.cluster.local:7233
Namespace: default
Task Queue: bootstrap
Web UI: temporal-web:8080 (kubectl port-forward)
```

## Local Development

### Prerequisites
- Node.js 20+
- kubectl configured for k3s cluster access
- Port-forward to Temporal server

### Setup

```bash
# Install dependencies
npm install

# Start development (watch mode)
npm run dev
```

### Run Worker Locally

```bash
# Port-forward Temporal frontend
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233

# Run worker (connects to localhost:7233)
TEMPORAL_ADDRESS=localhost:7233 npm run worker
```

### Testing

```bash
# Run tests (includes workflow replay tests)
npm test
```

## Deployment

### Build Worker Image

```bash
npm run build
docker build -t a4c-temporal-worker:v1.0.0 .
docker push registry/a4c-temporal-worker:v1.0.0
```

### Deploy to Kubernetes

```bash
cd ../infrastructure/k8s/temporal
kubectl apply -f worker-deployment.yaml
```

The worker deployment references the Docker image built from this directory.

## Architecture

### Event-Driven Activities

All activities emit domain events to maintain the event-driven architecture:

- **Activities**: Perform side effects (API calls, database operations)
- **Events**: Emitted to Supabase `domain_events` table
- **Projections**: Updated by event processors

### Workflow-First Approach

Workflows orchestrate all steps. If any step fails, Temporal automatically:
- Retries with exponential backoff
- Executes compensation logic (Saga pattern)
- Maintains complete execution history

## Key Workflows

- **OrganizationBootstrapWorkflow**: Creates provider/partner organizations with DNS and invitations

## Documentation

- **Development Guide**: See `CLAUDE.md` in this directory
- **Architecture**: See `.plans/temporal-integration/` in repository root
- **Infrastructure**: See `infrastructure/k8s/temporal/README.md`

## Monitoring

Access Temporal Web UI to view workflow executions:

```bash
kubectl port-forward -n temporal svc/temporal-web 8080:8080
# Open http://localhost:8080
```
