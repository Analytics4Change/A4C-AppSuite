# GitHub App Setup for GHCR Access

This guide walks through creating a GitHub App for the frontend deployment workflow.

## Why We Need a GitHub App

The `frontend-deploy.yml` workflow uses a GitHub App to:
1. **Authenticate to GitHub Container Registry (GHCR)** - Push Docker images
2. **Generate short-lived tokens** - More secure than long-lived PATs
3. **Grant fine-grained permissions** - Only what the workflow needs

## Step 1: Create GitHub App

### 1.1 Navigate to GitHub App Creation

**For Organization** (Recommended):
- Go to: https://github.com/organizations/Analytics4Change/settings/apps/new

**For Personal Account** (Alternative):
- Go to: https://github.com/settings/apps/new

### 1.2 Fill in Basic Information

**GitHub App Name**:
```
A4C-AppSuite-CI-CD
```

**Homepage URL**:
```
https://github.com/Analytics4Change/A4C-AppSuite
```

**Description** (Optional):
```
GitHub App for A4C-AppSuite CI/CD workflows - Docker image builds and GHCR push access
```

### 1.3 Configure Permissions

Scroll to **Repository permissions** section:

**Contents**: `Read-only`
- Reason: Checkout repository code

**Packages**: `Read and write`
- Reason: Push Docker images to GHCR

**Metadata**: `Read-only` (Auto-selected, required)

### 1.4 Configure Where This App Can Be Installed

Select: **Only on this account** (Analytics4Change)

### 1.5 Create the App

Click **Create GitHub App**

## Step 2: Generate Private Key

After creating the app:

1. Scroll down to **Private keys** section
2. Click **Generate a private key**
3. A `.pem` file will download to your computer
4. **Save this file securely** - we'll use it in Step 4

## Step 3: Install the App to Repository

1. After app creation, click **Install App** in the left sidebar
2. Select **Analytics4Change** organization (or your account)
3. Choose **Only select repositories**
4. Select **A4C-AppSuite** repository
5. Click **Install**

## Existing A4C-CICD App (USED FOR THIS PROJECT)

**This project uses the existing A4C-CICD GitHub App** instead of creating a new one.

### Current Configuration

- **App Name**: A4C-CICD
- **App ID**: `1976105`
- **Installation ID**: `86566483`
- **Private Key Location**: `/home/lars/.ssh/a4c-cicd.2025-09-18.private-key.pem`
- **Permissions**:
  - Contents: Read
  - Packages: Read & Write (for GHCR)
  - Pull Requests: Read
  - Actions: Read
  - Metadata: Read

### Private Key Security

⚠️ **IMPORTANT**: The private key is stored at:
```
/home/lars/.ssh/a4c-cicd.2025-09-18.private-key.pem
```

**Security Notes**:
- ✅ File is in `.ssh` directory (proper permissions)
- ✅ Added to GitHub Secrets (APP_PRIVATE_KEY)
- ⚠️ Keep this file secure and never commit to git
- ⚠️ Rotate periodically for security

## Step 4: Extract Required Information

### 4.1 Get App ID (ALREADY CONFIGURED)

**Current App ID**: `1976105`

From the GitHub App page (https://github.com/organizations/Analytics4Change/settings/apps/a4c-cicd):

Look for **App ID** near the top of the page.

### 4.2 Get Installation ID (ALREADY CONFIGURED)

**Current Installation ID**: `86566483`

**Method 1 - Via gh CLI**:
```bash
gh api /repos/Analytics4Change/A4C-AppSuite/installation | jq '.id'
```

**Method 2 - Via URL**:
After installing, the URL will look like:
```
https://github.com/organizations/Analytics4Change/settings/installations/86566483
```
The number at the end is the installation ID.

### 4.3 Get Private Key (ALREADY EXISTS)

**Current Private Key**: `/home/lars/.ssh/a4c-cicd.2025-09-18.private-key.pem`

This is the `.pem` file that was generated when the A4C-CICD app was created.

**Convert to single-line format for GitHub Secret**:
```bash
# Navigate to where the .pem file was downloaded
cd ~/Downloads

# Convert multiline PEM to single line (preserving newlines as \n)
cat a4c-appsuite-ci-cd.*.private-key.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}'
```

Copy the entire output (it will be one long line with `\n` characters).

## Step 5: Set GitHub Secrets

Now we'll add the secrets to the repository:

### 5.1 APP_ID

```bash
gh secret set APP_ID --repo Analytics4Change/A4C-AppSuite --body "<YOUR_APP_ID>"
```

Example:
```bash
gh secret set APP_ID --repo Analytics4Change/A4C-AppSuite --body "123456"
```

### 5.2 INSTALLATION_ID

```bash
gh secret set INSTALLATION_ID --repo Analytics4Change/A4C-AppSuite --body "<YOUR_INSTALLATION_ID>"
```

### 5.3 APP_PRIVATE_KEY

```bash
# Paste the single-line private key
cat ~/Downloads/a4c-appsuite-ci-cd.*.private-key.pem | gh secret set APP_PRIVATE_KEY --repo Analytics4Change/A4C-AppSuite
```

### 5.4 GHCR_PULL_TOKEN

For GHCR authentication, we need a token. The GitHub App token can be used, OR create a PAT:

**Option A - Use GITHUB_TOKEN** (Recommended - workflow already has this):

The workflow can use the built-in `GITHUB_TOKEN` for GHCR. Let me update the workflow to use it.

**Option B - Create Personal Access Token**:

1. Go to: https://github.com/settings/tokens?type=beta
2. Click **Generate new token** (Fine-grained)
3. Token name: `A4C-AppSuite-GHCR`
4. Repository access: **Only select repositories** → `A4C-AppSuite`
5. Permissions:
   - **Packages**: `Read and write`
6. Click **Generate token**
7. Copy the token and set secret:

```bash
gh secret set GHCR_PULL_TOKEN --repo Analytics4Change/A4C-AppSuite --body "<YOUR_TOKEN>"
```

## Step 6: Verify Secrets Are Set

```bash
gh secret list --repo Analytics4Change/A4C-AppSuite
```

Expected output:
```
APP_ID               2025-11-03T...
APP_PRIVATE_KEY      2025-11-03T...
GHCR_PULL_TOKEN      2025-11-03T...
INSTALLATION_ID      2025-11-03T...
KUBECONFIG          2025-11-03T...
```

## Step 7: Test Deployment

Trigger the workflow again:

```bash
gh workflow run "Deploy Frontend" --repo Analytics4Change/A4C-AppSuite
```

Monitor the run:
```bash
gh run list --repo Analytics4Change/A4C-AppSuite --workflow="Deploy Frontend" --limit 1
```

View logs if it fails:
```bash
gh run view <RUN_ID> --repo Analytics4Change/A4C-AppSuite --log
```

## Troubleshooting

### "Error: Input required and not supplied: app_id"

**Cause**: `APP_ID` secret not set or set incorrectly

**Solution**: Verify secret exists:
```bash
gh secret list --repo Analytics4Change/A4C-AppSuite | grep APP_ID
```

### "Bad credentials" when pushing to GHCR

**Cause**: `GHCR_PULL_TOKEN` is invalid or expired

**Solution**: Regenerate token and update secret

### "Error: Resource not accessible by integration"

**Cause**: GitHub App doesn't have correct permissions

**Solution**:
1. Go to GitHub App settings
2. Verify **Packages** permission is set to "Read and write"
3. Save changes
4. Reinstall the app if needed

### GitHub App Not Found

**Cause**: Installation ID is wrong or app not installed to repository

**Solution**:
```bash
# Get correct installation ID
gh api /repos/Analytics4Change/A4C-AppSuite/installation | jq '.id'
```

## Alternative: Use GITHUB_TOKEN Instead

If you prefer not to create a GitHub App, we can modify the workflow to use the built-in `GITHUB_TOKEN`:

**Edit `.github/workflows/frontend-deploy.yml`**:

1. Remove the "Get GitHub App Token" step (lines 34-40)
2. Update "Log in to Container Registry" to use `secrets.GITHUB_TOKEN`:

```yaml
- name: Log in to Container Registry
  uses: docker/login-action@v3
  with:
    registry: ${{ env.REGISTRY }}
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

This is simpler but less flexible than a GitHub App.

## Security Considerations

### GitHub App vs Personal Access Token

**GitHub App (Recommended)**:
- ✅ Short-lived tokens (expire after 1 hour)
- ✅ Installation-scoped permissions
- ✅ Auditable (shows as "App" in logs)
- ✅ Can be revoked centrally

**Personal Access Token**:
- ❌ Long-lived (up to 1 year)
- ❌ User-scoped (broader access)
- ❌ Shows as user in audit logs
- ❌ Requires manual rotation

### Private Key Security

- ⚠️ **Never commit the `.pem` file to git**
- ✅ Store securely in GitHub Secrets
- ✅ Rotate periodically (generate new key, update secret)
- ✅ Delete old private keys after rotation

## Next Steps

After secrets are configured:

1. ✅ GitHub App created and installed
2. ✅ All secrets set (APP_ID, APP_PRIVATE_KEY, INSTALLATION_ID, GHCR_PULL_TOKEN)
3. → Test deployment workflow
4. → Verify Docker image pushed to GHCR
5. → Verify Kubernetes deployment succeeds
6. → Delete old cluster-admin binding

---

**Created**: 2025-11-03
**Purpose**: Setup GitHub App for A4C-AppSuite CI/CD
