-- Phase 6: Backfill provider_admin Permissions
-- =============================================
-- 1. Add 4 missing permissions to role_permission_templates (for NEW orgs)
-- 2. Backfill 23 permissions to existing provider_admin roles (EXISTING orgs)
--
-- Complete provider_admin Permission Set (23 total):
--   Organization (4): view_ou, create_ou, view, update
--   Client (4): create, view, update, delete
--   Medication (5): create, view, update, delete, administer
--   Role (4): create, view, update, delete
--   User (6): create, view, update, delete, role_assign, role_revoke

-- Step 1: Add 4 missing permissions to role_permission_templates
-- These are needed for NEW organizations bootstrapped via Temporal workflow
INSERT INTO role_permission_templates (role_name, permission_name)
VALUES
  ('provider_admin', 'medication.administer'),
  ('provider_admin', 'role.delete'),
  ('provider_admin', 'role.update'),
  ('provider_admin', 'user.delete')
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- Step 2: Backfill all 23 permissions to existing provider_admin roles
-- Using direct insert with ON CONFLICT for idempotency
INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM roles_projection r
CROSS JOIN permissions_projection p
WHERE r.name = 'provider_admin'
  AND p.applet || '.' || p.action IN (
    -- Organization (4)
    'organization.view_ou', 'organization.create_ou', 'organization.view', 'organization.update',
    -- Client (4)
    'client.create', 'client.view', 'client.update', 'client.delete',
    -- Medication (5)
    'medication.create', 'medication.view', 'medication.update', 'medication.delete', 'medication.administer',
    -- Role (4)
    'role.create', 'role.view', 'role.update', 'role.delete',
    -- User (6)
    'user.create', 'user.view', 'user.update', 'user.delete', 'user.role_assign', 'user.role_revoke'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Step 3: Verification
DO $$
DECLARE
  v_template_count INT;
  v_role RECORD;
BEGIN
  -- Verify template has 23 permissions
  SELECT COUNT(*) INTO v_template_count
  FROM role_permission_templates WHERE role_name = 'provider_admin';

  RAISE NOTICE 'provider_admin template permissions: % (expected: 23)', v_template_count;

  -- Verify each role has 23 permissions
  FOR v_role IN
    SELECT r.id, o.name as org_name, COUNT(rp.permission_id) as perm_count
    FROM roles_projection r
    JOIN organizations_projection o ON o.id = r.organization_id
    LEFT JOIN role_permissions_projection rp ON rp.role_id = r.id
    WHERE r.name = 'provider_admin'
    GROUP BY r.id, o.name
  LOOP
    RAISE NOTICE '  %: % permissions (expected: 23)', v_role.org_name, v_role.perm_count;
  END LOOP;
END $$;
