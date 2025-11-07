-- ========================================
-- Invitations Projection Table
-- ========================================
-- CQRS Read Model: Updated by UserInvited domain events from Temporal workflows
--
-- Purpose: Stores user invitation tokens and acceptance status
-- Event Source: UserInvited events (emitted by GenerateInvitationsActivity)
-- Updated By: process_user_invited_event() trigger
--
-- Naming Convention: All projection tables use _projection suffix for consistency
-- Related Tables: organizations_projection (foreign key)
-- Edge Functions: validate-invitation, accept-invitation query this table
-- ========================================

CREATE TABLE IF NOT EXISTS invitations_projection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations_projection(id),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Development entity tracking
  -- Tags: ['development', 'test', 'mode:development']
  -- Used by cleanup script to identify and delete test data
  tags TEXT[] DEFAULT '{}',

  CONSTRAINT chk_invitation_status CHECK (status IN ('pending', 'accepted', 'expired', 'deleted'))
);

-- ========================================
-- Indexes for Performance
-- ========================================

-- Primary lookup: Edge Functions validate token
CREATE INDEX idx_invitations_projection_token
ON invitations_projection(token);

-- Query invitations by organization
CREATE INDEX idx_invitations_projection_org_email
ON invitations_projection(organization_id, email);

-- Query by status (find pending invitations)
CREATE INDEX idx_invitations_projection_status
ON invitations_projection(status);

-- Development entity cleanup (GIN index for array contains)
CREATE INDEX idx_invitations_projection_tags
ON invitations_projection USING GIN(tags);

-- ========================================
-- Row Level Security (RLS)
-- ========================================
-- Enable RLS for multi-tenant data isolation
ALTER TABLE invitations_projection ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see invitations for their organization
-- Note: Service role bypasses RLS, Edge Functions use service role
-- CREATE POLICY "Users can view their organization's invitations"
-- ON invitations_projection FOR SELECT
-- USING (organization_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::UUID);

-- ========================================
-- Comments for Documentation
-- ========================================
COMMENT ON TABLE invitations_projection IS
'CQRS projection of user invitations. Updated by UserInvited domain events from Temporal workflows. Queried by Edge Functions for invitation validation and acceptance.';

COMMENT ON COLUMN invitations_projection.invitation_id IS
'UUID from domain event (aggregate ID). Used for event correlation.';

COMMENT ON COLUMN invitations_projection.token IS
'256-bit cryptographically secure URL-safe base64 token. Used in invitation email link.';

COMMENT ON COLUMN invitations_projection.expires_at IS
'Invitation expiration timestamp (7 days from creation). Edge Functions check this.';

COMMENT ON COLUMN invitations_projection.tags IS
'Development entity tracking tags. Examples: ["development", "test", "mode:development"]. Used by cleanup script to identify and delete test data.';

COMMENT ON COLUMN invitations_projection.status IS
'Invitation lifecycle status: pending (initial), accepted (user accepted), expired (past expires_at), deleted (soft delete by cleanup script)';
