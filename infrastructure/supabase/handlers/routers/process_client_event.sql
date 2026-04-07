CREATE OR REPLACE FUNCTION public.process_client_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type

        -- Lifecycle events (from B2a-1)
        WHEN 'client.registered' THEN
            PERFORM handle_client_registered(p_event);

        WHEN 'client.information_updated' THEN
            PERFORM handle_client_information_updated(p_event);

        WHEN 'client.admitted' THEN
            PERFORM handle_client_admitted(p_event);

        WHEN 'client.discharged' THEN
            PERFORM handle_client_discharged(p_event);

        -- Phone sub-entity
        WHEN 'client.phone.added' THEN
            PERFORM handle_client_phone_added(p_event);

        WHEN 'client.phone.updated' THEN
            PERFORM handle_client_phone_updated(p_event);

        WHEN 'client.phone.removed' THEN
            PERFORM handle_client_phone_removed(p_event);

        -- Email sub-entity
        WHEN 'client.email.added' THEN
            PERFORM handle_client_email_added(p_event);

        WHEN 'client.email.updated' THEN
            PERFORM handle_client_email_updated(p_event);

        WHEN 'client.email.removed' THEN
            PERFORM handle_client_email_removed(p_event);

        -- Address sub-entity
        WHEN 'client.address.added' THEN
            PERFORM handle_client_address_added(p_event);

        WHEN 'client.address.updated' THEN
            PERFORM handle_client_address_updated(p_event);

        WHEN 'client.address.removed' THEN
            PERFORM handle_client_address_removed(p_event);

        -- Insurance sub-entity
        WHEN 'client.insurance.added' THEN
            PERFORM handle_client_insurance_added(p_event);

        WHEN 'client.insurance.updated' THEN
            PERFORM handle_client_insurance_updated(p_event);

        WHEN 'client.insurance.removed' THEN
            PERFORM handle_client_insurance_removed(p_event);

        -- Placement sub-entity
        WHEN 'client.placement.changed' THEN
            PERFORM handle_client_placement_changed(p_event);

        WHEN 'client.placement.ended' THEN
            PERFORM handle_client_placement_ended(p_event);

        -- Funding source sub-entity
        WHEN 'client.funding_source.added' THEN
            PERFORM handle_client_funding_source_added(p_event);

        WHEN 'client.funding_source.updated' THEN
            PERFORM handle_client_funding_source_updated(p_event);

        WHEN 'client.funding_source.removed' THEN
            PERFORM handle_client_funding_source_removed(p_event);

        -- Contact assignment
        WHEN 'client.contact.assigned' THEN
            PERFORM handle_client_contact_assigned(p_event);

        WHEN 'client.contact.unassigned' THEN
            PERFORM handle_client_contact_unassigned(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;
