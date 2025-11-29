# Post-Clear Context Recovery Prompt

**Use this prompt after running `/clear` to quickly regain context:**

---

Read the following documents to understand our current state:

1. **Migration Status**: `@dev/active/temporal-worker-realtime-migration-tasks.md`
   - Shows Phase 1-4 COMPLETE (including production deployment)
   - Phase 5-7 still pending (end-to-end testing, cleanup, monitoring)

2. **Architecture Context**: `@dev/active/temporal-worker-realtime-migration-context.md`
   - Contains all architectural decisions (13 decisions total)
   - Explains why we migrated from PostgreSQL LISTEN/NOTIFY to Supabase Realtime
   - Documents strict CQRS implementation with workflow queue projection

3. **Implementation Plan**: `@dev/active/temporal-worker-realtime-migration.md`
   - Complete step-by-step migration guide
   - Environment variable requirements
   - Testing procedures

---

## Current State (as of 2025-11-29 01:14:19 UTC)

**✅ DEPLOYED TO PRODUCTION** (commit f89c848)

The Temporal worker has been successfully migrated from PostgreSQL LISTEN/NOTIFY to Supabase Realtime with strict CQRS architecture. All code changes, database migrations, and CI/CD fixes have been deployed to the production Kubernetes cluster.

### What Was Deployed

1. **Worker Code** (`workflows/src/worker/event-listener.ts`):
   - Migrated from PostgreSQL LISTEN to Supabase Realtime subscription
   - Subscribes to `workflow_queue_projection` table (status=eq.pending)
   - Implements strict CQRS (all updates via events, not direct SQL)
   - Fixed all RPC calls to use `.schema('api')` prefix

2. **Database Schema** (via Supabase migrations):
   - `workflow_queue_projection` table (CQRS read model)
   - `enqueue_workflow_from_bootstrap_event` trigger
   - `update_workflow_queue_projection_from_event` trigger

3. **CI/CD Pipeline** (`.github/workflows/temporal-deploy.yml`):
   - Fixed Docker build cache invalidation (scoped per commit SHA)
   - Fixed Kubernetes deployment to use commit SHA tags (not `:latest`)

### Verified Working

- ✅ Worker starts successfully in production pod
- ✅ Subscribes to Realtime (`workflow_queue` channel)
- ✅ 5-event chain tested end-to-end:
  1. `organization.bootstrap.initiated`
  2. `workflow.queue.pending` (trigger auto-creates queue job)
  3. `workflow.queue.claimed` (worker claims job)
  4. `organization.bootstrap.workflow_started` (workflow starts in Temporal)
  5. `workflow.queue.completed` (job marked complete)

### Next Steps (When Ready)

**Phase 5: End-to-End Testing** (test via UI)
- Navigate to `https://a4c.firstovertheline.com/organizations/new`
- Create test organization and verify workflow executes
- Check Temporal Web UI for workflow completion
- Verify database projections populated correctly

**Phase 6: Cleanup** (remove deprecated config)
- Remove `SUPABASE_DB_URL` from Kubernetes secrets (no longer needed)
- Clean up test data from development testing

**Phase 7: Monitoring** (production stability)
- Monitor worker logs for 24 hours
- Track workflow success rate
- Verify no reconnection loops

---

## Quick Commands

**Verify worker is running:**
```bash
kubectl logs -n temporal -l app=workflow-worker --tail=50
```

**Check Realtime subscription:**
```bash
kubectl logs -n temporal -l app=workflow-worker --tail=50 | grep Realtime
```

**Expected output:**
```
[EventListener] ✅ Subscribed to workflow queue via Supabase Realtime
[EventListener]    Channel: workflow_queue
[EventListener]    Table: workflow_queue_projection
[EventListener]    Filter: status=eq.pending
```

**Test organization bootstrap via UI:**
```
https://a4c.firstovertheline.com/organizations/new
```

**Port-forward Temporal Web UI:**
```bash
kubectl port-forward -n temporal svc/temporal-frontend 8080:8080
# Then visit: http://localhost:8080
```

---

## If You Need to Rollback

See `temporal-worker-realtime-migration-tasks.md` section "Rollback Procedure" for three rollback options.

---

## Related Documents

- **AsyncAPI Contract**: `@infrastructure/supabase/contracts/organization-bootstrap-events.yaml`
- **Worker Code**: `@workflows/src/worker/event-listener.ts`
- **CI/CD Pipeline**: `@.github/workflows/temporal-deploy.yml`
- **Database Schema**: `@infrastructure/supabase/sql/02-tables/workflow_queue_projection/table.sql`

---

**IMPORTANT**: Before making any changes, verify the worker is healthy in production using the commands above.
