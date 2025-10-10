-- Enable Row Level Security on all tables
-- This must be done before creating policies

-- Core tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE dosage_info ENABLE ROW LEVEL SECURITY;

-- Audit tables (might have different RLS requirements)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_audit_log ENABLE ROW LEVEL SECURITY;

-- Note: After enabling RLS, tables will deny all access by default
-- Policies must be created to allow appropriate access