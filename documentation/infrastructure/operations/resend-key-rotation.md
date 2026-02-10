# Resend API Key Rotation

**Status**: ✅ Production
**Component**: Infrastructure Operations
**Last Updated**: 2025-01-14

## Overview

This guide provides step-by-step instructions for rotating the Resend API key used by Temporal workflow workers with zero downtime. Regular key rotation is a security best practice that reduces the risk of unauthorized access if a key is compromised.

## When to Rotate

Rotate the Resend API key when:

1. **Compromised Key**: Immediately rotate if the key is exposed (committed to git, logged, shared insecurely)
2. **Quarterly Rotation**: Proactive rotation every 90 days as security best practice
3. **Team Changes**: When developers with key access leave the organization
4. **Incident Response**: Part of broader incident response if related systems are compromised
5. **Compliance Requirements**: Industry-specific regulations may mandate rotation frequency

## Prerequisites

Before rotating the key, ensure you have:

- **Resend Account Access**: Admin access to https://resend.com/api-keys
- **Kubernetes Access**: kubectl configured with access to the `temporal` namespace
- **Permissions**: Ability to patch secrets and restart deployments
- **Communication**: Notify team members of maintenance window (brief disruption possible)

## Rotation Procedure

### Step 1: Create New API Key in Resend

1. Log in to Resend dashboard: https://resend.com/api-keys
2. Click **"Create API Key"**
3. Configure the new key:
   - **Name**: `A4C-AppSuite-Temporal-Workers-{DATE}` (e.g., `A4C-AppSuite-Temporal-Workers-2025-01-14`)
   - **Permission**: `Sending access` (full permissions)
   - **Domain**: `All Domains` (or restrict to specific verified domain)
4. Click **"Add"**
5. **IMPORTANT**: Copy the API key immediately (shown only once)
   - Format: `re_` followed by 32 alphanumeric characters
   - Example: `re_AbCdEfGhIjKlMnOpQrStUvWxYz123456`
6. Store the key securely in your password manager

### Step 2: Update Kubernetes Secret

The Resend API key is stored in the `workflow-worker-secrets` secret in the `temporal` namespace.

#### Option A: Patch the Secret (Recommended)

```bash
# Base64 encode the new API key
NEW_KEY="re_AbCdEfGhIjKlMnOpQrStUvWxYz123456"  # Replace with actual new key
ENCODED_KEY=$(echo -n "$NEW_KEY" | base64)

# Patch the secret with the new key
kubectl patch secret workflow-worker-secrets \
  -n temporal \
  --type='json' \
  -p="[{\"op\": \"replace\", \"path\": \"/data/RESEND_API_KEY\", \"value\": \"$ENCODED_KEY\"}]"

# Verify the patch was successful
kubectl get secret workflow-worker-secrets -n temporal -o jsonpath='{.data.RESEND_API_KEY}' | base64 -d
# Should output the new API key
```

#### Option B: Recreate the Secret from Example

If you prefer to recreate the entire secret:

```bash
# Navigate to infrastructure directory
cd infrastructure/k8s/temporal

# Copy the example file
cp worker-secret.yaml.example worker-secret.yaml

# Edit worker-secret.yaml and update RESEND_API_KEY
# - Find the line with RESEND_API_KEY
# - Replace the base64-encoded value with your new key (base64 encoded)

# Base64 encode your new key
echo -n "re_AbCdEfGhIjKlMnOpQrStUvWxYz123456" | base64
# Copy the output and paste into worker-secret.yaml

# Delete the old secret
kubectl delete secret workflow-worker-secrets -n temporal

# Apply the new secret
kubectl apply -f worker-secret.yaml

# Verify the secret was created
kubectl get secret workflow-worker-secrets -n temporal -o jsonpath='{.data.RESEND_API_KEY}' | base64 -d
```

**IMPORTANT**: Never commit `worker-secret.yaml` to git! It contains sensitive credentials.

### Step 3: Restart Temporal Workers

Kubernetes deployments do not automatically reload environment variables when secrets change. You must restart the workers to pick up the new key.

```bash
# Perform a rolling restart of the worker deployment
kubectl rollout restart deployment/workflow-worker -n temporal

# Monitor the rollout status
kubectl rollout status deployment/workflow-worker -n temporal

# Expected output:
# Waiting for deployment "workflow-worker" rollout to finish: 1 out of 2 new replicas have been updated...
# Waiting for deployment "workflow-worker" rollout to finish: 1 old replicas are pending termination...
# deployment "workflow-worker" successfully rolled out
```

The rolling restart ensures zero downtime:
1. Kubernetes starts new pods with the new secret
2. New pods become ready and start processing tasks
3. Old pods are terminated gracefully
4. Total downtime: 0 seconds (if deployment has multiple replicas)

### Step 4: Verify New Key Works

After the workers restart, verify they can send emails with the new key.

#### Check Worker Logs

```bash
# Get logs from the new pods
kubectl logs -n temporal -l app=workflow-worker --tail=50

# Look for successful email sending:
# ✅ Good signs:
#   - "Email sent successfully via Resend"
#   - "Email provider initialized: resend"
#   - No authentication errors
#
# ❌ Bad signs:
#   - "401 Unauthorized: Invalid API key"
#   - "RESEND_API_KEY environment variable is required"
#   - "Failed to send email"
```

#### Test Email Sending (Optional)

If you want to proactively test email sending:

1. **Trigger a workflow** that sends email (e.g., organization bootstrap)
2. **Check Resend dashboard** for sent email
3. **Verify recipient** receives the email
4. **Check Temporal Web UI** for workflow execution success

**Example using Temporal CLI**:

```bash
# Start an organization bootstrap workflow (sends welcome email)
temporal workflow start \
  --type organizationBootstrapWorkflow \
  --task-queue bootstrap \
  --workflow-id test-resend-rotation-$(date +%s) \
  --input '{
    "organizationId": "test-org-id",
    "adminEmail": "your-email@example.com",
    "adminName": "Test Admin",
    "organizationName": "Test Organization"
  }'
```

### Step 5: Revoke Old API Key

Once you've verified the new key works correctly, revoke the old key in Resend.

1. Log in to Resend dashboard: https://resend.com/api-keys
2. Find the old API key (previous date in name)
3. Click the **trash icon** to delete the key
4. Confirm deletion

**IMPORTANT**: Wait at least 30 minutes after worker restart before revoking the old key. This ensures all workers have fully restarted and are using the new key.

### Step 6: Update Documentation

Update internal documentation with the rotation date:

1. **Password Manager**: Update the key entry with new value and rotation date
2. **Runbook**: Update "Last Rotated" date in this document
3. **Team Notification**: Inform team that rotation is complete

## Rollback Procedure

If the new key does not work (e.g., wrong permissions, typo in key):

### Quick Rollback

```bash
# Retrieve the old key from Resend dashboard (if not yet revoked)
# Or from your password manager backup

# Base64 encode the old key
OLD_KEY="re_OldKeyValue123456789012345678901"  # Replace with actual old key
ENCODED_OLD_KEY=$(echo -n "$OLD_KEY" | base64)

# Patch the secret back to the old key
kubectl patch secret workflow-worker-secrets \
  -n temporal \
  --type='json' \
  -p="[{\"op\": \"replace\", \"path\": \"/data/RESEND_API_KEY\", \"value\": \"$ENCODED_OLD_KEY\"}]"

# Restart workers again
kubectl rollout restart deployment/workflow-worker -n temporal
kubectl rollout status deployment/workflow-worker -n temporal
```

### Post-Rollback

1. **Investigate** why the new key failed
2. **Fix the issue** (regenerate key with correct permissions, fix typo, etc.)
3. **Retry rotation** following the procedure above
4. **Do not revoke** the old key until new key is verified working

## Troubleshooting

### Workers Not Picking Up New Key

**Symptoms**: Workers still using old key after restart

**Cause**: Secret not updated correctly OR workers not actually restarted

**Solution**:

```bash
# Verify secret was updated
kubectl get secret workflow-worker-secrets -n temporal -o jsonpath='{.data.RESEND_API_KEY}' | base64 -d
# Should show new key starting with "re_"

# Verify pods were restarted
kubectl get pods -n temporal -l app=workflow-worker
# Check AGE column - should show recent restart time

# If pods are old, force delete them
kubectl delete pods -n temporal -l app=workflow-worker
# Deployment will automatically create new pods
```

### 401 Unauthorized After Rotation

**Symptoms**: Logs show "401 Unauthorized: Invalid API key"

**Cause**: New key is invalid, revoked, or has wrong permissions

**Solution**:

```bash
# Test the key directly with curl
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer re_YourNewKey123456789012345678901" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "noreply@resend.dev",
    "to": "test@example.com",
    "subject": "Test",
    "html": "<p>Test</p>"
  }'

# If response is 401, the key is invalid
# Regenerate the key in Resend dashboard with correct permissions
# Then update the secret again
```

### Old Key Still Working After Revocation

**Symptoms**: Emails still sending after old key revoked in Resend

**Cause**: Workers not restarted, so still using cached old key

**Solution**:

```bash
# Force restart of all worker pods
kubectl delete pods -n temporal -l app=workflow-worker

# Wait for new pods to start
kubectl wait --for=condition=ready pod -n temporal -l app=workflow-worker --timeout=60s

# Verify logs show new initialization
kubectl logs -n temporal -l app=workflow-worker --tail=20
```

### Rolling Restart Stuck

**Symptoms**: `kubectl rollout status` hangs or shows errors

**Cause**: New pods failing health checks (likely due to invalid key)

**Solution**:

```bash
# Check pod status
kubectl get pods -n temporal -l app=workflow-worker

# Describe failing pods
kubectl describe pod <pod-name> -n temporal

# Check logs of failing pods
kubectl logs <pod-name> -n temporal

# If new pods are crashing due to invalid key:
# 1. Rollback to old key (see Rollback Procedure above)
# 2. Investigate why new key is invalid
# 3. Fix and retry rotation
```

## Security Best Practices

1. **Never Commit Secrets**: The `worker-secret.yaml` file is `.gitignore`d. Never commit it to version control.

2. **Limit Access**: Only DevOps and senior engineers should have:
   - Resend dashboard admin access
   - Kubernetes secret read/write access
   - Password manager access to Resend key

3. **Audit Trail**: Document every rotation in:
   - Password manager (rotation date in notes)
   - This runbook (update "Last Rotated" below)
   - Team chat or ticketing system

4. **Key Naming**: Use descriptive names with dates in Resend dashboard:
   - ✅ `A4C-AppSuite-Temporal-Workers-2025-01-14`
   - ❌ `Production Key` or `Key 1`

5. **Backup Strategy**: Before rotating:
   - Export current secret to secure backup location
   - Ensure password manager has current key
   - Document current key name in Resend dashboard

6. **Minimal Permissions**: Create Resend API keys with minimum required permissions:
   - Use `Sending access` (not `Full access` unless needed)
   - Restrict to specific domains if possible
   - Avoid wildcard permissions

## Emergency Procedures

### Key Compromised (Public Exposure)

If the Resend API key is exposed publicly (e.g., committed to git, posted in chat):

1. **Immediate Action** (within 5 minutes):
   ```bash
   # Revoke the compromised key IMMEDIATELY in Resend dashboard
   # This stops any attacker from sending emails
   ```

2. **Create New Key** (within 10 minutes):
   - Follow Step 1 above to create new key
   - Use emergency naming: `A4C-AppSuite-EMERGENCY-{TIMESTAMP}`

3. **Update Secret and Restart** (within 15 minutes):
   ```bash
   # Patch secret with new key
   NEW_KEY="re_NewEmergencyKey..."
   ENCODED_KEY=$(echo -n "$NEW_KEY" | base64)
   kubectl patch secret workflow-worker-secrets -n temporal \
     --type='json' \
     -p="[{\"op\": \"replace\", \"path\": \"/data/RESEND_API_KEY\", \"value\": \"$ENCODED_KEY\"}]"

   # Force immediate restart (no graceful rolling)
   kubectl delete pods -n temporal -l app=workflow-worker
   ```

4. **Incident Response** (within 1 hour):
   - Check Resend dashboard for unauthorized emails sent
   - Review git history to remove committed key
   - Notify security team
   - Update incident log

5. **Post-Incident** (within 24 hours):
   - Conduct root cause analysis
   - Update procedures to prevent recurrence
   - Train team on secret handling

### Resend Service Outage

If Resend API is down (503 errors, timeouts):

1. **Check Status**: Visit https://status.resend.com
2. **Enable SMTP Fallback**: See [documentation/workflows/guides/resend-email-provider.md](../../workflows/guides/resend-email-provider.md#smtp-fallback) for SMTP configuration
3. **Monitor Recovery**: Once Resend is back online, revert to Resend for better deliverability

## Automation Considerations

**Future Enhancement**: Automate key rotation using:

- **Kubernetes External Secrets Operator**: Sync secrets from external vault (HashiCorp Vault, AWS Secrets Manager)
- **Automated Rotation Script**: Cron job to rotate quarterly
- **Alerting**: Notify DevOps when key is 80 days old (approaching 90-day rotation)

**Not Recommended**: Fully automated rotation without human verification can cause outages if automation fails.

## Checklist

Use this checklist when performing rotation:

- [ ] Create new API key in Resend dashboard
- [ ] Copy new key to password manager
- [ ] Base64 encode new key
- [ ] Patch Kubernetes secret with new key
- [ ] Verify secret was updated (`kubectl get secret`)
- [ ] Restart worker deployment (`kubectl rollout restart`)
- [ ] Monitor rollout status (`kubectl rollout status`)
- [ ] Check worker logs for successful initialization
- [ ] Test email sending (trigger workflow or use Temporal CLI)
- [ ] Verify email received and appears in Resend dashboard
- [ ] Wait 30 minutes for full propagation
- [ ] Revoke old API key in Resend dashboard
- [ ] Update password manager with rotation date
- [ ] Update this runbook's "Last Rotated" section
- [ ] Notify team of completed rotation

## Rotation History

Track rotation history for compliance and auditing:

| Date       | Performed By | Key Name                                    | Reason           | Incidents |
|------------|--------------|---------------------------------------------|------------------|-----------|
| 2025-01-14 | DevOps Team  | A4C-AppSuite-Temporal-Workers-2025-01-14   | Initial setup    | None      |
| YYYY-MM-DD | Name         | A4C-AppSuite-Temporal-Workers-YYYY-MM-DD   | Quarterly        | None      |

**Last Rotated**: 2025-01-14

## Related Documentation

- [Resend Email Provider Guide](../../workflows/guides/resend-email-provider.md) - Complete Resend implementation documentation
- [Infrastructure CLAUDE.md](../../../infrastructure/CLAUDE.md#email-provider-configuration-resend) - Developer guidance on Resend configuration
- [Temporal Worker Deployment](../../../infrastructure/k8s/temporal/worker-deployment.yaml) - K8s deployment configuration
- [Activities Reference](../../workflows/reference/activities-reference.md) - Email sending activities

## Support

For issues during rotation:

1. **Check Logs**: `kubectl logs -n temporal -l app=workflow-worker`
2. **Check Resend Status**: https://status.resend.com
3. **Review Troubleshooting**: See section above
4. **Emergency Rollback**: Use old key if new key fails
5. **Contact Resend Support**: support@resend.com (if API issues)
