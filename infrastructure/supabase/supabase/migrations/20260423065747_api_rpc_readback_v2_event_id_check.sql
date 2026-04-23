-- =============================================================================
-- Migration: api_rpc_readback_v2_event_id_check
-- Created: 2026-04-23
-- Purpose: Pattern A v2 — close the field-level write-through gap by adding a
--          race-safe post-emit `processing_error` check on the captured event_id.
-- =============================================================================
--
-- Background:
--   Pattern A (return-error envelope on handler-driven failure) was introduced
--   in migration 20260422052825 (api.update_client proof-of-pattern), extended
--   in 20260423032200 (api.change_client_placement), and generalized to 11 more
--   RPCs in 20260423060052. All used `IF NOT FOUND` after the projection
--   read-back as the failure-detection signal.
--
--   The gap (surfaced during Phase 1 implementation): IF NOT FOUND only catches
--   the case where the projection row is COMPLETELY MISSING. For UPDATE-only
--   handlers — which is the majority — the projection row pre-exists (created
--   by a separate add_*/register_* RPC). If the handler raises mid-update
--   (NOT NULL violation, type mismatch, RLS denial, NULL deref, missing
--   handler), the dispatcher trigger persists `processing_error` to the
--   domain_events row but the projection row remains visible (just stale or
--   partially-updated). The IF NOT FOUND check does NOT fire. The RPC returns
--   `{success: true, <entity>: <stale row>}` — the silent-failure shape Pattern
--   A was meant to eliminate.
--
--   Concretely demonstrated when implementing api.update_user: the
--   handle_user_profile_updated handler had never been created (router CASE
--   referenced a non-existent function — separate fix in commit 461b4929).
--   With the handler missing, every call set `processing_error` but the users
--   row pre-existed from signup. Without that handler fix, the IF NOT FOUND
--   check would have returned `{success: true, user: <unchanged row>}`.
--
--   The 9 pre-existing DONE RPCs (predating this branch) share the same gap.
--
-- Reference: software-architect-dbc 2026-04-23 follow-up review (agent ID
--   a26d286c3c12db3d5) — recommended Option (a) "always-check processing_error",
--   land Phase 1.6 on this same branch before opening the PR, retrofit ALL
--   pre-existing DONE RPCs in lockstep.
--
-- Pattern A v2 — three changes per RPC:
--
--   1. Add `v_event_id uuid;` to DECLARE block.
--
--   2. Capture the emit's UUID:
--          OLD: PERFORM api.emit_domain_event(...);
--          NEW: v_event_id := api.emit_domain_event(...);
--      `api.emit_domain_event(...) RETURNS uuid` already — no signature change.
--
--   3. After the existing `IF NOT FOUND THEN ... END IF;` block on the
--      projection read-back, add the race-safe processing_error check:
--          SELECT processing_error INTO v_processing_error
--          FROM domain_events WHERE id = v_event_id;
--          IF v_processing_error IS NOT NULL THEN
--              RETURN jsonb_build_object('success', false,
--                  'error', 'Event processing failed: ' || v_processing_error);
--          END IF;
--
-- Race safety:
--   `WHERE id = v_event_id` is an indexed PK lookup against the exact row this
--   RPC just emitted. Immune to concurrent emits on the same stream by other
--   sessions (the previous IF NOT FOUND fallback's `ORDER BY created_at DESC
--   LIMIT 1` could find a sibling event's processing_error — v2 fixes that).
--
-- Defense in depth:
--   The existing IF NOT FOUND block is preserved (not replaced). It catches
--   the rare case where the row is genuinely missing (e.g. RLS-denied
--   projection write that left no row at all). The new v2 check catches the
--   common case (handler raised on existing row). Both pass = success.
--
-- Idempotency: all CREATE OR REPLACE; safe to re-run.
--
-- RPCs touched (20 function definitions across 19 RPCs):
--
-- Phase 1 RPCs (11 from migration 20260423060052; SKIP update_role — it has
-- a multi-event 5-second-window check appropriate to its COMPLEX-CASE pattern):
--   * api.update_client_address
--   * api.update_client_email
--   * api.update_client_funding_source
--   * api.update_client_insurance
--   * api.update_client_phone
--   * api.update_organization_direct_care_settings (3-arg + 4-arg overloads)
--   * api.update_user
--   * api.update_user_phone
--   * api.update_user_notification_preferences
--   * api.update_schedule_template
--
-- Pre-existing DONE RPCs (9, predating this branch):
--   * api.update_client                 (proof-of-pattern, migration 20260422052825)
--   * api.change_client_placement       (migration 20260423032200)
--   * api.update_organization_unit      (migration 20260221173821)
--   * api.update_organization           (migration 20260226002002)
--   * api.update_organization_address   (migration 20260226002002)
--   * api.update_organization_contact   (migration 20260226002002)
--   * api.update_organization_phone     (migration 20260226002002)
--   * api.update_field_definition       (migration 20260408023403)
--   * api.update_field_category         (migration 20260408023403)
--
-- ADR: documentation/architecture/decisions/adr-rpc-readback-pattern.md
-- (Known Limitation section replaced with Resolved + v2 spec in companion commit.)
-- =============================================================================


-- =============================================================================
-- 1. CLIENT SUB-ENTITY RPCs (5) — Phase 1 RPCs
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
    v_event_id uuid;
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

    -- Pattern A v2: capture event_id for race-safe processing_error check below
    v_event_id := api.emit_domain_event(
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

    SELECT * INTO v_row FROM client_addresses_projection WHERE id = p_address_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.address.updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    -- Pattern A v2 race-safe check: catches handler-raised-mid-update on existing rows
    -- (IF NOT FOUND alone misses this — see adr-rpc-readback-pattern.md)
    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
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
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    v_event_id := api.emit_domain_event(
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

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
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
    v_event_id uuid;
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

    v_event_id := api.emit_domain_event(
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

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
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
    v_event_id uuid;
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

    v_event_id := api.emit_domain_event(
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

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
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
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    v_event_id := api.emit_domain_event(
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

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object('success', true, 'phone_id', p_phone_id, 'phone', row_to_json(v_row)::jsonb);
END;
$$;


-- =============================================================================
-- 2. ORGANIZATION DIRECT-CARE SETTINGS (2 overloads) — Phase 1 RPCs
-- =============================================================================

-- 2a. 3-arg overload ---------------------------------------------------------
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
    v_event_id uuid;
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

    v_event_id := api.emit_domain_event(
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

    SELECT direct_care_settings INTO v_actual_settings
    FROM organizations_projection
    WHERE id = p_org_id;

    IF v_actual_settings IS DISTINCT FROM v_new_settings THEN
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

    RETURN jsonb_build_object('success', true, 'settings', v_new_settings);
END;
$$;

-- 2b. 4-arg overload ---------------------------------------------------------
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
    v_event_id uuid;
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

    v_event_id := api.emit_domain_event(
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

    RETURN jsonb_build_object('success', true, 'settings', v_new_settings);
END;
$$;


-- =============================================================================
-- 3. USER RPCs (3) — Phase 1 RPCs
-- =============================================================================

-- 3a. api.update_user --------------------------------------------------------
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

    IF v_current_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles_projection
        WHERE user_id = p_user_id AND organization_id = p_org_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found in organization');
    END IF;

    SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
    FROM public.domain_events
    WHERE stream_id = p_user_id AND stream_type = 'user';

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

    SELECT * INTO v_row FROM public.users WHERE id = p_user_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object('success', true, 'event_id', v_event_id, 'user', row_to_json(v_row)::jsonb);
END;
$$;

-- 3b. api.update_user_phone --------------------------------------------------
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

    SELECT * INTO v_row
    FROM user_notification_preferences_projection
    WHERE user_id = p_user_id AND organization_id = p_org_id;

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

    RETURN jsonb_build_object('success', true, 'event_id', v_event_id, 'preferences', row_to_json(v_row)::jsonb);
END;
$$;


-- =============================================================================
-- 4. SCHEDULE TEMPLATE (1) — Phase 1 RPC
-- =============================================================================

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
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    v_user_id := auth.uid();

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

    v_event_id := api.emit_domain_event(
        p_stream_id := p_template_id,
        p_stream_type := 'schedule',
        p_event_type := 'schedule.updated',
        p_event_data := v_event_data,
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', v_org_id
        )
    );

    SELECT * INTO v_row FROM public.schedule_templates_projection WHERE id = p_template_id;

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

    RETURN jsonb_build_object('success', true, 'template', row_to_json(v_row)::jsonb);
END;
$$;


-- =============================================================================
-- 5. PRE-EXISTING DONE RPCs (9) — retrofit Pattern A v2 in lockstep
--
-- These RPCs predated the api-rpc-readback-pattern feature and used Pattern A
-- v1 (IF NOT FOUND only). Adding the v2 race-safe check here ensures all 19
-- DONE RPCs use the same pattern (update_role's COMPLEX-CASE pattern is
-- left intact).
-- =============================================================================

-- 5a. api.update_client (proof-of-pattern, migration 20260422052825) ---------
CREATE OR REPLACE FUNCTION api.update_client(
    p_client_id uuid,
    p_changes jsonb,
    p_reason text DEFAULT 'Client information updated',
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
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    IF NOT public.has_effective_permission('client.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: client.update');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.information_updated',
        p_event_data := jsonb_build_object('organization_id', v_org_id, 'changes', p_changes),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    SELECT * INTO v_row FROM clients_projection WHERE id = p_client_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.information_updated'
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'client_id', p_client_id,
        'client', row_to_json(v_row)::jsonb
    );
END;
$$;

-- 5b. api.change_client_placement (PR #27 remediation, migration 20260423032200)
CREATE OR REPLACE FUNCTION api.change_client_placement(
    p_client_id uuid,
    p_placement_arrangement text,
    p_start_date date DEFAULT CURRENT_DATE,
    p_reason_text text DEFAULT NULL,
    p_reason text DEFAULT 'Placement changed',
    p_event_metadata jsonb DEFAULT NULL,
    p_correlation_id uuid DEFAULT NULL,
    p_organization_unit_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_org_id uuid;
    v_org_path extensions.ltree;
    v_placement_id uuid := gen_random_uuid();
    v_ou_org_id uuid;
    v_ou_name text;
    v_result record;
    v_event_id uuid;
    v_processing_error text;
    v_has_existing_placement boolean;
    v_required_perm text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    SELECT EXISTS (
        SELECT 1 FROM client_placement_history_projection
        WHERE client_id = p_client_id AND is_current = true
    ) INTO v_has_existing_placement;

    v_required_perm := CASE
        WHEN v_has_existing_placement THEN 'client.transfer'
        ELSE 'client.create'
    END;

    IF NOT public.has_effective_permission(v_required_perm, v_org_path) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Missing permission: ' || v_required_perm);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    IF p_organization_unit_id IS NOT NULL THEN
        SELECT organization_id, COALESCE(display_name, name)
          INTO v_ou_org_id, v_ou_name
        FROM organization_units_projection
        WHERE id = p_organization_unit_id;

        IF v_ou_org_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Organizational unit not found');
        END IF;
        IF v_ou_org_id <> v_org_id THEN
            RETURN jsonb_build_object('success', false, 'error', 'Organizational unit does not belong to caller organization');
        END IF;
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id := p_client_id,
        p_stream_type := 'client',
        p_event_type := 'client.placement.changed',
        p_event_data := jsonb_build_object(
            'placement_id', v_placement_id,
            'organization_id', v_org_id,
            'placement_arrangement', p_placement_arrangement,
            'start_date', p_start_date,
            'reason', p_reason_text,
            'organization_unit_id', p_organization_unit_id
        ),
        p_event_metadata := COALESCE(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    -- Existing read-back broadened from PR #27 review (handles same-day correction path)
    SELECT id, placement_arrangement, organization_unit_id INTO v_result
    FROM client_placement_history_projection
    WHERE client_id = p_client_id
      AND start_date = p_start_date
      AND is_current = true;

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

    RETURN jsonb_build_object(
        'success', true,
        'placement_id', v_result.id,
        'organization_unit_id', v_result.organization_unit_id,
        'organization_unit_name', v_ou_name
    );
END;
$$;

-- 5c. api.update_organization_unit -------------------------------------------
-- This RPC uses raw INSERT INTO domain_events (manual stream_version) and
-- already captures v_event_id := gen_random_uuid(). Just adding the v2 check.
CREATE OR REPLACE FUNCTION api.update_organization_unit(
    p_unit_id uuid,
    p_name text DEFAULT NULL,
    p_display_name text DEFAULT NULL,
    p_timezone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_scope_path extensions.ltree;
    v_existing record;
    v_event_id uuid;
    v_stream_version integer;
    v_updated_fields text[];
    v_previous_values jsonb;
    v_result record;
    v_processing_error text;
BEGIN
    v_scope_path := get_permission_scope('organization.update_ou');

    IF v_scope_path IS NULL THEN
        RAISE EXCEPTION 'Missing permission: organization.update_ou'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_existing
    FROM organization_units_projection ou
    WHERE ou.id = p_unit_id
      AND ou.deleted_at IS NULL
      AND v_scope_path @> ou.path;

    IF v_existing IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Organizational unit not found',
            'errorDetails', jsonb_build_object(
                'code', 'NOT_FOUND',
                'message', 'Unit not found or outside your scope. Note: Root organizations use different update path.'
            )
        );
    END IF;

    v_updated_fields := ARRAY[]::text[];
    v_previous_values := '{}'::jsonb;

    IF p_name IS NOT NULL AND p_name != v_existing.name THEN
        v_updated_fields := array_append(v_updated_fields, 'name');
        v_previous_values := v_previous_values || jsonb_build_object('name', v_existing.name);
    END IF;

    IF p_display_name IS NOT NULL AND p_display_name != v_existing.display_name THEN
        v_updated_fields := array_append(v_updated_fields, 'display_name');
        v_previous_values := v_previous_values || jsonb_build_object('display_name', v_existing.display_name);
    END IF;

    IF p_timezone IS NOT NULL AND p_timezone != v_existing.timezone THEN
        v_updated_fields := array_append(v_updated_fields, 'timezone');
        v_previous_values := v_previous_values || jsonb_build_object('timezone', v_existing.timezone);
    END IF;

    IF array_length(v_updated_fields, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'unit', jsonb_build_object(
                'id', v_existing.id,
                'name', v_existing.name,
                'displayName', v_existing.display_name,
                'path', v_existing.path::text,
                'parentPath', v_existing.parent_path::text,
                'timeZone', v_existing.timezone,
                'isActive', v_existing.is_active,
                'isRootOrganization', false,
                'createdAt', v_existing.created_at,
                'updatedAt', v_existing.updated_at
            )
        );
    END IF;

    v_event_id := gen_random_uuid();

    SELECT COALESCE(MAX(stream_version), 0) + 1 INTO v_stream_version
    FROM domain_events
    WHERE stream_id = p_unit_id AND stream_type = 'organization_unit';

    INSERT INTO domain_events (
        id, stream_id, stream_type, stream_version,
        event_type, event_data, event_metadata
    ) VALUES (
        v_event_id,
        p_unit_id,
        'organization_unit',
        v_stream_version,
        'organization_unit.updated',
        jsonb_build_object(
            'organization_unit_id', p_unit_id,
            'name', COALESCE(p_name, v_existing.name),
            'display_name', COALESCE(p_display_name, v_existing.display_name),
            'timezone', COALESCE(p_timezone, v_existing.timezone),
            'updatable_fields', to_jsonb(v_updated_fields),
            'previous_values', v_previous_values
        ),
        jsonb_build_object(
            'user_id', get_current_user_id(),
            'source', 'api.update_organization_unit',
            'timestamp', now()
        )
    );

    SELECT * INTO v_result
    FROM organization_units_projection
    WHERE id = p_unit_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Projection not found after event processing'),
            'errorDetails', jsonb_build_object(
                'code', 'PROCESSING_ERROR',
                'message', 'The event was recorded but the handler failed. Check domain_events for details.'
            )
        );
    END IF;

    -- Pattern A v2 race-safe check
    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'errorDetails', jsonb_build_object(
                'code', 'PROCESSING_ERROR',
                'message', 'The event was recorded but the handler failed. Check domain_events for details.'
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'unit', jsonb_build_object(
            'id', v_result.id,
            'name', v_result.name,
            'displayName', v_result.display_name,
            'path', v_result.path::text,
            'parentPath', v_result.parent_path::text,
            'timeZone', v_result.timezone,
            'isActive', v_result.is_active,
            'isRootOrganization', false,
            'createdAt', v_result.created_at,
            'updatedAt', v_result.updated_at
        )
    );
END;
$$;

-- 5d. api.update_organization ------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization(
    p_org_id uuid,
    p_data jsonb,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id uuid := get_current_user_id();
    v_org_id uuid := get_current_org_id();
    v_org record;
    v_event_data jsonb;
    v_result record;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    SELECT * INTO v_org
    FROM organizations_projection
    WHERE id = p_org_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
    END IF;

    IF NOT has_platform_privilege() THEN
        IF NOT has_effective_permission('organization.update', v_org.path) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
        END IF;
        p_data := p_data - 'name';
    END IF;

    v_event_data := '{}'::jsonb;
    IF p_data ? 'name' THEN v_event_data := v_event_data || jsonb_build_object('name', p_data->>'name'); END IF;
    IF p_data ? 'display_name' THEN v_event_data := v_event_data || jsonb_build_object('display_name', p_data->>'display_name'); END IF;
    IF p_data ? 'tax_number' THEN v_event_data := v_event_data || jsonb_build_object('tax_number', p_data->>'tax_number'); END IF;
    IF p_data ? 'phone_number' THEN v_event_data := v_event_data || jsonb_build_object('phone_number', p_data->>'phone_number'); END IF;
    IF p_data ? 'timezone' THEN v_event_data := v_event_data || jsonb_build_object('timezone', p_data->>'timezone'); END IF;

    IF v_event_data = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'error', 'No updatable fields provided');
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id      := p_org_id,
        p_stream_type    := 'organization',
        p_event_type     := 'organization.updated',
        p_event_data     := v_event_data,
        p_event_metadata := jsonb_build_object(
            'user_id', v_user_id,
            'organization_id', COALESCE(v_org_id, p_org_id)
        ) || CASE WHEN p_reason IS NOT NULL
             THEN jsonb_build_object('reason', p_reason)
             ELSE '{}'::jsonb END
    );

    SELECT * INTO v_result FROM organizations_projection WHERE id = p_org_id;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false, 'error',
            COALESCE(v_processing_error, 'Organization not found after event processing'));
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'organization', jsonb_build_object(
            'id', v_result.id, 'name', v_result.name, 'display_name', v_result.display_name,
            'tax_number', v_result.tax_number, 'phone_number', v_result.phone_number,
            'timezone', v_result.timezone, 'updated_at', v_result.updated_at
        )
    );
END;
$$;

-- 5e. api.update_organization_address ----------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_address(p_address_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id uuid := get_current_user_id();
    v_address record;
    v_org record;
    v_result record;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    SELECT * INTO v_address FROM addresses_projection WHERE id = p_address_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Address not found'); END IF;

    SELECT * INTO v_org FROM organizations_projection WHERE id = v_address.organization_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

    IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id := p_address_id, p_stream_type := 'address', p_event_type := 'address.updated',
        p_event_data := p_data,
        p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_address.organization_id)
    );

    SELECT * INTO v_result FROM addresses_projection WHERE id = p_address_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Address update failed'));
    END IF;

    SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object('success', true, 'address', jsonb_build_object(
        'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
        'street1', v_result.street1, 'city', v_result.city, 'state', v_result.state,
        'zip_code', v_result.zip_code, 'updated_at', v_result.updated_at
    ));
END;
$$;

-- 5f. api.update_organization_contact ----------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_contact(p_contact_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id uuid := get_current_user_id();
    v_contact record;
    v_org record;
    v_result record;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    SELECT * INTO v_contact FROM contacts_projection WHERE id = p_contact_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Contact not found'); END IF;

    SELECT * INTO v_org FROM organizations_projection WHERE id = v_contact.organization_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

    IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id := p_contact_id, p_stream_type := 'contact', p_event_type := 'contact.updated',
        p_event_data := p_data,
        p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_contact.organization_id)
    );

    SELECT * INTO v_result FROM contacts_projection WHERE id = p_contact_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Contact update failed'));
    END IF;

    SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object('success', true, 'contact', jsonb_build_object(
        'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
        'first_name', v_result.first_name, 'last_name', v_result.last_name,
        'email', v_result.email, 'updated_at', v_result.updated_at
    ));
END;
$$;

-- 5g. api.update_organization_phone ------------------------------------------
CREATE OR REPLACE FUNCTION api.update_organization_phone(p_phone_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
    v_user_id uuid := get_current_user_id();
    v_phone record;
    v_org record;
    v_result record;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    SELECT * INTO v_phone FROM phones_projection WHERE id = p_phone_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Phone not found'); END IF;

    SELECT * INTO v_org FROM organizations_projection WHERE id = v_phone.organization_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

    IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id := p_phone_id, p_stream_type := 'phone', p_event_type := 'phone.updated',
        p_event_data := p_data,
        p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_phone.organization_id)
    );

    SELECT * INTO v_result FROM phones_projection WHERE id = p_phone_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Phone update failed'));
    END IF;

    SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || v_processing_error);
    END IF;

    RETURN jsonb_build_object('success', true, 'phone', jsonb_build_object(
        'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
        'number', v_result.number, 'extension', v_result.extension,
        'is_primary', v_result.is_primary, 'updated_at', v_result.updated_at
    ));
END;
$$;

-- 5h. api.update_field_definition --------------------------------------------
CREATE OR REPLACE FUNCTION api.update_field_definition(
    p_field_id uuid,
    p_display_name text DEFAULT NULL,
    p_category_id uuid DEFAULT NULL,
    p_field_type text DEFAULT NULL,
    p_is_visible boolean DEFAULT NULL,
    p_is_required boolean DEFAULT NULL,
    p_is_dimension boolean DEFAULT NULL,
    p_sort_order integer DEFAULT NULL,
    p_validation_rules jsonb DEFAULT NULL,
    p_configurable_label text DEFAULT NULL,
    p_conforming_dimension_mapping text DEFAULT NULL,
    p_reason text DEFAULT 'Field definition updated',
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
    v_existing record;
    v_changes jsonb;
    v_result record;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    SELECT id INTO v_existing
    FROM client_field_definitions_projection
    WHERE id = p_field_id AND organization_id = v_org_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Field definition not found');
    END IF;

    v_changes := jsonb_build_object('field_id', p_field_id, 'organization_id', v_org_id);

    IF p_display_name IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('display_name', p_display_name); END IF;
    IF p_category_id IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('category_id', p_category_id); END IF;
    IF p_field_type IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('field_type', p_field_type); END IF;
    IF p_is_visible IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('is_visible', p_is_visible); END IF;
    IF p_is_required IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('is_required', p_is_required); END IF;
    IF p_is_dimension IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('is_dimension', p_is_dimension); END IF;
    IF p_sort_order IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('sort_order', p_sort_order); END IF;
    IF p_validation_rules IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('validation_rules', p_validation_rules); END IF;
    IF p_configurable_label IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('configurable_label', p_configurable_label); END IF;
    IF p_conforming_dimension_mapping IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('conforming_dimension_mapping', p_conforming_dimension_mapping); END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id   := p_field_id,
        p_stream_type := 'client_field_definition',
        p_event_type  := 'client_field_definition.updated',
        p_event_data  := v_changes,
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    SELECT id INTO v_result
    FROM client_field_definitions_projection
    WHERE id = p_field_id AND organization_id = v_org_id AND is_active = true;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'field_id', p_field_id
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'field_id', p_field_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'field_id', p_field_id);
END;
$$;

-- 5i. api.update_field_category ----------------------------------------------
CREATE OR REPLACE FUNCTION api.update_field_category(
    p_category_id uuid,
    p_name text DEFAULT NULL,
    p_sort_order integer DEFAULT NULL,
    p_reason text DEFAULT 'Category updated',
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
    v_changes jsonb;
    v_result record;
    v_event_id uuid;
    v_processing_error text;
BEGIN
    v_org_id := public.get_current_org_id();

    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;
    IF NOT public.has_effective_permission('organization.update', v_org_path) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Missing permission: organization.update');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM client_field_categories
        WHERE id = p_category_id AND organization_id = v_org_id AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category not found, is a system category, or already inactive');
    END IF;

    v_changes := jsonb_build_object('category_id', p_category_id, 'organization_id', v_org_id);
    IF p_name IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('name', p_name); END IF;
    IF p_sort_order IS NOT NULL THEN v_changes := v_changes || jsonb_build_object('sort_order', p_sort_order); END IF;

    v_event_id := api.emit_domain_event(
        p_stream_id   := p_category_id,
        p_stream_type := 'client_field_category',
        p_event_type  := 'client_field_category.updated',
        p_event_data  := v_changes,
        p_event_metadata := jsonb_build_object(
            'user_id', auth.uid(),
            'organization_id', v_org_id,
            'reason', p_reason,
            'correlation_id', COALESCE(p_correlation_id, gen_random_uuid())
        )
    );

    SELECT id INTO v_result
    FROM client_field_categories
    WHERE id = p_category_id AND organization_id = v_org_id AND is_active = true;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error', COALESCE(v_processing_error, 'Event handler failed'),
            'category_id', p_category_id
        );
    END IF;

    SELECT processing_error INTO v_processing_error
    FROM domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || v_processing_error,
            'category_id', p_category_id
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'category_id', p_category_id);
END;
$$;


-- =============================================================================
-- VERIFICATION (run via MCP execute_sql or psql after apply):
--
-- 1. All 20 retrofitted RPCs contain v_event_id capture + post-emit check:
--    SELECT proname,
--           pg_get_functiondef(oid)::text LIKE '%v_event_id := api.emit_domain_event(%' OR
--           pg_get_functiondef(oid)::text LIKE '%v_event_id := gen_random_uuid()%' OR
--           pg_get_functiondef(oid)::text LIKE '%RETURNING id INTO v_event_id%'
--      AS has_v_event_id_capture
--    FROM pg_proc
--    WHERE pronamespace='api'::regnamespace
--      AND proname IN (
--        'update_client_address', 'update_client_email',
--        'update_client_funding_source', 'update_client_insurance', 'update_client_phone',
--        'update_organization_direct_care_settings', 'update_user',
--        'update_user_phone', 'update_user_notification_preferences',
--        'update_schedule_template',
--        'update_client', 'change_client_placement', 'update_organization_unit',
--        'update_organization', 'update_organization_address',
--        'update_organization_contact', 'update_organization_phone',
--        'update_field_definition', 'update_field_category'
--      );
--    Expect: 20 rows (update_organization_direct_care_settings has 2 overloads), all has_v_event_id_capture=t
--
-- 2. update_role intentionally NOT in v2 (uses COMPLEX-CASE 5-second-window check):
--    SELECT pg_get_functiondef(oid)::text LIKE '%5 seconds%'
--    FROM pg_proc WHERE proname='update_role' AND pronamespace='api'::regnamespace;
--    Expect: t (unchanged)
--
-- 3. No new failed events from this migration apply:
--    SELECT COUNT(*), event_type FROM domain_events
--    WHERE event_type IN (
--      'client.address.updated', 'client.email.updated', 'client.funding_source.updated',
--      'client.insurance.updated', 'client.phone.updated',
--      'client.information_updated', 'client.placement.changed',
--      'organization.updated', 'address.updated', 'contact.updated',
--      'phone.updated', 'organization_unit.updated',
--      'organization.direct_care_settings_updated',
--      'client_field_category.updated', 'client_field_definition.updated',
--      'user.profile.updated', 'user.phone.updated', 'user.notification_preferences.updated',
--      'schedule.updated'
--    ) AND processing_error IS NOT NULL
--      AND created_at > now() - INTERVAL '5 minutes'
--    GROUP BY event_type;
--    Expect: 0 rows
-- =============================================================================
