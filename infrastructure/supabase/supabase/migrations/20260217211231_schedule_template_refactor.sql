-- =============================================================================
-- Migration: schedule_template_refactor
-- Description: Refactors schedules from per-user clone model to template model.
--   Creates schedule_templates_projection + schedule_user_assignments_projection,
--   migrates data, creates api.* RPC functions, new event handlers/router,
--   drops old user.schedule.* handlers + user_schedule_policies_projection.
-- =============================================================================

-- =============================================================================
-- 1. NEW TABLES
-- =============================================================================

-- Schedule Templates — the "what"
CREATE TABLE IF NOT EXISTS "public"."schedule_templates_projection" (
    "id"              uuid  DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid  NOT NULL,
    "org_unit_id"     uuid,
    "schedule_name"   text  NOT NULL,
    "schedule"        jsonb NOT NULL,
    "is_active"       boolean DEFAULT true,
    "created_at"      timestamptz DEFAULT now(),
    "updated_at"      timestamptz DEFAULT now(),
    "created_by"      uuid,
    "last_event_id"   uuid,
    CONSTRAINT "schedule_templates_projection_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."schedule_templates_projection"
    IS 'CQRS projection of schedule.* template events — stores recurring weekly schedule definitions.';

COMMENT ON COLUMN "public"."schedule_templates_projection"."schedule"
    IS '{"dayname": {"begin": "HHMM", "end": "HHMM"}, ...} — Days without entries or with null = not scheduled.';

COMMENT ON COLUMN "public"."schedule_templates_projection"."org_unit_id"
    IS 'NULL = applies to all OUs. If set, template scoped to that specific OU.';

-- Foreign keys
ALTER TABLE "public"."schedule_templates_projection"
    ADD CONSTRAINT "schedule_templates_projection_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

ALTER TABLE "public"."schedule_templates_projection"
    ADD CONSTRAINT "schedule_templates_projection_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "public"."organization_units_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_schedule_templates_org"
    ON "public"."schedule_templates_projection" USING btree ("organization_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_schedule_templates_org_unit"
    ON "public"."schedule_templates_projection" USING btree ("org_unit_id");

-- Grants
GRANT SELECT ON TABLE "public"."schedule_templates_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."schedule_templates_projection" TO "service_role";

-- RLS
ALTER TABLE "public"."schedule_templates_projection" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_templates_select" ON "public"."schedule_templates_projection";
CREATE POLICY "schedule_templates_select"
    ON "public"."schedule_templates_projection"
    FOR SELECT
    USING (organization_id = public.get_current_org_id());

DROP POLICY IF EXISTS "schedule_templates_modify" ON "public"."schedule_templates_projection";
CREATE POLICY "schedule_templates_modify"
    ON "public"."schedule_templates_projection"
    USING (
        public.has_effective_permission(
            'user.schedule_manage',
            COALESCE(
                (SELECT organization_units_projection.path
                 FROM public.organization_units_projection
                 WHERE organization_units_projection.id = schedule_templates_projection.org_unit_id),
                (SELECT organizations_projection.path
                 FROM public.organizations_projection
                 WHERE organizations_projection.id = schedule_templates_projection.organization_id)
            )
        )
    );


-- Schedule User Assignments — the "who" and "when"
CREATE TABLE IF NOT EXISTS "public"."schedule_user_assignments_projection" (
    "id"                   uuid  DEFAULT gen_random_uuid() NOT NULL,
    "schedule_template_id" uuid  NOT NULL,
    "user_id"              uuid  NOT NULL,
    "organization_id"      uuid  NOT NULL,
    "effective_from"       date,
    "effective_until"      date,
    "is_active"            boolean DEFAULT true,
    "created_at"           timestamptz DEFAULT now(),
    "updated_at"           timestamptz DEFAULT now(),
    "last_event_id"        uuid,
    CONSTRAINT "schedule_user_assignments_projection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "schedule_user_assignments_unique_user_template"
        UNIQUE ("schedule_template_id", "user_id")
);

COMMENT ON TABLE "public"."schedule_user_assignments_projection"
    IS 'CQRS projection of schedule.user_assigned/unassigned events — junction between templates and users.';

-- Foreign keys
ALTER TABLE "public"."schedule_user_assignments_projection"
    ADD CONSTRAINT "schedule_user_assignments_template_fkey"
    FOREIGN KEY ("schedule_template_id") REFERENCES "public"."schedule_templates_projection"("id") ON DELETE CASCADE;

ALTER TABLE "public"."schedule_user_assignments_projection"
    ADD CONSTRAINT "schedule_user_assignments_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."schedule_user_assignments_projection"
    ADD CONSTRAINT "schedule_user_assignments_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_projection"("id");

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_schedule_assignments_template"
    ON "public"."schedule_user_assignments_projection" USING btree ("schedule_template_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_schedule_assignments_user"
    ON "public"."schedule_user_assignments_projection" USING btree ("user_id")
    WHERE ("is_active" = true);

CREATE INDEX IF NOT EXISTS "idx_schedule_assignments_org"
    ON "public"."schedule_user_assignments_projection" USING btree ("organization_id");

-- Grants
GRANT SELECT ON TABLE "public"."schedule_user_assignments_projection" TO "authenticated";
GRANT SELECT ON TABLE "public"."schedule_user_assignments_projection" TO "service_role";

-- RLS
ALTER TABLE "public"."schedule_user_assignments_projection" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_assignments_select" ON "public"."schedule_user_assignments_projection";
CREATE POLICY "schedule_assignments_select"
    ON "public"."schedule_user_assignments_projection"
    FOR SELECT
    USING (organization_id = public.get_current_org_id());

DROP POLICY IF EXISTS "schedule_assignments_modify" ON "public"."schedule_user_assignments_projection";
CREATE POLICY "schedule_assignments_modify"
    ON "public"."schedule_user_assignments_projection"
    USING (
        public.has_effective_permission(
            'user.schedule_manage',
            COALESCE(
                (SELECT organization_units_projection.path
                 FROM public.organization_units_projection
                 WHERE organization_units_projection.id = (
                     SELECT stp.org_unit_id FROM public.schedule_templates_projection stp
                     WHERE stp.id = schedule_user_assignments_projection.schedule_template_id
                 )),
                (SELECT organizations_projection.path
                 FROM public.organizations_projection
                 WHERE organizations_projection.id = schedule_user_assignments_projection.organization_id)
            )
        )
    );


-- =============================================================================
-- 2. DATA MIGRATION
-- =============================================================================

-- Migrate user_schedule_policies_projection → new tables
-- Group by (organization_id, org_unit_id, schedule_name, schedule) → one template per group
-- Then create assignment rows linking each original user to the matching template

DO $$
DECLARE
  v_template_row RECORD;
  v_assignment_row RECORD;
  v_template_id uuid;
BEGIN
  -- Create templates from distinct schedule definitions
  FOR v_template_row IN
    SELECT DISTINCT ON (organization_id, COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), schedule_name, schedule::text)
      organization_id,
      org_unit_id,
      schedule_name,
      schedule,
      is_active,
      created_at,
      updated_at,
      created_by
    FROM public.user_schedule_policies_projection
    ORDER BY organization_id, COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), schedule_name, schedule::text, created_at ASC
  LOOP
    v_template_id := gen_random_uuid();

    INSERT INTO public.schedule_templates_projection (
      id, organization_id, org_unit_id, schedule_name, schedule,
      is_active, created_at, updated_at, created_by
    ) VALUES (
      v_template_id,
      v_template_row.organization_id,
      v_template_row.org_unit_id,
      v_template_row.schedule_name,
      v_template_row.schedule,
      v_template_row.is_active,
      v_template_row.created_at,
      v_template_row.updated_at,
      v_template_row.created_by
    );

    -- Create assignment rows for all users who had this exact schedule definition
    FOR v_assignment_row IN
      SELECT id, user_id, effective_from, effective_until, is_active, created_at, updated_at
      FROM public.user_schedule_policies_projection
      WHERE organization_id = v_template_row.organization_id
        AND COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) =
            COALESCE(v_template_row.org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND schedule_name = v_template_row.schedule_name
        AND schedule::text = v_template_row.schedule::text
    LOOP
      INSERT INTO public.schedule_user_assignments_projection (
        id, schedule_template_id, user_id, organization_id,
        effective_from, effective_until, is_active, created_at, updated_at
      ) VALUES (
        v_assignment_row.id,
        v_template_id,
        v_assignment_row.user_id,
        v_template_row.organization_id,
        v_assignment_row.effective_from,
        v_assignment_row.effective_until,
        v_assignment_row.is_active,
        v_assignment_row.created_at,
        v_assignment_row.updated_at
      ) ON CONFLICT (schedule_template_id, user_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;


-- =============================================================================
-- 3. EVENT HANDLERS (schedule stream)
-- =============================================================================

-- Router: process_schedule_event
CREATE OR REPLACE FUNCTION public.process_schedule_event(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type
        -- Template lifecycle
        WHEN 'schedule.created'       THEN PERFORM handle_schedule_created(p_event);
        WHEN 'schedule.updated'       THEN PERFORM handle_schedule_updated(p_event);
        WHEN 'schedule.deactivated'   THEN PERFORM handle_schedule_deactivated(p_event);
        WHEN 'schedule.reactivated'   THEN PERFORM handle_schedule_reactivated(p_event);
        WHEN 'schedule.deleted'       THEN PERFORM handle_schedule_deleted(p_event);
        -- Assignment lifecycle
        WHEN 'schedule.user_assigned'   THEN PERFORM handle_schedule_user_assigned(p_event);
        WHEN 'schedule.user_unassigned' THEN PERFORM handle_schedule_user_unassigned(p_event);
        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_schedule_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;


-- Handler: handle_schedule_created
CREATE OR REPLACE FUNCTION public.handle_schedule_created(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_template_id uuid;
    v_user_id uuid;
    v_user_ids jsonb;
BEGIN
    v_template_id := (p_event.event_data->>'template_id')::uuid;

    -- Insert template
    INSERT INTO schedule_templates_projection (
        id, organization_id, org_unit_id, schedule_name, schedule,
        created_by, created_at, updated_at, last_event_id
    ) VALUES (
        v_template_id,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'org_unit_id')::uuid,
        p_event.event_data->>'schedule_name',
        p_event.event_data->'schedule',
        (p_event.event_data->>'created_by')::uuid,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (id) DO UPDATE SET
        schedule_name = EXCLUDED.schedule_name,
        schedule = EXCLUDED.schedule,
        org_unit_id = EXCLUDED.org_unit_id,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;

    -- Create initial assignments if user_ids provided
    v_user_ids := p_event.event_data->'user_ids';
    IF v_user_ids IS NOT NULL AND jsonb_array_length(v_user_ids) > 0 THEN
        FOR v_user_id IN SELECT jsonb_array_elements_text(v_user_ids)::uuid
        LOOP
            INSERT INTO schedule_user_assignments_projection (
                schedule_template_id, user_id, organization_id,
                created_at, updated_at, last_event_id
            ) VALUES (
                v_template_id,
                v_user_id,
                (p_event.event_data->>'organization_id')::uuid,
                p_event.created_at,
                p_event.created_at,
                p_event.id
            ) ON CONFLICT (schedule_template_id, user_id) DO NOTHING;
        END LOOP;
    END IF;
END;
$function$;


-- Handler: handle_schedule_updated
CREATE OR REPLACE FUNCTION public.handle_schedule_updated(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE schedule_templates_projection SET
        schedule_name = COALESCE(p_event.event_data->>'schedule_name', schedule_name),
        schedule = COALESCE(p_event.event_data->'schedule', schedule),
        org_unit_id = CASE
            WHEN p_event.event_data ? 'org_unit_id'
            THEN (p_event.event_data->>'org_unit_id')::uuid
            ELSE org_unit_id
        END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'template_id')::uuid;
END;
$function$;


-- Handler: handle_schedule_deactivated
CREATE OR REPLACE FUNCTION public.handle_schedule_deactivated(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE schedule_templates_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'template_id')::uuid;
END;
$function$;


-- Handler: handle_schedule_reactivated
CREATE OR REPLACE FUNCTION public.handle_schedule_reactivated(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE schedule_templates_projection SET
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'template_id')::uuid;
END;
$function$;


-- Handler: handle_schedule_deleted
CREATE OR REPLACE FUNCTION public.handle_schedule_deleted(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- CASCADE will delete assignments
    DELETE FROM schedule_templates_projection
    WHERE id = (p_event.event_data->>'template_id')::uuid
      AND is_active = false;
END;
$function$;


-- Handler: handle_schedule_user_assigned
CREATE OR REPLACE FUNCTION public.handle_schedule_user_assigned(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO schedule_user_assignments_projection (
        schedule_template_id, user_id, organization_id,
        effective_from, effective_until,
        created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'template_id')::uuid,
        (p_event.event_data->>'user_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        (p_event.event_data->>'effective_from')::date,
        (p_event.event_data->>'effective_until')::date,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (schedule_template_id, user_id) DO UPDATE SET
        effective_from = EXCLUDED.effective_from,
        effective_until = EXCLUDED.effective_until,
        is_active = true,
        updated_at = p_event.created_at,
        last_event_id = p_event.id;
END;
$function$;


-- Handler: handle_schedule_user_unassigned
CREATE OR REPLACE FUNCTION public.handle_schedule_user_unassigned(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    DELETE FROM schedule_user_assignments_projection
    WHERE schedule_template_id = (p_event.event_data->>'template_id')::uuid
      AND user_id = (p_event.event_data->>'user_id')::uuid;
END;
$function$;


-- =============================================================================
-- 4. UPDATE DISPATCHER: Add 'schedule' stream_type
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
        IF NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked' THEN
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
                WHEN 'impersonation'     THEN PERFORM process_impersonation_event(NEW);
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
-- 5. REMOVE OLD user.schedule.* CASE BRANCHES FROM process_user_event
-- =============================================================================

-- Read current function and recreate without schedule branches
-- (Full function with schedule lines removed)

CREATE OR REPLACE FUNCTION public.process_user_event(p_event record)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type
        -- User lifecycle
        WHEN 'user.synced_from_auth'                THEN PERFORM handle_user_synced_from_auth(p_event);
        WHEN 'user.created'                         THEN PERFORM handle_user_created(p_event);
        WHEN 'user.profile.updated'                 THEN PERFORM handle_user_profile_updated(p_event);
        WHEN 'user.organization_switched'            THEN PERFORM handle_user_organization_switched(p_event);
        WHEN 'user.deactivated'                      THEN PERFORM handle_user_deactivated(p_event);
        WHEN 'user.reactivated'                      THEN PERFORM handle_user_reactivated(p_event);
        WHEN 'user.deleted'                          THEN PERFORM handle_user_deleted(p_event);
        -- Contact information
        WHEN 'user.phone.added'                      THEN PERFORM handle_user_phone_added(p_event);
        WHEN 'user.phone.updated'                    THEN PERFORM handle_user_phone_updated(p_event);
        WHEN 'user.phone.removed'                    THEN PERFORM handle_user_phone_removed(p_event);
        WHEN 'user.address.added'                    THEN PERFORM handle_user_address_added(p_event);
        WHEN 'user.address.updated'                  THEN PERFORM handle_user_address_updated(p_event);
        WHEN 'user.address.removed'                  THEN PERFORM handle_user_address_removed(p_event);
        -- Access / preferences
        WHEN 'user.access_dates.updated'             THEN PERFORM handle_user_access_dates_updated(p_event);
        WHEN 'user.notification_preferences.updated' THEN PERFORM handle_user_notification_preferences_updated(p_event);
        -- Client assignments
        WHEN 'user.client.assigned'                  THEN PERFORM handle_user_client_assigned(p_event);
        WHEN 'user.client.unassigned'                THEN PERFORM handle_user_client_unassigned(p_event);
        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;


-- =============================================================================
-- 6. RPC FUNCTIONS (api schema)
-- =============================================================================

-- 6a. Create schedule template
CREATE OR REPLACE FUNCTION api.create_schedule_template(
    p_name text,
    p_schedule jsonb,
    p_org_unit_id uuid DEFAULT NULL,
    p_user_ids uuid[] DEFAULT '{}'::uuid[]
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_template_id uuid;
    v_uid uuid;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();
    v_template_id := gen_random_uuid();

    -- Validate permission
    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = p_org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    -- Validate OU belongs to org if specified
    IF p_org_unit_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.organization_units_projection
            WHERE id = p_org_unit_id AND organization_id = v_org_id
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Organization unit not found');
        END IF;
    END IF;

    -- Validate all user_ids belong to this org
    IF array_length(p_user_ids, 1) > 0 THEN
        IF EXISTS (
            SELECT 1 FROM unnest(p_user_ids) AS uid
            WHERE NOT EXISTS (
                SELECT 1 FROM public.users u WHERE u.id = uid AND u.organization_id = v_org_id
            )
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'One or more users not found in organization');
        END IF;
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := v_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.created',
        p_event_data     := jsonb_build_object(
            'template_id', v_template_id,
            'organization_id', v_org_id,
            'schedule_name', p_name,
            'schedule', p_schedule,
            'org_unit_id', p_org_unit_id,
            'user_ids', to_jsonb(p_user_ids),
            'created_by', v_user_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'template_id', v_template_id
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION api.create_schedule_template(text, jsonb, uuid, uuid[]) TO authenticated;


-- 6b. Update schedule template
CREATE OR REPLACE FUNCTION api.update_schedule_template(
    p_template_id uuid,
    p_name text DEFAULT NULL,
    p_schedule jsonb DEFAULT NULL,
    p_org_unit_id uuid DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_template RECORD;
    v_event_data jsonb;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF NOT v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot update an inactive template');
    END IF;

    -- Validate permission
    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    v_event_data := jsonb_build_object(
        'template_id', p_template_id,
        'organization_id', v_org_id
    );

    IF p_name IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object(
            'schedule_name', p_name,
            'previous_name', v_template.schedule_name
        );
    END IF;

    IF p_schedule IS NOT NULL THEN
        v_event_data := v_event_data || jsonb_build_object(
            'schedule', p_schedule,
            'previous_schedule', v_template.schedule
        );
    END IF;

    IF p_org_unit_id IS DISTINCT FROM v_template.org_unit_id THEN
        v_event_data := v_event_data || jsonb_build_object('org_unit_id', p_org_unit_id);
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.updated',
        p_event_data     := v_event_data
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION api.update_schedule_template(uuid, text, jsonb, uuid) TO authenticated;


-- 6c. Deactivate schedule template
CREATE OR REPLACE FUNCTION api.deactivate_schedule_template(
    p_template_id uuid,
    p_reason text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_template RECORD;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF NOT v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template is already inactive');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.deactivated',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'organization_id', v_org_id,
            'reason', p_reason
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION api.deactivate_schedule_template(uuid, text) TO authenticated;


-- 6d. Reactivate schedule template
CREATE OR REPLACE FUNCTION api.reactivate_schedule_template(
    p_template_id uuid
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_template RECORD;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template is already active');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.reactivated',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'organization_id', v_org_id
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION api.reactivate_schedule_template(uuid) TO authenticated;


-- 6e. Delete schedule template
CREATE OR REPLACE FUNCTION api.delete_schedule_template(
    p_template_id uuid,
    p_reason text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_template RECORD;
    v_user_count integer;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF v_template.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Template must be deactivated before deletion',
            'errorDetails', jsonb_build_object('code', 'STILL_ACTIVE')
        );
    END IF;

    -- Check for assigned users
    SELECT count(*) INTO v_user_count
    FROM public.schedule_user_assignments_projection
    WHERE schedule_template_id = p_template_id;

    IF v_user_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Cannot delete: %s user(s) still assigned', v_user_count),
            'errorDetails', jsonb_build_object('code', 'HAS_USERS', 'count', v_user_count)
        );
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.deleted',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'organization_id', v_org_id,
            'reason', p_reason
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION api.delete_schedule_template(uuid, text) TO authenticated;


-- 6f. Assign user to schedule
CREATE OR REPLACE FUNCTION api.assign_user_to_schedule(
    p_template_id uuid,
    p_user_id uuid,
    p_effective_from date DEFAULT NULL,
    p_effective_until date DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_template RECORD;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF NOT v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot assign users to an inactive template');
    END IF;

    -- Validate user belongs to org
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = p_user_id AND organization_id = v_org_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found in organization');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection WHERE id = v_template.org_unit_id),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.user_assigned',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'user_id', p_user_id,
            'organization_id', v_org_id,
            'effective_from', p_effective_from,
            'effective_until', p_effective_until
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION api.assign_user_to_schedule(uuid, uuid, date, date) TO authenticated;


-- 6g. Unassign user from schedule
CREATE OR REPLACE FUNCTION api.unassign_user_from_schedule(
    p_template_id uuid,
    p_user_id uuid,
    p_reason text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
BEGIN
    v_org_id := public.get_current_org_id();

    -- Validate template exists in org
    IF NOT EXISTS (
        SELECT 1 FROM public.schedule_templates_projection
        WHERE id = p_template_id AND organization_id = v_org_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    -- Validate assignment exists
    IF NOT EXISTS (
        SELECT 1 FROM public.schedule_user_assignments_projection
        WHERE schedule_template_id = p_template_id AND user_id = p_user_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'User is not assigned to this schedule');
    END IF;

    IF NOT public.has_effective_permission(
        'user.schedule_manage',
        COALESCE(
            (SELECT path FROM public.organization_units_projection
             WHERE id = (SELECT org_unit_id FROM public.schedule_templates_projection WHERE id = p_template_id)),
            (SELECT path FROM public.organizations_projection WHERE id = v_org_id)
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id      := p_template_id,
        p_stream_type    := 'schedule',
        p_event_type     := 'schedule.user_unassigned',
        p_event_data     := jsonb_build_object(
            'template_id', p_template_id,
            'user_id', p_user_id,
            'organization_id', v_org_id,
            'reason', p_reason
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION api.unassign_user_from_schedule(uuid, uuid, text) TO authenticated;


-- 6h. List schedule templates
CREATE OR REPLACE FUNCTION api.list_schedule_templates(
    p_org_id uuid DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_search text DEFAULT NULL
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_result jsonb;
BEGIN
    v_org_id := COALESCE(p_org_id, public.get_current_org_id());

    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.schedule_name), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            st.id,
            st.organization_id,
            st.org_unit_id,
            ou.name AS org_unit_name,
            st.schedule_name,
            st.schedule,
            st.is_active,
            st.created_at,
            st.updated_at,
            (SELECT count(*) FROM public.schedule_user_assignments_projection sa
             WHERE sa.schedule_template_id = st.id) AS assigned_user_count
        FROM public.schedule_templates_projection st
        LEFT JOIN public.organization_units_projection ou ON ou.id = st.org_unit_id
        WHERE st.organization_id = v_org_id
          AND (p_status IS NULL
               OR (p_status = 'active' AND st.is_active = true)
               OR (p_status = 'inactive' AND st.is_active = false))
          AND (p_search IS NULL
               OR st.schedule_name ILIKE '%' || p_search || '%')
    ) t;

    RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION api.list_schedule_templates(uuid, text, text) TO authenticated;


-- 6i. Get schedule template detail
CREATE OR REPLACE FUNCTION api.get_schedule_template(
    p_template_id uuid
)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id uuid;
    v_template jsonb;
    v_users jsonb;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT row_to_json(t)::jsonb INTO v_template
    FROM (
        SELECT
            st.id,
            st.organization_id,
            st.org_unit_id,
            ou.name AS org_unit_name,
            st.schedule_name,
            st.schedule,
            st.is_active,
            st.created_at,
            st.updated_at,
            st.created_by
        FROM public.schedule_templates_projection st
        LEFT JOIN public.organization_units_projection ou ON ou.id = st.org_unit_id
        WHERE st.id = p_template_id AND st.organization_id = v_org_id
    ) t;

    IF v_template IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb)
    INTO v_users
    FROM (
        SELECT
            sa.id,
            sa.user_id,
            u.display_name AS user_name,
            u.email AS user_email,
            sa.effective_from,
            sa.effective_until,
            sa.is_active,
            sa.created_at
        FROM public.schedule_user_assignments_projection sa
        JOIN public.users u ON u.id = sa.user_id
        WHERE sa.schedule_template_id = p_template_id
        ORDER BY u.display_name
    ) a;

    RETURN jsonb_build_object(
        'success', true,
        'template', v_template,
        'assigned_users', v_users
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION api.get_schedule_template(uuid) TO authenticated;


-- =============================================================================
-- 7. DROP OLD HANDLERS & TABLE
-- =============================================================================

-- Drop old handler functions
DROP FUNCTION IF EXISTS public.handle_user_schedule_created(record);
DROP FUNCTION IF EXISTS public.handle_user_schedule_updated(record);
DROP FUNCTION IF EXISTS public.handle_user_schedule_deactivated(record);
DROP FUNCTION IF EXISTS public.handle_user_schedule_reactivated(record);
DROP FUNCTION IF EXISTS public.handle_user_schedule_deleted(record);

-- Drop old api.* schedule functions (reference old per-user model)
DROP FUNCTION IF EXISTS api.create_user_schedule(uuid, jsonb, uuid, date, date, text);
DROP FUNCTION IF EXISTS api.create_user_schedule(uuid, text, jsonb, uuid, date, date, text);
DROP FUNCTION IF EXISTS api.update_user_schedule(uuid, text, jsonb, uuid, date, date, text);
DROP FUNCTION IF EXISTS api.update_user_schedule(uuid, jsonb, uuid, date, date, text);
DROP FUNCTION IF EXISTS api.deactivate_user_schedule(uuid, text);
DROP FUNCTION IF EXISTS api.reactivate_user_schedule(uuid, text);
DROP FUNCTION IF EXISTS api.delete_user_schedule(uuid, text);
DROP FUNCTION IF EXISTS api.list_user_schedules(uuid, uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS api.list_user_schedules(uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS api.get_schedule_by_id(uuid);
DROP FUNCTION IF EXISTS public.is_user_on_schedule(uuid, uuid, uuid, timestamptz);

-- Drop old table (data already migrated)
DROP TABLE IF EXISTS public.user_schedule_policies_projection;
