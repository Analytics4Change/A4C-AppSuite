# Environment Variables Reference

**Last Updated**: 2025-11-04
**Version**: 1.0.0

This document provides a comprehensive reference for all environment variables used across the A4C-AppSuite monorepo.

---

## Table of Contents

1. [Overview](#overview)
2. [Frontend Configuration](#frontend-configuration)
3. [Temporal Workflows Configuration](#temporal-workflows-configuration)
4. [Infrastructure Configuration](#infrastructure-configuration)
5. [Cross-Component Interactions](#cross-component-interactions)
6. [Security Best Practices](#security-best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The A4C-AppSuite uses environment variables to configure application behavior across different deployment environments (development, staging, production). Configuration is organized into three main components:

- **Frontend** (`frontend/`): React application with Vite
- **Temporal Workflows** (`workflows/`): Durable workflow orchestration
- **Infrastructure** (`infrastructure/`): Terraform and Kubernetes configurations

### Configuration File Locations

```
A4C-AppSuite/
├── frontend/
│   ├── .env.example              # Template with all available options
│   ├── .env.local                # Local development (git-ignored)
│   ├── .env.development          # Development mode (mock auth)
│   ├── .env.development.integration  # Integration testing (real auth)
│   └── .env.production           # Production template (replaced by CI/CD)
├── workflows/
│   ├── .env.example              # Template with all available options
│   └── .env.local                # Local development (git-ignored)
└── infrastructure/k8s/temporal/
    ├── worker-configmap.yaml     # Non-sensitive Kubernetes config
    └── worker-secret.yaml.example # Sensitive credentials template
```

---

## Frontend Configuration

### Primary Configuration

#### `VITE_APP_MODE` (Primary Control Variable)

**Purpose**: Controls deployment mode for entire frontend application
**Valid Values**: `mock` | `production`
**Default**: `mock` (development), `production` (in production builds)
**Required**: No (has fallback)

**Behavior Influence**:
- `mock`: Uses DevAuthProvider for instant authentication, mock organization service, offline capability
- `production`: Uses SupabaseAuthProvider for real OAuth flows, real Supabase backend, network-dependent

**Security Implications**: Controls whether real or mock JWT tokens are issued; affects RLS policy enforcement

**Files**:
- `frontend/src/config/deployment.config.ts` - Configuration logic
- `frontend/src/services/auth/AuthProviderFactory.ts` - Provider selection

**Example**:
```bash
# Development (mock mode)
VITE_APP_MODE=mock

# Integration testing (real auth)
VITE_APP_MODE=production
```

---

### Supabase Configuration

#### `VITE_SUPABASE_URL`

**Purpose**: Supabase project URL for backend API and authentication
**Default**: None (required when `VITE_APP_MODE=production`)
**Example**: `https://yourproject.supabase.co`
**Required**: Yes (if `VITE_APP_MODE=production`)

**Behavior Influence**: Determines which Supabase instance the application connects to; controls data isolation

**Security Implications**: Points to either dev or production database; must match authentication configuration

**Files**:
- `frontend/src/lib/supabase.ts` - Supabase client initialization
- `frontend/src/services/auth/SupabaseAuthProvider.ts` - Authentication provider

#### `VITE_SUPABASE_ANON_KEY`

**Purpose**: Anonymous API key for Supabase public operations
**Default**: None (required when `VITE_APP_MODE=production`)
**Required**: Yes (if `VITE_APP_MODE=production`)

**Behavior Influence**: Enables unauthenticated API calls to Supabase; limited by RLS policies

**Security Implications**: Public key; safe to expose in frontend; RLS policies enforce security

**Files**:
- `frontend/src/lib/supabase.ts` - Supabase client initialization

---

### Mock Authentication Configuration

#### `VITE_DEV_USER_ROLE`

**Purpose**: Override default mock user role for development
**Default**: `"provider_admin"`
**Valid Values**: `super_admin` | `provider_admin` | `clinician` | `viewer`
**Required**: No (optional override)

**Behavior Influence**: Changes JWT role claims in mock auth; affects RLS policy evaluation

**Development Only**: Yes, ignored in production mode

**Files**:
- `frontend/src/config/dev-auth.config.ts` - Mock user profiles

**Example**:
```bash
VITE_DEV_USER_ROLE=super_admin
VITE_DEV_USER_NAME=Dev Super Admin
VITE_DEV_USER_EMAIL=dev@example.com
```

#### `VITE_DEV_USER_NAME`

**Purpose**: Override default mock user name for development
**Default**: `"Dev User (Provider Admin)"`
**Required**: No (optional override)

**Behavior Influence**: Changes display name in mock authentication provider

**Development Only**: Yes, ignored in production mode

#### `VITE_DEV_USER_EMAIL`

**Purpose**: Override default mock user email for development
**Default**: `"dev@example.com"`
**Required**: No (optional override)

**Behavior Influence**: Changes email address in mock authentication provider

**Development Only**: Yes, ignored in production mode

---

### Medication Search API Configuration

#### `VITE_USE_RXNORM_API`

**Purpose**: Controls whether to use real RXNorm API or mock medication data
**Valid Values**: `true` | `false`
**Default**: `false` (uses mock data)
**Required**: No

**Behavior Influence**:
- `false`: Uses in-memory mock medication database (instant, offline capable)
- `true`: Calls real RXNorm API at National Library of Medicine (slower, network-dependent)

**Development Only**: No, affects production behavior

**Files**:
- `frontend/src/services/search/medication-search.service.ts` - Search service

#### `VITE_RXNORM_BASE_URL`

**Purpose**: Custom RXNorm API base URL (optional override)
**Default**: `https://rxnav.nlm.nih.gov`
**Required**: No (optional override)

**Behavior Influence**: Changes API endpoint for medication searches

**Files**:
- `frontend/src/config/medication-search.config.ts` - API configuration

#### `VITE_RXNORM_TIMEOUT`

**Purpose**: Request timeout for RXNorm API calls (optional override)
**Default**: `30000` (30 seconds)
**Required**: No (optional override)

**Behavior Influence**: How long to wait for medication search responses before timing out

**Performance Impact**: Affects user experience for slow networks

---

### Cache Configuration (Optional Overrides)

#### `VITE_CACHE_MEMORY_TTL`

**Purpose**: In-memory cache time-to-live
**Default**: `1800000` (30 minutes)
**Required**: No

**Behavior Influence**: How long medication search results stay in memory before expiring

**Performance Impact**: Balance between memory usage and network calls

#### `VITE_CACHE_INDEXEDDB_TTL`

**Purpose**: IndexedDB persistent cache time-to-live
**Default**: `86400000` (24 hours)
**Required**: No

**Behavior Influence**: How long cached data persists across browser sessions

**Performance Impact**: Enables offline access to previously-searched medications

#### `VITE_CACHE_MAX_MEMORY_ENTRIES`

**Purpose**: Maximum number of items in memory cache
**Default**: `100`
**Required**: No

**Behavior Influence**: Limits memory usage; oldest items evicted when exceeded

**Performance Impact**: Trade-off between memory and cache hit rate

---

### Circuit Breaker Configuration (Optional Overrides)

#### `VITE_CIRCUIT_FAILURE_THRESHOLD`

**Purpose**: Number of failures before circuit breaker opens
**Default**: `5`
**Required**: No

**Behavior Influence**: Prevents cascading failures; stops retrying failed API calls

**Resilience Impact**: Faster failure feedback to user when API is down

#### `VITE_CIRCUIT_RESET_TIMEOUT`

**Purpose**: Milliseconds before retrying failed circuit
**Default**: `60000` (1 minute)
**Required**: No

**Behavior Influence**: How long to wait before testing if API recovered

**Resilience Impact**: Balance between detecting recovery and not overwhelming failed service

---

### Search Behavior Configuration (Optional Overrides)

#### `VITE_SEARCH_MIN_LENGTH`

**Purpose**: Minimum characters required before search executes
**Default**: `2`
**Required**: No

**Behavior Influence**: Prevents noise from single-character searches; affects responsiveness

**Performance Impact**: Reduces API calls for incomplete searches

#### `VITE_SEARCH_MAX_RESULTS`

**Purpose**: Maximum number of search results to display
**Default**: `50`
**Required**: No

**Behavior Influence**: Limits dropdown size; affects UI performance

**UX Impact**: Larger number = more scrolling, smaller number = may miss results

#### `VITE_SEARCH_DEBOUNCE_MS`

**Purpose**: Debounce delay for medication search input
**Default**: `300` (300 milliseconds)
**Required**: No

**Behavior Influence**: Waits this long after user stops typing before searching

**Performance Impact**: Reduces API calls; makes UX feel snappier

---

### Debug Configuration (Development Only)

#### `VITE_DEBUG_AUTH`

**Purpose**: Enable authentication provider debugging
**Default**: `false`
**Required**: No

**Behavior Influence**: Logs auth provider decisions to console (dev only)

**Development Only**: Yes, no effect in production builds

#### `VITE_DEBUG_MOBX`

**Purpose**: Enable MobX state management debugging
**Default**: `false`
**Required**: No

**Behavior Influence**: Enables MobX diagnostic tools and logging

**Performance Impact**: Zero overhead in production (tree-shaken)

#### `VITE_DEBUG_PERFORMANCE`

**Purpose**: Enable performance monitoring
**Default**: `false`
**Required**: No

**Behavior Influence**: Tracks rendering performance and memory usage

**Performance Impact**: Minimal overhead, helps identify bottlenecks

---

## Temporal Workflows Configuration

### Primary Configuration

#### `WORKFLOW_MODE` (Master Control Variable)

**Purpose**: Controls default behavior for ALL provider services (DNS, email, etc.)
**Valid Values**: `mock` | `development` | `production`
**Default**: `development`
**Required**: No (has fallback)

**Behavior Influence**:
- `mock`: All providers mocked (in-memory, no output, fast tests)
- `development`: All providers log to console (see output, understand flow)
- `production`: All providers use real APIs (Cloudflare DNS, Resend email, SMTP)

**Security Implications**: Controls whether real DNS records are created, real emails are sent

**Files**:
- `workflows/src/shared/config/validate-config.ts` - Configuration validation
- `workflows/src/shared/providers/dns/factory.ts` - DNS provider selection
- `workflows/src/shared/providers/email/factory.ts` - Email provider selection

**Example**:
```bash
# Local development (console logs only)
WORKFLOW_MODE=development

# Integration testing (real resources)
WORKFLOW_MODE=production

# Unit tests (fast, no output)
WORKFLOW_MODE=mock
```

**Mode Behavior Matrix**:

| Mode | DNS Provider | Email Provider | Use Case |
|------|-------------|----------------|----------|
| mock | MockDNS | MockEmail | Unit tests, CI/CD |
| development | LoggingDNS | LoggingEmail | Local dev (console logs) |
| production | Cloudflare | Resend | Integration testing, prod |

---

### Provider Overrides (Advanced/Optional)

#### `DNS_PROVIDER`

**Purpose**: Override DNS provider selected by `WORKFLOW_MODE` (optional override)
**Valid Values**: `cloudflare` | `mock` | `logging` | `auto`
**Default**: Determined by `WORKFLOW_MODE` (mock→mock, development→logging, production→cloudflare)
**Required**: No (optional)

**Behavior Influence**: Allows testing DNS separately from email (e.g., test real DNS with mock email)

**Valid Combinations**:
```bash
# Test real DNS with logging email
WORKFLOW_MODE=development
DNS_PROVIDER=cloudflare

# Mock DNS with logging email
WORKFLOW_MODE=development
DNS_PROVIDER=mock

# Logging DNS with real email (for testing)
WORKFLOW_MODE=production
DNS_PROVIDER=logging
```

**Files**:
- `workflows/src/shared/providers/dns/factory.ts` - DNS provider factory

#### `EMAIL_PROVIDER`

**Purpose**: Override email provider selected by `WORKFLOW_MODE` (optional override)
**Valid Values**: `resend` | `smtp` | `mock` | `logging` | `auto`
**Default**: Determined by `WORKFLOW_MODE` (mock→mock, development→logging, production→resend)
**Required**: No (optional)

**Behavior Influence**: Allows testing email separately from DNS

**Valid Combinations**:
```bash
# Test real email with logging DNS
WORKFLOW_MODE=development
EMAIL_PROVIDER=resend

# Mock email with real DNS (for testing)
WORKFLOW_MODE=production
EMAIL_PROVIDER=mock
```

**Files**:
- `workflows/src/shared/providers/email/factory.ts` - Email provider factory

---

### Temporal Connection

#### `TEMPORAL_ADDRESS`

**Purpose**: Address of Temporal server (frontend service)
**Default**: `localhost:7233` (for local development)
**Example (Production)**: `temporal-frontend.temporal.svc.cluster.local:7233`
**Required**: Yes

**Behavior Influence**: Determines which Temporal cluster the worker connects to

**Development vs Production**:
- Development: Usually `localhost:7233` with port-forward
- Production: Kubernetes service DNS name

**Files**:
- `workflows/src/worker/index.ts` - Worker initialization

**Example**:
```bash
# Local development (kubectl port-forward)
TEMPORAL_ADDRESS=localhost:7233

# Production (Kubernetes service)
TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
```

#### `TEMPORAL_NAMESPACE`

**Purpose**: Temporal namespace for workflow isolation
**Default**: `default`
**Required**: Yes

**Behavior Influence**: Separates workflows by namespace (dev/staging/prod)

**Multi-tenancy**: Can use different namespaces for different environments

**Files**:
- `workflows/src/worker/index.ts` - Worker initialization

#### `TEMPORAL_TASK_QUEUE`

**Purpose**: Task queue for workflow execution
**Default**: `bootstrap`
**Required**: Yes

**Behavior Influence**: Workflows are queued here; workers consume from this queue

**Scaling**: Multiple workers can consume from same queue

**Files**:
- `workflows/src/worker/index.ts` - Worker initialization

---

### Supabase Configuration

#### `SUPABASE_URL`

**Purpose**: Supabase project URL for database and events
**Example**: `https://cuvxypuwvbchsngjzdqo.supabase.co`
**Required**: Yes

**Behavior Influence**: Determines which Supabase instance receives domain events

**Security Implications**: Must match the database where organizations are created

**Files**:
- `workflows/src/shared/utils/supabase.ts` - Supabase client
- All activities that emit domain events

#### `SUPABASE_SERVICE_ROLE_KEY`

**Purpose**: Service role API key for privileged database operations
**Default**: None
**Required**: Yes

**Behavior Influence**: Enables workflow to emit events, create organizations, modify projections

**Security Implications**: Highly privileged key; should only be in backend/worker environment

**Files**:
- `workflows/src/shared/utils/supabase.ts` - Supabase client

---

### DNS Provider Credentials

#### `CLOUDFLARE_API_TOKEN`

**Purpose**: API token for Cloudflare DNS operations
**Default**: None
**Required**: Yes (if `DNS_PROVIDER=cloudflare` or `WORKFLOW_MODE=production`)

**Behavior Influence**: Enables creating/verifying/deleting DNS records for organization subdomains

**Validation**: Required when `DNS_PROVIDER=cloudflare`

**Permissions Required**: Zone:Read, DNS:Edit

**Files**:
- `workflows/src/shared/providers/dns/cloudflare-provider.ts` - Cloudflare DNS provider

#### `CLOUDFLARE_ZONE_ID`

**Purpose**: Specific Cloudflare zone ID (optional, can be queried if not provided)
**Default**: None (will query zone by domain)
**Required**: No (optional for efficiency)

**Behavior Influence**: Speeds up DNS operations if zone ID is known in advance

**Files**:
- `workflows/src/shared/providers/dns/cloudflare-provider.ts` - Cloudflare DNS provider

---

### Email Provider Credentials

#### `RESEND_API_KEY`

**Purpose**: API key for Resend email service
**Example**: `re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
**Required**: Yes (if `EMAIL_PROVIDER=resend` or `WORKFLOW_MODE=production`)

**Behavior Influence**: Enables sending invitation emails to users

**Validation**: Required when `EMAIL_PROVIDER=resend`

**Files**:
- `workflows/src/shared/providers/email/resend-provider.ts` - Resend email provider

#### `SMTP_HOST`

**Purpose**: SMTP server hostname for traditional email
**Example**: `smtp.example.com`
**Required**: Yes (if `EMAIL_PROVIDER=smtp`)

**Behavior Influence**: SMTP server address for email delivery

**Files**:
- `workflows/src/shared/providers/email/smtp-provider.ts` - SMTP email provider

#### `SMTP_PORT`

**Purpose**: SMTP server port
**Default**: `587` (suggested)
**Required**: Yes (if `EMAIL_PROVIDER=smtp`)

**Behavior Influence**: Connection port for SMTP server

**Common Values**: 587 (TLS), 465 (SSL), 25 (plaintext)

**Files**:
- `workflows/src/shared/providers/email/smtp-provider.ts` - SMTP email provider

#### `SMTP_USER`

**Purpose**: SMTP authentication username
**Required**: Yes (if `EMAIL_PROVIDER=smtp`)

**Behavior Influence**: Username for SMTP server authentication

**Files**:
- `workflows/src/shared/providers/email/smtp-provider.ts` - SMTP email provider

#### `SMTP_PASS`

**Purpose**: SMTP authentication password
**Required**: Yes (if `EMAIL_PROVIDER=smtp`)

**Behavior Influence**: Password for SMTP server authentication

**Security Implications**: Sensitive; should only be in backend environment

**Files**:
- `workflows/src/shared/providers/email/smtp-provider.ts` - SMTP email provider

---

### Development Features

#### `TAG_DEV_ENTITIES`

**Purpose**: Add 'development' tag to all created entities
**Valid Values**: `true` | `false`
**Default**: `true` (when in development)
**Required**: No

**Behavior Influence**: Tags organizations/invitations with 'development' tag for cleanup

**Development Use**: Cleanup scripts find tagged entities: `npm run cleanup:dev`

**Warning**: Should be `false` in production (validation warning if not)

**Files**:
- `workflows/src/activities/organization-bootstrap/create-organization.ts` - Organization creation activity

#### `AUTO_CLEANUP`

**Purpose**: Automatically delete entities after workflow completes
**Valid Values**: `true` | `false`
**Default**: `false`
**Required**: No

**Behavior Influence**: Automatically runs cleanup script after successful workflow

**Development Use**: Fast iteration without manual cleanup

**Warning**: Dangerous in production (validation warning if enabled)

**Files**:
- `workflows/src/worker/index.ts` - Worker initialization

---

### Node.js Environment

#### `NODE_ENV`

**Purpose**: Node.js environment indicator
**Valid Values**: `development` | `production`
**Default**: Depends on build
**Recommendation**: Match `WORKFLOW_MODE` (development→development, production→production)

**Behavior Influence**: Affects logging levels, performance optimizations

**Files**:
- `workflows/src/utils/logger.ts` - Logger configuration
- Build tools

#### `LOG_LEVEL`

**Purpose**: Logging verbosity
**Valid Values**: `debug` | `info` | `warn` | `error`
**Default**: `info`
**Required**: No

**Behavior Influence**: Controls which log messages are printed

**Performance Impact**: Lower levels (debug) increase logging overhead

---

## Infrastructure Configuration

### Terraform Provider Variables

#### `TF_VAR_supabase_access_token`

**Purpose**: Supabase API token for Terraform provider
**Required**: Yes (if managing Supabase with Terraform)

**Behavior Influence**: Enables Terraform to create/modify Supabase resources

**Files**:
- `infrastructure/terraform/` (future IaC)

#### `TF_VAR_supabase_project_ref`

**Purpose**: Supabase project reference identifier
**Example**: `cuvxypuwvbchsngjzdqo`
**Required**: Yes (if managing Supabase with Terraform)

**Behavior Influence**: Specifies which Supabase project to manage

**Files**:
- `infrastructure/terraform/`

---

### Kubernetes Deployment

For Temporal workers deployed in Kubernetes, these are set as ConfigMap and Secrets:

**In ConfigMap** (non-sensitive):
```yaml
WORKFLOW_MODE: "production"
TEMPORAL_ADDRESS: "temporal-frontend.temporal.svc.cluster.local:7233"
TEMPORAL_NAMESPACE: "default"
TEMPORAL_TASK_QUEUE: "bootstrap"
SUPABASE_URL: "https://your-project.supabase.co"
TAG_DEV_ENTITIES: "false"
NODE_ENV: "production"
HEALTH_CHECK_PORT: "9090"
```

**In Secrets** (sensitive, base64-encoded):
```yaml
SUPABASE_SERVICE_ROLE_KEY: <base64-encoded>
CLOUDFLARE_API_TOKEN: <base64-encoded>
RESEND_API_KEY: <base64-encoded>
# SMTP credentials (if using SMTP)
SMTP_HOST: <base64-encoded>
SMTP_PORT: <base64-encoded>
SMTP_USER: <base64-encoded>
SMTP_PASS: <base64-encoded>
```

**Files**:
- `infrastructure/k8s/temporal/worker-configmap.yaml` - ConfigMap
- `infrastructure/k8s/temporal/worker-secret.yaml.example` - Secret template

---

## Cross-Component Interactions

### Mode Consistency Requirements

**Frontend ↔ Workflows**:
- If `VITE_APP_MODE=mock` (mock JWT) + `WORKFLOW_MODE=production` (real DNS) = Edge Functions will reject mock JWT
- Must use consistent modes: mock↔mock, production↔production

### Supabase Configuration

**Frontend**:
- Uses `VITE_SUPABASE_URL` with `VITE_SUPABASE_ANON_KEY` (limited by RLS)

**Workflows**:
- Uses `SUPABASE_URL` with `SUPABASE_SERVICE_ROLE_KEY` (privileged access)

**Both must point to the same Supabase project for correct operation**

### Cross-Component Behavior Matrix

| Variable | Frontend | Workflows | Infrastructure | Behavior |
|----------|----------|-----------|-----------------|----------|
| VITE_APP_MODE | Primary | N/A | N/A | Controls auth provider (mock vs real) |
| WORKFLOW_MODE | N/A | Primary | Config | Controls DNS/email providers |
| SUPABASE_URL | Required (prod) | Required | Config | Database connection point |
| SUPABASE_ANON_KEY | Required (prod) | N/A | N/A | Frontend API access |
| SUPABASE_SERVICE_ROLE_KEY | N/A | Required | Secret | Backend privileged operations |
| CLOUDFLARE_API_TOKEN | N/A | If DNS | Secret | DNS provisioning |
| RESEND_API_KEY | N/A | If Email | Secret | Email delivery |
| NODE_ENV | Build | Runtime | N/A | Logging, optimizations |
| TEMPORAL_ADDRESS | N/A | Required | Config | Workflow server connection |

---

## Security Best Practices

### Secret Management

1. **Never commit secrets to version control**
   - Use `.env.local` for local development (git-ignored)
   - Use GitHub Secrets for CI/CD
   - Use Kubernetes Secrets for production deployment

2. **Use appropriate key types per environment**
   - Frontend: Use `SUPABASE_ANON_KEY` (public, RLS-protected)
   - Backend: Use `SUPABASE_SERVICE_ROLE_KEY` (privileged, never expose)

3. **Rotate credentials regularly**
   - Especially for production environments
   - Update GitHub Secrets and Kubernetes Secrets
   - Test rotation in staging first

4. **Use environment-specific credentials**
   - Development: Point to development Supabase project
   - Production: Point to production Supabase project
   - Never mix development and production credentials

### Access Control

1. **Limit who can modify secrets**
   - GitHub Secrets: Require admin access
   - Kubernetes Secrets: Use RBAC to limit access

2. **Use git-crypt for sensitive files**
   - Repository uses git-crypt for encryption
   - Unlock: `git-crypt unlock /path/to/A4C-AppSuite-git-crypt.key`

3. **Audit access logs**
   - Monitor who accesses secrets
   - Review GitHub Actions logs
   - Check Kubernetes audit logs

### Validation

1. **All configurations are validated on startup**
   - Frontend: Checks for required Supabase credentials
   - Workflows: Validates provider credentials based on mode
   - Clear error messages for missing/invalid config

2. **Use templates for consistency**
   - `.env.example` files provide complete templates
   - Copy and customize for your environment
   - Compare against examples to catch mistakes

---

## Troubleshooting

### Common Issues

#### Issue: Frontend blank page with "Supabase configuration missing"

**Cause**: Missing or invalid `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`

**Solution**:
1. Check `.env.production` has real credentials (not placeholders)
2. For GitHub Actions: Verify GitHub Secrets are set
3. For local: Check `.env.local` has correct values
4. Rebuild application: `npm run build`

#### Issue: Temporal workers not connecting to cluster

**Cause**: Invalid `TEMPORAL_ADDRESS` or Temporal server not accessible

**Solution**:
1. Check `TEMPORAL_ADDRESS` value
   - Local: `localhost:7233` (requires port-forward)
   - Production: `temporal-frontend.temporal.svc.cluster.local:7233`
2. Test connectivity: `kubectl port-forward -n temporal svc/temporal-frontend 7233:7233`
3. Check worker logs: `kubectl logs -n temporal -l app=workflow-worker`

#### Issue: Workflow validation error: missing credentials

**Cause**: `WORKFLOW_MODE=production` but missing `CLOUDFLARE_API_TOKEN` or `RESEND_API_KEY`

**Solution**:
1. Add credentials to `.env.local` (local dev)
2. Create Kubernetes secret (production):
   ```bash
   kubectl create secret generic workflow-worker-secrets \
     -n temporal \
     --from-literal=CLOUDFLARE_API_TOKEN='your-token' \
     --from-literal=RESEND_API_KEY='your-key' \
     --from-literal=SUPABASE_SERVICE_ROLE_KEY='your-key'
   ```
3. Or switch to development mode: `WORKFLOW_MODE=development`

#### Issue: JWT token rejected by Edge Functions

**Cause**: Mode mismatch between frontend and backend

**Solution**:
1. Ensure `VITE_APP_MODE=production` in frontend
2. Ensure `WORKFLOW_MODE=production` in workflows
3. Verify both use same Supabase project
4. Check JWT claims are correctly set

### Validation Checklist

Use this checklist to validate your environment configuration:

**Frontend**:
- [ ] `.env.production` exists with real credentials (if deploying)
- [ ] `.env.local` has valid Supabase credentials (if testing locally)
- [ ] `VITE_APP_MODE` matches deployment environment
- [ ] GitHub Secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set

**Workflows**:
- [ ] `.env.local` has all required variables (if testing locally)
- [ ] `WORKFLOW_MODE` matches deployment environment
- [ ] Provider credentials present if using real providers
- [ ] Kubernetes secret `workflow-worker-secrets` exists (if deployed)
- [ ] ConfigMap `workflow-worker-config` has correct values

**Cross-Component**:
- [ ] Frontend and workflows use same Supabase project
- [ ] Mode consistency: mock↔mock or production↔production
- [ ] Credentials are environment-specific (no dev creds in prod)

### Testing Configuration

**Frontend (local)**:
```bash
cd frontend

# Test with mock mode
VITE_APP_MODE=mock npm run dev

# Test with real Supabase
VITE_APP_MODE=production npm run dev:auth
```

**Workflows (local)**:
```bash
cd workflows

# Test with mock providers
WORKFLOW_MODE=mock npm run dev

# Test with logging providers
WORKFLOW_MODE=development npm run dev

# Test with real providers
WORKFLOW_MODE=production npm run dev
```

**Validation Scripts**:
```bash
# Frontend: Check environment variables
cd frontend
node -e "console.log('VITE_SUPABASE_URL:', import.meta.env.VITE_SUPABASE_URL)"

# Workflows: Validate configuration
cd workflows
npm run validate-config
```

---

## Quick Reference

### Environment File Matrix

| File | Purpose | Tracked in Git | When Used |
|------|---------|----------------|-----------|
| `.env.example` | Template with all options | ✅ Yes | Reference for creating `.env.local` |
| `.env.local` | Local development | ❌ No | Local development |
| `.env.development` | Development mode | ✅ Yes | `npm run dev` (mock mode) |
| `.env.development.integration` | Integration testing | ✅ Yes | `npm run dev:auth` (real auth) |
| `.env.production` | Production template | ✅ Yes | Production build (replaced by CI/CD) |

### Quick Configuration Examples

**1. Local Frontend Development (Mock Auth)**
```bash
# frontend/.env.local
VITE_APP_MODE=mock
VITE_USE_RXNORM_API=false
VITE_DEBUG_AUTH=false
```

**2. Local Frontend with Real Auth**
```bash
# frontend/.env.local
VITE_APP_MODE=production
VITE_SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
VITE_USE_RXNORM_API=false
```

**3. Local Workflows Development (Console Logs)**
```bash
# workflows/.env.local
WORKFLOW_MODE=development
TEMPORAL_ADDRESS=localhost:7233
SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
TAG_DEV_ENTITIES=true
```

**4. Workflows Integration Testing (Real DNS, Mock Email)**
```bash
# workflows/.env.local
WORKFLOW_MODE=development
DNS_PROVIDER=cloudflare
CLOUDFLARE_API_TOKEN=your-token
SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

**5. Production Deployment**
```bash
# GitHub Secrets (Frontend)
VITE_SUPABASE_URL=https://prod-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

# Kubernetes Secret (Workflows)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
CLOUDFLARE_API_TOKEN=your-token
RESEND_API_KEY=re_xxx...
```

---

## Appendix: Configuration Validation

All environment configurations are validated on application startup. Here's what gets validated:

### Frontend Validation (`frontend/src/services/auth/supabase.service.ts`)

```typescript
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase configuration missing. Check your environment variables.');
}
```

### Workflows Validation (`workflows/src/shared/config/validate-config.ts`)

1. **WORKFLOW_MODE validation**
   - Must be `mock`, `development`, or `production`
   - Warnings for suspicious configurations

2. **Provider credential validation**
   - If `DNS_PROVIDER=cloudflare`: Requires `CLOUDFLARE_API_TOKEN`
   - If `EMAIL_PROVIDER=resend`: Requires `RESEND_API_KEY`
   - If `EMAIL_PROVIDER=smtp`: Requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`

3. **Production mode validation**
   - Requires `CLOUDFLARE_API_TOKEN`
   - Requires `RESEND_API_KEY` or SMTP credentials
   - Warns if `TAG_DEV_ENTITIES=true`
   - Errors if `AUTO_CLEANUP=true`

---

**For additional help**:
- Frontend: See `frontend/CLAUDE.md`
- Workflows: See `workflows/README.md`
- Infrastructure: See `infrastructure/CLAUDE.md`
- Root README: `README.md`
