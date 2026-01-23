-- =============================================================================
-- Migration: User Schedule Policies (Recurring Schedules)
-- Purpose: Store recurring weekly schedule patterns for staff availability
-- Part of: Multi-Role Authorization Phase 3B
-- =============================================================================

-- This is an event-sourced projection for Temporal workflow routing.
-- It determines "WHO should be notified?" (accountability), NOT "CAN user access?" (RLS).
-- Schedule is a weekly recurring pattern, not day-by-day shift assignments.

-- =============================================================================
-- TABLE: user_schedule_policies_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_schedule_policies_projection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations_projection(id),

  -- Recurring schedule as JSONB
  -- Format: {"monday": {"begin": "0800", "end": "1600"}, "tuesday": {...}, ...}
  -- Day names: monday, tuesday, wednesday, thursday, friday, saturday, sunday
  -- Times in 24-hour HHMM format (local to org timezone)
  schedule jsonb NOT NULL,

  -- Optional: Restrict to specific OU (NULL = all OUs in org)
  org_unit_id uuid REFERENCES organization_units_projection(id),

  -- Validity period for this schedule policy
  effective_from date,
  effective_until date,

  -- Standard metadata
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  last_event_id uuid,

  -- Unique constraint: one schedule per user/org/ou combination
  CONSTRAINT user_schedule_policies_unique
    UNIQUE NULLS NOT DISTINCT (user_id, organization_id, org_unit_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- For Temporal workflow queries: "Find users on schedule at OU X"
CREATE INDEX IF NOT EXISTS idx_user_schedule_policies_user
ON user_schedule_policies_projection(user_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_schedule_policies_org_ou
ON user_schedule_policies_projection(organization_id, org_unit_id) WHERE is_active = true;

-- For validity date filtering
CREATE INDEX IF NOT EXISTS idx_user_schedule_policies_dates
ON user_schedule_policies_projection(effective_from, effective_until) WHERE is_active = true;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

ALTER TABLE user_schedule_policies_projection ENABLE ROW LEVEL SECURITY;

-- Read: Users in same organization can view schedules
DROP POLICY IF EXISTS "user_schedule_policies_select" ON user_schedule_policies_projection;
CREATE POLICY "user_schedule_policies_select" ON user_schedule_policies_projection
FOR SELECT USING (
  organization_id = get_current_org_id()
);

-- Write: Requires user.schedule_manage permission at appropriate scope
DROP POLICY IF EXISTS "user_schedule_policies_modify" ON user_schedule_policies_projection;
CREATE POLICY "user_schedule_policies_modify" ON user_schedule_policies_projection
FOR ALL USING (
  has_effective_permission('user.schedule_manage',
    COALESCE(
      (SELECT path FROM organization_units_projection WHERE id = org_unit_id),
      (SELECT path FROM organizations_projection WHERE id = organization_id)
    )
  )
);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE user_schedule_policies_projection IS
'CQRS projection of user.schedule.* events - stores recurring weekly schedules.

Used by Temporal workflows for notification routing:
- When enable_schedule_enforcement is true, only staff on schedule get notified

Schedule format (JSONB):
{
  "monday": {"begin": "0800", "end": "1600"},
  "tuesday": {"begin": "0800", "end": "1600"},
  "wednesday": null,  // Off this day
  ...
}

Times are in 24-hour HHMM format, local to organization timezone.

NOT for RLS access control - use has_effective_permission() for that.';

COMMENT ON COLUMN user_schedule_policies_projection.schedule IS
'Weekly recurring schedule pattern as JSONB.
Format: {"dayname": {"begin": "HHMM", "end": "HHMM"}, ...}
Days without entries or with null value = not scheduled.
Times in 24-hour format (0800 = 8:00 AM, 1600 = 4:00 PM).';

COMMENT ON COLUMN user_schedule_policies_projection.org_unit_id IS
'Optional OU scope for this schedule.
NULL = schedule applies to all OUs in the organization.
If set, schedule only applies when user is working in this specific OU.';

-- =============================================================================
-- FUNCTION: is_user_on_schedule(user_id, org_id, org_unit_id?, check_time?)
-- =============================================================================

CREATE OR REPLACE FUNCTION is_user_on_schedule(
  p_user_id uuid,
  p_org_id uuid,
  p_org_unit_id uuid DEFAULT NULL,
  p_check_time timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_schedule jsonb;
  v_day_of_week text;
  v_current_time time;
  v_day_schedule jsonb;
  v_org_timezone text;
  v_local_time timestamptz;
BEGIN
  -- Get organization timezone
  SELECT COALESCE(timezone, 'America/New_York')
  INTO v_org_timezone
  FROM organizations_projection
  WHERE id = p_org_id;

  -- Convert check time to org's local timezone
  v_local_time := p_check_time AT TIME ZONE v_org_timezone;

  -- Get day name (lowercase, no trailing spaces)
  v_day_of_week := lower(trim(to_char(v_local_time, 'day')));
  v_current_time := v_local_time::time;

  -- Find applicable schedule (prefer OU-specific, fall back to org-wide)
  SELECT schedule INTO v_schedule
  FROM user_schedule_policies_projection
  WHERE user_id = p_user_id
    AND organization_id = p_org_id
    AND (org_unit_id IS NULL OR org_unit_id = p_org_unit_id)
    AND is_active = true
    AND (effective_from IS NULL OR effective_from <= p_check_time::date)
    AND (effective_until IS NULL OR effective_until >= p_check_time::date)
  ORDER BY org_unit_id NULLS LAST  -- Prefer OU-specific schedule
  LIMIT 1;

  -- No schedule found = not on schedule
  IF v_schedule IS NULL THEN
    RETURN false;
  END IF;

  -- Get schedule for current day
  v_day_schedule := v_schedule->v_day_of_week;

  -- Day not in schedule or explicitly null = not scheduled today
  IF v_day_schedule IS NULL OR v_day_schedule = 'null'::jsonb THEN
    RETURN false;
  END IF;

  -- Parse begin/end times and check if current time falls within
  -- Times are stored as HHMM strings (e.g., "0800", "1600")
  DECLARE
    v_begin_time time;
    v_end_time time;
  BEGIN
    v_begin_time := to_timestamp(v_day_schedule->>'begin', 'HH24MI')::time;
    v_end_time := to_timestamp(v_day_schedule->>'end', 'HH24MI')::time;

    RETURN v_current_time >= v_begin_time AND v_current_time <= v_end_time;
  EXCEPTION WHEN OTHERS THEN
    -- Invalid time format - treat as not on schedule
    RETURN false;
  END;
END;
$$;

COMMENT ON FUNCTION is_user_on_schedule(uuid, uuid, uuid, timestamptz) IS
'Check if a user is currently within their scheduled hours.

Parameters:
- p_user_id: User to check
- p_org_id: Organization context
- p_org_unit_id: Optional OU context (prefers OU-specific schedule if set)
- p_check_time: Time to check (defaults to now())

Returns true if:
1. User has an active schedule policy for the org (and optionally OU)
2. The policy is within its effective date range
3. Current day of week has scheduled hours
4. Current time is within the begin/end window

Time handling:
- Converts p_check_time to organization''s timezone
- Schedule times are in 24-hour HHMM format (org local time)

Used by Temporal workflows when enable_schedule_enforcement=true.';

GRANT EXECUTE ON FUNCTION is_user_on_schedule(uuid, uuid, uuid, timestamptz) TO authenticated;

-- =============================================================================
-- EVENT PROCESSOR: user.schedule.* events
-- =============================================================================

-- Handler for user.schedule.created
CREATE OR REPLACE FUNCTION handle_user_schedule_created(p_event record)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_schedule_policies_projection (
    id,
    user_id,
    organization_id,
    schedule,
    org_unit_id,
    effective_from,
    effective_until,
    created_by,
    last_event_id
  ) VALUES (
    COALESCE((p_event.event_data->>'schedule_id')::uuid, gen_random_uuid()),
    p_event.aggregate_id,
    (p_event.event_data->>'organization_id')::uuid,
    p_event.event_data->'schedule',
    (p_event.event_data->>'org_unit_id')::uuid,
    (p_event.event_data->>'effective_from')::date,
    (p_event.event_data->>'effective_until')::date,
    (p_event.event_metadata->>'user_id')::uuid,
    p_event.id
  ) ON CONFLICT (user_id, organization_id, org_unit_id) DO NOTHING;
END;
$$;

-- Handler for user.schedule.updated
CREATE OR REPLACE FUNCTION handle_user_schedule_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_schedule_policies_projection SET
    schedule = COALESCE(p_event.event_data->'schedule', schedule),
    effective_from = COALESCE((p_event.event_data->>'effective_from')::date, effective_from),
    effective_until = COALESCE((p_event.event_data->>'effective_until')::date, effective_until),
    updated_at = now(),
    last_event_id = p_event.id
  WHERE user_id = p_event.aggregate_id
    AND organization_id = (p_event.event_data->>'organization_id')::uuid
    AND (
      (org_unit_id IS NULL AND (p_event.event_data->>'org_unit_id') IS NULL)
      OR org_unit_id = (p_event.event_data->>'org_unit_id')::uuid
    );
END;
$$;

-- Handler for user.schedule.deactivated
CREATE OR REPLACE FUNCTION handle_user_schedule_deactivated(p_event record)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_schedule_policies_projection SET
    is_active = false,
    updated_at = now(),
    last_event_id = p_event.id
  WHERE user_id = p_event.aggregate_id
    AND organization_id = (p_event.event_data->>'organization_id')::uuid
    AND (
      (org_unit_id IS NULL AND (p_event.event_data->>'org_unit_id') IS NULL)
      OR org_unit_id = (p_event.event_data->>'org_unit_id')::uuid
    );
END;
$$;

-- =============================================================================
-- REGISTER HANDLERS IN EVENT ROUTER
-- =============================================================================

-- Add schedule event routing to process_user_event
-- This will be done via a separate update to the router function
-- For now, document the expected routing:
COMMENT ON FUNCTION handle_user_schedule_created(record) IS
'Event handler for user.schedule.created events.
Route from process_user_event: WHEN ''user.schedule.created'' THEN PERFORM handle_user_schedule_created(NEW);';

COMMENT ON FUNCTION handle_user_schedule_updated(record) IS
'Event handler for user.schedule.updated events.
Route from process_user_event: WHEN ''user.schedule.updated'' THEN PERFORM handle_user_schedule_updated(NEW);';

COMMENT ON FUNCTION handle_user_schedule_deactivated(record) IS
'Event handler for user.schedule.deactivated events.
Route from process_user_event: WHEN ''user.schedule.deactivated'' THEN PERFORM handle_user_schedule_deactivated(NEW);';
