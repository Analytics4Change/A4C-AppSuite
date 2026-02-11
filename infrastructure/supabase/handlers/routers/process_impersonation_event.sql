CREATE OR REPLACE FUNCTION public.process_impersonation_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_session_id TEXT;
  v_super_admin_user_id UUID;
  v_target_user_id UUID;
  v_previous_expires_at TIMESTAMPTZ;
  v_total_duration INTEGER;
BEGIN
  v_session_id := p_event.event_data->>'session_id';

  CASE p_event.event_type
    WHEN 'impersonation.started' THEN
      INSERT INTO impersonation_sessions_projection (
        session_id, super_admin_user_id, super_admin_email, super_admin_name,
        super_admin_org_id, target_user_id, target_email, target_name,
        target_org_id, target_org_name, target_org_type,
        justification_reason, justification_reference_id, justification_notes,
        status, started_at, expires_at, duration_ms, total_duration_ms,
        renewal_count, actions_performed, ip_address, user_agent,
        created_at, updated_at
      ) VALUES (
        v_session_id,
        (p_event.event_data->'super_admin'->>'user_id')::UUID,
        p_event.event_data->'super_admin'->>'email',
        p_event.event_data->'super_admin'->>'name',
        CASE
          WHEN p_event.event_data->'super_admin'->>'org_id' IS NULL THEN NULL
          WHEN p_event.event_data->'super_admin'->>'org_id' = '*' THEN NULL
          ELSE (p_event.event_data->'super_admin'->>'org_id')::UUID
        END,
        (p_event.event_data->'target'->>'user_id')::UUID,
        p_event.event_data->'target'->>'email',
        p_event.event_data->'target'->>'name',
        (p_event.event_data->'target'->>'org_id')::UUID,
        p_event.event_data->'target'->>'org_name',
        p_event.event_data->'target'->>'org_type',
        p_event.event_data->'justification'->>'reason',
        p_event.event_data->'justification'->>'reference_id',
        p_event.event_data->'justification'->>'notes',
        'active', NOW(),
        (p_event.event_data->'session_config'->>'expires_at')::TIMESTAMPTZ,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,
        0, 0,
        p_event.event_data->>'ip_address',
        p_event.event_data->>'user_agent',
        p_event.created_at, p_event.created_at
      )
      ON CONFLICT (session_id) DO NOTHING;

    WHEN 'impersonation.renewed' THEN
      SELECT expires_at,
        total_duration_ms + (
          (p_event.event_data->>'new_expires_at')::TIMESTAMPTZ -
          (p_event.event_data->>'previous_expires_at')::TIMESTAMPTZ
        ) / 1000
      INTO v_previous_expires_at, v_total_duration
      FROM impersonation_sessions_projection
      WHERE session_id = v_session_id;

      UPDATE impersonation_sessions_projection
      SET expires_at = (p_event.event_data->>'new_expires_at')::TIMESTAMPTZ,
          total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
          renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
          updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation renewal event for non-existent session: %', v_session_id;
      END IF;

    WHEN 'impersonation.ended' THEN
      UPDATE impersonation_sessions_projection
      SET status = CASE
            WHEN p_event.event_data->>'reason' = 'timeout' THEN 'expired'
            ELSE 'ended'
          END,
          ended_at = (p_event.event_data->'summary'->>'ended_at')::TIMESTAMPTZ,
          ended_reason = p_event.event_data->>'reason',
          ended_by_user_id = (p_event.event_data->>'ended_by')::UUID,
          total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
          renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
          actions_performed = (p_event.event_data->>'actions_performed')::INTEGER,
          updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation end event for non-existent session: %', v_session_id;
      END IF;

    ELSE
      RAISE WARNING 'Unknown impersonation event type: %', p_event.event_type;
  END CASE;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error processing impersonation event %: % (Event ID: %)',
      p_event.event_type, SQLERRM, p_event.id;
    RAISE;
END;
$function$;
