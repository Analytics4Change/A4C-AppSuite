-- Migration: client_contact_tables
-- Creates 4 client-owned contact tables for the Client Intake implementation (Phase B1a).
-- These are event-sourced sub-entity projections of the 'client' stream.
-- Pattern: contact_designations_projection (20260327210838)

-- =============================================================================
-- 1. client_phones_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_phones_projection" (
    "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"       uuid NOT NULL,
    "organization_id" uuid NOT NULL,
    "phone_number"    text NOT NULL,
    "phone_type"      text NOT NULL DEFAULT 'mobile',
    "is_primary"      boolean NOT NULL DEFAULT false,
    "is_active"       boolean NOT NULL DEFAULT true,
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz,
    "last_event_id"   uuid,

    CONSTRAINT "client_phones_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_phones_type_check" CHECK (
        phone_type IN ('mobile', 'home', 'work', 'fax', 'other')
    ),
    CONSTRAINT "client_phones_unique" UNIQUE ("client_id", "phone_number")
);

ALTER TABLE "public"."client_phones_projection" OWNER TO "postgres";

-- Foreign keys
ALTER TABLE "public"."client_phones_projection"
    ADD CONSTRAINT "client_phones_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

ALTER TABLE "public"."client_phones_projection"
    ADD CONSTRAINT "client_phones_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_phones_client"
    ON "public"."client_phones_projection" USING btree ("client_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_phones_org"
    ON "public"."client_phones_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

-- RLS
ALTER TABLE "public"."client_phones_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_phones_select"
    ON "public"."client_phones_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_phones_platform_admin"
    ON "public"."client_phones_projection"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_phones_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_phones_projection" TO "service_role";

-- Comment
COMMENT ON TABLE "public"."client_phones_projection" IS
'CQRS projection of client.phone.* events — client-owned phone numbers (Decision 57).
Sub-entity of client stream. Each client can have multiple phones with type and primary flag.
Event types: client.phone.added, client.phone.updated, client.phone.removed
Permission: client.update';

-- =============================================================================
-- 2. client_emails_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_emails_projection" (
    "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"       uuid NOT NULL,
    "organization_id" uuid NOT NULL,
    "email"           text NOT NULL,
    "email_type"      text NOT NULL DEFAULT 'personal',
    "is_primary"      boolean NOT NULL DEFAULT false,
    "is_active"       boolean NOT NULL DEFAULT true,
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz,
    "last_event_id"   uuid,

    CONSTRAINT "client_emails_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_emails_type_check" CHECK (
        email_type IN ('personal', 'work', 'school', 'other')
    ),
    CONSTRAINT "client_emails_unique" UNIQUE ("client_id", "email")
);

ALTER TABLE "public"."client_emails_projection" OWNER TO "postgres";

-- Foreign keys
ALTER TABLE "public"."client_emails_projection"
    ADD CONSTRAINT "client_emails_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

ALTER TABLE "public"."client_emails_projection"
    ADD CONSTRAINT "client_emails_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_emails_client"
    ON "public"."client_emails_projection" USING btree ("client_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_emails_org"
    ON "public"."client_emails_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

-- RLS
ALTER TABLE "public"."client_emails_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_emails_select"
    ON "public"."client_emails_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_emails_platform_admin"
    ON "public"."client_emails_projection"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_emails_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_emails_projection" TO "service_role";

-- Comment
COMMENT ON TABLE "public"."client_emails_projection" IS
'CQRS projection of client.email.* events — client-owned email addresses (Decision 57).
Sub-entity of client stream. Each client can have multiple emails with type and primary flag.
Event types: client.email.added, client.email.updated, client.email.removed
Permission: client.update';

-- =============================================================================
-- 3. client_addresses_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_addresses_projection" (
    "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"       uuid NOT NULL,
    "organization_id" uuid NOT NULL,
    "address_type"    text NOT NULL DEFAULT 'home',
    "street1"         text NOT NULL,
    "street2"         text,
    "city"            text NOT NULL,
    "state"           text NOT NULL,
    "zip"             text NOT NULL,
    "country"         text NOT NULL DEFAULT 'US',
    "is_primary"      boolean NOT NULL DEFAULT false,
    "is_active"       boolean NOT NULL DEFAULT true,
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz,
    "last_event_id"   uuid,

    CONSTRAINT "client_addresses_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_addresses_type_check" CHECK (
        address_type IN ('home', 'mailing', 'school', 'placement', 'other')
    ),
    CONSTRAINT "client_addresses_unique" UNIQUE ("client_id", "address_type")
);

ALTER TABLE "public"."client_addresses_projection" OWNER TO "postgres";

-- Foreign keys
ALTER TABLE "public"."client_addresses_projection"
    ADD CONSTRAINT "client_addresses_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

ALTER TABLE "public"."client_addresses_projection"
    ADD CONSTRAINT "client_addresses_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_addresses_client"
    ON "public"."client_addresses_projection" USING btree ("client_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_addresses_org"
    ON "public"."client_addresses_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

-- RLS
ALTER TABLE "public"."client_addresses_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_addresses_select"
    ON "public"."client_addresses_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_addresses_platform_admin"
    ON "public"."client_addresses_projection"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_addresses_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_addresses_projection" TO "service_role";

-- Comment
COMMENT ON TABLE "public"."client_addresses_projection" IS
'CQRS projection of client.address.* events — client-owned addresses (Decision 57).
Sub-entity of client stream. Each client can have one address per type.
Event types: client.address.added, client.address.updated, client.address.removed
Permission: client.update';

-- =============================================================================
-- 4. client_contact_assignments_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_contact_assignments_projection" (
    "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"       uuid NOT NULL,
    "contact_id"      uuid NOT NULL,
    "organization_id" uuid NOT NULL,
    "designation"     text NOT NULL,
    "assigned_at"     timestamptz NOT NULL DEFAULT now(),
    "is_active"       boolean NOT NULL DEFAULT true,
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz,
    "last_event_id"   uuid,

    CONSTRAINT "client_contact_assignments_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_contact_assignments_designation_check" CHECK (
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
    CONSTRAINT "client_contact_assignments_unique" UNIQUE ("client_id", "contact_id", "designation")
);

ALTER TABLE "public"."client_contact_assignments_projection" OWNER TO "postgres";

-- Foreign keys
ALTER TABLE "public"."client_contact_assignments_projection"
    ADD CONSTRAINT "client_contact_assignments_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

ALTER TABLE "public"."client_contact_assignments_projection"
    ADD CONSTRAINT "client_contact_assignments_projection_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");

ALTER TABLE "public"."client_contact_assignments_projection"
    ADD CONSTRAINT "client_contact_assignments_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_contact_assignments_client"
    ON "public"."client_contact_assignments_projection" USING btree ("client_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_contact_assignments_contact"
    ON "public"."client_contact_assignments_projection" USING btree ("contact_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_contact_assignments_org"
    ON "public"."client_contact_assignments_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_contact_assignments_org_designation"
    ON "public"."client_contact_assignments_projection" USING btree ("organization_id", "designation")
    WHERE ("is_active" = true);

-- RLS
ALTER TABLE "public"."client_contact_assignments_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_contact_assignments_select"
    ON "public"."client_contact_assignments_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_contact_assignments_platform_admin"
    ON "public"."client_contact_assignments_projection"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_contact_assignments_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_contact_assignments_projection" TO "service_role";

-- Comment
COMMENT ON TABLE "public"."client_contact_assignments_projection" IS
'CQRS projection of client.contact.assigned/unassigned events — 4NF junction linking
clients to contacts with a clinical designation (Decision 13, Decision 16).
Each row = atomic fact: client X has contact Y in designation Z.
Same 12 designations as contact_designations_projection.
Event types: client.contact.assigned, client.contact.unassigned
Permission: client.update (Decision 17)';
