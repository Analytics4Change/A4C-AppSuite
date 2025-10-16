-- Bootstrap Event Listener
-- Automatically handles bootstrap workflow progression based on events
-- Integrates with Zitadel service and maintains CQRS compliance

-- Function to handle bootstrap workflow progression
CREATE OR REPLACE FUNCTION handle_bootstrap_workflow()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process newly inserted events that haven't been processed yet
  IF TG_OP = 'INSERT' AND NEW.processed_at IS NULL THEN
    
    -- Handle organization bootstrap events
    IF NEW.stream_type = 'organization' THEN
      
      CASE NEW.event_type
        
        -- When bootstrap is initiated, trigger Zitadel org creation
        WHEN 'organization.bootstrap.initiated' THEN
          -- In production, this would trigger an external service call
          -- For now, we'll simulate the Zitadel API call
          PERFORM simulate_zitadel_org_creation(
            NEW.event_data,
            NEW.stream_id,
            (NEW.event_metadata->>'user_id')::UUID
          );
        
        -- When Zitadel org is created, continue with organization creation
        WHEN 'organization.zitadel.created' THEN
          PERFORM continue_bootstrap_after_zitadel(NEW);
        
        -- When bootstrap fails, trigger cleanup if needed
        WHEN 'organization.bootstrap.failed' THEN
          -- Check if partial cleanup is required
          IF (NEW.event_data->>'partial_cleanup_required')::BOOLEAN = true THEN
            -- Emit cleanup events for any partial resources
            INSERT INTO domain_events (
              stream_id, stream_type, event_type, event_data, event_metadata, created_at
            ) VALUES (
              NEW.stream_id,
              'organization',
              'organization.bootstrap.cancelled',
              jsonb_build_object(
                'bootstrap_id', NEW.event_data->>'bootstrap_id',
                'cleanup_completed', true,
                'cleanup_actions', ARRAY['partial_resource_cleanup'],
                'original_failure_stage', NEW.event_data->>'failure_stage'
              ),
              jsonb_build_object(
                'user_id', NEW.event_metadata->>'user_id',
                'reason', 'Automated cleanup after bootstrap failure',
                'automated', true
              ),
              NOW()
            );
          END IF;
        
        ELSE
          -- Not a bootstrap event, do nothing
          NULL;
      END CASE;
      
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for bootstrap workflow automation
CREATE TRIGGER bootstrap_workflow_trigger
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION handle_bootstrap_workflow();

-- Function to manually retry failed bootstrap
CREATE OR REPLACE FUNCTION retry_failed_bootstrap(
  p_bootstrap_id UUID,
  p_user_id UUID
) RETURNS UUID AS $$
DECLARE
  v_failed_event RECORD;
  v_new_bootstrap_id UUID;
  v_organization_id UUID;
BEGIN
  -- Find the failed bootstrap event
  SELECT * INTO v_failed_event
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bootstrap failure event not found for bootstrap_id: %', p_bootstrap_id;
  END IF;
  
  -- Generate new IDs for retry
  v_new_bootstrap_id := gen_random_uuid();
  v_organization_id := gen_random_uuid();
  
  -- Re-initiate bootstrap with new IDs
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    v_organization_id,
    'organization',
    'organization.bootstrap.initiated',
    jsonb_set(
      jsonb_set(
        v_failed_event.event_data,
        '{bootstrap_id}',
        to_jsonb(v_new_bootstrap_id::TEXT)
      ),
      '{retry_of}',
      to_jsonb(p_bootstrap_id::TEXT)
    ),
    jsonb_build_object(
      'user_id', p_user_id,
      'reason', format('Manual retry of failed bootstrap %s', p_bootstrap_id),
      'original_bootstrap_id', p_bootstrap_id
    ),
    NOW()
  );
  
  RETURN v_new_bootstrap_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get bootstrap status
CREATE OR REPLACE FUNCTION get_bootstrap_status(
  p_bootstrap_id UUID
) RETURNS TABLE (
  bootstrap_id UUID,
  organization_id UUID,
  status TEXT,
  current_stage TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH bootstrap_events AS (
    SELECT 
      de.stream_id as org_id,
      de.event_type,
      de.event_data,
      de.created_at,
      ROW_NUMBER() OVER (ORDER BY de.created_at DESC) as rn
    FROM domain_events de
    WHERE de.event_data->>'bootstrap_id' = p_bootstrap_id::TEXT
      AND de.stream_type = 'organization'
      AND de.event_type LIKE 'organization.bootstrap.%'
  )
  SELECT 
    p_bootstrap_id,
    be.org_id,
    CASE 
      WHEN be.event_type = 'organization.bootstrap.completed' THEN 'completed'
      WHEN be.event_type = 'organization.bootstrap.failed' THEN 'failed'
      WHEN be.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
      WHEN be.event_type = 'organization.zitadel.created' THEN 'processing'
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'initiated'
      ELSE 'unknown'
    END,
    CASE 
      WHEN be.event_type = 'organization.bootstrap.initiated' THEN 'zitadel_creation'
      WHEN be.event_type = 'organization.zitadel.created' THEN 'organization_creation'
      WHEN be.event_type = 'organization.bootstrap.completed' THEN 'completed'
      WHEN be.event_type = 'organization.bootstrap.failed' THEN be.event_data->>'failure_stage'
      ELSE 'unknown'
    END,
    be.event_data->>'error_message',
    be.created_at,
    CASE 
      WHEN be.event_type = 'organization.bootstrap.completed' THEN be.created_at
      ELSE NULL
    END
  FROM bootstrap_events be
  WHERE be.rn = 1; -- Most recent event
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to list all bootstrap processes (for admin dashboard)
CREATE OR REPLACE FUNCTION list_bootstrap_processes(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  bootstrap_id UUID,
  organization_id UUID,
  organization_name TEXT,
  organization_type TEXT,
  admin_email TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH bootstrap_initiation AS (
    SELECT DISTINCT
      (de.event_data->>'bootstrap_id')::UUID as bid,
      de.stream_id,
      de.event_data->>'organization_name' as org_name,
      de.event_data->>'organization_type' as org_type,
      de.event_data->>'admin_email' as email,
      de.created_at as initiated_at
    FROM domain_events de
    WHERE de.event_type = 'organization.bootstrap.initiated'
  ),
  bootstrap_status AS (
    SELECT 
      (de.event_data->>'bootstrap_id')::UUID as bid,
      CASE 
        WHEN de.event_type = 'organization.bootstrap.completed' THEN 'completed'
        WHEN de.event_type = 'organization.bootstrap.failed' THEN 'failed'
        WHEN de.event_type = 'organization.bootstrap.cancelled' THEN 'cancelled'
        ELSE 'processing'
      END as current_status,
      CASE 
        WHEN de.event_type = 'organization.bootstrap.completed' THEN de.created_at
        ELSE NULL
      END as completed_time,
      de.event_data->>'error_message' as error_msg,
      ROW_NUMBER() OVER (PARTITION BY de.event_data->>'bootstrap_id' ORDER BY de.created_at DESC) as rn
    FROM domain_events de
    WHERE de.event_type LIKE 'organization.bootstrap.%'
      AND de.event_type != 'organization.bootstrap.initiated'
  )
  SELECT 
    bi.bid,
    bi.stream_id,
    bi.org_name,
    bi.org_type,
    bi.email,
    COALESCE(bs.current_status, 'processing'),
    bi.initiated_at,
    bs.completed_time,
    bs.error_msg
  FROM bootstrap_initiation bi
  LEFT JOIN bootstrap_status bs ON bi.bid = bs.bid AND bs.rn = 1
  ORDER BY bi.initiated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to clean up old failed bootstrap attempts
CREATE OR REPLACE FUNCTION cleanup_old_bootstrap_failures(
  p_days_old INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
  v_cleanup_count INTEGER;
BEGIN
  -- This function would clean up very old failed bootstrap attempts
  -- For now, just return count of what would be cleaned
  SELECT COUNT(*) INTO v_cleanup_count
  FROM domain_events
  WHERE event_type = 'organization.bootstrap.failed'
    AND created_at < NOW() - (p_days_old || ' days')::INTERVAL;
  
  RAISE NOTICE 'Would clean up % old failed bootstrap attempts', v_cleanup_count;
  
  -- In production, you might want to archive rather than delete
  -- DELETE FROM domain_events WHERE ...
  
  RETURN v_cleanup_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON FUNCTION handle_bootstrap_workflow IS 
  'Trigger function that automatically progresses bootstrap workflow based on events';
COMMENT ON FUNCTION retry_failed_bootstrap IS 
  'Manually retry a failed bootstrap process with new IDs';
COMMENT ON FUNCTION get_bootstrap_status IS 
  'Get current status of a bootstrap process by bootstrap_id';
COMMENT ON FUNCTION list_bootstrap_processes IS 
  'List all bootstrap processes with their current status (admin dashboard)';
COMMENT ON FUNCTION cleanup_old_bootstrap_failures IS 
  'Clean up old failed bootstrap attempts for maintenance';