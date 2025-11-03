# Kubernetes RBAC for GitHub Actions

This directory contains the Role-Based Access Control (RBAC) configuration for GitHub Actions CI/CD deployments.

## Overview

The GitHub Actions service account has **namespace-scoped** permissions following the **principle of least privilege**. It can only perform deployment operations in specific namespaces, not cluster-wide administration.

## Security Model

### Service Account
- **Name**: `github-actions`
- **Namespace**: `default`
- **Purpose**: CI/CD deployments for frontend and Temporal workers

### Permissions Scope

GitHub Actions has access to **2 namespaces only**:

1. **default** namespace - Frontend application deployments
2. **temporal** namespace - Temporal worker deployments

**No access to**:
- `kube-system` (Kubernetes core components)
- `cert-manager` (Certificate management)
- `kube-public` (Public resources)
- Any cluster-wide operations

## RBAC Resources

### 1. ServiceAccount (`serviceaccount.yaml`)

Defines the GitHub Actions service account that workflows authenticate with.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: github-actions
  namespace: default
```

### 2. Token Secret (`token-secret.yaml`)

Long-lived token for GitHub Actions authentication. Kubernetes automatically populates this secret with a JWT token.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: github-actions-token
  namespace: default
  annotations:
    kubernetes.io/service-account.name: github-actions
type: kubernetes.io/service-account-token
```

### 3. Frontend Role (`role-frontend.yaml`)

Permissions for deploying the React frontend application to the `default` namespace.

**Allowed Operations**:
- Create/patch docker registry secrets (ghcr-secret)
- Get/list/patch/watch deployments (frontend deployment)
- Get/list/watch replica sets (monitor rollout)
- Get/list pods (check pod status)
- Get/list services (verify service)
- Get/list ingresses (check ingress)
- Get/list events (troubleshoot issues)

**NOT Allowed**:
- Delete any resources
- Modify other namespaces
- Access cluster-wide resources

### 4. Temporal Role (`role-temporal.yaml`)

Permissions for deploying Temporal workers to the `temporal` namespace.

**Allowed Operations**:
- Create/patch docker registry secrets
- Get/list/patch/watch deployments
- Get/list/watch replica sets
- Get/list pods
- Get/list events

### 5. RoleBindings (`rolebinding-*.yaml`)

Binds the service account to the namespace-specific roles.

- `rolebinding-frontend.yaml` - Connects `github-actions` to `github-actions-frontend-role` in `default` namespace
- `rolebinding-temporal.yaml` - Connects `github-actions` to `github-actions-temporal-role` in `temporal` namespace

## Applying RBAC Configuration

```bash
# Apply all RBAC resources
kubectl apply -f infrastructure/k8s/rbac/

# Verify service account created
kubectl get serviceaccount github-actions -n default

# Verify roles created
kubectl get role github-actions-frontend-role -n default
kubectl get role github-actions-temporal-role -n temporal

# Verify role bindings
kubectl get rolebinding github-actions-frontend-binding -n default
kubectl get rolebinding github-actions-temporal-binding -n temporal

# Verify token secret
kubectl get secret github-actions-token -n default
```

## Testing Permissions

```bash
# Test required permissions (should all return "yes")
kubectl auth can-i create secrets --as=system:serviceaccount:default:github-actions -n default
kubectl auth can-i patch deployments --as=system:serviceaccount:default:github-actions -n default
kubectl auth can-i patch deployments --as=system:serviceaccount:default:github-actions -n temporal

# Test dangerous permissions (should return "no")
kubectl auth can-i delete namespaces --as=system:serviceaccount:default:github-actions
kubectl auth can-i create clusterroles --as=system:serviceaccount:default:github-actions
kubectl auth can-i delete deployments --as=system:serviceaccount:default:github-actions -n kube-system
```

## GitHub Actions Integration

### Kubeconfig Generation

The service account token is used to create a kubeconfig file for GitHub Actions:

```bash
# 1. Extract token from secret
TOKEN=$(kubectl get secret github-actions-token -n default -o jsonpath='{.data.token}' | base64 -d)

# 2. Create kubeconfig
cat > kubeconfig.yaml <<EOF
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

# 3. Base64 encode for GitHub Secret
cat kubeconfig.yaml | base64 -w 0 > kubeconfig-base64.txt
```

### GitHub Secret Update

1. Go to repository Settings → Secrets → Actions
2. Update `KUBECONFIG` secret with base64 content from `kubeconfig-base64.txt`
3. Workflows will use this kubeconfig for kubectl commands

## Workflow Usage

GitHub Actions workflows automatically use the KUBECONFIG secret:

```yaml
# .github/workflows/frontend-deploy.yml
- name: Set up kubeconfig
  run: |
    mkdir -p ~/.kube
    echo "${{ secrets.KUBECONFIG }}" | base64 -d > ~/.kube/config

- name: Deploy frontend
  run: |
    kubectl apply -f frontend/k8s/deployment.yaml
    kubectl rollout status deployment/a4c-frontend
```

## Security Benefits

| Risk | Old Approach (cluster-admin) | New Approach (namespace-scoped) |
|------|----------------------------|--------------------------------|
| **Compromised GitHub Secret** | Attacker has full cluster control | Attacker limited to 2 namespaces |
| **Accidental Deletion** | Could delete entire cluster | Cannot delete critical resources |
| **Supply Chain Attack** | Malicious workflow could install backdoors | Limited blast radius |
| **Privilege Escalation** | Already has maximum privileges | Cannot escalate beyond namespace |
| **Audit Trail** | Hard to track what CI/CD needs | Clear role definitions |

## Maintenance

### Adding New Namespace Access

If GitHub Actions needs to deploy to a new namespace:

1. Create new Role:
```yaml
# role-new-namespace.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: github-actions-new-namespace-role
  namespace: new-namespace
rules:
  # Add required permissions
```

2. Create RoleBinding:
```yaml
# rolebinding-new-namespace.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: github-actions-new-namespace-binding
  namespace: new-namespace
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: github-actions-new-namespace-role
subjects:
- kind: ServiceAccount
  name: github-actions
  namespace: default
```

3. Apply changes:
```bash
kubectl apply -f infrastructure/k8s/rbac/role-new-namespace.yaml
kubectl apply -f infrastructure/k8s/rbac/rolebinding-new-namespace.yaml
```

### Rotating Service Account Token

For security, rotate the token periodically:

```bash
# 1. Delete old token secret
kubectl delete secret github-actions-token -n default

# 2. Recreate token secret
kubectl apply -f infrastructure/k8s/rbac/token-secret.yaml

# 3. Wait for Kubernetes to populate token
sleep 2

# 4. Extract new token and create kubeconfig
TOKEN=$(kubectl get secret github-actions-token -n default -o jsonpath='{.data.token}' | base64 -d)
# ... create new kubeconfig and update GitHub Secret
```

### Revoking Access

To completely revoke GitHub Actions access:

```bash
# Delete all RBAC resources
kubectl delete -f infrastructure/k8s/rbac/

# Or just delete the service account (cascades to tokens)
kubectl delete serviceaccount github-actions -n default
```

## Troubleshooting

### "Forbidden" Errors in GitHub Actions

**Symptom**: Workflow fails with:
```
Error from server (Forbidden): error when ... : "<resource>" is forbidden:
User "system:serviceaccount:default:github-actions" cannot <verb> resource "<resource>"
in API group "<apiGroup>" in the namespace "<namespace>"
```

**Solution**: Add missing permission to the appropriate Role:

```yaml
# Add to role-frontend.yaml or role-temporal.yaml
rules:
- apiGroups: ["<apiGroup>"]
  resources: ["<resource>"]
  verbs: ["<verb>"]
```

Then reapply:
```bash
kubectl apply -f infrastructure/k8s/rbac/role-frontend.yaml
# OR
kubectl apply -f infrastructure/k8s/rbac/role-temporal.yaml
```

### Token Expired

**Symptom**: `error: You must be logged in to the server (Unauthorized)`

**Solution**: Service account tokens should not expire, but if they do:

```bash
# Check token validity
kubectl --kubeconfig=~/.kube/config-github-actions cluster-info

# If expired, recreate token secret
kubectl delete secret github-actions-token -n default
kubectl apply -f infrastructure/k8s/rbac/token-secret.yaml

# Update GitHub Secret with new token
```

### Permission Verification

```bash
# List all permissions for github-actions service account
kubectl auth can-i --list --as=system:serviceaccount:default:github-actions -n default
kubectl auth can-i --list --as=system:serviceaccount:default:github-actions -n temporal
```

## References

- [Kubernetes RBAC Documentation](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Service Account Tokens](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Infrastructure CLAUDE.md](../../CLAUDE.md)
- [KUBECONFIG Update Guide](../../KUBECONFIG_UPDATE_GUIDE.md)

---

**Created**: 2025-11-03
**Last Updated**: 2025-11-03
**Maintainer**: Infrastructure Team
