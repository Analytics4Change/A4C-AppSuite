-- Row-Level Security Policy for domain_events INSERT
-- Allows authenticated users to emit events with proper validation
--
-- Per architect review (2024-12-20):
-- - Keep EventEmitter as direct INSERT (not RPC) per CQRS principle
-- - RLS policy provides security without duplicate RPC layer
-- - Validates: user authenticated, org_id matches JWT, reason >= 10 chars
--
-- IMPORTANT: Super admin policy already exists (domain_events_super_admin_all)
-- This policy adds INSERT capability for non-super_admin authenticated users

-- ============================================================================
-- Domain Events INSERT Policy (Authenticated Users)
-- ============================================================================

-- Policy: Authenticated users can INSERT events
-- Validates:
--   1. User is authenticated (auth.uid() IS NOT NULL)
--   2. org_id in event_metadata matches JWT org_id claim
--   3. reason in event_metadata is at least 10 characters
DROP POLICY IF EXISTS domain_events_authenticated_insert ON domain_events;
CREATE POLICY domain_events_authenticated_insert
  ON domain_events
  FOR INSERT
  WITH CHECK (
    -- Must be authenticated
    auth.uid() IS NOT NULL
    AND (
      -- Either super_admin (bypass org check)
      is_super_admin(get_current_user_id())
      OR (
        -- Or org_id must match JWT claim
        (event_metadata->>'organization_id')::uuid = (
          (current_setting('request.jwt.claims', true)::jsonb)->>'org_id'
        )::uuid
      )
    )
    AND (
      -- Reason must be at least 10 characters (defense-in-depth, also checked in frontend)
      length(event_metadata->>'reason') >= 10
    )
  );

COMMENT ON POLICY domain_events_authenticated_insert ON domain_events IS
  'Allows authenticated users to INSERT events. Validates org_id matches JWT claim and reason >= 10 chars.';


-- ============================================================================
-- Domain Events SELECT Policy (Org-scoped read access)
-- ============================================================================

-- Policy: Users can SELECT events for their organization
-- Note: Super admin already has ALL access via domain_events_super_admin_all
DROP POLICY IF EXISTS domain_events_org_select ON domain_events;
CREATE POLICY domain_events_org_select
  ON domain_events
  FOR SELECT
  USING (
    -- User authenticated
    auth.uid() IS NOT NULL
    AND (
      -- Either super_admin (already covered by other policy, but explicit here)
      is_super_admin(get_current_user_id())
      OR (
        -- Or event belongs to user's organization
        (event_metadata->>'organization_id')::uuid = (
          (current_setting('request.jwt.claims', true)::jsonb)->>'org_id'
        )::uuid
      )
    )
  );

COMMENT ON POLICY domain_events_org_select ON domain_events IS
  'Allows users to SELECT events belonging to their organization.';
