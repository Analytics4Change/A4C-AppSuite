# Resend Email Provider Guide

**Last Updated**: 2025-01-14
**Status**: Production
**Audience**: Developers, DevOps Engineers

---

## Overview

A4C-AppSuite uses **Resend** (https://resend.com) as the primary email provider for transactional emails, including:
- Organization invitation emails (during organization bootstrap workflow)
- Password reset emails (future)
- Notification emails (future)

**SMTP (nodemailer)** is available as a fallback if Resend is unavailable or if SMTP is preferred.

### Why Resend?

**Advantages**:
- **Simple API**: Single `POST /emails` endpoint, no complex SMTP configuration
- **Excellent Deliverability**: Built on AWS SES infrastructure
- **Developer-Friendly**: Beautiful dashboard, detailed logs, webhook support
- **Generous Free Tier**: 100 emails/day, 3,000 emails/month (sufficient for MVP)
- **No Infrastructure**: No need to manage SMTP servers or relay configurations

**Trade-offs**:
- **External Dependency**: Relies on third-party service (mitigated with SMTP fallback)
- **Cost at Scale**: Paid plans required beyond free tier (acceptable for SaaS model)

---

## Implementation Architecture

### Email Provider Factory Pattern

The email provider is selected at runtime via a factory pattern based on environment configuration:

**File**: `workflows/src/shared/providers/email/factory.ts`

```typescript
export function createEmailProvider(): IEmailProvider {
  const mode = process.env.WORKFLOW_MODE || 'development';
  const override = process.env.EMAIL_PROVIDER;

  // Override takes precedence
  if (override) {
    if (override === 'resend') return new ResendEmailProvider();
    if (override === 'smtp') return new SMTPEmailProvider();
    if (override === 'logging') return new LoggingEmailProvider();
    if (override === 'mock') return new MockEmailProvider();
  }

  // Default behavior based on mode
  if (mode === 'production') {
    // Production: Use Resend if RESEND_API_KEY set, else SMTP fallback
    if (process.env.RESEND_API_KEY) {
      return new ResendEmailProvider();
    }
    if (process.env.SMTP_HOST) {
      return new SMTPEmailProvider();
    }
    throw new Error('Production mode requires RESEND_API_KEY or SMTP configuration');
  }

  if (mode === 'development') {
    return new LoggingEmailProvider(); // Console only, no API calls
  }

  return new MockEmailProvider(); // In-memory, testing
}
```

### Resend Provider Implementation

**File**: `workflows/src/shared/providers/email/resend-provider.ts`

```typescript
export class ResendEmailProvider implements IEmailProvider {
  private apiKey: string;
  private apiUrl = 'https://api.resend.com/emails';

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }
  }

  async sendEmail(params: SendEmailParams): Promise<void> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Resend API error: ${error.message}`);
    }
  }
}
```

**Key Points**:
- Uses native `fetch()` API (Node.js 20+, no npm package needed)
- Validates `RESEND_API_KEY` on provider instantiation
- Throws descriptive errors for debugging

### Activity Usage

**File**: `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`

```typescript
export async function sendInvitationEmails(
  params: SendInvitationEmailsParams
): Promise<SendInvitationEmailsResult> {
  const emailProvider = createEmailProvider(); // Factory creates Resend in production

  for (const invitation of params.invitations) {
    await emailProvider.sendEmail({
      from: 'A4C Platform <noreply@analytics4change.com>',
      to: invitation.email,
      subject: `Invitation to ${params.organizationName}`,
      html: generateInvitationEmailHtml(invitation, params),
    });

    // Emit domain event for audit trail
    await emitEvent({
      event_type: 'invitation_email.sent',
      aggregate_type: 'invitation',
      aggregate_id: invitation.id,
      event_data: {
        recipient: invitation.email,
        organization_id: params.organizationId,
        sent_at: new Date().toISOString(),
      },
    });
  }
}
```

---

## Configuration

### Prerequisites

1. **Resend Account**: Sign up at https://resend.com
2. **API Key**: Create API key with "Send emails" permission
3. **Kubernetes Access**: `kubectl` configured for temporal namespace
4. **Domain Verification** (optional but recommended): Verify your sending domain

### Step 1: Create Resend API Key

1. Log in to https://resend.com
2. Navigate to **API Keys** → **Create API Key**
3. **Name**: "A4C Production" (or environment-specific: "A4C Staging", "A4C Development")
4. **Permissions**: **Send emails** (read-only not needed for workers)
5. **Domain**: Select verified domain (or leave as "All Domains")
6. Click **Create**
7. **Copy the API key** (starts with `re_`) - shown only once!

**Security Best Practice**: Store API key in password manager immediately after creation.

### Step 2: Configure Kubernetes Secret

The `RESEND_API_KEY` must be added to the Kubernetes secret used by Temporal workers.

#### Create/Update Secret File

**File**: `infrastructure/k8s/temporal/worker-secret.yaml` (NOT committed to git)

```bash
# If secret file doesn't exist, create from template
cd infrastructure/k8s/temporal
cp worker-secret.yaml.example worker-secret.yaml
```

#### Encode API Key

```bash
# Encode the Resend API key to base64
echo -n "re_your_actual_api_key_here" | base64

# Example output:
# cmVfeW91cl9hY3R1YWxfYXBpX2tleV9oZXJl
```

#### Update Secret YAML

Edit `worker-secret.yaml` and replace the `RESEND_API_KEY` value:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: workflow-worker-secrets
  namespace: temporal
  labels:
    app: workflow-worker
    component: temporal-worker
type: Opaque
data:
  # Supabase service role key (base64 encoded)
  SUPABASE_SERVICE_ROLE_KEY: "eW91ci1zdXBhYmFzZS1zZXJ2aWNlLXJvbGUta2V5LWhlcmU="

  # Cloudflare API token (base64 encoded)
  CLOUDFLARE_API_TOKEN: "eW91ci1jbG91ZGZsYXJlLWFwaS10b2tlbi1oZXJl"

  # Resend API key (base64 encoded) - UPDATE THIS
  RESEND_API_KEY: "cmVfeW91cl9hY3R1YWxfYXBpX2tleV9oZXJl"
```

#### Apply Secret to Cluster

```bash
kubectl apply -f infrastructure/k8s/temporal/worker-secret.yaml
```

**Expected output**:
```
secret/workflow-worker-secrets configured
```

### Step 3: Restart Temporal Workers

Workers must be restarted to load the new secret:

```bash
# Rolling restart (zero downtime)
kubectl rollout restart deployment/workflow-worker -n temporal

# Wait for rollout to complete
kubectl rollout status deployment/workflow-worker -n temporal --timeout=300s
```

**Expected output**:
```
deployment "workflow-worker" successfully rolled out
```

### Step 4: Verify Configuration

Check worker logs for successful email provider initialization:

```bash
kubectl logs -n temporal -l app=workflow-worker --tail=50 | grep -i "email\|resend"
```

**Expected log entry**:
```
✓ Email provider configured: ResendEmailProvider
```

**If you see an error**:
```
❌ Email provider requires RESEND_API_KEY environment variable
```

This means the secret wasn't loaded correctly. Verify:
1. Secret exists: `kubectl get secret workflow-worker-secrets -n temporal`
2. Secret contains key: `kubectl get secret workflow-worker-secrets -n temporal -o yaml | grep RESEND_API_KEY`
3. Deployment references secret: `kubectl get deployment workflow-worker -n temporal -o yaml | grep -A10 envFrom`

---

## Domain Verification (Recommended)

By default, Resend sends emails from `@resend.dev`. To send from your own domain (e.g., `@analytics4change.com`), you must verify domain ownership.

### Why Verify Your Domain?

**Benefits**:
- **Professional branding**: Emails from `noreply@analytics4change.com` instead of `@resend.dev`
- **Better deliverability**: Custom domains have better reputation than shared domains
- **SPF/DKIM signing**: Automatic email authentication reduces spam classification

### Verification Steps

1. **Log in to Resend**: https://resend.com/domains
2. **Click "Add Domain"**
3. **Enter your domain**: `analytics4change.com` (root domain, not subdomain)
4. **Add DNS records** provided by Resend to your DNS provider (Cloudflare):
   - **TXT record** (for verification): `resend._domainkey.analytics4change.com`
   - **CNAME record** (for DKIM): `resend._domainkey.analytics4change.com`
   - **MX record** (optional, for receiving bounces): `analytics4change.com`

5. **Wait for DNS propagation** (1-48 hours, usually <5 minutes)
6. **Click "Verify Domain"** in Resend dashboard

**Verification Status**:
- ✅ **Verified**: Domain ready to send emails
- ⏳ **Pending**: DNS records not yet propagated
- ❌ **Failed**: DNS records incorrect or not found

### Update Email "From" Address

Once domain verified, update activity code to use verified domain:

**File**: `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`

```typescript
// Before (using resend.dev)
from: 'A4C Platform <noreply@resend.dev>',

// After (using verified domain)
from: 'A4C Platform <noreply@analytics4change.com>',
```

**Redeploy workers** after code change for updates to take effect.

---

## Email Templates

### Current Implementation: Inline HTML

Currently, email HTML is generated inline in activity code:

**File**: `workflows/src/activities/organization-bootstrap/send-invitation-emails.ts`

```typescript
function generateInvitationEmailHtml(
  invitation: Invitation,
  params: SendInvitationEmailsParams
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button {
          background-color: #4CAF50;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 4px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>You're invited to ${params.organizationName}</h1>
        <p>Hello ${invitation.firstName},</p>
        <p>You've been invited to join ${params.organizationName} on the A4C Platform.</p>
        <p>
          <a href="${invitation.acceptUrl}" class="button">Accept Invitation</a>
        </p>
        <p>Or copy this link: ${invitation.acceptUrl}</p>
      </div>
    </body>
    </html>
  `;
}
```

**Advantages**:
- Simple, no external dependencies
- Full control over HTML
- Easy to customize per workflow

**Disadvantages**:
- Code changes required to update templates
- No visual preview tool
- Harder to maintain consistency across multiple email types

### Future: Resend Templates (Recommended)

Resend supports creating reusable templates in the dashboard:

**Benefits**:
- **Visual editor**: Edit templates without code changes
- **Version control**: Resend tracks template versions
- **A/B testing**: Test different subject lines/content
- **Consistency**: Shared styles across all emails

**Migration Path**:

1. Create template in Resend dashboard
2. Get template ID (e.g., `tmpl_abc123`)
3. Update activity to use template:

```typescript
await emailProvider.sendEmail({
  from: 'A4C Platform <noreply@analytics4change.com>',
  to: invitation.email,
  template_id: 'tmpl_abc123', // Resend template ID
  template_data: {
    organizationName: params.organizationName,
    firstName: invitation.firstName,
    acceptUrl: invitation.acceptUrl,
  },
});
```

**Note**: Requires updating `ResendEmailProvider` to support `template_id` parameter.

---

## Monitoring and Observability

### Resend Dashboard

**URL**: https://resend.com/logs

**Available Metrics**:
- **Sent emails**: Total count, success rate
- **Delivery status**: Delivered, bounced, spam complaints
- **Open rate**: Percentage of recipients who opened (requires tracking pixel)
- **Click rate**: Percentage who clicked links (requires link tracking)
- **API usage**: Requests per day, quota remaining

**Filtering**:
- By date range (last 7 days, 30 days, custom)
- By status (delivered, bounced, failed)
- By recipient email
- By subject line

**Email Detail View**:
- Full email content (HTML and plain text)
- Delivery timeline (sent → delivered → opened → clicked)
- SMTP logs (if delivery failed)
- Webhook events (if configured)

### Temporal Workflow Logs

Check worker logs for email activity execution:

```bash
# View all email activity logs
kubectl logs -n temporal -l app=workflow-worker | grep "sendInvitationEmails"

# View last 100 lines with timestamps
kubectl logs -n temporal -l app=workflow-worker --tail=100 --timestamps

# Follow logs in real-time
kubectl logs -n temporal -l app=workflow-worker -f | grep -i email
```

**Successful email send log**:
```
INFO: sendInvitationEmails activity started (invitations: 3)
INFO: Email sent to john.doe@example.com (invitation_id: inv_123)
INFO: Email sent to jane.smith@example.com (invitation_id: inv_456)
INFO: Email sent to bob.jones@example.com (invitation_id: inv_789)
INFO: sendInvitationEmails activity completed (3/3 sent)
```

**Failed email send log**:
```
ERROR: sendInvitationEmails activity failed
ERROR: Resend API error: 401 Unauthorized - Invalid API key
```

### Domain Events

All sent emails emit `invitation_email.sent` domain events for audit trail:

```sql
-- Query sent emails from domain events
SELECT
  event_data->>'recipient' as email,
  event_data->>'organization_id' as org_id,
  event_data->>'sent_at' as sent_at,
  created_at
FROM domain_events
WHERE event_type = 'invitation_email.sent'
ORDER BY created_at DESC
LIMIT 50;
```

**Use cases**:
- Audit trail: Who was invited when?
- Debugging: Was email actually sent?
- Analytics: Invitation send rate over time

---

## Troubleshooting

### Issue 1: `RESEND_API_KEY not set`

**Error**:
```
Error: Email provider requires RESEND_API_KEY environment variable
```

**Cause**: Kubernetes secret missing or not loaded by worker.

**Solution**:

1. **Verify secret exists**:
   ```bash
   kubectl get secret workflow-worker-secrets -n temporal
   ```

2. **Check secret contains key**:
   ```bash
   kubectl get secret workflow-worker-secrets -n temporal -o yaml | grep RESEND_API_KEY
   ```

3. **If missing, create secret**:
   ```bash
   kubectl apply -f infrastructure/k8s/temporal/worker-secret.yaml
   ```

4. **Restart workers**:
   ```bash
   kubectl rollout restart deployment/workflow-worker -n temporal
   ```

---

### Issue 2: `401 Unauthorized - Invalid API key`

**Error**:
```
Resend API error: 401 Unauthorized - Invalid API key
```

**Causes**:
- API key incorrect (typo during base64 encoding)
- API key deleted from Resend dashboard
- API key expired (Resend keys don't expire, but can be revoked)

**Solution**:

1. **Verify API key in Resend dashboard**:
   - Log in to https://resend.com/api-keys
   - Check if key still exists
   - If deleted, create new key

2. **Verify base64 encoding correct**:
   ```bash
   # Decode current value in secret
   kubectl get secret workflow-worker-secrets -n temporal -o jsonpath='{.data.RESEND_API_KEY}' | base64 -d

   # Should print: re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

3. **Update secret with correct key**:
   ```bash
   NEW_KEY=$(echo -n "re_correct_api_key" | base64)
   kubectl patch secret workflow-worker-secrets -n temporal \
     -p "{\"data\":{\"RESEND_API_KEY\":\"$NEW_KEY\"}}"
   kubectl rollout restart deployment/workflow-worker -n temporal
   ```

---

### Issue 3: `429 Too Many Requests - Rate limit exceeded`

**Error**:
```
Resend API error: 429 Too Many Requests
```

**Cause**: Exceeded Resend free tier limits (100 emails/day, 3,000 emails/month).

**Solution**:

1. **Check usage in Resend dashboard**:
   - Log in to https://resend.com/usage
   - View emails sent today/this month

2. **Upgrade Resend plan** (if consistent high volume):
   - Navigate to https://resend.com/pricing
   - Select appropriate plan (Pro: $20/month for 50,000 emails)

3. **Implement retry with exponential backoff** (temporary workaround):
   ```typescript
   // In ResendEmailProvider.sendEmail()
   const maxRetries = 3;
   for (let attempt = 0; attempt < maxRetries; attempt++) {
     try {
       const response = await fetch(this.apiUrl, options);
       if (response.status === 429) {
         const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
         await sleep(retryAfter * 1000); // Wait before retry
         continue;
       }
       // Process successful response
       break;
     } catch (error) {
       if (attempt === maxRetries - 1) throw error;
     }
   }
   ```

---

### Issue 4: `403 Forbidden - Domain not verified`

**Error**:
```
Resend API error: 403 Forbidden - Domain not verified
```

**Cause**: Attempting to send from custom domain (`@analytics4change.com`) before verifying domain ownership.

**Solution**:

1. **Verify domain in Resend** (see [Domain Verification](#domain-verification-recommended) section)

2. **OR use default Resend domain** (temporary workaround):
   ```typescript
   // Change from:
   from: 'A4C Platform <noreply@analytics4change.com>',

   // To:
   from: 'A4C Platform <noreply@resend.dev>',
   ```

---

### Issue 5: Emails going to spam

**Symptoms**: Emails delivered but land in spam folder.

**Causes**:
- Sending domain not verified (using `@resend.dev`)
- Missing SPF/DKIM records
- High spam score (spammy content, too many links)
- Recipient marked previous emails as spam

**Solutions**:

1. **Verify custom domain** (see [Domain Verification](#domain-verification-recommended))
2. **Add SPF/DKIM records** (automatic with verified domain)
3. **Improve email content**:
   - Avoid spam trigger words ("free", "click here", excessive punctuation)
   - Include unsubscribe link (even for transactional emails)
   - Use plain text version alongside HTML
4. **Monitor Resend spam reports**:
   ```bash
   # Check Resend dashboard → Logs → Filter by "Spam complaint"
   ```

---

### Issue 6: Worker logs show no email activity

**Symptoms**: No email-related logs in worker output, even though workflow executed.

**Possible Causes**:
- Email activity not invoked (workflow logic issue)
- Activity failed silently (exception swallowed)
- Worker not processing correct task queue

**Solution**:

1. **Check Temporal Web UI**:
   ```bash
   kubectl port-forward -n temporal svc/temporal-web 8080:8080
   # Open: http://localhost:8080
   ```

2. **Search for workflow execution** by organization ID

3. **View activity history** to see if `sendInvitationEmails` was invoked

4. **Check activity input/output** for errors

5. **If activity not invoked**, check workflow code:
   ```typescript
   // Ensure activity is called
   await sendInvitationEmails({
     organizationId: params.organizationId,
     organizationName: params.organizationName,
     invitations: params.invitations,
   });
   ```

---

## SMTP Fallback Configuration

If Resend is unavailable or SMTP is preferred, configure SMTP credentials:

### Add SMTP Credentials to Kubernetes Secret

```bash
kubectl patch secret workflow-worker-secrets -n temporal -p '{
  "data": {
    "SMTP_HOST": "'$(echo -n "smtp.gmail.com" | base64)'",
    "SMTP_PORT": "'$(echo -n "587" | base64)'",
    "SMTP_USER": "'$(echo -n "your-email@gmail.com" | base64)'",
    "SMTP_PASS": "'$(echo -n "your-app-password" | base64)'"
  }
}'
```

### Restart Workers

```bash
kubectl rollout restart deployment/workflow-worker -n temporal
```

### Factory Behavior

The factory will automatically use SMTP if:
- `WORKFLOW_MODE=production` AND
- `RESEND_API_KEY` is NOT set AND
- `SMTP_HOST` IS set

**To force SMTP even if `RESEND_API_KEY` is set**:

Add to `worker-configmap.yaml`:
```yaml
data:
  EMAIL_PROVIDER: "smtp"
```

Apply and restart workers.

---

## Best Practices

### Security

1. **Rotate API keys quarterly** (see [Resend Key Rotation Guide](../../infrastructure/operations/resend-key-rotation.md))
2. **Never commit secrets to git** (`worker-secret.yaml` is gitignored)
3. **Use separate API keys per environment** (dev, staging, production)
4. **Monitor Resend dashboard** for suspicious activity (unexpected spikes, spam complaints)

### Reliability

1. **Implement retry logic** for transient failures (429 rate limit, 503 service unavailable)
2. **Configure SMTP fallback** for high-availability scenarios
3. **Monitor email delivery rates** in Resend dashboard (>95% delivery target)
4. **Set up webhooks** for bounce/spam notifications (future enhancement)

### Performance

1. **Batch email sends** where possible (Resend supports up to 100 recipients per API call)
2. **Use Temporal retry policies** for activity-level failures
3. **Monitor API response times** (target: <500ms p95)

### Compliance

1. **Include unsubscribe link** in all emails (even transactional)
2. **Honor unsubscribe requests** within 24 hours (implement `email_preferences` table)
3. **Log all sent emails** for audit compliance (`invitation_email.sent` domain events)
4. **Comply with CAN-SPAM Act** (US) and GDPR (EU)

---

## Related Documentation

- **[Resend Key Rotation Guide](../../infrastructure/operations/resend-key-rotation.md)** - Key rotation procedures
- **[Activities Reference](../reference/activities-reference.md)** - `sendInvitationEmails` activity specification
- **[Environment Variables](../../infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md)** - `RESEND_API_KEY` configuration
- **[Temporal Workflow Guidelines](../../../workflows/CLAUDE.md)** - Workflow development best practices

**External Resources**:
- **Resend Documentation**: https://resend.com/docs
- **Resend API Reference**: https://resend.com/docs/api-reference/emails/send-email
- **Resend Status Page**: https://status.resend.com

---

**Last Updated**: 2025-01-14 | **Maintained By**: DevOps Team
