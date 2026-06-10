-- Hotfix: api.add_user_phone / api.update_user_phone org-scoped read-back
-- referenced a column (is_primary) that exists only on user_phones, NOT on
-- user_org_phone_overrides.
--
-- Surfaced 2026-06-10 during manual happy-path testing of the phone-add flow:
--   "Failed to add phone: column \"is_primary\" does not exist"
-- when adding an ORG-SCOPED phone (p_org_id IS NOT NULL). Global phones
-- (read from user_phones, which HAS is_primary) were unaffected.
--
-- Root cause: pitfall #8 (handler/RPC vs projection-table column drift). The
-- handler `handle_user_phone_added` is CORRECT — it deliberately omits
-- is_primary when inserting into user_org_phone_overrides (org overrides have
-- no primary concept by design). But the api.add_user_phone read-back ELSE
-- branch SELECTed `is_primary` from that table, raising at plan time. The
-- whole RPC transaction rolled back, so the add failed (no orphan row) but
-- the feature was broken for org-scoped phones.
--
-- Fix: org-override read-backs return the constant `false` for isPrimary
-- (matching the handler's intent). update_user_phone's org branch is aligned
-- for shape parity (was silently omitting is_primary for org phones).
--
-- CREATE OR REPLACE with identical signatures preserves each function's OID
-- and its @a4c-rpc-shape COMMENT (no DROP+CREATE; pitfall re: comment loss N/A).

-- =====================================================================
-- Pitfall #8 fail-loud column-existence assertion (precondition guard)
-- =====================================================================
DO $assert$
DECLARE
  v_missing text;
BEGIN
  -- Global phones read from user_phones — INCLUDING is_primary.
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id','user_id','label','type','number','extension',
                    'country_code','is_primary','is_active','sms_capable',
                    'created_at','updated_at']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_phones' AND column_name=c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'user_phones missing read-back column(s): %', v_missing
      USING ERRCODE = '42703';
  END IF;

  -- Org overrides read from user_org_phone_overrides — WITHOUT is_primary
  -- (the column the bug erroneously referenced). Assert the override
  -- read-back set exists.
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id','user_id','org_id','label','type','number','extension',
                    'country_code','is_active','sms_capable',
                    'created_at','updated_at']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_org_phone_overrides' AND column_name=c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'user_org_phone_overrides missing read-back column(s): %', v_missing
      USING ERRCODE = '42703';
  END IF;

  -- If a future migration adds is_primary to the override table, the
  -- constant-false read-back below should be revisited to return the real value.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_org_phone_overrides'
      AND column_name='is_primary') THEN
    RAISE WARNING 'user_org_phone_overrides now has is_primary; revisit the constant-false read-back in api.add_user_phone / api.update_user_phone';
  END IF;
END
$assert$;

-- =====================================================================
-- api.add_user_phone  (fix: ELSE branch isPrimary -> constant false)
-- =====================================================================
CREATE OR REPLACE FUNCTION api.add_user_phone(
    p_user_id uuid,
    p_label text,
    p_type text,
    p_number text,
    p_extension text DEFAULT NULL::text,
    p_country_code text DEFAULT '+1'::text,
    p_is_primary boolean DEFAULT false,
    p_sms_capable boolean DEFAULT false,
    p_org_id uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_phone_id uuid;
    v_event_id uuid;
    v_metadata jsonb;
    v_phone jsonb;
    v_processing_error text;
BEGIN
    -- Authorization: Three-tier check (unchanged from baseline)
    IF NOT (
        public.has_platform_privilege()
        OR public.has_org_admin_permission()
        OR p_user_id = public.get_current_user_id()
    ) THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    v_phone_id := gen_random_uuid();

    -- Build metadata with optional reason (unchanged from baseline)
    v_metadata := jsonb_build_object(
        'user_id', public.get_current_user_id(),
        'source', 'api.add_user_phone'
    );
    IF p_reason IS NOT NULL THEN
        v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
    END IF;

    -- Emit domain event (unchanged from baseline)
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

    -- Pattern A v2 read-back: branch on p_org_id to read from the correct
    -- projection. Handler writes to `user_phones` for global phones,
    -- `user_org_phone_overrides` for org-scoped phones. The v_phone jsonb
    -- uses explicit camelCase keys to match the frontend `UserPhone` type.
    IF p_org_id IS NULL THEN
        SELECT jsonb_build_object(
            'id', id,
            'userId', user_id,
            'orgId', NULL,
            'label', label,
            'type', type,
            'number', number,
            'extension', extension,
            'countryCode', country_code,
            'isPrimary', is_primary,
            'smsCapable', sms_capable,
            'isActive', is_active,
            'createdAt', created_at,
            'updatedAt', updated_at
        )
        INTO v_phone
        FROM user_phones
        WHERE id = v_phone_id;
    ELSE
        -- HOTFIX 2026-06-10: user_org_phone_overrides has NO is_primary column
        -- (org overrides carry no primary designation — see handler
        -- handle_user_phone_added, which omits it). Return constant false
        -- rather than SELECTing a nonexistent column.
        SELECT jsonb_build_object(
            'id', id,
            'userId', user_id,
            'orgId', org_id,
            'label', label,
            'type', type,
            'number', number,
            'extension', extension,
            'countryCode', country_code,
            'isPrimary', false,
            'smsCapable', sms_capable,
            'isActive', is_active,
            'createdAt', created_at,
            'updatedAt', updated_at
        )
        INTO v_phone
        FROM user_org_phone_overrides
        WHERE id = v_phone_id;
    END IF;

    IF v_phone IS NULL THEN
        -- Row wasn't projected. Surface the handler's processing_error on
        -- the captured event_id (race-safe PK lookup, Pattern A v2).
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'),
            'phoneId', v_phone_id
        );
    END IF;

    -- Post-read-back processing_error check. The handler may have partially
    -- completed (e.g., projection row inserted but a trailing side effect
    -- raised); Pattern A v2 requires surfacing that as an envelope failure
    -- rather than silently returning success.
    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'phoneId', v_phone_id
        );
    END IF;

    -- Success envelope (additive contract change: `phone` is new; `phoneId`
    -- and `eventId` preserved for existing consumers).
    RETURN jsonb_build_object(
        'success', true,
        'phoneId', v_phone_id,
        'eventId', v_event_id,
        'phone', v_phone
    );
END;
$function$;

-- =====================================================================
-- api.update_user_phone  (fix: org branch returns is_primary=false for
-- shape parity; was silently omitting it for org phones)
-- =====================================================================
CREATE OR REPLACE FUNCTION api.update_user_phone(
    p_phone_id uuid,
    p_label text DEFAULT NULL::text,
    p_type text DEFAULT NULL::text,
    p_number text DEFAULT NULL::text,
    p_extension text DEFAULT NULL::text,
    p_country_code text DEFAULT NULL::text,
    p_is_primary boolean DEFAULT NULL::boolean,
    p_sms_capable boolean DEFAULT NULL::boolean,
    p_org_id uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_user_id uuid;
    v_event_id uuid;
    v_metadata jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    IF p_org_id IS NULL THEN
        SELECT user_id INTO v_user_id FROM user_phones WHERE id = p_phone_id;
    ELSE
        SELECT user_id INTO v_user_id FROM user_org_phone_overrides WHERE id = p_phone_id;
    END IF;

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

    IF p_org_id IS NULL THEN
        SELECT * INTO v_row FROM user_phones WHERE id = p_phone_id;
    ELSE
        SELECT * INTO v_row FROM user_org_phone_overrides WHERE id = p_phone_id;
    END IF;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    -- HOTFIX 2026-06-10: user_org_phone_overrides has no is_primary column, so
    -- row_to_json omits it for org phones (frontend then sees isPrimary=undefined).
    -- Inject the constant false for org overrides to match api.add_user_phone
    -- and the UserPhone contract (isPrimary: boolean). Global phones carry the
    -- real value from user_phones.
    RETURN jsonb_build_object(
        'success', true,
        'phoneId', p_phone_id,
        'eventId', v_event_id,
        'phone',
        CASE
            WHEN p_org_id IS NULL THEN row_to_json(v_row)::jsonb
            ELSE row_to_json(v_row)::jsonb || jsonb_build_object('is_primary', false)
        END
    );
END;
$function$;
