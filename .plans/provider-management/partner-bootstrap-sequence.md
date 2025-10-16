# Provider Partner Bootstrap Sequence

## Overview

Detailed sequence documentation for bootstrapping `type=provider_partner` organizations in the A4C platform. Provider partners include VAR organizations, court systems, social services, and family access organizations that need cross-tenant access to provider data.

## Provider Partner Characteristics

- **Organization Type**: `provider_partner`
- **Initial Role**: `partner_admin`
- **Permissions**: Partner-relevant permissions within their organization scope
- **Cross-Tenant Access**: Requires explicit grants to access provider data
- **Partner Types**: VAR, court systems, social services, family organizations

---

## Provider Partner Types and Use Cases

### Partner Organization Categories

```mermaid
graph TD
    A[provider_partner Organizations] --> B[VAR Partners]
    A --> C[Court Systems]  
    A --> D[Social Services]
    A --> E[Family Organizations]
    
    B --> B1[Value-Added Resellers]
    B --> B2[Consulting Partners]
    B --> B3[Support Organizations]
    B --> B4[Implementation Partners]
    
    C --> C1[Juvenile Courts]
    C --> C2[Family Courts]
    C --> C3[Guardian ad Litem]
    C --> C4[Court Administrators]
    
    D --> D1[Child Protective Services]
    D --> D2[Case Managers]
    D --> D3[Social Workers]
    D --> D4[Government Agencies]
    
    E --> E1[Parent/Guardian Access]
    E --> E2[Family Member Portal]
    E --> E3[Shared Family Organizations]
    E --> E4[Emergency Contacts]
    
    style B fill:#e3f2fd
    style C fill:#fff3e0
    style D fill:#e8f5e8
    style E fill:#fce4ec
```

### Business Profile Requirements by Type

```mermaid
graph LR
    A[Partner Type] --> B{VAR Partner}
    A --> C{Court System}
    A --> D{Social Services}
    A --> E{Family Org}
    
    B --> F[Partner Profile]
    F --> F1[Services Offered]
    F --> F2[Client References] 
    F --> F3[Certifications]
    F --> F4[Revenue Share Terms]
    
    C --> G[Legal Profile]
    G --> G1[Jurisdiction]
    G --> G2[Court Authority]
    G --> G3[Legal Contact Info]
    G --> G4[Case Management System]
    
    D --> H[Agency Profile]
    H --> H1[Agency Type]
    H --> H2[Service Area]
    H --> H3[Contact Personnel]
    H --> H4[Case Load Capacity]
    
    E --> I[Family Profile]
    I --> I1[Family Members]
    I --> I2[Emergency Contacts]
    I --> I3[Relationship Types]
    I --> I4[Notification Preferences]
```

---

## Detailed Partner Bootstrap Flow

### Phase 1: Partner Type Selection and Validation

```mermaid
sequenceDiagram
    participant Admin as Platform Admin
    participant UI as Partner Creation UI
    participant TypeSel as Partner Type Selector
    participant Valid as Form Validator
    participant Saga as Bootstrap Orchestrator
    
    Admin->>UI: Create new provider partner
    UI->>TypeSel: Select partner type
    
    alt VAR Partner
        TypeSel->>UI: Show VAR-specific fields
        Note over UI: Company info, services, certifications
    else Court System
        TypeSel->>UI: Show court-specific fields
        Note over UI: Jurisdiction, authority, legal contacts
    else Social Services
        TypeSel->>UI: Show agency-specific fields
        Note over UI: Agency type, service area, personnel
    else Family Organization
        TypeSel->>UI: Show family-specific fields
        Note over UI: Family members, relationships, contacts
    end
    
    UI->>Valid: Validate partner data
    Valid->>Valid: Check email format and uniqueness
    Valid->>Valid: Validate partner-specific requirements
    Valid->>Valid: Confirm authorization documentation
    Valid-->>UI: Validation passed
    
    UI->>Saga: orchestrate_organization_bootstrap()
    Note over UI,Saga: type='provider_partner'<br/>partner_subtype, business_info
    
    Saga->>Events: Emit organization.bootstrap.initiated
    Note over Events: Contains partner type and subtype info
```

### Phase 2: Zitadel Organization Creation (Same as Provider)

```mermaid
sequenceDiagram
    participant Trigger as Bootstrap Trigger
    participant ZitSvc as Zitadel Service
    participant ZitAPI as Zitadel Management API
    participant Events as Event Stream
    
    Note over Trigger,Events: Same flow as provider bootstrap
    
    Trigger->>ZitSvc: simulate_zitadel_org_creation()
    ZitSvc->>ZitAPI: Create Organization
    Note over ZitAPI: name: "XYZ Consulting Partners"
    
    ZitAPI-->>ZitSvc: zitadel_org_id
    
    ZitSvc->>ZitAPI: Create Admin User  
    Note over ZitAPI: email: admin@xyzconsulting.com
    
    ZitAPI-->>ZitSvc: zitadel_user_id, invitation_sent
    
    ZitSvc->>Events: Emit organization.zitadel.created
    Note over Events: Same structure as provider<br/>but type='provider_partner'
```

### Phase 3: Partner Organization Creation and Role Assignment

```mermaid
sequenceDiagram
    participant Cont as Continue Bootstrap
    participant Events as Event Stream
    participant OrgProc as Organization Processor
    participant RoleProc as Role Processor
    participant Proj as Database Projections
    
    Cont->>Cont: Generate partner ltree path
    Note over Cont: 'root.org_xyz_consulting'<br/>(Same pattern as provider)
    
    Cont->>Events: Emit organization.created
    Note over Events: type='provider_partner'<br/>path='root.org_xyz_consulting'
    
    Events->>OrgProc: Process organization.created
    OrgProc->>Proj: Insert into organizations_projection
    Note over Proj: type='provider_partner'<br/>is_active=true
    
    Cont->>Events: Emit user.role.assigned
    Note over Events: role='partner_admin'<br/>scope_path='root.org_xyz_consulting'
    
    Events->>RoleProc: Process user.role.assigned
    RoleProc->>Proj: Insert into user_roles_projection
    Note over Proj: role='partner_admin'<br/>partner-scoped permissions
    
    Cont->>Events: Emit organization.bootstrap.completed
    Note over Events: admin_role='partner_admin'
```

### Phase 4: Business Profile Creation

```mermaid
sequenceDiagram
    participant Setup as Partner Setup Wizard
    participant Admin as Partner Admin
    participant Events as Event Stream
    participant Proc as Business Profile Processor
    participant Proj as Business Profiles Projection
    
    Setup->>Admin: Collect partner business profile
    Note over Admin: Type-specific profile information
    
    alt VAR Partner Profile
        Admin->>Admin: Enter services offered, certifications
        Admin->>Admin: Revenue share terms, client references
    else Court System Profile  
        Admin->>Admin: Enter jurisdiction, court authority
        Admin->>Admin: Legal contact info, case system details
    else Social Services Profile
        Admin->>Admin: Enter agency type, service area
        Admin->>Admin: Contact personnel, case load info
    else Family Profile
        Admin->>Admin: Enter family member details
        Admin->>Admin: Relationships, emergency contacts
    end
    
    Admin->>Events: Emit organization.business_profile.created
    Note over Events: organization_type='provider_partner'<br/>partner_profile={type-specific data}
    
    Events->>Proc: Process business profile
    Proc->>Proj: Insert into organization_business_profiles_projection
    Note over Proc,Proj: partner_profile JSONB populated<br/>provider_profile remains NULL
```

---

## Partner-Specific Permission Sets

### Partner Admin Role Permissions

```mermaid
graph TD
    A[partner_admin Role] --> B[Organization Management]
    A --> C[User Management] 
    A --> D[Access Request Management]
    A --> E[Profile Management]
    
    B --> B1[organization.view]
    B --> B2[organization.update]
    B --> B3[organization.create_sub]
    
    C --> C1[user.create]
    C --> C2[user.view]
    C --> C3[user.update]
    C --> C4[user.assign_role]
    
    D --> D1[access_grant.view]
    D --> D2[access_grant.request]
    D --> D3[cross_tenant.view_granted]
    
    E --> E1[organization.business_profile_update]
    E --> E2[profile.manage]
    E --> E3[contact.update]
    
    style A fill:#e3f2fd
    style B fill:#e8f5e8
    style C fill:#fff3e0
    style D fill:#fce4ec
    style E fill:#f3e5f5
```

### Permission Differences from Provider Admin

```mermaid
graph LR
    A[provider_admin] --> B[Has All Provider Permissions]
    B --> B1[client.* within org]
    B --> B2[medication.* within org]
    B --> B3[access_grant.create]
    B --> B4[organization.deactivate]
    
    C[partner_admin] --> D[Has Limited Partner Permissions]
    D --> D1[NO client.* permissions]
    D --> D2[NO medication.* permissions]
    D --> D3[access_grant.request only]
    D --> D4[NO organization.deactivate]
    
    E[Cross-Tenant Access] --> F[Via Explicit Grants Only]
    F --> F1[access_grant.created events]
    F --> F2[Must be approved by provider]
    F --> F3[Time-limited and scoped]
    
    style B1 fill:#ffcdd2
    style B2 fill:#ffcdd2
    style D1 fill:#c8e6c9
    style D2 fill:#c8e6c9
```

---

## Cross-Tenant Access Request Flow

### Access Grant Request Process

```mermaid
sequenceDiagram
    participant Partner as Partner Admin
    participant UI as Access Request UI
    participant Workflow as Grant Workflow
    participant Provider as Provider Admin
    participant Events as Event Stream
    participant Grants as Access Grants Projection
    
    Partner->>UI: Request access to provider data
    Note over Partner,UI: Select provider, scope, justification
    
    UI->>Workflow: Submit access request
    Note over Workflow: Validate request, legal basis
    
    Workflow->>Provider: Notify of access request
    Note over Provider: Email + dashboard notification
    
    Provider->>Provider: Review request details
    Note over Provider: Legal basis, scope, partner info
    
    alt Request Approved
        Provider->>Events: Emit access_grant.created
        Note over Events: consultant_org_id=partner<br/>provider_org_id=provider<br/>authorization_type, scope
        
        Events->>Grants: Update access grants projection
        Grants-->>Partner: Access granted notification
        
    else Request Denied
        Provider->>Workflow: Deny request with reason
        Workflow-->>Partner: Access denied notification
    end
```

### VAR Partner Access Pattern

```mermaid
sequenceDiagram
    participant VAR as VAR Partner Admin
    participant Multi as Multi-Provider Dashboard
    participant Grant1 as Provider A Grant
    participant Grant2 as Provider B Grant
    participant Data as Provider Data Access
    
    Note over VAR: VAR manages multiple provider customers
    
    VAR->>Multi: View all granted provider access
    Multi->>Grant1: Query active grants for Provider A
    Multi->>Grant2: Query active grants for Provider B
    
    Grant1-->>Multi: Full org access, expires 2024-12-31
    Grant2-->>Multi: Facility-scoped, expires 2025-06-30
    
    VAR->>Data: Access Provider A data
    Data->>Data: Check cross_tenant_access_grants_projection
    Data-->>VAR: Grant reports, dashboards, client summaries
    
    VAR->>Data: Access Provider B data  
    Data->>Data: Check grant scope (facility only)
    Data-->>VAR: Limited facility data only
```

---

## Partner Type-Specific Workflows

### Court System Access Workflow

```mermaid
sequenceDiagram
    participant Court as Court Administrator
    participant Case as Case Management System
    participant Legal as Legal Authorization
    participant Provider as Healthcare Provider
    participant Access as Data Access
    
    Court->>Case: Court order issued for youth case
    Case->>Legal: Generate legal authorization document
    Legal->>Provider: Submit court order for data access
    
    Provider->>Provider: Verify court order authenticity
    Provider->>Provider: Determine data scope from order
    
    Provider->>Access: Grant court access
    Note over Access: authorization_type='court_order'<br/>legal_reference='Case #2024-JV-1234'<br/>scope='client_specific'
    
    Court->>Access: Access youth case data
    Access->>Access: Validate court order not expired
    Access-->>Court: Provide authorized case information
```

### Social Services Access Pattern

```mermaid
sequenceDiagram
    participant CPS as Child Protective Services
    participant Worker as Case Worker
    participant Provider as Healthcare Provider
    participant Client as Youth Client Data
    
    CPS->>Worker: Assign case worker to youth
    Worker->>Provider: Request access to youth records
    Note over Worker,Provider: Social services assignment document
    
    Provider->>Provider: Verify worker credentials
    Provider->>Provider: Confirm case assignment
    
    Provider->>Client: Grant case worker access
    Note over Client: authorization_type='social_services_assignment'<br/>scope='client_specific'<br/>time-limited access
    
    Worker->>Client: Access youth case information
    Client-->>Worker: Medical history, treatment plans, progress notes
```

### Family Access Workflow

```mermaid
sequenceDiagram
    participant Parent as Parent/Guardian
    participant Family as Family Organization
    participant Consent as Consent Management
    participant Provider as Healthcare Provider
    participant Youth as Youth Records
    
    Parent->>Family: Join shared family organization
    Family->>Consent: Submit parental consent forms
    Consent->>Provider: Request family access approval
    
    Provider->>Provider: Verify parental authority
    Provider->>Provider: Check youth consent (if age appropriate)
    
    alt Consent Granted
        Provider->>Youth: Grant family access
        Note over Youth: authorization_type='parental_consent'<br/>scope='client_specific'<br/>limited medical info
        
        Parent->>Youth: View allowed information
        Youth-->>Parent: Basic health status, appointment schedules
        
    else Consent Denied
        Provider->>Consent: Deny access request
        Consent-->>Parent: Access denied with explanation
    end
```

---

## Partner Dashboard and Monitoring

### VAR Partner Multi-Provider Dashboard

```mermaid
graph TD
    A[VAR Partner Dashboard] --> B[Provider Portfolio]
    A --> C[Access Grant Status]
    A --> D[Revenue Metrics]
    A --> E[Support Tickets]
    
    B --> B1[Provider A - Active]
    B --> B2[Provider B - Active] 
    B --> B3[Provider C - Pending Setup]
    
    C --> C1[12 Active Grants]
    C --> C2[3 Expiring Soon]
    C --> C3[1 Suspended]
    
    D --> D1[Monthly Revenue]
    D --> D2[YTD Performance]
    D --> D3[Commission Tracking]
    
    E --> E1[Open Tickets: 5]
    E --> E2[Resolved This Month: 23]
    E --> E3[SLA Performance: 94%]
    
    style B1 fill:#c8e6c9
    style B2 fill:#c8e6c9
    style B3 fill:#fff3e0
    style C3 fill:#ffcdd2
```

### Partner Access Audit Trail

```mermaid
sequenceDiagram
    participant Audit as Audit System
    participant Partner as Partner Organization
    participant Access as Data Access Events
    participant Compliance as Compliance Report
    
    Partner->>Access: Access provider data
    Access->>Audit: Log access event
    Note over Audit: timestamp, partner_id, provider_id<br/>data_accessed, legal_basis
    
    Access->>Access: Record data export
    Access->>Audit: Log export event
    Note over Audit: export_format, data_scope<br/>retention_compliance
    
    Audit->>Compliance: Generate access report
    Note over Compliance: Who accessed what data when<br/>Legal basis for each access<br/>Data retention compliance
    
    Compliance-->>Provider: Monthly access summary
    Compliance-->>Partner: Usage and compliance report
```

---

## Integration and API Access

### Partner API Endpoints

```mermaid
graph LR
    A[Partner API] --> B[/api/partner/dashboard]
    A --> C[/api/partner/access-grants]
    A --> D[/api/partner/providers]
    A --> E[/api/partner/requests]
    
    B --> F[Get portfolio summary]
    C --> G[List active grants]
    C --> H[Request new access]
    C --> I[View grant details]
    
    D --> J[List accessible providers]
    D --> K[Get provider profiles]
    
    E --> L[Submit access request]
    E --> M[Track request status]
    E --> N[Appeal denied request]
    
    style A fill:#e3f2fd
    style B fill:#e8f5e8
    style C fill:#fff3e0
    style D fill:#fce4ec
    style E fill:#f3e5f5
```

### Partner-Specific Data Views

```mermaid
graph TD
    A[Partner Data Access] --> B{Partner Type}
    
    B -->|VAR| C[VAR Dashboard View]
    B -->|Court| D[Legal Case View]
    B -->|Social Services| E[Case Management View] 
    B -->|Family| F[Family Portal View]
    
    C --> C1[Multi-provider metrics]
    C --> C2[Aggregate reporting]
    C --> C3[Revenue dashboards]
    
    D --> D1[Case-specific data only]
    D --> D2[Legal compliance reports]
    D --> D3[Court order status]
    
    E --> E1[Assigned case data]
    E --> E2[Service coordination]
    E --> E3[Progress tracking]
    
    F --> F1[Limited health info]
    F --> F2[Appointment scheduling]
    F --> F3[Communication tools]
```

---

## Summary

Provider partner bootstrap involves:

1. **Type-Specific Setup**: Different forms and requirements based on partner type
2. **Standard Zitadel Flow**: Same organization creation process as providers
3. **Limited Permissions**: partner_admin role with restricted capabilities
4. **Business Profiles**: Type-specific partner profile information
5. **Cross-Tenant Access**: Via explicit grants from providers, not inherent access
6. **Audit and Compliance**: Full tracking of all cross-tenant data access

Key differences from provider bootstrap:
- **No inherent client/medication access** - must be explicitly granted
- **Request-based access model** - partners request, providers approve
- **Type-specific profiles** - VAR, court, social services, family variants
- **Limited organizational hierarchy** - typically flat structure within partner org