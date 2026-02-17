-- Add ON DELETE CASCADE to user FK references that are missing it.
-- Context: 6 of 8 tables referencing public.users already use ON DELETE CASCADE.
-- These two are the outliers. Note: public.users uses soft-delete (deleted_at).
-- CASCADE only triggers on hard-delete; soft-delete cleanup is handled by event handlers.

ALTER TABLE "public"."user_schedule_policies_projection"
    DROP CONSTRAINT IF EXISTS "user_schedule_policies_projection_user_id_fkey";
ALTER TABLE "public"."user_schedule_policies_projection"
    ADD CONSTRAINT "user_schedule_policies_projection_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."user_client_assignments_projection"
    DROP CONSTRAINT IF EXISTS "user_client_assignments_projection_user_id_fkey";
ALTER TABLE "public"."user_client_assignments_projection"
    ADD CONSTRAINT "user_client_assignments_projection_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
