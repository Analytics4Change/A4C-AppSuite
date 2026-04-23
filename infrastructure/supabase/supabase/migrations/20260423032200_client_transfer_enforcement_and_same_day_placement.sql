-- =============================================================================
-- Migration: client_transfer_enforcement_and_same_day_placement
-- Created: 2026-04-23
-- Purpose: Address two findings from the PR #27 code review of the
--          client-ou-edit feature (PR 1).
-- =============================================================================
--
-- Finding 1 (Major) — client.transfer enforcement gap:
--   Migration 20260422052825 seeded the `client.transfer` permission, added it
--   to the provider_admin role template, and backfilled active provider_admin
--   roles. However, api.change_client_placement still gates on `client.update`,
--   leaving the new permission unenforced. ADR Decision 2 (which makes
--   client.transfer the gating permission for placement changes) was not
--   load-bearing at the enforcement layer.
--
--   Fix: api.change_client_placement now performs an inferred permission check.
--   If a client has no `is_current = true` placement row, the check is treated
--   as a creation (`client.create`); otherwise it is a transfer
--   (`client.transfer`). The DB infers the action type from state, so a
--   malicious caller cannot bypass by claiming an intake context.
--
--   Intake flow: ClientIntakeFormViewModel.submit() calls
--   change_client_placement *after* register_client, so at that moment no
--   is_current row exists → resolves to `client.create`.
--   Edit flow (Phase 5a, future PR 2a): a placement row already exists →
--   resolves to `client.transfer`.
--
-- Finding 2 (Minor) — Same-day placement constraint risk:
--   client_placement_history_projection has UNIQUE (client_id, start_date)
--   (added by 20260408000351), but handle_client_placement_changed's
--   ON CONFLICT clause only targets the pkey. Two placement changes for the
--   same client on the same day (e.g. an admin correcting an OU pick within
--   minutes of intake) would surface as an unhandled constraint violation →
--   processing_error on the event.
--
--   Fix: handle_client_placement_changed branches on start_date inside the
--   FOR UPDATE lock. If the locked is_current row's start_date matches the
--   incoming event's start_date, it updates that row in place (correction
--   semantics). Otherwise it follows the existing close-then-insert path.
--
--   The RPC's read-back guard is broadened from `WHERE id = v_placement_id`
--   to `WHERE client_id = p_client_id AND start_date = p_start_date AND
--   is_current = true` so it correctly resolves both the new-row and
--   same-day-correction paths.
--
-- Idempotency:
--   * Both functions use CREATE OR REPLACE with the same signatures shipped
--     by 20260422052825 (no DROP FUNCTION required).
--   * GRANT EXECUTE re-issued for safety; idempotent.
--
-- Cross-reference:
--   * ADR documentation/architecture/decisions/adr-client-ou-placement.md
--     Decision 2 (enforcement section appended) and Decision 6 (new).
--   * PR #27 review comment by lars-tice (2026-04-23 03:07 UTC).
-- =============================================================================

-- =============================================================================
-- 1. api.change_client_placement — inferred permission + broadened read-back
-- =============================================================================

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
    v_processing_error text;
    v_has_existing_placement boolean;
    v_required_perm text;
BEGIN
    v_org_id := public.get_current_org_id();
    SELECT path INTO v_org_path FROM organizations_projection WHERE id = v_org_id;

    -- Inferred permission check: first placement = client.create, else client.transfer.
    -- DB-side inference prevents callers from spoofing an intake context.
    SELECT EXISTS (
        SELECT 1 FROM client_placement_history_projection
        WHERE client_id = p_client_id AND is_current = true
    ) INTO v_has_existing_placement;

    v_required_perm := CASE
        WHEN v_has_existing_placement THEN 'client.transfer'
        ELSE 'client.create'
    END;

    IF NOT public.has_effective_permission(v_required_perm, v_org_path) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Missing permission: ' || v_required_perm
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM clients_projection WHERE id = p_client_id AND organization_id = v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Client not found');
    END IF;

    -- Validate OU (if supplied) belongs to caller's organization
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

    PERFORM api.emit_domain_event(
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

    -- Read-back guard: locate the current placement row for this client+date.
    -- Broadened from `id = v_placement_id` so the same-day-correction path
    -- (which updates the existing row in place rather than inserting v_placement_id)
    -- still resolves cleanly.
    SELECT id, placement_arrangement, organization_unit_id INTO v_result
    FROM client_placement_history_projection
    WHERE client_id = p_client_id
      AND start_date = p_start_date
      AND is_current = true;

    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM domain_events
        WHERE stream_id = p_client_id AND event_type = 'client.placement.changed'
        ORDER BY created_at DESC LIMIT 1;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown')
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'placement_id', v_result.id,
        'organization_unit_id', v_result.organization_unit_id,
        'organization_unit_name', v_ou_name
    );
END;
$$;

GRANT EXECUTE ON FUNCTION api.change_client_placement(uuid, text, date, text, text, jsonb, uuid, uuid) TO authenticated, service_role;

-- =============================================================================
-- 2. handle_client_placement_changed — same-day in-place branch
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_placement_changed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_client_id uuid;
    v_org_id uuid;
    v_new_placement text;
    v_start_date date;
    v_new_ou_id uuid;
    v_current_placement_id uuid;
    v_current_start_date date;
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_new_placement := p_event.event_data->>'placement_arrangement';
    v_start_date := (p_event.event_data->>'start_date')::date;

    -- OU is optional on the event (historical events have no OU); cast is nullable-safe
    v_new_ou_id := NULLIF(p_event.event_data->>'organization_unit_id', '')::uuid;

    -- C4: Lock the existing current placement row (if any) before the transition.
    -- Concurrent placement events for the same client serialize here.
    SELECT id, start_date INTO v_current_placement_id, v_current_start_date
    FROM client_placement_history_projection
    WHERE client_id = v_client_id
      AND organization_id = v_org_id
      AND is_current = true
    FOR UPDATE;

    IF v_current_placement_id IS NOT NULL AND v_current_start_date = v_start_date THEN
        -- Same-day correction: update the existing current row in place.
        -- Avoids the UNIQUE (client_id, start_date) violation that the
        -- close-then-insert path would otherwise trigger when the new row
        -- carries the same start_date as the prior current row.
        -- Semantic: an admin re-selecting an OU within minutes of intake is
        -- correcting a placement, not stacking a new history entry.
        UPDATE client_placement_history_projection SET
            placement_arrangement = v_new_placement,
            organization_unit_id  = v_new_ou_id,
            reason                = p_event.event_data->>'reason',
            updated_at            = p_event.created_at,
            last_event_id         = p_event.id
        WHERE id = v_current_placement_id;
    ELSE
        -- Different day OR first placement: existing close-then-insert flow.
        IF v_current_placement_id IS NOT NULL THEN
            UPDATE client_placement_history_projection SET
                is_current = false,
                end_date = v_start_date,
                updated_at = p_event.created_at,
                last_event_id = p_event.id
            WHERE id = v_current_placement_id;
        END IF;

        -- Insert new current placement (includes OU)
        INSERT INTO client_placement_history_projection (
            id, client_id, organization_id, placement_arrangement, start_date,
            is_current, reason, organization_unit_id,
            created_at, updated_at, last_event_id
        ) VALUES (
            (p_event.event_data->>'placement_id')::uuid,
            v_client_id,
            v_org_id,
            v_new_placement,
            v_start_date,
            true,
            p_event.event_data->>'reason',
            v_new_ou_id,
            p_event.created_at,
            p_event.created_at,
            p_event.id
        ) ON CONFLICT ON CONSTRAINT client_placement_history_projection_pkey DO UPDATE SET
            placement_arrangement = EXCLUDED.placement_arrangement,
            start_date = EXCLUDED.start_date,
            is_current = true,
            reason = EXCLUDED.reason,
            organization_unit_id = EXCLUDED.organization_unit_id,
            updated_at = EXCLUDED.updated_at,
            last_event_id = EXCLUDED.last_event_id;
    END IF;

    -- Denormalize current placement + OU onto clients_projection (unchanged).
    -- This is the SOLE mutation path for clients_projection.organization_unit_id
    -- after client creation (C3).
    UPDATE clients_projection SET
        placement_arrangement = v_new_placement,
        organization_unit_id  = v_new_ou_id,
        updated_at            = p_event.created_at,
        last_event_id         = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;

-- =============================================================================
-- 3. Verification (run via MCP execute_sql or psql after apply)
-- =============================================================================
-- Permission inference present:
--   SELECT pg_get_functiondef(oid)::text LIKE '%v_required_perm := CASE WHEN v_has_existing_placement%' AS check_present
--   FROM pg_proc WHERE proname='change_client_placement' AND pronamespace='api'::regnamespace;
--   Expect: t
--
-- Same-day branch present:
--   SELECT pg_get_functiondef(oid)::text LIKE '%v_current_start_date = v_start_date%' AS branch_present
--   FROM pg_proc WHERE proname='handle_client_placement_changed';
--   Expect: t
--
-- Read-back broadened:
--   SELECT pg_get_functiondef(oid)::text LIKE '%WHERE client_id = p_client_id%AND start_date = p_start_date%AND is_current = true%' AS readback_broadened
--   FROM pg_proc WHERE proname='change_client_placement' AND pronamespace='api'::regnamespace;
--   Expect: t
--
-- No failed events post-deploy:
--   SELECT COUNT(*) FROM domain_events
--   WHERE event_type = 'client.placement.changed' AND processing_error IS NOT NULL;
--   Expect: 0
