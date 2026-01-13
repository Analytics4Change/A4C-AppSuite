-- =============================================================================
-- Migration: Backfill user names from invitation events
-- =============================================================================
-- Purpose: Populate first_name and last_name for existing users by extracting
-- the data from their corresponding user.invited domain events.
--
-- Background: The accept-invitation Edge Function was emitting user.created
-- events without first_name/last_name, even though the invitation had this data.
-- This migration backfills the missing data for existing users.
-- =============================================================================

-- Backfill user names from user.invited events
-- Uses a CTE to find the most recent user.invited event for each user email
WITH invitation_names AS (
  SELECT DISTINCT ON (event_data->>'email')
    event_data->>'email' AS email,
    event_data->>'first_name' AS first_name,
    event_data->>'last_name' AS last_name
  FROM domain_events
  WHERE event_type = 'user.invited'
    AND event_data->>'first_name' IS NOT NULL
    AND event_data->>'first_name' != ''
  ORDER BY event_data->>'email', created_at DESC
)
UPDATE users u
SET
  first_name = COALESCE(u.first_name, inv.first_name),
  last_name = COALESCE(u.last_name, inv.last_name),
  name = COALESCE(
    u.name,
    NULLIF(TRIM(CONCAT(inv.first_name, ' ', inv.last_name)), ''),
    u.email
  ),
  updated_at = NOW()
FROM invitation_names inv
WHERE u.email = inv.email
  AND (u.first_name IS NULL OR u.last_name IS NULL);

-- Log completion
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % user records with names from invitation events', updated_count;
END $$;
