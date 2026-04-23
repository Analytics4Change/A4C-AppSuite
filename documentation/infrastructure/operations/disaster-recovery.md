---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Disaster recovery procedures for A4C-AppSuite — backup strategy across database/Kubernetes/Temporal, complete cluster failure recovery, database corruption recovery, and application rollback.

**When to read**:
- Planning a disaster recovery exercise
- Recovering from cluster, database, or application failure
- Reviewing backup strategy and retention policies
- Onboarding to operations responsibilities

**Prerequisites**: Familiarity with the deployment runbook, cluster admin access, Supabase dashboard access

**Key topics**: `disaster-recovery`, `backup`, `recovery`, `rollback`, `cluster-failure`, `database-corruption`

**Estimated read time**: 6 minutes
<!-- TL;DR-END -->

# Disaster Recovery

This document covers backup strategy and recovery procedures for catastrophic failures.

## Backup Strategy

### Database

- Supabase provides automated backups (check retention policy in Supabase dashboard)
- Manual backup before major migrations:
  ```bash
  pg_dump -h $DB_HOST -U postgres -d postgres > backup-$(date +%Y%m%d).sql
  ```

### Kubernetes

- Critical deployments tracked in git (`infrastructure/k8s/*.yaml`)
- Secrets stored in encrypted git-crypt
- ConfigMaps in version control

### Temporal

- Workflows are durable (persisted in Temporal DB)
- Worker code in git
- Temporal cluster backed by PostgreSQL (Supabase backups)

## Recovery Procedures

### Complete Cluster Failure

1. Restore k3s cluster from infrastructure backup
2. Redeploy Temporal Helm chart
3. Redeploy workers: `kubectl apply -f infrastructure/k8s/temporal/`
4. Redeploy frontend: `kubectl apply -f frontend/k8s/`
5. Verify health checks (see [Deployment Runbook → Monitoring](deployment/deployment-runbook.md#monitoring))
6. Resume Temporal workflows (automatic on worker startup)

### Database Corruption

1. Identify last good backup
2. Restore from Supabase backup (use Supabase dashboard)
3. Re-run migrations if needed (`supabase db push --linked`)
4. Verify data integrity
5. Resume application services

### Application Rollback

1. Identify last working deployment via `kubectl rollout history deployment/<name>`
2. Rollback: `kubectl rollout undo deployment/<name>` (add `-n <namespace>` for `temporal`)
3. Verify application health
4. Investigate root cause
5. Fix and re-deploy

For per-component rollback commands, see [Deployment Runbook](deployment/deployment-runbook.md).

## Security Best Practices

### Secrets Management

- Never commit secrets to git
- Rotate GitHub secrets regularly (see [Resend Key Rotation](resend-key-rotation.md) for the email provider rotation procedure)
- Use GitHub environment protection for production
- Encrypt sensitive files with git-crypt

### Access Control

- Limit kubectl access to authorized personnel
- Use RBAC in Kubernetes (see `infrastructure/k8s/rbac/README.md`)
- Audit GitHub Actions logs regularly
- Enable branch protection on `main`

### Database

- Use Supabase RLS for all tables
- Never expose service role key in frontend
- Audit database access logs
- Backup before major migrations

### Kubernetes

- Use network policies to isolate namespaces
- Scan Docker images for vulnerabilities
- Keep cluster up to date
- Monitor resource usage

## Related Documentation

- [Deployment Runbook](deployment/deployment-runbook.md) — Manual deployment + rollback for each component
- [KUBECONFIG Update Guide](KUBECONFIG_UPDATE_GUIDE.md) — Cluster access configuration
- [Resend Key Rotation](resend-key-rotation.md) — Email provider key rotation
- [Day 0 Migration Guide](../guides/supabase/DAY0-MIGRATION-GUIDE.md) — Database baseline procedures
- [Infrastructure CLAUDE.md](../../../infrastructure/CLAUDE.md) — Component-level guide
