-- Migration: contact_designations_projection
-- Creates the contact designation table for the 4NF contact-designation model (Decision 13).
-- Designations link contacts to clinical/administrative roles within an organization.
-- Event-sourced via process_contact_event() router (Decision 15).

-- =============================================================================
-- 1. contact_designations_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."contact_designations_projection" (
    "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
    "contact_id"      uuid NOT NULL,
    "designation"     text NOT NULL,
    "organization_id" uuid NOT NULL,
    "is_active"       boolean NOT NULL DEFAULT true,
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz,
    "last_event_id"   uuid,

    CONSTRAINT "contact_designations_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_designations_designation_check" CHECK (
        designation IN (
            'clinician',
            'therapist',
            'psychiatrist',
            'behavioral_analyst',
            'case_worker',
            'guardian',
            'emergency_contact',
            'program_manager',
            'primary_care_physician',
            'prescriber',
            'probation_officer',
            'caseworker'
        )
    ),
    CONSTRAINT "contact_designations_unique" UNIQUE ("contact_id", "designation", "organization_id")
);

ALTER TABLE "public"."contact_designations_projection" OWNER TO "postgres";

-- =============================================================================
-- 2. FOREIGN KEYS
-- =============================================================================

ALTER TABLE "public"."contact_designations_projection"
    ADD CONSTRAINT "contact_designations_projection_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");

ALTER TABLE "public"."contact_designations_projection"
    ADD CONSTRAINT "contact_designations_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- =============================================================================
-- 3. INDEXES
-- =============================================================================

-- Contact lookup (which designations does this contact have?)
CREATE INDEX IF NOT EXISTS "idx_contact_designations_contact"
    ON "public"."contact_designations_projection" USING btree ("contact_id")
    WHERE ("is_active" = true);

-- Org lookup (all designations in this org)
CREATE INDEX IF NOT EXISTS "idx_contact_designations_org"
    ON "public"."contact_designations_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

-- Designation lookup (all contacts with a specific designation in an org)
CREATE INDEX IF NOT EXISTS "idx_contact_designations_org_designation"
    ON "public"."contact_designations_projection" USING btree ("organization_id", "designation")
    WHERE ("is_active" = true);

-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE "public"."contact_designations_projection" ENABLE ROW LEVEL SECURITY;

-- SELECT: org members can see designations in their org
CREATE POLICY "contact_designations_select"
    ON "public"."contact_designations_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

-- Platform admin override
CREATE POLICY "contact_designations_platform_admin"
    ON "public"."contact_designations_projection"
    USING ("public"."has_platform_privilege"());

-- =============================================================================
-- 5. GRANTS
-- =============================================================================

GRANT SELECT ON TABLE "public"."contact_designations_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."contact_designations_projection" TO "service_role";

-- =============================================================================
-- 6. COMMENTS
-- =============================================================================

COMMENT ON TABLE "public"."contact_designations_projection" IS
'CQRS projection of contact.designation.* events — links contacts to clinical/administrative
designations within an organization (4NF contact-designation model, Decision 13).

A contact can hold multiple designations in the same org (e.g., both clinician and therapist).
UNIQUE constraint on (contact_id, designation, organization_id) prevents duplicates.
12 fixed designations — orgs cannot add custom designations (Decision 14).
Orgs can rename display labels via configurable_label in client_field_definitions_projection.

Stream type: contact (routed through process_contact_event)
Event types: contact.designation.created, contact.designation.deactivated
Permission: client.update (reuses existing permission, Decision 17)';

COMMENT ON COLUMN "public"."contact_designations_projection"."designation" IS
'Fixed 12-value enum (CHECK constraint). Values:
- Clinical: clinician, therapist, psychiatrist, behavioral_analyst
- Administrative: case_worker, program_manager
- External: guardian, emergency_contact, primary_care_physician, prescriber, probation_officer, caseworker
Org display labels configurable via client_field_definitions_projection.configurable_label.';

COMMENT ON COLUMN "public"."contact_designations_projection"."contact_id" IS
'FK to contacts_projection. For internal users, contacts_projection.user_id links to auth.users.
Lazy contact creation — contacts_projection record auto-created on first clinical assignment.';
