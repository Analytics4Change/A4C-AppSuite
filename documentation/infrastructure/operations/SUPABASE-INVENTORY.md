---
status: current
last_updated: 2025-01-13
---

# Supabase Infrastructure Inventory

## Overview
This document provides a comprehensive inventory of all Supabase resources required for the Analytics4Change (A4C) platform. These resources will be provisioned using Terraform with the Supabase provider.

## Project Configuration

### Connection Details
- **Project URL**: `https://tmrjlswbsxmbglmaclxu.supabase.com`
- **Project Reference**: `tmrjlswbsxmbglmaclxu`
- **Region**: US East (automatically assigned)

### API Keys
```env
# Public/Anon Key (Frontend use)
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtcmpsc3dic3htYmdsbWFjbHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5MzgzNzQsImV4cCI6MjA3NDUxNDM3NH0.o_cS3L7X6h1UKnNgPEeV9PLSB-bTtExzTK1amXXjxOY

# Service Role Key (Backend/Admin use)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtcmpsc3dic3htYmdsbWFjbHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODkzODM3NCwiZXhwIjoyMDc0NTE0Mzc0fQ.st2PYTcdOYR_PjcIElRnvjV_-N7CBu7_x0Q3k_150aA
```

## Database Schema

### 1. Organizations Table
Primary table for multi-tenancy support, synced with Zitadel organizations.

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL, -- Zitadel Organization ID
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('healthcare_facility', 'var', 'admin')),
  metadata JSONB DEFAULT '{}',
  settings JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_organizations_external_id ON organizations(external_id);
CREATE INDEX idx_organizations_type ON organizations(type);
CREATE INDEX idx_organizations_is_active ON organizations(is_active);
```

### 2. Users Table
Shadow table for Zitadel users, used for RLS and audit trails.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL, -- Zitadel User ID
  email TEXT NOT NULL,
  name TEXT,
  current_organization_id UUID REFERENCES organizations(id),
  accessible_organizations UUID[], -- Array of organization IDs
  roles TEXT[], -- Array of role names from Zitadel
  metadata JSONB DEFAULT '{}',
  last_login TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_external_id ON users(external_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_current_organization ON users(current_organization_id);
CREATE INDEX idx_users_roles ON users USING GIN(roles);
```

### 3. Clients Table
Core table for patient/client records.

```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Basic Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),

  -- Contact Information
  email TEXT,
  phone TEXT,
  address JSONB DEFAULT '{}', -- {street, city, state, zip_code, country}

  -- Emergency Contact
  emergency_contact JSONB DEFAULT '{}', -- {name, relationship, phone, alternate_phone}

  -- Medical Information
  allergies TEXT[],
  medical_conditions TEXT[],
  blood_type TEXT,

  -- Administrative
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  admission_date DATE,
  discharge_date DATE,
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_clients_organization ON clients(organization_id);
CREATE INDEX idx_clients_name ON clients(last_name, first_name);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_dob ON clients(date_of_birth);
```

### 4. Medications Table
Medication catalog with comprehensive drug information.

```sql
CREATE TABLE medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Medication Information
  name TEXT NOT NULL,
  generic_name TEXT,
  brand_names TEXT[],
  rxnorm_cui TEXT, -- RXNorm Concept Unique Identifier
  ndc_codes TEXT[], -- National Drug Codes

  -- Classification
  category_broad TEXT,
  category_specific TEXT,
  drug_class TEXT,

  -- Flags
  is_psychotropic BOOLEAN DEFAULT false,
  is_controlled BOOLEAN DEFAULT false,
  controlled_substance_schedule TEXT, -- Schedule I-V
  is_narcotic BOOLEAN DEFAULT false,
  requires_monitoring BOOLEAN DEFAULT false,
  is_high_alert BOOLEAN DEFAULT false,

  -- Details
  active_ingredients JSONB DEFAULT '[]', -- [{name, strength, unit}]
  available_forms TEXT[], -- ['tablet', 'capsule', 'liquid', etc.]
  available_strengths TEXT[], -- ['5mg', '10mg', '20mg']

  -- Additional Information
  manufacturer TEXT,
  warnings TEXT[],
  black_box_warning TEXT,
  metadata JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_formulary BOOLEAN DEFAULT true,

  -- Audit
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_medications_organization ON medications(organization_id);
CREATE INDEX idx_medications_name ON medications(name);
CREATE INDEX idx_medications_generic_name ON medications(generic_name);
CREATE INDEX idx_medications_rxnorm ON medications(rxnorm_cui);
CREATE INDEX idx_medications_is_controlled ON medications(is_controlled);
CREATE INDEX idx_medications_is_active ON medications(is_active);
```

### 5. Medication History Table
Tracks all medication prescriptions and administration history.

```sql
CREATE TABLE medication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id),

  -- Prescription Details
  prescription_date DATE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  discontinue_date DATE,
  discontinue_reason TEXT,

  -- Prescriber Information
  prescriber_name TEXT,
  prescriber_npi TEXT, -- National Provider Identifier
  prescriber_license TEXT,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active', 'completed', 'discontinued', 'on_hold', 'expired'
  )),

  -- Additional Information
  indication TEXT, -- Reason for prescription
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_active_medication UNIQUE (client_id, medication_id, status)
    WHERE status = 'active'
);

-- Indexes
CREATE INDEX idx_medication_history_organization ON medication_history(organization_id);
CREATE INDEX idx_medication_history_client ON medication_history(client_id);
CREATE INDEX idx_medication_history_medication ON medication_history(medication_id);
CREATE INDEX idx_medication_history_status ON medication_history(status);
CREATE INDEX idx_medication_history_dates ON medication_history(start_date, end_date);
```

### 6. Dosage Info Table
Detailed dosage instructions for each medication prescription.

```sql
CREATE TABLE dosage_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_history_id UUID NOT NULL REFERENCES medication_history(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Dosage Details
  form TEXT NOT NULL, -- tablet, capsule, liquid, injection, etc.
  route TEXT NOT NULL, -- oral, IV, IM, topical, etc.
  strength TEXT NOT NULL, -- e.g., "10mg", "5mg/ml"
  dose_amount NUMERIC NOT NULL,
  dose_unit TEXT NOT NULL, -- mg, ml, units, etc.

  -- Frequency
  frequency_value INTEGER,
  frequency_unit TEXT, -- 'daily', 'hourly', 'weekly', etc.
  frequency_details JSONB DEFAULT '{}', -- Complex frequency patterns

  -- Timing
  times_of_day TEXT[], -- ['08:00', '12:00', '18:00']
  specific_days TEXT[], -- For weekly schedules
  prn BOOLEAN DEFAULT false, -- As needed
  prn_reason TEXT,

  -- Administration Conditions
  food_requirements TEXT, -- 'with_food', 'empty_stomach', 'no_restriction'
  food_timing_minutes INTEGER, -- Minutes before/after food
  special_instructions TEXT[],

  -- Duration and Quantity
  duration_value INTEGER,
  duration_unit TEXT, -- 'days', 'weeks', 'months'
  total_quantity NUMERIC,
  refills_authorized INTEGER DEFAULT 0,
  refills_remaining INTEGER DEFAULT 0,

  -- Additional Information
  max_daily_dose NUMERIC,
  taper_schedule JSONB, -- For medications that need tapering
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_dosage_info_medication_history ON dosage_info(medication_history_id);
CREATE INDEX idx_dosage_info_organization ON dosage_info(organization_id);
CREATE INDEX idx_dosage_info_prn ON dosage_info(prn);
```

## Row Level Security (RLS) Policies

### Enable RLS on All Tables
```sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE dosage_info ENABLE ROW LEVEL SECURITY;
```

### Organization Isolation Policies
Base policy pattern for organization-level data isolation:

```sql
-- Clients table organization isolation
CREATE POLICY "org_isolation_policy" ON clients
  USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

-- Medications table organization isolation
CREATE POLICY "org_isolation_policy" ON medications
  USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

-- Medication History organization isolation
CREATE POLICY "org_isolation_policy" ON medication_history
  USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

-- Dosage Info organization isolation
CREATE POLICY "org_isolation_policy" ON dosage_info
  USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);
```

### Role-Based Access Control Policies

#### Super Admin Policies
Full access to all data across all organizations:

```sql
-- Super admin full access to all tables
CREATE POLICY "super_admin_all_access" ON clients
  USING ((auth.jwt() -> 'roles') ? 'super_admin');

CREATE POLICY "super_admin_all_access" ON medications
  USING ((auth.jwt() -> 'roles') ? 'super_admin');

CREATE POLICY "super_admin_all_access" ON medication_history
  USING ((auth.jwt() -> 'roles') ? 'super_admin');

CREATE POLICY "super_admin_all_access" ON dosage_info
  USING ((auth.jwt() -> 'roles') ? 'super_admin');

CREATE POLICY "super_admin_all_access" ON organizations
  USING ((auth.jwt() -> 'roles') ? 'super_admin');

CREATE POLICY "super_admin_all_access" ON users
  USING ((auth.jwt() -> 'roles') ? 'super_admin');
```

#### Partner Onboarder Policies
Can create and manage provider organizations:

```sql
-- Partner onboarder can manage organizations
CREATE POLICY "partner_onboarder_org_management" ON organizations
  USING (
    (auth.jwt() -> 'roles') ? 'partner_onboarder'
    OR id = (auth.jwt() ->> 'organization_id')::UUID
  )
  WITH CHECK (
    (auth.jwt() -> 'roles') ? 'partner_onboarder'
    OR (type = 'healthcare_facility' AND id = (auth.jwt() ->> 'organization_id')::UUID)
  );

-- Partner onboarder can view users
CREATE POLICY "partner_onboarder_user_view" ON users
  FOR SELECT
  USING ((auth.jwt() -> 'roles') ? 'partner_onboarder');
```

#### Administrator Policies
Full access within their organization:

```sql
-- Administrator full access within organization
CREATE POLICY "admin_org_full_access" ON clients
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'administrator'
  );

CREATE POLICY "admin_org_full_access" ON medications
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'administrator'
  );

CREATE POLICY "admin_org_full_access" ON medication_history
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'administrator'
  );

CREATE POLICY "admin_org_full_access" ON dosage_info
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'administrator'
  );
```

#### Provider Admin Policies
Manage provider-level settings and users:

```sql
-- Provider admin access within their provider organization
CREATE POLICY "provider_admin_access" ON clients
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'provider_admin'
  );

CREATE POLICY "provider_admin_access" ON medications
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'provider_admin'
  );

CREATE POLICY "provider_admin_access" ON medication_history
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'provider_admin'
  );
```

#### Caregiver Policies
Access to assigned clients and their medications:

```sql
-- Caregivers can manage client records
CREATE POLICY "caregiver_client_access" ON clients
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'caregiver'
  );

-- Caregivers can manage medication history
CREATE POLICY "caregiver_medication_access" ON medication_history
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'caregiver'
  );

-- Caregivers can manage dosage info
CREATE POLICY "caregiver_dosage_access" ON dosage_info
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'caregiver'
  );

-- Caregivers can read medications
CREATE POLICY "caregiver_medication_read" ON medications
  FOR SELECT
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'caregiver'
  );
```

#### Viewer Policies
Read-only access within organization:

```sql
-- Viewers have read-only access to all org data
CREATE POLICY "viewer_read_only" ON clients
  FOR SELECT
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'viewer'
  );

CREATE POLICY "viewer_read_only" ON medications
  FOR SELECT
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'viewer'
  );

CREATE POLICY "viewer_read_only" ON medication_history
  FOR SELECT
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'viewer'
  );

CREATE POLICY "viewer_read_only" ON dosage_info
  FOR SELECT
  USING (
    organization_id = (auth.jwt() ->> 'organization_id')::UUID
    AND (auth.jwt() -> 'roles') ? 'viewer'
  );
```

## Edge Functions

### 1. Auth Bridge Function
Validates Zitadel JWT tokens and creates Supabase-compatible sessions.

**Path**: `/functions/v1/auth-bridge`
**Method**: POST

```typescript
// Expected input
{
  "zitadel_token": "eyJhbGc...",
  "action": "validate" | "refresh" | "logout"
}

// Response
{
  "supabase_token": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "organization_id": "uuid",
    "roles": ["administrator"]
  }
}
```

### 2. Client API Function
CRUD operations for client management with organization scoping.

**Base Path**: `/functions/v1/clients`

```typescript
// Endpoints
GET    /functions/v1/clients          // List all clients in org
GET    /functions/v1/clients/:id      // Get specific client
POST   /functions/v1/clients          // Create new client
PUT    /functions/v1/clients/:id      // Update client
DELETE /functions/v1/clients/:id      // Archive client
GET    /functions/v1/clients/search   // Search clients

// Query parameters
?status=active|inactive|archived
?search=john+doe
?page=1&limit=20
?sort=last_name&order=asc
```

### 3. Medication API Function
Medication search, management, and prescription handling.

**Base Path**: `/functions/v1/medications`

```typescript
// Endpoints
GET    /functions/v1/medications/search       // Search medications
GET    /functions/v1/medications/:id          // Get medication details
POST   /functions/v1/medications              // Add custom medication
PUT    /functions/v1/medications/:id          // Update medication
GET    /functions/v1/medications/formulary    // Get org formulary

// Prescription endpoints
POST   /functions/v1/medications/prescribe    // Create prescription
PUT    /functions/v1/medications/history/:id  // Update prescription
GET    /functions/v1/medications/history/:clientId  // Get client history
POST   /functions/v1/medications/discontinue  // Discontinue medication
```

### 4. RXNorm Proxy Function
Proxy and cache requests to the RXNorm API for medication data.

**Path**: `/functions/v1/rxnorm/*`

```typescript
// Proxied endpoints
GET /functions/v1/rxnorm/search?name=aspirin
GET /functions/v1/rxnorm/rxcui/:rxcui
GET /functions/v1/rxnorm/interactions/:rxcui
GET /functions/v1/rxnorm/ndc/:ndc

// Features
- Response caching (24 hours)
- Rate limiting (100 req/min)
- Error retry with exponential backoff
- Request coalescing for duplicate queries
```

### 5. Reports Function
Generate various reports for organizations.

**Base Path**: `/functions/v1/reports`

```typescript
// Endpoints
GET /functions/v1/reports/medication-adherence
GET /functions/v1/reports/controlled-substances
GET /functions/v1/reports/client-summary/:clientId
GET /functions/v1/reports/organization-metrics

// Export formats
?format=pdf|csv|json
?date_from=2024-01-01&date_to=2024-12-31
```

## Storage Buckets

### 1. Client Documents Bucket
```typescript
{
  name: "client-documents",
  public: false,
  file_size_limit: "10MB",
  allowed_mime_types: [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ],
  structure: "/{organization_id}/clients/{client_id}/{document_type}/{filename}"
}
```

**RLS Policies**:
```sql
-- Read access for org members
CREATE POLICY "org_members_read_documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'client-documents'
  AND (storage.foldername(name))[1] = auth.jwt() ->> 'organization_id'
);

-- Write access for caregivers and above
CREATE POLICY "caregiver_write_documents"
ON storage.objects FOR INSERT
USING (
  bucket_id = 'client-documents'
  AND (storage.foldername(name))[1] = auth.jwt() ->> 'organization_id'
  AND (
    (auth.jwt() -> 'roles') ? 'caregiver'
    OR (auth.jwt() -> 'roles') ? 'administrator'
    OR (auth.jwt() -> 'roles') ? 'super_admin'
  )
);
```

### 2. Profile Pictures Bucket
```typescript
{
  name: "profile-pictures",
  public: true, // Read-only public access
  file_size_limit: "2MB",
  allowed_mime_types: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ],
  structure: "/{organization_id}/users/{user_id}/avatar.{ext}"
}
```

**RLS Policies**:
```sql
-- Anyone can read profile pictures
CREATE POLICY "public_read_avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-pictures');

-- Users can update their own avatar
CREATE POLICY "user_update_own_avatar"
ON storage.objects FOR INSERT
USING (
  bucket_id = 'profile-pictures'
  AND (storage.foldername(name))[2] = auth.uid()
);
```

## Database Functions and Triggers

### 1. Update Timestamp Function
Automatically updates the `updated_at` timestamp on row modifications.

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables with updated_at column
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medications_updated_at BEFORE UPDATE ON medications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medication_history_updated_at BEFORE UPDATE ON medication_history
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dosage_info_updated_at BEFORE UPDATE ON dosage_info
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 2. User Sync Function
Synchronizes user data from JWT claims on each request.

```sql
CREATE OR REPLACE FUNCTION sync_user_from_jwt()
RETURNS void AS $$
DECLARE
  jwt_user_id TEXT;
  jwt_email TEXT;
  jwt_name TEXT;
  jwt_org_id TEXT;
  jwt_roles TEXT[];
BEGIN
  -- Extract JWT claims
  jwt_user_id := auth.jwt() ->> 'sub';
  jwt_email := auth.jwt() ->> 'email';
  jwt_name := auth.jwt() ->> 'name';
  jwt_org_id := auth.jwt() ->> 'organization_id';
  jwt_roles := ARRAY(SELECT jsonb_array_elements_text(auth.jwt() -> 'roles'));

  -- Upsert user record
  INSERT INTO users (
    external_id,
    email,
    name,
    current_organization_id,
    roles,
    last_login
  )
  VALUES (
    jwt_user_id,
    jwt_email,
    jwt_name,
    jwt_org_id::UUID,
    jwt_roles,
    NOW()
  )
  ON CONFLICT (external_id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    current_organization_id = EXCLUDED.current_organization_id,
    roles = EXCLUDED.roles,
    last_login = NOW();
END;
$$ language 'plpgsql' SECURITY DEFINER;
```

### 3. Audit Log Function
Creates audit trail for sensitive operations.

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  user_id UUID,
  user_email TEXT,
  organization_id UUID,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    user_id,
    user_email,
    organization_id
  )
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    (auth.jwt() ->> 'sub')::UUID,
    auth.jwt() ->> 'email',
    (auth.jwt() ->> 'organization_id')::UUID
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Apply audit triggers to ALL tables for comprehensive audit trail
CREATE TRIGGER audit_organizations AFTER INSERT OR UPDATE OR DELETE ON organizations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_clients AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_medications AFTER INSERT OR UPDATE OR DELETE ON medications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_medication_history AFTER INSERT OR UPDATE OR DELETE ON medication_history
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_dosage_info AFTER INSERT OR UPDATE OR DELETE ON dosage_info
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
```

### 4. API-Level Audit Function
Tracks API calls at the Edge Function level.

```sql
CREATE TABLE api_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  request_body JSONB,
  response_body JSONB,
  error_message TEXT,
  user_id UUID,
  user_email TEXT,
  organization_id UUID,
  ip_address INET,
  user_agent TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX idx_api_audit_endpoint ON api_audit_log(endpoint);
CREATE INDEX idx_api_audit_user ON api_audit_log(user_id);
CREATE INDEX idx_api_audit_created ON api_audit_log(created_at);
CREATE INDEX idx_api_audit_status ON api_audit_log(status_code);

-- Function to log API calls (called from Edge Functions)
CREATE OR REPLACE FUNCTION log_api_call(
  p_endpoint TEXT,
  p_method TEXT,
  p_status_code INTEGER,
  p_request_body JSONB DEFAULT NULL,
  p_response_body JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  audit_id UUID;
BEGIN
  INSERT INTO api_audit_log (
    endpoint,
    method,
    status_code,
    request_body,
    response_body,
    error_message,
    user_id,
    user_email,
    organization_id,
    duration_ms
  )
  VALUES (
    p_endpoint,
    p_method,
    p_status_code,
    p_request_body,
    p_response_body,
    p_error_message,
    (auth.jwt() ->> 'sub')::UUID,
    auth.jwt() ->> 'email',
    (auth.jwt() ->> 'organization_id')::UUID,
    p_duration_ms
  )
  RETURNING id INTO audit_id;

  RETURN audit_id;
END;
$$ language 'plpgsql' SECURITY DEFINER;
```

### 5. Audit Retention Policy
Automatically archive old audit records.

```sql
-- Archived audit tables
CREATE TABLE audit_log_archive (LIKE audit_log INCLUDING ALL);
CREATE TABLE api_audit_log_archive (LIKE api_audit_log INCLUDING ALL);

-- Function to archive old audit records
CREATE OR REPLACE FUNCTION archive_old_audit_records()
RETURNS void AS $$
BEGIN
  -- Archive records older than 90 days
  INSERT INTO audit_log_archive
  SELECT * FROM audit_log
  WHERE created_at < NOW() - INTERVAL '90 days';

  DELETE FROM audit_log
  WHERE created_at < NOW() - INTERVAL '90 days';

  -- Archive API audit logs older than 30 days
  INSERT INTO api_audit_log_archive
  SELECT * FROM api_audit_log
  WHERE created_at < NOW() - INTERVAL '30 days';

  DELETE FROM api_audit_log
  WHERE created_at < NOW() - INTERVAL '30 days';

  -- Log the archival
  INSERT INTO audit_log (
    table_name,
    action,
    new_data,
    user_email
  )
  VALUES (
    'audit_archive',
    'ARCHIVE',
    jsonb_build_object(
      'audit_log_archived', (SELECT COUNT(*) FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days'),
      'api_audit_archived', (SELECT COUNT(*) FROM api_audit_log WHERE created_at < NOW() - INTERVAL '30 days')
    ),
    'system'
  );
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Schedule archival (requires pg_cron extension)
-- SELECT cron.schedule('archive-audit-logs', '0 2 * * *', 'SELECT archive_old_audit_records();');
```

## Realtime Subscriptions

### Channel Configurations

```typescript
// Client updates channel
const clientChannel = supabase
  .channel('client-changes')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'clients',
      filter: `organization_id=eq.${organizationId}`
    },
    (payload) => handleClientChange(payload)
  )
  .subscribe();

// Medication history channel
const medicationChannel = supabase
  .channel('medication-changes')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'medication_history',
      filter: `organization_id=eq.${organizationId}`
    },
    (payload) => handleMedicationChange(payload)
  )
  .subscribe();

// Organization-wide notifications
const notificationChannel = supabase
  .channel('org-notifications')
  .on(
    'broadcast',
    { event: 'notification' },
    (payload) => handleNotification(payload)
  )
  .subscribe();
```

## Terraform Configuration

### Provider Configuration
```hcl
terraform {
  required_version = ">= 1.0"

  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }
}

provider "supabase" {
  access_token = var.supabase_access_token
  project_ref  = "tmrjlswbsxmbglmaclxu"
}
```

### Variables
```hcl
variable "supabase_access_token" {
  description = "Supabase management API access token"
  type        = string
  sensitive   = true
}

variable "supabase_anon_key" {
  description = "Supabase anonymous/public key"
  type        = string
  default     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtcmpsc3dic3htYmdsbWFjbHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5MzgzNzQsImV4cCI6MjA3NDUxNDM3NH0.o_cS3L7X6h1UKnNgPEeV9PLSB-bTtExzTK1amXXjxOY"
}

variable "supabase_service_role_key" {
  description = "Supabase service role key"
  type        = string
  sensitive   = true
  default     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtcmpsc3dic3htYmdsbWFjbHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODkzODM3NCwiZXhwIjoyMDc0NTE0Mzc0fQ.st2PYTcdOYR_PjcIElRnvjV_-N7CBu7_x0Q3k_150aA"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  default     = "dev"
}
```

### Resource Examples
```hcl
# Create organizations table
resource "supabase_table" "organizations" {
  name        = "organizations"
  schema      = "public"
  description = "Multi-tenancy organizations"

  columns = {
    id = {
      type        = "uuid"
      primary_key = true
      default     = "gen_random_uuid()"
    }
    external_id = {
      type     = "text"
      nullable = false
      unique   = true
    }
    name = {
      type     = "text"
      nullable = false
    }
    type = {
      type     = "text"
      nullable = false
      check    = "type IN ('healthcare_facility', 'var', 'admin')"
    }
    # ... additional columns
  }

  rls_enabled = true
}

# Create RLS policy
resource "supabase_rls_policy" "org_isolation_clients" {
  table  = "clients"
  name   = "org_isolation_policy"
  using  = "organization_id = (auth.jwt() ->> 'organization_id')::UUID"
  check  = "organization_id = (auth.jwt() ->> 'organization_id')::UUID"
  cmd    = "ALL"
}

# Create Edge Function
resource "supabase_edge_function" "auth_bridge" {
  name   = "auth-bridge"
  source = file("${path.module}/functions/auth-bridge/index.ts")

  environment_variables = {
    ZITADEL_INSTANCE_URL = var.zitadel_instance_url
    ZITADEL_PROJECT_ID   = var.zitadel_project_id
  }
}

# Create storage bucket
resource "supabase_storage_bucket" "client_documents" {
  name          = "client-documents"
  public        = false
  file_size_limit = 10485760 # 10MB in bytes

  allowed_mime_types = [
    "application/pdf",
    "image/jpeg",
    "image/png"
  ]
}
```

## Migration Strategy

### Phase 1: Infrastructure Setup (Week 1)
1. **Create Database Schema**
   - Run table creation scripts
   - Set up indexes
   - Verify foreign key constraints

2. **Implement RLS Policies**
   - Enable RLS on all tables
   - Create organization isolation policies
   - Create role-based access policies
   - Test with sample JWT tokens

3. **Set Up Storage Buckets**
   - Create buckets with proper permissions
   - Configure CORS settings
   - Test file upload/download

### Phase 2: Functions Deployment (Week 2)
1. **Deploy Core Functions**
   - Auth bridge function
   - Client API function
   - Medication API function

2. **Configure API Gateway**
   - Set up routing rules
   - Configure rate limiting
   - Enable CORS

3. **Test API Endpoints**
   - Unit tests for each function
   - Integration tests with frontend
   - Load testing

### Phase 3: Data Migration (Week 3)
1. **Migrate Mock Data**
   - Export mock data from frontend
   - Transform to match schema
   - Import to Supabase

2. **Validate Data Integrity**
   - Check foreign key relationships
   - Verify organization assignments
   - Test RLS policies with real data

### Phase 4: Integration Testing (Week 4)
1. **Frontend Integration**
   - Update environment variables
   - Replace mock services with Supabase
   - Test all CRUD operations

2. **End-to-End Testing**
   - User authentication flow
   - Complete medication workflow
   - Role-based access testing

3. **Performance Optimization**
   - Query optimization
   - Index tuning
   - Caching strategy

## Security Considerations

### JWT Token Structure
Expected JWT claims from Zitadel:

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "organization_id": "org-uuid",
  "organizations": ["org-uuid-1", "org-uuid-2"],
  "roles": ["administrator", "caregiver"],
  "permissions": [
    "read:clients",
    "write:clients",
    "read:medications",
    "write:medications"
  ],
  "iat": 1234567890,
  "exp": 1234567890,
  "iss": "https://analytics4change-zdswvg.us1.zitadel.cloud",
  "aud": "tmrjlswbsxmbglmaclxu"
}
```

### CORS Configuration
```json
{
  "allowed_origins": [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://app.analytics4change.org",
    "https://staging.analytics4change.org"
  ],
  "allowed_methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  "allowed_headers": [
    "Authorization",
    "Content-Type",
    "X-Organization-Id",
    "X-Request-Id"
  ],
  "exposed_headers": ["X-Request-Id"],
  "max_age": 86400,
  "credentials": true
}
```

### API Rate Limiting
```typescript
{
  "default": {
    "requests_per_minute": 60,
    "requests_per_hour": 1000
  },
  "authenticated": {
    "requests_per_minute": 120,
    "requests_per_hour": 5000
  },
  "admin": {
    "requests_per_minute": 300,
    "requests_per_hour": 10000
  }
}
```

## REST API Documentation

### OpenAPI Specification
The Supabase PostgREST automatically generates REST endpoints for all tables. We'll augment this with:

#### 1. OpenAPI Documentation Edge Function
```typescript
// Edge Function: /functions/v1/openapi
export async function handler(req: Request) {
  const openApiSpec = {
    "openapi": "3.0.0",
    "info": {
      "title": "A4C Platform API",
      "version": "1.0.0",
      "description": "Analytics4Change Healthcare Platform API"
    },
    "servers": [
      {
        "url": "https://tmrjlswbsxmbglmaclxu.supabase.co",
        "description": "Production"
      }
    ],
    "security": [
      {
        "bearerAuth": []
      }
    ],
    "paths": {
      "/rest/v1/clients": {
        "get": {
          "summary": "List all clients",
          "operationId": "getClients",
          "parameters": [
            {
              "name": "organization_id",
              "in": "query",
              "required": true,
              "schema": { "type": "string", "format": "uuid" }
            },
            {
              "name": "status",
              "in": "query",
              "schema": { "type": "string", "enum": ["active", "inactive", "archived"] }
            }
          ],
          "responses": {
            "200": {
              "description": "List of clients",
              "content": {
                "application/json": {
                  "schema": {
                    "type": "array",
                    "items": { "$ref": "#/components/schemas/Client" }
                  }
                }
              }
            }
          }
        },
        "post": {
          "summary": "Create a new client",
          "operationId": "createClient",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ClientInput" }
              }
            }
          },
          "responses": {
            "201": {
              "description": "Client created",
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/Client" }
                }
              }
            }
          }
        }
      }
    },
    "components": {
      "securitySchemes": {
        "bearerAuth": {
          "type": "http",
          "scheme": "bearer",
          "bearerFormat": "JWT"
        }
      }
    }
  };

  return new Response(JSON.stringify(openApiSpec), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

#### 2. Postman Collection Generator
```typescript
// Edge Function: /functions/v1/postman
export async function handler(req: Request) {
  const postmanCollection = {
    "info": {
      "name": "A4C Platform API",
      "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    "auth": {
      "type": "bearer",
      "bearer": [
        {
          "key": "token",
          "value": "{{supabase_token}}",
          "type": "string"
        }
      ]
    },
    "variable": [
      {
        "key": "base_url",
        "value": "https://tmrjlswbsxmbglmaclxu.supabase.co"
      },
      {
        "key": "supabase_token",
        "value": "",
        "type": "string"
      }
    ],
    "item": [
      {
        "name": "Clients",
        "item": [
          {
            "name": "Get All Clients",
            "request": {
              "method": "GET",
              "header": [],
              "url": {
                "raw": "{{base_url}}/rest/v1/clients",
                "host": ["{{base_url}}"],
                "path": ["rest", "v1", "clients"]
              }
            }
          }
        ]
      }
    ]
  };

  return new Response(JSON.stringify(postmanCollection), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="A4C-API.postman_collection.json"'
    }
  });
}
```

### API Documentation Files (Not Managed by Terraform)
Store these in the repository under `/api-docs/`:

```
/api-docs/
├── openapi.yaml          # Full OpenAPI 3.0 specification
├── postman/
│   ├── collection.json   # Postman collection
│   └── environment.json  # Postman environment variables
├── examples/
│   ├── requests/         # Example request payloads
│   └── responses/        # Example response payloads
└── README.md            # API documentation guide
```

## HATEOAS Implementation

### Overview
Since Supabase's PostgREST doesn't natively support HATEOAS, we implement it via Edge Functions that wrap database calls and add hypermedia controls.

### HATEOAS Edge Function Wrapper
```typescript
// Edge Function: /functions/v1/hateoas/clients
interface HATEOASResponse<T> {
  data: T;
  _links: {
    self: { href: string; method: string };
    [key: string]: { href: string; method: string; title?: string };
  };
  _embedded?: Record<string, any>;
  _actions?: Array<{
    name: string;
    href: string;
    method: string;
    fields?: Array<{ name: string; type: string; required?: boolean }>;
  }>;
}

export async function handler(req: Request) {
  const { method, url } = req;
  const { pathname, searchParams } = new URL(url);
  const pathParts = pathname.split('/');
  const clientId = pathParts[pathParts.length - 1];

  if (method === 'GET' && clientId && clientId !== 'clients') {
    // Get single client with HATEOAS links
    const client = await getClient(clientId);

    const response: HATEOASResponse<typeof client> = {
      data: client,
      _links: {
        self: {
          href: `/functions/v1/hateoas/clients/${clientId}`,
          method: 'GET'
        },
        update: {
          href: `/functions/v1/hateoas/clients/${clientId}`,
          method: 'PUT',
          title: 'Update client information'
        },
        delete: {
          href: `/functions/v1/hateoas/clients/${clientId}`,
          method: 'DELETE',
          title: 'Archive this client'
        },
        medications: {
          href: `/functions/v1/hateoas/clients/${clientId}/medications`,
          method: 'GET',
          title: 'View client medications'
        },
        documents: {
          href: `/functions/v1/hateoas/clients/${clientId}/documents`,
          method: 'GET',
          title: 'View client documents'
        },
        collection: {
          href: '/functions/v1/hateoas/clients',
          method: 'GET',
          title: 'Back to all clients'
        }
      },
      _actions: [
        {
          name: 'prescribe_medication',
          href: `/functions/v1/hateoas/clients/${clientId}/medications`,
          method: 'POST',
          fields: [
            { name: 'medication_id', type: 'uuid', required: true },
            { name: 'dosage_info', type: 'object', required: true }
          ]
        },
        {
          name: 'upload_document',
          href: `/functions/v1/hateoas/clients/${clientId}/documents`,
          method: 'POST',
          fields: [
            { name: 'file', type: 'file', required: true },
            { name: 'document_type', type: 'string', required: true }
          ]
        }
      ]
    };

    // Add embedded resources if requested
    if (searchParams.get('embed') === 'medications') {
      response._embedded = {
        medications: await getClientMedications(clientId)
      };
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/hal+json' }
    });
  }

  // List clients with pagination links
  if (method === 'GET') {
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const { clients, total } = await getClients(page, limit);

    const totalPages = Math.ceil(total / limit);

    const response: HATEOASResponse<typeof clients> = {
      data: clients,
      _links: {
        self: {
          href: `/functions/v1/hateoas/clients?page=${page}&limit=${limit}`,
          method: 'GET'
        },
        first: {
          href: `/functions/v1/hateoas/clients?page=1&limit=${limit}`,
          method: 'GET'
        },
        last: {
          href: `/functions/v1/hateoas/clients?page=${totalPages}&limit=${limit}`,
          method: 'GET'
        }
      }
    };

    // Add prev/next links if applicable
    if (page > 1) {
      response._links.prev = {
        href: `/functions/v1/hateoas/clients?page=${page - 1}&limit=${limit}`,
        method: 'GET'
      };
    }
    if (page < totalPages) {
      response._links.next = {
        href: `/functions/v1/hateoas/clients?page=${page + 1}&limit=${limit}`,
        method: 'GET'
      };
    }

    // Add create action
    response._actions = [
      {
        name: 'create_client',
        href: '/functions/v1/hateoas/clients',
        method: 'POST',
        fields: [
          { name: 'first_name', type: 'string', required: true },
          { name: 'last_name', type: 'string', required: true },
          { name: 'date_of_birth', type: 'date', required: true },
          { name: 'email', type: 'email', required: false }
        ]
      }
    ];

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/hal+json' }
    });
  }
}
```

### HATEOAS State Machine
Define allowed state transitions for resources:

```typescript
// State transitions for medication prescriptions
const medicationStateTransitions = {
  'draft': ['active', 'cancelled'],
  'active': ['on_hold', 'discontinued', 'completed'],
  'on_hold': ['active', 'discontinued'],
  'discontinued': [], // Terminal state
  'completed': [], // Terminal state
  'cancelled': [] // Terminal state
};

// Generate available actions based on current state
function getAvailableActions(resource: any, resourceType: string) {
  const actions = [];

  if (resourceType === 'medication_history' && resource.status) {
    const transitions = medicationStateTransitions[resource.status] || [];

    transitions.forEach(nextState => {
      actions.push({
        name: `transition_to_${nextState}`,
        href: `/functions/v1/hateoas/medications/${resource.id}/transition`,
        method: 'POST',
        fields: [
          { name: 'new_status', type: 'string', value: nextState },
          { name: 'reason', type: 'string', required: nextState === 'discontinued' }
        ]
      });
    });
  }

  return actions;
}
```

## API Testing & Validation

### Automated API Testing Edge Function
```typescript
// Edge Function: /functions/v1/api-tests
export async function handler(req: Request) {
  const tests = [
    {
      name: "Authentication Test",
      endpoint: "/auth/v1/token",
      method: "POST",
      expected_status: 200
    },
    {
      name: "Get Clients",
      endpoint: "/rest/v1/clients",
      method: "GET",
      expected_status: 200,
      expected_schema: "ClientArray"
    },
    {
      name: "Create Client",
      endpoint: "/rest/v1/clients",
      method: "POST",
      expected_status: 201,
      payload: {
        first_name: "Test",
        last_name: "User",
        date_of_birth: "2000-01-01"
      }
    }
  ];

  const results = await runTests(tests);

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

## Monitoring and Observability

### Key Metrics to Track
- API response times
- Database query performance
- RLS policy evaluation time
- Storage usage
- Edge function execution duration
- Error rates by endpoint

### Alerting Rules
- API response time > 2 seconds
- Database connection pool > 80%
- Storage usage > 80%
- Error rate > 1%
- Failed authentication attempts > 10/minute

## Backup and Recovery

### Backup Strategy
- **Database**: Daily automated backups with 30-day retention
- **Storage**: Weekly backups of all buckets
- **Configuration**: Version controlled in Git

### Recovery Procedures
1. **Database Recovery**
   - Point-in-time recovery available
   - Maximum 5-minute data loss

2. **Storage Recovery**
   - Restore from S3 backups
   - Maximum 1-week data loss

3. **Disaster Recovery**
   - Full environment rebuild from Terraform
   - Estimated RTO: 4 hours
   - Estimated RPO: 1 hour

## Cost Estimation

### Monthly Costs (Estimated)
- **Database**: ~$25 (starter tier)
- **Auth**: Included with database
- **Storage**: ~$5 (10GB)
- **Edge Functions**: ~$10 (100K invocations)
- **Bandwidth**: ~$10 (50GB)
- **Total**: ~$50/month for development

### Scaling Considerations
- Move to Pro tier at 10K MAU (~$25/month)
- Team tier for production (~$599/month)
- Enterprise for HIPAA compliance (custom pricing)

## Appendix

### Useful SQL Queries

#### Check User Permissions
```sql
SELECT
  auth.jwt() ->> 'email' as user_email,
  auth.jwt() ->> 'organization_id' as org_id,
  auth.jwt() -> 'roles' as roles;
```

#### View Active RLS Policies
```sql
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

#### Monitor Table Sizes
```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Environment Variable Template
```env
# Supabase Configuration
SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.com
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_PROJECT_REF=tmrjlswbsxmbglmaclxu

# Terraform Configuration
TF_VAR_supabase_access_token=sbp_...
TF_VAR_environment=dev

# Application Configuration
DATABASE_URL=postgresql://postgres:[password]@db.tmrjlswbsxmbglmaclxu.supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:[password]@db.tmrjlswbsxmbglmaclxu.supabase.co:5432/postgres
```

---

*Last Updated: January 2025*
*Version: 1.0.0*