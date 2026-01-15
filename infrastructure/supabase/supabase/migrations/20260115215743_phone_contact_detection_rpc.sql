-- ============================================================================
-- Migration: Phone-Based Contact Detection RPC
-- Purpose: Detect contacts by phone number for user-contact linking in admin UI
-- ============================================================================

-- ============================================================================
-- api.find_contacts_by_phone
-- Returns contacts that have a matching phone number
-- Used when admin enters a phone number for a user, to suggest contact linking
-- ============================================================================

CREATE OR REPLACE FUNCTION api.find_contacts_by_phone(
  p_organization_id UUID,
  p_phone_number TEXT
)
RETURNS TABLE (
  contact_id UUID,
  contact_name TEXT,
  contact_type contact_type,
  contact_email TEXT,
  is_shared BOOLEAN  -- true if phone is used by multiple contacts
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_normalized_phone TEXT;
  v_phone_contact_count INT;
BEGIN
  -- Normalize phone number: remove non-digits for comparison
  v_normalized_phone := regexp_replace(p_phone_number, '[^0-9]', '', 'g');

  -- Count how many contacts have this phone (for is_shared flag)
  SELECT COUNT(DISTINCT cp.contact_id) INTO v_phone_contact_count
  FROM phones_projection p
  JOIN contact_phones cp ON cp.phone_id = p.id
  JOIN contacts_projection c ON c.id = cp.contact_id
  WHERE regexp_replace(p.number, '[^0-9]', '', 'g') = v_normalized_phone
    AND c.organization_id = p_organization_id
    AND p.deleted_at IS NULL
    AND c.deleted_at IS NULL;

  -- Return matching contacts
  RETURN QUERY
  SELECT
    c.id AS contact_id,
    CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
    c.type AS contact_type,
    c.email AS contact_email,
    (v_phone_contact_count > 1) AS is_shared
  FROM phones_projection p
  JOIN contact_phones cp ON cp.phone_id = p.id
  JOIN contacts_projection c ON c.id = cp.contact_id
  WHERE regexp_replace(p.number, '[^0-9]', '', 'g') = v_normalized_phone
    AND c.organization_id = p_organization_id
    AND p.deleted_at IS NULL
    AND c.deleted_at IS NULL;
END;
$$;

ALTER FUNCTION api.find_contacts_by_phone(UUID, TEXT) OWNER TO postgres;

COMMENT ON FUNCTION api.find_contacts_by_phone(UUID, TEXT) IS
  'Find contacts by phone number. Used when admin enters a phone for a user to suggest contact linking. '
  'Returns is_shared=true if phone is used by multiple contacts (requires user confirmation).';

GRANT EXECUTE ON FUNCTION api.find_contacts_by_phone(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION api.find_contacts_by_phone(UUID, TEXT) TO service_role;
