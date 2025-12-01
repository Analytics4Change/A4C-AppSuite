# Supabase Edge Functions - Environment Variables

## Required Environment Variables

These environment variables must be configured in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables.

### Supabase Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SUPABASE_URL` | Supabase project URL | `https://yourproject.supabase.co` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations | `eyJhbGc...` | Yes |
| `SUPABASE_ANON_KEY` | Anonymous key for client operations | `eyJhbGc...` | Yes |

### Temporal Configuration (Phase 1: Direct RPC)

| Variable | Description | Example | Default | Required |
|----------|-------------|---------|---------|----------|
| `TEMPORAL_ADDRESS` | Temporal gRPC server address | `temporal-frontend.temporal.svc.cluster.local:7233` | `temporal-frontend.temporal.svc.cluster.local:7233` | No (has default) |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `default` | `default` | No (has default) |

## Configuration via Supabase Dashboard

1. Navigate to Supabase Dashboard
2. Select your project
3. Go to **Project Settings** → **Edge Functions** → **Environment Variables**
4. Add the following variables:

```bash
# Supabase (auto-configured)
SUPABASE_URL=<auto-set-by-supabase>
SUPABASE_SERVICE_ROLE_KEY=<auto-set-by-supabase>
SUPABASE_ANON_KEY=<auto-set-by-supabase>

# Temporal (add these manually)
TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
TEMPORAL_NAMESPACE=default
```

## Deployment Method

Edge Functions are deployed automatically via GitHub Actions when changes are pushed to the `main` branch.

**Workflow**: `.github/workflows/edge-functions-deploy.yml`

**Manual deployment** (if needed):
```bash
cd infrastructure/supabase
supabase functions deploy organization-bootstrap
```

## Architecture Change (Phase 1)

**Previous Architecture** (5 hops):
```
Frontend → Edge Function → PostgreSQL → Realtime → Worker → Temporal
```

**New Architecture** (2 hops):
```
Frontend → Edge Function → Temporal
          ↓ (parallel)
          PostgreSQL (audit trail)
```

**Benefits**:
- Reduced latency (~500ms improvement)
- Immediate error feedback to frontend
- Simpler debugging (no event listener chain)
- Local development matches production

**References**:
- Implementation Plan: `dev/active/architecture-simplification-option-c.md`
- Migration Context: `dev/active/temporal-worker-realtime-migration-context.md`
