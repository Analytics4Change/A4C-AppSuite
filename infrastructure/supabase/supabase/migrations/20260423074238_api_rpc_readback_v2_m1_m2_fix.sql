-- =============================================================================
-- Migration: api_rpc_readback_v2_m1_m2_fix
-- =============================================================================
-- Purpose: Address PR #30 review findings M1 + M2 on Pattern A v2 read-back.
--
-- M1 — 6 RPCs used a race-prone `ORDER BY created_at DESC LIMIT 1` inside the
--      IF NOT FOUND branch of their read-back guard, despite `v_event_id` being
--      captured in scope. This migration replaces that query with a race-safe
--      PK lookup `WHERE id = v_event_id` so the IF NOT FOUND and post-emit
--      branches are consistent in all 20 v2 RPCs. See architect report
--      (software-architect-dbc agent ad2e78383cd378c9f, 2026-04-23).
--
--      Affected RPCs:
--        - api.update_client_address
--        - api.update_client_email
--        - api.update_client_funding_source
--        - api.update_client_insurance
--        - api.update_client_phone
--        - api.update_client  (proof-of-pattern, migration 20260422052825)
--
-- M2 — api.update_role uses a 5-second wall-clock window to detect
--      processing_error among its multi-event emits (1 role.updated + N
--      role.permission.granted + M role.permission.revoked). The arbitrary
--      threshold risks:
--        (a) missing errors if handler processing exceeds 5 seconds;
--        (b) surfacing an unrelated concurrent op's error on the same role.
--      This migration switches to captured-event-id semantics: each emit's
--      uuid is appended to a `v_event_ids uuid[]` array, and the error lookup
--      uses `WHERE id = ANY(v_event_ids) AND processing_error IS NOT NULL` —
--      race-safe PK scan, correctly scoped to this RPC's events only. Works
--      correctly for the empty-emit no-op case (ANY('{}') matches no rows).
--
-- Contract unchanged: RPCs still return `{success, <entity>, ...}` on success
-- and `{success: false, error: 'Event processing failed: ...'}` on handler
-- failure. NEVER `RAISE EXCEPTION` here — see
-- documentation/architecture/decisions/adr-rpc-readback-pattern.md Decision 2.
--
-- Idempotency: all definitions use CREATE OR REPLACE FUNCTION.
-- =============================================================================


-- =============================================================================
-- M1: 6 RPCs — race-safe IF NOT FOUND fallback via captured v_event_id
-- =============================================================================

-- M1.1 api.update_client_address ---------------------------------------------
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
        -- M1 fix: race-safe PK lookup on captured event_id
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

    RETURN jsonb_build_object('success', true, 'address_id', p_address_id, 'address', row_to_json(v_row)::jsonb);
END;
$$;


-- M1.2 api.update_client_email ------------------------------------------------
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
        -- M1 fix: race-safe PK lookup on captured event_id
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

    RETURN jsonb_build_object('success', true, 'email_id', p_email_id, 'email', row_to_json(v_row)::jsonb);
END;
$$;


-- M1.3 api.update_client_funding_source ---------------------------------------
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
        -- M1 fix: race-safe PK lookup on captured event_id
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

    RETURN jsonb_build_object('success', true, 'funding_source_id', p_funding_source_id, 'funding_source', row_to_json(v_row)::jsonb);
END;
$$;


-- M1.4 api.update_client_insurance --------------------------------------------
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
        -- M1 fix: race-safe PK lookup on captured event_id
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

    RETURN jsonb_build_object('success', true, 'policy_id', p_policy_id, 'policy', row_to_json(v_row)::jsonb);
END;
$$;


-- M1.5 api.update_client_phone ------------------------------------------------
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
        -- M1 fix: race-safe PK lookup on captured event_id
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

    RETURN jsonb_build_object('success', true, 'phone_id', p_phone_id, 'phone', row_to_json(v_row)::jsonb);
END;
$$;


-- M1.6 api.update_client (proof-of-pattern) -----------------------------------
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
        -- M1 fix: race-safe PK lookup on captured event_id
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
        'client_id', p_client_id,
        'client', row_to_json(v_row)::jsonb
    );
END;
$$;


-- =============================================================================
-- M2: api.update_role — captured-event-id multi-event check (COMPLEX-CASE)
-- =============================================================================
-- Replaces the 5-second wall-clock window with a uuid[] of captured event_ids.
-- Correctly scoped to this RPC's emits; race-safe on concurrent role edits.
-- Empty v_event_ids (no-op update — caller passed current name/desc/perms) →
-- ANY('{}') matches no rows → v_processing_error IS NULL → {success: true}.
-- =============================================================================

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
    v_event_ids uuid[] := '{}';  -- M2: capture every emit's id for race-safe PK check
BEGIN
    v_user_id := public.get_current_user_id();
    v_org_id := public.get_current_org_id();

    -- Caller-driven validation (pre-emit) — unchanged
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
        v_event_ids := array_append(v_event_ids, api.emit_domain_event(
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
        ));
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
            v_event_ids := array_append(v_event_ids, api.emit_domain_event(
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
            ));
        END LOOP;

        FOREACH v_perm_id IN ARRAY v_to_revoke
        LOOP
            SELECT name INTO v_perm_name FROM permissions_projection WHERE id = v_perm_id;
            v_event_ids := array_append(v_event_ids, api.emit_domain_event(
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
            ));
        END LOOP;
    END IF;

    -- Pattern A COMPLEX-CASE read-back: compose role row + permission_ids array
    SELECT * INTO v_row FROM roles_projection WHERE id = p_role_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        -- M2 fix: race-safe — lookup failure among THIS RPC's emitted events only
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE id = ANY(v_event_ids) AND processing_error IS NOT NULL
        ORDER BY created_at DESC LIMIT 1;
        RETURN jsonb_build_object('success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
    END IF;

    SELECT array_agg(permission_id ORDER BY permission_id) INTO v_perm_ids_after
    FROM role_permissions_projection WHERE role_id = p_role_id;
    v_perm_ids_after := COALESCE(v_perm_ids_after, '{}');

    -- M2 fix: replaces 5-second-window with captured-ID PK scan.
    -- Empty v_event_ids (no-op update) → no rows → v_processing_error IS NULL → success.
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE id = ANY(v_event_ids) AND processing_error IS NOT NULL
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
-- -- M1: no v2 RPC should still contain the race-prone query shape
-- SELECT proname FROM pg_proc
-- WHERE pronamespace='api'::regnamespace
--   AND proname IN ('update_client_address','update_client_email',
--                   'update_client_funding_source','update_client_insurance',
--                   'update_client_phone','update_client')
--   AND pg_get_functiondef(oid)::text LIKE '%ORDER BY created_at DESC LIMIT 1%';
-- -- Expect: 0 rows.
--
-- -- M2: update_role uses captured-id array, no time-window
-- SELECT
--     pg_get_functiondef(oid)::text LIKE '%ANY(v_event_ids)%' AS uses_captured_ids,
--     pg_get_functiondef(oid)::text NOT LIKE '%INTERVAL ''5 seconds''%' AS no_time_window
-- FROM pg_proc WHERE proname='update_role' AND pronamespace='api'::regnamespace;
-- -- Expect: both t.
-- =============================================================================
