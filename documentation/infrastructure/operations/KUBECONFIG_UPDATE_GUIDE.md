---
status: current
last_updated: 2025-01-13
---

# KUBECONFIG Update Guide for GitHub Actions Deployment

## Overview

This guide documents the **RBAC-secured kubeconfig** for GitHub Actions deployments. The configuration uses:
- **Public Cloudflare Tunnel endpoint**: `https://k8s.firstovertheline.com` (accessible from GitHub Actions)
- **Namespace-scoped permissions**: Service account with least-privilege RBAC (NOT cluster-admin)
- **Service account authentication**: Long-lived token for CI/CD workflows

## Current Configuration (Updated 2025-11-03)

### Service Account Setup
- **Service Account**: `github-actions` (in `default` namespace)
- **Permissions**: Namespace-scoped roles (NOT cluster-admin)
  - `github-actions-frontend-role` → `default` namespace (frontend deployments)
  - `github-actions-temporal-role` → `temporal` namespace (worker deployments)
- **Authentication**: Long-lived token via `github-actions-token` secret

### Security Model

**Principle of Least Privilege**:
- ✅ Can deploy to `default` and `temporal` namespaces only
- ✅ Can create/patch deployments, services, ingresses, secrets
- ✅ Can monitor rollouts and check pod status
- ❌ Cannot delete resources (including deployments)
- ❌ Cannot access `kube-system`, `cert-manager`, or other namespaces
- ❌ Cannot perform cluster-wide operations
- ❌ No cluster-admin privileges

**RBAC Resources**:
- Located in: `infrastructure/k8s/rbac/`
- See: `infrastructure/k8s/rbac/README.md` for details

## Background

The k3s cluster is running on a private network with a Cloudflare Tunnel for external access:
- **Private endpoint**: `https://192.168.122.42:6443` (local access only)
- **Public endpoint**: `https://k8s.firstovertheline.com` (GitHub Actions access via Cloudflare Tunnel)

## Prerequisites

- Admin access to the GitHub repository (Settings → Secrets and variables → Actions)
- `kubectl` installed locally for testing (optional but recommended)
- Access to k3s cluster via existing kubeconfig (`~/.kube/config`)

## Step 1: Verify Cloudflare Tunnel is Running

SSH into the k3s host machine and verify the tunnel service:

```bash
# Check cloudflared service status
sudo systemctl status cloudflared

# Expected output: active (running)
```

If the service is not running:

```bash
# Start the service
sudo systemctl start cloudflared

# Enable on boot
sudo systemctl enable cloudflared
```

## Step 2: Test Public Endpoint Accessibility

From **any machine with internet access** (not the k3s host), test the public endpoint:

```bash
# Test DNS resolution
nslookup k8s.firstovertheline.com

# Test k8s API server (expect certificate/auth error, but confirms connectivity)
curl -k https://k8s.firstovertheline.com/version

# Expected output: Either JSON version info or 401/403 auth error (both confirm connectivity)
```

If this fails:
- Check Cloudflare Tunnel configuration in `/etc/cloudflared/config.yml`
- Verify DNS records in Cloudflare dashboard
- Check tunnel logs: `sudo journalctl -u cloudflared -f`

## Step 3: Extract Current Kubeconfig

SSH into the k3s host machine:

```bash
# Extract the kubeconfig
sudo cat /etc/rancher/k3s/k3s.yaml

# Copy the output to your local machine
```

The output will look like:

```yaml
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: LS0tLS1CRUdJTi... (long base64 string)
    server: https://127.0.0.1:6443  # <-- This needs to change
  name: default
contexts:
- context:
    cluster: default
    user: default
  name: default
current-context: default
users:
- name: default
  user:
    client-certificate-data: LS0tLS1CRUdJTi... (long base64 string)
    client-key-data: LS0tLS1CRUdJTi... (long base64 string)
```

## Step 4: Modify Kubeconfig for Public Access

Create a new file `kubeconfig-public.yaml` on your local machine with the content from Step 3, then modify it:

**Change this line:**
```yaml
    server: https://127.0.0.1:6443
```

**To this:**
```yaml
    server: https://k8s.firstovertheline.com
```

**Optional: Handle TLS verification**

If you encounter TLS certificate issues (the tunnel uses a different certificate than the k3s API server):

**Option A - Skip TLS verification (simpler, less secure):**
```yaml
clusters:
- cluster:
    server: https://k8s.firstovertheline.com
    insecure-skip-tls-verify: true  # <-- Add this line
    # Remove or comment out certificate-authority-data
  name: default
```

**Option B - Use proper certificate (more secure):**
```yaml
clusters:
- cluster:
    server: https://k8s.firstovertheline.com
    certificate-authority-data: LS0tLS1CRUdJTi... # Keep original CA cert
  name: default
```

Try Option B first, fall back to Option A if certificate validation fails.

## Step 5: Test Modified Kubeconfig Locally

Before updating GitHub, test the modified kubeconfig from your local machine:

```bash
# Set the kubeconfig environment variable
export KUBECONFIG=/path/to/kubeconfig-public.yaml

# Test connection
kubectl cluster-info

# Expected output:
# Kubernetes control plane is running at https://k8s.firstovertheline.com

# Test a simple command
kubectl get nodes

# Expected output: List of k3s cluster nodes
```

If this fails:
- Verify DNS resolution: `nslookup k8s.firstovertheline.com`
- Check tunnel is running (Step 1)
- Try Option A (insecure-skip-tls-verify) if certificate validation fails
- Check firewall rules on k3s host

## Step 6: Encode Kubeconfig for GitHub Secret

Once local testing succeeds, encode the kubeconfig:

```bash
# Base64 encode (no line wrapping)
cat kubeconfig-public.yaml | base64 -w 0 > kubeconfig-base64.txt

# The output is a single long string like:
# YXBpVmVyc2lvbjogdjEKa2luZDogQ29uZmlnCmNsdXN0ZXJzOgotIGNsdXN0ZXI6CiAgICBjZXJ0...
```

**Alternative format (plain text):**

Some workflows support plain YAML instead of base64. If your workflow decodes base64, use the encoded version above. If it expects plain YAML, use the file content directly.

## Step 7: Update GitHub Repository Secret

1. Go to your GitHub repository: https://github.com/Analytics4Change/A4C-AppSuite
2. Navigate to **Settings → Secrets and variables → Actions**
3. Find the `KUBECONFIG` secret (or create it if it doesn't exist)
4. Click **Update** (or **New repository secret**)
5. **Name**: `KUBECONFIG`
6. **Value**: Paste the base64-encoded content from `kubeconfig-base64.txt`
7. Click **Update secret** (or **Add secret**)

## Step 8: Verify GitHub Actions Deployment

Trigger a deployment workflow to test:

**Option A - Make a small change:**
```bash
# Make a trivial change to frontend code
echo "# Test" >> frontend/README.md
git add frontend/README.md
git commit -m "test: Trigger deployment to verify KUBECONFIG update"
git push origin main
```

**Option B - Re-run existing workflow:**
1. Go to **Actions** tab in GitHub
2. Select the most recent **Frontend Deploy** workflow run
3. Click **Re-run jobs → Re-run all jobs**

**Expected workflow output:**

```
✅ kubectl configured successfully
Kubernetes control plane is running at https://k8s.firstovertheline.com
✅ kubectl can connect to cluster
```

If the workflow still fails:
- Double-check the secret was updated correctly
- Verify base64 encoding is correct (no extra newlines)
- Check workflow logs for specific error messages
- Ensure kubeconfig format matches what the workflow expects

## Step 9: Clean Up

After successful deployment:

```bash
# Remove local test files (they contain sensitive credentials)
rm kubeconfig-public.yaml kubeconfig-base64.txt

# Remove the test commit if you created one
git reset --soft HEAD~1  # Undo commit but keep changes
git checkout frontend/README.md  # Discard test changes
```

## Troubleshooting

### Error: "Unable to connect to the server: dial tcp: lookup k8s.firstovertheline.com: no such host"

**Cause**: DNS not configured or propagated

**Solution**:
1. Check Cloudflare DNS records
2. Verify domain is `k8s.firstovertheline.com` (not a typo)
3. Wait a few minutes for DNS propagation
4. Test with `nslookup k8s.firstovertheline.com`

### Error: "x509: certificate is valid for 192.168.122.42, not k8s.firstovertheline.com"

**Cause**: k3s API server certificate doesn't include the public domain

**Solution**: Use `insecure-skip-tls-verify: true` in kubeconfig (Step 4, Option A)

### Error: "error: You must be logged in to the server (Unauthorized)"

**Cause**: Client certificate/key is incorrect or expired

**Solution**:
1. Re-extract kubeconfig from `/etc/rancher/k3s/k3s.yaml`
2. Ensure you copied the entire `client-certificate-data` and `client-key-data` fields
3. Check for copy/paste errors (missing characters)

### Error: "The connection to the server k8s.firstovertheline.com:443 was refused"

**Cause**: Cloudflare Tunnel not running or misconfigured

**Solution**:
1. Check tunnel status: `sudo systemctl status cloudflared`
2. Check tunnel config: `sudo cat /etc/cloudflared/config.yml`
3. Verify the k8s hostname is configured with correct service URL
4. Restart tunnel: `sudo systemctl restart cloudflared`

### Workflow still uses old kubeconfig

**Cause**: GitHub secret not updated or workflow cached old value

**Solution**:
1. Verify secret was actually updated in GitHub UI
2. Try deleting and recreating the secret (instead of updating)
3. Re-run the workflow (don't just re-trigger)

## Security Considerations

### Kubeconfig Contains Sensitive Credentials

The kubeconfig file contains:
- Client certificates (authenticate as cluster admin)
- Client private keys (sign requests)
- Cluster CA certificate (verify server identity)

**Never commit kubeconfig to git or share publicly.** Always:
- Store in GitHub Secrets (encrypted at rest)
- Use git-crypt for local encrypted storage if needed
- Rotate credentials if exposed
- Use RBAC to limit permissions (create dedicated GitHub Actions user with limited permissions)

### TLS Verification

Using `insecure-skip-tls-verify: true` disables certificate validation:
- **Risk**: Vulnerable to man-in-the-middle attacks
- **Mitigation**: Cloudflare Tunnel provides transport encryption, reducing risk
- **Better solution**: Generate k3s certificates with SANs including `k8s.firstovertheline.com`

### RBAC and Least Privilege

The GitHub Actions service account uses **namespace-scoped roles** instead of cluster-admin:
- **Security benefit**: Limited blast radius if GitHub Secret is compromised
- **Access control**: Only deployment operations in specific namespaces
- **Audit trail**: Clear RBAC definitions make it easy to review permissions
- **See**: `infrastructure/k8s/rbac/README.md` for complete RBAC documentation

## RBAC Setup (Completed 2025-11-03)

The GitHub Actions kubeconfig now uses a restricted service account instead of cluster-admin. This section documents the setup for reference.

### Service Account Creation

```bash
# Create service account in default namespace
kubectl apply -f infrastructure/k8s/rbac/serviceaccount.yaml

# Create long-lived token secret
kubectl apply -f infrastructure/k8s/rbac/token-secret.yaml
```

### Role Creation

Two namespace-scoped roles were created:

```bash
# Frontend deployment role (default namespace)
kubectl apply -f infrastructure/k8s/rbac/role-frontend.yaml

# Temporal worker deployment role (temporal namespace)
kubectl apply -f infrastructure/k8s/rbac/role-temporal.yaml
```

### Role Bindings

```bash
# Bind service account to frontend role
kubectl apply -f infrastructure/k8s/rbac/rolebinding-frontend.yaml

# Bind service account to temporal worker role
kubectl apply -f infrastructure/k8s/rbac/rolebinding-temporal.yaml
```

### Kubeconfig Generation

```bash
# Extract service account token
TOKEN=$(kubectl get secret github-actions-token -n default -o jsonpath='{.data.token}' | base64 -d)

# Create kubeconfig
cat > github-actions-kubeconfig.yaml <<EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: https://k8s.firstovertheline.com
  name: k3s-cluster
contexts:
- context:
    cluster: k3s-cluster
    user: github-actions
  name: github-actions-context
current-context: github-actions-context
users:
- name: github-actions
  user:
    token: ${TOKEN}
EOF

# Base64 encode for GitHub Secret
cat github-actions-kubeconfig.yaml | base64 -w 0 > kubeconfig-base64.txt
```

### Permission Verification

```bash
# Verify required permissions work
kubectl auth can-i create secrets --as=system:serviceaccount:default:github-actions -n default
kubectl auth can-i patch deployments --as=system:serviceaccount:default:github-actions -n default
kubectl auth can-i patch deployments --as=system:serviceaccount:default:github-actions -n temporal

# Verify dangerous permissions are blocked
kubectl auth can-i delete namespaces --as=system:serviceaccount:default:github-actions  # Should return "no"
```

### Cleanup of Old Cluster-Admin

After validating GitHub Actions deployments work with the new RBAC:

```bash
# Delete old cluster-admin binding
kubectl delete clusterrolebinding github-actions-admin

# Verify service account no longer has cluster-admin
kubectl auth can-i delete namespaces --as=system:serviceaccount:default:github-actions  # Should return "no"
```

## Next Steps

After successful KUBECONFIG update:

1. **Enable Temporal worker deployment** - Update `.github/workflows/workflows-docker.yaml` to deploy after Docker build
2. **Add Supabase migrations** - Create workflow to run database migrations
3. **Set up monitoring** - Add health checks and alerting for failed deployments
4. **Implement rollback procedures** - Document how to rollback failed deployments

## Reference

- Original Cloudflare Tunnel plan: `.plans/cloudflare-remote-access/plan.md`
- Cloudflare Tunnel config: `frontend/cloudflared-config.yml`
- Frontend deployment workflow: `.github/workflows/frontend-deploy.yml`
- k3s documentation: https://docs.k3s.io/
- Cloudflare Tunnel docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/

## Change History

- 2025-11-03: **RBAC Security Update** - Replaced cluster-admin with namespace-scoped roles for GitHub Actions
  - Created `github-actions` service account with least-privilege permissions
  - Added namespace-scoped roles for `default` and `temporal` namespaces
  - Updated kubeconfig generation to use service account token
  - Documented RBAC setup and security benefits
- 2025-11-03: Initial version - Documented procedure to fix GitHub Actions kubectl connectivity
