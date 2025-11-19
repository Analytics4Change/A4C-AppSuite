-- Organization Event Processing Functions
-- Handles all organization lifecycle events with CQRS-compliant cascade logic
-- Source events: organization.* events in domain_events table

-- Main organization event processor
CREATE OR REPLACE FUNCTION process_organization_event(
  p_event RECORD
) RETURNS VOID AS $$
DECLARE
  v_depth INTEGER;
  v_parent_type TEXT;
  v_deleted_path LTREE;
  v_role_record RECORD;
  v_child_org RECORD;
BEGIN
  CASE p_event.event_type
    
    -- Handle organization creation
    WHEN 'organization.created' THEN
      v_depth := nlevel((p_event.event_data->>'path')::LTREE);
      
      -- For sub-organizations, inherit parent type
      IF v_depth > 2 AND p_event.event_data->>'parent_path' IS NOT NULL THEN
        SELECT type INTO v_parent_type
        FROM organizations_projection 
        WHERE path = (p_event.event_data->>'parent_path')::LTREE;
        
        -- Override type with parent type for inheritance
        p_event.event_data := jsonb_set(p_event.event_data, '{type}', to_jsonb(v_parent_type));
      END IF;
      
      -- Insert into organizations projection
      INSERT INTO organizations_projection (
        id, name, display_name, slug, type, path, parent_path, depth,
        tax_number, phone_number, timezone, metadata, created_at,
        partner_type, referring_partner_id
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'name'),
        safe_jsonb_extract_text(p_event.event_data, 'display_name'),
        safe_jsonb_extract_text(p_event.event_data, 'slug'),
        safe_jsonb_extract_text(p_event.event_data, 'type'),
        (p_event.event_data->>'path')::LTREE,
        CASE
          WHEN p_event.event_data ? 'parent_path'
          THEN (p_event.event_data->>'parent_path')::LTREE
          ELSE NULL
        END,
        nlevel((p_event.event_data->>'path')::LTREE),
        safe_jsonb_extract_text(p_event.event_data, 'tax_number'),
        safe_jsonb_extract_text(p_event.event_data, 'phone_number'),
        COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), 'America/New_York'),
        COALESCE(p_event.event_data->'metadata', '{}'::jsonb),
        p_event.created_at,
        CASE
          WHEN p_event.event_data ? 'partner_type'
          THEN (safe_jsonb_extract_text(p_event.event_data, 'partner_type'))::partner_type
          ELSE NULL
        END,
        safe_jsonb_extract_uuid(p_event.event_data, 'referring_partner_id')
      );

    -- Handle subdomain DNS record creation
    WHEN 'organization.subdomain.dns_created' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'verifying',
        cloudflare_record_id = safe_jsonb_extract_text(p_event.event_data, 'cloudflare_record_id'),
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{dns_record}',
          jsonb_build_object(
            'type', safe_jsonb_extract_text(p_event.event_data, 'dns_record_type'),
            'value', safe_jsonb_extract_text(p_event.event_data, 'dns_record_value'),
            'zone_id', safe_jsonb_extract_text(p_event.event_data, 'cloudflare_zone_id'),
            'created_at', p_event.created_at
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle successful subdomain verification
    WHEN 'organization.subdomain.verified' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'verified',
        dns_verified_at = (p_event.event_data->>'verified_at')::TIMESTAMPTZ,
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{verification}',
          jsonb_build_object(
            'method', safe_jsonb_extract_text(p_event.event_data, 'verification_method'),
            'attempts', (p_event.event_data->>'verification_attempts')::INTEGER,
            'verified_at', p_event.event_data->>'verified_at'
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle subdomain verification failure
    WHEN 'organization.subdomain.verification_failed' THEN
      UPDATE organizations_projection
      SET
        subdomain_status = 'failed',
        subdomain_metadata = jsonb_set(
          COALESCE(subdomain_metadata, '{}'::jsonb),
          '{failure}',
          jsonb_build_object(
            'reason', safe_jsonb_extract_text(p_event.event_data, 'failure_reason'),
            'retry_count', (p_event.event_data->>'retry_count')::INTEGER,
            'will_retry', safe_jsonb_extract_boolean(p_event.event_data, 'will_retry'),
            'failed_at', p_event.created_at
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle business profile creation
    WHEN 'organization.business_profile.created' THEN
      INSERT INTO organization_business_profiles_projection (
        organization_id, organization_type, mailing_address, physical_address,
        provider_profile, partner_profile, created_at
      ) VALUES (
        p_event.stream_id,
        safe_jsonb_extract_text(p_event.event_data, 'organization_type'),
        p_event.event_data->'mailing_address',
        p_event.event_data->'physical_address',
        CASE 
          WHEN safe_jsonb_extract_text(p_event.event_data, 'organization_type') = 'provider'
          THEN p_event.event_data->'provider_profile'
          ELSE NULL
        END,
        CASE 
          WHEN safe_jsonb_extract_text(p_event.event_data, 'organization_type') = 'provider_partner'
          THEN p_event.event_data->'partner_profile'
          ELSE NULL
        END,
        p_event.created_at
      );

    -- Handle organization deactivation
    WHEN 'organization.deactivated' THEN
      -- Update organization status
      UPDATE organizations_projection 
      SET 
        is_active = false,
        deactivated_at = p_event.created_at,
        deactivation_reason = safe_jsonb_extract_text(p_event.event_data, 'deactivation_type'),
        updated_at = p_event.created_at
      WHERE 
        id = p_event.stream_id
        OR (
          safe_jsonb_extract_boolean(p_event.event_data, 'cascade_to_children')
          AND path <@ (SELECT path FROM organizations_projection WHERE id = p_event.stream_id)
        );

      -- If login is blocked, emit user session termination events
      IF safe_jsonb_extract_boolean(p_event.event_data, 'login_blocked') THEN
        -- This would emit user.session.terminated events
        -- Implementation depends on user session management system
        RAISE NOTICE 'Login blocked for organization %, would terminate user sessions', p_event.stream_id;
      END IF;

    -- Handle organization deletion (CQRS-compliant cascade via events)
    WHEN 'organization.deleted' THEN
      v_deleted_path := (p_event.event_data->>'deleted_path')::LTREE;
      
      -- Mark organization as deleted (logical delete)
      UPDATE organizations_projection 
      SET 
        deleted_at = p_event.created_at,
        deletion_reason = safe_jsonb_extract_text(p_event.event_data, 'deletion_strategy'),
        is_active = false,
        updated_at = p_event.created_at
      WHERE path::LTREE <@ v_deleted_path OR path = v_deleted_path;

      -- CQRS-COMPLIANT CASCADE: Emit role.deleted events for affected roles
      -- Only emit events, do NOT directly update role projections
      FOR v_role_record IN (
        SELECT id, name, org_hierarchy_scope 
        FROM roles_projection 
        WHERE 
          org_hierarchy_scope::LTREE <@ v_deleted_path         -- At or below deleted path
          OR v_deleted_path <@ org_hierarchy_scope::LTREE      -- Deleted path is child of role scope
      ) LOOP
        INSERT INTO domain_events (
          stream_id, stream_type, event_type, event_data, event_metadata, created_at
        ) VALUES (
          v_role_record.id,
          'role',
          'role.deleted',
          jsonb_build_object(
            'role_name', v_role_record.name,
            'org_hierarchy_scope', v_role_record.org_hierarchy_scope,
            'deletion_reason', 'organization_deleted',
            'organization_deletion_event_id', p_event.id
          ),
          jsonb_build_object(
            'user_id', p_event.event_metadata->>'user_id',
            'reason', format('Role %s deleted because organizational scope %s was deleted', 
                            v_role_record.name, v_role_record.org_hierarchy_scope),
            'automated', true
          ),
          p_event.created_at
        );
      END LOOP;

      -- Emit organization.deleted events for child organizations
      FOR v_child_org IN (
        SELECT id, path
        FROM organizations_projection
        WHERE path <@ v_deleted_path AND path != v_deleted_path AND deleted_at IS NULL
      ) LOOP
        INSERT INTO domain_events (
          stream_id, stream_type, event_type, event_data, event_metadata, created_at
        ) VALUES (
          v_child_org.id,
          'organization',
          'organization.deleted',
          jsonb_build_object(
            'organization_id', v_child_org.id,
            'deleted_path', v_child_org.path,
            'deletion_strategy', 'cascade_delete',
            'cascade_confirmed', true,
            'parent_deletion_event_id', p_event.id
          ),
          jsonb_build_object(
            'user_id', p_event.event_metadata->>'user_id',
            'reason', format('Child organization %s deleted due to parent organization deletion', v_child_org.path),
            'automated', true
          ),
          p_event.created_at
        );
      END LOOP;

    -- Handle organization reactivation
    WHEN 'organization.reactivated' THEN
      UPDATE organizations_projection 
      SET 
        is_active = true,
        deactivated_at = NULL,
        deactivation_reason = NULL,
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle organization updates
    WHEN 'organization.updated' THEN
      UPDATE organizations_projection 
      SET 
        name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'name'), name),
        display_name = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'display_name'), display_name),
        phone_number = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'phone_number'), phone_number),
        timezone = COALESCE(safe_jsonb_extract_text(p_event.event_data, 'timezone'), timezone),
        metadata = COALESCE(p_event.event_data->'metadata', metadata),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    -- Handle business profile updates
    WHEN 'organization.business_profile.updated' THEN
      UPDATE organization_business_profiles_projection 
      SET 
        mailing_address = COALESCE(p_event.event_data->'mailing_address', mailing_address),
        physical_address = COALESCE(p_event.event_data->'physical_address', physical_address),
        provider_profile = CASE 
          WHEN organization_type = 'provider' 
          THEN COALESCE(p_event.event_data->'provider_profile', provider_profile)
          ELSE provider_profile
        END,
        partner_profile = CASE 
          WHEN organization_type = 'provider_partner'
          THEN COALESCE(p_event.event_data->'partner_profile', partner_profile)
          ELSE partner_profile
        END,
        updated_at = p_event.created_at
      WHERE organization_id = p_event.stream_id;

    -- Handle bootstrap events (CQRS-compliant - no direct DB operations)
    WHEN 'organization.bootstrap.initiated' THEN
      -- Bootstrap initiation: Log and prepare for next stages
      -- Note: This event triggers the bootstrap orchestrator externally
      RAISE NOTICE 'Bootstrap initiated for org %, bootstrap_id: %',
        p_event.stream_id,
        p_event.event_data->>'bootstrap_id';

    WHEN 'organization.bootstrap.completed' THEN
      -- Bootstrap completion: Update organization metadata
      UPDATE organizations_projection 
      SET 
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{bootstrap}',
          jsonb_build_object(
            'bootstrap_id', p_event.event_data->>'bootstrap_id',
            'completed_at', p_event.created_at,
            'admin_role', p_event.event_data->>'admin_role_assigned',
            'permissions_granted', (p_event.event_data->>'permissions_granted')::INTEGER
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'organization.bootstrap.failed' THEN
      -- Bootstrap failure: Mark organization for cleanup if created
      UPDATE organizations_projection 
      SET 
        is_active = false,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'),
          '{bootstrap}',
          jsonb_build_object(
            'bootstrap_id', p_event.event_data->>'bootstrap_id',
            'failed_at', p_event.created_at,
            'failure_stage', p_event.event_data->>'failure_stage',
            'error_message', p_event.event_data->>'error_message'
          )
        ),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

    WHEN 'organization.bootstrap.cancelled' THEN
      -- Bootstrap cancellation: Final cleanup completed
      -- For cancelled bootstraps, organization may not exist in projection yet
      IF EXISTS (SELECT 1 FROM organizations_projection WHERE id = p_event.stream_id) THEN
        UPDATE organizations_projection 
        SET 
          deleted_at = p_event.created_at,
          deletion_reason = 'bootstrap_cancelled',
          is_active = false,
          metadata = jsonb_set(
            COALESCE(metadata, '{}'),
            '{bootstrap}',
            jsonb_build_object(
              'bootstrap_id', p_event.event_data->>'bootstrap_id',
              'cancelled_at', p_event.created_at,
              'cleanup_completed', p_event.event_data->>'cleanup_completed'
            )
          ),
          updated_at = p_event.created_at
        WHERE id = p_event.stream_id;
      END IF;

    ELSE
      RAISE WARNING 'Unknown organization event type: %', p_event.event_type;
  END CASE;

END;
$$ LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp;

-- Helper function to validate organization path hierarchy
CREATE OR REPLACE FUNCTION validate_organization_hierarchy(
  p_path LTREE,
  p_parent_path LTREE
) RETURNS BOOLEAN AS $$
BEGIN
  -- Root organizations (depth 2) should have no parent
  IF nlevel(p_path) = 2 THEN
    RETURN p_parent_path IS NULL;
  END IF;
  
  -- Sub-organizations must have valid parent
  IF nlevel(p_path) > 2 THEN
    IF p_parent_path IS NULL THEN
      RETURN false;
    END IF;
    
    -- Check that parent exists
    IF NOT EXISTS (SELECT 1 FROM organizations_projection WHERE path = p_parent_path) THEN
      RETURN false;
    END IF;
    
    -- Check that path is properly nested under parent
    RETURN p_path <@ p_parent_path;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to get organization hierarchy for queries
CREATE OR REPLACE FUNCTION get_organization_descendants(
  p_org_path LTREE
) RETURNS TABLE (
  id UUID,
  name TEXT,
  path LTREE,
  depth INTEGER,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.name, o.path, o.depth, o.is_active
  FROM organizations_projection o
  WHERE o.path <@ p_org_path
    AND o.deleted_at IS NULL
  ORDER BY o.path;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Function to get organization ancestors
CREATE OR REPLACE FUNCTION get_organization_ancestors(
  p_org_path LTREE
) RETURNS TABLE (
  id UUID,
  name TEXT,
  path LTREE,
  depth INTEGER,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.name, o.path, o.depth, o.is_active
  FROM organizations_projection o
  WHERE p_org_path <@ o.path
    AND o.deleted_at IS NULL
  ORDER BY o.depth;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, extensions, pg_temp;

-- Comments for documentation
COMMENT ON FUNCTION process_organization_event IS 
  'Main organization event processor - handles creation, updates, deactivation, deletion with CQRS-compliant cascade logic';
COMMENT ON FUNCTION validate_organization_hierarchy IS 
  'Validates that organization path structure follows ltree hierarchy rules';
COMMENT ON FUNCTION get_organization_descendants IS 
  'Returns all active descendant organizations for a given organization path';
COMMENT ON FUNCTION get_organization_ancestors IS 
  'Returns all ancestor organizations for a given organization path';