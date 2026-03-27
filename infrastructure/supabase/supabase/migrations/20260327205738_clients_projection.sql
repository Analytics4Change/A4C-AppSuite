-- Migration: clients_projection
-- Creates the core client (patient) projection table for the Client Management Applet.
-- This is a CQRS read model populated by event handlers (stream_type: 'client').
-- ~50 typed columns covering demographics, referral, admission, clinical, medical,
-- legal, discharge, education, and org-defined custom fields (JSONB).

-- =============================================================================
-- 1. CREATE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."clients_projection" (
    -- Primary key + tenant isolation
    "id"                          uuid DEFAULT gen_random_uuid() NOT NULL,
    "organization_id"             uuid NOT NULL,
    "organization_unit_id"        uuid,

    -- Lifecycle
    "status"                      text DEFAULT 'active' NOT NULL,
    "data_source"                 text DEFAULT 'manual' NOT NULL,

    -- Demographics (Step 1)
    "first_name"                  text NOT NULL,
    "last_name"                   text NOT NULL,
    "middle_name"                 text,
    "preferred_name"              text,
    "date_of_birth"               date NOT NULL,
    "gender"                      text NOT NULL,
    "gender_identity"             text,
    "pronouns"                    text,
    "race"                        text[],
    "ethnicity"                   text,
    "primary_language"            text,
    "secondary_language"          text,
    "interpreter_needed"          boolean,
    "marital_status"              text,
    "citizenship_status"          text,
    "photo_url"                   text,
    "mrn"                         text,
    "external_id"                 text,
    "drivers_license"             text,

    -- Referral (Step 4)
    "referral_source_type"        text,
    "referral_organization"       text,
    "referral_date"               date,
    "reason_for_referral"         text,

    -- Admission (Step 5)
    "admission_date"              date NOT NULL,
    "admission_type"              text,
    "level_of_care"               text,
    "expected_length_of_stay"     integer,
    "initial_risk_level"          text,
    "discharge_plan_status"       text,
    "placement_arrangement"       text,

    -- Insurance IDs (Step 6)
    "medicaid_id"                 text,
    "medicare_id"                 text,

    -- Clinical Profile (Step 7)
    "primary_diagnosis"           jsonb,
    "secondary_diagnoses"         jsonb,
    "dsm5_diagnoses"              jsonb,
    "presenting_problem"          text,
    "suicide_risk_status"         text,
    "violence_risk_status"        text,
    "trauma_history_indicator"    boolean,
    "substance_use_history"       text,
    "developmental_history"       text,
    "previous_treatment_history"  text,

    -- Medical (Step 8)
    "allergies"                   jsonb NOT NULL DEFAULT '{"nka": true, "items": []}'::jsonb,
    "medical_conditions"          jsonb NOT NULL DEFAULT '{"nkmc": true, "items": []}'::jsonb,
    "immunization_status"         text,
    "dietary_restrictions"        text,
    "special_medical_needs"       text,

    -- Legal (Step 9)
    "legal_custody_status"        text,
    "court_ordered_placement"     boolean,
    "financial_guarantor_type"    text,
    "court_case_number"           text,
    "state_agency"                text,
    "legal_status"                text,
    "mandated_reporting_status"   boolean,
    "protective_services_involvement" boolean,
    "safety_plan_required"        boolean,

    -- Discharge (Step 10, Decision 78: three-field decomposition)
    "discharge_date"              date,
    "discharge_outcome"           text,
    "discharge_reason"            text,
    "discharge_diagnosis"         jsonb,
    "discharge_placement"         text,

    -- Education
    "education_status"            text,
    "grade_level"                 text,
    "iep_status"                  boolean,

    -- Custom fields (org-defined via field registry)
    "custom_fields"               jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Audit
    "created_at"                  timestamptz NOT NULL DEFAULT now(),
    "updated_at"                  timestamptz NOT NULL DEFAULT now(),
    "created_by"                  uuid NOT NULL,
    "updated_by"                  uuid NOT NULL,

    -- Event handler idempotency
    "last_event_id"               uuid,

    CONSTRAINT "clients_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clients_projection_status_check" CHECK (status IN ('active', 'inactive', 'discharged')),
    CONSTRAINT "clients_projection_data_source_check" CHECK (data_source IN ('manual', 'api', 'import'))
);

ALTER TABLE "public"."clients_projection" OWNER TO "postgres";

-- =============================================================================
-- 2. FOREIGN KEYS
-- =============================================================================

ALTER TABLE "public"."clients_projection"
    ADD CONSTRAINT "clients_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

ALTER TABLE "public"."clients_projection"
    ADD CONSTRAINT "clients_projection_organization_unit_id_fkey"
    FOREIGN KEY ("organization_unit_id") REFERENCES "public"."organization_units_projection"("id");

ALTER TABLE "public"."clients_projection"
    ADD CONSTRAINT "clients_projection_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");

ALTER TABLE "public"."clients_projection"
    ADD CONSTRAINT "clients_projection_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");

-- FK from existing user_client_assignments_projection to this new table.
-- Column already exists with comment "No FK constraint yet - clients table will be created in a future migration."
ALTER TABLE "public"."user_client_assignments_projection"
    ADD CONSTRAINT "user_client_assignments_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

-- =============================================================================
-- 3. INDEXES
-- =============================================================================

-- Org isolation (most common filter)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_org"
    ON "public"."clients_projection" USING btree ("organization_id");

-- Org + status (filtered listing)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_org_status"
    ON "public"."clients_projection" USING btree ("organization_id", "status");

-- Name search (last, first for sorted listings)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_name"
    ON "public"."clients_projection" USING btree ("organization_id", "last_name", "first_name");

-- Date of birth (age-based queries, duplicate detection)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_dob"
    ON "public"."clients_projection" USING btree ("organization_id", "date_of_birth");

-- Org unit placement
CREATE INDEX IF NOT EXISTS "idx_clients_projection_org_unit"
    ON "public"."clients_projection" USING btree ("organization_unit_id")
    WHERE ("organization_unit_id" IS NOT NULL);

-- Custom fields (JSONB containment queries)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_custom_fields"
    ON "public"."clients_projection" USING gin ("custom_fields");

-- MRN lookup (org-scoped)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_mrn"
    ON "public"."clients_projection" USING btree ("organization_id", "mrn")
    WHERE ("mrn" IS NOT NULL);

-- External ID lookup (for imports)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_external_id"
    ON "public"."clients_projection" USING btree ("organization_id", "external_id")
    WHERE ("external_id" IS NOT NULL);

-- Admission date (cohort analysis)
CREATE INDEX IF NOT EXISTS "idx_clients_projection_admission_date"
    ON "public"."clients_projection" USING btree ("organization_id", "admission_date");

-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE "public"."clients_projection" ENABLE ROW LEVEL SECURITY;

-- SELECT: Any org member can read clients in their org (no permission check —
-- clinicians, therapists, etc. all need client visibility)
CREATE POLICY "clients_projection_select"
    ON "public"."clients_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

-- Platform admin override (all operations)
CREATE POLICY "clients_projection_platform_admin"
    ON "public"."clients_projection"
    USING ("public"."has_platform_privilege"());

-- Note: No INSERT/UPDATE/DELETE policies for authenticated role.
-- This is a CQRS projection — writes come from event handlers running as
-- service_role, which bypasses RLS. Future client.* permission checks are
-- enforced at the API function layer (api.register_client, api.update_client, etc.)

-- =============================================================================
-- 5. GRANTS
-- =============================================================================

-- Read-only for authenticated users (CQRS projection)
GRANT SELECT ON TABLE "public"."clients_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."clients_projection" TO "service_role";

-- =============================================================================
-- 6. COMMENTS
-- =============================================================================

COMMENT ON TABLE "public"."clients_projection" IS
'CQRS projection of client.* events — the core client (patient) record for
residential behavioral healthcare. ~50 typed columns covering demographics,
referral, admission, clinical profile, medical, legal, discharge, and education.

Stream type: client
Event types: client.registered, client.updated, client.admitted, client.discharged,
  client.reverse_discharged, client.readmitted, client.status_changed,
  client.custom_fields_updated
Handler: process_client_event() router → individual handlers

Org-configurable fields use configurable_presence via client_field_definitions_projection.
Org-defined custom fields stored in custom_fields JSONB column.

Mandatory at intake: first_name, last_name, date_of_birth, gender, admission_date,
  allergies (default NKA), medical_conditions (default NKMC)
Mandatory at discharge: discharge_date, discharge_outcome, discharge_reason';

COMMENT ON COLUMN "public"."clients_projection"."status" IS
'Client lifecycle status: active (enrolled), inactive (paused), discharged (completed care).';

COMMENT ON COLUMN "public"."clients_projection"."data_source" IS
'How this client record was created: manual (staff entry), api (external system), import (bulk upload).';

COMMENT ON COLUMN "public"."clients_projection"."race" IS
'OMB multi-select race categories. Text array allows multiple selections per federal requirements.';

COMMENT ON COLUMN "public"."clients_projection"."ethnicity" IS
'OMB single-select: Hispanic or Latino, Not Hispanic or Latino. First question in OMB two-question format.';

COMMENT ON COLUMN "public"."clients_projection"."allergies" IS
'JSONB: {nka: boolean, items: [{name, allergy_type (medication|food|environmental), severity}]}.
NKA = No Known Allergies. Default value indicates NKA with empty items array.';

COMMENT ON COLUMN "public"."clients_projection"."medical_conditions" IS
'JSONB: {nkmc: boolean, items: [{code, description, is_chronic}]}.
NKMC = No Known Medical Conditions. Default value indicates NKMC with empty items array.';

COMMENT ON COLUMN "public"."clients_projection"."primary_diagnosis" IS
'ICD-10 diagnosis: {code, description}. Intake snapshot — longitudinal tracking deferred.';

COMMENT ON COLUMN "public"."clients_projection"."secondary_diagnoses" IS
'ICD-10 array: [{code, description}]. Multiple secondary diagnoses supported.';

COMMENT ON COLUMN "public"."clients_projection"."dsm5_diagnoses" IS
'DSM-5 array: [{code, description}]. Separate from ICD-10 for clinical precision.';

COMMENT ON COLUMN "public"."clients_projection"."discharge_outcome" IS
'Decision 78: Binary discharge outcome — successful or unsuccessful. Primary reporting dimension for program success rates.';

COMMENT ON COLUMN "public"."clients_projection"."discharge_reason" IS
'Decision 78: 14-value enum capturing why the client was discharged.
Values: graduated_program, achieved_treatment_goals, awol, ama, administrative,
hospitalization_medical, insufficient_progress, intermediate_secure_care,
secure_care, ten_day_notice, court_ordered, deceased, transfer, medical.';

COMMENT ON COLUMN "public"."clients_projection"."discharge_placement" IS
'Decision 78: 9-value enum capturing where the client went after discharge.
Values: home, lower_level_of_care, higher_level_of_care, secure_care,
intermediate_secure_care, other_program, hospitalization, incarceration, other.';

COMMENT ON COLUMN "public"."clients_projection"."placement_arrangement" IS
'Decision 83: Denormalized current placement arrangement (13 SAMHSA/state Medicaid values).
Updated by client.placement.changed handler. Full history in client_placement_history table.';

COMMENT ON COLUMN "public"."clients_projection"."legal_custody_status" IS
'Decision 82: Who holds legal authority — distinct from placement_arrangement (where client lives).
Values: parent_guardian, state_child_welfare, juvenile_justice, guardianship, emancipated_minor, other.';

COMMENT ON COLUMN "public"."clients_projection"."financial_guarantor_type" IS
'Decision 84: Who pays — distinct from legal_custody_status (who has legal authority).
Values: parent_guardian, state_agency, juvenile_justice, self, insurance_only, tribal_agency, va, other.';

COMMENT ON COLUMN "public"."clients_projection"."custom_fields" IS
'Org-defined custom fields as flat key-value JSONB. Keys are semantic (e.g., "house_assignment"),
never positional ("custom_field_1"). Structure/metadata in client_field_definitions_projection.
GIN-indexed for containment queries.';

COMMENT ON COLUMN "public"."clients_projection"."last_event_id" IS
'ID of the last domain event that updated this projection row. Used for handler idempotency.';

-- Update comment on user_client_assignments_projection.client_id now that FK exists
COMMENT ON COLUMN "public"."user_client_assignments_projection"."client_id" IS
'Client being assigned to this staff member. FK to clients_projection(id).';
