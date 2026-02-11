CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.activated' THEN PERFORM handle_organization_activated(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);
    WHEN 'organization.direct_care_settings_updated' THEN PERFORM handle_organization_direct_care_settings_updated(p_event);
    WHEN 'organization.bootstrap.initiated' THEN NULL;
    WHEN 'organization.bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'organization.bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'organization.bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);
    ELSE
      RAISE EXCEPTION 'Unhandled event type % in process_organization_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;
