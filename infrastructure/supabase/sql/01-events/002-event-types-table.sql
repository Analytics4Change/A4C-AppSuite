-- Event Types Catalog
-- Documents all valid event types in the system
CREATE TABLE IF NOT EXISTS event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identification
  event_type TEXT UNIQUE NOT NULL, -- 'client.admitted', 'medication.prescribed'
  stream_type TEXT NOT NULL, -- Which entity type this applies to

  -- Event schema
  event_schema JSONB NOT NULL, -- JSON Schema for validating event_data
  metadata_schema JSONB, -- JSON Schema for validating event_metadata

  -- Documentation
  description TEXT NOT NULL,
  example_data JSONB,
  example_metadata JSONB,

  -- Configuration
  is_active BOOLEAN DEFAULT true,
  requires_approval BOOLEAN DEFAULT false,
  allowed_roles TEXT[], -- Which roles can emit this event

  -- Projection configuration
  projection_function TEXT, -- Name of function that processes this event
  projection_tables TEXT[], -- Which tables this event affects

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID  -- FK constraint deferred to avoid circular dependency (added in 02-tables/users/add-event-types-fk.sql)
);

-- Insert core event types
INSERT INTO event_types (event_type, stream_type, description, event_schema, projection_tables) VALUES
-- Client events
('client.registered', 'client', 'New client registered in system',
  '{"type": "object", "required": ["first_name", "last_name", "date_of_birth", "organization_id"]}',
  ARRAY['clients']),

('client.admitted', 'client', 'Client admitted to facility',
  '{"type": "object", "required": ["admission_date", "facility_id", "reason"]}',
  ARRAY['clients']),

('client.information_updated', 'client', 'Client information modified',
  '{"type": "object", "properties": {"changes": {"type": "object"}}}',
  ARRAY['clients']),

('client.discharged', 'client', 'Client discharged from facility',
  '{"type": "object", "required": ["discharge_date", "discharge_reason"]}',
  ARRAY['clients']),

-- Medication events
('medication.added_to_formulary', 'medication', 'New medication added to formulary',
  '{"type": "object", "required": ["name", "generic_name", "organization_id"]}',
  ARRAY['medications']),

('medication.prescribed', 'medication_history', 'Medication prescribed to client',
  '{"type": "object", "required": ["client_id", "medication_id", "dosage", "frequency", "start_date"]}',
  ARRAY['medication_history']),

('medication.administered', 'dosage', 'Medication dose administered',
  '{"type": "object", "required": ["medication_history_id", "administered_at", "administered_by", "amount"]}',
  ARRAY['dosage_info']),

('medication.skipped', 'dosage', 'Medication dose skipped',
  '{"type": "object", "required": ["medication_history_id", "scheduled_time", "skip_reason"]}',
  ARRAY['dosage_info']),

('medication.discontinued', 'medication_history', 'Medication discontinued',
  '{"type": "object", "required": ["medication_history_id", "discontinue_date", "reason"]}',
  ARRAY['medication_history']),

-- User events
('user.synced_from_zitadel', 'user', 'User synchronized from Zitadel',
  '{"type": "object", "required": ["zitadel_user_id", "email", "roles"]}',
  ARRAY['users']),

('user.organization_switched', 'user', 'User switched organization context',
  '{"type": "object", "required": ["user_id", "from_organization_id", "to_organization_id"]}',
  ARRAY['users', 'audit_log']);

-- Index for lookups
CREATE INDEX idx_event_types_stream ON event_types(stream_type);
CREATE INDEX idx_event_types_active ON event_types(is_active) WHERE is_active = true;

-- Comment
COMMENT ON TABLE event_types IS 'Catalog of all valid event types with schemas and processing rules';