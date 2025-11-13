-- Row-Level Security Policies for Clinical Tables
-- CRITICAL FIX: These tables had RLS enabled but NO policies defined
-- Impact: Without policies, tables deny ALL access (production blocker)
-- Date: 2025-11-13
-- Ref: documentation/MIGRATION_REPORT.md Phase 7.4 (RLS Gaps)

-- ============================================================================
-- Clients Table
-- ============================================================================

-- Super admins can view all client records across all organizations
DROP POLICY IF EXISTS clients_super_admin_select ON clients;
CREATE POLICY clients_super_admin_select
  ON clients
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view clients in their own organization
DROP POLICY IF EXISTS clients_org_select ON clients;
CREATE POLICY clients_org_select
  ON clients
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Organization admins and users with permission can create clients
DROP POLICY IF EXISTS clients_insert ON clients;
CREATE POLICY clients_insert
  ON clients
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    is_org_admin(get_current_user_id(), organization_id) OR
    user_has_permission(get_current_user_id(), 'clients.create', organization_id)
  );

-- Super admins and users with permission can update clients
DROP POLICY IF EXISTS clients_update ON clients;
CREATE POLICY clients_update
  ON clients
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'clients.update', organization_id)
    )
  );

-- Super admins and users with permission can delete clients
-- NOTE: Prefer status='archived' over DELETE in most cases
DROP POLICY IF EXISTS clients_delete ON clients;
CREATE POLICY clients_delete
  ON clients
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'clients.delete', organization_id)
    )
  );

COMMENT ON POLICY clients_super_admin_select ON clients IS
  'Allows super admins to view all client records across all organizations';
COMMENT ON POLICY clients_org_select ON clients IS
  'Allows organization users to view clients in their own organization';
COMMENT ON POLICY clients_insert ON clients IS
  'Allows organization admins and authorized users to create client records';
COMMENT ON POLICY clients_update ON clients IS
  'Allows authorized users to update client records in their organization';
COMMENT ON POLICY clients_delete ON clients IS
  'Allows authorized users to delete client records (prefer archiving)';


-- ============================================================================
-- Medications Table
-- ============================================================================

-- Super admins can view all medications across all organizations
DROP POLICY IF EXISTS medications_super_admin_select ON medications;
CREATE POLICY medications_super_admin_select
  ON medications
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view medications in their own organization
DROP POLICY IF EXISTS medications_org_select ON medications;
CREATE POLICY medications_org_select
  ON medications
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Organization admins and pharmacy staff can create medications
DROP POLICY IF EXISTS medications_insert ON medications;
CREATE POLICY medications_insert
  ON medications
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND (
        is_org_admin(get_current_user_id(), organization_id)
        OR user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
      )
    )
  );

-- Super admins and pharmacy staff can update medications
DROP POLICY IF EXISTS medications_update ON medications;
CREATE POLICY medications_update
  ON medications
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );

-- Super admins and authorized pharmacy staff can delete medications
DROP POLICY IF EXISTS medications_delete ON medications;
CREATE POLICY medications_delete
  ON medications
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.manage', organization_id)
    )
  );

COMMENT ON POLICY medications_super_admin_select ON medications IS
  'Allows super admins to view all medication formularies across all organizations';
COMMENT ON POLICY medications_org_select ON medications IS
  'Allows organization users to view medications in their own formulary';
COMMENT ON POLICY medications_insert ON medications IS
  'Allows organization admins and pharmacy staff to add medications to formulary';
COMMENT ON POLICY medications_update ON medications IS
  'Allows pharmacy staff to update medication information';
COMMENT ON POLICY medications_delete ON medications IS
  'Allows authorized pharmacy staff to remove medications from formulary';


-- ============================================================================
-- Medication History Table
-- ============================================================================

-- Super admins can view all prescription records across all organizations
DROP POLICY IF EXISTS medication_history_super_admin_select ON medication_history;
CREATE POLICY medication_history_super_admin_select
  ON medication_history
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view prescription records in their own organization
DROP POLICY IF EXISTS medication_history_org_select ON medication_history;
CREATE POLICY medication_history_org_select
  ON medication_history
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Prescribers can create prescriptions in their organization
DROP POLICY IF EXISTS medication_history_insert ON medication_history;
CREATE POLICY medication_history_insert
  ON medication_history
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
    )
  );

-- Prescribers can update prescriptions in their organization
DROP POLICY IF EXISTS medication_history_update ON medication_history;
CREATE POLICY medication_history_update
  ON medication_history
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND (
        user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
        OR prescribed_by = get_current_user_id()
      )
    )
  );

-- Prescribers can discontinue prescriptions in their organization
DROP POLICY IF EXISTS medication_history_delete ON medication_history;
CREATE POLICY medication_history_delete
  ON medication_history
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.prescribe', organization_id)
    )
  );

COMMENT ON POLICY medication_history_super_admin_select ON medication_history IS
  'Allows super admins to view all prescription records across all organizations';
COMMENT ON POLICY medication_history_org_select ON medication_history IS
  'Allows organization users to view prescription records in their own organization';
COMMENT ON POLICY medication_history_insert ON medication_history IS
  'Allows authorized prescribers to create prescriptions in their organization';
COMMENT ON POLICY medication_history_update ON medication_history IS
  'Allows prescribers to update their prescriptions in their organization';
COMMENT ON POLICY medication_history_delete ON medication_history IS
  'Allows authorized prescribers to discontinue prescriptions';


-- ============================================================================
-- Dosage Info Table
-- ============================================================================

-- Super admins can view all dosage records across all organizations
DROP POLICY IF EXISTS dosage_info_super_admin_select ON dosage_info;
CREATE POLICY dosage_info_super_admin_select
  ON dosage_info
  FOR SELECT
  USING (is_super_admin(get_current_user_id()));

-- Organization users can view dosage records in their own organization
DROP POLICY IF EXISTS dosage_info_org_select ON dosage_info;
CREATE POLICY dosage_info_org_select
  ON dosage_info
  FOR SELECT
  USING (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Medication administrators can schedule doses
DROP POLICY IF EXISTS dosage_info_insert ON dosage_info;
CREATE POLICY dosage_info_insert
  ON dosage_info
  FOR INSERT
  WITH CHECK (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
    )
  );

-- Medication administrators and staff who administered can update doses
DROP POLICY IF EXISTS dosage_info_update ON dosage_info;
CREATE POLICY dosage_info_update
  ON dosage_info
  FOR UPDATE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND (
        user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
        OR administered_by = get_current_user_id()
      )
    )
  );

-- Super admins and medication administrators can delete dosage records
DROP POLICY IF EXISTS dosage_info_delete ON dosage_info;
CREATE POLICY dosage_info_delete
  ON dosage_info
  FOR DELETE
  USING (
    is_super_admin(get_current_user_id()) OR
    (
      organization_id = (auth.jwt()->>'org_id')::uuid
      AND user_has_permission(get_current_user_id(), 'medications.administer', organization_id)
    )
  );

COMMENT ON POLICY dosage_info_super_admin_select ON dosage_info IS
  'Allows super admins to view all dosage records across all organizations';
COMMENT ON POLICY dosage_info_org_select ON dosage_info IS
  'Allows organization users to view dosage records in their own organization';
COMMENT ON POLICY dosage_info_insert ON dosage_info IS
  'Allows medication administrators to schedule doses in their organization';
COMMENT ON POLICY dosage_info_update ON dosage_info IS
  'Allows medication administrators and administering staff to update dose records';
COMMENT ON POLICY dosage_info_delete ON dosage_info IS
  'Allows medication administrators to delete dosage records';
