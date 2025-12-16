# Context: Subdomain Redirect Bug Fix

## Decision Record

**Date**: 2025-12-15
**Feature**: Subdomain Redirect Bug Fix
**Goal**: Ensure users are redirected to their organization's subdomain after invitation acceptance

### Key Decisions

1. **Minimal Fix Approach**: Remove try-catch only, don't optimize DNS quorum tracking
   - The existing DNS retry loop is sufficient
   - Adding state tracking for partial quorum would add unnecessary complexity
   - DNS queries are cheap and idempotent

2. **Let Temporal Handle Retries**: By removing the try-catch, errors propagate to the DNS retry loop
   - Workflow-level retry (7 attempts, 10s-300s backoff) is appropriate for DNS propagation
   - Activity-level retry (3 attempts, 1s-30s) was bypassed by the try-catch anyway

3. **Data Repair via Event Emission**: Fix existing `liveforlife` org by manually emitting the verified event
   - The projection trigger will handle updating `subdomain_status`
   - No direct database updates needed

## Technical Context

### Architecture

```
Frontend → Edge Function → Database Projection → Redirect Decision
                ↑
Temporal Workflow → verifyDNS Activity → Domain Event → Projection Trigger
```

The redirect logic in `accept-invitation/index.ts` checks `subdomain_status === 'verified'` to decide whether to redirect to the subdomain URL.

### Event Flow

1. `configureDNS` creates Cloudflare CNAME record
2. `verifyDNS` queries 3 DNS servers (Google, Cloudflare, OpenDNS)
3. If quorum (2/3) reached, emits `organization.subdomain.verified` event
4. Projection trigger updates `subdomain_status` to `'verified'`
5. Invitation acceptance checks this status for redirect decision

### The Bug

```typescript
// workflow.ts lines 224-233 (THE BUG)
try {
  await verifyDNS({ orgId: state.orgId!, domain: dnsResult.fqdn });
} catch (verifyError) {
  // DNS verification failed, but we'll continue  ← SWALLOWS ERROR
  log.warn('DNS verification failed (non-fatal)', {...});
}
```

When `verifyDNS` throws (quorum not reached), the catch block logs it as "non-fatal" and continues. The `organization.subdomain.verified` event is never emitted.

### Evidence from Temporal Logs

```
[ConfigureDNS] Creating CNAME record: liveforlife.firstovertheline.com → a4c.firstovertheline.com
[VerifyDNS] Quorum: 0/3 (required: 2)
error: Error: DNS verification failed: only 0/3 servers confirmed.
2025-12-15T16:40:12.665Z [WARN] DNS verification failed (non-fatal) { subdomain: 'liveforlife'
```

DNS has since propagated (verified via `dig`), but the event was never emitted.

## File Structure

### Files Modified
- `workflows/src/workflows/organization-bootstrap/workflow.ts` (lines 224-233)
  - Remove try-catch around `verifyDNS` call

### Related Files (Read-Only Context)
- `workflows/src/activities/organization-bootstrap/verify-dns.ts`
  - Implements quorum-based DNS verification
  - Throws error if quorum not reached (correct behavior)
  - Emits `organization.subdomain.verified` event on success

- `infrastructure/supabase/supabase/functions/accept-invitation/index.ts` (lines 295-308)
  - Redirect logic checks `subdomain_status === 'verified'`

- `infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql`
  - Handles `organization.subdomain.verified` event
  - Updates `subdomain_status` to `'verified'` in projection

## Related Components

- **Temporal Worker**: Runs the organization bootstrap workflow
- **Cloudflare DNS**: Target for CNAME records
- **Supabase Edge Functions**: Handle invitation acceptance redirect
- **PostgreSQL Triggers**: Process domain events to update projections

## Key Patterns and Conventions

### DNS Retry Loop Structure (lines 204-265)
```typescript
while (dnsRetryCount < maxDnsRetries && !dnsSuccess) {
  try {
    const dnsResult = await configureDNS({...});
    await verifyDNS({...});  // ← Error should propagate here
    dnsSuccess = true;
  } catch (error) {
    dnsRetryCount++;
    // Exponential backoff: 10s → 20s → 40s → ... → 300s (max)
    await sleep(`${delaySeconds}s`);
  }
}
```

### Activity Idempotency
- `configureDNS`: Check-then-act pattern, returns existing record if found
- `verifyDNS`: Stateless, queries all DNS servers fresh each call

## Important Constraints

- **DNS Propagation Time**: Typically 60-300 seconds
- **Quorum Requirement**: 2 of 3 DNS servers must resolve
- **Retry Budget**: 7 attempts with exponential backoff (~15 min total)
- **WORKFLOW_MODE**: Production mode performs real DNS lookups

## Why This Approach?

**Alternative Considered**: Track partial quorum state between retries
- Only query DNS servers that haven't verified yet
- More efficient but adds complexity

**Chosen Approach**: Minimal fix (remove try-catch)
- Simpler, less risk of introducing new bugs
- DNS queries are cheap (~5s timeout, parallel execution)
- Existing retry loop is well-designed for this use case

## Database State for `liveforlife`

```sql
-- Organization ID: 15179416-0229-4362-ab39-e754891d9d72
-- Current state: subdomain_status = 'verifying'
-- DNS has propagated: dig shows Cloudflare IPs
-- Missing event: organization.subdomain.verified
```
