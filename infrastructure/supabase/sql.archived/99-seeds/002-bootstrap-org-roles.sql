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
     "settings": {
       "is_active": true,
       "is_internal": true,
       "description": "Platform owner organization"
     }
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating A4C platform organization"
   }'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

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
  'root.a4c'::LTREE,
  NULL,
  true,
  NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- Core Role Templates
-- ============================================================================

-- Super Admin Role (global scope, NULL org_id for platform-wide access)
-- This is the ONLY role seeded as global - all other roles are per-organization
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata) VALUES
  ('11111111-1111-1111-1111-111111111111', 'role', 1, 'role.created',
   '{
     "name": "super_admin",
     "description": "Platform administrator who manages tenant onboarding and permissions"
   }'::jsonb,
   '{
     "user_id": "00000000-0000-0000-0000-000000000000",
     "reason": "Bootstrap: Creating super_admin role for A4C platform staff"
   }'::jsonb)
ON CONFLICT (stream_id, stream_type, stream_version) DO NOTHING;

-- NOTE: provider_admin and partner_admin roles are NOT seeded as global roles
-- They are created per-organization during the organization bootstrap workflow
-- with proper organization_id and org_hierarchy_scope set.
-- See: workflows/src/activities/organization-bootstrap/grant-provider-admin-permissions.ts
-- Template permissions for these roles are defined in: role_permission_templates table


-- ============================================================================
-- Notes
-- ============================================================================

-- Role Scoping Architecture:
-- - super_admin: Global scope (organization_id=NULL, org_hierarchy_scope=NULL)
--   Created once at platform bootstrap, assigned all permissions globally
--
-- - provider_admin, partner_admin, clinician, viewer: Per-organization scope
--   Created during organization bootstrap workflow with organization_id and
--   org_hierarchy_scope set. This ensures proper multi-tenant isolation.
--
-- Permission Templates:
-- - Templates for each role type are stored in role_permission_templates table
-- - Bootstrap workflow queries templates and grants permissions to new roles
-- - Platform owners can modify templates to customize future org bootstraps
--
-- Super Admin is assigned all permissions in the next seed file
