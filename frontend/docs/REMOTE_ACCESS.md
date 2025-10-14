# Remote Access Guide

Secure SSH access to the A4C development environment via Cloudflare tunnels with Zero Trust authentication.

## Overview

This guide provides secure remote access to the development environment through:
- **SSH access**: `ssh.firstovertheline.com` (port 22)
- **K8s API access**: `k8s.firstovertheline.com` (kubectl via Cloudflare tunnel)
- **Application access**: `a4c.firstovertheline.com` (public A4C medication management app)
- **Security**: Cloudflare Zero Trust with `firstovertheline` team authentication

## Recent Infrastructure Improvements (October 2025)

### Problem Solved
The infrastructure experienced a service outage due to a configuration mismatch and lack of resilience mechanisms:

**Root Cause**: 
- K3s Kubernetes cluster runs inside a VM (`k3s-server`) at `192.168.122.42:6443`
- Cloudflare tunnel was incorrectly configured to point to `192.168.122.1:6443` (host)
- VM was not set to autostart, requiring manual intervention after host reboots
- No automated monitoring or recovery systems in place

**Impact**: 
- `a4c.firstovertheline.com` returned 502 Bad Gateway errors
- `k8s.firstovertheline.com` was inaccessible for cluster management
- `ssh.firstovertheline.com` worked (points to host SSH service)

### Solutions Implemented

#### 1. **Configuration Fix**
- Updated `/etc/cloudflared/config.yml` to point K8s API endpoint to correct VM address
- Changed from `https://192.168.122.1:6443` → `https://192.168.122.42:6443`
- Restarted cloudflared service to apply changes

#### 2. **Resilience Improvements**
- **VM Autostart**: Enabled `virsh autostart k3s-server` - VM now starts automatically on host boot
- **Hybrid kubectl Access**: Created dual-context kubeconfig:
  ```bash
  kubectl config use-context local   # Direct VM access (fast)
  kubectl config use-context remote  # Cloudflare tunnel access (external)
  ```

#### 3. **Automated Monitoring & Recovery**
- **Health Check Script**: `/usr/local/bin/k3s-health-check` monitors all services
- **Auto-Recovery**: Automatically starts VMs and restarts failed services  
- **Systemd Timer**: Health checks run every 5 minutes (`k3s-health-check.timer`)
- **Logging**: Comprehensive logging to `/var/log/k3s-health-check.log`
- **Alerting Framework**: Extensible alert system (`/usr/local/bin/k3s-alert`)

#### 4. **Monitoring Scope**
The health check system monitors:
- **VM Status**: `k3s-server` virtual machine state
- **K8s API**: Both local (`192.168.122.42:6443`) and remote (`k8s.firstovertheline.com`) endpoints
- **Web Service**: Application availability at `a4c.firstovertheline.com`
- **SSH Service**: Remote access via `ssh.firstovertheline.com` 
- **Cloudflared Service**: Tunnel daemon health and connectivity

### Benefits Achieved
- **Zero Manual Intervention**: System recovers automatically from common failures
- **Faster Development**: Local kubectl context provides direct, low-latency access
- **External Accessibility**: Remote context enables external access via Cloudflare tunnels
- **Proactive Monitoring**: Issues detected and resolved before users notice
- **Production Readiness**: Resilient architecture suitable for production workloads

### Architecture Summary
```
External Users → Cloudflare Tunnel → Host (192.168.122.1) → VM (192.168.122.42)
├── ssh.firstovertheline.com → SSH service (port 22)
├── k8s.firstovertheline.com → K3s API (port 6443) 
└── a4c.firstovertheline.com → Web app (port 80)
```

**Lesson Learned**: Always implement autostart, monitoring, and recovery mechanisms for production-like environments to minimize downtime and operational overhead.

## Remote SSH Access Update (October 2025)

### Simplified Remote SSH Access

**For remote machines outside the local network**, use the cloudflared proxy method:

#### **Step 1: Install cloudflared on Remote Machine**

**macOS:**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Ubuntu/Debian:**
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

**Windows:**
Download from: https://github.com/cloudflare/cloudflared/releases

#### **Step 2: Two-Command SSH Access**

**Terminal 1 - Start SSH Proxy:**
```bash
cloudflared access tcp --hostname ssh.firstovertheline.com --listener 127.0.0.1:2222
```

**Terminal 2 - SSH Connection:**
```bash
ssh -p 2222 username@127.0.0.1
```

#### **Alternative: One-Command Method**
```bash
# Start proxy in background and connect
cloudflared access tcp --hostname ssh.firstovertheline.com --listener 127.0.0.1:2222 &
sleep 2
ssh -p 2222 username@127.0.0.1
```

### Authentication Methods Available
- **Password Authentication**: Enabled (MaxAuthTries=3)
- **SSH Key Authentication**: Also supported
- **Choose either method** during login prompt

### Why This Method?
- ✅ **No Zero Trust setup required** - works with current configuration
- ✅ **Secure** - all traffic encrypted through Cloudflare tunnel
- ✅ **Works from any network** - no VPN or special network setup needed
- ✅ **One-time setup** - install cloudflared once per remote machine
- ✅ **Proven reliable** - tested and verified approach

### Technical Note
Direct SSH to `ssh.firstovertheline.com` is not possible due to Cloudflare tunnel limitations. The cloudflared proxy method is the standard approach for SSH access through Cloudflare tunnels.

## Prerequisites

### For Administrators
- [ ] Cloudflare tunnel configured and running
- [ ] DNS records created for SSH subdomain
- [ ] Zero Trust team `firstovertheline` configured
- [ ] SSH server enabled and configured

### For Users
- [ ] Cloudflare Zero Trust team membership (`firstovertheline`)
- [ ] SSH client (built into macOS/Linux)
- [ ] `cloudflared` client installed

## Quick Start

### SSH Access with Cloudflare Access

**Proper authentication method:**
```bash
cloudflared access ssh --hostname ssh.firstovertheline.com
```

This command:
1. Opens browser for Zero Trust authentication
2. Authenticates with your authorized email + MFA
3. Establishes SSH session after successful authentication

**Note**: Direct `ssh ssh.firstovertheline.com` will bypass authentication and is not recommended for security.

## Detailed Setup Instructions

### SSH Server Configuration (Administrator)

SSH should already be running on most Linux systems. Verify and configure:

```bash
# Check SSH status
sudo systemctl status ssh

# Start SSH if not running
sudo systemctl enable ssh
sudo systemctl start ssh

# Optional: Configure SSH for better security
sudo nano /etc/ssh/sshd_config
```

**Recommended SSH hardening:**
```
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no  # After SSH key setup
PubkeyAuthentication yes
X11Forwarding yes          # For GUI applications over SSH
ClientAliveInterval 60     # Keep connections alive
ClientAliveCountMax 3
```

### DNS Configuration (Administrator)

The SSH subdomain requires a DNS record pointing to the Cloudflare tunnel:

**Create DNS record in Cloudflare dashboard:**
```
Type: CNAME
Name: ssh
Target: c9fbbb48-792d-4ba1-86b7-c7a141c1eea6.cfargotunnel.com
Proxy status: Proxied (orange cloud icon - enabled)
TTL: Auto (default)
```

This creates: `ssh.firstovertheline.com`

#### Verify DNS Configuration

**Test DNS resolution:**
```bash
dig ssh.firstovertheline.com +short
# Should return Cloudflare proxy IPs (172.64.x.x or 104.21.x.x)
```

**Test HTTP connectivity:**
```bash
# Note: Replace firstovertheline.com with your actual domain
curl -I https://ssh.firstovertheline.com
# Should return 302 redirect to Cloudflare Access authentication
```

### Zero Trust Team Setup (Administrator)

Configure Zero Trust authentication through the Cloudflare dashboard:

#### Step 1: Access Zero Trust Dashboard
1. Log into Cloudflare Dashboard
2. Navigate to **Zero Trust** in the sidebar
3. Complete initial setup if first time (choose Free plan)

#### Step 2: Configure Team and Authentication
1. **Team domain**: `firstovertheline.cloudflareaccess.com`
2. **Authentication methods**: 
   - Email (required)
   - Google SSO (recommended)
   - TOTP/MFA (recommended)

#### Step 3: Add Team Members
1. Go to **Settings** → **Users**
2. Click **"Add users"**
3. Enter authorized email addresses
4. Send invitations (users must accept to gain access)

#### Step 4: Create SSH Access Application
1. Navigate to **Access** → **Applications**
2. Click **"Add an application"**
3. Configure:
   - **Application type**: Infrastructure
   - **Application name**: `SSH Access`
   - **Session duration**: 8 hours
   - **Application domain**: `ssh.firstovertheline.com`
4. **Add a policy**:
   - **Policy name**: `Allow team members`
   - **Action**: Allow
   - **Include**: Emails → Add authorized team member emails
5. **Save application**

### Client Setup (Users)

#### Install cloudflared Client

**macOS:**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Ubuntu/Debian:**
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

**Windows:**
Download from: https://github.com/cloudflare/cloudflared/releases

#### SSH Key Authentication Setup

**Generate SSH key pair:**
```bash
# On client machine
ssh-keygen -t ed25519 -C "your-email@example.com"
```

**Copy public key to server:**
```bash
# Using cloudflared SSH access
cloudflared access ssh --hostname ssh.firstovertheline.com
# Then once connected:
ssh-copy-id username@localhost
```

## Authentication Flow

### Cloudflare Access SSH Process

1. **Initiate Connection**:
   ```bash
   cloudflared access ssh --hostname ssh.firstovertheline.com
   ```

2. **Browser Authentication**:
   - Browser window opens automatically (or manual URL provided)
   - Cloudflare Zero Trust login page appears
   - Enter your authorized email address

3. **Multi-Factor Authentication**:
   - Complete MFA challenge if enabled
   - Cloudflare verifies team membership (`firstovertheline`)

4. **SSH Connection Establishment**:
   - Authentication successful → SSH session begins
   - You'll see SSH server response and command prompt
   - Session persists until manually disconnected

### SSH Short-Lived Certificates (Advanced)

For seamless SSH without browser popups, configure SSH certificates:

```bash
# Configure SSH proxy for automatic authentication
cloudflared access ssh-config --hostname ssh.firstovertheline.com

# Add to ~/.ssh/config for automatic proxy usage
# After setup, normal SSH commands work:
ssh username@ssh.firstovertheline.com
```

**Benefits**:
- No browser popups for each connection
- Automatic authentication through Cloudflare
- Certificates expire automatically for security
- Better user experience for frequent SSH usage

## Security Features

### Network Security
- **Zero Trust**: All connections require authentication
- **Team-based Access**: Only `firstovertheline` team members allowed
- **Encrypted Transport**: All traffic encrypted via Cloudflare tunnel
- **No Direct Exposure**: SSH service not directly accessible from internet

### Access Control
- **Email Verification**: Must use authorized email address
- **MFA Support**: Multi-factor authentication available
- **Audit Logging**: All access attempts logged in Cloudflare
- **Session Monitoring**: Active sessions visible in Zero Trust dashboard

### Network Isolation
- **Public App Unaffected**: `a4c.firstovertheline.com` remains public
- **Administrative Separation**: SSH access isolated from public services
- **Existing Infrastructure**: Uses current Cloudflare tunnel setup

## Troubleshooting

### Common SSH Issues

**Connection Refused:**
```bash
# Check if SSH server is running
sudo systemctl status ssh

# Check tunnel configuration
sudo systemctl status cloudflared

# Verify DNS resolution
dig ssh.firstovertheline.com +short
```

**Authentication Failures:**
- Verify team membership in Cloudflare Zero Trust dashboard
- Check that your email is authorized in SSH Access application
- Clear browser cookies and retry authentication
- Ensure you're using `cloudflared access ssh` command

**Permission Denied after authentication:**
```bash
# Check user account exists on server
id username

# Verify SSH key is properly installed
ssh-copy-id username@ssh.firstovertheline.com
```

### Zero Trust Issues

**Browser Authentication Not Working:**
- Try different browser or incognito mode
- Check corporate firewall settings
- Manually visit: `https://firstovertheline.cloudflareaccess.com` (replace with your team domain)
- Verify team membership status in dashboard

**Team Access Denied:**
- Contact administrator to verify team membership
- Ensure correct email address is being used
- Check if invitation email was received and accepted
- Verify SSH Access application includes your email

### Network Diagnostics

**Test DNS resolution:**
```bash
# Should return Cloudflare IPs
dig ssh.firstovertheline.com +short

# Test against multiple DNS servers
dig @1.1.1.1 ssh.firstovertheline.com +short
dig @8.8.8.8 ssh.firstovertheline.com +short
```

**Test HTTP connectivity:**
```bash
# Should return 302 redirect to authentication
# Note: Replace firstovertheline.com with your actual domain
curl -I https://ssh.firstovertheline.com

# Should show Cloudflare Access headers
curl -v https://ssh.firstovertheline.com 2>&1 | grep -i cf-
```

**Verify tunnel status:**
```bash
# Check service status
sudo systemctl status cloudflared

# Check tunnel connections
cloudflared tunnel info a4c-k3s-tunnel

# Monitor logs
journalctl -u cloudflared -f
```

## Performance Optimization

### SSH Performance
```bash
# Use compression for slow connections
cloudflared access ssh --hostname ssh.firstovertheline.com -- -C

# Enable connection multiplexing
# Add to ~/.ssh/config:
Host ssh.firstovertheline.com
  ControlMaster auto
  ControlPath /tmp/%r@%h:%p
  ControlPersist 10m
```

## Maintenance

### Regular Tasks

**SSH Server Maintenance:**
```bash
# Review SSH logs periodically
sudo journalctl -u ssh --since "1 week ago"

# Update SSH server when available
sudo apt update && sudo apt upgrade openssh-server
```

**Zero Trust Management:**
- Review team membership quarterly
- Monitor access logs for unusual activity
- Update authentication methods as needed
- Test authentication flow monthly

### Monitoring

**Active Sessions:**
```bash
# View current SSH sessions
who
last

# Monitor system resources
htop
```

**Cloudflare Access Logs:**
- Access logs available in Zero Trust dashboard
- Monitor for failed authentication attempts
- Review session duration patterns

## Advanced Configuration

### SSH Key-Only Authentication

**After SSH key setup, disable password authentication:**
```bash
# Edit /etc/ssh/sshd_config
sudo nano /etc/ssh/sshd_config

# Set:
PasswordAuthentication no
PubkeyAuthentication yes

# Restart SSH service
sudo systemctl restart ssh
```

### Custom SSH Configuration

**Client-side SSH config optimization:**
```bash
# Add to ~/.ssh/config
Host ssh.firstovertheline.com
  User your-username
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 60
  ServerAliveCountMax 3
  Compression yes
```

## Security Best Practices

### SSH Hardening
- Use SSH keys instead of passwords
- Configure fail2ban for brute force protection
- Regular security updates
- Monitor SSH access logs

### Access Management
- Regularly review team membership
- Use strong passwords for initial setup
- Enable multi-factor authentication
- Implement least-privilege access principles

---

## Support

For issues or questions:
1. Check this troubleshooting guide first
2. Review Cloudflare Zero Trust dashboard for access issues
3. Check system logs: `journalctl -u cloudflared -f`
4. Contact team administrator for access requests

**Security Note**: Always use the official `cloudflared access ssh` command for authenticated connections. Direct SSH connections bypass security controls.