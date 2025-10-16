# Provider Organization Bootstrap Sequence

## Overview

Detailed sequence documentation for bootstrapping `type=provider` organizations in the A4C platform. Provider organizations are healthcare facilities that manage at-risk youth and need comprehensive organizational hierarchies.

## Provider Bootstrap Characteristics

- **Organization Type**: `provider`
- **Initial Role**: `provider_admin` 
- **Permissions**: All organization-scoped permissions within their hierarchy
- **Hierarchy**: Can create sub-organizations (facilities, programs, units)
- **Cross-Tenant**: Can grant access to provider_partner organizations

---

## Detailed Provider Bootstrap Flow

### Phase 1: Initiation and Validation

```mermaid
sequenceDiagram
    participant UI as Provider Management UI
    participant Valid as Form Validator
    participant Saga as Bootstrap Orchestrator
    participant CB as Circuit Breaker
    participant Events as Event Stream
    
    Note over UI: Platform admin enters provider details
    UI->>UI: Collect provider information
    Note over UI: Name, admin email, contact info, provider type
    
    UI->>Valid: Validate form data
    Valid->>Valid: Check email format
    Valid->>Valid: Validate organization name uniqueness
    Valid->>Valid: Confirm admin email (double-entry)
    Valid-->>UI: Validation passed
    
    UI->>Saga: orchestrate_organization_bootstrap()
    Note over UI,Saga: type='provider', name, admin_email, slug
    
    Saga->>CB: check_circuit_breaker('zitadel_management_api')
    
    alt Circuit Breaker Open
        CB-->>Saga: state='open'
        Saga->>Events: Emit organization.bootstrap.failed
        Note over Events: failure_stage='zitadel_org_creation'<br/>error='Circuit breaker open'
        Events-->>UI: Bootstrap failed notification
    else Circuit Breaker Closed/Half-Open
        CB-->>Saga: state='closed'
        Saga->>Events: Emit organization.bootstrap.initiated
        Note over Events: Contains bootstrap_id, org_type='provider'
        Events-->>UI: Bootstrap initiated notification
    end
```

### Phase 2: Zitadel Organization Creation

```mermaid
sequenceDiagram
    participant Trigger as Bootstrap Trigger
    participant ZitSvc as Zitadel Service
    participant ZitAPI as Zitadel Management API
    participant CB as Circuit Breaker
    participant Events as Event Stream
    
    Trigger->>ZitSvc: simulate_zitadel_org_creation()
    Note over Trigger,ZitSvc: Triggered by organization.bootstrap.initiated
    
    ZitSvc->>ZitSvc: Extract bootstrap data
    Note over ZitSvc: org_name, admin_email, org_type='provider'
    
    loop Retry Loop (max 3 attempts)
        ZitSvc->>CB: check_circuit_breaker()
        CB-->>ZitSvc: Circuit state
        
        alt Circuit Open
            ZitSvc->>Events: Emit organization.bootstrap.failed
            Note over Events: error='Circuit breaker open'
        else Circuit Closed/Half-Open
            ZitSvc->>ZitAPI: Create Organization
            Note over ZitAPI: POST /management/v1/orgs<br/>name: "ACME Healthcare"
            
            alt Zitadel Org Creation Success
                ZitAPI-->>ZitSvc: organization_id, org_domain
                
                ZitSvc->>ZitAPI: Create Admin User
                Note over ZitAPI: POST /management/v1/users<br/>email: admin@acmehealthcare.com
                
                alt User Creation Success
                    ZitAPI-->>ZitSvc: user_id, invitation_sent
                    ZitSvc->>CB: record_circuit_breaker_success()
                    
                    ZitSvc->>Events: Emit organization.zitadel.created
                    Note over Events: zitadel_org_id, zitadel_user_id<br/>invitation_sent=true
                    
                else User Creation Failure
                    ZitAPI-->>ZitSvc: User creation error
                    ZitSvc->>ZitAPI: Cleanup: Delete organization
                    ZitSvc->>CB: record_circuit_breaker_failure()
                    ZitSvc->>ZitSvc: Continue retry loop
                end
                
            else Org Creation Failure
                ZitAPI-->>ZitSvc: HTTP 5xx or network error
                ZitSvc->>CB: record_circuit_breaker_failure()
                ZitSvc->>ZitSvc: Exponential backoff (1s, 2s, 4s, 8s)
            end
        end
    end
    
    alt Max Retries Exceeded
        ZitSvc->>Events: Emit organization.bootstrap.failed
        Note over Events: failure_stage='zitadel_org_creation'<br/>error='Max retries exceeded'
    end
```

### Phase 3: Organization Creation and Role Assignment

```mermaid
sequenceDiagram
    participant Trigger as Zitadel Success Trigger
    participant Cont as Continue Bootstrap Function
    participant Events as Event Stream
    participant OrgProc as Organization Processor
    participant RoleProc as Role Processor
    participant Proj as Database Projections
    
    Trigger->>Cont: continue_bootstrap_after_zitadel()
    Note over Trigger,Cont: Triggered by organization.zitadel.created
    
    Cont->>Cont: Extract Zitadel creation data
    Note over Cont: zitadel_org_id, zitadel_user_id<br/>bootstrap_id, org_name, org_type
    
    Cont->>Cont: Generate ltree path
    Note over Cont: 'root.org_acme_healthcare'
    
    Cont->>Events: Emit organization.created
    Note over Events: name, type='provider'<br/>path='root.org_acme_healthcare'<br/>zitadel_org_id
    
    Events->>OrgProc: Process organization.created
    OrgProc->>Proj: Insert into organizations_projection
    Note over Proj: id, name, type='provider'<br/>path, zitadel_org_id<br/>is_active=true
    
    Cont->>Events: Emit user.role.assigned
    Note over Events: role='provider_admin'<br/>scope_path='root.org_acme_healthcare'<br/>zitadel_user_id
    
    Events->>RoleProc: Process user.role.assigned
    RoleProc->>Proj: Insert into user_roles_projection
    Note over Proj: user_id, role='provider_admin'<br/>org_id, scope_path
    
    Cont->>Events: Emit organization.bootstrap.completed
    Note over Events: bootstrap_id, organization_id<br/>admin_role='provider_admin'<br/>ltree_path
    
    Events->>OrgProc: Process bootstrap.completed
    OrgProc->>Proj: Update organizations_projection metadata
    Note over Proj: metadata.bootstrap.completed_at<br/>metadata.bootstrap.admin_role
```

### Phase 4: Permission Initialization

```mermaid
sequenceDiagram
    participant RoleProc as Role Event Processor
    participant PermSvc as Permission Service
    participant Events as Event Stream
    participant Proj as Projections
    
    Note over RoleProc: Processing user.role.assigned for provider_admin
    
    RoleProc->>PermSvc: get_role_permissions('provider_admin')
    PermSvc-->>RoleProc: List of permission IDs
    
    loop For each organization-scoped permission
        RoleProc->>Events: Emit permission.granted
        Note over Events: user_id, permission_name<br/>org_scope='provider_org_id'
        
        Events->>Proj: Update user_permissions_projection
        Note over Proj: Effective permissions for user
    end
    
    Note over Proj: Provider admin now has all permissions:<br/>- organization.create_sub<br/>- organization.view<br/>- organization.update<br/>- client.*, medication.*<br/>- access_grant.create<br/>- etc.
```

---

## Provider Organization Structure

### Hierarchical Path Examples

```mermaid
graph TD
    A[root.org_acme_healthcare] --> B[root.org_acme_healthcare.north_campus]
    A --> C[root.org_acme_healthcare.south_campus]
    A --> D[root.org_acme_healthcare.admin_office]
    
    B --> E[root.org_acme_healthcare.north_campus.residential_unit_a]
    B --> F[root.org_acme_healthcare.north_campus.outpatient_clinic]
    
    C --> G[root.org_acme_healthcare.south_campus.residential_unit_b]
    C --> H[root.org_acme_healthcare.south_campus.family_therapy]
    
    style A fill:#e3f2fd
    style B fill:#e8f5e8
    style C fill:#e8f5e8
    style D fill:#fff3e0
```

### Provider Sub-Organization Creation Flow

```mermaid
sequenceDiagram
    participant Admin as Provider Admin
    participant UI as Organization Management UI
    participant Valid as Hierarchy Validator
    participant Events as Event Stream
    participant Proc as Organization Processor
    
    Admin->>UI: Create sub-organization
    Note over Admin,UI: "North Campus" under ACME Healthcare
    
    UI->>Valid: validate_organization_hierarchy()
    Valid->>Valid: Check parent exists and is active
    Valid->>Valid: Verify admin has organization.create_sub permission
    Valid->>Valid: Validate ltree path structure
    Valid-->>UI: Validation passed
    
    UI->>Events: Emit organization.created
    Note over Events: parent_path='root.org_acme_healthcare'<br/>path='root.org_acme_healthcare.north_campus'<br/>type='provider' (inherited)
    
    Events->>Proc: Process organization.created
    Proc->>Proc: Inherit parent organization type
    Note over Proc: type = parent.type ('provider')
    
    Proc->>Proj: Insert sub-organization
    Note over Proc,Proj: Organizations projection updated<br/>Hierarchy maintained via ltree
```

---

## Provider-Specific Features

### Business Profile Creation

```mermaid
sequenceDiagram
    participant Setup as Organization Setup Wizard
    participant Admin as Provider Admin
    participant Events as Event Stream
    participant Proc as Business Profile Processor
    
    Note over Setup: After bootstrap completion
    Setup->>Admin: Collect business profile info
    Note over Admin: Provider type, license info<br/>mailing address, contact details
    
    Admin->>Events: Emit organization.business_profile.created
    Note over Events: organization_type='provider'<br/>provider_profile={license_info, capacity, etc}
    
    Events->>Proc: Process business profile event
    Proc->>Proj: Insert into organization_business_profiles_projection
    Note over Proc,Proj: Only for top-level organization<br/>provider_profile JSONB populated
```

### Cross-Tenant Access Grant Creation

```mermaid
sequenceDiagram
    participant Admin as Provider Admin
    participant UI as Access Management UI
    participant Grant as Grant Service
    participant Events as Event Stream
    
    Note over Admin: VAR partner needs access to data
    Admin->>UI: Create cross-tenant access grant
    Note over UI: consultant_org_id (VAR)<br/>scope, authorization_type='var_contract'
    
    UI->>Grant: validate_cross_tenant_access()
    Grant->>Grant: Check consultant is provider_partner
    Grant->>Grant: Check provider is provider (self)
    Grant-->>UI: Validation passed
    
    UI->>Events: Emit access_grant.created
    Note over Events: consultant_org_id, provider_org_id<br/>legal_reference='VAR Contract #2024-001'
    
    Events->>Grant: Process access grant
    Grant->>Proj: Update cross_tenant_access_grants_projection
    Note over Grant,Proj: Grant active for VAR access
```

---

## Bootstrap Status Monitoring

### Status Dashboard Query

```mermaid
graph TD
    A[Bootstrap Dashboard] --> B[get_bootstrap_status()]
    A --> C[list_bootstrap_processes()]
    
    B --> D{Bootstrap Status}
    D --> E[initiated - Zitadel pending]
    D --> F[processing - Creating organization]
    D --> G[completed - Ready for use]
    D --> H[failed - Needs retry]
    
    C --> I[Recent Bootstrap List]
    I --> J[Provider: ACME Healthcare - Completed]
    I --> K[Provider: Sunshine Youth - Processing]
    I --> L[Provider Partner: XYZ Consulting - Failed]
    
    style G fill:#c8e6c9
    style H fill:#ffcdd2
```

### Manual Retry Process

```mermaid
sequenceDiagram
    participant Admin as Platform Admin
    participant UI as Admin Dashboard
    participant Retry as Retry Service
    participant Events as Event Stream
    
    Admin->>UI: View failed bootstrap
    UI->>UI: Display error details
    Note over UI: failure_stage='zitadel_org_creation'<br/>error='API timeout after retries'
    
    Admin->>Retry: retry_failed_bootstrap(bootstrap_id)
    Retry->>Retry: Generate new bootstrap_id and org_id
    Retry->>Events: Emit organization.bootstrap.initiated
    Note over Events: retry_of=original_bootstrap_id<br/>new bootstrap_id
    
    Events-->>Admin: New bootstrap process started
    Note over Admin: Fresh attempt with circuit breaker reset
```

---

## Integration Points

### Zitadel Management API Endpoints

```mermaid
graph LR
    A[Bootstrap Service] --> B[POST /management/v1/orgs]
    A --> C[POST /management/v1/users]
    A --> D[POST /management/v1/users/{id}/grants]
    
    B --> E[Create Organization]
    C --> F[Create Admin User]
    D --> G[Grant ORG_OWNER Role]
    
    H[API Responses] --> I[organization_id]
    H --> J[user_id]
    H --> K[invitation_link]
    
    style B fill:#e1f5fe
    style C fill:#e8f5e8
    style D fill:#fff3e0
```

### Frontend Integration

```mermaid
graph TD
    A[Provider Management UI] --> B[Bootstrap Form Component]
    A --> C[Bootstrap Status Component]
    A --> D[Bootstrap Dashboard]
    
    B --> E[Form Validation]
    B --> F[Submit Handler]
    B --> G[Progress Indicator]
    
    C --> H[Status Polling]
    C --> I[Error Display]
    C --> J[Retry Button]
    
    D --> K[Bootstrap List]
    D --> L[Filter/Search]
    D --> M[Bulk Operations]
```

---

## Summary

Provider organization bootstrap involves:

1. **Validation**: Email, name uniqueness, circuit breaker check
2. **Zitadel Integration**: Organization and user creation with retry logic
3. **Organization Creation**: Event-driven hierarchy establishment
4. **Role Assignment**: provider_admin with full org-scoped permissions
5. **Business Profile**: Provider-specific metadata collection
6. **Access Management**: Ability to grant cross-tenant access to partners

The process is fully event-driven with comprehensive error handling, audit trails, and manual retry capabilities for maximum reliability.