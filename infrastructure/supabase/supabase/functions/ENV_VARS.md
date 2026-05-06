# Supabase Edge Functions - Environment Variables

## Required Environment Variables

These environment variables must be configured in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables.

### Supabase Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SUPABASE_URL` | Supabase project URL | `https://yourproject.supabase.co` | Yes (auto-set) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (LEGACY auto-injected; see APP_SECRET_KEY note below) | `eyJhbGc...` or `sb_secret_...` | No (fallback only) |
| `SUPABASE_ANON_KEY` | Anonymous key (LEGACY auto-injected; per-call resolution prefers request `apikey` header) | `eyJhbGc...` or `sb_publishable_...` | Yes (auto-set, fallback only) |
| `APP_SECRET_KEY` | **Preferred** secret key for admin operations — set explicitly to bypass the auto-inject bug ([supabase/supabase#37648](https://github.com/supabase/supabase/issues/37648)) | `sb_secret_...` | Yes (admin functions, set explicitly) |

**Why `APP_SECRET_KEY`?**

When migrating from legacy JWT keys to the new `sb_publishable_*`/`sb_secret_*` system, the auto-injected `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` Edge Function env vars retain the legacy JWT values even after legacy keys are disabled at the project level. Calls using those values fail at the API gateway with "Legacy API keys are disabled".

**Workarounds applied in `_shared/api-key-resolution.ts`**:
- **Anon key**: pulled from the inbound request's `apikey:` header (frontend always sends the current publishable key). The env var is fallback only.
- **Service role / secret key**: read from the custom-named `APP_SECRET_KEY` env var (the `SUPABASE_` prefix is reserved by the platform and can't be overridden via `supabase secrets set`). The auto-injected `SUPABASE_SERVICE_ROLE_KEY` is fallback only.

**Setting `APP_SECRET_KEY`**:
```bash
supabase secrets set APP_SECRET_KEY=sb_secret_YOUR_KEY --project-ref <project-ref>
```
Then redeploy Edge Functions (push to main, or `gh workflow run edge-functions-deploy.yml`).

> **⚠️ Operational Sequence Hazard — self-DOS via missing `APP_SECRET_KEY`**
>
> If you flip "Disable legacy API keys" in the Supabase Dashboard **before** `APP_SECRET_KEY` is set in Edge Function secrets, every admin Edge Function (`accept-invitation`, `invite-user`, `manage-user`, `validate-invitation`, `workflow-status`) will return "Legacy API keys are disabled" at the API gateway. Effective service outage on the invitation + user-management surface.
>
> **Pre-flight check before disabling legacy:**
> 1. `supabase secrets list --project-ref <ref>` — confirm `APP_SECRET_KEY` is present.
> 2. Trigger a redeploy AFTER the secret was set: `gh workflow run edge-functions-deploy.yml` (Edge Functions read env at invocation time but the auto-inject fixes for prefix-reserved vars require a redeploy to take effect — set the secret first, redeploy second).
> 3. Smoke a non-destructive admin call (e.g. `validate-invitation` with a stub token).
> 4. Only then flip the toggle.
>
> **Recovery if you got the order wrong**: re-enable legacy keys in the Dashboard (instant), set `APP_SECRET_KEY`, redeploy, smoke, then re-disable. No data loss; ~5 minutes of admin-call outage.

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
# Supabase (auto-configured by Supabase — fallback only after migration to new API keys)
SUPABASE_URL=<auto-set-by-supabase>
SUPABASE_SERVICE_ROLE_KEY=<auto-set-by-supabase>
SUPABASE_ANON_KEY=<auto-set-by-supabase>

# Custom-named secret key (PREFERRED for admin ops; bypasses auto-inject bug)
APP_SECRET_KEY=sb_secret_YOUR_KEY

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
