# CI/CD Setup Instructions for A4C-FrontEnd

This guide will walk you through setting up automated deployment for the A4C-FrontEnd React application.

## Prerequisites

- ✅ GitHub repository is private (`lars-tice/A4C-FrontEnd`)
- ✅ k3s cluster running with Cloudflare tunnel
- ✅ Domain `a4c.firstovertheline.com` configured

## Step 1: Create GitHub App (15 minutes)

### 1.1 Create the App
1. Go to GitHub **Settings** → **Developer settings** → **GitHub Apps**
2. Click **New GitHub App**
3. Fill out the form:
   - **GitHub App name**: `A4C-FrontEnd-CI-CD` (must be globally unique)
   - **Description**: `Automated CI/CD for A4C Frontend deployments`
   - **Homepage URL**: `https://a4c.firstovertheline.com`
   - **Webhook URL**: `https://example.com` (placeholder)
   - **Webhook secret**: Leave blank
   - **SSL verification**: Enabled (default)

### 1.2 Configure Permissions
Set these **Repository permissions**:
- **Actions**: Read
- **Contents**: Read
- **Metadata**: Read
- **Packages**: Write
- **Pull requests**: Read

Leave **Account permissions** as "No access"

### 1.3 Installation Settings
- **Where can this GitHub App be installed?**: Select **"Only allow this GitHub App to be installed on the @lars-tice account"**

### 1.4 Create and Install
1. Click **Create GitHub App**
2. **Save the App ID** (you'll see it on the next page)
3. Scroll down to **Private keys** → Click **Generate a private key**
4. **Download the .pem file** and keep it secure
5. Click **Install App** in left sidebar
6. Click **Install** next to your username
7. Select **Selected repositories** → Choose `A4C-FrontEnd`
8. Click **Install**
9. **Note the Installation ID** from the URL (e.g., `https://github.com/settings/installations/12345678`)

## Step 2: Configure Repository Secrets (5 minutes)

In your `A4C-FrontEnd` repository:
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add these:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `APP_ID` | Your GitHub App ID | From Step 1.4 |
| `APP_PRIVATE_KEY` | Complete .pem file content | Include headers and footers |
| `INSTALLATION_ID` | Installation ID from URL | From Step 1.4 |
| `KUBECONFIG` | k3s kubeconfig content | Base64 encoded kubeconfig |

### Get KUBECONFIG content:
```bash
base64 -w 0 /home/lars/dev/A4C-LocalHosting/k3s-kubeconfig.yaml
```

## Step 3: Add Files to Repository

Copy these files to your `A4C-FrontEnd` repository:

### Required Files:
```
A4C-FrontEnd/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions workflow
├── k8s/
│   ├── deployment.yaml         # k8s deployment
│   ├── service.yaml           # k8s service
│   └── ingress.yaml           # k8s ingress with SSL
├── docs/
│   ├── CI-CD-SETUP.md         # This file
│   ├── DEPLOYMENT-PROCESS.md   # How it works
│   └── TROUBLESHOOTING.md     # Common issues
└── Dockerfile                 # Production container build
```

## Step 4: Test the Pipeline

1. **Commit and push** all the new files to the `main` branch:
```bash
git add .
git commit -m "Add automated CI/CD pipeline"
git push origin main
```

2. **Monitor the workflow**:
   - Go to your repository → **Actions** tab
   - You should see the "Deploy A4C-FrontEnd" workflow running

3. **Expected timeline**:
   - Build stage: ~2-3 minutes
   - Deploy stage: ~1-2 minutes  
   - Total: ~4-5 minutes

## Step 5: Verify Success

After the workflow completes:
1. Check https://a4c.firstovertheline.com loads correctly
2. Verify new container is running:
```bash
kubectl get pods -l app=a4c-frontend
kubectl describe deployment a4c-frontend
```

## What Happens on Each Push

1. **Trigger**: Any push to `main` branch
2. **Build**: 
   - Install Node.js dependencies
   - Run tests (if any)
   - Build React app (`npm run build`)
   - Build Docker container
   - Push to GitHub Container Registry
3. **Deploy**:
   - Update k3s deployment with new image
   - Rolling update (zero downtime)
   - Health checks verify deployment
   - Report success/failure

## Security Features

- ✅ **GitHub App authentication** (most secure method)
- ✅ **Private container registry** (ghcr.io)
- ✅ **Scoped permissions** (only what's needed)
- ✅ **Secrets management** (encrypted in GitHub)
- ✅ **Production environment** (deployment protection)

## Next Steps

- **Team access**: Add collaborators to repository
- **Branch protection**: Require PR reviews for main branch
- **Staging environment**: Add staging branch deployments  
- **Monitoring**: Add application performance monitoring
- **Backup**: Regular k3s cluster backups

## Support

If you encounter issues:
1. Check the **Actions** tab for detailed logs
2. Review **TROUBLESHOOTING.md** for common problems
3. Verify all secrets are configured correctly
4. Test kubectl access manually