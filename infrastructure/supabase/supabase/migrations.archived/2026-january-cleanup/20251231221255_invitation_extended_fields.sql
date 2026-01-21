-- Migration: Invitation extended fields
-- Purpose: Add access dates and notification preferences to invitations
-- These values are copied to user_org_access when invitation is accepted

-------------------------------------------------------------------------------
-- 1. Add access date columns to invitations_projection
-------------------------------------------------------------------------------

-- Access start date (when user can first access the org)
ALTER TABLE public.invitations_projection
    ADD COLUMN IF NOT EXISTS access_start_date date DEFAULT NULL;

COMMENT ON COLUMN public.invitations_projection.access_start_date
    IS 'First date the invited user can access the org after accepting (NULL = immediate)';

-- Access expiration date (when user access will be revoked)
ALTER TABLE public.invitations_projection
    ADD COLUMN IF NOT EXISTS access_expiration_date date DEFAULT NULL;

COMMENT ON COLUMN public.invitations_projection.access_expiration_date
    IS 'Date the invited user access will expire (NULL = no expiration)';

-------------------------------------------------------------------------------
-- 2. Add notification preferences column to invitations_projection
-------------------------------------------------------------------------------

ALTER TABLE public.invitations_projection
    ADD COLUMN IF NOT EXISTS notification_preferences jsonb DEFAULT '{
        "email": true,
        "sms": { "enabled": false, "phone_id": null },
        "in_app": false
    }'::jsonb NOT NULL;

COMMENT ON COLUMN public.invitations_projection.notification_preferences
    IS 'Initial notification preferences for the user (copied to user_org_access on acceptance)';

-------------------------------------------------------------------------------
-- 3. Add constraint: access_start_date must be before access_expiration_date
-------------------------------------------------------------------------------

-- Drop constraint if exists for idempotency, then recreate
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'invitations_date_order_check'
        AND conrelid = 'public.invitations_projection'::regclass
    ) THEN
        ALTER TABLE public.invitations_projection
            DROP CONSTRAINT invitations_date_order_check;
    END IF;
END $$;

ALTER TABLE public.invitations_projection
    ADD CONSTRAINT invitations_date_order_check CHECK (
        access_start_date IS NULL
        OR access_expiration_date IS NULL
        OR access_start_date <= access_expiration_date
    );

-------------------------------------------------------------------------------
-- 4. Indexes for new fields
-------------------------------------------------------------------------------

-- Index for finding invitations with access restrictions
CREATE INDEX IF NOT EXISTS idx_invitations_with_access_dates
    ON public.invitations_projection (organization_id, status)
    WHERE access_start_date IS NOT NULL OR access_expiration_date IS NOT NULL;
