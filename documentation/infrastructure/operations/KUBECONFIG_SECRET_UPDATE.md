---
status: current
last_updated: 2025-01-13
---

# GitHub KUBECONFIG Secret Update Instructions

## Step 1: Copy the Base64 Kubeconfig

The new base64-encoded kubeconfig is ready at:
```bash
/home/lars/tmp/kubeconfig-base64.txt
```

**Copy the contents to your clipboard:**
```bash
cat /home/lars/tmp/kubeconfig-base64.txt
```

The output is a long base64 string (~2689 characters). Copy the **entire** string.

---

## Step 2: Update GitHub Secret

1. **Go to GitHub Repository Settings**
   - Navigate to: https://github.com/Analytics4Change/A4C-AppSuite/settings/secrets/actions

2. **Find the KUBECONFIG secret**
   - Look for `KUBECONFIG` in the list of repository secrets

3. **Click "Update" or the pencil icon**

4. **Paste the new base64 value**
   - Delete the old value
   - Paste the entire base64 string from `/home/lars/tmp/kubeconfig-base64.txt`
   - **Important**: Make sure there are NO extra spaces or line breaks

5. **Click "Update secret"**

---

## Step 3: Backup Information (For Rollback if Needed)

### Current Old Kubeconfig (Backup)
The current GitHub Secret contains the kubeconfig from `~/.kube/config` with the `remote` context.

**If you need to rollback:**
```bash
# Extract the remote context from your current kubeconfig
cat ~/.kube/config | base64 -w 0

# Then update the GitHub Secret with this value
```

---

## What Changed?

### Old Configuration
- Service account: `github-actions` (in `default` namespace)
- ClusterRoleBinding: `github-actions-admin` → `cluster-admin` role
- Access: **Full cluster access** (all namespaces, all resources)
- Security risk: High (compromised secret = full cluster control)

### New Configuration
- Service account: `github-actions` (in `default` namespace) ← Same account
- Roles: `github-actions-frontend-role` (default ns) + `github-actions-temporal-role` (temporal ns)
- Access: **Namespace-scoped only** (default + temporal namespaces, deployment operations only)
- Security risk: Low (compromised secret = limited deployment access)

### Old ClusterRoleBinding (Not Yet Deleted)
The old `github-actions-admin` ClusterRoleBinding is still active. This means:
- The service account currently has BOTH the old cluster-admin AND new namespace-scoped permissions
- After validating GitHub Actions deployments work, we'll delete the ClusterRoleBinding
- Once deleted, the service account will only have the new restricted permissions

---

## Next Steps (After Updating Secret)

1. **Trigger a deployment workflow** to test:
   - Frontend: Push a change to `frontend/**` or manually trigger `.github/workflows/frontend-deploy.yml`
   - OR Temporal Workers: Push a change to `workflows/**` or manually trigger `.github/workflows/workflows-docker.yaml`

2. **Monitor the workflow logs** for success/errors

3. **If deployment succeeds:**
   - Run: `kubectl --context=local delete clusterrolebinding github-actions-admin`
   - This removes cluster-admin permissions permanently
   - Service account will now only have namespace-scoped permissions

4. **If deployment fails:**
   - Immediately revert the GitHub KUBECONFIG secret to the old value
   - Review error logs to identify missing permission
   - File an issue with error details

---

## Verification Checklist

- [ ] Base64 kubeconfig copied from `/home/lars/tmp/kubeconfig-base64.txt`
- [ ] GitHub Secret `KUBECONFIG` updated
- [ ] Deployment workflow triggered (frontend OR temporal workers)
- [ ] Workflow completed successfully
- [ ] Application is accessible and working
- [ ] Old `github-actions-admin` ClusterRoleBinding deleted (after validation)

---

## Security Note

**Why is base64 encoding secure?**

Base64 encoding is **NOT encryption** - it's just a format conversion. The security comes from:

1. **GitHub Secrets encryption**: GitHub encrypts all secrets using libsodium before storage
2. **Access control**: Only authorized repository collaborators can view/edit secrets
3. **Masked logs**: Secrets are automatically redacted from workflow logs
4. **HTTPS transport**: Secrets transmitted over encrypted connections

The base64 encoding is purely to convert the multi-line YAML kubeconfig into a single-line string that GitHub Secrets UI can accept.

---

**Created**: 2025-11-03
**Kubeconfig Location**: `/home/lars/tmp/github-actions-kubeconfig.yaml`
**Base64 Location**: `/home/lars/tmp/kubeconfig-base64.txt`
