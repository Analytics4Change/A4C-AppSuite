-- api.get_invitation_for_resend(p_invitation_id, p_org_id)
-- Returns invitation details needed for resend operation
-- Authorization: Caller must have user.create permission (checked by edge function)
--
-- Used by: invite-user edge function (resend operation)

CREATE OR REPLACE FUNCTION api.get_invitation_for_resend(
  p_invitation_id UUID,
  p_org_id UUID
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  status TEXT,
  roles JSONB,
  access_start_date DATE,
  access_expiration_date DATE,
  notification_preferences JSONB,
  organization_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, api
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.first_name,
    i.last_name,
    i.status,
    i.roles,
    i.access_start_date,
    i.access_expiration_date,
    i.notification_preferences,
    i.organization_id
  FROM public.invitations_projection i
  WHERE i.id = p_invitation_id
    AND i.organization_id = p_org_id;
END;
$$;

COMMENT ON FUNCTION api.get_invitation_for_resend(UUID, UUID) IS
  'Get invitation details for resend operation. Called by invite-user edge function.';

GRANT EXECUTE ON FUNCTION api.get_invitation_for_resend(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION api.get_invitation_for_resend(UUID, UUID) TO service_role;
