-- Fix: Grant SELECT on schedule/assignment projections and users table
-- These tables have RLS enabled with proper policies but were missing
-- table-level GRANT SELECT, causing "permission denied" errors when
-- accessed via SECURITY INVOKER functions.

GRANT SELECT ON TABLE public.user_schedule_policies_projection TO authenticated;
GRANT SELECT ON TABLE public.user_schedule_policies_projection TO service_role;

GRANT SELECT ON TABLE public.user_client_assignments_projection TO authenticated;
GRANT SELECT ON TABLE public.user_client_assignments_projection TO service_role;

GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT ON TABLE public.users TO service_role;
