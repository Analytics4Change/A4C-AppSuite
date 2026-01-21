-- Migration: Add missing FK constraints to organizations_projection
-- Tables: impersonation_sessions_projection, cross_tenant_access_grants_projection, user_notification_preferences_projection
-- All use ON DELETE CASCADE to automatically clean up when organizations are deleted

-- 1. impersonation_sessions_projection.target_org_id
-- Tracks super admin impersonation sessions into target organizations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_impersonation_sessions_target_org'
      AND table_name = 'impersonation_sessions_projection'
  ) THEN
    ALTER TABLE impersonation_sessions_projection
    ADD CONSTRAINT fk_impersonation_sessions_target_org
    FOREIGN KEY (target_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 2. cross_tenant_access_grants_projection.provider_org_id
-- Target provider organization owning the data being accessed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cross_tenant_grants_provider_org'
      AND table_name = 'cross_tenant_access_grants_projection'
  ) THEN
    ALTER TABLE cross_tenant_access_grants_projection
    ADD CONSTRAINT fk_cross_tenant_grants_provider_org
    FOREIGN KEY (provider_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 3. cross_tenant_access_grants_projection.consultant_org_id
-- Provider_partner organization requesting access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cross_tenant_grants_consultant_org'
      AND table_name = 'cross_tenant_access_grants_projection'
  ) THEN
    ALTER TABLE cross_tenant_access_grants_projection
    ADD CONSTRAINT fk_cross_tenant_grants_consultant_org
    FOREIGN KEY (consultant_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 4. user_notification_preferences_projection.organization_id
-- Organization-specific notification preferences for users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_notification_prefs_org'
      AND table_name = 'user_notification_preferences_projection'
  ) THEN
    ALTER TABLE user_notification_preferences_projection
    ADD CONSTRAINT fk_user_notification_prefs_org
    FOREIGN KEY (organization_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Verification query (run after migration to confirm):
-- SELECT tc.table_name, tc.constraint_name, kcu.column_name
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON tc.constraint_name = kcu.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY'
--   AND tc.constraint_name IN (
--     'fk_impersonation_sessions_target_org',
--     'fk_cross_tenant_grants_provider_org',
--     'fk_cross_tenant_grants_consultant_org',
--     'fk_user_notification_prefs_org'
--   );
