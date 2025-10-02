-- Dosage Info Table
-- Tracks actual medication administration events
CREATE TABLE IF NOT EXISTS dosage_info (

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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE dosage_info IS 'Tracks actual medication administration events';