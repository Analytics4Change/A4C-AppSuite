-- ============================================================================
-- Migration: Add missing user lifecycle handlers + orphan-read filters
-- ============================================================================
-- Problem 1 — Missing handlers:
--   process_user_event() routes user.deactivated / user.reactivated /
--   user.deleted to handle_user_{deactivated,reactivated,deleted}, but those
--   handler functions were never created. Every such event has silently failed
--   (stored in domain_events.processing_error) since Feb 2026. Projections are
--   stale for deactivated/deleted users; reactivate is a complete no-op.
--
-- Problem 2 — Orphan-read exposure (surfaced by PR #33 audit):
--   Four api.* RPCs return dependent-projection rows without filtering on
--   public.users.deleted_at. Today this is latent (no user has ever been
--   tombstoned because the handler didn't exist). The moment the new
--   handle_user_deleted populates deleted_at, these RPCs would leak orphaned
--   data to the frontend. This migration closes both gaps in one PR.
--
-- Design decisions (see dev/active/fix-missing-user-lifecycle-handlers/):
--   - Deactivation/reactivation: flip public.users.is_active only. Emitted
--     deactivated_at/reactivated_at timestamps live in domain_events.event_data
--     as audit trail (public.users has no column for them).
--   - Delete: soft-delete public.users only (set deleted_at + is_active=false).
--     Dependent projections untouched; orphan-read filters in §2 ensure
--     client-facing queries exclude them.
--   - Delete replay safety: COALESCE first-set-wins on retry_failed_event.
--   - Error style: RAISE USING ERRCODE, no PII interpolation.
-- ============================================================================


-- ============================================================================
-- §1. Handlers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_user_deactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    UPDATE public.users
       SET is_active = false,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_reactivated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    UPDATE public.users
       SET is_active = true,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    -- COALESCE order: existing tombstone wins (replay-safe), then event
    -- payload's deleted_at, then event creation time as final fallback.
    UPDATE public.users
       SET deleted_at = COALESCE(
             deleted_at,
             (p_event.event_data->>'deleted_at')::timestamptz,
             p_event.created_at
           ),
           is_active = false,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;


-- ============================================================================
-- §2. Orphan-read filters on existing api.* RPCs
-- ============================================================================
-- Each function is re-declared verbatim with a single added guard:
-- dependent-projection reads now exclude rows whose user_id points to a
-- soft-deleted public.users row. Authorization, return shape, and business
-- logic are unchanged.
-- ============================================================================

-- api.get_user_addresses: add EXISTS filter on ua.user_id not-deleted
CREATE OR REPLACE FUNCTION api.get_user_addresses(p_user_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, label text, type text, street1 text, street2 text, city text, state text, zip_code text, country text, is_primary boolean, is_active boolean, metadata jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_current_user_id uuid;
  v_current_org_id uuid;
BEGIN
  v_current_user_id := public.get_current_user_id();
  v_current_org_id := public.get_current_org_id();

  IF NOT (
    public.has_platform_privilege()
    OR (public.has_org_admin_permission() AND EXISTS (
      SELECT 1 FROM user_organizations_projection uop
      WHERE uop.user_id = p_user_id AND uop.org_id = v_current_org_id
    ))
    OR p_user_id = v_current_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ua.id,
    ua.user_id,
    ua.label,
    ua.type::text,
    ua.street1,
    ua.street2,
    ua.city,
    ua.state,
    ua.zip_code,
    ua.country,
    ua.is_primary,
    ua.is_active,
    ua.metadata,
    ua.created_at,
    ua.updated_at
  FROM user_addresses ua
  WHERE ua.user_id = p_user_id
    AND ua.is_active = true
    -- Orphan-read filter: exclude addresses for soft-deleted users
    AND EXISTS (
      SELECT 1 FROM public.users u
       WHERE u.id = ua.user_id
         AND u.deleted_at IS NULL
    )
  ORDER BY ua.is_primary DESC, ua.created_at DESC;
END;
$function$;

-- api.get_user_phones: early-return empty array for deleted users
-- (cleaner than threading EXISTS through the UNION ALL)
CREATE OR REPLACE FUNCTION api.get_user_phones(p_user_id uuid, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Orphan-read filter: soft-deleted users have no retrievable phones
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = p_user_id
       AND u.deleted_at IS NULL
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    WITH all_phones AS (
      SELECT
        up.id,
        up.label,
        up.type::text,
        up.number,
        up.extension,
        up.country_code,
        up.sms_capable,
        up.is_primary,
        up.is_active,
        (up.source_contact_phone_id IS NOT NULL) AS is_mirrored,
        'global'::text AS source,
        up.created_at
      FROM user_phones up
      WHERE up.user_id = p_user_id
        AND up.is_active = true

      UNION ALL

      SELECT
        uopo.id,
        uopo.label,
        uopo.type::text,
        uopo.number,
        uopo.extension,
        uopo.country_code,
        uopo.sms_capable,
        false AS is_primary,
        uopo.is_active,
        false AS is_mirrored,
        'org'::text AS source,
        uopo.created_at
      FROM user_org_phone_overrides uopo
      WHERE uopo.user_id = p_user_id
        AND uopo.org_id = p_organization_id
        AND uopo.is_active = true
        AND p_organization_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', ap.id,
      'label', ap.label,
      'type', ap.type,
      'number', ap.number,
      'extension', ap.extension,
      'countryCode', ap.country_code,
      'smsCapable', ap.sms_capable,
      'isPrimary', ap.is_primary,
      'isActive', ap.is_active,
      'isMirrored', ap.is_mirrored,
      'source', ap.source
    ) ORDER BY ap.is_primary DESC, ap.created_at ASC), '[]'::jsonb)
    FROM all_phones ap
  );
END;
$function$;

-- api.get_user_notification_preferences: early-return "all-disabled" shape for deleted users
CREATE OR REPLACE FUNCTION api.get_user_notification_preferences(p_user_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR p_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Orphan-read filter: soft-deleted users have no deliverable preferences.
  -- Return an "all-disabled" shape so callers expecting the preference object
  -- don't crash on missing fields, but no channel is implicitly enabled.
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = p_user_id
       AND u.deleted_at IS NULL
  ) THEN
    RETURN '{"email": false, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'email', unp.email_enabled,
    'sms', jsonb_build_object(
      'enabled', unp.sms_enabled,
      'phoneId', unp.sms_phone_id
    ),
    'inApp', unp.in_app_enabled
  ) INTO v_result
  FROM user_notification_preferences_projection unp
  WHERE unp.user_id = p_user_id
    AND unp.organization_id = p_organization_id;

  RETURN COALESCE(
    v_result,
    '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb
  );
END;
$function$;

-- api.list_user_client_assignments: convert LEFT JOIN users to INNER JOIN
-- with deleted_at filter in the ON clause.
CREATE OR REPLACE FUNCTION api.list_user_client_assignments(p_org_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid, p_active_only boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_org_id := COALESCE(p_org_id, public.get_current_org_id());

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization context required');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'user_id', a.user_id,
      'user_name', COALESCE(u.name, u.email),
      'user_email', u.email,
      'client_id', a.client_id,
      'organization_id', a.organization_id,
      'assigned_at', a.assigned_at,
      'assigned_until', a.assigned_until,
      'notes', a.notes,
      'is_active', a.is_active
    ) ORDER BY u.name, u.email
  ), '[]'::jsonb) INTO v_result
  FROM user_client_assignments_projection a
  -- Orphan-read filter: INNER JOIN with deleted_at IS NULL excludes
  -- assignments for soft-deleted users (was previously LEFT JOIN).
  JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
  WHERE a.organization_id = v_org_id
    AND (p_user_id IS NULL OR a.user_id = p_user_id)
    AND (p_client_id IS NULL OR a.client_id = p_client_id)
    AND (NOT p_active_only OR a.is_active = true);

  RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$function$;

-- api.get_schedule_template: add deleted_at IS NULL to the users join in the
-- assigned_users sub-select. Without this, schedule templates leak u.name and
-- u.email of soft-deleted users via their schedule_user_assignments_projection
-- rows (FK CASCADE is inert under soft-delete UPDATE).
-- Body copied verbatim from 20260218162625_fix_get_schedule_template_display_name_column.sql
-- with only the JOIN predicate changed.
CREATE OR REPLACE FUNCTION api.get_schedule_template(p_template_id uuid)
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
            u.name AS user_name,
            u.email AS user_email,
            sa.effective_from,
            sa.effective_until,
            sa.is_active,
            sa.created_at
        FROM public.schedule_user_assignments_projection sa
        -- Orphan-read filter: exclude assignments whose user was soft-deleted.
        JOIN public.users u ON u.id = sa.user_id AND u.deleted_at IS NULL
        WHERE sa.schedule_template_id = p_template_id
        ORDER BY u.name
    ) a;

    RETURN jsonb_build_object(
        'success', true,
        'template', v_template,
        'assigned_users', v_users
    );
END;
$function$;
