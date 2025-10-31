-- ============================================================================
-- Test Data Setup for Organization Module Integration Testing
-- ============================================================================
--
-- This script creates test data for verifying the frontend integration with
-- deployed Edge Functions. Execute this in Supabase Studio SQL Editor.
--
-- Created: 2025-10-30
-- Purpose: Enable end-to-end testing of organization workflows and invitations
-- ============================================================================

-- ============================================================================
-- 1. Create Test Organization
-- ============================================================================
-- Creates a test organization for invitation testing

INSERT INTO organizations_projection (
  id,
  name,
  slug,
  type,
  subdomain,
  timezone,
  status,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Test Organization',
  'test-org',
  'provider',
  'test',
  'America/New_York',
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

-- Verify insertion
SELECT
  id,
  name,
  slug,
  type,
  subdomain,
  timezone,
  status
FROM organizations_projection
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ============================================================================
-- 2. Create Test Program (Optional - for complete data)
-- ============================================================================
-- Creates a test program linked to the organization

INSERT INTO programs_projection (
  id,
  organization_id,
  name,
  type,
  capacity,
  current_occupancy,
  status,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'Test Residential Program',
  'residential',
  50,
  0,
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

-- Verify insertion
SELECT
  id,
  organization_id,
  name,
  type,
  capacity
FROM programs_projection
WHERE organization_id = '00000000-0000-0000-0000-000000000001';

-- ============================================================================
-- 3. Create Test Contact (Optional - for complete data)
-- ============================================================================
-- Creates a test contact for the organization

INSERT INTO contacts_projection (
  id,
  organization_id,
  first_name,
  last_name,
  email,
  title,
  is_primary,
  status,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000001',
  'Test',
  'Admin',
  'admin@test-org.example.com',
  'Administrator',
  true,
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  updated_at = NOW();

-- Verify insertion
SELECT
  id,
  organization_id,
  first_name,
  last_name,
  email,
  is_primary
FROM contacts_projection
WHERE organization_id = '00000000-0000-0000-0000-000000000001';

-- ============================================================================
-- 4. Create Test Invitation (Valid, Not Expired, Not Accepted)
-- ============================================================================
-- Creates a test invitation for acceptance flow testing

INSERT INTO invitations (
  id,
  token,
  email,
  organization_id,
  expires_at,
  accepted_at,
  created_at
) VALUES (
  '00000000-0000-0000-0000-000000000301',
  'test-invitation-token-123',
  'invited-user@example.com',
  '00000000-0000-0000-0000-000000000001',
  NOW() + INTERVAL '7 days',
  NULL,  -- Not yet accepted
  NOW()
)
ON CONFLICT (token) DO UPDATE SET
  expires_at = EXCLUDED.expires_at,
  accepted_at = NULL;

-- Verify insertion
SELECT
  id,
  token,
  email,
  organization_id,
  expires_at,
  accepted_at,
  (expires_at > NOW()) as is_valid,
  (accepted_at IS NULL) as is_available
FROM invitations
WHERE token = 'test-invitation-token-123';

-- ============================================================================
-- 5. Create Test Invitation (Expired - for error testing)
-- ============================================================================
-- Creates an expired invitation for negative testing

INSERT INTO invitations (
  id,
  token,
  email,
  organization_id,
  expires_at,
  accepted_at,
  created_at
) VALUES (
  '00000000-0000-0000-0000-000000000302',
  'expired-invitation-token-456',
  'expired-user@example.com',
  '00000000-0000-0000-0000-000000000001',
  NOW() - INTERVAL '1 day',  -- Expired yesterday
  NULL,
  NOW() - INTERVAL '8 days'
)
ON CONFLICT (token) DO UPDATE SET
  expires_at = NOW() - INTERVAL '1 day';

-- Verify insertion
SELECT
  id,
  token,
  email,
  expires_at,
  (expires_at > NOW()) as is_valid
FROM invitations
WHERE token = 'expired-invitation-token-456';

-- ============================================================================
-- 6. Create Test Invitation (Already Accepted - for error testing)
-- ============================================================================
-- Creates an already-accepted invitation for negative testing

INSERT INTO invitations (
  id,
  token,
  email,
  organization_id,
  expires_at,
  accepted_at,
  created_at
) VALUES (
  '00000000-0000-0000-0000-000000000303',
  'accepted-invitation-token-789',
  'accepted-user@example.com',
  '00000000-0000-0000-0000-000000000001',
  NOW() + INTERVAL '7 days',
  NOW() - INTERVAL '1 day',  -- Accepted yesterday
  NOW() - INTERVAL '8 days'
)
ON CONFLICT (token) DO UPDATE SET
  accepted_at = NOW() - INTERVAL '1 day';

-- Verify insertion
SELECT
  id,
  token,
  email,
  accepted_at,
  (accepted_at IS NOT NULL) as is_accepted
FROM invitations
WHERE token = 'accepted-invitation-token-789';

-- ============================================================================
-- Summary Query - Verify All Test Data
-- ============================================================================

SELECT 'Organizations' as entity_type, COUNT(*) as count
FROM organizations_projection
WHERE id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 'Programs', COUNT(*)
FROM programs_projection
WHERE organization_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 'Contacts', COUNT(*)
FROM contacts_projection
WHERE organization_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 'Invitations', COUNT(*)
FROM invitations
WHERE token IN (
  'test-invitation-token-123',
  'expired-invitation-token-456',
  'accepted-invitation-token-789'
);

-- ============================================================================
-- Test URLs for Frontend Integration
-- ============================================================================
-- After running this script, you can test with these URLs:
--
-- 1. Valid Invitation:
--    http://localhost:5173/accept-invitation?token=test-invitation-token-123
--    Expected: Shows invitation details, allows acceptance
--
-- 2. Expired Invitation:
--    http://localhost:5173/accept-invitation?token=expired-invitation-token-456
--    Expected: Shows "Invitation has expired" error
--
-- 3. Already Accepted Invitation:
--    http://localhost:5173/accept-invitation?token=accepted-invitation-token-789
--    Expected: Shows "Invitation has already been accepted" error
--
-- 4. Invalid Token:
--    http://localhost:5173/accept-invitation?token=invalid-token-xyz
--    Expected: Shows "Invalid invitation token" error
-- ============================================================================

-- ============================================================================
-- Cleanup (Optional - uncomment to remove test data)
-- ============================================================================
-- Uncomment these lines to remove all test data:

-- DELETE FROM invitations WHERE token LIKE '%token-%';
-- DELETE FROM contacts_projection WHERE organization_id = '00000000-0000-0000-0000-000000000001';
-- DELETE FROM programs_projection WHERE organization_id = '00000000-0000-0000-0000-000000000001';
-- DELETE FROM organizations_projection WHERE id = '00000000-0000-0000-0000-000000000001';
