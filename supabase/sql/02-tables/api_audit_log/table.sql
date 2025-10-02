-- Api Audit Log Table
-- REST API specific audit logging with performance metrics
CREATE TABLE IF NOT EXISTS api_audit_log (

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE api_audit_log IS 'REST API specific audit logging with performance metrics';