# Remove Deprecated temporal/ Directory

## Status: ✅ COMPLETED

**Date Completed**: 2025-01-12
**Reason**: Directory was deprecated/orphaned artifact

## Background

The `temporal/` directory at repository root was accidentally committed in commit 78b08780 (2025-11-03) alongside infrastructure changes for deploying Temporal workers to the Kubernetes "temporal namespace". This directory contained outdated workflow code that has been superseded by the `workflows/` directory.

## Evidence of Deprecation

1. **CI/CD Pipeline**: `.github/workflows/temporal-deploy.yml` explicitly uses `workflows/**` for builds and deployments (not `temporal/`)

2. **Git History**: `temporal/` had only 1 commit adding all files at once, while `workflows/` has 8+ commits of active development

3. **Backup Artifacts**: Both directories contained `.env.local.backup-20251103-142946` files, suggesting `temporal/` was a backup mistakenly committed

4. **Package Names**:
   - `temporal/package.json`: `@a4c/temporal` (older)
   - `workflows/package.json`: `@a4c/workflows` (current, more comprehensive)

## Actions Taken

- ✅ Removed entire `temporal/` directory via `git rm -r temporal/`
- ✅ Verified no references to `temporal/` in CI/CD or deployment configs
- ✅ Confirmed `workflows/` remains intact and is the active implementation
- ✅ Created this documentation for historical record

## Active Implementation

All Temporal.io workflow orchestration is in `workflows/` directory:
- Worker code: `workflows/src/`
- Deployment: `.github/workflows/temporal-deploy.yml`
- Kubernetes: `infrastructure/k8s/temporal/worker-deployment.yaml`
- Documentation: `workflows/IMPLEMENTATION.md`

## Related Commits

- 78b08780 - Accidentally added temporal/ directory
- 0c14f543 - Original commit creating workflows/ directory
