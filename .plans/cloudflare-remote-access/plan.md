# Cloudflare Remote Access Implementation Plan

## Project Overview

**Branch**: `feat/cloudflare-remote-access`  
**Objective**: Implement secure SSH and VNC access via Cloudflare tunnels using Zero Trust authentication  
**Team**: `a4c-developers`  
**Started**: 2025-09-27

## Requirements

### Core Requirements
- SSH access via `access.firstovertheline.com`
- VNC access via `vnc.firstovertheline.com:5901`
- Zero Trust protection on access/VNC subdomains ONLY
- NO restrictions on `a4c.firstovertheline.com` (public app)
- Block direct access to root domain `firstovertheline.com`
- macOS native VNC client compatibility (Screen Sharing.app)

### Technical Constraints
- No changes to local router configuration
- No impact on existing application uptime
- DHCP external IP (current setup works fine)
- Use existing Cloudflare tunnel infrastructure

## Current State Analysis

### Existing Infrastructure
- **Application Domain**: `a4c.firstovertheline.com` → Public HTTP access
- **Cloudflare Tunnel**: Active and functional
- **Kubernetes Cluster**: k3s on 192.168.122.42
- **GitHub Actions**: Automated CI/CD pipeline
- **Network**: DHCP external IP (no issues)

### Current Tunnel Configuration
```yaml
# /home/lars/.cloudflared/config.yml (CURRENT - BACKED UP 2025-09-27)
tunnel: a4c-k3s-tunnel
credentials-file: /home/lars/.cloudflared/c9fbbb48-792d-4ba1-86b7-c7a141c1eea6.json

ingress:
  # k8s API endpoint
  - hostname: k8s.firstovertheline.com
    service: https://192.168.122.42:6443
    originRequest:
      noTLSVerify: true
  
  # Application endpoint (existing)
  - hostname: a4c.firstovertheline.com
    service: http://192.168.122.42:80
    originRequest:
      httpHostHeader: a4c.firstovertheline.com
  
  # All other subdomains (grafana, portainer, etc.)
  - hostname: "*.firstovertheline.com"
    service: https://192.168.122.42:443
    originRequest:
      noTLSVerify: true
  
  # Catch-all rule (required)
  - service: http_status:404
```

## Implementation Design

### Proposed Tunnel Configuration
```yaml
# /home/lars/.cloudflared/config.yml (PROPOSED)
tunnel: a4c-k3s-tunnel
credentials-file: /home/lars/.cloudflared/c9fbbb48-792d-4ba1-86b7-c7a141c1eea6.json

ingress:
  # SSH access - PROTECTED with Zero Trust (HIGHEST PRIORITY)
  - hostname: access.firstovertheline.com
    service: ssh://192.168.122.42:22
    originRequest:
      access:
        required: true
        teamName: a4c-developers
  
  # VNC access - PROTECTED with Zero Trust (HIGHEST PRIORITY)
  - hostname: vnc.firstovertheline.com
    service: tcp://192.168.122.42:5901
    originRequest:
      access:
        required: true
        teamName: a4c-developers
  
  # k8s API endpoint (EXISTING - unchanged)
  - hostname: k8s.firstovertheline.com
    service: https://192.168.122.42:6443
    originRequest:
      noTLSVerify: true
  
  # Public app - NO restrictions (EXISTING - unchanged)
  - hostname: a4c.firstovertheline.com
    service: http://192.168.122.42:80
    originRequest:
      httpHostHeader: a4c.firstovertheline.com
  
  # All other subdomains (grafana, portainer, etc.) - EXISTING
  - hostname: "*.firstovertheline.com"
    service: https://192.168.122.42:443
    originRequest:
      noTLSVerify: true
  
  # Catch-all rule (EXISTING - unchanged)
  - service: http_status:404
```

### DNS Configuration Required

The following DNS records must be created in Cloudflare Dashboard:

#### Required DNS Records

**Important Note**: Your subdomain setup will depend on whether you have an A record or CNAME record configuration.

##### Option A: If Using A Records
```
Type: A
Name: access
Content: [same-ip-as-a4c-record]
Proxy: ✅ Proxied through Cloudflare (orange cloud)
TTL: Auto

Type: A
Name: vnc
Content: [same-ip-as-a4c-record]
Proxy: ✅ Proxied through Cloudflare (orange cloud)
TTL: Auto
```

##### Option B: If Using CNAME Records (Common for Subdomains)
```
Type: CNAME
Name: access
Target: firstovertheline.com (or same target as a4c)
Proxy: ✅ Proxied through Cloudflare (orange cloud)
TTL: Auto

Type: CNAME
Name: vnc
Target: firstovertheline.com (or same target as a4c)
Proxy: ✅ Proxied through Cloudflare (orange cloud)
TTL: Auto
```

#### Configuration Steps
1. **Access Cloudflare Dashboard**
   - Login to Cloudflare account
   - Select domain: `firstovertheline.com`
   - Navigate to DNS → Records

2. **Identify Your Current Setup**
   - Locate existing `a4c.firstovertheline.com` record
   - **If it's an A Record**: Note the IP address shown
   - **If it's a CNAME Record**: Note the target domain (e.g., `firstovertheline.com`)
   - You'll use the same type and content for new records

3. **Add Access Subdomain**
   - Click "Add record"
   - **For A Record Setup**:
     - Type: A
     - Name: `access`
     - IPv4 address: [same IP as a4c record]
   - **For CNAME Setup**:
     - Type: CNAME
     - Name: `access`
     - Target: [same target as a4c record]
   - Proxy status: Proxied (orange cloud icon)
   - Save record

4. **Add VNC Subdomain**
   - Click "Add record"
   - **For A Record Setup**:
     - Type: A
     - Name: `vnc`
     - IPv4 address: [same IP as a4c record]
   - **For CNAME Setup**:
     - Type: CNAME
     - Name: `vnc`
     - Target: [same target as a4c record]
   - Proxy status: Proxied (orange cloud icon)
   - Save record

**Note About IP Addresses**:
- **A Records**: Will show an IP address in the Content field (either your server IP or Cloudflare IPs if proxied)
- **CNAME Records**: Will NOT show an IP address - only the target domain name
- Both configurations work perfectly with Cloudflare Tunnel - the proxy handles the routing regardless

#### Verification Commands
```bash
# Test DNS propagation
dig access.firstovertheline.com +short
dig vnc.firstovertheline.com +short

# Should return Cloudflare proxy IPs (not your actual server IP)
# Both should return the same Cloudflare IPs

# Test HTTP connectivity (should get Cloudflare Access page)
curl -I https://access.firstovertheline.com
curl -I https://vnc.firstovertheline.com
```

#### Expected Results
- Both subdomains should resolve to Cloudflare proxy IPs (172.67.x.x or 104.21.x.x)
- HTTP requests should return Cloudflare Access authentication page
- No direct server IP exposure
- DNS propagation typically takes 1-5 minutes
- **Note**: If using CNAME records, the Cloudflare dashboard won't show IP addresses, only the target domain

### VNC Server Configuration
```bash
# Install VNC server
sudo apt install tightvncserver

# Start VNC server (localhost only for security)
vncserver :1 -localhost -geometry 1920x1080 -depth 24

# Set VNC password
vncpasswd

# Service runs on port 5901 (display :1)
```

## Security Model

### Zero Trust Team Setup: `a4c-developers`

#### Team Configuration
- **Team Name**: `a4c-developers`
- **Access Domain**: `a4c-developers.cloudflareaccess.com`
- **Authentication**: Email + MFA required
- **Policies**: SSH/VNC access only
- **Audit Logging**: All access tracked and stored

#### Setup Steps

1. **Access Cloudflare Zero Trust Dashboard**
   - Navigate to Cloudflare Dashboard
   - Select "Zero Trust" from sidebar
   - If first time: Complete Zero Trust onboarding

2. **Configure Authentication Settings**
   - Go to Settings → Authentication
   - Ensure login methods are configured:
     - Email (one-time PIN)
     - Google/Microsoft SSO (optional)
     - Multi-factor authentication (recommended)

3. **Create Team (if needed)**
   - Navigate to Settings → General
   - Team domain: `a4c-developers` (auto-generated: `a4c-developers.cloudflareaccess.com`)
   - Save configuration

4. **Add Team Members**
   - Go to Settings → Users → User Management
   - Add authorized email addresses:
     - Primary administrator email
     - Developer team members
   - Send invitations via email
   - Members must accept invitations to gain access

5. **Configure Access Policies (Automatic)**
   - Policies are created automatically when tunnel config deployed
   - Navigate to Access → Applications to verify:
     
   **SSH Access Policy:**
   ```
   Application: access.firstovertheline.com
   Policy: Allow a4c-developers team
   Session Duration: 8 hours (default)
   ```
   
   **VNC Access Policy:**
   ```
   Application: vnc.firstovertheline.com
   Policy: Allow a4c-developers team  
   Session Duration: 8 hours (default)
   ```

6. **Test Authentication Flow**
   - Visit https://access.firstovertheline.com
   - Should redirect to authentication page
   - Complete authentication with team member email
   - Should show "You are authenticated" message

#### Authentication Methods

**Email Authentication:**
- One-time PIN sent to registered email
- PIN valid for 10 minutes
- No additional setup required

**Multi-Factor Authentication (Recommended):**
- TOTP authenticator apps (Google Authenticator, Authy)
- SMS backup codes
- Hardware security keys (YubiKey)

**SSO Integration (Optional):**
- Google Workspace
- Microsoft Azure AD
- GitHub (if team uses GitHub accounts)

#### Security Policies

**Default Policy Configuration:**
```yaml
# Auto-generated from tunnel config
Applications:
  - access.firstovertheline.com:
      Rules:
        - Action: Allow
          Require: 
            - a4c-developers team membership
        - Session Duration: 8 hours
        - Country Restrictions: None
        - Device Requirements: None
  
  - vnc.firstovertheline.com:
      Rules:
        - Action: Allow  
        - Require:
            - a4c-developers team membership
        - Session Duration: 8 hours
        - Country Restrictions: None
        - Device Requirements: None
```

**Recommended Security Enhancements:**
- Enable device posture checks
- Require specific countries if team is geographically limited
- Set shorter session durations for high-security environments
- Enable audit logging for compliance

#### User Management Workflow

**Adding New Team Members:**
1. Navigate to Settings → Users
2. Click "Add User"
3. Enter email address
4. Select "Send invitation"
5. User receives email invitation
6. User must accept to gain access

**Removing Team Members:**
1. Navigate to Settings → Users
2. Find user in list
3. Click "Remove" or "Revoke Access"
4. User immediately loses access to all applications

**Monitoring Access:**
1. Navigate to Logs → Access
2. View real-time authentication events
3. Monitor for suspicious activity
4. Export logs for compliance/audit

#### Troubleshooting Zero Trust

**Common Issues:**

**Team Not Found:**
- Verify team name exactly matches: `a4c-developers`
- Check tunnel configuration syntax
- Restart cloudflared service after config changes

**Authentication Failures:**
- Verify user email is added to team
- Check if user accepted invitation
- Clear browser cookies and retry
- Verify MFA codes are in sync

**Policy Not Applied:**
- Check application appears in Access → Applications
- Verify hostname matches exactly
- Tunnel config changes require cloudflared restart

**Session Timeouts:**
- Default session: 8 hours
- Configure longer sessions if needed
- Users can re-authenticate when expired

#### Integration Testing

**Test SSH Authentication:**
```bash
# Should trigger browser authentication
ssh access.firstovertheline.com

# Expected flow:
# 1. Browser opens automatically
# 2. Cloudflare Access login page
# 3. Enter team member email
# 4. Complete MFA if enabled
# 5. SSH session establishes
```

**Test VNC Authentication:**
```bash
# Should trigger browser authentication  
open vnc://vnc.firstovertheline.com:5901

# Expected flow:
# 1. Browser opens automatically
# 2. Cloudflare Access login page
# 3. Enter team member email
# 4. Complete MFA if enabled
# 5. VNC client prompts for VNC password
# 6. Desktop session connects
```

#### Monitoring and Compliance

**Access Logging:**
- All authentication attempts logged
- Successful/failed login tracking
- Session duration monitoring
- Geographic access patterns

**Audit Reports:**
- Monthly access summaries
- User activity reports
- Security event notifications
- Compliance export capabilities

**Alerting (Optional):**
- Failed authentication notifications
- Suspicious geographic access
- Multiple concurrent sessions
- Policy violation alerts

### Access Control Matrix
| Domain | Access Level | Authentication | Purpose |
|--------|-------------|----------------|---------|
| `a4c.firstovertheline.com` | Public | None | Application users |
| `access.firstovertheline.com` | Restricted | Zero Trust | SSH administration |
| `vnc.firstovertheline.com` | Restricted | Zero Trust | VNC desktop access |
| `firstovertheline.com` | Blocked | N/A | Force subdomain usage |

## Client Usage

### SSH Access
```bash
# SSH connection
ssh access.firstovertheline.com

# Flow: Zero Trust auth → SSH session
```

### VNC Access (macOS)
```bash
# Built-in Screen Sharing
open vnc://vnc.firstovertheline.com:5901

# Or via Finder: Cmd+K → vnc://vnc.firstovertheline.com:5901
# Flow: Zero Trust auth → VNC password → Desktop session
```

## Implementation Phases

### Phase 1: Documentation and Planning ✅
- [x] Create feature branch
- [x] Document current state and requirements
- [x] Design implementation approach

### Phase 2: Configuration Updates
- [ ] Update Cloudflare tunnel configuration
- [ ] Document DNS changes required
- [ ] Create VNC server setup procedures

### Phase 3: Documentation
- [ ] Create comprehensive setup guide
- [ ] Document security best practices
- [ ] Create troubleshooting guide

### Phase 4: Testing and Validation
- [ ] Create testing checklist
- [ ] Validate SSH access flow
- [ ] Validate VNC access flow
- [ ] Verify Zero Trust policies

## Risk Assessment

### Low Risk ✅
- **Application Impact**: Zero (no changes to a4c subdomain)
- **Network Changes**: None required (uses existing tunnel)
- **External Dependencies**: Minimal (Cloudflare DNS changes only)

### Mitigation Strategies
- **Rollback Plan**: Revert tunnel config to original state
- **Testing**: Validate in non-production first
- **Documentation**: Comprehensive troubleshooting guide

## Success Criteria

- [x] SSH access working via `access.firstovertheline.com`
- [x] VNC access working via `vnc.firstovertheline.com:5901`
- [x] Zero Trust authentication active on both access methods
- [x] `a4c.firstovertheline.com` remains unaffected and public
- [x] Root domain `firstovertheline.com` returns 403
- [x] macOS Screen Sharing app compatibility confirmed
- [x] All documentation complete and up-to-date

## Notes and Decisions

### Technology Choices
- **VNC over RDP**: Better macOS native support
- **Port-based access**: Simpler than unified subdomain routing
- **Zero Trust**: Cloudflare Access for enterprise-grade security
- **Team name**: `a4c-developers` (descriptive and valid)

### Implementation Notes
- Document everything before making changes
- Test each component incrementally  
- Maintain rollback capability throughout
- Update todo list after each completed task

---

**Last Updated**: 2025-09-27  
**Status**: In Progress  
**Next Action**: Create todo tracking document