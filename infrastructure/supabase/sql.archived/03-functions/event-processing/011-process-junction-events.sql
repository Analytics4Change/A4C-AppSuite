-- Junction Table Event Processing Functions
-- Handles all junction link/unlink events with CQRS-compliant projections
-- Source events: *.linked and *.unlinked events in domain_events table
--
-- Supported junction types:
--   - organization.contact.linked/unlinked (org → contact)
--   - organization.address.linked/unlinked (org → address)
--   - organization.phone.linked/unlinked (org → phone)
--   - contact.phone.linked/unlinked (contact → phone)
--   - contact.address.linked/unlinked (contact → address)
--   - phone.address.linked/unlinked (phone → address)

-- Main junction event processor
CREATE OR REPLACE FUNCTION process_junction_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type

    -- Organization-Contact Links
    WHEN 'organization.contact.linked' THEN
      INSERT INTO organization_contacts (organization_id, contact_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
      )
      ON CONFLICT (organization_id, contact_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.contact.unlinked' THEN
      DELETE FROM organization_contacts
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');

    -- Organization-Address Links
    WHEN 'organization.address.linked' THEN
      INSERT INTO organization_addresses (organization_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (organization_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.address.unlinked' THEN
      DELETE FROM organization_addresses
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Organization-Phone Links
    WHEN 'organization.phone.linked' THEN
      INSERT INTO organization_phones (organization_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (organization_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.phone.unlinked' THEN
      DELETE FROM organization_phones
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Contact-Phone Links
    WHEN 'contact.phone.linked' THEN
      INSERT INTO contact_phones (contact_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (contact_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.phone.unlinked' THEN
      DELETE FROM contact_phones
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Contact-Address Links
    WHEN 'contact.address.linked' THEN
      INSERT INTO contact_addresses (contact_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (contact_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.address.unlinked' THEN
      DELETE FROM contact_addresses
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Phone-Address Links
    WHEN 'phone.address.linked' THEN
      INSERT INTO phone_addresses (phone_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (phone_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'phone.address.unlinked' THEN
      DELETE FROM phone_addresses
      WHERE phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    ELSE
      RAISE WARNING 'Unknown junction event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION process_junction_event IS
  'Main junction event processor - handles link/unlink for all 6 junction table types (org-contact, org-address, org-phone, contact-phone, contact-address, phone-address)';
