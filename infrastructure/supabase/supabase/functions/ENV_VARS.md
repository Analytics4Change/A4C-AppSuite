# Supabase Edge Functions - Environment Variables

## Required Environment Variables

These environment variables must be configured in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables.

### Supabase Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SUPABASE_URL` | Supabase project URL | `https://yourproject.supabase.co` | Yes (auto-set) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations | `eyJhbGc...` | Yes (auto-set) |
| `SUPABASE_ANON_KEY` | Anonymous key for client operations | `eyJhbGc...` | Yes (auto-set) |

### Backend API Configuration (Optional)

| Variable | Description | Example | Default | Required |
|----------|-------------|---------|---------|----------|
| `BACKEND_API_URL` | Backend API URL for workflow operations | `https://api-a4c.firstovertheline.com` | `https://api-a4c.firstovertheline.com` | No (has default) |

### Email Provider (Required for Invitation Functions)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `RESEND_API_KEY` | Resend API key for sending invitation emails | `re_xxxxxxxxxxxxx` | Yes (`invite-user`, `resend-invitation`) |

**Note**: The `invite-user` and `resend-invitation` functions will return HTTP 500 if `RESEND_API_KEY` is not set.

**Setting via CLI:**
```bash
supabase secrets set RESEND_API_KEY=re_YOUR_API_KEY --project-ref <project-ref>
```

**Getting a Resend API key:**
1. Sign up at https://resend.com
2. Navigate to **API Keys** → **Create API Key**
3. Copy the key (starts with `re_`)

**Functions requiring this variable:**

| Function | Purpose | Requires RESEND_API_KEY |
|----------|---------|------------------------|
| `invite-user` | Send user invitation emails | **Yes** |
| `resend-invitation` | Resend invitation emails | **Yes** |
| `validate-invitation` | Validate invitation tokens | No |
| `accept-invitation` | Accept invitation and create user | No |

## Configuration via Supabase Dashboard

1. Navigate to Supabase Dashboard
2. Select your project
3. Go to **Project Settings** → **Edge Functions** → **Environment Variables**
4. Verify the following variables are set:

```bash
# Supabase (auto-configured by Supabase)
SUPABASE_URL=<auto-set-by-supabase>
SUPABASE_SERVICE_ROLE_KEY=<auto-set-by-supabase>
SUPABASE_ANON_KEY=<auto-set-by-supabase>

# Backend API (optional - uses default if not set)
# BACKEND_API_URL=https://api-a4c.firstovertheline.com
```

## Deployment Method

Edge Functions are deployed automatically via GitHub Actions when changes are pushed to the `main` branch.

**Workflow**: `.github/workflows/edge-functions-deploy.yml`

**Manual deployment** (if needed):
```bash
cd infrastructure/supabase
supabase functions deploy organization-bootstrap
supabase functions deploy workflow-status
```

## Architecture (Phase 2: Backend API)

Edge Functions cannot connect directly to Temporal because they run in Deno Deploy
(external to the k8s cluster) and cannot reach k8s internal DNS addresses.

**Current Architecture** (2 hops via Backend API):
```
Frontend → Edge Function → Backend API (k8s) → Temporal
           ↓ (auth validation)
           (optional: PostgreSQL for audit)
```

**Alternative Architecture** (Frontend calls Backend API directly):
```
Frontend → Backend API (k8s) → Temporal
```

**Note**: The frontend `TemporalWorkflowClient` already supports calling the Backend API
directly when `VITE_BACKEND_API_URL` is configured. The Edge Function serves as a
fallback/proxy for backwards compatibility.

**Benefits of Backend API approach**:
- Works with Deno Deploy (no k8s internal DNS required)
- Single entry point for workflow operations
- Centralized authentication and authorization
- Immediate error feedback to frontend

**References**:
- Backend API Implementation: `dev/active/backend-api-implementation-status.md`
- Migration Context: `dev/active/temporal-worker-realtime-migration-context.md`
