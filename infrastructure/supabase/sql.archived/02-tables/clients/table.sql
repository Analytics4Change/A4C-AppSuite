-- Clients Table
-- Patient/client records with full medical information
CREATE TABLE IF NOT EXISTS clients (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,

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
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE clients IS 'Patient/client records with full medical information';