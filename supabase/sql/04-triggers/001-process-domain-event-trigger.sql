-- Trigger to Process Domain Events
-- Automatically projects events to 3NF tables when they are inserted
CREATE TRIGGER process_domain_event_trigger
  BEFORE INSERT OR UPDATE ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_domain_event();

-- Optional: Create an async processing trigger using pg_net for better performance
-- This would process events asynchronously to avoid blocking inserts
-- Uncomment if pg_net extension is available:

-- CREATE OR REPLACE FUNCTION async_process_domain_event()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   -- Queue event for async processing
--   PERFORM net.http_post(
--     url := 'http://localhost:54321/functions/v1/process-event',
--     body := jsonb_build_object(
--       'event_id', NEW.id,
--       'event_type', NEW.event_type,
--       'stream_id', NEW.stream_id,
--       'stream_type', NEW.stream_type
--     )
--   );
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER async_process_event_trigger
--   AFTER INSERT ON domain_events
--   FOR EACH ROW
--   EXECUTE FUNCTION async_process_domain_event();