-- Subdomain provisioning status tracking
-- Used by organizations_projection.subdomain_status column
-- Tracks lifecycle: pending → dns_created → verifying → verified (or failed)

CREATE TYPE subdomain_status AS ENUM (
  'pending',      -- Subdomain provisioning initiated but not started
  'dns_created',  -- Cloudflare DNS record created successfully
  'verifying',    -- DNS verification in progress (polling)
  'verified',     -- DNS verified and subdomain active
  'failed'        -- Provisioning or verification failed
);

COMMENT ON TYPE subdomain_status IS
  'Tracks subdomain provisioning lifecycle for organizations. Workflow: pending → dns_created → verifying → verified (or failed at any stage)';
