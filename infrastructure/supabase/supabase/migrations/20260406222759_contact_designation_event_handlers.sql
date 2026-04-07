-- Migration: contact_designation_event_handlers
-- Adds 2 CASE branches to process_contact_event() for designation management (Phase B2b).
-- Creates 2 handlers for contact_designations_projection (Decision 15).
-- Pattern: existing process_contact_event() at handlers/routers/process_contact_event.sql

-- =============================================================================
-- 1. Extended router: process_contact_event() — add designation CASE branches
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_contact_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_contact_id UUID;
  v_user_id UUID;
BEGIN
  CASE p_event.event_type

    WHEN 'contact.created' THEN
      INSERT INTO contacts_projection (
        id, organization_id, type, label,
        first_name, last_name, email, title, department,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'first_name'),
        safe_jsonb_extract_text(p_event.event_data, 'last_name'),
        safe_jsonb_extract_text(p_event.event_data, 'email'),
        safe_jsonb_extract_text(p_event.event_data, 'title'),
        safe_jsonb_extract_text(p_event.event_data, 'department'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'contact.updated' THEN
      UPDATE contacts_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::contact_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        first_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'first_name'), first_name),
        last_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'last_name'), last_name),
        email = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'email'), email),
        title = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'title'), title),
        department = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'department'), department),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'contact.deleted' THEN
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'contact.user.linked' THEN
      v_contact_id := safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');
      v_user_id := safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

      UPDATE contacts_projection
      SET
        user_id = v_user_id,
        updated_at = p_event.created_at
      WHERE id = v_contact_id
        AND deleted_at IS NULL;

      INSERT INTO user_phones (
        id, user_id, label, type, number, extension, country_code,
        is_primary, is_active, sms_capable, metadata, source_contact_phone_id,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(), v_user_id, p.label, p.type, p.number, p.extension,
        COALESCE(p.country_code, '+1'), COALESCE(p.is_primary, false),
        true, true,
        jsonb_build_object('mirrored_at', p_event.created_at, 'source', 'contact_link'),
        p.id, p_event.created_at, p_event.created_at
      FROM phones_projection p
      JOIN contact_phones cp ON cp.phone_id = p.id
      WHERE cp.contact_id = v_contact_id
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_active, true) = true
        AND p.type = 'mobile'
      ON CONFLICT DO NOTHING;

    WHEN 'contact.user.unlinked' THEN
      UPDATE contacts_projection
      SET
        user_id = NULL,
        updated_at = p_event.created_at
      WHERE id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND user_id = safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

    -- Designation events (Phase B2b)
    WHEN 'contact.designation.created' THEN
      PERFORM handle_contact_designation_created(p_event);

    WHEN 'contact.designation.deactivated' THEN
      PERFORM handle_contact_designation_deactivated(p_event);

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_contact_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

-- =============================================================================
-- 2. Handler: handle_contact_designation_created
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_contact_designation_created(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO contact_designations_projection (
        id, contact_id, designation, organization_id,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'designation_id')::uuid,
        p_event.stream_id,
        p_event.event_data->>'designation',
        (p_event.event_data->>'organization_id')::uuid,
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (contact_id, designation, organization_id) DO UPDATE SET
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

-- =============================================================================
-- 3. Handler: handle_contact_designation_deactivated
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_contact_designation_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE contact_designations_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE contact_id = p_event.stream_id
      AND designation = p_event.event_data->>'designation'
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
