-- Migration: client_permissions_seed
-- Adds client.discharge permission (Phase B1c).
-- The 4 basic client permissions (create, view, update, delete) already exist in baseline.
-- Pattern: 001-permissions-seed.sql (domain event emission)

-- =============================================================================
-- 1. Seed client.discharge permission via domain event
-- =============================================================================

DO $$ BEGIN
  INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
  VALUES (
    gen_random_uuid(), 'permission', 1, 'permission.defined',
    '{"applet": "client", "action": "discharge", "description": "Discharge clients from care", "scope_type": "org", "requires_mfa": false}'::jsonb,
    '{"user_id": "00000000-0000-0000-0000-000000000000", "reason": "Seed: Client discharge permission (Phase B)"}'::jsonb
  );
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- =============================================================================
-- 2. Add to role_permission_templates (used by bootstrap for new orgs)
-- =============================================================================

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'client.discharge', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('clinician', 'client.discharge', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- =============================================================================
-- 3. Permission implications: discharge → view, discharge → update
-- The standard CRUD pattern (003-permission-implications-seed.sql) only covers
-- create/update/delete → view. discharge is a domain-specific action.
-- =============================================================================

INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'client.discharge' AND p2.name = 'client.view'
ON CONFLICT DO NOTHING;

INSERT INTO permission_implications (permission_id, implies_permission_id)
SELECT p1.id, p2.id
FROM permissions_projection p1, permissions_projection p2
WHERE p1.name = 'client.discharge' AND p2.name = 'client.update'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 4. Backfill: grant client.discharge to already-bootstrapped roles
-- New orgs get it via bootstrap (role_permission_templates).
-- Existing orgs need their provider_admin and clinician roles updated.
-- =============================================================================

-- For each existing org that has a provider_admin role, grant client.discharge
INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
SELECT
    rp.id AS role_id,
    pp.id AS permission_id,
    now()
FROM roles_projection rp
CROSS JOIN permissions_projection pp
WHERE rp.name = 'provider_admin'
  AND rp.is_active = true
  AND pp.name = 'client.discharge'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions_projection rpp
    WHERE rpp.role_id = rp.id AND rpp.permission_id = pp.id
  )
ON CONFLICT DO NOTHING;

-- Same for clinician role
INSERT INTO role_permissions_projection (role_id, permission_id, granted_at)
SELECT
    rp.id AS role_id,
    pp.id AS permission_id,
    now()
FROM roles_projection rp
CROSS JOIN permissions_projection pp
WHERE rp.name = 'clinician'
  AND rp.is_active = true
  AND pp.name = 'client.discharge'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions_projection rpp
    WHERE rpp.role_id = rp.id AND rpp.permission_id = pp.id
  )
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 5. Update authoritative seed file reference
-- =============================================================================

COMMENT ON TABLE "public"."permissions_projection" IS
'CQRS projection of permission.defined events — 41 permissions (was 40, added client.discharge).
Updated 2026-04-06: Added client.discharge for Phase B Client Intake.';
