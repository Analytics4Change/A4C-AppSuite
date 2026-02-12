-- =============================================================================
-- Migration: Enable Realtime for user_roles_projection
-- Purpose: Allow frontend to detect role changes and trigger JWT refresh
-- Part of: Multi-Role Authorization Phase 5 (Frontend Integration)
-- =============================================================================

-- Publish user_roles_projection to Supabase Realtime so the frontend
-- SupabaseAuthProvider can subscribe to changes for the current user.
-- When a role assignment changes, the frontend debounces and calls
-- refreshSession() to get an updated JWT with new effective_permissions.

DO $$
BEGIN
  -- Only add if not already published
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_roles_projection'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.user_roles_projection;
    RAISE NOTICE 'Added user_roles_projection to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'user_roles_projection already in supabase_realtime publication';
  END IF;
END $$;
