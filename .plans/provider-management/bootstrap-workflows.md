# Organization Bootstrap Workflows

## Overview

This document provides comprehensive Mermaid diagrams documenting the event-driven organization bootstrap processes for the A4C platform. Bootstrap workflows enable platform_owner users to create new provider and provider_partner organizations with proper Zitadel integration, role assignment, and audit trails.

## Table of Contents

1. [High-Level Bootstrap Flow](#high-level-bootstrap-flow)
2. [Provider Organization Bootstrap](#provider-organization-bootstrap)
3. [Provider Partner Bootstrap](#provider-partner-bootstrap)
4. [Error Handling and Compensation](#error-handling-and-compensation)
5. [Circuit Breaker States](#circuit-breaker-states)
6. [Cross-Tenant Access Grant Flow](#cross-tenant-access-grant-flow)

---

## High-Level Bootstrap Flow

```mermaid
graph TD
    A[Platform Admin] --> B[Bootstrap UI]
    B --> C{Organization Type}
    C -->|provider| D[Provider Bootstrap Flow]
    C -->|provider_partner| E[Provider Partner Bootstrap Flow]
    
    D --> F[Emit organization.bootstrap.initiated]
    E --> F
    
    F --> G[Check Circuit Breaker]
    G -->|Open| H[Emit organization.bootstrap.failed]
    G -->|Closed/Half-Open| I[Call Zitadel API]
    
    I -->|Success| J[Emit organization.zitadel.created]
    I -->|Failure| K[Retry with Exponential Backoff]
    
    K -->|Max Retries| H
    K -->|Retry Success| J
    
    J --> L[Emit organization.created]
    L --> M[Emit user.role.assigned]
    M --> N[Emit organization.bootstrap.completed]
    
    H --> O[Emit organization.bootstrap.cancelled]
    
    N --> P[Bootstrap Complete]
    O --> Q[Bootstrap Failed/Cancelled]
    
    style F fill:#e1f5fe
    style J fill:#e8f5e8
    style H fill:#ffebee
    style N fill:#e8f5e8
    style O fill:#ffebee
```

---

## Provider Organization Bootstrap

### Detailed Provider Bootstrap Sequence

```mermaid
sequenceDiagram
    participant Admin as Platform Admin
    participant UI as Bootstrap UI
    participant Saga as Bootstrap Orchestrator
    participant CB as Circuit Breaker
    participant ZIT as Zitadel API
    participant EP as Event Processor
    participant DB as Organizations Projection
    
    Admin->>UI: Enter provider details
    Note over Admin,UI: Name, admin email, contact info
    
    UI->>Saga: orchestrate_organization_bootstrap()
    Note over UI,Saga: provider type, email validation
    
    Saga->>CB: check_circuit_breaker()
    CB-->>Saga: state: closed
    
    Saga->>EP: Emit organization.bootstrap.initiated
    Note over Saga,EP: Contains: bootstrap_id, org_type=provider, name, admin_email
    
    EP->>ZIT: simulate_zitadel_org_creation()
    Note over EP,ZIT: Retry loop with exponential backoff
    
    ZIT->>ZIT: Create Zitadel organization
    ZIT->>ZIT: Create admin user
    ZIT->>ZIT: Send invitation email
    
    alt Zitadel Success
        ZIT-->>EP: Success response
        EP->>EP: record_circuit_breaker_success()
        EP->>EP: Emit organization.zitadel.created
        Note over EP: Contains: zitadel_org_id, zitadel_user_id
        
        EP->>EP: continue_bootstrap_after_zitadel()
        EP->>EP: Emit organization.created
        Note over EP: ltree path: root.org_provider_name
        
        EP->>EP: Emit user.role.assigned
        Note over EP: Role: provider_admin, Scope: org root
        
        EP->>EP: Emit organization.bootstrap.completed
        
        EP->>DB: Update organizations_projection
        Note over EP,DB: Via organization event processor
        
    else Zitadel Failure
        ZIT-->>EP: API failure
        EP->>EP: record_circuit_breaker_failure()
        EP->>ZIT: Retry with delay (1s, 2s, 4s, 8s)
        
        alt Max Retries Exceeded
            EP->>EP: Emit organization.bootstrap.failed
            EP->>EP: Emit organization.bootstrap.cancelled
        end
    end
    
    EP-->>Admin: Bootstrap status update
    Note over EP,Admin: Via UI polling or WebSocket
```

### Provider Bootstrap Event Flow

```mermaid
stateDiagram-v2
    [*] --> Initiated
    
    Initiated --> ZitadelPending : organization.bootstrap.initiated
    note right of ZitadelPending
        Circuit breaker check
        Zitadel API calls with retry
    end note
    
    ZitadelPending --> OrganizationCreation : organization.zitadel.created
    ZitadelPending --> Failed : organization.bootstrap.failed
    
    OrganizationCreation --> RoleAssignment : organization.created
    note right of RoleAssignment
        Assign provider_admin role
        Grant org-scoped permissions
    end note
    
    RoleAssignment --> Completed : user.role.assigned
    
    Completed --> [*] : organization.bootstrap.completed
    
    Failed --> Cancelled : organization.bootstrap.cancelled
    Cancelled --> [*]
    
    Failed --> Initiated : retry_failed_bootstrap()
    note left of Failed
        Manual retry with new IDs
        Cleanup partial resources
    end note
```

---

## Provider Partner Bootstrap

### Provider Partner Bootstrap Sequence

```mermaid
sequenceDiagram
    participant Admin as Platform Admin
    participant UI as Bootstrap UI
    participant Saga as Bootstrap Orchestrator
    participant EP as Event Processor
    participant ZIT as Zitadel API
    participant Grant as Access Grant Service
    
    Admin->>UI: Enter provider_partner details
    Note over Admin,UI: VAR info, court system, family org
    
    UI->>Saga: orchestrate_organization_bootstrap()
    Note over UI,Saga: type=provider_partner
    
    Saga->>EP: Emit organization.bootstrap.initiated
    
    EP->>ZIT: Create Zitadel organization
    ZIT-->>EP: Success (zitadel_org_id, user_id)
    
    EP->>EP: Emit organization.zitadel.created
    EP->>EP: Emit organization.created
    Note over EP: ltree path: root.org_partner_name
    
    EP->>EP: Emit user.role.assigned
    Note over EP: Role: partner_admin
    
    EP->>EP: Emit organization.bootstrap.completed
    
    Note over Admin,Grant: Later: Cross-tenant access grants created separately
    Admin->>Grant: Create access grants to provider data
    Grant->>EP: Emit access_grant.created
    
    EP-->>Admin: Partner organization ready
```

### Provider Partner Organization Types

```mermaid
graph TD
    A[provider_partner Organizations] --> B[VAR Partners]
    A --> C[Court Systems]
    A --> D[Social Services]
    A --> E[Family Organizations]
    
    B --> B1[Value-Added Resellers]
    B --> B2[Consulting Partners]
    B --> B3[Support Organizations]
    
    C --> C1[Juvenile Courts]
    C --> C2[Family Courts]
    C --> C3[Guardian ad Litem]
    
    D --> D1[Child Services]
    D --> D2[Case Managers]
    D --> D3[Social Workers]
    
    E --> E1[Parent/Guardian Access]
    E --> E2[Family Member Access]
    E --> E3[Shared Family Org]
    
    style B fill:#e3f2fd
    style C fill:#fff3e0
    style D fill:#e8f5e8
    style E fill:#fce4ec
```

---

## Error Handling and Compensation

### Failure Scenarios and Recovery

```mermaid
graph TD
    A[Bootstrap Initiated] --> B{Circuit Breaker Check}
    B -->|Open| C[Immediate Failure]
    B -->|Closed| D[Zitadel API Call]
    
    D --> E{API Response}
    E -->|Success| F[Continue Bootstrap]
    E -->|Failure| G[Retry Logic]
    
    G --> H{Retry Count}
    H -->|< Max Retries| I[Exponential Backoff]
    H -->|>= Max Retries| J[Bootstrap Failed]
    
    I --> K[Wait: 1s, 2s, 4s, 8s]
    K --> D
    
    C --> L[Emit bootstrap.failed]
    J --> L
    
    L --> M{Partial Resources?}
    M -->|Yes| N[Emit bootstrap.cancelled]
    M -->|No| O[End - No Cleanup Needed]
    
    N --> P[Cleanup Partial Resources]
    P --> Q[Cleanup Completed]
    
    L --> R[Manual Retry Available]
    R --> S[retry_failed_bootstrap()]
    S --> A
    
    style C fill:#ffcdd2
    style J fill:#ffcdd2
    style L fill:#ffcdd2
    style F fill:#c8e6c9
    style Q fill:#c8e6c9
```

### Compensation Events

```mermaid
sequenceDiagram
    participant Saga as Bootstrap Saga
    participant ZIT as Zitadel API
    participant Events as Event Stream
    participant Cleanup as Cleanup Service
    
    Saga->>ZIT: Create organization
    ZIT-->>Saga: Success (org created)
    
    Saga->>ZIT: Create admin user
    ZIT-->>Saga: Failure (user creation failed)
    
    Note over Saga: Partial state - org exists, user doesn't
    
    Saga->>Events: Emit organization.bootstrap.failed
    Note over Events: partial_cleanup_required: true
    
    Events->>Cleanup: Trigger compensation
    
    Cleanup->>ZIT: Delete partial organization
    ZIT-->>Cleanup: Organization deleted
    
    Cleanup->>Events: Emit organization.bootstrap.cancelled
    Note over Events: cleanup_completed: true, cleanup_actions: ['deleted_zitadel_organization']
```

---

## Circuit Breaker States

### Circuit Breaker State Machine

```mermaid
stateDiagram-v2
    [*] --> Closed
    
    Closed --> Open : Failure count >= threshold (3)
    note right of Open
        All requests rejected
        Timeout: 5 minutes
    end note
    
    Open --> HalfOpen : Timeout expired
    note right of HalfOpen
        Limited requests allowed
        Test if service recovered
    end note
    
    HalfOpen --> Closed : Success
    HalfOpen --> Open : Failure
    
    Closed --> Closed : Success (reset failure count)
    Closed --> Closed : Failure (increment count)
```

### Circuit Breaker Configuration

```mermaid
graph LR
    A[Circuit Breaker Config] --> B[Failure Threshold: 3]
    A --> C[Timeout: 5 minutes]
    A --> D[Retry Delay: 30 seconds]
    A --> E[Service: Zitadel Management API]
    
    F[Failure Types] --> G[HTTP 5xx Errors]
    F --> H[Network Timeouts]
    F --> I[Connection Refused]
    
    J[Success Criteria] --> K[HTTP 2xx Responses]
    J --> L[Valid JSON Response]
    J --> M[Organization Created]
    
    style B fill:#ffcdd2
    style C fill:#fff3e0
    style D fill:#e1f5fe
```

---

## Cross-Tenant Access Grant Flow

### Access Grant Creation for Provider Partners

```mermaid
sequenceDiagram
    participant Admin as Provider Admin
    participant UI as Grant Management UI
    participant Validate as Grant Validator
    participant Events as Event Stream
    participant Proj as Access Grants Projection
    participant RLS as Row Level Security
    
    Admin->>UI: Create cross-tenant grant
    Note over Admin,UI: VAR needs access to provider data
    
    UI->>Validate: validate_cross_tenant_access()
    Note over UI,Validate: Check: consultant=provider_partner, provider=provider
    
    Validate-->>UI: Validation passed
    
    UI->>Events: Emit access_grant.created
    Note over UI,Events: consultant_org_id, provider_org_id, scope, legal_basis
    
    Events->>Proj: Update access grants projection
    Note over Events,Proj: Via access grant event processor
    
    Note over Proj,RLS: Grant now active for authorization checks
    
    Admin->>UI: Later: Monitor grant usage
    UI->>Proj: Query active grants
    Proj-->>UI: Grant details with audit trail
```

### Access Grant Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active
    
    Active --> Suspended : access_grant.suspended
    note right of Suspended
        Temporary hold
        Investigation, dispute
    end note
    
    Suspended --> Active : access_grant.reactivated
    Suspended --> Revoked : access_grant.revoked
    
    Active --> Expired : access_grant.expired
    note right of Expired
        Time-based expiration
        Contract end date
    end note
    
    Active --> Revoked : access_grant.revoked
    note right of Revoked
        Permanent termination
        Security breach, request
    end note
    
    Expired --> [*]
    Revoked --> [*]
```

### Grant Authorization Check Flow

```mermaid
graph TD
    A[Provider Partner Request] --> B[Extract org_id and user_id]
    B --> C[Query access_grants_projection]
    
    C --> D{Grant Exists?}
    D -->|No| E[Access Denied]
    D -->|Yes| F{Grant Active?}
    
    F -->|No| E
    F -->|Yes| G{Grant Expired?}
    
    G -->|Yes| E
    G -->|No| H{User Authorized?}
    
    H -->|No| E
    H -->|Yes| I{Scope Check}
    
    I -->|Pass| J[Access Granted]
    I -->|Fail| E
    
    J --> K[Log Access Event]
    E --> L[Log Denial Event]
    
    style J fill:#c8e6c9
    style E fill:#ffcdd2
    style K fill:#e1f5fe
    style L fill:#fff3e0
```

---

## Summary

This documentation provides comprehensive workflow diagrams for:

- **Bootstrap Orchestration**: Event-driven organization creation with Zitadel integration
- **Error Resilience**: Circuit breaker patterns and compensation event handling  
- **Cross-Tenant Access**: provider_partner access to provider data with full audit trails
- **CQRS Compliance**: All operations via events, projections never directly updated

The workflows ensure reliable organization bootstrap with proper error handling, retry logic, and comprehensive audit trails suitable for healthcare compliance requirements.