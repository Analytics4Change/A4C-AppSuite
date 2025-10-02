-- TEMPORARY: Mock Development Organization Seed
-- This seed file creates a mock organization for development and testing
-- before the multi-tenant provisioning system is fully implemented.
--
-- TODO: Remove this file when subdomain-based multi-tenancy is complete
--
-- Purpose:
-- - Provides a valid organization for event system development
-- - Enables testing of event-driven architecture without full tenant system
-- - Fixed UUID for easy reference in development
--
-- Migration Path:
-- When production multi-tenancy is ready:
-- 1. Implement ProductionOrganizationService
-- 2. Set VITE_USE_MOCK_ORGANIZATION=false
-- 3. DELETE FROM organizations WHERE external_id = 'mock-dev-org'

INSERT INTO organizations (
  id,
  external_id,
  name,
  type,
  metadata,
  is_active,
  created_at
) VALUES (
  '00000000-0000-0000-0000-000000000001'::UUID,
  'mock-dev-org',
  'Mock Development Organization',
  'healthcare_facility',
  jsonb_build_object(
    'is_mock', true,
    'note', 'Temporary mock organization for event system development',
    'created_for', 'event-driven-architecture-scaffolding',
    'remove_when', 'multi-tenant provisioning system is complete'
  ),
  true,
  NOW()
) ON CONFLICT (external_id) DO NOTHING;

-- Add reminder comment to organizations table
COMMENT ON TABLE organizations IS 'Multi-tenant organizations synced with Zitadel. NOTE: Contains mock data - organization with external_id "mock-dev-org" is temporary for development.';
