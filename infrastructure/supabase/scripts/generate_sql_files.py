#!/usr/bin/env python3
"""
Generate individual SQL files from the SUPABASE-INVENTORY.md
This script splits the monolithic schema into individual files
"""

import os
import re

# Read the inventory file
inventory_path = "../../SUPABASE-INVENTORY.md"

# Table definitions from inventory (simplified for this script)
tables = {
    "clients": {
        "columns": """
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
  updated_at TIMESTAMPTZ DEFAULT NOW()""",
        "indexes": [
            ("idx_clients_organization", "organization_id"),
            ("idx_clients_name", "last_name, first_name"),
            ("idx_clients_status", "status"),
            ("idx_clients_dob", "date_of_birth")
        ],
        "comment": "Patient/client records with full medical information"
    },
    "medications": {
        "columns": """
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
  updated_at TIMESTAMPTZ DEFAULT NOW()""",
        "indexes": [
            ("idx_medications_organization", "organization_id"),
            ("idx_medications_name", "name"),
            ("idx_medications_generic_name", "generic_name"),
            ("idx_medications_rxnorm", "rxnorm_cui"),
            ("idx_medications_is_controlled", "is_controlled"),
            ("idx_medications_is_active", "is_active")
        ],
        "comment": "Medication catalog with comprehensive drug information"
    },
    "medication_history": {
        "columns": """
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

  -- Dosage Information
  dosage_amount DECIMAL,
  dosage_unit TEXT,
  frequency TEXT,
  route TEXT, -- oral, injection, topical, etc.
  instructions TEXT,

  -- PRN (As Needed) Information
  is_prn BOOLEAN DEFAULT false,
  prn_reason TEXT,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued', 'on_hold')),

  -- Tracking
  refills_authorized INTEGER,
  refills_used INTEGER DEFAULT 0,
  last_filled_date DATE,
  pharmacy_name TEXT,

  -- Clinical Notes
  notes TEXT,
  side_effects_reported TEXT[],
  effectiveness_rating INTEGER CHECK (effectiveness_rating BETWEEN 1 AND 5),

  -- Compliance
  compliance_percentage DECIMAL,
  missed_doses_count INTEGER DEFAULT 0,

  -- Additional Data
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()""",
        "indexes": [
            ("idx_medication_history_organization", "organization_id"),
            ("idx_medication_history_client", "client_id"),
            ("idx_medication_history_medication", "medication_id"),
            ("idx_medication_history_status", "status"),
            ("idx_medication_history_prescription_date", "prescription_date"),
            ("idx_medication_history_is_prn", "is_prn")
        ],
        "comment": "Tracks all medication prescriptions and administration history"
    },
    "dosage_info": {
        "columns": """
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  medication_history_id UUID NOT NULL REFERENCES medication_history(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Administration Details
  scheduled_datetime TIMESTAMPTZ NOT NULL,
  administered_datetime TIMESTAMPTZ,
  administered_by UUID REFERENCES users(id),

  -- Dosage
  scheduled_amount DECIMAL NOT NULL,
  administered_amount DECIMAL,
  unit TEXT NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'administered', 'skipped', 'refused', 'missed', 'late', 'early'
  )),

  -- Reasons and Notes
  skip_reason TEXT,
  refusal_reason TEXT,
  administration_notes TEXT,

  -- Vitals (if monitored)
  vitals_before JSONB DEFAULT '{}', -- {bp, hr, temp, etc.}
  vitals_after JSONB DEFAULT '{}',

  -- Side Effects
  side_effects_observed TEXT[],
  adverse_reaction BOOLEAN DEFAULT false,
  adverse_reaction_details TEXT,

  -- Verification
  verified_by UUID REFERENCES users(id),
  verification_datetime TIMESTAMPTZ,

  -- Additional Data
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()""",
        "indexes": [
            ("idx_dosage_info_organization", "organization_id"),
            ("idx_dosage_info_medication_history", "medication_history_id"),
            ("idx_dosage_info_client", "client_id"),
            ("idx_dosage_info_scheduled_datetime", "scheduled_datetime"),
            ("idx_dosage_info_status", "status"),
            ("idx_dosage_info_administered_by", "administered_by")
        ],
        "comment": "Tracks actual medication administration events"
    },
    "audit_log": {
        "columns": """
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Event Information
  event_type TEXT NOT NULL, -- create, update, delete, access, export, print, etc.
  event_category TEXT NOT NULL, -- data_change, authentication, authorization, system
  event_name TEXT NOT NULL,
  event_description TEXT,

  -- Actor Information
  user_id UUID REFERENCES users(id),
  user_email TEXT,
  user_name TEXT,
  user_roles TEXT[],
  impersonated_by UUID REFERENCES users(id),

  -- Resource Information
  resource_type TEXT, -- table name or resource type
  resource_id UUID,
  resource_name TEXT,

  -- Change Details
  operation TEXT, -- INSERT, UPDATE, DELETE, SELECT
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],

  -- Request Context
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  request_id TEXT,
  request_method TEXT, -- GET, POST, PUT, DELETE, etc.
  request_path TEXT,

  -- Response
  response_status INTEGER,
  error_message TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()""",
        "indexes": [
            ("idx_audit_log_organization", "organization_id"),
            ("idx_audit_log_user", "user_id"),
            ("idx_audit_log_event_type", "event_type"),
            ("idx_audit_log_resource", "resource_type, resource_id"),
            ("idx_audit_log_created_at", "created_at DESC"),
            ("idx_audit_log_session", "session_id")
        ],
        "comment": "General system audit trail for all data changes"
    },
    "api_audit_log": {
        "columns": """
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- API Request
  request_id TEXT UNIQUE NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  request_query_params JSONB,
  request_headers JSONB,
  request_body JSONB,
  request_size_bytes INTEGER,

  -- API Response
  response_timestamp TIMESTAMPTZ,
  response_status_code INTEGER,
  response_headers JSONB,
  response_body JSONB,
  response_size_bytes INTEGER,
  response_time_ms INTEGER,

  -- Authentication
  auth_method TEXT, -- bearer_token, api_key, oauth, etc.
  auth_user_id UUID REFERENCES users(id),
  auth_organization_id UUID REFERENCES organizations(id),
  auth_scopes TEXT[],

  -- Rate Limiting
  rate_limit_tier TEXT,
  rate_limit_remaining INTEGER,
  rate_limit_reset_at TIMESTAMPTZ,

  -- Error Information
  error_code TEXT,
  error_message TEXT,
  error_details JSONB,

  -- Performance Metrics
  database_queries_count INTEGER,
  database_time_ms INTEGER,
  cache_hits INTEGER,
  cache_misses INTEGER,

  -- Client Information
  client_ip INET,
  client_user_agent TEXT,
  client_version TEXT,
  client_sdk TEXT,

  -- HATEOAS Links (if applicable)
  hateoas_links JSONB,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()""",
        "indexes": [
            ("idx_api_audit_log_organization", "organization_id"),
            ("idx_api_audit_log_request_id", "request_id"),
            ("idx_api_audit_log_user", "auth_user_id"),
            ("idx_api_audit_log_timestamp", "request_timestamp DESC"),
            ("idx_api_audit_log_method_path", "request_method, request_path"),
            ("idx_api_audit_log_status", "response_status_code"),
            ("idx_api_audit_log_client_ip", "client_ip")
        ],
        "comment": "REST API specific audit logging with performance metrics"
    }
}

# Generate table SQL files
for table_name, table_info in tables.items():
    # Create table SQL
    table_sql = f"""-- {table_name.replace('_', ' ').title()} Table
-- {table_info['comment']}
CREATE TABLE IF NOT EXISTS {table_name} (
{table_info['columns']}
);

-- Add table comment
COMMENT ON TABLE {table_name} IS '{table_info['comment']}';"""

    # Write table file
    table_path = f"sql/02-tables/{table_name}/table.sql"
    print(f"Creating: {table_path}")
    with open(table_path, 'w') as f:
        f.write(table_sql)

    # Create indexes
    for idx_name, idx_cols in table_info['indexes']:
        index_sql = f"""-- Index on {idx_cols}
CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name}({idx_cols});"""

        index_path = f"sql/02-tables/{table_name}/indexes/{idx_name}.sql"
        print(f"Creating: {index_path}")
        with open(index_path, 'w') as f:
            f.write(index_sql)

    # Create trigger for updated_at if table has it
    if "updated_at TIMESTAMPTZ" in table_info['columns']:
        trigger_sql = f"""-- Trigger to automatically update the updated_at timestamp
CREATE TRIGGER update_{table_name}_updated_at
  BEFORE UPDATE ON {table_name}
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();"""

        trigger_path = f"sql/02-tables/{table_name}/triggers/update_updated_at.sql"
        print(f"Creating: {trigger_path}")
        with open(trigger_path, 'w') as f:
            f.write(trigger_sql)

print("SQL file generation complete!")