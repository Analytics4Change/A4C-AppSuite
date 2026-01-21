-- ============================================================================
-- Migration: Unified Phone Lookup RPC
-- Purpose: Get all phones for a "person" (contact + linked user phones if any)
-- ============================================================================

-- ============================================================================
-- api.get_person_phones
-- Returns contact phones + user phones if contact has linked user_id
-- Provides unified view of all phones associated with a person
-- ============================================================================

CREATE OR REPLACE FUNCTION api.get_person_phones(p_contact_id UUID)
RETURNS TABLE (
  id UUID,
  source TEXT,  -- 'contact' or 'user'
  label TEXT,
  phone_type phone_type,
  number TEXT,
  extension TEXT,
  country_code TEXT,
  sms_capable BOOLEAN,
  is_primary BOOLEAN,
  is_mirrored BOOLEAN  -- true if user phone was mirrored from contact
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get user_id if contact is linked to a user
  SELECT c.user_id INTO v_user_id
  FROM contacts_projection c
  WHERE c.id = p_contact_id
    AND c.deleted_at IS NULL;

  -- Return contact phones
  RETURN QUERY
  SELECT
    p.id,
    'contact'::TEXT AS source,
    p.label,
    p.type AS phone_type,
    p.number,
    p.extension,
    p.country_code,
    (p.type = 'mobile')::BOOLEAN AS sms_capable,  -- Mobile phones assumed SMS capable
    COALESCE(p.is_primary, false) AS is_primary,
    false AS is_mirrored  -- Contact phones are never "mirrored"
  FROM phones_projection p
  JOIN contact_phones cp ON cp.phone_id = p.id
  WHERE cp.contact_id = p_contact_id
    AND p.deleted_at IS NULL
    AND COALESCE(p.is_active, true) = true;

  -- If contact has linked user, also return user phones
  IF v_user_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      up.id,
      'user'::TEXT AS source,
      up.label,
      up.type AS phone_type,
      up.number,
      up.extension,
      up.country_code,
      up.sms_capable,
      up.is_primary,
      (up.source_contact_phone_id IS NOT NULL) AS is_mirrored
    FROM user_phones up
    WHERE up.user_id = v_user_id
      AND up.is_active = true;
  END IF;
END;
$$;

ALTER FUNCTION api.get_person_phones(UUID) OWNER TO postgres;

COMMENT ON FUNCTION api.get_person_phones(UUID) IS
  'Get all phones for a person (contact + user if linked). Returns source to distinguish '
  'contact phones from user phones, and is_mirrored to identify auto-copied phones.';

GRANT EXECUTE ON FUNCTION api.get_person_phones(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_person_phones(UUID) TO service_role;
