CREATE OR REPLACE FUNCTION public.process_organization_unit_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'organization_unit.created' THEN PERFORM handle_organization_unit_created(p_event);
    WHEN 'organization_unit.updated' THEN PERFORM handle_organization_unit_updated(p_event);
    WHEN 'organization_unit.deactivated' THEN PERFORM handle_organization_unit_deactivated(p_event);
    WHEN 'organization_unit.reactivated' THEN PERFORM handle_organization_unit_reactivated(p_event);
    WHEN 'organization_unit.deleted' THEN PERFORM handle_organization_unit_deleted(p_event);
    ELSE
      RAISE WARNING 'Unknown organization_unit event type: %', p_event.event_type;
  END CASE;
END;
$function$;
