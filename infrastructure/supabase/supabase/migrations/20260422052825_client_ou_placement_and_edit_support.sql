-- =============================================================================
-- Migration: client_ou_placement_and_edit_support
-- Feature: OU Placement Tracking + Full Client Record Editing
-- Created: 2026-04-22
-- =============================================================================
--
-- Architectural decisions (see dev/active/client-ou-edit-plan.md):
--
-- * C3 — SINGLE-PATH OU MUTATION: organization_unit_id on clients_projection
--   is mutable ONLY via api.change_client_placement (which emits
--   client.placement.changed). api.update_client and api.admit_client must
--   NOT mutate it. This migration removes those dual-write paths.
--
-- * C4 — ROW LOCK IN HANDLER: handle_client_placement_changed acquires
--   SELECT ... FOR UPDATE on the existing is_current=true placement row
--   before the close-then-insert sequence. The partial unique index
--   idx_client_placement_current would reject concurrent INSERTs if two
--   placement events race; the row lock serializes the transition for a
--   given client.
--
-- * M1 — NEW PERMISSION client.transfer: Distinct from client.update.
--   Seeded here and added to provider_admin template (not clinician).
--
-- * M5 — EXPLICIT jsonb_build_object: api.get_client's placement history
--   aggregation is rewritten from row_to_json(ph)::jsonb to explicit
--   jsonb_build_object(...) enumeration so the LEFT JOIN to
--   organization_units_projection can include organization_unit_name.
--
-- * M7 — RLS UNCHANGED: client_placement_history_projection RLS policies
--   (client_placement_select, client_placement_platform_admin) are NOT
--   modified. Org-level filtering continues to suffice; OU-scoped filtering
--   is deferred to API-query-time if required later.
--
-- * M8 — placement_arrangement FALLBACK: OU-only edits from the UI reuse
--   the current placement_arrangement value (NOT NULL on the history row);
--   the frontend looks this up from clients_projection before the RPC call.
--
-- * G6 — BACKFILL: Existing is_current rows inherit the client's current
--   organization_unit_id (idempotent via IS NULL guard).
--
-- * G2 — VERIFICATION: Trailing commented SELECTs document the expected
--   post-apply state.
--
-- * 1g-pre — READ-BACK PATTERN SEED: api.update_client now returns the
--   fresh projection row in response (backward-compatible addition). This
--   is a proof-of-pattern for the parked follow-up feature at
--   dev/parked/api-rpc-readback-pattern/ which generalizes read-back to
--   all api.update_* RPCs.
-- =============================================================================

-- =============================================================================
-- 1a. ALTER TABLE: add organization_unit_id to placement history
-- =============================================================================

ALTER TABLE public.client_placement_history_projection
    ADD COLUMN IF NOT EXISTS organization_unit_id uuid;

-- FK to organization_units_projection (idempotent via NOT EXISTS check)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'client_placement_history_projection_organization_unit_id_fkey'
          AND table_name = 'client_placement_history_projection'
    ) THEN
        ALTER TABLE public.client_placement_history_projection
            ADD CONSTRAINT client_placement_history_projection_organization_unit_id_fkey
            FOREIGN KEY (organization_unit_id)
            REFERENCES public.organization_units_projection(id);
    END IF;
END
$$;

-- Index on OU for "current placements at this OU" queries
CREATE INDEX IF NOT EXISTS idx_client_placement_history_ou
    ON public.client_placement_history_projection (organization_unit_id)
    WHERE is_current = true;

COMMENT ON COLUMN public.client_placement_history_projection.organization_unit_id IS
'Organizational unit (facility/site) associated with this placement. Populated
only by handle_client_placement_changed. Mutation path: api.change_client_placement.';

-- =============================================================================
-- 1b. Backfill existing is_current placements (G6)
-- Idempotent: only fills rows where OU is currently NULL.
-- =============================================================================

UPDATE public.client_placement_history_projection ph
SET organization_unit_id = c.organization_unit_id,
    updated_at = COALESCE(ph.updated_at, now())
FROM public.clients_projection c
WHERE ph.client_id = c.id
  AND ph.is_current = true
  AND c.organization_unit_id IS NOT NULL
  AND ph.organization_unit_id IS NULL;

-- =============================================================================
-- 1c. api.change_client_placement — accept p_organization_unit_id (C3, M8)
-- Preserves existing read-back guard. Adds OU validation (must belong to
-- caller's org). Response adds organization_unit_id + organization_unit_name.
--
-- Note: PostgreSQL identifies functions by (name, input arg types). Adding
-- p_organization_unit_id changes the signature, so we must DROP the old
-- 7-arg function explicitly — otherwise CREATE OR REPLACE creates a new
-- overload and callers resolve to the stale one when they don't pass OU.
-- =============================================================================

DROP FUNCTION IF EXISTS api.change_client_placement(uuid, text, date, text, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION api.change_client_placement(
    p_client_id uuid,
    p_placement_arrangement text,
    p_start_date date DEFAULT CURRENT_DATE,
    p_reason_text text DEFAULT NULL,
    p_reason text DEFAULT 'Placement changed',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL,
    p_organization_unit_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_placement_id uuid := gen_random_uuid();
    v_ou_org_id uuid;
    v_ou_name text;
    v_result record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    -- Validate OU (if supplied) belongs to caller's organization
    IF p_organization_unit_id IS NOT NULL THEN
        SELECT organization_id, COALESCE(display_name, name)
          INTO v_ou_org_id, v_ou_name
        FROM organization_units_projection
        WHERE id = p_organization_unit_id;

        IF v_ou_org_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Organizational unit not found');
        END IF;
        IF v_ou_org_id <> v_org_id THEN
            RETURN jsonb_build_object('success', false, 'error', 'Organizational unit does not belong to caller organization');
        END IF;
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.placement.changed',
        p_event_data := jsonb_build_object(
            'placement_id', v_placement_id,
            'organization_id', v_org_id,
            'placement_arrangement', p_placement_arrangement,
            'start_date', p_start_date,
            'reason', p_reason_text,
            'organization_unit_id', p_organization_unit_id
        ),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- Read-back guard: verify the new placement history row exists
    SELECT id, placement_arrangement, organization_unit_id INTO v_result
    FROM client_placement_history_projection
    WHERE id = v_placement_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.placement.changed'
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown')
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'placement_id', v_placement_id,
        'organization_unit_id', v_result.organization_unit_id,
        'organization_unit_name', v_ou_name
    );
END;
$$;

GRANT EXECUTE ON FUNCTION api.change_client_placement(uuid, text, date, text, text, jsonb, uuid, uuid) TO authenticated, service_role;

-- =============================================================================
-- 1d. handle_client_placement_changed — FOR UPDATE lock + OU column (C4)
-- Row lock on the existing is_current=true row serializes concurrent
-- placement changes for the same client. Denormalizes organization_unit_id
-- to clients_projection.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_placement_changed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_new_placement text;
    v_start_date date;
    v_new_ou_id uuid;
    v_current_placement_id uuid;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_new_placement := p_event.event_data->>'placement_arrangement';
    v_start_date := (p_event.event_data->>'start_date')::date;

    -- OU is optional on the event (historical events have no OU); cast is nullable-safe
    v_new_ou_id := NULLIF(p_event.event_data->>'organization_unit_id', '')::uuid;

    -- C4: Lock the existing current placement row (if any) before the transition.
    -- Concurrent placement events for the same client serialize here.
    SELECT id INTO v_current_placement_id
    FROM client_placement_history_projection
    WHERE client_id = v_client_id
      AND organization_id = v_org_id
      AND is_current = true
    FOR UPDATE;

    -- Close previous current placement (no-op if first placement)
    IF v_current_placement_id IS NOT NULL THEN
        UPDATE client_placement_history_projection SET
            is_current = false,
            end_date = v_start_date,
            updated_at = p_event.created_at,
            last_event_id = p_event.id
        WHERE id = v_current_placement_id;
    END IF;

    -- Insert new current placement (includes OU)
    INSERT INTO client_placement_history_projection (
        id, client_id, organization_id, placement_arrangement, start_date,
        is_current, reason, organization_unit_id,
        created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'placement_id')::uuid,
        v_client_id,
        v_org_id,
        v_new_placement,
        v_start_date,
        true,
        p_event.event_data->>'reason',
        v_new_ou_id,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT ON CONSTRAINT client_placement_history_projection_pkey DO UPDATE SET
        placement_arrangement = EXCLUDED.placement_arrangement,
        start_date = EXCLUDED.start_date,
        is_current = true,
        reason = EXCLUDED.reason,
        organization_unit_id = EXCLUDED.organization_unit_id,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;

    -- Denormalize current placement + OU onto clients_projection
    -- This is the SOLE mutation path for clients_projection.organization_unit_id
    -- after client creation (C3).
    UPDATE clients_projection SET
        placement_arrangement = v_new_placement,
        organization_unit_id = v_new_ou_id,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;

-- =============================================================================
-- 1e. api.get_client — explicit jsonb_build_object + OU name join (M5)
-- Replaces row_to_json(ph)::jsonb with explicit field enumeration so the
-- LEFT JOIN to organization_units_projection can surface display_name.
-- =============================================================================

CREATE OR REPLACE FUNCTION api.get_client(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_client jsonb;
    v_phones jsonb;
    v_emails jsonb;
    v_addresses jsonb;
    v_insurance jsonb;
    v_placements jsonb;
    v_funding jsonb;
    v_assignments jsonb;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('client.view', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.view');
    END IF;

    SELECT row_to_json(c)::jsonb INTO v_client
    FROM clients_projection c
    WHERE c.id = p_client_id AND c.organization_id = v_org_id;

    IF v_client IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) INTO v_phones
    FROM client_phones_projection p WHERE p.client_id = p_client_id AND p.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb) INTO v_emails
    FROM client_emails_projection e WHERE e.client_id = p_client_id AND e.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb) INTO v_addresses
    FROM client_addresses_projection a WHERE a.client_id = p_client_id AND a.is_active = true;

    SELECT COALESCE(jsonb_agg(row_to_json(i)::jsonb), '[]'::jsonb) INTO v_insurance
    FROM client_insurance_policies_projection i WHERE i.client_id = p_client_id AND i.is_active = true;

    -- Placement history: explicit fields + OU name from LEFT JOIN (M5)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ph.id,
            'client_id', ph.client_id,
            'organization_id', ph.organization_id,
            'placement_arrangement', ph.placement_arrangement,
            'start_date', ph.start_date,
            'end_date', ph.end_date,
            'is_current', ph.is_current,
            'reason', ph.reason,
            'created_at', ph.created_at,
            'updated_at', ph.updated_at,
            'last_event_id', ph.last_event_id,
            'organization_unit_id', ph.organization_unit_id,
            'organization_unit_name', COALESCE(ou.display_name, ou.name)
        ) ORDER BY ph.start_date DESC
    ), '[]'::jsonb) INTO v_placements
    FROM client_placement_history_projection ph
    LEFT JOIN organization_units_projection ou ON ou.id = ph.organization_unit_id
    WHERE ph.client_id = p_client_id;

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
        'phones', v_phones,
        'emails', v_emails,
        'addresses', v_addresses,
        'insurance_policies', v_insurance,
        'placement_history', v_placements,
        'funding_sources', v_funding,
        'contact_assignments', v_assignments
    ));
END;
$$;

-- =============================================================================
-- 1f. handle_client_information_updated — remove organization_unit_id write (C3)
-- OU is no longer mutable through update_client. Any OU change must emit
-- client.placement.changed via api.change_client_placement. This prevents
-- divergence between clients_projection.organization_unit_id and the
-- placement history audit trail.
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
        -- Admission (C3: organization_unit_id intentionally omitted; mutate via api.change_client_placement)
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

COMMENT ON FUNCTION public.handle_client_information_updated(record) IS
'Projects client.information_updated events to clients_projection. Per C3,
does NOT mutate organization_unit_id — that column is the denormalized
current-placement OU and is maintained exclusively by
handle_client_placement_changed.';

-- =============================================================================
-- 1g. handle_client_admitted — remove organization_unit_id write (C3)
-- Admission emits client.admitted but must not mutate OU on clients_projection.
-- The intake flow calls api.change_client_placement after registration to
-- establish the initial OU + placement. Admission itself handles status
-- transition and admission-metadata fields only.
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
        -- C3: organization_unit_id intentionally NOT mutated here; use api.change_client_placement.
        primary_diagnosis = CASE WHEN p_event.event_data ? 'primary_diagnosis' THEN p_event.event_data->'primary_diagnosis' ELSE primary_diagnosis END,
        updated_at = p_event.created_at,
        updated_by = v_user_id,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;

COMMENT ON FUNCTION public.handle_client_admitted(record) IS
'Projects client.admitted events to clients_projection (status + admission
metadata). Per C3, does NOT mutate organization_unit_id; that is set only
by handle_client_registered at creation time and handle_client_placement_changed
on every subsequent placement event.';

-- =============================================================================
-- 1g-pre. api.update_client — enrich read-back response (seeds parked follow-up)
-- Returns fresh projection row in response under "client" field.
-- Backward-compatible: existing callers reading success/client_id continue
-- to work. New callers can optionally consume response.client.
-- Proof-of-pattern for dev/parked/api-rpc-readback-pattern/ which generalizes
-- this across all api.update_* RPCs (feature-level Phase 9).
-- Error codes:
--   P9003 — projection row missing after event emit (should be unreachable
--           because the event handler writes synchronously in-trigger, but
--           we surface it defensively).
--   P9004 — handler raised an exception; processing_error captured.
-- =============================================================================

CREATE OR REPLACE FUNCTION api.update_client(
    p_client_id uuid,
    p_changes jsonb,
    p_reason text DEFAULT 'Client information updated',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_row clients_projection%ROWTYPE;
    v_processing_error text;
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
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.information_updated',
        p_event_data := jsonb_build_object('organization_id', v_org_id, 'changes', p_changes),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- Read-back: fresh projection row for response.
    SELECT * INTO v_row FROM clients_projection WHERE id = p_client_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.information_updated'
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown')
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'client_id', p_client_id,
        'client', row_to_json(v_row)::jsonb
    );
END;
$$;

-- =============================================================================
-- 1h. Seed client.transfer permission (M1)
-- Matches the pattern from 20260406221739_client_permissions_seed.sql.
-- Granted to provider_admin by default; NOT granted to clinician — orgs can
-- extend via api.grant_role_permission.
-- =============================================================================

-- 1h.1: Emit permission.defined event
DO $$ BEGIN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (
        gen_random_uuid(), 'permission', 1, 'permission.defined',
        '{"applet": "client", "action": "transfer", "description": "Change a client''s placement or organizational unit (emits client.placement.changed)", "scope_type": "org", "requires_mfa": false}'::jsonb,
        '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client transfer permission for OU/placement edits"}'::jsonb
    );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- 1h.2: Add to provider_admin template (used by bootstrap for new orgs)
INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'client.transfer', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- 1h.3: Permission implications — transfer → view, transfer → update
INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'client.transfer' AND p2.name = 'client.view'
ON CONFLICT DO NOTHING;

INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'client.transfer' AND p2.name = 'client.update'
ON CONFLICT DO NOTHING;

-- 1h.4: Backfill — grant client.transfer to existing provider_admin roles
INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
SELECT rp.id AS role_id, pp.id AS permission_id, now()
FROM roles_projection rp
CROSS JOIN permissions_projection pp
WHERE rp.name = 'provider_admin'
  AND rp.is_active = true
  AND pp.name = 'client.transfer'
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions_projection rpp
      WHERE rpp.role_id = rp.id AND rpp.permission_id = pp.id
  )
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 1i. Verification queries (G2) — run manually post-apply
-- =============================================================================
-- -- Column exists with FK:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'client_placement_history_projection'
--     AND column_name = 'organization_unit_id';
-- SELECT conname FROM pg_constraint
--   WHERE conname = 'client_placement_history_projection_organization_unit_id_fkey';
--
-- -- RPC signature updated (8 args including p_organization_unit_id):
-- SELECT proname, pg_get_function_arguments(oid) FROM pg_proc
--   WHERE proname = 'change_client_placement' AND pronamespace = 'api'::regnamespace;
--
-- -- Permission seeded:
-- SELECT name, description FROM permissions_projection WHERE name = 'client.transfer';
-- SELECT role_name FROM role_permission_templates WHERE permission_name = 'client.transfer';
--
-- -- Backfill applied (should report count of is_current rows with OU):
-- SELECT COUNT(*) AS backfilled_rows
-- FROM client_placement_history_projection
-- WHERE is_current = true AND organization_unit_id IS NOT NULL;
--
-- -- Handler OU mutation removed from information_updated + admitted:
-- SELECT prosrc FROM pg_proc WHERE proname = 'handle_client_information_updated'
--   AND prosrc NOT LIKE '%organization_unit_id = CASE%';
-- SELECT prosrc FROM pg_proc WHERE proname = 'handle_client_admitted'
--   AND prosrc NOT LIKE '%organization_unit_id = CASE%';
--
-- -- api.get_client returns organization_unit_name for a sample client:
-- SELECT api.get_client(id) FROM clients_projection LIMIT 1;
