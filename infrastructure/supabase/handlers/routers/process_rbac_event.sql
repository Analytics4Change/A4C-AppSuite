CREATE OR REPLACE FUNCTION public.process_rbac_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'role.created' THEN PERFORM handle_role_created(p_event);
    WHEN 'role.updated' THEN PERFORM handle_role_updated(p_event);
    WHEN 'role.deactivated' THEN PERFORM handle_role_deactivated(p_event);
    WHEN 'role.reactivated' THEN PERFORM handle_role_reactivated(p_event);
    WHEN 'role.deleted' THEN PERFORM handle_role_deleted(p_event);
    WHEN 'role.permission.granted' THEN PERFORM handle_role_permission_granted(p_event);
    WHEN 'role.permission.revoked' THEN PERFORM handle_role_permission_revoked(p_event);
    WHEN 'permission.defined' THEN PERFORM handle_permission_defined(p_event);
    WHEN 'permission.updated' THEN PERFORM handle_permission_updated(p_event);
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_rbac_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;
