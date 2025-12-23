-- Unprocessed Events View
-- Monitor events that failed to project or are pending processing
CREATE OR REPLACE VIEW unprocessed_events AS
SELECT
  de.id,
  de.stream_id,
  de.stream_type,
  de.event_type,
  de.stream_version,
  de.created_at,
  de.processing_error,
  de.retry_count,
  age(NOW(), de.created_at) AS age,
  de.event_metadata->>'user_id' AS created_by
FROM domain_events de
WHERE de.processed_at IS NULL
  OR de.processing_error IS NOT NULL
ORDER BY de.created_at ASC;

COMMENT ON VIEW unprocessed_events IS 'Events that failed processing or are still pending';