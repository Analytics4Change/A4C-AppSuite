# Tasks: Domain Configuration Unification + Tenant Redirect

## Research Session ✅ COMPLETE

- [x] Research Temporal workflow architecture (7-stage bootstrap)
- [x] Research event sourcing and domain events
- [x] Research database schema and RLS policies
- [x] Research frontend form and state management
- [x] Research email invitation flow
- [x] Identify invitation accept URL pattern
- [x] Analyze multi-tenant subdomain implications
- [x] Audit all domain references in codebase
- [x] Evaluate .env inheritance options (symlinks vs defaults)

---

## Phase 1: Domain Configuration Unification ✅ COMPLETE

### Phase 1A: Update Env Schemas
- [x] Add `PLATFORM_BASE_DOMAIN` to `workflows/src/shared/config/env-schema.ts`
- [x] Add derivation logic in `validateWorkflowsEnv()` for TARGET_DOMAIN, FRONTEND_URL
- [x] Add `PLATFORM_BASE_DOMAIN` to Edge Functions `_shared/env-schema.ts`
- [x] Add derivation logic for BACKEND_API_URL, FRONTEND_URL

### Phase 1B: Update Kubernetes ConfigMaps
- [x] Update `infrastructure/k8s/temporal/worker-configmap.yaml`
  - Add PLATFORM_BASE_DOMAIN
  - Removed redundant TARGET_DOMAIN and FRONTEND_URL (now derived)
- [x] Update `infrastructure/k8s/temporal/configmap-dev.yaml`
  - Renamed BASE_DOMAIN → PLATFORM_BASE_DOMAIN

### Phase 1C: Remove Hardcodes from Workflow Code
- [x] `workflows/src/workflows/organization-bootstrap/workflow.ts:199` - uses config via activity
- [x] `workflows/src/workflows/organization-bootstrap/workflow.ts:286` - uses derived FRONTEND_URL via activity
- [x] `workflows/src/scripts/cleanup-dev.ts:112` - uses env var
- [x] `workflows/src/scripts/cleanup-test-org-dns.ts:6` - uses env var
- [x] `workflows/src/api/routes/workflows.ts:26` - uses validated env config

### Phase 1D: Update Tests
- [x] `workflows/src/__tests__/activities/configure-dns.test.ts` - added env-schema mock
- [x] `workflows/src/__tests__/workflows/organization-bootstrap.test.ts` - uses mocked activities

### Phase 1 Testing (Manual verification needed)
- [ ] Worker starts with only `PLATFORM_BASE_DOMAIN` set
- [ ] `TARGET_DOMAIN` and `FRONTEND_URL` computed correctly
- [ ] Existing workflows still function
- [ ] DNS configuration uses correct domain
- [ ] Email invitations use correct URLs

---

## Phase 2: Tenant Subdomain Redirect ✅ COMPLETE

### Edge Function Changes
- [x] Update `accept-invitation/index.ts` to query organization data (slug, subdomain_status)
- [x] Build redirect URL based on subdomain availability
- [x] Use `PLATFORM_BASE_DOMAIN` for URL construction
- [x] Log redirect decisions for debugging

### Frontend Changes
- [x] Update `AcceptInvitationPage.tsx` to detect absolute vs relative URLs
- [x] Use `window.location.href` for cross-origin redirects (tenant subdomains)
- [x] Keep `navigate()` for same-origin paths (org ID fallback)

### Type Updates
- [x] AcceptInvitationResponse already supports absolute URLs (no changes needed)

### Phase 2 Testing (Manual verification needed)
- [ ] Provider org with verified subdomain → redirects to subdomain
- [ ] Provider org with pending DNS → falls back to org ID path
- [ ] Family partner (no subdomain) → uses org ID path
- [ ] Platform owner (no subdomain) → uses org ID path

---

## Documentation ✅ COMPLETE

- [x] Document PLATFORM_BASE_DOMAIN in ENVIRONMENT_VARIABLES.md
- [x] Add Domain Configuration section explaining derivation pattern
- [x] Update TARGET_DOMAIN entry to show derivation
- [x] Update FRONTEND_URL entry to show derivation
- [x] Add PLATFORM_BASE_DOMAIN entries for Workflows and Edge Functions

---

## Current Status

**Phase**: Implementation Complete
**Status**: ✅ COMPLETE
**Last Updated**: 2025-12-09
**Next Step**: Deploy and test changes

---

## Change Log

- **2025-12-09 (earlier)**: Research session completed
  - Explored all facets of organization bootstrap
  - Documented email invitation flow
  - Identified post-acceptance redirect as improvement opportunity

- **2025-12-09 (later)**: Planning session completed
  - Audited all domain references in codebase
  - Decided on PLATFORM_BASE_DOMAIN as single source of truth
  - Evaluated .env inheritance options (chose defaults over symlinks)
  - Created implementation plan with 2 phases
  - Documented PLATFORM_BASE_DOMAIN in ENVIRONMENT_VARIABLES.md
  - Ready for implementation

- **2025-12-09 (final)**: Implementation session completed
  - Phase 1A: Added PLATFORM_BASE_DOMAIN to env schemas with derivation logic
  - Phase 1B: Updated Kubernetes ConfigMaps (removed redundant derived values)
  - Phase 1C: Removed hardcodes from workflow code, activities, scripts, API routes
  - Phase 1D: Added env-schema mock to tests
  - Phase 2: Implemented tenant redirect in accept-invitation Edge Function
  - Phase 2: Updated AcceptInvitationPage for cross-origin redirects
  - 15 files modified total
  - Ready for deployment and testing
