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
        -- Demographics
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
        -- Referral
        referral_source_type = CASE WHEN v_changes ? 'referral_source_type' THEN v_changes->>'referral_source_type' ELSE referral_source_type END,
        referral_organization = CASE WHEN v_changes ? 'referral_organization' THEN v_changes->>'referral_organization' ELSE referral_organization END,
        referral_date = CASE WHEN v_changes ? 'referral_date' THEN (v_changes->>'referral_date')::date ELSE referral_date END,
        reason_for_referral = CASE WHEN v_changes ? 'reason_for_referral' THEN v_changes->>'reason_for_referral' ELSE reason_for_referral END,
        -- Admission
        organization_unit_id = CASE WHEN v_changes ? 'organization_unit_id' THEN (v_changes->>'organization_unit_id')::uuid ELSE organization_unit_id END,
        admission_date = COALESCE((v_changes->>'admission_date')::date, admission_date),
        admission_type = CASE WHEN v_changes ? 'admission_type' THEN v_changes->>'admission_type' ELSE admission_type END,
        level_of_care = CASE WHEN v_changes ? 'level_of_care' THEN v_changes->>'level_of_care' ELSE level_of_care END,
        expected_length_of_stay = CASE WHEN v_changes ? 'expected_length_of_stay' THEN (v_changes->>'expected_length_of_stay')::integer ELSE expected_length_of_stay END,
        initial_risk_level = CASE WHEN v_changes ? 'initial_risk_level' THEN v_changes->>'initial_risk_level' ELSE initial_risk_level END,
        discharge_plan_status = CASE WHEN v_changes ? 'discharge_plan_status' THEN v_changes->>'discharge_plan_status' ELSE discharge_plan_status END,
        placement_arrangement = CASE WHEN v_changes ? 'placement_arrangement' THEN v_changes->>'placement_arrangement' ELSE placement_arrangement END,
        -- Insurance IDs
        medicaid_id = CASE WHEN v_changes ? 'medicaid_id' THEN v_changes->>'medicaid_id' ELSE medicaid_id END,
        medicare_id = CASE WHEN v_changes ? 'medicare_id' THEN v_changes->>'medicare_id' ELSE medicare_id END,
        -- Clinical
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
        -- Medical
        allergies = CASE WHEN v_changes ? 'allergies' THEN v_changes->'allergies' ELSE allergies END,
        medical_conditions = CASE WHEN v_changes ? 'medical_conditions' THEN v_changes->'medical_conditions' ELSE medical_conditions END,
        immunization_status = CASE WHEN v_changes ? 'immunization_status' THEN v_changes->>'immunization_status' ELSE immunization_status END,
        dietary_restrictions = CASE WHEN v_changes ? 'dietary_restrictions' THEN v_changes->>'dietary_restrictions' ELSE dietary_restrictions END,
        special_medical_needs = CASE WHEN v_changes ? 'special_medical_needs' THEN v_changes->>'special_medical_needs' ELSE special_medical_needs END,
        -- Legal
        legal_custody_status = CASE WHEN v_changes ? 'legal_custody_status' THEN v_changes->>'legal_custody_status' ELSE legal_custody_status END,
        court_ordered_placement = CASE WHEN v_changes ? 'court_ordered_placement' THEN (v_changes->>'court_ordered_placement')::boolean ELSE court_ordered_placement END,
        financial_guarantor_type = CASE WHEN v_changes ? 'financial_guarantor_type' THEN v_changes->>'financial_guarantor_type' ELSE financial_guarantor_type END,
        court_case_number = CASE WHEN v_changes ? 'court_case_number' THEN v_changes->>'court_case_number' ELSE court_case_number END,
        state_agency = CASE WHEN v_changes ? 'state_agency' THEN v_changes->>'state_agency' ELSE state_agency END,
        legal_status = CASE WHEN v_changes ? 'legal_status' THEN v_changes->>'legal_status' ELSE legal_status END,
        mandated_reporting_status = CASE WHEN v_changes ? 'mandated_reporting_status' THEN (v_changes->>'mandated_reporting_status')::boolean ELSE mandated_reporting_status END,
        protective_services_involvement = CASE WHEN v_changes ? 'protective_services_involvement' THEN (v_changes->>'protective_services_involvement')::boolean ELSE protective_services_involvement END,
        safety_plan_required = CASE WHEN v_changes ? 'safety_plan_required' THEN (v_changes->>'safety_plan_required')::boolean ELSE safety_plan_required END,
        -- Education
        education_status = CASE WHEN v_changes ? 'education_status' THEN v_changes->>'education_status' ELSE education_status END,
        grade_level = CASE WHEN v_changes ? 'grade_level' THEN v_changes->>'grade_level' ELSE grade_level END,
        iep_status = CASE WHEN v_changes ? 'iep_status' THEN (v_changes->>'iep_status')::boolean ELSE iep_status END,
        -- Custom fields (merge, don't replace)
        custom_fields = CASE WHEN v_changes ? 'custom_fields' THEN custom_fields || v_changes->'custom_fields' ELSE custom_fields END,
        -- Audit
        updated_at = p_event.created_at,
        updated_by = v_user_id,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;
