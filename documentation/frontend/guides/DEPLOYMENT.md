# Deployment Guide

Comprehensive guide for deploying the A4C-FrontEnd application with automated CI/CD pipeline.

🌐 **Live Application**: [https://a4c.firstovertheline.com](https://a4c.firstovertheline.com)

## Architecture Overview

```
GitHub Repository → GitHub Actions → GitHub Container Registry → k3s Cluster → Cloudflare Tunnel → Public Internet
```

## Quick Deployment

For immediate deployment:

```bash
# Trigger deployment
git push origin main

# Monitor deployment
# Visit: https://github.com/Analytics4Change/A4C-FrontEnd/actions

# Verify deployment
curl -f https://a4c.firstovertheline.com/
```

## CI/CD Pipeline Setup

### Prerequisites

- ✅ GitHub repository with CI/CD pipeline
- ✅ k3s cluster with Cloudflare tunnel
- ✅ Domain `a4c.firstovertheline.com` configured
- ✅ Machine user authentication (`analytics4change-ghcr-bot`)

### Pipeline Components

#### Build Stage (~2-3 minutes)
1. **Node.js Setup**: Install dependencies with `npm ci`
2. **Type Checking**: Run `npm run typecheck`
3. **Build**: Generate production build with `npm run build`
4. **Container Build**: Multi-stage Docker build (Node.js → nginx)
5. **Registry Push**: Upload to GitHub Container Registry

#### Deploy Stage (~1-2 minutes)
1. **Kubernetes Setup**: Configure kubectl with cluster access
2. **Image Pull Secrets**: Create GHCR authentication
3. **Rolling Update**: Deploy new container with zero downtime
4. **Health Checks**: Verify application responsiveness
5. **Status Report**: Success/failure notification

### Container Build Process

**Multi-Stage Dockerfile**:
- **Stage 1 (Builder)**: Node.js 20 Alpine, build React app
- **Stage 2 (Production)**: nginx Alpine, serve static files

**Optimizations**:
- Layer caching for faster builds
- Gzip compression enabled
- Security headers configured
- SPA routing support

### Deployment Security

- **GitHub App Authentication**: Scoped permissions, no personal tokens
- **Private Container Registry**: Authenticated image pulls
- **Encrypted Secrets**: kubeconfig and tokens secured
- **Network Security**: Cloudflare proxy with SSL termination
- **Container Security**: Alpine base, non-root user, read-only filesystem

## Manual Deployment

For manual deployment or troubleshooting:

### Local Build and Push

```bash
# Build container locally
docker build -t ghcr.io/analytics4change/a4c-frontend:manual .

# Push to registry (requires authentication)
docker push ghcr.io/analytics4change/a4c-frontend:manual
```

### Direct Kubernetes Deployment

```bash
# Update deployment with new image
kubectl set image deployment/a4c-frontend container=ghcr.io/analytics4change/a4c-frontend:manual

# Monitor rollout
kubectl rollout status deployment/a4c-frontend --timeout=300s

# Verify deployment
kubectl get pods -l app=a4c-frontend
```

### Rollback Commands

```bash
# View deployment history
kubectl rollout history deployment/a4c-frontend

# Rollback to previous version
kubectl rollout undo deployment/a4c-frontend

# Rollback to specific revision
kubectl rollout undo deployment/a4c-frontend --to-revision=2
```

## Infrastructure Details

### Kubernetes Configuration

```yaml
# 2 replicas for high availability
replicas: 2

# Rolling update strategy
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 1

# Resource limits
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "200m"

# Health checks optimized for fast rollouts
readinessProbe:
  initialDelaySeconds: 3
  periodSeconds: 3
  timeoutSeconds: 2
  failureThreshold: 2
```

### Cloudflare Tunnel Configuration

```yaml
# /home/lars/.cloudflared/config.yml
ingress:
  - hostname: a4c.firstovertheline.com
    service: http://192.168.122.42:80
    originRequest:
      httpHostHeader: a4c.firstovertheline.com
```

### Container Registry

- **Registry**: GitHub Container Registry (ghcr.io)
- **Authentication**: Machine user with Classic PAT
- **Image Tags**: `latest`, `main-<sha>`, `main`
- **Rotation Schedule**: PAT rotated every 90 days (documented in GHCR_TOKEN_ROTATION.md)

## Monitoring and Troubleshooting

### Health Monitoring

```bash
# Check application health
curl -f https://a4c.firstovertheline.com/

# Check pod status
kubectl get pods -l app=a4c-frontend

# Check service endpoints
kubectl get endpoints a4c-frontend-service

# Check deployment status
kubectl describe deployment a4c-frontend
```

### Common Issues

**Build Failures**:
- Node.js version compatibility
- TypeScript compilation errors
- Dependency conflicts

**Deployment Failures**:
- kubectl authentication issues
- Image pull failures
- Resource constraints

**Runtime Issues**:
- Health check failures
- nginx configuration
- SSL certificate problems

### Performance Characteristics

- **Cache Hit Build**: ~1 minute
- **Cache Miss Build**: ~3 minutes
- **Rolling Update**: ~30-60 seconds
- **Health Stabilization**: ~30 seconds
- **Container Startup**: ~5-10 seconds

## Token Management

### Machine User PAT Rotation

The deployment uses a machine user (`analytics4change-ghcr-bot`) with a Classic GitHub PAT for GHCR authentication.

**Rotation Schedule**: Every 90 days
**Secret Name**: `GHCR_PULL_TOKEN`
**Documentation**: See `docs/GHCR_TOKEN_ROTATION.md`

### Required Secrets

| Secret Name | Description | Location |
|-------------|-------------|----------|
| `GHCR_PULL_TOKEN` | Machine user PAT for GHCR | GitHub Repository Secrets |
| `KUBECONFIG` | k3s cluster access | GitHub Repository Secrets |
| `APP_ID` | GitHub App ID | GitHub Repository Secrets |
| `APP_PRIVATE_KEY` | GitHub App private key | GitHub Repository Secrets |
| `INSTALLATION_ID` | GitHub App installation ID | GitHub Repository Secrets |

## Development Environments

### Cross-Platform Development

The application supports development across multiple environments:

- **Ubuntu 24.04** with Firefox
- **macOS** with Safari
- **Windows** with Chrome/Edge

### File Synchronization

**Tracked in Git**:
- Source code (`/src/**/*`)
- Configuration files (`package.json`, `vite.config.ts`, etc.)
- Documentation (`*.md`)
- Tests and E2E specs

**Not Tracked**:
- Dependencies (`node_modules/`)
- Build output (`dist/`)
- Cache files (`.vite/`)
- Test results (`test-results/`)
- Environment configs (`.env.local`)

### Best Practices

```bash
# Switching environments
git pull origin main
npm ci
rm -rf .vite
npm run dev

# Before committing
npm run typecheck
npm run lint
npm run test:e2e
git status
```

## Future Enhancements

### Planned Improvements
- **Staging Environment**: Separate staging branch deployments
- **Performance Monitoring**: APM integration
- **Security Scanning**: Container vulnerability checks
- **Multi-Region**: Deploy to multiple clusters

### Scaling Considerations
- **Auto-scaling**: HPA based on CPU/memory metrics
- **Load Balancing**: Advanced traffic management
- **Blue-Green Deployments**: Zero-risk deployment strategy
- **Database Integration**: When backend services are added