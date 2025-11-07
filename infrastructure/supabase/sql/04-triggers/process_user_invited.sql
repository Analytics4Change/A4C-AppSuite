-- ========================================
-- Process UserInvited Events
-- ========================================
-- Event-Driven Trigger: Updates invitations_projection when UserInvited events are emitted
--
-- Event Source: domain_events table (event_type = 'UserInvited')
-- Event Emitter: GenerateInvitationsActivity (Temporal workflow)
-- Projection Target: invitations_projection
-- Pattern: CQRS Event Sourcing
-- ========================================

CREATE OR REPLACE FUNCTION process_user_invited_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Extract event data and insert/update invitation projection
  INSERT INTO invitations_projection (
    invitation_id,
    organization_id,
    email,
    first_name,
    last_name,
    role,
    token,
    expires_at,
    tags
  )
  VALUES (
    -- Extract from event_data (JSONB)
    (NEW.event_data->>'invitation_id')::UUID,
    (NEW.event_data->>'org_id')::UUID,
    NEW.event_data->>'email',
    NEW.event_data->>'first_name',
    NEW.event_data->>'last_name',
    NEW.event_data->>'role',
    NEW.event_data->>'token',
    (NEW.event_data->>'expires_at')::TIMESTAMPTZ,

    -- Extract tags from event_metadata (JSONB array)
    -- Coalesce to empty array if tags not present
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(NEW.event_metadata->'tags')),
      '{}'::TEXT[]
    )
  )
  ON CONFLICT (invitation_id) DO NOTHING;  -- Idempotency: ignore duplicate events

  -- Return NEW to continue trigger chain
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Register Trigger
-- ========================================
-- Fires AFTER INSERT on domain_events for UserInvited events only

-- Drop trigger if exists (idempotency)
DROP TRIGGER IF EXISTS process_user_invited_event ON domain_events;

CREATE TRIGGER process_user_invited_event
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.event_type = 'UserInvited')
EXECUTE FUNCTION process_user_invited_event();

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON FUNCTION process_user_invited_event() IS
'Event processor for UserInvited domain events. Updates invitations_projection with invitation data from Temporal workflows. Idempotent (ON CONFLICT DO NOTHING).';
