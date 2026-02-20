CREATE OR REPLACE FUNCTION public.process_junction_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'organization.contact.linked' THEN
      INSERT INTO organization_contacts (organization_id, contact_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
      ) ON CONFLICT (organization_id, contact_id) DO NOTHING;

    WHEN 'organization.contact.unlinked' THEN
      DELETE FROM organization_contacts
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');

    WHEN 'organization.address.linked' THEN
      INSERT INTO organization_addresses (organization_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      ) ON CONFLICT (organization_id, address_id) DO NOTHING;

    WHEN 'organization.address.unlinked' THEN
      DELETE FROM organization_addresses
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    WHEN 'organization.phone.linked' THEN
      INSERT INTO organization_phones (organization_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      ) ON CONFLICT (organization_id, phone_id) DO NOTHING;

    WHEN 'organization.phone.unlinked' THEN
      DELETE FROM organization_phones
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    WHEN 'organization.email.linked' THEN
      INSERT INTO organization_emails (organization_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      ) ON CONFLICT (organization_id, email_id) DO NOTHING;

    WHEN 'organization.email.unlinked' THEN
      DELETE FROM organization_emails
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    WHEN 'contact.phone.linked' THEN
      INSERT INTO contact_phones (contact_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      ) ON CONFLICT (contact_id, phone_id) DO NOTHING;

    WHEN 'contact.phone.unlinked' THEN
      DELETE FROM contact_phones
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    WHEN 'contact.address.linked' THEN
      INSERT INTO contact_addresses (contact_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      ) ON CONFLICT (contact_id, address_id) DO NOTHING;

    WHEN 'contact.address.unlinked' THEN
      DELETE FROM contact_addresses
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    WHEN 'contact.email.linked' THEN
      INSERT INTO contact_emails (contact_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      ) ON CONFLICT (contact_id, email_id) DO NOTHING;

    WHEN 'contact.email.unlinked' THEN
      DELETE FROM contact_emails
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    WHEN 'phone.address.linked' THEN
      INSERT INTO phone_addresses (phone_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      ) ON CONFLICT (phone_id, address_id) DO NOTHING;

    WHEN 'phone.address.unlinked' THEN
      DELETE FROM phone_addresses
      WHERE phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_junction_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;
