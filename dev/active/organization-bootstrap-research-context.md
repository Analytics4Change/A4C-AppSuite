# Context: Domain Configuration Unification + Tenant Redirect

## Session Purpose

Implement unified domain configuration and post-acceptance tenant subdomain redirect.

**Started**: 2025-12-09
**Status**: ✅ Implementation Complete - Ready for Deployment

---

## Architecture Overview

### System Flow

```
Frontend                    Backend API              Temporal
────────                    ───────────              ────────
OrganizationCreatePage  →   Edge Function    →    OrganizationBootstrap
(3-section form)            (JWT validation)       Workflow (7 stages)
     ↓                           ↓                       ↓
OrganizationFormVM          NOTIFY channel        Activities emit events
(MobX state)                     ↓                       ↓
     ↓                      Backend API           PostgreSQL triggers
WorkflowClient              Worker listens              ↓
(Mock/Temporal)                  ↓                Projection tables
     ↓                      Temporal Client       updated via CQRS
BootstrapStatusPage              ↓
(polling every 2s)          Start workflow
```

### 7-Stage Workflow

| Stage | Activity | Event Emitted | External API |
|-------|----------|---------------|--------------|
| 1 | Create Organization | `organization.created` | - |
| 2 | Configure DNS | `organization.dns.configured` | Cloudflare |
| 3 | DNS Propagation Wait | - | 5-min durable timer |
| 4 | Verify DNS | - | DNS lookup |
| 5 | Generate Invitations | `user.invited` | - |
| 6 | Send Emails | `invitation.email.sent` | Resend/SMTP |
| 7 | Activate Organization | `organization.activated` | - |

---

## Domain Configuration Problem (Identified 2025-12-09)

### Current State - Domain Configuration Chaos

| Variable | Current Value | Location | Issue |
|----------|---------------|----------|-------|
| Hardcoded | `firstovertheline.com` | workflow.ts:199, scripts, tests | No single source of truth |
| `TARGET_DOMAIN` | `a4c.firstovertheline.com` | env-schema.ts, worker-configmap.yaml | Should derive from base |
| `FRONTEND_URL` | `https://a4c.firstovertheline.com` | env-schema.ts, worker-configmap.yaml | Should derive from base |
| `BACKEND_API_URL` | `https://api-a4c.firstovertheline.com` | env-schema.ts | Should derive from base |
| `BASE_DOMAIN` | `firstovertheline.com` | configmap-dev.yaml | **Exists but unused!** |

### All Domain References Found

1. **Kubernetes ConfigMaps**: 6 references
2. **Kubernetes Ingress**: 3 files
3. **Env schema defaults**: 3 files
4. **Hardcoded workflow code**: 5 references
5. **Tests**: 14 occurrences
6. **Frontend env files**: 2 files

---

## Key Decisions

### 1. Accept Invitation on Platform Domain (Not Tenant)

**Decision**: Keep `/accept-invitation` on `a4c.firstovertheline.com` (platform domain)

**Rationale**:
- Invitation emails sent in Step 6, before DNS fully propagates (Step 4)
- Even after DNS propagates, user may click email days later
- Platform domain is always guaranteed to work
- Avoids chicken-and-egg problem with tenant subdomain availability

### 2. Post-Acceptance Redirect to Tenant Subdomain (New Feature)

**Decision**: After accepting invitation, redirect to tenant subdomain if DNS verified

**Implementation**:
- `accept-invitation` Edge Function queries org's `slug` and `subdomain_status`
- If `subdomain_status = 'verified'` → redirect to `https://{slug}.${PLATFORM_BASE_DOMAIN}/dashboard`
- Otherwise → fallback to `/organizations/${orgId}/dashboard`

### 3. PLATFORM_BASE_DOMAIN as Single Source of Truth (2025-12-09)

**Decision**: Introduce `PLATFORM_BASE_DOMAIN` env var as root for all domain configuration

**Derivation Pattern**:
```
PLATFORM_BASE_DOMAIN = "firstovertheline.com"
         │
         ├── FRONTEND_URL      = https://a4c.${PLATFORM_BASE_DOMAIN}
         ├── TARGET_DOMAIN     = a4c.${PLATFORM_BASE_DOMAIN}  (CNAME target)
         ├── BACKEND_API_URL   = https://api-a4c.${PLATFORM_BASE_DOMAIN}
         └── Tenant subdomains = {slug}.${PLATFORM_BASE_DOMAIN}
```

**Rationale**:
- Single point of change to switch environments
- Consistency across all components
- Individual URLs can still be overridden if needed
- Multi-environment support (dev/staging/prod)

### 4. No Symlinks for .env Files (2025-12-09)

**Decision**: Use defaults in env schemas rather than symlinked .env files

**Rationale**:
- Docker COPY doesn't follow symlinks outside build context
- Vite may not resolve symlinked .env files
- Windows compatibility issues with symlinks
- Git behavior inconsistent across platforms

**Alternative Chosen**: Each component defines `PLATFORM_BASE_DOMAIN` with same default value. Override via ConfigMap or .env if needed.

---

## Key Files

### Workflows Component
| File | Purpose |
|------|---------|
| `workflows/src/shared/config/env-schema.ts` | Environment schema - needs PLATFORM_BASE_DOMAIN |
| `workflows/src/workflows/organization-bootstrap/workflow.ts` | Line 199 hardcodes domain |
| `workflows/src/scripts/cleanup-dev.ts:112` | Hardcodes targetDomain |
| `workflows/src/scripts/cleanup-test-org-dns.ts:6` | Hardcodes baseDomain |

### Edge Functions
| File | Purpose |
|------|---------|
| `infrastructure/supabase/supabase/functions/_shared/env-schema.ts` | Needs PLATFORM_BASE_DOMAIN |
| `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` | Line 219 - redirect URL |

### Frontend
| File | Purpose |
|------|---------|
| `frontend/src/pages/organizations/AcceptInvitationPage.tsx` | Handle cross-origin redirect |
| `frontend/src/types/organization.types.ts` | AcceptInvitationResult type |

### Kubernetes
| File | Purpose |
|------|---------|
| `infrastructure/k8s/temporal/worker-configmap.yaml` | Contains TARGET_DOMAIN, FRONTEND_URL |
| `infrastructure/k8s/temporal/configmap-dev.yaml` | Has unused BASE_DOMAIN |

---

## Documentation Created (2025-12-09)

- **Updated**: `documentation/infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md`
  - Added "Domain Configuration" section at top
  - Added PLATFORM_BASE_DOMAIN entries for Workflows and Edge Functions
  - Updated TARGET_DOMAIN and FRONTEND_URL entries to show derivation
  - Version bumped to 2.2.0

---

## Reference Materials

### Documentation Files
- `documentation/architecture/workflows/temporal-overview.md`
- `documentation/architecture/workflows/organization-onboarding-workflow.md`
- `documentation/architecture/data/organization-management-architecture.md`
- `documentation/infrastructure/reference/database/tables/organizations_projection.md`
- `documentation/infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md` (updated)

### Contract Files
- `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml`

### Plan File
- `/home/lars/.claude/plans/jolly-nibbling-shamir.md` - Implementation plan

---

## Important Constraints

- **Conditional Subdomain Logic**: Not all orgs have subdomains
  - `provider` → Always requires subdomain
  - `provider_partner` (var) → Requires subdomain
  - `provider_partner` (family/court/other) → No subdomain
  - `platform_owner` → No subdomain

- **Subdomain Status Check**: Only redirect if `subdomain_status = 'verified'`

- **Cross-Origin Auth**: Supabase Auth cookies work across subdomains (same root domain)

---

## Implementation Complete (2025-12-09)

All implementation tasks completed. The following files were modified:

### Workflows Component (7 files)
- `workflows/src/shared/config/env-schema.ts` - Added PLATFORM_BASE_DOMAIN with derivation logic
- `workflows/src/shared/types/index.ts` - Made targetDomain and frontendUrl optional in params
- `workflows/src/activities/organization-bootstrap/configure-dns.ts` - Uses env config for targetDomain
- `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts` - Uses env config for frontendUrl
- `workflows/src/workflows/organization-bootstrap/workflow.ts` - Removed hardcoded domain values
- `workflows/src/api/routes/workflows.ts` - Uses validated env config
- `workflows/src/scripts/cleanup-dev.ts` - Uses getWorkflowsEnv()
- `workflows/src/scripts/cleanup-test-org-dns.ts` - Uses validateWorkflowsEnv()
- `workflows/src/__tests__/activities/configure-dns.test.ts` - Added env-schema mock

### Edge Functions (2 files)
- `infrastructure/supabase/supabase/functions/_shared/env-schema.ts` - Added PLATFORM_BASE_DOMAIN with derivation
- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` - Tenant redirect logic

### Kubernetes (2 files)
- `infrastructure/k8s/temporal/worker-configmap.yaml` - Added PLATFORM_BASE_DOMAIN, removed derived values
- `infrastructure/k8s/temporal/configmap-dev.yaml` - Renamed BASE_DOMAIN → PLATFORM_BASE_DOMAIN

### Frontend (1 file)
- `frontend/src/pages/organizations/AcceptInvitationPage.tsx` - Cross-origin redirect handling

---

## Next Steps (Deployment)

1. **Build and test locally**:
   ```bash
   cd workflows && npm run build && npm test
   ```

2. **Deploy Kubernetes ConfigMaps**:
   ```bash
   kubectl apply -f infrastructure/k8s/temporal/worker-configmap.yaml
   kubectl apply -f infrastructure/k8s/temporal/configmap-dev.yaml
   ```

3. **Restart Temporal workers**:
   ```bash
   kubectl rollout restart deployment/workflow-worker -n temporal
   ```

4. **Deploy Edge Functions**:
   ```bash
   cd infrastructure/supabase && ./deploy-functions.sh
   ```

5. **Manual verification**:
   - Test organization bootstrap creates DNS correctly
   - Test invitation acceptance redirects to tenant subdomain (when verified)
   - Test fallback to org ID path when subdomain not verified
