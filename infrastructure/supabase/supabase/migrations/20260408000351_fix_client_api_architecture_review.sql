-- Migration: fix_client_api_architecture_review
-- Fixes findings from software-architect-dbc architecture review of Phase B implementation.
--
-- M2: Fix stale event_schema required fields for client.registered
-- M3: Add read-back guard to api.update_client
-- M4: Add read-back guard to api.discharge_client
-- M5: Add read-back guards to sub-entity "add" RPCs (7 functions)
-- m1: Remove discharge_plan_status references from handlers (column dropped in 20260330204308)
-- m6: Expand api.get_client contact_assignments lateral join to return all fields
-- m7: Add UNIQUE(client_id, start_date) constraint to client_placement_history_projection

-- =============================================================================
-- m7: Add UNIQUE(client_id, start_date) constraint to placement history (Decision 83)
-- =============================================================================

ALTER TABLE public.client_placement_history_projection
    ADD CONSTRAINT client_placement_history_client_start_date_unique
    UNIQUE (client_id, start_date);

-- =============================================================================
-- M2: Fix stale event_schema for client.registered
-- Was: race, ethnicity, primary_language (no longer mandatory per Decision 66/67)
-- Should: admission_date, allergies, medical_conditions (mandatory per Decision 67)
-- =============================================================================

UPDATE public.event_types
SET event_schema = '{"type": "object", "required": ["organization_id", "first_name", "last_name", "date_of_birth", "gender", "admission_date", "allergies", "medical_conditions"]}'::jsonb
WHERE event_type = 'client.registered';

-- =============================================================================
-- m1: Fix handle_client_registered — remove discharge_plan_status
-- Column was dropped in migration 20260330204308_remove_discharge_plan_status.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_registered(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := COALESCE(
        (p_event.event_metadata->>'user_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );

    INSERT INTO clients_projection (
        id,
        organization_id,
        organization_unit_id,
        status,
        data_source,
        -- Demographics
        first_name,
        last_name,
        middle_name,
        preferred_name,
        date_of_birth,
        gender,
        gender_identity,
        pronouns,
        race,
        ethnicity,
        primary_language,
        secondary_language,
        interpreter_needed,
        marital_status,
        citizenship_status,
        photo_url,
        mrn,
        external_id,
        drivers_license,
        -- Referral
        referral_source_type,
        referral_organization,
        referral_date,
        reason_for_referral,
        -- Admission
        admission_date,
        admission_type,
        level_of_care,
        expected_length_of_stay,
        initial_risk_level,
        placement_arrangement,
        -- Insurance IDs
        medicaid_id,
        medicare_id,
        -- Clinical
        primary_diagnosis,
        secondary_diagnoses,
        dsm5_diagnoses,
        presenting_problem,
        suicide_risk_status,
        violence_risk_status,
        trauma_history_indicator,
        substance_use_history,
        developmental_history,
        previous_treatment_history,
        -- Medical
        allergies,
        medical_conditions,
        immunization_status,
        dietary_restrictions,
        special_medical_needs,
        -- Legal
        legal_custody_status,
        court_ordered_placement,
        financial_guarantor_type,
        court_case_number,
        state_agency,
        legal_status,
        mandated_reporting_status,
        protective_services_involvement,
        safety_plan_required,
        -- Education
        education_status,
        grade_level,
        iep_status,
        -- Custom fields
        custom_fields,
        -- Audit
        created_at,
        updated_at,
        created_by,
        updated_by,
        last_event_id
    ) VALUES (
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'organization_unit_id')::uuid,
        COALESCE(p_event.event_data->>'status', 'active'),
        COALESCE(p_event.event_data->>'data_source', 'manual'),
        p_event.event_data->>'first_name',
        p_event.event_data->>'last_name',
        p_event.event_data->>'middle_name',
        p_event.event_data->>'preferred_name',
        (p_event.event_data->>'date_of_birth')::date,
        p_event.event_data->>'gender',
        p_event.event_data->>'gender_identity',
        p_event.event_data->>'pronouns',
        CASE WHEN p_event.event_data ? 'race' THEN
            ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'race'))
        ELSE NULL END,
        p_event.event_data->>'ethnicity',
        p_event.event_data->>'primary_language',
        p_event.event_data->>'secondary_language',
        (p_event.event_data->>'interpreter_needed')::boolean,
        p_event.event_data->>'marital_status',
        p_event.event_data->>'citizenship_status',
        p_event.event_data->>'photo_url',
        p_event.event_data->>'mrn',
        p_event.event_data->>'external_id',
        p_event.event_data->>'drivers_license',
        p_event.event_data->>'referral_source_type',
        p_event.event_data->>'referral_organization',
        (p_event.event_data->>'referral_date')::date,
        p_event.event_data->>'reason_for_referral',
        (p_event.event_data->>'admission_date')::date,
        p_event.event_data->>'admission_type',
        p_event.event_data->>'level_of_care',
        (p_event.event_data->>'expected_length_of_stay')::integer,
        p_event.event_data->>'initial_risk_level',
        p_event.event_data->>'placement_arrangement',
        p_event.event_data->>'medicaid_id',
        p_event.event_data->>'medicare_id',
        CASE WHEN p_event.event_data ? 'primary_diagnosis' THEN p_event.event_data->'primary_diagnosis' ELSE NULL END,
        CASE WHEN p_event.event_data ? 'secondary_diagnoses' THEN p_event.event_data->'secondary_diagnoses' ELSE NULL END,
        CASE WHEN p_event.event_data ? 'dsm5_diagnoses' THEN p_event.event_data->'dsm5_diagnoses' ELSE NULL END,
        p_event.event_data->>'presenting_problem',
        p_event.event_data->>'suicide_risk_status',
        p_event.event_data->>'violence_risk_status',
        (p_event.event_data->>'trauma_history_indicator')::boolean,
        p_event.event_data->>'substance_use_history',
        p_event.event_data->>'developmental_history',
        p_event.event_data->>'previous_treatment_history',
        COALESCE(p_event.event_data->'allergies', '{"nka": true, "items": []}'::jsonb),
        COALESCE(p_event.event_data->'medical_conditions', '{"nkmc": true, "items": []}'::jsonb),
        p_event.event_data->>'immunization_status',
        p_event.event_data->>'dietary_restrictions',
        p_event.event_data->>'special_medical_needs',
        p_event.event_data->>'legal_custody_status',
        (p_event.event_data->>'court_ordered_placement')::boolean,
        p_event.event_data->>'financial_guarantor_type',
        p_event.event_data->>'court_case_number',
        p_event.event_data->>'state_agency',
        p_event.event_data->>'legal_status',
        (p_event.event_data->>'mandated_reporting_status')::boolean,
        (p_event.event_data->>'protective_services_involvement')::boolean,
        (p_event.event_data->>'safety_plan_required')::boolean,
        p_event.event_data->>'education_status',
        p_event.event_data->>'grade_level',
        (p_event.event_data->>'iep_status')::boolean,
        COALESCE(p_event.event_data->'custom_fields', '{}'::jsonb),
        p_event.created_at,
        p_event.created_at,
        v_user_id,
        v_user_id,
        p_event.id
    )
    ON CONFLICT (id) DO UPDATE SET
        organization_unit_id = EXCLUDED.organization_unit_id,
        status = EXCLUDED.status,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        middle_name = EXCLUDED.middle_name,
        preferred_name = EXCLUDED.preferred_name,
        date_of_birth = EXCLUDED.date_of_birth,
        gender = EXCLUDED.gender,
        gender_identity = EXCLUDED.gender_identity,
        pronouns = EXCLUDED.pronouns,
        race = EXCLUDED.race,
        ethnicity = EXCLUDED.ethnicity,
        primary_language = EXCLUDED.primary_language,
        secondary_language = EXCLUDED.secondary_language,
        interpreter_needed = EXCLUDED.interpreter_needed,
        marital_status = EXCLUDED.marital_status,
        citizenship_status = EXCLUDED.citizenship_status,
        photo_url = EXCLUDED.photo_url,
        mrn = EXCLUDED.mrn,
        external_id = EXCLUDED.external_id,
        drivers_license = EXCLUDED.drivers_license,
        referral_source_type = EXCLUDED.referral_source_type,
        referral_organization = EXCLUDED.referral_organization,
        referral_date = EXCLUDED.referral_date,
        reason_for_referral = EXCLUDED.reason_for_referral,
        admission_date = EXCLUDED.admission_date,
        admission_type = EXCLUDED.admission_type,
        level_of_care = EXCLUDED.level_of_care,
        expected_length_of_stay = EXCLUDED.expected_length_of_stay,
        initial_risk_level = EXCLUDED.initial_risk_level,
        placement_arrangement = EXCLUDED.placement_arrangement,
        medicaid_id = EXCLUDED.medicaid_id,
        medicare_id = EXCLUDED.medicare_id,
        primary_diagnosis = EXCLUDED.primary_diagnosis,
        secondary_diagnoses = EXCLUDED.secondary_diagnoses,
        dsm5_diagnoses = EXCLUDED.dsm5_diagnoses,
        presenting_problem = EXCLUDED.presenting_problem,
        suicide_risk_status = EXCLUDED.suicide_risk_status,
        violence_risk_status = EXCLUDED.violence_risk_status,
        trauma_history_indicator = EXCLUDED.trauma_history_indicator,
        substance_use_history = EXCLUDED.substance_use_history,
        developmental_history = EXCLUDED.developmental_history,
        previous_treatment_history = EXCLUDED.previous_treatment_history,
        allergies = EXCLUDED.allergies,
        medical_conditions = EXCLUDED.medical_conditions,
        immunization_status = EXCLUDED.immunization_status,
        dietary_restrictions = EXCLUDED.dietary_restrictions,
        special_medical_needs = EXCLUDED.special_medical_needs,
        legal_custody_status = EXCLUDED.legal_custody_status,
        court_ordered_placement = EXCLUDED.court_ordered_placement,
        financial_guarantor_type = EXCLUDED.financial_guarantor_type,
        court_case_number = EXCLUDED.court_case_number,
        state_agency = EXCLUDED.state_agency,
        legal_status = EXCLUDED.legal_status,
        mandated_reporting_status = EXCLUDED.mandated_reporting_status,
        protective_services_involvement = EXCLUDED.protective_services_involvement,
        safety_plan_required = EXCLUDED.safety_plan_required,
        education_status = EXCLUDED.education_status,
        grade_level = EXCLUDED.grade_level,
        iep_status = EXCLUDED.iep_status,
        custom_fields = EXCLUDED.custom_fields,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

-- =============================================================================
-- m1: Fix handle_client_information_updated — remove discharge_plan_status
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_information_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_changes jsonb;
    v_user_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_changes := p_event.event_data->'changes';
    v_user_id := COALESCE(
        (p_event.event_metadata->>'user_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );

    UPDATE clients_projection SET
        first_name = COALESCE(v_changes->>'first_name', first_name),
        last_name = COALESCE(v_changes->>'last_name', last_name),
        middle_name = CASE WHEN v_changes ? 'middle_name' THEN v_changes->>'middle_name' ELSE middle_name END,
        preferred_name = CASE WHEN v_changes ? 'preferred_name' THEN v_changes->>'preferred_name' ELSE preferred_name END,
        date_of_birth = COALESCE((v_changes->>'date_of_birth')::date, date_of_birth),
        gender = COALESCE(v_changes->>'gender', gender),
        gender_identity = CASE WHEN v_changes ? 'gender_identity' THEN v_changes->>'gender_identity' ELSE gender_identity END,
        pronouns = CASE WHEN v_changes ? 'pronouns' THEN v_changes->>'pronouns' ELSE pronouns END,
        race = CASE WHEN v_changes ? 'race' THEN ARRAY(SELECT jsonb_array_elements_text(v_changes->'race')) ELSE race END,
        ethnicity = CASE WHEN v_changes ? 'ethnicity' THEN v_changes->>'ethnicity' ELSE ethnicity END,
        primary_language = CASE WHEN v_changes ? 'primary_language' THEN v_changes->>'primary_language' ELSE primary_language END,
        secondary_language = CASE WHEN v_changes ? 'secondary_language' THEN v_changes->>'secondary_language' ELSE secondary_language END,
        interpreter_needed = CASE WHEN v_changes ? 'interpreter_needed' THEN (v_changes->>'interpreter_needed')::boolean ELSE interpreter_needed END,
        marital_status = CASE WHEN v_changes ? 'marital_status' THEN v_changes->>'marital_status' ELSE marital_status END,
        citizenship_status = CASE WHEN v_changes ? 'citizenship_status' THEN v_changes->>'citizenship_status' ELSE citizenship_status END,
        photo_url = CASE WHEN v_changes ? 'photo_url' THEN v_changes->>'photo_url' ELSE photo_url END,
        mrn = CASE WHEN v_changes ? 'mrn' THEN v_changes->>'mrn' ELSE mrn END,
        external_id = CASE WHEN v_changes ? 'external_id' THEN v_changes->>'external_id' ELSE external_id END,
        drivers_license = CASE WHEN v_changes ? 'drivers_license' THEN v_changes->>'drivers_license' ELSE drivers_license END,
        referral_source_type = CASE WHEN v_changes ? 'referral_source_type' THEN v_changes->>'referral_source_type' ELSE referral_source_type END,
        referral_organization = CASE WHEN v_changes ? 'referral_organization' THEN v_changes->>'referral_organization' ELSE referral_organization END,
        referral_date = CASE WHEN v_changes ? 'referral_date' THEN (v_changes->>'referral_date')::date ELSE referral_date END,
        reason_for_referral = CASE WHEN v_changes ? 'reason_for_referral' THEN v_changes->>'reason_for_referral' ELSE reason_for_referral END,
        organization_unit_id = CASE WHEN v_changes ? 'organization_unit_id' THEN (v_changes->>'organization_unit_id')::uuid ELSE organization_unit_id END,
        admission_date = COALESCE((v_changes->>'admission_date')::date, admission_date),
        admission_type = CASE WHEN v_changes ? 'admission_type' THEN v_changes->>'admission_type' ELSE admission_type END,
        level_of_care = CASE WHEN v_changes ? 'level_of_care' THEN v_changes->>'level_of_care' ELSE level_of_care END,
        expected_length_of_stay = CASE WHEN v_changes ? 'expected_length_of_stay' THEN (v_changes->>'expected_length_of_stay')::integer ELSE expected_length_of_stay END,
        initial_risk_level = CASE WHEN v_changes ? 'initial_risk_level' THEN v_changes->>'initial_risk_level' ELSE initial_risk_level END,
        placement_arrangement = CASE WHEN v_changes ? 'placement_arrangement' THEN v_changes->>'placement_arrangement' ELSE placement_arrangement END,
        medicaid_id = CASE WHEN v_changes ? 'medicaid_id' THEN v_changes->>'medicaid_id' ELSE medicaid_id END,
        medicare_id = CASE WHEN v_changes ? 'medicare_id' THEN v_changes->>'medicare_id' ELSE medicare_id END,
        primary_diagnosis = CASE WHEN v_changes ? 'primary_diagnosis' THEN v_changes->'primary_diagnosis' ELSE primary_diagnosis END,
        secondary_diagnoses = CASE WHEN v_changes ? 'secondary_diagnoses' THEN v_changes->'secondary_diagnoses' ELSE secondary_diagnoses END,
        dsm5_diagnoses = CASE WHEN v_changes ? 'dsm5_diagnoses' THEN v_changes->'dsm5_diagnoses' ELSE dsm5_diagnoses END,
        presenting_problem = CASE WHEN v_changes ? 'presenting_problem' THEN v_changes->>'presenting_problem' ELSE presenting_problem END,
        suicide_risk_status = CASE WHEN v_changes ? 'suicide_risk_status' THEN v_changes->>'suicide_risk_status' ELSE suicide_risk_status END,
        violence_risk_status = CASE WHEN v_changes ? 'violence_risk_status' THEN v_changes->>'violence_risk_status' ELSE violence_risk_status END,
        trauma_history_indicator = CASE WHEN v_changes ? 'trauma_history_indicator' THEN (v_changes->>'trauma_history_indicator')::boolean ELSE trauma_history_indicator END,
        substance_use_history = CASE WHEN v_changes ? 'substance_use_history' THEN v_changes->>'substance_use_history' ELSE substance_use_history END,
        developmental_history = CASE WHEN v_changes ? 'developmental_history' THEN v_changes->>'developmental_history' ELSE developmental_history END,
        previous_treatment_history = CASE WHEN v_changes ? 'previous_treatment_history' THEN v_changes->>'previous_treatment_history' ELSE previous_treatment_history END,
        allergies = CASE WHEN v_changes ? 'allergies' THEN v_changes->'allergies' ELSE allergies END,
        medical_conditions = CASE WHEN v_changes ? 'medical_conditions' THEN v_changes->'medical_conditions' ELSE medical_conditions END,
        immunization_status = CASE WHEN v_changes ? 'immunization_status' THEN v_changes->>'immunization_status' ELSE immunization_status END,
        dietary_restrictions = CASE WHEN v_changes ? 'dietary_restrictions' THEN v_changes->>'dietary_restrictions' ELSE dietary_restrictions END,
        special_medical_needs = CASE WHEN v_changes ? 'special_medical_needs' THEN v_changes->>'special_medical_needs' ELSE special_medical_needs END,
        legal_custody_status = CASE WHEN v_changes ? 'legal_custody_status' THEN v_changes->>'legal_custody_status' ELSE legal_custody_status END,
        court_ordered_placement = CASE WHEN v_changes ? 'court_ordered_placement' THEN (v_changes->>'court_ordered_placement')::boolean ELSE court_ordered_placement END,
        financial_guarantor_type = CASE WHEN v_changes ? 'financial_guarantor_type' THEN v_changes->>'financial_guarantor_type' ELSE financial_guarantor_type END,
        court_case_number = CASE WHEN v_changes ? 'court_case_number' THEN v_changes->>'court_case_number' ELSE court_case_number END,
        state_agency = CASE WHEN v_changes ? 'state_agency' THEN v_changes->>'state_agency' ELSE state_agency END,
        legal_status = CASE WHEN v_changes ? 'legal_status' THEN v_changes->>'legal_status' ELSE legal_status END,
        mandated_reporting_status = CASE WHEN v_changes ? 'mandated_reporting_status' THEN (v_changes->>'mandated_reporting_status')::boolean ELSE mandated_reporting_status END,
        protective_services_involvement = CASE WHEN v_changes ? 'protective_services_involvement' THEN (v_changes->>'protective_services_involvement')::boolean ELSE protective_services_involvement END,
        safety_plan_required = CASE WHEN v_changes ? 'safety_plan_required' THEN (v_changes->>'safety_plan_required')::boolean ELSE safety_plan_required END,
        education_status = CASE WHEN v_changes ? 'education_status' THEN v_changes->>'education_status' ELSE education_status END,
        grade_level = CASE WHEN v_changes ? 'grade_level' THEN v_changes->>'grade_level' ELSE grade_level END,
        iep_status = CASE WHEN v_changes ? 'iep_status' THEN (v_changes->>'iep_status')::boolean ELSE iep_status END,
        custom_fields = CASE WHEN v_changes ? 'custom_fields' THEN custom_fields || v_changes->'custom_fields' ELSE custom_fields END,
        updated_at = p_event.created_at,
        updated_by = v_user_id,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;

-- =============================================================================
-- M3: Add read-back guard to api.update_client
-- =============================================================================

CREATE OR REPLACE FUNCTION api.update_client(
    p_client_id uuid, p_changes jsonb,
    p_reason text DEFAULT 'Client information updated',
    p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid; v_org_path extensions.ltree;
    v_result record; v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id, p_stream_type := 'client',
        p_event_type := 'client.information_updated',
        p_event_data := jsonb_build_object('organization_id', v_org_id, 'changes', p_changes),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );

    -- Read-back guard
    SELECT id, updated_at INTO v_result FROM clients_projection WHERE id = p_client_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.information_updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- M3: Add read-back guard to api.admit_client
-- =============================================================================

CREATE OR REPLACE FUNCTION api.admit_client(
    p_client_id uuid, p_admission_data jsonb,
    p_reason text DEFAULT 'Client admitted',
    p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid; v_org_path extensions.ltree;
    v_result record; v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id, p_stream_type := 'client',
        p_event_type := 'client.admitted',
        p_event_data := p_admission_data || jsonb_build_object('organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );

    -- Read-back guard: verify status is active
    SELECT id, status INTO v_result FROM clients_projection WHERE id = p_client_id AND status = 'active';
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.admitted'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- M4: Add read-back guard to api.discharge_client
-- =============================================================================

CREATE OR REPLACE FUNCTION api.discharge_client(
    p_client_id uuid, p_discharge_data jsonb,
    p_reason text DEFAULT 'Client discharged',
    p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid; v_org_path extensions.ltree;
    v_result record; v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.discharge', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.discharge');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id AND status = 'active') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found or not active');
    END IF;

    -- Validate 3 mandatory discharge fields (Decision 78)
    IF p_discharge_data->>'discharge_date' IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'discharge_date is required');
    END IF;
    IF p_discharge_data->>'discharge_outcome' IS NULL OR p_discharge_data->>'discharge_outcome' = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'discharge_outcome is required');
    END IF;
    IF p_discharge_data->>'discharge_reason' IS NULL OR p_discharge_data->>'discharge_reason' = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'discharge_reason is required');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id, p_stream_type := 'client',
        p_event_type := 'client.discharged',
        p_event_data := p_discharge_data || jsonb_build_object('organization_id', v_org_id),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid()))
    );

    -- Read-back guard: verify status changed to discharged
    SELECT id, status, discharge_date INTO v_result
    FROM clients_projection WHERE id = p_client_id AND status = 'discharged';
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.discharged'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'client_id', p_client_id);
END;
$$;

-- =============================================================================
-- m6: Expand api.get_client contact_assignments to return all fields
-- =============================================================================

CREATE OR REPLACE FUNCTION api.get_client(p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid; v_org_path extensions.ltree;
    v_client jsonb; v_phones jsonb; v_emails jsonb; v_addresses jsonb;
    v_insurance jsonb; v_placements jsonb; v_funding jsonb; v_assignments jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.view', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.view');
    END IF;

    SELECT row_to_json(c)::jsonb INTO v_client FROM clients_projection c
    WHERE c.id = p_client_id AND c.organization_id = v_org_id;
    IF v_client IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) INTO v_phones
    FROM client_phones_projection p WHERE p.client_id = p_client_id AND p.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb) INTO v_emails
    FROM client_emails_projection e WHERE e.client_id = p_client_id AND e.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb) INTO v_addresses
    FROM client_addresses_projection a WHERE a.client_id = p_client_id AND a.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(i)::jsonb), '[]'::jsonb) INTO v_insurance
    FROM client_insurance_policies_projection i WHERE i.client_id = p_client_id AND i.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(ph)::jsonb ORDER BY ph.start_date DESC), '[]'::jsonb) INTO v_placements
    FROM client_placement_history_projection ph WHERE ph.client_id = p_client_id;

    SELECT COALESCE(jsonb_agg(row_to_json(f)::jsonb), '[]'::jsonb) INTO v_funding
    FROM client_funding_sources_projection f WHERE f.client_id = p_client_id AND f.is_active = true;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ca.id, 'client_id', ca.client_id, 'contact_id', ca.contact_id,
        'organization_id', ca.organization_id, 'designation', ca.designation,
        'is_active', ca.is_active, 'assigned_at', ca.assigned_at,
        'created_at', ca.created_at, 'updated_at', ca.updated_at,
        'last_event_id', ca.last_event_id,
        'contact_name', cp.first_name || ' ' || cp.last_name,
        'contact_email', cp.email
    )), '[]'::jsonb) INTO v_assignments
    FROM client_contact_assignments_projection ca
    JOIN contacts_projection cp ON cp.id = ca.contact_id
    WHERE ca.client_id = p_client_id AND ca.is_active = true;

    RETURN jsonb_build_object('success', true, 'data', v_client || jsonb_build_object(
        'phones', v_phones, 'emails', v_emails, 'addresses', v_addresses,
        'insurance_policies', v_insurance, 'placement_history', v_placements,
        'funding_sources', v_funding, 'contact_assignments', v_assignments
    ));
END;
$$;

-- =============================================================================
-- M5: Add read-back guards to sub-entity "add" RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION api.add_client_phone(
    p_client_id uuid, p_phone_number text,
    p_phone_type text DEFAULT 'mobile', p_is_primary boolean DEFAULT false,
    p_reason text DEFAULT 'Phone added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_phone_id uuid := gen_random_uuid(); v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.phone.added',
        p_event_data := jsonb_build_object('phone_id', v_phone_id, 'organization_id', v_org_id, 'phone_number', p_phone_number, 'phone_type', p_phone_type, 'is_primary', p_is_primary),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())));

    IF NOT EXISTS (SELECT 1 FROM client_phones_projection WHERE id = v_phone_id) THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_client_id AND event_type = 'client.phone.added' ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;
    RETURN jsonb_build_object('success', true, 'phone_id', v_phone_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.add_client_email(
    p_client_id uuid, p_email text, p_email_type text DEFAULT 'personal', p_is_primary boolean DEFAULT false,
    p_reason text DEFAULT 'Email added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_email_id uuid := gen_random_uuid(); v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.email.added',
        p_event_data := jsonb_build_object('email_id', v_email_id, 'organization_id', v_org_id, 'email', p_email, 'email_type', p_email_type, 'is_primary', p_is_primary),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())));

    IF NOT EXISTS (SELECT 1 FROM client_emails_projection WHERE id = v_email_id) THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_client_id AND event_type = 'client.email.added' ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;
    RETURN jsonb_build_object('success', true, 'email_id', v_email_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.add_client_address(
    p_client_id uuid, p_street1 text, p_city text, p_state text, p_zip text,
    p_address_type text DEFAULT 'home', p_street2 text DEFAULT NULL, p_country text DEFAULT 'US', p_is_primary boolean DEFAULT false,
    p_reason text DEFAULT 'Address added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_address_id uuid := gen_random_uuid(); v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.address.added',
        p_event_data := jsonb_build_object('address_id', v_address_id, 'organization_id', v_org_id, 'address_type', p_address_type, 'street1', p_street1, 'street2', p_street2, 'city', p_city, 'state', p_state, 'zip', p_zip, 'country', p_country, 'is_primary', p_is_primary),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())));

    IF NOT EXISTS (SELECT 1 FROM client_addresses_projection WHERE id = v_address_id) THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_client_id AND event_type = 'client.address.added' ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;
    RETURN jsonb_build_object('success', true, 'address_id', v_address_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.add_client_insurance(
    p_client_id uuid, p_policy_type text, p_payer_name text,
    p_policy_number text DEFAULT NULL, p_group_number text DEFAULT NULL,
    p_subscriber_name text DEFAULT NULL, p_subscriber_relation text DEFAULT NULL,
    p_coverage_start_date date DEFAULT NULL, p_coverage_end_date date DEFAULT NULL,
    p_reason text DEFAULT 'Insurance added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_policy_id uuid := gen_random_uuid(); v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.insurance.added',
        p_event_data := jsonb_build_object('policy_id', v_policy_id, 'organization_id', v_org_id, 'policy_type', p_policy_type, 'payer_name', p_payer_name, 'policy_number', p_policy_number, 'group_number', p_group_number, 'subscriber_name', p_subscriber_name, 'subscriber_relation', p_subscriber_relation, 'coverage_start_date', p_coverage_start_date, 'coverage_end_date', p_coverage_end_date),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())));

    IF NOT EXISTS (SELECT 1 FROM client_insurance_policies_projection WHERE id = v_policy_id) THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_client_id AND event_type = 'client.insurance.added' ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;
    RETURN jsonb_build_object('success', true, 'policy_id', v_policy_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.add_client_funding_source(
    p_client_id uuid, p_source_type text, p_source_name text,
    p_reference_number text DEFAULT NULL, p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL,
    p_custom_fields jsonb DEFAULT '{}'::jsonb,
    p_reason text DEFAULT 'Funding source added', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_funding_source_id uuid := gen_random_uuid(); v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.funding_source.added',
        p_event_data := jsonb_build_object('funding_source_id', v_funding_source_id, 'organization_id', v_org_id, 'source_type', p_source_type, 'source_name', p_source_name, 'reference_number', p_reference_number, 'start_date', p_start_date, 'end_date', p_end_date, 'custom_fields', p_custom_fields),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())));

    IF NOT EXISTS (SELECT 1 FROM client_funding_sources_projection WHERE id = v_funding_source_id) THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_client_id AND event_type = 'client.funding_source.added' ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;
    RETURN jsonb_build_object('success', true, 'funding_source_id', v_funding_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.change_client_placement(
    p_client_id uuid, p_placement_arrangement text, p_start_date date DEFAULT CURRENT_DATE,
    p_reason_text text DEFAULT NULL,
    p_reason text DEFAULT 'Placement changed', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_placement_id uuid := gen_random_uuid(); v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.placement.changed',
        p_event_data := jsonb_build_object('placement_id', v_placement_id, 'organization_id', v_org_id, 'placement_arrangement', p_placement_arrangement, 'start_date', p_start_date, 'reason', p_reason_text),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())));

    IF NOT EXISTS (SELECT 1 FROM client_placement_history_projection WHERE id = v_placement_id) THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_client_id AND event_type = 'client.placement.changed' ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;
    RETURN jsonb_build_object('success', true, 'placement_id', v_placement_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.assign_client_contact(
    p_client_id uuid, p_contact_id uuid, p_designation text,
    p_reason text DEFAULT 'Contact assigned', p_event_metadata jsonb DEFAULT NULL, p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE v_org_id uuid; v_org_path extensions.ltree; v_assignment_id uuid := gen_random_uuid(); v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.update', v_org_path) THEN RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update'); END IF;
    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN RETURN jsonb_build_object('success', false, 'error', 'Client not found'); END IF;
    IF NOT EXISTS (SELECT 1 FROM contacts_projection WHERE id = p_contact_id AND organization_id = v_org_id AND deleted_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'error', 'Contact not found'); END IF;

    PERFORM api.emit_domain_event(p_stream_id := p_client_id, p_stream_type := 'client', p_event_type := 'client.contact.assigned',
        p_event_data := jsonb_build_object('assignment_id', v_assignment_id, 'organization_id', v_org_id, 'contact_id', p_contact_id, 'designation', p_designation),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object('user_id', auth.uid(), 'organization_id', v_org_id, 'reason', p_reason, 'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())));

    IF NOT EXISTS (SELECT 1 FROM client_contact_assignments_projection WHERE id = v_assignment_id) THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_client_id AND event_type = 'client.contact.assigned' ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;
    RETURN jsonb_build_object('success', true, 'assignment_id', v_assignment_id);
END;
$$;
