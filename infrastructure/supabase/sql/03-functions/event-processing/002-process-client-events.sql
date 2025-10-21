-- Process Client Events
-- Projects client-related events to the clients table
CREATE OR REPLACE FUNCTION process_client_event(
  p_event RECORD
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'client.registered' THEN
      INSERT INTO clients (
        id,
        organization_id,
        first_name,
        last_name,
        date_of_birth,
        gender,
        email,
        phone,
        address,
        emergency_contact,
        allergies,
        medical_conditions,
        blood_type,
        status,
        notes,
        metadata,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_date(p_event.event_data, 'date_of_birth'),
        safe_jsonb_extract_text(p_event.event_data, 'gender'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'phone'),
        COALESCE(p_event.event_data->'address', '{}'::JSONB),
        COALESCE(p_event.event_data->'emergency_contact', '{}'::JSONB),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'allergies', '[]'::JSONB)
        )),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'medical_conditions', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'blood_type'),
        'active',
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'client.admitted' THEN
      UPDATE clients
      SET
        admission_date = safe_jsonb_extract_date(p_event.event_data, 'admission_date'),
        status = 'active',
        metadata = metadata || jsonb_build_object(
          'admission_reason', safe_jsonb_extract_text(p_event.event_data, 'reason'),
          'facility_id', safe_jsonb_extract_text(p_event.event_data, 'facility_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.information_updated' THEN
      -- Apply partial updates from the changes object
      UPDATE clients
      SET
        first_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'first_name'),
          first_name
        ),
        last_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'last_name'),
          last_name
        ),
        email = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'email'),
          email
        ),
        phone = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'phone'),
          phone
        ),
        address = COALESCE(
          p_event.event_data->'changes'->'address',
          address
        ),
        emergency_contact = COALESCE(
          p_event.event_data->'changes'->'emergency_contact',
          emergency_contact
        ),
        allergies = CASE
          WHEN p_event.event_data->'changes' ? 'allergies' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'changes'->'allergies'))
          ELSE allergies
        END,
        medical_conditions = CASE
          WHEN p_event.event_data->'changes' ? 'medical_conditions' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'changes'->'medical_conditions'))
          ELSE medical_conditions
        END,
        blood_type = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'blood_type'),
          blood_type
        ),
        notes = COALESCE(
          safe_jsonb_extract_text(p_event.event_data->'changes', 'notes'),
          notes
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.discharged' THEN
      UPDATE clients
      SET
        discharge_date = safe_jsonb_extract_date(p_event.event_data, 'discharge_date'),
        status = 'inactive',
        metadata = metadata || jsonb_build_object(
          'discharge_reason', safe_jsonb_extract_text(p_event.event_data, 'discharge_reason'),
          'discharge_notes', safe_jsonb_extract_text(p_event.event_data, 'notes')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'client.archived' THEN
      UPDATE clients
      SET
        status = 'archived',
        metadata = metadata || jsonb_build_object(
          'archive_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'archived_at', p_event.created_at
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown client event type: %', p_event.event_type;
  END CASE;

  -- Also record in audit log (with the reason!)
  INSERT INTO audit_log (
    organization_id,
    event_type,
    event_category,
    event_name,
    event_description,
    user_id,
    user_email,
    resource_type,
    resource_id,
    old_values,
    new_values,
    metadata
  ) VALUES (
    safe_jsonb_extract_organization_id(p_event.event_data),
    p_event.event_type,
    'data_change',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    safe_jsonb_extract_text(p_event.event_metadata, 'user_email'),
    'clients',
    p_event.stream_id,
    NULL, -- Could extract from previous events if needed
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_client_event IS 'Projects client events to the clients table and audit log';