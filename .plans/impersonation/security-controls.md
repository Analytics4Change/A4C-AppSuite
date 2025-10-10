# Impersonation Security Controls

## Overview

This document specifies comprehensive security controls for Super Admin impersonation in the A4C platform. Given the sensitive nature of impersonation (full access to any user's data), strict security measures are essential to prevent abuse and maintain compliance with healthcare regulations.

**Security Principles:**
1. **Defense in Depth:** Multiple layers of protection
2. **Least Privilege:** Limit scope and duration of access
3. **Auditability:** Comprehensive logging of all impersonation activity
4. **Transparency:** Users aware when their accounts are accessed
5. **Accountability:** Clear attribution of all actions to both Super Admin and target user

---

## Authentication Requirements

### Multi-Factor Authentication (MFA)

**Requirement:** MFA MUST be verified before every impersonation session starts

**Supported Methods:**
1. **TOTP (Time-Based One-Time Password)** - Recommended
   - Google Authenticator, Authy, 1Password, etc.
   - 6-digit code valid for 30 seconds
2. **Hardware Security Key** - Highest security
   - YubiKey, Titan Key, etc.
   - FIDO2/WebAuthn standard
3. **SMS (Not Recommended)** - Fallback only
   - Subject to SIM swap attacks
   - Only for emergency access

**Implementation:**
```typescript
async function startImpersonation(targetUserId: string, justification: Justification) {
  // 1. Check if user has MFA enabled
  if (!currentUser.mfaEnabled) {
    throw new Error('MFA required for impersonation. Please enable MFA first.');
  }

  // 2. Challenge MFA
  const mfaChallenge = await mfaService.challenge(currentUser.id);

  // 3. User enters TOTP code
  const userCode = await promptMFACode();

  // 4. Verify code
  const verified = await mfaService.verify(mfaChallenge.id, userCode);
  if (!verified) {
    throw new Error('Invalid MFA code. Impersonation denied.');
  }

  // 5. Proceed with impersonation
  return await impersonationService.start(targetUserId, justification);
}
```

**MFA Enforcement Policy:**
```sql
-- Database constraint: Super Admins MUST have MFA enabled
ALTER TABLE users
ADD CONSTRAINT super_admin_mfa_required
CHECK (
  role != 'super_admin' OR
  (role = 'super_admin' AND mfa_enabled = TRUE)
);
```

---

## Justification Requirements

### Required Fields

**Every impersonation session MUST include:**
```typescript
interface ImpersonationJustification {
  reason: 'support_ticket' | 'emergency' | 'audit' | 'training';
  referenceId?: string;  // Required for support_ticket
  notes?: string;        // Optional, but encouraged
}
```

**Validation Rules:**
```typescript
function validateJustification(justification: Justification): void {
  if (!justification.reason) {
    throw new Error('Reason for impersonation is required');
  }

  if (justification.reason === 'support_ticket' && !justification.referenceId) {
    throw new Error('Support ticket number is required');
  }

  if (justification.reason === 'emergency' && !justification.notes) {
    throw new Error('Emergency justification requires detailed notes');
  }

  // Optional: Validate ticket number exists in support system
  if (justification.referenceId && !await ticketSystem.exists(justification.referenceId)) {
    throw new Error(`Invalid ticket number: ${justification.referenceId}`);
  }
}
```

### Justification Review

**Post-Launch Feature:** Periodic review of justifications

```typescript
// Compliance team reviews all impersonation sessions monthly
async function generateJustificationReport(startDate: Date, endDate: Date) {
  const sessions = await db.events.findMany({
    where: {
      eventType: 'impersonation.started',
      timestamp: { gte: startDate, lte: endDate }
    }
  });

  return sessions.map(session => ({
    superAdmin: session.data.superAdmin.email,
    targetUser: session.data.target.email,
    targetOrg: session.data.target.orgName,
    reason: session.data.justification.reason,
    referenceId: session.data.justification.referenceId,
    notes: session.data.justification.notes,
    timestamp: session.timestamp,
    duration: session.data.sessionConfig.duration
  }));
}
```

---

## Session Time Limits

### Duration Policy

**Default:** 30 minutes per session
**Maximum Renewals:** Unlimited (each renewal logged)
**Total Session Limit (Recommended):** 2 hours (4 renewals)

**Implementation:**
```typescript
const IMPERSONATION_SESSION_DURATION = 30 * 60 * 1000; // 30 minutes
const IMPERSONATION_MAX_RENEWALS = 4;  // Optional limit

async function renewImpersonation(sessionId: string) {
  const session = await redis.get(`impersonation:${sessionId}`);

  if (session.renewalCount >= IMPERSONATION_MAX_RENEWALS) {
    throw new Error(
      `Maximum renewals (${IMPERSONATION_MAX_RENEWALS}) reached. ` +
      'Please end this session and start a new one if access still needed.'
    );
  }

  // Extend TTL
  await redis.expire(`impersonation:${sessionId}`, 1800); // 30 minutes
  session.renewalCount += 1;
  session.expiresAt = new Date(Date.now() + IMPERSONATION_SESSION_DURATION);

  return session;
}
```

### Automatic Logout

**Requirement:** Sessions MUST automatically expire when timer reaches zero

**Implementation:**
```typescript
// Frontend: Client-side timer
useEffect(() => {
  if (!impersonationSession) return;

  const timeUntilExpiry = new Date(impersonationSession.expiresAt).getTime() - Date.now();

  const logoutTimer = setTimeout(async () => {
    await endImpersonation(impersonationSession.sessionId, 'timeout');
    window.location.href = '/logout';
  }, timeUntilExpiry);

  return () => clearTimeout(logoutTimer);
}, [impersonationSession]);

// Backend: Server-side cleanup
setInterval(async () => {
  const sessions = await redis.keys('impersonation:*');

  for (const key of sessions) {
    const session = JSON.parse(await redis.get(key));

    if (new Date(session.expiresAt) < new Date()) {
      // Emit timeout event
      await eventEmitter.emit(
        session.superAdminId,
        'user',
        'impersonation.ended',
        { ...session, reason: 'timeout' },
        'Impersonation session timed out (server cleanup)'
      );

      // Delete expired session
      await redis.del(key);
    }
  }
}, 60000); // Every minute
```

---

## Access Restrictions

### Nested Impersonation Prevention

**Rule:** Cannot start impersonation while already impersonating

**Implementation:**
```typescript
async function startImpersonation(targetUserId: string) {
  const currentJWT = getCurrentJWT();

  if (currentJWT.impersonation) {
    throw new Error(
      'Cannot impersonate while already in an impersonation session. ' +
      'Please end your current session first.'
    );
  }

  // Proceed with impersonation
}
```

### Action Restrictions (Optional)

**Post-Launch Feature:** Restrict certain actions during impersonation

**Example Restrictions:**
```typescript
// Actions that should NOT be allowed during impersonation:
const RESTRICTED_ACTIONS = [
  'delete_user_account',     // Prevent deleting impersonated user
  'change_org_ownership',    // Prevent org ownership transfer
  'grant_super_admin',       // Prevent privilege escalation
  'revoke_mfa',              // Prevent security downgrade
  'export_all_data'          // Prevent bulk data exfiltration (audit first)
];

function checkActionPermission(action: string, jwt: JWT): void {
  if (jwt.impersonation && RESTRICTED_ACTIONS.includes(action)) {
    throw new Error(
      `Action "${action}" is not allowed during impersonation sessions. ` +
      'Please contact another Super Admin or end impersonation first.'
    );
  }
}
```

---

## IP Restrictions (Optional)

### Office/VPN Only Access

**Post-Launch Feature:** Limit impersonation to specific IP ranges

**Implementation:**
```typescript
const ALLOWED_IP_RANGES = [
  '192.168.1.0/24',     // Office network
  '10.0.0.0/8',         // VPN network
  '203.0.113.0/24'      // Cloud infrastructure
];

async function startImpersonation(targetUserId: string, clientIP: string) {
  if (!isIPAllowed(clientIP, ALLOWED_IP_RANGES)) {
    await logSecurityEvent('impersonation_denied_ip', {
      superAdminId: currentUser.id,
      clientIP,
      reason: 'IP not in allowed ranges'
    });

    throw new Error(
      'Impersonation is only allowed from office or VPN networks. ' +
      `Your IP (${clientIP}) is not authorized.`
    );
  }

  // Proceed with impersonation
}

function isIPAllowed(clientIP: string, allowedRanges: string[]): boolean {
  // Use ipaddr.js or similar library
  return allowedRanges.some(range => isIPInRange(clientIP, range));
}
```

---

## Audit Logging

### Comprehensive Event Logging

**All impersonation activity MUST be logged:**
1. Session lifecycle (started, renewed, ended)
2. All actions during impersonation (with metadata)
3. Failed impersonation attempts
4. Security violations

**Event Schema:** See `.plans/impersonation/event-schema.md`

### Failed Attempt Logging

```typescript
async function logFailedImpersonation(
  superAdminId: string,
  reason: string,
  details: any
) {
  await eventEmitter.emit(
    superAdminId,
    'user',
    'impersonation.failed',
    {
      superAdminId,
      reason,
      details,
      timestamp: new Date().toISOString()
    },
    `Impersonation attempt failed: ${reason}`
  );
}

// Example failures to log:
// - MFA verification failed
// - IP not allowed
// - Target user not found
// - Insufficient permissions
// - Nested impersonation attempt
// - Session expired
```

### Retention Policy

**Healthcare Compliance:** 7-year retention required

**Implementation:**
```sql
-- Events table never deletes impersonation events
CREATE POLICY "impersonation_events_no_delete"
ON events FOR DELETE
USING (event_type NOT LIKE 'impersonation.%');

-- Archive old events to cold storage (90 days)
CREATE TABLE events_archive (LIKE events INCLUDING ALL);

-- Monthly job
INSERT INTO events_archive
SELECT * FROM events
WHERE timestamp < NOW() - INTERVAL '90 days'
  AND event_type LIKE 'impersonation.%';
```

---

## Provider Notification (Post-Launch)

### Email Notification to Provider Admins

**Feature:** Notify Provider Admins when Super Admin accesses their org

**Implementation:**
```typescript
async function notifyProviderAdmin(session: ImpersonationSession) {
  const providerAdmins = await db.users.findMany({
    where: {
      orgId: session.target.orgId,
      role: 'provider_admin'
    }
  });

  for (const admin of providerAdmins) {
    await emailService.send({
      to: admin.email,
      subject: 'A4C Support Access Notification',
      template: 'impersonation-notification',
      data: {
        superAdminName: session.superAdmin.name,
        targetUserName: session.target.name,
        reason: session.justification.reason,
        referenceId: session.justification.referenceId,
        startTime: session.startedAt,
        orgName: session.target.orgName
      }
    });
  }
}
```

**Email Template:**
```html
<h2>Support Access Notification</h2>

<p>Dear {{ orgName }} Administrator,</p>

<p>
  This is to inform you that A4C support staff has accessed your organization
  for the following reason:
</p>

<ul>
  <li><strong>Support Staff:</strong> {{ superAdminName }}</li>
  <li><strong>User Account Accessed:</strong> {{ targetUserName }}</li>
  <li><strong>Reason:</strong> {{ reason }}</li>
  <li><strong>Reference:</strong> {{ referenceId }}</li>
  <li><strong>Access Time:</strong> {{ startTime }}</li>
</ul>

<p>
  This access was required to assist with {{ reason }}. All actions during
  this session have been logged for audit purposes.
</p>

<p>
  If you have questions or concerns about this access, please contact
  support@a4c.com or reference {{ referenceId }}.
</p>
```

**Opt-Out Option:**
```typescript
// Allow Provider Admins to opt-out of notifications (NOT recommended)
interface OrgSettings {
  notifyOnImpersonation: boolean;  // Default: true
}
```

---

## Role Separation (Post-Launch)

### Specialized Super Admin Roles

**Current:** Single `super_admin` role with full access

**Post-Launch:** Split into specialized roles

**Role Definitions:**
```typescript
enum SuperAdminRole {
  SYSTEM_ADMIN = 'system_admin',        // Infrastructure, no customer data access
  SUPPORT_ADMIN = 'support_admin',      // Customer support, can impersonate
  COMPLIANCE_ADMIN = 'compliance_admin', // Audit access, read-only impersonation
  SECURITY_ADMIN = 'security_admin'     // Security reviews, audit logs only
}

interface SuperAdminPermissions {
  canImpersonate: boolean;
  canModifyData: boolean;    // Write access during impersonation
  canAccessAuditLogs: boolean;
  canManageUsers: boolean;
  canManageInfrastructure: boolean;
}

const ROLE_PERMISSIONS: Record<SuperAdminRole, SuperAdminPermissions> = {
  system_admin: {
    canImpersonate: false,
    canModifyData: false,
    canAccessAuditLogs: false,
    canManageUsers: true,
    canManageInfrastructure: true
  },
  support_admin: {
    canImpersonate: true,
    canModifyData: true,  // Can help users fix data
    canAccessAuditLogs: true,
    canManageUsers: false,
    canManageInfrastructure: false
  },
  compliance_admin: {
    canImpersonate: true,
    canModifyData: false,  // Read-only impersonation
    canAccessAuditLogs: true,
    canManageUsers: false,
    canManageInfrastructure: false
  },
  security_admin: {
    canImpersonate: false,
    canModifyData: false,
    canAccessAuditLogs: true,
    canManageUsers: false,
    canManageInfrastructure: false
  }
};
```

---

## Just-In-Time Access (Future)

### Request-Approval Workflow

**Advanced Feature:** Require approval before impersonation

**Workflow:**
```
1. Support Admin requests impersonation access
   ├─ Target user
   ├─ Justification
   └─ Requested duration

2. Approval required from:
   ├─ Another Super Admin (peer review)
   └─ Optional: Provider Admin (for transparency)

3. If approved:
   ├─ Time-limited grant created (e.g., 1 hour)
   ├─ Impersonation allowed within grant window
   └─ Grant auto-expires after time limit

4. If denied:
   ├─ Request logged
   └─ Support Admin notified of denial reason
```

**Implementation:**
```typescript
interface ImpersonationGrant {
  id: string;
  requestedBy: string;       // Support Admin user ID
  targetUserId: string;
  justification: Justification;
  requestedDuration: number;
  approvedBy?: string;       // Approving Super Admin
  approvedAt?: Date;
  expiresAt?: Date;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

async function requestImpersonation(
  targetUserId: string,
  justification: Justification
): Promise<ImpersonationGrant> {
  const grant = await db.impersonationGrants.create({
    data: {
      requestedBy: currentUser.id,
      targetUserId,
      justification,
      requestedDuration: 3600000, // 1 hour
      status: 'pending'
    }
  });

  // Notify approvers
  await notifyApprovers(grant);

  return grant;
}

async function approveImpersonation(grantId: string): Promise<void> {
  const grant = await db.impersonationGrants.update({
    where: { id: grantId },
    data: {
      status: 'approved',
      approvedBy: currentUser.id,
      approvedAt: new Date(),
      expiresAt: new Date(Date.now() + grant.requestedDuration)
    }
  });

  // Notify requester
  await notifyGrantApproved(grant);
}
```

---

## Anomaly Detection (Future)

### Suspicious Activity Monitoring

**Patterns to detect:**
1. Rapid successive impersonations (> 5 orgs in 10 minutes)
2. Impersonation outside normal business hours (2 AM - 6 AM)
3. Impersonation from unusual IP addresses
4. Long-duration sessions (> 2 hours)
5. High volume of data exports during impersonation

**Implementation:**
```typescript
async function detectAnomalies(event: DomainEvent) {
  if (event.eventType !== 'impersonation.started') return;

  const superAdminId = event.data.superAdmin.userId;

  // Check rapid succession
  const recentSessions = await db.events.count({
    where: {
      eventType: 'impersonation.started',
      data: { path: ['superAdmin', 'userId'], equals: superAdminId },
      timestamp: { gte: new Date(Date.now() - 10 * 60 * 1000) }
    }
  });

  if (recentSessions > 5) {
    await alertSecurityTeam({
      type: 'rapid_impersonation',
      superAdminId,
      count: recentSessions,
      timeWindow: '10 minutes'
    });
  }

  // Check unusual hours
  const hour = new Date().getHours();
  if (hour < 6 || hour > 22) {
    await alertSecurityTeam({
      type: 'unusual_hours',
      superAdminId,
      hour,
      sessionId: event.data.sessionId
    });
  }
}
```

---

## Incident Response

### Security Incident Handling

**If suspicious impersonation detected:**

1. **Immediate Actions:**
   - Revoke all active impersonation sessions for user
   - Disable Super Admin account temporarily
   - Log security incident
   - Alert security team

2. **Investigation:**
   - Review all recent impersonation sessions
   - Analyze justifications and actions performed
   - Check for data exfiltration
   - Interview Super Admin if possible

3. **Remediation:**
   - If malicious: Terminate account, rotate credentials
   - If mistake: Retrain, document procedures
   - If authorized: Update anomaly detection rules

**Implementation:**
```typescript
async function handleSecurityIncident(
  superAdminId: string,
  reason: string
) {
  // 1. Revoke all active sessions
  const sessions = await redis.keys(`impersonation:*`);
  for (const key of sessions) {
    const session = JSON.parse(await redis.get(key));
    if (session.superAdminId === superAdminId) {
      await endImpersonation(session.sessionId, 'forced_by_security');
      await redis.del(key);
    }
  }

  // 2. Disable account
  await db.users.update({
    where: { id: superAdminId },
    data: { status: 'suspended' }
  });

  // 3. Log incident
  await db.securityIncidents.create({
    data: {
      type: 'suspicious_impersonation',
      userId: superAdminId,
      reason,
      severity: 'high',
      status: 'investigating'
    }
  });

  // 4. Alert security team
  await alertSecurityTeam({
    type: 'security_incident',
    severity: 'HIGH',
    userId: superAdminId,
    reason,
    action: 'Account suspended, all sessions terminated'
  });
}
```

---

## Compliance Requirements

### HIPAA Compliance

**45 CFR § 164.308(a)(5)(ii)(C) - Log-in Monitoring:**
> Procedures for monitoring log-in attempts and reporting discrepancies

**Implementation:** All impersonation events logged with comprehensive details

**45 CFR § 164.312(a)(2)(i) - Unique User Identification:**
> Assign a unique name and/or number for identifying and tracking user identity

**Implementation:** JWT includes both Super Admin ID and target user ID

**45 CFR § 164.312(d) - Person or Entity Authentication:**
> Procedures to verify that a person or entity seeking access to electronic protected health information is the one claimed

**Implementation:** MFA required before impersonation

### State-Specific Regulations

**California CMIA (Confidentiality of Medical Information Act):**
- Requires audit trail of all access to medical information
- Implementation: Comprehensive event logging

**GDPR (if applicable):**
- Right to know when personal data is accessed
- Implementation: Provider notification feature (post-launch)

---

## Related Documents

- `.plans/impersonation/architecture.md` - Overall architecture
- `.plans/impersonation/event-schema.md` - Audit event definitions
- `.plans/impersonation/ui-specification.md` - Visual indicators and UX
- `.plans/consolidated/agent-observations.md` - System-wide security context

---

## Security Checklist

### MVP Requirements

- [ ] MFA required before impersonation
- [ ] Justification capture with validation
- [ ] 30-minute time-limited sessions
- [ ] Renewal modal at 1-minute warning
- [ ] Automatic logout on timeout
- [ ] Comprehensive event logging (started, renewed, ended, actions)
- [ ] Visual indicators (red border, banner, favicon, title)
- [ ] Nested impersonation prevention
- [ ] Server-side session validation (Redis with TTL)
- [ ] JWT includes impersonation context
- [ ] Audit log queries functional
- [ ] 7-year retention policy configured

### Post-Launch Enhancements

- [ ] Provider notification emails
- [ ] IP restrictions (office/VPN only)
- [ ] Action restrictions (prevent certain operations)
- [ ] Role separation (System vs. Support vs. Compliance admins)
- [ ] Just-In-Time access (request-approval workflow)
- [ ] Anomaly detection (suspicious patterns)
- [ ] Incident response automation
- [ ] Maximum renewal limit enforced
- [ ] Read-only impersonation mode (Compliance Admins)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Status:** Final Specification
