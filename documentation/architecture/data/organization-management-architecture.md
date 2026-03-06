---
status: current
last_updated: 2026-03-06
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Complete architecture for organization management module including two-route frontend pattern (list page with cards + manage page), provider admin redirect, service layer with factory pattern, organization lifecycle operations (deactivate/reactivate/delete), contact/address/phone CRUD, Temporal deletion workflow, and event-driven CQRS backend with JWT access_blocked guard.

**When to read**:
- Understanding organization management module architecture
- Implementing new organization-related features
- Debugging organization CRUD or lifecycle operations
- Understanding service factory pattern
- Working with organization entity services (contacts, addresses, phones)
- Understanding the deletion workflow or access_blocked mechanism

**Prerequisites**: [event-sourcing-overview.md](event-sourcing-overview.md), [temporal-overview.md](../workflows/temporal-overview.md)

**Key topics**: `organization-management`, `organization-lifecycle`, `organization-deletion`, `entity-service`, `access-blocked`, `cqrs`, `service-factory`, `temporal`, `mobx`, `dependency-injection`

**Estimated read time**: 25 minutes
<!-- TL;DR-END -->

# Organization Management Module - Architecture

**Last Updated**: 2026-02-26
**Status**: ✅ Implementation Complete
**UAT Status**: Passed (2025-12-02 — creation/bootstrap), In Progress (2026-02-26 — manage page/lifecycle)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Frontend Architecture](#frontend-architecture)
3. [Service Layer](#service-layer)
4. [Backend Infrastructure](#backend-infrastructure)
5. [Organization Lifecycle Operations](#organization-lifecycle-operations)
6. [Organization Deletion Workflow](#organization-deletion-workflow)
7. [Database Schema](#database-schema)
8. [Event Processing](#event-processing)
9. [Authentication & Authorization](#authentication--authorization)
10. [Configuration System](#configuration-system)
11. [Data Flow Diagrams](#data-flow-diagrams)
12. [Deployment Architecture](#deployment-architecture)

---

## Architecture Overview

### Design Principles

1. **Event-Driven CQRS**: All state changes recorded as immutable events
2. **Factory Pattern**: Environment-based service selection
3. **Dependency Injection**: All services injected via constructors for testability
4. **Mock-First Development**: Complete mock implementations for rapid frontend development
5. **Progressive Enhancement**: Works in mock mode, seamlessly upgrades to production
6. **Type Safety**: Strict TypeScript with zero `any` types

### Technology Stack

**Frontend**:
- React 19 + TypeScript (strict mode)
- MobX for reactive state management
- Vite for fast builds
- Vitest (unit tests) + Playwright (E2E tests)

**Backend**:
- Supabase (PostgreSQL + Auth + Edge Functions)
- Temporal.io for workflow orchestration (✅ fully implemented and operational)
- Backend API Service (Fastify, deployed to k8s)
- PostgreSQL with ltree for hierarchical data
- CQRS projections for read-optimized views

**Infrastructure**:
- Kubernetes (k3s) for Temporal cluster
- Cloudflare for DNS/subdomain management
- Deno runtime for Edge Functions

---

## Frontend Architecture

### MVVM Pattern

The frontend follows strict Model-View-ViewModel separation:

```
┌─────────────────────────────────────────────────────┐
│                      VIEW LAYER                      │
│  (React Components - Presentation Only)             │
│  • OrganizationCreatePage                           │
│  • OrganizationBootstrapStatusPage                  │
│  • OrganizationListPage                             │
│  • OrganizationsManagePage (split-panel, lifecycle)  │
│  • OrganizationDashboard                            │
│  • AcceptInvitationPage                             │
│  • AccessBlockedPage                                │
└─────────────────┬───────────────────────────────────┘
                  │ observes (MobX)
                  ▼
┌─────────────────────────────────────────────────────┐
│                   VIEWMODEL LAYER                    │
│  (Business Logic + State Management)                │
│  • OrganizationFormViewModel (create)               │
│  • OrganizationManageListViewModel (list, lifecycle)│
│  • OrganizationManageFormViewModel (edit, entities) │
│  • InvitationAcceptanceViewModel                    │
└─────────────────┬───────────────────────────────────┘
                  │ uses
                  ▼
┌─────────────────────────────────────────────────────┐
│                    SERVICE LAYER                     │
│  (API Communication + Data Persistence)             │
│  • IOrganizationCommandService (lifecycle RPCs)     │
│  • IOrganizationQueryService (details, list)        │
│  • IOrganizationEntityService (contact/addr/phone)  │
│  • IWorkflowClient (interface)                      │
│  • IInvitationService (interface)                   │
│  • OrganizationService (draft management)           │
└─────────────────────────────────────────────────────┘
```

### Key Components

#### Pages (7 total)

1. **OrganizationCreatePage** (`frontend/src/pages/organizations/OrganizationCreatePage.tsx`)
   - Full organization creation form (~700 lines)
   - **3-Section Structure**:
     - **General Information**: Organization type, name, subdomain, timezone, headquarters address/phone
     - **Billing Information**: Billing contact, address, phone (visible for providers only)
     - **Provider Admin Information**: Admin contact, address, phone
   - "Use General Information" checkboxes for address/phone sharing (see below)
   - Auto-save to drafts (localStorage)
   - Inline validation with error messages
   - Conditional section visibility based on organization type

   **"Use General Information" Checkbox Behavior**:

   Both the Billing and Provider Admin sections include checkboxes to reuse data from General Information:

   | Checkbox | When Checked | When Unchecked |
   |----------|--------------|----------------|
   | "Use General Information for Address" | Billing/Admin address fields hidden, uses HQ address | Shows separate address fields |
   | "Use General Information for Phone" | Billing/Admin phone fields hidden, uses HQ phone | Shows separate phone fields |

   **Implementation**:
   - Checkboxes are checked by default (pre-populate with HQ data)
   - Unchecking reveals separate input fields for that section
   - On submit, if checked: workflow receives reference to HQ entity
   - On submit, if unchecked: workflow creates new entity with section-specific data

   **Database Effect**:
   - When checkbox is checked: Junction table links org to same address/phone entity
   - When checkbox is unchecked: New entity created with appropriate type/label

2. **OrganizationBootstrapStatusPage** (`frontend/src/pages/organizations/OrganizationBootstrapStatusPage.tsx`)
   - Real-time workflow progress tracking (350 lines)
   - 10-stage workflow visualization
   - Status polling every 2 seconds
   - Error handling and retry

3. **OrganizationListPage** (`frontend/src/pages/organizations/OrganizationListPage.tsx`)
   - **Route**: `/organizations` (platform owner only; provider admins redirect to `/organizations/manage`)
   - Glassmorphism card grid (1/2/3 columns responsive) via `OrganizationCard` component
   - Cards display: org name, status badge, type badge, provider admin name/email/phone
   - Sticky filter tabs (All/Active/Inactive) with counts + sticky search bar
   - Search across name, display_name, subdomain, provider admin name/email
   - Create button in page header (navigates to `/organizations/manage?mode=create`)
   - Reuses `OrganizationManageListViewModel`

4. **OrganizationDashboard** (`frontend/src/pages/organizations/OrganizationDashboard.tsx`)
   - Minimal MVP dashboard (282 lines)
   - Organization details display
   - Placeholder for future features

5. **AcceptInvitationPage** (`frontend/src/pages/organizations/AcceptInvitationPage.tsx`)
   - Invitation token validation (396 lines)
   - Email/password account creation
   - Google OAuth integration
   - Error states (expired, already accepted)

6. **OrganizationsManagePage** (`frontend/src/pages/organizations/OrganizationsManagePage.tsx`)
   - Full-width manage page (~1400 lines) following `RolesManagePage` pattern
   - **Entry paths**: (a) card click from list page `?orgId=<uuid>`, (b) provider admin redirect (auto-loads own org from JWT), (c) `?mode=create` for create form
   - Organization details form, contacts/addresses/phones entity sections
   - **Entity CRUD**: Inline add/edit/delete for contacts, addresses, phones via `EntityFormDialog`
   - **DangerZone**: Deactivate/reactivate/delete with `ConfirmDialog` (platform owner only)
   - **Role-based behavior**: Platform owners see Back + Create buttons in header; provider admins see full-width form (no list, no create, no delete)
   - **Field editability**: Platform owners edit all fields including `name`; others edit display_name, tax_number, phone_number, timezone only
   - **Route**: `/organizations/manage` with `RequirePermission("organization.update")`
   - **Query params**: `?orgId=<uuid>` to load specific org, `?mode=create` for create form (create wins if both present)

7. **AccessBlockedPage** (`frontend/src/pages/auth/AccessBlockedPage.tsx`)
   - Displayed when JWT `access_blocked` claim is true (e.g., org deactivated)
   - Glassmorphism card with ShieldX icon, reason-to-label mapping, sign out button
   - Route: `/access-blocked` (public, outside `ProtectedRoute`)

#### Reusable Components (3 custom)

1. **PhoneInput** (`frontend/src/components/organization/PhoneInput.tsx`)
   - Auto-formatting US phone numbers: `(xxx) xxx-xxxx`
   - Real-time validation
   - Accessible with ARIA labels

2. **SubdomainInput** (`frontend/src/components/organization/SubdomainInput.tsx`)
   - Real-time subdomain availability checking
   - Visual feedback: green checkmark (available), red X (taken)
   - Debounced API calls (500ms)
   - Input sanitization (lowercase, alphanumeric + hyphens)

3. **SelectDropdown** (`frontend/src/components/organization/SelectDropdown.tsx`)
   - Accessible dropdown with keyboard navigation
   - Used for: states, timezones, program types, payment types
   - ARIA-compliant

#### ViewModels (4 total)

1. **OrganizationFormViewModel** (`frontend/src/viewModels/organization/OrganizationFormViewModel.ts`)
   - **Responsibilities**: Create form state, validation, draft auto-save, workflow submission
   - **Key Features**: Field-level errors, touch tracking, computed `isValid`/`canSubmit`

2. **OrganizationManageListViewModel** (`frontend/src/viewModels/organization/OrganizationManageListViewModel.ts`)
   - **Responsibilities**: Organization list state, search/filtering, lifecycle operations
   - **Key Features**: `deactivateOrganization()`, `reactivateOrganization()`, `deleteOrganization()` with operation result tracking

3. **OrganizationManageFormViewModel** (`frontend/src/viewModels/organization/OrganizationManageFormViewModel.ts`)
   - **Responsibilities**: Edit form state, validation, submission, 9 entity CRUD methods
   - **Key Features**: Role-based `isPlatformOwner`, `canEditName`, `canEditFields` computed properties; `performEntityOperation()` shared helper with auto-reload on success

4. **InvitationAcceptanceViewModel** (`frontend/src/viewModels/organization/InvitationAcceptanceViewModel.ts`)
   - **Responsibilities**: Token validation, invitation acceptance (email/password or OAuth)
   - **Key Features**: Dual auth methods, computed `isValid`/`isExpired`/`isAlreadyAccepted`

---

## Service Layer

### Factory Pattern with Dependency Injection

All services use **constructor injection** for testability and **factory pattern** for environment-based selection:

```typescript
// Factory selects implementation based on VITE_DEV_PROFILE
class OrganizationFormViewModel {
  constructor(
    private workflowClient: IWorkflowClient = WorkflowClientFactory.create(),
    private orgService: OrganizationService = new OrganizationService()
  ) {
    makeObservable(this);
  }
}

// Unit test can inject mocks
const mockClient = new MockWorkflowClient();
const vm = new OrganizationFormViewModel(mockClient);
```

### Service Implementations

#### 1. Organization Command Service

**Interface**: `IOrganizationCommandService` (`frontend/src/services/organization/IOrganizationCommandService.ts`)

**Methods**:
- `updateOrganization(orgId, data, reason?)` → `OrganizationOperationResult`
- `deactivateOrganization(orgId, reason)` → `OrganizationOperationResult`
- `reactivateOrganization(orgId)` → `OrganizationOperationResult`
- `deleteOrganization(orgId, reason)` → `OrganizationOperationResult`

**Implementations**: `SupabaseOrganizationCommandService` (dedicated RPCs), `MockOrganizationCommandService` (in-memory)

**Factory**: `OrganizationCommandServiceFactory` selects based on `getDeploymentConfig().useMockOrganization`

#### 2. Organization Query Service

**Interface**: `IOrganizationQueryService` (`frontend/src/services/organization/IOrganizationQueryService.ts`)

**Methods**:
- `getOrganizationDetails(orgId)` → org + contacts + addresses + phones in single response
- `listOrganizations()` → organization list

**Implementations**: `SupabaseOrganizationQueryService` (RPC), `MockOrganizationQueryService` (in-memory)

#### 3. Organization Entity Service

**Interface**: `IOrganizationEntityService` (`frontend/src/services/organization/IOrganizationEntityService.ts`)

**Methods** (9 total — 3 each for contacts, addresses, phones):
- `createContact/Address/Phone(orgId, data)` → `OrganizationEntityResult`
- `updateContact/Address/Phone(orgId, entityId, data)` → `OrganizationEntityResult`
- `deleteContact/Address/Phone(orgId, entityId)` → `OrganizationEntityResult`

**Implementations**: `SupabaseOrganizationEntityService` (shared `callEntityRpc` helper), `MockOrganizationEntityService` (in-memory with realistic data)

**Factory**: `OrganizationEntityServiceFactory` selects based on `getDeploymentConfig()`

#### 4. Workflow Client Service

**Interface**: `IWorkflowClient` (`frontend/src/services/workflow/IWorkflowClient.ts`)

**Implementations**:

- **MockWorkflowClient** (`frontend/src/services/workflow/MockWorkflowClient.ts`)
  - localStorage-based simulation (268 lines)
  - Simulates 10-stage workflow with realistic timing
  - Status updates every 2 seconds
  - Returns workflow results with echoed user input
  - Perfect for UI development without backend

- **TemporalWorkflowClient** (`frontend/src/services/workflow/TemporalWorkflowClient.ts`)
  - Supabase Edge Function integration (183 lines)
  - Calls `organization-bootstrap` Edge Function
  - Polls `workflow-status` Edge Function
  - Returns real workflow progress from database

**Factory**: `WorkflowClientFactory` selects based on `appConfig.services.workflowClient`

#### 2. Invitation Service

**Interface**: `IInvitationService` (`frontend/src/services/invitation/IInvitationService.ts`)

**Implementations**:

- **MockInvitationService** (`frontend/src/services/invitation/MockInvitationService.ts`)
  - In-memory simulation
  - Predefined test invitations
  - Token validation logic
  - No backend required

- **TemporalInvitationService** (`frontend/src/services/invitation/TemporalInvitationService.ts`)
  - Production implementation
  - Calls `validate-invitation` Edge Function
  - Calls `accept-invitation` Edge Function
  - Returns real invitation data

#### 3. Organization Service

**File**: `frontend/src/services/organization/OrganizationService.ts`

**Responsibilities**:
- Draft management (localStorage)
- Auto-save functionality
- Draft summaries for list view
- No backend dependency (localStorage only)

**Methods**:
- `saveDraft(data): Promise<string>` - Save form to localStorage
- `loadDraft(draftId): Promise<OrganizationFormData>` - Load from localStorage
- `deleteDraft(draftId): Promise<void>` - Remove draft
- `listDrafts(): Promise<DraftSummary[]>` - Get all drafts

#### 4. Validation Utilities

**File**: `frontend/src/utils/organization-validation.ts`

**Functions**:
- `ValidationRules.organizationName(value): string | null` - 2-100 chars
- `ValidationRules.subdomain(value): string | null` - 3-63 chars, lowercase, alphanumeric + hyphens
- `ValidationRules.phone(value): string | null` - Exactly 10 digits
- `ValidationRules.email(value): string | null` - Valid email format
- `ValidationRules.zipCode(value): string | null` - xxxxx or xxxxx-xxxx
- `formatPhone(value): string` - Format as (xxx) xxx-xxxx

---

## Backend Infrastructure

### Architecture: 2-Hop Direct RPC

**Pattern**: Frontend → Backend API → Temporal (2 hops)

```
Frontend (React) → Backend API (Fastify/k8s) → Temporal Server → Worker
                                ↓
                          PostgreSQL (audit events)
```

### Backend API Service (NEW - 2025-12-01)

**Runtime**: Node.js 20 + Fastify
**Deployment**: Kubernetes (temporal namespace)
**Location**: `workflows/src/api/`
**External URL**: `https://api-a4c.firstovertheline.com`

**Endpoints**:
- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe (checks Temporal connection)
- `POST /api/v1/workflows/organization-bootstrap` - Start bootstrap workflow
- `DELETE /api/v1/organizations/:id` - Start organization deletion workflow

**Authentication**: JWT from Supabase Auth (Authorization header)
**Permission Required**: `organization.create_root`

**Why Backend API instead of Edge Functions?**
- Edge Functions run on Deno Deploy (external to k8s cluster)
- Cannot reach Temporal's internal DNS (`temporal-frontend.temporal.svc.cluster.local:7233`)
- Backend API runs inside k8s, has direct Temporal access

### Supabase Edge Functions

**Runtime**: Deno (TypeScript on V8)
**Deployment**: Supabase platform
**Location**: `infrastructure/supabase/supabase/functions/`

#### 1. organization-bootstrap (Proxy)

**File**: `supabase/functions/organization-bootstrap/index.ts`

**Purpose**: Proxies requests to Backend API (cannot call Temporal directly)

**Flow**:
1. Accepts organization data from frontend
2. Validates JWT authorization
3. Forwards request to Backend API
4. Returns `workflowId` and `organizationId`

**Request**:
```typescript
POST /organization-bootstrap
{
  "organizationName": "Acme Healthcare",
  "organizationType": "provider",
  "subdomain": "acme-healthcare",
  // ... other fields
}
```

**Response**:
```typescript
{
  "workflowId": "bootstrap-123e4567-e89b-12d3-a456-426614174000"
}
```

#### 2. workflow-status

**File**: `functions/workflow-status/index.ts` (203 lines)

**Purpose**: Queries workflow progress from database events

**Flow**:
1. Accepts `workflowId` from frontend
2. Calls PostgreSQL function `get_bootstrap_status(workflow_id)`
3. Returns 10-stage workflow status:
   - Stage 1: Organization created
   - Stage 2: DNS configured
   - Stage 3: DNS propagation verified
   - Stage 4: User invitation generated
   - Stage 5: Invitation email sent
   - Stage 6-10: Additional steps (future)

**Request**:
```typescript
POST /workflow-status
{
  "workflowId": "bootstrap-123e4567-e89b-12d3-a456-426614174000"
}
```

**Response**:
```typescript
{
  "workflowId": "bootstrap-...",
  "status": "running" | "completed" | "failed",
  "progress": [
    { "stage": 1, "name": "Organization created", "status": "completed", "timestamp": "2025-10-30T..." },
    { "stage": 2, "name": "DNS configured", "status": "in_progress", "timestamp": null },
    // ...
  ]
}
```

#### 3. validate-invitation

**File**: `functions/validate-invitation/index.ts` (107 lines)

**Purpose**: Validates invitation tokens

**Flow**:
1. Accepts invitation token from URL
2. Queries `user_invitations_projection` table
3. Checks expiration, acceptance status
4. Returns organization details

**Request**:
```typescript
POST /validate-invitation
{
  "token": "inv_abc123def456ghi789"
}
```

**Response**:
```typescript
{
  "valid": true,
  "organizationName": "Acme Healthcare",
  "adminEmail": "admin@acme.com",
  "expiresAt": "2025-11-15T...",
  "status": "pending" | "accepted" | "expired"
}
```

#### 4. accept-invitation

**File**: `functions/accept-invitation/index.ts` (213 lines)

**Purpose**: Creates user accounts and marks invitation as accepted

**Flow**:
1. Accepts invitation token + credentials
2. Creates Supabase Auth user (email/password or OAuth)
3. Emits `user.created` event
4. Marks invitation as accepted in projection
5. Returns success status

**Request**:
```typescript
POST /accept-invitation
{
  "token": "inv_abc123def456ghi789",
  "password": "SecurePassword123!",
  // OR
  "oauthProvider": "google"
}
```

**Response**:
```typescript
{
  "success": true,
  "userId": "user-123e4567-e89b-12d3-a456-426614174000",
  "redirectUrl": "/organizations/org-id/dashboard"
}
```

### Security Pattern

All Edge Functions follow this pattern:

```typescript
// 1. Verify JWT authorization
const authHeader = req.headers.get('Authorization');
const token = authHeader?.replace('Bearer ', '');
const { data: { user }, error } = await supabase.auth.getUser(token);
if (error || !user) return new Response('Unauthorized', { status: 401 });

// 2. Use service role for admin operations
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!
);

// 3. Emit domain events (CQRS-compliant)
await supabaseAdmin.from('domain_events').insert({
  stream_type: 'organization',
  stream_id: orgId,
  event_type: 'organization.created',
  event_data: { ... }
});

// 4. Return response
return new Response(JSON.stringify({ workflowId }), {
  headers: { 'Content-Type': 'application/json' }
});
```

---

## Organization Lifecycle Operations

### Overview

Organization lifecycle operations (deactivate, reactivate, delete) are managed through dedicated `api.` schema RPC functions. All operations emit domain events and use read-back guards to verify handler success.

### RPC Functions (5 lifecycle + 9 entity CRUD)

**Lifecycle RPCs** (platform owner only via `has_platform_privilege()`):
- `api.deactivate_organization(p_org_id, p_reason)` — sets `is_active=false`, emits `organization.deactivated`
- `api.reactivate_organization(p_org_id)` — sets `is_active=true`, emits `organization.reactivated`
- `api.delete_organization(p_org_id, p_reason)` — requires prior deactivation, emits `organization.deleted`

**Detail/Update RPCs** (permission-gated via `has_effective_permission()`):
- `api.get_organization_details(p_org_id)` — returns org + contacts + addresses + phones
- `api.update_organization(p_org_id, p_data, p_reason)` — strips `name` for non-platform-owners

**Entity CRUD RPCs** (9 total — `has_effective_permission('organization.update')`):
- `api.create_contact/address/phone(p_org_id, p_data)`
- `api.update_contact/address/phone(p_org_id, p_entity_id, p_data)`
- `api.delete_contact/address/phone(p_org_id, p_entity_id)`

### JWT Access Blocked Mechanism

When an organization is deactivated, the JWT custom claims hook (`custom_access_token_hook`) detects `is_active = false` and sets:
- `access_blocked: true`
- `access_block_reason: 'organization_deactivated'`

This blocks user access within ~1 hour (JWT refresh window). The frontend `ProtectedRoute` checks for `access_blocked` and redirects to `AccessBlockedPage`.

**Note**: This is a pull mechanism (token refresh), not push. For immediate blocking, the deletion workflow also bans users via Supabase Admin API.

---

## Organization Deletion Workflow

### Temporal Workflow: `organizationDeletionWorkflow`

**Location**: `workflows/src/workflows/organization-deletion/workflow.ts`
**Pattern**: Best-effort cleanup (no saga compensation)
**Task Queue**: `bootstrap` (shared with bootstrap workflow)
**Trigger**: `DELETE /api/v1/organizations/:id` → Temporal `client.workflow.start()`

### 5-Activity Pipeline

1. **`emitDeletionInitiated`** (new) → emits `organization.deletion.initiated` event
2. **`revokeInvitations`** (reused from bootstrap compensation) → revokes pending invitations
3. **`removeDNS`** (reused from bootstrap compensation) → removes Cloudflare DNS record
4. **`deactivateOrgUsers`** (new) → bans all org users via `supabase.auth.admin.updateUserById(id, { ban_duration: 'none' })`
5. **`emitDeletionCompleted`** (new) → emits `organization.deletion.completed` event with summary

### Design Decisions

- **No saga compensation**: The org is already soft-deleted and access-blocked; cleanup is supplementary, not transactional. Individual activity failures logged in `errors[]` but don't prevent other steps.
- **Child entities NOT deleted**: Contacts, addresses, phones preserved for cross-tenant grant holders, legal/compliance retention. Org soft-delete + RLS blocks normal access.
- **Cross-tenant grants preserved**: All grant types (VAR, court, social services, family, emergency) persist independently of org lifecycle.

---

## Database Schema

### CQRS Projections (Read Models)

All projections follow event-sourced pattern: **never directly updated**, only via event processors.

#### 1. programs_projection

**File**: `infrastructure/supabase/sql/02-tables/organizations/004-programs_projection.sql`

**Purpose**: Stores treatment programs offered by organizations

**Schema**:
```sql
CREATE TABLE programs_projection (
  program_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  program_name TEXT NOT NULL,
  program_type TEXT NOT NULL CHECK (program_type IN (
    'residential', 'outpatient', 'IOP', 'PHP', 'sober_living', 'MAT'
  )),
  capacity INTEGER,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

**Indexes**:
- `organization_id` (foreign key lookup)
- `program_type` (filtering by type)
- `is_active` (active programs query)

#### 2. contacts_projection

**File**: `infrastructure/supabase/sql/02-tables/organizations/005-contacts_projection.sql`

**Purpose**: Contact persons for organizations with type/label classification

**Schema**:
```sql
CREATE TABLE contacts_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  label TEXT NOT NULL,        -- Human-readable: 'Headquarters', 'Billing Contact', 'Provider Admin'
  type contact_type NOT NULL, -- ENUM: 'headquarters', 'billing', 'admin', 'emergency', 'other'
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  title TEXT,                 -- Job title: 'Executive Director', 'CFO'
  department TEXT,            -- Department: 'Finance', 'Operations'
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

**Type/Label System**:
- `type`: Machine-readable classification for queries (enum values)
- `label`: Human-readable display name (free text)
- Example: `type='billing', label='Billing Contact'`

**Business Rules**:
- One primary contact per organization (unique partial index)
- Contact types support the 3-section form (headquarters, billing, admin)

#### 3. addresses_projection

**File**: `infrastructure/supabase/sql/02-tables/organizations/006-addresses_projection.sql`

**Purpose**: Physical addresses for organizations with type/label classification

**Schema**:
```sql
CREATE TABLE addresses_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  label TEXT NOT NULL,          -- Human-readable: 'Headquarters', 'Billing Address', 'Provider Admin'
  type address_type NOT NULL,   -- ENUM: 'headquarters', 'billing', 'shipping', 'mailing', 'other'
  street1 TEXT NOT NULL,
  street2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,          -- US state codes (2-letter)
  zip_code TEXT NOT NULL,       -- xxxxx or xxxxx-xxxx format
  country TEXT DEFAULT 'US',
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

**Type/Label System**:
- `type`: Machine-readable classification for queries (enum values)
- `label`: Human-readable display name (free text)
- Example: `type='billing', label='Billing Address'`

**Business Rules**:
- One primary address per organization
- Address types support the 3-section form (headquarters, billing, admin)

#### 4. phones_projection

**File**: `infrastructure/supabase/sql/02-tables/organizations/007-phones_projection.sql`

**Purpose**: Phone numbers for organizations with type/label classification

**Schema**:
```sql
CREATE TABLE phones_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  label TEXT NOT NULL,          -- Human-readable: 'Main Office', 'Billing Phone', 'Provider Admin'
  type phone_type NOT NULL,     -- ENUM: 'main', 'billing', 'mobile', 'fax', 'other'
  number TEXT NOT NULL,         -- 10 digits (no formatting)
  extension TEXT,
  country_code TEXT DEFAULT '+1',
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

**Type/Label System**:
- `type`: Machine-readable classification for queries (enum values)
- `label`: Human-readable display name (free text)
- Example: `type='billing', label='Billing Phone'`

**Business Rules**:
- One primary phone per organization
- Phone number format: 10 digits (no formatting, stored as digits only)
- Frontend formats as (xxx) xxx-xxxx for display
- Phone types support the 3-section form (main, billing, admin)

#### 5. Junction Tables (Many-to-Many Relationships)

The 3-section form creates multiple contacts, addresses, and phones per organization. Junction tables link them:

**organization_contacts**:
```sql
CREATE TABLE organization_contacts (
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  contact_id UUID NOT NULL REFERENCES contacts_projection(id),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, contact_id)
);
```

**organization_addresses**:
```sql
CREATE TABLE organization_addresses (
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  address_id UUID NOT NULL REFERENCES addresses_projection(id),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, address_id)
);
```

**organization_phones**:
```sql
CREATE TABLE organization_phones (
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  phone_id UUID NOT NULL REFERENCES phones_projection(id),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, phone_id)
);
```

**Junction Table Purpose**:
- Allow multiple contacts/addresses/phones per organization
- Support "Use General Information" checkbox (reuse same entity)
- Enable soft-delete of relationships without deleting the entity
- Query: "Get all contacts for organization X" or "Get all organizations using address Y"

### Common Patterns

All projection tables follow these patterns:

1. **UUID Primary Keys**: `gen_random_uuid()`
2. **Logical Deletion**: `deleted_at TIMESTAMPTZ` (never physical DELETE)
3. **Audit Timestamps**: `created_at`, `updated_at`, `deleted_at`
4. **Metadata Extensibility**: `JSONB` column for future fields
5. **Performance Indexes**: On foreign keys and common query patterns
6. **Business Rule Constraints**: CHECK constraints for data validation

---

## Event Processing

### Event-Driven Updates

**Principle**: Projections are **never directly updated**. All changes happen via domain events processed by PostgreSQL triggers.

### Event Processor Functions

**File**: `infrastructure/supabase/sql/03-functions/event-processing/007-process-organization-child-events.sql` (324 lines)

**Functions Created**:

1. **process_program_event()**
   - Handles: `program.created`, `program.updated`, `program.activated`, `program.deactivated`, `program.deleted`
   - Creates/updates/soft-deletes rows in `programs_projection`

2. **process_contact_event()**
   - Handles: `contact.created`, `contact.updated`, `contact.deleted`
   - Enforces single primary contact rule

3. **process_address_event()**
   - Handles: `address.created`, `address.updated`, `address.deleted`
   - Enforces single primary address rule

4. **process_phone_event()**
   - Handles: `phone.created`, `phone.updated`, `phone.deleted`
   - Enforces single primary phone rule

### Event Router

**File**: `infrastructure/supabase/sql/03-functions/event-processing/001-main-event-router.sql`

**Purpose**: Routes domain events to appropriate processors based on `stream_type`

**Routing Logic**:
```sql
CASE p_event.stream_type
  WHEN 'program' THEN PERFORM process_program_event(p_event);
  WHEN 'contact' THEN PERFORM process_contact_event(p_event);
  WHEN 'address' THEN PERFORM process_address_event(p_event);
  WHEN 'phone' THEN PERFORM process_phone_event(p_event);
  WHEN 'organization' THEN PERFORM process_organization_event(p_event);
  -- ... other stream types
END CASE;
```

### Event Processing Pattern Example

```sql
-- Event: contact.created
WHEN 'contact.created' THEN
  -- Step 1: Extract organization_id from event
  v_org_id := safe_jsonb_extract_uuid(p_event.event_data, 'organization_id');

  -- Step 2: Clear existing primary if new contact is primary
  IF safe_jsonb_extract_boolean(p_event.event_data, 'is_primary') THEN
    UPDATE contacts_projection
    SET is_primary = false
    WHERE organization_id = v_org_id
      AND is_primary = true
      AND deleted_at IS NULL;
  END IF;

  -- Step 3: Insert new contact
  INSERT INTO contacts_projection (
    contact_id, organization_id, first_name, last_name, email,
    role_label, is_primary, metadata
  ) VALUES (
    safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
    v_org_id,
    safe_jsonb_extract_text(p_event.event_data, 'first_name'),
    safe_jsonb_extract_text(p_event.event_data, 'last_name'),
    safe_jsonb_extract_text(p_event.event_data, 'email'),
    safe_jsonb_extract_text(p_event.event_data, 'role_label'),
    safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'),
    p_event.event_data - 'contact_id' - 'organization_id' - 'first_name' - 'last_name' - 'email' - 'role_label' - 'is_primary'
  );
```

### Benefits of Event Processing

1. **Audit Trail**: Complete history of all changes in `domain_events` table
2. **Consistency**: Single source of truth for business rules
3. **Replay**: Can rebuild projections by replaying events
4. **Debugging**: Can trace exactly what happened and when
5. **Compliance**: HIPAA-compliant audit logs

---

## Authentication & Authorization

### Supabase Auth with JWT Custom Claims

**Status**: ✅ Fully implemented (as of 2025-10-28)

### JWT Custom Claims Structure (v4)

All authenticated users receive JWT tokens with custom claims:

```typescript
interface JWTClaims {
  sub: string;                        // User UUID
  email: string;
  org_id: string;                    // Organization UUID (for RLS)
  org_type: string;                  // Organization type (platform_owner, provider, provider_partner)
  effective_permissions: number;     // Bitfield of merged permissions across all roles
  access_blocked?: boolean;          // Set to true when org is deactivated/deleted
  access_block_reason?: string;      // 'organization_deactivated' | 'organization_deleted'
}
```

**Example JWT payload**:
```json
{
  "sub": "user-123e4567-e89b-12d3-a456-426614174000",
  "email": "admin@acme-healthcare.com",
  "org_id": "org-660e8400-e29b-41d4-a716-446655440000",
  "org_type": "provider",
  "effective_permissions": 4194303
}
```

**Note**: v3 fields (`user_role`, `permissions` array, `scope_path`) were removed in the JWT v4 migration (2026-01-26). Permissions are now a bitfield checked via `hasPermission()` / `has_permission()` helpers.

### Row-Level Security (RLS)

PostgreSQL RLS policies enforce multi-tenant isolation:

```sql
-- Example RLS policy for organizations_projection
CREATE POLICY organizations_super_admin_all
  ON organizations_projection FOR ALL
  USING (is_super_admin(get_current_user_id()));

CREATE POLICY organizations_org_admin_select
  ON organizations_projection FOR SELECT
  USING (has_org_admin_permission() AND id = get_current_org_id());
```

**Key Points**:
- `is_super_admin()` users can see/manage all organizations
- `has_org_admin_permission()` users can only see their own organization
- RLS uses helper functions (not raw JWT parsing) for v4 claims compatibility
- Regular users have no direct table access (organization context via JWT claims)

### Authentication Modes

Frontend supports three authentication modes via `VITE_APP_MODE`:

1. **mock** (default for development):
   - Instant authentication without network calls
   - Complete JWT claims structure for testing
   - Configurable user profiles (super_admin, provider_admin, etc.)
   - Perfect for UI development

2. **integration** (for testing):
   - Real OAuth flows with Google/GitHub
   - Real JWT tokens from Supabase
   - Custom claims from database hooks
   - Use for testing authentication flows

3. **production**:
   - Real Supabase Auth with social login
   - Enterprise SSO support (SAML 2.0)
   - JWT custom claims with full RLS enforcement

---

## Configuration System

### Single Source of Truth: `VITE_DEV_PROFILE`

**File**: `frontend/src/config/app.config.ts`

**Purpose**: Single environment variable controls entire application behavior

### Available Profiles

#### 1. local-mock (Default for development)

```typescript
{
  name: 'local-mock',
  services: {
    authProvider: 'dev',              // DevAuthProvider (mock)
    workflowClient: 'mock',           // MockWorkflowClient (localStorage)
    invitationService: 'mock'         // MockInvitationService (in-memory)
  },
  features: {
    useRealDatabase: false,           // No Supabase calls
    useRealWorkflows: false,          // No Temporal calls
    enableDebugTools: true            // Show debug info
  }
}
```

**Use case**: Rapid UI development without backend dependencies

#### 2. integration-supabase (For integration testing)

```typescript
{
  name: 'integration-supabase',
  services: {
    authProvider: 'supabase',         // SupabaseAuthProvider (real)
    workflowClient: 'temporal',       // TemporalWorkflowClient (real)
    invitationService: 'temporal'     // TemporalInvitationService (real)
  },
  features: {
    useRealDatabase: true,            // Supabase dev project
    useRealWorkflows: true,           // Edge Functions + events
    enableDebugTools: true            // Keep debug tools
  }
}
```

**Use case**: Testing authentication, Edge Functions, database integration

#### 3. production

```typescript
{
  name: 'production',
  services: {
    authProvider: 'supabase',         // SupabaseAuthProvider (real)
    workflowClient: 'temporal',       // TemporalWorkflowClient (real)
    invitationService: 'temporal'     // TemporalInvitationService (real)
  },
  features: {
    useRealDatabase: true,            // Supabase prod project
    useRealWorkflows: true,           // Temporal cluster required
    enableDebugTools: false           // Hide debug tools
  }
}
```

**Use case**: Production deployment

### Environment Variables

#### Frontend `.env.local`

```bash
# Development Profile (controls all service selection)
VITE_DEV_PROFILE=local-mock              # Options: local-mock, integration-supabase, production

# Supabase (only needed for integration/production)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

#### Supabase Edge Functions (set via dashboard or CLI)

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
```

---

## Data Flow Diagrams

### Form Submission → Workflow Trigger

```
User fills form
  ↓
OrganizationFormViewModel.submit()
  ↓
workflowClient.startBootstrap(params)
  │
  ├── MOCK MODE: MockWorkflowClient
  │   ↓
  │   localStorage.setItem('workflow_...')
  │   ↓
  │   Return synthetic workflowId
  │
  └── PRODUCTION MODE: TemporalWorkflowClient
      ↓
      Supabase Edge Function: /organization-bootstrap
      ↓
      Emit domain event: organization.bootstrap.initiated
      ↓
      Return workflowId
  ↓
Navigate to /organizations/bootstrap/:workflowId
  ↓
Poll workflow status every 2 seconds
```

### Event Emission → Projection Updates

```
Edge Function executes
  ↓
INSERT INTO domain_events (stream_type, event_type, event_data)
  ↓
PostgreSQL trigger: AFTER INSERT ON domain_events
  ↓
Call process_event_routing()
  ↓
Route based on stream_type:
  ├── stream_type = 'program' → process_program_event()
  ├── stream_type = 'contact' → process_contact_event()
  ├── stream_type = 'address' → process_address_event()
  └── stream_type = 'phone' → process_phone_event()
  ↓
Event processor updates projection table
  ↓
Frontend queries projection for display
```

### Draft Save/Load Flow

```
Save Draft:
  User clicks "Save Draft" or auto-save triggers (500ms debounce)
    ↓
  OrganizationFormViewModel.saveDraft()
    ↓
  organizationService.saveDraft(formData)
    ↓
  localStorage.setItem('org_draft_...', JSON.stringify(data))
    ↓
  Toast: "Draft saved"

Load Draft:
  User clicks "Resume" on OrganizationListPage
    ↓
  Navigate to /organizations/create?draft=:id
    ↓
  OrganizationFormViewModel.loadDraft(id)
    ↓
  organizationService.loadDraft(id)
    ↓
  localStorage.getItem('org_draft_...')
    ↓
  Populate form fields (MobX updates trigger re-render)
```

---

## Deployment Architecture

### Frontend Deployment

```
┌─────────────────────────────────────────────────────┐
│              HOSTING PLATFORM                        │
│  (Vercel / Netlify / Cloudflare Pages)             │
│                                                      │
│  Environment Variables:                             │
│  • VITE_DEV_PROFILE=production                     │
│  • VITE_SUPABASE_URL=https://prod.supabase.co     │
│  • VITE_SUPABASE_ANON_KEY=prod-anon-key           │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│              FRONTEND (React SPA)                    │
│  • Static HTML/CSS/JS served from CDN              │
│  • Client-side routing (React Router)              │
│  • JWT tokens in localStorage                      │
└───────────────────┬─────────────────────────────────┘
                    │ HTTPS API calls
                    ▼
┌─────────────────────────────────────────────────────┐
│         SUPABASE (Backend Platform)                 │
│  ┌────────────────────────────────────────────┐   │
│  │  Auth Service (Supabase Auth)               │   │
│  │  • OAuth2 PKCE (Google, GitHub)            │   │
│  │  • SAML 2.0 (Enterprise SSO)               │   │
│  │  • JWT with custom claims                  │   │
│  └────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────┐   │
│  │  PostgreSQL Database                        │   │
│  │  • domain_events (event store)             │   │
│  │  • organizations_projection                │   │
│  │  • programs_projection                     │   │
│  │  • contacts_projection                     │   │
│  │  • addresses_projection                    │   │
│  │  • phones_projection                       │   │
│  │  • Event processor triggers                │   │
│  │  • RLS policies                            │   │
│  └────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────┐   │
│  │  Edge Functions (Deno Runtime)             │   │
│  │  • organization-bootstrap                  │   │
│  │  • workflow-status                         │   │
│  │  • validate-invitation                     │   │
│  │  • accept-invitation                       │   │
│  └────────────────────────────────────────────┘   │
└───────────────────┬─────────────────────────────────┘
                    │ (Future: Temporal workflows)
                    ▼
┌─────────────────────────────────────────────────────┐
│      KUBERNETES CLUSTER (k3s)                       │
│  ┌────────────────────────────────────────────┐   │
│  │  Temporal Server (Namespace: temporal)     │   │
│  │  • Frontend service: port 7233             │   │
│  │  • Web UI: port 8080                       │   │
│  └────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────┐   │
│  │  Temporal Workers (Deployed)               │   │
│  │  • OrganizationBootstrapWorkflow (10 stg)  │   │
│  │  • OrganizationDeletionWorkflow (5 stg)    │   │
│  │  • 13 forward + 6 compensation activities  │   │
│  └────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Infrastructure Services

**Cloudflare**:
- DNS management for subdomains (e.g., `acme-healthcare.firstovertheline.com`)
- CDN for frontend static assets
- DDoS protection

**Email Service** (Resend — Operational):
- Resend.com for transactional emails (primary), SMTP (fallback)
- User invitation emails
- See [Resend Email Provider Guide](../../workflows/guides/resend-email-provider.md)

---

## Temporal Integration (Complete)

### Workflow Implementation

**Status**: ✅ Fully implemented and deployed (2025-12-01)

**Location**: `workflows/src/workflows/organizationBootstrapWorkflow.ts`

### Workflow: OrganizationBootstrapWorkflow

**10-Stage Process**:

1. **Stage 1**: Create organization in database
2. **Stage 2**: Create contacts (HQ, Billing, Admin)
3. **Stage 3**: Create addresses (HQ, Billing, Admin)
4. **Stage 4**: Create phones (HQ, Billing, Admin)
5. **Stage 5**: Configure DNS subdomain (Cloudflare API)
6. **Stage 6**: Verify DNS propagation
7. **Stage 7**: Generate user invitation tokens
8. **Stage 8**: Send invitation emails (Resend API)
9. **Stage 9**: Activate organization
10. **Stage 10**: Emit completion event

### Bootstrap Activities (13 total: 7 forward + 6 compensation)

**Forward Activities**:
1. `createOrganization()` - Create org, emit `organization.created` event
2. `grantProviderAdminPermissions()` - Grant 16 canonical permissions to provider admin
3. `configureDNS()` - Create DNS record via Cloudflare API
4. `verifyDNS()` - Quorum-based DNS propagation verification (2/3 resolvers)
5. `generateInvitations()` - Create invitation tokens
6. `sendInvitationEmails()` - Send emails via Resend API
7. `emitBootstrapCompleted()` - Emit `organization.bootstrap.completed` event (trigger handler sets `is_active=true`)

**Event Emission Activities**:
1. `emitBootstrapCompleted()` - Emits `organization.bootstrap.completed` (on success)
2. `emitBootstrapFailed()` - Emits `organization.bootstrap.failed` (on failure, handler sets `is_active=false`)

**Compensation Activities** (Saga pattern rollback):
1. `deactivateOrganization()` - Safety net fallback (P2 removal planned)
2. `removeDNS()` - Remove DNS record from Cloudflare
3. `revokeInvitations()` - Mark invitations as revoked
4. `deleteContacts()` - Delete related contacts
5. `deleteAddresses()` - Delete related addresses
6. `deletePhones()` - Delete related phones

### Deletion Workflow Activities (5 total: 3 new + 2 reused)

**Location**: `workflows/src/workflows/organization-deletion/workflow.ts`
**Pattern**: Best-effort cleanup (no saga compensation — org is already soft-deleted)

1. `emitDeletionInitiated()` (new) - Emits `organization.deletion.initiated` event
2. `revokeInvitations()` (reused from bootstrap) - Revokes all pending invitations
3. `removeDNS()` (reused from bootstrap) - Removes Cloudflare DNS record
4. `deactivateOrgUsers()` (new) - Bans all org users via Supabase Admin API (`ban_duration: 'none'`)
5. `emitDeletionCompleted()` (new) - Emits `organization.deletion.completed` with error summary

**API Trigger**: `DELETE /api/v1/organizations/:id` (`workflows/src/api/routes/workflows.ts`)

### Triggering Architecture

**2-Hop Pattern**: Frontend → Backend API → Temporal

```
Frontend (React)
     ↓ POST /api/v1/workflows/organization-bootstrap
Backend API (Fastify @ api-a4c.firstovertheline.com)
     ↓ client.workflow.start()
Temporal Server (temporal-frontend.temporal.svc.cluster.local:7233)
     ↓
Temporal Worker (workflow-worker deployment)
```

---

## Summary

### Implementation Status: Complete

✅ **Frontend** (7 pages, 3 components, 4 ViewModels)
✅ **Service Layer** (6 service interfaces with factory pattern, mock + production)
✅ **Backend API** (Fastify service deployed to k8s, 2 endpoints)
✅ **Edge Functions** (4 Deno functions with `access_blocked` guard)
✅ **Database Schema** (4 CQRS projections + 3 junction tables)
✅ **Database RPCs** (14 lifecycle + entity CRUD functions in `api` schema)
✅ **Event Processing** (trigger-based updates, 13 routers, 52+ handlers)
✅ **Temporal Workflows** (bootstrap: 13 activities, deletion: 5 activities)
✅ **Worker Deployment** (workflow-worker in temporal namespace)
✅ **JWT Access Blocked** (org deactivation → access_blocked claim → AccessBlockedPage)
✅ **Configuration System** (profile-based)
✅ **Authentication** (Supabase Auth + JWT v4 claims)
✅ **UAT Testing** (Passed 2025-12-02 — creation/bootstrap)

### Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Workflow Triggering | 2-Hop (Frontend → Backend API → Temporal) | Edge Functions can't reach k8s internal DNS |
| Form Structure | 3 Sections (General, Billing, Admin) | Captures all required organization data |
| Data Reuse | "Use General Information" checkboxes | Reduces data entry, uses junction tables |
| Entity Classification | Type/Label system | Machine queries (type) + human display (label) |
| Bootstrap Compensation | Saga pattern (6 rollback activities) | Graceful failure recovery |
| Deletion Workflow | Best-effort cleanup (no saga) | Org already soft-deleted; cleanup is supplementary |
| Dedicated RPCs | `api.update_organization()` etc. over `emit_domain_event()` | Backend owns event emission, proper permission checks |
| Temporal for Deletion Only | Deactivate/reactivate are synchronous RPCs | Only deletion has unreliable external calls (DNS, Admin API) |
| Cross-Tenant Grants on Delete | Preserved (all grant types) | Legal obligation + VAR metrics + soft-delete architecture |

### Future Enhancements

- Organization deletion status polling UI
- Real-time workflow status via WebSocket (currently polling)
- Cross-tenant access grant management UI
- VAR dashboard with aggregated performance metrics
- Bulk organization import from CSV

---

## Related Documentation

### Implementation & Database
- **[organizations_projection Table](../../infrastructure/reference/database/tables/organizations_projection.md)** - Complete database schema (760 lines)
- **[organization_business_profiles_projection Table](../../infrastructure/reference/database/tables/organization_business_profiles_projection.md)** - Business profile schema
- **organization_domains_projection** - Custom domains schema (not yet implemented)
- **provider_partnerships_projection** - Partnership schema (not yet implemented)

### Multi-Tenancy & Data Architecture
- **[Multi-Tenancy Architecture](./multi-tenancy-architecture.md)** - Organization-based tenant isolation with RLS
- **[Tenants as Organizations](./tenants-as-organizations.md)** - Multi-tenancy design philosophy
- **[Event Sourcing Overview](./event-sourcing-overview.md)** - CQRS and domain events
- **[Provider Partners Architecture](./provider-partners-architecture.md)** - Partner ecosystem design

### Authentication & Authorization
- **[RBAC Architecture](../authorization/rbac-architecture.md)** - Role-based access control at org level
- **[Frontend Auth Architecture](../authentication/frontend-auth-architecture.md)** - JWT custom claims with org_id
- **[JWT Custom Claims Setup](../../infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md)** - Database hooks for org context

### Workflows & Operations
- **[Organization Onboarding Workflow](../workflows/organization-onboarding-workflow.md)** - Workflow design for org setup
- **[Organization Bootstrap Workflow Design](../../workflows/architecture/organization-bootstrap-workflow-design.md)** - Detailed workflow spec
- **[Temporal Overview](../workflows/temporal-overview.md)** - Workflow orchestration architecture

### Infrastructure & Deployment
- **[Supabase Auth Setup](../../infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md)** - OAuth configuration
- **[Deployment Instructions](../../infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md)** - Production deployment
- **[SQL Idempotency Audit](../../infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)** - Migration best practices

---

**Document Version**: 3.0
**Last Updated**: 2026-02-26
**Author**: Claude Code
**Status**: ✅ Implementation Complete
