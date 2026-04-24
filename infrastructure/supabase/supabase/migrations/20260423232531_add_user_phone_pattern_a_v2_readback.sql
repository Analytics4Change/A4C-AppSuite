-- =============================================================================
-- Migration: add_user_phone_pattern_a_v2_readback
-- =============================================================================
-- Purpose: Blocker 3 (Scope F, PR A) — extend `api.add_user_phone` to return
--          the refreshed `phone` entity in its Pattern A v2 success envelope,
--          mirroring the existing `api.update_user_phone` contract.
--
-- Context:
--   - `api.update_user_phone` already returns `phone` (baseline_v4 L6585).
--   - `api.add_user_phone` (baseline_v4 L204) currently returns only
--     `{success, phoneId, eventId}` — frontend must refetch the phone list
--     after every add, even though the event handler has already populated
--     the projection before the trigger returns.
--
-- Contract change (additive):
--   Before: `{success: true, phoneId, eventId}`
--   After:  `{success: true, phoneId, eventId, phone: <UserPhone-shaped jsonb>}`
--
-- Pattern A v2 architect-reviewed requirement (software-architect-dbc agent
-- `a9dee2ed181895edb`, 2026-04-23):
--   The read-back MUST branch on `p_org_id IS NULL` because the handler
--   writes to two different tables:
--     - `user_phones` when `p_org_id IS NULL` (global phone)
--     - `user_org_phone_overrides` when `p_org_id` is set (org-specific)
--   A single-table SELECT would return NULL for org-scoped phones and
--   trigger a false-failure envelope.
--
-- The read-back uses explicit `jsonb_build_object` with camelCase keys (not
-- `row_to_json(v_row)::jsonb`) so the returned shape matches the frontend
-- `UserPhone` TypeScript type without an adapter step — load-bearing for
-- the in-place VM patch convention documented at
-- `documentation/frontend/patterns/rpc-readback-vm-patch.md` (authored in
-- this same PR).
--
-- Parameter list: preserved byte-for-byte from baseline_v4 to avoid
-- drop-and-recreate. CREATE OR REPLACE only.
--
-- Error envelope (Pattern A v2 — ADR `adr-rpc-readback-pattern.md`):
--   - IF NOT FOUND on the row read-back → surface `processing_error` from
--     the captured `v_event_id`.
--   - Post-read-back processing_error check → same envelope.
--   - NEVER `RAISE EXCEPTION` for handler-driven failures (destroys the
--     `domain_events` audit row).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- =============================================================================


CREATE OR REPLACE FUNCTION api.add_user_phone(
    p_user_id uuid,
    p_label text,
    p_type text,
    p_number text,
    p_extension text DEFAULT NULL,
    p_country_code text DEFAULT '+1',
    p_is_primary boolean DEFAULT false,
    p_sms_capable boolean DEFAULT false,
    p_org_id uuid DEFAULT NULL,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
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
        SELECT jsonb_build_object(
            'id', id,
            'userId', user_id,
            'orgId', org_id,
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
$$;


-- =============================================================================
-- VERIFICATION (run via MCP execute_sql or psql after apply):
--
-- -- Shape check: add_user_phone returns 'phone' key
-- SELECT pg_get_functiondef(oid)::text LIKE '%''phone'', v_phone%'
-- FROM pg_proc WHERE proname='add_user_phone' AND pronamespace='api'::regnamespace;
-- -- Expect: t.
--
-- -- Branch check: both user_phones and user_org_phone_overrides referenced
-- SELECT
--   pg_get_functiondef(oid)::text LIKE '%FROM user_phones%'
--   AND pg_get_functiondef(oid)::text LIKE '%FROM user_org_phone_overrides%'
-- FROM pg_proc WHERE proname='add_user_phone' AND pronamespace='api'::regnamespace;
-- -- Expect: t.
-- =============================================================================
