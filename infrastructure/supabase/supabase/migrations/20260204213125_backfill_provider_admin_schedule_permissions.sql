-- =============================================================================
-- Migration: Backfill provider_admin schedule/assignment permissions
-- Purpose: Emit role.permission.granted events for existing provider_admin roles
--          that are missing user.schedule_manage and user.client_assign permissions
-- Reference: documentation/architecture/authorization/provider-admin-permissions-architecture.md
--            This implements "Phase 3: Cutover" - backfill for existing roles
-- =============================================================================

-- For each provider_admin role that's missing these permissions,
-- emit role.permission.granted events. The existing event processor
-- (handle_role_permission_granted in process_rbac_event) will update
-- role_permissions_projection.

-- Use a CTE to calculate the next stream_version for each role
WITH role_max_versions AS (
  -- Get current max stream_version for each role
  SELECT stream_id, COALESCE(MAX(stream_version), 0) as max_version
  FROM domain_events
  WHERE stream_type = 'role'
  GROUP BY stream_id
),
permissions_to_grant AS (
  -- Get the permissions that need to be granted, with row numbers for versioning
  SELECT
    r.id as role_id,
    r.organization_id,
    p.id as permission_id,
    p.name as permission_name,
    ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY p.name) as row_num
  FROM roles_projection r
  CROSS JOIN permissions_projection p
  WHERE r.name = 'provider_admin'
    AND p.name IN ('user.schedule_manage', 'user.client_assign')
    AND NOT EXISTS (
      SELECT 1 FROM role_permissions_projection rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
    )
)
INSERT INTO domain_events (stream_type, stream_id, stream_version, event_type, event_data, event_metadata)
SELECT
  'role',
  ptg.role_id,
  COALESCE(rmv.max_version, 0) + ptg.row_num,
  'role.permission.granted',
  jsonb_build_object(
    'role_id', ptg.role_id,
    'permission_id', ptg.permission_id,
    'permission_name', ptg.permission_name,
    'organization_id', ptg.organization_id
  ),
  jsonb_build_object(
    'reason', 'Backfill: Phase 7 schedule/assignment permissions for existing provider_admin roles',
    'migration', '20260204213125_backfill_provider_admin_schedule_permissions'
  )
FROM permissions_to_grant ptg
LEFT JOIN role_max_versions rmv ON rmv.stream_id = ptg.role_id;
