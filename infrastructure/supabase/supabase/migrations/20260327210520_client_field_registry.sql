-- Migration: client_field_registry
-- Creates the field configuration infrastructure for the Client Management Applet:
--   1. client_field_categories — system + org-defined field categories (event-sourced, Decision 87)
--   2. client_field_definitions_projection — org-configurable field registry (CQRS)
--   3. client_reference_values — global reference data (ISO 639 languages)
--   4. client_field_definition_templates — seed templates for org bootstrap (like role_permission_templates)

-- =============================================================================
-- 1. client_field_categories
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_field_categories" (
    "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid,
    "name"            text NOT NULL,
    "slug"            text NOT NULL,
    "sort_order"      integer NOT NULL DEFAULT 0,
    "is_active"       boolean NOT NULL DEFAULT true,
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz NOT NULL DEFAULT now(),
    "last_event_id"   uuid,

    CONSTRAINT "client_field_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_field_categories_slug_org_unique" UNIQUE ("organization_id", "slug")
);

ALTER TABLE "public"."client_field_categories" OWNER TO "postgres";

-- FK to organizations (nullable — NULL = system/app-owner category)
ALTER TABLE "public"."client_field_categories"
    ADD CONSTRAINT "client_field_categories_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_field_categories_org"
    ON "public"."client_field_categories" USING btree ("organization_id");

-- RLS
ALTER TABLE "public"."client_field_categories" ENABLE ROW LEVEL SECURITY;

-- SELECT: Any authenticated user can read system categories (org_id IS NULL)
-- and categories belonging to their org
CREATE POLICY "client_field_categories_select"
    ON "public"."client_field_categories"
    FOR SELECT
    USING (
        "organization_id" IS NULL
        OR "organization_id" = "public"."get_current_org_id"()
    );

-- Platform admin override
CREATE POLICY "client_field_categories_platform_admin"
    ON "public"."client_field_categories"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_field_categories" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_field_categories" TO "service_role";

-- Comments
COMMENT ON TABLE "public"."client_field_categories" IS
'Field categories for grouping client field definitions in the configuration UI.
System categories (organization_id IS NULL) are seeded and locked. Orgs can create
custom categories via client_field_category.created events (Decision 87).

Stream type: client_field_category
Event types: client_field_category.created, client_field_category.deactivated';

COMMENT ON COLUMN "public"."client_field_categories"."organization_id" IS
'NULL = system/app-owner category (shared, read-only for tenants). Non-NULL = org-defined custom category.';

COMMENT ON COLUMN "public"."client_field_categories"."slug" IS
'URL-safe identifier. UNIQUE per org (including NULL for system categories). Used as tab key in configuration UI.';

-- Seed system categories (organization_id = NULL)
-- Sort order matches intake wizard step ordering
INSERT INTO "public"."client_field_categories" ("id", "organization_id", "name", "slug", "sort_order")
VALUES
    ('a0000000-0000-0000-0000-000000000001', NULL, 'Demographics',        'demographics',  1),
    ('a0000000-0000-0000-0000-000000000002', NULL, 'Contact Information', 'contact_info',  2),
    ('a0000000-0000-0000-0000-000000000003', NULL, 'Guardian',            'guardian',      3),
    ('a0000000-0000-0000-0000-000000000004', NULL, 'Referral',            'referral',      4),
    ('a0000000-0000-0000-0000-000000000005', NULL, 'Admission',           'admission',     5),
    ('a0000000-0000-0000-0000-000000000006', NULL, 'Insurance',           'insurance',     6),
    ('a0000000-0000-0000-0000-000000000007', NULL, 'Clinical Profile',    'clinical',      7),
    ('a0000000-0000-0000-0000-000000000008', NULL, 'Medical',             'medical',       8),
    ('a0000000-0000-0000-0000-000000000009', NULL, 'Legal & Compliance',  'legal',         9),
    ('a0000000-0000-0000-0000-00000000000a', NULL, 'Discharge',           'discharge',    10),
    ('a0000000-0000-0000-0000-00000000000b', NULL, 'Education',           'education',    11)
ON CONFLICT ("organization_id", "slug") DO NOTHING;

-- =============================================================================
-- 2. client_field_definitions_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_field_definitions_projection" (
    "id"                          uuid DEFAULT gen_random_uuid() NOT NULL,
    "organization_id"             uuid NOT NULL,
    "category_id"                 uuid NOT NULL,
    "field_key"                   text NOT NULL,
    "display_name"                text NOT NULL,
    "field_type"                  text NOT NULL DEFAULT 'text',
    "is_visible"                  boolean NOT NULL DEFAULT true,
    "is_required"                 boolean NOT NULL DEFAULT false,
    "validation_rules"            jsonb,
    "is_dimension"                boolean NOT NULL DEFAULT false,
    "sort_order"                  integer NOT NULL DEFAULT 0,
    "configurable_label"          text,
    "conforming_dimension_mapping" text,
    "is_active"                   boolean NOT NULL DEFAULT true,
    "created_at"                  timestamptz NOT NULL DEFAULT now(),
    "updated_at"                  timestamptz NOT NULL DEFAULT now(),
    "last_event_id"               uuid,

    CONSTRAINT "client_field_definitions_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_field_definitions_field_type_check" CHECK (
        field_type IN ('text', 'number', 'date', 'enum', 'multi_enum', 'boolean', 'jsonb')
    ),
    CONSTRAINT "client_field_definitions_org_key_unique" UNIQUE ("organization_id", "field_key")
);

ALTER TABLE "public"."client_field_definitions_projection" OWNER TO "postgres";

-- Foreign keys
ALTER TABLE "public"."client_field_definitions_projection"
    ADD CONSTRAINT "client_field_definitions_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

ALTER TABLE "public"."client_field_definitions_projection"
    ADD CONSTRAINT "client_field_definitions_projection_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "public"."client_field_categories"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_field_definitions_org"
    ON "public"."client_field_definitions_projection" USING btree ("organization_id");

CREATE INDEX IF NOT EXISTS "idx_client_field_definitions_org_category"
    ON "public"."client_field_definitions_projection" USING btree ("organization_id", "category_id");

CREATE INDEX IF NOT EXISTS "idx_client_field_definitions_org_active"
    ON "public"."client_field_definitions_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

-- RLS (Decision 89: relaxed read — org member only, no permission check)
ALTER TABLE "public"."client_field_definitions_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_field_definitions_select"
    ON "public"."client_field_definitions_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_field_definitions_platform_admin"
    ON "public"."client_field_definitions_projection"
    USING ("public"."has_platform_privilege"());

-- Grants (read-only — writes via event handlers)
GRANT SELECT ON TABLE "public"."client_field_definitions_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_field_definitions_projection" TO "service_role";

-- Comments
COMMENT ON TABLE "public"."client_field_definitions_projection" IS
'CQRS projection of client_field_definition.* events — per-org field configuration registry.
Controls field visibility, required flags, display labels, and analytics exposure.

Stream type: client_field_definition
Event types: client_field_definition.created, client_field_definition.updated,
  client_field_definition.deactivated

Seeded per org during bootstrap from client_field_definition_templates.
Frontend reads these to render configurable intake/discharge forms.
Configuration UI at /settings/client-fields allows org admins to toggle visibility,
required flags, and custom labels (permission: organization.update).';

COMMENT ON COLUMN "public"."client_field_definitions_projection"."field_key" IS
'Semantic key matching column name on clients_projection (e.g., "race", "admission_type").
For custom fields: org-defined semantic key stored in custom_fields JSONB. Never positional.';

COMMENT ON COLUMN "public"."client_field_definitions_projection"."is_visible" IS
'Whether this field appears in the intake/discharge form for this org. Configurable_presence fields
can be toggled. Mandatory fields (first_name, admission_date, etc.) are always visible and locked.';

COMMENT ON COLUMN "public"."client_field_definitions_projection"."is_required" IS
'Decision 69: Org admin can mark any visible field as "Required when visible". Enforcement at API
function layer (api.register_client validates non-null). DB columns stay nullable — required-ness
is a per-org business rule, not a schema invariant.';

COMMENT ON COLUMN "public"."client_field_definitions_projection"."is_dimension" IS
'Whether this field is exposed as a Cube.js dimension for this org. Conforming dimensions
(gender, race, ethnicity, admission_date, etc.) are always dimensions. Custom fields can be
promoted to org-scoped dimensions.';

COMMENT ON COLUMN "public"."client_field_definitions_projection"."configurable_label" IS
'Org-level display label override. Used for designations (e.g., "Clinician" → "Primary Counselor")
and state_agency (e.g., "State Agency" → "DCFS"). NULL = use default display_name.';

COMMENT ON COLUMN "public"."client_field_definitions_projection"."conforming_dimension_mapping" IS
'Canonical key for cross-org Cube.js analytics. When org renames a field label, this mapping ensures
the underlying dimension key stays consistent across all organizations.';

-- =============================================================================
-- 3. client_reference_values
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_reference_values" (
    "id"            uuid DEFAULT gen_random_uuid() NOT NULL,
    "category"      text NOT NULL,
    "code"          text NOT NULL,
    "display_name"  text NOT NULL,
    "sort_order"    integer,
    "is_active"     boolean NOT NULL DEFAULT true,

    CONSTRAINT "client_reference_values_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_reference_values_category_code_unique" UNIQUE ("category", "code")
);

ALTER TABLE "public"."client_reference_values" OWNER TO "postgres";

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_reference_values_category"
    ON "public"."client_reference_values" USING btree ("category")
    WHERE ("is_active" = true);

-- RLS (global read-only reference data — any authenticated user)
ALTER TABLE "public"."client_reference_values" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_reference_values_select"
    ON "public"."client_reference_values"
    FOR SELECT
    USING (true);

-- Platform admin can write
CREATE POLICY "client_reference_values_platform_admin"
    ON "public"."client_reference_values"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_reference_values" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_reference_values" TO "service_role";

-- Comments
COMMENT ON TABLE "public"."client_reference_values" IS
'Global reference data for client fields. Not org-scoped — shared across all organizations.
Currently seeds ISO 639 languages for primary_language/secondary_language runtime search.
Read-only for tenants. Managed by platform admin via SQL or future admin UI.';

COMMENT ON COLUMN "public"."client_reference_values"."category" IS
'Reference data category. Current: "language" (ISO 639). Future: could add others.';

COMMENT ON COLUMN "public"."client_reference_values"."code" IS
'Canonical code stored in clients_projection (e.g., ISO 639-1 "en", "es").';

-- Seed ISO 639 languages (top 40 by US healthcare relevance)
INSERT INTO "public"."client_reference_values" ("category", "code", "display_name", "sort_order")
VALUES
    ('language', 'en',  'English',                1),
    ('language', 'es',  'Spanish',                2),
    ('language', 'zh',  'Chinese (Mandarin)',     3),
    ('language', 'vi',  'Vietnamese',             4),
    ('language', 'tl',  'Tagalog',                5),
    ('language', 'ko',  'Korean',                 6),
    ('language', 'ar',  'Arabic',                 7),
    ('language', 'fr',  'French',                 8),
    ('language', 'pt',  'Portuguese',             9),
    ('language', 'ru',  'Russian',               10),
    ('language', 'ja',  'Japanese',              11),
    ('language', 'ht',  'Haitian Creole',        12),
    ('language', 'de',  'German',                13),
    ('language', 'hi',  'Hindi',                 14),
    ('language', 'bn',  'Bengali',               15),
    ('language', 'ur',  'Urdu',                  16),
    ('language', 'pa',  'Punjabi',               17),
    ('language', 'gu',  'Gujarati',              18),
    ('language', 'pl',  'Polish',                19),
    ('language', 'it',  'Italian',               20),
    ('language', 'fa',  'Farsi (Persian)',       21),
    ('language', 'am',  'Amharic',               22),
    ('language', 'sw',  'Swahili',               23),
    ('language', 'my',  'Burmese',               24),
    ('language', 'ne',  'Nepali',                25),
    ('language', 'th',  'Thai',                  26),
    ('language', 'km',  'Khmer',                 27),
    ('language', 'lo',  'Lao',                   28),
    ('language', 'hmn', 'Hmong',                 29),
    ('language', 'so',  'Somali',                30),
    ('language', 'yo',  'Yoruba',                31),
    ('language', 'ig',  'Igbo',                  32),
    ('language', 'el',  'Greek',                 33),
    ('language', 'he',  'Hebrew',                34),
    ('language', 'uk',  'Ukrainian',             35),
    ('language', 'ro',  'Romanian',              36),
    ('language', 'ms',  'Malay',                 37),
    ('language', 'id',  'Indonesian',            38),
    ('language', 'nav', 'Navajo',                39),
    ('language', 'chr', 'Cherokee',              40)
ON CONFLICT ("category", "code") DO NOTHING;

-- =============================================================================
-- 4. client_field_definition_templates
-- =============================================================================
-- Seed data copied to client_field_definitions_projection for each new org
-- during bootstrap (like role_permission_templates). Platform-managed.

CREATE TABLE IF NOT EXISTS "public"."client_field_definition_templates" (
    "id"                          uuid DEFAULT gen_random_uuid() NOT NULL,
    "field_key"                   text NOT NULL,
    "category_slug"               text NOT NULL,
    "display_name"                text NOT NULL,
    "field_type"                  text NOT NULL DEFAULT 'text',
    "is_visible"                  boolean NOT NULL DEFAULT true,
    "is_required"                 boolean NOT NULL DEFAULT false,
    "is_locked"                   boolean NOT NULL DEFAULT false,
    "validation_rules"            jsonb,
    "is_dimension"                boolean NOT NULL DEFAULT false,
    "sort_order"                  integer NOT NULL DEFAULT 0,
    "configurable_label"          text,
    "conforming_dimension_mapping" text,
    "is_active"                   boolean NOT NULL DEFAULT true,
    "created_at"                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "client_field_definition_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_field_definition_templates_key_unique" UNIQUE ("field_key")
);

ALTER TABLE "public"."client_field_definition_templates" OWNER TO "postgres";

-- RLS (same pattern as role_permission_templates — read-only for all, write for super_admin)
ALTER TABLE "public"."client_field_definition_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_field_definition_templates_read"
    ON "public"."client_field_definition_templates"
    FOR SELECT
    USING (true);

CREATE POLICY "client_field_definition_templates_write"
    ON "public"."client_field_definition_templates"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_field_definition_templates" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_field_definition_templates" TO "service_role";

-- Comments
COMMENT ON TABLE "public"."client_field_definition_templates" IS
'Seed templates for client field definitions. Copied to client_field_definitions_projection
during org bootstrap (seedFieldDefinitions activity). Analogous to role_permission_templates.

is_locked = true means the field cannot be hidden by org admin (mandatory fields).
Platform admin can modify templates via SQL — changes affect future bootstraps only.';

COMMENT ON COLUMN "public"."client_field_definition_templates"."field_key" IS
'Maps to column name on clients_projection or key in custom_fields JSONB.';

COMMENT ON COLUMN "public"."client_field_definition_templates"."category_slug" IS
'Maps to client_field_categories.slug. Resolved to category_id during bootstrap copy.';

COMMENT ON COLUMN "public"."client_field_definition_templates"."is_locked" IS
'If true, org admin cannot toggle visibility — field is always visible and required.
Used for mandatory fields like first_name, last_name, date_of_birth, gender, admission_date.';

-- =============================================================================
-- 5. SEED: field definition templates
-- =============================================================================
-- All ~43 configurable fields seeded. Mandatory fields are locked + required.
-- All visible by default (Decision: all ~40 fields visible, selective required).

INSERT INTO "public"."client_field_definition_templates"
    ("field_key", "category_slug", "display_name", "field_type", "is_visible", "is_required", "is_locked", "is_dimension", "sort_order")
VALUES
    -- ── Demographics (Step 1) ──
    ('first_name',        'demographics', 'First Name',              'text',       true, true,  true,  false, 1),
    ('last_name',         'demographics', 'Last Name',               'text',       true, true,  true,  false, 2),
    ('middle_name',       'demographics', 'Middle Name',             'text',       true, false, false, false, 3),
    ('preferred_name',    'demographics', 'Preferred Name',          'text',       true, false, false, false, 4),
    ('date_of_birth',     'demographics', 'Date of Birth',           'date',       true, true,  true,  true,  5),
    ('gender',            'demographics', 'Gender Assigned at Birth','enum',       true, true,  true,  true,  6),
    ('gender_identity',   'demographics', 'Gender Identity',         'text',       true, false, false, false, 7),
    ('pronouns',          'demographics', 'Pronouns',                'text',       true, false, false, false, 8),
    ('race',              'demographics', 'Race',                    'multi_enum', true, false, false, true,  9),
    ('ethnicity',         'demographics', 'Ethnicity',               'enum',       true, false, false, true,  10),
    ('primary_language',  'demographics', 'Primary Language',        'text',       true, false, false, true,  11),
    ('secondary_language','demographics', 'Secondary Language',      'text',       true, false, false, false, 12),
    ('interpreter_needed','demographics', 'Interpreter Needed',      'boolean',    true, false, false, false, 13),
    ('marital_status',    'demographics', 'Marital Status',          'enum',       true, false, false, false, 14),
    ('citizenship_status','demographics', 'Citizenship Status',      'enum',       true, false, false, false, 15),
    ('photo_url',         'demographics', 'Photo',                   'text',       true, false, false, false, 16),
    ('mrn',               'demographics', 'Medical Record Number',   'text',       true, false, false, false, 17),
    ('external_id',       'demographics', 'External ID',             'text',       true, false, false, false, 18),
    ('drivers_license',   'demographics', 'Driver''s License',       'text',       true, false, false, false, 19),

    -- ── Contact Information (Step 2) — sub-entity table toggles ──
    ('client_phones',     'contact_info', 'Phone Numbers',           'text',       true, false, false, false, 1),
    ('client_emails',     'contact_info', 'Email Addresses',         'text',       true, false, false, false, 2),
    ('client_addresses',  'contact_info', 'Addresses',               'text',       true, false, false, false, 3),

    -- ── Guardian (Step 3) ──
    ('legal_custody_status',    'guardian', 'Legal Custody Status',       'enum',    true, false, false, false, 1),
    ('court_ordered_placement', 'guardian', 'Court-Ordered Placement',    'boolean', true, false, false, false, 2),
    ('financial_guarantor_type','guardian', 'Financial Guarantor Type',   'enum',    true, false, false, false, 3),

    -- ── Referral (Step 4) ──
    ('referral_source_type',  'referral', 'Referral Source Type',      'enum',  true, false, false, false, 1),
    ('referral_organization', 'referral', 'Referral Organization',     'text',  true, false, false, false, 2),
    ('referral_date',         'referral', 'Referral Date',             'date',  true, false, false, false, 3),
    ('reason_for_referral',   'referral', 'Reason for Referral',       'text',  true, false, false, false, 4),

    -- ── Admission (Step 5) ──
    ('admission_date',          'admission', 'Admission Date',            'date',    true, true,  true,  true,  1),
    ('admission_type',          'admission', 'Admission Type',            'enum',    true, false, false, false, 2),
    ('level_of_care',           'admission', 'Level of Care',             'text',    true, false, false, false, 3),
    ('expected_length_of_stay', 'admission', 'Expected Length of Stay',   'number',  true, false, false, false, 4),
    ('initial_risk_level',      'admission', 'Initial Risk Level',        'enum',    true, false, false, true,  5),
    ('discharge_plan_status',   'admission', 'Discharge Plan Status',     'enum',    true, false, false, false, 6),
    ('placement_arrangement',   'admission', 'Placement Arrangement',     'enum',    true, false, false, true,  7),

    -- ── Insurance (Step 6) ──
    ('medicaid_id',  'insurance', 'Medicaid ID',  'text', true, false, false, false, 1),
    ('medicare_id',  'insurance', 'Medicare ID',  'text', true, false, false, false, 2),

    -- ── Clinical Profile (Step 7) ──
    ('primary_diagnosis',          'clinical', 'Primary Diagnosis',          'jsonb',   true, false, false, false, 1),
    ('secondary_diagnoses',        'clinical', 'Secondary Diagnoses',        'jsonb',   true, false, false, false, 2),
    ('dsm5_diagnoses',             'clinical', 'DSM-5 Diagnoses',            'jsonb',   true, false, false, false, 3),
    ('presenting_problem',         'clinical', 'Presenting Problem',         'text',    true, false, false, false, 4),
    ('suicide_risk_status',        'clinical', 'Suicide Risk Status',        'enum',    true, false, false, false, 5),
    ('violence_risk_status',       'clinical', 'Violence Risk Status',       'enum',    true, false, false, false, 6),
    ('trauma_history_indicator',   'clinical', 'Trauma History',             'boolean', true, false, false, false, 7),
    ('substance_use_history',      'clinical', 'Substance Use History',      'text',    true, false, false, false, 8),
    ('developmental_history',      'clinical', 'Developmental History',      'text',    true, false, false, false, 9),
    ('previous_treatment_history', 'clinical', 'Previous Treatment History', 'text',    true, false, false, false, 10),

    -- ── Medical (Step 8) ──
    ('allergies',            'medical', 'Allergies',             'jsonb',   true, true,  true,  false, 1),
    ('medical_conditions',   'medical', 'Medical Conditions',    'jsonb',   true, true,  true,  false, 2),
    ('immunization_status',  'medical', 'Immunization Status',   'text',    true, false, false, false, 3),
    ('dietary_restrictions', 'medical', 'Dietary Restrictions',  'text',    true, false, false, false, 4),
    ('special_medical_needs','medical', 'Special Medical Needs', 'text',    true, false, false, false, 5),

    -- ── Legal & Compliance (Step 9) ──
    ('court_case_number',               'legal', 'Court Case Number',               'text',    true, false, false, false, 1),
    ('state_agency',                    'legal', 'State Agency',                    'text',    true, false, false, false, 2),
    ('legal_status',                    'legal', 'Legal Status',                    'enum',    true, false, false, false, 3),
    ('mandated_reporting_status',       'legal', 'Mandated Reporting Status',       'boolean', true, false, false, false, 4),
    ('protective_services_involvement', 'legal', 'Protective Services Involvement', 'boolean', true, false, false, false, 5),
    ('safety_plan_required',            'legal', 'Safety Plan Required',            'boolean', true, false, false, false, 6),

    -- ── Discharge (Step 10) — seeded but excluded from config UI (Decision 90) ──
    ('discharge_date',      'discharge', 'Discharge Date',      'date', true, false, true, false, 1),
    ('discharge_outcome',   'discharge', 'Discharge Outcome',   'enum', true, false, true, true,  2),
    ('discharge_reason',    'discharge', 'Discharge Reason',    'enum', true, false, true, true,  3),
    ('discharge_diagnosis', 'discharge', 'Discharge Diagnosis', 'jsonb',true, false, false,false, 4),
    ('discharge_placement', 'discharge', 'Discharge Placement', 'enum', true, false, false,true,  5),

    -- ── Education ──
    ('education_status', 'education', 'Education Status', 'enum',    true, false, false, false, 1),
    ('grade_level',      'education', 'Grade Level',      'text',    true, false, false, false, 2),
    ('iep_status',       'education', 'IEP Status',       'boolean', true, false, false, false, 3)

ON CONFLICT ("field_key") DO NOTHING;
