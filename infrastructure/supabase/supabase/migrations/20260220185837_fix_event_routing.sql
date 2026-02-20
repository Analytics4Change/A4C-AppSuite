-- =============================================================================
-- Fix Event Routing: 6 fixes for routing, error handling, and retry
-- =============================================================================
-- A: Add user.role.assigned/revoked CASE to process_user_event()
-- B: Remove dead user.role.* branches from process_rbac_event() + drop broken handler
-- C: Fix dispatcher to exclude contact.user.linked/unlinked from junction pre-route
-- D: Add invitation.email.sent no-op to process_organization_event()
-- E: Fix 9 routers: RAISE WARNING → RAISE EXCEPTION
-- F: Retry 4 failed events
-- =============================================================================

-- =============================================================================
-- Part C: Fix dispatcher — exclude contact.user.linked/unlinked from junction
-- =============================================================================
CREATE OR REPLACE FUNCTION public.process_domain_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_error_msg TEXT;
    v_error_detail TEXT;
BEGIN
    -- Skip already-processed events (idempotency)
    IF NEW.processed_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        IF (NEW.event_type LIKE '%.linked' OR NEW.event_type LIKE '%.unlinked')
           AND NEW.event_type NOT IN ('contact.user.linked', 'contact.user.unlinked') THEN
            PERFORM process_junction_event(NEW);
        ELSE
            CASE NEW.stream_type
                WHEN 'role'              THEN PERFORM process_rbac_event(NEW);
                WHEN 'permission'        THEN PERFORM process_rbac_event(NEW);
                WHEN 'user'              THEN PERFORM process_user_event(NEW);
                WHEN 'organization'      THEN PERFORM process_organization_event(NEW);
                WHEN 'organization_unit' THEN PERFORM process_organization_unit_event(NEW);
                WHEN 'schedule'          THEN PERFORM process_schedule_event(NEW);
                WHEN 'contact'           THEN PERFORM process_contact_event(NEW);
                WHEN 'address'           THEN PERFORM process_address_event(NEW);
                WHEN 'phone'             THEN PERFORM process_phone_event(NEW);
                WHEN 'email'             THEN PERFORM process_email_event(NEW);
                WHEN 'invitation'        THEN PERFORM process_invitation_event(NEW);
                WHEN 'access_grant'      THEN PERFORM process_access_grant_event(NEW);
                WHEN 'impersonation'     THEN PERFORM process_impersonation_event(NEW);
                -- Administrative stream_types — No projection needed
                WHEN 'platform_admin'    THEN NULL;
                WHEN 'workflow_queue'    THEN NULL;
                WHEN 'test'              THEN NULL;
                ELSE
                    RAISE EXCEPTION 'Unknown stream_type "%" for event %', NEW.stream_type, NEW.id
                        USING ERRCODE = 'P9002';
            END CASE;
        END IF;

        NEW.processed_at = clock_timestamp();
        NEW.processing_error = NULL;

    EXCEPTION
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT, v_error_detail = PG_EXCEPTION_DETAIL;
            RAISE WARNING 'Event processing error for event %: % - %', NEW.id, v_error_msg, COALESCE(v_error_detail, '');
            NEW.processing_error = v_error_msg || ' - ' || COALESCE(v_error_detail, '');
    END;

    RETURN NEW;
END;
$function$;

-- =============================================================================
-- Part A: Add user.role.assigned/revoked to process_user_event()
-- =============================================================================
CREATE OR REPLACE FUNCTION public.process_user_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    CASE p_event.event_type
        -- User lifecycle
        WHEN 'user.synced_from_auth'                THEN PERFORM handle_user_synced_from_auth(p_event);
        WHEN 'user.created'                         THEN PERFORM handle_user_created(p_event);
        WHEN 'user.profile.updated'                 THEN PERFORM handle_user_profile_updated(p_event);
        WHEN 'user.organization_switched'            THEN PERFORM handle_user_organization_switched(p_event);
        WHEN 'user.deactivated'                      THEN PERFORM handle_user_deactivated(p_event);
        WHEN 'user.reactivated'                      THEN PERFORM handle_user_reactivated(p_event);
        WHEN 'user.deleted'                          THEN PERFORM handle_user_deleted(p_event);
        -- Contact information
        WHEN 'user.phone.added'                      THEN PERFORM handle_user_phone_added(p_event);
        WHEN 'user.phone.updated'                    THEN PERFORM handle_user_phone_updated(p_event);
        WHEN 'user.phone.removed'                    THEN PERFORM handle_user_phone_removed(p_event);
        WHEN 'user.address.added'                    THEN PERFORM handle_user_address_added(p_event);
        WHEN 'user.address.updated'                  THEN PERFORM handle_user_address_updated(p_event);
        WHEN 'user.address.removed'                  THEN PERFORM handle_user_address_removed(p_event);
        -- Access / preferences
        WHEN 'user.access_dates.updated'             THEN PERFORM handle_user_access_dates_updated(p_event);
        WHEN 'user.notification_preferences.updated' THEN PERFORM handle_user_notification_preferences_updated(p_event);
        -- Client assignments
        WHEN 'user.client.assigned'                  THEN PERFORM handle_user_client_assigned(p_event);
        WHEN 'user.client.unassigned'                THEN PERFORM handle_user_client_unassigned(p_event);
        -- Invitations
        WHEN 'user.invited'                          THEN PERFORM handle_user_invited(p_event);
        -- Role assignments (emitted with stream_type 'user')
        WHEN 'user.role.assigned'                    THEN PERFORM handle_user_role_assigned(p_event);
        WHEN 'user.role.revoked'                     THEN PERFORM handle_user_role_revoked(p_event);
        ELSE
            RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
                USING ERRCODE = 'P9001';
    END CASE;
END;
$function$;

-- =============================================================================
-- Part B: Remove dead user.role.* branches from process_rbac_event()
-- + fix ELSE: RAISE WARNING → RAISE EXCEPTION
-- =============================================================================
CREATE OR REPLACE FUNCTION public.process_rbac_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'role.created' THEN PERFORM handle_role_created(p_event);
    WHEN 'role.updated' THEN PERFORM handle_role_updated(p_event);
    WHEN 'role.deactivated' THEN PERFORM handle_role_deactivated(p_event);
    WHEN 'role.reactivated' THEN PERFORM handle_role_reactivated(p_event);
    WHEN 'role.deleted' THEN PERFORM handle_role_deleted(p_event);
    WHEN 'role.permission.granted' THEN PERFORM handle_role_permission_granted(p_event);
    WHEN 'role.permission.revoked' THEN PERFORM handle_role_permission_revoked(p_event);
    WHEN 'permission.defined' THEN PERFORM handle_permission_defined(p_event);
    WHEN 'permission.updated' THEN PERFORM handle_permission_updated(p_event);
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_rbac_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

-- Drop the broken handler (uses wrong column 'org_id' instead of 'organization_id')
DROP FUNCTION IF EXISTS public.handle_rbac_user_role_assigned(record);

-- =============================================================================
-- Part D: Add invitation.email.sent no-op to process_organization_event()
-- =============================================================================
CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'organization.created' THEN PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.activated' THEN PERFORM handle_organization_activated(p_event);
    WHEN 'organization.deactivated' THEN PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN PERFORM handle_organization_deleted(p_event);
    WHEN 'organization.subdomain.verified' THEN PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN PERFORM handle_organization_subdomain_failed(p_event);
    WHEN 'organization.direct_care_settings_updated' THEN PERFORM handle_organization_direct_care_settings_updated(p_event);
    WHEN 'organization.bootstrap.initiated' THEN NULL;
    WHEN 'organization.bootstrap.completed' THEN PERFORM handle_bootstrap_completed(p_event);
    WHEN 'organization.bootstrap.failed' THEN PERFORM handle_bootstrap_failed(p_event);
    WHEN 'organization.bootstrap.cancelled' THEN PERFORM handle_bootstrap_cancelled(p_event);
    -- Forwarding CASE: invitation.resent events were emitted with stream_type='organization'
    -- by invite-user Edge Function (pre-v15). Forward to the correct handler.
    WHEN 'invitation.resent' THEN PERFORM handle_invitation_resent(p_event);
    -- Forwarding CASE: invitation.email.sent events emitted with stream_type='organization'
    -- by Temporal activities. Informational only, no projection needed.
    WHEN 'invitation.email.sent' THEN NULL;
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_organization_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

-- =============================================================================
-- Part E: Fix 9 routers — RAISE WARNING → RAISE EXCEPTION
-- (process_rbac_event and process_organization_event already fixed above)
-- =============================================================================

-- 1. process_organization_unit_event
CREATE OR REPLACE FUNCTION public.process_organization_unit_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'organization_unit.created' THEN PERFORM handle_organization_unit_created(p_event);
    WHEN 'organization_unit.updated' THEN PERFORM handle_organization_unit_updated(p_event);
    WHEN 'organization_unit.deactivated' THEN PERFORM handle_organization_unit_deactivated(p_event);
    WHEN 'organization_unit.reactivated' THEN PERFORM handle_organization_unit_reactivated(p_event);
    WHEN 'organization_unit.deleted' THEN PERFORM handle_organization_unit_deleted(p_event);
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_organization_unit_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

-- 2. process_access_grant_event
CREATE OR REPLACE FUNCTION public.process_access_grant_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_grant_id UUID;
BEGIN
  CASE p_event.event_type

    WHEN 'access_grant.created' THEN
      INSERT INTO cross_tenant_access_grants_projection (
        id, consultant_org_id, consultant_user_id, provider_org_id,
        scope, scope_id, authorization_type, legal_reference,
        granted_by, granted_at, expires_at, permissions, terms,
        status, created_at, updated_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_org_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'consultant_user_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        safe_jsonb_extract_text(p_event.event_data, 'scope'),
        safe_jsonb_extract_uuid(p_event.event_data, 'scope_id'),
        safe_jsonb_extract_text(p_event.event_data, 'authorization_type'),
        safe_jsonb_extract_text(p_event.event_data, 'legal_reference'),
        safe_jsonb_extract_uuid(p_event.event_data, 'granted_by'),
        p_event.created_at,
        safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
        COALESCE(p_event.event_data->'permissions', '[]'::jsonb),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    WHEN 'access_grant.revoked' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'revoked',
          revoked_at = p_event.created_at,
          revoked_by = safe_jsonb_extract_uuid(p_event.event_data, 'revoked_by'),
          revocation_reason = safe_jsonb_extract_text(p_event.event_data, 'revocation_reason'),
          revocation_details = safe_jsonb_extract_text(p_event.event_data, 'revocation_details'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.expired' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'expired',
          expired_at = p_event.created_at,
          expiration_type = safe_jsonb_extract_text(p_event.event_data, 'expiration_type'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.suspended' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'suspended',
          suspended_at = p_event.created_at,
          suspended_by = safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
          suspension_reason = safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
          suspension_details = safe_jsonb_extract_text(p_event.event_data, 'suspension_details'),
          expected_resolution_date = safe_jsonb_extract_timestamp(p_event.event_data, 'expected_resolution_date'),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    WHEN 'access_grant.reactivated' THEN
      v_grant_id := safe_jsonb_extract_uuid(p_event.event_data, 'grant_id');
      UPDATE cross_tenant_access_grants_projection
      SET status = 'active',
          suspended_at = NULL, suspended_by = NULL,
          suspension_reason = NULL, suspension_details = NULL,
          expected_resolution_date = NULL,
          reactivated_at = p_event.created_at,
          reactivated_by = safe_jsonb_extract_uuid(p_event.event_data, 'reactivated_by'),
          resolution_details = safe_jsonb_extract_text(p_event.event_data, 'resolution_details'),
          expires_at = COALESCE(
            safe_jsonb_extract_timestamp(p_event.event_data, 'new_expires_at'),
            expires_at
          ),
          updated_at = p_event.created_at
      WHERE id = v_grant_id;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_access_grant_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

-- 3. process_impersonation_event (also remove inner EXCEPTION block)
CREATE OR REPLACE FUNCTION public.process_impersonation_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_session_id TEXT;
BEGIN
  v_session_id := p_event.event_data->>'session_id';

  CASE p_event.event_type
    WHEN 'impersonation.started' THEN
      INSERT INTO impersonation_sessions_projection (
        session_id, super_admin_user_id, super_admin_email, super_admin_name,
        super_admin_org_id, target_user_id, target_email, target_name,
        target_org_id, target_org_name, target_org_type,
        justification_reason, justification_reference_id, justification_notes,
        status, started_at, expires_at, duration_ms, total_duration_ms,
        renewal_count, actions_performed, ip_address, user_agent,
        created_at, updated_at
      ) VALUES (
        v_session_id,
        (p_event.event_data->'super_admin'->>'user_id')::UUID,
        p_event.event_data->'super_admin'->>'email',
        p_event.event_data->'super_admin'->>'name',
        CASE
          WHEN p_event.event_data->'super_admin'->>'org_id' IS NULL THEN NULL
          WHEN p_event.event_data->'super_admin'->>'org_id' = '*' THEN NULL
          ELSE (p_event.event_data->'super_admin'->>'org_id')::UUID
        END,
        (p_event.event_data->'target'->>'user_id')::UUID,
        p_event.event_data->'target'->>'email',
        p_event.event_data->'target'->>'name',
        (p_event.event_data->'target'->>'org_id')::UUID,
        p_event.event_data->'target'->>'org_name',
        p_event.event_data->'target'->>'org_type',
        p_event.event_data->'justification'->>'reason',
        p_event.event_data->'justification'->>'reference_id',
        p_event.event_data->'justification'->>'notes',
        'active', NOW(),
        (p_event.event_data->'session_config'->>'expires_at')::TIMESTAMPTZ,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,
        (p_event.event_data->'session_config'->>'duration')::INTEGER,
        0, 0,
        p_event.event_data->>'ip_address',
        p_event.event_data->>'user_agent',
        p_event.created_at, p_event.created_at
      )
      ON CONFLICT (session_id) DO NOTHING;

    WHEN 'impersonation.renewed' THEN
      UPDATE impersonation_sessions_projection
      SET expires_at = (p_event.event_data->>'new_expires_at')::TIMESTAMPTZ,
          total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
          renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
          updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation renewal event for non-existent session: %', v_session_id;
      END IF;

    WHEN 'impersonation.ended' THEN
      UPDATE impersonation_sessions_projection
      SET status = CASE
            WHEN p_event.event_data->>'reason' = 'timeout' THEN 'expired'
            ELSE 'ended'
          END,
          ended_at = (p_event.event_data->'summary'->>'ended_at')::TIMESTAMPTZ,
          ended_reason = p_event.event_data->>'reason',
          ended_by_user_id = (p_event.event_data->>'ended_by')::UUID,
          total_duration_ms = (p_event.event_data->>'total_duration')::INTEGER,
          renewal_count = (p_event.event_data->>'renewal_count')::INTEGER,
          actions_performed = (p_event.event_data->>'actions_performed')::INTEGER,
          updated_at = p_event.created_at
      WHERE session_id = v_session_id;

      IF NOT FOUND THEN
        RAISE WARNING 'Impersonation end event for non-existent session: %', v_session_id;
      END IF;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_impersonation_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;

-- 4. process_contact_event
CREATE OR REPLACE FUNCTION public.process_contact_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_contact_id UUID;
  v_user_id UUID;
BEGIN
  CASE p_event.event_type

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
      ON CONFLICT (id) DO NOTHING;

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

    WHEN 'contact.deleted' THEN
      UPDATE contacts_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'contact.user.linked' THEN
      v_contact_id := safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');
      v_user_id := safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

      UPDATE contacts_projection
      SET
        user_id = v_user_id,
        updated_at = p_event.created_at
      WHERE id = v_contact_id
        AND deleted_at IS NULL;

      INSERT INTO user_phones (
        id, user_id, label, type, number, extension, country_code,
        is_primary, is_active, sms_capable, metadata, source_contact_phone_id,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(), v_user_id, p.label, p.type, p.number, p.extension,
        COALESCE(p.country_code, '+1'), COALESCE(p.is_primary, false),
        true, true,
        jsonb_build_object('mirrored_at', p_event.created_at, 'source', 'contact_link'),
        p.id, p_event.created_at, p_event.created_at
      FROM phones_projection p
      JOIN contact_phones cp ON cp.phone_id = p.id
      WHERE cp.contact_id = v_contact_id
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_active, true) = true
        AND p.type = 'mobile'
      ON CONFLICT DO NOTHING;

    WHEN 'contact.user.unlinked' THEN
      UPDATE contacts_projection
      SET
        user_id = NULL,
        updated_at = p_event.created_at
      WHERE id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND user_id = safe_jsonb_extract_uuid(p_event.event_data, 'user_id');

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_contact_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

-- 5. process_address_event
CREATE OR REPLACE FUNCTION public.process_address_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'address.created' THEN
      INSERT INTO addresses_projection (
        id, organization_id, type, label,
        street1, street2, city, state, zip_code, country,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'street1'),
        safe_jsonb_extract_text(p_event.event_data, 'street2'),
        safe_jsonb_extract_text(p_event.event_data, 'city'),
        safe_jsonb_extract_text(p_event.event_data, 'state'),
        safe_jsonb_extract_text(p_event.event_data, 'zip_code'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), 'USA'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'address.updated' THEN
      UPDATE addresses_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::address_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        street1 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street1'), street1),
        street2 = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'street2'), street2),
        city = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'city'), city),
        state = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'state'), state),
        zip_code = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'zip_code'), zip_code),
        country = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'country'), country),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'address.deleted' THEN
      UPDATE addresses_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_address_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

-- 6. process_phone_event
CREATE OR REPLACE FUNCTION public.process_phone_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'phone.created' THEN
      INSERT INTO phones_projection (
        id, organization_id, type, label,
        number, extension, is_primary,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE NULL
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'number'),
        safe_jsonb_extract_text(p_event.event_data, 'extension'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'phone.updated' THEN
      UPDATE phones_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::phone_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'number'), number),
        extension = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'extension'), extension),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'phone.deleted' THEN
      UPDATE phones_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_phone_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

-- 7. process_email_event
CREATE OR REPLACE FUNCTION public.process_email_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'email.created' THEN
      INSERT INTO emails_projection (
        id, organization_id, type, label,
        address, is_primary,
        metadata, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::email_type
          ELSE 'work'::email_type
        END,
        safe_jsonb_extract_text(p_event.event_data, 'label'),
        safe_jsonb_extract_text(p_event.event_data, 'address'),
        COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), false),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at
      )
      ON CONFLICT (id) DO NOTHING;

    WHEN 'email.updated' THEN
      UPDATE emails_projection
      SET
        type = CASE
          WHEN p_event.event_data ? 'type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'type'))::email_type
          ELSE type
        END,
        label = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'label'), label),
        address = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'address'), address),
        is_primary = COALESCE(safe_jsonb_extract_boolean(p_event.event_data, 'is_primary'), is_primary),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'email.deleted' THEN
      UPDATE emails_projection
      SET
        deleted_at = p_event.created_at,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_email_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

-- 8. process_junction_event
CREATE OR REPLACE FUNCTION public.process_junction_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'organization.contact.linked' THEN
      INSERT INTO organization_contacts (organization_id, contact_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
      ) ON CONFLICT (organization_id, contact_id) DO NOTHING;

    WHEN 'organization.contact.unlinked' THEN
      DELETE FROM organization_contacts
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id');

    WHEN 'organization.address.linked' THEN
      INSERT INTO organization_addresses (organization_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      ) ON CONFLICT (organization_id, address_id) DO NOTHING;

    WHEN 'organization.address.unlinked' THEN
      DELETE FROM organization_addresses
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    WHEN 'organization.phone.linked' THEN
      INSERT INTO organization_phones (organization_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      ) ON CONFLICT (organization_id, phone_id) DO NOTHING;

    WHEN 'organization.phone.unlinked' THEN
      DELETE FROM organization_phones
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    WHEN 'organization.email.linked' THEN
      INSERT INTO organization_emails (organization_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'organization_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      ) ON CONFLICT (organization_id, email_id) DO NOTHING;

    WHEN 'organization.email.unlinked' THEN
      DELETE FROM organization_emails
      WHERE organization_id = safe_jsonb_extract_uuid(p_event.event_data, 'organization_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    WHEN 'contact.phone.linked' THEN
      INSERT INTO contact_phones (contact_id, phone_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
      ) ON CONFLICT (contact_id, phone_id) DO NOTHING;

    WHEN 'contact.phone.unlinked' THEN
      DELETE FROM contact_phones
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id');

    WHEN 'contact.address.linked' THEN
      INSERT INTO contact_addresses (contact_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      ) ON CONFLICT (contact_id, address_id) DO NOTHING;

    WHEN 'contact.address.unlinked' THEN
      DELETE FROM contact_addresses
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    WHEN 'contact.email.linked' THEN
      INSERT INTO contact_emails (contact_id, email_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'contact_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'email_id')
      ) ON CONFLICT (contact_id, email_id) DO NOTHING;

    WHEN 'contact.email.unlinked' THEN
      DELETE FROM contact_emails
      WHERE contact_id = safe_jsonb_extract_uuid(p_event.event_data, 'contact_id')
        AND email_id = safe_jsonb_extract_uuid(p_event.event_data, 'email_id');

    WHEN 'phone.address.linked' THEN
      INSERT INTO phone_addresses (phone_id, address_id)
      VALUES (
        safe_jsonb_extract_uuid(p_event.event_data, 'phone_id'),
        safe_jsonb_extract_uuid(p_event.event_data, 'address_id')
      ) ON CONFLICT (phone_id, address_id) DO NOTHING;

    WHEN 'phone.address.unlinked' THEN
      DELETE FROM phone_addresses
      WHERE phone_id = safe_jsonb_extract_uuid(p_event.event_data, 'phone_id')
        AND address_id = safe_jsonb_extract_uuid(p_event.event_data, 'address_id');

    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_junction_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;

END;
$function$;

-- =============================================================================
-- Part F: Retry failed events
-- =============================================================================
UPDATE domain_events
SET processed_at = NULL,
    processing_error = NULL,
    retry_count = COALESCE(retry_count, 0) + 1
WHERE processing_error IS NOT NULL
  AND processed_at IS NULL
  AND event_type IN ('user.role.assigned', 'invitation.email.sent');
