-- =============================================================================
-- Migration: api_rpc_readback_pattern
-- Created: 2026-04-23
-- Purpose: Generalize the projection-read-back guard pattern (Pattern A) to
--          all in-scope api.update_* and api.change_* RPCs that currently
--          emit a domain event and return immediately, exposing a silent-
--          failure surface when handlers fail and set processing_error.
-- =============================================================================
--
-- Background:
--   Surfaced as Major finding M3 by software-architect-dbc during the
--   client-ou-edit feature review. Proof-of-pattern landed in api.update_client
--   (migration 20260422052825) and api.change_client_placement (migration
--   20260423032200). This migration generalizes that pattern to the remaining
--   10 NEEDS-PATTERN RPCs + 1 COMPLEX-CASE.
--
-- Pattern A (return-error envelope) — the load-bearing constraint:
--   The dispatcher trigger process_domain_event() (BEFORE INSERT/UPDATE on
--   domain_events) catches handler exceptions and stores them in the NEW row's
--   processing_error column without re-raising. The domain_events row INSERTs
--   successfully with the failure trace preserved. If an RPC then RAISE
--   EXCEPTIONs to surface the failure, the entire transaction (including that
--   just-inserted audit row) rolls back, destroying the diagnostic evidence.
--   The admin dashboard at /admin/events would see zero failed events; the
--   api.retry_failed_event() recovery RPC would have nothing to retry.
--
--   Therefore handler-driven failures (read-back returns NOT FOUND) MUST use:
--     RETURN jsonb_build_object('success', false, 'error', '...')
--   never RAISE EXCEPTION (which would erase the audit trail).
--
--   Caller-driven failures (permission denial, entity-not-found pre-emit) may
--   continue using the function's existing pattern (RETURN error or RAISE) —
--   they happen BEFORE event emission so no audit trail to preserve.
--
-- Reference: software-architect-dbc report (2026-04-23) — see
--   infrastructure/supabase/handlers/trigger/process_domain_event.sql:9-58
--   for the catch-and-persist mechanic this pattern is built around.
--
-- RPCs touched by this migration (10 NEEDS-PATTERN + 1 COMPLEX-CASE = 11):
--
-- Client sub-entity (5 — same shape, additive response):
--   * api.update_client_address      → reads back client_addresses_projection
--   * api.update_client_email        → reads back client_emails_projection
--   * api.update_client_funding_source → reads back client_funding_sources_projection
--   * api.update_client_insurance    → reads back client_insurance_policies_projection
--   * api.update_client_phone        → reads back client_phones_projection
--
-- Organization (1 — has 2 baseline overloads, both updated; response shape
-- changes from raw jsonb to {success, settings} envelope — frontend consumer
-- updated in companion commit):
--   * api.update_organization_direct_care_settings (3-arg + 4-arg)
--                                    → reads back organizations_projection
--
-- User (3 — additive response):
--   * api.update_user                → reads back users (base table, predates _projection naming)
--   * api.update_user_phone          → reads back user_phones OR user_org_phone_overrides
--                                       (branches on p_org_id, mirrors existing pre-emit lookup)
--   * api.update_user_notification_preferences
--                                    → reads back user_notification_preferences_projection
--
-- Schedule (1 — additive response):
--   * api.update_schedule_template   → reads back schedule_templates_projection
--
-- Role (1 — COMPLEX-CASE; response composes role row + permission_ids array):
--   * api.update_role                → reads back roles_projection +
--                                       array_agg(permission_id) from
--                                       role_permissions_projection
--
-- Idempotency:
--   * All RPCs use CREATE OR REPLACE FUNCTION with the same signatures shipped
--     in baseline / prior migrations — no DROP needed. Re-runs are safe.
--   * The 4-arg overload of update_organization_direct_care_settings is
--     re-emitted; the 3-arg overload is also re-emitted (preserved, not
--     dropped, because it has independent callers).
--
-- Inventory source: dev/active/api-rpc-readback-pattern/api-rpc-readback-pattern-plan.md
-- =============================================================================


-- =============================================================================
-- 1. CLIENT SUB-ENTITY RPCs (5)
-- All share: emit `client.<thing>.updated` event; read back client_<things>_projection;
-- return {success, <id>, <entity_data>}.
-- =============================================================================

-- 1a. api.update_client_address ----------------------------------------------
CREATE OR REPLACE FUNCTION api.update_client_address(
    p_client_id uuid,
    p_address_id uuid,
    p_address_type text DEFAULT NULL,
    p_street1 text DEFAULT NULL,
    p_street2 text DEFAULT NULL,
    p_city text DEFAULT NULL,
    p_state text DEFAULT NULL,
    p_zip text DEFAULT NULL,
    p_country text DEFAULT NULL,
    p_is_primary boolean DEFAULT NULL,
    p_reason text DEFAULT 'Address updated',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_data jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    v_data := jsonb_build_object('address_id', p_address_id, 'organization_id', v_org_id);
    IF p_address_type IS NOT NULL THEN v_data := v_data || jsonb_build_object('address_type', p_address_type); END IF;
    IF p_street1 IS NOT NULL THEN v_data := v_data || jsonb_build_object('street1', p_street1); END IF;
    IF p_street2 IS NOT NULL THEN v_data := v_data || jsonb_build_object('street2', p_street2); END IF;
    IF p_city IS NOT NULL THEN v_data := v_data || jsonb_build_object('city', p_city); END IF;
    IF p_state IS NOT NULL THEN v_data := v_data || jsonb_build_object('state', p_state); END IF;
    IF p_zip IS NOT NULL THEN v_data := v_data || jsonb_build_object('zip', p_zip); END IF;
    IF p_country IS NOT NULL THEN v_data := v_data || jsonb_build_object('country', p_country); END IF;
    IF p_is_primary IS NOT NULL THEN v_data := v_data || jsonb_build_object('is_primary', p_is_primary); END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.address.updated',
        p_event_data := v_data,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- Pattern A read-back: handler ran synchronously via BEFORE INSERT trigger.
    -- A NOT FOUND result here means the handler raised — process_domain_event()
    -- caught the exception and persisted processing_error on the just-inserted
    -- domain_events row. Surface that to the caller without RAISEing (which
    -- would roll back the audit row).
    SELECT * INTO v_row
    FROM client_addresses_projection
    WHERE id = p_address_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.address.updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'address_id', p_address_id, 'address', row_to_json(v_row)::jsonb);
END;
$$;

-- 1b. api.update_client_email ------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_client_email(
    p_client_id uuid,
    p_email_id uuid,
    p_email text DEFAULT NULL,
    p_email_type text DEFAULT NULL,
    p_is_primary boolean DEFAULT NULL,
    p_reason text DEFAULT 'Email updated',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_row record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.email.updated',
        p_event_data := jsonb_build_object('email_id', p_email_id, 'organization_id', v_org_id)
            || CASE WHEN p_email IS NOT NULL THEN jsonb_build_object('email', p_email) ELSE '{}'::jsonb END
            || CASE WHEN p_email_type IS NOT NULL THEN jsonb_build_object('email_type', p_email_type) ELSE '{}'::jsonb END
            || CASE WHEN p_is_primary IS NOT NULL THEN jsonb_build_object('is_primary', p_is_primary) ELSE '{}'::jsonb END,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    SELECT * INTO v_row FROM client_emails_projection WHERE id = p_email_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.email.updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'email_id', p_email_id, 'email', row_to_json(v_row)::jsonb);
END;
$$;

-- 1c. api.update_client_funding_source ---------------------------------------
CREATE OR REPLACE FUNCTION api.update_client_funding_source(
    p_client_id uuid,
    p_funding_source_id uuid,
    p_source_type text DEFAULT NULL,
    p_source_name text DEFAULT NULL,
    p_reference_number text DEFAULT NULL,
    p_start_date date DEFAULT NULL,
    p_end_date date DEFAULT NULL,
    p_custom_fields jsonb DEFAULT NULL,
    p_reason text DEFAULT 'Funding source updated',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_data jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    v_data := jsonb_build_object('funding_source_id', p_funding_source_id, 'organization_id', v_org_id);
    IF p_source_type IS NOT NULL THEN v_data := v_data || jsonb_build_object('source_type', p_source_type); END IF;
    IF p_source_name IS NOT NULL THEN v_data := v_data || jsonb_build_object('source_name', p_source_name); END IF;
    IF p_reference_number IS NOT NULL THEN v_data := v_data || jsonb_build_object('reference_number', p_reference_number); END IF;
    IF p_start_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('start_date', p_start_date); END IF;
    IF p_end_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('end_date', p_end_date); END IF;
    IF p_custom_fields IS NOT NULL THEN v_data := v_data || jsonb_build_object('custom_fields', p_custom_fields); END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.funding_source.updated',
        p_event_data := v_data,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    SELECT * INTO v_row FROM client_funding_sources_projection WHERE id = p_funding_source_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.funding_source.updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'funding_source_id', p_funding_source_id, 'funding_source', row_to_json(v_row)::jsonb);
END;
$$;

-- 1d. api.update_client_insurance --------------------------------------------
CREATE OR REPLACE FUNCTION api.update_client_insurance(
    p_client_id uuid,
    p_policy_id uuid,
    p_payer_name text DEFAULT NULL,
    p_policy_number text DEFAULT NULL,
    p_group_number text DEFAULT NULL,
    p_subscriber_name text DEFAULT NULL,
    p_subscriber_relation text DEFAULT NULL,
    p_coverage_start_date date DEFAULT NULL,
    p_coverage_end_date date DEFAULT NULL,
    p_reason text DEFAULT 'Insurance updated',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_data jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    v_data := jsonb_build_object('policy_id', p_policy_id, 'organization_id', v_org_id);
    IF p_payer_name IS NOT NULL THEN v_data := v_data || jsonb_build_object('payer_name', p_payer_name); END IF;
    IF p_policy_number IS NOT NULL THEN v_data := v_data || jsonb_build_object('policy_number', p_policy_number); END IF;
    IF p_group_number IS NOT NULL THEN v_data := v_data || jsonb_build_object('group_number', p_group_number); END IF;
    IF p_subscriber_name IS NOT NULL THEN v_data := v_data || jsonb_build_object('subscriber_name', p_subscriber_name); END IF;
    IF p_subscriber_relation IS NOT NULL THEN v_data := v_data || jsonb_build_object('subscriber_relation', p_subscriber_relation); END IF;
    IF p_coverage_start_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('coverage_start_date', p_coverage_start_date); END IF;
    IF p_coverage_end_date IS NOT NULL THEN v_data := v_data || jsonb_build_object('coverage_end_date', p_coverage_end_date); END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.insurance.updated',
        p_event_data := v_data,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    SELECT * INTO v_row FROM client_insurance_policies_projection WHERE id = p_policy_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.insurance.updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'policy_id', p_policy_id, 'policy', row_to_json(v_row)::jsonb);
END;
$$;

-- 1e. api.update_client_phone ------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_client_phone(
    p_client_id uuid,
    p_phone_id uuid,
    p_phone_number text DEFAULT NULL,
    p_phone_type text DEFAULT NULL,
    p_is_primary boolean DEFAULT NULL,
    p_reason text DEFAULT 'Phone updated',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_row record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.phone.updated',
        p_event_data := jsonb_build_object('phone_id', p_phone_id, 'organization_id', v_org_id)
            || CASE WHEN p_phone_number IS NOT NULL THEN jsonb_build_object('phone_number', p_phone_number) ELSE '{}'::jsonb END
            || CASE WHEN p_phone_type IS NOT NULL THEN jsonb_build_object('phone_type', p_phone_type) ELSE '{}'::jsonb END
            || CASE WHEN p_is_primary IS NOT NULL THEN jsonb_build_object('is_primary', p_is_primary) ELSE '{}'::jsonb END,
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    SELECT * INTO v_row FROM client_phones_projection WHERE id = p_phone_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.phone.updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'phone_id', p_phone_id, 'phone', row_to_json(v_row)::jsonb);
END;
$$;


-- =============================================================================
-- 2. ORGANIZATION DIRECT-CARE SETTINGS (2 overloads — 3-arg + 4-arg)
-- Both currently return raw v_new_settings jsonb. Pattern A wraps in
-- {success, settings} envelope. **Breaking change** for the one frontend
-- consumer (frontend/src/services/direct-care/SupabaseDirectCareSettingsService.ts)
-- which currently reads `data.enable_*` directly — companion commit on this
-- branch updates it to read `data.settings.enable_*`.
--
-- Both overloads use RAISE EXCEPTION for caller-driven failures (org-not-found,
-- permission denial). Per architect report this is fine — those happen pre-emit
-- so no audit trail to preserve. The new read-back guard uses Pattern A
-- (RETURN error envelope) only for handler-driven failures.
-- =============================================================================

-- 2a. 3-arg overload (no p_reason) -------------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
    p_org_id uuid,
    p_enable_staff_client_mapping boolean DEFAULT NULL,
    p_enable_schedule_enforcement boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_current_settings jsonb;
    v_new_settings jsonb;
    v_org_path extensions.ltree;
    v_actual_settings jsonb;
    v_processing_error text;
BEGIN
    -- Caller-driven validation (pre-emit; RAISE EXCEPTION OK)
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = p_org_id;
    IF v_org_path IS NULL THEN
        RAISE EXCEPTION 'Organization not found';
    END IF;

    IF NOT has_effective_permission('organization.update', v_org_path) THEN
        RAISE EXCEPTION 'Insufficient permissions: organization.update required';
    END IF;

    -- Build new settings, preserving values not being updated
    SELECT COALESCE(direct_care_settings, '{}'::jsonb)
    INTO v_current_settings
    FROM organizations_projection
    WHERE id = p_org_id;

    v_new_settings := v_current_settings;
    IF p_enable_staff_client_mapping IS NOT NULL THEN
        v_new_settings := jsonb_set(v_new_settings, '{enable_staff_client_mapping}', to_jsonb(p_enable_staff_client_mapping));
    END IF;
    IF p_enable_schedule_enforcement IS NOT NULL THEN
        v_new_settings := jsonb_set(v_new_settings, '{enable_schedule_enforcement}', to_jsonb(p_enable_schedule_enforcement));
    END IF;

    -- Emit domain event (handler updates organizations_projection.direct_care_settings)
    PERFORM api.emit_domain_event(
        p_stream_type := 'organization',
        p_stream_id := p_org_id,
        p_event_type := 'organization.direct_care_settings_updated',
        p_event_data := jsonb_build_object(
            'organization_id', p_org_id,
            'settings', v_new_settings,
            'previous_settings', v_current_settings
        ),
        p_event_metadata := jsonb_build_object('user_id', auth.uid())
    );

    -- Pattern A read-back: confirm projection actually carries v_new_settings
    SELECT direct_care_settings INTO v_actual_settings
    FROM organizations_projection
    WHERE id = p_org_id;

    IF v_actual_settings IS DISTINCT FROM v_new_settings THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_org_id AND event_type = 'organization.direct_care_settings_updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'settings', v_new_settings);
END;
$$;

-- 2b. 4-arg overload (with p_reason) -----------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_direct_care_settings(
    p_org_id uuid,
    p_enable_staff_client_mapping boolean DEFAULT NULL,
    p_enable_schedule_enforcement boolean DEFAULT NULL,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_current_settings jsonb;
    v_new_settings jsonb;
    v_org_path extensions.ltree;
    v_metadata jsonb;
    v_actual_settings jsonb;
    v_processing_error text;
BEGIN
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = p_org_id;
    IF v_org_path IS NULL THEN
        RAISE EXCEPTION 'Organization not found';
    END IF;

    IF NOT has_effective_permission('organization.update', v_org_path) THEN
        RAISE EXCEPTION 'Insufficient permissions: organization.update required';
    END IF;

    SELECT COALESCE(direct_care_settings, '{}'::jsonb)
    INTO v_current_settings
    FROM organizations_projection
    WHERE id = p_org_id;

    v_new_settings := v_current_settings;
    IF p_enable_staff_client_mapping IS NOT NULL THEN
        v_new_settings := jsonb_set(v_new_settings, '{enable_staff_client_mapping}', to_jsonb(p_enable_staff_client_mapping));
    END IF;
    IF p_enable_schedule_enforcement IS NOT NULL THEN
        v_new_settings := jsonb_set(v_new_settings, '{enable_schedule_enforcement}', to_jsonb(p_enable_schedule_enforcement));
    END IF;

    v_metadata := jsonb_build_object('user_id', auth.uid());
    IF p_reason IS NOT NULL THEN
        v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
    END IF;

    PERFORM api.emit_domain_event(
        p_stream_type := 'organization',
        p_stream_id := p_org_id,
        p_event_type := 'organization.direct_care_settings_updated',
        p_event_data := jsonb_build_object(
            'organization_id', p_org_id,
            'settings', v_new_settings,
            'previous_settings', v_current_settings
        ),
        p_event_metadata := v_metadata
    );

    SELECT direct_care_settings INTO v_actual_settings
    FROM organizations_projection
    WHERE id = p_org_id;

    IF v_actual_settings IS DISTINCT FROM v_new_settings THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_org_id AND event_type = 'organization.direct_care_settings_updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'settings', v_new_settings);
END;
$$;


-- =============================================================================
-- 3. USER RPCs (3)
-- =============================================================================

-- 3a. api.update_user --------------------------------------------------------
-- Reads back from `users` (base table — predates the _projection naming
-- convention). Preserves the manual stream_version calc and raw INSERT INTO
-- domain_events pattern used by the original (no api.emit_domain_event).
CREATE OR REPLACE FUNCTION api.update_user(
    p_user_id uuid,
    p_org_id uuid,
    p_first_name text DEFAULT NULL,
    p_last_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'api'
AS $$
DECLARE
    v_event_id uuid;
    v_current_user_id uuid;
    v_stream_version int;
    v_row record;
    v_processing_error text;
BEGIN
    v_current_user_id := auth.uid();

    -- Caller-driven validation (pre-emit)
    IF v_current_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles_projection
        WHERE user_id = p_user_id AND organization_id = p_org_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found in organization');
    END IF;

    -- Calculate next stream version for this user (preserved contract)
    SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
    FROM public.domain_events
    WHERE stream_id = p_user_id AND stream_type = 'user';

    -- Emit domain event with stream_version + complete metadata
    INSERT INTO public.domain_events (
        stream_type, stream_id, stream_version, event_type, event_data, event_metadata
    ) VALUES (
        'user',
        p_user_id,
        v_stream_version,
        'user.profile.updated',
        jsonb_build_object(
            'user_id', p_user_id,
            'organization_id', p_org_id,
            'first_name', p_first_name,
            'last_name', p_last_name
        ),
        jsonb_build_object(
            'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'source', 'api',
            'user_id', v_current_user_id,
            'reason', 'User profile updated via UI',
            'service_name', 'api-rpc',
            'operation_name', 'update_user'
        )
    )
    RETURNING id INTO v_event_id;

    -- Pattern A read-back: handle_user_profile_updated writes to users base table
    SELECT * INTO v_row FROM public.users WHERE id = p_user_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events
        WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'event_id', v_event_id, 'user', row_to_json(v_row)::jsonb);
END;
$$;

-- 3b. api.update_user_phone --------------------------------------------------
-- Branches on p_org_id between `user_phones` (org_id NULL) and
-- `user_org_phone_overrides` (org_id NOT NULL). Read-back must mirror the
-- same branching — handler writes to whichever table the pre-emit lookup
-- found.
CREATE OR REPLACE FUNCTION api.update_user_phone(
    p_phone_id uuid,
    p_label text DEFAULT NULL,
    p_type text DEFAULT NULL,
    p_number text DEFAULT NULL,
    p_extension text DEFAULT NULL,
    p_country_code text DEFAULT NULL,
    p_is_primary boolean DEFAULT NULL,
    p_sms_capable boolean DEFAULT NULL,
    p_org_id uuid DEFAULT NULL,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id uuid;
    v_event_id uuid;
    v_metadata jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    -- Caller-driven validation (pre-emit; existing RAISE pattern preserved)
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

    -- Pattern A read-back: mirror the pre-emit branching
    IF p_org_id IS NULL THEN
        SELECT * INTO v_row FROM user_phones WHERE id = p_phone_id;
    ELSE
        SELECT * INTO v_row FROM user_org_phone_overrides WHERE id = p_phone_id;
    END IF;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'phoneId', p_phone_id, 'eventId', v_event_id, 'phone', row_to_json(v_row)::jsonb);
END;
$$;

-- 3c. api.update_user_notification_preferences -------------------------------
CREATE OR REPLACE FUNCTION api.update_user_notification_preferences(
    p_user_id uuid,
    p_org_id uuid,
    p_notification_preferences jsonb,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_event_id uuid;
    v_metadata jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    -- Caller-driven validation (pre-emit; existing RAISE pattern preserved)
    IF NOT (
        public.has_platform_privilege()
        OR public.has_org_admin_permission()
        OR p_user_id = public.get_current_user_id()
    ) THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    v_metadata := jsonb_build_object(
        'user_id', public.get_current_user_id(),
        'source', 'api.update_user_notification_preferences'
    );
    IF p_reason IS NOT NULL THEN
        v_metadata := v_metadata || jsonb_build_object('reason', p_reason);
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id := p_user_id,
        p_stream_type := 'user',
        p_event_type := 'user.notification_preferences.updated',
        p_event_data := jsonb_build_object(
            'user_id', p_user_id,
            'org_id', p_org_id,
            'notification_preferences', p_notification_preferences
        ),
        p_event_metadata := v_metadata
    );

    -- Pattern A read-back. Note: projection column is `organization_id`, while
    -- the RPC param + event_data field is `p_org_id`/`org_id` — the handler
    -- (handle_user_notification_preferences_updated) translates between them.
    SELECT * INTO v_row
    FROM user_notification_preferences_projection
    WHERE user_id = p_user_id AND organization_id = p_org_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'event_id', v_event_id, 'preferences', row_to_json(v_row)::jsonb);
END;
$$;


-- =============================================================================
-- 4. SCHEDULE TEMPLATE (1)
-- =============================================================================

-- 4a. api.update_schedule_template -------------------------------------------
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
AS $$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_template record;
    v_event_data jsonb;
    v_row record;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();

    -- Caller-driven validation (pre-emit; existing RETURN-error pattern preserved)
    SELECT * INTO v_template
    FROM public.schedule_templates_projection
    WHERE id = p_template_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Schedule template not found');
    END IF;

    IF NOT v_template.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot update an inactive template');
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
        p_stream_id := p_template_id,
        p_stream_type := 'schedule',
        p_event_type := 'schedule.updated',
        p_event_data := v_event_data,
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', v_org_id
        )
    );

    -- Pattern A read-back
    SELECT * INTO v_row FROM public.schedule_templates_projection WHERE id = p_template_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_template_id AND event_type = 'schedule.updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    RETURN jsonb_build_object('success', true, 'template', row_to_json(v_row)::jsonb);
END;
$$;


-- =============================================================================
-- 5. ROLE (COMPLEX-CASE — composes role row + permission_ids array)
-- =============================================================================

-- 5a. api.update_role --------------------------------------------------------
-- COMPLEX-CASE: response composes the role row PLUS the array of current
-- permission_ids (sourced from role_permissions_projection). Standard
-- %ROWTYPE / row_to_json read-back is insufficient because the role's
-- permissions live in a separate projection.
--
-- The pre-emit validation paths (RETURN error envelope on not-found, inactive,
-- subset-only-violation) are preserved verbatim. Only the post-emit happy
-- path is changed to compose the joined response.
--
-- Note: this function emits 1-N events (role.updated + role.permission.granted
-- + role.permission.revoked). The read-back happens AFTER all events have been
-- emitted; the BEFORE INSERT trigger has already updated both
-- roles_projection and role_permissions_projection synchronously by the time
-- the read-back runs. If ANY of the emitted events failed, the read-back
-- still returns the role row (since handle_role_updated wrote it before the
-- failing handler ran), but the permission_ids array reflects only the
-- successfully-applied changes. The processing_error fetch surfaces the most
-- recent failure for caller diagnostics.
CREATE OR REPLACE FUNCTION api.update_role(
    p_role_id uuid,
    p_name text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_permission_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id uuid;
    v_org_id uuid;
    v_existing record;
    v_current_perms uuid[];
    v_new_perms uuid[];
    v_to_grant uuid[];
    v_to_revoke uuid[];
    v_perm_id uuid;
    v_user_perms uuid[];
    v_perm_name text;
    v_row record;
    v_perm_ids_after uuid[];
    v_processing_error text;
BEGIN
    v_user_id := public.get_current_user_id();
    v_org_id := public.get_current_org_id();

    -- Caller-driven validation (pre-emit)
    SELECT * INTO v_existing FROM roles_projection
    WHERE id = p_role_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Role not found',
            'errorDetails', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Role not found or access denied')
        );
    END IF;

    IF NOT v_existing.is_active THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot update inactive role',
            'errorDetails', jsonb_build_object('code', 'INACTIVE_ROLE', 'message', 'Reactivate the role before making changes')
        );
    END IF;

    -- Emit role.updated event if name or description changed
    IF p_name IS NOT NULL OR p_description IS NOT NULL THEN
        PERFORM api.emit_domain_event(
            p_stream_id := p_role_id,
            p_stream_type := 'role',
            p_event_type := 'role.updated',
            p_event_data := jsonb_build_object(
                'name', COALESCE(p_name, v_existing.name),
                'description', COALESCE(p_description, v_existing.description)
            ),
            p_event_metadata := jsonb_build_object(
                'user_id', v_user_id,
                'organization_id', v_org_id,
                'reason', 'Role metadata update via Role Management UI'
            )
        );
    END IF;

    -- Handle permission changes
    IF p_permission_ids IS NOT NULL THEN
        SELECT array_agg(permission_id) INTO v_current_perms
        FROM role_permissions_projection WHERE role_id = p_role_id;
        v_current_perms := COALESCE(v_current_perms, '{}');
        v_new_perms := p_permission_ids;

        v_user_perms := public.get_user_aggregated_permissions(v_user_id);

        v_to_grant := ARRAY(SELECT unnest(v_new_perms) EXCEPT SELECT unnest(v_current_perms));

        IF NOT public.check_permissions_subset(v_to_grant, v_user_perms) THEN
            FOREACH v_perm_id IN ARRAY v_to_grant
            LOOP
                IF NOT (v_perm_id = ANY(v_user_perms)) THEN
                    SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', 'Cannot grant permission you do not possess',
                        'errorDetails', jsonb_build_object(
                            'code', 'SUBSET_ONLY_VIOLATION',
                            'message', format('Permission %s is not in your granted set', COALESCE(v_perm_name, v_perm_id::text))
                        )
                    );
                END IF;
            END LOOP;
        END IF;

        v_to_revoke := ARRAY(SELECT unnest(v_current_perms) EXCEPT SELECT unnest(v_new_perms));

        FOREACH v_perm_id IN ARRAY v_to_grant
        LOOP
            SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
            PERFORM api.emit_domain_event(
                p_stream_id := p_role_id,
                p_stream_type := 'role',
                p_event_type := 'role.permission.granted',
                p_event_data := jsonb_build_object(
                    'permission_id', v_perm_id,
                    'permission_name', v_perm_name
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id', v_user_id,
                    'organization_id', v_org_id,
                    'reason', 'Permission added via Role Management UI'
                )
            );
        END LOOP;

        FOREACH v_perm_id IN ARRAY v_to_revoke
        LOOP
            SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
            PERFORM api.emit_domain_event(
                p_stream_id := p_role_id,
                p_stream_type := 'role',
                p_event_type := 'role.permission.revoked',
                p_event_data := jsonb_build_object(
                    'permission_id', v_perm_id,
                    'permission_name', v_perm_name,
                    'revocation_reason', 'Permission removed via Role Management UI'
                ),
                p_event_metadata := jsonb_build_object(
                    'user_id', v_user_id,
                    'organization_id', v_org_id,
                    'reason', 'Permission removed via Role Management UI'
                )
            );
        END LOOP;
    END IF;

    -- Pattern A COMPLEX-CASE read-back: compose role row + permission_ids array
    SELECT * INTO v_row FROM roles_projection WHERE id = p_role_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        -- The role row is gone — handle_role_updated must have failed catastrophically.
        -- Fetch the most recent failure for diagnostics.
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_role_id
          AND event_type IN ('role.updated', 'role.permission.granted', 'role.permission.revoked')
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    SELECT array_agg(permission_id ORDER BY permission_id) INTO v_perm_ids_after
    FROM role_permissions_projection WHERE role_id = p_role_id;
    v_perm_ids_after := COALESCE(v_perm_ids_after, '{}');

    -- Surface processing_error from any of the emitted events for caller awareness
    -- (the role+permissions read-back may still succeed even if a single grant/revoke
    -- failed — caller can decide whether to treat partial-success as success).
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_role_id
      AND processing_error IS NOT NULL
      AND created_at > NOW() - INTERVAL '5 seconds'
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
        'success', v_processing_error IS NULL,
        'role', row_to_json(v_row)::jsonb,
        'permission_ids', to_jsonb(v_perm_ids_after),
        'error', CASE WHEN v_processing_error IS NOT NULL
                      THEN 'Event processing failed: ' || v_processing_error
                      ELSE NULL END
    );
END;
$$;


-- =============================================================================
-- VERIFICATION (run via MCP execute_sql or psql after apply):
--
-- Confirm read-back guard present in each refactored RPC:
--   SELECT proname,
--          pg_get_functiondef(oid)::text LIKE '%Pattern A read-back%' AS has_marker
--   FROM pg_proc
--   WHERE pronamespace='api'::regnamespace
--     AND proname IN (
--       'update_client_address', 'update_client_email',
--       'update_client_funding_source', 'update_client_insurance',
--       'update_client_phone', 'update_organization_direct_care_settings',
--       'update_user', 'update_user_phone', 'update_user_notification_preferences',
--       'update_schedule_template', 'update_role'
--     );
--   Expect: 12 rows (update_organization_direct_care_settings has 2 overloads), all has_marker=t
--
-- Confirm no failed events from the migration apply:
--   SELECT COUNT(*) FROM domain_events
--   WHERE event_type IN (
--     'client.address.updated', 'client.email.updated',
--     'client.funding_source.updated', 'client.insurance.updated',
--     'client.phone.updated', 'organization.direct_care_settings_updated',
--     'user.profile.updated', 'user.phone.updated',
--     'user.notification_preferences.updated', 'schedule.updated',
--     'role.updated', 'role.permission.granted', 'role.permission.revoked'
--   ) AND processing_error IS NOT NULL
--     AND created_at > now() - INTERVAL '5 minutes';
--   Expect: 0
-- =============================================================================
