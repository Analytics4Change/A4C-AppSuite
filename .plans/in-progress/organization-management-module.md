# Organization Management Module - Implementation Plan

**Status**: 🚧 In Progress
**Started**: 2025-10-28
**Target Completion**: TBD
**Priority**: High - Core business functionality
**Pattern**: MVVM with Temporal workflow orchestration

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current System State](#current-system-state)
3. [Wireframe Specification](#wireframe-specification)
4. [Requirements Analysis](#requirements-analysis)
5. [Architecture & Design Decisions](#architecture--design-decisions)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Component Specifications](#component-specifications)
8. [Backend Integration](#backend-integration)
9. [Data Flow](#data-flow)
10. [Testing Strategy](#testing-strategy)
11. [Deployment Plan](#deployment-plan)
12. [Progress Tracking](#progress-tracking)

---

## Executive Summary

### Project Scope

Implement a complete Organization Management module that allows super admins to create and bootstrap new provider and partner organizations. The module will:

1. **Replace existing Provider management UI** with new unified Organization Management
2. **Integrate with Temporal workflows** for durable, long-running bootstrap processes
3. **Implement glassomorphic UI** matching existing application design
4. **Support draft management** for incomplete forms
5. **Handle DNS provisioning** via Cloudflare API (10-40 minute async process)
6. **Send user invitations** via email with secure tokens

### Key Decisions

| Decision Point | Choice | Rationale |
|----------------|--------|-----------|
| **Organization Types** | Both Provider + Partner | Backend supports both; Partner UI deferred |
| **Workflow Trigger** | Automatic on form submit | Seamless UX; no manual bootstrap step |
| **DNS Subdomain** | Manual input field | Gives admin control; validated for uniqueness |
| **UI Priority** | Provider only initially | Incremental delivery; Partner UI follows |
| **Module Name** | "Organization Management" | More accurate than "Providers" |
| **Route Structure** | `/organizations/*` | RESTful, supports both types |
| **Worker Language** | Node.js/TypeScript | Already scaffolded in `temporal/` |
| **UI Pattern** | Glassomorphic (liquid glass) | Matches existing application aesthetic |
| **State Management** | MVVM with MobX | Existing pattern in codebase |
| **Draft Storage** | localStorage (initial) | Simple, no backend changes needed |

### Timeline Estimate

- **Phase 1-2 (Data + Services)**: 3-4 hours
- **Phase 3 (ViewModel)**: 2-3 hours
- **Phase 4 (UI Components)**: 5-7 hours
- **Phase 5 (Pages)**: 3-4 hours
- **Phase 6 (Routing)**: 1 hour
- **Phase 7 (Workflow Integration)**: 3-4 hours
- **Phase 8 (Testing)**: 3-4 hours
- **Phase 9 (Backend)**: 2-3 hours
- **Total**: 22-32 hours

---

## Current System State

### ✅ What Exists

#### Frontend
- **Provider UI**: `frontend/src/pages/providers/`
  - ProviderCreatePage.tsx (existing form - will be replaced)
  - ProviderListPage.tsx
  - ProviderDetailPage.tsx
- **Provider ViewModel**: `frontend/src/viewModels/providers/ProviderFormViewModel.ts`
- **Provider Service**: `frontend/src/services/providers/provider.service.ts`
- **Routes**: `/providers/*` in App.tsx (lines 79-82)

#### Backend Infrastructure
- **Temporal Cluster**: Operational since 2025-10-17
  - Namespace: `default`
  - Task Queue: `bootstrap`
  - Frontend: `temporal-frontend.temporal.svc.cluster.local:7233`
  - Web UI: Port-forward 8080
- **Worker Scaffolding**: `temporal/` directory (Node.js/TypeScript)
  - package.json, tsconfig.json, Dockerfile present
  - `src/workflows/` - EMPTY
  - `src/activities/` - EMPTY

#### Database
- **Event Store**: `domain_events` table with triggers
- **Projections**:
  - `organizations_projection` table (org_id, name, type, domain, path, is_active)
  - `user_roles_projection` table
  - `roles_projection` table
  - `permissions_projection` table
- **Auth**: Supabase Auth with JWT custom claims (deployed 2025-10-28)

#### Documentation
- **Temporal Integration Plans**: `.plans/temporal-integration/`
  - overview.md
  - organization-onboarding-workflow.md (comprehensive workflow spec)
  - activities-reference.md
  - error-handling-and-compensation.md
- **Supabase Auth Plans**: `.plans/supabase-auth-integration/`
  - overview.md
  - frontend-auth-architecture.md
  - custom-claims-setup.md

### ❌ What's Missing

#### Frontend
- **Organization Management Module** - Complete new implementation
- **Subdomain input field** - Not in existing Provider form
- **Admin first/last name fields** - Existing form only has single "primaryContactName"
- **Structured billing address** - Existing form has single text field
- **Phone formatting** - No mask/validation
- **Time zone selector** - Not present
- **Email provider dropdown** - Not present
- **Draft management** - No save/resume functionality
- **Temporal client service** - No way to trigger workflows from frontend
- **Bootstrap status page** - No real-time workflow progress UI

#### Backend
- **Workflow Implementation** - `temporal/src/workflows/` is empty
- **Activity Implementation** - `temporal/src/activities/` is empty
- **User Invitations Table** - `user_invitations_projection` doesn't exist
- **Event Processors** - Missing triggers for:
  - OrganizationCreated
  - OrganizationActivated
  - UserInvited
  - InvitationEmailSent
  - DNSConfigured
- **Supabase Edge Function** - No workflow trigger endpoint
- **Worker Deployment** - Docker image not built/deployed

---

## Wireframe Specification

### Visual Design
- **Style**: Glassomorphic (liquid glass)
- **Layout**: Single-page form with three card sections
- **Buttons**: Cancel, Save Draft, Submit

### Field Inventory

#### General Information Section
| Field Label | Type | Required | Backend Mapping |
|-------------|------|----------|-----------------|
| Organization Type | Dropdown (Provider/Partner) | ✅ | `type: 'provider' \| 'partner'` |
| Organization Name | Text | ✅ | `orgData.name` |
| Display Name | Text | ✅ | `display_name` (projection only) |
| Subdomain | Text | ✅ | `subdomain` → DNS provisioning |
| Main Phone Number | Formatted (xxx) xxx-xxxx | ✅ | `main_phone` |
| Additional Phone Number | Formatted (xxx) xxx-xxxx | ❌ | `additional_phone` |
| Time Zone | Dropdown (US zones) | ✅ | `time_zone` |

#### Billing Information Section
| Field Label | Type | Required | Backend Mapping |
|-------------|------|----------|-----------------|
| Billing Name | Text | ✅ | Billing system |
| Payment Type | Dropdown (ACH/Credit/Wire) | ✅ | Billing system |
| Use Mailing Address for Billing | Checkbox | ❌ | UI-only logic |
| Street Line 1 | Text | ✅ | `billing_address.street1` |
| Street Line 2 | Text | ❌ | `billing_address.street2` |
| City | Text | ✅ | `billing_address.city` |
| State | Dropdown | ✅ | `billing_address.state` |
| Zip Code | Text | ✅ | `billing_address.zipCode` |

#### Provider Admin Information Section
| Field Label | Type | Required | Backend Mapping |
|-------------|------|----------|-----------------|
| Administrator First Name | Text | ✅ | `users[0].firstName` |
| Administrator Last Name | Text | ✅ | `users[0].lastName` |
| Administrator Email | Email | ✅ | `users[0].email` + `orgData.contactEmail` |
| Email Provider | Dropdown (Apple/Google/etc) | ❌ | Configuration hint |

### Workflow Parameter Mapping

The form must collect these parameters for `OrganizationBootstrapWorkflow`:

```typescript
interface OrganizationBootstrapParams {
  orgData: {
    name: string;           // ✅ Organization Name
    type: 'provider' | 'partner'; // ✅ Organization Type
    parentOrgId?: string;   // N/A (Partner UI later)
    contactEmail: string;   // ✅ Administrator Email
  };
  subdomain: string;        // ✅ Subdomain field
  users: Array<{
    email: string;          // ✅ Administrator Email
    firstName: string;      // ✅ Administrator First Name
    lastName: string;       // ✅ Administrator Last Name
    role: 'provider_admin' | 'organization_member'; // Hardcode 'provider_admin'
  }>;
  dnsPropagationTimeout?: number; // Optional, default 30 min
}
```

**✅ All required workflow parameters are present in wireframe!**

---

## Requirements Analysis

### Functional Requirements

#### FR-1: Form Management
- **FR-1.1**: User can fill multi-section form with validation
- **FR-1.2**: User can save incomplete form as draft
- **FR-1.3**: User can resume draft from list
- **FR-1.4**: User can delete drafts
- **FR-1.5**: Form auto-saves every 30 seconds

#### FR-2: Data Validation
- **FR-2.1**: Real-time field validation with error messages
- **FR-2.2**: Subdomain uniqueness check (debounced API call)
- **FR-2.3**: Phone number formatting with mask
- **FR-2.4**: Email format validation
- **FR-2.5**: Required field enforcement

#### FR-3: Workflow Integration
- **FR-3.1**: Submit button triggers Temporal workflow
- **FR-3.2**: User redirected to status page with workflow ID
- **FR-3.3**: Status page polls workflow progress every 5 seconds
- **FR-3.4**: Status page shows step-by-step progress
- **FR-3.5**: On completion, redirect to organization detail page

#### FR-4: Address Management
- **FR-4.1**: "Use Mailing Address for Billing" checkbox
- **FR-4.2**: When checked, auto-copy mailing → billing fields
- **FR-4.3**: When unchecked, clear billing fields

### Non-Functional Requirements

#### NFR-1: Performance
- Form renders in < 200ms
- Auto-save doesn't block UI
- Validation debounced appropriately

#### NFR-2: Accessibility
- WCAG 2.1 Level AA compliance
- Full keyboard navigation
- Proper ARIA labels
- Screen reader compatible

#### NFR-3: UX
- Glassomorphic styling consistent with app
- Loading states for async operations
- Clear error messages
- Success feedback

#### NFR-4: Reliability
- Workflow survives browser refresh
- Draft persistence even if server down
- Graceful degradation if Temporal unavailable

### Validation Rules

| Field | Rules |
|-------|-------|
| Organization Name | Required, 2-100 chars, no leading/trailing spaces |
| Display Name | Required, 2-100 chars |
| Subdomain | Required, 3-63 chars, lowercase, alphanumeric + hyphens only, unique, no leading/trailing hyphens |
| Main Phone | Required, exactly 10 digits, format (xxx) xxx-xxxx |
| Additional Phone | Optional, if provided: 10 digits, format (xxx) xxx-xxxx |
| Administrator Email | Required, valid email format, unique (future) |
| Administrator First Name | Required, 1-50 chars, letters only |
| Administrator Last Name | Required, 1-50 chars, letters only |
| Billing Name | Required, 2-100 chars |
| Street Line 1 | Required, 5-100 chars |
| City | Required, 2-50 chars, letters and spaces only |
| State | Required, must be valid US state |
| Zip Code | Required, 5 digits or 5+4 format (xxxxx or xxxxx-xxxx) |

---

## Architecture & Design Decisions

### MVVM Pattern

```
View (React Components)
  ↓ observes
ViewModel (MobX Observable State + Actions)
  ↓ uses
Services (API calls, business logic)
  ↓ calls
Backend (Temporal, Supabase)
```

**Benefits**:
- Clear separation of concerns
- Testable business logic
- Reactive UI updates with MobX
- Reusable ViewModels across views

### Component Architecture

```
OrganizationCreatePage
├── GlassCard (General Information)
│   ├── OrganizationTypeDropdown
│   ├── Input (Organization Name)
│   ├── Input (Display Name)
│   ├── SubdomainInput
│   ├── PhoneInput (Main Phone)
│   ├── PhoneInput (Additional Phone)
│   └── TimeZoneDropdown
├── GlassCard (Billing Information)
│   ├── Input (Billing Name)
│   ├── PaymentTypeDropdown
│   ├── Checkbox (Use Mailing for Billing)
│   └── StructuredAddressInputs
│       ├── Input (Street 1)
│       ├── Input (Street 2)
│       ├── Input (City)
│       ├── StateDropdown
│       └── Input (Zip Code)
├── GlassCard (Admin Information)
│   ├── Input (First Name)
│   ├── Input (Last Name)
│   ├── Input (Email)
│   └── EmailProviderDropdown
└── ActionButtons
    ├── Button (Cancel)
    ├── Button (Save Draft)
    └── Button (Submit)
```

### Service Layer

```typescript
// Organization Service (CRUD + Draft management)
interface OrganizationService {
  saveDraft(data: OrganizationFormData): Promise<string>;
  loadDraft(draftId: string): Promise<OrganizationFormData>;
  deleteDraft(draftId: string): Promise<void>;
  listDrafts(): Promise<DraftSummary[]>;
  checkSubdomainAvailability(subdomain: string): Promise<boolean>;
}

// Temporal Client Service (Workflow trigger)
interface TemporalClientService {
  startBootstrapWorkflow(params: OrganizationBootstrapParams): Promise<string>;
  getWorkflowStatus(workflowId: string): Promise<WorkflowStatus>;
  cancelWorkflow(workflowId: string): Promise<void>;
}
```

### Routing Structure

```
/organizations
├── /organizations (List page)
├── /organizations/create (Form page)
├── /organizations/:id/view (Detail page)
├── /organizations/:id/edit (Edit page - future)
└── /organizations/bootstrap/:workflowId (Status page)
```

### State Management

**ViewModel State**:
```typescript
class OrganizationFormViewModel {
  // Form data (observable)
  type = 'provider';
  name = '';
  displayName = '';
  subdomain = '';
  // ... all form fields

  // UI state (observable)
  isLoading = false;
  isSaving = false;
  isDraft = false;
  error: string | null = null;
  validationErrors: Record<string, string> = {};

  // Workflow state (observable)
  workflowId: string | null = null;
  workflowStatus: 'idle' | 'running' | 'completed' | 'failed' = 'idle';

  // Computed values (computed)
  get isValid(): boolean
  get canSaveDraft(): boolean
  get canSubmit(): boolean
  get formattedSubdomain(): string // Returns: subdomain.firstovertheline.com

  // Actions (action)
  setField(field: string, value: any): void
  toggleUseMailingForBilling(): void
  copyMailingToBilling(): void
  formatPhone(value: string): string
  saveDraft(): Promise<void>
  submit(): Promise<void>
  validate(): boolean
}
```

### Glassomorphic Styling

```typescript
const glassStyle = {
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid',
  borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
  boxShadow: `
    0 0 0 1px rgba(255, 255, 255, 0.18) inset,
    0 2px 4px rgba(0, 0, 0, 0.04),
    0 4px 8px rgba(0, 0, 0, 0.04),
    0 8px 16px rgba(0, 0, 0, 0.04)
  `.trim()
};
```

---

## Implementation Roadmap

### Phase 1: Types & Data Models (2-3 hours)

#### 1.1 Type Definitions
**File**: `frontend/src/types/organization.types.ts` (new)

```typescript
export interface OrganizationFormData {
  // General Information
  type: 'provider' | 'partner';
  name: string;
  displayName: string;
  subdomain: string;
  mainPhone: string;
  additionalPhone: string;
  timeZone: string;

  // Billing Information
  billingName: string;
  paymentType: 'ACH' | 'Credit Card' | 'Wire Transfer';
  useMailingForBilling: boolean;
  billingAddress: {
    street1: string;
    street2: string;
    city: string;
    state: string;
    zipCode: string;
  };

  // Admin Information
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  emailProvider: 'Apple' | 'Google' | 'Microsoft' | 'Other';

  // Workflow tracking
  workflowId?: string;
  status: 'draft' | 'pending' | 'running' | 'completed' | 'failed';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OrganizationBootstrapParams {
  orgData: {
    name: string;
    type: 'provider' | 'partner';
    parentOrgId?: string;
    contactEmail: string;
  };
  subdomain: string;
  users: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: 'provider_admin' | 'organization_member';
  }>;
  dnsPropagationTimeout?: number;
}

export interface WorkflowStatus {
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    step: string;
    completed: boolean;
    error?: string;
  }[];
  result?: OrganizationBootstrapResult;
}

export interface OrganizationBootstrapResult {
  orgId: string;
  domain: string;
  dnsConfigured: boolean;
  invitationsSent: number;
  errors?: string[];
}

export interface DraftSummary {
  draftId: string;
  organizationName: string;
  subdomain: string;
  lastSaved: Date;
}
```

#### 1.2 Constants
**File**: `frontend/src/constants/organization.constants.ts` (new)

```typescript
export const US_TIME_ZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET – EST/EDT, UTC-05:00 / UTC-04:00)' },
  { value: 'America/Chicago', label: 'Central Time (CT – CST/CDT, UTC-06:00 / UTC-05:00)' },
  { value: 'America/Denver', label: 'Mountain Time (MT – MST/MDT, UTC-07:00 / UTC-06:00)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT – PST/PDT, UTC-08:00 / UTC-07:00)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT – AKST/AKDT, UTC-09:00 / UTC-08:00)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii-Aleutian Time (HAT – HST, UTC-10:00)' }
];

export const PAYMENT_TYPES = ['ACH', 'Credit Card', 'Wire Transfer'] as const;

export const EMAIL_PROVIDERS = ['Apple', 'Google', 'Microsoft', 'Other'] as const;

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];
```

**Checklist**:
- [ ] Create `types/organization.types.ts`
- [ ] Create `constants/organization.constants.ts`
- [ ] Export from index files

---

### Phase 2: Services (3-4 hours)

#### 2.1 Organization Service
**File**: `frontend/src/services/organization/organization.service.ts` (new)

```typescript
import { OrganizationFormData, DraftSummary } from '@/types/organization.types';

class OrganizationService {
  private DRAFT_KEY_PREFIX = 'org_draft_';

  // Draft management (localStorage)
  async saveDraft(data: OrganizationFormData): Promise<string> {
    const draftId = data.workflowId || `draft_${Date.now()}`;
    const draftData = {
      ...data,
      updatedAt: new Date()
    };
    localStorage.setItem(this.DRAFT_KEY_PREFIX + draftId, JSON.stringify(draftData));
    return draftId;
  }

  async loadDraft(draftId: string): Promise<OrganizationFormData | null> {
    const data = localStorage.getItem(this.DRAFT_KEY_PREFIX + draftId);
    if (!data) return null;
    return JSON.parse(data);
  }

  async deleteDraft(draftId: string): Promise<void> {
    localStorage.removeItem(this.DRAFT_KEY_PREFIX + draftId);
  }

  async listDrafts(): Promise<DraftSummary[]> {
    const drafts: DraftSummary[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.DRAFT_KEY_PREFIX)) {
        const data = localStorage.getItem(key);
        if (data) {
          const parsed = JSON.parse(data);
          drafts.push({
            draftId: key.replace(this.DRAFT_KEY_PREFIX, ''),
            organizationName: parsed.name,
            subdomain: parsed.subdomain,
            lastSaved: new Date(parsed.updatedAt)
          });
        }
      }
    }
    return drafts.sort((a, b) => b.lastSaved.getTime() - a.lastSaved.getTime());
  }

  // Subdomain validation
  async checkSubdomainAvailability(subdomain: string): Promise<boolean> {
    // TODO: Implement API call to check uniqueness
    // For now, mock implementation
    await new Promise(resolve => setTimeout(resolve, 500));
    return !['test', 'admin', 'api', 'www'].includes(subdomain);
  }
}

export const organizationService = new OrganizationService();
```

#### 2.2 Temporal Client Service
**File**: `frontend/src/services/temporal/temporal-client.service.ts` (new)

```typescript
import { createClient } from '@supabase/supabase-js';
import { OrganizationBootstrapParams, WorkflowStatus } from '@/types/organization.types';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

class TemporalClientService {

  async startBootstrapWorkflow(params: OrganizationBootstrapParams): Promise<string> {
    // Call Supabase Edge Function that triggers Temporal workflow
    const { data, error } = await supabase.functions.invoke('trigger-bootstrap-workflow', {
      body: params
    });

    if (error) throw new Error(`Failed to start workflow: ${error.message}`);

    return data.workflowId;
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    // Poll workflow status via Edge Function
    const { data, error } = await supabase.functions.invoke('get-workflow-status', {
      body: { workflowId }
    });

    if (error) throw new Error(`Failed to get workflow status: ${error.message}`);

    return data;
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    // Cancel running workflow
    const { error } = await supabase.functions.invoke('cancel-workflow', {
      body: { workflowId }
    });

    if (error) throw new Error(`Failed to cancel workflow: ${error.message}`);
  }
}

export const temporalClientService = new TemporalClientService();
```

#### 2.3 Validation Utilities
**File**: `frontend/src/utils/organization-validation.ts` (new)

```typescript
export const ValidationRules = {
  organizationName: (value: string): string | null => {
    if (!value || value.trim().length === 0) return 'Organization name is required';
    if (value.trim().length < 2) return 'Organization name must be at least 2 characters';
    if (value.trim().length > 100) return 'Organization name must be less than 100 characters';
    return null;
  },

  subdomain: (value: string): string | null => {
    if (!value) return 'Subdomain is required';
    if (value.length < 3) return 'Subdomain must be at least 3 characters';
    if (value.length > 63) return 'Subdomain must be less than 63 characters';
    if (!/^[a-z0-9-]+$/.test(value)) return 'Subdomain can only contain lowercase letters, numbers, and hyphens';
    if (value.startsWith('-') || value.endsWith('-')) return 'Subdomain cannot start or end with a hyphen';
    return null;
  },

  phone: (value: string): string | null => {
    if (!value) return null; // Optional field
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 10) return 'Phone number must be exactly 10 digits';
    return null;
  },

  email: (value: string): string | null => {
    if (!value) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return 'Invalid email format';
    return null;
  },

  zipCode: (value: string): string | null => {
    if (!value) return 'Zip code is required';
    const zipRegex = /^\d{5}(-\d{4})?$/;
    if (!zipRegex.test(value)) return 'Invalid zip code format (use xxxxx or xxxxx-xxxx)';
    return null;
  }
};

export const formatPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};
```

**Checklist**:
- [ ] Create `services/organization/organization.service.ts`
- [ ] Create `services/temporal/temporal-client.service.ts`
- [ ] Create `utils/organization-validation.ts`
- [ ] Create Supabase Edge Functions (see Phase 9)

---

### Phase 3: ViewModel (2-3 hours)

#### 3.1 OrganizationFormViewModel
**File**: `frontend/src/viewModels/organization/OrganizationFormViewModel.ts` (new)

```typescript
import { makeAutoObservable, runInAction } from 'mobx';
import { OrganizationFormData } from '@/types/organization.types';
import { organizationService } from '@/services/organization/organization.service';
import { temporalClientService } from '@/services/temporal/temporal-client.service';
import { ValidationRules, formatPhone } from '@/utils/organization-validation';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('viewmodel');

export class OrganizationFormViewModel {
  // General Information
  type: 'provider' | 'partner' = 'provider';
  name = '';
  displayName = '';
  subdomain = '';
  mainPhone = '';
  additionalPhone = '';
  timeZone = 'America/New_York';

  // Billing Information
  billingName = '';
  paymentType: 'ACH' | 'Credit Card' | 'Wire Transfer' = 'ACH';
  useMailingForBilling = false;
  billingAddress = {
    street1: '',
    street2: '',
    city: '',
    state: '',
    zipCode: ''
  };

  // Admin Information
  adminFirstName = '';
  adminLastName = '';
  adminEmail = '';
  emailProvider: 'Apple' | 'Google' | 'Microsoft' | 'Other' = 'Google';

  // UI State
  isLoading = false;
  isSaving = false;
  isDraft = false;
  error: string | null = null;
  validationErrors: Record<string, string> = {};

  // Workflow State
  workflowId: string | null = null;
  workflowStatus: 'idle' | 'running' | 'completed' | 'failed' = 'idle';

  // Draft auto-save
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private draftId: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  // Computed values
  get isValid(): boolean {
    return Object.keys(this.validationErrors).length === 0 && this.name.length > 0;
  }

  get canSaveDraft(): boolean {
    return this.name.length > 0 || this.subdomain.length > 0;
  }

  get canSubmit(): boolean {
    return this.isValid && !this.isSaving;
  }

  get formattedSubdomain(): string {
    return this.subdomain ? `${this.subdomain}.firstovertheline.com` : '';
  }

  // Actions
  setField(field: string, value: any): void {
    (this as any)[field] = value;
    this.validateField(field);
    this.scheduleAutoSave();
  }

  toggleUseMailingForBilling(): void {
    this.useMailingForBilling = !this.useMailingForBilling;
    if (this.useMailingForBilling) {
      this.copyMailingToBilling();
    } else {
      this.clearBillingAddress();
    }
  }

  copyMailingToBilling(): void {
    // TODO: Implement when mailing address fields added
    // For now, no-op since wireframe doesn't show mailing address section
  }

  clearBillingAddress(): void {
    runInAction(() => {
      this.billingAddress = {
        street1: '',
        street2: '',
        city: '',
        state: '',
        zipCode: ''
      };
    });
  }

  handlePhoneChange(field: 'mainPhone' | 'additionalPhone', value: string): void {
    const formatted = formatPhone(value);
    runInAction(() => {
      this[field] = formatted;
      this.validateField(field);
      this.scheduleAutoSave();
    });
  }

  validateField(field: string): void {
    const validators: Record<string, (value: any) => string | null> = {
      name: ValidationRules.organizationName,
      subdomain: ValidationRules.subdomain,
      mainPhone: ValidationRules.phone,
      additionalPhone: ValidationRules.phone,
      adminEmail: ValidationRules.email,
      'billingAddress.zipCode': ValidationRules.zipCode
    };

    const validator = validators[field];
    if (validator) {
      const error = validator((this as any)[field]);
      runInAction(() => {
        if (error) {
          this.validationErrors[field] = error;
        } else {
          delete this.validationErrors[field];
        }
      });
    }
  }

  validate(): boolean {
    const errors: Record<string, string> = {};

    // Validate all required fields
    const requiredValidations = {
      name: ValidationRules.organizationName(this.name),
      subdomain: ValidationRules.subdomain(this.subdomain),
      mainPhone: ValidationRules.phone(this.mainPhone),
      adminEmail: ValidationRules.email(this.adminEmail)
    };

    Object.entries(requiredValidations).forEach(([field, error]) => {
      if (error) errors[field] = error;
    });

    // Validate required text fields
    if (!this.displayName) errors.displayName = 'Display name is required';
    if (!this.billingName) errors.billingName = 'Billing name is required';
    if (!this.adminFirstName) errors.adminFirstName = 'First name is required';
    if (!this.adminLastName) errors.adminLastName = 'Last name is required';
    if (!this.billingAddress.street1) errors['billingAddress.street1'] = 'Street address is required';
    if (!this.billingAddress.city) errors['billingAddress.city'] = 'City is required';
    if (!this.billingAddress.state) errors['billingAddress.state'] = 'State is required';

    runInAction(() => {
      this.validationErrors = errors;
    });

    return Object.keys(errors).length === 0;
  }

  scheduleAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = setTimeout(() => {
      if (this.canSaveDraft) {
        this.saveDraft();
      }
    }, 30000); // 30 seconds
  }

  async saveDraft(): Promise<void> {
    if (!this.canSaveDraft) return;

    try {
      const draftData: OrganizationFormData = {
        type: this.type,
        name: this.name,
        displayName: this.displayName,
        subdomain: this.subdomain,
        mainPhone: this.mainPhone,
        additionalPhone: this.additionalPhone,
        timeZone: this.timeZone,
        billingName: this.billingName,
        paymentType: this.paymentType,
        useMailingForBilling: this.useMailingForBilling,
        billingAddress: { ...this.billingAddress },
        adminFirstName: this.adminFirstName,
        adminLastName: this.adminLastName,
        adminEmail: this.adminEmail,
        emailProvider: this.emailProvider,
        status: 'draft'
      };

      const draftId = await organizationService.saveDraft(draftData);

      runInAction(() => {
        this.draftId = draftId;
        this.isDraft = true;
      });

      log.info('Draft saved', { draftId });
    } catch (error) {
      log.error('Failed to save draft', error);
    }
  }

  async loadDraft(draftId: string): Promise<void> {
    runInAction(() => { this.isLoading = true; });

    try {
      const draft = await organizationService.loadDraft(draftId);

      if (draft) {
        runInAction(() => {
          Object.assign(this, draft);
          this.draftId = draftId;
          this.isDraft = true;
        });
      }
    } catch (error) {
      runInAction(() => {
        this.error = 'Failed to load draft';
      });
      log.error('Failed to load draft', error);
    } finally {
      runInAction(() => { this.isLoading = false; });
    }
  }

  async submit(): Promise<void> {
    if (!this.validate()) {
      runInAction(() => {
        this.error = 'Please fix validation errors before submitting';
      });
      return;
    }

    runInAction(() => {
      this.isSaving = true;
      this.error = null;
    });

    try {
      // Start Temporal workflow
      const workflowId = await temporalClientService.startBootstrapWorkflow({
        orgData: {
          name: this.name,
          type: this.type,
          contactEmail: this.adminEmail
        },
        subdomain: this.subdomain,
        users: [{
          email: this.adminEmail,
          firstName: this.adminFirstName,
          lastName: this.adminLastName,
          role: 'provider_admin'
        }]
      });

      runInAction(() => {
        this.workflowId = workflowId;
        this.workflowStatus = 'running';
        this.isDraft = false;
      });

      // Delete draft if it exists
      if (this.draftId) {
        await organizationService.deleteDraft(this.draftId);
      }

      log.info('Workflow started', { workflowId });

      // Navigation handled by component
      return workflowId;

    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to submit organization';
      });
      log.error('Submit failed', error);
    } finally {
      runInAction(() => { this.isSaving = false; });
    }
  }

  dispose(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
  }
}
```

**Checklist**:
- [ ] Create `viewModels/organization/OrganizationFormViewModel.ts`
- [ ] Add unit tests for validation logic
- [ ] Add unit tests for phone formatting

---

### Phase 4: UI Components (5-7 hours)

#### 4.1 Component Reuse Strategy

| Wireframe Element | Existing Component | New Component | Notes |
|-------------------|-------------------|---------------|-------|
| Text inputs | ✅ Input | - | Reuse as-is |
| Dropdowns | ✅ EditableDropdown | TimeZoneDropdown, PaymentTypeDropdown, EmailProviderDropdown | Wrapper components |
| Card containers | ✅ Card, CardHeader, CardContent | GlassCard | Apply glass styling |
| Buttons | ✅ Button | - | Reuse as-is |
| Checkbox | ✅ Checkbox | - | Reuse as-is |
| Labels | ✅ Label | - | Reuse as-is |
| Phone input | - | ✅ PhoneInput | New with formatting |
| Subdomain input | - | ✅ SubdomainInput | New with validation |
| Address inputs | - | ✅ StructuredAddressInputs | New composite |

#### 4.2 New Component: GlassCard
**File**: `frontend/src/components/ui/GlassCard.tsx`

```typescript
import React from 'react';
import { Card, CardProps } from './card';

const glassStyle = {
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid',
  borderImage: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.5) 100%) 1',
  boxShadow: `
    0 0 0 1px rgba(255, 255, 255, 0.18) inset,
    0 2px 4px rgba(0, 0, 0, 0.04),
    0 4px 8px rgba(0, 0, 0, 0.04),
    0 8px 16px rgba(0, 0, 0, 0.04)
  `.trim()
};

export const GlassCard: React.FC<CardProps> = ({ className, style, ...props }) => {
  return (
    <Card
      className={className}
      style={{ ...glassStyle, ...style }}
      {...props}
    />
  );
};
```

#### 4.3 New Component: PhoneInput
**File**: `frontend/src/components/ui/PhoneInput.tsx`

```typescript
import React from 'react';
import { Input } from './input';
import { Label } from './label';
import { formatPhone } from '@/utils/organization-validation';

interface PhoneInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  id,
  label,
  value,
  onChange,
  error,
  required = false,
  disabled = false
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    onChange(formatted);
  };

  return (
    <div>
      <Label htmlFor={id}>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <Input
        id={id}
        type="tel"
        value={value}
        onChange={handleChange}
        placeholder="(xxx) xxx-xxxx"
        className={error ? 'border-red-500' : ''}
        disabled={disabled}
      />
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
};
```

#### 4.4 New Component: SubdomainInput
**File**: `frontend/src/components/organization/SubdomainInput.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { organizationService } from '@/services/organization/organization.service';
import { Check, X, Loader2 } from 'lucide-react';

interface SubdomainInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export const SubdomainInput: React.FC<SubdomainInputProps> = ({
  id,
  value,
  onChange,
  error,
  disabled = false
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!value || error) {
      setIsAvailable(null);
      return;
    }

    const checkAvailability = async () => {
      setIsChecking(true);
      try {
        const available = await organizationService.checkSubdomainAvailability(value);
        setIsAvailable(available);
      } catch (err) {
        setIsAvailable(null);
      } finally {
        setIsChecking(false);
      }
    };

    const timer = setTimeout(checkAvailability, 500);
    return () => clearTimeout(timer);
  }, [value, error]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    onChange(cleaned);
  };

  return (
    <div>
      <Label htmlFor={id}>
        DNS Subdomain <span className="text-red-500">*</span>
      </Label>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2">
          <Input
            id={id}
            type="text"
            value={value}
            onChange={handleChange}
            placeholder="acme-healthcare"
            className={error ? 'border-red-500' : isAvailable === false ? 'border-red-500' : isAvailable === true ? 'border-green-500' : ''}
            disabled={disabled}
          />
          <span className="text-gray-500 whitespace-nowrap">.firstovertheline.com</span>
          {isChecking && <Loader2 className="animate-spin text-gray-400" size={20} />}
          {!isChecking && isAvailable === true && <Check className="text-green-500" size={20} />}
          {!isChecking && isAvailable === false && <X className="text-red-500" size={20} />}
        </div>
      </div>
      <p className="text-sm text-gray-500 mt-1">
        Lowercase letters, numbers, and hyphens only
      </p>
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
      {!error && isAvailable === false && (
        <p className="text-red-500 text-sm mt-1">This subdomain is already taken</p>
      )}
    </div>
  );
};
```

#### 4.5 Other New Components

**Files to create:**
- `components/ui/TimeZoneDropdown.tsx` - Dropdown with US time zones
- `components/ui/PaymentTypeDropdown.tsx` - Payment type selector
- `components/ui/EmailProviderDropdown.tsx` - Email provider selector
- `components/ui/StateDropdown.tsx` - US states dropdown
- `components/organization/StructuredAddressInputs.tsx` - Composite address form

**Checklist**:
- [ ] Create GlassCard component
- [ ] Create PhoneInput component
- [ ] Create SubdomainInput component
- [ ] Create TimeZoneDropdown component
- [ ] Create PaymentTypeDropdown component
- [ ] Create EmailProviderDropdown component
- [ ] Create StateDropdown component
- [ ] Create StructuredAddressInputs component

---

### Phase 5: Page Components (3-4 hours)

#### 5.1 OrganizationCreatePage
**File**: `frontend/src/pages/organization/OrganizationCreatePage.tsx`

(See full implementation in Component Specifications section below)

#### 5.2 OrganizationBootstrapStatusPage
**File**: `frontend/src/pages/organization/OrganizationBootstrapStatusPage.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { temporalClientService } from '@/services/temporal/temporal-client.service';
import { WorkflowStatus } from '@/types/organization.types';
import { GlassCard } from '@/components/ui/GlassCard';
import { Check, Loader2, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const OrganizationBootstrapStatusPage: React.FC = observer(() => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<WorkflowStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId) return;

    const pollStatus = async () => {
      try {
        const workflowStatus = await temporalClientService.getWorkflowStatus(workflowId);
        setStatus(workflowStatus);

        // Stop polling if completed or failed
        if (workflowStatus.status === 'completed' || workflowStatus.status === 'failed') {
          clearInterval(intervalId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get workflow status');
      }
    };

    pollStatus(); // Initial poll
    const intervalId = setInterval(pollStatus, 5000); // Poll every 5 seconds

    return () => clearInterval(intervalId);
  }, [workflowId]);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <GlassCard className="p-6">
          <div className="flex items-center gap-3 text-red-600">
            <AlertCircle size={24} />
            <h2 className="text-xl font-bold">Error</h2>
          </div>
          <p className="mt-4 text-gray-700">{error}</p>
          <Button
            className="mt-4"
            onClick={() => navigate('/organizations')}
          >
            Back to Organizations
          </Button>
        </GlassCard>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="max-w-4xl mx-auto">
        <GlassCard className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin" size={24} />
            <h2 className="text-xl font-bold">Loading workflow status...</h2>
          </div>
        </GlassCard>
      </div>
    );
  }

  const renderStepIcon = (step: { completed: boolean; error?: string }) => {
    if (step.error) return <X className="text-red-500" size={24} />;
    if (step.completed) return <Check className="text-green-500" size={24} />;
    return <Loader2 className="animate-spin text-blue-500" size={24} />;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Organization Bootstrap</h1>
        <p className="text-gray-600 mt-1">Workflow ID: {workflowId}</p>
      </div>

      <GlassCard className="p-6">
        <h2 className="text-xl font-bold mb-4">Progress</h2>

        <div className="space-y-4">
          {status.progress.map((step, index) => (
            <div key={index} className="flex items-center gap-4">
              {renderStepIcon(step)}
              <div className="flex-1">
                <p className="font-medium">{step.step}</p>
                {step.error && (
                  <p className="text-red-500 text-sm mt-1">{step.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {status.status === 'completed' && status.result && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="font-bold text-green-900">Bootstrap Complete!</h3>
            <p className="text-green-800 mt-2">
              Organization: {status.result.domain}
            </p>
            <p className="text-green-800">
              Invitations sent: {status.result.invitationsSent}
            </p>
            <Button
              className="mt-4"
              onClick={() => navigate(`/organizations/${status.result?.orgId}/view`)}
            >
              View Organization
            </Button>
          </div>
        )}

        {status.status === 'failed' && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h3 className="font-bold text-red-900">Bootstrap Failed</h3>
            <p className="text-red-800 mt-2">
              The organization bootstrap process encountered an error. Please contact support.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => navigate('/organizations')}
            >
              Back to Organizations
            </Button>
          </div>
        )}
      </GlassCard>
    </div>
  );
});
```

#### 5.3 Other Pages
**Files to create:**
- `pages/organization/OrganizationListPage.tsx` - List all organizations
- `pages/organization/OrganizationDetailPage.tsx` - View organization details
- `pages/organization/OrganizationDraftListPage.tsx` - List saved drafts

**Checklist**:
- [ ] Create OrganizationCreatePage
- [ ] Create OrganizationBootstrapStatusPage
- [ ] Create OrganizationListPage
- [ ] Create OrganizationDetailPage
- [ ] Create OrganizationDraftListPage

---

### Phase 6: Routing Integration (1 hour)

#### 6.1 Update App.tsx
**File**: `frontend/src/App.tsx`

Add routes around line 79:

```tsx
{/* Organization Management routes */}
<Route path="/organizations" element={<OrganizationListPage />} />
<Route path="/organizations/drafts" element={<OrganizationDraftListPage />} />
<Route path="/organizations/create" element={<OrganizationCreatePage />} />
<Route path="/organizations/:id/view" element={<OrganizationDetailPage />} />
<Route path="/organizations/bootstrap/:workflowId" element={<OrganizationBootstrapStatusPage />} />
```

#### 6.2 Update Navigation
**File**: `frontend/src/components/layouts/MainLayout.tsx`

Update sidebar navigation item:
- Change "Providers" → "Organizations"
- Link to `/organizations`

**Checklist**:
- [ ] Add routes to App.tsx
- [ ] Update MainLayout navigation

---

### Phase 7: Workflow Integration (3-4 hours)

This phase connects the frontend to Temporal via Supabase Edge Functions.

#### 7.1 Create Supabase Edge Function - Trigger Workflow
**File**: `infrastructure/supabase/functions/trigger-bootstrap-workflow/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Client } from 'npm:@temporalio/client';

const temporalAddress = Deno.env.get('TEMPORAL_ADDRESS') || 'temporal-frontend.temporal.svc.cluster.local:7233';

serve(async (req) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { orgData, subdomain, users } = await req.json();

    // Connect to Temporal
    const client = new Client({
      namespace: 'default'
    });

    // Start workflow
    const handle = await client.workflow.start('OrganizationBootstrapWorkflow', {
      taskQueue: 'bootstrap',
      workflowId: `org-bootstrap-${Date.now()}`,
      args: [{ orgData, subdomain, users }]
    });

    return new Response(
      JSON.stringify({ workflowId: handle.workflowId }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
});
```

#### 7.2 Create Supabase Edge Function - Get Status
**File**: `infrastructure/supabase/functions/get-workflow-status/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Client } from 'npm:@temporalio/client';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { workflowId } = await req.json();

    const client = new Client({ namespace: 'default' });
    const handle = client.workflow.getHandle(workflowId);

    const description = await handle.describe();

    // Map workflow status to our format
    const status = {
      workflowId,
      status: description.status.name,
      progress: [], // TODO: Query workflow for progress
      result: null // TODO: Get result if completed
    };

    return new Response(
      JSON.stringify(status),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
});
```

**Checklist**:
- [ ] Create Edge Function: trigger-bootstrap-workflow
- [ ] Create Edge Function: get-workflow-status
- [ ] Deploy Edge Functions to Supabase
- [ ] Test Edge Functions with Postman/curl
- [ ] Update TemporalClientService to use Edge Functions

---

### Phase 8: Testing (3-4 hours)

#### 8.1 Unit Tests
**File**: `frontend/src/viewModels/organization/__tests__/OrganizationFormViewModel.test.ts`

```typescript
import { OrganizationFormViewModel } from '../OrganizationFormViewModel';

describe('OrganizationFormViewModel', () => {
  let viewModel: OrganizationFormViewModel;

  beforeEach(() => {
    viewModel = new OrganizationFormViewModel();
  });

  describe('Validation', () => {
    it('should validate organization name', () => {
      viewModel.setField('name', '');
      expect(viewModel.validationErrors.name).toBeTruthy();

      viewModel.setField('name', 'Valid Org Name');
      expect(viewModel.validationErrors.name).toBeFalsy();
    });

    it('should validate subdomain format', () => {
      viewModel.setField('subdomain', 'Invalid_Subdomain');
      expect(viewModel.validationErrors.subdomain).toBeTruthy();

      viewModel.setField('subdomain', 'valid-subdomain');
      expect(viewModel.validationErrors.subdomain).toBeFalsy();
    });

    it('should validate phone format', () => {
      viewModel.handlePhoneChange('mainPhone', '1234567890');
      expect(viewModel.mainPhone).toBe('(123) 456-7890');
    });
  });

  describe('Draft Management', () => {
    it('should allow saving draft when name is provided', () => {
      viewModel.setField('name', 'Test Org');
      expect(viewModel.canSaveDraft).toBe(true);
    });

    it('should not allow saving empty draft', () => {
      expect(viewModel.canSaveDraft).toBe(false);
    });
  });
});
```

#### 8.2 E2E Tests
**File**: `frontend/e2e/organization-bootstrap.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Organization Bootstrap Flow', () => {
  test('should complete full organization creation flow', async ({ page }) => {
    await page.goto('http://localhost:5173/organizations/create');

    // Fill General Information
    await page.selectOption('#type', 'provider');
    await page.fill('#name', 'Acme Healthcare');
    await page.fill('#displayName', 'Acme Healthcare Inc.');
    await page.fill('#subdomain', 'acme-healthcare');
    await page.fill('#mainPhone', '5551234567');

    // Fill Billing Information
    await page.fill('#billingName', 'Acme Healthcare');
    await page.selectOption('#paymentType', 'ACH');
    await page.fill('#street1', '123 Main St');
    await page.fill('#city', 'San Francisco');
    await page.selectOption('#state', 'CA');
    await page.fill('#zipCode', '94102');

    // Fill Admin Information
    await page.fill('#adminFirstName', 'John');
    await page.fill('#adminLastName', 'Doe');
    await page.fill('#adminEmail', 'john@acme-healthcare.com');

    // Submit form
    await page.click('button[type="submit"]');

    // Should redirect to status page
    await expect(page).toHaveURL(/\/organizations\/bootstrap\/.+/);

    // Should show progress
    await expect(page.locator('text=Organization created')).toBeVisible();
  });

  test('should save and resume draft', async ({ page }) => {
    await page.goto('http://localhost:5173/organizations/create');

    // Fill partial form
    await page.fill('#name', 'Draft Org');
    await page.fill('#subdomain', 'draft-org');

    // Save draft
    await page.click('button:has-text("Save Draft")');

    // Navigate away
    await page.goto('http://localhost:5173/organizations');

    // Navigate to drafts
    await page.goto('http://localhost:5173/organizations/drafts');

    // Should see draft
    await expect(page.locator('text=Draft Org')).toBeVisible();

    // Resume draft
    await page.click('button:has-text("Resume")');

    // Should have saved values
    await expect(page.locator('#name')).toHaveValue('Draft Org');
    await expect(page.locator('#subdomain')).toHaveValue('draft-org');
  });
});
```

**Checklist**:
- [ ] Create ViewModel unit tests
- [ ] Create E2E test suite
- [ ] Add accessibility tests
- [ ] Test all validation rules
- [ ] Test draft save/load
- [ ] Test workflow submission

---

### Phase 9: Backend Requirements (2-3 hours)

#### 9.1 Database Schema Updates
**File**: `infrastructure/supabase/sql/02-tables/organizations/alter-add-fields.sql`

```sql
-- Add new fields to organizations_projection
ALTER TABLE organizations_projection
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS main_phone TEXT,
  ADD COLUMN IF NOT EXISTS additional_phone TEXT,
  ADD COLUMN IF NOT EXISTS time_zone TEXT DEFAULT 'America/New_York';
```

#### 9.2 User Invitations Table
**File**: `infrastructure/supabase/sql/02-tables/user_invitations/table.sql`

```sql
CREATE TABLE IF NOT EXISTS user_invitations_projection (
  invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations_projection(org_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_user_invitations_org ON user_invitations_projection(org_id);
CREATE INDEX idx_user_invitations_email ON user_invitations_projection(email);
CREATE INDEX idx_user_invitations_token ON user_invitations_projection(token);
CREATE INDEX idx_user_invitations_status ON user_invitations_projection(status);

COMMENT ON TABLE user_invitations_projection IS 'Tracks user invitation lifecycle for organization onboarding';
```

#### 9.3 Event Processors
**File**: `infrastructure/supabase/sql/04-triggers/organization-events.sql`

(Already documented in Temporal integration plans - implement triggers for:)
- OrganizationCreated
- OrganizationActivated
- UserInvited
- InvitationEmailSent
- DNSConfigured

**Checklist**:
- [ ] Extend organizations_projection table
- [ ] Create user_invitations_projection table
- [ ] Create event processor triggers
- [ ] Add to DEPLOY_TO_SUPABASE_STUDIO.sql
- [ ] Deploy via Supabase MCP

---

## Component Specifications

### OrganizationCreatePage (Full Implementation)

**File**: `frontend/src/pages/organization/OrganizationCreatePage.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Save, Send, Building } from 'lucide-react';
import { OrganizationFormViewModel } from '@/viewModels/organization/OrganizationFormViewModel';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { SubdomainInput } from '@/components/organization/SubdomainInput';
import { TimeZoneDropdown } from '@/components/ui/TimeZoneDropdown';
import { PaymentTypeDropdown } from '@/components/ui/PaymentTypeDropdown';
import { EmailProviderDropdown } from '@/components/ui/EmailProviderDropdown';
import { StructuredAddressInputs } from '@/components/organization/StructuredAddressInputs';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

export const OrganizationCreatePage: React.FC = observer(() => {
  const navigate = useNavigate();
  const [viewModel] = useState(() => new OrganizationFormViewModel());

  useEffect(() => {
    log.debug('OrganizationCreatePage mounting');
    return () => {
      viewModel.dispose();
    };
  }, [viewModel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const workflowId = await viewModel.submit();
    if (workflowId) {
      navigate(`/organizations/bootstrap/${workflowId}`);
    }
  };

  const handleSaveDraft = async () => {
    await viewModel.saveDraft();
    // Show toast notification: "Draft saved"
  };

  const renderField = (
    id: string,
    label: string,
    field: keyof OrganizationFormViewModel,
    type: string = 'text',
    required: boolean = false
  ) => (
    <div>
      <Label htmlFor={id}>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <Input
        id={id}
        type={type}
        value={viewModel[field] as string}
        onChange={(e) => viewModel.setField(field, e.target.value)}
        className={viewModel.validationErrors[field as string] ? 'border-red-500' : ''}
        disabled={viewModel.isSaving}
      />
      {viewModel.validationErrors[field as string] && (
        <p className="text-red-500 text-sm mt-1">{viewModel.validationErrors[field as string]}</p>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/organizations')}
          className="hover:bg-white/50"
        >
          <ArrowLeft size={20} className="mr-2" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-gray-900">Organization Management</h1>
          <p className="text-gray-600 mt-1">Create a new provider organization</p>
        </div>
      </div>

      {/* Error Display */}
      {viewModel.error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {viewModel.error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* General Information Card */}
        <GlassCard className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building size={20} />
              General Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Organization Type */}
            <div>
              <Label htmlFor="type">
                Organization Type <span className="text-red-500">*</span>
              </Label>
              <select
                id="type"
                value={viewModel.type}
                onChange={(e) => viewModel.setField('type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                disabled={viewModel.isSaving}
              >
                <option value="provider">Provider</option>
                <option value="partner">Partner</option>
              </select>
            </div>

            {/* Organization Name */}
            {renderField('name', 'Organization Name', 'name', 'text', true)}

            {/* Display Name */}
            {renderField('displayName', 'Display Name', 'displayName', 'text', true)}

            {/* Subdomain */}
            <div className="md:col-span-2">
              <SubdomainInput
                id="subdomain"
                value={viewModel.subdomain}
                onChange={(value) => viewModel.setField('subdomain', value)}
                error={viewModel.validationErrors.subdomain}
                disabled={viewModel.isSaving}
              />
            </div>

            {/* Main Phone */}
            <PhoneInput
              id="mainPhone"
              label="Main Phone Number"
              value={viewModel.mainPhone}
              onChange={(value) => viewModel.handlePhoneChange('mainPhone', value)}
              error={viewModel.validationErrors.mainPhone}
              required
              disabled={viewModel.isSaving}
            />

            {/* Additional Phone */}
            <PhoneInput
              id="additionalPhone"
              label="Additional Phone Number"
              value={viewModel.additionalPhone}
              onChange={(value) => viewModel.handlePhoneChange('additionalPhone', value)}
              error={viewModel.validationErrors.additionalPhone}
              disabled={viewModel.isSaving}
            />

            {/* Time Zone */}
            <div className="md:col-span-2">
              <TimeZoneDropdown
                id="timeZone"
                value={viewModel.timeZone}
                onChange={(value) => viewModel.setField('timeZone', value)}
                disabled={viewModel.isSaving}
              />
            </div>
          </CardContent>
        </GlassCard>

        {/* Billing Information Card */}
        <GlassCard className="mb-6">
          <CardHeader>
            <CardTitle>Billing Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Billing Name */}
            {renderField('billingName', 'Billing Name', 'billingName', 'text', true)}

            {/* Payment Type */}
            <PaymentTypeDropdown
              id="paymentType"
              value={viewModel.paymentType}
              onChange={(value) => viewModel.setField('paymentType', value)}
              disabled={viewModel.isSaving}
            />

            {/* Use Mailing Address */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="useMailingForBilling"
                checked={viewModel.useMailingForBilling}
                onCheckedChange={viewModel.toggleUseMailingForBilling}
                disabled={viewModel.isSaving}
              />
              <Label htmlFor="useMailingForBilling" className="cursor-pointer">
                Use Mailing Address for Billing
              </Label>
            </div>

            {/* Billing Address */}
            <StructuredAddressInputs
              address={viewModel.billingAddress}
              onChange={(field, value) => viewModel.setField(`billingAddress.${field}`, value)}
              errors={viewModel.validationErrors}
              disabled={viewModel.isSaving}
            />
          </CardContent>
        </GlassCard>

        {/* Admin Information Card */}
        <GlassCard className="mb-6">
          <CardHeader>
            <CardTitle>Provider Admin Information</CardTitle>
            <p className="text-sm text-gray-600">
              An invitation will be sent to set up the administrator account
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* First Name */}
            {renderField('adminFirstName', 'Administrator First Name', 'adminFirstName', 'text', true)}

            {/* Last Name */}
            {renderField('adminLastName', 'Administrator Last Name', 'adminLastName', 'text', true)}

            {/* Email */}
            <div className="md:col-span-2">
              {renderField('adminEmail', 'Administrator Email', 'adminEmail', 'email', true)}
            </div>

            {/* Email Provider */}
            <EmailProviderDropdown
              id="emailProvider"
              value={viewModel.emailProvider}
              onChange={(value) => viewModel.setField('emailProvider', value)}
              disabled={viewModel.isSaving}
            />
          </CardContent>
        </GlassCard>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/organizations')}
            disabled={viewModel.isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSaveDraft}
            disabled={!viewModel.canSaveDraft || viewModel.isSaving}
          >
            <Save size={20} className="mr-2" />
            Save Draft
          </Button>
          <Button
            type="submit"
            disabled={!viewModel.canSubmit}
          >
            {viewModel.isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Submitting...
              </>
            ) : (
              <>
                <Send size={20} className="mr-2" />
                Submit
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
});
```

---

## Backend Integration

### Temporal Workflow Implementation Status

**Current State**: Comprehensive documentation exists in `.plans/temporal-integration/organization-onboarding-workflow.md` but **NO CODE** in `temporal/src/workflows/` or `temporal/src/activities/`.

**Required Implementation**:
1. Workflow: `OrganizationBootstrapWorkflow` (lines 98-250 of plan)
2. Activities: 8 total (lines 257-723 of plan)
   - create-organization.ts
   - configure-dns.ts
   - verify-dns.ts
   - generate-invitations.ts
   - send-invitation-emails.ts (uses Resend email provider)
   - activate-organization.ts
   - remove-dns.ts (compensation)
   - deactivate-organization.ts (compensation)

**See**: `.plans/temporal-integration/organization-onboarding-workflow.md` for complete implementation details.

### Email Service Configuration

**Service**: Resend (https://resend.com)
**Purpose**: Transactional email delivery for user invitations

**Benefits**:
- ✅ Excellent deliverability (emails don't land in spam)
- ✅ Simple API (no SMTP server management needed)
- ✅ 100 emails/day free tier (sufficient for initial scale)
- ✅ $20/month for 50,000 emails (production tier)
- ✅ HIPAA-compliant infrastructure available
- ✅ Built-in analytics and tracking

**Environment Variables** (Temporal workers):
```bash
# Production
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Development (uses LoggingEmailProvider - logs to console)
NODE_ENV=development
```

**Implementation**: ResendEmailProvider implements IEmailProvider interface with dependency injection pattern. See `.plans/in-progress/temporal-workflow-design.md` for complete provider implementation.

**Local Development**: No Resend API key needed - LoggingEmailProvider logs email content to console for debugging.

---

## Data Flow

### Form Submission → Workflow Trigger

```
User fills form
  ↓
OrganizationFormViewModel.submit()
  ↓
temporalClientService.startBootstrapWorkflow()
  ↓
Supabase Edge Function: trigger-bootstrap-workflow
  ↓
Temporal Client.workflow.start()
  ↓
OrganizationBootstrapWorkflow started
  ↓
Return workflowId
  ↓
Navigate to /organizations/bootstrap/:workflowId
  ↓
Poll workflow status every 5 seconds
```

### Event Emission → Projection Updates

```
Activity executes
  ↓
Emit domain event to domain_events table
  ↓
PostgreSQL trigger fires
  ↓
Event processor function runs
  ↓
Update projection table
  ↓
Frontend queries projection for display
```

### Draft Save/Load Flow

```
Save Draft:
  User clicks "Save Draft"
    ↓
  OrganizationFormViewModel.saveDraft()
    ↓
  organizationService.saveDraft()
    ↓
  localStorage.setItem()
    ↓
  Toast: "Draft saved"

Load Draft:
  User clicks "Resume" on draft list
    ↓
  Navigate to /organizations/create?draft=:id
    ↓
  OrganizationFormViewModel.loadDraft(id)
    ↓
  organizationService.loadDraft(id)
    ↓
  localStorage.getItem()
    ↓
  Populate form fields
```

---

## Testing Strategy

### Unit Testing
- **ViewModels**: Test validation, computed values, actions
- **Services**: Mock Supabase calls, test error handling
- **Utilities**: Test phone formatting, validation rules
- **Coverage Target**: 80%+

### Integration Testing
- **Service Integration**: Test real Supabase Edge Function calls (dev environment)
- **Draft Persistence**: Test localStorage operations
- **Form Validation**: Test complete validation flow

### E2E Testing
- **Happy Path**: Complete form submission → workflow completion
- **Draft Management**: Save → Navigate away → Resume
- **Error Scenarios**: Invalid subdomain, validation errors
- **Accessibility**: Keyboard navigation, screen reader

### Manual Testing Checklist
- [ ] Fill complete form and submit
- [ ] Verify workflow starts
- [ ] Monitor workflow progress in status page
- [ ] Verify workflow completion
- [ ] Check organization created in database
- [ ] Verify invitation email sent
- [ ] Test draft save/load
- [ ] Test all validation rules
- [ ] Test phone formatting
- [ ] Test address auto-fill
- [ ] Test keyboard navigation
- [ ] Test with screen reader

---

## Deployment Plan

### Prerequisites
- [ ] Temporal cluster operational
- [ ] Supabase project configured
- [ ] Database schema deployed
- [ ] Event processors active

### Frontend Deployment
1. Build application: `npm run build`
2. Deploy to hosting (Vercel/Netlify)
3. Configure environment variables
4. Verify routes accessible

### Backend Deployment
1. Deploy Supabase Edge Functions
2. Configure Temporal worker
3. Build worker Docker image
4. Deploy worker to Kubernetes
5. Verify worker connects to Temporal

### Database Deployment
1. Run schema updates (organizations table fields)
2. Create user_invitations_projection table
3. Deploy event processor triggers
4. Verify triggers active

### Verification
- [ ] Frontend loads without errors
- [ ] Form submission triggers workflow
- [ ] Workflow executes successfully
- [ ] Events populate projections
- [ ] Status page shows progress
- [ ] Organization created in database

---

## Progress Tracking

### Implementation Status

#### Phase 1: Types & Data Models
- [ ] Create organization.types.ts
- [ ] Create organization.constants.ts
- [ ] Export from index files

#### Phase 2: Services
- [ ] Create organization.service.ts
- [ ] Create temporal-client.service.ts
- [ ] Create organization-validation.ts

#### Phase 3: ViewModel
- [ ] Create OrganizationFormViewModel.ts
- [ ] Add unit tests

#### Phase 4: UI Components
- [ ] Create GlassCard component
- [ ] Create PhoneInput component
- [ ] Create SubdomainInput component
- [ ] Create TimeZoneDropdown component
- [ ] Create PaymentTypeDropdown component
- [ ] Create EmailProviderDropdown component
- [ ] Create StateDropdown component
- [ ] Create StructuredAddressInputs component

#### Phase 5: Page Components
- [ ] Create OrganizationCreatePage
- [ ] Create OrganizationBootstrapStatusPage
- [ ] Create OrganizationListPage
- [ ] Create OrganizationDetailPage
- [ ] Create OrganizationDraftListPage

#### Phase 6: Routing
- [ ] Add routes to App.tsx
- [ ] Update MainLayout navigation

#### Phase 7: Workflow Integration
- [ ] Create Edge Function: trigger-bootstrap-workflow
- [ ] Create Edge Function: get-workflow-status
- [ ] Deploy Edge Functions
- [ ] Test integration

#### Phase 8: Testing
- [ ] Create ViewModel unit tests
- [ ] Create E2E test suite
- [ ] Test all validation rules
- [ ] Test draft management
- [ ] Test workflow submission

#### Phase 9: Backend
- [ ] Extend organizations_projection table
- [ ] Create user_invitations_projection table
- [ ] Create event processor triggers
- [ ] Deploy schema updates

### Temporal Implementation (Separate Track)
- [ ] Implement OrganizationBootstrapWorkflow
- [ ] Implement 8 activities
- [ ] Deploy worker to Kubernetes
- [ ] Verify workflow execution

---

## Open Questions & Decisions

### Questions
1. **Mailing Address**: Wireframe shows "Use Mailing Address for Billing" but no mailing address fields. Should we add them or remove checkbox?
2. **Draft Expiration**: Should drafts expire after X days?
3. **Subdomain Uniqueness**: Check against what source? (organizations_projection? Cloudflare DNS?)
4. **Partner Organizations**: When to implement Partner UI? (Deferred for now)
5. **Email Provider**: What's the purpose of this field? Configuration for OAuth hint?

### Decisions Made
- ✅ Use localStorage for draft storage (simple, no backend changes)
- ✅ Auto-save drafts every 30 seconds
- ✅ Glassomorphic styling matches existing application
- ✅ MVVM pattern with MobX
- ✅ Supabase Edge Functions for Temporal integration
- ✅ Poll workflow status every 5 seconds
- ✅ New module: "Organization Management" (not "Providers")
- ✅ Route structure: `/organizations/*`

---

## Related Documentation

- **Temporal Integration**: `.plans/temporal-integration/overview.md`
- **Temporal Workflow Spec**: `.plans/temporal-integration/organization-onboarding-workflow.md`
- **Supabase Auth**: `.plans/supabase-auth-integration/overview.md`
- **Frontend Auth**: `.plans/supabase-auth-integration/frontend-auth-architecture.md`
- **RBAC Architecture**: `.plans/rbac-permissions/architecture.md`

---

**Document Version**: 1.0
**Last Updated**: 2025-10-28
**Status**: Planning Complete - Ready for Implementation
