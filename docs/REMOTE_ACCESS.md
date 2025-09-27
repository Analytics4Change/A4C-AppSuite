# Remote Access Guide

Secure SSH and VNC access to the A4C development environment via Cloudflare tunnels with Zero Trust authentication.

## Overview

This guide provides secure remote access to the development environment through:
- **SSH access**: `access.firstovertheline.com` (port 22)
- **VNC access**: `vnc.firstovertheline.com:5901` (display :1)
- **Security**: Cloudflare Zero Trust with `a4c-developers` team authentication
- **No Impact**: Public application at `a4c.firstovertheline.com` remains unaffected

## Prerequisites

### For Administrators
- [ ] Cloudflare tunnel configured and running
- [ ] DNS records created for access subdomains
- [ ] Zero Trust team `a4c-developers` configured
- [ ] VNC server installed and running on host
- [ ] SSH server enabled and configured

### For Users
- [ ] Cloudflare Zero Trust team membership (`a4c-developers`)
- [ ] SSH client (built into macOS/Linux)
- [ ] VNC client (Screen Sharing app on macOS)

## Quick Start

### SSH Access
```bash
ssh access.firstovertheline.com
```
1. Browser opens for Zero Trust authentication
2. Authenticate with your authorized email + MFA
3. SSH session establishes to the development server

### VNC Access (macOS)
```bash
open vnc://vnc.firstovertheline.com:5901
```
**Alternative methods:**
- Finder: `Cmd+K` → Enter `vnc://vnc.firstovertheline.com:5901`
- Screen Sharing.app: Connect to Server → `vnc.firstovertheline.com:5901`

1. Browser opens for Zero Trust authentication
2. Authenticate with your authorized email + MFA
3. VNC password prompt appears
4. Desktop session connects

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
PasswordAuthentication yes  # Initially, can disable after key setup
PubkeyAuthentication yes
X11Forwarding yes          # For GUI applications over SSH
ClientAliveInterval 60     # Keep connections alive
ClientAliveCountMax 3
```

### VNC Server Setup (Administrator)

Install and configure VNC server for remote desktop access:

```bash
# Install VNC server
sudo apt update
sudo apt install tightvncserver

# Start VNC server (first time setup)
vncserver :1

# This will prompt for VNC password (required for connections)
# Choose a secure password and remember it for client connections
```

**Configure VNC startup script:**
```bash
# Create startup script
nano ~/.vnc/xstartup
```

**Basic xstartup content:**
```bash
#!/bin/bash
xrdb $HOME/.Xresources
startxfce4 &  # or your preferred desktop environment
```

**Start VNC server with specific settings:**
```bash
# Start VNC server with custom geometry and depth
vncserver :1 -localhost -geometry 1920x1080 -depth 24

# Check VNC server status
vncserver -list

# Kill VNC server if needed
vncserver -kill :1
```

### DNS Configuration (Administrator)

Add DNS records in Cloudflare dashboard:

1. Navigate to Cloudflare Dashboard → Your Domain → DNS
2. Add these A records:
   ```
   Type: A
   Name: access
   Content: [your-tunnel-ip] (proxied through Cloudflare)
   
   Type: A  
   Name: vnc
   Content: [your-tunnel-ip] (proxied through Cloudflare)
   ```

**Note**: The tunnel IP is provided by Cloudflare and should be the same as your existing `a4c.firstovertheline.com` record.

### Zero Trust Team Setup (Administrator)

1. **Access Cloudflare Zero Trust Dashboard**
   - Go to Cloudflare Dashboard → Zero Trust
   - Navigate to Settings → Authentication

2. **Create Team (if not exists)**
   - Team name: `a4c-developers`
   - Configure authentication methods (email + MFA recommended)

3. **Add Team Members**
   - Go to Settings → Users
   - Add authorized email addresses
   - Send invitations to team members

4. **Configure Access Policies**
   - Navigate to Access → Applications
   - Policies should automatically apply based on tunnel configuration
   - Verify policies exist for:
     - `access.firstovertheline.com` → Team: `a4c-developers`
     - `vnc.firstovertheline.com` → Team: `a4c-developers`

## Client Connection Guide

### SSH Client Setup

**macOS/Linux (Terminal):**
```bash
# Basic connection
ssh access.firstovertheline.com

# With specific user
ssh username@access.firstovertheline.com

# With X11 forwarding for GUI apps
ssh -X access.firstovertheline.com

# With local port forwarding
ssh -L 8080:localhost:8080 access.firstovertheline.com
```

**Windows (PowerShell/WSL):**
```powershell
# Using built-in SSH client (Windows 10+)
ssh access.firstovertheline.com

# Or use PuTTY, WSL, or Git Bash
```

### VNC Client Setup

**macOS (Screen Sharing):**
```bash
# Command line
open vnc://vnc.firstovertheline.com:5901

# Via Finder
# 1. Press Cmd+K
# 2. Enter: vnc://vnc.firstovertheline.com:5901
# 3. Click Connect

# Via Screen Sharing app
# 1. Open Screen Sharing.app
# 2. Enter: vnc.firstovertheline.com:5901
# 3. Click Connect
```

**Windows (VNC Viewer):**
1. Download VNC Viewer from RealVNC
2. Install and open VNC Viewer
3. Enter server: `vnc.firstovertheline.com:5901`
4. Connect and follow authentication prompts

**Linux (Various clients):**
```bash
# Using Remmina
remmina vnc://vnc.firstovertheline.com:5901

# Using TigerVNC
vncviewer vnc.firstovertheline.com:5901

# Using Vinagre
vinagre vnc://vnc.firstovertheline.com:5901
```

## Authentication Flow

### Zero Trust Authentication Process

1. **Initiate Connection**
   - SSH: `ssh access.firstovertheline.com`
   - VNC: Connect to `vnc.firstovertheline.com:5901`

2. **Browser Authentication**
   - Browser window opens automatically
   - Cloudflare Zero Trust login page appears
   - Enter your authorized email address

3. **Multi-Factor Authentication**
   - Complete MFA challenge (SMS, authenticator app, etc.)
   - Cloudflare verifies team membership (`a4c-developers`)

4. **Connection Establishment**
   - Authentication successful → Connection proceeds
   - Authentication failed → Connection blocked

5. **Session Management**
   - SSH: Standard SSH session with terminal access
   - VNC: Desktop session requiring VNC password

### Session Persistence

- **SSH**: Sessions persist until manually disconnected or timeout
- **VNC**: Desktop sessions can be left running and reconnected
- **Authentication**: Zero Trust tokens have configurable expiration

## Security Features

### Network Security
- **Zero Trust**: All connections require authentication
- **Team-based Access**: Only `a4c-developers` team members allowed
- **Encrypted Transport**: All traffic encrypted via Cloudflare tunnel
- **No Direct Exposure**: Services not directly accessible from internet

### Access Control
- **Email Verification**: Must use authorized email address
- **MFA Required**: Multi-factor authentication enforced
- **Audit Logging**: All access attempts logged in Cloudflare
- **Session Monitoring**: Active sessions visible in Zero Trust dashboard

### Network Isolation
- **Public App Unaffected**: `a4c.firstovertheline.com` remains public
- **Administrative Separation**: SSH/VNC access isolated from public services
- **No Router Changes**: Uses existing Cloudflare tunnel infrastructure

## Troubleshooting

### Common SSH Issues

**Connection Refused:**
```bash
# Check if SSH server is running
sudo systemctl status ssh

# Check tunnel configuration
sudo systemctl status cloudflared

# Verify DNS resolution
nslookup access.firstovertheline.com
```

**Authentication Failures:**
- Verify team membership in Cloudflare Zero Trust
- Check email address authorization
- Clear browser cookies and retry
- Contact administrator for team access

**Permission Denied:**
```bash
# Check user account exists
id username

# Verify SSH configuration
sudo sshd -T | grep -i permitrootlogin
```

### Common VNC Issues

**Connection Timeout:**
```bash
# Check VNC server status
vncserver -list

# Restart VNC server if needed
vncserver -kill :1
vncserver :1 -localhost -geometry 1920x1080 -depth 24
```

**Black Screen/Desktop Issues:**
```bash
# Check desktop environment
ps aux | grep -i xfce  # or your DE

# Review VNC logs
cat ~/.vnc/*.log

# Restart with different desktop
echo "startxfce4 &" > ~/.vnc/xstartup
vncserver -kill :1
vncserver :1
```

**VNC Password Issues:**
```bash
# Reset VNC password
vncpasswd

# Restart VNC server
vncserver -kill :1
vncserver :1
```

### Zero Trust Issues

**Browser Not Opening:**
- Try connecting from different device/browser
- Check if corporate firewall blocks Cloudflare Access
- Manual navigation: Visit `https://a4c-developers.cloudflareaccess.com`

**Team Access Denied:**
- Contact administrator to verify team membership
- Ensure correct email address is being used
- Check if invitation email was received and accepted

**MFA Problems:**
- Verify authenticator app is in sync
- Use backup codes if available
- Contact administrator to reset MFA

### Network Diagnostics

**Test Connectivity:**
```bash
# Test DNS resolution
dig access.firstovertheline.com
dig vnc.firstovertheline.com

# Test HTTP connectivity (should get Access page)
curl -I https://access.firstovertheline.com

# Test tunnel status
cloudflared tunnel info a4c-k3s-tunnel
```

**Verify Configuration:**
```bash
# Check tunnel configuration
cat /home/lars/.cloudflared/config.yml

# Check tunnel logs
journalctl -u cloudflared -f
```

## Performance Optimization

### SSH Performance
```bash
# Use compression for slow connections
ssh -C access.firstovertheline.com

# Multiplex connections
ssh -o ControlMaster=auto -o ControlPath=/tmp/%r@%h:%p access.firstovertheline.com
```

### VNC Performance
```bash
# Lower color depth for faster performance
vncserver :1 -depth 16

# Smaller geometry for bandwidth-limited connections
vncserver :1 -geometry 1366x768

# Enable compression (client-side)
vncviewer -AutoSelect=0 -FullColor=0 vnc.firstovertheline.com:5901
```

## Maintenance

### Regular Tasks

**VNC Server Maintenance:**
```bash
# Weekly restart for stability
vncserver -kill :1
vncserver :1 -localhost -geometry 1920x1080 -depth 24

# Monitor VNC logs for issues
tail -f ~/.vnc/*.log
```

**SSH Configuration:**
```bash
# Review SSH logs periodically
sudo journalctl -u ssh -f

# Update SSH server when available
sudo apt update && sudo apt upgrade openssh-server
```

**Zero Trust Management:**
- Review team membership quarterly
- Monitor access logs for suspicious activity
- Update MFA methods as needed
- Rotate authentication credentials annually

### Monitoring

**Active Sessions:**
```bash
# View SSH sessions
who
last

# View VNC sessions
vncserver -list
ps aux | grep vnc
```

**Resource Usage:**
```bash
# Monitor system resources during remote sessions
htop
iotop
```

## Advanced Configuration

### SSH Key Authentication

**Generate SSH key pair:**
```bash
# On client machine
ssh-keygen -t ed25519 -C "your-email@example.com"

# Copy public key to server
ssh-copy-id access.firstovertheline.com
```

**Disable password authentication:**
```bash
# On server (/etc/ssh/sshd_config)
PasswordAuthentication no
sudo systemctl restart ssh
```

### VNC Desktop Environment

**Configure specific desktop environment:**
```bash
# For XFCE
echo "startxfce4 &" > ~/.vnc/xstartup

# For GNOME
echo "gnome-session &" > ~/.vnc/xstartup

# For KDE
echo "startkde &" > ~/.vnc/xstartup

# Make executable
chmod +x ~/.vnc/xstartup
```

### Custom Port Configuration

**SSH on non-standard port:**
```bash
# Modify tunnel config to use different port
service: ssh://192.168.122.42:2222
```

**Multiple VNC displays:**
```bash
# Start additional VNC servers
vncserver :2 -geometry 1920x1080 -depth 24
vncserver :3 -geometry 1366x768 -depth 16

# Access via different ports
# :1 = port 5901
# :2 = port 5902
# :3 = port 5903
```

## Security Best Practices

### SSH Hardening
- Use SSH keys instead of passwords when possible
- Configure fail2ban to prevent brute force attacks
- Use non-standard SSH port if needed
- Enable SSH session logging

### VNC Security
- Always use VNC in localhost-only mode (`-localhost`)
- Use strong VNC passwords (8+ characters)
- Consider VNC over SSH for additional encryption
- Disable VNC when not needed

### Access Management
- Regularly review team membership
- Use short-lived authentication tokens
- Monitor access logs for anomalies
- Implement least-privilege access principles

---

## Support

For issues or questions:
1. Check this troubleshooting guide first
2. Review Cloudflare Zero Trust dashboard for access issues
3. Check system logs for technical issues
4. Contact team administrator for access requests

**Important**: Never share VNC passwords or SSH keys. All access should go through the official Zero Trust authentication flow.