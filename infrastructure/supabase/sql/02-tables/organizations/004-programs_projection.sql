-- Programs Projection Table
-- CQRS projection maintained by program.* event processors
-- Source of truth: program.* events in audit_log/domain_events table

CREATE TABLE IF NOT EXISTS programs_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations_projection(id) ON DELETE CASCADE,

  -- Program Information
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- residential, outpatient, day_treatment, iop, php, sober_living, mat

  -- Program Details
  description TEXT,
  capacity INTEGER,
  current_occupancy INTEGER DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT true,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_programs_organization
  ON programs_projection(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_programs_type
  ON programs_projection(type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_programs_active
  ON programs_projection(is_active, organization_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Documentation
COMMENT ON TABLE programs_projection IS 'CQRS projection of program.* events - treatment programs offered by organizations';
COMMENT ON COLUMN programs_projection.type IS 'Program type: residential, outpatient, day_treatment, iop, php, sober_living, mat';
COMMENT ON COLUMN programs_projection.capacity IS 'Maximum number of clients this program can serve (NULL = unlimited)';
COMMENT ON COLUMN programs_projection.current_occupancy IS 'Current number of active clients in program';
COMMENT ON COLUMN programs_projection.is_active IS 'Program active status (affects client enrollment)';
