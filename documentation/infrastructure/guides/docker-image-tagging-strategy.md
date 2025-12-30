---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Commit SHA-based Docker image tagging strategy that ensures automatic Kubernetes pod restarts, prevents stale cached builds, provides deployment traceability, and supports easy rollbacks. Replaces problematic `:latest` tag usage.

**When to read**:
- Setting up Docker CI/CD for new services
- Debugging pods not restarting after deployment
- Understanding image cache scoping strategy
- Rolling back to previous deployment version

**Prerequisites**: Docker/GitHub Actions CI/CD knowledge

**Key topics**: `docker-tagging`, `commit-sha`, `kubernetes-restart`, `cache-invalidation`, `rollback`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# Docker Image Tagging Strategy

**Status**: Active
**Last Updated**: 2025-11-29
**Applies To**: All containerized deployments (Frontend, Temporal Workers, Edge Functions)

## Overview

All A4C-AppSuite Docker images use a **commit SHA-based tagging strategy** with semantic versioning support. This ensures deterministic deployments, automatic Kubernetes pod restarts, and efficient build caching.

## Problem Statement

### Why Not Use `:latest`?

Using the `:latest` tag for production deployments creates several critical issues:

1. **Kubernetes doesn't detect changes**: When you push a new image with the same tag (`:latest`), Kubernetes sees no tag change and won't pull the new image or restart pods
2. **Stale Docker builds**: GitHub Actions may reuse cached Docker layers from previous builds, deploying old code even when source files changed
3. **No traceability**: Impossible to determine which git commit is running in production
4. **Difficult rollbacks**: Can't easily roll back to a specific version

### Historical Context

**Before (commits prior to 4ab49e02 and f89c848b)**:
- Temporal worker used `:latest` tag
- Manual `kubectl rollout restart` required to force pod updates
- Cache invalidation issues caused stale builds
- Production deployed old code despite successful CI/CD

**After (commits 4ab49e02, f89c848b, 12b1168e)**:
- All services use commit SHA tags
- Automatic pod restarts on deployment
- Cache properly scoped per commit
- Production always runs exact git commit

## Tagging Strategy

### Tag Patterns

Every Docker image is tagged with multiple tags simultaneously:

```yaml
# Primary deployment tag
type=sha,prefix=,format=short        # Creates: :a1b2c3d

# Convenience tag
type=raw,value=latest,enable={{is_default_branch}}  # Creates: :latest

# Semantic version tags (when git tags exist)
type=semver,pattern={{version}}      # Creates: :1.2.3
type=semver,pattern={{major}}.{{minor}}  # Creates: :1.2
type=semver,pattern={{major}}        # Creates: :1
```

### Examples

**Regular commit to main** (no git tag):
```
ghcr.io/analytics4change/a4c-appsuite-frontend:12b1168
ghcr.io/analytics4change/a4c-appsuite-frontend:latest
```

**Tagged release** (git tag `v1.2.3`):
```
ghcr.io/analytics4change/a4c-appsuite-frontend:12b1168
ghcr.io/analytics4change/a4c-appsuite-frontend:1.2.3
ghcr.io/analytics4change/a4c-appsuite-frontend:1.2
ghcr.io/analytics4change/a4c-appsuite-frontend:1
ghcr.io/analytics4change/a4c-appsuite-frontend:latest
```

### Which Tag is Used for Deployment?

**Always use the commit SHA tag**, not `:latest`:

```bash
# Extract SHA tag (excludes :latest)
IMAGE_TAG=$(echo "${{ needs.build.outputs.image-tags }}" | grep -v latest | head -n1)

# Deploy with unique SHA tag
kubectl set image deployment/my-app \
  container=$IMAGE_TAG
```

## Implementation

### GitHub Actions Workflow Configuration

#### 1. Docker Metadata Action

```yaml
- name: Extract metadata
  id: meta
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/analytics4change/my-service
    tags: |
      # Tag with commit SHA (primary deployment tag)
      type=sha,prefix=,format=short
      # Tag with 'latest' on main branch
      type=raw,value=latest,enable={{is_default_branch}}
      # Tag with version on git tags (e.g., v1.0.0)
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
      type=semver,pattern={{major}}
```

#### 2. Docker Build with Commit-Scoped Cache

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: ./service
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    labels: ${{ steps.meta.outputs.labels }}
    # Cache scoped per branch + commit SHA
    cache-from: type=gha,scope=${{ github.ref_name }}
    cache-to: type=gha,mode=max,scope=${{ github.ref_name }}-${{ github.sha }}
```

**Key points**:
- `cache-from` uses branch name for layer reuse
- `cache-to` adds commit SHA to create unique cache entry
- This prevents stale caching while maintaining fast builds

#### 3. Kubernetes Deployment

```yaml
- name: Deploy to Kubernetes
  run: |
    # Get the commit SHA tag (not :latest) to force pod restart
    IMAGE_TAG=$(echo "${{ needs.build.outputs.image-tags }}" | grep -v latest | head -n1)
    echo "Using image tag: $IMAGE_TAG"

    # Update the deployment image using kubectl set image
    kubectl set image deployment/my-deployment \
      container-name=$IMAGE_TAG

    echo "✅ Image updated in deployment"
```

**Key points**:
- Use `kubectl set image`, not `kubectl apply`
- Filter out `:latest` tag with `grep -v latest`
- Kubernetes detects new SHA tag and automatically restarts pods
- No manual `kubectl rollout restart` needed

## Benefits

### 1. Automatic Pod Restarts

Kubernetes automatically detects when the image tag changes:

```
# Before (using :latest)
deployment.apps/my-app unchanged      ❌ No restart!

# After (using commit SHA)
deployment.apps/my-app image updated  ✅ Automatic restart!
```

### 2. Prevents Stale Builds

Docker build cache is scoped per commit, preventing cached layers from old commits:

```yaml
# Cache key includes commit SHA
scope: main-12b1168e

# Next commit gets new cache entry
scope: main-a3f5c92d
```

### 3. Complete Traceability

Image tag directly shows which commit is deployed:

```bash
$ kubectl get deployment my-app -o jsonpath='{.spec.template.spec.containers[0].image}'
ghcr.io/analytics4change/my-app:12b1168

$ git log --oneline | grep 12b1168
12b1168e feat(ci): Align frontend Docker tagging with workflow deployment strategy
```

### 4. Easy Rollbacks

Can roll back to any previous commit:

```bash
# Find previous SHA
git log --oneline

# Deploy previous version
kubectl set image deployment/my-app \
  container=ghcr.io/analytics4change/my-app:f89c848
```

### 5. Semantic Versioning Support

Optional git tags create version aliases:

```bash
# Deploy specific version
kubectl set image deployment/my-app \
  container=ghcr.io/analytics4change/my-app:1.2.3

# Deploy latest in major version
kubectl set image deployment/my-app \
  container=ghcr.io/analytics4change/my-app:1
```

## Migration Guide

### Updating Existing Workflows

If you have a workflow using `:latest` tags, follow these steps:

#### Step 1: Update Docker Metadata

**Before**:
```yaml
tags: |
  type=ref,event=branch
  type=raw,value=latest
```

**After**:
```yaml
tags: |
  # Tag with commit SHA
  type=sha,prefix=,format=short
  # Tag with 'latest' on main branch
  type=raw,value=latest,enable={{is_default_branch}}
  # Tag with version on git tags
  type=semver,pattern={{version}}
  type=semver,pattern={{major}}.{{minor}}
  type=semver,pattern={{major}}
```

#### Step 2: Update Cache Scoping

**Before**:
```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

**After**:
```yaml
cache-from: type=gha,scope=${{ github.ref_name }}
cache-to: type=gha,mode=max,scope=${{ github.ref_name }}-${{ github.sha }}
```

#### Step 3: Update Deployment Strategy

**Before**:
```yaml
- name: Deploy
  run: |
    IMAGE_TAG=$(echo "${{ needs.build.outputs.image-tag }}" | head -n1)
    sed -i "s|image:.*|image: $IMAGE_TAG|g" deployment.yaml
    kubectl apply -f deployment.yaml
    kubectl rollout restart deployment/my-app  # Manual restart required!
```

**After**:
```yaml
- name: Deploy
  run: |
    # Get commit SHA tag (not :latest)
    IMAGE_TAG=$(echo "${{ needs.build.outputs.image-tag }}" | grep -v latest | head -n1)
    echo "Using image tag: $IMAGE_TAG"

    # Kubernetes auto-restarts when tag changes
    kubectl set image deployment/my-app \
      container=$IMAGE_TAG

    echo "✅ Image updated in deployment"
```

#### Step 4: Verify Deployment

```bash
# Check deployed image tag
kubectl get deployment my-app -o jsonpath='{.spec.template.spec.containers[0].image}'

# Should show commit SHA, not :latest
# Expected: ghcr.io/analytics4change/my-app:12b1168
# Not:      ghcr.io/analytics4change/my-app:latest
```

## Applied To

This strategy is currently implemented in:

### ✅ Temporal Worker Deployment
- **Workflow**: `.github/workflows/temporal-deploy.yml`
- **Commits**: 4ab49e02 (cache), f89c848b (tagging)
- **Image**: `ghcr.io/analytics4change/a4c-workflows`
- **Deployment**: Kubernetes `temporal` namespace

### ✅ Frontend Deployment
- **Workflow**: `.github/workflows/frontend-deploy.yml`
- **Commit**: 12b1168e
- **Image**: `ghcr.io/analytics4change/a4c-appsuite-frontend`
- **Deployment**: Kubernetes default namespace

### 🔄 Future: Edge Functions
- Supabase Edge Functions don't use Docker (Deno runtime)
- Deployment via Supabase CLI with git SHA metadata

## Troubleshooting

### Issue: Image Tag Shows `:latest` After Deployment

**Problem**: Deployment still references `:latest` tag

**Diagnosis**:
```bash
kubectl get deployment my-app -o jsonpath='{.spec.template.spec.containers[0].image}'
# Shows: ghcr.io/analytics4change/my-app:latest  ❌
```

**Solution**: Check that deployment script filters out `:latest`:
```bash
IMAGE_TAG=$(echo "$tags" | grep -v latest | head -n1)
```

### Issue: Pods Don't Restart After Deployment

**Problem**: GitHub Actions shows success but pods still run old code

**Diagnosis**:
```bash
kubectl get pods -l app=my-app
# AGE shows old timestamp (e.g., 3d)
```

**Cause**: Using same tag (`:latest`) doesn't trigger Kubernetes to pull new image

**Solution**: Verify commit SHA tags are being used:
```bash
# In GitHub Actions logs, check for:
Using image tag: ghcr.io/analytics4change/my-app:12b1168
```

### Issue: Docker Build Cache Not Invalidating

**Problem**: Source code changes but old code is deployed

**Diagnosis**:
```bash
# In GitHub Actions logs, check build step:
# If all layers show "CACHED", cache isn't invalidating
```

**Solution**: Verify cache scope includes commit SHA:
```yaml
cache-to: type=gha,mode=max,scope=${{ github.ref_name }}-${{ github.sha }}
```

### Issue: Rollback to Previous Version

**Need**: Deploy previous commit after bad deployment

**Solution**:
```bash
# 1. Find previous commit SHA
git log --oneline -10

# 2. Deploy previous version
kubectl set image deployment/my-app \
  container=ghcr.io/analytics4change/my-app:f89c848

# 3. Verify rollout
kubectl rollout status deployment/my-app
```

## Best Practices

### 1. Always Use Commit SHA for Deployments

```bash
✅ GOOD: kubectl set image deployment/my-app container=ghcr.io/org/app:12b1168
❌ BAD:  kubectl set image deployment/my-app container=ghcr.io/org/app:latest
```

### 2. Keep `:latest` Tag for Development

The `:latest` tag still has value for development environments:

```bash
# Pull latest for local development
docker pull ghcr.io/analytics4change/my-app:latest
```

### 3. Use Semantic Versioning for Releases

Create git tags for releases:

```bash
git tag -a v1.2.3 -m "Release 1.2.3"
git push origin v1.2.3
```

This automatically creates semver tags: `:1.2.3`, `:1.2`, `:1`

### 4. Document Image Tags in Deployment

Add image tag to deployment annotations:

```yaml
annotations:
  deployed-commit: "12b1168e"
  deployed-date: "2025-11-29"
  deployed-by: "github-actions"
```

### 5. Monitor Image Pull Times

Long pull times may indicate cache issues:

```bash
# Check pod events for image pull duration
kubectl describe pod my-app-xxx | grep -A 5 "Pulling image"
```

## References

- **Docker metadata-action**: https://github.com/docker/metadata-action
- **Docker build-push-action**: https://github.com/docker/build-push-action
- **Kubernetes Image Pull Policy**: https://kubernetes.io/docs/concepts/containers/images/
- **GitHub Actions Cache**: https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows

## Related Documentation

- [Deployment Checklist](../operations/deployment/DEPLOYMENT_CHECKLIST.md)
- [Kubernetes RBAC Guide](kubernetes/rbac/)
- [Temporal Worker Realtime Migration](../../../dev/active/temporal-worker-realtime-migration-context.md) - Original implementation

## Changelog

### 2025-11-29 - Initial Documentation
- Documented commit SHA tagging strategy
- Migrated from dev-docs to official documentation
- Applied to Frontend and Temporal worker deployments
