-- =============================================================================
-- Migration: Fix domain_events RLS Initplan Policies
-- Purpose: Wrap current_setting() calls with (SELECT ...) for per-query
--          evaluation instead of per-row evaluation
-- Reference: Supabase advisor - "Auth RLS Initplan" warning
-- =============================================================================

-- Fix domain_events_authenticated_insert - wrap current_setting()
DROP POLICY IF EXISTS "domain_events_authenticated_insert" ON domain_events;
CREATE POLICY "domain_events_authenticated_insert" ON domain_events
FOR INSERT WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL
  AND (
    has_platform_privilege()
    OR ((event_metadata ->> 'organization_id')::uuid = (SELECT (current_setting('request.jwt.claims', true))::jsonb ->> 'org_id')::uuid)
  )
  AND length(event_metadata ->> 'reason') >= 10
);

-- Fix domain_events_org_select - wrap current_setting()
DROP POLICY IF EXISTS "domain_events_org_select" ON domain_events;
CREATE POLICY "domain_events_org_select" ON domain_events
FOR SELECT USING (
  (SELECT auth.uid()) IS NOT NULL
  AND (
    has_platform_privilege()
    OR ((event_metadata ->> 'organization_id')::uuid = (SELECT (current_setting('request.jwt.claims', true))::jsonb ->> 'org_id')::uuid)
  )
);

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
