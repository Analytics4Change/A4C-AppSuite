-- Medications Table
-- Medication catalog with comprehensive drug information
CREATE TABLE IF NOT EXISTS medications (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,

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
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE medications IS 'Medication catalog with comprehensive drug information';