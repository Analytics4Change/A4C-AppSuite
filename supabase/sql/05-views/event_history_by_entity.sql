-- Event History by Entity View
-- Provides a complete event history for any entity with full context
CREATE OR REPLACE VIEW event_history_by_entity AS
SELECT
  de.stream_id AS entity_id,
  de.stream_type AS entity_type,
  de.event_type,
  de.stream_version AS version,
  de.event_data,
  de.event_metadata->>'reason' AS change_reason,
  de.event_metadata->>'user_id' AS changed_by_id,
  u.name AS changed_by_name,
  u.email AS changed_by_email,
  de.event_metadata->>'correlation_id' AS correlation_id,
  de.created_at AS occurred_at,
  de.processed_at,
  de.processing_error
FROM domain_events de
LEFT JOIN users u ON u.id = (de.event_metadata->>'user_id')::UUID
ORDER BY de.stream_id, de.stream_version;

-- Index for performance (create as materialized view for better performance)
COMMENT ON VIEW event_history_by_entity IS 'Complete event history for any entity including who made changes and why';