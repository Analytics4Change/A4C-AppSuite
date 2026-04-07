-- Migration: client_insurance_placement_tables
-- Creates 3 client sub-entity tables for insurance, placement, and funding (Phase B1b).
-- These are event-sourced sub-entity projections of the 'client' stream.

-- =============================================================================
-- 1. client_insurance_policies_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_insurance_policies_projection" (
    "id"                  uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"           uuid NOT NULL,
    "organization_id"     uuid NOT NULL,
    "policy_type"         text NOT NULL,
    "payer_name"          text NOT NULL,
    "policy_number"       text,
    "group_number"        text,
    "subscriber_name"     text,
    "subscriber_relation" text,
    "coverage_start_date" date,
    "coverage_end_date"   date,
    "is_active"           boolean NOT NULL DEFAULT true,
    "created_at"          timestamptz NOT NULL DEFAULT now(),
    "updated_at"          timestamptz,
    "last_event_id"       uuid,

    CONSTRAINT "client_insurance_policies_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_insurance_policy_type_check" CHECK (
        policy_type IN ('primary', 'secondary', 'medicaid', 'medicare')
    ),
    CONSTRAINT "client_insurance_policies_unique" UNIQUE ("client_id", "policy_type")
);

ALTER TABLE "public"."client_insurance_policies_projection" OWNER TO "postgres";

-- Foreign keys
ALTER TABLE "public"."client_insurance_policies_projection"
    ADD CONSTRAINT "client_insurance_policies_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

ALTER TABLE "public"."client_insurance_policies_projection"
    ADD CONSTRAINT "client_insurance_policies_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_insurance_client"
    ON "public"."client_insurance_policies_projection" USING btree ("client_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_insurance_org"
    ON "public"."client_insurance_policies_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

-- RLS
ALTER TABLE "public"."client_insurance_policies_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_insurance_select"
    ON "public"."client_insurance_policies_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_insurance_platform_admin"
    ON "public"."client_insurance_policies_projection"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_insurance_policies_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_insurance_policies_projection" TO "service_role";

-- Comment
COMMENT ON TABLE "public"."client_insurance_policies_projection" IS
'CQRS projection of client.insurance.* events — insurance policies (Decision 74).
Sub-entity of client stream. policy_type: primary, secondary, medicaid, medicare.
Event types: client.insurance.added, client.insurance.updated, client.insurance.removed
Permission: client.update';

-- =============================================================================
-- 2. client_placement_history_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_placement_history_projection" (
    "id"                    uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"             uuid NOT NULL,
    "organization_id"       uuid NOT NULL,
    "placement_arrangement" text NOT NULL,
    "start_date"            date NOT NULL,
    "end_date"              date,
    "is_current"            boolean NOT NULL DEFAULT true,
    "reason"                text,
    "created_at"            timestamptz NOT NULL DEFAULT now(),
    "updated_at"            timestamptz,
    "last_event_id"         uuid,

    CONSTRAINT "client_placement_history_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_placement_arrangement_check" CHECK (
        placement_arrangement IN (
            'residential_treatment',
            'therapeutic_foster_care',
            'group_home',
            'foster_care',
            'kinship_placement',
            'adoptive_placement',
            'independent_living',
            'home_based',
            'detention',
            'secure_residential',
            'hospital_inpatient',
            'shelter',
            'other'
        )
    )
);

ALTER TABLE "public"."client_placement_history_projection" OWNER TO "postgres";

-- Only one current placement per client
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_placement_current"
    ON "public"."client_placement_history_projection" ("client_id")
    WHERE ("is_current" = true);

-- Foreign keys
ALTER TABLE "public"."client_placement_history_projection"
    ADD CONSTRAINT "client_placement_history_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

ALTER TABLE "public"."client_placement_history_projection"
    ADD CONSTRAINT "client_placement_history_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_placement_client"
    ON "public"."client_placement_history_projection" USING btree ("client_id");

CREATE INDEX IF NOT EXISTS "idx_client_placement_org"
    ON "public"."client_placement_history_projection" USING btree ("organization_id");

-- RLS
ALTER TABLE "public"."client_placement_history_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_placement_select"
    ON "public"."client_placement_history_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_placement_platform_admin"
    ON "public"."client_placement_history_projection"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_placement_history_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_placement_history_projection" TO "service_role";

-- Comment
COMMENT ON TABLE "public"."client_placement_history_projection" IS
'CQRS projection of client.placement.* events — placement trajectory with date ranges (Decision 83).
Sub-entity of client stream. Only one row can have is_current=true per client (partial unique index).
When placement changes: close previous (is_current=false, end_date set), insert new (is_current=true).
Also updates clients_projection.placement_arrangement (denormalized current value).
13 SAMHSA/state Medicaid standard placement types.
Event types: client.placement.changed, client.placement.ended
Permission: client.update';

-- =============================================================================
-- 3. client_funding_sources_projection
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."client_funding_sources_projection" (
    "id"               uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"        uuid NOT NULL,
    "organization_id"  uuid NOT NULL,
    "source_type"      text NOT NULL,
    "source_name"      text NOT NULL,
    "reference_number" text,
    "start_date"       date,
    "end_date"         date,
    "custom_fields"    jsonb NOT NULL DEFAULT '{}'::jsonb,
    "is_active"        boolean NOT NULL DEFAULT true,
    "created_at"       timestamptz NOT NULL DEFAULT now(),
    "updated_at"       timestamptz,
    "last_event_id"    uuid,

    CONSTRAINT "client_funding_sources_projection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."client_funding_sources_projection" OWNER TO "postgres";

-- Foreign keys
ALTER TABLE "public"."client_funding_sources_projection"
    ADD CONSTRAINT "client_funding_sources_projection_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients_projection"("id");

ALTER TABLE "public"."client_funding_sources_projection"
    ADD CONSTRAINT "client_funding_sources_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_client_funding_client"
    ON "public"."client_funding_sources_projection" USING btree ("client_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_client_funding_org"
    ON "public"."client_funding_sources_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

-- RLS
ALTER TABLE "public"."client_funding_sources_projection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_funding_select"
    ON "public"."client_funding_sources_projection"
    FOR SELECT
    USING ("organization_id" = "public"."get_current_org_id"());

CREATE POLICY "client_funding_platform_admin"
    ON "public"."client_funding_sources_projection"
    USING ("public"."has_platform_privilege"());

-- Grants
GRANT SELECT ON TABLE "public"."client_funding_sources_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_funding_sources_projection" TO "service_role";

-- Comment
COMMENT ON TABLE "public"."client_funding_sources_projection" IS
'CQRS projection of client.funding_source.* events — external funding sources (Decision 76).
Sub-entity of client stream. Replaces old "state" payer type on insurance table.
Dynamic multi-instance: org admin defines slots in field_definitions, staff adds rows at intake.
custom_fields JSONB for non-standard fields per funding source row (Decision 77).
Event types: client.funding_source.added, client.funding_source.updated, client.funding_source.removed
Permission: client.update';
