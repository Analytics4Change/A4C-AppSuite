---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Step-by-step guide to manually configure Google OAuth for A4C-AppSuite via Google Cloud Console and Supabase Dashboard, including credential creation, redirect URI setup, and verification scripts.

**When to read**:
- Setting up Google OAuth for a new environment
- Rotating OAuth client secrets
- Troubleshooting OAuth configuration errors
- Verifying JWT custom claims are working

**Prerequisites**: Google Cloud Console access, Supabase project access

**Key topics**: `google-oauth`, `oauth-credentials`, `redirect-uri`, `supabase-dashboard`, `secret-rotation`

**Estimated read time**: 10 minutes
<!-- TL;DR-END -->

# OAuth Manual Setup Guide

This guide documents how to manually configure Google OAuth for the A4C-AppSuite. OAuth configuration is a one-time setup that rarely needs to be changed, so it's managed manually rather than via CI/CD.

## Prerequisites

Before configuring OAuth, you need:

1. **Google Cloud Console access** with permissions to create OAuth credentials
2. **Supabase project** with admin access
3. **Supabase Management API token** (Access Token from Dashboard → Account → Access Tokens)

## Step 1: Create Google OAuth Credentials

### 1.1 Go to Google Cloud Console

1. Navigate to [Google Cloud Console](https://console.cloud.google.com/)
2. Select or create a project for A4C-AppSuite

### 1.2 Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** (for public access) or **Internal** (for organization-only)
3. Fill in required fields:
   - **App name**: A4C-AppSuite
   - **User support email**: your email
   - **Developer contact**: your email
4. Click **Save and Continue**
5. Add scopes: `email`, `profile`, `openid`
6. Click **Save and Continue**
7. Add test users if using External type
8. Click **Save and Continue**

### 1.3 Create OAuth Client ID

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Select **Web application**
4. Configure:
   - **Name**: A4C-AppSuite Production
   - **Authorized JavaScript origins**:
     - `https://a4c.firstovertheline.com`
     - `https://*.firstovertheline.com` (for subdomains)
   - **Authorized redirect URIs**:
     - `https://tmrjlswbsxmbglmaclxu.supabase.co/auth/v1/callback`
     - (Replace `tmrjlswbsxmbglmaclxu` with your project ref)
5. Click **Create**
6. **Save** the Client ID and Client Secret securely

## Step 2: Configure Supabase OAuth

### Option A: Using the Script (Recommended)

```bash
cd infrastructure/supabase

# Set environment variables
export SUPABASE_ACCESS_TOKEN="your-management-api-token"
export SUPABASE_PROJECT_REF="tmrjlswbsxmbglmaclxu"
export GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"

# Run configuration script
./scripts/configure-google-oauth.sh
```

### Option B: Using Supabase Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Authentication → Providers**
4. Find **Google** and click **Enable**
5. Enter:
   - **Client ID**: from Google Cloud Console
   - **Client Secret**: from Google Cloud Console
6. Click **Save**

### Option C: Using Management API Directly

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "external_google_enabled": true,
    "external_google_client_id": "YOUR_CLIENT_ID",
    "external_google_secret": "YOUR_CLIENT_SECRET"
  }'
```

## Step 3: Verify Configuration

### 3.1 Verify via API

```bash
cd infrastructure/supabase
export SUPABASE_ACCESS_TOKEN="your-access-token"
./scripts/verify-oauth-config.sh
```

Expected output:
```
✅ Google OAuth is enabled
   Client ID: xxxxxxx.apps.googleusercontent.com
```

### 3.2 Generate Test OAuth URL

```bash
./scripts/test-oauth-url.sh
```

This generates a URL you can open in a browser to test the OAuth flow.

### 3.3 Full OAuth Flow Test

```bash
npm install @supabase/supabase-js  # First time only
node scripts/test-google-oauth.js
```

This tests the complete OAuth flow including token exchange.

## Step 4: Verify JWT Custom Claims

After OAuth is configured, verify that JWT custom claims (org_id, permissions, role) are being added:

1. Run the JWT hook verification SQL:
   ```bash
   # Copy contents of scripts/verify-jwt-hook-complete.sql
   # Execute in Supabase SQL Editor
   ```

2. Check for:
   - Hook function exists in `auth` schema
   - Hook is registered in `auth.hooks`
   - Claims are properly formatted

## When to Reconfigure OAuth

OAuth reconfiguration is needed when:

- **Client secret rotation**: Security best practice (annually)
- **Domain changes**: If the application URL changes
- **Project migration**: Moving to a new Supabase project
- **Adding providers**: Enabling additional OAuth providers (GitHub, Apple, etc.)

## Troubleshooting

### "redirect_uri_mismatch" Error

**Cause**: The callback URL in Supabase doesn't match what's registered in Google Cloud Console.

**Fix**:
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Edit your OAuth client
3. Add the exact callback URL:
   ```
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

### User Shows "viewer" Role Instead of Expected Role

**Cause**: JWT custom claims hook is not running or misconfigured.

**Fix**:
1. Run `scripts/verify-jwt-hook-complete.sql` in SQL Editor
2. Verify hook is registered in Dashboard → Authentication → Hooks
3. Check that `auth.custom_access_token_hook` function exists

### OAuth Works But User Not Linked to Organization

**Cause**: User needs to be invited to an organization.

**Fix**:
1. Ensure user has been invited via the organization bootstrap workflow
2. Check `user_roles_projection` table for role assignment
3. Verify the invitation was accepted

### "Invalid client" Error

**Cause**: Client ID or secret is incorrect.

**Fix**:
1. Verify credentials in Google Cloud Console
2. Re-run `configure-google-oauth.sh` with correct credentials
3. Check for extra whitespace in environment variables

## Available Scripts

| Script | Purpose |
|--------|---------|
| `configure-google-oauth.sh` | Configure Google OAuth provider |
| `verify-oauth-config.sh` | Verify OAuth is enabled and configured |
| `test-oauth-url.sh` | Generate OAuth URL for browser testing |
| `test-google-oauth.js` | Full OAuth flow test with SDK |
| `verify-auth-hook-registration.sh` | Verify JWT custom claims hook |
| `verify-jwt-hook-complete.sql` | SQL to diagnose JWT hook issues |

## Security Notes

1. **Never commit OAuth secrets to git** - Use environment variables or secret managers
2. **Rotate client secrets annually** - Generate new secret in Google Console, update Supabase
3. **Limit OAuth scopes** - Only request `email`, `profile`, `openid`
4. **Monitor failed logins** - Check Supabase Auth logs for unusual patterns
5. **Use HTTPS only** - OAuth requires secure connections

## Reference Documentation

- [Supabase Auth with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [A4C OAuth Testing Guide](./OAUTH-TESTING.md)
- [JWT Custom Claims Setup](./JWT-CLAIMS-SETUP.md)
