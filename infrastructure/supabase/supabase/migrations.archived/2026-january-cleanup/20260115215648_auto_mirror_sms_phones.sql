-- ============================================================================
-- Migration: Auto-Mirror SMS Phones on Contact-User Link
-- Purpose: When contact.user.linked fires, automatically create user_phones
--          records that mirror the contact's SMS-capable phones for notifications
-- ============================================================================

-- ============================================================================
-- Part A: Add source_contact_phone_id column to user_phones
-- Tracks which phones were auto-mirrored from contacts
-- ============================================================================

ALTER TABLE public.user_phones
ADD COLUMN IF NOT EXISTS source_contact_phone_id UUID;

COMMENT ON COLUMN public.user_phones.source_contact_phone_id IS
  'If this phone was auto-mirrored from a contact phone, stores the source phone_id for audit trail. NULL for user-managed phones.';

-- Index for finding mirrored phones by source
CREATE INDEX IF NOT EXISTS idx_user_phones_source_contact_phone
ON public.user_phones (source_contact_phone_id)
WHERE source_contact_phone_id IS NOT NULL;

-- ============================================================================
-- Part B: Update process_contact_event to auto-mirror phones
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_contact_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_contact_id UUID;
  v_user_id UUID;
BEGIN
  CASE p_event.event_type

    -- Handle contact creation
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
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
      ON CONFLICT (id) DO NOTHING;  -- Idempotent

    -- Handle contact updates
    -- Note: phone is a separate entity (phones_projection) linked via contact_phones junction table
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

    -- Handle contact deletion (soft delete)
    WHEN 'contact.deleted' THEN
      -- Event-driven soft delete (no CASCADE - must emit events for linked entities first)
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle contact-user linking (same person is both contact and user)
    -- Event emitted when user accepts invitation or admin manually links
    -- AUTO-MIRROR: Copy contact's SMS-capable phones to user_phones for notifications
    WHEN 'contact.user.linked' THEN
      v_contact_id := safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');
      v_user_id := safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

      -- Update contact with user_id
      UPDATE contacts_projection
      SET
        user_id = v_user_id,
        updated_at = p_event.created_at
      WHERE id = v_contact_id
        AND deleted_at IS NULL;

      -- Auto-mirror SMS-capable phones from contact to user
      -- Mobile phones are assumed SMS-capable by default
      INSERT INTO user_phones (
        id,
        user_id,
        label,
        type,
        number,
        extension,
        country_code,
        is_primary,
        is_active,
        sms_capable,
        metadata,
        source_contact_phone_id,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
        v_user_id,
        p.label,
        p.type,
        p.number,
        p.extension,
        COALESCE(p.country_code, '+1'),  -- Default US country code
        COALESCE(p.is_primary, false),
        true,  -- New mirrored phones are active by default
        true,  -- Mirrored phones assumed SMS capable (we only copy mobile/SMS phones)
        jsonb_build_object('mirrored_at', p_event.created_at, 'source', 'contact_link'),
        p.id,  -- Track source for audit
        p_event.created_at,
        p_event.created_at
      FROM phones_projection p
      JOIN contact_phones cp ON cp.phone_id = p.id
      WHERE cp.contact_id = v_contact_id
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_active, true) = true
        -- Only mirror mobile phones (SMS-capable)
        AND p.type = 'mobile'
      ON CONFLICT DO NOTHING;  -- Idempotent - don't duplicate if re-linked

    -- Handle contact-user unlinking
    -- Event emitted when user deleted or admin manually unlinks
    -- Note: We do NOT delete mirrored phones - they become user-managed
    WHEN 'contact.user.unlinked' THEN
      UPDATE contacts_projection
      SET
        user_id = NULL,
        updated_at = p_event.created_at
      WHERE id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND user_id = safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

    ELSE
      RAISE WARNING 'Unknown contact event type: %', p_event.event_type;
  END CASE;

END;
$$;

COMMENT ON FUNCTION public.process_contact_event(record) IS
  'Process contact domain events. Handles contact CRUD, contact-user linking with auto-mirror of SMS-capable phones.';
