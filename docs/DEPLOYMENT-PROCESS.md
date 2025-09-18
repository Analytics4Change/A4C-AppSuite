# A4C-FrontEnd Automated Deployment Process

This document explains how the automated CI/CD pipeline works for the A4C-FrontEnd React application.

## Architecture Overview

```
GitHub Repository → GitHub Actions → GitHub Container Registry → k3s Cluster → Cloudflare Tunnel → Public Internet
```

## Detailed Flow

### 1. Trigger (Developer Action)
```bash
git push origin main
```

### 2. GitHub Actions Workflow

#### Build Job (~2-3 minutes)
1. **Checkout code** from repository
2. **Authenticate** using GitHub App token
3. **Setup Node.js 20** with npm cache
4. **Install dependencies** (`npm ci`)
5. **Run tests** (if any exist)
6. **Build React app** (`npm run build`)
7. **Setup Docker Buildx** for multi-platform builds
8. **Login to GHCR** using GitHub App token
9. **Build container image** with multi-stage Dockerfile
10. **Push to registry** (`ghcr.io/lars-tice/a4c-frontend`)

#### Deploy Job (~1-2 minutes)
1. **Authenticate** using GitHub App token
2. **Setup kubectl** with k3s cluster access
3. **Create image pull secret** for private registry
4. **Update deployment** with new container image
5. **Wait for rollout** to complete (rolling update)
6. **Verify deployment** (pods, service, ingress)
7. **Health check** application endpoint
8. **Report status** (success/failure)

### 3. Container Registry
- **Registry**: GitHub Container Registry (`ghcr.io`)
- **Image naming**: `ghcr.io/lars-tice/a4c-frontend:latest`
- **Tagging strategy**:
  - `latest` - Most recent main branch
  - `main-<sha>` - Specific commit SHA
  - `main` - Main branch latest

### 4. Kubernetes Deployment

#### Rolling Update Strategy
- **Max unavailable**: 1 pod
- **Max surge**: 1 pod
- **Zero downtime**: Always maintain service availability

#### Container Configuration
- **Base image**: nginx:alpine
- **Resources**: 128Mi RAM, 100m CPU (requests)
- **Replicas**: 2 pods for high availability
- **Health checks**: Startup, liveness, readiness probes

#### Networking
- **Service**: ClusterIP on port 80
- **Ingress**: Traefik with SSL termination
- **Domain**: a4c.firstovertheline.com
- **SSL**: Let's Encrypt automatic certificates

### 5. External Access
- **Cloudflare Tunnel**: Secure connection without port forwarding
- **CDN**: Global content delivery network
- **SSL**: End-to-end encryption
- **DDoS Protection**: Cloudflare security features

## Container Build Process

### Multi-Stage Dockerfile

#### Stage 1: Builder (node:20-alpine)
```dockerfile
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
```

#### Stage 2: Production (nginx:alpine)
```dockerfile
COPY --from=builder /app/dist /usr/share/nginx/html
# Configure nginx for SPA routing
# Add security headers
# Enable gzip compression
```

### Optimizations
- **Layer caching**: Package files copied first
- **Production build**: `npm ci --only=production`
- **Static assets**: Efficient nginx serving
- **Gzip compression**: Reduced transfer size
- **Security headers**: XSS, CSRF protection

## Deployment Security

### Authentication
- **GitHub App**: Scoped permissions, no personal tokens
- **Private registry**: Authenticated image pulls
- **k3s access**: Encrypted kubeconfig in secrets

### Network Security
- **Private cluster**: No direct internet access
- **Cloudflare proxy**: Hide origin server
- **SSL/TLS**: End-to-end encryption
- **Security headers**: Browser protection

### Container Security
- **Alpine base**: Minimal attack surface
- **Non-root user**: nginx runs as nginx user
- **Read-only filesystem**: Container immutability
- **Resource limits**: Prevent resource exhaustion

## Monitoring & Observability

### GitHub Actions
- **Workflow status**: Success/failure notifications
- **Build logs**: Detailed execution information
- **Deployment metrics**: Timing and resource usage

### Kubernetes
- **Pod status**: Ready/not ready states
- **Service endpoints**: Traffic routing health
- **Ingress status**: SSL certificate validity
- **Resource usage**: CPU/memory consumption

### Application
- **Health endpoints**: HTTP status checks
- **Response times**: Performance monitoring
- **Error rates**: Application stability

## Rollback Strategy

### Automatic Rollback
- **Health check failure**: Automatic rollback to previous version
- **Deployment timeout**: Rollback after 5 minutes
- **Pod crash loops**: Prevent infinite restart cycles

### Manual Rollback
```bash
# View deployment history
kubectl rollout history deployment/a4c-frontend

# Rollback to previous version
kubectl rollout undo deployment/a4c-frontend

# Rollback to specific revision
kubectl rollout undo deployment/a4c-frontend --to-revision=2
```

## Performance Characteristics

### Build Performance
- **Cache hit**: ~1 minute (Docker layers cached)
- **Cache miss**: ~3 minutes (full rebuild)
- **Parallel builds**: Multiple architectures if needed

### Deployment Performance
- **Rolling update**: ~30-60 seconds
- **Health checks**: ~30 seconds stabilization
- **DNS propagation**: Immediate (Cloudflare)

### Runtime Performance
- **Container startup**: ~5-10 seconds
- **nginx**: High-performance static serving
- **React SPA**: Client-side routing
- **CDN caching**: Global edge locations

## Troubleshooting Common Issues

### Build Failures
- **Node.js version**: Ensure Node 20 compatibility
- **Dependencies**: Check package-lock.json consistency
- **Tests**: Fix failing test cases

### Deployment Failures
- **kubectl access**: Verify kubeconfig secret
- **Image pull**: Check registry authentication
- **Resource limits**: Monitor cluster capacity

### Runtime Issues
- **Health checks**: Verify application starts correctly
- **nginx config**: Check static file serving
- **SSL certificates**: Ensure cert-manager working

## Future Enhancements

### Planned Improvements
- **Staging environment**: Separate staging branch
- **Database migrations**: Automated schema updates
- **Performance monitoring**: APM integration
- **Security scanning**: Container vulnerability checks

### Scaling Considerations
- **Multi-region**: Deploy to multiple clusters
- **Load balancing**: Advanced traffic management
- **Auto-scaling**: HPA based on metrics
- **Blue-green deployments**: Zero-risk deployments