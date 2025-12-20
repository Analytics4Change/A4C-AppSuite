-- Seed Role Permission Templates
-- These templates define which permissions are granted to each role type
-- during organization bootstrap. Platform owners can modify these to
-- customize permission assignments for new organizations.
--
-- NOTE: This seeds the templates table, NOT the actual permission grants.
-- Actual grants are created during org bootstrap via Temporal workflow.

-- Seed provider_admin template (16 permissions)
-- These are the canonical permissions for provider organization admins
INSERT INTO role_permission_templates (role_name, permission_name) VALUES
  -- Organization (4)
  ('provider_admin', 'organization.view_ou'),
  ('provider_admin', 'organization.create_ou'),
  ('provider_admin', 'organization.view'),
  ('provider_admin', 'organization.update'),
  -- Client (4)
  ('provider_admin', 'client.create'),
  ('provider_admin', 'client.view'),
  ('provider_admin', 'client.update'),
  ('provider_admin', 'client.delete'),
  -- Medication (2)
  ('provider_admin', 'medication.create'),
  ('provider_admin', 'medication.view'),
  -- Role (3)
  ('provider_admin', 'role.create'),
  ('provider_admin', 'role.assign'),
  ('provider_admin', 'role.view'),
  -- User (3)
  ('provider_admin', 'user.create'),
  ('provider_admin', 'user.view'),
  ('provider_admin', 'user.update')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- Seed partner_admin template (4 permissions - read-only subset)
-- Partners have limited visibility into provider data
INSERT INTO role_permission_templates (role_name, permission_name) VALUES
  ('partner_admin', 'organization.view'),
  ('partner_admin', 'client.view'),
  ('partner_admin', 'medication.view'),
  ('partner_admin', 'user.view')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- Seed clinician template (core clinical permissions)
-- Clinicians can view/manage clients and medications
INSERT INTO role_permission_templates (role_name, permission_name) VALUES
  ('clinician', 'client.view'),
  ('clinician', 'client.update'),
  ('clinician', 'medication.view'),
  ('clinician', 'medication.create')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- Seed viewer template (read-only access)
INSERT INTO role_permission_templates (role_name, permission_name) VALUES
  ('viewer', 'client.view'),
  ('viewer', 'medication.view'),
  ('viewer', 'user.view')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- Comments for future reference
COMMENT ON TABLE role_permission_templates IS
  'Seeded with canonical permissions for provider_admin (16), partner_admin (4), clinician (4), viewer (3). '
  'Platform owners can modify via SQL or future Admin UI.';
