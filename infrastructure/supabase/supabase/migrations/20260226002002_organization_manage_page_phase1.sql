-- Phase 1: Organization Manage Page — RPCs, JWT Hook, Router Updates
--
-- 1. JWT hook: add org is_active check (access_blocked when org deactivated)
-- 2. Organization lifecycle RPCs: get_details, update, deactivate, reactivate, delete
-- 3. Contact/address/phone CRUD RPCs (9 total)
-- 4. Router CASE additions for deletion.initiated/completed

-- =============================================================================
-- SECTION 1: JWT Hook Extension — org is_active check
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_org_id uuid;
  v_org_type text;
  v_org_is_active boolean;
  v_org_access_record record;
  v_access_blocked boolean := false;
  v_access_block_reason text;
  v_effective_permissions jsonb;
  v_current_org_unit_id uuid;
  v_current_org_unit_path text;
BEGIN
  -- Extract user ID from event (Supabase Auth user UUID)
  v_user_id := (event->>'user_id')::uuid;

  -- Get user's current organization and org unit context
  SELECT u.current_organization_id, u.current_org_unit_id
  INTO v_org_id, v_current_org_unit_id
  FROM public.users u
  WHERE u.id = v_user_id;

  -- =========================================================================
  -- ACCESS DATE VALIDATION
  -- =========================================================================

  IF v_org_id IS NOT NULL THEN
    SELECT
      uop.access_start_date,
      uop.access_expiration_date
    INTO v_org_access_record
    FROM public.user_organizations_projection uop
    WHERE uop.user_id = v_user_id
      AND uop.org_id = v_org_id;

    IF v_org_access_record.access_start_date IS NOT NULL
       AND v_org_access_record.access_start_date > CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_not_started';
    END IF;

    IF v_org_access_record.access_expiration_date IS NOT NULL
       AND v_org_access_record.access_expiration_date < CURRENT_DATE THEN
      v_access_blocked := true;
      v_access_block_reason := 'access_expired';
    END IF;
  END IF;

  -- If access is blocked, return minimal claims with blocked flag
  IF v_access_blocked THEN
    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', v_org_id,
        'org_type', NULL,
        'effective_permissions', '[]'::jsonb,
        'access_blocked', true,
        'access_block_reason', v_access_block_reason,
        'claims_version', 4
      )
    );
  END IF;

  -- =========================================================================
  -- ORGANIZATION CONTEXT RESOLUTION
  -- =========================================================================

  IF v_org_id IS NULL THEN
    SELECT
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.user_roles_projection ur
          JOIN public.roles_projection r ON r.id = ur.role_id
          WHERE ur.user_id = v_user_id
            AND r.name = 'super_admin'
            AND ur.organization_id IS NULL
            AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
            AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
        ) THEN NULL
        ELSE (
          SELECT o.id
          FROM public.organizations_projection o
          WHERE o.type = 'platform_owner'
          LIMIT 1
        )
      END
    INTO v_org_id;
  END IF;

  IF v_org_id IS NULL THEN
    v_org_type := 'platform_owner';
  ELSE
    SELECT o.type::text, o.is_active INTO v_org_type, v_org_is_active
    FROM public.organizations_projection o
    WHERE o.id = v_org_id;

    -- =========================================================================
    -- ORGANIZATION ACTIVE STATUS CHECK (NEW)
    -- Block access when organization is deactivated or deleted
    -- =========================================================================
    IF NOT COALESCE(v_org_is_active, true) THEN
      RETURN jsonb_build_object(
        'claims',
        COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
          'org_id', v_org_id,
          'org_type', NULL,
          'effective_permissions', '[]'::jsonb,
          'access_blocked', true,
          'access_block_reason', 'organization_deactivated',
          'claims_version', 4
        )
      );
    END IF;
  END IF;

  -- =========================================================================
  -- ORG UNIT CONTEXT (for user-centric workflows)
  -- =========================================================================

  IF v_current_org_unit_id IS NOT NULL THEN
    SELECT ou.path::text INTO v_current_org_unit_path
    FROM public.organization_units_projection ou
    WHERE ou.id = v_current_org_unit_id;
  END IF;

  -- =========================================================================
  -- EFFECTIVE PERMISSIONS (sole permission mechanism)
  -- =========================================================================

  -- Check if user is super_admin (any role named super_admin)
  IF EXISTS (
    SELECT 1
    FROM public.user_roles_projection ur
    JOIN public.roles_projection r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
      AND r.name = 'super_admin'
      AND (ur.role_valid_from IS NULL OR ur.role_valid_from <= CURRENT_DATE)
      AND (ur.role_valid_until IS NULL OR ur.role_valid_until >= CURRENT_DATE)
  ) THEN
    -- Super admins get all permissions at root scope (empty string = global)
    SELECT jsonb_agg(
      jsonb_build_object('p', p.name, 's', '')
    )
    INTO v_effective_permissions
    FROM public.permissions_projection p;
  ELSE
    -- Regular users get computed effective permissions with scopes
    SELECT jsonb_agg(
      jsonb_build_object('p', permission_name, 's', COALESCE(effective_scope::text, ''))
    )
    INTO v_effective_permissions
    FROM compute_effective_permissions(v_user_id, v_org_id);
  END IF;

  v_effective_permissions := COALESCE(v_effective_permissions, '[]'::jsonb);

  -- =========================================================================
  -- BUILD CLAIMS (v4 - no deprecated fields)
  -- =========================================================================

  v_claims := COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
    'org_id', v_org_id,
    'org_type', v_org_type,
    'access_blocked', false,
    'claims_version', 4,
    'effective_permissions', v_effective_permissions,
    'current_org_unit_id', v_current_org_unit_id,
    'current_org_unit_path', v_current_org_unit_path
  );

  RETURN jsonb_build_object('claims', v_claims);

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'JWT hook error for user %: % %',
      v_user_id,
      SQLERRM,
      SQLSTATE;

    RETURN jsonb_build_object(
      'claims',
      COALESCE(event->'claims', '{}'::jsonb) || jsonb_build_object(
        'org_id', NULL,
        'org_type', NULL,
        'effective_permissions', '[]'::jsonb,
        'access_blocked', false,
        'claims_error', SQLERRM,
        'claims_version', 4
      )
    );
END;
$$;

-- =============================================================================
-- SECTION 2: Organization Details Query RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION api.get_organization_details(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_org record;
  v_contacts jsonb;
  v_addresses jsonb;
  v_phones jsonb;
BEGIN
  -- Fetch organization
  SELECT * INTO v_org
  FROM organizations_projection
  WHERE id = p_org_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
  END IF;

  -- Fetch active contacts
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'label', c.label, 'type', c.type::text,
    'first_name', c.first_name, 'last_name', c.last_name,
    'email', c.email, 'title', c.title, 'department', c.department,
    'is_primary', c.is_primary, 'is_active', c.is_active,
    'user_id', c.user_id, 'created_at', c.created_at, 'updated_at', c.updated_at
  ) ORDER BY c.is_primary DESC, c.created_at), '[]'::jsonb)
  INTO v_contacts
  FROM contacts_projection c
  WHERE c.organization_id = p_org_id AND c.deleted_at IS NULL;

  -- Fetch active addresses
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'label', a.label, 'type', a.type::text,
    'street1', a.street1, 'street2', a.street2,
    'city', a.city, 'state', a.state, 'zip_code', a.zip_code, 'country', a.country,
    'is_primary', a.is_primary, 'is_active', a.is_active,
    'created_at', a.created_at, 'updated_at', a.updated_at
  ) ORDER BY a.is_primary DESC, a.created_at), '[]'::jsonb)
  INTO v_addresses
  FROM addresses_projection a
  WHERE a.organization_id = p_org_id AND a.deleted_at IS NULL;

  -- Fetch active phones
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ph.id, 'label', ph.label, 'type', ph.type::text,
    'number', ph.number, 'extension', ph.extension, 'country_code', ph.country_code,
    'is_primary', ph.is_primary, 'is_active', ph.is_active,
    'created_at', ph.created_at, 'updated_at', ph.updated_at
  ) ORDER BY ph.is_primary DESC, ph.created_at), '[]'::jsonb)
  INTO v_phones
  FROM phones_projection ph
  WHERE ph.organization_id = p_org_id AND ph.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'organization', jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'display_name', v_org.display_name,
      'slug', v_org.slug, 'type', v_org.type, 'path', v_org.path::text,
      'parent_path', v_org.parent_path::text,
      'tax_number', v_org.tax_number, 'phone_number', v_org.phone_number,
      'timezone', v_org.timezone, 'is_active', v_org.is_active,
      'deactivated_at', v_org.deactivated_at, 'deactivation_reason', v_org.deactivation_reason,
      'deleted_at', v_org.deleted_at, 'deletion_reason', v_org.deletion_reason,
      'subdomain_status', v_org.subdomain_status,
      'partner_type', v_org.partner_type, 'referring_partner_id', v_org.referring_partner_id,
      'direct_care_settings', v_org.direct_care_settings,
      'tags', v_org.tags, 'metadata', v_org.metadata,
      'created_at', v_org.created_at, 'updated_at', v_org.updated_at
    ),
    'contacts', v_contacts,
    'addresses', v_addresses,
    'phones', v_phones
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION api.get_organization_details(uuid) TO authenticated;

-- =============================================================================
-- SECTION 3: Organization Update RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION api.update_organization(
  p_org_id uuid,
  p_data jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_org_id uuid := get_current_org_id();
  v_org record;
  v_event_data jsonb;
  v_result record;
  v_processing_error text;
BEGIN
  -- Verify org exists and is not deleted
  SELECT * INTO v_org
  FROM organizations_projection
  WHERE id = p_org_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
  END IF;

  -- Permission: platform owners can edit all fields; others need organization.update
  IF NOT has_platform_privilege() THEN
    IF NOT has_effective_permission('organization.update', v_org.path) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;
    -- Non-platform-owners cannot edit 'name' (system identifier)
    p_data := p_data - 'name';
  END IF;

  -- Build event data from allowed fields only
  v_event_data := '{}'::jsonb;
  IF p_data ? 'name' THEN v_event_data := v_event_data || jsonb_build_object('name', p_data->>'name'); END IF;
  IF p_data ? 'display_name' THEN v_event_data := v_event_data || jsonb_build_object('display_name', p_data->>'display_name'); END IF;
  IF p_data ? 'tax_number' THEN v_event_data := v_event_data || jsonb_build_object('tax_number', p_data->>'tax_number'); END IF;
  IF p_data ? 'phone_number' THEN v_event_data := v_event_data || jsonb_build_object('phone_number', p_data->>'phone_number'); END IF;
  IF p_data ? 'timezone' THEN v_event_data := v_event_data || jsonb_build_object('timezone', p_data->>'timezone'); END IF;

  IF v_event_data = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'No updatable fields provided');
  END IF;

  -- Emit event
  PERFORM api.emit_domain_event(
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

  -- Read-back guard
  SELECT * INTO v_result FROM organizations_projection WHERE id = p_org_id;

  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_org_id AND event_type = 'organization.updated'
    ORDER BY sequence_number DESC LIMIT 1;

    RETURN jsonb_build_object('success', false, 'error',
      COALESCE(v_processing_error, 'Organization not found after event processing'));
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
$function$;

GRANT EXECUTE ON FUNCTION api.update_organization(uuid, jsonb, text) TO authenticated;

-- =============================================================================
-- SECTION 4: Organization Deactivate RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION api.deactivate_organization(
  p_org_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_org record;
  v_result record;
  v_processing_error text;
BEGIN
  -- Platform owner only
  IF NOT has_platform_privilege() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Platform privilege required');
  END IF;

  -- Verify org exists, is active, not deleted
  SELECT * INTO v_org
  FROM organizations_projection
  WHERE id = p_org_id AND is_active = true AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found or already inactive');
  END IF;

  -- Emit event
  PERFORM api.emit_domain_event(
    p_stream_id      := p_org_id,
    p_stream_type    := 'organization',
    p_event_type     := 'organization.deactivated',
    p_event_data     := jsonb_build_object(
      'deactivation_type', COALESCE(p_reason, 'administrative'),
      'effective_date', now()::text
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', p_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  -- Read-back guard: verify deactivation
  SELECT * INTO v_result
  FROM organizations_projection
  WHERE id = p_org_id AND is_active = false;

  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_org_id AND event_type = 'organization.deactivated'
    ORDER BY sequence_number DESC LIMIT 1;

    RETURN jsonb_build_object('success', false, 'error',
      COALESCE(v_processing_error, 'Deactivation failed'));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization', jsonb_build_object(
      'id', v_result.id, 'name', v_result.name, 'is_active', v_result.is_active,
      'deactivated_at', v_result.deactivated_at, 'deactivation_reason', v_result.deactivation_reason
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION api.deactivate_organization(uuid, text) TO authenticated;

-- =============================================================================
-- SECTION 5: Organization Reactivate RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION api.reactivate_organization(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_org record;
  v_result record;
  v_processing_error text;
BEGIN
  -- Platform owner only
  IF NOT has_platform_privilege() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Platform privilege required');
  END IF;

  -- Verify org exists, is inactive, not deleted
  SELECT * INTO v_org
  FROM organizations_projection
  WHERE id = p_org_id AND is_active = false AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Organization not found or already active');
  END IF;

  -- Emit event
  PERFORM api.emit_domain_event(
    p_stream_id      := p_org_id,
    p_stream_type    := 'organization',
    p_event_type     := 'organization.reactivated',
    p_event_data     := '{}'::jsonb,
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', p_org_id
    )
  );

  -- Read-back guard: verify reactivation
  SELECT * INTO v_result
  FROM organizations_projection
  WHERE id = p_org_id AND is_active = true;

  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_org_id AND event_type = 'organization.reactivated'
    ORDER BY sequence_number DESC LIMIT 1;

    RETURN jsonb_build_object('success', false, 'error',
      COALESCE(v_processing_error, 'Reactivation failed'));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization', jsonb_build_object(
      'id', v_result.id, 'name', v_result.name, 'is_active', v_result.is_active
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION api.reactivate_organization(uuid) TO authenticated;

-- =============================================================================
-- SECTION 6: Organization Delete RPC (synchronous — marks as deleted)
-- Temporal workflow handles async cleanup (DNS, users, invitations)
-- =============================================================================

CREATE OR REPLACE FUNCTION api.delete_organization(
  p_org_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_org record;
  v_result record;
  v_processing_error text;
BEGIN
  -- Platform owner only
  IF NOT has_platform_privilege() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Platform privilege required');
  END IF;

  -- Verify org exists, is deactivated (must deactivate first), not already deleted
  SELECT * INTO v_org
  FROM organizations_projection
  WHERE id = p_org_id AND is_active = false AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Organization not found, must be deactivated before deletion, or already deleted');
  END IF;

  -- Emit event
  PERFORM api.emit_domain_event(
    p_stream_id      := p_org_id,
    p_stream_type    := 'organization',
    p_event_type     := 'organization.deleted',
    p_event_data     := jsonb_build_object(
      'deletion_strategy', COALESCE(p_reason, 'soft_delete')
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', v_user_id,
      'organization_id', p_org_id
    ) || CASE WHEN p_reason IS NOT NULL
         THEN jsonb_build_object('reason', p_reason)
         ELSE '{}'::jsonb END
  );

  -- Read-back guard: verify deletion
  SELECT * INTO v_result
  FROM organizations_projection
  WHERE id = p_org_id AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id = p_org_id AND event_type = 'organization.deleted'
    ORDER BY sequence_number DESC LIMIT 1;

    RETURN jsonb_build_object('success', false, 'error',
      COALESCE(v_processing_error, 'Deletion failed'));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization', jsonb_build_object(
      'id', v_result.id, 'name', v_result.name,
      'deleted_at', v_result.deleted_at, 'deletion_reason', v_result.deletion_reason
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION api.delete_organization(uuid, text) TO authenticated;

-- =============================================================================
-- SECTION 7: Contact CRUD RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION api.create_organization_contact(p_org_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_org record;
  v_contact_id uuid := gen_random_uuid();
  v_result record;
  v_processing_error text;
BEGIN
  SELECT * INTO v_org FROM organizations_projection WHERE id = p_org_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_contact_id, p_stream_type := 'contact', p_event_type := 'contact.created',
    p_event_data := p_data || jsonb_build_object('organization_id', p_org_id),
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', p_org_id)
  );

  SELECT * INTO v_result FROM contacts_projection WHERE id = v_contact_id;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = v_contact_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Contact creation failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'contact', jsonb_build_object(
    'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
    'first_name', v_result.first_name, 'last_name', v_result.last_name,
    'email', v_result.email, 'title', v_result.title, 'department', v_result.department,
    'is_primary', v_result.is_primary, 'created_at', v_result.created_at
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.create_organization_contact(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION api.update_organization_contact(p_contact_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_contact record; v_org record; v_result record; v_processing_error text;
BEGIN
  SELECT * INTO v_contact FROM contacts_projection WHERE id = p_contact_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Contact not found'); END IF;

  SELECT * INTO v_org FROM organizations_projection WHERE id = v_contact.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_contact_id, p_stream_type := 'contact', p_event_type := 'contact.updated',
    p_event_data := p_data,
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_contact.organization_id)
  );

  SELECT * INTO v_result FROM contacts_projection WHERE id = p_contact_id;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_contact_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Contact update failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'contact', jsonb_build_object(
    'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
    'first_name', v_result.first_name, 'last_name', v_result.last_name,
    'email', v_result.email, 'updated_at', v_result.updated_at
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.update_organization_contact(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION api.delete_organization_contact(p_contact_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_contact record; v_org record; v_result record; v_processing_error text;
BEGIN
  SELECT * INTO v_contact FROM contacts_projection WHERE id = p_contact_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Contact not found'); END IF;

  SELECT * INTO v_org FROM organizations_projection WHERE id = v_contact.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_contact_id, p_stream_type := 'contact', p_event_type := 'contact.deleted',
    p_event_data := '{}'::jsonb,
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_contact.organization_id)
      || CASE WHEN p_reason IS NOT NULL THEN jsonb_build_object('reason', p_reason) ELSE '{}'::jsonb END
  );

  SELECT * INTO v_result FROM contacts_projection WHERE id = p_contact_id AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_contact_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Contact deletion failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'contact', jsonb_build_object('id', v_result.id, 'deleted_at', v_result.deleted_at));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.delete_organization_contact(uuid, text) TO authenticated;

-- =============================================================================
-- SECTION 8: Address CRUD RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION api.create_organization_address(p_org_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_org record;
  v_address_id uuid := gen_random_uuid();
  v_result record;
  v_processing_error text;
BEGIN
  SELECT * INTO v_org FROM organizations_projection WHERE id = p_org_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_address_id, p_stream_type := 'address', p_event_type := 'address.created',
    p_event_data := p_data || jsonb_build_object('organization_id', p_org_id),
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', p_org_id)
  );

  SELECT * INTO v_result FROM addresses_projection WHERE id = v_address_id;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = v_address_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Address creation failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'address', jsonb_build_object(
    'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
    'street1', v_result.street1, 'street2', v_result.street2,
    'city', v_result.city, 'state', v_result.state, 'zip_code', v_result.zip_code,
    'country', v_result.country, 'is_primary', v_result.is_primary, 'created_at', v_result.created_at
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.create_organization_address(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION api.update_organization_address(p_address_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_address record; v_org record; v_result record; v_processing_error text;
BEGIN
  SELECT * INTO v_address FROM addresses_projection WHERE id = p_address_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Address not found'); END IF;

  SELECT * INTO v_org FROM organizations_projection WHERE id = v_address.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_address_id, p_stream_type := 'address', p_event_type := 'address.updated',
    p_event_data := p_data,
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_address.organization_id)
  );

  SELECT * INTO v_result FROM addresses_projection WHERE id = p_address_id;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_address_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Address update failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'address', jsonb_build_object(
    'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
    'street1', v_result.street1, 'city', v_result.city, 'state', v_result.state,
    'zip_code', v_result.zip_code, 'updated_at', v_result.updated_at
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.update_organization_address(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION api.delete_organization_address(p_address_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_address record; v_org record; v_result record; v_processing_error text;
BEGIN
  SELECT * INTO v_address FROM addresses_projection WHERE id = p_address_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Address not found'); END IF;

  SELECT * INTO v_org FROM organizations_projection WHERE id = v_address.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_address_id, p_stream_type := 'address', p_event_type := 'address.deleted',
    p_event_data := '{}'::jsonb,
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_address.organization_id)
      || CASE WHEN p_reason IS NOT NULL THEN jsonb_build_object('reason', p_reason) ELSE '{}'::jsonb END
  );

  SELECT * INTO v_result FROM addresses_projection WHERE id = p_address_id AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_address_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Address deletion failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'address', jsonb_build_object('id', v_result.id, 'deleted_at', v_result.deleted_at));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.delete_organization_address(uuid, text) TO authenticated;

-- =============================================================================
-- SECTION 9: Phone CRUD RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION api.create_organization_phone(p_org_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_org record;
  v_phone_id uuid := gen_random_uuid();
  v_result record;
  v_processing_error text;
BEGIN
  SELECT * INTO v_org FROM organizations_projection WHERE id = p_org_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := v_phone_id, p_stream_type := 'phone', p_event_type := 'phone.created',
    p_event_data := p_data || jsonb_build_object('organization_id', p_org_id),
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', p_org_id)
  );

  SELECT * INTO v_result FROM phones_projection WHERE id = v_phone_id;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = v_phone_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Phone creation failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'phone', jsonb_build_object(
    'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
    'number', v_result.number, 'extension', v_result.extension, 'country_code', v_result.country_code,
    'is_primary', v_result.is_primary, 'created_at', v_result.created_at
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.create_organization_phone(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION api.update_organization_phone(p_phone_id uuid, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_phone record; v_org record; v_result record; v_processing_error text;
BEGIN
  SELECT * INTO v_phone FROM phones_projection WHERE id = p_phone_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Phone not found'); END IF;

  SELECT * INTO v_org FROM organizations_projection WHERE id = v_phone.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_phone_id, p_stream_type := 'phone', p_event_type := 'phone.updated',
    p_event_data := p_data,
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_phone.organization_id)
  );

  SELECT * INTO v_result FROM phones_projection WHERE id = p_phone_id;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_phone_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Phone update failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'phone', jsonb_build_object(
    'id', v_result.id, 'label', v_result.label, 'type', v_result.type::text,
    'number', v_result.number, 'extension', v_result.extension,
    'is_primary', v_result.is_primary, 'updated_at', v_result.updated_at
  ));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.update_organization_phone(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION api.delete_organization_phone(p_phone_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := get_current_user_id();
  v_phone record; v_org record; v_result record; v_processing_error text;
BEGIN
  SELECT * INTO v_phone FROM phones_projection WHERE id = p_phone_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Phone not found'); END IF;

  SELECT * INTO v_org FROM organizations_projection WHERE id = v_phone.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Organization not found'); END IF;

  IF NOT has_platform_privilege() AND NOT has_effective_permission('organization.update', v_org.path) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  PERFORM api.emit_domain_event(
    p_stream_id := p_phone_id, p_stream_type := 'phone', p_event_type := 'phone.deleted',
    p_event_data := '{}'::jsonb,
    p_event_metadata := jsonb_build_object('user_id', v_user_id, 'organization_id', v_phone.organization_id)
      || CASE WHEN p_reason IS NOT NULL THEN jsonb_build_object('reason', p_reason) ELSE '{}'::jsonb END
  );

  SELECT * INTO v_result FROM phones_projection WHERE id = p_phone_id AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    SELECT processing_error INTO v_processing_error FROM domain_events WHERE stream_id = p_phone_id ORDER BY sequence_number DESC LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_processing_error, 'Phone deletion failed'));
  END IF;

  RETURN jsonb_build_object('success', true, 'phone', jsonb_build_object('id', v_result.id, 'deleted_at', v_result.deleted_at));
END;
$function$;

GRANT EXECUTE ON FUNCTION api.delete_organization_phone(uuid, text) TO authenticated;

-- =============================================================================
-- SECTION 10: Router CASE additions for deletion workflow events
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_organization_event(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type
    WHEN 'organization.created' THEN
      PERFORM handle_organization_created(p_event);
    WHEN 'organization.updated' THEN
      PERFORM handle_organization_updated(p_event);
    WHEN 'organization.subdomain_status.changed' THEN
      PERFORM handle_organization_subdomain_status_changed(p_event);
    WHEN 'organization.activated' THEN
      PERFORM handle_organization_activated(p_event);
    WHEN 'organization.deactivated' THEN
      PERFORM handle_organization_deactivated(p_event);
    WHEN 'organization.reactivated' THEN
      PERFORM handle_organization_reactivated(p_event);
    WHEN 'organization.deleted' THEN
      PERFORM handle_organization_deleted(p_event);
    WHEN 'organization.subdomain.verified' THEN
      PERFORM handle_organization_subdomain_verified(p_event);
    WHEN 'organization.subdomain.dns_created' THEN
      PERFORM handle_organization_subdomain_dns_created(p_event);
    WHEN 'organization.subdomain.failed' THEN
      PERFORM handle_organization_subdomain_failed(p_event);
    WHEN 'organization.direct_care_settings_updated' THEN
      PERFORM handle_organization_direct_care_settings_updated(p_event);
    WHEN 'organization.bootstrap.initiated' THEN
      NULL; -- no-op, handled by bootstrap trigger
    WHEN 'organization.bootstrap.completed' THEN
      PERFORM handle_bootstrap_completed(p_event);
    WHEN 'organization.bootstrap.failed' THEN
      PERFORM handle_bootstrap_failed(p_event);
    WHEN 'organization.bootstrap.cancelled' THEN
      PERFORM handle_bootstrap_cancelled(p_event);
    -- Deletion workflow events (no projection update needed)
    WHEN 'organization.deletion.initiated' THEN
      NULL; -- no-op, Temporal workflow tracking
    WHEN 'organization.deletion.completed' THEN
      NULL; -- no-op, org already marked deleted by organization.deleted event
    -- Forwarding CASE (pre-v15 Edge Function migration paths)
    WHEN 'invitation.resent' THEN
      PERFORM handle_invitation_resent(p_event);
    WHEN 'invitation.email.sent' THEN
      NULL; -- no-op
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_organization_event', p_event.event_type
          USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;
