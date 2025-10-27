-- Bootstrap Organization & Roles
-- Creates the A4C platform organization and core role templates

-- ============================================================================
-- A4C Platform Organization
-- ============================================================================

-- Create Analytics4Change platform organization via event
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'organization', 1, 'organization.registered',
   '{
     "name": "Analytics4Change",
     "slug": "a4c",
     "org_type": "platform_owner",
     "parent_org_id": null,
     "zitadel_org_id": "339658157368404786",
     "settings": {
       "is_active": true,
       "is_internal": true,
       "description": "Platform owner organization"
     }
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating A4C platform organization"
   }'::jsonb);

-- Create organization projection manually (no organization event processor yet in minimal bootstrap)
INSERT INTO organizations_projection (
  id,
  name,
  slug,
  type,
  path,
  parent_path,
  is_active,
  created_at
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Analytics4Change',
  'a4c',
  'platform_owner',
  'a4c'::LTREE,
  NULL,
  true,
  NOW()
);

-- Create Zitadel organization mapping
INSERT INTO zitadel_organization_mapping (
  internal_org_id,
  zitadel_org_id,
  org_name,
  created_at
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '339658157368404786',
  'Analytics4Change',
  NOW()
);


-- ============================================================================
-- Core Role Templates
-- ============================================================================

-- Super Admin Role (global scope, NULL org_id for platform-wide access)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'role', 1, 'role.created',
   '{
     "name": "super_admin",
     "description": "Platform administrator who manages tenant onboarding and permissions"
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating super_admin role for A4C platform staff"
   }'::jsonb);

-- Provider Admin Role Template (permissions granted per organization during provisioning)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('22222222-2222-2222-2222-222222222222', 'role', 1, 'role.created',
   '{
     "name": "provider_admin",
     "description": "Organization administrator who manages their provider organization (permissions granted during org provisioning)"
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating provider_admin role template"
   }'::jsonb);

-- Partner Admin Role Template (permissions granted per organization during provisioning)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('33333333-3333-3333-3333-333333333333', 'role', 1, 'role.created',
   '{
     "name": "partner_admin",
     "description": "Provider partner administrator who manages cross-tenant access (permissions granted during org provisioning)"
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating partner_admin role template"
   }'::jsonb);


-- ============================================================================
-- Notes
-- ============================================================================

-- Provider Admin and Partner Admin roles have NO permissions at this stage
-- Permissions are granted during organization provisioning workflows
-- This ensures proper scoping: provider_admin manages their org, not others
--
-- Super Admin is assigned all 22 permissions in the next seed file
