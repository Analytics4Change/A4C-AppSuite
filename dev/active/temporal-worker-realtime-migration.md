# Temporal Worker Realtime Migration Plan

**Status**: Phase 2 Complete - Ready for Phase 3 Testing
**Created**: 2025-11-27
**Updated**: 2025-11-27
**Priority**: High - Blocks organization bootstrap workflow
**Test Plan**: See `temporal-worker-realtime-migration-test-plan.md` for automated testing procedures

## Problem Summary

Organization bootstrap Edge Function succeeds (HTTP 200) and creates domain events, but Temporal workflows never start because the worker's PostgreSQL NOTIFY listener doesn't receive notifications.

### Root Cause

Worker connects to Supabase connection pooler (`pooler.supabase.com`) instead of direct database. **PostgreSQL LISTEN/NOTIFY does NOT work through connection poolers** because:
- Poolers reuse connections between different clients
- NOTIFY is session-specific and requires persistent connection
- Pooler closes idle connections, breaking LISTEN

### Evidence

1. ✅ Worker logs claim: `✅ Listening for workflow events on PostgreSQL channel: workflow_events`
2. ❌ Database query shows: NO active LISTEN session in `pg_stat_activity`
3. ✅ NOTIFY trigger exists and is deployed: `trigger_notify_bootstrap_initiated`
4. ❌ Worker has received ZERO notifications (checked via logs)
5. ✅ Edge Function successfully creates events in `domain_events` table
6. ✅ Activities emit events correctly via Supabase RPC

## Solution: Migrate to Supabase Realtime

Replace PostgreSQL `pg` LISTEN with Supabase Realtime subscriptions.

### Scope of Changes

**Files to modify:** 2 worker files only
- `workflows/src/worker/event-listener.ts` - Replace `pg` LISTEN with Supabase Realtime
- `workflows/src/worker/index.ts` - Remove PostgreSQL client initialization

**Files unchanged:**
- ❌ Activities (already use Supabase client correctly)
- ❌ Workflows (don't know how they're triggered)
- ❌ Edge Functions (use stream-based `emit_domain_event` RPC signature)
- ❌ Database triggers (continue to work as-is)
- ❌ Database functions (two overloaded versions both work)

## Environment Variables

### Available in ConfigMap (workflow-worker-config)
- ✅ `SUPABASE_URL`
- ✅ `TEMPORAL_ADDRESS`
- ✅ `TEMPORAL_NAMESPACE`
- ✅ `TEMPORAL_TASK_QUEUE`
- ✅ `WORKFLOW_MODE`
- ✅ `NODE_ENV`

### Available in Secrets (workflow-worker-secrets)
- ✅ `SUPABASE_SERVICE_ROLE_KEY`
- ✅ `SUPABASE_DB_URL` (will be removed after migration)

### Currently Used in createEventListener()
- `SUPABASE_DB_URL` or `DATABASE_URL` - PostgreSQL connection (REMOVE)
- `NODE_ENV` - SSL configuration (REMOVE - no longer needed)
- `TEMPORAL_ADDRESS` - Temporal connection (KEEP)
- `TEMPORAL_NAMESPACE` - Temporal namespace (KEEP)
- `SUPABASE_URL` - Supabase client (KEEP)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase auth (KEEP)

## Implementation Steps

### Step 1: Add Environment Variable Validation

**File**: `workflows/src/worker/event-listener.ts`

Add defensive validation function:

```typescript
/**
 * Validate required environment variables
 * @throws Error if required variables are missing
 */
function validateEnvironment(): void {
  const required = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE
  };

  const missing = Object.entries(required)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please check ConfigMap (workflow-worker-config) and Secrets (workflow-worker-secrets)`
    );
  }

  // Validate URL format
  try {
    new URL(required.SUPABASE_URL!);
  } catch {
    throw new Error(`Invalid SUPABASE_URL format: ${required.SUPABASE_URL}`);
  }

  // Validate Temporal address format (host:port)
  if (!/^[^:]+:\d+$/.test(required.TEMPORAL_ADDRESS!)) {
    throw new Error(
      `Invalid TEMPORAL_ADDRESS format: ${required.TEMPORAL_ADDRESS} (expected "host:port")`
    );
  }
}
```

### Step 2: Refactor Event Listener Class

**File**: `workflows/src/worker/event-listener.ts`

Replace imports:
```typescript
// REMOVE: import { Client as PgClient } from 'pg'
// ADD: import type { RealtimeChannel } from '@supabase/realtime-js'
```

Update class:
```typescript
export class WorkflowEventListener {
  // REMOVE: private pgClient: PgClient
  // ADD: private subscription: RealtimeChannel | null = null

  private supabaseClient: ReturnType<typeof createSupabaseClient>
  private temporalClient: TemporalClient
  private isListening = false

  constructor(
    temporalClient: TemporalClient,
    supabaseClient: ReturnType<typeof createSupabaseClient>
  ) {
    this.temporalClient = temporalClient
    this.supabaseClient = supabaseClient
  }

  async start(): Promise<void> {
    if (this.isListening) {
      console.log('[EventListener] Already listening, skipping start')
      return
    }

    try {
      // Subscribe to domain_events table INSERT events
      this.subscription = this.supabaseClient
        .channel('workflow_events')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'domain_events',
            filter: 'event_type=eq.organization.bootstrap.initiated'
          },
          (payload) => {
            this.handleNotification(payload.new).catch((error) => {
              console.error('[EventListener] Error handling notification:', error)
            })
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            this.isListening = true
            console.log('[EventListener] ✅ Subscribed to workflow events via Supabase Realtime')
            console.log('[EventListener]    Channel: workflow_events')
            console.log('[EventListener]    Filter: event_type=eq.organization.bootstrap.initiated')
          } else if (status === 'CLOSED') {
            this.isListening = false
            console.log('[EventListener] ⚠️  Subscription closed')
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[EventListener] ❌ Subscription error:', err)
            this.isListening = false
            // Attempt reconnection
            this.reconnect()
          }
        })

      console.log('[EventListener] Subscription initiated...')
    } catch (error) {
      console.error('[EventListener] Failed to start listener:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.isListening || !this.subscription) {
      return
    }

    try {
      await this.subscription.unsubscribe()
      this.isListening = false
      console.log('[EventListener] Stopped listening for workflow events')
    } catch (error) {
      console.error('[EventListener] Error stopping listener:', error)
    }
  }

  private async handleNotification(event: any): Promise<void> {
    if (!event) {
      console.warn('[EventListener] Received null event, skipping')
      return
    }

    try {
      // Map Realtime payload to EventNotification format
      const notification: EventNotification = {
        event_id: event.id,
        event_type: event.event_type,
        stream_id: event.stream_id,
        stream_type: event.stream_type,
        event_data: event.event_data,
        event_metadata: event.event_metadata,
        created_at: event.created_at
      }

      console.log('[EventListener] Received notification:', {
        event_id: notification.event_id,
        event_type: notification.event_type,
        stream_id: notification.stream_id
      })

      // Route to appropriate handler (existing code)
      switch (notification.event_type) {
        case 'organization.bootstrap.initiated':
          await this.handleBootstrapEvent(notification)
          break

        default:
          console.log(`[EventListener] No handler for event type: ${notification.event_type}`)
      }
    } catch (error) {
      console.error('[EventListener] Error handling notification:', error)
      console.error('[EventListener] Event:', JSON.stringify(event, null, 2))
    }
  }

  // Keep existing: handleBootstrapEvent() (lines 143-189)
  // Keep existing: emitWorkflowStartedEvent() (lines 191-223)

  private async reconnect(): Promise<void> {
    this.isListening = false
    console.log('[EventListener] Attempting to reconnect in 5 seconds...')

    setTimeout(async () => {
      try {
        await this.start()
        console.log('[EventListener] ✅ Reconnected successfully')
      } catch (error) {
        console.error('[EventListener] Reconnection failed:', error)
        this.reconnect()
      }
    }, 5000)
  }
}
```

### Step 3: Refactor createEventListener Factory

**File**: `workflows/src/worker/event-listener.ts` (lines 249-279)

```typescript
/**
 * Create and start event listener
 */
export async function createEventListener(): Promise<WorkflowEventListener> {
  // Validate environment variables first
  validateEnvironment()

  // Create Supabase client
  const supabaseClient = createSupabaseClient(
    process.env.SUPABASE_URL!,  // Already validated
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // Already validated
    {
      auth: {
        persistSession: false
      },
      global: {
        headers: {
          'x-application-name': 'temporal-worker'
        }
      }
    }
  )

  // Create Temporal connection
  let connection: Connection
  try {
    connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS!  // Already validated
    })
  } catch (error) {
    throw new Error(
      `Failed to connect to Temporal at ${process.env.TEMPORAL_ADDRESS}: ${error}`
    )
  }

  // Create Temporal client
  const temporalClient = new TemporalClient({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default'
  })

  // Create and start listener
  const listener = new WorkflowEventListener(temporalClient, supabaseClient)

  try {
    await listener.start()
  } catch (error) {
    // Close Temporal connection if listener fails
    await connection.close()
    throw new Error(`Failed to start event listener: ${error}`)
  }

  return listener
}
```

### Step 4: Update Dependencies

**File**: `workflows/package.json`

Remove: `"pg": "^8.x.x"`

Verify: `"@supabase/supabase-js": "^2.x.x"` includes Realtime support

### Step 5: Test Locally

```bash
# Start local Supabase with Realtime
cd infrastructure/supabase
./local-tests/start-local.sh

# Verify Realtime is enabled
supabase status | grep Realtime

# Start worker
cd ../../workflows
npm run dev

# In separate terminal: Insert test event
export PROJECT_REF="tmrjlswbsxmbglmaclxu"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
psql -h "db.${PROJECT_REF}.supabase.co" -U postgres -d postgres <<'SQL'
INSERT INTO domain_events (
  stream_id,
  stream_type,
  stream_version,
  event_type,
  event_data,
  event_metadata
) VALUES (
  gen_random_uuid(),
  'organization',
  1,
  'organization.bootstrap.initiated',
  '{"subdomain": "test-realtime", "orgData": {"name": "Test Org"}}'::jsonb,
  '{}'::jsonb
);
SQL

# Verify worker logs show:
# [EventListener] ✅ Subscribed to workflow events via Supabase Realtime
# [EventListener] Received notification: event_id=...
# [EventListener] ✅ Workflow started: ...
```

### Step 6: Deploy to Kubernetes

```bash
# Build Docker image
cd workflows
docker build -t ghcr.io/analytics4change/a4c-workflows:latest .

# Push to registry
docker push ghcr.io/analytics4change/a4c-workflows:latest

# Deploy to k8s
kubectl rollout restart deployment/workflow-worker -n temporal
kubectl rollout status deployment/workflow-worker -n temporal

# Verify subscription in logs
kubectl logs -n temporal -l app=workflow-worker --tail=50 | grep Realtime

# Expected output:
# [EventListener] ✅ Subscribed to workflow events via Supabase Realtime
```

### Step 7: Test End-to-End

1. Submit organization form at `https://a4c.firstovertheline.com/organizations/new`
2. Check browser network tab - Edge Function returns HTTP 200
3. Check Temporal Web UI - Workflow appears with ID `org-bootstrap-{orgId}`
4. Verify projections populate:
   ```sql
   SELECT * FROM organizations_projection WHERE name = 'your-test-org';
   SELECT * FROM invitations_projection WHERE organization_id = 'your-org-id';
   ```

### Step 8: Cleanup

Remove `SUPABASE_DB_URL` from secrets (no longer needed):

```bash
kubectl patch secret workflow-worker-secrets -n temporal \
  --type=json \
  -p='[{"op":"remove","path":"/data/SUPABASE_DB_URL"}]'
```

## Benefits of Supabase Realtime

✅ **No direct database connection** - Works through Supabase API
✅ **No connection pooling issues** - Pooler doesn't interfere
✅ **Built-in reconnection** - Automatic recovery from disconnects
✅ **Better monitoring** - Supabase Dashboard shows Realtime connections
✅ **Consistent with best practices** - Uses Supabase features properly
✅ **Defensive programming** - Validates env vars, catches errors early

## Rollback Plan

If Realtime doesn't work:

**Option A**: Revert code changes
```bash
git revert <commit-hash>
docker build && docker push
kubectl rollout restart deployment/workflow-worker -n temporal
```

**Option B**: Fix connection pooler issue (not recommended)
1. Update `SUPABASE_DB_URL` to direct database host:
   - Change from: `pooler.supabase.com`
   - Change to: `db.tmrjlswbsxmbglmaclxu.supabase.co`
2. Keep original `pg` LISTEN implementation
3. Restart worker

**Option C**: Polling fallback (last resort)
1. Remove LISTEN/Realtime entirely
2. Poll `domain_events` table every 5 seconds
3. Much less efficient but guaranteed to work

## Success Criteria

- [ ] Worker logs show `✅ Subscribed to workflow events via Supabase Realtime`
- [ ] Supabase Dashboard shows active Realtime connection in project
- [ ] Environment variable validation catches missing vars on startup
- [ ] Submit organization form → Workflow starts in Temporal
- [ ] Temporal Web UI shows workflow execution with correct ID
- [ ] Projections populate: `organizations_projection`, `invitations_projection`
- [ ] No undefined/null/connection errors in worker logs
- [ ] Worker gracefully reconnects if Realtime subscription drops

## Related Issues

**Test Organization**: `poc-test1-20251126`
- Organization ID: `0979276c-78dc-4056-a30a-c18638f65de3`
- Workflow ID: `fe92b5c5-698f-4b91-a085-7e0f24168091` (never started)
- Event ID: `e035216a-ca66-48e6-8d1f-cccc8c78a4c6` (created successfully)

**Cleanup Script**: `/tmp/cleanup-poc-test1-20251126.sql` - Removes test data

## References

- Worker code: `workflows/src/worker/event-listener.ts`
- Worker init: `workflows/src/worker/index.ts`
- Edge Function: `infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts`
- NOTIFY trigger: `infrastructure/supabase/sql/04-triggers/process_organization_bootstrap_initiated.sql`
- Event emission: `workflows/src/shared/utils/emit-event.ts`
