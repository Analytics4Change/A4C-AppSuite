# Temporal Worker Realtime Migration - Context

**Created**: 2025-11-27
**Updated**: 2025-12-02
**Status**: Phase 11 Complete - Architecture Simplification Deployed & Backend API HTTPS Fixed
**Priority**: High - Ready for Phase 2 End-to-End Testing

**Related Documents**:
- **Implementation Plan**: `temporal-worker-realtime-migration.md`
- **Task Tracking**: `temporal-worker-realtime-migration-tasks.md`
- **Test Plan**: `temporal-worker-realtime-migration-test-plan.md` (Automated testing with progress tracking)

## Problem Statement

Organization bootstrap Edge Function succeeds (HTTP 200) and creates domain events, but Temporal workflows never start because the worker's PostgreSQL NOTIFY listener doesn't receive notifications.

## Root Cause

Worker connects to Supabase connection pooler (`pooler.supabase.com`) instead of direct database. **PostgreSQL LISTEN/NOTIFY does NOT work through connection poolers** because:
- Poolers reuse connections between different clients
- NOTIFY is session-specific and requires persistent connection
- Pooler closes idle connections, breaking LISTEN

## Evidence Discovered

1. ✅ Worker logs claim: `✅ Listening for workflow events on PostgreSQL channel: workflow_events`
2. ❌ Database query shows: NO active LISTEN session in `pg_stat_activity`
3. ✅ NOTIFY trigger exists and is deployed: `trigger_notify_bootstrap_initiated`
4. ❌ Worker has received ZERO notifications (checked via logs)
5. ✅ Edge Function successfully creates events in `domain_events` table
6. ✅ Activities emit events correctly via Supabase RPC

### Test Organization Details

**Test Organization**: `poc-test1-20251126`
- Organization ID: `0979276c-78dc-4056-a30a-c18638f65de3`
- Workflow ID: `fe92b5c5-698f-4b91-a085-7e0f24168091` (never started)
- Event ID: `e035216a-ca66-48e6-8d1f-cccc8c78a4c6` (created successfully)

**Cleanup Script**: `/tmp/cleanup-poc-test1-20251126.sql` - Removes test data

## Solution: Migrate to Supabase Realtime

Replace PostgreSQL `pg` LISTEN with Supabase Realtime subscriptions.

### Key Decisions

1. **Use Supabase Realtime instead of fixing pooler connection**: Realtime is the proper Supabase-native approach and avoids connection pooling issues entirely - 2025-11-27

2. **Add defensive environment variable validation**: Worker should fail fast with clear error messages if required env vars are missing or malformed - 2025-11-27

3. **Keep two-signature RPC approach**: Both stream-based (Edge Functions) and aggregate-based (Activities) signatures for `emit_domain_event` work correctly and should be preserved - 2025-11-27

4. **Implement automatic reconnection**: Worker should automatically reconnect if Realtime subscription drops - 2025-11-27

5. **Remove `pg` dependency entirely**: No longer needed after migration to Realtime - 2025-11-27

6. **CRITICAL ARCHITECTURAL CHANGE - Implement Strict CQRS**: Do NOT subscribe to `domain_events` table directly. Create purpose-built `workflow_queue_projection` read model and subscribe to that instead - 2025-11-28
   - **Rationale**: Subscribing to write model (`domain_events`) violates CQRS separation of concerns
   - **Pattern**: Projection is the queue, subscription is on projection status changes
   - **Benefits**: Cleaner separation, better scalability, observability via projection state

7. **Single unified workflow queue**: All workflow types use one `workflow_queue_projection` table, differentiated by `event_type` field - 2025-11-28
   - **Anti-pattern avoided**: Creating separate projections per workflow type
   - **Rationale**: Simpler schema, easier worker scaling, single subscription point

8. **Use `event_type` directly, no redundant `workflow_type` field**: Event type from AsyncAPI contract is sufficient to route jobs - 2025-11-28
   - **Rationale**: `event_type` (e.g., `organization.bootstrap.initiated`) already identifies workflow
   - **Anti-pattern avoided**: Storing redundant metadata that duplicates event schema

9. **Strict CQRS: ALL projection updates via events and triggers**: Worker never writes directly to `workflow_queue_projection` - 2025-11-28
   - **Write path**: Worker emits events (`workflow.queue.claimed`, `completed`, `failed`)
   - **Projection path**: Database triggers process events and update projection
   - **Benefits**: Maintains event sourcing immutability, complete audit trail, idempotent updates

10. **AsyncAPI Contract Expansion**: Added 4 new workflow queue events to document CQRS pattern - 2025-11-28
    - `workflow.queue.pending` - Job created (trigger auto-emits when bootstrap event arrives)
    - `workflow.queue.claimed` - Worker claims job (worker emits, trigger marks processing)
    - `workflow.queue.completed` - Workflow succeeded (worker emits, trigger marks completed)
    - `workflow.queue.failed` - Workflow failed (worker emits, trigger marks failed)

11. **RPC Schema Prefix Requirement**: ALL RPC calls to api schema MUST use `.schema('api')` prefix - 2025-11-28
    - **Critical Fix**: `emitWorkflowStartedEvent` was failing without this prefix
    - **Error**: `PGRST106: The schema must be one of the following: api`
    - **Applies to**: `emit_domain_event`, `emit_workflow_started_event`, all api schema RPCs
    - **Does NOT apply to**: Table operations (`.from('table')` uses public schema by default)

12. **Docker Build Cache Must Invalidate Per Commit**: Use commit SHA in cache scope to prevent stale image caching - 2025-11-29
    - **Problem**: GitHub Actions cache reused layers from previous builds even when source code changed
    - **Solution**: `cache-to: type=gha,mode=max,scope=${{ github.ref_name }}-${{ github.sha }}`
    - **Benefit**: Each commit gets unique cache key, forcing rebuild of changed layers
    - **Impact**: Prevents deploying stale code while maintaining fast builds via layer caching

13. **Kubernetes Deployment Requires Unique Image Tags**: Using `:latest` tag prevents pod restarts when image changes - 2025-11-29
    - **Problem**: `kubectl set image` with same tag (`:latest`) doesn't trigger pod restart
    - **Root Cause**: Kubernetes sees no tag change, doesn't pull new image, pod runs old code
    - **Solution**: Deploy using commit SHA tag (`:f89c848`) instead of `:latest`
    - **Implementation**: `IMAGE_TAG=$(echo "$tags" | grep -v latest | head -n1)`
    - **Benefit**: Each commit gets unique tag, forcing automatic pod restart with new image

14. **Apply Same Tagging Strategy to All Deployments**: Frontend and all services should use identical Docker tagging and deployment patterns - 2025-11-29
    - **Consistency**: Frontend now uses same commit SHA tagging as Temporal worker
    - **Pattern**: Short SHA tag (`:12b1168`), semver tags (`:1.0.0`, `:1.0`, `:1`), `:latest`
    - **Deployment**: `kubectl set image` with SHA tag, no manual `rollout restart` needed
    - **Cache**: Branch + commit SHA scoping prevents stale builds

15. **Phase 2 Architecture Simplification (Option C)**: Remove event-driven workflow triggering, simplify from 5 hops to 2 hops - 2025-12-01
    - **Decision**: Implement Option C (Hybrid Architecture) from retrospective analysis
    - **Keep**: Event sourcing for state management (works well, provides audit trail)
    - **Remove**: Event-driven workflow triggering via Realtime (too complex, 5-hop chain)
    - **Old Flow**: Frontend → Edge Function → PostgreSQL → Realtime → Worker → Temporal (5 hops, ~600ms latency)
    - **New Flow**: Frontend → Edge Function → Temporal (2 hops, direct RPC)
    - **Benefits**: Latency removed, simpler debugging, no duplicate workflows, fewer dependencies
    - **Code Deletion**: 509 lines removed (`workflows/src/worker/event-listener.ts`)
    - **Database**: Triggers dropped, `workflow_queue_projection` preserved for historical data
    - **Deployment**: Zero-downtime via GitHub Actions CI/CD with commit SHA tagging
    - **Pre-Testing**: Hard-deleted all POC data (33 database records, 1 DNS record)
16. **Supabase Realtime Enforces RLS Even for service_role**: Missing INSERT/UPDATE/DELETE policies block Realtime notifications - 2025-11-29
    - **Discovery**: Worker subscribed successfully but never received notifications despite successful bootstrap
    - **Root Cause**: Realtime enforces RLS for ALL operations, even with service_role key
    - **Solution**: Added INSERT/UPDATE/DELETE policies for service_role on workflow_queue_projection
    - **Migration**: `add_realtime_policies_workflow_queue` (idempotent)
    - **Impact**: Without these policies, Realtime silently fails to broadcast change notifications
    - **Lesson**: Local tests bypassed RLS via SECURITY DEFINER, hiding this production-only issue

16. **Resend Email Domain Verification Requires Parent Domain**: Cannot verify subdomain independently - 2025-11-29
    - **Issue**: Activities sent emails from `noreply@{subdomain}.firstovertheline.com`, Resend rejected (domain not verified)
    - **Requirement**: Resend verifies parent domain only (firstovertheline.com), not subdomains
    - **Solution**: Extract parent domain from subdomain for email sender address
    - **DNS Setup**: One-time configuration of DKIM, SPF (MX+TXT), DMARC records in Cloudflare
    - **Code Fix**: `send-invitation-emails.ts` now uses parent domain for `from` address
    - **Critical Discovery**: Domain name typo in Resend (firstoverttheline.com) caused 2+ hour verification delay

17. **Resend Domain Recreation Generates New DKIM Key**: Must update DNS when recreating domain - 2025-11-29
    - **Scenario**: After fixing domain name typo, had to delete and recreate domain in Resend
    - **Behavior**: Each domain creation generates unique DKIM public key
    - **Requirement**: Updated Cloudflare DNS record with new DKIM value after recreation
    - **Cloudflare Record**: `resend._domainkey.firstovertheline.com` TXT record
    - **Impact**: Old DKIM key would have caused email delivery failures even with correct domain spelling

18. **Architecture Simplification: Option C (Hybrid)**: After retrospective analysis, removing event-driven workflow triggering while keeping event sourcing - 2025-12-01
    - **Retrospective Complete**: `documentation/retrospectives/2025-11-temporal-worker-migration.md` documents 5 integration challenges and 3 architectural patterns
    - **Key Insight**: Multi-service architecture (5 hops) creates excessive integration points, silent failures, and environment parity gaps
    - **Decision**: Implement Option C (Hybrid) - Direct RPC from Edge Function to Temporal, keep event sourcing for state management
    - **Benefits**: Reduce 5 hops to 2 hops, remove 509 lines of event listener code, improve observability, simplify testing
    - **Implementation Plan**: `dev/active/architecture-simplification-option-c.md` - Detailed 5-phase plan using GitHub Actions deployment
    - **Timeline**: 1 week for POC/staging environment (no migration complexity needed)
    - **What We Keep**: Event sourcing (`domain_events`), CQRS projections, activity event emission, audit trail
    - **What We Remove**: Event-driven workflow triggering (PostgreSQL → Realtime → Worker listener chain), `workflow_queue_projection`, event listener code

19. **Cloudflare Universal SSL Only Covers First-Level Wildcards**: Nested subdomains require Advanced Certificate or hostname rename - 2025-12-02
    - **Discovery**: `api.a4c.firstovertheline.com` (nested subdomain) failed HTTPS with SSL handshake failure
    - **Root Cause**: Cloudflare Universal SSL certificate covers `*.firstovertheline.com` but NOT `*.a4c.firstovertheline.com`
    - **Solution**: Renamed to `api-a4c.firstovertheline.com` (first-level subdomain, hyphen instead of dot)
    - **Files Updated**: cloudflared config, k8s ingress, frontend env files, CLAUDE.md, GitHub workflow
    - **Verification**: `https://api-a4c.firstovertheline.com/health` returns `{"status":"ok"}`
    - **Backend API Status**: Phase 5 COMPLETE - External HTTPS access working via 2-hop architecture

## Scope of Changes

**Files modified** (Phases 2, 3, 4 & 9 - COMPLETE):
- ✅ `workflows/src/worker/event-listener.ts` - Complete rewrite for strict CQRS (509 lines, major refactor)
  - Changed subscription from `domain_events` to `workflow_queue_projection`
  - Changed filter from `event_type=eq.organization.bootstrap.initiated` to `status=eq.pending`
  - Added 3 new event emission methods: `emitQueueClaimedEvent`, `emitQueueCompletedEvent`, `emitQueueFailedEvent`
  - Fixed ALL RPC calls to use `.schema('api')` prefix (critical fix for `emitWorkflowStartedEvent`)
- ✅ `workflows/src/worker/index.ts` - Updated logging messages (5 lines changed)
- ✅ `workflows/package.json` - Removed `pg` and `@types/pg` dependencies (2 dependencies removed, 15 packages total)
- ✅ `workflows/package-lock.json` - Updated lockfile (161 lines removed)
- ✅ `.github/workflows/temporal-deploy.yml` - Fixed Docker cache invalidation and deployment tagging (Phase 4)
  - Line 77-78: Added commit SHA to cache scope for proper invalidation
  - Line 173: Use commit SHA tag instead of `:latest` for deployments
- ✅ `.github/workflows/frontend-deploy.yml` - Applied same fixes to frontend deployment (2025-11-29, commit 12b1168e)
  - Lines 102-109: Updated Docker metadata tags (commit SHA + semver patterns)
  - Lines 116-117: Added commit SHA to cache scope
  - Lines 200-208: Changed to `kubectl set image` with SHA tag, removed manual restart
- ✅ `infrastructure/supabase/supabase/functions/workflow-status/index.ts` - Fixed to read workflowId from request body (Phase 9, commit 655707d9)
  - Lines 68-76: Changed from `url.searchParams.get('workflowId')` to `await req.json()` to read from body
  - Fixed 400 "Missing workflowId parameter" error after form submission
- ✅ `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts` - Fixed to use parent domain (Phase 9, commit 655707d9)
  - Lines 169-183: Extract parent domain from subdomain for email sender
  - Changed from `noreply@{subdomain}.firstovertheline.com` to `noreply@firstovertheline.com`
  - Fixed 403 "domain is not verified" error from Resend
- ✅ `workflows/src/worker/index.ts` - Fixed misleading startup logs (Phase 9, commit 655707d9)
  - Lines 116-118: Corrected channel name (`workflow_queue`) and table name (`workflow_queue_projection`)
  - Added filter information to logs (`status=eq.pending`)

**Files created** (Phase 3 - Strict CQRS):
- ✅ `infrastructure/supabase/sql/02-tables/workflow_queue_projection/table.sql` - CQRS read model (workflow queue)
- ✅ `infrastructure/supabase/sql/04-triggers/enqueue_workflow_from_bootstrap_event.sql` - Auto-creates queue jobs
- ✅ `infrastructure/supabase/sql/04-triggers/update_workflow_queue_projection.sql` - Processes workflow queue events
- ✅ `infrastructure/supabase/contracts/organization-bootstrap-events.yaml` - Updated with 4 new queue events

**Migrations created** (Phase 9 - UAT Bug Fixes):
- ✅ `add_realtime_policies_workflow_queue` - Added INSERT/UPDATE/DELETE RLS policies for service_role (2025-11-29)
  - **Critical Fix**: Without these policies, Realtime cannot broadcast change notifications
  - **Policies Added**: `workflow_queue_projection_service_role_insert`, `_update`, `_delete`
  - **Impact**: Enabled worker to receive Realtime notifications (187ms latency measured)

**Documentation created** (Phase 10 - Retrospective & Architecture Planning):
- ✅ `documentation/retrospectives/2025-11-temporal-worker-migration.md` - Comprehensive retrospective (2025-12-01)
  - **Content**: Analyzed 5 integration challenges, 3 architectural patterns from migration
  - **Key Insights**: Multi-service coordination struggles, silent failures, environment parity gaps
  - **Forward-Looking**: 3 architecture options (Simplify, Full Microservices, Hybrid)
  - **Size**: ~300 lines documenting lessons learned
- ✅ `dev/active/architecture-simplification-option-c.md` - Detailed implementation plan (2025-12-01)
  - **Content**: 5-phase plan to implement Option C (Hybrid architecture)
  - **Scope**: Remove event-driven workflow triggering, keep event sourcing
  - **Timeline**: 1 week for POC/staging environment
  - **Deployment**: GitHub Actions automated workflows
  - **Size**: ~400 lines with complete test plan and rollback procedures

**Files unchanged**:
- ❌ Activities (already use Supabase client correctly)
- ❌ Workflows (don't know how they're triggered)
- ❌ Edge Functions (use stream-based `emit_domain_event` RPC signature)
- ❌ Database event sourcing functions (two overloaded versions both work)

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

## Architecture Context

### Old Flow (BROKEN - PostgreSQL LISTEN)
1. User submits organization form
2. Edge Function creates domain event with `organization.bootstrap.initiated`
3. PostgreSQL trigger fires `notify_workflow_worker_bootstrap()`
4. Trigger executes `pg_notify('workflow_events', payload)`
5. ❌ Worker doesn't receive notification (pooler breaks LISTEN)
6. ❌ Workflow never starts

### New Flow (WORKING - Supabase Realtime + Strict CQRS)
1. User submits organization form via frontend
2. Edge Function emits `organization.bootstrap.initiated` event to `domain_events`
3. Database trigger `enqueue_workflow_from_bootstrap_event` auto-emits `workflow.queue.pending` event
4. Database trigger `update_workflow_queue_projection` creates entry in `workflow_queue_projection` (status=pending)
5. ✅ Worker receives Realtime notification (subscribed to `workflow_queue_projection` with filter `status=eq.pending`)
6. ✅ Worker emits `workflow.queue.claimed` event (marks job as processing via trigger)
7. ✅ Worker starts Temporal workflow with deterministic ID `org-bootstrap-{stream_id}`
8. ✅ Worker emits `organization.bootstrap.workflow_started` event (tracks workflow start)
9. ✅ Workflow activities execute and emit domain events (e.g., `organization.created`)
10. ✅ Worker emits `workflow.queue.completed` event (marks job done via trigger)
11. ✅ All projection triggers update read models from events

**Complete 5-Event Chain (Verified End-to-End)**:
```
1. organization.bootstrap.initiated     (t=0ms)    - Bootstrap request
2. workflow.queue.pending               (t=0ms)    - Trigger creates queue job
3. workflow.queue.claimed               (t=+249ms) - Worker claims job
4. organization.bootstrap.workflow_started (t=+359ms) - Workflow starts in Temporal
5. workflow.queue.completed             (t=+502ms) - Job completes
```

**Projection State Lifecycle**:
```
workflow_queue_projection.status:
  pending → processing → completed

Tracked fields:
  - worker_id: 'worker-1167933'
  - workflow_id: 'org-bootstrap-ffffffff-ffff-4fff-afff-ffffffffffff'
  - workflow_run_id: '019accf1-7736-77ce-a276-6c15f1a262d5'
```

### Event Emission Patterns

#### Edge Functions (Stream-Based)
```typescript
await supabaseAdmin
  .schema('api')
  .rpc('emit_domain_event', {
    p_stream_id: organizationId,
    p_stream_type: 'organization',
    p_stream_version: 1,
    p_event_type: 'organization.bootstrap.initiated',
    p_event_data: { /* ... */ },
    p_event_metadata: { /* ... */ }
  });
```

#### Activities (Aggregate-Based)
```typescript
await emitEvent({
  event_type: 'user.invited',
  aggregate_type: 'Organization',
  aggregate_id: params.orgId,
  event_data: { /* ... */ },
  tags: ['organization', 'invitation']
});
```

Both patterns work correctly and should not be changed.

## Important Constraints

- **PostgreSQL LISTEN/NOTIFY doesn't work through connection poolers**: Always use direct database connection for LISTEN/NOTIFY, or migrate to Supabase Realtime - Discovered 2025-11-27

- **Supabase Realtime requires service role key**: Anonymous key won't work for Realtime subscriptions in server-side code - Existing constraint

- **Workflow IDs must be deterministic**: Worker generates `org-bootstrap-{stream_id}` to ensure idempotency - Existing constraint (updated to use stream_id instead of orgId)

- **Environment variables must be validated on startup**: Worker should fail fast with clear error messages if configuration is invalid - Implemented 2025-11-27

- **Use `SupabaseClient` type, not `ReturnType<typeof createSupabaseClient>`**: The former is more generic and avoids TypeScript compatibility issues with Realtime types - Discovered 2025-11-27

- **Realtime subscriptions use `schema: 'public'` for tables**: The `api` schema is for functions/RPCs only, not for table subscriptions via `postgres_changes` - Verified 2025-11-27

- **CRITICAL: RPC calls to api schema MUST use `.schema('api')` prefix**: Without this, you get error `PGRST106: The schema must be one of the following: api` - Discovered 2025-11-28
  - **Applies to**: `emit_domain_event`, `emit_workflow_started_event`, all RPC functions in api schema
  - **Example**: `supabaseClient.schema('api').rpc('emit_domain_event', {...})`
  - **Does NOT apply to**: Table queries (`.from('table')` defaults to public schema)

- **Subscribe to projections, not event store**: Never subscribe to `domain_events` directly. Create purpose-built projection and subscribe to that - Architectural decision 2025-11-28

- **Projection naming convention**: All CQRS read models must use `_projection` suffix (e.g., `workflow_queue_projection`, `organizations_projection`) - Infrastructure guideline

- **Strict CQRS write path**: All projection updates MUST happen via events + triggers. Workers emit events, triggers update projections - Architectural pattern 2025-11-28

- **Supabase Realtime enforces RLS for service_role**: Even with service_role key, Realtime requires INSERT/UPDATE/DELETE policies to broadcast change notifications - Discovered 2025-11-29
  - **Without policies**: Worker subscription succeeds but never receives notifications
  - **Failure mode**: Silent - no errors in logs, subscription shows "SUBSCRIBED" status
  - **Fix**: Add INSERT/UPDATE/DELETE policies for service_role on subscribed tables
  - **Required for**: workflow_queue_projection (any table used for Realtime subscriptions)

- **Local vs Production Testing Gap**: Local tests bypass RLS via SECURITY DEFINER, production enforces RLS via Realtime - Discovered 2025-11-29
  - **Local behavior**: Direct SQL queries use SECURITY DEFINER, bypass RLS policies
  - **Production behavior**: Realtime enforces RLS even for service_role operations
  - **Impact**: Missing RLS policies cause production failures not caught in local testing
  - **Mitigation**: Always test Realtime subscriptions against remote Supabase before production deployment
  - **Checklist**: Verify INSERT, UPDATE, DELETE policies exist for all projection tables used in subscriptions

- **Resend requires parent domain verification**: Cannot send from subdomain without verifying parent domain - Discovered 2025-11-29
  - **Issue**: Attempting to send from `noreply@subdomain.example.com` fails with 403 "domain not verified"
  - **Requirement**: Verify parent domain (`example.com`) with Resend, configure DNS records (DKIM, SPF, DMARC)
  - **Solution**: Extract parent domain from subdomain, use parent domain in email `from` address
  - **One-time setup**: Configure DNS records in Cloudflare: DKIM TXT, SPF MX, SPF TXT, DMARC TXT
  - **Code pattern**: `const parentDomain = subdomain.split('.').slice(-2).join('.')`

- **Resend domain recreation generates new DKIM key**: Each domain creation in Resend generates unique DKIM public key - Discovered 2025-11-29
  - **Scenario**: Delete and recreate domain (e.g., to fix typo) produces different DKIM key
  - **Requirement**: Must update DNS DKIM TXT record with new key after domain recreation
  - **Record**: `resend._domainkey.example.com` TXT record in Cloudflare
  - **Impact**: Stale DKIM key causes email delivery failures even with correct domain configuration

## Files Structure

### Modified Files (Phase 2, 3 & 9)
- `workflows/src/worker/event-listener.ts` - Worker event listener (509 lines total)
  - Removed `pg` LISTEN, added Supabase Realtime subscription
  - Changed subscription from `domain_events` to `workflow_queue_projection`
  - Changed filter from `event_type=eq.organization.bootstrap.initiated` to `status=eq.pending`
  - Added environment variable validation function
  - Added automatic reconnection logic
  - Added 3 new event emission methods for strict CQRS
  - **Critical fix**: Added `.schema('api')` to ALL RPC calls

- `workflows/src/worker/index.ts` - Worker initialization
  - Updated logging to show "Supabase Realtime" instead of "PostgreSQL Channel"

- `workflows/package.json` - Dependencies
  - Removed `"pg": "^8.11.3"` and `"@types/pg": "^8.10.9"`
  - `@supabase/supabase-js` already includes Realtime support

- `infrastructure/supabase/supabase/functions/workflow-status/index.ts` - Edge Function (Phase 9)
  - Fixed API parameter mismatch causing 400 errors after form submission
  - Changed from reading `workflowId` from URL query params to request body
  - Lines 68-76: `const { workflowId } = await req.json()` instead of `url.searchParams.get('workflowId')`
  - Aligns with frontend sending workflowId in POST body

- `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts` - Activity (Phase 9)
  - Fixed 403 "domain is not verified" error from Resend
  - Extract parent domain from organization subdomain for email sender
  - Lines 169-183: `const parentDomain = params.domain.split('.').slice(-2).join('.')`
  - Changed from: `noreply@{subdomain}.firstovertheline.com`
  - Changed to: `noreply@firstovertheline.com` (verified parent domain)
  - Resend only verifies parent domain, not subdomains

### New Database Files (Phase 3 - Strict CQRS)
- `infrastructure/supabase/sql/02-tables/workflow_queue_projection/table.sql` - CQRS read model
  - Table definition with status, worker tracking, workflow tracking
  - Added to `supabase_realtime` publication
  - RLS policy for service_role access
  - Indexes on status, event_type, stream_id, created_at

- `infrastructure/supabase/sql/04-triggers/enqueue_workflow_from_bootstrap_event.sql` - Auto-enqueue trigger
  - Listens for `organization.bootstrap.initiated` events
  - Auto-emits `workflow.queue.pending` event
  - Separates domain events from infrastructure events

- `infrastructure/supabase/sql/04-triggers/update_workflow_queue_projection.sql` - Projection update trigger
  - Processes 4 workflow queue events: `pending`, `claimed`, `completed`, `failed`
  - Updates projection status and metadata
  - Implements strict CQRS (all writes via events)

### Phase 9 Migrations (UAT Bug Fixes)
- `add_realtime_policies_workflow_queue` - RLS policies for Realtime (2025-11-29)
  - **Critical Fix**: Added INSERT/UPDATE/DELETE policies for service_role
  - **Root Cause**: Supabase Realtime enforces RLS even for service_role operations
  - **Symptom**: Worker subscription showed "SUBSCRIBED" but never received notifications
  - **Policies Created**:
    - `workflow_queue_projection_service_role_insert` - Allows Realtime to broadcast INSERTs
    - `workflow_queue_projection_service_role_update` - Allows Realtime to broadcast UPDATEs
    - `workflow_queue_projection_service_role_delete` - Allows Realtime to broadcast DELETEs
  - **Impact**: Reduced latency from infinite (never received) to 187ms (INSERT to worker claim)
  - **Idempotency**: Uses `DROP POLICY IF EXISTS` before `CREATE POLICY`

### Known Limitations (Phase 9)
- **Parent Domain Extraction**: Current implementation uses hardcoded `.split('.').slice(-2).join('.')` logic
  - **Works for**: Simple TLDs like `.com`, `.org`, `.net`
  - **Fails for**: Multi-part TLDs like `.co.uk`, `.com.au`, `.gov.uk`
  - **Location**: `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts:169-183`
  - **TODO**: Replace with proper public suffix list (PSL) parsing library
  - **Recommended**: Use `psl` npm package or similar to correctly extract parent domain

### Updated Contract Files (Phase 3)
- `infrastructure/supabase/contracts/organization-bootstrap-events.yaml` - AsyncAPI contract
  - Added 4 new workflow queue events
  - Documented complete CQRS event flow
  - Defined payload schemas for all queue events

### Files Referenced (No Changes)
- `infrastructure/supabase/supabase/functions/organization-bootstrap/index.ts` - Edge Function
- `workflows/src/activities/organization-bootstrap/generate-invitations.ts` - Example activity
- `workflows/src/shared/utils/emit-event.ts` - Event emission utility (aggregate-based)
- `infrastructure/k8s/temporal/worker-deployment.yaml` - Kubernetes deployment

### Documentation Files Created
- `/tmp/cleanup-poc-test1-20251126.sql` - Idempotent cleanup script for test organization - Created 2025-11-26
- `dev/active/temporal-worker-realtime-migration.md` - Complete migration plan - Created 2025-11-27
- `dev/active/temporal-worker-realtime-migration-context.md` - Architecture context and decisions - Created 2025-11-27 (this file)
- `dev/active/temporal-worker-realtime-migration-tasks.md` - Task checklist and progress tracking - Created 2025-11-27
- `dev/active/temporal-worker-realtime-migration-test-plan.md` - Automated testing procedures - Created 2025-11-27
- `infrastructure/supabase/scripts/verify-auth-hook-registration.sh` - Auth hook verification - Created 2025-11-27

## Reference Materials

- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime)
- [PostgreSQL LISTEN/NOTIFY Documentation](https://www.postgresql.org/docs/current/sql-notify.html)
- [Temporal TypeScript SDK](https://docs.temporal.io/typescript)
- Complete migration plan: `dev/active/temporal-worker-realtime-migration.md`

## Testing Strategy

### Local Testing (Phase 3 - COMPLETED)
1. ✅ Switch from local Supabase to remote testing (local had storage migration issue)
2. ✅ Port-forward Temporal server: `kubectl port-forward -n temporal svc/temporal-frontend 7233:7233`
3. ✅ Start worker with `npm run dev`
4. ✅ Emit test event via `api.emit_domain_event` RPC
5. ✅ Verify worker logs show subscription: `✅ Subscribed to workflow queue via Supabase Realtime`
6. ✅ Verify complete 5-event chain executes correctly
7. ✅ Verify projection state transitions: `pending → processing → completed`

### Remote Testing Results (Phase 3)
- ✅ Worker subscribed to `workflow_queue_projection` with filter `status=eq.pending`
- ✅ Complete event chain verified (5 events in correct order with proper timing)
- ✅ All RPC calls working with `.schema('api')` prefix
- ✅ Projection lifecycle verified: status updates, worker tracking, workflow tracking
- ✅ No subscription errors, no connection errors
- ✅ All test data cleaned up from database

### Kubernetes Testing (Phase 4 - PENDING)
1. Build and push Docker image
2. Deploy updated worker
3. Check logs for Realtime subscription confirmation
4. Submit organization form from UI
5. Verify workflow appears in Temporal Web UI
6. Verify projections populate correctly

## Success Criteria

**Phase 3 (Local Testing) - ✅ COMPLETE**:
- ✅ Worker logs show `✅ Subscribed to workflow queue via Supabase Realtime`
- ✅ Worker logs show channel: `workflow_queue`, table: `workflow_queue_projection`, filter: `status=eq.pending`
- ✅ Environment variable validation catches missing vars on startup
- ✅ Complete 5-event chain executes end-to-end:
  1. `organization.bootstrap.initiated`
  2. `workflow.queue.pending`
  3. `workflow.queue.claimed`
  4. `organization.bootstrap.workflow_started` (critical fix verified)
  5. `workflow.queue.completed`
- ✅ Projection state transitions correctly: `pending → processing → completed`
- ✅ Worker tracking fields populated: `worker_id`, `workflow_id`, `workflow_run_id`
- ✅ No schema errors, no subscription errors, no connection errors
- ✅ All updates via strict CQRS (events + triggers)

**Phase 4 (Production Deployment) - ⏸️ PENDING**:
- [ ] Worker logs show Realtime subscription in Kubernetes
- [ ] Supabase Dashboard shows active Realtime connection
- [ ] Submit organization form → Workflow starts in Temporal
- [ ] Temporal Web UI shows workflow execution with correct ID
- [ ] Projections populate: `organizations_projection`, `invitations_projection`
- [ ] Worker gracefully reconnects if Realtime subscription drops

## Rollback Plan

### Option A: Revert Code Changes
```bash
git revert <commit-hash>
docker build && docker push
kubectl rollout restart deployment/workflow-worker -n temporal
```

### Option B: Fix Connection Pooler (Not Recommended)
1. Update `SUPABASE_DB_URL` to direct database host
2. Change from: `pooler.supabase.com`
3. Change to: `db.tmrjlswbsxmbglmaclxu.supabase.co`
4. Keep original `pg` LISTEN implementation

### Option C: Polling Fallback (Last Resort)
1. Remove LISTEN/Realtime entirely
2. Poll `domain_events` table every 5 seconds
3. Much less efficient but guaranteed to work
