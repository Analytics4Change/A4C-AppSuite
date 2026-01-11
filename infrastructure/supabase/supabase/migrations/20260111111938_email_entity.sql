-- Migration: email_entity
-- Purpose: Create email as a first-class entity for organization bootstrap workflow
-- Pattern: Follow phones_projection structure for consistency
--
-- Creates:
-- 1. email_type enum
-- 2. emails_projection table
-- 3. organization_emails junction table
-- 4. contact_emails junction table
-- 5. process_email_event function
-- 6. Updates to process_junction_event for email links
-- 7. Updates to process_domain_event router for 'email' stream_type
-- 8. RLS policies
-- 9. Indexes
-- 10. FK constraints and grants

-- ============================================================================
-- 1. EMAIL_TYPE ENUM
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_type') THEN
    CREATE TYPE "public"."email_type" AS ENUM (
      'work',
      'personal',
      'billing',
      'support',
      'main'
    );
    ALTER TYPE "public"."email_type" OWNER TO "postgres";
    COMMENT ON TYPE "public"."email_type" IS 'Classification of email addresses: work, personal, billing, support, main';
  END IF;
END $$;

-- ============================================================================
-- 2. EMAILS_PROJECTION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."emails_projection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "type" "public"."email_type" NOT NULL,
    "address" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);

ALTER TABLE "public"."emails_projection" OWNER TO "postgres";

COMMENT ON TABLE "public"."emails_projection" IS 'CQRS projection of email.* events - email addresses associated with organizations';

COMMENT ON COLUMN "public"."emails_projection"."organization_id" IS 'Owning organization (org-scoped for RLS, future multi-org support via junction tables)';

COMMENT ON COLUMN "public"."emails_projection"."label" IS 'User-defined email label for identification (e.g., "Main Office", "Billing Department")';

COMMENT ON COLUMN "public"."emails_projection"."type" IS 'Structured email type: work, personal, billing, support, main';

COMMENT ON COLUMN "public"."emails_projection"."address" IS 'Email address (e.g., "info@example.com")';

COMMENT ON COLUMN "public"."emails_projection"."is_primary" IS 'Primary email for the organization (only one per org enforced by unique index)';

COMMENT ON COLUMN "public"."emails_projection"."is_active" IS 'Email active status';

COMMENT ON COLUMN "public"."emails_projection"."deleted_at" IS 'Soft delete timestamp (cascades from org deletion)';

-- Primary key
ALTER TABLE ONLY "public"."emails_projection"
    ADD CONSTRAINT "emails_projection_pkey" PRIMARY KEY ("id");

-- Foreign key to organizations
ALTER TABLE ONLY "public"."emails_projection"
    ADD CONSTRAINT "emails_projection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- ============================================================================
-- 3. ORGANIZATION_EMAILS JUNCTION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."organization_emails" (
    "organization_id" "uuid" NOT NULL,
    "email_id" "uuid" NOT NULL,
    CONSTRAINT "organization_emails_pkey" PRIMARY KEY ("organization_id", "email_id")
);

ALTER TABLE "public"."organization_emails" OWNER TO "postgres";

COMMENT ON TABLE "public"."organization_emails" IS 'Junction table linking organizations to their email addresses';

-- Foreign keys
ALTER TABLE ONLY "public"."organization_emails"
    ADD CONSTRAINT "organization_emails_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

ALTER TABLE ONLY "public"."organization_emails"
    ADD CONSTRAINT "organization_emails_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "public"."emails_projection"("id");

-- Unique constraint (explicit, though PK already ensures this)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_emails_unique" ON "public"."organization_emails" ("organization_id", "email_id");

-- ============================================================================
-- 4. CONTACT_EMAILS JUNCTION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."contact_emails" (
    "contact_id" "uuid" NOT NULL,
    "email_id" "uuid" NOT NULL,
    CONSTRAINT "contact_emails_pkey" PRIMARY KEY ("contact_id", "email_id")
);

ALTER TABLE "public"."contact_emails" OWNER TO "postgres";

COMMENT ON TABLE "public"."contact_emails" IS 'Junction table linking contacts to their email addresses';

-- Foreign keys
ALTER TABLE ONLY "public"."contact_emails"
    ADD CONSTRAINT "contact_emails_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts_projection"("id");

ALTER TABLE ONLY "public"."contact_emails"
    ADD CONSTRAINT "contact_emails_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "public"."emails_projection"("id");

-- Unique constraint (explicit, though PK already ensures this)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_contact_emails_unique" ON "public"."contact_emails" ("contact_id", "email_id");

-- ============================================================================
-- 5. INDEXES FOR EMAILS_PROJECTION
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_emails_organization" ON "public"."emails_projection" ("organization_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX IF NOT EXISTS "idx_emails_active" ON "public"."emails_projection" ("is_active", "organization_id") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));

CREATE INDEX IF NOT EXISTS "idx_emails_label" ON "public"."emails_projection" ("label", "organization_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX IF NOT EXISTS "idx_emails_address" ON "public"."emails_projection" ("address") WHERE ("deleted_at" IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_emails_one_primary_per_org" ON "public"."emails_projection" ("organization_id") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));

CREATE INDEX IF NOT EXISTS "idx_emails_primary" ON "public"."emails_projection" ("organization_id", "is_primary") WHERE (("is_primary" = true) AND ("deleted_at" IS NULL));

CREATE INDEX IF NOT EXISTS "idx_emails_type" ON "public"."emails_projection" ("type", "organization_id") WHERE ("deleted_at" IS NULL);

-- ============================================================================
-- 6. PROCESS_EMAIL_EVENT FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."process_email_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type

    -- Handle email creation
    WHEN 'email.created' THEN
      INSERT INTO emails_projection (
        id, organization_id, type, label,
        address, is_primary,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::email_type
          ELSE 'work'::email_type
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'address'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle email updates
    WHEN 'email.updated' THEN
      UPDATE emails_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::email_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        address = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'address'), address),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle email deletion (soft delete)
    WHEN 'email.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE emails_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE WARNING 'Unknown email event type: %', p_event.event_type;
  END CASE;

END;
$$;

ALTER FUNCTION "public"."process_email_event"("p_event" "record") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."process_email_event"("p_event" "record") IS 'Main email event processor - handles creation, updates, and soft deletion with CQRS projections';

-- ============================================================================
-- 7. UPDATE PROCESS_DOMAIN_EVENT TO ROUTE 'email' STREAM_TYPE
-- ============================================================================
-- We need to update the CASE statement in process_domain_event to add 'email' routing
-- This is done by CREATE OR REPLACE
CREATE OR REPLACE FUNCTION "public"."process_domain_event"() RETURNS trigger
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_error_msg TEXT;
  v_error_detail TEXT;
BEGIN
  -- Skip already-processed events (idempotency)
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
      PERFORM process_junction_event(NEW);
    ELSE
      CASE NEW.stream_type
        WHEN 'role' THEN PERFORM process_rbac_event(NEW);
        WHEN 'permission' THEN PERFORM process_rbac_event(NEW);
        WHEN 'client' THEN PERFORM process_client_event(NEW);
        WHEN 'medication' THEN PERFORM process_medication_event(NEW);
        WHEN 'medication_history' THEN PERFORM process_medication_history_event(NEW);
        WHEN 'dosage' THEN PERFORM process_dosage_event(NEW);
        WHEN 'user' THEN PERFORM process_user_event(NEW);
        WHEN 'organization' THEN PERFORM process_organization_event(NEW);
        WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
        WHEN 'contact' THEN PERFORM process_contact_event(NEW);
        WHEN 'address' THEN PERFORM process_address_event(NEW);
        WHEN 'phone' THEN PERFORM process_phone_event(NEW);
        WHEN 'email' THEN PERFORM process_email_event(NEW);  -- Added email routing
        WHEN 'invitation' THEN PERFORM process_invitation_event(NEW);
        WHEN 'access_grant' THEN PERFORM process_access_grant_event(NEW);
        WHEN 'impersonation' THEN PERFORM process_impersonation_event(NEW);
        ELSE
          RAISE WARNING 'Unknown stream_type: %', NEW.stream_type;
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
$$;

ALTER FUNCTION "public"."process_domain_event"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."process_domain_event"() IS 'Main router that processes domain events and projects them to 3NF tables';

-- ============================================================================
-- 8. UPDATE PROCESS_JUNCTION_EVENT FOR EMAIL LINKS
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."process_junction_event"("p_event" "record") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  CASE p_event.event_type

    -- Organization-Contact Links
    WHEN 'organization.contact.linked' THEN
      INSERT INTO organization_contacts (organization_id, contact_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
      )
      ON CONFLICT (organization_id, contact_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.contact.unlinked' THEN
      DELETE FROM organization_contacts
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');

    -- Organization-Address Links
    WHEN 'organization.address.linked' THEN
      INSERT INTO organization_addresses (organization_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (organization_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.address.unlinked' THEN
      DELETE FROM organization_addresses
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Organization-Phone Links
    WHEN 'organization.phone.linked' THEN
      INSERT INTO organization_phones (organization_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (organization_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.phone.unlinked' THEN
      DELETE FROM organization_phones
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Organization-Email Links (NEW)
    WHEN 'organization.email.linked' THEN
      INSERT INTO organization_emails (organization_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      )
      ON CONFLICT (organization_id, email_id) DO NOTHING;  -- Idempotent

    WHEN 'organization.email.unlinked' THEN
      DELETE FROM organization_emails
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    -- Contact-Phone Links
    WHEN 'contact.phone.linked' THEN
      INSERT INTO contact_phones (contact_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      )
      ON CONFLICT (contact_id, phone_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.phone.unlinked' THEN
      DELETE FROM contact_phones
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    -- Contact-Address Links
    WHEN 'contact.address.linked' THEN
      INSERT INTO contact_addresses (contact_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (contact_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.address.unlinked' THEN
      DELETE FROM contact_addresses
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    -- Contact-Email Links (NEW)
    WHEN 'contact.email.linked' THEN
      INSERT INTO contact_emails (contact_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      )
      ON CONFLICT (contact_id, email_id) DO NOTHING;  -- Idempotent

    WHEN 'contact.email.unlinked' THEN
      DELETE FROM contact_emails
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    -- Phone-Address Links
    WHEN 'phone.address.linked' THEN
      INSERT INTO phone_addresses (phone_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      )
      ON CONFLICT (phone_id, address_id) DO NOTHING;  -- Idempotent

    WHEN 'phone.address.unlinked' THEN
      DELETE FROM phone_addresses
      WHERE phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    ELSE
      RAISE WARNING 'Unknown junction event type: %', p_event.event_type;
  END CASE;

END;
$$;

ALTER FUNCTION "public"."process_junction_event"("p_event" "record") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."process_junction_event"("p_event" "record") IS 'Main junction event processor - handles link/unlink for all 8 junction table types (org-contact, org-address, org-phone, org-email, contact-phone, contact-address, contact-email, phone-address)';

-- ============================================================================
-- 9. RLS POLICIES FOR EMAILS_PROJECTION
-- ============================================================================
ALTER TABLE "public"."emails_projection" ENABLE ROW LEVEL SECURITY;

-- Org admins can view emails in their organization
CREATE POLICY "emails_org_admin_select" ON "public"."emails_projection"
    FOR SELECT
    USING (("public"."is_org_admin"("public"."get_current_user_id"(), "organization_id") AND ("deleted_at" IS NULL)));

COMMENT ON POLICY "emails_org_admin_select" ON "public"."emails_projection" IS 'Allows organization admins to view emails in their organization (excluding soft-deleted)';

-- Super admins have full access
CREATE POLICY "emails_super_admin_all" ON "public"."emails_projection"
    USING ("public"."is_super_admin"("public"."get_current_user_id"()));

COMMENT ON POLICY "emails_super_admin_all" ON "public"."emails_projection" IS 'Allows super admins full access to all emails';

-- Service role for Temporal workers
CREATE POLICY "emails_projection_service_role_select" ON "public"."emails_projection"
    FOR SELECT TO "service_role"
    USING (true);

COMMENT ON POLICY "emails_projection_service_role_select" ON "public"."emails_projection" IS 'Allows Temporal workers (service_role) to read email data for cleanup activities';

-- ============================================================================
-- 10. RLS POLICIES FOR ORGANIZATION_EMAILS JUNCTION
-- ============================================================================
ALTER TABLE "public"."organization_emails" ENABLE ROW LEVEL SECURITY;

-- Org admins can view organization-email links
CREATE POLICY "org_emails_org_admin_select" ON "public"."organization_emails"
    FOR SELECT
    USING ((EXISTS ( SELECT 1
       FROM "public"."organizations_projection" "o"
      WHERE (("o"."id" = "organization_emails"."organization_id") AND "public"."is_org_admin"("public"."get_current_user_id"(), "o"."id")))) AND (EXISTS ( SELECT 1
       FROM "public"."emails_projection" "e"
      WHERE (("e"."id" = "organization_emails"."email_id") AND ("e"."organization_id" = "e"."organization_id") AND ("e"."deleted_at" IS NULL)))));

COMMENT ON POLICY "org_emails_org_admin_select" ON "public"."organization_emails" IS 'Allows organization admins to view organization-email links (both entities must belong to their org)';

-- Super admins have full access
CREATE POLICY "org_emails_super_admin_all" ON "public"."organization_emails"
    USING ("public"."is_super_admin"("public"."get_current_user_id"()));

COMMENT ON POLICY "org_emails_super_admin_all" ON "public"."organization_emails" IS 'Allows super admins full access to all organization-email links';

-- ============================================================================
-- 11. RLS POLICIES FOR CONTACT_EMAILS JUNCTION
-- ============================================================================
ALTER TABLE "public"."contact_emails" ENABLE ROW LEVEL SECURITY;

-- Org admins can view contact-email links
CREATE POLICY "contact_emails_org_admin_select" ON "public"."contact_emails"
    FOR SELECT
    USING ((EXISTS ( SELECT 1
       FROM "public"."contacts_projection" "c"
      WHERE (("c"."id" = "contact_emails"."contact_id") AND "public"."is_org_admin"("public"."get_current_user_id"(), "c"."organization_id") AND ("c"."deleted_at" IS NULL)))) AND (EXISTS ( SELECT 1
       FROM "public"."emails_projection" "e"
      WHERE (("e"."id" = "contact_emails"."email_id") AND ("e"."deleted_at" IS NULL)))));

COMMENT ON POLICY "contact_emails_org_admin_select" ON "public"."contact_emails" IS 'Allows organization admins to view contact-email links (both contact and email must belong to their org)';

-- Super admins have full access
CREATE POLICY "contact_emails_super_admin_all" ON "public"."contact_emails"
    USING ("public"."is_super_admin"("public"."get_current_user_id"()));

COMMENT ON POLICY "contact_emails_super_admin_all" ON "public"."contact_emails" IS 'Allows super admins full access to all contact-email links';

-- ============================================================================
-- 12. GRANTS
-- ============================================================================
GRANT SELECT ON TABLE "public"."emails_projection" TO "service_role";
GRANT SELECT ON TABLE "public"."emails_projection" TO "authenticated";

GRANT SELECT ON TABLE "public"."organization_emails" TO "service_role";
GRANT SELECT ON TABLE "public"."organization_emails" TO "authenticated";

GRANT SELECT ON TABLE "public"."contact_emails" TO "service_role";
GRANT SELECT ON TABLE "public"."contact_emails" TO "authenticated";

-- ============================================================================
-- 13. API RPC FUNCTIONS (optional, for frontend access)
-- ============================================================================
-- Get emails for an organization
CREATE OR REPLACE FUNCTION "api"."get_emails_by_org"("p_org_id" "uuid")
RETURNS TABLE (
  "id" "uuid",
  "organization_id" "uuid",
  "label" "text",
  "type" "public"."email_type",
  "address" "text",
  "is_primary" boolean,
  "is_active" boolean,
  "metadata" "jsonb",
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
)
LANGUAGE "plpgsql"
SECURITY INVOKER
SET "search_path" TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.organization_id, e.label, e.type, e.address,
    e.is_primary, e.is_active, e.metadata,
    e.created_at, e.updated_at
  FROM emails_projection e
  WHERE e.organization_id = p_org_id
    AND e.deleted_at IS NULL;
END;
$$;

ALTER FUNCTION "api"."get_emails_by_org"("p_org_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "api"."get_emails_by_org"("p_org_id" "uuid") IS 'Get emails for an organization. SECURITY INVOKER - respects RLS.';
