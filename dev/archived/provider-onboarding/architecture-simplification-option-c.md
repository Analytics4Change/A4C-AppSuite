# Architecture Simplification: Option C Implementation Plan

**Status**: Ready to Implement
**Created**: 2025-12-01
**Context**: See `documentation/retrospectives/2025-11-temporal-worker-migration.md`

## Executive Summary

This plan implements **Option C (Hybrid Architecture)** to simplify workflow triggering while preserving event sourcing for state management.

**Current Architecture** (5 hops):
```
Frontend → Edge Function → PostgreSQL → Realtime → Worker → Temporal
```

**Target Architecture** (2 hops):
```
Frontend → Edge Function → Temporal
          ↓ (parallel)
          PostgreSQL (audit trail)
```

**Timeline**: 1 week (POC/staging environment - no migration needed)
**Deployment**: GitHub Actions automated workflows

## Key Benefits

1. **Simplicity**: Remove 509 lines of event listener code
2. **Reliability**: Direct RPC eliminates 3 integration points
3. **Observability**: Failures surface immediately in Edge Function logs
4. **Testing**: Local development matches production
5. **Performance**: Reduce workflow trigger latency by ~500ms

## Architecture Changes

### What We're Removing

1. **Event-Driven Workflow Triggering**: PostgreSQL → Realtime → Worker listener chain
2. **workflow_queue_projection**: Read model for pending workflows
3. **Event Listener Code**: `workflows/src/worker/event-listener.ts` (509 lines)
4. **Database Trigger**: `enqueue_workflow_from_bootstrap_event`

### What We're Keeping

1. **Event Sourcing**: All state changes still recorded in `domain_events`
2. **CQRS Projections**: `organizations_projection`, `organization_members_projection`, etc.
3. **Activity Event Emission**: Activities emit events that trigger projections
4. **Audit Trail**: Complete event history preserved

### What We're Adding

1. **Direct Temporal Client**: Edge Function calls Temporal gRPC API
2. **Synchronous Error Handling**: Workflow start failures return to frontend immediately

## Implementation Phases

### Phase 1: Edge Function Update (Day 1-2)

**Goal**: Add direct Temporal client to organization-bootstrap Edge Function

#### Step 1.1: Update Dependencies

**File**: `infrastructure/supabase/functions/deno.json`

```json
{
  "imports": {
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2",
    "@temporalio/client": "npm:@temporalio/client@^1.10.0"
  }
}
```

#### Step 1.2: Update Edge Function

**File**: `infrastructure/supabase/functions/organization-bootstrap/index.ts`

```typescript
import { createClient } from '@supabase/supabase-js'
import { Connection, Client } from '@temporalio/client'

const TEMPORAL_ADDRESS = Deno.env.get('TEMPORAL_ADDRESS') || 'temporal-frontend.temporal.svc.cluster.local:7233'
const TEMPORAL_NAMESPACE = Deno.env.get('TEMPORAL_NAMESPACE') || 'default'

Deno.serve(async (req) => {
  try {
    // 1. Parse request
    const { orgName, subdomain, adminUserId } = await req.json()

    // 2. Validate input
    if (!orgName || !subdomain || !adminUserId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 3. Emit domain event (audit trail)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: event, error: eventError } = await supabase.rpc('emit_domain_event', {
      p_event_type: 'OrganizationBootstrapRequested',
      p_aggregate_type: 'Organization',
      p_aggregate_id: crypto.randomUUID(),
      p_event_data: { orgName, subdomain, adminUserId },
      p_metadata: { source: 'edge-function', triggeredBy: adminUserId }
    }).schema('api').single()

    if (eventError) {
      console.error('Failed to emit event:', eventError)
      return new Response(
        JSON.stringify({ error: 'Failed to record event' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 4. Start Temporal workflow (direct RPC)
    const connection = await Connection.connect({ address: TEMPORAL_ADDRESS })
    const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE })

    const workflowId = `org-bootstrap-${subdomain}-${Date.now()}`
    const handle = await client.workflow.start('organizationBootstrap', {
      taskQueue: 'bootstrap',
      workflowId,
      args: [{
        orgName,
        subdomain,
        adminUserId,
        eventId: event.event_id // Link to audit event
      }]
    })

    console.log('Workflow started:', workflowId)

    // 5. Return success
    return new Response(
      JSON.stringify({
        success: true,
        workflowId,
        eventId: event.event_id
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

#### Step 1.3: Add Environment Variables

**Via Supabase Dashboard** → Project Settings → Edge Functions → Environment Variables:

```bash
TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
TEMPORAL_NAMESPACE=default
```

#### Step 1.4: Deploy Edge Function

**Deployment**: Automatic via GitHub Actions

Push changes to `main` branch:
```bash
git add infrastructure/supabase/functions/
git commit -m "feat(edge-functions): Add direct Temporal workflow triggering"
git push origin main
```

GitHub Actions workflow `.github/workflows/edge-functions-deploy.yml` will:
1. Detect changes in `infrastructure/supabase/functions/**`
2. Deploy to Supabase using `supabase functions deploy`
3. Environment variables already configured in Supabase dashboard

**Verification**:
```bash
# Check GitHub Actions run
gh run list --workflow=edge-functions-deploy.yml --limit 1

# Test Edge Function
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/organization-bootstrap \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "orgName": "Test Org",
    "subdomain": "test-poc-$(date +%s)",
    "adminUserId": "YOUR_USER_ID"
  }'
```

---

### Phase 2: Worker Simplification (Day 2-3)

**Goal**: Remove event listener code, use standard Temporal worker

#### Step 2.1: Delete Event Listener

**File to DELETE**: `workflows/src/worker/event-listener.ts` (509 lines)

```bash
git rm workflows/src/worker/event-listener.ts
```

#### Step 2.2: Simplify Worker

**File**: `workflows/src/worker/index.ts`

**BEFORE** (with event listener):
```typescript
import { eventListener } from './event-listener'
import { Worker } from '@temporalio/worker'

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('../workflows'),
    activities,
    taskQueue: 'bootstrap'
  })

  // Start event listener
  const listener = eventListener(worker)
  await listener.start()

  await worker.run()
}

run().catch(console.error)
```

**AFTER** (standard Temporal worker):
```typescript
import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from '../activities'

async function run() {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
  })

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: 'bootstrap',
    workflowsPath: require.resolve('../workflows'),
    activities
  })

  console.log('Worker started on task queue: bootstrap')
  await worker.run()
}

run().catch((err) => {
  console.error('Worker failed:', err)
  process.exit(1)
})
```

#### Step 2.3: Update Package.json Scripts

**File**: `workflows/package.json`

No changes needed - scripts already correct:
```json
{
  "scripts": {
    "worker": "ts-node src/worker/index.ts",
    "dev": "nodemon --watch src --ext ts --exec npm run worker"
  }
}
```

#### Step 2.4: Commit Changes

```bash
git add workflows/src/worker/
git commit -m "refactor(workflows): Remove event listener, use standard Temporal worker"
```

---

### Phase 3: Deployment via GitHub Actions (Day 3-4)

**Goal**: Deploy simplified worker to Kubernetes using automated workflow

#### Step 3.1: Push Changes

```bash
git push origin main
```

#### Step 3.2: Monitor GitHub Actions

GitHub Actions workflow `.github/workflows/workflows-docker.yml` will automatically:

1. **Build Docker Image**:
   ```yaml
   - uses: docker/build-push-action@v5
     with:
       context: ./workflows
       file: ./workflows/Dockerfile
       push: true
       tags: |
         ghcr.io/${{ github.repository }}/temporal-worker:${{ github.sha }}
         ghcr.io/${{ github.repository }}/temporal-worker:latest
   ```

2. **Deploy to Kubernetes**:
   ```yaml
   - name: Deploy to Kubernetes
     run: |
       kubectl set image deployment/temporal-worker \
         temporal-worker=ghcr.io/${{ github.repository }}/temporal-worker:${{ github.sha }} \
         -n temporal
       kubectl rollout status deployment/temporal-worker -n temporal --timeout=5m
   ```

3. **Verify Deployment**:
   ```bash
   # Check GitHub Actions run
   gh run watch

   # Verify pods restarted
   kubectl get pods -n temporal -l app=temporal-worker

   # Check worker logs
   kubectl logs -n temporal -l app=temporal-worker --tail=50 --follow
   ```

#### Step 3.3: Expected Log Output

```
Worker started on task queue: bootstrap
Connected to Temporal at temporal-frontend.temporal.svc.cluster.local:7233
Namespace: default
Task queue: bootstrap
Polling for workflows...
```

**Key Difference**: No more "Event listener started" or Supabase Realtime connection logs.

---

### Phase 4: Database Cleanup (Day 4-5)

**Goal**: Remove unused event-driven workflow triggering infrastructure

#### Step 4.1: Create Migration to Remove Trigger

**File**: `infrastructure/supabase/migrations/YYYYMMDDHHMMSS_remove_workflow_queue_trigger.sql`

```sql
-- Remove workflow queue trigger (no longer needed)
DROP TRIGGER IF EXISTS trigger_enqueue_workflow_from_bootstrap_event
  ON api.domain_events;

DROP FUNCTION IF EXISTS api.enqueue_workflow_from_bootstrap_event();

-- Keep workflow_queue_projection table for now (contains historical data)
-- Can be removed in future cleanup if no longer needed for reporting

COMMENT ON TABLE api.workflow_queue_projection IS
  'Deprecated: Legacy workflow queue from event-driven triggering.
   Kept for historical data only. New workflows trigger via direct RPC.';
```

#### Step 4.2: Apply Migration

**Local Testing**:
```bash
cd infrastructure/supabase
./local-tests/start-local.sh
./local-tests/run-migrations.sh
./local-tests/stop-local.sh
```

**Production Deployment**:
```bash
# Migration auto-deploys via GitHub Actions when pushed to main
git add infrastructure/supabase/migrations/
git commit -m "refactor(db): Remove workflow queue trigger (direct RPC migration)"
git push origin main
```

---

### Phase 5: Testing & Validation (Day 5-7)

**Goal**: Verify end-to-end workflow triggering and event sourcing

#### Test Plan

##### Test 1: Happy Path - Organization Bootstrap

**Steps**:
1. Open frontend: `https://your-frontend.vercel.app`
2. Navigate to "Create Organization"
3. Fill in:
   - Organization Name: "Test POC Direct RPC"
   - Subdomain: `test-direct-rpc-${timestamp}`
   - Admin User: (current user)
4. Click "Create Organization"

**Expected Results**:
- ✅ Frontend shows "Organization creation in progress"
- ✅ Edge Function returns `{ success: true, workflowId: "...", eventId: "..." }`
- ✅ Temporal UI shows workflow running: `org-bootstrap-test-direct-rpc-*`
- ✅ `domain_events` table has `OrganizationBootstrapRequested` event
- ✅ Organization appears in `organizations_projection` within 30 seconds
- ✅ Admin user added to `organization_members_projection`
- ✅ Subdomain DNS record created (verify in Cloudflare)
- ✅ Invitation email sent (check logs)

**Verification Queries**:
```sql
-- Check domain event
SELECT event_type, aggregate_id, created_at, event_data
FROM api.domain_events
WHERE event_data->>'subdomain' = 'test-direct-rpc-123456'
ORDER BY created_at DESC;

-- Check projection
SELECT org_id, name, subdomain, status, created_at
FROM api.organizations_projection
WHERE subdomain = 'test-direct-rpc-123456';

-- Check workflow queue (should be empty - not used anymore)
SELECT COUNT(*)
FROM api.workflow_queue_projection
WHERE created_at > NOW() - INTERVAL '1 hour';
```

##### Test 2: Error Handling - Invalid Input

**Steps**:
1. Call Edge Function with missing field:
   ```bash
   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/organization-bootstrap \
     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"orgName": "Test", "subdomain": ""}'
   ```

**Expected Results**:
- ✅ Edge Function returns 400 error immediately
- ✅ No domain event created
- ✅ No Temporal workflow started
- ✅ Error logged in Edge Function logs

##### Test 3: Error Handling - Temporal Unavailable

**Steps**:
1. Simulate Temporal downtime:
   ```bash
   kubectl scale deployment temporal-frontend -n temporal --replicas=0
   ```
2. Attempt organization creation via frontend

**Expected Results**:
- ✅ Edge Function returns 500 error with timeout message
- ✅ Domain event created (audit trail preserved)
- ✅ Frontend shows error: "Unable to start workflow"
- ✅ User can retry after Temporal is back

**Cleanup**:
```bash
kubectl scale deployment temporal-frontend -n temporal --replicas=1
```

##### Test 4: Event Sourcing Verification

**Goal**: Confirm event-driven projections still work

**Steps**:
1. Start organization bootstrap workflow
2. Monitor `domain_events` table for activity events
3. Verify projections update via triggers

**Expected Event Flow**:
```
1. OrganizationBootstrapRequested (from Edge Function)
2. OrganizationCreated (from createOrganization activity)
3. OrganizationMemberAdded (from addOrganizationMember activity)
4. DNSRecordCreated (from provisionDNS activity)
5. InvitationEmailSent (from sendInvitationEmail activity)
6. OrganizationBootstrapCompleted (from workflow completion)
```

**Verification**:
```sql
-- Check all events for a workflow
SELECT
  event_type,
  aggregate_type,
  created_at,
  event_data->>'workflowId' as workflow_id,
  event_data->>'subdomain' as subdomain
FROM api.domain_events
WHERE event_data->>'workflowId' = 'org-bootstrap-test-direct-rpc-123456'
ORDER BY created_at ASC;
```

##### Test 5: Performance Comparison

**Before** (5 hops):
```
Frontend → Edge Function → PostgreSQL → Realtime → Worker → Temporal
Average workflow start latency: ~800ms
```

**After** (2 hops):
```
Frontend → Edge Function → Temporal
Expected workflow start latency: ~200ms
```

**Measurement**:
```bash
# Time Edge Function response
time curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/organization-bootstrap \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "orgName": "Performance Test",
    "subdomain": "perf-test-$(date +%s)",
    "adminUserId": "YOUR_USER_ID"
  }'
```

---

## Rollback Plan

If critical issues are found, rollback is straightforward since this is a POC/staging environment:

### Quick Rollback (< 10 minutes)

1. **Revert Git Commits**:
   ```bash
   git revert HEAD~3..HEAD  # Revert last 3 commits
   git push origin main
   ```

2. **Redeploy Previous Worker**:
   ```bash
   # GitHub Actions will automatically redeploy old worker image
   gh run watch
   ```

3. **Restore Database Trigger**:
   ```sql
   -- Re-create trigger (SQL from previous migration)
   CREATE OR REPLACE FUNCTION api.enqueue_workflow_from_bootstrap_event()
   RETURNS TRIGGER AS $$
   BEGIN
     INSERT INTO api.workflow_queue_projection (
       workflow_type,
       workflow_input,
       status,
       event_id
     ) VALUES (
       'organizationBootstrap',
       NEW.event_data,
       'pending',
       NEW.event_id
     );
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   CREATE TRIGGER trigger_enqueue_workflow_from_bootstrap_event
     AFTER INSERT ON api.domain_events
     FOR EACH ROW
     WHEN (NEW.event_type = 'OrganizationBootstrapRequested')
     EXECUTE FUNCTION api.enqueue_workflow_from_bootstrap_event();
   ```

4. **Verify Event Listener**:
   ```bash
   kubectl logs -n temporal -l app=temporal-worker --tail=100 | grep "Event listener"
   ```

### Root Cause Analysis After Rollback

If rollback is needed, investigate:
1. Edge Function logs: `supabase functions logs organization-bootstrap`
2. Worker logs: `kubectl logs -n temporal -l app=temporal-worker`
3. Temporal UI: Check workflow failures
4. Database events: Check for missing events in `domain_events`

---

## Success Metrics

### Quantitative
- ✅ Workflow start latency < 300ms (vs. ~800ms before)
- ✅ Zero integration-related silent failures in 1 week of testing
- ✅ 509 lines of event listener code removed
- ✅ Local development == production environment (no Realtime dependency)

### Qualitative
- ✅ Edge Function errors visible immediately in logs
- ✅ Workflow failures return to frontend
- ✅ Event sourcing preserved (complete audit trail)
- ✅ CQRS projections still update correctly
- ✅ Simpler mental model for debugging

---

## Post-Implementation

### Documentation Updates

1. **Architecture Diagrams**: Update to show direct RPC flow
2. **Developer Onboarding**: Simplify workflow triggering guide
3. **Runbook**: Remove Supabase Realtime troubleshooting sections

### Monitoring

1. **Edge Function Metrics**:
   - Success rate: > 99%
   - Response time: p95 < 500ms
   - Error rate: < 1%

2. **Worker Metrics**:
   - Task queue lag: < 10 tasks
   - Workflow success rate: > 95%
   - Average workflow duration: ~ 30 seconds

3. **Event Sourcing Health**:
   - Event emission rate: matches workflow activity count
   - Projection lag: < 2 seconds

### Future Optimizations

1. **Batch Operations**: If needed, add batch organization creation endpoint
2. **Async Status**: Return immediately with workflow ID, poll for status
3. **Retry Logic**: Add exponential backoff for Temporal connection failures
4. **Circuit Breaker**: Protect Edge Function from cascading failures

---

## References

- **Retrospective**: `documentation/retrospectives/2025-11-temporal-worker-migration.md`
- **Migration Context**: `dev/active/temporal-worker-realtime-migration-context.md`
- **GitHub Actions Workflow**: `.github/workflows/workflows-docker.yml`
- **Edge Function Deploy**: `.github/workflows/edge-functions-deploy.yml`
- **Temporal Docs**: https://docs.temporal.io/typescript/workers
- **Supabase Edge Functions**: https://supabase.com/docs/guides/functions

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-01 | Use GitHub Actions for deployment | Automated, consistent, already configured |
| 2025-12-01 | Keep event sourcing | Works well, provides audit trail, supports CQRS |
| 2025-12-01 | Direct RPC from Edge Function | Eliminates 3 integration points, improves observability |
| 2025-12-01 | Remove event listener (509 lines) | No longer needed with direct RPC |
| 2025-12-01 | 1-week timeline | POC environment allows direct implementation |

---

**Next Steps**: Begin Phase 1 implementation (Edge Function update)
