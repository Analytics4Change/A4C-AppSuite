-- Grant All Permissions to Super Admin Role
-- Creates role.permission.granted events for all 22 permissions

DO $$
DECLARE
  perm_record RECORD;
  version_counter INT := 2;  -- Start at version 2 (version 1 was role.created)
BEGIN
  -- Grant all 22 permissions to super_admin role
  -- These will be processed by the RBAC event triggers into role_permissions_projection

  FOR perm_record IN
    SELECT id, applet, action
    FROM permissions_projection
    WHERE applet IN ('organization', 'role', 'permission', 'user')
    ORDER BY applet, action  -- Deterministic ordering for consistent stream versions
  LOOP
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
      '11111111-1111-1111-1111-111111111111',  -- super_admin role stream_id
      'role',
      version_counter,
      'role.permission.granted',
      jsonb_build_object(
        'permission_id', perm_record.id,
        'permission_name', perm_record.applet || '.' || perm_record.action
      ),
      jsonb_build_object(
        'user_id', '00000000-0000-0000-0000-000000000000',
        'reason', 'Bootstrap: Granting ' || perm_record.applet || '.' || perm_record.action || ' to super_admin'
      )
    );

    version_counter := version_counter + 1;
  END LOOP;

  -- Log summary
  RAISE NOTICE 'Granted % permissions to super_admin role', version_counter - 2;
END $$;
