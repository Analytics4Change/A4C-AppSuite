-- =============================================================================
-- Migration: User Client Assignments
-- Purpose: Store staff-to-client assignments for notification routing
-- Part of: Multi-Role Authorization Phase 3C
-- =============================================================================

-- This is an event-sourced projection for Temporal workflow routing.
-- It determines "WHO should be notified?" (accountability), NOT "CAN user access?" (RLS).
-- When enable_staff_client_mapping is true, only assigned staff get notified.

-- =============================================================================
-- TABLE: user_client_assignments_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_client_assignments_projection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL,  -- Will reference clients table when created
  organization_id uuid NOT NULL REFERENCES organizations_projection(id),

  -- Assignment period
  assigned_at timestamptz DEFAULT now(),
  assigned_until timestamptz,  -- NULL = indefinite

  -- Standard metadata
  is_active boolean DEFAULT true,
  assigned_by uuid,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_event_id uuid,

  -- Unique constraint: one assignment per user/client pair
  CONSTRAINT user_client_assignments_unique
    UNIQUE (user_id, client_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- For Temporal workflow queries: "Find staff assigned to client X"
-- Note: assigned_until is checked at query time (now() can't be in index predicate)
CREATE INDEX IF NOT EXISTS idx_user_client_assignments_user
ON user_client_assignments_projection(user_id, assigned_until)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_client_assignments_client
ON user_client_assignments_projection(client_id, assigned_until)
WHERE is_active = true;

-- For organization-level queries
CREATE INDEX IF NOT EXISTS idx_user_client_assignments_org
ON user_client_assignments_projection(organization_id) WHERE is_active = true;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

ALTER TABLE user_client_assignments_projection ENABLE ROW LEVEL SECURITY;

-- Read: Users in same organization can view assignments
DROP POLICY IF EXISTS "user_client_assignments_select" ON user_client_assignments_projection;
CREATE POLICY "user_client_assignments_select" ON user_client_assignments_projection
FOR SELECT USING (
  organization_id = get_current_org_id()
);

-- Write: Requires user.client_assign permission at org scope
DROP POLICY IF EXISTS "user_client_assignments_modify" ON user_client_assignments_projection;
CREATE POLICY "user_client_assignments_modify" ON user_client_assignments_projection
FOR ALL USING (
  has_effective_permission('user.client_assign',
    (SELECT path FROM organizations_projection WHERE id = organization_id)
  )
);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE user_client_assignments_projection IS
'CQRS projection of user.client.* events - stores staff-to-client assignments.

Used by Temporal workflows for notification routing:
- When enable_staff_client_mapping is true, only assigned staff get notified
- Provides accountability tracking (who is responsible for this client?)

NOT for RLS access control - use has_effective_permission() for that.
Client location determines OU context, not this assignment table.';

COMMENT ON COLUMN user_client_assignments_projection.client_id IS
'Client being assigned to this staff member.
Note: No FK constraint yet - clients table will be created in a future migration.';

COMMENT ON COLUMN user_client_assignments_projection.assigned_until IS
'Optional end date for temporary assignments.
NULL = indefinite assignment.
Expired assignments (assigned_until < now()) are excluded from active queries.';

-- =============================================================================
-- FUNCTION: is_user_assigned_to_client(user_id, client_id)
-- =============================================================================

CREATE OR REPLACE FUNCTION is_user_assigned_to_client(
  p_user_id uuid,
  p_client_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_client_assignments_projection
    WHERE user_id = p_user_id
      AND client_id = p_client_id
      AND is_active = true
      AND (assigned_until IS NULL OR assigned_until > now())
  );
$$;

COMMENT ON FUNCTION is_user_assigned_to_client(uuid, uuid) IS
'Check if a user is currently assigned to a client.

Parameters:
- p_user_id: Staff member to check
- p_client_id: Client to check assignment for

Returns true if:
1. An active assignment exists
2. The assignment hasn''t expired (assigned_until is NULL or in the future)

Used by Temporal workflows when enable_staff_client_mapping=true.';

GRANT EXECUTE ON FUNCTION is_user_assigned_to_client(uuid, uuid) TO authenticated;

-- =============================================================================
-- FUNCTION: get_staff_assigned_to_client(client_id, org_id?)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_staff_assigned_to_client(
  p_client_id uuid,
  p_org_id uuid DEFAULT NULL
) RETURNS TABLE(user_id uuid, assigned_at timestamptz, notes text)
LANGUAGE sql
STABLE
AS $$
  SELECT user_id, assigned_at, notes
  FROM user_client_assignments_projection
  WHERE client_id = p_client_id
    AND (p_org_id IS NULL OR organization_id = p_org_id)
    AND is_active = true
    AND (assigned_until IS NULL OR assigned_until > now())
  ORDER BY assigned_at;
$$;

COMMENT ON FUNCTION get_staff_assigned_to_client(uuid, uuid) IS
'Get all staff currently assigned to a client.

Parameters:
- p_client_id: Client to get assignments for
- p_org_id: Optional organization filter

Returns all active, non-expired assignments.
Used by Temporal workflows to determine notification recipients.';

GRANT EXECUTE ON FUNCTION get_staff_assigned_to_client(uuid, uuid) TO authenticated;

-- =============================================================================
-- FUNCTION: get_clients_assigned_to_user(user_id, org_id?)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_clients_assigned_to_user(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL
) RETURNS TABLE(client_id uuid, assigned_at timestamptz, notes text)
LANGUAGE sql
STABLE
AS $$
  SELECT client_id, assigned_at, notes
  FROM user_client_assignments_projection
  WHERE user_id = p_user_id
    AND (p_org_id IS NULL OR organization_id = p_org_id)
    AND is_active = true
    AND (assigned_until IS NULL OR assigned_until > now())
  ORDER BY assigned_at;
$$;

COMMENT ON FUNCTION get_clients_assigned_to_user(uuid, uuid) IS
'Get all clients currently assigned to a user.

Parameters:
- p_user_id: Staff member to get assignments for
- p_org_id: Optional organization filter

Returns all active, non-expired assignments.
Used by frontend to show a user''s caseload.';

GRANT EXECUTE ON FUNCTION get_clients_assigned_to_user(uuid, uuid) TO authenticated;

-- =============================================================================
-- EVENT PROCESSOR: user.client.* events
-- =============================================================================

-- Handler for user.client.assigned
CREATE OR REPLACE FUNCTION handle_user_client_assigned(p_event record)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_client_assignments_projection (
    id,
    user_id,
    client_id,
    organization_id,
    assigned_by,
    notes,
    assigned_until,
    last_event_id
  ) VALUES (
    COALESCE((p_event.event_data->>'assignment_id')::uuid, gen_random_uuid()),
    p_event.aggregate_id,
    (p_event.event_data->>'client_id')::uuid,
    (p_event.event_data->>'organization_id')::uuid,
    (p_event.event_metadata->>'user_id')::uuid,
    p_event.event_data->>'notes',
    (p_event.event_data->>'assigned_until')::timestamptz,
    p_event.id
  ) ON CONFLICT (user_id, client_id)
  DO UPDATE SET
    is_active = true,
    assigned_until = EXCLUDED.assigned_until,
    notes = EXCLUDED.notes,
    updated_at = now(),
    last_event_id = p_event.id;
END;
$$;

-- Handler for user.client.unassigned
CREATE OR REPLACE FUNCTION handle_user_client_unassigned(p_event record)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_client_assignments_projection SET
    is_active = false,
    assigned_until = now(),
    updated_at = now(),
    last_event_id = p_event.id
  WHERE user_id = p_event.aggregate_id
    AND client_id = (p_event.event_data->>'client_id')::uuid;
END;
$$;

-- =============================================================================
-- REGISTER HANDLERS IN EVENT ROUTER
-- =============================================================================

COMMENT ON FUNCTION handle_user_client_assigned(record) IS
'Event handler for user.client.assigned events.
Route from process_user_event: WHEN ''user.client.assigned'' THEN PERFORM handle_user_client_assigned(NEW);';

COMMENT ON FUNCTION handle_user_client_unassigned(record) IS
'Event handler for user.client.unassigned events.
Route from process_user_event: WHEN ''user.client.unassigned'' THEN PERFORM handle_user_client_unassigned(NEW);';
