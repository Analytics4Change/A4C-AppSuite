---
status: current
last_updated: 2026-04-22
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Service-layer rules for the frontend — Supabase session retrieval (never cache manually), CQRS query pattern (RPC functions only), and business-scoped correlation IDs.

**When to read**:
- Writing or modifying any file under `src/services/`
- Adding a new service that calls Supabase
- Debugging "empty list returned" or 406 errors from queries
- Working with multi-step business transactions that need correlation tracking

**Prerequisites**: Familiarity with Supabase JS client and JWT structure

**Key topics**: `services`, `supabase`, `session`, `jwt`, `cqrs`, `rpc`, `correlation-id`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# Frontend Services Guidelines

This file governs code under `frontend/src/services/`. Three rules — all backed by past production incidents.

## 1. Service Session Management

> **⚠️ CRITICAL: Never Cache Sessions Manually**
>
> Supabase manages session state automatically after login. Services that manually
> cache sessions will fail silently when the cache is stale or never populated.
> This caused critical bugs including empty data lists where all queries silently
> returned zero results.

**ALWAYS** retrieve sessions directly from Supabase's auth client in every service method that needs authentication context:

```typescript
// ✅ CORRECT: Retrieve session from Supabase client
async getUsersPaginated(): Promise<PaginatedResult<UserListItem>> {
  const client = supabaseService.getClient();

  // Get session directly from Supabase - it manages auth state automatically
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    log.error('No authenticated session');
    return { items: [], totalCount: 0 };
  }

  // Decode JWT to extract custom claims
  const claims = this.decodeJWT(session.access_token);
  if (!claims.org_id) {
    log.error('No organization context in JWT claims');
    return { items: [], totalCount: 0 };
  }

  // Use claims.org_id for RLS-compatible queries
}

// Helper method for JWT decoding
private decodeJWT(token: string): DecodedJWTClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(globalThis.atob(payload));
  } catch {
    return {};
  }
}
```

**NEVER** use manual session caching or custom session storage:

```typescript
// ❌ WRONG: Manual session cache - this will FAIL SILENTLY
const session = supabaseService.getCurrentSession();  // Returns NULL!
if (!session?.claims.org_id) {
  return { items: [] };  // Silent failure - empty list returned
}
```

**Why manual caching fails:**
1. Custom session caches require explicit population (calling `updateSession()`)
2. If the cache is never populated, all service methods silently fail
3. Supabase already manages session state automatically — don't duplicate it
4. The Supabase client's `auth.getSession()` always returns the current valid session

**When you need JWT claims** (`org_id`, `effective_permissions`, `org_type`):
- Call `client.auth.getSession()` to get the session
- Decode the `access_token` to extract custom claims
- Use the same `decodeJWT()` pattern shown above

## 2. CQRS Query Pattern

> **⚠️ CRITICAL: All Data Queries MUST Use RPC Functions**
>
> NEVER use direct table queries with PostgREST embedding across projection tables.
> This violates the CQRS pattern and has caused critical bugs including 406 errors.

**ALWAYS** use `api.` schema RPC functions for data queries:

```typescript
// ✅ CORRECT: RPC function call (CQRS pattern)
const { data, error } = await client
  .schema('api')
  .rpc('list_users', {
    p_org_id: claims.org_id,
    p_status: statusFilter,
    p_search_term: searchTerm,
  });

// ✅ CORRECT: Other RPC examples
await client.schema('api').rpc('get_roles', { p_org_id: orgId });
await client.schema('api').rpc('get_organizations', {});
await client.schema('api').rpc('get_organization_units', { p_org_id: orgId });
```

**NEVER** use direct table queries with PostgREST embedding:

```typescript
// ❌ WRONG: Direct table query with embedding - VIOLATES CQRS
const { data } = await client
  .from('users')
  .select(`
    id, email, name,
    user_roles_projection!inner (
      role_id,
      roles_projection (id, name)
    )
  `)
  .eq('user_roles_projection.organization_id', orgId);
```

**Why RPC functions are required:**
1. Projections are denormalized read models — joins should happen at event-processing time, not query time
2. PostgREST embedding across projections re-normalizes data, defeating CQRS benefits
3. RPC functions encapsulate query logic in the database (single source of truth, testable, versionable)
4. RPC functions can handle complex filtering, sorting, and pagination efficiently
5. Consistent pattern across all services for maintainability

**Services using this pattern:**
- `SupabaseUserQueryService` → `api.list_users()`
- `SupabaseRoleService` → `api.get_roles()`, `api.get_role_by_id()`
- `SupabaseOrganizationQueryService` → `api.get_organizations()`, `api.get_organization_by_id()`
- `SupabaseOrganizationUnitService` → `api.get_organization_units()`
- `SupabaseScheduleService` → `api.list_schedule_templates()`

## 3. Correlation ID Pattern (Business-Scoped)

`correlation_id` ties together the ENTIRE business transaction lifecycle, not just a single request.

**Frontend Implementation**:
- **New transaction** (create org, invite user): Generate new `correlation_id` and pass via `x-correlation-id` header
- **Continuing transaction** (accept invitation): Let backend use the stored `correlation_id` — do NOT generate new one
- **Tracing headers**: Always include `x-correlation-id`, `x-session-id`, and `traceparent` in API calls

**Example — Invitation Flow**:
```typescript
// Creating invitation - generate new correlation_id
const correlationId = crypto.randomUUID();
await fetch('/api/invite', {
  headers: {
    'x-correlation-id': correlationId,
    'x-session-id': sessionId,
  },
  body: JSON.stringify({ email, role }),
});

// Accepting invitation - DO NOT generate correlation_id
// Backend will use the stored correlation_id from the original invitation
await supabase.functions.invoke('accept-invitation', {
  body: { token },
  // No x-correlation-id header - backend reuses stored one
});
```

**Why this matters**: Querying by `correlation_id` returns the complete lifecycle:
```sql
SELECT event_type, created_at FROM domain_events
WHERE correlation_id = 'abc-123'::uuid ORDER BY created_at;
-- user.invited → invitation.resent → invitation.accepted (same ID)
```

## Related Documentation

- [Frontend CLAUDE.md](../../CLAUDE.md) — Tech stack, MVVM, MobX, accessibility (parent)
- [Auth context CLAUDE.md](../contexts/CLAUDE.md) — IAuthProvider pattern, JWT claims structure
- [Event metadata schema](../../../documentation/workflows/reference/event-metadata-schema.md) — Correlation strategy reference
- [Frontend auth architecture](../../../documentation/architecture/authentication/frontend-auth-architecture.md) — Three-mode auth design
