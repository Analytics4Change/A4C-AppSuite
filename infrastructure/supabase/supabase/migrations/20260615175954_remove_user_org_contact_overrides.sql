-- Remove per-user org-override phone & address tables (global-only user contact data)
--
-- `user_org_phone_overrides` / `user_org_address_overrides` (keyed user_id+org_id)
-- were a structural-symmetry "hybrid scope" feature (user-management Decision #13,
-- 2024-12-31) with no documented use case. They are removed; all user phones/addresses
-- are now global (`user_phones` / `user_addresses`). The org-level HQ contact subsystem
-- (`phones_projection`/`addresses_projection`/`contacts_projection` + `organization_*`
-- junctions, keyed organization_id) is a DIFFERENT subsystem and is untouched.
--
-- Trigger: notification-prefs SMS picker offered org-scoped phones, but
-- `user_notification_preferences_projection.sms_phone_id` FK → `user_phones(id)`
-- (global only) → FK violation on save. Removing org-override phones fixes it structurally.
--
-- Approach (architect-reviewed APPROVE WITH IN-PR FIXES):
--   * Simplify the 14 consumers (5 api RPCs + 3 public helpers + 6 handlers) — drop the
--     org/`p_org_id` branch. Bodies derived from DEPLOYED state (incl. hotfix 20260610200218).
--   * Keep vestigial `p_org_id`/`p_organization_id` params (always NULL) → no signature
--     change → CREATE OR REPLACE preserves OID + @a4c-rpc-shape/reachability COMMENT tags
--     (no DROP+CREATE re-tag needed). Only the 2 RPC comments with stale override prose are
--     re-issued, preserving every @a4c tag line byte-for-byte.
--   * Drop 6 RLS policies, 5 indexes, 2 tables. Outbound FKs to user_organizations_projection
--     vanish; zero inbound FKs (verified).
--   * Inverted pitfall-#8 fail-loud assertion: verify tables + function refs are GONE.

SET search_path = public, extensions, pg_temp;

-- =====================================================================
-- 1. api.* RPCs — simplified to global-only (CREATE OR REPLACE, sig unchanged)
-- =====================================================================

CREATE OR REPLACE FUNCTION api.add_user_phone(
    p_user_id uuid, p_label text, p_type text, p_number text,
    p_extension text DEFAULT NULL::text, p_country_code text DEFAULT '+1'::text,
    p_is_primary boolean DEFAULT false, p_sms_capable boolean DEFAULT false,
    p_org_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text
)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_phone_id uuid;
    v_event_id uuid;
    v_metadata jsonb;
    v_phone jsonb;
    v_processing_error text;
BEGIN
    IF NOT (
        public.has_platform_privilege()
        OR public.has_org_admin_permission()
        OR p_user_id = public.get_current_user_id()
    ) THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    v_phone_id := gen_random_uuid();

    v_metadata := jsonb_build_object(
        'user_id', public.get_current_user_id(),
        'source', 'api.add_user_phone'
    );
    IF p_reason IS NOT NULL THEN
        v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
    END IF;

    -- p_org_id retained for signature stability (always NULL post org-override removal).
    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.phone.added',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'phone_id', v_phone_id,
            'org_id', p_org_id,
            'label', p_label,
            'type', p_type,
            'number', p_number,
            'extension', p_extension,
            'country_code', p_country_code,
            'is_primary', p_is_primary,
            'sms_capable', p_sms_capable
        ),
        p_event_metadata := v_metadata
    );

    -- Pattern A v2 read-back (global user_phones only).
    SELECT jsonb_build_object(
        'id', id, 'userId', user_id, 'orgId', NULL,
        'label', label, 'type', type, 'number', number, 'extension', extension,
        'countryCode', country_code, 'isPrimary', is_primary, 'smsCapable', sms_capable,
        'isActive', is_active, 'createdAt', created_at, 'updatedAt', updated_at
    )
    INTO v_phone
    FROM user_phones
    WHERE id = v_phone_id;

    IF v_phone IS NULL THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'),
            'phoneId', v_phone_id);
    END IF;

    SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'phoneId', v_phone_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'phoneId', v_phone_id, 'eventId', v_event_id, 'phone', v_phone);
END;
$function$;

CREATE OR REPLACE FUNCTION api.update_user_phone(
    p_phone_id uuid, p_label text DEFAULT NULL::text, p_type text DEFAULT NULL::text,
    p_number text DEFAULT NULL::text, p_extension text DEFAULT NULL::text,
    p_country_code text DEFAULT NULL::text, p_is_primary boolean DEFAULT NULL::boolean,
    p_sms_capable boolean DEFAULT NULL::boolean, p_org_id uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text
)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_user_id uuid;
    v_event_id uuid;
    v_metadata jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    SELECT user_id INTO v_user_id FROM user_phones WHERE id = p_phone_id;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Phone not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (
        public.has_platform_privilege()
        OR public.has_org_admin_permission()
        OR v_user_id = public.get_current_user_id()
    ) THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    v_metadata := jsonb_build_object(
        'user_id', public.get_current_user_id(),
        'source', 'api.update_user_phone'
    );
    IF p_reason IS NOT NULL THEN
        v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id := v_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.phone.updated',
        p_event_data := jsonb_build_object(
            'phone_id', p_phone_id,
            'org_id', p_org_id,
            'label', p_label,
            'type', p_type,
            'number', p_number,
            'extension', p_extension,
            'country_code', p_country_code,
            'is_primary', p_is_primary,
            'sms_capable', p_sms_capable
        ),
        p_event_metadata := v_metadata
    );

    SELECT * INTO v_row FROM user_phones WHERE id = p_phone_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object('success', true, 'phoneId', p_phone_id, 'eventId', v_event_id,
        'phone', row_to_json(v_row)::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION api.remove_user_phone(
    p_phone_id uuid, p_org_id uuid DEFAULT NULL::uuid,
    p_hard_delete boolean DEFAULT false, p_reason text DEFAULT NULL::text
)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_event_id UUID;
  v_metadata JSONB;
BEGIN
  SELECT user_id INTO v_user_id FROM user_phones WHERE id = p_phone_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Phone not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.has_platform_privilege()
    OR public.has_org_admin_permission()
    OR v_user_id = public.get_current_user_id()
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  v_metadata := jsonb_build_object(
    'user_id', public.get_current_user_id(),
    'source', 'api.remove_user_phone'
  );
  IF p_reason IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
  END IF;

  v_event_id := api.emit_domain_event(
    p_stream_id := v_user_id,
    p_stream_type := 'user',
    p_event_type := 'user.phone.removed',
    p_event_data := jsonb_build_object(
      'phone_id', p_phone_id,
      'org_id', p_org_id,
      'removal_type', CASE WHEN p_hard_delete THEN 'hard_delete' ELSE 'soft_delete' END
    ),
    p_event_metadata := v_metadata
  );

  RETURN jsonb_build_object('success', true, 'phoneId', p_phone_id, 'eventId', v_event_id);
END;
$function$;

CREATE OR REPLACE FUNCTION api.get_user_phones(p_user_id uuid, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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
    SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.deleted_at IS NULL
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', up.id,
      'label', up.label,
      'type', up.type::text,
      'number', up.number,
      'extension', up.extension,
      'countryCode', up.country_code,
      'smsCapable', up.sms_capable,
      'isPrimary', up.is_primary,
      'isActive', up.is_active,
      'isMirrored', (up.source_contact_phone_id IS NOT NULL),
      'source', 'global'
    ) ORDER BY up.is_primary DESC, up.created_at ASC), '[]'::jsonb)
    FROM user_phones up
    WHERE up.user_id = p_user_id AND up.is_active = true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION api.get_user_sms_phones(p_user_id uuid, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', up.id,
      'label', up.label,
      'number', up.number,
      'isPrimary', up.is_primary,
      'isMirrored', (up.source_contact_phone_id IS NOT NULL)
    ) ORDER BY up.is_primary DESC, up.created_at ASC), '[]'::jsonb)
    FROM user_phones up
    WHERE up.user_id = p_user_id AND up.is_active = true AND up.sms_capable = true
  );
END;
$function$;

-- =====================================================================
-- 1b. Re-issue COMMENTs that referenced the dropped tables (preserve @a4c tags verbatim)
-- =====================================================================

COMMENT ON FUNCTION api.add_user_phone(uuid, text, text, text, text, text, boolean, boolean, uuid, text) IS
$comment$Add a new phone for a user (global user_phones). p_org_id is vestigial (per-user org-override removed 2026-06; always NULL).
p_reason provides optional audit context (e.g., "Admin added phone during onboarding").
Authorization: Platform admin, org admin, or user adding their own phone.

@a4c-rpc-shape: envelope

@a4c-bucket: D
@a4c-consultant-callable: pending-phase4-rls
@a4c-consultant-callable-reason: Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4.
@a4c-phase-target: 4$comment$;

COMMENT ON FUNCTION api.get_user_phones(uuid, uuid) IS
$comment$Get user phones for notification settings. Returns global user_phones (per-user org-override removed 2026-06; source is always "global").
Includes isMirrored flag to indicate phones auto-copied from contact profile.
Authorization:
- Platform admins can read any user
- Org admins can read users in their org
- Users can read their own phones

@a4c-rpc-shape: read

@a4c-bucket: D
@a4c-consultant-callable: pending-phase4-rls
@a4c-consultant-callable-reason: Entity-lookup signature with RLS-enforced tenancy; per-table RLS extension required in Phase 4.
@a4c-phase-target: 4$comment$;

-- =====================================================================
-- 2. public.* effective-lookup helpers — global-only (is_override always false)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_user_effective_phone(p_user_id uuid, p_org_id uuid, p_phone_type phone_type DEFAULT 'mobile'::phone_type)
 RETURNS TABLE(id uuid, label text, type phone_type, number text, extension text, country_code text, sms_capable boolean, is_override boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    -- p_org_id retained for signature stability; org-override removed 2026-06.
    RETURN QUERY
    SELECT up.id, up.label, up.type, up.number, up.extension, up.country_code, up.sms_capable, false AS is_override
    FROM public.user_phones up
    WHERE up.user_id = p_user_id AND up.type = p_phone_type AND up.is_active = true
    ORDER BY up.is_primary DESC
    LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_sms_phone(p_user_id uuid, p_org_id uuid)
 RETURNS TABLE(id uuid, number text, country_code text, is_override boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT up.id, up.number, up.country_code, false AS is_override
    FROM public.user_phones up
    WHERE up.user_id = p_user_id AND up.sms_capable = true AND up.is_active = true
    ORDER BY up.is_primary DESC, up.type = 'mobile' DESC
    LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_effective_address(p_user_id uuid, p_org_id uuid, p_address_type address_type DEFAULT 'physical'::address_type)
 RETURNS TABLE(id uuid, label text, type address_type, street1 text, street2 text, city text, state text, zip_code text, country text, is_override boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT ua.id, ua.label, ua.type, ua.street1, ua.street2, ua.city, ua.state, ua.zip_code, ua.country, false AS is_override
    FROM public.user_addresses ua
    WHERE ua.user_id = p_user_id AND ua.type = p_address_type AND ua.is_active = true
    ORDER BY ua.is_primary DESC
    LIMIT 1;
END;
$function$;

-- =====================================================================
-- 3. Event handlers — drop the org-override branch (global tables only)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_user_phone_added(p_event record)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO user_phones (
    id, user_id, label, type, number, extension, country_code,
    is_primary, is_active, sms_capable, metadata, created_at, updated_at
  ) VALUES (
    (p_event.event_data->>'phone_id')::UUID,
    (p_event.event_data->>'user_id')::UUID,
    p_event.event_data->>'label',
    (p_event.event_data->>'type')::phone_type,
    p_event.event_data->>'number',
    p_event.event_data->>'extension',
    COALESCE(p_event.event_data->>'country_code', '+1'),
    COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
    COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
    COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
    COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_phone_updated(p_event record)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE user_phones SET
    label = COALESCE(p_event.event_data->>'label', label),
    type = COALESCE((p_event.event_data->>'type')::phone_type, type),
    number = COALESCE(p_event.event_data->>'number', number),
    extension = p_event.event_data->>'extension',
    country_code = COALESCE(p_event.event_data->>'country_code', country_code),
    is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
    is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
    sms_capable = COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, sms_capable),
    metadata = COALESCE(p_event.event_data->'metadata', metadata),
    updated_at = p_event.created_at
  WHERE id = (p_event.event_data->>'phone_id')::UUID;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_phone_removed(p_event record)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_phone_id UUID := (p_event.event_data->>'phone_id')::UUID;
BEGIN
  IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
    DELETE FROM user_phones WHERE id = v_phone_id;
  ELSE
    UPDATE user_phones SET is_active = false, updated_at = p_event.created_at WHERE id = v_phone_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_address_added(p_event record)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO user_addresses (
    id, user_id, label, type, street1, street2, city, state, zip_code, country,
    is_primary, is_active, metadata, created_at, updated_at
  ) VALUES (
    (p_event.event_data->>'address_id')::UUID,
    (p_event.event_data->>'user_id')::UUID,
    p_event.event_data->>'label',
    (p_event.event_data->>'type')::address_type,
    p_event.event_data->>'street1',
    p_event.event_data->>'street2',
    p_event.event_data->>'city',
    p_event.event_data->>'state',
    p_event.event_data->>'zip_code',
    COALESCE(p_event.event_data->>'country', 'USA'),
    COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
    COALESCE((p_event.event_data->>'is_active')::BOOLEAN, true),
    COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_address_updated(p_event record)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE user_addresses SET
    label = COALESCE(p_event.event_data->>'label', label),
    type = COALESCE((p_event.event_data->>'type')::address_type, type),
    street1 = COALESCE(p_event.event_data->>'street1', street1),
    street2 = p_event.event_data->>'street2',
    city = COALESCE(p_event.event_data->>'city', city),
    state = COALESCE(p_event.event_data->>'state', state),
    zip_code = COALESCE(p_event.event_data->>'zip_code', zip_code),
    country = COALESCE(p_event.event_data->>'country', country),
    is_primary = COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, is_primary),
    is_active = COALESCE((p_event.event_data->>'is_active')::BOOLEAN, is_active),
    metadata = COALESCE(p_event.event_data->'metadata', metadata),
    updated_at = p_event.created_at
  WHERE id = (p_event.event_data->>'address_id')::UUID;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_address_removed(p_event record)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_address_id UUID := (p_event.event_data->>'address_id')::UUID;
BEGIN
  IF p_event.event_data->>'removal_type' = 'hard_delete' THEN
    DELETE FROM user_addresses WHERE id = v_address_id;
  ELSE
    UPDATE user_addresses SET is_active = false, updated_at = p_event.created_at WHERE id = v_address_id;
  END IF;
END;
$function$;

-- =====================================================================
-- 4. Drop RLS policies (6) — must precede DROP TABLE for clean teardown
-- =====================================================================
DROP POLICY IF EXISTS platform_admin_all ON public.user_org_phone_overrides;
DROP POLICY IF EXISTS user_org_phone_overrides_org_admin_all ON public.user_org_phone_overrides;
DROP POLICY IF EXISTS user_org_phone_overrides_own_all ON public.user_org_phone_overrides;
DROP POLICY IF EXISTS platform_admin_all ON public.user_org_address_overrides;
DROP POLICY IF EXISTS user_org_address_overrides_org_admin_all ON public.user_org_address_overrides;
DROP POLICY IF EXISTS user_org_address_overrides_own_all ON public.user_org_address_overrides;

-- =====================================================================
-- 5. Drop indexes (5 non-PK)
-- =====================================================================
DROP INDEX IF EXISTS public.idx_user_org_phone_overrides_lookup;
DROP INDEX IF EXISTS public.idx_user_org_phone_overrides_sms;
DROP INDEX IF EXISTS public.idx_user_org_phone_overrides_user;
DROP INDEX IF EXISTS public.idx_user_org_address_overrides_lookup;
DROP INDEX IF EXISTS public.idx_user_org_address_overrides_user;

-- =====================================================================
-- 6. Drop tables (outbound FKs to user_organizations_projection vanish; zero inbound FKs)
-- =====================================================================
DROP TABLE IF EXISTS public.user_org_phone_overrides;
DROP TABLE IF EXISTS public.user_org_address_overrides;

-- =====================================================================
-- 7. Inverted pitfall-#8 fail-loud assertion: tables + function refs are GONE
-- =====================================================================
DO $assert$
BEGIN
  IF to_regclass('public.user_org_phone_overrides') IS NOT NULL
     OR to_regclass('public.user_org_address_overrides') IS NOT NULL THEN
    RAISE EXCEPTION 'Override table still present after migration' USING ERRCODE = 'P9099';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','api')
      AND p.prosrc ILIKE '%user_org_phone_overrides%'
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','api')
      AND p.prosrc ILIKE '%user_org_address_overrides%'
  ) THEN
    RAISE EXCEPTION 'A function still references a dropped override table' USING ERRCODE = 'P9099';
  END IF;
END
$assert$;
