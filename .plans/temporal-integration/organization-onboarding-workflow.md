# Organization Onboarding Workflow - Temporal Implementation

**Status**: ✅ Primary workflow for organization bootstrap
**Priority**: Critical - Core business process
**Pattern**: Workflow-First with Event-Driven Activities

---

## Table of Contents

1. [Overview](#overview)
2. [Workflow Definition](#workflow-definition)
3. [Activities Implementation](#activities-implementation)
4. [Event Emission](#event-emission)
5. [Error Handling and Compensation](#error-handling-and-compensation)
6. [Testing](#testing)
7. [Deployment](#deployment)

---

## Overview

The Organization Onboarding Workflow orchestrates the complete bootstrap process for new provider and partner organizations, including:

1. **Organization Creation**: Emit event to create organization record
2. **DNS Configuration**: Provision subdomain via Cloudflare API
3. **DNS Propagation Wait**: Durable timer (5-30 minutes)
4. **DNS Verification**: Confirm subdomain resolves correctly
5. **User Invitations**: Generate secure invitation tokens
6. **Email Delivery**: Send invitation emails to users
7. **Organization Activation**: Mark organization as active

**Key Characteristics**:
- **Duration**: 10-40 minutes (depends on DNS propagation)
- **Durability**: Survives worker crashes and restarts
- **Retry Logic**: Automatic retries with exponential backoff
- **Compensation**: Saga pattern for rollback on failures
- **Observability**: Complete execution history in Temporal Web UI

---

## Workflow Definition

### Workflow Interface

```typescript
// File: temporal/src/workflows/organization/bootstrap-workflow.ts

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../../activities/organization'

// Proxy activities with retry policies
const {
  createOrganizationActivity,
  configureDNSActivity,
  verifyDNSActivity,
  generateInvitationsActivity,
  sendInvitationEmailsActivity,
  activateOrganizationActivity,
  // Compensation activities
  removeDNSActivity,
  deactivateOrganizationActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3
  }
})

export interface OrganizationBootstrapParams {
  orgData: {
    name: string
    type: 'provider' | 'partner'
    parentOrgId?: string // For partner organizations
    contactEmail: string
  }
  subdomain: string // e.g., "acme-healthcare"
  users: Array<{
    email: string
    firstName: string
    lastName: string
    role: 'provider_admin' | 'organization_member'
  }>
  dnsPropagationTimeout?: number // Optional, default 30 minutes
}

export interface OrganizationBootstrapResult {
  orgId: string
  domain: string
  dnsConfigured: boolean
  invitationsSent: number
  errors?: string[]
}

export async function OrganizationBootstrapWorkflow(
  params: OrganizationBootstrapParams
): Promise<OrganizationBootstrapResult> {
  const result: OrganizationBootstrapResult = {
    orgId: '',
    domain: '',
    dnsConfigured: false,
    invitationsSent: 0,
    errors: []
  }

  let orgCreated = false
  let dnsConfigured = false

  try {
    // ========================================
    // STEP 1: Create Organization
    // ========================================
    console.log('[WORKFLOW] Creating organization:', params.orgData.name)

    result.orgId = await createOrganizationActivity({
      name: params.orgData.name,
      type: params.orgData.type,
      parentOrgId: params.orgData.parentOrgId,
      contactEmail: params.orgData.contactEmail,
      subdomain: params.subdomain
    })

    orgCreated = true
    console.log('[WORKFLOW] Organization created:', result.orgId)

    // ========================================
    // STEP 2: Configure DNS Subdomain
    // ========================================
    console.log('[WORKFLOW] Configuring DNS for subdomain:', params.subdomain)

    const dnsResult = await configureDNSActivity({
      orgId: result.orgId,
      subdomain: params.subdomain,
      targetDomain: 'firstovertheline.com' // Base domain
    })

    result.domain = dnsResult.fqdn
    dnsConfigured = true
    console.log('[WORKFLOW] DNS configured:', result.domain)

    // ========================================
    // STEP 3: Wait for DNS Propagation
    // ========================================
    // Durable sleep - workflow can be paused and resumed
    const propagationWait = 5 * 60 * 1000 // 5 minutes in milliseconds
    console.log('[WORKFLOW] Waiting for DNS propagation:', propagationWait / 1000, 'seconds')
    await sleep(propagationWait)

    // ========================================
    // STEP 4: Verify DNS Resolution
    // ========================================
    console.log('[WORKFLOW] Verifying DNS resolution for:', result.domain)

    const maxRetries = 6 // Total wait: 5 min initial + (6 * 5 min) = 35 minutes max
    const retryDelay = 5 * 60 * 1000 // 5 minutes between retries

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await verifyDNSActivity({ domain: result.domain })
        result.dnsConfigured = true
        console.log('[WORKFLOW] DNS verified successfully on attempt', attempt)
        break
      } catch (error) {
        if (attempt === maxRetries) {
          throw new Error(`DNS verification failed after ${maxRetries} attempts`)
        }
        console.log(`[WORKFLOW] DNS not ready, retrying in ${retryDelay / 1000}s (attempt ${attempt}/${maxRetries})`)
        await sleep(retryDelay)
      }
    }

    // ========================================
    // STEP 5: Generate User Invitations
    // ========================================
    console.log('[WORKFLOW] Generating invitations for', params.users.length, 'users')

    const invitations = await generateInvitationsActivity({
      orgId: result.orgId,
      users: params.users
    })

    console.log('[WORKFLOW] Generated', invitations.length, 'invitations')

    // ========================================
    // STEP 6: Send Invitation Emails
    // ========================================
    console.log('[WORKFLOW] Sending invitation emails')

    const emailResults = await sendInvitationEmailsActivity({
      orgId: result.orgId,
      invitations: invitations,
      domain: result.domain
    })

    result.invitationsSent = emailResults.successCount

    if (emailResults.failures.length > 0) {
      result.errors = emailResults.failures.map(f =>
        `Failed to send email to ${f.email}: ${f.error}`
      )
      console.warn('[WORKFLOW] Some emails failed:', result.errors)
    }

    // ========================================
    // STEP 7: Activate Organization
    // ========================================
    console.log('[WORKFLOW] Activating organization')

    await activateOrganizationActivity({ orgId: result.orgId })

    console.log('[WORKFLOW] Organization bootstrap completed successfully')
    return result

  } catch (error) {
    console.error('[WORKFLOW] Error during bootstrap:', error)

    // ========================================
    // COMPENSATION: Rollback Completed Steps
    // ========================================
    console.log('[WORKFLOW] Starting compensation...')

    try {
      // Remove DNS if it was configured
      if (dnsConfigured) {
        console.log('[WORKFLOW] Compensating: Removing DNS configuration')
        await removeDNSActivity({
          subdomain: params.subdomain
        })
      }

      // Deactivate organization if it was created
      if (orgCreated && result.orgId) {
        console.log('[WORKFLOW] Compensating: Deactivating organization')
        await deactivateOrganizationActivity({
          orgId: result.orgId
        })
      }

      console.log('[WORKFLOW] Compensation completed')
    } catch (compensationError) {
      console.error('[WORKFLOW] Compensation failed:', compensationError)
      // Log but don't throw - original error is more important
    }

    throw error // Re-throw original error for Temporal to record
  }
}
```

---

## Activities Implementation

### Activity 1: Create Organization

```typescript
// File: temporal/src/activities/organization/create-organization.ts

import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Service role for admin operations
)

export interface CreateOrganizationParams {
  name: string
  type: 'provider' | 'partner'
  parentOrgId?: string
  contactEmail: string
  subdomain: string
}

export async function createOrganizationActivity(
  params: CreateOrganizationParams
): Promise<string> {
  const orgId = uuidv4()

  // Build ltree path
  let path: string
  if (params.type === 'provider') {
    // Top-level provider: path = subdomain
    path = params.subdomain
  } else {
    // Partner organization: path = parent.subdomain
    if (!params.parentOrgId) {
      throw new Error('Partner organizations must have a parent')
    }

    // Get parent path
    const { data: parent } = await supabase
      .from('organizations_projection')
      .select('path')
      .eq('org_id', params.parentOrgId)
      .single()

    if (!parent) {
      throw new Error(`Parent organization not found: ${params.parentOrgId}`)
    }

    path = `${parent.path}.${params.subdomain}`
  }

  // Get workflow context for event metadata
  const workflowInfo = Context.current().info

  // Emit OrganizationCreated event
  const { error: eventError } = await supabase
    .from('domain_events')
    .insert({
      event_type: 'OrganizationCreated',
      aggregate_type: 'Organization',
      aggregate_id: orgId,
      event_data: {
        org_id: orgId,
        name: params.name,
        type: params.type,
        parent_org_id: params.parentOrgId || null,
        contact_email: params.contactEmail,
        domain: `${params.subdomain}.firstovertheline.com`,
        path: path,
        is_active: false // Activated after full bootstrap
      },
      metadata: {
        workflow_id: workflowInfo.workflowId,
        workflow_run_id: workflowInfo.runId,
        workflow_type: workflowInfo.workflowType,
        activity_id: workflowInfo.activityId
      }
    })

  if (eventError) {
    throw new Error(`Failed to emit OrganizationCreated event: ${eventError.message}`)
  }

  console.log(`[ACTIVITY] Emitted OrganizationCreated event for org: ${orgId}`)

  // Event processor will update organizations_projection table
  return orgId
}
```

### Activity 2: Configure DNS

```typescript
// File: temporal/src/activities/organization/configure-dns.ts

import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'
import Cloudflare from 'cloudflare'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const cloudflare = new Cloudflare({
  apiToken: process.env.CLOUDFLARE_API_TOKEN!
})

export interface ConfigureDNSParams {
  orgId: string
  subdomain: string
  targetDomain: string // e.g., "firstovertheline.com"
}

export interface ConfigureDNSResult {
  fqdn: string // e.g., "acme-healthcare.firstovertheline.com"
  recordId: string // Cloudflare DNS record ID
}

export async function configureDNSActivity(
  params: ConfigureDNSParams
): Promise<ConfigureDNSResult> {

  const fqdn = `${params.subdomain}.${params.targetDomain}`

  // Get zone ID for target domain
  const zones = await cloudflare.zones.list({ name: params.targetDomain })
  if (!zones.result || zones.result.length === 0) {
    throw new Error(`Zone not found for domain: ${params.targetDomain}`)
  }
  const zoneId = zones.result[0].id

  // Create CNAME record pointing to app load balancer
  const record = await cloudflare.dns.records.create(zoneId, {
    type: 'CNAME',
    name: params.subdomain,
    content: 'app.firstovertheline.com', // Load balancer/ingress
    proxied: true, // Cloudflare proxy for SSL/CDN
    ttl: 1 // Auto TTL (proxied)
  })

  console.log(`[ACTIVITY] Created DNS record: ${fqdn} -> ${record.result.content}`)

  // Emit DNSConfigured event
  const workflowInfo = Context.current().info
  const { error: eventError } = await supabase
    .from('domain_events')
    .insert({
      event_type: 'DNSConfigured',
      aggregate_type: 'Organization',
      aggregate_id: params.orgId,
      event_data: {
        org_id: params.orgId,
        subdomain: params.subdomain,
        fqdn: fqdn,
        cloudflare_record_id: record.result.id,
        proxied: true
      },
      metadata: {
        workflow_id: workflowInfo.workflowId,
        workflow_run_id: workflowInfo.runId,
        workflow_type: workflowInfo.workflowType
      }
    })

  if (eventError) {
    // DNS created but event failed - log for manual cleanup
    console.error(`[ACTIVITY] Failed to emit DNSConfigured event: ${eventError.message}`)
    console.error(`[ACTIVITY] Manual cleanup may be required for DNS record: ${fqdn}`)
    throw new Error(`Failed to emit DNSConfigured event: ${eventError.message}`)
  }

  return {
    fqdn,
    recordId: record.result.id
  }
}
```

### Activity 3: Verify DNS

```typescript
// File: temporal/src/activities/organization/verify-dns.ts

import { promises as dns } from 'dns'

export interface VerifyDNSParams {
  domain: string
}

export async function verifyDNSActivity(params: VerifyDNSParams): Promise<void> {
  try {
    // Resolve CNAME record
    const addresses = await dns.resolve(params.domain, 'CNAME')

    if (addresses.length === 0) {
      throw new Error('DNS record not found')
    }

    console.log(`[ACTIVITY] DNS verified: ${params.domain} -> ${addresses[0]}`)

    // Optionally verify it points to correct target
    const expectedTarget = 'app.firstovertheline.com'
    if (!addresses.some(addr => addr.includes(expectedTarget))) {
      throw new Error(`DNS points to unexpected target: ${addresses[0]}`)
    }

  } catch (error) {
    console.log(`[ACTIVITY] DNS verification failed for ${params.domain}:`, error)
    throw new Error(`DNS not ready: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
```

### Activity 4: Generate Invitations

```typescript
// File: temporal/src/activities/organization/generate-invitations.ts

import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { randomBytes } from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface GenerateInvitationsParams {
  orgId: string
  users: Array<{
    email: string
    firstName: string
    lastName: string
    role: string
  }>
}

export interface Invitation {
  invitationId: string
  email: string
  token: string
  expiresAt: Date
}

export async function generateInvitationsActivity(
  params: GenerateInvitationsParams
): Promise<Invitation[]> {

  const invitations: Invitation[] = []
  const workflowInfo = Context.current().info

  for (const user of params.users) {
    const invitationId = uuidv4()
    const token = randomBytes(32).toString('base64url') // URL-safe token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    // Emit UserInvited event
    const { error: eventError } = await supabase
      .from('domain_events')
      .insert({
        event_type: 'UserInvited',
        aggregate_type: 'User',
        aggregate_id: invitationId,
        event_data: {
          invitation_id: invitationId,
          org_id: params.orgId,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          role: user.role,
          token: token,
          expires_at: expiresAt.toISOString(),
          status: 'pending'
        },
        metadata: {
          workflow_id: workflowInfo.workflowId,
          workflow_run_id: workflowInfo.runId,
          workflow_type: workflowInfo.workflowType
        }
      })

    if (eventError) {
      console.error(`[ACTIVITY] Failed to emit UserInvited event for ${user.email}:`, eventError)
      throw new Error(`Failed to emit UserInvited event: ${eventError.message}`)
    }

    invitations.push({
      invitationId,
      email: user.email,
      token,
      expiresAt
    })

    console.log(`[ACTIVITY] Generated invitation for: ${user.email}`)
  }

  return invitations
}
```

### Activity 5: Send Invitation Emails

```typescript
// File: temporal/src/activities/organization/send-invitation-emails.ts

import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import type { Invitation } from './generate-invitations'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Configure email transport (example: SMTP)
const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

export interface SendInvitationEmailsParams {
  orgId: string
  invitations: Invitation[]
  domain: string
}

export interface SendInvitationEmailsResult {
  successCount: number
  failures: Array<{ email: string; error: string }>
}

export async function sendInvitationEmailsActivity(
  params: SendInvitationEmailsParams
): Promise<SendInvitationEmailsResult> {

  const result: SendInvitationEmailsResult = {
    successCount: 0,
    failures: []
  }

  const workflowInfo = Context.current().info

  for (const invitation of params.invitations) {
    try {
      const inviteLink = `https://${params.domain}/auth/accept-invitation?token=${invitation.token}`

      await transporter.sendMail({
        from: '"A4C Platform" <noreply@firstovertheline.com>',
        to: invitation.email,
        subject: 'You\'re invited to join A4C Analytics Platform',
        html: `
          <h2>Welcome to A4C Analytics Platform</h2>
          <p>You've been invited to join our healthcare analytics platform.</p>
          <p>Click the link below to accept your invitation and set up your account:</p>
          <p><a href="${inviteLink}">${inviteLink}</a></p>
          <p>This invitation expires in 7 days.</p>
          <p>If you did not expect this invitation, you can safely ignore this email.</p>
        `
      })

      result.successCount++
      console.log(`[ACTIVITY] Sent invitation email to: ${invitation.email}`)

      // Emit InvitationEmailSent event
      await supabase.from('domain_events').insert({
        event_type: 'InvitationEmailSent',
        aggregate_type: 'User',
        aggregate_id: invitation.invitationId,
        event_data: {
          invitation_id: invitation.invitationId,
          email: invitation.email,
          sent_at: new Date().toISOString()
        },
        metadata: {
          workflow_id: workflowInfo.workflowId,
          workflow_run_id: workflowInfo.runId
        }
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.failures.push({
        email: invitation.email,
        error: errorMessage
      })
      console.error(`[ACTIVITY] Failed to send email to ${invitation.email}:`, error)

      // Emit InvitationEmailFailed event
      await supabase.from('domain_events').insert({
        event_type: 'InvitationEmailFailed',
        aggregate_type: 'User',
        aggregate_id: invitation.invitationId,
        event_data: {
          invitation_id: invitation.invitationId,
          email: invitation.email,
          error: errorMessage
        },
        metadata: {
          workflow_id: workflowInfo.workflowId,
          workflow_run_id: workflowInfo.runId
        }
      })
    }
  }

  return result
}
```

### Activity 6: Activate Organization

```typescript
// File: temporal/src/activities/organization/activate-organization.ts

import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface ActivateOrganizationParams {
  orgId: string
}

export async function activateOrganizationActivity(
  params: ActivateOrganizationParams
): Promise<void> {

  const workflowInfo = Context.current().info

  // Emit OrganizationActivated event
  const { error: eventError } = await supabase
    .from('domain_events')
    .insert({
      event_type: 'OrganizationActivated',
      aggregate_type: 'Organization',
      aggregate_id: params.orgId,
      event_data: {
        org_id: params.orgId,
        activated_at: new Date().toISOString()
      },
      metadata: {
        workflow_id: workflowInfo.workflowId,
        workflow_run_id: workflowInfo.runId,
        workflow_type: workflowInfo.workflowType
      }
    })

  if (eventError) {
    throw new Error(`Failed to emit OrganizationActivated event: ${eventError.message}`)
  }

  console.log(`[ACTIVITY] Organization activated: ${params.orgId}`)
}
```

---

## Event Emission

### Event Processor Triggers

All events emitted by activities are processed by PostgreSQL triggers:

```sql
-- File: infrastructure/supabase/sql/04-triggers/organization-events.sql

-- Trigger: Process OrganizationCreated event
CREATE OR REPLACE FUNCTION process_organization_created()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'OrganizationCreated' THEN
    INSERT INTO organizations_projection (
      org_id,
      name,
      type,
      parent_org_id,
      contact_email,
      domain,
      path,
      is_active,
      created_at
    )
    VALUES (
      (NEW.event_data->>'org_id')::uuid,
      NEW.event_data->>'name',
      NEW.event_data->>'type',
      (NEW.event_data->>'parent_org_id')::uuid,
      NEW.event_data->>'contact_email',
      NEW.event_data->>'domain',
      (NEW.event_data->>'path')::ltree,
      (NEW.event_data->>'is_active')::boolean,
      NEW.created_at
    )
    ON CONFLICT (org_id) DO UPDATE
    SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      domain = EXCLUDED.domain,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_process_organization_created
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_organization_created();

-- Trigger: Process OrganizationActivated event
CREATE OR REPLACE FUNCTION process_organization_activated()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'OrganizationActivated' THEN
    UPDATE organizations_projection
    SET
      is_active = true,
      activated_at = (NEW.event_data->>'activated_at')::timestamptz,
      updated_at = now()
    WHERE org_id = (NEW.event_data->>'org_id')::uuid;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_process_organization_activated
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_organization_activated();

-- Trigger: Process UserInvited event
CREATE OR REPLACE FUNCTION process_user_invited()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'UserInvited' THEN
    INSERT INTO user_invitations_projection (
      invitation_id,
      org_id,
      email,
      first_name,
      last_name,
      role,
      token,
      status,
      expires_at,
      created_at
    )
    VALUES (
      (NEW.event_data->>'invitation_id')::uuid,
      (NEW.event_data->>'org_id')::uuid,
      NEW.event_data->>'email',
      NEW.event_data->>'first_name',
      NEW.event_data->>'last_name',
      NEW.event_data->>'role',
      NEW.event_data->>'token',
      NEW.event_data->>'status',
      (NEW.event_data->>'expires_at')::timestamptz,
      NEW.created_at
    )
    ON CONFLICT (invitation_id) DO UPDATE
    SET
      status = EXCLUDED.status,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_process_user_invited
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_user_invited();
```

---

## Error Handling and Compensation

### Retry Policies

Activities have configurable retry policies:

```typescript
// Global retry policy (applied to all activities)
const activities = proxyActivities<typeof activitiesModule>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3
  }
})

// Per-activity override for longer operations
const { configureDNSActivity } = proxyActivities<typeof activitiesModule>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    maximumAttempts: 5 // More retries for DNS operations
  }
})
```

### Compensation Activities

```typescript
// File: temporal/src/activities/organization/compensation.ts

import { Context } from '@temporalio/activity'
import { createClient } from '@supabase/supabase-js'
import Cloudflare from 'cloudflare'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const cloudflare = new Cloudflare({
  apiToken: process.env.CLOUDFLARE_API_TOKEN!
})

// Compensation: Remove DNS record
export async function removeDNSActivity(params: {
  subdomain: string
}): Promise<void> {

  const workflowInfo = Context.current().info

  try {
    // Get DNS record from projection (if available)
    const { data: org } = await supabase
      .from('organizations_projection')
      .select('domain')
      .eq('domain', `${params.subdomain}.firstovertheline.com`)
      .single()

    if (!org) {
      console.log('[COMPENSATION] Organization record not found, skipping DNS cleanup')
      return
    }

    // Get zone ID
    const targetDomain = 'firstovertheline.com'
    const zones = await cloudflare.zones.list({ name: targetDomain })
    if (!zones.result || zones.result.length === 0) {
      throw new Error(`Zone not found: ${targetDomain}`)
    }
    const zoneId = zones.result[0].id

    // Find DNS record
    const records = await cloudflare.dns.records.list(zoneId, {
      name: `${params.subdomain}.${targetDomain}`
    })

    if (records.result && records.result.length > 0) {
      for (const record of records.result) {
        await cloudflare.dns.records.delete(zoneId, record.id)
        console.log(`[COMPENSATION] Removed DNS record: ${record.name}`)
      }
    }

    // Emit DNSRemoved event
    await supabase.from('domain_events').insert({
      event_type: 'DNSRemoved',
      aggregate_type: 'Organization',
      aggregate_id: params.subdomain,
      event_data: {
        subdomain: params.subdomain,
        reason: 'compensation'
      },
      metadata: {
        workflow_id: workflowInfo.workflowId,
        workflow_run_id: workflowInfo.runId
      }
    })

  } catch (error) {
    console.error('[COMPENSATION] Failed to remove DNS:', error)
    throw error
  }
}

// Compensation: Deactivate organization
export async function deactivateOrganizationActivity(params: {
  orgId: string
}): Promise<void> {

  const workflowInfo = Context.current().info

  // Emit OrganizationDeactivated event
  const { error: eventError } = await supabase
    .from('domain_events')
    .insert({
      event_type: 'OrganizationDeactivated',
      aggregate_type: 'Organization',
      aggregate_id: params.orgId,
      event_data: {
        org_id: params.orgId,
        reason: 'compensation',
        deactivated_at: new Date().toISOString()
      },
      metadata: {
        workflow_id: workflowInfo.workflowId,
        workflow_run_id: workflowInfo.runId
      }
    })

  if (eventError) {
    throw new Error(`Failed to emit OrganizationDeactivated event: ${eventError.message}`)
  }

  console.log(`[COMPENSATION] Organization deactivated: ${params.orgId}`)
}
```

---

## Testing

### Unit Tests for Activities

```typescript
// File: temporal/src/activities/organization/__tests__/create-organization.test.ts

import { createOrganizationActivity } from '../create-organization'
import { createClient } from '@supabase/supabase-js'

jest.mock('@supabase/supabase-js')

describe('createOrganizationActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should emit OrganizationCreated event', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null })
      })
    }
    ;(createClient as jest.Mock).mockReturnValue(mockSupabase)

    const params = {
      name: 'Test Organization',
      type: 'provider' as const,
      contactEmail: 'test@example.com',
      subdomain: 'test-org'
    }

    const orgId = await createOrganizationActivity(params)

    expect(orgId).toBeDefined()
    expect(mockSupabase.from).toHaveBeenCalledWith('domain_events')
  })
})
```

### Workflow Integration Tests

```typescript
// File: temporal/src/workflows/organization/__tests__/bootstrap-workflow.test.ts

import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { OrganizationBootstrapWorkflow } from '../bootstrap-workflow'
import * as activities from '../../../activities/organization'

describe('OrganizationBootstrapWorkflow', () => {
  let testEnv: TestWorkflowEnvironment

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal()
  })

  afterAll(async () => {
    await testEnv?.teardown()
  })

  it('should complete successfully with valid params', async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../bootstrap-workflow'),
      activities
    })

    await worker.runUntil(async () => {
      const result = await testEnv.client.workflow.execute(
        OrganizationBootstrapWorkflow,
        {
          workflowId: 'test-workflow-' + Date.now(),
          taskQueue: 'test',
          args: [{
            orgData: {
              name: 'Test Org',
              type: 'provider',
              contactEmail: 'test@example.com'
            },
            subdomain: 'test-org',
            users: [{
              email: 'user@example.com',
              firstName: 'John',
              lastName: 'Doe',
              role: 'provider_admin'
            }]
          }]
        }
      )

      expect(result.orgId).toBeDefined()
      expect(result.dnsConfigured).toBe(true)
      expect(result.invitationsSent).toBe(1)
    })
  })
})
```

---

## Deployment

### Deploy Worker

```bash
# Build Docker image
cd temporal/
docker build -t a4c-temporal-worker:v1.0.0 .

# Push to registry
docker push registry.example.com/a4c-temporal-worker:v1.0.0

# Deploy to Kubernetes
kubectl apply -f ../infrastructure/k8s/temporal/worker-deployment.yaml
```

### Trigger Workflow

```typescript
// File: temporal/src/client/trigger-bootstrap.ts

import { Client } from '@temporalio/client'

const client = new Client({
  namespace: 'default'
})

async function bootstrapOrganization() {
  const handle = await client.workflow.start('OrganizationBootstrapWorkflow', {
    taskQueue: 'bootstrap',
    workflowId: `org-bootstrap-${Date.now()}`,
    args: [{
      orgData: {
        name: 'Acme Healthcare',
        type: 'provider',
        contactEmail: 'admin@acme-healthcare.com'
      },
      subdomain: 'acme-healthcare',
      users: [
        {
          email: 'john@acme-healthcare.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'provider_admin'
        }
      ]
    }]
  })

  console.log(`Started workflow: ${handle.workflowId}`)

  const result = await handle.result()
  console.log('Workflow completed:', result)
}

bootstrapOrganization().catch(console.error)
```

---

## Related Documentation

- **Temporal Integration Overview**: `overview.md`
- **Activities Reference**: `activities-reference.md`
- **Error Handling**: `error-handling-and-compensation.md`
- **Supabase Auth**: `.plans/supabase-auth-integration/overview.md`

---

**Document Version**: 1.0
**Last Updated**: 2025-10-24
**Status**: Ready for Implementation
