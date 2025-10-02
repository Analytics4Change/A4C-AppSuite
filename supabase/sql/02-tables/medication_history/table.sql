-- Medication History Table
-- Tracks all medication prescriptions and administration history
CREATE TABLE IF NOT EXISTS medication_history (

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
  dosage_form TEXT, -- Broad category (Solid, Liquid, etc.)
  frequency TEXT, -- Can be comma-separated or JSON array
  timings TEXT[], -- Timing conditions (morning, evening, bedtime, etc.)
  food_conditions TEXT[], -- Food restrictions (with_food, without_food, etc.)
  special_restrictions TEXT[], -- Special restrictions
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
  pharmacy_phone TEXT,
  rx_number TEXT, -- Prescription number

  -- Inventory Tracking
  inventory_quantity DECIMAL,
  inventory_unit TEXT,

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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE medication_history IS 'Tracks all medication prescriptions and administration history';