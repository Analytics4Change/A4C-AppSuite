# Zitadel Bootstrap API Integration Flows

## Overview

Comprehensive documentation of Zitadel Management API integration patterns for organization bootstrap workflows. This covers HTTP API calls, error handling, retry logic, and circuit breaker patterns for reliable organization and user creation.

## Table of Contents

1. [Zitadel Management API Overview](#zitadel-management-api-overview)
2. [Authentication and Authorization](#authentication-and-authorization)
3. [Organization Creation Flow](#organization-creation-flow)
4. [User Creation and Invitation Flow](#user-creation-and-invitation-flow)
5. [Error Handling and Retry Patterns](#error-handling-and-retry-patterns)
6. [Circuit Breaker Implementation](#circuit-breaker-implementation)
7. [Webhook Integration](#webhook-integration)

---

## Zitadel Management API Overview

### API Base Configuration

```mermaid
graph LR
    A[A4C Bootstrap Service] --> B[Zitadel Instance]
    B --> C[analytics4change-zdswvg.us1.zitadel.cloud]
    
    A --> D[Management API]
    D --> E[/management/v1/orgs]
    D --> F[/management/v1/users]
    D --> G[/management/v1/grants]
    
    H[Authentication] --> I[Service Account JWT]
    H --> J[API Key/Secret]
    H --> K[OAuth2 Client Credentials]
    
    style C fill:#e3f2fd
    style E fill:#e8f5e8
    style F fill:#fff3e0
    style G fill:#fce4ec
```

### API Endpoint Mapping

```mermaid
graph TD
    A[Bootstrap Operations] --> B[Create Organization]
    A --> C[Create Admin User]
    A --> D[Assign Roles/Grants]
    A --> E[Send Invitations]
    
    B --> B1[POST /management/v1/orgs]
    C --> C1[POST /management/v1/orgs/{orgId}/users]
    D --> D1[POST /management/v1/users/{userId}/grants]
    E --> E1[POST /management/v1/users/{userId}/email/resend_code]
    
    F[Cleanup Operations] --> G[Delete Organization]
    F --> H[Delete User]
    
    G --> G1[DELETE /management/v1/orgs/{orgId}]
    H --> H1[DELETE /management/v1/users/{userId}]
    
    style B1 fill:#e3f2fd
    style C1 fill:#e8f5e8
    style D1 fill:#fff3e0
    style E1 fill:#fce4ec
    style G1 fill:#ffcdd2
    style H1 fill:#ffcdd2
```

---

## Authentication and Authorization

### Service Account Setup

```mermaid
sequenceDiagram
    participant Setup as Initial Setup
    participant Zit as Zitadel Console
    participant SA as Service Account
    participant API as Management API
    participant Bootstrap as Bootstrap Service
    
    Setup->>Zit: Create service account
    Zit->>SA: Generate service account credentials
    Note over SA: client_id, client_secret<br/>JWT signing key
    
    SA->>Zit: Request management API permissions
    Zit->>SA: Grant org.write, user.write permissions
    
    Bootstrap->>API: Authenticate with service account
    API->>API: Validate JWT token
    API-->>Bootstrap: Access token (30min TTL)
    
    Note over Bootstrap: Cache token, refresh before expiry
```

### API Authentication Flow

```mermaid
graph TD
    A[Bootstrap Request] --> B[Check Token Cache]
    B -->|Valid Token| C[Use Cached Token]
    B -->|Expired/Missing| D[Request New Token]
    
    D --> E[OAuth2 Client Credentials]
    E --> F[POST /oauth/v2/token]
    F --> G{Response}
    
    G -->|Success| H[Cache Access Token]
    G -->|Failure| I[Authentication Error]
    
    H --> C
    C --> J[Call Management API]
    
    I --> K[Emit bootstrap.failed]
    I --> L[Record Circuit Breaker Failure]
    
    style H fill:#c8e6c9
    style I fill:#ffcdd2
    style C fill:#e1f5fe
```

---

## Organization Creation Flow

### Create Organization API Call

```mermaid
sequenceDiagram
    participant Bootstrap as Bootstrap Service
    participant Auth as Auth Service
    participant API as Zitadel API
    participant CB as Circuit Breaker
    participant Events as Event Stream
    
    Bootstrap->>CB: check_circuit_breaker()
    CB-->>Bootstrap: state='closed'
    
    Bootstrap->>Auth: get_access_token()
    Auth-->>Bootstrap: Bearer token
    
    Bootstrap->>API: POST /management/v1/orgs
    Note over API: Request body:<br/>{<br/>  "name": "ACME Healthcare",<br/>  "domain": "acme-healthcare.a4c.app"<br/>}
    
    alt Success Response
        API-->>Bootstrap: 201 Created
        Note over Bootstrap: Response:<br/>{<br/>  "id": "org_12345",<br/>  "name": "ACME Healthcare",<br/>  "domain": "acme-healthcare.a4c.app",<br/>  "state": "active"<br/>}
        
        Bootstrap->>CB: record_circuit_breaker_success()
        Bootstrap->>Events: Continue to user creation
        
    else Client Error (4xx)
        API-->>Bootstrap: 400/409 Error
        Note over Bootstrap: Don't retry on client errors
        Bootstrap->>Events: Emit bootstrap.failed
        
    else Server Error (5xx)
        API-->>Bootstrap: 500/503 Error
        Bootstrap->>CB: record_circuit_breaker_failure()
        Bootstrap->>Bootstrap: Retry with exponential backoff
        
    else Network Error
        API-->>Bootstrap: Timeout/Connection refused
        Bootstrap->>CB: record_circuit_breaker_failure()
        Bootstrap->>Bootstrap: Retry with exponential backoff
    end
```

### Organization Creation Request/Response

```typescript
// Organization Creation Request
interface CreateOrganizationRequest {
  name: string;
  domain?: string;
  admin_email?: string;
  metadata?: {
    a4c_organization_id: string;
    organization_type: 'provider' | 'provider_partner';
    bootstrap_id: string;
  };
}

// Organization Creation Response
interface CreateOrganizationResponse {
  id: string;
  name: string;
  domain: string;
  state: 'active' | 'inactive';
  creation_date: string;
  change_date: string;
  sequence: number;
}
```

### Organization Validation Rules

```mermaid
graph TD
    A[Organization Request] --> B{Validation Checks}
    
    B --> C[Name Uniqueness]
    B --> D[Domain Availability]
    B --> E[Name Format Check]
    B --> F[Metadata Validation]
    
    C -->|Pass| G[Continue Validation]
    C -->|Fail| H[409 Conflict]
    
    D -->|Pass| G
    D -->|Fail| I[400 Bad Request]
    
    E -->|Pass| G
    E -->|Fail| J[400 Invalid Format]
    
    F -->|Pass| K[Create Organization]
    F -->|Fail| L[400 Invalid Metadata]
    
    K --> M[201 Created]
    
    style M fill:#c8e6c9
    style H fill:#ffcdd2
    style I fill:#ffcdd2
    style J fill:#ffcdd2
    style L fill:#ffcdd2
```

---

## User Creation and Invitation Flow

### Admin User Creation Sequence

```mermaid
sequenceDiagram
    participant Bootstrap as Bootstrap Service
    participant OrgAPI as Organization API
    participant UserAPI as User API
    participant GrantAPI as Grant API
    participant Email as Email Service
    participant Events as Event Stream
    
    Note over Bootstrap: Organization created successfully
    
    Bootstrap->>UserAPI: POST /management/v1/orgs/{orgId}/users
    Note over UserAPI: Create admin user in organization
    
    alt User Creation Success
        UserAPI-->>Bootstrap: 201 Created
        Note over Bootstrap: Response:<br/>{<br/>  "userId": "user_67890",<br/>  "state": "active"<br/>}
        
        Bootstrap->>GrantAPI: POST /management/v1/users/{userId}/grants
        Note over GrantAPI: Grant ORG_OWNER role
        
        alt Grant Assignment Success
            GrantAPI-->>Bootstrap: 201 Created
            
            Bootstrap->>Email: POST /management/v1/users/{userId}/email/resend_code
            Note over Email: Send invitation email
            
            Email-->>Bootstrap: 200 OK (invitation sent)
            
            Bootstrap->>Events: Emit organization.zitadel.created
            Note over Events: Success - continue bootstrap
            
        else Grant Assignment Failure
            GrantAPI-->>Bootstrap: Error
            Bootstrap->>UserAPI: DELETE /management/v1/users/{userId}
            Bootstrap->>OrgAPI: DELETE /management/v1/orgs/{orgId}
            Bootstrap->>Events: Emit organization.bootstrap.failed
        end
        
    else User Creation Failure
        UserAPI-->>Bootstrap: Error
        Bootstrap->>OrgAPI: DELETE /management/v1/orgs/{orgId}
        Bootstrap->>Events: Emit organization.bootstrap.failed
    end
```

### User Creation Request/Response

```typescript
// User Creation Request
interface CreateUserRequest {
  user_name: string;
  profile: {
    first_name?: string;
    last_name?: string;
    nick_name?: string;
    display_name?: string;
    preferred_language?: string;
  };
  email: {
    email: string;
    is_email_verified?: boolean;
  };
  metadata?: {
    bootstrap_id: string;
    organization_role: 'provider_admin' | 'partner_admin';
  };
}

// User Creation Response
interface CreateUserResponse {
  user_id: string;
  details: {
    sequence: number;
    creation_date: string;
    change_date: string;
    resource_owner: string;
  };
}
```

### Role Grant Assignment

```mermaid
graph TD
    A[User Created] --> B[Assign Organization Role]
    B --> C{Organization Type}
    
    C -->|provider| D[Grant ORG_OWNER]
    C -->|provider_partner| E[Grant ORG_OWNER]
    
    D --> F[Additional Project Grants]
    E --> F
    
    F --> G[A4C Application Access]
    F --> H[Management Console Access]
    F --> I[Custom Role Assignments]
    
    G --> J[Grant Complete]
    H --> J
    I --> J
    
    J --> K[Send Invitation Email]
    
    style J fill:#c8e6c9
    style K fill:#e1f5fe
```

---

## Error Handling and Retry Patterns

### Exponential Backoff Implementation

```mermaid
graph TD
    A[API Call] --> B{Response Type}
    
    B -->|2xx Success| C[Record Success]
    B -->|4xx Client Error| D[Don't Retry]
    B -->|5xx Server Error| E[Retry Logic]
    B -->|Network Error| E
    
    E --> F{Retry Count}
    F -->|< Max Retries| G[Calculate Backoff]
    F -->|>= Max Retries| H[Max Retries Exceeded]
    
    G --> I[Wait: base_delay * 2^retry_count]
    I --> J[Add Jitter: ±20%]
    J --> K[Sleep]
    K --> L[Increment Retry Count]
    L --> A
    
    C --> M[Continue Bootstrap]
    D --> N[Emit bootstrap.failed]
    H --> N
    
    style C fill:#c8e6c9
    style M fill:#c8e6c9
    style D fill:#ffcdd2
    style H fill:#ffcdd2
    style N fill:#ffcdd2
```

### Retry Configuration

```typescript
interface RetryConfig {
  maxRetries: number;        // 3
  baseDelayMs: number;       // 1000ms
  maxDelayMs: number;        // 8000ms
  jitterPercent: number;     // 20
  retryableStatus: number[]; // [500, 502, 503, 504]
}

// Backoff calculation
function calculateBackoff(retryCount: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, retryCount);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = cappedDelay * (config.jitterPercent / 100);
  const jitterAmount = (Math.random() - 0.5) * 2 * jitter;
  return Math.max(0, cappedDelay + jitterAmount);
}
```

### Error Classification and Handling

```mermaid
graph LR
    A[API Error] --> B{Status Code}
    
    B -->|400| C[Bad Request]
    B -->|401| D[Unauthorized]
    B -->|403| E[Forbidden]
    B -->|404| F[Not Found]
    B -->|409| G[Conflict]
    B -->|429| H[Rate Limited]
    B -->|500| I[Internal Server Error]
    B -->|502| J[Bad Gateway]
    B -->|503| K[Service Unavailable]
    B -->|504| L[Gateway Timeout]
    
    C --> M[Don't Retry - Fix Request]
    D --> N[Don't Retry - Auth Issue]
    E --> N
    F --> M
    G --> M
    H --> O[Retry with Longer Delay]
    I --> P[Retry with Backoff]
    J --> P
    K --> P
    L --> P
    
    style M fill:#ffcdd2
    style N fill:#ffcdd2
    style O fill:#fff3e0
    style P fill:#e1f5fe
```

---

## Circuit Breaker Implementation

### Circuit Breaker State Transitions

```mermaid
stateDiagram-v2
    [*] --> Closed
    
    Closed --> Open : failure_count >= 3
    note right of Open
        All requests rejected
        fast_fail = true
        timeout = 5 minutes
    end note
    
    Open --> HalfOpen : timeout_expired
    note left of HalfOpen
        Limited requests allowed
        test_request = true
    end note
    
    HalfOpen --> Closed : success
    HalfOpen --> Open : failure
    
    Closed --> Closed : success (reset count)
    Closed --> Closed : failure (increment count)
```

### Circuit Breaker Database Schema

```sql
-- Circuit breaker state tracking
CREATE TABLE zitadel_circuit_breaker (
  service_name TEXT PRIMARY KEY DEFAULT 'zitadel_management_api',
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_failure_time TIMESTAMPTZ,
  next_retry_time TIMESTAMPTZ,
  last_success_time TIMESTAMPTZ,
  total_requests INTEGER DEFAULT 0,
  total_successes INTEGER DEFAULT 0,
  total_failures INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Circuit Breaker Decision Logic

```mermaid
graph TD
    A[API Request] --> B[Check Circuit Breaker]
    B --> C{Circuit State}
    
    C -->|Closed| D[Allow Request]
    C -->|Open| E{Timeout Expired?}
    C -->|Half-Open| F[Allow Limited Request]
    
    E -->|No| G[Reject - Fast Fail]
    E -->|Yes| H[Transition to Half-Open]
    H --> F
    
    D --> I[Execute Request]
    F --> I
    
    I --> J{Request Result}
    J -->|Success| K[Record Success]
    J -->|Failure| L[Record Failure]
    
    K --> M{State}
    M -->|Half-Open| N[Transition to Closed]
    M -->|Closed| O[Reset Failure Count]
    
    L --> P{Failure Count}
    P -->|< Threshold| Q[Increment Count]
    P -->|>= Threshold| R[Transition to Open]
    
    G --> S[Emit bootstrap.failed]
    
    style K fill:#c8e6c9
    style L fill:#ffcdd2
    style G fill:#ffcdd2
    style S fill:#ffcdd2
```

---

## Webhook Integration

### Zitadel to A4C Event Flow

```mermaid
sequenceDiagram
    participant Zit as Zitadel
    participant Webhook as Webhook Endpoint
    participant Valid as Webhook Validator
    participant Events as Event Stream
    participant Bootstrap as Bootstrap Process
    
    Zit->>Webhook: POST /webhooks/zitadel/events
    Note over Webhook: Event: user.added, org.changed, etc.
    
    Webhook->>Valid: Validate webhook signature
    Valid->>Valid: Verify JWT signature
    Valid->>Valid: Check timestamp freshness
    Valid-->>Webhook: Signature valid
    
    Webhook->>Events: Transform to A4C event format
    Note over Events: Map Zitadel events to organization.* events
    
    alt Organization Event
        Events->>Bootstrap: Trigger bootstrap continuation
        Bootstrap->>Bootstrap: Process next bootstrap step
    else User Event
        Events->>Events: Update user projections
    else Other Events
        Events->>Events: Log for audit
    end
```

### Webhook Payload Processing

```typescript
interface ZitadelWebhookPayload {
  eventType: string;
  resourceOwner: string;
  aggregateId: string;
  aggregateType: string;
  sequence: number;
  creationDate: string;
  payload: {
    orgId?: string;
    userId?: string;
    email?: string;
    state?: string;
    [key: string]: any;
  };
}

// Webhook event mapping
const eventMapping = {
  'org.added': 'organization.zitadel.created',
  'user.added': 'user.zitadel.created',
  'user.deactivated': 'user.zitadel.deactivated',
  'org.removed': 'organization.zitadel.deleted'
};
```

### Webhook Security and Validation

```mermaid
graph TD
    A[Incoming Webhook] --> B[Extract JWT Token]
    B --> C[Verify Signature]
    C --> D{Signature Valid?}
    
    D -->|No| E[Reject Request]
    D -->|Yes| F[Check Timestamp]
    
    F --> G{Within Time Window?}
    G -->|No| H[Reject - Replay Attack]
    G -->|Yes| I[Validate Event Structure]
    
    I --> J{Valid Structure?}
    J -->|No| K[Reject - Malformed]
    J -->|Yes| L[Process Event]
    
    E --> M[Log Security Violation]
    H --> M
    K --> M
    
    L --> N[Transform to A4C Event]
    N --> O[Emit to Event Stream]
    
    style E fill:#ffcdd2
    style H fill:#ffcdd2
    style K fill:#ffcdd2
    style M fill:#ffcdd2
    style L fill:#c8e6c9
    style O fill:#c8e6c9
```

---

## Monitoring and Observability

### API Metrics Collection

```mermaid
graph TD
    A[Zitadel API Calls] --> B[Metrics Collector]
    B --> C[Request Count]
    B --> D[Response Time]
    B --> E[Error Rate]
    B --> F[Circuit Breaker State]
    
    C --> G[Total Requests]
    C --> H[Requests by Endpoint]
    C --> I[Requests by Status Code]
    
    D --> J[Average Response Time]
    D --> K[95th Percentile]
    D --> L[99th Percentile]
    
    E --> M[Error Count]
    E --> N[Error Rate %]
    E --> O[Errors by Type]
    
    F --> P[State Changes]
    F --> Q[Time in Each State]
    F --> R[Failure Count]
    
    style G fill:#e1f5fe
    style H fill:#e1f5fe
    style I fill:#e1f5fe
    style J fill:#e8f5e8
    style K fill:#e8f5e8
    style L fill:#e8f5e8
    style M fill:#ffcdd2
    style N fill:#ffcdd2
    style O fill:#ffcdd2
```

### Bootstrap Success/Failure Tracking

```mermaid
graph LR
    A[Bootstrap Metrics] --> B[Success Rate]
    A --> C[Average Duration]
    A --> D[Failure Reasons]
    A --> E[Retry Statistics]
    
    B --> F[Daily Success %]
    B --> G[Weekly Trends]
    
    C --> H[End-to-End Time]
    C --> I[Time by Stage]
    
    D --> J[Zitadel API Failures]
    D --> K[Network Issues]
    D --> L[Validation Errors]
    
    E --> M[Retry Attempts per Bootstrap]
    E --> N[Recovery Success Rate]
    
    style F fill:#c8e6c9
    style G fill:#c8e6c9
    style H fill:#e1f5fe
    style I fill:#e1f5fe
```

---

## Summary

The Zitadel bootstrap API integration provides:

1. **Reliable Organization Creation**: With comprehensive error handling and retry logic
2. **Circuit Breaker Protection**: Prevents cascading failures when Zitadel is unavailable
3. **Comprehensive Audit Trail**: Every API call and response logged for compliance
4. **Webhook Integration**: Real-time synchronization of Zitadel state changes
5. **Monitoring and Alerting**: Full observability into bootstrap success/failure rates

The integration is designed for production reliability with proper error recovery, rate limiting protection, and comprehensive logging for healthcare compliance requirements.