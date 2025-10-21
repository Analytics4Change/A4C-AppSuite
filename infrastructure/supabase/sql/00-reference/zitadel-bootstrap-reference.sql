-- Zitadel Bootstrap Service
-- Handles Zitadel API integration for organization bootstrap with retry/circuit breaker patterns
-- CQRS-compliant: Only emits events, never directly updates projections

-- Circuit breaker state management for Zitadel API
CREATE TABLE IF NOT EXISTS zitadel_circuit_breaker (
  service_name TEXT PRIMARY KEY DEFAULT 'zitadel_management_api',
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_failure_time TIMESTAMPTZ,
  next_retry_time TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize circuit breaker state
INSERT INTO zitadel_circuit_breaker (service_name) 
VALUES ('zitadel_management_api') 
ON CONFLICT (service_name) DO NOTHING;

-- Circuit breaker configuration
CREATE OR REPLACE FUNCTION get_circuit_breaker_config()
RETURNS TABLE (
  failure_threshold INTEGER,
  timeout_seconds INTEGER,
  retry_delay_seconds INTEGER
) AS $$
BEGIN
  RETURN QUERY SELECT 
    3 as failure_threshold,      -- Open circuit after 3 failures
    300 as timeout_seconds,      -- Keep circuit open for 5 minutes
    30 as retry_delay_seconds;   -- Wait 30 seconds between retries
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check circuit breaker state
CREATE OR REPLACE FUNCTION check_circuit_breaker(
  p_service_name TEXT DEFAULT 'zitadel_management_api'
) RETURNS TEXT AS $$
DECLARE
  v_state TEXT;
  v_failure_count INTEGER;
  v_next_retry_time TIMESTAMPTZ;
  v_config RECORD;
BEGIN
  -- Get current state
  SELECT state, failure_count, next_retry_time 
  INTO v_state, v_failure_count, v_next_retry_time
  FROM zitadel_circuit_breaker 
  WHERE service_name = p_service_name;
  
  -- Get configuration
  SELECT * INTO v_config FROM get_circuit_breaker_config();
  
  -- Handle circuit breaker logic
  CASE v_state
    WHEN 'closed' THEN
      RETURN 'closed';
      
    WHEN 'open' THEN
      -- Check if enough time has passed to try half-open
      IF NOW() >= v_next_retry_time THEN
        -- Transition to half-open
        UPDATE zitadel_circuit_breaker 
        SET state = 'half_open', updated_at = NOW()
        WHERE service_name = p_service_name;
        RETURN 'half_open';
      ELSE
        RETURN 'open';
      END IF;
      
    WHEN 'half_open' THEN
      RETURN 'half_open';
      
    ELSE
      RETURN 'closed';
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to record circuit breaker success
CREATE OR REPLACE FUNCTION record_circuit_breaker_success(
  p_service_name TEXT DEFAULT 'zitadel_management_api'
) RETURNS VOID AS $$
BEGIN
  -- Reset circuit breaker on success
  UPDATE zitadel_circuit_breaker 
  SET 
    state = 'closed',
    failure_count = 0,
    last_failure_time = NULL,
    next_retry_time = NULL,
    updated_at = NOW()
  WHERE service_name = p_service_name;
END;
$$ LANGUAGE plpgsql;

-- Function to record circuit breaker failure
CREATE OR REPLACE FUNCTION record_circuit_breaker_failure(
  p_service_name TEXT DEFAULT 'zitadel_management_api'
) RETURNS VOID AS $$
DECLARE
  v_config RECORD;
  v_failure_count INTEGER;
BEGIN
  SELECT * INTO v_config FROM get_circuit_breaker_config();
  
  -- Increment failure count
  UPDATE zitadel_circuit_breaker 
  SET 
    failure_count = failure_count + 1,
    last_failure_time = NOW(),
    updated_at = NOW()
  WHERE service_name = p_service_name;
  
  -- Get updated failure count
  SELECT failure_count INTO v_failure_count
  FROM zitadel_circuit_breaker 
  WHERE service_name = p_service_name;
  
  -- Open circuit if threshold exceeded
  IF v_failure_count >= v_config.failure_threshold THEN
    UPDATE zitadel_circuit_breaker 
    SET 
      state = 'open',
      next_retry_time = NOW() + (v_config.timeout_seconds || ' seconds')::INTERVAL,
      updated_at = NOW()
    WHERE service_name = p_service_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Bootstrap orchestrator function (Saga coordinator)
-- CRITICAL: This function ONLY emits events, never updates projections directly
CREATE OR REPLACE FUNCTION orchestrate_organization_bootstrap(
  p_bootstrap_id UUID,
  p_organization_type TEXT,
  p_organization_name TEXT,
  p_admin_email TEXT,
  p_slug TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_organization_id UUID;
  v_circuit_state TEXT;
  v_contact_info JSONB;
BEGIN
  -- Generate organization ID
  v_organization_id := gen_random_uuid();
  
  -- Check circuit breaker before proceeding
  v_circuit_state := check_circuit_breaker();
  IF v_circuit_state = 'open' THEN
    -- Emit bootstrap failure event
    INSERT INTO domain_events (
      stream_id, stream_type, event_type, event_data, event_metadata, created_at
    ) VALUES (
      v_organization_id,
      'organization',
      'organization.bootstrap.failed',
      jsonb_build_object(
        'bootstrap_id', p_bootstrap_id,
        'failure_stage', 'zitadel_org_creation',
        'error_message', 'Zitadel API circuit breaker is open',
        'partial_cleanup_required', false
      ),
      jsonb_build_object(
        'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
        'reason', 'Bootstrap failed: Zitadel API temporarily unavailable'
      ),
      NOW()
    );
    
    RAISE EXCEPTION 'Zitadel API circuit breaker is open. Please try again later.';
  END IF;
  
  -- Prepare contact info
  v_contact_info := jsonb_build_object(
    'timezone', 'America/New_York'
  );
  
  -- Emit bootstrap initiated event
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    v_organization_id,
    'organization',
    'organization.bootstrap.initiated',
    jsonb_build_object(
      'bootstrap_id', p_bootstrap_id,
      'organization_type', p_organization_type,
      'organization_name', p_organization_name,
      'admin_email', p_admin_email,
      'slug', COALESCE(p_slug, replace(lower(p_organization_name), ' ', '_')),
      'contact_info', v_contact_info
    ),
    jsonb_build_object(
      'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
      'reason', format('Initiating bootstrap for %s organization: %s', p_organization_type, p_organization_name)
    ),
    NOW()
  );
  
  -- NOTE: The actual Zitadel API calls would be handled by an external service
  -- that listens for organization.bootstrap.initiated events and emits
  -- organization.zitadel.created or organization.bootstrap.failed events
  
  RETURN v_organization_id;
END;
$$ LANGUAGE plpgsql;

-- Function to simulate Zitadel organization creation (for testing)
-- In production, this would be replaced by actual HTTP API calls
CREATE OR REPLACE FUNCTION simulate_zitadel_org_creation(
  p_event_data JSONB,
  p_organization_id UUID,
  p_user_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_bootstrap_id UUID;
  v_organization_name TEXT;
  v_admin_email TEXT;
  v_organization_type TEXT;
  v_slug TEXT;
  v_zitadel_org_id TEXT;
  v_zitadel_user_id TEXT;
  v_circuit_state TEXT;
  v_retry_count INTEGER DEFAULT 0;
  v_max_retries INTEGER DEFAULT 3;
  v_delay_seconds INTEGER[] DEFAULT ARRAY[1, 2, 4, 8]; -- Exponential backoff
BEGIN
  -- Extract data from bootstrap event
  v_bootstrap_id := (p_event_data->>'bootstrap_id')::UUID;
  v_organization_name := p_event_data->>'organization_name';
  v_admin_email := p_event_data->>'admin_email';
  v_organization_type := p_event_data->>'organization_type';
  v_slug := p_event_data->>'slug';
  
  -- Retry loop with exponential backoff
  WHILE v_retry_count <= v_max_retries LOOP
    BEGIN
      -- Check circuit breaker
      v_circuit_state := check_circuit_breaker();
      IF v_circuit_state = 'open' THEN
        RAISE EXCEPTION 'Circuit breaker is open';
      END IF;
      
      -- Simulate Zitadel API call
      -- In production: HTTP POST to Zitadel Management API
      -- For simulation: generate mock IDs
      v_zitadel_org_id := 'zitadel_' || replace(v_slug, '_', '') || '_' || extract(epoch from now())::TEXT;
      v_zitadel_user_id := 'user_' || replace(v_admin_email, '@', '_at_') || '_' || extract(epoch from now())::TEXT;
      
      -- Simulate potential failure (10% chance for testing)
      IF random() < 0.1 THEN
        RAISE EXCEPTION 'Simulated Zitadel API failure';
      END IF;
      
      -- Success: Record circuit breaker success
      PERFORM record_circuit_breaker_success();
      
      -- Emit success event
      INSERT INTO domain_events (
        stream_id, stream_type, event_type, event_data, event_metadata, created_at
      ) VALUES (
        p_organization_id,
        'organization',
        'organization.zitadel.created',
        jsonb_build_object(
          'bootstrap_id', v_bootstrap_id,
          'zitadel_org_id', v_zitadel_org_id,
          'zitadel_user_id', v_zitadel_user_id,
          'admin_email', v_admin_email,
          'organization_name', v_organization_name,
          'organization_type', v_organization_type,
          'slug', v_slug,
          'invitation_sent', true
        ),
        jsonb_build_object(
          'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
          'reason', format('Zitadel organization and user created successfully for %s', v_organization_name)
        ),
        NOW()
      );
      
      -- Success - exit retry loop
      EXIT;
      
    EXCEPTION
      WHEN OTHERS THEN
        v_retry_count := v_retry_count + 1;
        
        -- Record circuit breaker failure
        PERFORM record_circuit_breaker_failure();
        
        -- If max retries exceeded, emit failure event
        IF v_retry_count > v_max_retries THEN
          INSERT INTO domain_events (
            stream_id, stream_type, event_type, event_data, event_metadata, created_at
          ) VALUES (
            p_organization_id,
            'organization',
            'organization.bootstrap.failed',
            jsonb_build_object(
              'bootstrap_id', v_bootstrap_id,
              'failure_stage', 'zitadel_org_creation',
              'error_message', SQLERRM,
              'partial_cleanup_required', false
            ),
            jsonb_build_object(
              'user_id', COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'),
              'reason', format('Zitadel organization creation failed after %s retries: %s', v_max_retries, SQLERRM)
            ),
            NOW()
          );
          RETURN;
        END IF;
        
        -- Wait with exponential backoff
        IF v_retry_count <= array_length(v_delay_seconds, 1) THEN
          PERFORM pg_sleep(v_delay_seconds[v_retry_count]);
        ELSE
          PERFORM pg_sleep(8); -- Max delay
        END IF;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to continue bootstrap after Zitadel creation
-- Emits organization.created and role assignment events
CREATE OR REPLACE FUNCTION continue_bootstrap_after_zitadel(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_bootstrap_id UUID;
  v_zitadel_org_id TEXT;
  v_organization_type TEXT;
  v_organization_name TEXT;
  v_slug TEXT;
  v_ltree_path LTREE;
  v_admin_role TEXT;
BEGIN
  -- Extract data from Zitadel creation event
  v_bootstrap_id := (p_event.event_data->>'bootstrap_id')::UUID;
  v_zitadel_org_id := p_event.event_data->>'zitadel_org_id';
  v_organization_type := p_event.event_data->>'organization_type';
  v_organization_name := p_event.event_data->>'organization_name';
  v_slug := p_event.event_data->>'slug';
  
  -- Generate ltree path for root organization
  v_ltree_path := ('root.org_' || v_slug)::LTREE;
  
  -- Determine admin role based on organization type
  v_admin_role := CASE v_organization_type
    WHEN 'provider' THEN 'provider_admin'
    WHEN 'provider_partner' THEN 'partner_admin'
    ELSE 'provider_admin'
  END;
  
  -- Emit organization.created event
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    p_event.stream_id,
    'organization',
    'organization.created',
    jsonb_build_object(
      'name', v_organization_name,
      'display_name', v_organization_name,
      'slug', v_slug,
      'zitadel_org_id', v_zitadel_org_id,
      'type', v_organization_type,
      'path', v_ltree_path::TEXT,
      'parent_path', NULL,
      'timezone', 'America/New_York',
      'metadata', jsonb_build_object(
        'bootstrap_id', v_bootstrap_id,
        'admin_email', p_event.event_data->>'admin_email'
      )
    ),
    jsonb_build_object(
      'user_id', p_event.event_metadata->>'user_id',
      'reason', format('Creating organization record for bootstrapped %s: %s', v_organization_type, v_organization_name)
    ),
    NOW()
  );
  
  -- Emit user.role.assigned event for the admin
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    (p_event.event_data->>'zitadel_user_id')::UUID,
    'user',
    'user.role.assigned',
    jsonb_build_object(
      'role_name', v_admin_role,
      'org_id', p_event.stream_id::TEXT,
      'scope_path', v_ltree_path::TEXT,
      'assigned_by', p_event.event_metadata->>'user_id',
      'zitadel_user_id', p_event.event_data->>'zitadel_user_id'
    ),
    jsonb_build_object(
      'user_id', p_event.event_metadata->>'user_id',
      'reason', format('Assigning %s role to bootstrap admin for %s', v_admin_role, v_organization_name)
    ),
    NOW()
  );
  
  -- Finally, emit bootstrap completion event
  INSERT INTO domain_events (
    stream_id, stream_type, event_type, event_data, event_metadata, created_at
  ) VALUES (
    p_event.stream_id,
    'organization',
    'organization.bootstrap.completed',
    jsonb_build_object(
      'bootstrap_id', v_bootstrap_id,
      'organization_id', p_event.stream_id,
      'admin_role_assigned', v_admin_role,
      'permissions_granted', 0, -- Will be calculated by RBAC event processor
      'zitadel_org_id', v_zitadel_org_id,
      'ltree_path', v_ltree_path::TEXT
    ),
    jsonb_build_object(
      'user_id', p_event.event_metadata->>'user_id',
      'reason', format('Bootstrap completed successfully for %s: %s', v_organization_type, v_organization_name)
    ),
    NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE zitadel_circuit_breaker IS 
  'Circuit breaker state for Zitadel API to handle failures gracefully';
COMMENT ON FUNCTION orchestrate_organization_bootstrap IS 
  'CQRS-compliant bootstrap orchestrator - emits events only, never updates projections directly';
COMMENT ON FUNCTION simulate_zitadel_org_creation IS 
  'Simulates Zitadel API calls with retry/circuit breaker (replace with actual HTTP calls in production)';
COMMENT ON FUNCTION continue_bootstrap_after_zitadel IS 
  'Continues bootstrap process after successful Zitadel org creation by emitting organization.created events';