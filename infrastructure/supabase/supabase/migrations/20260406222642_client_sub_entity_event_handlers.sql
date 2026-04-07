-- Migration: client_sub_entity_event_handlers
-- Extends process_client_event() router with 19 sub-entity CASE branches.
-- Creates 19 handlers for phone/email/address/insurance/placement/funding/contact_assignment.
-- Pattern: handle_client_field_definition_created (20260327211210)

-- =============================================================================
-- 1. Extended router: process_client_event() — now 23 CASE branches total
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_client_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type

        -- Lifecycle events (from B2a-1)
        WHEN 'client.registered' THEN
            PERFORM handle_client_registered(p_event);

        WHEN 'client.information_updated' THEN
            PERFORM handle_client_information_updated(p_event);

        WHEN 'client.admitted' THEN
            PERFORM handle_client_admitted(p_event);

        WHEN 'client.discharged' THEN
            PERFORM handle_client_discharged(p_event);

        -- Phone sub-entity
        WHEN 'client.phone.added' THEN
            PERFORM handle_client_phone_added(p_event);

        WHEN 'client.phone.updated' THEN
            PERFORM handle_client_phone_updated(p_event);

        WHEN 'client.phone.removed' THEN
            PERFORM handle_client_phone_removed(p_event);

        -- Email sub-entity
        WHEN 'client.email.added' THEN
            PERFORM handle_client_email_added(p_event);

        WHEN 'client.email.updated' THEN
            PERFORM handle_client_email_updated(p_event);

        WHEN 'client.email.removed' THEN
            PERFORM handle_client_email_removed(p_event);

        -- Address sub-entity
        WHEN 'client.address.added' THEN
            PERFORM handle_client_address_added(p_event);

        WHEN 'client.address.updated' THEN
            PERFORM handle_client_address_updated(p_event);

        WHEN 'client.address.removed' THEN
            PERFORM handle_client_address_removed(p_event);

        -- Insurance sub-entity
        WHEN 'client.insurance.added' THEN
            PERFORM handle_client_insurance_added(p_event);

        WHEN 'client.insurance.updated' THEN
            PERFORM handle_client_insurance_updated(p_event);

        WHEN 'client.insurance.removed' THEN
            PERFORM handle_client_insurance_removed(p_event);

        -- Placement sub-entity
        WHEN 'client.placement.changed' THEN
            PERFORM handle_client_placement_changed(p_event);

        WHEN 'client.placement.ended' THEN
            PERFORM handle_client_placement_ended(p_event);

        -- Funding source sub-entity
        WHEN 'client.funding_source.added' THEN
            PERFORM handle_client_funding_source_added(p_event);

        WHEN 'client.funding_source.updated' THEN
            PERFORM handle_client_funding_source_updated(p_event);

        WHEN 'client.funding_source.removed' THEN
            PERFORM handle_client_funding_source_removed(p_event);

        -- Contact assignment
        WHEN 'client.contact.assigned' THEN
            PERFORM handle_client_contact_assigned(p_event);

        WHEN 'client.contact.unassigned' THEN
            PERFORM handle_client_contact_unassigned(p_event);

        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_client_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;

-- =============================================================================
-- 2. Phone handlers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_phone_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_phones_projection (
        id, client_id, organization_id, phone_number, phone_type, is_primary,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'phone_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'phone_number',
        COALESCE(p_event.event_data->>'phone_type', 'mobile'),
        COALESCE((p_event.event_data->>'is_primary')::boolean, false),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, phone_number) DO UPDATE SET
        phone_type = EXCLUDED.phone_type,
        is_primary = EXCLUDED.is_primary,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_phone_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_phones_projection SET
        phone_number = COALESCE(p_event.event_data->>'phone_number', phone_number),
        phone_type = COALESCE(p_event.event_data->>'phone_type', phone_type),
        is_primary = CASE WHEN p_event.event_data ? 'is_primary' THEN (p_event.event_data->>'is_primary')::boolean ELSE is_primary END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'phone_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_phone_removed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_phones_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'phone_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

-- =============================================================================
-- 3. Email handlers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_email_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_emails_projection (
        id, client_id, organization_id, email, email_type, is_primary,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'email_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'email',
        COALESCE(p_event.event_data->>'email_type', 'personal'),
        COALESCE((p_event.event_data->>'is_primary')::boolean, false),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, email) DO UPDATE SET
        email_type = EXCLUDED.email_type,
        is_primary = EXCLUDED.is_primary,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_email_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_emails_projection SET
        email = COALESCE(p_event.event_data->>'email', email),
        email_type = COALESCE(p_event.event_data->>'email_type', email_type),
        is_primary = CASE WHEN p_event.event_data ? 'is_primary' THEN (p_event.event_data->>'is_primary')::boolean ELSE is_primary END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'email_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_email_removed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_emails_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'email_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

-- =============================================================================
-- 4. Address handlers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_address_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_addresses_projection (
        id, client_id, organization_id, address_type, street1, street2,
        city, state, zip, country, is_primary,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'address_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        COALESCE(p_event.event_data->>'address_type', 'home'),
        p_event.event_data->>'street1',
        p_event.event_data->>'street2',
        p_event.event_data->>'city',
        p_event.event_data->>'state',
        p_event.event_data->>'zip',
        COALESCE(p_event.event_data->>'country', 'US'),
        COALESCE((p_event.event_data->>'is_primary')::boolean, false),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, address_type) DO UPDATE SET
        street1 = EXCLUDED.street1,
        street2 = EXCLUDED.street2,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        country = EXCLUDED.country,
        is_primary = EXCLUDED.is_primary,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_address_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_addresses_projection SET
        address_type = COALESCE(p_event.event_data->>'address_type', address_type),
        street1 = COALESCE(p_event.event_data->>'street1', street1),
        street2 = CASE WHEN p_event.event_data ? 'street2' THEN p_event.event_data->>'street2' ELSE street2 END,
        city = COALESCE(p_event.event_data->>'city', city),
        state = COALESCE(p_event.event_data->>'state', state),
        zip = COALESCE(p_event.event_data->>'zip', zip),
        country = COALESCE(p_event.event_data->>'country', country),
        is_primary = CASE WHEN p_event.event_data ? 'is_primary' THEN (p_event.event_data->>'is_primary')::boolean ELSE is_primary END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'address_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_address_removed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_addresses_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'address_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

-- =============================================================================
-- 5. Insurance handlers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_insurance_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_insurance_policies_projection (
        id, client_id, organization_id, policy_type, payer_name, policy_number,
        group_number, subscriber_name, subscriber_relation,
        coverage_start_date, coverage_end_date,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'policy_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'policy_type',
        p_event.event_data->>'payer_name',
        p_event.event_data->>'policy_number',
        p_event.event_data->>'group_number',
        p_event.event_data->>'subscriber_name',
        p_event.event_data->>'subscriber_relation',
        (p_event.event_data->>'coverage_start_date')::date,
        (p_event.event_data->>'coverage_end_date')::date,
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, policy_type) DO UPDATE SET
        payer_name = EXCLUDED.payer_name,
        policy_number = EXCLUDED.policy_number,
        group_number = EXCLUDED.group_number,
        subscriber_name = EXCLUDED.subscriber_name,
        subscriber_relation = EXCLUDED.subscriber_relation,
        coverage_start_date = EXCLUDED.coverage_start_date,
        coverage_end_date = EXCLUDED.coverage_end_date,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_insurance_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_insurance_policies_projection SET
        payer_name = COALESCE(p_event.event_data->>'payer_name', payer_name),
        policy_number = CASE WHEN p_event.event_data ? 'policy_number' THEN p_event.event_data->>'policy_number' ELSE policy_number END,
        group_number = CASE WHEN p_event.event_data ? 'group_number' THEN p_event.event_data->>'group_number' ELSE group_number END,
        subscriber_name = CASE WHEN p_event.event_data ? 'subscriber_name' THEN p_event.event_data->>'subscriber_name' ELSE subscriber_name END,
        subscriber_relation = CASE WHEN p_event.event_data ? 'subscriber_relation' THEN p_event.event_data->>'subscriber_relation' ELSE subscriber_relation END,
        coverage_start_date = CASE WHEN p_event.event_data ? 'coverage_start_date' THEN (p_event.event_data->>'coverage_start_date')::date ELSE coverage_start_date END,
        coverage_end_date = CASE WHEN p_event.event_data ? 'coverage_end_date' THEN (p_event.event_data->>'coverage_end_date')::date ELSE coverage_end_date END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'policy_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_insurance_removed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_insurance_policies_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'policy_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

-- =============================================================================
-- 6. Placement handlers (Decision 83)
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
BEGIN
    v_client_id := p_event.stream_id;
    v_org_id := (p_event.event_data->>'organization_id')::uuid;
    v_new_placement := p_event.event_data->>'placement_arrangement';
    v_start_date := (p_event.event_data->>'start_date')::date;

    -- Close previous current placement
    UPDATE client_placement_history_projection SET
        is_current = false,
        end_date = v_start_date,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE client_id = v_client_id
      AND organization_id = v_org_id
      AND is_current = true;

    -- Insert new current placement
    INSERT INTO client_placement_history_projection (
        id, client_id, organization_id, placement_arrangement, start_date,
        is_current, reason, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'placement_id')::uuid,
        v_client_id,
        v_org_id,
        v_new_placement,
        v_start_date,
        true,
        p_event.event_data->>'reason',
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT ON CONSTRAINT client_placement_history_projection_pkey DO UPDATE SET
        placement_arrangement = EXCLUDED.placement_arrangement,
        start_date = EXCLUDED.start_date,
        is_current = true,
        reason = EXCLUDED.reason,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;

    -- Denormalize current placement onto clients_projection
    UPDATE clients_projection SET
        placement_arrangement = v_new_placement,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = v_client_id
      AND organization_id = v_org_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_placement_ended(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_placement_history_projection SET
        is_current = false,
        end_date = COALESCE((p_event.event_data->>'end_date')::date, CURRENT_DATE),
        reason = COALESCE(p_event.event_data->>'reason', reason),
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE client_id = p_event.stream_id
      AND organization_id = (p_event.event_data->>'organization_id')::uuid
      AND is_current = true;

    -- Clear denormalized placement on clients_projection
    UPDATE clients_projection SET
        placement_arrangement = NULL,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = p_event.stream_id
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

-- =============================================================================
-- 7. Funding source handlers (Decision 76)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_funding_source_added(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_funding_sources_projection (
        id, client_id, organization_id, source_type, source_name, reference_number,
        start_date, end_date, custom_fields,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'funding_source_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'source_type',
        p_event.event_data->>'source_name',
        p_event.event_data->>'reference_number',
        (p_event.event_data->>'start_date')::date,
        (p_event.event_data->>'end_date')::date,
        COALESCE(p_event.event_data->'custom_fields', '{}'::jsonb),
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT ON CONSTRAINT client_funding_sources_projection_pkey DO UPDATE SET
        source_type = EXCLUDED.source_type,
        source_name = EXCLUDED.source_name,
        reference_number = EXCLUDED.reference_number,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        custom_fields = EXCLUDED.custom_fields,
        is_active = true,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_funding_source_updated(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_funding_sources_projection SET
        source_type = COALESCE(p_event.event_data->>'source_type', source_type),
        source_name = COALESCE(p_event.event_data->>'source_name', source_name),
        reference_number = CASE WHEN p_event.event_data ? 'reference_number' THEN p_event.event_data->>'reference_number' ELSE reference_number END,
        start_date = CASE WHEN p_event.event_data ? 'start_date' THEN (p_event.event_data->>'start_date')::date ELSE start_date END,
        end_date = CASE WHEN p_event.event_data ? 'end_date' THEN (p_event.event_data->>'end_date')::date ELSE end_date END,
        custom_fields = CASE WHEN p_event.event_data ? 'custom_fields' THEN custom_fields || p_event.event_data->'custom_fields' ELSE custom_fields END,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'funding_source_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_funding_source_removed(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_funding_sources_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE id = (p_event.event_data->>'funding_source_id')::uuid
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;

-- =============================================================================
-- 8. Contact assignment handlers (Decision 16)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_client_contact_assigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO client_contact_assignments_projection (
        id, client_id, contact_id, organization_id, designation, assigned_at,
        is_active, created_at, updated_at, last_event_id
    ) VALUES (
        (p_event.event_data->>'assignment_id')::uuid,
        p_event.stream_id,
        (p_event.event_data->>'contact_id')::uuid,
        (p_event.event_data->>'organization_id')::uuid,
        p_event.event_data->>'designation',
        p_event.created_at,
        true,
        p_event.created_at,
        p_event.created_at,
        p_event.id
    ) ON CONFLICT (client_id, contact_id, designation) DO UPDATE SET
        is_active = true,
        assigned_at = EXCLUDED.assigned_at,
        updated_at = EXCLUDED.updated_at,
        last_event_id = EXCLUDED.last_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_client_contact_unassigned(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    UPDATE client_contact_assignments_projection SET
        is_active = false,
        updated_at = p_event.created_at,
        last_event_id = p_event.id
    WHERE client_id = p_event.stream_id
      AND contact_id = (p_event.event_data->>'contact_id')::uuid
      AND designation = p_event.event_data->>'designation'
      AND organization_id = (p_event.event_data->>'organization_id')::uuid;
END;
$function$;
