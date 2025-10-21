-- Audit Log Table
-- CQRS projection for audit trail - General system audit trail for all data changes
CREATE TABLE IF NOT EXISTS audit_log (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,

  -- Event Information
  event_type TEXT NOT NULL, -- create, update, delete, access, export, print, etc.
  event_category TEXT NOT NULL, -- data_change, authentication, authorization, system
  event_name TEXT NOT NULL,
  event_description TEXT,

  -- Actor Information
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  user_roles TEXT[],
  impersonated_by UUID,

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE audit_log IS 'CQRS projection for audit trail - General system audit trail for all data changes';