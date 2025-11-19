-- ========================================
-- Process InvitationRevoked Events
-- ========================================
-- Event-Driven Trigger: Updates invitations_projection when InvitationRevoked events are emitted
--
-- Event Source: domain_events table (event_type = 'InvitationRevoked')
-- Event Emitter: RevokeInvitationsActivity (Temporal workflow compensation)
-- Projection Target: invitations_projection
-- Pattern: CQRS Event Sourcing
-- ========================================

CREATE OR REPLACE FUNCTION process_invitation_revoked_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Update invitation status to 'deleted' based on event data
  UPDATE invitations_projection
  SET
    status = 'deleted',
    updated_at = (NEW.event_data->>'revoked_at')::TIMESTAMPTZ
  WHERE invitation_id = (NEW.event_data->>'invitation_id')::UUID
    AND status = 'pending';  -- Only revoke pending invitations (idempotent)

  -- Return NEW to continue trigger chain
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- ========================================
-- Register Trigger
-- ========================================
-- Fires AFTER INSERT on domain_events for InvitationRevoked events only

-- Drop trigger if exists (idempotency)
DROP TRIGGER IF EXISTS process_invitation_revoked_event ON domain_events;

CREATE TRIGGER process_invitation_revoked_event
AFTER INSERT ON domain_events
FOR EACH ROW
WHEN (NEW.event_type = 'InvitationRevoked')
EXECUTE FUNCTION process_invitation_revoked_event();

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON FUNCTION process_invitation_revoked_event() IS
'Event processor for InvitationRevoked domain events. Updates invitations_projection status to deleted when workflow compensation revokes pending invitations. Idempotent (only updates pending invitations).';
