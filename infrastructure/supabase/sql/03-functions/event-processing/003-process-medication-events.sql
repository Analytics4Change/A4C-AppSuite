-- Process Medication Events
-- Projects medication-related events to medications, medication_history, and dosage_info tables
CREATE OR REPLACE FUNCTION process_medication_event(
  p_event domain_events
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'medication.added_to_formulary' THEN
      INSERT INTO medications (
        id,
        organization_id,
        name,
        generic_name,
        brand_names,
        rxnorm_cui,
        ndc_codes,
        category_broad,
        category_specific,
        drug_class,
        is_psychotropic,
        is_controlled,
        controlled_substance_schedule,
        is_narcotic,
        requires_monitoring,
        is_high_alert,
        active_ingredients,
        available_forms,
        available_strengths,
        manufacturer,
        warnings,
        black_box_warning,
        metadata,
        is_active,
        is_formulary,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'generic_name'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'brand_names', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'rxnorm_cui'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'ndc_codes', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'category_broad'),
        safe_jsonb_extract_text(p_event.event_data, 'category_specific'),
        safe_jsonb_extract_text(p_event.event_data, 'drug_class'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_psychotropic', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_controlled', false),
        safe_jsonb_extract_text(p_event.event_data, 'controlled_substance_schedule'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_narcotic', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'requires_monitoring', false),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_high_alert', false),
        COALESCE(p_event.event_data->'active_ingredients', '[]'::JSONB),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'available_forms', '[]'::JSONB)
        )),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'available_strengths', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'manufacturer'),
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'warnings', '[]'::JSONB)
        )),
        safe_jsonb_extract_text(p_event.event_data, 'black_box_warning'),
        COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        true,
        true,
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'medication.updated' THEN
      -- Apply updates to medication catalog
      UPDATE medications
      SET
        name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'name'),
          name
        ),
        warnings = CASE
          WHEN p_event.event_data ? 'warnings' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'warnings'))
          ELSE warnings
        END,
        black_box_warning = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'black_box_warning'),
          black_box_warning
        ),
        is_formulary = COALESCE(
          safe_jsonb_extract_boolean(p_event.event_data, 'is_formulary'),
          is_formulary
        ),
        metadata = metadata || COALESCE(p_event.event_data->'metadata', '{}'::JSONB),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.removed_from_formulary' THEN
      UPDATE medications
      SET
        is_formulary = false,
        is_active = false,
        metadata = metadata || jsonb_build_object(
          'removal_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'removed_at', p_event.created_at
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown medication event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Process Medication History Events
CREATE OR REPLACE FUNCTION process_medication_history_event(
  p_event domain_events
) RETURNS VOID AS $$
BEGIN
  -- Validate event sequence
  PERFORM validate_event_sequence(p_event);

  CASE p_event.event_type
    WHEN 'medication.prescribed' THEN
      INSERT INTO medication_history (
        id,
        organization_id,
        client_id,
        medication_id,
        prescription_date,
        start_date,
        end_date,
        prescriber_name,
        prescriber_npi,
        prescriber_license,
        dosage_amount,
        dosage_unit,
        dosage_form,
        frequency,
        timings,
        food_conditions,
        special_restrictions,
        route,
        instructions,
        is_prn,
        prn_reason,
        status,
        refills_authorized,
        refills_used,
        pharmacy_name,
        pharmacy_phone,
        rx_number,
        inventory_quantity,
        inventory_unit,
        notes,
        metadata,
        created_by,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_id'),
        safe_jsonb_extract_date(p_event.event_data, 'prescription_date'),
        safe_jsonb_extract_date(p_event.event_data, 'start_date'),
        safe_jsonb_extract_date(p_event.event_data, 'end_date'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_name'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_npi'),
        safe_jsonb_extract_text(p_event.event_data, 'prescriber_license'),
        (p_event.event_data->>'dosage_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'dosage_unit'),
        safe_jsonb_extract_text(p_event.event_data, 'dosage_form'),
        CASE
          WHEN jsonb_typeof(p_event.event_data->'frequency') = 'array'
          THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'frequency')), ', ')
          ELSE safe_jsonb_extract_text(p_event.event_data, 'frequency')
        END,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'timings', '[]'::JSONB))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'food_conditions', '[]'::JSONB))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_event.event_data->'special_restrictions', '[]'::JSONB))),
        safe_jsonb_extract_text(p_event.event_data, 'route'),
        safe_jsonb_extract_text(p_event.event_data, 'instructions'),
        safe_jsonb_extract_boolean(p_event.event_data, 'is_prn', false),
        safe_jsonb_extract_text(p_event.event_data, 'prn_reason'),
        'active',
        COALESCE((p_event.event_data->>'refills_authorized')::INTEGER, 0),
        0,
        safe_jsonb_extract_text(p_event.event_data, 'pharmacy_name'),
        safe_jsonb_extract_text(p_event.event_data, 'pharmacy_phone'),
        safe_jsonb_extract_text(p_event.event_data, 'rx_number'),
        COALESCE((p_event.event_data->>'inventory_quantity')::DECIMAL, 0),
        safe_jsonb_extract_text(p_event.event_data, 'inventory_unit'),
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        jsonb_build_object(
          'prescription_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'approvals', p_event.event_metadata->'approval_chain',
          'medication_name', safe_jsonb_extract_text(p_event.event_data, 'medication_name'),
          'source', safe_jsonb_extract_text(p_event.event_metadata, 'source'),
          'controlled_substance', safe_jsonb_extract_boolean(p_event.event_metadata, 'controlled_substance', false),
          'therapeutic_purpose', safe_jsonb_extract_text(p_event.event_metadata, 'therapeutic_purpose')
        ),
        safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
        p_event.created_at
      );

    WHEN 'medication.refilled' THEN
      UPDATE medication_history
      SET
        refills_used = refills_used + 1,
        last_filled_date = safe_jsonb_extract_date(p_event.event_data, 'filled_date'),
        pharmacy_name = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'pharmacy_name'),
          pharmacy_name
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.discontinued' THEN
      UPDATE medication_history
      SET
        discontinue_date = safe_jsonb_extract_date(p_event.event_data, 'discontinue_date'),
        discontinue_reason = safe_jsonb_extract_text(p_event.event_data, 'reason'),
        status = 'discontinued',
        metadata = metadata || jsonb_build_object(
          'discontinue_details', p_event.event_metadata,
          'discontinued_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    WHEN 'medication.modified' THEN
      -- Handle dosage or frequency changes
      UPDATE medication_history
      SET
        dosage_amount = COALESCE(
          (p_event.event_data->>'dosage_amount')::DECIMAL,
          dosage_amount
        ),
        dosage_unit = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'dosage_unit'),
          dosage_unit
        ),
        frequency = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'frequency'),
          frequency
        ),
        instructions = COALESCE(
          safe_jsonb_extract_text(p_event.event_data, 'instructions'),
          instructions
        ),
        metadata = metadata || jsonb_build_object(
          'modification_reason', safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
          'modified_at', p_event.created_at,
          'modified_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
        ),
        updated_by = safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown medication history event type: %', p_event.event_type;
  END CASE;

  -- Record in audit log
  INSERT INTO audit_log (
    organization_id,
    event_type,
    event_category,
    event_name,
    event_description,
    user_id,
    resource_type,
    resource_id,
    new_values,
    metadata
  ) VALUES (
    safe_jsonb_extract_organization_id(p_event.event_data),
    p_event.event_type,
    'medication_management',
    p_event.event_type,
    safe_jsonb_extract_text(p_event.event_metadata, 'reason'),
    safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
    'medication_history',
    p_event.stream_id,
    p_event.event_data,
    p_event.event_metadata
  );
END;
$$ LANGUAGE plpgsql;

-- Process Dosage Events
CREATE OR REPLACE FUNCTION process_dosage_event(
  p_event domain_events
) RETURNS VOID AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'medication.administered' THEN
      INSERT INTO dosage_info (
        id,
        organization_id,
        medication_history_id,
        client_id,
        scheduled_datetime,
        administered_datetime,
        administered_by,
        scheduled_amount,
        administered_amount,
        unit,
        status,
        administration_notes,
        vitals_before,
        vitals_after,
        side_effects_observed,
        metadata,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_history_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'scheduled_datetime'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'administered_at'),
        safe_jsonb_extract_uuid(p_event.event_data, 'administered_by'),
        (p_event.event_data->>'scheduled_amount')::DECIMAL,
        (p_event.event_data->>'administered_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'unit'),
        'administered',
        safe_jsonb_extract_text(p_event.event_data, 'notes'),
        p_event.event_data->'vitals_before',
        p_event.event_data->'vitals_after',
        ARRAY(SELECT jsonb_array_elements_text(
          COALESCE(p_event.event_data->'side_effects', '[]'::JSONB)
        )),
        jsonb_build_object(
          'administration_method', safe_jsonb_extract_text(p_event.event_data, 'method'),
          'witness', safe_jsonb_extract_text(p_event.event_data, 'witnessed_by')
        ),
        p_event.created_at
      );

    WHEN 'medication.skipped', 'medication.refused' THEN
      INSERT INTO dosage_info (
        id,
        organization_id,
        medication_history_id,
        client_id,
        scheduled_datetime,
        scheduled_amount,
        unit,
        status,
        skip_reason,
        refusal_reason,
        metadata,
        created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_organization_id(p_event.event_data),
        safe_jsonb_extract_uuid(p_event.event_data, 'medication_history_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'client_id'),
        safe_jsonb_extract_timestamp(p_event.event_data, 'scheduled_datetime'),
        (p_event.event_data->>'scheduled_amount')::DECIMAL,
        safe_jsonb_extract_text(p_event.event_data, 'unit'),
        CASE p_event.event_type
          WHEN 'medication.skipped' THEN 'skipped'
          WHEN 'medication.refused' THEN 'refused'
        END,
        safe_jsonb_extract_text(p_event.event_data, 'skip_reason'),
        safe_jsonb_extract_text(p_event.event_data, 'refusal_reason'),
        jsonb_build_object(
          'recorded_by', safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id'),
          'reason_details', safe_jsonb_extract_text(p_event.event_metadata, 'reason')
        ),
        p_event.created_at
      );

    ELSE
      RAISE WARNING 'Unknown dosage event type: %', p_event.event_type;
  END CASE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_medication_event IS 'Projects medication catalog events to the medications table';
COMMENT ON FUNCTION process_medication_history_event IS 'Projects prescription events to the medication_history table';
COMMENT ON FUNCTION process_dosage_event IS 'Projects administration events to the dosage_info table';