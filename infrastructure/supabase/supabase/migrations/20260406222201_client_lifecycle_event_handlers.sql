-- Migration: client_lifecycle_event_handlers
-- Adds 'client' stream_type to dispatcher, creates router + 4 lifecycle handlers (Phase B2a-1).
-- Pattern: client_field_definition_events (20260327211210)

-- =============================================================================
-- 1. Update dispatcher: add 'client' stream_type
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_domain_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_error_msg TEXT;
    v_error_detail TEXT;
BEGIN
    -- Skip already-processed events (idempotency)
    IF NEW.processed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        IF (NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked')
           AND NEW.event_type NOT IN ('contact.user.linked', 'contact.user.unlinked') THEN
            PERFORM process_junction_event(NEW);
        ELSE
            CASE NEW.stream_type
                WHEN 'role'              THEN PERFORM process_rbac_event(NEW);
                WHEN 'permission'        THEN PERFORM process_rbac_event(NEW);
                WHEN 'user'              THEN PERFORM process_user_event(NEW);
                WHEN 'organization'      THEN PERFORM process_organization_event(NEW);
                WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
                WHEN 'schedule'          THEN PERFORM process_schedule_event(NEW);
                WHEN 'contact'           THEN PERFORM process_contact_event(NEW);
                WHEN 'address'           THEN PERFORM process_address_event(NEW);
                WHEN 'phone'             THEN PERFORM process_phone_event(NEW);
                WHEN 'email'             THEN PERFORM process_email_event(NEW);
                WHEN 'invitation'        THEN PERFORM process_invitation_event(NEW);
                WHEN 'access_grant'      THEN PERFORM process_access_grant_event(NEW);
                WHEN 'impersonation'            THEN PERFORM process_impersonation_event(NEW);
                WHEN 'client_field_definition'  THEN PERFORM process_client_field_definition_event(NEW);
                WHEN 'client_field_category'    THEN PERFORM process_client_field_category_event(NEW);
                WHEN 'client'                   THEN PERFORM process_client_event(NEW);
                -- Administrative stream_types — No projection needed
                WHEN 'platform_admin'    THEN NULL;
                WHEN 'workflow_queue'    THEN NULL;
                WHEN 'test'              THEN NULL;
                ELSE
                    RAISE EXCEPTION 'Unknown stream_type "%" for event %', NEW.stream_type, NEW.id
                        USING ERRCODE = 'P9002';
            END CASE;
        END IF;

        NEW.processed_at = clock_timestamp();
        NEW.processing_error = NULL;

    EXCEPTION
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
            RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
            NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
    END;

    RETURN NEW;
END;
$function$;

-- =============================================================================
-- 2. Router: process_client_event()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_client_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type

        -- Lifecycle events
        WHEN 'client.registered' THEN
            PERFORM handle_client_registered(p_event);

        WHEN 'client.information_updated' THEN
            PERFORM handle_client_information_updated(p_event);

        WHEN 'client.admitted' THEN
            PERFORM handle_client_admitted(p_event);

        WHEN 'client.discharged' THEN
            PERFORM handle_client_discharged(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;

-- =============================================================================
-- 3. Handler: handle_client_registered
-- Inserts a new row into clients_projection from registration event data.
-- ON CONFLICT for idempotency (replay safety).
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
        discharge_plan_status,
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
        -- Demographics
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
        -- Referral
        p_event.event_data->>'referral_source_type',
        p_event.event_data->>'referral_organization',
        (p_event.event_data->>'referral_date')::date,
        p_event.event_data->>'reason_for_referral',
        -- Admission
        (p_event.event_data->>'admission_date')::date,
        p_event.event_data->>'admission_type',
        p_event.event_data->>'level_of_care',
        (p_event.event_data->>'expected_length_of_stay')::integer,
        p_event.event_data->>'initial_risk_level',
        p_event.event_data->>'discharge_plan_status',
        p_event.event_data->>'placement_arrangement',
        -- Insurance IDs
        p_event.event_data->>'medicaid_id',
        p_event.event_data->>'medicare_id',
        -- Clinical
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
        -- Medical
        COALESCE(p_event.event_data->'allergies', '{"nka": true, "items": []}'::jsonb),
        COALESCE(p_event.event_data->'medical_conditions', '{"nkmc": true, "items": []}'::jsonb),
        p_event.event_data->>'immunization_status',
        p_event.event_data->>'dietary_restrictions',
        p_event.event_data->>'special_medical_needs',
        -- Legal
        p_event.event_data->>'legal_custody_status',
        (p_event.event_data->>'court_ordered_placement')::boolean,
        p_event.event_data->>'financial_guarantor_type',
        p_event.event_data->>'court_case_number',
        p_event.event_data->>'state_agency',
        p_event.event_data->>'legal_status',
        (p_event.event_data->>'mandated_reporting_status')::boolean,
        (p_event.event_data->>'protective_services_involvement')::boolean,
        (p_event.event_data->>'safety_plan_required')::boolean,
        -- Education
        p_event.event_data->>'education_status',
        p_event.event_data->>'grade_level',
        (p_event.event_data->>'iep_status')::boolean,
        -- Custom fields
        COALESCE(p_event.event_data->'custom_fields', '{}'::jsonb),
        -- Audit
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
        discharge_plan_status = EXCLUDED.discharge_plan_status,
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
-- 4. Handler: handle_client_information_updated
-- Partial update — only changes fields present in event_data.changes.
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

-- =============================================================================
-- 5. Handler: handle_client_admitted
-- Updates admission-specific fields on an existing client.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_admitted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_user_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_user_id := COALESCE(
        (p_event.event_metadata->>'user_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );

    UPDATE clients_projection SET
        status = 'active',
        admission_date = COALESCE((p_event.event_data->>'admission_date')::date, admission_date),
        admission_type = COALESCE(p_event.event_data->>'admission_type', admission_type),
        level_of_care = CASE WHEN p_event.event_data ? 'level_of_care' THEN p_event.event_data->>'level_of_care' ELSE level_of_care END,
        expected_length_of_stay = CASE WHEN p_event.event_data ? 'expected_length_of_stay' THEN (p_event.event_data->>'expected_length_of_stay')::integer ELSE expected_length_of_stay END,
        initial_risk_level = CASE WHEN p_event.event_data ? 'initial_risk_level' THEN p_event.event_data->>'initial_risk_level' ELSE initial_risk_level END,
        organization_unit_id = CASE WHEN p_event.event_data ? 'organization_unit_id' THEN (p_event.event_data->>'organization_unit_id')::uuid ELSE organization_unit_id END,
        primary_diagnosis = CASE WHEN p_event.event_data ? 'primary_diagnosis' THEN p_event.event_data->'primary_diagnosis' ELSE primary_diagnosis END,
        updated_at = p_event.created_at,
        updated_by = v_user_id,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;

-- =============================================================================
-- 6. Handler: handle_client_discharged
-- Sets status to 'discharged' and populates discharge fields (Decision 78).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_discharged(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_user_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_user_id := COALESCE(
        (p_event.event_metadata->>'user_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );

    UPDATE clients_projection SET
        status = 'discharged',
        -- Mandatory discharge fields (Decision 78)
        discharge_date = (p_event.event_data->>'discharge_date')::date,
        discharge_outcome = p_event.event_data->>'discharge_outcome',
        discharge_reason = p_event.event_data->>'discharge_reason',
        -- Optional discharge fields
        discharge_diagnosis = CASE WHEN p_event.event_data ? 'discharge_diagnosis' THEN p_event.event_data->'discharge_diagnosis' ELSE discharge_diagnosis END,
        discharge_placement = CASE WHEN p_event.event_data ? 'discharge_placement' THEN p_event.event_data->>'discharge_placement' ELSE discharge_placement END,
        -- Audit
        updated_at = p_event.created_at,
        updated_by = v_user_id,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;
