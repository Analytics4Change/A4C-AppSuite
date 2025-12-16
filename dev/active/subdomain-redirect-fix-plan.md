# Implementation Plan: Subdomain Redirect Bug Fix

## Executive Summary

Fix the subdomain redirect functionality that broke after invitation acceptance. Users should be redirected to their organization's subdomain (e.g., `liveforlife.firstovertheline.com`) after accepting an invitation, but instead they're redirected to the generic path (`/organizations/{id}/dashboard`).

The root cause is that the `verifyDNS` activity throws an error when DNS hasn't propagated yet, but the workflow catches and swallows this error instead of letting Temporal retry. This prevents the `organization.subdomain.verified` event from ever being emitted, leaving `subdomain_status` stuck at `'verifying'`.

## Phase 1: Code Fix

### 1.1 Remove Try-Catch Around verifyDNS
- Remove the try-catch block that swallows `verifyDNS` errors
- Allow errors to propagate to the DNS retry loop's outer catch
- The existing retry loop (7 attempts, exponential backoff 10s-300s) handles retries

### 1.2 Verify Retry Behavior
- Confirm error propagates to DNS retry loop (line 235)
- Verify exponential backoff timing is appropriate for DNS propagation (60-300s typical)
- Confirm `configureDNS` is idempotent on retry (returns existing record)

## Phase 2: Data Repair

### 2.1 Fix Existing Organization
- Manually emit `organization.subdomain.verified` event for `liveforlife` organization
- Verify the projection trigger updates `subdomain_status` to `'verified'`
- Test redirect works for existing invitation

## Phase 3: Deployment & Validation

### 3.1 Deploy Worker
- Build and push updated worker Docker image
- Deploy to Kubernetes cluster
- Verify worker connects to Temporal

### 3.2 End-to-End Validation
- Bootstrap a new test organization
- Verify DNS verification retries until propagated
- Verify `organization.subdomain.verified` event emitted
- Verify subdomain redirect works after invitation acceptance

## Success Metrics

### Immediate
- [ ] Code change deployed to production worker
- [ ] `liveforlife` organization has `subdomain_status = 'verified'`
- [ ] Existing user can access `liveforlife.firstovertheline.com`

### Medium-Term
- [ ] New organization bootstraps complete with verified subdomain
- [ ] Invitation acceptance redirects to subdomain correctly

### Long-Term
- [ ] No organizations stuck in `subdomain_status = 'verifying'`
- [ ] DNS verification consistently succeeds within retry window

## Implementation Schedule

| Phase | Task | Time Estimate |
|-------|------|---------------|
| 1.1 | Remove try-catch | 5 minutes |
| 2.1 | Data repair for liveforlife | 10 minutes |
| 3.1 | Deploy worker | 15 minutes |
| 3.2 | E2E validation | 15 minutes |

**Total**: ~45 minutes

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| DNS never propagates | Existing 7-retry limit prevents infinite loop; workflow fails gracefully with compensation |
| Retry loop too aggressive | 10s minimum delay, exponential backoff prevents API rate limiting |
| `configureDNS` not idempotent | Already verified - returns existing record if found |

## Next Steps After Completion

1. Monitor new organization bootstraps for successful subdomain verification
2. Consider adding alerting for organizations stuck in `verifying` state
3. Document the DNS verification flow in workflow architecture docs
