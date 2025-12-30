---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Complete guide for deploying Supabase Edge Functions covering local development with Supabase CLI, GitHub Actions automated deployment, secrets management, monitoring/logging, and troubleshooting common issues (CORS, timeouts, 500 errors).

**When to read**:
- Creating new Edge Functions for workflow triggers
- Setting up CI/CD for Edge Function deployment
- Debugging Edge Function errors or CORS issues
- Configuring secrets (RESEND_API_KEY, SERVICE_ROLE_KEY)

**Prerequisites**: Supabase CLI installed, GitHub repository access

**Key topics**: `edge-functions`, `deno`, `github-actions-deploy`, `cors`, `supabase-secrets`

**Estimated read time**: 25 minutes
<!-- TL;DR-END -->

# Edge Functions Deployment Guide

## Overview

This guide covers deployment of Supabase Edge Functions for the A4C AppSuite. Edge Functions are serverless Deno functions that run on Supabase's global edge network, providing low-latency API endpoints for triggering workflows and executing business logic.

**Key Features**:
- **Runtime**: Deno (TypeScript/JavaScript)
- **Deployment**: Automated via GitHub Actions
- **Global CDN**: Sub-100ms response times worldwide
- **Auto-scaling**: Handles traffic spikes automatically
- **Secrets**: Managed via Supabase Dashboard or CLI

## Architecture

```mermaid
graph LR
    A[Frontend UI] -->|HTTPS POST| B[Edge Function]
    B -->|Service Role| C[PostgreSQL]
    C -->|INSERT event| D[domain_events]
    D -->|Trigger| E[PostgreSQL NOTIFY]
    E -->|Channel| F[Temporal Worker]
    F -->|Start| G[Workflow]
```

**Edge Functions in A4C**:
- `create-organization`: Validates input, emits `organization.bootstrap_initiated` event
- *(Future)* `invite-user`: Emits `user.invitation_initiated` event
- *(Future)* `update-subscription`: Emits `subscription.upgrade_initiated` event

## Prerequisites

### 1. Supabase CLI

Install Supabase CLI (required for local testing):

```bash
# Install via Homebrew (macOS/Linux)
brew install supabase/tap/supabase

# Or via npm
npm install -g supabase

# Verify installation
supabase --version
```

### 2. Supabase Project

You'll need:
- Supabase project reference ID (e.g., `tmrjlswbsxmbglmaclxu`)
- Supabase access token (for CLI/GitHub Actions)

**Get Project Reference**:
```bash
# Via Supabase Dashboard
# Settings → General → Reference ID

# Or via CLI
supabase projects list
```

**Generate Access Token**:
1. Go to https://supabase.com/dashboard/account/tokens
2. Click "Generate New Token"
3. Name: "GitHub Actions Deployment"
4. Save token securely (shown only once)

### 3. GitHub Repository Secrets

Add secrets to GitHub repository for CI/CD:

```bash
# Navigate to repository
# Settings → Secrets and variables → Actions → New repository secret

# Add these secrets:
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SUPABASE_PROJECT_REF=tmrjlswbsxmbglmaclxu
```

## Local Development

### Project Structure

```
infrastructure/supabase/
├── functions/
│   ├── create-organization/
│   │   ├── index.ts           # Function handler
│   │   └── README.md          # Function documentation
│   ├── invite-user/
│   │   └── index.ts
│   └── _shared/               # Shared utilities
│       ├── cors.ts            # CORS headers
│       ├── validation.ts      # Input validation
│       └── types.ts           # TypeScript types
└── config.toml                # Supabase configuration
```

### Initialize Supabase Project

Link local directory to Supabase project:

```bash
cd infrastructure/supabase

# Initialize (creates config.toml if doesn't exist)
supabase init

# Link to remote project
supabase link --project-ref tmrjlswbsxmbglmaclxu
```

### Create New Function

```bash
# Create function directory
supabase functions new create-organization

# This creates:
# - functions/create-organization/index.ts
```

**Example Function** (`functions/create-organization/index.ts`):

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { name, slug, owner_email, tier, subdomain_enabled } = await req.json();

    // Validate input
    if (!name || !slug || !owner_email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: name, slug, owner_email' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return new Response(
        JSON.stringify({ error: 'Slug must be lowercase alphanumeric with hyphens' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Generate organization ID
    const organizationId = crypto.randomUUID();

    // Emit event to trigger workflow
    const { data: event, error } = await supabase
      .from('domain_events')
      .insert({
        event_type: 'organization.bootstrap_initiated',
        aggregate_type: 'organization',
        aggregate_id: organizationId,
        event_data: {
          name,
          slug,
          owner_email,
          tier: tier || 'free',
          subdomain_enabled: subdomain_enabled || false
        },
        event_metadata: {
          timestamp: new Date().toISOString(),
          tags: ['production', 'edge-function'],
          source: 'api',
          correlation_id: req.headers.get('X-Correlation-ID') || crypto.randomUUID()
        }
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to emit event:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to start workflow' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Return 202 Accepted (async processing)
    return new Response(
      JSON.stringify({
        event_id: event.id,
        organization_id: organizationId,
        message: 'Organization creation started'
      }),
      {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
```

### Run Function Locally

```bash
# Start local Supabase (includes Edge Functions runtime)
supabase start

# Serve specific function
supabase functions serve create-organization

# Function available at:
# http://localhost:54321/functions/v1/create-organization
```

### Test Function Locally

```bash
# Test with curl
curl -X POST http://localhost:54321/functions/v1/create-organization \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "name": "Test Organization",
    "slug": "test-org",
    "owner_email": "owner@test.com",
    "tier": "free",
    "subdomain_enabled": false
  }'

# Expected response (202 Accepted):
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "organization_id": "660e8400-e29b-41d4-a716-446655440001",
  "message": "Organization creation started"
}
```

**Verify Event Emitted**:

```bash
# Check domain_events table
supabase db sql "SELECT * FROM domain_events ORDER BY created_at DESC LIMIT 1;"
```

## Manual Deployment

Deploy functions manually via Supabase CLI:

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy create-organization

# Deploy with environment variables
supabase secrets set MY_SECRET=value
supabase functions deploy create-organization
```

**Verify Deployment**:

```bash
# List deployed functions
supabase functions list

# Expected output:
# create-organization (v1.0.0) - deployed 2 minutes ago
```

**Test Production Function**:

```bash
# Get function URL
# https://<project-ref>.supabase.co/functions/v1/create-organization

curl -X POST https://tmrjlswbsxmbglmaclxu.supabase.co/functions/v1/create-organization \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "name": "Production Org",
    "slug": "prod-org",
    "owner_email": "owner@prod.com"
  }'
```

## Automated Deployment (GitHub Actions)

### Workflow Configuration

GitHub Actions workflow deploys Edge Functions automatically on push to `main` branch.

**File**: `.github/workflows/edge-functions-deploy.yml`

```yaml
name: Deploy Edge Functions

on:
  push:
    branches:
      - main
    paths:
      - 'infrastructure/supabase/functions/**'
      - '.github/workflows/edge-functions-deploy.yml'

  workflow_dispatch: # Manual trigger

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Deploy Edge Functions
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
        run: |
          cd infrastructure/supabase
          supabase functions deploy --project-ref $SUPABASE_PROJECT_REF

      - name: Verify deployment
        run: |
          echo "✅ Edge Functions deployed successfully"
          echo "Project: ${{ secrets.SUPABASE_PROJECT_REF }}"
```

### Trigger Deployment

**Automatic Trigger**:
```bash
# Make changes to function
vi infrastructure/supabase/functions/create-organization/index.ts

# Commit and push
git add infrastructure/supabase/functions/
git commit -m "feat(edge-functions): Update create-organization validation"
git push origin main

# GitHub Actions automatically deploys
```

**Manual Trigger**:
1. Go to GitHub repository
2. Navigate to "Actions" tab
3. Select "Deploy Edge Functions" workflow
4. Click "Run workflow" → "Run workflow"

### Monitor Deployment

```bash
# View GitHub Actions logs
# Go to: https://github.com/Analytics4Change/A4C-AppSuite/actions

# Or use GitHub CLI
gh run list --workflow=edge-functions-deploy.yml
gh run view <run-id> --log
```

## Environment Variables and Secrets

### Built-in Variables

Edge Functions have access to these environment variables automatically:

- `SUPABASE_URL`: Your project's Supabase URL
- `SUPABASE_ANON_KEY`: Anonymous API key (public)
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (bypasses RLS)

### Custom Secrets

Add custom secrets for API keys, tokens, etc.

**Via CLI**:
```bash
# Set secret
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# List secrets
supabase secrets list

# Unset secret
supabase secrets unset RESEND_API_KEY
```

**Via Supabase Dashboard**:
1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/settings/functions
2. Navigate to "Edge Functions" → "Secrets"
3. Add secret: Name = `RESEND_API_KEY`, Value = `re_xxx...`
4. Click "Save"

**Use in Function**:
```typescript
const resendApiKey = Deno.env.get('RESEND_API_KEY');

if (!resendApiKey) {
  throw new Error('RESEND_API_KEY not configured');
}

// Use API key
const response = await fetch('https://api.resend.com/emails', {
  headers: {
    'Authorization': `Bearer ${resendApiKey}`,
    'Content-Type': 'application/json'
  }
});
```

## Function Monitoring

### Logs

**Via Supabase Dashboard**:
1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/logs/edge-functions
2. Select function: `create-organization`
3. View real-time logs

**Via CLI**:
```bash
# Stream logs for specific function
supabase functions logs create-organization --follow

# Filter by error level
supabase functions logs create-organization --level error
```

**Log from Function**:
```typescript
// Use console.log, console.error in function code
console.log('Organization created:', organizationId);
console.error('Validation failed:', error);
```

### Metrics

**Via Supabase Dashboard**:
1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/functions
2. View metrics:
   - Invocations (requests/hour)
   - Errors (error rate %)
   - Duration (p50, p95, p99 latency)
   - Region distribution

**Key Metrics**:
- **Invocations**: 10-50 requests/hour (expected for org creation)
- **Error Rate**: <1% (target)
- **P95 Latency**: <500ms (target)
- **Cold Start**: <100ms (Deno is fast)

## Troubleshooting

### Function Not Deploying

**Error**: `Error: Failed to deploy function`

**Check**:
```bash
# Verify CLI authentication
supabase projects list

# Verify project link
cd infrastructure/supabase
cat .supabase/config.toml | grep project_id

# Re-link if needed
supabase link --project-ref YOUR_PROJECT_REF
```

### Function Returns 500 Error

**Error**: `Internal server error`

**Check Logs**:
```bash
# View recent errors
supabase functions logs create-organization --level error --tail 50

# Common causes:
# 1. Missing environment variable
# 2. Invalid Supabase client initialization
# 3. Syntax error in function code
```

**Fix**:
```typescript
// Add error handling
try {
  // Function logic
} catch (error) {
  console.error('Unexpected error:', error); // Log to Supabase
  return new Response(
    JSON.stringify({ error: 'Internal server error' }),
    { status: 500 }
  );
}
```

### CORS Errors in Browser

**Error**: `CORS policy: No 'Access-Control-Allow-Origin' header`

**Fix**: Add CORS headers to all responses:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Or specific origin
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Handle preflight
if (req.method === 'OPTIONS') {
  return new Response('ok', { headers: corsHeaders });
}

// Add to all responses
return new Response(JSON.stringify(data), {
  status: 200,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
```

### Function Timeout

**Error**: `Function execution timed out`

**Default Timeout**: 150 seconds (Edge Functions limit)

**Optimization**:
```typescript
// ❌ Bad: Synchronous workflow execution (slow)
const result = await executeWorkflow(); // Waits for completion

// ✅ Good: Async event emission (fast)
await supabase.from('domain_events').insert({ ... }); // Returns immediately
return new Response(JSON.stringify({ status: 'processing' }), { status: 202 });
```

### Event Not Triggering Workflow

**Check Database Trigger**:
```sql
-- Verify trigger exists
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'process_organization_bootstrap_initiated';
```

**Check Event Emitted**:
```sql
-- Check domain_events table
SELECT * FROM domain_events
WHERE event_type = 'organization.bootstrap_initiated'
ORDER BY created_at DESC
LIMIT 5;
```

**Check Worker Listening**:
```bash
# Check worker logs
kubectl logs -n temporal-workers deployment/bootstrap-worker --tail=50 | grep "workflow_events"

# Should see: "Listening on channel: workflow_events"
```

## Best Practices

### 1. Always Return 202 for Async Operations

```typescript
// ✅ Good: 202 Accepted for workflow triggers
return new Response(JSON.stringify({ event_id, organization_id }), {
  status: 202, // Accepted, processing asynchronously
  headers: { 'Content-Type': 'application/json' }
});

// ❌ Bad: 200 OK implies synchronous completion
return new Response(JSON.stringify({ organization_id }), {
  status: 200 // Misleading
});
```

### 2. Validate Input Thoroughly

```typescript
// Validate all required fields
if (!name || !slug || !owner_email) {
  return new Response(
    JSON.stringify({ error: 'Missing required fields' }),
    { status: 400 }
  );
}

// Validate formats
if (!/^[a-z0-9-]+$/.test(slug)) {
  return new Response(
    JSON.stringify({ error: 'Invalid slug format' }),
    { status: 400 }
  );
}

// Validate email
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner_email)) {
  return new Response(
    JSON.stringify({ error: 'Invalid email format' }),
    { status: 400 }
  );
}
```

### 3. Use Service Role Key (Not Anon Key)

```typescript
// ✅ Good: Service role bypasses RLS
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // Bypasses RLS
);

// ❌ Bad: Anon key enforces RLS (may fail)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')! // Enforces RLS
);
```

### 4. Log Errors for Debugging

```typescript
try {
  // Function logic
} catch (error) {
  console.error('Error:', error); // Logged to Supabase
  return new Response(
    JSON.stringify({ error: 'Internal server error' }),
    { status: 500 }
  );
}
```

### 5. Include Correlation IDs

```typescript
const correlationId = req.headers.get('X-Correlation-ID') || crypto.randomUUID();

await supabase.from('domain_events').insert({
  event_metadata: {
    correlation_id: correlationId, // For distributed tracing
    timestamp: new Date().toISOString()
  }
});
```

## Security Considerations

### 1. Never Expose Service Role Key to Client

**Edge Function**: ✅ Safe (server-side)
**Frontend**: ❌ Dangerous (client-side)

```typescript
// ✅ Good: Service role in Edge Function (secure)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ❌ Bad: Service role in frontend (INSECURE!)
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY // NEVER DO THIS
);
```

### 2. Implement Rate Limiting (Future)

```typescript
// TODO: Implement rate limiting
// - 10 org creations per user per hour
// - 100 requests per IP per minute
```

### 3. Validate JWT Tokens

```typescript
// Extract user from JWT
const authHeader = req.headers.get('Authorization');
const token = authHeader?.replace('Bearer ', '');

const { data: { user }, error } = await supabase.auth.getUser(token);

if (error || !user) {
  return new Response(
    JSON.stringify({ error: 'Unauthorized' }),
    { status: 401 }
  );
}

// Include user_id in event metadata
event_metadata: {
  user_id: user.id,
  timestamp: new Date().toISOString()
}
```

## Related Documentation

- **Triggering Workflows Guide**: `documentation/workflows/guides/triggering-workflows.md`
- **Event Metadata Schema**: `documentation/workflows/reference/event-metadata-schema.md`
- **Event-Driven Architecture**: `documentation/architecture/workflows/event-driven-workflow-triggering.md`
- **Supabase Edge Functions Docs**: https://supabase.com/docs/guides/functions

## Support

For Edge Functions issues:
1. Check function logs: `supabase functions logs <function-name>`
2. Test locally: `supabase functions serve <function-name>`
3. Verify secrets: `supabase secrets list`
4. Review GitHub Actions logs for deployment failures
