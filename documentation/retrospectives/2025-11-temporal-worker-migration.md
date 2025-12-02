# Project Retrospective: Multi-Service Event-Driven Architecture

**Period**: November 25-29, 2025
**Focus**: Architectural patterns, integration challenges, and multi-service coordination
**Initiative**: Organization Bootstrap - Temporal Worker Migration & Multi-Service Workflow

---

## 📊 Executive Summary

**Major Initiative**: Organization Bootstrap - Multi-Service Event-Driven Workflow

**Service Topology**:
```
Frontend (React/K8s)
  ↓ HTTP
Edge Function (Supabase serverless)
  ↓ RPC
PostgreSQL (event store + triggers)
  ↓ Realtime
Temporal Worker (K8s pod)
  ↓ Workflow execution
Activities (HTTP/RPC back to Supabase)
```

**Key Challenge**: Achieving reliable coordination across 5+ services with different runtime environments, security models, and observability tools.

**Commits Analyzed**: 30 production commits (Nov 25-29, 2025)
**Phases Completed**: 9 (Temporal migration) + 6 (Contract alignment) + 1 (Provider onboarding)

---

## 🎯 Architectural Patterns That Worked

### 1. Event Sourcing as Integration Layer
**Pattern**: All state changes flow through immutable event stream

**Implementation**:
- `domain_events` table as central event store
- Triggers process events → update projections
- Services emit events, never write projections directly
- Complete audit trail for debugging multi-service flows

**Win**: When UAT failed, could trace exact event sequence:
```sql
SELECT event_type, created_at, event_data
FROM domain_events
WHERE aggregate_id = 'org-id'
ORDER BY created_at;
```

**Evidence of Value**: Found missing events immediately, identified exact failure point (no `workflow.queue.pending` event = trigger didn't fire)

### 2. Strict CQRS (Command Query Responsibility Segregation)
**Pattern**: Write model (events) separate from read model (projections)

**Benefit During Crisis**: When projection was stuck in "pending", could verify:
- ✅ Event created (write model working)
- ❌ Projection not updated (read model broken)
- → Isolated issue to trigger, not event emission

**Discipline**: Worker NEVER writes projections, only emits events
- Prevented "quick fix" temptation to bypass CQRS
- Maintained architectural integrity under pressure

### 3. Contract-First Development (AsyncAPI)
**Pattern**: Define event schemas before implementation

**Success**: All three services (Frontend, Edge Function, Worker) agreed on payload structure
- Single source of truth
- Versioning built-in
- Clear integration points

**Limitation Discovered**: Manual type sync required (auto-generation loses nested structure strictness)

---

## 🔥 Multi-Service Integration Challenges

### 1. **Cross-Service Security Models** ⚠️ CRITICAL DISCOVERY

**Challenge**: Each service has different security context

| Service | Security Model | Impact on Our Code |
|---------|---------------|-------------------|
| PostgreSQL | RLS policies per role | Local tests bypassed via SECURITY DEFINER |
| Supabase Realtime | RLS enforced even for service_role | Required explicit INSERT/UPDATE/DELETE policies |
| Edge Functions | service_role key | Full access, no RLS |
| Temporal Worker | service_role key | Subscription blocked by missing RLS policies |

**The Gap**: Local testing used direct SQL (SECURITY DEFINER function) which bypasses RLS. Production used Realtime which enforces RLS even for service_role.

**Architectural Lesson**:
> When multiple services access the same data through different APIs (direct SQL vs Realtime vs RPC), they encounter different security enforcement points. You cannot assume service_role grants uniform access.

**Pattern Emerged**: "Security Model Boundary Testing"
- Test each service's access path independently
- Verify RLS policies for EVERY service integration point
- Don't assume local success = production success

---

### 2. **Silent Failures Across Service Boundaries** 🚨 RELIABILITY

**Discovery**: Services can appear healthy while integration is broken

**Examples**:

**A. Realtime Subscription**
```
Worker logs: "✅ SUBSCRIBED to workflow_queue"
Database: INSERT succeeds
Reality: Worker never receives notification (missing RLS policies)
```
**No error anywhere** - both services think they're working

**B. Frontend → Edge Function**
```
Frontend: Form submits, redirects (appears successful)
Edge Function: No POST request in logs
Database: No events created
Reality: Frontend never called Edge Function (unknown root cause)
```
**No error shown to user** - silent failure

**Pattern**: Each service validates its own behavior, not the integration

**Architectural Lesson**:
> In multi-service architectures, "no errors" ≠ "working correctly". Each service needs integration health checks, not just internal health checks.

**Missing Pattern**: End-to-end health monitoring
- Synthetic transactions that exercise full service chain
- Distributed tracing to follow requests across services
- Integration assertions (e.g., "event created → worker received it")

---

### 3. **Environment Parity Gaps** 🏗️ TESTING

**The Problem**: Local environment fundamentally different from production

| Aspect | Local | Production |
|--------|-------|-----------|
| Database access | Direct PostgreSQL connection | Through Supabase API |
| Event notifications | PostgreSQL LISTEN (doesn't work) | Supabase Realtime |
| Worker runtime | localhost:7233 (port-forward) | K8s pod with service discovery |
| Security enforcement | Often bypassed for convenience | Strictly enforced |
| Service dependencies | Mock/stub | Real services |

**Impact**:
- Phase 3 local tests: ✅ Passed
- Phase 4 production: ❌ Failed (missing RLS policies)
- Phase 9 UAT: ❌ Failed (email domain config, API mismatch)

**Architectural Lesson**:
> You cannot achieve environment parity in a multi-service architecture when services are managed by third parties (Supabase). Testing must happen against real integration points.

**Pattern Needed**: "Integration Environment"
- Remote Supabase (not local)
- Remote Temporal cluster
- Real Realtime subscriptions
- Real RLS enforcement
- Synthetic/test data only

**Current Gap**: No staging environment, testing jumps from local → production

---

### 4. **Observable Integration Points** 📊 DEBUGGING

**Challenge**: When 5-step chain fails, which service broke?

**Current State**: Each service logs independently
- Frontend: Browser console (user-specific, not centralized)
- Edge Function: Supabase logs (separate from worker)
- Database Triggers: PostgreSQL logs (verbose, mixed with other events)
- Worker: K8s pod logs (separate from Supabase)
- Temporal: Workflow history UI (separate system)

**UAT Debugging Experience**:
```
1. Check worker logs - "Subscribed" ✅
2. Check database - job stuck in "pending" ❌
3. Check RLS policies - missing INSERT/UPDATE/DELETE ❌
4. Check Supabase logs - no errors shown ❌
5. Manually query events - found the gap

Total time: 2 hours
```

**Architectural Lesson**:
> Multi-service debugging requires correlation IDs and centralized observability. Checking 5 different log systems is unsustainable.

**Pattern Needed**: "Distributed Tracing"
- Correlation ID flows through: Frontend → Edge Function → Database → Realtime → Worker
- Single timeline view showing all services
- Event causality tracking

---

### 5. **Contract Synchronization Across Services** 🔌 INTEGRATION

**Challenge**: 3 TypeScript codebases must stay in sync with 1 YAML contract

**Current Process**:
1. Update AsyncAPI contract (YAML)
2. Manually update Edge Function TypeScript types
3. Manually update Frontend TypeScript types
4. Manually update Worker TypeScript types
5. Add JSDoc comments linking to contract line numbers
6. Hope nobody forgets a field

**What Broke**: Frontend sent `workflowId` in body, Edge Function read from query params
- Contract didn't specify transport layer (body vs query params)
- Each service made different assumptions
- Integration failed silently

**Architectural Lesson**:
> In multi-service architectures, contracts must specify not just data shape, but also transport semantics (HTTP method, headers, body vs query params, error codes).

**Pattern Attempted**: AsyncAPI as single source of truth
**Gap Discovered**: Contract doesn't cover HTTP-level details, only event payload

**Missing**: HTTP API contract (OpenAPI) separate from event contract (AsyncAPI)

---

## 💡 Broader Architectural Patterns

### Pattern 1: The "Distributed Monolith" Anti-Pattern

**What We Built**:
- Frontend → Edge Function → Database → Worker → Temporal
- Each service depends on the next in a chain
- Failure in any service blocks the entire flow
- No independent deployment of services

**Evidence**: When RLS policies were missing:
- Edge Function worked ✅
- Database trigger worked ✅
- Worker subscription worked (appeared to) ✅
- **Integration failed** ❌ (worker never received events)

**Realization**: We have the complexity of microservices without the benefits
- Can't test services independently (need full integration)
- Can't deploy services independently (contract changes require coordinated updates)
- Can't scale services independently (workflow coupled to specific events)

**Question to Consider**: Is this the right architecture for our use case?

### Pattern 2: Event-Driven Complexity vs. Direct RPC

**Current**:
```
Frontend → POST → Edge Function
  → emit event → PostgreSQL
    → trigger → emit event → Realtime
      → notify → Worker
        → start workflow → call activities
          → RPC back to PostgreSQL
```
5 hops to start a workflow

**Alternative**:
```
Frontend → POST → Edge Function
  → RPC → Temporal
    → start workflow → call activities
```
2 hops to start a workflow

**Why We Chose Events**:
- Audit trail (event sourcing)
- Decoupling (services don't know about each other)
- Durability (events persist if worker is down)

**Cost**:
- Complexity (5 integration points vs 2)
- Debugging (trace across 5 services vs 2)
- Failure modes (5 potential break points vs 2)

**Architectural Question**: Is the event-driven complexity worth the benefits for this use case?

### Pattern 3: The RLS/Multi-Tenancy Tension

**Challenge**: RLS policies designed for user isolation, but service integration needs cross-tenant access

**Specific Issue**: Worker needs to:
- Subscribe to ALL pending workflows (across all tenants)
- Emit events for ANY organization
- Access workflow queue regardless of org_id

**But RLS Says**: "You can only see/modify rows where org_id matches your JWT"

**Current Workaround**: Grant service_role access to bypass RLS
```sql
CREATE POLICY workflow_queue_service_role_select
  ON workflow_queue_projection
  FOR SELECT TO service_role
  USING (true);  -- Bypass tenant isolation
```

**Tension**: Multi-tenancy (RLS) vs. Cross-Tenant Services (Worker)

**Architectural Lesson**:
> RLS is excellent for user-facing services, but complicates service-to-service communication. Need separate policies for "users" vs "internal services".

**Pattern Needed**: "Service Account" policies separate from "User" policies

---

## 🔮 Forward-Looking Recommendations

### Addressing Multi-Service Struggles

#### Option A: Simplify the Service Topology

**Reduce**: Frontend → Edge Function → Database → Worker → Temporal
**To**: Frontend → Edge Function → Temporal

**How**:
- Edge Function calls Temporal directly (RPC)
- Temporal workflows still emit events for audit trail
- Remove worker-as-event-listener pattern
- Worker becomes simple Temporal worker (polls task queue)

**Trade-offs**:
- ✅ 2 integration points instead of 5
- ✅ Easier to test (can test Edge Function → Temporal directly)
- ✅ Faster (no Realtime hop)
- ❌ Lose event-driven decoupling
- ❌ Edge Function now knows about Temporal (tighter coupling)

#### Option B: Embrace Full Microservices Pattern

**Current State**: Distributed monolith (services coupled, not independently deployable)

**Move To**: True microservices
- Each service owns its data (no shared database)
- Services communicate via events only (no direct database access)
- Each service has its own deployment lifecycle
- Services use bounded contexts (DDD)

**Requirements**:
- Dedicated database per service (Temporal DB, Organization DB, User DB)
- Event bus (not database triggers)
- API Gateway pattern
- Service mesh for observability

**Trade-offs**:
- ✅ True independence
- ✅ Can scale/deploy services separately
- ❌ Much higher operational complexity
- ❌ Eventual consistency everywhere
- ❌ Requires significant infrastructure investment

#### Option C: Hybrid - Event Sourcing for State, RPC for Orchestration

**Pattern**:
- Keep event sourcing for state changes (audit trail)
- Use direct RPC for orchestration (workflow triggering)
- Decouple state management from workflow triggering

**Implementation**:
```
Frontend → Edge Function:
  1. Emit domain event (organization.bootstrap.initiated)
  2. Call Temporal RPC directly (start workflow)

Temporal Workflow:
  1. Execute activities
  2. Activities emit domain events (organization.created, etc.)
  3. Database triggers update projections
```

**Trade-offs**:
- ✅ Best of both worlds (audit trail + simple orchestration)
- ✅ Fewer integration points than pure event-driven
- ✅ Still maintain CQRS and event sourcing
- ❌ Edge Function has two responsibilities (emit event + call Temporal)

---

### Immediate Recommendations (Next Sprint)

#### 1. Create Staging Environment 🎯 HIGHEST PRIORITY
- Remote Supabase project (dev/staging)
- Remote Temporal cluster
- Real service integration
- Synthetic data only
- **WHY**: Cannot achieve environment parity locally in multi-service architecture

#### 2. Add Distributed Tracing 📊 OBSERVABILITY
- Correlation IDs across all services
- Centralized logging (not 5 separate log systems)
- Trace visualization (see entire request flow)
- **WHY**: Debugging 5 services with separate logs is unsustainable

#### 3. Integration Health Checks ✅ RELIABILITY
- Synthetic end-to-end transactions
- Alert if integration breaks (not just if service is down)
- Monitor expected behaviors (e.g., "event → notification latency")
- **WHY**: Silent failures across service boundaries are our biggest risk

#### 4. Contract Completeness 📋 INTEGRATION
- Add HTTP-level specs to contracts (method, headers, body/query params)
- Consider OpenAPI for HTTP APIs, AsyncAPI for events
- Automated contract testing between services
- **WHY**: Current contracts don't specify enough to prevent integration bugs

---

### Short-Term (Next Month)

#### 1. Evaluate Architecture Simplification
- Prototype Option C (Hybrid: Events for state, RPC for orchestration)
- Measure: Integration points, test complexity, failure modes
- Decision: Continue event-driven or simplify?

#### 2. Service Account RLS Pattern
- Separate policies for service_role (cross-tenant) vs users (single-tenant)
- Document pattern for future projection tables
- Apply consistently across all projections

#### 3. Integration Testing Framework
- Test suite that runs against staging environment
- Exercises full service chain
- Runs on PR + nightly
- **Critical**: Cannot test multi-service integration locally

---

### Long-Term (Next Quarter)

#### 1. Architectural Decision: Monolith vs. Microservices vs. Modular Monolith
- Current: Distributed monolith (worst of both worlds)
- Options: Simplify to modular monolith OR embrace full microservices
- Decision criteria: Team size, operational maturity, scaling needs

#### 2. Service Mesh Investigation
- If staying multi-service: Need proper service-to-service communication
- Istio/Linkerd for observability, retries, circuit breakers
- Requires Kubernetes expertise

#### 3. Bounded Contexts & Domain-Driven Design
- If staying multi-service: Define clear bounded contexts
- Organization service, User service, Workflow service
- Each owns its data, communicates via well-defined contracts

---

## 💎 Core Architectural Insights

### 1. Multi-Service != Microservices
We have distributed system complexity without microservice benefits (independent deployment, scaling, development)

### 2. Event-Driven Has Costs
5-hop event chains are harder to test, debug, and reason about than direct RPC. Benefits (audit, decoupling) must outweigh costs.

### 3. Environment Parity Impossible
With managed services (Supabase), cannot replicate production locally. Must test against real integration points.

### 4. Silent Failures Are Systemic
In multi-service systems, each service validates itself but not the integration. Need end-to-end health monitoring.

### 5. RLS vs. Service Integration
Multi-tenancy (RLS) designed for user isolation, complicates service-to-service communication. Need separate patterns for each.

### 6. Contracts Must Be Complete
AsyncAPI specifies payload, but HTTP semantics (body vs query, headers, status codes) also critical for integration success.

### 7. Observability is Infrastructure
Distributed tracing, correlation IDs, centralized logging are not "nice to have" - they're required for multi-service debugging.

---

## 🎯 Specific Incidents Analyzed

### Incident 1: Missing RLS Policies (2-hour outage during UAT)

**Timeline**:
- T+0: User submits organization form
- T+0: Edge Function creates `organization.bootstrap.initiated` event ✅
- T+0: Database trigger creates `workflow.queue.pending` event ✅
- T+0: Database INSERT to `workflow_queue_projection` succeeds ✅
- T+0: Worker subscription shows "SUBSCRIBED" ✅
- T+∞: Worker never receives notification ❌

**Root Cause**: Missing INSERT/UPDATE/DELETE RLS policies on `workflow_queue_projection`
- Supabase Realtime enforces RLS even for service_role
- Only SELECT policy existed
- Silent failure: No errors logged anywhere

**Fix**: Created `add_realtime_policies_workflow_queue` migration
```sql
-- Added INSERT, UPDATE, DELETE policies for service_role
```

**Latency Impact**: ∞ (never worked) → 187ms (notification received)

**Lessons**:
- RLS enforcement varies by access path (direct SQL vs Realtime)
- Local testing bypassed RLS (SECURITY DEFINER), production enforced it
- Need explicit RLS policy checklist for all projection tables

---

### Incident 2: Resend Email Domain Verification (2+ hour debug)

**Timeline**:
- T+0: Workflow sends invitation email
- T+0: Resend returns 403: "domain is not verified"
- T+30min: Created DNS records (DKIM, SPF, DMARC) in Cloudflare
- T+60min: Verified DNS propagation globally (Google DNS, Cloudflare, OpenDNS)
- T+120min: Triggered programmatic verification via Resend API
- T+120min: Still pending...
- T+150min: **Discovered domain typo** in Resend ("firstover**t**theline.com")

**Root Causes**:
1. Activities sent from `noreply@subdomain.example.com`
2. Resend only verifies parent domain (`example.com`)
3. Domain name typo in Resend system

**Fixes**:
1. Extract parent domain: `.split('.').slice(-2).join('.')`
2. Delete domain with typo, recreate with correct spelling
3. Update Cloudflare DKIM (new domain = new DKIM key)

**Known Limitation**: Hardcoded `.slice(-2)` fails for multi-part TLDs (`.co.uk`, `.com.au`)
- **TODO**: Replace with PSL (Public Suffix List) library

**Lessons**:
- Email providers have non-obvious requirements (parent domain only)
- Domain recreation generates new DKIM keys
- Manual setup steps prone to human error

---

### Incident 3: Frontend API Parameter Mismatch

**Timeline**:
- T+0: User submits organization form
- T+0: Form redirects to /clients (success path)
- T+0: Edge Function returns 400: "Missing workflowId parameter"
- T+0: No error shown to user (silent failure)

**Root Cause**:
- Frontend sent `workflowId` in POST body
- Edge Function read from URL query params
- Contract didn't specify transport layer

**Fix**: Changed Edge Function to read from body
```typescript
// Before: const workflowId = url.searchParams.get('workflowId');
// After: const { workflowId } = await req.json();
```

**Lessons**:
- AsyncAPI doesn't cover HTTP-level details (body vs query params)
- Need OpenAPI contract for HTTP APIs
- Frontend error handling swallows failures (always redirects)

---

## 📚 Related Documentation

### Migration Docs
- `dev/active/temporal-worker-realtime-migration-context.md` - Complete architecture context
- `dev/active/temporal-worker-realtime-migration-tasks.md` - All 9 phases with tasks
- `dev/active/temporal-worker-realtime-migration.md` - Implementation plan

### Contract Alignment
- `dev/active/asyncapi-contract-alignment-context.md` - Contract alignment decisions
- `dev/active/asyncapi-contract-alignment-tasks.md` - Contract work tasks

### Architecture Documentation
- `documentation/architecture/workflows/temporal-overview.md` - Temporal architecture
- `documentation/architecture/data/event-sourcing-overview.md` - Event sourcing patterns
- `infrastructure/supabase/contracts/organization-bootstrap-events.yaml` - AsyncAPI contract

---

## 🔄 Continuous Improvement Actions

### Completed
- ✅ Created comprehensive dev-docs for all phases
- ✅ Documented all architectural decisions with rationale
- ✅ Added RLS policy checklist to migration docs
- ✅ Noted known limitations (parent domain extraction)

### In Progress
- ⏸️ Final UAT testing (blocked on form submission mystery)
- ⏸️ Contract alignment production verification

### Planned
- [ ] Create staging environment (highest priority)
- [ ] Implement distributed tracing
- [ ] Add integration health checks
- [ ] Prototype hybrid architecture (Option C)

---

**Key Question for Team**: Given the multi-service coordination challenges we've experienced, should we simplify the architecture (Option A/C) or invest in proper microservice infrastructure (Option B)?

---

*Retrospective Date: 2025-11-29*
*Analysis Period: November 25-29, 2025*
*Commits Analyzed: 30 production commits*
*Author: Development Team*
