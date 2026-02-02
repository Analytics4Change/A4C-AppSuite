-- ============================================
-- AUTHORITATIVE ROLE PERMISSION TEMPLATES SEED FILE
-- ============================================
-- This file defines bootstrap role permission templates for the A4C platform.
-- These templates are used during organization bootstrap to assign default
-- permissions to standard roles.
--
-- IMPORTANT: This is the SINGLE SOURCE OF TRUTH for role permission templates.
-- DB is authoritative - regenerate this file if DB changes.
--
-- Last Updated: 2026-02-02
-- Source: Generated from production DB during Day 0 v3 reconciliation
-- Changes:
--   - 2026-02-02: Added user.schedule_manage, user.client_assign to provider_admin (Phase 7)
-- ============================================

-- ============================================
-- CLINICIAN ROLE (4 permissions)
-- Basic clinical staff with client and medication access
-- ============================================

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('clinician', 'client.update', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('clinician', 'client.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('clinician', 'medication.create', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('clinician', 'medication.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- ============================================
-- PARTNER_ADMIN ROLE (4 permissions)
-- VAR partner administrators with limited view access
-- ============================================

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('partner_admin', 'client.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('partner_admin', 'medication.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('partner_admin', 'organization.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('partner_admin', 'user.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- ============================================
-- PROVIDER_ADMIN ROLE (29 permissions)
-- Full organization administrator with all org-scoped permissions
-- ============================================

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'client.create', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'client.delete', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'client.update', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'client.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'medication.administer', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'medication.create', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'medication.delete', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'medication.update', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'medication.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.create_ou', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.deactivate_ou', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.delete_ou', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.reactivate_ou', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.update', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.update_ou', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'organization.view_ou', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'role.create', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'role.delete', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'role.update', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'role.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.create', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.delete', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.role_assign', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.role_revoke', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.update', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.schedule_manage', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('provider_admin', 'user.client_assign', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

-- ============================================
-- VIEWER ROLE (3 permissions)
-- Read-only access to basic data
-- ============================================

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('viewer', 'client.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('viewer', 'medication.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;

INSERT INTO role_permission_templates (role_name, permission_name, is_active)
VALUES ('viewer', 'user.view', true)
ON CONFLICT (role_name, permission_name) DO NOTHING;
