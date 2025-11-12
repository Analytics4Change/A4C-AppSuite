---
status: current
last_updated: 2025-01-12
---

# Organization Management Module - Architecture

**Last Updated**: 2025-10-31
**Status**: ✅ Implementation Complete (~90%)
**Remaining Work**: Temporal backend workflows (~10%)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Frontend Architecture](#frontend-architecture)
3. [Service Layer](#service-layer)
4. [Backend Infrastructure](#backend-infrastructure)
5. [Database Schema](#database-schema)
6. [Event Processing](#event-processing)
7. [Authentication & Authorization](#authentication--authorization)
8. [Configuration System](#configuration-system)
9. [Data Flow Diagrams](#data-flow-diagrams)
10. [Deployment Architecture](#deployment-architecture)

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
- Temporal.io for workflow orchestration (design complete, not implemented)
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
│  • OrganizationDashboard                            │
│  • AcceptInvitationPage                             │
└─────────────────┬───────────────────────────────────┘
                  │ observes (MobX)
                  ▼
┌─────────────────────────────────────────────────────┐
│                   VIEWMODEL LAYER                    │
│  (Business Logic + State Management)                │
│  • OrganizationFormViewModel                        │
│  • InvitationAcceptanceViewModel                    │
│    - Form validation                                │
│    - Auto-save drafts                               │
│    - Field-level error tracking                     │
└─────────────────┬───────────────────────────────────┘
                  │ uses
                  ▼
┌─────────────────────────────────────────────────────┐
│                    SERVICE LAYER                     │
│  (API Communication + Data Persistence)             │
│  • IWorkflowClient (interface)                      │
│  • IInvitationService (interface)                   │
│  • OrganizationService (draft management)           │
└─────────────────────────────────────────────────────┘
```

### Key Components

#### Pages (5 total)

1. **OrganizationCreatePage** (`frontend/src/pages/organizations/OrganizationCreatePage.tsx`)
   - Full organization creation form (638 lines)
   - Collapsible sections: Basic Info, Contact, Address, Phone, Program
   - Auto-save to drafts (localStorage)
   - Inline validation with error messages
   - Glassomorphic UI styling

2. **OrganizationBootstrapStatusPage** (`frontend/src/pages/organizations/OrganizationBootstrapStatusPage.tsx`)
   - Real-time workflow progress tracking (350 lines)
   - 10-stage workflow visualization
   - Status polling every 2 seconds
   - Error handling and retry

3. **OrganizationListPage** (`frontend/src/pages/organizations/OrganizationListPage.tsx`)
   - Organization grid view (351 lines)
   - Draft management (resume/delete)
   - Search and filtering
   - Role-based visibility

4. **OrganizationDashboard** (`frontend/src/pages/organizations/OrganizationDashboard.tsx`)
   - Minimal MVP dashboard (282 lines)
   - Organization details display
   - Placeholder for future features

5. **AcceptInvitationPage** (`frontend/src/pages/organizations/AcceptInvitationPage.tsx`)
   - Invitation token validation (396 lines)
   - Email/password account creation
   - Google OAuth integration
   - Error states (expired, already accepted)

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

#### ViewModels (2 total)

1. **OrganizationFormViewModel** (`frontend/src/viewModels/organization/OrganizationFormViewModel.ts`)
   - **Responsibilities**:
     - Form state management (MobX observables)
     - Validation logic (email, phone, zip, subdomain)
     - Draft auto-save (500ms debounce)
     - Workflow submission
     - Nested field updates (address, phone, program)
   - **Key Features**:
     - Field-level error tracking
     - Touch tracking (pristine state)
     - Computed properties (`isValid`, `canSubmit`)
     - Constructor injection for testability

2. **InvitationAcceptanceViewModel** (`frontend/src/viewModels/organization/InvitationAcceptanceViewModel.ts`)
   - **Responsibilities**:
     - Token validation
     - Password strength checking
     - Invitation acceptance (email/password or OAuth)
     - Loading state management
   - **Key Features**:
     - Dual authentication methods
     - Computed properties (`isValid`, `isExpired`, `isAlreadyAccepted`)
     - Error handling and recovery

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

#### 1. Workflow Client Service

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

### Supabase Edge Functions

**Runtime**: Deno (TypeScript on V8)
**Deployment**: Supabase platform
**Location**: `infrastructure/supabase/functions/`

#### 1. organization-bootstrap

**File**: `functions/organization-bootstrap/index.ts` (209 lines)

**Purpose**: Initiates organization bootstrap workflow

**Flow**:
1. Accepts organization data from frontend
2. Validates JWT authorization
3. Emits `organization.bootstrap.initiated` event to `domain_events` table
4. Returns `workflowId` for tracking

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

**Purpose**: Contact persons for organizations

**Schema**:
```sql
CREATE TABLE contacts_projection (
  contact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  role_label TEXT, -- e.g., "Executive Director", "Clinical Director"
  is_primary BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

**Business Rules**:
- Exactly one primary contact per organization (enforced by unique partial index)
- Email validation via CHECK constraint

#### 3. addresses_projection

**File**: `infrastructure/supabase/sql/02-tables/organizations/006-addresses_projection.sql`

**Purpose**: Physical addresses for organizations

**Schema**:
```sql
CREATE TABLE addresses_projection (
  address_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  street_line_1 TEXT NOT NULL,
  street_line_2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state ~ '^[A-Z]{2}$'), -- US state codes
  zip_code TEXT NOT NULL CHECK (zip_code ~ '^\d{5}(-\d{4})?$'),
  is_primary BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

**Business Rules**:
- Exactly one primary address per organization
- US state validation (2-letter codes)
- Zip code validation (xxxxx or xxxxx-xxxx)

#### 4. phones_projection

**File**: `infrastructure/supabase/sql/02-tables/organizations/007-phones_projection.sql`

**Purpose**: Phone numbers for organizations

**Schema**:
```sql
CREATE TABLE phones_projection (
  phone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(org_id),
  phone_number TEXT NOT NULL CHECK (phone_number ~ '^\d{10}$'), -- 10 digits only
  extension TEXT,
  phone_type TEXT CHECK (phone_type IN ('mobile', 'office', 'fax')),
  is_primary BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

**Business Rules**:
- Exactly one primary phone per organization
- Phone number format: 10 digits (no formatting)
- Frontend formats as (xxx) xxx-xxxx for display

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

### JWT Custom Claims Structure

All authenticated users receive JWT tokens with custom claims:

```typescript
interface JWTClaims {
  sub: string;              // User UUID
  email: string;
  org_id: string;          // Organization UUID (for RLS)
  user_role: UserRole;     // User's role
  permissions: string[];   // Permission strings
  scope_path: string;      // Hierarchical scope (ltree)
}
```

**Example JWT payload**:
```json
{
  "sub": "user-123e4567-e89b-12d3-a456-426614174000",
  "email": "admin@acme-healthcare.com",
  "org_id": "org-660e8400-e29b-41d4-a716-446655440000",
  "user_role": "provider_admin",
  "permissions": ["organization.read", "organization.write", "user.invite"],
  "scope_path": "org_acme_healthcare"
}
```

### Row-Level Security (RLS)

PostgreSQL RLS policies enforce multi-tenant isolation:

```sql
-- Example RLS policy for organizations_projection
CREATE POLICY "Users can only see their organization"
ON organizations_projection
FOR SELECT
USING (
  org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid
  OR
  (current_setting('request.jwt.claims', true)::json->>'user_role')::text IN ('super_admin', 'a4c_partner')
);
```

**Key Points**:
- `super_admin` and `a4c_partner` can see all organizations
- `provider_admin` can only see their own organization
- `clinician` and `viewer` have further restrictions

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
│  │  Temporal Workers (Not yet deployed)       │   │
│  │  • OrganizationBootstrapWorkflow           │   │
│  │  • 8 activities (DNS, email, etc.)         │   │
│  └────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Infrastructure Services

**Cloudflare**:
- DNS management for subdomains (e.g., `acme-healthcare.firstovertheline.com`)
- CDN for frontend static assets
- DDoS protection

**Email Service** (Future):
- Resend.com for transactional emails
- User invitation emails
- Password reset emails

---

## Temporal Integration (Not Yet Implemented)

### Workflow Design (Complete)

**File**: `.plans/in-progress/temporal-workflow-design.md`

**Status**: ✅ Design complete, ❌ Code not written

### Workflow: OrganizationBootstrapWorkflow

**10-Stage Process**:

1. **Stage 1**: Create organization in database
2. **Stage 2**: Configure DNS subdomain (Cloudflare API)
3. **Stage 3**: Verify DNS propagation (10-40 minutes)
4. **Stage 4**: Generate user invitation token
5. **Stage 5**: Send invitation email (Resend API)
6. **Stage 6**: Activate organization
7. **Stage 7-10**: Reserved for future steps

### Activities (8 total)

**Design complete, implementation pending**:

1. `createOrganization()` - Emit `organization.created` event
2. `configureDNS()` - Cloudflare API call
3. `verifyDNS()` - DNS propagation check (with retry)
4. `generateInvitations()` - Create invitation tokens
5. `sendInvitationEmails()` - Resend API call
6. `activateOrganization()` - Emit `organization.activated` event
7. `removeDNS()` - Compensation activity (rollback)
8. `deactivateOrganization()` - Compensation activity (rollback)

### Remaining Work

To complete Temporal integration (~10% of total project):

1. Implement `temporal/src/workflows/OrganizationBootstrapWorkflow.ts`
2. Implement `temporal/src/activities/*.ts` (8 activities)
3. Configure Cloudflare API client
4. Configure Resend email client
5. Build Docker image for worker
6. Deploy worker to Kubernetes cluster
7. Update Edge Function to actually trigger Temporal workflow (currently emits event only)

---

## Summary

### What's Complete (90%)

✅ Frontend (5 pages, 3 components, 2 ViewModels)
✅ Service Layer (factory pattern, mock + production)
✅ Backend Edge Functions (4 Deno functions)
✅ Database Schema (4 CQRS projections)
✅ Event Processing (trigger-based updates)
✅ Testing (100+ unit tests, 27 E2E tests)
✅ Configuration System (profile-based)
✅ Authentication (Supabase Auth + JWT claims)

### What's Remaining (10%)

❌ Temporal workflow implementation (design complete, code not written)
❌ Worker deployment to Kubernetes
❌ Production schema deployment

### Next Steps

1. Deploy database migrations to Supabase production
2. Deploy Edge Functions to Supabase production
3. Implement Temporal workflows and activities
4. Deploy Temporal workers to Kubernetes
5. Configure DNS (Cloudflare)
6. Set up monitoring (Sentry/LogRocket)
7. Configure CI/CD pipelines

---

**Document Version**: 1.0
**Last Updated**: 2025-10-31
**Author**: Claude Code
**Status**: ✅ Architecture Documentation Complete
