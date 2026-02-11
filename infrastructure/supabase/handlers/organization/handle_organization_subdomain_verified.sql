CREATE OR REPLACE FUNCTION public.handle_organization_subdomain_verified(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE organizations_projection
  SET subdomain_status = 'verified',
      updated_at = p_event.created_at
  WHERE id = p_event.stream_id;
END;
$function$;
