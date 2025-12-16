# Context: Organization Routes Production Integration

## Decision Record

**Date**: 2025-12-15
**Feature**: Organization Routes Production Integration
**Goal**: Connect organization routes to real database data, replacing mock data with ViewModel pattern and event-driven updates.
**Status**: ✅ COMPLETE - Deployed to production

### Key Decisions

1. **ViewModel + MobX Architecture**: Follows existing patterns like `InvitationAcceptanceViewModel`. All business logic in ViewModel, presentation in Component. State managed via MobX observables.

2. **Event-Driven Updates**: Organization edits emit `organization.updated` domain events. PostgreSQL triggers update `organizations_projection` table. No direct table writes.

3. **Paginated RPC Function**: New `api.get_organizations_paginated()` function with built-in filtering, sorting, and pagination to reduce frontend complexity.

4. **Role-Based Access Control**: super_admin sees all organizations. Other roles filtered by RLS policies using JWT claims (`org_id`, `scope_path`).

5. **AsyncAPI Contract Reuse**: The `organization.updated` event is already defined in AsyncAPI contracts - no new contracts needed.

6. **CONSOLIDATED_SCHEMA.sql Only**: Added functions directly to CONSOLIDATED_SCHEMA.sql, not separate SQL files per project convention - Added 2025-12-15

7. **Inline Edit Mode**: Used inline edit mode in dashboard instead of modal popup - cleaner UX - Decided 2025-12-15

## Technical Context

### Architecture

```
Frontend Component (React + observer)
    ↓
 ViewModel (MobX makeAutoObservable)
    ↓
Service Layer (IOrganizationQueryService, IOrganizationCommandService)
    ↓
Supabase RPC (api.get_organizations_paginated, api.emit_domain_event)
    ↓
PostgreSQL (organizations_projection, domain_events)
    ↓
Event Processor Trigger (process_organization_event)
```

### Tech Stack

- **Frontend**: React 19, TypeScript, MobX (state), Tailwind CSS
- **Backend**: Supabase PostgreSQL, Edge Functions
- **Patterns**: CQRS, Event Sourcing, Dependency Injection
- **Auth**: Supabase Auth with JWT custom claims

### Dependencies

- `organizations_projection` table - CQRS projection populated by bootstrap workflow
- `domain_events` table - Event store for all state changes
- `process_organization_event` trigger - Updates projection on events
- `api` schema - PostgREST exposed schema for RPC calls
- JWT custom claims (`org_id`, `user_role`, `scope_path`) - For RLS

## File Structure

### New Files Created - 2025-12-15

- `frontend/src/services/organization/IOrganizationCommandService.ts` - Command service interface with `updateOrganization()` method
- `frontend/src/services/organization/SupabaseOrganizationCommandService.ts` - Event-driven updates via `api.emit_domain_event` RPC
- `frontend/src/services/organization/MockOrganizationCommandService.ts` - Logs operations for mock mode
- `frontend/src/services/organization/OrganizationCommandServiceFactory.ts` - Factory based on VITE_AUTH_MODE
- `frontend/src/viewModels/organization/OrganizationListViewModel.ts` - Full pagination, filtering, sorting, search with debounce
- `frontend/src/viewModels/organization/OrganizationDashboardViewModel.ts` - Load org, edit mode, validation, event-driven save

### Existing Files Modified - 2025-12-15

- `frontend/src/pages/organizations/OrganizationListPage.tsx` - Complete rewrite with ViewModel, grid layout, filters, pagination
- `frontend/src/pages/organizations/OrganizationDashboard.tsx` - Complete rewrite with ViewModel, inline edit mode
- `frontend/src/services/organization/IOrganizationQueryService.ts` - Added `getOrganizationsPaginated()` method
- `frontend/src/services/organization/SupabaseOrganizationQueryService.ts` - Implemented pagination via RPC
- `frontend/src/services/organization/MockOrganizationQueryService.ts` - Added pagination mock with client-side filtering
- `frontend/src/types/organization.types.ts` - Added `PaginatedResult<T>`, `OrganizationQueryOptions`, `OrganizationUpdateData`
- `infrastructure/supabase/CONSOLIDATED_SCHEMA.sql` - Added `api.get_organizations_paginated()` function (lines ~3107-3200)

## Related Components

- **Organization Bootstrap Workflow** (`workflows/src/workflows/organization-bootstrap/`) - Creates organizations
- **Event Processing** (`infrastructure/supabase/sql/03-functions/event-processing/002-process-organization-events.sql`) - Updates projections
- **Auth System** (`frontend/src/services/auth/`) - Provides JWT claims for RLS
- **Organization Creation Form** (`frontend/src/pages/organizations/OrganizationCreationForm.tsx`) - Triggers bootstrap

## Key Patterns and Conventions

### ViewModel Pattern

```typescript
// Component uses ViewModel for all state
const [viewModel] = useState(() => new OrganizationDashboardViewModel());

useEffect(() => {
  viewModel.loadOrganization(orgId);
}, [orgId]);

// Wrap with observer() HOC for reactive rendering
export const OrganizationDashboard: React.FC = observer(() => {
  // viewModel.isLoading, viewModel.organization, etc. are reactive
});
```

### Event-Driven Updates

```typescript
// Command service emits events via RPC
async updateOrganization(orgId: string, data: OrganizationUpdateData, reason: string) {
  const eventId = globalThis.crypto.randomUUID();

  await supabase.schema('api').rpc('emit_domain_event', {
    p_event_id: eventId,
    p_event_type: 'organization.updated',
    p_aggregate_type: 'organization',
    p_aggregate_id: orgId,
    p_event_data: {
      ...data,
      updated_fields: Object.keys(data),
      reason
    },
    p_event_metadata: { source: 'frontend' }
  });
}
```

### Service Factory Pattern

```typescript
// Factory selects implementation based on VITE_AUTH_MODE
export function createOrganizationQueryService(): IOrganizationQueryService {
  const authMode = import.meta.env.VITE_AUTH_MODE || 'mock';

  if (authMode === 'mock') {
    return new MockOrganizationQueryService();
  }
  return new SupabaseOrganizationQueryService();
}
```

## Reference Materials

- `documentation/architecture/data/event-sourcing-overview.md` - CQRS/ES architecture
- `documentation/frontend/guides/EVENT-DRIVEN-GUIDE.md` - Frontend event patterns
- `frontend/src/viewModels/organization/InvitationAcceptanceViewModel.ts` - Reference ViewModel implementation
- `infrastructure/supabase/contracts/asyncapi/domains/organization.yaml` - Event contracts

## Important Constraints

1. **PostgREST Schema Restriction**: Only `api` schema exposed. Must use `api.*` functions for RPC calls.

2. **Event-Driven Only**: Never write directly to projection tables. Always emit domain events.

3. **CONSOLIDATED_SCHEMA.sql Deployment**: Individual SQL files not auto-deployed. New functions must be added to CONSOLIDATED_SCHEMA.sql.

4. **JWT Claims Required**: RLS policies use JWT claims. Test with valid tokens in integration mode.

5. **Organization Type Enum**: `provider`, `provider_partner`, `platform_owner` - matches database enum.

6. **globalThis.crypto for UUID**: Use `globalThis.crypto.randomUUID()` not `crypto.randomUUID()` for ESLint compatibility - Discovered 2025-12-15

7. **useCallback for hook dependencies**: When functions are used in useEffect, wrap with useCallback to satisfy react-hooks/exhaustive-deps - Discovered 2025-12-15

## Implementation Discoveries - 2025-12-15

### Factory Function Naming
The existing `OrganizationQueryServiceFactory.ts` exports `createOrganizationQueryService()` function, not a class with `.create()` method. ViewModels must import the function directly.

### Window Function for Pagination
Used `COUNT(*) OVER()` window function in SQL to get total count alongside paginated results in a single query - more efficient than separate count query.

### SECURITY DEFINER for RLS Bypass
The `api.get_organizations_paginated()` function uses `SECURITY DEFINER` to bypass RLS and allow super_admin to see all organizations.

### MobX Observer Pattern
Components using ViewModel must be wrapped with `observer()` HOC from mobx-react-lite for reactive updates.

## Why This Approach?

### ViewModel + MobX
- **Chosen**: ViewModel pattern with MobX observables
- **Alternative**: Direct state in components with React Query
- **Rationale**: Follows established codebase patterns (InvitationAcceptanceViewModel), separates business logic from presentation, enables testability

### Event-Driven Updates
- **Chosen**: Emit domain events, triggers update projections
- **Alternative**: Direct table updates via RPC
- **Rationale**: Maintains event sourcing architecture, provides audit trail, enables future event replay

### Paginated RPC Function
- **Chosen**: Single RPC with all parameters
- **Alternative**: Multiple RPCs or client-side filtering
- **Rationale**: Reduces roundtrips, enables database-level optimization, keeps pagination logic server-side

## Deployment Record

**Commit**: c94df447
**Message**: feat(organizations): Connect organization routes to production data
**Date**: 2025-12-15
**Workflows**:
- Deploy Database Schema: ✅ success
- Deploy Frontend: ✅ success
- Validate Frontend Documentation: ✅ success
